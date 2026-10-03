'use client';
import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, PageHeader } from '@/components/ui';
import { NOTIF } from '@/lib/status';
import { fmtDateTime, timeAgo } from '@/lib/dates';

export default function NotificationsPage() {
  const { notifications, unread, markRead, markAllRead, settings, tz } = useApp();
  const [filter, setFilter] = useState('all');
  const [perm, setPerm] = useState(() => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'));
  const shown = notifications.filter((n) => (filter === 'unread' ? !n.read_status : filter === 'all' ? true : n.notification_type === filter));

  const enableBrowser = async () => {
    if (!('Notification' in window)) return;
    setPerm(await Notification.requestPermission());
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" subtitle={unread ? `${unread} unread` : 'You’re all caught up.'}
        actions={unread > 0 && <button className="btn-secondary" onClick={markAllRead}>Mark all as read</button>} />

      {settings.browser_notifications_enabled && perm === 'default' && (
        <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-sm text-slate-600"><BellRing size={18} className="text-ink-600" />Get a browser alert the moment a reminder or escalation arrives.</div>
          <button className="btn-primary btn-sm" onClick={enableBrowser}>Turn on browser notifications</button>
        </div>
      )}
      {perm === 'denied' && <div className="text-xs text-slate-500">Browser notifications are blocked. Allow them in your browser’s site settings to receive alerts.</div>}

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {['all', 'unread', 'reminder', 'missed', 'attention', 'escalation', 'system'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === f ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
            {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : `${NOTIF[f].icon} ${NOTIF[f].label}`}
          </button>
        ))}
      </div>

      <div className="panel overflow-hidden">
        {shown.length === 0 && <Empty title="Nothing here">Reminders, missed-marking alerts and escalations appear here.</Empty>}
        <ul>
          {shown.map((n) => (
            <li key={n.id} className={`flex gap-4 border-b border-slate-100 px-5 py-4 last:border-0 ${n.read_status ? '' : 'bg-ink-50/50'} ${n.notification_type === 'escalation' ? 'border-l-4 border-l-red-500' : ''}`}>
              <span className="text-xl" aria-hidden="true">{NOTIF[n.notification_type]?.icon || '📢'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{n.title}</span>
                  {!n.read_status && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">New</span>}
                </div>
                <p className="mt-0.5 text-sm text-slate-600">{n.message}</p>
                <div className="mt-1 text-xs text-slate-400" title={fmtDateTime(n.created_at, tz)}>{timeAgo(n.created_at)}</div>
              </div>
              {!n.read_status && <button onClick={() => markRead(n.id)} className="self-start text-xs font-semibold text-ink-700 hover:underline">Mark read</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
