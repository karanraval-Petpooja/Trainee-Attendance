'use client';
import { useMemo, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { Empty, PageHeader, PageLoader, StatCard } from '@/components/ui';
import { useAlerts, useAttendance, useTrainees, useTrainers } from '@/lib/hooks';
import { addDays, addMonths, endOfMonth, endOfYear, fmtMedium, minKey, startOfMonth, startOfYear } from '@/lib/dates';
import { scopeTo, streaks, summarize } from '@/lib/status';

function periodRange(p, today, custom) {
  switch (p) {
    case 'last_month': { const s = addMonths(today, -1); return [s, endOfMonth(s)]; }
    case 'last_30': return [addDays(today, -29), today];
    case 'year': return [startOfYear(today), endOfYear(today)];
    case 'custom': return [custom.start, custom.end];
    default: return [startOfMonth(today), endOfMonth(today)];
  }
}
const pct = (p) => (p === null || p === undefined ? '—' : `${p}%`);

export default function AnalyticsPage() {
  const { profile, settings, now } = useApp();
  const isManager = profile.role === 'manager';
  const { trainees, loading } = useTrainees(isManager ? { includeInactive: true, includeDeleted: true } : { includeInactive: true, includeDeleted: true, trainerId: profile.id });
  const { trainers } = useTrainers();
  const [trainerId, setTrainerId] = useState('all');
  const [period, setPeriod] = useState('month');
  const [custom, setCustom] = useState({ start: startOfMonth(now.date), end: now.date });
  const [start, end] = periodRange(period, now.date, custom);
  const pool = useMemo(() => scopeTo(trainees, trainerId), [trainees, trainerId]);
  const ids = useMemo(() => pool.map((t) => t.id), [pool]);
  const { byTrainee, loading: aLoading } = useAttendance(ids, minKey(start, addDays(now.date, -180)), now.date);
  const trainerIds = useMemo(() => (isManager ? trainers.map((t) => t.id) : [profile.id]), [isManager, trainers, profile.id]);
  const { alerts } = useAlerts(trainerIds);

  const rows = useMemo(() => pool.map((t) => {
    const args = { settings, records: byTrainee[t.id] || {}, now, trainee: t };
    return { t, s: summarize({ ...args, start, end }), st: streaks(args) };
  }), [pool, settings, byTrainee, now, start, end]);

  const team = rows.reduce((acc, { s }) => {
    ['present', 'absent', 'half_day', 'holiday', 'not_filled'].forEach((k) => { acc[k] = (acc[k] || 0) + s[k]; });
    return acc;
  }, {});
  const denom = (team.present || 0) + (team.absent || 0) + (team.half_day || 0) + (team.not_filled || 0);
  const teamPct = denom ? Math.round((((team.present || 0) + (team.half_day || 0) / 2) * 1000) / denom) / 10 : null;

  const compliance = (isManager ? trainers : [profile]).map((tr) => {
    const inRange = alerts.filter((a) => a.trainer_id === tr.id && a.attendance_date >= start && a.attendance_date <= end);
    return { tr, missed: inRange.length, open: inRange.filter((a) => !a.resolved).length, total: alerts.filter((a) => a.trainer_id === tr.id).length };
  });

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance analytics" subtitle={`${fmtMedium(start)} to ${fmtMedium(end)}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            {isManager && (
              <select className="input w-auto" value={trainerId} onChange={(e) => setTrainerId(e.target.value)} aria-label="Trainer">
                <option value="all">All trainers</option>
                {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
              <option value="month">This month</option><option value="last_month">Last month</option>
              <option value="last_30">Last 30 days</option><option value="year">This year</option><option value="custom">Custom range</option>
            </select>
          </div>
        )} />

      {period === 'custom' && (
        <div className="panel flex flex-wrap gap-3 p-4">
          <div><label className="label" htmlFor="a-s">From</label><input id="a-s" type="date" className="input" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} /></div>
          <div><label className="label" htmlFor="a-e">To</label><input id="a-e" type="date" className="input" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} /></div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Batch attendance" value={pct(teamPct)} />
        <StatCard label="Present days" value={team.present || 0} tone="green" />
        <StatCard label="Absent days" value={team.absent || 0} tone="red" />
        <StatCard label="Half days" value={team.half_day || 0} tone="amber" />
        <StatCard label="Holiday days" value={team.holiday || 0} tone="amber" />
        <StatCard label="Not marked" value={team.not_filled || 0} tone="orange" />
      </div>

      <section className="panel overflow-hidden">
        <h2 className="border-b border-slate-100 px-5 py-4 text-base font-bold">Trainee attendance</h2>
        {aLoading ? <PageLoader /> : rows.length === 0 ? <Empty title="No trainees yet" /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Trainee</th><th>Attendance</th><th>Present</th><th>Absent</th><th>Half Day</th><th>Holiday</th><th>Week Off</th><th>Not marked</th><th>Present streak</th><th>Absent streak</th></tr></thead>
              <tbody>
                {rows.map(({ t, s, st }) => (
                  <tr key={t.id}>
                    <td className="font-semibold text-slate-800">{t.name}<span className="ml-1 text-xs font-normal text-slate-400">{t.employee_code}</span>{t.deleted_at && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Deleted</span>}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${s.percentage >= 90 ? 'bg-emerald-500' : s.percentage >= 75 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${s.percentage || 0}%` }} /></div>
                        <span className="font-bold text-slate-800">{pct(s.percentage)}</span>
                      </div>
                    </td>
                    <td>{s.present}</td><td>{s.absent}</td><td>{s.half_day}</td><td>{s.holiday}</td><td>{s.week_off}</td>
                    <td className={s.not_filled ? 'font-bold text-red-600' : ''}>{s.not_filled}</td>
                    <td>{st.presentStreak}</td>
                    <td className={st.absentStreak ? 'font-bold text-red-600' : ''}>{st.absentStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel overflow-hidden">
        <h2 className="border-b border-slate-100 px-5 py-4 text-base font-bold">{isManager ? 'Trainer marking compliance' : 'Your marking record'}</h2>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Trainer</th><th>Missed days (this period)</th><th>Still unmarked</th><th>Missed days (total)</th></tr></thead>
            <tbody>
              {compliance.map(({ tr, missed, open, total }) => (
                <tr key={tr.id}>
                  <td className="font-semibold text-slate-800">{tr.name}</td>
                  <td className={missed ? 'font-bold text-red-600' : ''}>{missed}</td>
                  <td>{open}</td>
                  <td className={total >= settings.escalation_threshold ? 'font-bold text-red-600' : ''}>{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-slate-400">Attendance % = (present + ½ half days) ÷ (present + absent + half days + not marked). Holidays and week offs are excluded.</p>
    </div>
  );
}
