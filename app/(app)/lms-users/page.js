'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, Info, Search } from 'lucide-react';
import Link from 'next/link';
import { useApp } from '@/components/AppShell';
import { Empty, PageHeader, PageLoader, Spinner } from '@/components/ui';
import { sb } from '@/lib/supabase';
import { fetchAll, useTrainees, useTrainers } from '@/lib/hooks';
import { notJoining, scopeTo } from '@/lib/status';
import { buildContactIndex, buildRow, downloadLmsFile, duplicateProblems, findContact, problemsOf } from '@/lib/lmsExport';
import { LMS_MAX_ROWS } from '@/lib/lmsTemplate';

// Pick trainees → download them in the LMS "user import" format (Data + Instructions sheets).
// Name, E Code, email, phone, department and designation come from Contact Details; the trainer can fix anything before exporting.
const FIELDS = [
  ['code', 'E Code', 'w-[92px]'], ['email', 'Email', 'w-[210px]'], ['first', 'First Name', 'w-[110px]'], ['last', 'Last Name', 'w-[110px]'],
  ['phone', 'Phone', 'w-[110px]'], ['department', 'Department', 'w-[150px]'], ['designation', 'Designation', 'w-[130px]'],
];

export default function LmsUsersPage() {
  const { profile, now, showToast } = useApp();
  const isManager = profile.role === 'manager';
  const { trainees, batches, loading } = useTrainees({ trainerId: isManager ? null : profile.id });
  const { trainers } = useTrainers();
  const [contacts, setContacts] = useState(null);
  const [contactsError, setContactsError] = useState('');
  const [roles, setRoles] = useState('Employee');
  const [q, setQ] = useState('');
  const [batchId, setBatchId] = useState('all');
  const [trainerId, setTrainerId] = useState('all');
  const [show, setShow] = useState('all');           // all | ready | attention
  const [picked, setPicked] = useState({});          // trainee id → true
  const [edits, setEdits] = useState({});            // trainee id → { field: value } (only for this file, nothing is saved)
  const [withProblems, setWithProblems] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAll(() => sb().from('contacts').select('employee_code, name, official_email, personal_email, phone, department, designation, active').order('name'))
      .then(setContacts).catch((e) => { setContactsError(e.message || 'Contact Details could not be loaded'); setContacts([]); });
  }, []);

  const idx = useMemo(() => buildContactIndex(contacts || []), [contacts]);
  const pool = useMemo(() => scopeTo(trainees, trainerId).filter((t) => !notJoining(t)), [trainees, trainerId]);
  const base = useMemo(() => pool.map((t) => { const { contact, via } = findContact(t, idx); return { t, row: buildRow(t, contact, via) }; }), [pool, idx]);

  const all = base.map(({ t, row }) => ({ t, row: { ...row, ...(edits[t.id] || {}) } }));
  const chosen = all.filter(({ t }) => picked[t.id]);
  const dups = duplicateProblems(chosen.map((x) => x.row));
  const withIssues = all.map((x) => ({ ...x, issues: [...problemsOf(x.row, roles), ...(picked[x.t.id] ? dups.get(x.t.id) || [] : [])] }));

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

  if (loading || contacts === null) return <PageLoader />;
  const matched = base.filter((x) => x.row.matched).length;

  return (
    <div className="space-y-5">
      <PageHeader title="LMS user export" subtitle="Choose trainees and download them in the LMS import format, ready to upload to learn.petpooja.com."
        actions={<button className="btn-primary" onClick={download} disabled={busy || !toExport.length || toExport.length > LMS_MAX_ROWS}>
          {busy ? <Spinner size={16} /> : <Download size={16} />}Download LMS file ({toExport.length})</button>} />

      <div className="panel space-y-2 p-4 text-sm text-slate-600">
        <div className="flex items-start gap-2"><Info size={16} className="mt-0.5 shrink-0 text-ink-500" /><div>
          <b className="text-slate-800">How the file is filled.</b> Name, E Code, email, phone, department and designation come from <b>Contact Details</b> (matched by E Code, email or name).
          If someone is not there, their own trainee record is used, and anything still unknown is left <b>blank</b>. <b>Manages Departments</b> and <b>Joining Date</b> are always left blank.
        </div></div>
        <div className="pl-6"><b className="text-slate-800">Mandatory in the LMS:</b> Email (work email), First Name, Last Name and Roles. A row missing one is marked and is not exported unless you tick “include incomplete rows”.
          Without an E Code the LMS gives the person the temporary password <i>Firstname@123</i>.</div>
        {contactsError && <div className="pl-6 text-red-600">Contact Details could not be loaded: {contactsError}</div>}
        {!contactsError && contacts.length === 0 && <div className="pl-6 text-amber-700">Contact Details is empty, so only the trainee records are used. {isManager ? <>Refresh it on the <Link href="/contacts" className="font-semibold underline">Contact Details</Link> page.</> : 'Ask a manager to refresh Contact Details.'}</div>}
        {contacts.length > 0 && <div className="pl-6 text-xs text-slate-500">{matched} of {base.length} trainees found in Contact Details ({contacts.length} people in the list).</div>}
      </div>

      <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <label className="label" htmlFor="lu-q">Search</label>
          <Search size={16} className="absolute bottom-3 left-3.5 text-slate-400" />
          <input id="lu-q" className="input pl-10" placeholder="Name, email or E Code" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="lu-batch">Batch</label>
          <select id="lu-batch" className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="all">All batches</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </select>
        </div>
        {isManager && (
          <div>
            <label className="label" htmlFor="lu-trainer">Trainer</label>
            <select id="lu-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="all">All trainers</option>{trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="lu-show">Show</label>
          <select id="lu-show" className="input" value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="all">All</option><option value="ready">Ready only</option><option value="attention">Needs attention</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="lu-roles">Roles (name in the LMS)</label>
          <input id="lu-roles" className="input" value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="Employee" />
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
        {rows.length === 0 ? <Empty title="No trainees match">Change the filters above.</Empty> : (
          <div className="table-wrap max-h-[68vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10"><tr>
                <th><input type="checkbox" aria-label="Select all shown" checked={allShownPicked} onChange={(e) => pickMany(rows, e.target.checked)} /></th>
                <th>Trainee</th>{FIELDS.map(([k, label]) => <th key={k}>{label}</th>)}<th>Status</th>
              </tr></thead>
              <tbody>
                {rows.map(({ t, row, issues }) => (
                  <tr key={t.id} className={issues.length ? 'bg-amber-50/50' : ''}>
                    <td><input type="checkbox" aria-label={`Select ${t.name}`} checked={Boolean(picked[t.id])} onChange={(e) => pickMany([{ t }], e.target.checked)} /></td>
                    <td className="min-w-[150px]">
                      <div className="font-semibold text-slate-800">{t.name}</div>
                      <div className="text-xs text-slate-500">{t._batch?.code || 'No batch'}</div>
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
    </div>
  );
}
