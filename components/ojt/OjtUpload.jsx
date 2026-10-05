'use client';
import { useMemo, useState } from 'react';
import { FileUp } from 'lucide-react';
import { sb } from '@/lib/supabase';
import { fmtDuration, parseMeetFileName, readOjtWorkbook, suggestSessionMinutes, summarizeOjt } from '@/lib/ojt';
import { useApp } from '../AppShell';
import { ErrorText, Modal, Spinner } from '../ui';

// Upload the OJT attendance + score workbook and save it as a session
export default function OjtUpload({ trainers, onClose, onSaved }) {
  const { profile, now } = useApp();
  const isManager = profile.role === 'manager';
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(now.date);
  const [trainerId, setTrainerId] = useState(isManager ? '' : profile.id);
  const [passPercent, setPassPercent] = useState(70);
  const [type, setType] = useState('OJT');
  const [withScores, setWithScores] = useState(false);
  // Session taken by the trainer, and the minimum a trainee must attend to be Present
  const [sesH, setSesH] = useState(2);
  const [sesM, setSesM] = useState(0);
  const [minH, setMinH] = useState(1);
  const [minM, setMinM] = useState(0);
  const [minTouched, setMinTouched] = useState(false);
  const [sesTouched, setSesTouched] = useState(false);
  const [autoNote, setAutoNote] = useState('');
  const sessionMinutes = (Number(sesH) || 0) * 60 + (Number(sesM) || 0);
  const requiredMinutes = (Number(minH) || 0) * 60 + (Number(minM) || 0);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const sum = useMemo(() => (parsed ? summarizeOjt(parsed.participants) : null), [parsed]);

  const read = async (f, opts = {}) => {
    setReading(true); setError('');
    try {
      const req = opts.required ?? requiredMinutes;
      const res = await readOjtWorkbook(await f.arrayBuffer(), { passPercent: Number(opts.pass ?? passPercent), requiredMinutes: req > 0 ? req : null, includeScores: opts.scores ?? withScores });
      setParsed(res);
      if (opts.first) {
        // First read of a file: fill name, date and session length from the Meet file name + join/exit times
        const meta = parseMeetFileName(f.name);
        setTitle(meta.title || f.name.replace(/\.xlsx$/i, ''));
        if (meta.date) setDate(meta.date);
        const length = suggestSessionMinutes(res.span, meta.time);
        if (length && !sesTouched) {
          const half = Math.round(length / 2);
          setSesH(Math.floor(length / 60)); setSesM(length % 60);
          if (!minTouched) {
            setMinH(Math.floor(half / 60)); setMinM(half % 60);
            const again = await readOjtWorkbook(await f.arrayBuffer(), { passPercent: Number(passPercent), requiredMinutes: half, includeScores: withScores });
            setParsed(again);
          }
          setAutoNote(`Filled from the file: ${meta.date ? `date ${meta.date}, ` : ''}session about ${fmtDuration(length)} (${meta.time ? `started ${meta.time}` : 'first join'} → when most people left). Change anything if needed.`);
        }
      }
    } catch (e) { setParsed(null); setError(e.message); }
    setReading(false);
  };
  const onFile = (e) => { const f = e.target.files?.[0]; if (f) { setFile(f); read(f, { first: true }); } };
  // Session length changed: minimum follows at half the session until edited by hand
  const setSession = (h, m) => {
    setSesTouched(true); setSesH(h); setSesM(m);
    if (!minTouched) {
      const half = Math.round(((Number(h) || 0) * 60 + (Number(m) || 0)) / 2);
      setMinH(Math.floor(half / 60)); setMinM(half % 60);
      if (file) read(file, { required: half });
    }
  };
  const setMinimum = (h, m) => {
    setMinTouched(true); setMinH(h); setMinM(m);
    if (file) read(file, { required: (Number(h) || 0) * 60 + (Number(m) || 0) });
  };

  const save = async () => {
    if (!parsed?.participants.length) { setError('Upload a file first.'); return; }
    if (!title.trim() || !date) { setError('Enter a session name and date.'); return; }
    if (requiredMinutes > sessionMinutes && sessionMinutes > 0) { setError('The minimum time cannot be longer than the session.'); return; }
    setSaving(true); setError('');
    const { data: s, error: e1 } = await sb().from('ojt_sessions').insert({
      title: title.trim(), session_date: date, trainer_id: trainerId || null, pass_percent: Number(passPercent) || 70,
      source_file: file?.name || null, created_by: profile.id, session_type: type,
      session_minutes: sessionMinutes || null, min_present_minutes: requiredMinutes || null,
    }).select().single();
    if (e1) { setSaving(false); setError(e1.message); return; }
    const rows = parsed.participants.map(({ belowMinimum, ...p }) => ({ ...p, session_id: s.id }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e2 } = await sb().from('ojt_participants').insert(rows.slice(i, i + 500));
      if (e2) { await sb().from('ojt_sessions').delete().eq('id', s.id); setSaving(false); setError(e2.message); return; }
    }
    setSaving(false);
    onSaved(s.id);
    onClose();
  };

  return (
    <Modal title="Upload OJT / Upskill / PIP / Refresher sheet" onClose={onClose} wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !parsed}>{saving && <Spinner size={16} />}Save session</button></>}>
      <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50/50 p-4 text-sm">
        <label className="font-semibold text-ink-800" htmlFor="ojt-file"><FileUp size={16} className="mr-1 inline" />Choose the Excel file (.xlsx)</label>
        <p className="mt-1 text-xs text-slate-500">The Google Meet attendance file (First name, Last name, Email, Duration, Time joined, Time exited). First and last names are joined, people who rejoined are merged, and the name, date and session length are filled in from the file.</p>
        <input id="ojt-file" type="file" accept=".xlsx" onChange={onFile} className="mt-2 block text-xs" />
        {reading && <p className="mt-2 text-xs text-slate-500"><Spinner size={12} /> Reading…</p>}
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 p-4">
        <div className="text-sm font-bold text-ink-900">Session time</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ses-h">Session taken by the trainer</label>
            <div className="flex items-center gap-2">
              <input id="ses-h" type="number" min={0} max={12} className="input w-20" value={sesH} onChange={(e) => setSession(e.target.value, sesM)} aria-label="Session hours" /><span className="text-sm text-slate-500">hr</span>
              <input type="number" min={0} max={59} className="input w-20" value={sesM} onChange={(e) => setSession(sesH, e.target.value)} aria-label="Session minutes" /><span className="text-sm text-slate-500">min</span>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="min-h">Trainee must attend at least</label>
            <div className="flex items-center gap-2">
              <input id="min-h" type="number" min={0} max={12} className="input w-20" value={minH} onChange={(e) => setMinimum(e.target.value, minM)} aria-label="Minimum hours" /><span className="text-sm text-slate-500">hr</span>
              <input type="number" min={0} max={59} className="input w-20" value={minM} onChange={(e) => setMinimum(minH, e.target.value)} aria-label="Minimum minutes" /><span className="text-sm text-slate-500">min</span>
            </div>
          </div>
        </div>
        {autoNote && <p className="mt-2 text-xs text-emerald-700">{autoNote}</p>}
        <p className="mt-2 text-xs text-red-700">Anyone below {Math.floor(requiredMinutes / 60)} hr {requiredMinutes % 60} min, even by one minute, is marked <b>Absent</b> (in red). This replaces the P / A column in the sheet.</p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="ojt-type">Type</label>
          <select id="ojt-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="OJT">OJT</option><option value="Upskill">Upskill</option><option value="PIP">PIP</option><option value="Refresher">Refresher</option>
          </select>
        </div>
        <div><label className="label" htmlFor="ojt-title">Session name</label><input id="ojt-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. OJT – POS Billing" /></div>
        <div><label className="label" htmlFor="ojt-date">Session date</label><input id="ojt-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {isManager && (
          <div>
            <label className="label" htmlFor="ojt-trainer">Trainer</label>
            <select id="ojt-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="">Not set</option>
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <div className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input type="checkbox" className="h-4 w-4 accent-ink-800" checked={withScores}
              onChange={(e) => { setWithScores(e.target.checked); if (file) read(file, { scores: e.target.checked }); }} />
            Include assessment scores (Score tab) — optional
          </label>
          {withScores && (
            <div className="mt-3 max-w-xs">
              <label className="label" htmlFor="ojt-pass">Pass mark (%) — used only when the Pass/ Fail column is empty</label>
              <input id="ojt-pass" type="number" min={1} max={100} className="input" value={passPercent} onChange={(e) => { setPassPercent(e.target.value); if (file) read(file, { pass: e.target.value }); }} />
            </div>
          )}
        </div>
      </div>

      {parsed && sum && (
        <>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-ink-50 px-3 py-1 font-semibold text-ink-800">{sum.participants} participants</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{sum.present} present</span>
            <span className="rounded-full bg-red-100 px-3 py-1 font-semibold text-red-800">{sum.absent} absent (below {Math.floor(requiredMinutes / 60)} hr {requiredMinutes % 60} min)</span>
            {withScores && <>
              <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{sum.pass} pass</span>
              <span className="rounded-full bg-red-50 px-3 py-1 font-semibold text-red-800">{sum.fail} fail</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800">{sum.assessAbsent} absent in assessment</span>
            </>}
          </div>
          {parsed.warnings.length > 0 && (
            <div className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              <b>Notes from the file:</b>
              <ul className="mt-1 list-disc pl-5">{parsed.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-200">
            <table className="tbl text-xs">
              <thead className="sticky top-0"><tr><th>Name</th><th>Duration</th><th>Attendance</th>{withScores && <><th>Score</th><th>Result</th></>}</tr></thead>
              <tbody>{parsed.participants.map((p) => (
                <tr key={p.email || p.full_name} className={p.attendance === 'A' ? 'bg-red-50 text-red-700' : ''}><td className={p.attendance === 'A' ? 'font-semibold' : ''}>{p.full_name}</td><td>{fmtDuration(p.duration_minutes) || 'did not join'}</td><td>{p.attendance === 'A' ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">Absent</span> : p.attendance || '—'}</td>{withScores && <><td>{p.score ?? (p.result === 'Absent' ? 'Absent' : '—')}{p.total ? ` / ${p.total}` : ''}</td><td>{p.result || '—'}</td></>}</tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}
