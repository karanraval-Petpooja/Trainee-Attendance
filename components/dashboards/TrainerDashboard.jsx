'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { addDays, fmtClock, fmtLong, startOfMonth, timeAgo } from '@/lib/dates';
import { groupStatus, NOTIF, summarize, traineeActiveOn } from '@/lib/status';
import { useAlerts, useAttendance, useTrainees } from '@/lib/hooks';
import { useApp } from '../AppShell';
import { RegisterList, RegisterModal } from '../Register';
import { PageLoader, StatCard } from '../ui';

export default function TrainerDashboard() {
  const { profile, settings, now, notifications } = useApp();
  const today = now.date;
  const { trainees, loading } = useTrainees({ trainerId: profile.id });
  const ids = useMemo(() => trainees.map((t) => t.id), [trainees]);
  const monthStart = startOfMonth(today);
  const from = monthStart < addDays(today, -13) ? monthStart : addDays(today, -13);
  const { byTrainee, reload: reloadAtt } = useAttendance(ids, from, today);
  const { alerts, reload: reloadAlerts } = useAlerts([profile.id]);
  const [openDate, setOpenDate] = useState(null);

  const todayInfo = groupStatus({ dateKey: today, settings, trainees, recordsByTrainee: byTrainee, now });
  const inTraining = trainees.filter((t) => traineeActiveOn(t, today)).length;
  const open = alerts.filter((a) => !a.resolved);

  const month = useMemo(() => {
    const tot = { present: 0, absent: 0, half_day: 0, not_filled: 0 };
    trainees.forEach((t) => {
      const s = summarize({ start: monthStart, end: today, settings, records: byTrainee[t.id] || {}, now, trainee: t });
      Object.keys(tot).forEach((k) => { tot[k] += s[k]; });
    });
    const denom = tot.present + tot.absent + tot.half_day + tot.not_filled;
    return { ...tot, pct: denom ? Math.round(((tot.present + tot.half_day / 2) * 1000) / denom) / 10 : null };
  }, [trainees, byTrainee, monthStart, today, settings, now]);

  const refresh = () => { reloadAtt(); reloadAlerts(); };
  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Hello, {profile.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">Mark your trainees’ attendance before {fmtClock(settings.attendance_deadline)} every working day.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Trainees in training" value={inTraining} hint={`${trainees.length} on your list`} />
        <StatCard label="Marked today" value={todayInfo.status === 'week_off' ? '—' : `${todayInfo.total - (todayInfo.unmarked || 0)}/${todayInfo.total}`} tone={todayInfo.unmarked ? 'orange' : 'green'} hint={todayInfo.status === 'week_off' ? 'Week off' : undefined} />
        <StatCard label="Present today" value={todayInfo.counts?.present ?? 0} tone="green" hint={todayInfo.counts?.absent ? `${todayInfo.counts.absent} absent` : undefined} />
        <StatCard label="Batch attendance" value={month.pct === null ? '—' : `${month.pct}%`} hint="this month" />
        {(() => {
          const perBatch = alerts.reduce((m, a) => { const k = a.batch?.code || 'No batch'; m[k] = (m[k] || 0) + 1; return m; }, {});
          const worst = Math.max(0, ...Object.values(perBatch));
          const detail = Object.entries(perBatch).map(([k, v]) => `${k}: ${v}`).join(' · ');
          return <StatCard label="Missed marking days" value={alerts.length} tone={worst >= settings.escalation_threshold ? 'red' : 'slate'}
            hint={`${detail ? `${detail} · ` : ''}manager alerted at ${settings.escalation_threshold} per batch`} />;
        })()}
      </div>

      {open.length > 0 && (
        <section className="panel border-red-200">
          <h2 className="border-b border-red-100 bg-red-50/60 px-5 py-3 text-base font-bold text-red-800">Days you haven’t finished marking</h2>
          <ul>
            {open.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-b border-slate-50 px-5 py-3 last:border-0">
                <span aria-hidden="true">⚠️</span>
                <div className="flex-1 text-sm"><span className="font-semibold text-slate-800">{fmtLong(a.attendance_date)}</span><span className="text-slate-500"> · {a.batch?.code ? `${a.batch.code} · ` : ''}{a.unmarked_count} trainee(s) not marked</span></div>
                <button className="btn-danger btn-sm" onClick={() => setOpenDate(a.attendance_date)}>Mark now</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel p-5">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-lg font-bold">Today’s attendance</h2>
          <span className="text-sm text-slate-500">{fmtLong(today)}</span>
        </div>
        <RegisterList date={today} trainees={trainees} onSaved={refresh} />
      </section>

      <section className="panel">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold">Recent notifications</h2>
          <Link href="/notifications" className="text-sm font-semibold text-ink-700 hover:underline">View all</Link>
        </div>
        {notifications.length === 0 && <div className="px-5 py-6 text-sm text-slate-500">You’re all caught up.</div>}
        <ul>
          {notifications.slice(0, 5).map((n) => (
            <li key={n.id} className="flex gap-3 border-b border-slate-50 px-5 py-3 last:border-0">
              <span aria-hidden="true">{NOTIF[n.notification_type]?.icon || '📢'}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">{n.title}</div>
                <div className="text-xs text-slate-500">{n.message}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{timeAgo(n.created_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {openDate && <RegisterModal date={openDate} trainees={trainees} onClose={() => setOpenDate(null)} onSaved={refresh} />}
    </div>
  );
}
