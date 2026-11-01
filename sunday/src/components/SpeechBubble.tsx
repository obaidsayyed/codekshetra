import { forwardRef, type CSSProperties } from "react";

export interface SpeechBubbleProps {
  text: string;
  pinned?: boolean;
  /** Absolute layout (desktop pet): the parent positions it with transforms. */
  floating?: boolean;
  /** Pointer side: "bottom" (default) points down at Sunday. */
  pointer?: "bottom" | "left";
  onTogglePin?: () => void;
  onClose?: () => void;
  style?: CSSProperties;
  className?: string;
}

/**
 * Dark glass speech bubble with a thin cyan outline and a pointer toward
 * Sunday. The pointer position is driven by the `--pointer-x` CSS variable so
 * the pet can move it every frame without re-rendering React.
 */
export const SpeechBubble = forwardRef<HTMLDivElement, SpeechBubbleProps>(function SpeechBubble(
  { text, pinned, floating, pointer = "bottom", onTogglePin, onClose, style, className },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`speech-bubble ${floating ? "is-floating" : ""} pointer-${pointer} ${pinned ? "is-pinned" : ""} ${className ?? ""}`}
      style={style}
      role="status"
      aria-live="polite"
      data-interactive={onTogglePin || onClose ? "" : undefined}
    >
      <p className="speech-text">{text}</p>
      {(onTogglePin || onClose) && (
        <div className="speech-actions">
          {onTogglePin && (
            <button type="button" className="speech-btn" onClick={onTogglePin} title={pinned ? "Unpin" : "Keep this message"} aria-label={pinned ? "Unpin" : "Pin"}>
              <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden>
                <path d="M10 1.5 14.5 6l-2 .5-2.8 2.8.3 3.2-1.2 1.2L6 10.9 2.5 14.4l-.9-.9L5.1 10 2.3 7.2l1.2-1.2 3.2.3L9.5 3.5z" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          )}
          {onClose && (
            <button type="button" className="speech-btn" onClick={onClose} title="Dismiss" aria-label="Dismiss">
              <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden>
                <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
