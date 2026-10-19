'use client';
import { useEffect, useState } from 'react';
import { BellOff, BellRing, Send } from 'lucide-react';
import { authFetch } from '@/lib/supabase';
import { useApp } from './AppShell';
import { Spinner } from './ui';

const key = () => {
  const b64 = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

// "Turn on phone notifications": alerts from the 🔔 also arrive as phone notifications, even when the app is closed
export default function PhoneNotifications({ compact = false }) {
  const { showToast } = useApp();
  const [state, setState] = useState('checking'); // checking | unsupported | ios-home | denied | off | on
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState(ios && !standalone ? 'ios-home' : 'unsupported'); return;
    }
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) { setState('unsupported'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    setState(sub ? 'on' : 'off');
  };
  useEffect(() => { check().catch(() => setState('unsupported')); }, []);

  const turnOn = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() }));
      await authFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), test: true }) });
      setState('on');
      showToast('Phone notifications are on. A test notification is on its way.');
    } catch (e) { showToast(e.message || 'Could not turn on notifications', 'error'); }
    finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await authFetch('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => null);
        await sub.unsubscribe();
      }
      setState('off');
      showToast('Phone notifications are off on this device.');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await authFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), test: true }) });
      showToast('Test sent. It should appear on this device in a few seconds.');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  if (state === 'checking') return null;
  const text = {
    'on': 'On for this device: attendance alerts, handover reminders and other notifications pop up even when the app is closed.',
    'off': 'Get attendance alerts and handover reminders as phone notifications, even when the app is closed.',
    'denied': 'Notifications are blocked for this app. Allow them in the phone settings (Settings → Notifications → Trainer Attendance / Chrome), then reopen the app.',
    'ios-home': 'On iPhone: first add the app to the Home Screen (Safari → Share → Add to Home Screen), open it from there, then turn notifications on here. Needs iOS 16.4 or newer.',
    'unsupported': 'This browser cannot show phone notifications. Use Chrome on Android, or the Home-Screen app on iPhone (iOS 16.4+).',
  }[state];

  return (
    <section className={`panel ${compact ? 'p-4' : 'p-5'} mb-4`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${state === 'on' ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-100 text-ink-700'}`}>
          {state === 'on' ? <BellRing size={20} /> : <BellOff size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink-900">Phone notifications {state === 'on' ? '· On' : ''}</div>
          <p className="mt-0.5 text-xs text-slate-500">{text}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {state === 'off' && <button className="btn-primary btn-sm" onClick={turnOn} disabled={busy}>{busy ? <Spinner size={14} /> : <BellRing size={14} />}Turn on</button>}
          {state === 'on' && <>
            <button className="btn-secondary btn-sm" onClick={test} disabled={busy}><Send size={14} />Send a test</button>
            <button className="btn-ghost btn-sm" onClick={turnOff} disabled={busy}>Turn off</button>
          </>}
        </div>
      </div>
    </section>
  );
}
