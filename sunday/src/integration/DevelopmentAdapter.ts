import type { PetCommand } from "../shared/ipc";
import type { SundayState } from "../shared/states";
import { getBridge } from "../services/bridge";
import type { SundayController } from "./SundayController";

/**
 * A SundayController that forwards every call to the live desktop pet over
 * IPC. Used by the Animation Studio's controller playground so developers can
 * drive the real overlay by hand. Outside Electron it reports itself as
 * unavailable instead of pretending to work.
 */
export function createRemotePetController(): (SundayController & { available: boolean }) {
  const bridge = getBridge();
  const send = (cmd: PetCommand) => bridge?.sendPetCommand(cmd);
  return {
    available: !!bridge,
    setState: (state: SundayState) => send({ type: "setState", state }),
    setSpeech: (text: string) => send({ type: "setSpeech", text }),
    clearSpeech: () => send({ type: "clearSpeech" }),
    setRoaming: (enabled: boolean) => send({ type: "setRoaming", enabled }),
    setMovementSpeed: (speed: number) => send({ type: "setMovementSpeed", speed }),
    setCharacterScale: (scale: number) => send({ type: "setCharacterScale", scale }),
  };
}

/** Dispatches a validated pet command onto any controller (used by the pet window). */
export function dispatchPetCommand(
  controller: SundayController & { greet?: () => void; wake?: () => void; setPinnedSpeech?: (t: string) => void },
  cmd: PetCommand,
  onAgentEvent: (cmd: Extract<PetCommand, { type: "agentEvent" }>) => void,
): void {
  switch (cmd.type) {
    case "setState":
      controller.setState(cmd.state);
      break;
    case "setSpeech":
      if (cmd.pinned && controller.setPinnedSpeech) controller.setPinnedSpeech(cmd.text);
      else controller.setSpeech(cmd.text);
      break;
    case "clearSpeech":
      controller.clearSpeech();
      break;
    case "setRoaming":
      controller.setRoaming(cmd.enabled);
      break;
    case "setMovementSpeed":
      controller.setMovementSpeed(cmd.speed);
      break;
    case "setCharacterScale":
      controller.setCharacterScale(cmd.scale);
      break;
    case "agentEvent":
      onAgentEvent(cmd);
      break;
    case "greet":
      controller.greet?.();
      break;
    case "wake":
      controller.wake?.();
      break;
  }
}
