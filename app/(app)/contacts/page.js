'use client';
import { useEffect, useMemo, useState } from 'react';
import { FileUp, RefreshCw, Search } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, ErrorText, Modal, PageHeader, PageLoader, Spinner } from '@/components/ui';
import { authFetch, sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { parseContacts, saveContacts } from '@/lib/contacts';
import { pasteToRows, readContactsFile } from '@/lib/readContactsFile';

async function loadContacts() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb().from('contacts').select('*').order('name').range(from, from + 999);
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

function UploadContacts({ onClose, onSaved }) {
  const { showToast } = useApp();
  const [src, setSrc] = useState(null); // { header, rows, sheetName }
  const [paste, setPaste] = useState('');
  const [fullList, setFullList] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => {
    try {
      const s = src || (paste.trim() ? pasteToRows(paste) : null);
      return s ? { ...parseContacts(s.header, s.rows), sheetName: s.sheetName } : null;
    } catch (e) { return { contacts: [], errors: [e.message] }; }
  }, [src, paste]);
  const depts = useMemo(() => {
    const m = {};
    (parsed?.contacts || []).forEach((c) => { const d = c.department || '—'; m[d] = (m[d] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [parsed]);
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    try { setSrc(await readContactsFile(f)); } catch (err) { setError(err.message); }
  };
  const save = async () => {
    if (!parsed?.contacts.length) return;
    setSaving(true); setError('');
    try {
      const runId = `upload-${Date.now()}`;
      const res = await saveContacts(sb(), parsed.contacts, { runId });
      let off = 0;
      if (fullList) {
        const { data } = await sb().from('contacts').update({ active: false }).or(`last_seen_run.neq.${runId},last_seen_run.is.null`).eq('active', true).select('id');
        off = data?.length || 0;
      }
      showToast(`Contacts saved: ${res.added} added, ${res.updated} updated${off ? `, ${off} marked inactive` : ''}.`);
      onSaved(); onClose();
    } catch (e) { setError(e.message); }
    setSaving(false);
  };
  return (
    <Modal title="Upload Contact Details" onClose={onClose} wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !parsed?.contacts.length}>{saving && <Spinner size={16} />}Save {parsed?.contacts.length || ''} contacts</button></>}>
      <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50/50 p-4 text-sm">
        <label className="font-semibold text-ink-800" htmlFor="ct-file"><FileUp size={16} className="mr-1 inline" />Choose the Contact Details file (.xlsx or .csv)</label>
        <p className="mt-1 text-xs text-slate-500">Columns are found by their headings: <b>Name</b> and <b>Department</b> are needed; E Code, Official Email, Personal Email, Mobile, Designation, Location, Reporting Manager and Status are used when present.</p>
        <input id="ct-file" type="file" accept=".xlsx,.csv" onChange={onFile} className="mt-2 block text-xs" />
      </div>
      {!src && (
        <textarea className="input mt-3 h-24 font-mono text-xs" placeholder="…or paste the rows here, including the heading row" value={paste} onChange={(e) => setPaste(e.target.value)} />
      )}
      {parsed?.errors?.length > 0 && <div className="mt-3"><ErrorText>{parsed.errors.join(' ')}</ErrorText></div>}
      {parsed?.contacts.length > 0 && (
        <>
          <p className="mt-3 text-sm"><b>{parsed.contacts.length}</b> people{parsed.sheetName ? <> from <b>{parsed.sheetName}</b></> : null} · {parsed.contacts.filter((c) => !c.active).length} inactive by Status</p>
          <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {depts.map(([d, n]) => <span key={d} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{d} ({n})</span>)}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-ink-800" checked={fullList} onChange={(e) => setFullList(e.target.checked)} />
            This is the full list: mark people not in it as inactive
          </label>
        </>
      )}
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

export default function ContactsPage() {
  const { showToast } = useApp();
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [upload, setUpload] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const reload = async () => setList(await loadContacts());
  useEffect(() => { reload(); }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await authFetch('/api/contacts-run', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not refresh');
      showToast(j.running ? j.message : `Contact Details: ${j.rows} rows, ${j.added} added, ${j.updated} updated${j.deactivated ? `, ${j.deactivated} no longer in the sheet` : ''}.`);
      await reload();
    } catch (e) { showToast(e.message, 'error'); }
    setRefreshing(false);
  };

  if (!list) return <PageLoader />;
  const active = list.filter((c) => c.active);
  const depts = Object.entries(active.reduce((m, c) => { const d = c.department || '—'; m[d] = (m[d] || 0) + 1; return m; }, {})).sort((a, b) => a[0].localeCompare(b[0]));
  const shown = list.filter((c) => (showInactive || c.active) && (dept === 'all' || (c.department || '—') === dept)
    && [c.name, c.employee_code, c.official_email, c.personal_email, c.phone, c.designation, c.location].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())));
  const lastUpdate = list.reduce((m, c) => (c.updated_at > m ? c.updated_at : m), '');

  return (
    <div>
      <PageHeader title="Contact Details" subtitle={`${active.length} active people in ${depts.length} departments${lastUpdate ? ` · updated ${fmtMedium(lastUpdate.slice(0, 10))}` : ''}. Used to mark "Not attended" in sessions.`}
        actions={<>
          <button className="btn-secondary" onClick={refresh} disabled={refreshing}>{refreshing ? <Spinner size={16} /> : <RefreshCw size={16} />}Refresh from Google sheet</button>
          <button className="btn-primary" onClick={() => setUpload(true)}><FileUp size={16} />Upload file</button>
        </>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="Search name, E Code, email, mobile, designation" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" />
        </div>
        <select className="input sm:w-64" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="all">All departments</option>
          {depts.map(([d, n]) => <option key={d} value={d}>{d} ({n})</option>)}
        </select>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm"><input type="checkbox" className="h-4 w-4 accent-ink-800" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
      </div>
      {list.length === 0 ? (
        <Empty title="No contacts yet">Upload the Contact Details file, or fill CONTACTS in the Google script and click “Refresh from Google sheet”.</Empty>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Name</th><th>E Code</th><th>Department</th><th>Designation</th><th>Email</th><th>Mobile</th><th>Location</th></tr></thead>
            <tbody>
              {shown.slice(0, 500).map((c) => (
                <tr key={c.id} className={c.active ? '' : 'text-slate-400'}>
                  <td className="font-semibold">{c.name}{!c.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">inactive</span>}</td>
                  <td>{c.employee_code || '—'}</td><td>{c.department || '—'}</td><td>{c.designation || '—'}</td>
                  <td className="text-xs">{c.official_email || c.personal_email || '—'}</td><td>{c.phone || '—'}</td><td>{c.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 500 && <p className="p-3 text-xs text-slate-500">Showing 500 of {shown.length}. Search or pick a department to narrow it down.</p>}
        </div>
      )}
      {upload && <UploadContacts onClose={() => setUpload(false)} onSaved={reload} />}
    </div>
  );
}
