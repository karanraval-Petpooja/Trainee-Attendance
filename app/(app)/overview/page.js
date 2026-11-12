'use client';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { PageHeader, PageLoader } from '@/components/ui';
import { fetchAll, useTrainees, useTrainers } from '@/lib/hooks';
import { sb } from '@/lib/supabase';
import { fmtMedium, startOfMonth, endOfMonth } from '@/lib/dates';
import { EXIT_LABELS, isRetraining, periodsOf, sentToFloor, traineeActiveOn } from '@/lib/status';

// Training overview: who is in training and how trainings end, with filters. Click any number to see the people.
const STATUS = [
  ['training', 'In Training', 'bg-ink-700'],
  ['retraining', 'Retraining', 'bg-amber-500'],
  ['awaiting', 'Awaiting final handover', 'bg-indigo-400'],
  ['upcoming', 'Joining soon', 'bg-sky-400'],
  ['handover', 'Handover', 'bg-emerald-500'],
  ['resigned', 'Resigned', 'bg-red-500'],
  ['not_certified', 'Not Certified', 'bg-rose-400'],
  ['drop_out', 'Drop Out', 'bg-orange-500'],
  ['service_not_required', 'Service Not Required', 'bg-stone-400'],
  ['doj_revised', 'DOJ Revised', 'bg-slate-400'],
  ['offer_revoked', 'Offer Revoked', 'bg-slate-500'],
];
const FINISHED = ['handover', 'resigned', 'not_certified', 'drop_out', 'service_not_required'];
const norm = (x) => String(x || '').trim();
const isAhmedabad = (c) => /ahmedabad|amdavad|gandhinagar/i.test(c || '');

export default function OverviewPage() {
  const { profile, now } = useApp();
  const canAll = profile.role === 'manager' || !!profile.report_access;
  const { trainees, loading } = useTrainees(canAll ? { includeInactive: true } : { includeInactive: true, trainerId: profile.id });
  const { trainers } = useTrainers();
  const [f, setF] = useState({ trainer: 'all', batch: 'all', dept: 'all', loc: 'all', rm: 'all' });
  const [drill, setDrill] = useState(null); // { title, people }
  const [feedback, setFeedback] = useState({});
  useEffect(() => {
    fetchAll(() => sb().from('trainee_feedback').select('trainee_id, status'))
      .then((rows) => setFeedback(Object.fromEntries(rows.map((r) => [r.trainee_id, r.status])))).catch(() => {});
  }, []);
  const trainerName = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);

  const statusOf = (t) => {
    if (t.status !== 'active') return null;
    if (sentToFloor(t)) return 'awaiting';
    if (traineeActiveOn(t, now.date)) return isRetraining(t) ? 'retraining' : 'training';
    if (!t.exit_reason && t.joining_date > now.date) return 'upcoming';
    return t.exit_reason || null;
  };
  const locOf = (t) => (!norm(t.city) ? 'Not known' : isAhmedabad(t.city) ? 'Ahmedabad' : 'Outside Ahmedabad');

  const all = useMemo(() => trainees.filter((t) => !t.deleted_at).map((t) => ({ t, st: statusOf(t) })).filter((x) => x.st), [trainees, now.date]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = (fn) => [...new Set(all.map(({ t }) => fn(t)).filter(Boolean))].sort();
  const pass = ({ t }) => (f.trainer === 'all' || t.trainer_id === f.trainer) && (f.batch === 'all' || (t._batch?.code || '—') === f.batch)
    && (f.dept === 'all' || (norm(t.department) || 'Not known') === f.dept) && (f.loc === 'all' || locOf(t) === f.loc)
    && (f.rm === 'all' || (norm(t.reporting_manager) || 'Not known') === f.rm);
  const list = all.filter(pass);
  const inTraining = list.filter((x) => ['training', 'retraining', 'awaiting'].includes(x.st));
  const ms = startOfMonth(now.date); const me = endOfMonth(now.date);
  const joined = list.filter(({ t }) => t.joining_date >= ms && t.joining_date <= me);
  const finished = list.filter((x) => FINISHED.includes(x.st));
  const handed = finished.filter((x) => x.st === 'handover');
  const fbBase = finished.filter((x) => x.st === 'handover');
  const fbTaken = fbBase.filter(({ t }) => feedback[t.id] === 'taken');

  const group = (arr, keyFn) => Object.entries(arr.reduce((m, x) => { const k = keyFn(x); (m[k] = m[k] || []).push(x.t); return m; }, {}));
  const byStatus = STATUS.map(([k, label, color]) => ({ k, label, color, people: list.filter((x) => x.st === k).map((x) => x.t) })).filter((s) => s.people.length);
  const byDept = group(inTraining, ({ t }) => norm(t.department) || 'Not known').sort((a, b) => b[1].length - a[1].length);
  const byLoc = group(inTraining, ({ t }) => locOf(t)).sort((a, b) => b[1].length - a[1].length);
  const byDoj = group(list, ({ t }) => t.joining_date).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-12);
  const show = (title, people) => setDrill({ title, people });
  const pctOf = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  if (loading) return <PageLoader />;
  const Sel = ({ label, k, options, render = (x) => x }) => (
    <div><label className="label" htmlFor={`ov-${k}`}>{label}</label>
      <select id={`ov-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        <option value="all">All</option>{options.map((o) => <option key={o} value={o}>{render(o)}</option>)}
      </select></div>
  );
  const Tile = ({ label, value, sub, tone = 'text-ink-900', onClick }) => (
    <button type="button" onClick={onClick} className="panel p-5 text-left hover:border-slate-300">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-extrabold ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </button>
  );
  const maxDoj = Math.max(1, ...byDoj.map(([, p]) => p.length));
  const locTotal = byLoc.reduce((a, [, p]) => a + p.length, 0);
  const LOC_COLOR = { Ahmedabad: '#334a7d', 'Outside Ahmedabad': '#f59e0b', 'Not known': '#cbd5e1' };
  let acc = 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Training overview" subtitle="Where the people in training are and how trainings end. Click any number to see the people behind it." />
      <div className="panel grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {canAll && <Sel label="Trainer" k="trainer" options={opts((t) => t.trainer_id)} render={(id) => trainerName[id] || 'Not assigned'} />}
        <Sel label="Batch" k="batch" options={opts((t) => t._batch?.code || '—')} />
        <Sel label="Department" k="dept" options={opts((t) => norm(t.department) || 'Not known')} />
        <Sel label="Location" k="loc" options={opts(locOf)} />
        <Sel label="Reporting authority" k="rm" options={opts((t) => norm(t.reporting_manager) || 'Not known')} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Trainees in training" value={inTraining.length} onClick={() => show('In training', inTraining.map((x) => x.t))} />
        <Tile label="Joined this month" value={joined.length} onClick={() => show('Joined this month', joined.map((x) => x.t))} />
        <Tile label="Handover rate" value={pctOf(handed.length, finished.length)} tone="text-emerald-600" sub={`${handed.length} of ${finished.length} who finished`} onClick={() => show('Handed over', handed.map((x) => x.t))} />
        <Tile label="Feedback taken" value={pctOf(fbTaken.length, fbBase.length)} tone="text-amber-600" sub={`${fbTaken.length} of ${fbBase.length} handed over`} onClick={() => show('Handed over without feedback taken', fbBase.filter(({ t }) => feedback[t.id] !== 'taken').map((x) => x.t))} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-base font-bold">Trainees by status</h2>
          <p className="text-xs text-slate-500">Everyone matching the filters, by where they stand today</p>
          <ul className="mt-3 space-y-2">
            {byStatus.map((s) => (
              <li key={s.k}><button type="button" className="flex w-full items-center gap-3 text-left text-sm hover:opacity-80" onClick={() => show(s.label, s.people)}>
                <span className="w-44 shrink-0 truncate text-slate-700">{s.label}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${s.color}`} style={{ width: `${(s.people.length / Math.max(1, list.length)) * 100}%` }} /></span>
                <span className="w-24 shrink-0 text-right font-bold text-slate-800">{s.people.length} <span className="text-xs font-normal text-slate-400">({pctOf(s.people.length, list.length)})</span></span>
              </button></li>
            ))}
            {!byStatus.length && <li className="text-sm text-slate-400">No trainees for these filters.</li>}
          </ul>
        </section>

        <section className="panel p-5">
          <h2 className="text-base font-bold">Trainees by department</h2>
          <p className="text-xs text-slate-500">Where the people in training sit</p>
          <ul className="mt-3 space-y-2">
            {byDept.map(([k, people]) => (
              <li key={k}><button type="button" className="flex w-full items-center gap-3 text-left text-sm hover:opacity-80" onClick={() => show(`In training · ${k}`, people)}>
                <span className="w-44 shrink-0 truncate text-slate-700">{k}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-ink-700" style={{ width: `${(people.length / Math.max(1, inTraining.length)) * 100}%` }} /></span>
                <span className="w-10 shrink-0 text-right font-bold text-slate-800">{people.length}</span>
              </button></li>
            ))}
            {!byDept.length && <li className="text-sm text-slate-400">Nobody in training.</li>}
          </ul>
        </section>

        <section className="panel p-5">
          <h2 className="text-base font-bold">Joining trend by date</h2>
          <p className="text-xs text-slate-500">How many trainees started on each day (latest dates)</p>
          <div className="mt-4 flex h-44 items-end gap-2">
            {byDoj.map(([d, people]) => (
              <button key={d} type="button" className="flex flex-1 flex-col items-center justify-end gap-1 hover:opacity-80" onClick={() => show(`Joined ${fmtMedium(d)}`, people)} title={fmtMedium(d)}>
                <span className="text-xs font-bold text-slate-700">{people.length}</span>
                <span className="w-full rounded-t bg-ink-700" style={{ height: `${(people.length / maxDoj) * 130}px` }} />
                <span className="text-[10px] text-slate-500">{d.slice(8)}/{d.slice(5, 7)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="text-base font-bold">Location</h2>
          <p className="text-xs text-slate-500">Trainees in training: Ahmedabad or outside Ahmedabad</p>
          <div className="mt-3 flex items-center gap-6">
            <svg viewBox="0 0 42 42" className="h-36 w-36 shrink-0" role="img" aria-label="Location">
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="6" />
              {byLoc.map(([k, people]) => {
                const share = (people.length / Math.max(1, locTotal)) * 100; const off = 25 - acc; acc += share;
                return <circle key={k} cx="21" cy="21" r="15.9" fill="none" stroke={LOC_COLOR[k] || '#94a3b8'} strokeWidth="6" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={off} />;
              })}
              <text x="21" y="23.5" textAnchor="middle" className="fill-slate-800" style={{ fontSize: 7, fontWeight: 800 }}>{locTotal}</text>
            </svg>
            <ul className="space-y-1.5 text-sm">
              {byLoc.map(([k, people]) => (
                <li key={k}><button type="button" className="flex items-center gap-2 hover:underline" onClick={() => show(`In training · ${k}`, people)}>
                  <span className="h-3 w-3 rounded-sm" style={{ background: LOC_COLOR[k] || '#94a3b8' }} />{k} <b>{people.length}</b> <span className="text-slate-400">({pctOf(people.length, locTotal)})</span>
                </button></li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {drill && (
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="text-base font-bold">{drill.title} · {drill.people.length}</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setDrill(null)} aria-label="Close"><X size={16} /></button>
          </div>
          <div className="table-wrap max-h-96 overflow-y-auto">
            <table className="tbl">
              <thead><tr><th>E Code</th><th>Name</th><th>Batch</th><th>DOJ</th><th>TCD / LWD</th><th>Status</th><th>Trainer</th><th>Department</th><th>Reporting authority</th></tr></thead>
              <tbody>
                {drill.people.map((t) => (
                  <tr key={t.id}>
                    <td className="text-slate-600">{t.employee_code || '—'}</td>
                    <td className="font-semibold text-slate-800">{t.name}</td>
                    <td>{t._batch?.code || '—'}</td>
                    <td>{fmtMedium(t.joining_date)}</td>
                    <td>{t.tcd_lwd ? fmtMedium(t.tcd_lwd) : '—'}</td>
                    <td>{STATUS.find(([k]) => k === statusOf(t))?.[1] || EXIT_LABELS[t.exit_reason || ''] || '—'}{periodsOf(t).length > 1 ? ' · retrained' : ''}</td>
                    <td>{trainerName[t.trainer_id] || t.trainer_label || '—'}</td>
                    <td>{t.department || '—'}</td>
                    <td>{t.reporting_manager || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
