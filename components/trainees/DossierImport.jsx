'use client';
import { useMemo, useState } from 'react';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { parseDossier, parseDossierByHeader, isHeadedDossier } from '@/lib/parseDossier';
import { executeDossierSync, makeMatcher, matchTrainerName, planDossierSync } from '@/lib/dossierSync';
import { readDossierXlsx } from '@/lib/readDossierXlsx';
import { EXIT_LABELS, RAG } from '@/lib/status';
import { useApp } from '../AppShell';
import { ErrorText, Modal, Spinner } from '../ui';


// Manager: import trainees (and their attendance) straight from the Dossier sheet
export default function DossierImport({ trainers, trainees, onClose, onDone }) {
  const { profile, now, settings } = useApp();
  const cutoff = settings?.dossier_from_date || null;
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
  const parsedFile = useMemo(() => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const head = (lines[0] || '').split('\t');
    let res;
    if (isHeadedDossier(head)) {
      res = parseDossierByHeader(head, lines.slice(1).map((l) => l.split('\t')), { today: now?.date });
      res = { ...res, rows: res.rows.map((r, i) => ({ line: i + 2, attendance: [], warnings: [], ...r })) };
    } else res = parseDossier(text, { colors });
    if (!cutoff) return { ...res, beforeCutoff: 0 };
    const startOf = (r) => (r.trainingStart && r.trainingStart > r.joining_date ? r.trainingStart : r.joining_date);
    const kept = res.rows.filter((r) => startOf(r) >= cutoff);
    return { ...res, rows: kept, beforeCutoff: res.rows.length - kept.length };
  }, [text, colors, now?.date, cutoff]);
  // Only trainees still in training (default): no handover / exit yet, or a TCD that is still ahead
  const [onlyTraining, setOnlyTraining] = useState(true);
  const today = now?.date || new Date().toISOString().slice(0, 10);
  const stillTraining = (r) => !r.exit_reason || (r.exit_reason === 'handover' && r.tcd_lwd && r.tcd_lwd >= today);
  const parsedAll = useMemo(() => (onlyTraining ? { ...parsedFile, rows: parsedFile.rows.filter(stillTraining) } : parsedFile),
    [parsedFile, onlyTraining, today]);
  const leftOut = parsedFile.rows.length - parsedAll.rows.length;
  // DOJ filter: only trainees who joined on the picked dates are shown and imported (none picked = all)
  const [dojPick, setDojPick] = useState(() => new Set());
  const dojList = useMemo(() => {
    const m = {};
    parsedAll.rows.forEach((r) => { m[r.joining_date] = (m[r.joining_date] || 0) + 1; });
    return Object.entries(m).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [parsedAll.rows]);
  const parsed = useMemo(() => (dojPick.size
    ? { ...parsedAll, rows: parsedAll.rows.filter((r) => dojPick.has(r.joining_date)) }
    : parsedAll), [parsedAll, dojPick]);
  const toggleDoj = (d) => setDojPick((cur) => { const n = new Set(cur); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    setFileNote('Reading the file…');
    try {
      const res = await readDossierXlsx(await f.arrayBuffer());
      setText(res.text);
      setColors(res.colors);
      setDojPick(new Set());
      setFileNote(res.headed
        ? `Read sheet “${res.sheetName}” from ${f.name} by its headings. Status comes from the Training Status column.`
        : `Read sheet “${res.sheetName}” from ${f.name}, including row colours.`);
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
      <textarea className="input mt-3 h-32 font-mono text-[11px]" value={text} onChange={(e) => { setText(e.target.value); setColors([]); setDojPick(new Set()); }} placeholder="Paste Dossier rows here" aria-label="Dossier rows" />

      {parsedFile.beforeCutoff > 0 && (
        <p className="mt-3 text-xs text-slate-500">{parsedFile.beforeCutoff} row{parsedFile.beforeCutoff === 1 ? '' : 's'} from before {fmtMedium(cutoff)} skipped (Settings → Dossier connection).</p>
      )}

      {parsedFile.rows.length > 0 && (
        <label className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-ink-800" checked={onlyTraining} onChange={(e) => { setOnlyTraining(e.target.checked); setDojPick(new Set()); }} />
          <span className="font-semibold text-slate-800">Only trainees still in training</span>
          <span className="text-xs text-slate-500">{onlyTraining ? `${leftOut} handed over / exited row${leftOut === 1 ? '' : 's'} left out` : 'all rows, including handed over / exited'}</span>
        </label>
      )}

      {dojList.length > 1 && (
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-bold text-ink-900">Filter by DOJ</span>
            <span className="text-xs text-slate-500">{dojPick.size ? `${parsed.rows.length} of ${parsedAll.rows.length} trainees selected` : `All ${parsedAll.rows.length} trainees · pick dates to import only those`}</span>
          </div>
          <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            <button type="button" onClick={() => setDojPick(new Set())}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${dojPick.size === 0 ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>All DOJs</button>
            {dojList.map(([d, n]) => (
              <button key={d} type="button" onClick={() => toggleDoj(d)} aria-pressed={dojPick.has(d)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${dojPick.has(d) ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                {fmtMedium(d)} <span className={dojPick.has(d) ? 'text-ink-200' : 'text-slate-400'}>({n})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {dojList.length > 0 && parsed.rows.length === 0 && <p className="mt-3 text-sm text-slate-500">No trainees for the picked DOJ.</p>}

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
