import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  checked?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  x: number;
  y: number;
  items: (MenuItem | "separator")[];
  onClose: () => void;
}

/** Compact dark context menu shown on right-click, kept inside the window. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(6, Math.min(x, window.innerWidth - w - 6)),
      top: Math.max(6, Math.min(y, window.innerHeight - h - 6)),
    });
  }, [x, y]);

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.left, top: pos.top }} role="menu" data-interactive="" onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} className="menu-sep" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            className={`menu-item ${item.danger ? "is-danger" : ""}`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {item.checked !== undefined && <span className={`menu-check ${item.checked ? "is-on" : ""}`} aria-hidden />}
          </button>
        ),
      )}
    </div>
  );
}
