"""
High-Fidelity Audio I/O for SUNDAY.
Captures at device's native hardware sample rate (e.g. 44.1 kHz), resamples to 16 kHz,
and applies automatic gain normalization for Whisper STT and openWakeWord.
"""
import time
import wave
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import scipy.signal
import sounddevice as sd
from app.config.settings import settings
from app.audit.logger import audit_logger


TARGET_SAMPLE_RATE = 16000  # 16 kHz required by Whisper & wake word
CHANNELS = 1                # Mono


def apply_highpass_filter(data: np.ndarray, sample_rate: int = 16000, cutoff: float = 80.0) -> np.ndarray:
    """
    Applies a 4th-order Butterworth high-pass filter at 80 Hz.
    Eliminates laptop fan hum, table rumble, and low-frequency electrical noise.
    """
    try:
        nyquist = 0.5 * sample_rate
        norm_cutoff = cutoff / nyquist
        if norm_cutoff >= 1.0:
            return data
        b, a = scipy.signal.butter(4, norm_cutoff, btype='high', analog=False)
        return scipy.signal.filtfilt(b, a, data)
    except Exception:
        return data


class AudioIO:
    def __init__(self):
        self.is_muted: bool = False
        self.is_recording: bool = False
        self.target_rate = TARGET_SAMPLE_RATE
        self.channels = CHANNELS
        self.last_audio_level: float = 0.0

    def get_device_native_rate(self) -> int:
        """Determines the default input device's native hardware sample rate."""
        try:
            device_idx = sd.default.device[0]
            if device_idx is not None and device_idx >= 0:
                info = sd.query_devices(device_idx)
                rate = int(info.get("default_samplerate", 44100))
                return rate
        except Exception as e:
            audit_logger.warning("Could not query default device rate: %s. Using 44100.", e)
        return 44100

    def set_mute(self, muted: bool) -> None:
        self.is_muted = muted
        audit_logger.info("Microphone mute status set to: %s", muted)

    def record_speech_dynamic(
        self,
        max_duration_sec: float = 60.0,
        silence_timeout_sec: float = 1.2,
        initial_silence_timeout_sec: float = 5.0,
        min_duration_sec: float = 0.6,
        energy_threshold: float = 0.008,
        on_chunk: Optional[callable] = None
    ) -> Optional[np.ndarray]:
        """
        Dynamically records speech until the user finishes talking (VAD endpointing).
        Allows up to 5.0s for the user to begin speaking so commands are never prematurely cut off.
        Endpoints speech after 1.2s of silence. Rejects room/fan noise below calibrated threshold.
        """
        if self.is_muted:
            audit_logger.warning("Dynamic record requested while muted. Capture aborted.")
            return None

        self.is_recording = True
        native_rate = self.get_device_native_rate()
        chunk_duration = 0.15  # 150ms per block
        chunk_samples = int(chunk_duration * native_rate)

        chunks = []
        speech_started = False
        silence_elapsed = 0.0
        total_time = 0.0
        ambient_samples = []
        effective_threshold = energy_threshold

        audit_logger.info("Dynamic recording started (max %.1fs, pause endpoint: %.1fs, standby timeout: %.1fs)...",
                          max_duration_sec, silence_timeout_sec, initial_silence_timeout_sec)

        try:
            with sd.InputStream(samplerate=native_rate, channels=self.channels, dtype='float32', blocksize=chunk_samples) as stream:
                while total_time < max_duration_sec:
                    if self.is_muted:
                        break
                    data, _ = stream.read(chunk_samples)
                    chunk_flat = data.flatten()
                    chunks.append(chunk_flat)
                    total_time += chunk_duration

                    rms = float(np.sqrt(np.mean(chunk_flat ** 2)))
                    self.last_audio_level = float(np.max(np.abs(chunk_flat)))

                    # Calibrate ambient noise during initial 300ms
                    if len(ambient_samples) < 2:
                        ambient_samples.append(rms)
                        if len(ambient_samples) == 2:
                            ambient_floor = float(np.mean(ambient_samples))
                            effective_threshold = min(0.02, max(energy_threshold, ambient_floor * 1.5))
                            audit_logger.debug("Ambient noise floor: %.5f, effective speech threshold: %.5f", ambient_floor, effective_threshold)

                    if on_chunk:
                        on_chunk(self.last_audio_level, total_time)

                    if rms >= effective_threshold:
                        speech_started = True
                        silence_elapsed = 0.0
                    else:
                        if speech_started:
                            silence_elapsed += chunk_duration
                            if silence_elapsed >= silence_timeout_sec and total_time >= min_duration_sec:
                                audit_logger.info("Speech endpoint detected (%.2fs silence). Ending capture.", silence_elapsed)
                                break
                        else:
                            # User hasn't started speaking; wait at most initial_silence_timeout_sec (1.5s)
                            if total_time >= initial_silence_timeout_sec:
                                audit_logger.info("No speech detected within %.1fs. Returning to standby for new conversation.", initial_silence_timeout_sec)
                                break

            if not chunks or not speech_started:
                return None

            raw_audio = np.concatenate(chunks)
            audit_logger.info("Dynamic capture finished: %.2f seconds total audio.", total_time)

            # Resample to 16 kHz
            if native_rate != self.target_rate:
                num_target_samples = int(len(raw_audio) * self.target_rate / native_rate)
                resampled = scipy.signal.resample(raw_audio, num_target_samples)
            else:
                resampled = raw_audio

            # Apply high-pass filter at 80 Hz to remove fan hum / desk rumble
            filtered = apply_highpass_filter(resampled, sample_rate=self.target_rate, cutoff=80.0)

            # Gain normalization only for genuine speech signals
            max_val = float(np.max(np.abs(filtered)))
            if max_val >= 0.005:
                gain = min(0.85 / max_val, 10.0)
                filtered = filtered * gain
            else:
                audit_logger.info("Audio signal too quiet (peak: %.4f). Treating as silence.", max_val)
                return None

            filtered = np.clip(filtered, -1.0, 1.0)
            return (filtered * 32767.0).astype(np.int16)

        except Exception as e:
            audit_logger.error("Dynamic speech recording failed: %s", e)
            return None
        finally:
            self.is_recording = False

    def record_audio(self, duration_sec: float = 5.0) -> Optional[np.ndarray]:
        """
        Records mono audio at native hardware rate and resamples to 16 kHz with gain normalization.
        """
        if self.is_muted:
            audit_logger.warning("Record requested while muted. Capture aborted.")
            return None

        self.is_recording = True
        native_rate = self.get_device_native_rate()
        num_frames = int(duration_sec * native_rate)

        try:
            audit_logger.info("Recording audio for %.1fs at native rate %d Hz...", duration_sec, native_rate)
            # Record in float32 for maximum dynamic range
            rec = sd.rec(num_frames, samplerate=native_rate, channels=self.channels, dtype='float32')
            sd.wait()
            raw_audio = rec.flatten()

            # Measure incoming volume level
            peak = float(np.max(np.abs(raw_audio)))
            rms = float(np.sqrt(np.mean(raw_audio ** 2)))
            self.last_audio_level = peak
            audit_logger.info("Recorded audio peak: %.4f, RMS: %.4f", peak, rms)

            if peak < 0.001:
                audit_logger.warning("Recorded audio is silent. Check microphone privacy / mute settings in Windows.")

            # Resample to 16 kHz
            if native_rate != self.target_rate:
                num_target_samples = int(len(raw_audio) * self.target_rate / native_rate)
                resampled = scipy.signal.resample(raw_audio, num_target_samples)
            else:
                resampled = raw_audio

            # Automatic Gain Control / Peak Normalization for Whisper
            # Amplifies quiet room speech so Whisper receives clear audio
            max_val = np.max(np.abs(resampled))
            if max_val > 0.005:
                # Normalize peak to 0.70
                gain = min(0.70 / max_val, 15.0)  # Max 15x gain boost
                resampled = resampled * gain
                audit_logger.info("Applied AGC gain: %.2fx (normalized peak: %.3f)", gain, np.max(np.abs(resampled)))

            # Clip to valid range and convert to 16-bit integer PCM
            resampled = np.clip(resampled, -1.0, 1.0)
            int16_audio = (resampled * 32767.0).astype(np.int16)
            return int16_audio

        except Exception as e:
            audit_logger.error("Audio recording failed: %s", e)
            return None
        finally:
            self.is_recording = False
            audit_logger.error("Audio recording failed: %s", e)
            return None

    def save_wav(self, audio_data: np.ndarray, file_path: Path) -> Path:
        """Saves numpy int16 audio array to a standard 16-bit mono WAV file."""
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(file_path), 'wb') as wf:
            wf.setnchannels(self.channels)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(self.target_rate)
            wf.writeframes(audio_data.tobytes())
        return file_path

    def play_wav(self, file_path: Path) -> None:
        """Plays a WAV file through default speakers."""
        try:
            with wave.open(str(file_path), 'rb') as wf:
                sr = wf.getframerate()
                n_frames = wf.getnframes()
                data = wf.readframes(n_frames)
                audio_arr = np.frombuffer(data, dtype=np.int16)
                sd.play(audio_arr, samplerate=sr)
                sd.wait()
        except Exception as e:
            audit_logger.warning("sounddevice play failed: %s. Using winsound fallback.", e)
            try:
                import winsound
                winsound.PlaySound(str(file_path), winsound.SND_FILENAME)
            except Exception as e2:
                audit_logger.error("winsound playback failed: %s", e2)


audio_io = AudioIO()
