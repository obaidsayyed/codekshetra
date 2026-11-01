/**
 * Bridge connecting the SUNDAY Electron 3D Companion Frontend to the Python Backend Engine.
 *
 * Communicates via local HTTP and Event stream on 127.0.0.1:8765:
 * - Forwards chat panel user messages directly to Python workflow engine.
 * - Drives 3D character poses (idle, thinking, working, talking, celebrating, error, listening).
 * - Displays character speech bubbles above Sunday's head.
 * - Synchronizes voice session status (wakeword, STT, TTS) with 3D animations.
 */
import http from "node:http";
import { BrowserWindow } from "electron";
import { IPC } from "../src/shared/ipc";
import type { IntegrationHub } from "./integration";
import type { DesktopManager } from "./desktopManager";
import type { SundayState } from "../src/shared/states";

const BACKEND_HOST = "127.0.0.1";
const BACKEND_PORT = 8765;

interface ApiResponse {
  success?: boolean;
  status?: string;
  spoken_message?: string;
  spoken_prompt?: string;
  message?: string;
  error?: string;
  approval_id?: string;
  muted?: boolean;
}

interface ServerEvent {
  id: number;
  type: string;
  state?: SundayState;
  speech?: string;
  role?: "sunday" | "system";
  text?: string;
  muted?: boolean;
  visible?: boolean;
}

export function sendToPython(path: string, body?: Record<string, unknown>): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : "";
    const options: http.RequestOptions = {
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path,
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: 120000, // Tasks like month-end close can take up to 2 minutes
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch {
          resolve({ success: res.statusCode === 200, message: data });
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request to Python backend timed out."));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

export async function setVoiceMute(muted?: boolean): Promise<{ success: boolean; muted: boolean }> {
  try {
    const body = muted !== undefined ? { muted } : {};
    const res = await sendToPython("/api/voice/mute", body);
    return { success: true, muted: Boolean(res?.muted) };
  } catch (err: any) {
    console.error("[bridge] Failed to toggle voice mute:", err);
    return { success: false, muted: false };
  }
}

export async function getVoiceMute(): Promise<boolean> {
  try {
    const res = await sendToPython("/api/voice/mute");
    return Boolean(res?.muted);
  } catch {
    return false;
  }
}

export function initPythonBackendBridge(hub: IntegrationHub, desktop?: DesktopManager): void {
  console.log("[bridge] Initializing Python backend connection bridge...");

  let lastEventId = 0;
  let isConnected = false;
  let workingTimer: NodeJS.Timeout | null = null;

  // 1. Subscribe to User Messages typed into Sunday's Chat Panel
  hub.panel.onUserMessage(async (text) => {
    console.log(`[bridge] User message from panel: "${text}"`);
    try {
      // Step A: Character immediately enters 'thinking' state
      hub.controller.setState("thinking");
      hub.controller.setSpeech("Thinking...");

      // Step B: If processing takes >500ms, Sunday sits and types on his tiny laptop ('working')
      workingTimer = setTimeout(() => {
        hub.controller.setState("working");
        hub.controller.setSpeech("Working on it...");
      }, 500);

      // Step C: Send objective to Python workflow engine
      const res = await sendToPython("/api/message", { text });
      if (workingTimer) clearTimeout(workingTimer);

      console.log("[bridge] Backend response received:", res);

      // Step D: Handle Execution Result
      if (res && res.success) {
        const spokenMsg = res.spoken_message || res.message || "Task completed successfully.";

        // Celebrate task completion!
        hub.controller.setState("celebrating");
        hub.controller.setSpeech(spokenMsg);
        hub.panel.pushMessage({ role: "sunday", text: spokenMsg });

        // Transition back to calm idle after celebration
        setTimeout(() => {
          hub.controller.setState("idle");
          hub.controller.clearSpeech();
        }, 5000);
      } else if (res && res.status === "waiting_for_owner") {
        const prompt = res.spoken_prompt || "Owner voice approval required.";
        hub.controller.setState("thinking");
        hub.controller.setSpeech(prompt);
        hub.panel.pushMessage({ role: "system", text: prompt });
      } else if (res && res.status === "conversational") {
        const reply = res.spoken_message || "I understand.";
        hub.controller.setState("talking");
        hub.controller.setSpeech(reply);
        hub.panel.pushMessage({ role: "sunday", text: reply });
        setTimeout(() => {
          hub.controller.setState("idle");
          hub.controller.clearSpeech();
        }, 4500);
      } else {
        const errText = res?.spoken_message || res?.error || "I could not complete that task.";
        hub.controller.setState("error");
        hub.controller.setSpeech(errText);
        hub.panel.pushMessage({ role: "system", text: errText });
        setTimeout(() => {
          hub.controller.setState("idle");
          hub.controller.clearSpeech();
        }, 4000);
      }
    } catch (err: any) {
      if (workingTimer) clearTimeout(workingTimer);
      console.error("[bridge] Failed to communicate with Python backend:", err);
      hub.controller.setState("error");
      hub.controller.setSpeech("Could not reach Python backend.");
      hub.panel.pushMessage({
        role: "system",
        text: `Backend connection error: ${err.message}. Ensure SUNDAY Python engine is active on port ${BACKEND_PORT}.`,
      });
      setTimeout(() => {
        hub.controller.setState("idle");
        hub.controller.clearSpeech();
      }, 4000);
    }
  });

  // 2. Poll Event Stream from Python Backend (Voice wakeword, status changes, TTS speech)
  const pollBackendEvents = async () => {
    try {
      const data: any = await sendToPython(`/api/events?since=${lastEventId}`);
      if (!isConnected) {
        isConnected = true;
        console.log("[bridge] Successfully connected to SUNDAY Python Backend Engine!");
        hub.panel.pushMessage({
          role: "system",
          text: "Connected to SUNDAY Local Offline AI Engine (Windows 11).",
        });
      }

      if (data && Array.isArray(data.events)) {
        for (const evt of data.events as ServerEvent[]) {
          if (evt.id > lastEventId) lastEventId = evt.id;

          if (evt.type === "state_change" && evt.state) {
            console.log(`[bridge] Syncing character state: ${evt.state}`);
            hub.controller.setState(evt.state);
            if (evt.speech) {
              hub.controller.setSpeech(evt.speech);
            }
            if (evt.state === "listening" || evt.state === "thinking" || evt.state === "working" || evt.state === "talking") {
              desktop?.show();
            }
          } else if (evt.type === "character_visibility") {
            if (evt.visible) {
              console.log("[bridge] Showing Sunday character on wake word trigger.");
              desktop?.show();
              hub.controller.setState("listening");
              hub.controller.setSpeech("I'm listening!");
            } else {
              console.log("[bridge] Hiding Sunday character on dismissive / standby.");
              desktop?.hide();
            }
          } else if (evt.type === "chat_message" && evt.text) {
            hub.panel.pushMessage({
              role: evt.role || "sunday",
              text: evt.text,
            });
          } else if (evt.type === "voice_mute_change") {
            const isMuted = Boolean(evt.muted);
            console.log(`[bridge] Voice mute state updated from backend: ${isMuted}`);
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed()) {
                win.webContents.send(IPC.voiceMuteChanged, isMuted);
              }
            }
          }
        }
      }
    } catch {
      // Backend not yet ready; retry silently
      isConnected = false;
    }

    setTimeout(pollBackendEvents, 350);
  };

  // Start polling
  pollBackendEvents();
}
