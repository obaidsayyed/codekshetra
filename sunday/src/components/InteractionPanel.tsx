import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSettings } from "../hooks/useSettings";
import { getBridge } from "../services/bridge";
import { playSound, setSoundEnabled, setSoundVolume, wireUiSounds } from "../services/sound";
import type { PanelMessage } from "../shared/ipc";
import { isNightActive } from "../shared/settings";
import { SkinPortrait } from "./CustomizationPanel";
import { IconClose, IconMic, IconMicOff, IconMinus, IconPlug, IconSend } from "./Icons";
import { PwaInstallHeaderButton } from "./PwaInstallBanner";
import { webVoice, type WebVoiceListenerState } from "../services/webVoice";

/**
 * The floating chat panel — presentation layer only. It shows messages pushed
 * by the main process and forwards what the user types to the integration
 * hook. With no backend attached it says so plainly and never invents a reply.
 */

const QUICK_STARTS = ["What can you do?", "Show me today's tasks", "Summarise my notes", "Tell me a fun fact"];

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function InteractionPanel() {
  const bridge = getBridge();
  const [settings] = useSettings();
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceState, setVoiceState] = useState<WebVoiceListenerState>(webVoice.getSnapshot());
  const [noteOpen, setNoteOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const night = isNightActive(settings.nightMode);

  useEffect(() => {
    return webVoice.subscribe(setVoiceState);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("view-panel");
    document.title = "SUNDAY";
    return () => document.documentElement.classList.remove("view-panel");
  }, []);

  useEffect(() => {
    setSoundEnabled(settings.soundEffects && !settings.quietMode);
    setSoundVolume(settings.soundVolume);
  }, [settings.soundEffects, settings.quietMode, settings.soundVolume]);

  useEffect(() => (rootRef.current ? wireUiSounds(rootRef.current) : undefined), []);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getAppInfo().then((i) => setConnected(i.integrationConnected));
    void bridge.panel.getHistory().then(setMessages);
    const unsubMsg = bridge.panel.onMessage((m) => {
      if (m.role === "sunday") playSound("receive");
      setMessages((prev) => [...prev.filter((p) => p.id !== m.id), m]);
    });
    let unsubMute = () => {};
    if (bridge.voice) {
      void bridge.voice.getMute().then(setVoiceMuted);
      unsubMute = bridge.voice.onMuteChanged((m) => {
        setVoiceMuted(m);
      });
    }
    return () => {
      unsubMsg();
      unsubMute();
    };
  }, [bridge]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // grow the textarea with its content
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(110, el.scrollHeight)}px`;
  }, [draft]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    playSound("send");
    if (!bridge) {
      setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", text, timestamp: Date.now(), status: "not-delivered" }]);
      return;
    }
    const res = await bridge.panel.sendUserMessage(text);
    setConnected(res.delivered);
  };

  const toggleMute = async () => {
    if (!bridge?.voice) return;
    playSound("click");
    const nextState = !voiceMuted;
    setVoiceMuted(nextState);
    const res = await bridge.voice.setMute(nextState);
    if (res && typeof res.muted === "boolean") {
      setVoiceMuted(res.muted);
    }
  };

  const visible = messages.filter((m) => m.role !== "system" || connected);

  return (
    <div className={`panel-shell ${night ? "is-night" : ""}`} ref={rootRef}>
      <div className="chat-panel">
        <header className="chat-header drag-region">
          <div className="chat-avatar">
            <SkinPortrait appearance={settings.appearance} size={34} />
            <i className={`presence ${connected ? "is-on" : ""}`} aria-hidden />
          </div>
          <div className="chat-title">
            <h1>SUNDAY</h1>
            <span className="conn">
              {connected
                ? voiceMuted
                  ? "Chat mode only · Mic muted"
                  : "Online · ready to help"
                : "Not connected yet"}
            </span>
          </div>
          <div className="chat-controls no-drag">
            <PwaInstallHeaderButton />
            <button
              type="button"
              className={`voice-wake-pill ${voiceState.isAwake ? "is-awake" : "is-standby"}`}
              onClick={() => (voiceState.isAwake ? webVoice.goToStandby() : webVoice.wakeUp())}
              title={voiceState.isAwake ? "Put Sunday to Standby Sleep" : "Wake Sunday & Start Listening"}
            >
              <span className="wake-indicator-dot" />
              <span>{voiceState.isAwake ? "Listening" : 'Say "Sunday"'}</span>
            </button>
            <button
              type="button"
              className="nav-studio-btn"
              onClick={() => { window.location.hash = "studio"; }}
              title="Open Animation Studio"
            >
              🎬 Studio
            </button>
            <button
              type="button"
              className={`mute-btn ${voiceMuted ? "is-muted" : ""}`}
              onClick={toggleMute}
              aria-label={voiceMuted ? "Unmute voice commands (Turn on mic)" : "Mute voice commands (Chat mode only)"}
              title={voiceMuted ? "Unmute mic (Voice commands enabled)" : "Mute mic (Chat mode only)"}
            >
              {voiceMuted ? <IconMicOff /> : <IconMic />}
            </button>
            <button type="button" onClick={() => bridge?.minimizeWindow()} aria-label="Minimize" title="Minimize">
              <IconMinus />
            </button>
            <button type="button" onClick={() => bridge?.closeWindow()} aria-label="Close" title="Close">
              <IconClose />
            </button>
          </div>
        </header>

        {!connected && noteOpen && (
          <div className="not-connected" role="note">
            <IconPlug />
            <p>
              <b>No assistant is plugged in yet.</b> Messages stay here and aren&rsquo;t sent anywhere.
            </p>
            <button type="button" onClick={() => setNoteOpen(false)} aria-label="Dismiss note" title="Dismiss">
              ✕
            </button>
          </div>
        )}

        <div className="chat-messages" ref={listRef}>
          {visible.length === 0 ? (
            <div className="chat-empty">
              <SkinPortrait appearance={settings.appearance} size={72} />
              <h2>Hi, I&rsquo;m Sunday!</h2>
              <p>{connected ? "Ask me anything — I'll answer right here." : "Once my assistant brain is connected, we can chat right here."}</p>
            </div>
          ) : (
            <>
              <span className="day-sep">Today</span>
              {visible.map((m) => (
                <div key={m.id} className={`msg msg-${m.role}`}>
                  {m.role === "sunday" && (
                    <div className="msg-avatar">
                      <SkinPortrait appearance={settings.appearance} size={26} />
                    </div>
                  )}
                  <div className="msg-body">
                    <p>{m.text}</p>
                    {m.role !== "system" && (
                      <span className="msg-meta">
                        {time(m.timestamp)}
                        {m.status === "not-delivered" && <span className="msg-status">not sent · no assistant connected</span>}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {visible.length === 0 && (
          <div className="quick-chips no-drag">
            {QUICK_STARTS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setDraft(q);
                  inputRef.current?.focus();
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <form
          className="chat-input no-drag"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              } else if (e.key.length === 1 || e.key === "Backspace") {
                playSound("keypress");
              }
            }}
            placeholder="Type a message…"
            maxLength={4000}
            aria-label="Message"
          />
          <button type="submit" className="send" aria-label="Send" disabled={!draft.trim()} data-sound="off">
            <IconSend />
          </button>
        </form>
        <div className="chat-footer">
          <span>Enter to send · Shift+Enter for a new line</span>
          {draft.length > 3500 && <span>{4000 - draft.length} left</span>}
        </div>
      </div>
    </div>
  );
}
