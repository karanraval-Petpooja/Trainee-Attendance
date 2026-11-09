'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Search, X } from 'lucide-react';
import { sb } from '@/lib/supabase';
import { fetchAll } from '@/lib/hooks';
import { buildContactIndex } from '@/lib/lmsExport';
import { buildInsights, enrich, NOT_LISTED, OUTCOME_LABEL } from '@/lib/traineeInsights';
import { Spinner, StatCard } from '../ui';

// Manager dashboard → "Trainee insights": department, joining trend, location and designation of the people in training,
// with the same filters as the Excel dashboard. Every bar, slice and number card opens the list of people behind it.
const SLICE = { Ahmedabad: '#34437A', 'Outside Ahmedabad': '#F59F00', Unknown: '#CBD5E1' };
const CONTACT_COLS = 'employee_code, name, official_email, personal_email, department, designation, location, reporting_manager, active';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let contactsCache = null; // Contact Details are large and change rarely: read once, reuse for 10 minutes
const dm = (k) => { const [, m, d] = String(k).split('-'); return [`${+d}`, MONTHS[+m - 1]]; };
const full = (k) => { const [y, m, d] = String(k || '').split('-'); return k ? `${+d} ${MONTHS[+m - 1]} ${y}` : '—'; };
const summary = (items) => items.map((x) => `${x.label} ${x.n}`).join(', ');
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400';

function Card({ title, hint, children, className = '' }) {
  return <div className={`panel p-5 ${className}`}><h3 className="text-sm font-bold text-ink-900">{title}</h3><p className="mb-4 text-xs text-slate-500">{hint}</p>{children}</div>;
}

// Vertical bars (the joining trend). Dates are written on two lines (day over month) so they always fit.
function Columns({ items, label, onPick }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return (
    <div role="group" aria-label={`${label}: ${summary(items.map((x) => ({ label: dm(x.label).join(' '), n: x.n })))}`}>
      <div className="flex h-44 items-end gap-1.5 border-b border-slate-200">
        {items.map((x) => (
          <button key={x.label} type="button" onClick={() => onPick(x)} aria-label={`${dm(x.label).join(' ')}: ${x.n} joined. Show the list`}
            className={`group flex h-full flex-1 flex-col items-center justify-end rounded-t-md text-xs font-bold text-ink-900 ${focus}`}>
            {x.n}<div className="mt-1 w-full rounded-t-md bg-ink-600 transition-colors group-hover:bg-ink-800" style={{ height: Math.max(4, Math.round((x.n / max) * 132)) }} />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {items.map((x) => { const [d, m] = dm(x.label); return <span key={x.label} onClick={() => onPick(x)} className="flex-1 cursor-pointer text-center text-[10px] leading-tight text-slate-500"><b className="block text-[11px] text-slate-700">{d}</b>{m}</span>; })}
      </div>
    </div>
  );
}

// Horizontal bars (department, designation): the full name is always readable
function Rows({ items, label, onPick }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return (
    <div role="group" aria-label={`${label}: ${summary(items)}`} className="space-y-1">
      {items.map((x) => (
        <button key={x.label} type="button" onClick={() => onPick(x)} aria-label={`${x.label}: ${x.n}. Show the list`} title={x.label}
          className={`group grid w-full grid-cols-[minmax(110px,190px)_1fr_34px] items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-xs hover:bg-slate-50 ${focus}`}>
          <span className="truncate text-slate-700">{x.label}</span>
          <span className="h-3.5 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full transition-colors ${x.label === NOT_LISTED ? 'bg-slate-300 group-hover:bg-slate-400' : 'bg-ink-600 group-hover:bg-ink-800'}`} style={{ width: `${(x.n / max) * 100}%` }} /></span>
          <b className="text-right text-ink-900">{x.n}</b>
        </button>
      ))}
    </div>
  );
}

// The list of people behind a bar, a slice or a number card
function DetailPanel({ detail, names, today, onClose, onFilter }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const list = useMemo(() => detail.rows
    .filter((r) => [r.t.name, r.code, r.dept, r.desig, r.mgr, r.t._batch?.code].some((v) => String(v || '').toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => a.t.name.localeCompare(b.t.name)), [detail, q]);
  const line = (r) => [r.code || '', r.t.name, r.t._batch?.code || '', names[r.t.trainer_id] || '', r.dept === NOT_LISTED ? '' : r.dept, r.desig === NOT_LISTED ? '' : r.desig,
    r.loc === 'Unknown' ? '' : r.loc, r.mgr === NOT_LISTED ? '' : r.mgr, full(r.t.joining_date), OUTCOME_LABEL[r.outcome]];
  const HEAD = ['E Code', 'Name', 'Batch', 'Trainer', 'Department', 'Designation', 'Location', 'Reporting authority', 'Joined', 'Status'];
  const download = async () => {
    setBusy(true);
    const { downloadTableXlsx } = await import('@/lib/monthlySheet');
    await downloadTableXlsx({ headers: HEAD, rows: list.map(line), filename: `Trainees_${detail.title.replace(/[^A-Za-z0-9]+/g, '_')}_${today}.xlsx`, sheetName: 'Trainees' });
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={detail.title} className="animate-pop flex max-h-[90vh] w-full max-w-6xl flex-col rounded-3xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div><h2 className="text-lg font-bold text-ink-900">{detail.title}</h2><p className="text-sm text-slate-500">{detail.rows.length} {detail.rows.length === 1 ? 'person' : 'people'}{detail.note ? ` · ${detail.note}` : ''}</p></div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-10" placeholder="Search name, E Code, department…" aria-label="Search this list" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {detail.filter && <button className="btn-secondary" onClick={() => onFilter(detail.filter)}>Filter the dashboard to {detail.filter.value}</button>}
          <button className="btn-primary" onClick={download} disabled={busy || !list.length}>{busy ? <Spinner size={16} /> : <Download size={16} />}Download Excel</button>
        </div>
        <div className="overflow-auto">
          {list.length === 0 ? <p className="px-6 py-10 text-center text-sm text-slate-500">Nobody matches your search.</p> : (
            <table className="tbl">
              <thead className="sticky top-0 z-10"><tr>{HEAD.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {list.map((r) => { const c = line(r); return (
                  <tr key={r.t.id}>{c.map((v, i) => <td key={i} className={i === 1 ? 'font-semibold text-slate-800' : 'text-slate-600'}>{i === 9
                    ? <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${r.outcome === 'completed' ? 'bg-emerald-100 text-emerald-800' : r.outcome === 'ended' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>{v}</span> : (v || '—')}</td>)}</tr>
                ); })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TraineeInsights({ trainees, trainers, today }) {
  const [contacts, setContacts] = useState(contactsCache && Date.now() - contactsCache.at < 600000 ? contactsCache.rows : null);
  const [ratings, setRatings] = useState(null);
  const [f, setF] = useState({});
  const [detail, setDetail] = useState(null);
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
  const open = (title, list, extra = {}) => setDetail({ title, rows: list, ...extra });
  const sel = (id, label, key, list, show = (x) => x) => (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input" value={f[key] || ''} onChange={set(key)}>
        <option value="">All</option>{list.map((x) => <option key={x} value={x}>{show(x)}</option>)}
      </select>
    </div>
  );
  const card = (title, list, node) => (
    <button type="button" onClick={() => open(title, list)} aria-label={`${title}: ${list.length}. Show the list`}
      className={`block w-full rounded-2xl text-left transition hover:ring-2 hover:ring-ink-300 ${focus}`}>{node}</button>
  );
  const donutPick = (e) => { // clicking the ring itself picks the slice under the pointer (the legend works from the keyboard)
    const r = e.currentTarget.getBoundingClientRect();
    const deg = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    const pct = (((deg % 360) + 360) % 360) / 3.6;
    let acc = 0;
    const hit = I.loc.find((x) => { acc += (x.n / I.kpi.inTraining) * 100; return pct <= acc; });
    if (hit) pickLoc(hit);
  };
  const pickLoc = (x) => open(`${x.label === 'Unknown' ? 'Unknown location' : x.label}: in training`, x.rows, { filter: { key: 'loc', value: x.label } });

  return (
    <section className="space-y-4" aria-labelledby="ti-title">
      <div>
        <h2 id="ti-title" className="text-lg font-bold text-ink-900">Trainee insights</h2>
        <p className="text-sm text-slate-500">Where the people in training sit. Every number follows these filters. Click any bar, slice or number to see the people behind it.</p>
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
        {card('Trainees in training', I.lists.inTraining, <StatCard label="Trainees in training" value={I.kpi.inTraining} tone="ink" />)}
        {card('Joined this month', I.lists.joinedThisMonth, <StatCard label="Joined this month" value={I.kpi.joinedThisMonth} tone="slate" />)}
        {card('Finished training: handed over or left', I.lists.finished, <StatCard label="Handover rate" value={I.kpi.handoverRate === null ? '—' : `${I.kpi.handoverRate}%`} tone="green" hint={I.kpi.finished ? `${I.kpi.completed} of ${I.kpi.finished} who finished` : 'Nobody has finished yet'} />)}
        <StatCard label="Average feedback" value={avg === null ? '—' : `★ ${avg.toFixed(1)}`} tone="amber" hint={ratings === null ? 'Loading…' : avg === null ? 'No ratings yet' : `${ratings.length} ratings, all forms`} />
      </div>

      {contacts === null ? <div className="panel py-16 text-center"><Spinner /></div> : (<>
        {contacts.length === 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">Contact Details is empty, so department, designation and location are unknown. Refresh it on the <Link href="/contacts" className="font-semibold underline">Contact Details</Link> page.</div>}
        {I.kpi.inTraining === 0 ? <div className="panel py-12 text-center text-sm text-slate-500">Nobody is in training for these filters.</div> : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Trainees by department" hint="Where the people in training sit (from Contact Details)">
              <Rows items={I.dept} label="Trainees by department" onPick={(x) => open(`${x.label}: in training`, x.rows, x.label === 'Others' || x.label === NOT_LISTED ? { note: x.label === 'Others' ? 'the smaller departments together' : 'not found in Contact Details' } : { filter: { key: 'dept', value: x.label } })} />
            </Card>
            <Card title="Joining trend by date" hint="How many trainees started on each day (latest dates)">
              {I.trend.length ? <Columns items={I.trend.map((x) => ({ label: x.date, n: x.n, rows: x.rows }))} label="Joining trend" onPick={(x) => open(`Joined on ${full(x.label)}`, x.rows)} /> : <p className="text-sm text-slate-500">No joining dates.</p>}
            </Card>
            <Card title="Location" hint="Ahmedabad or outside Ahmedabad">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex h-36 w-36 shrink-0 cursor-pointer items-center justify-center rounded-full" role="img" aria-label={`Location: ${summary(I.loc)}`} onClick={donutPick}
                  style={{ background: `conic-gradient(${(() => { let a = 0; return I.loc.map((x) => { const s = a; a += (x.n / I.kpi.inTraining) * 100; return `${SLICE[x.label]} ${s}% ${a}%`; }).join(', '); })()})` }}>
                  <div className="pointer-events-none flex h-20 w-20 items-center justify-center rounded-full bg-white text-lg font-bold text-ink-900">{I.kpi.inTraining}</div>
                </div>
                <ul className="space-y-1 text-sm">
                  {I.loc.map((x) => <li key={x.label}><button type="button" onClick={() => pickLoc(x)} aria-label={`${x.label}: ${x.n}. Show the list`} className={`rounded-md px-1.5 py-1 text-left hover:bg-slate-50 ${focus}`}>
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SLICE[x.label] }} />{x.label === 'Unknown' ? 'Unknown location' : x.label} <b>{x.n}</b> <span className="text-slate-500">({Math.round((x.n * 100) / I.kpi.inTraining)}%)</span></button></li>)}
                </ul>
              </div>
            </Card>
            <Card title="Trainees by designation" hint="Which roles are in training right now" className="lg:col-span-2">
              <Rows items={I.desig} label="Trainees by designation" onPick={(x) => open(`${x.label}: in training`, x.rows, x.label === 'Others' ? { note: 'the smaller roles together' } : x.label === NOT_LISTED ? { note: 'not found in Contact Details' } : {})} />
            </Card>
          </div>
        )}
      </>)}
      {detail && <DetailPanel detail={detail} names={names} today={today} onClose={() => setDetail(null)} onFilter={({ key, value }) => { setF((c) => ({ ...c, [key]: value })); setDetail(null); }} />}
    </section>
  );
}
