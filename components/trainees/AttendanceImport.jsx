'use client';
import { useMemo, useState } from 'react';
import { CalendarCheck, FileUp } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { ErrorText, Modal, Spinner } from '@/components/ui';
import { sb } from '@/lib/supabase';
import { fetchAll } from '@/lib/hooks';
import { fmtMedium } from '@/lib/dates';
import { makeMatcher } from '@/lib/dossierSync';
import { planAttendance, readAttendanceWorkbook } from '@/lib/dossierAttendance';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (k) => `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;

// Dossier upload that updates ONLY attendance (Day 1 … Day 40), and only before the cut-off date.
export default function AttendanceImport({ trainees, onClose, onDone }) {
  const { now } = useApp();
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [existing, setExisting] = useState({});
  const [cutoff, setCutoff] = useState(`${now.date.slice(0, 7)}-01`); // default: keep this month exactly as in the app
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showNames, setShowNames] = useState(false);
  const match = useMemo(() => makeMatcher(trainees), [trainees]);

  const pick = async (f) => {
    setError(''); setFile(f); setRows(null); setBusy('Reading the file…');
    try {
      const { rows: rs } = await readAttendanceWorkbook(await f.arrayBuffer());
      // attendance already in the app for the trainees in this file
      const ids = [...new Set(rs.map((r) => match(r)?.id).filter(Boolean))];
      setBusy('Checking attendance already in the app…');
      const ex = {};
      for (let i = 0; i < ids.length; i += 100) {
        const part = await fetchAll(() => sb().from('attendance').select('trainee_id, attendance_date, status').in('trainee_id', ids.slice(i, i + 100)));
        for (const a of part) (ex[a.trainee_id] = ex[a.trainee_id] || {})[a.attendance_date] = a.status;
      }
      setExisting(ex); setRows(rs);
    } catch (e) { setError(e.message || 'Could not read this file'); }
    setBusy('');
  };

  const plan = useMemo(() => (rows ? planAttendance(rows, match, existing, cutoff) : null), [rows, match, existing, cutoff]);
  const toSend = plan ? [...plan.add, ...(replace ? plan.differ : [])].map(({ t, d, s }) => ({ t, d, s })) : [];

  const run = async () => {
    setBusy('Saving attendance…'); setError('');
    const total = { added: 0, replaced: 0, kept: 0, skipped_after_cutoff: 0 };
    try {
      for (let i = 0; i < toSend.length; i += 500) {
        const { data, error: e } = await sb().rpc('import_dossier_attendance', { p_rows: toSend.slice(i, i + 500), p_before: cutoff, p_replace: replace });
        if (e) throw e;
        for (const k of Object.keys(total)) total[k] += data?.[k] || 0;
        setBusy(`Saving attendance… ${Math.min(i + 500, toSend.length)} of ${toSend.length}`);
      }
      onDone(`Attendance imported: ${total.added} days added${total.replaced ? `, ${total.replaced} replaced` : ''}. Nothing from ${fmtMedium(cutoff)} on was changed.`);
      onClose();
    } catch (e) { setError(e.message || 'Import failed'); }
    setBusy('');
  };

  return (
    <Modal title="Import attendance from the Dossier" onClose={onClose} wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={run} disabled={!plan || !toSend.length || !!busy}>{busy ? <Spinner size={16} /> : <CalendarCheck size={16} />}Import {toSend.length ? `${toSend.length} days` : ''}</button></>}>
      <p className="text-sm text-slate-600">Reads the <b>Day 1 … Day 40</b> columns (P, AB, HD, Holiday) for trainees already in the app. <b>Only attendance</b> is updated: names, statuses, trainers, batches and RAG are not changed, and no trainees are added.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 p-4 hover:border-ink-400">
          <FileUp size={20} className="text-ink-700" />
          <span className="text-sm"><b>{file ? file.name : 'Choose the Dossier file (.xlsx)'}</b><br /><span className="text-xs text-slate-500">The tab with Name, DOJ and Day 1 is used</span></span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        <div className="rounded-xl border border-slate-200 p-4">
          <label className="label" htmlFor="att-cut">Keep everything from this date exactly as in the app</label>
          <input id="att-cut" type="date" className="input" value={cutoff} max={now.date} onChange={(e) => setCutoff(e.target.value || cutoff)} />
          <p className="mt-1 text-xs text-slate-500">Attendance on or after {fmtMedium(cutoff)} is never touched.</p>
        </div>
      </div>
      {busy && !plan && <p className="mt-4 flex items-center gap-2 text-sm text-slate-600"><Spinner size={14} />{busy}</p>}
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
      {plan && (
        <div className="mt-2 space-y-3 text-sm">
          <div className="rounded-xl bg-emerald-50 p-4">
            <div className="font-bold text-emerald-900">{plan.add.length} days will be added for {plan.matched} trainees</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.keys(plan.byMonth).sort().map((k) => <span key={k} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-emerald-800">{monthName(k)}: {plan.byMonth[k]}</span>)}
            </div>
            <p className="mt-2 text-xs text-emerald-800">Only days that are empty in the app. {plan.same} day{plan.same === 1 ? ' is' : 's are'} already the same in the app.</p>
          </div>
          {plan.differ.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="font-semibold text-amber-900">{plan.differ.length} day{plan.differ.length === 1 ? '' : 's'} marked differently in the app → kept as in the app</div>
              <label className="mt-2 flex items-center gap-2 text-xs text-amber-900"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Replace them with the Dossier (only before {fmtMedium(cutoff)})</label>
            </div>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            <li><b>{plan.afterCutoff}</b> marks on or after {fmtMedium(cutoff)} ignored: that period stays exactly as in the app.</li>
            <li><b>{plan.weekOffs}</b> “Week Off” cells skipped: the app works out week offs itself.</li>
            {plan.beforeDoj > 0 && <li><b>{plan.beforeDoj}</b> marks from an older stint (before the DOJ in the app) skipped.</li>}
            {Object.keys(plan.unknown).length > 0 && <li>Not understood (skipped): {Object.entries(plan.unknown).map(([k, v]) => `“${k}” ×${v}`).join(', ')}.</li>}
            {plan.unmatched.length > 0 && (
              <li><b>{plan.unmatched.length}</b> trainee{plan.unmatched.length === 1 ? '' : 's'} in the file are not in the app (skipped). <button type="button" className="font-semibold text-ink-700 hover:underline" onClick={() => setShowNames(!showNames)}>{showNames ? 'Hide' : 'Show'} names</button>
                {showNames && <div className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-2">{plan.unmatched.join(' · ')}</div>}</li>
            )}
          </ul>
        </div>
      )}
      {busy && plan && <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Spinner size={14} />{busy}</p>}
    </Modal>
  );
}
