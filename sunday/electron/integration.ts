import { randomUUID } from "node:crypto";
import type { SundayController } from "../src/integration/SundayController";
import { MAX_PANEL_MESSAGE_LENGTH, validateAgentEvent, validatePetCommand, type PanelMessage, type PetCommand, type SundayAgentEvent } from "../src/shared/ipc";
import type { SundayState } from "../src/shared/states";

/**
 * Main-process integration surface for the existing AI agent application.
 *
 * SUNDAY does not contain an agent, does not call Ollama and makes no network
 * requests. A separately written integration layer (running in this main
 * process) can obtain this host via `getIntegrationHost()` and:
 *   - drive the pet with `host.controller.setState(...)` etc.
 *   - forward agent events with `host.dispatchAgentEvent(event)`
 *   - show assistant messages with `host.panel.pushMessage(...)`
 *   - receive what the user types with `host.panel.onUserMessage(...)`
 */

export interface PanelHost {
  pushMessage(msg: { role: "sunday" | "system"; text: string }): PanelMessage;
  onUserMessage(handler: (text: string, message: PanelMessage) => void): () => void;
  history(): PanelMessage[];
}

export interface SundayIntegrationHost {
  controller: SundayController;
  dispatchAgentEvent(event: SundayAgentEvent): boolean;
  panel: PanelHost;
  /** True once something has subscribed to user messages. */
  isConnected(): boolean;
}

type Sender = (cmd: PetCommand) => void;
type Broadcast = (msg: PanelMessage) => void;

const MAX_HISTORY = 200;

export class IntegrationHub implements SundayIntegrationHost {
  private messages: PanelMessage[] = [];
  private userHandlers = new Set<(text: string, m: PanelMessage) => void>();
  readonly controller: SundayController;
  readonly panel: PanelHost;

  constructor(
    private readonly sendToPet: Sender,
    private readonly broadcast: Broadcast,
  ) {
    const send = (cmd: unknown) => {
      const valid = validatePetCommand(cmd);
      if (valid) this.sendToPet(valid);
    };
    this.controller = {
      setState: (state: SundayState) => send({ type: "setState", state }),
      setSpeech: (text: string) => send({ type: "setSpeech", text }),
      clearSpeech: () => send({ type: "clearSpeech" }),
      setRoaming: (enabled: boolean) => send({ type: "setRoaming", enabled }),
      setMovementSpeed: (speed: number) => send({ type: "setMovementSpeed", speed }),
      setCharacterScale: (scale: number) => send({ type: "setCharacterScale", scale }),
    };
    this.panel = {
      pushMessage: (msg) => this.push({ role: msg.role, text: msg.text }),
      onUserMessage: (handler) => {
        this.userHandlers.add(handler);
        return () => this.userHandlers.delete(handler);
      },
      history: () => [...this.messages],
    };
  }

  isConnected(): boolean {
    return this.userHandlers.size > 0;
  }

  dispatchAgentEvent(event: SundayAgentEvent): boolean {
    const valid = validateAgentEvent(event);
    if (!valid) return false;
    this.sendToPet({ type: "agentEvent", event: valid });
    return true;
  }

  private push(m: { role: PanelMessage["role"]; text: string; status?: PanelMessage["status"] }): PanelMessage {
    const msg: PanelMessage = {
      id: randomUUID(),
      role: m.role,
      text: m.text.slice(0, MAX_PANEL_MESSAGE_LENGTH),
      timestamp: Date.now(),
      status: m.status,
    };
    this.messages.push(msg);
    if (this.messages.length > MAX_HISTORY) this.messages.splice(0, this.messages.length - MAX_HISTORY);
    this.broadcast(msg);
    return msg;
  }

  /** Called by IPC when the user sends text from the panel. */
  receiveUserMessage(text: string): { delivered: boolean } {
    const clean = text.trim().slice(0, MAX_PANEL_MESSAGE_LENGTH);
    if (!clean) return { delivered: false };
    const delivered = this.isConnected();
    const msg = this.push({ role: "user", text: clean, status: delivered ? "delivered" : "not-delivered" });
    for (const h of this.userHandlers) {
      try {
        h(clean, msg);
      } catch (err) {
        console.error("[sunday] integration handler failed:", err);
      }
    }
    return { delivered };
  }
}

let host: IntegrationHub | null = null;

export function setIntegrationHost(h: IntegrationHub): void {
  host = h;
}

/** Entry point for the future backend integration layer (main process). */
export function getIntegrationHost(): SundayIntegrationHost | null {
  return host;
}
