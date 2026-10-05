'use client';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Search } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, PageHeader, PageLoader, Spinner } from '@/components/ui';
import { useAttendance, useTrainees, useTrainers } from '@/lib/hooks';
import { addMonths, endOfMonth, MONTHS, pad, startOfMonth } from '@/lib/dates';
import { scopeTo } from '@/lib/status';
import {
  buildMonthlySheet, CELL, CELL_STYLE, downloadMonthlySheetXlsx, fmtDayHeader, inMonth, TOTAL_HEADERS,
} from '@/lib/monthlySheet';

const STAGES = { all: 'Everyone', training: 'In training', completed: 'Handed over', exited: 'Resigned / not certified / revoked' };

export default function MonthlySheetPage() {
  const { profile, settings, now, showToast } = useApp();
  const isManager = profile.role === 'manager';
  const [trainerId, setTrainerId] = useState('all');
  const [monthKey, setMonthKey] = useState(startOfMonth(now.date));
  const [q, setQ] = useState('');
  const [rm, setRm] = useState('all');
  const [stage, setStage] = useState('all');
  const [downloading, setDownloading] = useState(false);
  const { trainees, loading } = useTrainees(isManager ? { includeInactive: true, includeDeleted: true } : { includeInactive: true, includeDeleted: true, trainerId: profile.id });
  const { trainers } = useTrainers();
  const trainerNames = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);

  const [batchId, setBatchId] = useState('all');
  const scoped = useMemo(() => scopeTo(trainees, trainerId), [trainees, trainerId]);
  const batchOptions = useMemo(() => [...new Map(scoped.filter((t) => t._batch).map((t) => [t._batch.id, t._batch])).values()].sort((a, b) => a.code.localeCompare(b.code)), [scoped]);
  const monthTrainees = useMemo(() => scoped.filter((t) => inMonth(t, monthKey) && (batchId === 'all' || t.batch_id === batchId)), [scoped, monthKey, batchId]);
  const ids = useMemo(() => monthTrainees.map((t) => t.id), [monthTrainees]);
  const { byTrainee, loading: aLoading } = useAttendance(ids, monthKey, endOfMonth(monthKey));

  const sheet = useMemo(() => buildMonthlySheet({
    monthKey, trainees: monthTrainees, recordsByTrainee: byTrainee, trainerNames, settings, now,
  }), [monthKey, monthTrainees, byTrainee, trainerNames, settings, now]);

  const reportingManagers = useMemo(() => [...new Set(sheet.rows.map((r) => r.reportingManager).filter(Boolean))].sort(), [sheet.rows]);
  const stageOf = (id) => {
    const t = monthTrainees.find((x) => x.id === id);
    if (!t?.exit_reason) return 'training';
    return t.exit_reason === 'handover' ? 'completed' : 'exited';
  };
  const rows = sheet.rows.filter((r) => (rm === 'all' || r.reportingManager === rm)
    && (stage === 'all' || stageOf(r.id) === stage)
    && [r.name, r.code, r.reportingManager].some((v) => String(v).toLowerCase().includes(q.toLowerCase())));

  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7)) - 1;
  const years = [];
  for (let yy = Number(now.date.slice(0, 4)) + 1; yy >= Number(now.date.slice(0, 4)) - 3; yy -= 1) years.push(yy);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadMonthlySheetXlsx({ ...sheet, rows }, monthKey);
      showToast('Excel file downloaded.');
    } catch (e) {
      showToast(`Download failed: ${e.message}`, 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Monthly attendance sheet"
        subtitle={`${sheet.title} · ${rows.length} trainee${rows.length === 1 ? '' : 's'}`}
        actions={(
          <button className="btn-primary" onClick={download} disabled={downloading || !rows.length}>
            {downloading ? <Spinner size={16} /> : <FileSpreadsheet size={16} />}Download Excel
          </button>
        )}
      />

      <div className="panel flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
        <div className="flex items-end gap-2">
          <button className="btn-secondary h-[42px] px-3" onClick={() => setMonthKey(addMonths(monthKey, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <div>
            <label className="label" htmlFor="ms-month">Month</label>
            <select id="ms-month" className="input" value={m} onChange={(e) => setMonthKey(`${y}-${pad(Number(e.target.value) + 1)}-01`)}>
              {MONTHS.map((name, i) => <option key={name} value={i}>{name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ms-year">Year</label>
            <select id="ms-year" className="input" value={y} onChange={(e) => setMonthKey(`${e.target.value}-${pad(m + 1)}-01`)}>
              {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
            </select>
          </div>
          <button className="btn-secondary h-[42px] px-3" onClick={() => setMonthKey(addMonths(monthKey, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="ms-q">Search</label>
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="ms-q" className="input pl-10" placeholder="Name, E Code or reporting manager" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {isManager && (
          <div className="lg:w-48">
            <label className="label" htmlFor="ms-trainer">Trainer</label>
            <select id="ms-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="all">All trainers</option>
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {batchOptions.length > 0 && (
          <div className="lg:w-40">
            <label className="label" htmlFor="ms-batch">Batch</label>
            <select id="ms-batch" className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="all">All</option>
              {batchOptions.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
            </select>
          </div>
        )}
        <div className="lg:w-56">
          <label className="label" htmlFor="ms-rm">Reporting manager</label>
          <select id="ms-rm" className="input" value={rm} onChange={(e) => setRm(e.target.value)}>
            <option value="all">All</option>
            {reportingManagers.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div className="lg:w-56">
          <label className="label" htmlFor="ms-stage">Training status</label>
          <select id="ms-stage" className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
            {Object.entries(STAGES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="panel overflow-hidden">
        {(loading || aLoading) ? <PageLoader /> : rows.length === 0 ? (
          <Empty title="No trainees for this month">Trainees appear here when their DOJ and TCD / LWD overlap the selected month.</Empty>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-20">
                <tr>
                  {['E Code', 'E Name', 'DOJ', 'TCD / LWD', 'Reporting manager'].map((h, i) => (
                    <th key={h} className={`whitespace-nowrap border-b border-r border-ink-700 bg-ink-800 px-3 py-2.5 text-left font-semibold text-white ${i < 2 ? 'sticky z-30' : ''}`}
                      style={i === 0 ? { left: 0, minWidth: 70 } : i === 1 ? { left: 70, minWidth: 210 } : undefined}>{h}</th>
                  ))}
                  {sheet.days.map((k) => (
                    <th key={k} className={`whitespace-nowrap border-b border-r border-ink-600 px-2 py-2.5 text-center font-semibold text-white ${k === now.date ? 'bg-emerald-600' : 'bg-ink-700'}`}>{fmtDayHeader(k)}</th>
                  ))}
                  {TOTAL_HEADERS.map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-r border-ink-700 bg-ink-900 px-3 py-2.5 text-center font-semibold text-white">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:[&>td]:brightness-[0.97]">
                    <td className="sticky z-10 whitespace-nowrap border-b border-r border-slate-200 bg-white px-3 py-2 text-slate-600" style={{ left: 0 }}>{r.code || '—'}</td>
                    <td className="sticky z-10 whitespace-nowrap border-b border-r border-slate-200 bg-white px-3 py-2 font-semibold text-slate-800" style={{ left: 70 }}>{r.name}</td>
                    <td className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-2 text-slate-600">{r.dojLabel}</td>
                    <td className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-2 text-slate-600">{r.tcdLabel}</td>
                    <td className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-2 text-slate-600">{r.reportingManager || '—'}</td>
                    {r.cells.map((c, i) => (
                      <td key={sheet.days[i]} className={`border-b border-r border-slate-200 px-1.5 py-2 text-center font-semibold ${CELL_STYLE[c]?.tw || ''} ${c === CELL.HANDOVER ? 'min-w-[120px] whitespace-normal leading-tight' : 'min-w-[54px] whitespace-nowrap'}`}>{c}</td>
                    ))}
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-center font-semibold">{r.totals.present}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-center">{r.totals.wo}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-center">{r.totals.ph}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-center">{r.totals.absent}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-center">{r.totals.hd}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-center">{r.totals.leaves}</td>
                    <td className="border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-center font-bold text-ink-900">{r.paid}</td>
                    <td className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-slate-600">{r.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="rounded border border-slate-200 bg-white px-3 py-0.5">&nbsp;</span>Present (also when not marked)</span>
        {Object.entries(CELL_STYLE).filter(([code]) => ![CELL.LEAVE, CELL.P, CELL.NOT_FILLED].includes(code)).map(([code, st]) => (
          <span key={code} className="inline-flex items-center gap-1.5"><span className={`rounded px-1.5 py-0.5 font-semibold ${st.tw}`}>{code === CELL.HANDOVER ? 'Handover' : code}</span>{{
            P: 'Present', WO: 'Week off', PH: 'Holiday', Absent: 'Absent', 'Half day': 'Half day', Leave: 'Leave', 'Not Marked': 'Trainer did not mark', [CELL.HANDOVER]: 'Handover to Reporting Manager (day after TCD)',
          }[code]}</span>
        ))}
        <span>Total Paid Days = Present + WO + Public Holiday + Leaves + ½ HD. Holiday marked by the trainer goes in the Public Holiday column.</span>
      </div>
    </div>
  );
}
