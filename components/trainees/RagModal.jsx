'use client';
import { useState } from 'react';
import { sb } from '@/lib/supabase';
import { RAG } from '@/lib/status';
import { useApp } from '../AppShell';
import { ErrorText, Modal, Spinner } from '../ui';

// Can this user update the trainee's RAG? Manager, current trainer, or a trainer who had them before.
export const canEditRag = (t, profile) => profile.role === 'manager' || t.trainer_id === profile.id || Boolean(t._assign?.some((a) => a.trainer_id === profile.id));

export function RagChip({ rag, onClick }) {
  const m = RAG[rag];
  const cls = m ? m.chip : 'bg-slate-100 text-slate-500';
  const body = (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${m ? m.dot : 'bg-slate-300'}`} />{m ? m.label : 'Set RAG'}
    </span>
  );
  return onClick ? <button onClick={onClick} className="rounded-full hover:opacity-80" title="Update RAG">{body}</button> : body;
}

// Trainer / manager updates a trainee's RAG status and remark
export default function RagModal({ trainee, onClose, onSaved }) {
  const { profile, showToast } = useApp();
  const [rag, setRag] = useState(trainee.rag || '');
  const [remark, setRemark] = useState(trainee.rag_remark || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Amber / Red need a reason (at least 5 characters)
  const needsReason = rag === 'amber' || rag === 'red';
  const reasonMissing = needsReason && remark.trim().length < 5;
  const save = async () => {
    if (reasonMissing) { setError(`Write the reason for ${rag === 'red' ? 'Red' : 'Amber'} (at least 5 characters).`); return; }
    setSaving(true);
    setError('');
    const { error: err } = await sb().rpc('set_rag', { p_trainee: trainee.id, p_rag: rag || null, p_remark: remark });
    setSaving(false);
    if (err) { setError(err.message); return; }
    showToast('RAG updated.');
    onSaved?.({ rag: rag || null, rag_remark: remark.trim() || null });
    onClose();
  };
  return (
    <Modal title={`RAG · ${trainee.name}`} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || reasonMissing}>{saving && <Spinner size={16} />}Save</button></>}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="RAG status">
        {Object.entries(RAG).map(([k, m]) => (
          <button key={k} role="radio" aria-checked={rag === k} onClick={() => setRag(k)}
            className={`rounded-xl border-2 px-3 py-3 text-sm font-bold ${rag === k ? `${m.chip} border-current` : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${m.dot}`} />{m.label}
          </button>
        ))}
      </div>
      {rag && <button className="mt-2 text-xs font-semibold text-slate-500 hover:underline" onClick={() => setRag('')}>Clear RAG</button>}
      <label className="label mt-4" htmlFor="rag-remark">
        {needsReason ? <>Reason <span className="text-red-600">*</span> <span className="font-normal text-slate-500">(required for {rag === 'red' ? 'Red' : 'Amber'})</span></> : 'Remarks'}
      </label>
      <textarea id="rag-remark" rows={4} value={remark} onChange={(e) => { setRemark(e.target.value); setError(''); }}
        aria-required={needsReason} aria-invalid={reasonMissing}
        className={`input ${reasonMissing ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : ''}`}
        placeholder={needsReason ? 'Why Amber / Red? e.g. network issues, slow learner, needs 3 mock demo calls…' : 'Optional, e.g. good progress'} />
      {reasonMissing && <p className="mt-1 text-xs font-semibold text-red-600">A reason is required for {rag === 'red' ? 'Red' : 'Amber'}.</p>}
      <p className="mt-2 text-xs text-slate-500">Shown in the RAG Report only, not in the Monthly Sheet.</p>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}
