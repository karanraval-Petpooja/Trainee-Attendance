'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, GraduationCap, Siren, Sun, UserX, Users } from 'lucide-react';
import { addDays, fmtClock, fmtDateTime, fmtMedium, fmtShort, rangeKeys } from '@/lib/dates';
import { groupStatus, scopeTo, traineeActiveOn, weekOffReason } from '@/lib/status';
import { useAlerts, useAttendance, useTrainees, useTrainers } from '@/lib/hooks';
import { useApp } from '../AppShell';
import { Empty, PageLoader, StatCard } from '../ui';

export default function ManagerDashboard() {
  const { settings, now, tz } = useApp();
  const today = now.date;
  const T = settings.escalation_threshold;
  const { trainers, loading } = useTrainers();
  const { trainees, loading: tLoading } = useTrainees();
  const ids = useMemo(() => trainees.map((t) => t.id), [trainees]);
  const trainerIds = useMemo(() => trainers.map((t) => t.id), [trainers]);
  const { byTrainee } = useAttendance(ids, addDays(today, -13), today);
  const { alerts } = useAlerts(trainerIds);
  const nameOf = (id) => trainers.find((t) => t.id === id)?.name || 'Trainer';

  const missed = useMemo(() => alerts.reduce((m, a) => ({ ...m, [a.trainer_id]: (m[a.trainer_id] || 0) + 1 }), {}), [alerts]);
  const all = groupStatus({ dateKey: today, settings, trainees, recordsByTrainee: byTrainee, now });
  const wo = weekOffReason(today, settings);

  const perTrainer = trainers.map((tr) => {
    const mine = scopeTo(trainees, tr.id);
    const g = groupStatus({ dateKey: today, settings, trainees: mine, recordsByTrainee: byTrainee, now });
    return { tr, g, count: mine.filter((t) => traineeActiveOn(t, today)).length, missed: missed[tr.id] || 0 };
  });
  const repeated = perTrainer.filter((r) => r.missed >= T).sort((a, b) => b.missed - a.missed);
  const watch = perTrainer.filter((r) => T > 1 && r.missed === T - 1);

  const trend = useMemo(() => rangeKeys(addDays(today, -13), today).filter((k) => !weekOffReason(k, settings)).slice(-10)
    .map((k) => ({ k, ...groupStatus({ dateKey: k, settings, trainees, recordsByTrainee: byTrainee, now }) })), [today, settings, trainees, byTrainee, now]);

  if (loading || tLoading) return <PageLoader />;
  const c = all.counts || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Today’s attendance</h1>
          <p className="mt-1 text-sm text-slate-500">{wo ? `Week off (${wo}). No attendance needed today.` : `Trainers mark by ${fmtClock(settings.attendance_deadline)} · escalation after ${T} missed days`}</p>
        </div>
        <Link href="/attendance" className="text-sm font-semibold text-ink-700 hover:underline">Open attendance register</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 xl:grid-cols-8">
        <StatCard label="Trainers" value={trainers.length} icon={Users} />
        <StatCard label="Trainees in training" value={all.total} icon={GraduationCap} />
        <StatCard label="Present" value={c.present || 0} tone="green" icon={CheckCircle2} />
        <StatCard label="Absent" value={c.absent || 0} tone="red" icon={UserX} />
        <StatCard label="Half Day" value={c.half_day || 0} tone="amber" />
        <StatCard label="Holiday" value={c.holiday || 0} tone="amber" icon={Sun} />
        <StatCard label="Not marked" value={(c.not_filled || 0) + (c.pending || 0)} tone={c.not_filled ? 'orange' : 'violet'} icon={c.not_filled ? AlertTriangle : Clock} hint={c.not_filled ? 'deadline passed' : 'before deadline'} />
        <StatCard label="Repeated failures" value={repeated.length} tone="red" icon={Siren} hint={`trainers with ${T}+ misses`} />
      </div>

      <section className="panel overflow-hidden">
        <h2 className="border-b border-slate-100 px-5 py-4 text-base font-bold">Trainer-wise status today</h2>
        {perTrainer.length === 0 ? <Empty title="No trainers yet">Add trainers from the Trainers page.</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Trainer</th><th>Trainees</th><th>Marked</th><th>Present</th><th>Absent</th><th>Half Day</th><th>Holiday</th><th>Status</th><th>Missed days</th><th /></tr></thead>
              <tbody>
                {perTrainer.map(({ tr, g, count, missed: m }) => {
                  const cc = g.counts || {};
                  const marked = (g.total || 0) - (g.unmarked || 0);
                  const state = g.status === 'week_off' ? ['🔵 Week off', 'text-sky-700'] : !g.total ? ['No trainees', 'text-slate-400']
                    : g.unmarked === 0 ? ['✅ Done', 'text-emerald-700'] : cc.not_filled ? ['⚠️ Not marked', 'text-red-700'] : ['⏳ Pending', 'text-ink-700'];
                  return (
                    <tr key={tr.id} className={cc.not_filled ? 'bg-red-50/40' : ''}>
                      <td className="font-semibold text-slate-800">{tr.name}</td>
                      <td>{count}</td>
                      <td>{g.total ? `${marked}/${g.total}` : '—'}</td>
                      <td>{cc.present || 0}</td><td>{cc.absent || 0}</td><td>{cc.half_day || 0}</td><td>{cc.holiday || 0}</td>
                      <td className={`font-semibold ${state[1]}`}>{state[0]}</td>
                      <td className={m >= T ? 'font-bold text-red-600' : ''}>{m}</td>
                      <td><Link href={`/attendance?trainer=${tr.id}`} className="text-sm font-semibold text-ink-700 hover:underline">Open register</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-5">
        <section className="panel xl:col-span-2">
          <h2 className="border-b border-slate-100 px-5 py-4 text-base font-bold">Repeated attendance failures</h2>
          {repeated.length === 0 && watch.length === 0 && <Empty title="No repeated failures">Trainers appear here as they approach the threshold.</Empty>}
          <ul>
            {repeated.map(({ tr, missed: m }) => (
              <li key={tr.id} className="flex items-start gap-3 border-b border-red-100 bg-red-50/60 px-5 py-3">
                <span className="text-lg" aria-hidden="true">🚨</span>
                <div className="text-sm"><span className="font-semibold text-red-800">{tr.name}</span><span className="text-red-700"> has missed marking attendance {m} times.</span></div>
              </li>
            ))}
            {watch.map(({ tr, missed: m }) => (
              <li key={tr.id} className="flex items-start gap-3 border-b border-amber-100 bg-amber-50/60 px-5 py-3">
                <span className="text-lg" aria-hidden="true">⚠️</span>
                <div className="text-sm"><span className="font-semibold text-amber-900">{tr.name}</span><span className="text-amber-800"> has missed {m} times. One more triggers an escalation.</span></div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel xl:col-span-3">
          <h2 className="border-b border-slate-100 px-5 py-4 text-base font-bold">Missed marking alerts</h2>
          {alerts.length === 0 ? <Empty title="No alerts yet" /> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Trainer</th><th>Batch</th><th>Date</th><th>Unmarked</th><th>Status</th><th>Detected</th><th>Count</th></tr></thead>
                <tbody>
                  {alerts.slice(0, 12).map((a) => (
                    <tr key={a.id}>
                      <td className="font-semibold text-slate-800">{nameOf(a.trainer_id)}</td>
                      <td>{a.batch?.code ? <span className="rounded-md bg-ink-50 px-2 py-0.5 text-xs font-bold text-ink-800">{a.batch.code}</span> : <span className="text-xs text-slate-400">No batch</span>}</td>
                      <td>{fmtMedium(a.attendance_date)}</td>
                      <td>{a.unmarked_count}</td>
                      <td>{a.resolved ? <span className="text-xs font-semibold text-orange-600">Filled late</span> : <span className="text-xs font-semibold text-red-600">Not marked</span>}</td>
                      <td className="text-slate-500">{fmtDateTime(a.created_at, tz)}</td>
                      <td className={`font-bold ${a.miss_number >= T ? 'text-red-600' : 'text-slate-600'}`}>#{a.miss_number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <h2 className="border-b border-slate-100 px-5 py-4 text-base font-bold">Last 10 working days</h2>
        <div className="space-y-2.5 px-5 py-4">
          {trend.map((d) => {
            const cc = d.counts || {};
            return (
              <div key={d.k} className="flex items-center gap-3 text-xs">
                <span className={`w-14 shrink-0 font-semibold ${d.k === today ? 'text-ink-900' : 'text-slate-500'}`}>{fmtShort(d.k)}</span>
                <div className="flex h-3.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  {d.total > 0 && [['present', 'bg-emerald-500'], ['half_day', 'bg-orange-400'], ['holiday', 'bg-amber-300'], ['absent', 'bg-rose-500'], ['not_filled', 'bg-red-700'], ['pending', 'bg-ink-200']].map(([s, cls]) => cc[s] > 0 && (
                    <div key={s} className={cls} style={{ width: `${(cc[s] / d.total) * 100}%` }} title={`${cc[s]} ${s.replace('_', ' ')}`} />
                  ))}
                </div>
                <span className="w-12 text-right font-semibold text-slate-600">{cc.present || 0}/{d.total}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
