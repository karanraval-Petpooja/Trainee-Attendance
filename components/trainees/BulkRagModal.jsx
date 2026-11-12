'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase';
import { RAG } from '@/lib/status';
import { useApp } from '../AppShell';
import { ErrorText, Modal, Spinner } from '../ui';
import { canEditRag } from './RagModal';

// Set the same RAG (and reason) for several trainees at once. Trainers: only their own trainees.
export default function BulkRagModal({ items, onClose, onDone }) {
  const { profile } = useApp();
  const allowed = items.filter((t) => canEditRag(t, profile) && !t.deleted_at);
  const skipped = items.length - allowed.length;
  const [rag, setRag] = useState('');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsReason = rag === 'amber' || rag === 'red';
  const reasonMissing = needsReason && remark.trim().length < 5;

  const save = async () => {
    if (!rag) { setError('Choose Green, Amber or Red.'); return; }
    if (reasonMissing) { setError(`Write the reason for ${rag === 'red' ? 'Red' : 'Amber'} (at least 5 characters).`); return; }
    setBusy(true); setError('');
    let ok = 0; const failed = [];
    for (const t of allowed) {
      const { error: e } = await sb().rpc('set_rag', { p_trainee: t.id, p_rag: rag, p_remark: remark.trim() });
      if (e) failed.push(`${t.name}: ${e.message}`); else ok += 1;
    }
    setBusy(false);
    if (failed.length) { setError(`${ok} updated. Not updated: ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? ` (+${failed.length - 3} more)` : ''}`); onDone(null); return; }
    onDone(`RAG set to ${RAG[rag].label} for ${ok} trainee${ok === 1 ? '' : 's'}.`);
    onClose();
  };

  return (
    <Modal title={`Set RAG for ${allowed.length} trainee${allowed.length === 1 ? '' : 's'}`} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy || !allowed.length || !rag || reasonMissing}>{busy && <Spinner size={16} />}Set RAG</button></>}>
      <ul className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
        {allowed.map((t) => <li key={t.id} className="py-0.5">{t.name}{t.rag ? <span className="text-slate-400"> · now {RAG[t.rag]?.label}</span> : ''}</li>)}
      </ul>
      {skipped > 0 && <p className="mt-2 text-xs text-amber-700">{skipped} selected trainee{skipped === 1 ? ' is' : 's are'} not yours, so not included.</p>}
      <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="RAG status">
        {Object.entries(RAG).map(([k, v]) => (
          <button key={k} type="button" role="radio" aria-checked={rag === k} onClick={() => { setRag(k); setError(''); }}
            className={`rounded-xl border-2 px-3 py-3 text-sm font-bold ${rag === k ? `${v.chip} border-current` : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${v.dot}`} />{v.label}
          </button>
        ))}
      </div>
      <label className="label mt-4" htmlFor="bulk-rag-remark">
        {needsReason ? <>Reason <span className="text-red-600">*</span> <span className="font-normal text-slate-500">(required for {rag === 'red' ? 'Red' : 'Amber'}, same for everyone selected)</span></> : 'Remarks (optional, same for everyone selected)'}
      </label>
      <textarea id="bulk-rag-remark" rows={3} className={`input ${reasonMissing ? 'border-red-300' : ''}`} value={remark} onChange={(e) => { setRemark(e.target.value); setError(''); }}
        placeholder={needsReason ? 'e.g. slow on billing, needs 2 more mock calls' : 'e.g. good progress'} />
      <p className="mt-2 text-xs text-slate-500">Replaces the current RAG and remark of each trainee listed.</p>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}
