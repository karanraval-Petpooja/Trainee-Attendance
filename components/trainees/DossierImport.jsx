'use client';
import { useMemo, useState } from 'react';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { parseDossier } from '@/lib/parseDossier';
import { executeDossierSync, makeMatcher, matchTrainerName, planDossierSync } from '@/lib/dossierSync';
import { readDossierXlsx } from '@/lib/readDossierXlsx';
import { EXIT_LABELS, RAG } from '@/lib/status';
import { useApp } from '../AppShell';
import { ErrorText, Modal, Spinner } from '../ui';


// Manager: import trainees (and their attendance) straight from the Dossier sheet
export default function DossierImport({ trainers, trainees, onClose, onDone }) {
  const { profile } = useApp();
  const [text, setText] = useState('');
  const [defaultTrainer, setDefaultTrainer] = useState('');
  const [mapping, setMapping] = useState({});
  const [withAttendance, setWithAttendance] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [colors, setColors] = useState([]);
  const [fileNote, setFileNote] = useState('');
  const parsed = useMemo(() => parseDossier(text, { colors }), [text, colors]);
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    setFileNote('Reading the file…');
    try {
      const res = await readDossierXlsx(await f.arrayBuffer());
      setText(res.text);
      setColors(res.colors);
      setFileNote(`Read sheet “${res.sheetName}” from ${f.name}, including row colours.`);
    } catch (err) {
      setFileNote('');
      setError(err.message);
    }
  };

  // Detected trainer names → app trainer accounts (auto-match on first name)
  const detected = useMemo(() => [...new Set(parsed.rows.map((r) => r.trainerName).filter(Boolean))].sort(), [parsed.rows]);
  const autoMatch = (n) => matchTrainerName(n, trainers) || '';
  const trainerFor = (r) => (r.trainerName ? (mapping[r.trainerName] ?? autoMatch(r.trainerName)) : '') || defaultTrainer || null;
  const tName = (id) => trainers.find((t) => t.id === id)?.name || '—';

  const match = useMemo(() => makeMatcher(trainees), [trainees]);
  const attCount = parsed.rows.reduce((n, r) => n + r.attendance.length, 0);
  const updates = parsed.rows.filter(match).length;

  const run = async () => {
    setWorking(true);
    setError('');
    try {
      const switched = new Set(trainees.filter((t) => t._assign?.length).map((t) => t.id));
      const plan = planDossierSync(parsed.rows, trainees, (n) => trainerFor({ trainerName: n }), { switched });
      const res = await executeDossierSync(sb(), plan, { withAttendance, overwrite, createdBy: profile.id, onProgress: setProgress });
      if (res.errors.length) setError(`Saved with some problems: ${res.errors.slice(0, 3).join('; ')}${res.errors.length > 3 ? ` (+${res.errors.length - 3} more)` : ''}`);
      onDone(`Dossier imported: ${res.added} added, ${res.updated} updated${withAttendance ? `, ${res.days} attendance days saved` : ''}.`);
      if (!res.errors.length) onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
      setProgress('');
    }
  };

  return (
    <Modal title="Import from Dossier" onClose={onClose} wide
      footer={<>
        {progress && <span className="mr-auto self-center text-xs text-slate-500">{progress}</span>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={run} disabled={working || !parsed.rows.length}>{working && <Spinner size={16} />}Import {parsed.rows.length || ''} trainees</button>
      </>}>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>In the Dossier sheet, select whole rows (click the row numbers on the left), from the <b>Sr. No.</b> column to the <b>Remarks</b> column.</li>
        <li>Copy (Ctrl + C) and paste below (Ctrl + V). You can paste the same rows again later to update them.</li>
      </ol>
      <div className="mt-3 rounded-xl border border-dashed border-ink-300 bg-ink-50/50 p-3 text-sm">
        <label className="font-semibold text-ink-800" htmlFor="dossier-file">Or upload the Dossier Excel file (.xlsx)</label>
        <p className="text-xs text-slate-500">In Google Sheets: File → Download → Microsoft Excel. Row colours are read too (blue = DOJ revised, yellow = left, pink / cream = handed over, white = in training).</p>
        <input id="dossier-file" type="file" accept=".xlsx" onChange={onFile} className="mt-2 block text-xs" />
        {fileNote && <p className="mt-1 text-xs font-semibold text-emerald-700">{fileNote}</p>}
      </div>
      <textarea className="input mt-3 h-32 font-mono text-[11px]" value={text} onChange={(e) => { setText(e.target.value); setColors([]); }} placeholder="Paste Dossier rows here" aria-label="Dossier rows" />

      {parsed.rows.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-ink-50 px-3 py-1 font-semibold text-ink-800">{parsed.rows.length} rows</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{parsed.rows.length - updates} new</span>
            <span className="rounded-full bg-sky-50 px-3 py-1 font-semibold text-sky-800">{updates} already in the app (will be updated)</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">{attCount} attendance days</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {detected.map((n) => (
              <div key={n}>
                <label className="label text-xs" htmlFor={`map-${n}`}>Trainer “{n}” in the Dossier is</label>
                <select id={`map-${n}`} className="input py-2" value={mapping[n] ?? autoMatch(n)} onChange={(e) => setMapping({ ...mapping, [n]: e.target.value })}>
                  <option value="">Use the default below</option>
                  {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label className="label text-xs" htmlFor="map-default">Trainer for rows without a trainer name</label>
              <select id="map-default" className="input py-2" value={defaultTrainer} onChange={(e) => setDefaultTrainer(e.target.value)}>
                <option value="">Not assigned</option>
                {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          {detected.some((n) => !(mapping[n] ?? autoMatch(n))) && (
            <p className="mt-2 text-xs text-amber-700">Some trainer names have no matching login. Add them on the Trainers page first, or they get the default trainer.</p>
          )}

          <div className="mt-4 space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-ink-800" checked={withAttendance} onChange={(e) => setWithAttendance(e.target.checked)} />Import daily attendance (P, AB, HD, Holiday). Days are counted from the DOJ, skipping Sundays.</label>
            {withAttendance && <label className="ml-6 flex items-center gap-2 text-slate-600"><input type="checkbox" className="h-4 w-4 accent-ink-800" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />Overwrite attendance already marked in the app</label>}
          </div>

          <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-slate-200">
            <table className="tbl text-xs">
              <thead className="sticky top-0"><tr><th>E Code</th><th>Name</th><th>DOJ</th><th>TCD / LWD</th><th>Status</th><th>Trainer</th><th>Track</th><th>RAG</th><th>Attendance</th></tr></thead>
              <tbody>
                {parsed.rows.map((r) => (
                  <tr key={r.line} className={r.warnings.length ? 'bg-amber-50' : ''}>
                    <td>{r.employee_code || '—'}</td>
                    <td className="font-semibold">{r.name}{match(r) && <span className="ml-1 text-[10px] font-normal text-sky-700">update</span>}</td>
                    <td>{fmtMedium(r.joining_date)}{r.trainingStart && r.trainingStart > r.joining_date && <div className="text-[10px] text-ink-600">trains from {fmtMedium(r.trainingStart)}</div>}</td>
                    <td>{r.tcd_lwd ? fmtMedium(r.tcd_lwd) : '—'}</td>
                    <td>{EXIT_LABELS[r.exit_reason || '']}</td>
                    <td>{trainerFor(r) ? tName(trainerFor(r)) : <span className="text-slate-400">Not assigned</span>}</td>
                    <td>{r.track || '—'}</td>
                    <td>{r.rag ? RAG[r.rag].label : '—'}</td>
                    <td title={r.warnings.join('; ')}>{r.attendance.length ? `${r.attendance.length} days, to ${fmtMedium(r.lastDate)}` : '—'}{r.autoFilled ? <div className="text-[10px] text-emerald-700">+{r.autoFilled} completed days as Present</div> : null}{r.warnings.length > 0 && ' ⚠'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.some((r) => r.warnings.length) && <p className="mt-2 text-xs text-amber-700">⚠ rows: hover the attendance cell for details. Days after the TCD / LWD are ignored automatically.</p>}
        </>
      )}
      {parsed.errors.length > 0 && <div className="mt-3"><ErrorText>{parsed.errors.slice(0, 4).join(' · ')}</ErrorText></div>}
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}
