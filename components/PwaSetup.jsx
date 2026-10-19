'use client';
import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

// Installable app: registers the service worker; "Install app" on Android / desktop Chrome,
// and a one-time tip on iPhone (Safari has no install button: Share → Add to Home Screen).
export function useInstall() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream);
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  const install = async () => { if (!prompt) return; prompt.prompt(); await prompt.userChoice.catch(() => null); setPrompt(null); };
  return { canInstall: Boolean(prompt) && !installed, install, installed, ios };
}

// Top-bar button (Android / desktop) — shown only when the phone offers installation
export function InstallButton() {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return (
    <button type="button" data-tour="install-app" onClick={install} title="Install Trainer Attendance as an app"
      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
      <Download size={16} /><span className="hidden sm:inline">Install app</span>
    </button>
  );
}

// iPhone tip, shown once until closed (only in Safari, not when already installed)
export function IosInstallTip() {
  const { ios, installed } = useInstall();
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem('iosInstallTip') === 'hidden'); } catch { setHidden(false); } }, []);
  if (!ios || installed || hidden) return null;
  const close = () => { setHidden(true); try { localStorage.setItem('iosInstallTip', 'hidden'); } catch { /* ignore */ } };
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 rounded-2xl bg-ink-900 p-4 text-white shadow-2xl">
      <button type="button" onClick={close} className="absolute right-3 top-3 rounded-full p-1 text-white/70 hover:bg-white/10" aria-label="Close"><X size={16} /></button>
      <div className="pr-6 text-sm font-bold">Install Trainer Attendance on your iPhone</div>
      <p className="mt-1 text-xs text-white/80">Tap <Share size={13} className="mx-0.5 inline -translate-y-0.5" /> <b>Share</b> at the bottom of Safari, then <b>Add to Home Screen</b>. It opens like an app, full screen.</p>
    </div>
  );
}
