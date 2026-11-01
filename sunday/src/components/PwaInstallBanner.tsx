import { useEffect, useState } from "react";

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // Check if already in standalone PWA mode
    if (typeof window !== "undefined") {
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;
      setIsInstalled(isStandalone);

      const ua = window.navigator.userAgent.toLowerCase();
      const isApple = /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream;
      setIsIos(isApple);
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else if (isIos) {
      setShowIosGuide(true);
    }
  };

  return {
    canInstall: Boolean(deferredPrompt) || (isIos && !isInstalled),
    isInstalled,
    isIos,
    showIosGuide,
    setShowIosGuide,
    promptInstall,
  };
}

export function PwaInstallHeaderButton() {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();

  if (isInstalled || !canInstall) return null;

  return (
    <button
      type="button"
      className="pwa-install-btn"
      onClick={promptInstall}
      title="Install SUNDAY as an app on your phone or computer"
      aria-label="Install SUNDAY App"
    >
      <span className="pwa-icon">📲</span>
      <span className="pwa-text">Install App</span>
    </button>
  );
}

export function PwaInstallBanner() {
  const { canInstall, isInstalled, showIosGuide, setShowIosGuide, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);

  if (isInstalled || dismissed) return null;

  return (
    <>
      {canInstall && (
        <div className="pwa-banner" role="banner">
          <div className="pwa-banner-content">
            <span className="pwa-banner-badge">SUNDAY PWA</span>
            <p>
              Install <b>SUNDAY</b> on your home screen or desktop for continuous voice listening and instant companion access.
            </p>
          </div>
          <div className="pwa-banner-actions">
            <button type="button" className="pwa-banner-install-btn" onClick={promptInstall}>
              ⬇️ Install App
            </button>
            <button
              type="button"
              className="pwa-banner-close-btn"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss banner"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {showIosGuide && (
        <div className="pwa-ios-modal" onClick={() => setShowIosGuide(false)}>
          <div className="pwa-ios-card" onClick={(e) => e.stopPropagation()}>
            <div className="pwa-ios-header">
              <h3>Install SUNDAY on iPhone / iPad</h3>
              <button type="button" onClick={() => setShowIosGuide(false)}>✕</button>
            </div>
            <ol className="pwa-ios-steps">
              <li>Tap the <b>Share</b> button ⎋ at the bottom of Safari.</li>
              <li>Scroll down and tap <b>Add to Home Screen</b> ➕.</li>
              <li>Tap <b>Add</b> in the top right corner.</li>
            </ol>
            <p className="pwa-ios-sub">SUNDAY will now launch like a native app on your phone with instant wake & voice!</p>
            <button type="button" className="pwa-ios-done-btn" onClick={() => setShowIosGuide(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
