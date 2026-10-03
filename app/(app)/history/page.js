'use client';
import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, PageHeader, PageLoader, StatusChip } from '@/components/ui';
import { useAttendance, useTrainees, useTrainers } from '@/lib/hooks';
import { diffDays, endOfMonth, fmtDay, fmtMedium, fmtTime, MONTHS, minKey, pad, rangeKeys, startOfMonth } from '@/lib/dates';
import { computeStatus, scopeTo, STATUS, traineeActiveOn, trainerOn } from '@/lib/status';
import { downloadTableXlsx } from '@/lib/monthlySheet';

const STATUSES = ['present', 'absent', 'half_day', 'holiday', 'week_off', 'not_filled', 'pending'];

export default function HistoryPage() {
  const { profile, settings, now, tz } = useApp();
  const isManager = profile.role === 'manager';
  const { trainees, loading: tLoading } = useTrainees(isManager ? { includeInactive: true, includeDeleted: true } : { includeInactive: true, includeDeleted: true, trainerId: profile.id });
  const { trainers } = useTrainers();
  const trainerNames = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);
  const [trainerId, setTrainerId] = useState('all');
  const [traineeId, setTraineeId] = useState('all');
  const [start, setStart] = useState(startOfMonth(now.date));
  const [end, setEnd] = useState(now.date);
  const [status, setStatus] = useState('all');
  const [month, setMonth] = useState(Number(now.date.slice(5, 7)) - 1);
  const [year, setYear] = useState(Number(now.date.slice(0, 4)));

  const tooLong = start && end && diffDays(start, end) > 366;
  const effectiveEnd = end ? minKey(end, now.date) : now.date;
  const pool = useMemo(() => scopeTo(trainees, trainerId), [trainees, trainerId]);
  const list = useMemo(() => (traineeId === 'all' ? pool : pool.filter((t) => t.id === traineeId)), [pool, traineeId]);
  const ids = useMemo(() => list.map((t) => t.id), [list]);
  const { byTrainee, loading } = useAttendance(tooLong ? [] : ids, start, effectiveEnd);

  const years = [];
  for (let y = Number(now.date.slice(0, 4)) + 1; y >= Number(now.date.slice(0, 4)) - 3; y -= 1) years.push(y);
  const applyMonth = (m, y) => { setMonth(m); setYear(y); const s = `${y}-${pad(m + 1)}-01`; setStart(s); setEnd(endOfMonth(s)); };

  const rows = useMemo(() => {
    if (tooLong || !start || !effectiveEnd || start > effectiveEnd) return [];
    const out = [];
    for (const k of rangeKeys(start, effectiveEnd).reverse()) {
      for (const t of list) {
        const rec = byTrainee[t.id]?.[k];
        if (!rec && !traineeActiveOn(t, k)) continue;
        const info = computeStatus({ dateKey: k, settings, record: rec, now, trainee: t });
        if (info.status === 'other_trainer') continue;
        if (status !== 'all' && info.status !== status) continue;
        out.push({ k, t, info });
      }
    }
    return out;
  }, [tooLong, start, effectiveEnd, list, settings, byTrainee, now, status]);

  const table = () => {
    const head = ['Date', 'Day', 'E Code', 'Trainee', 'Batch', ...(isManager ? ['Trainer'] : []), 'Status', 'Marked at', 'Late'];
    const lines = rows.map(({ k, t, info }) => [
      fmtMedium(k), fmtDay(k), t.employee_code || '', t.name, t._batch?.code || '', ...(isManager ? [trainerNames[trainerOn(t, k)] || ''] : []),
      STATUS[info.status].short, info.record ? fmtTime(info.record.marked_at, tz) : '', info.record?.is_late ? 'Yes' : '',
    ]);
    return { head, lines };
  };
  const exportXlsx = () => { const { head, lines } = table(); downloadTableXlsx({ headers: head, rows: lines, filename: `attendance_${start}_to_${effectiveEnd}.xlsx` }); };
  const exportCsv = () => {
    const { head, lines } = table();
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `attendance_${start}_to_${effectiveEnd}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance history" subtitle="Filter any period and download it."
        actions={(
          <>
            <button className="btn-primary" onClick={exportXlsx} disabled={!rows.length}><FileSpreadsheet size={16} />Download Excel</button>
            <button className="btn-secondary" onClick={exportCsv} disabled={!rows.length}><Download size={16} />CSV</button>
          </>
        )} />

      <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {isManager && (
          <div>
            <label className="label" htmlFor="h-trainer">Trainer</label>
            <select id="h-trainer" className="input" value={trainerId} onChange={(e) => { setTrainerId(e.target.value); setTraineeId('all'); }}>
              <option value="all">All trainers</option>
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="h-trainee">Trainee</label>
          <select id="h-trainee" className="input" value={traineeId} onChange={(e) => setTraineeId(e.target.value)}>
            <option value="all">All trainees</option>
            {pool.map((t) => <option key={t.id} value={t.id}>{t.name}{t.deleted_at ? ' (deleted)' : ''}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="h-start">Start Date</label><input id="h-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><label className="label" htmlFor="h-end">End Date</label><input id="h-end" type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div>
          <label className="label" htmlFor="h-month">Month</label>
          <select id="h-month" className="input" value={month} onChange={(e) => applyMonth(Number(e.target.value), year)}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="h-year">Year</label>
          <select id="h-year" className="input" value={year} onChange={(e) => applyMonth(month, Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="h-status">Status</label>
          <select id="h-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].short}</option>)}
          </select>
        </div>
      </div>

      <div className="panel overflow-hidden">
        {tooLong ? <Empty title="Choose a shorter period">History can show up to one year at a time.</Empty>
          : (loading || tLoading) ? <PageLoader />
            : rows.length === 0 ? <Empty title="No records for these filters">Try a different date range or status.</Empty> : (
              <div className="table-wrap max-h-[70vh] overflow-y-auto">
                <table className="tbl">
                  <thead className="sticky top-0 z-10"><tr><th>Date</th><th>Day</th><th>Trainee</th>{isManager && <th>Trainer</th>}<th>Status</th><th>Marked at</th></tr></thead>
                  <tbody>
                    {rows.map(({ k, t, info }) => (
                      <tr key={`${k}-${t.id}`}>
                        <td className="font-semibold text-slate-800">{fmtMedium(k)}</td>
                        <td className="text-slate-500">{fmtDay(k)}</td>
                        <td>{t.name}<span className="ml-1 text-xs text-slate-400">{[t.employee_code, t._batch?.code].filter(Boolean).join(' · ')}</span></td>
                        {isManager && <td className="text-slate-500">{trainerNames[trainerOn(t, k)] || '—'}</td>}
                        <td><StatusChip status={info.status} late={info.record?.is_late} /></td>
                        <td className="text-slate-500">{info.record ? fmtTime(info.record.marked_at, tz) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </div>
  );
}
