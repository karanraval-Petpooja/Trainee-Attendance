'use client';
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { PageHeader, PageLoader } from '@/components/ui';
import { useTrainees, useTrainers } from '@/lib/hooks';
import { addMonths, endOfMonth, fmtMedium, MONTHS, startOfMonth } from '@/lib/dates';
import { periodsOf } from '@/lib/status';
import { EXCLUDED, kpiOf } from '@/lib/kpi';

// Trainer KPI — FAP (First Attempt Pass) and Throughput, by trainer and by batch.
// Each trainee counts for the trainer who trained their FIRST attempt.
const pctTxt = (p) => (p == null ? '—' : `${Math.round(p)}%`);
const tone = (p) => (p == null ? 'text-slate-400' : p >= 90 ? 'text-emerald-600' : p >= 75 ? 'text-amber-600' : 'text-red-600');

export default function KpiPage() {
  const { profile, now } = useApp();
  const canAll = profile.role === 'manager' || !!profile.report_access;
  const { trainees, loading } = useTrainees(canAll ? { includeInactive: true } : { includeInactive: true, trainerId: profile.id });
  const { trainers } = useTrainers();
  const [from, setFrom] = useState(addMonths(startOfMonth(now.date), -2));
  const [to, setTo] = useState(startOfMonth(now.date));
  const [trainer, setTrainer] = useState('all');
  const [drill, setDrill] = useState(null);
  const trainerName = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);

  // trainer of the first attempt: the trainer history at the end of the first training period
  const firstTrainer = (t) => {
    const p = periodsOf(t)[0]; const day = p?.end || now.date;
    const a = (t._assign || []).filter((x) => x.start_date <= day && (!x.end_date || x.end_date >= day)).sort((x, y) => (x.start_date < y.start_date ? 1 : -1))[0];
    return a?.trainer_id || t.trainer_id || null;
  };
  const lo = from <= to ? from : to; const hi = endOfMonth(from <= to ? to : from);
  const cohort = useMemo(() => trainees.filter((t) => !t.deleted_at && t.joining_date >= lo && t.joining_date <= hi)
    .map((t) => ({ t, tr: firstTrainer(t) })), [trainees, lo, hi]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = cohort.filter((x) => trainer === 'all' || x.tr === trainer);
  const total = kpiOf(visible.map((x) => x.t));
  const byTrainer = Object.entries(visible.reduce((m, x) => { (m[x.tr || '—'] = m[x.tr || '—'] || []).push(x.t); return m; }, {}))
    .map(([id, list]) => ({ id, name: trainerName[id] || list[0]?.trainer_label || 'Not assigned', k: kpiOf(list) }))
    .sort((a, b) => (b.k.throughputPct ?? -1) - (a.k.throughputPct ?? -1) || a.name.localeCompare(b.name));
  const byBatch = Object.entries(visible.reduce((m, x) => { const c = x.t._batch?.code || 'No batch'; (m[c] = m[c] || []).push(x); return m; }, {}))
    .map(([code, xs]) => ({ code, trainer: [...new Set(xs.map((x) => trainerName[x.tr] || 'Not assigned'))].join(', '), doj: xs.map((x) => x.t.joining_date).sort()[0], k: kpiOf(xs.map((x) => x.t)) }))
    .sort((a, b) => (a.doj < b.doj ? 1 : -1));
  const show = (title, people) => people.length && setDrill({ title, people });

  if (loading) return <PageLoader />;
  const years = []; for (let y = Number(now.date.slice(0, 4)) - 2; y <= Number(now.date.slice(0, 4)); y += 1) years.push(y);
  const MonthPick = ({ id, value, set }) => (
    <div className="flex gap-1">
      <select id={id} className="input" value={Number(value.slice(5, 7)) - 1} onChange={(e) => set(`${value.slice(0, 4)}-${String(Number(e.target.value) + 1).padStart(2, '0')}-01`)}>{MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}</select>
      <select className="input" value={Number(value.slice(0, 4))} onChange={(e) => set(`${e.target.value}-${value.slice(5, 7)}-01`)} aria-label="Year">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
    </div>
  );
  const Num = ({ v, people, title, cls = '' }) => (people?.length ? <button type="button" className={`font-semibold hover:underline ${cls}`} onClick={() => show(title, people)}>{v}</button> : <span className={cls}>{v}</span>);
  const Row = ({ label, sub, k, title }) => (
    <tr>
      <td className="font-semibold text-slate-800">{label}{sub && <div className="text-xs font-normal text-slate-400">{sub}</div>}</td>
      <td>{k.joined}</td>
      <td><Num v={k.excluded} people={k.people.excluded} title={`${title} · not counted (left / DOJ revised…)`} cls="text-slate-500" /></td>
      <td className="font-semibold">{k.counted}</td>
      <td><span className={`text-base font-extrabold ${tone(k.fapPct)}`}>{pctTxt(k.fapPct)}</span> <Num v={`${k.fap}/${k.firstDecided}`} people={k.people.fap} title={`${title} · passed on the first attempt`} cls="text-xs text-slate-500" /></td>
      <td><Num v={k.firstFail} people={k.people.firstFail} title={`${title} · failed the first attempt`} cls={k.firstFail ? 'text-red-600' : ''} /></td>
      <td><Num v={k.retrainPass} people={k.people.retrainPass} title={`${title} · passed after retraining`} /></td>
      <td><Num v={k.notCertified} people={k.people.notCertified} title={`${title} · not certified`} cls={k.notCertified ? 'text-red-600' : ''} /></td>
      <td><span className={`text-base font-extrabold ${tone(k.throughputPct)}`}>{pctTxt(k.throughputPct)}</span> <Num v={`${k.passed}/${k.finalDecided}`} people={k.people.passed} title={`${title} · passed in the end`} cls="text-xs text-slate-500" /></td>
      <td><Num v={k.inProgress} people={k.people.inProgress} title={`${title} · still in training / retraining`} cls="text-slate-500" /></td>
    </tr>
  );
  const Head = ({ first }) => (
    <thead><tr><th>{first}</th><th>Joined</th><th title="Left the organisation (Resigned, Drop Out, Service Not Required) or never joined (DOJ Revised, Offer Revoked)">Not counted</th><th>Counted</th><th title="Passed on the first attempt ÷ counted with a first result">FAP</th><th>Fail (1st)</th><th>Passed after retraining</th><th>Not certified</th><th title="Passed in the end ÷ counted with a final result">Throughput (KPI)</th><th>In progress</th></tr></thead>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Trainer KPI" subtitle="FAP (first attempt pass) and Throughput by trainer and batch. People who left the organisation or whose DOJ was revised are not counted." />
      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <div><label className="label" htmlFor="k-from">Joined from</label><MonthPick id="k-from" value={from} set={setFrom} /></div>
        <div><label className="label" htmlFor="k-to">to</label><MonthPick id="k-to" value={to} set={setTo} /></div>
        {canAll && (
          <div><label className="label" htmlFor="k-tr">Trainer</label>
            <select id="k-tr" className="input" value={trainer} onChange={(e) => setTrainer(e.target.value)}>
              <option value="all">All trainers</option>{trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
        )}
        <p className="flex-1 text-xs text-slate-500">Trainees who joined {fmtMedium(lo)} – {fmtMedium(hi)}. Each counts for the trainer of their first attempt.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="panel p-5"><div className="text-sm text-slate-500">Throughput (KPI)</div><div className={`mt-1 text-3xl font-extrabold ${tone(total.throughputPct)}`}>{pctTxt(total.throughputPct)}</div><div className="mt-1 text-xs text-slate-400">{total.passed} of {total.finalDecided} passed in the end</div></div>
        <div className="panel p-5"><div className="text-sm text-slate-500">FAP (first attempt pass)</div><div className={`mt-1 text-3xl font-extrabold ${tone(total.fapPct)}`}>{pctTxt(total.fapPct)}</div><div className="mt-1 text-xs text-slate-400">{total.fap} of {total.firstDecided} on the first attempt</div></div>
        <div className="panel p-5"><div className="text-sm text-slate-500">Failed the first attempt</div><div className="mt-1 text-3xl font-extrabold text-red-600">{total.firstFail}</div><div className="mt-1 text-xs text-slate-400">{total.retrainPass} passed after retraining · {total.notCertified} not certified</div></div>
        <div className="panel p-5"><div className="text-sm text-slate-500">Counted</div><div className="mt-1 text-3xl font-extrabold text-ink-900">{total.counted}</div><div className="mt-1 text-xs text-slate-400">{total.excluded} not counted{Object.keys(total.excludedBy).length ? ` (${Object.entries(total.excludedBy).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''} · {total.inProgress} in progress</div></div>
      </div>

      <section className="panel overflow-hidden">
        <h2 className="border-b border-slate-100 px-5 py-4 text-base font-bold">By trainer</h2>
        <div className="table-wrap"><table className="tbl"><Head first="Trainer" /><tbody>{byTrainer.map((r) => <Row key={r.id} label={r.name} k={r.k} title={r.name} />)}</tbody></table></div>
        {!byTrainer.length && <p className="px-5 py-4 text-sm text-slate-400">No trainees joined in this period.</p>}
      </section>

      <section className="panel overflow-hidden">
        <h2 className="border-b border-slate-100 px-5 py-4 text-base font-bold">By batch</h2>
        <div className="table-wrap"><table className="tbl"><Head first="Batch" /><tbody>{byBatch.map((r) => <Row key={r.code} label={r.code} sub={`${r.trainer} · from ${fmtMedium(r.doj)}`} k={r.k} title={r.code} />)}</tbody></table></div>
      </section>

      {drill && (
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-base font-bold">{drill.title} · {drill.people.length}</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setDrill(null)} aria-label="Close"><X size={16} /></button>
          </div>
          <div className="table-wrap max-h-96 overflow-y-auto"><table className="tbl">
            <thead><tr><th>E Code</th><th>Name</th><th>Batch</th><th>DOJ</th><th>Attempts</th><th>Result</th></tr></thead>
            <tbody>{drill.people.map((t) => (
              <tr key={t.id}><td>{t.employee_code || '—'}</td><td className="font-semibold">{t.name}</td><td>{t._batch?.code || '—'}</td><td>{fmtMedium(t.joining_date)}</td>
                <td>{periodsOf(t).length}</td><td>{EXCLUDED[t.exit_reason] || (t.exit_reason === 'handover' ? 'Passed (handover)' : t.exit_reason === 'not_certified' ? 'Not certified' : 'In progress')}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      <p className="text-xs text-slate-400">FAP = passed on the first attempt ÷ trainees with a first result. Throughput = passed in the end (also after retraining) ÷ trainees with a final result. Not counted: Resigned, Drop Out, Service Not Required, DOJ Revised, Offer Revoked. Pass = final Handover; first-attempt fail = Retraining or Not Certified.</p>
    </div>
  );
}
