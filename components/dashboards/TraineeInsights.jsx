'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/supabase';
import { fetchAll } from '@/lib/hooks';
import { buildContactIndex } from '@/lib/lmsExport';
import { buildInsights, enrich, NOT_LISTED } from '@/lib/traineeInsights';
import { Spinner, StatCard } from '../ui';

// Manager dashboard → "Trainee insights": department, joining trend, location and designation of the people in training,
// with the same filters as the Excel dashboard (trainer, batch, department, location, reporting authority).
const SLICE = { Ahmedabad: '#34437A', 'Outside Ahmedabad': '#F59F00', Unknown: '#CBD5E1' };
const CONTACT_COLS = 'employee_code, name, official_email, personal_email, department, designation, location, reporting_manager, active';
let contactsCache = null; // Contact Details are large and change rarely: read once, reuse for 10 minutes
const fmtDate = (k) => { const [, m, d] = String(k).split('-'); return `${+d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}`; };
const summary = (items) => items.map((x) => `${x.label} ${x.n}`).join(', ');

function Card({ title, hint, children, className = '' }) {
  return <div className={`panel p-5 ${className}`}><h3 className="text-sm font-bold text-ink-900">{title}</h3><p className="mb-4 text-xs text-slate-500">{hint}</p>{children}</div>;
}
function Columns({ items, label, fmt = (x) => x }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return (
    <div role="img" aria-label={`${label}: ${summary(items.map((x) => ({ label: fmt(x.label), n: x.n })))}`}>
      <div className="flex h-44 items-end gap-2 border-b border-slate-200">
        {items.map((x) => (
          <div key={x.label} className="flex flex-1 flex-col items-center justify-end text-xs font-bold text-ink-900">
            {x.n}<div className={`mt-1 w-full rounded-t-md ${x.label === NOT_LISTED ? 'bg-slate-300' : 'bg-ink-600'}`} style={{ height: Math.max(4, Math.round((x.n / max) * 132)) }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">{items.map((x) => <span key={x.label} title={fmt(x.label)} className="flex-1 truncate text-center text-[11px] text-slate-500">{fmt(x.label)}</span>)}</div>
    </div>
  );
}
function Rows({ items, label }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return (
    <div role="img" aria-label={`${label}: ${summary(items)}`} className="space-y-2.5">
      {items.map((x) => (
        <div key={x.label} className="grid grid-cols-[minmax(110px,190px)_1fr_34px] items-center gap-3 text-xs">
          <span className="truncate text-slate-700" title={x.label}>{x.label}</span>
          <div className="h-3.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${x.label === NOT_LISTED ? 'bg-slate-300' : 'bg-ink-600'}`} style={{ width: `${(x.n / max) * 100}%` }} /></div>
          <b className="text-right text-ink-900">{x.n}</b>
        </div>
      ))}
    </div>
  );
}

export default function TraineeInsights({ trainees, trainers, today }) {
  const [contacts, setContacts] = useState(contactsCache && Date.now() - contactsCache.at < 600000 ? contactsCache.rows : null);
  const [ratings, setRatings] = useState(null);
  const [f, setF] = useState({});
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));

  useEffect(() => {
    if (contacts) return;
    fetchAll(() => sb().from('contacts').select(CONTACT_COLS).order('name')).then((rows) => { contactsCache = { at: Date.now(), rows }; setContacts(rows); });
  }, [contacts]);
  useEffect(() => { // average feedback stars, all forms (a rating is only there when the form has a rating question)
    fetchAll(() => sb().from('feedback_responses').select('rating').not('rating', 'is', null)).then((rows) => setRatings(rows)).catch(() => setRatings([]));
  }, []);

  const idx = useMemo(() => buildContactIndex(contacts || []), [contacts]);
  const rows = useMemo(() => enrich(trainees, idx, today), [trainees, idx, today]);
  const I = useMemo(() => buildInsights(rows, today, f), [rows, today, f]);
  const names = Object.fromEntries(trainers.map((t) => [t.id, t.name]));
  const avg = ratings && ratings.length ? ratings.reduce((s, r) => s + Number(r.rating), 0) / ratings.length : null;
  const filtered = Object.values(f).some(Boolean);
  const sel = (id, label, key, list, show = (x) => x) => (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input" value={f[key] || ''} onChange={set(key)}>
        <option value="">All</option>{list.map((x) => <option key={x} value={x}>{show(x)}</option>)}
      </select>
    </div>
  );

  return (
    <section className="space-y-4" aria-labelledby="ti-title">
      <div>
        <h2 id="ti-title" className="text-lg font-bold text-ink-900">Trainee insights</h2>
        <p className="text-sm text-slate-500">Where the people in training sit. Every number below follows these filters.</p>
      </div>

      <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        {sel('ti-trainer', 'Trainer', 'trainer', I.options.trainers, (id) => names[id] || 'Trainer')}
        {sel('ti-batch', 'Batch', 'batch', I.options.batches)}
        {sel('ti-dept', 'Department', 'dept', I.options.depts)}
        {sel('ti-loc', 'Location', 'loc', I.options.locs)}
        {sel('ti-mgr', 'Reporting authority', 'mgr', I.options.mgrs)}
        <div className="flex items-end">{filtered && <button className="btn-secondary w-full" onClick={() => setF({})}>Clear filters</button>}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Trainees in training" value={I.kpi.inTraining} tone="ink" />
        <StatCard label="Joined this month" value={I.kpi.joinedThisMonth} tone="slate" />
        <StatCard label="Handover rate" value={I.kpi.handoverRate === null ? '—' : `${I.kpi.handoverRate}%`} tone="green" hint={I.kpi.finished ? `${I.kpi.completed} of ${I.kpi.finished} who finished` : 'Nobody has finished yet'} />
        <StatCard label="Average feedback" value={avg === null ? '—' : `★ ${avg.toFixed(1)}`} tone="amber" hint={ratings === null ? 'Loading…' : avg === null ? 'No ratings yet' : `${ratings.length} ratings, all forms`} />
      </div>

      {contacts === null ? <div className="panel py-16 text-center"><Spinner /></div> : (<>
        {contacts.length === 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">Contact Details is empty, so department, designation and location are unknown. Refresh it on the <Link href="/contacts" className="font-semibold underline">Contact Details</Link> page.</div>}
        {I.kpi.inTraining === 0 ? <div className="panel py-12 text-center text-sm text-slate-500">Nobody is in training for these filters.</div> : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Trainees by department" hint="Where the people in training sit (from Contact Details)"><Columns items={I.dept} label="Trainees by department" /></Card>
            <Card title="Joining trend by date" hint="How many trainees started on each day (latest dates)">{I.trend.length ? <Columns items={I.trend.map((x) => ({ label: x.date, n: x.n }))} label="Joining trend" fmt={fmtDate} /> : <p className="text-sm text-slate-500">No joining dates.</p>}</Card>
            <Card title="Location" hint="Ahmedabad or outside Ahmedabad">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full" role="img" aria-label={`Location: ${summary(I.loc)}`}
                  style={{ background: `conic-gradient(${(() => { let a = 0; return I.loc.map((x) => { const s = a; a += (x.n / I.kpi.inTraining) * 100; return `${SLICE[x.label]} ${s}% ${a}%`; }).join(', '); })()})` }}>
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-lg font-bold text-ink-900">{I.kpi.inTraining}</div>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {I.loc.map((x) => <li key={x.label}><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SLICE[x.label] }} />{x.label === 'Unknown' ? 'Unknown location' : x.label} <b>{x.n}</b> <span className="text-slate-500">({Math.round((x.n * 100) / I.kpi.inTraining)}%)</span></li>)}
                </ul>
              </div>
            </Card>
            <Card title="Trainees by designation" hint="Which roles are in training right now" className="lg:col-span-2"><Rows items={I.desig} label="Trainees by designation" /></Card>
          </div>
        )}
      </>)}
    </section>
  );
}
