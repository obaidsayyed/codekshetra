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
        max_duration_sec: float = 45.0,
        silence_timeout_sec: float = 1.8,
        min_duration_sec: float = 1.2,
        energy_threshold: float = 0.004,
        on_chunk: Optional[callable] = None
    ) -> Optional[np.ndarray]:
        """
        Dynamically records speech until the user finishes talking (VAD endpointing).
        Allows full natural conversations and long multi-sentence instructions without premature cutoff.
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

        audit_logger.info("Dynamic recording started (max %.1fs, silence stop: %.1fs)...", max_duration_sec, silence_timeout_sec)

        try:
            with sd.InputStream(samplerate=native_rate, channels=self.channels, dtype='float32', blocksize=chunk_samples) as stream:
                while total_time < max_duration_sec:
                    if self.is_muted:
                        break
                    data, overflowed = stream.read(chunk_samples)
                    chunk_flat = data.flatten()
                    chunks.append(chunk_flat)
                    total_time += chunk_duration

                    rms = float(np.sqrt(np.mean(chunk_flat ** 2)))
                    self.last_audio_level = float(np.max(np.abs(chunk_flat)))

                    if on_chunk:
                        on_chunk(self.last_audio_level, total_time)

                    if rms >= energy_threshold:
                        speech_started = True
                        silence_elapsed = 0.0
                    else:
                        if speech_started:
                            silence_elapsed += chunk_duration
                            if silence_elapsed >= silence_timeout_sec and total_time >= min_duration_sec:
                                audit_logger.info("Speech endpoint detected (%.2fs silence). Ending capture.", silence_elapsed)
                                break
                        else:
                            # User hasn't started speaking yet; allow up to 7 seconds before idle timeout
                            if total_time >= 7.0:
                                audit_logger.info("No speech detected after 7s. Ending capture.")
                                break

            if not chunks:
                return None

            raw_audio = np.concatenate(chunks)
            audit_logger.info("Dynamic capture finished: %.2f seconds total audio.", total_time)

            # Resample to 16 kHz
            if native_rate != self.target_rate:
                num_target_samples = int(len(raw_audio) * self.target_rate / native_rate)
                resampled = scipy.signal.resample(raw_audio, num_target_samples)
            else:
                resampled = raw_audio

            # Gain normalization for clear Whisper transcription
            max_val = np.max(np.abs(resampled))
            if max_val > 0.003:
                gain = min(0.75 / max_val, 15.0)
                resampled = resampled * gain

            resampled = np.clip(resampled, -1.0, 1.0)
            return (resampled * 32767.0).astype(np.int16)

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
