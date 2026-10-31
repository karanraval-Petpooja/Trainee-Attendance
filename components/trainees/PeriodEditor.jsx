'use client';
import { useState } from 'react';
import { Plus, Trash2, Wrench } from 'lucide-react';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { EXIT_LABELS, periodsOf } from '@/lib/status';
import { ErrorText, Spinner } from '@/components/ui';

// Manager only: correct a trainee's training periods after a mistake (e.g. Handover marked instead of
// Not Certified, or a wrong "bring back"). Each period: start, last day, and how it ended.
// The trainee's current status and TCD / LWD follow the LAST period automatically. Attendance is not touched.
const ENDINGS = [['', 'Still in training (no end)'], ['retraining', 'Failed → Retraining'], ...Object.entries(EXIT_LABELS).filter(([k]) => k)];

export default function PeriodEditor({ trainee, onSaved }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(() => periodsOf(trainee).map((p) => ({ start: p.start || '', end: p.end || '', reason: p.reason || '' })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const check = () => {
    if (!rows.length) return 'Keep at least one period.';
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]; const last = i === rows.length - 1;
      if (!r.start) return `Period ${i + 1}: choose the start date.`;
      if (r.end && r.end < r.start) return `Period ${i + 1}: the last day is before the start.`;
      if (!last && (!r.end || !r.reason)) return `Period ${i + 1}: an earlier period needs a last day and how it ended.`;
      if (!last && r.reason !== 'retraining') return `Period ${i + 1}: only “Failed → Retraining” can be followed by another period. Remove the later period instead.`;
      if (i > 0 && r.start <= rows[i - 1].end) return `Period ${i + 1}: must start after ${fmtMedium(rows[i - 1].end)}.`;
      if (last && r.reason === 'handover' && !r.end) return 'A handover needs the TCD (last day).';
      if (last && r.reason === 'retraining') return 'The last period cannot end in “Retraining”: add the retraining period, or choose Not Certified.';
      if (last && !r.reason && r.end) return 'Choose how the last period ended (or clear its last day).';
    }
    return '';
  };
  const save = async () => {
    const msg = check(); if (msg) { setError(msg); return; }
    setBusy(true); setError('');
    const periods = rows.map((r) => ({ start: r.start, end: r.end || null, reason: r.reason || null }));
    const { error: e } = await sb().from('trainees').update({ training_periods: periods, status: 'active' }).eq('id', trainee.id);
    setBusy(false);
    if (e) { setError(e.message); return; }
    onSaved(`Training history of ${trainee.name} corrected.`);
  };
  if (!open) {
    return (
      <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => setOpen(true)}>
        <Wrench size={14} />Fix training history (correct a mistake)
      </button>
    );
  }
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="text-sm font-bold text-ink-900">Fix training history</div>
      <p className="mt-0.5 text-xs text-slate-600">Correct each period, or remove one created by mistake. The current status and TCD / LWD follow the last period. Attendance already marked is not changed.</p>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid items-end gap-2 rounded-lg bg-white p-2 sm:grid-cols-[auto_1fr_1fr_1.4fr_auto]">
            <span className="self-center rounded-full bg-ink-50 px-2 py-0.5 text-xs font-semibold text-ink-700">Period {i + 1}</span>
            <div><label className="label text-xs" htmlFor={`pe-s-${i}`}>Start</label><input id={`pe-s-${i}`} type="date" className="input py-1.5" value={r.start} onChange={(e) => set(i, 'start', e.target.value)} /></div>
            <div><label className="label text-xs" htmlFor={`pe-e-${i}`}>Last day</label><input id={`pe-e-${i}`} type="date" className="input py-1.5" value={r.end} onChange={(e) => set(i, 'end', e.target.value)} /></div>
            <div><label className="label text-xs" htmlFor={`pe-r-${i}`}>Ended as</label>
              <select id={`pe-r-${i}`} className="input py-1.5" value={r.reason} onChange={(e) => set(i, 'reason', e.target.value)}>
                {ENDINGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <button type="button" className="btn-ghost btn-sm text-red-600" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove period ${i + 1}`}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 text-xs font-semibold text-ink-700 hover:underline" onClick={() => setRows([...rows, { start: '', end: '', reason: '' }])}><Plus size={12} className="inline" /> Add a period</button>
      <div className="mt-2"><ErrorText>{error}</ErrorText></div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={() => { setOpen(false); setError(''); setRows(periodsOf(trainee).map((p) => ({ start: p.start || '', end: p.end || '', reason: p.reason || '' }))); }}>Cancel</button>
        <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>{busy && <Spinner size={14} />}Save history</button>
      </div>
    </div>
  );
}
