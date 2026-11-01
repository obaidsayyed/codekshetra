import { useCallback, useEffect, useState } from "react";
import { loadSettings, saveSettings, subscribeSettings } from "../services/bridge";
import { DEFAULT_SETTINGS, type PetSettings } from "../shared/settings";

/** Live settings shared between all windows (persisted by the main process). */
export function useSettings(): [PetSettings, (patch: Partial<PetSettings>) => void, boolean] {
  const [settings, setSettings] = useState<PetSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => {
      if (alive) {
        setSettings(s);
        setLoaded(true);
      }
    });
    const off = subscribeSettings((s) => alive && setSettings(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const update = useCallback((patch: Partial<PetSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    void saveSettings(patch).then(setSettings);
  }, []);

  return [settings, update, loaded];
}
