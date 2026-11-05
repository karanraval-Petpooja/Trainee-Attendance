'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, GraduationCap, Info, Search, X } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, Spinner } from '@/components/ui';
import { sb } from '@/lib/supabase';
import { fetchAll } from '@/lib/hooks';
import { scopeTo } from '@/lib/status';
import { buildContactIndex, buildRow, downloadLmsFile, duplicateProblems, findContact, lmsStage, problemsOf } from '@/lib/lmsExport';
import { LMS_MAX_ROWS } from '@/lib/lmsTemplate';

// "Export for LMS" button for the Trainees & Batches header
export function LmsExportButton({ onClick }) {
  return <button className="btn-secondary" onClick={onClick}><GraduationCap size={16} />Export for LMS</button>;
}

// Pick trainees → download them in the LMS "user import" format (Data + Instructions sheets).
// Only people in their FIRST training are listed: someone in reassessment is already in the LMS, and someone whose
// training is complete is not needed. Name, E Code, email, phone, department and designation come from Contact Details.
const FIELDS = [
  ['code', 'E Code', 'w-[92px]'], ['email', 'Email', 'w-[210px]'], ['first', 'First Name', 'w-[110px]'], ['last', 'Last Name', 'w-[110px]'],
  ['phone', 'Phone', 'w-[110px]'], ['department', 'Department', 'w-[150px]'], ['designation', 'Designation', 'w-[130px]'],
];
const STAGE_TAG = { reassessment: 'Reassessment · already in the LMS', completed: 'Training complete', upcoming: 'Not started yet' };

export default function LmsExport({ trainees, batches, trainers, onClose }) {
  const { profile, now, showToast } = useApp();
  const isManager = profile.role === 'manager';
  const [contacts, setContacts] = useState(null);
  const [contactsError, setContactsError] = useState('');
  const [roles, setRoles] = useState('Employee');
  const [q, setQ] = useState('');
  const [batchId, setBatchId] = useState('all');
  const [trainerId, setTrainerId] = useState('all');
  const [show, setShow] = useState('all');           // all | ready | attention
  const [upcoming, setUpcoming] = useState(false);   // also people who have not started yet
  const [others, setOthers] = useState(false);       // also reassessment / training-complete people
  const [picked, setPicked] = useState({});          // trainee id → true
  const [edits, setEdits] = useState({});            // trainee id → { field: value } (only for this file, nothing is saved)
  const [withProblems, setWithProblems] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    fetchAll(() => sb().from('contacts').select('employee_code, name, official_email, personal_email, phone, department, designation, active').order('name'))
      .then(setContacts).catch((e) => { setContactsError(e.message || 'Contact Details could not be loaded'); setContacts([]); });
  }, []);

  const idx = useMemo(() => buildContactIndex(contacts || []), [contacts]);
  const staged = useMemo(() => scopeTo(trainees, trainerId).map((t) => ({ t, stage: lmsStage(t, now.date) })).filter((x) => x.stage !== 'other'), [trainees, trainerId, now.date]);
  const count = (s) => staged.filter((x) => x.stage === s).length;
  const pool = staged.filter(({ stage }) => stage === 'new' || (upcoming && stage === 'upcoming') || (others && (stage === 'reassessment' || stage === 'completed')));
  const base = useMemo(() => pool.map(({ t, stage }) => { const { contact, via } = findContact(t, idx); return { t, stage, row: buildRow(t, contact, via) }; }), [pool, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = base.map((x) => ({ ...x, row: { ...x.row, ...(edits[x.t.id] || {}) } }));
  const chosen = all.filter(({ t }) => picked[t.id]);
  const dups = duplicateProblems(chosen.map((x) => x.row));
  const withIssues = all.map((x) => ({ ...x, issues: [...problemsOf(x.row, roles), ...(picked[x.t.id] ? dups.get(x.t.id) || [] : [])] }));
  const batchOptions = batches.filter((b) => pool.some(({ t }) => t.batch_id === b.id));

  const rows = withIssues
    .filter(({ t }) => batchId === 'all' || t.batch_id === batchId)
    .filter(({ issues }) => show === 'all' || (show === 'ready' ? issues.length === 0 : issues.length > 0))
    .filter(({ t, row }) => [t.name, row.email, row.code].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (a.t._batch?.code || '').localeCompare(b.t._batch?.code || '') || a.t.name.localeCompare(b.t.name));
  const selected = withIssues.filter(({ t }) => picked[t.id]);
  const ready = selected.filter((x) => x.issues.length === 0);
  const incomplete = selected.length - ready.length;
  const toExport = withProblems ? selected : ready;
  const set = (id, field, value) => setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [field]: value } }));
  const pickMany = (list, on) => setPicked((p) => { const n = { ...p }; list.forEach(({ t }) => { if (on) n[t.id] = true; else delete n[t.id]; }); return n; });
  const allShownPicked = rows.length > 0 && rows.every(({ t }) => picked[t.id]);

  const download = async () => {
    if (!toExport.length) return;
    setBusy(true);
    try {
      const code = batchId !== 'all' ? batches.find((b) => b.id === batchId)?.code : '';
      await downloadLmsFile(toExport.map((x) => x.row), roles, `LMS_users${code ? `_${code}` : ''}_${now.date}.xlsx`);
      showToast(`${toExport.length} user${toExport.length === 1 ? '' : 's'} exported in the LMS format.`);
    } catch (e) { showToast(e.message, 'error'); }
    setBusy(false);
  };

  const matched = base.filter((x) => x.row.matched).length;
  const skipped = [count('reassessment') && `${count('reassessment')} in reassessment (already in the LMS)`, count('completed') && `${count('completed')} with training complete`].filter(Boolean);

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-slate-50" role="dialog" aria-modal="true" aria-label="Export trainees for the LMS">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-8">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-bold text-ink-900">Export for LMS</h2>
          <p className="hidden text-xs text-slate-500 sm:block">Trainees in training, in the LMS import format, ready to upload to learn.petpooja.com.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn-primary" onClick={download} disabled={busy || !toExport.length || toExport.length > LMS_MAX_ROWS}>
            {busy ? <Spinner size={16} /> : <Download size={16} />}Download LMS file ({toExport.length})</button>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={20} /></button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 lg:px-8">
        {contacts === null ? <div className="py-16 text-center"><Spinner /></div> : (<>
          <div className="panel space-y-2 p-4 text-sm text-slate-600">
            <div className="flex items-start gap-2"><Info size={16} className="mt-0.5 shrink-0 text-ink-500" /><div>
              <b className="text-slate-800">Who is listed.</b> Only trainees in their <b>first training</b>. Someone in <b>reassessment</b> is already in the LMS, and someone whose <b>training is complete</b> is not needed, so they are left out.
              {skipped.length > 0 && <> Not listed now: {skipped.join(' · ')}.</>}
            </div></div>
            <div className="pl-6"><b className="text-slate-800">How the file is filled.</b> Name, E Code, email, phone, department and designation come from <b>Contact Details</b> (matched by E Code, email or name); if someone is not there, their trainee record is used and anything unknown stays <b>blank</b>. <b>Manages Departments</b> and <b>Joining Date</b> are always blank.</div>
            <div className="pl-6"><b className="text-slate-800">Mandatory in the LMS:</b> Email (work email), First Name, Last Name and Roles. A row missing one is marked and left out unless you tick “include incomplete rows”. Without an E Code the LMS gives the temporary password <i>Firstname@123</i>.</div>
            {contactsError && <div className="pl-6 text-red-600">Contact Details could not be loaded: {contactsError}</div>}
            {!contactsError && contacts.length === 0 && <div className="pl-6 text-amber-700">Contact Details is empty, so only the trainee records are used. {isManager ? <>Refresh it on the <Link href="/contacts" className="font-semibold underline">Contact Details</Link> page.</> : 'Ask a manager to refresh Contact Details.'}</div>}
            {contacts.length > 0 && base.length > 0 && <div className="pl-6 text-xs text-slate-500">{matched} of {base.length} listed trainees found in Contact Details ({contacts.length} people in the list).</div>}
          </div>

          <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <label className="label" htmlFor="lx-q">Search</label>
              <Search size={16} className="absolute bottom-3 left-3.5 text-slate-400" />
              <input id="lx-q" className="input pl-10" placeholder="Name, email or E Code" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="lx-batch">Batch</label>
              <select id="lx-batch" className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="all">All batches</option>{batchOptions.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
              </select>
            </div>
            {isManager && (
              <div>
                <label className="label" htmlFor="lx-trainer">Trainer</label>
                <select id="lx-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
                  <option value="all">All trainers</option>{trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="lx-show">Show</label>
              <select id="lx-show" className="input" value={show} onChange={(e) => setShow(e.target.value)}>
                <option value="all">All</option><option value="ready">Ready only</option><option value="attention">Needs attention</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="lx-roles">Roles (name in the LMS)</label>
              <input id="lx-roles" className="input" value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="Employee" />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 sm:col-span-2 lg:col-span-5">
              {count('upcoming') > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} />Also show people who have not started yet ({count('upcoming')})</label>}
              {(count('reassessment') > 0 || count('completed') > 0) && <label className="flex items-center gap-2"><input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />Also show reassessment / training-complete people ({count('reassessment') + count('completed')})</label>}
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-sm">
              <div className="text-slate-600"><b className="text-slate-800">{selected.length}</b> selected · <span className="text-emerald-700">{ready.length} ready</span>
                {incomplete > 0 && <> · <span className="font-semibold text-amber-700">{incomplete} need attention</span></>}</div>
              <div className="flex flex-wrap items-center gap-3">
                {incomplete > 0 && <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={withProblems} onChange={(e) => setWithProblems(e.target.checked)} />Include incomplete rows in the file</label>}
                <button className="btn-secondary btn-sm" onClick={() => pickMany(rows.filter((x) => x.issues.length === 0), true)}>Select all ready</button>
                {selected.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setPicked({})}>Clear</button>}
              </div>
            </div>
            {rows.length === 0 ? <Empty title={pool.length === 0 ? 'Nobody in training needs an LMS account' : 'No trainees match'}>{pool.length === 0 ? 'Trainees in reassessment or with training complete are not listed.' : 'Change the filters above.'}</Empty> : (
              <div className="table-wrap max-h-[60vh] overflow-auto">
                <table className="tbl">
                  <thead className="sticky top-0 z-10"><tr>
                    <th><input type="checkbox" aria-label="Select all shown" checked={allShownPicked} onChange={(e) => pickMany(rows, e.target.checked)} /></th>
                    <th>Trainee</th>{FIELDS.map(([k, label]) => <th key={k}>{label}</th>)}<th>Status</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(({ t, row, issues, stage }) => (
                      <tr key={t.id} className={issues.length ? 'bg-amber-50/50' : ''}>
                        <td><input type="checkbox" aria-label={`Select ${t.name}`} checked={Boolean(picked[t.id])} onChange={(e) => pickMany([{ t }], e.target.checked)} /></td>
                        <td className="min-w-[150px]">
                          <div className="font-semibold text-slate-800">{t.name}</div>
                          <div className="text-xs text-slate-500">{t._batch?.code || 'No batch'}</div>
                          {stage !== 'new' && <div className="text-[11px] font-semibold text-blue-700">{STAGE_TAG[stage]}</div>}
                          <div className={`text-[11px] ${row.matched ? 'text-emerald-700' : 'text-slate-400'}`}>{row.matched ? `Contact Details · by ${row.via}` : 'Not in Contact Details'}</div>
                        </td>
                        {FIELDS.map(([k, label, w]) => (
                          <td key={k}><input className={`input !px-2 !py-1.5 !text-xs ${w}`} aria-label={`${label} of ${t.name}`} value={row[k] ?? ''} onChange={(e) => set(t.id, k, e.target.value)} /></td>
                        ))}
                        <td className="min-w-[130px]">{issues.length === 0
                          ? <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">✓ Ready</span>
                          : <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800" title={issues.join(', ')}>⚠ {issues.join(', ')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">Changes you type here are used for this file only; they are not saved to the trainee or to Contact Details.</p>
        </>)}
      </div>
    </div>
  );
}
