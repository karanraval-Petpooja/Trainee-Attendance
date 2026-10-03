'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { NOTIF } from '@/lib/status';
import { timeAgo } from '@/lib/dates';
import { useApp } from './AppShell';

export default function NotificationBell() {
  const { notifications, unread, markRead, markAllRead } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-xl p-2.5 text-slate-600 hover:bg-slate-100" aria-label={`Notifications, ${unread} unread`}>
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="animate-pop absolute right-0 top-12 z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="font-display font-bold text-ink-900">Notifications</div>
            {unread > 0 && <button onClick={markAllRead} className="text-xs font-semibold text-ink-600 hover:underline">Mark all as read</button>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-500">You’re all caught up.</div>}
            {notifications.slice(0, 8).map((n) => (
              <button key={n.id} onClick={() => markRead(n.id)}
                className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${n.read_status ? '' : 'bg-ink-50/60'}`}>
                <span className="text-lg leading-6" aria-hidden="true">{NOTIF[n.notification_type]?.icon || '📢'}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{n.title}</span>
                    {!n.read_status && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{n.message}</span>
                  <span className="mt-1 block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block bg-slate-50 px-4 py-2.5 text-center text-sm font-semibold text-ink-700 hover:bg-slate-100">View all notifications</Link>
        </div>
      )}
    </div>
  );
}
