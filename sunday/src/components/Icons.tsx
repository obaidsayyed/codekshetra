/** Small inline line icons (no external icon font or network). */
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconChat = () => (
  <svg {...base} aria-hidden>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  </svg>
);
export const IconFilm = () => (
  <svg {...base} aria-hidden>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 3v10M11 3v10M2 8h3M11 8h3" />
  </svg>
);
export const IconGear = () => (
  <svg {...base} aria-hidden>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
  </svg>
);
export const IconHide = () => (
  <svg {...base} aria-hidden>
    <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" />
    <path d="M3 13 13 3" />
  </svg>
);
export const IconExit = () => (
  <svg {...base} aria-hidden>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const IconWalk = () => (
  <svg {...base} aria-hidden>
    <circle cx="9" cy="2.8" r="1.3" />
    <path d="M8.5 5 7 9l2.5 2 .5 3M7 9l-2 4.5M8.5 5l2.5 2.5 2 .5M8.5 5 6 6.5 5 9" />
  </svg>
);
export const IconMoon = () => (
  <svg {...base} aria-hidden>
    <path d="M12.5 10.2A5.2 5.2 0 0 1 5.8 3.5a5.2 5.2 0 1 0 6.7 6.7z" />
  </svg>
);
export const IconPlay = () => (
  <svg {...base} aria-hidden>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
  </svg>
);
export const IconPause = () => (
  <svg {...base} aria-hidden>
    <path d="M5 3.5v9M11 3.5v9" strokeWidth="2.2" />
  </svg>
);
export const IconStop = () => (
  <svg {...base} aria-hidden>
    <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
  </svg>
);
export const IconRestart = () => (
  <svg {...base} aria-hidden>
    <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" />
    <path d="M3.5 2.5v2.8h2.8" />
  </svg>
);
export const IconLoop = () => (
  <svg {...base} aria-hidden>
    <path d="M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2 12.5 4l-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2" />
  </svg>
);
export const IconStepBack = () => (
  <svg {...base} aria-hidden>
    <path d="M11.5 4 6.5 8l5 4zM4.5 4v8" />
  </svg>
);
export const IconStepFwd = () => (
  <svg {...base} aria-hidden>
    <path d="M4.5 4l5 4-5 4zM11.5 4v8" />
  </svg>
);
export const IconSend = () => (
  <svg {...base} aria-hidden>
    <path d="M2.5 8 13.5 3l-4 10.5-2-4.5z" />
  </svg>
);
export const IconMinus = () => (
  <svg {...base} aria-hidden>
    <path d="M4 8h8" />
  </svg>
);
export const IconClose = () => (
  <svg {...base} aria-hidden>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>
);
export const IconPlug = () => (
  <svg {...base} aria-hidden>
    <path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" />
  </svg>
);
export const IconArrow = () => (
  <svg {...base} aria-hidden>
    <path d="M3 8h9M9 5l3 3-3 3" />
  </svg>
);
export const IconSparkle = () => (
  <svg {...base} aria-hidden>
    <path d="M8 2v4M8 10v4M2 8h4M10 8h4" />
  </svg>
);
export const IconSound = () => (
  <svg {...base} aria-hidden>
    <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" />
    <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.8a6 6 0 0 1 0 8.4" />
  </svg>
);
export const IconMute = () => (
  <svg {...base} aria-hidden>
    <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" />
    <path d="M11 6l3.5 4M14.5 6 11 10" />
  </svg>
);
export const IconMic = () => (
  <svg {...base} aria-hidden>
    <rect x="5.5" y="2" width="5" height="7.5" rx="2.5" />
    <path d="M3.5 6.5a4.5 4.5 0 0 0 9 0" />
    <path d="M8 11v3M6 14h4" />
  </svg>
);
export const IconMicOff = () => (
  <svg {...base} aria-hidden>
    <path d="M2 2l12 12" />
    <path d="M7 2.3a2.5 2.5 0 0 1 3.5 2.3v2M10.5 8.5A2.5 2.5 0 0 1 5.5 8V6" />
    <path d="M3.5 6.5a4.5 4.5 0 0 0 7.8 3.2M12.5 6.5a4.5 4.5 0 0 1-.8 2.5" />
    <path d="M8 11v3M6 14h4" />
  </svg>
);
