import { isControllableState, type SundayState } from "../shared/states";
import type { SundayController } from "./SundayController";

export type { AgentEventType, SundayAgentEvent } from "../shared/ipc";
export { validateAgentEvent } from "../shared/ipc";
import type { SundayAgentEvent } from "../shared/ipc";

/**
 * Event adapter: translates events emitted by the (separate, existing) agent
 * backend into controller calls. Returns false for events it cannot map, so
 * the integration layer can log them.
 *
 *   status_changed  { status: "thinking" | "working" | … | alias }  → setState
 *   speech          { text: string, animate?: boolean }             → setSpeech (+ talking)
 *   task_completed  { message?: string }                            → completed + bubble
 *   task_failed     { message?: string }                            → error + bubble
 *   user_attention  { message?: string }                            → jump + bubble
 */

/** Common backend status words mapped onto Sunday's states. */
export const STATUS_ALIASES: Record<string, SundayState> = {
  busy: "working",
  processing: "thinking",
  planning: "thinking",
  generating: "working",
  recording: "listening",
  speaking: "talking",
  responding: "talking",
  done: "completed",
  success: "completed",
  failed: "error",
  failure: "error",
  ready: "idle",
  waiting: "idle",
  asleep: "sleeping",
};

export function resolveStatus(status: unknown): SundayState | null {
  if (typeof status !== "string") return null;
  const key = status.trim().toLowerCase();
  if (isControllableState(key)) return key;
  return STATUS_ALIASES[key] ?? null;
}

const text = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);

export function applyAgentEvent(controller: SundayController, event: SundayAgentEvent): boolean {
  const p = event.payload ?? {};
  switch (event.type) {
    case "status_changed": {
      const state = resolveStatus(p.status ?? p.state);
      if (!state) return false;
      controller.setState(state);
      if (typeof p.message === "string" && p.message.trim()) controller.setSpeech(p.message.trim());
      return true;
    }
    case "speech": {
      if (typeof p.text !== "string" || !p.text.trim()) return false;
      if (p.animate !== false) controller.setState("talking");
      controller.setSpeech(p.text.trim());
      return true;
    }
    case "task_completed":
      controller.setState("completed");
      controller.setSpeech(text(p.message, "Task completed! ✅"));
      return true;
    case "task_failed":
      controller.setState("error");
      controller.setSpeech(text(p.message, "Hmm, something went wrong."));
      return true;
    case "user_attention":
      controller.setState("jumping");
      controller.setSpeech(text(p.message, "Hey! Over here 👋"));
      return true;
    default:
      return false;
  }
}
