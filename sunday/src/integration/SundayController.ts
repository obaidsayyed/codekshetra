/**
 * The public, typed control surface for Sunday. The future AI backend
 * integration layer drives the pet exclusively through this interface (or
 * through `applyAgentEvent`, which maps agent events onto it).
 *
 * Nothing here talks to a network, a model or Ollama. It only changes what
 * Sunday shows.
 */
export type { SundayState } from "../shared/states";
export { CONTROLLABLE_STATES, isControllableState } from "../shared/states";
import type { SundayState } from "../shared/states";

export interface SundayController {
  setState(state: SundayState): void;
  setSpeech(text: string): void;
  clearSpeech(): void;
  setRoaming(enabled: boolean): void;
  setMovementSpeed(speed: number): void;
  setCharacterScale(scale: number): void;
}

/** Optional extras the pet implementation also offers. */
export interface ExtendedSundayController extends SundayController {
  /** Shows a bubble that stays until cleared. */
  setPinnedSpeech(text: string): void;
  /** Turns Sunday toward the user with a little wave. */
  greet(): void;
  /** Wakes Sunday if asleep. */
  wake(): void;
  getState(): string;
}
