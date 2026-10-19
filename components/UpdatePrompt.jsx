'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

const MINE = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';

// "A new version is ready · Update now": after every deployment, on phones (Android / iPhone app) and computers
export default function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const r = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
        const { version } = await r.json();
        if (version && version !== 'dev' && MINE !== 'dev' && version !== MINE) setReady(true);
      } catch { /* offline: try again later */ }
      navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
    };
    check();
    const timer = setInterval(check, 5 * 60 * 1000);                 // every 5 minutes while open
    const onShow = () => { if (document.visibilityState === 'visible') check(); }; // app opened / brought back
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => { stop = true; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
  }, []);

  const update = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
      reg?.waiting?.postMessage?.({ type: 'SKIP_WAITING' });
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
    } catch { /* reload anyway */ }
    window.location.reload();
  };

  if (!ready || later) return null;
  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink-900 p-3 pl-4 text-white shadow-2xl sm:bottom-5" role="status">
      <RefreshCw size={18} className="shrink-0 text-emerald-300" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-bold">A new version is ready</div>
        <div className="text-xs text-white/70">Update to get the latest changes. Nothing you saved is lost.</div>
      </div>
      <button type="button" onClick={update} disabled={busy} className="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-bold text-ink-900 hover:bg-emerald-400">
        {busy ? 'Updating…' : 'Update now'}
      </button>
      <button type="button" onClick={() => setLater(true)} className="shrink-0 rounded-full p-1 text-white/60 hover:bg-white/10" aria-label="Later"><X size={16} /></button>
    </div>
  );
}
