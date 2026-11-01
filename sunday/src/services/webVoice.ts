import { getBridge } from "./bridge";
import { playSound } from "./sound";
import { say } from "./voice";

/**
 * In-Browser Web Speech Recognition & Wake Word Engine for SUNDAY PWA.
 * Continuously listens for "Sunday" / "Hey Sunday" to wake up.
 * In standby, ambient noise is ignored until the wake word is heard.
 * While awake, accepts commands and stops / goes to standby on "thank you".
 */

export type WebVoiceState = "standby" | "waking" | "listening" | "processing" | "speaking";

export interface WebVoiceListenerState {
  isSupported: boolean;
  isListening: boolean;
  isAwake: boolean;
  state: WebVoiceState;
  transcript: string;
  error: string | null;
}

type StateCallback = (state: WebVoiceListenerState) => void;

class WebVoiceService {
  private recognition: any = null;
  private isSupported = false;
  private shouldListen = false;
  private isAwake = false;
  private currentState: WebVoiceState = "standby";
  private currentTranscript = "";
  private lastError: string | null = null;
  private listeners = new Set<StateCallback>();
  private restartTimer: number | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.isSupported = true;
        this.initRecognition(SpeechRecognition);
      }
    }
  }

  private initRecognition(SpeechRecognitionClass: any): void {
    try {
      this.recognition = new SpeechRecognitionClass();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = "en-US";
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.lastError = null;
        this.notify();
      };

      this.recognition.onerror = (event: any) => {
        // "no-speech" is normal when room is quiet; don't count as fatal error
        if (event.error !== "no-speech") {
          this.lastError = event.error;
          this.notify();
        }
      };

      this.recognition.onend = () => {
        if (this.shouldListen) {
          // Continuous restart loop with slight backoff
          if (this.restartTimer) window.clearTimeout(this.restartTimer);
          this.restartTimer = window.setTimeout(() => {
            try {
              if (this.shouldListen && this.recognition) {
                this.recognition.start();
              }
            } catch {
              /* ignore already started */
            }
          }, 300);
        } else {
          this.notify();
        }
      };

      this.recognition.onresult = (event: any) => {
        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            final += item[0].transcript;
          } else {
            interim += item[0].transcript;
          }
        }

        const heard = (final || interim).trim();
        if (!heard) return;

        this.currentTranscript = heard;
        this.notify();

        if (final) {
          this.handleSpeech(final.trim());
        } else {
          // Handle wake word in interim results for ultra-fast reaction
          this.checkInterimWakeWord(interim.trim());
        }
      };
    } catch (e: any) {
      this.lastError = e?.message || "Failed to initialize speech recognition";
      this.isSupported = false;
    }
  }

  private checkInterimWakeWord(phrase: string): void {
    if (this.isAwake) return;
    const wakeRegex = /\b(hey\s+sunday|hi\s+sunday|hello\s+sunday|ok\s+sunday|okay\s+sunday|sunday|sundae)\b/i;
    if (wakeRegex.test(phrase)) {
      this.wakeUp({ fromWakeWord: true, partialText: phrase });
    }
  }

  private handleSpeech(phrase: string): void {
    const bridge = getBridge();
    const wakeRegex = /\b(hey\s+sunday|hi\s+sunday|hello\s+sunday|ok\s+sunday|okay\s+sunday|sunday|sundae)\b/i;
    const dismissRegex = /\b(thank\s+you|thanks|no\s+that'?s\s+it|that'?s\s+all|that\s+is\s+all|nothing\s+else|go\s+to\s+sleep|sleep\s+sunday|goodnight|bye\s+sunday)\b/i;

    // 1. If currently in standby / sleeping:
    if (!this.isAwake) {
      if (wakeRegex.test(phrase)) {
        // Wake up!
        const cleaned = phrase.replace(wakeRegex, "").trim();
        this.wakeUp({ fromWakeWord: true });

        // If user said something right after the wake word (e.g. "Sunday read mail from john")
        if (cleaned.length > 2) {
          this.processCommand(cleaned);
        }
      }
      return;
    }

    // 2. If already awake:
    // Check for dismissive phrase to put Sunday back to standby
    if (dismissRegex.test(phrase)) {
      this.goToStandby("Alright, let me know if you need anything else.");
      return;
    }

    // If user said "Sunday" again while awake, acknowledge gently
    if (/^(sunday|hey sunday)$/i.test(phrase.trim())) {
      bridge.sendPetCommand({ type: "setState", state: "listening" });
      bridge.sendPetCommand({ type: "setSpeech", text: "I'm listening!" });
      playSound("wake");
      return;
    }

    // Actual user command
    this.processCommand(phrase);
  }

  private async processCommand(text: string): Promise<void> {
    const bridge = getBridge();
    this.setState("processing");
    bridge.sendPetCommand({ type: "setState", state: "working" });
    bridge.sendPetCommand({ type: "setSpeech", text: "Working on it..." });

    try {
      await bridge.panel.sendUserMessage(text);
    } finally {
      if (this.isAwake) {
        this.setState("listening");
      }
    }
  }

  /** Wakes Sunday up immediately (via wake word or manual Start button). */
  wakeUp(options: { fromWakeWord?: boolean; partialText?: string } = {}): void {
    this.isAwake = true;
    this.setState("listening");

    const bridge = getBridge();
    bridge.sendPetCommand({ type: "wake" });
    playSound("wake");

    window.setTimeout(() => {
      bridge.sendPetCommand({ type: "setState", state: "listening" });
      const greeting = options.fromWakeWord ? "I'm listening!" : "Hello! I'm Sunday. How can I help you today?";
      bridge.sendPetCommand({ type: "setSpeech", text: greeting });
      say(greeting);
    }, 400);

    // Ensure listening is active
    if (!this.shouldListen) {
      void this.start();
    }
  }

  /** Puts Sunday back to standby sleep (strictly listening for "Sunday" again). */
  goToStandby(farewell = "Alright, let me know if you need anything else."): void {
    this.isAwake = false;
    this.setState("standby");

    const bridge = getBridge();
    bridge.sendPetCommand({ type: "setState", state: "sleeping" });
    bridge.sendPetCommand({ type: "setSpeech", text: "💤 Standby — Say 'Sunday' to wake" });
    say(farewell);
  }

  /** Starts the continuous microphone listener (prompts for mic permission if first time). */
  async start(): Promise<boolean> {
    if (!this.isSupported) return false;
    this.shouldListen = true;
    try {
      if (this.recognition) {
        this.recognition.start();
      }
      this.notify();
      return true;
    } catch (e: any) {
      if (e?.name !== "InvalidStateError") {
        this.lastError = e?.message || "Failed to start microphone";
        this.notify();
      }
      return false;
    }
  }

  /** Stops the microphone listener completely. */
  stop(): void {
    this.shouldListen = false;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* ignore */
      }
    }
    this.isAwake = false;
    this.setState("standby");
    this.notify();
  }

  toggleListening(): void {
    if (this.shouldListen) {
      this.stop();
    } else {
      void this.start();
    }
  }

  private setState(st: WebVoiceState): void {
    this.currentState = st;
    this.notify();
  }

  private notify(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  getSnapshot(): WebVoiceListenerState {
    return {
      isSupported: this.isSupported,
      isListening: this.shouldListen,
      isAwake: this.isAwake,
      state: this.currentState,
      transcript: this.currentTranscript,
      error: this.lastError,
    };
  }

  subscribe(cb: StateCallback): () => void {
    this.listeners.add(cb);
    cb(this.getSnapshot());
    return () => this.listeners.delete(cb);
  }
}

export const webVoice = new WebVoiceService();
