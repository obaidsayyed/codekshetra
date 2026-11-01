/** Every animation state Sunday's engine can play. */
export const ANIMATION_STATES = [
  "idle",
  "walking",
  "running",
  "jumping",
  "sitting",
  "thinking",
  "working",
  "listening",
  "talking",
  "sleeping",
  "celebrating",
  "error",
  "dragging",
  "waking",
  "completed",
] as const;

export type SundayAnimationState = (typeof ANIMATION_STATES)[number];

/** States an external integration (the AI backend) may request. */
export const CONTROLLABLE_STATES = [
  "idle",
  "walking",
  "running",
  "jumping",
  "sitting",
  "thinking",
  "working",
  "listening",
  "talking",
  "sleeping",
  "celebrating",
  "error",
  "completed",
] as const;

export type SundayState = (typeof CONTROLLABLE_STATES)[number];

export function isAnimationState(value: unknown): value is SundayAnimationState {
  return typeof value === "string" && (ANIMATION_STATES as readonly string[]).includes(value);
}

export function isControllableState(value: unknown): value is SundayState {
  return typeof value === "string" && (CONTROLLABLE_STATES as readonly string[]).includes(value);
}

export const STATE_LABELS: Record<SundayAnimationState, string> = {
  idle: "Idle",
  walking: "Walking",
  running: "Running",
  jumping: "Jumping",
  sitting: "Sitting",
  thinking: "Thinking",
  working: "Working",
  listening: "Listening",
  talking: "Talking",
  sleeping: "Sleeping",
  celebrating: "Celebrating",
  error: "Error / Confused",
  dragging: "Dragged",
  waking: "Waking Up",
  completed: "Task Completed",
};
