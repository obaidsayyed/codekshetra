import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../hooks/useSettings";
import { getBridge } from "../services/bridge";
import { PetRuntime, type BubbleModel } from "../services/PetRuntime";
import { PET_BASE_SIZE } from "../scene/SundayScene";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { IconChat, IconExit, IconFilm, IconGear, IconHide, IconMoon, IconWalk } from "./Icons";
import { SpeechBubble } from "./SpeechBubble";

/**
 * Desktop pet mode: a transparent, frameless overlay containing only Sunday,
 * his speech bubble, a small night indicator and the right-click menu.
 */
export function SundayPet() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<PetRuntime | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [settings, updateSettings, loaded] = useSettings();
  const [bubble, setBubble] = useState<BubbleModel | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [night, setNight] = useState(false);
  const bridge = getBridge();

  useEffect(() => {
    document.documentElement.classList.add("view-pet");
    return () => document.documentElement.classList.remove("view-pet");
  }, []);

  // create the runtime once settings are known
  useEffect(() => {
    if (!loaded || !canvasRef.current || runtimeRef.current) return;
    const rt = new PetRuntime(canvasRef.current, bridge, settings, {
      onBubble: setBubble,
      onMenu: setMenu,
      onNight: setNight,
    });
    runtimeRef.current = rt;
    void rt.start();
    (window as unknown as { __sunday?: unknown }).__sunday = { controller: rt.controller, engine: rt.scene.engine };
    return () => {
      rt.dispose();
      runtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    runtimeRef.current?.applySettings(settings);
  }, [settings]);

  const setBubbleEl = useCallback((el: HTMLDivElement | null) => {
    bubbleRef.current = el;
    runtimeRef.current?.setBubbleElement(el);
  }, []);

  const closeMenu = useCallback(() => {
    setMenu(null);
    runtimeRef.current?.setMenuOpen(false);
  }, []);

  const items: (MenuItem | "separator")[] = [
    { id: "chat", label: "Open Chat Panel", icon: <IconChat />, onSelect: () => bridge?.openWindow("panel") },
    { id: "studio", label: "Animation Studio", icon: <IconFilm />, onSelect: () => bridge?.openWindow("studio") },
    { id: "settings", label: "Settings", icon: <IconGear />, onSelect: () => bridge?.openWindow("settings") },
    "separator",
    { id: "roam", label: "Roam around", icon: <IconWalk />, checked: settings.roaming, onSelect: () => updateSettings({ roaming: !settings.roaming }) },
    {
      id: "night",
      label: "Night mode",
      icon: <IconMoon />,
      checked: settings.nightMode === "on" || (settings.nightMode === "auto" && night),
      onSelect: () => updateSettings({ nightMode: settings.nightMode === "on" || (settings.nightMode === "auto" && night) ? "off" : "on" }),
    },
    "separator",
    { id: "hide", label: "Hide SUNDAY", icon: <IconHide />, onSelect: () => bridge?.hidePet() },
    { id: "exit", label: "Exit", icon: <IconExit />, danger: true, onSelect: () => bridge?.quit() },
  ];

  const canvasHeight = Math.round(PET_BASE_SIZE.height * settings.characterScale);

  return (
    <div className={`pet-root ${night ? "is-night" : ""}`}>
      <canvas ref={canvasRef} className="pet-canvas" style={{ height: canvasHeight }} aria-label="Sunday, your desktop companion" />
      {night && (
        <div className="night-indicator" title="Night mode — click Sunday to wake him up">
          <IconMoon />
        </div>
      )}
      {bubble && (
        <SpeechBubble
          key={bubble.id}
          ref={setBubbleEl}
          text={bubble.text}
          pinned={bubble.pinned}
          floating
          onTogglePin={() => runtimeRef.current?.togglePinBubble()}
          onClose={() => runtimeRef.current?.hideBubble()}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} />}
      {!bridge && <div className="pet-browser-note">Browser preview — desktop movement needs the Electron app.</div>}
    </div>
  );
}
