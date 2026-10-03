'use client';
import { useMemo, useState } from 'react';
import { FileSpreadsheet, Search } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import RagModal, { canEditRag, RagChip } from '@/components/trainees/RagModal';
import { Empty, PageHeader, PageLoader, StatCard } from '@/components/ui';
import { useTrainees, useTrainers } from '@/lib/hooks';
import { fmtDateTime, fmtMedium } from '@/lib/dates';
import { EXIT_LABELS, RAG, scopeTo, traineeActiveOn } from '@/lib/status';
import { downloadTableXlsx } from '@/lib/monthlySheet';

// Separate report for RAG status and trainer remarks (not part of the Monthly Sheet)
export default function RagReportPage() {
  const { profile, now, tz } = useApp();
  const isManager = profile.role === 'manager';
  const { trainees, batches, loading, reload } = useTrainees({ includeInactive: true, trainerId: isManager ? null : profile.id });
  const { trainers } = useTrainers();
  const names = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);
  const [q, setQ] = useState('');
  const [rag, setRag] = useState('all');
  const [trainerId, setTrainerId] = useState('all');
  const [batchId, setBatchId] = useState('all');
  const [track, setTrack] = useState('all');
  const [stage, setStage] = useState('all');
  const [editing, setEditing] = useState(null);


  const stageOf = (t) => (traineeActiveOn(t, now.date) ? 'training' : t.exit_reason && t.exit_reason !== 'handover' ? 'exited' : 'done');
  const tracks = useMemo(() => [...new Set(trainees.map((t) => t.track).filter(Boolean))].sort(), [trainees]);
  const pool = useMemo(() => scopeTo(trainees, trainerId), [trainees, trainerId]);
  const rows = pool.filter((t) => (rag === 'all' || (rag === 'none' ? !t.rag : t.rag === rag))
    && (batchId === 'all' || t.batch_id === batchId)
    && (track === 'all' || t.track === track)
    && (stage === 'all' || stageOf(t) === stage)
    && [t.name, t.employee_code, t.rag_remark, t.reporting_manager].some((v) => v?.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => ({ red: 0, amber: 1, green: 2 }[a.rag] ?? 3) - ({ red: 0, amber: 1, green: 2 }[b.rag] ?? 3) || a.name.localeCompare(b.name));
  const count = (k) => rows.filter((t) => (k === 'none' ? !t.rag : t.rag === k)).length;
  const statusText = (t) => (t.tcd_lwd ? `${EXIT_LABELS[t.exit_reason || 'handover']}` : EXIT_LABELS[t.exit_reason || '']);

  const download = () => downloadTableXlsx({
    headers: ['E Code', 'E Name', 'Batch', 'Track', 'Designation', 'Trainer', 'Reporting manager', 'DOJ', 'TCD / LWD', 'Status', 'RAG', 'Remarks', 'Updated'],
    rows: rows.map((t) => [t.employee_code || '', t.name, t._batch?.code || '', t.track || '', t.designation || '', names[t.trainer_id] || '',
      t.reporting_manager || '', fmtMedium(t.joining_date), t.tcd_lwd ? fmtMedium(t.tcd_lwd) : '', statusText(t),
      t.rag ? RAG[t.rag].label : '', t.rag_remark || '', t.rag_updated_at ? fmtDateTime(t.rag_updated_at, tz) : '']),
    filename: `RAG_Report_${now.date}.xlsx`,
    sheetName: 'RAG Report',
  });

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <PageHeader title="RAG & remarks report" subtitle="Trainer feedback on each trainee. This is separate from the Monthly Sheet."
        actions={<button className="btn-primary" onClick={download} disabled={!rows.length}><FileSpreadsheet size={16} />Download Excel</button>} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Green" value={count('green')} tone="green" />
        <StatCard label="Amber" value={count('amber')} tone="amber" />
        <StatCard label="Red" value={count('red')} tone="red" />
        <StatCard label="Not set" value={count('none')} tone="slate" />
      </div>

      <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <label className="label" htmlFor="rg-q">Search</label>
          <Search size={16} className="absolute bottom-3 left-3.5 text-slate-400" />
          <input id="rg-q" className="input pl-10" placeholder="Name, E Code or remark" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="rg-rag">RAG</label>
          <select id="rg-rag" className="input" value={rag} onChange={(e) => setRag(e.target.value)}>
            <option value="all">All</option><option value="red">Red</option><option value="amber">Amber</option><option value="green">Green</option><option value="none">Not set</option>
          </select>
        </div>
        {isManager && (
          <div>
            <label className="label" htmlFor="rg-trainer">Trainer</label>
            <select id="rg-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="all">All trainers</option>
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="rg-batch">Batch / Track</label>
          <select id="rg-batch" className="input" value={batchId !== 'all' ? `b:${batchId}` : track !== 'all' ? `t:${track}` : 'all'}
            onChange={(e) => { const v = e.target.value; setBatchId(v.startsWith('b:') ? v.slice(2) : 'all'); setTrack(v.startsWith('t:') ? v.slice(2) : 'all'); }}>
            <option value="all">All</option>
            {batches.length > 0 && <optgroup label="Batch">{batches.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.code}</option>)}</optgroup>}
            {tracks.length > 0 && <optgroup label="Track">{tracks.map((t) => <option key={t} value={`t:${t}`}>{t}</option>)}</optgroup>}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rg-stage">Status</label>
          <select id="rg-stage" className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="all">All</option><option value="training">In training</option><option value="done">Handed over</option><option value="exited">Left / not certified / revoked</option>
          </select>
        </div>
      </div>

      <div className="panel overflow-hidden">
        {rows.length === 0 ? <Empty title="No trainees match">Set RAG from the Trainees page or by clicking a RAG chip here.</Empty> : (
          <div className="table-wrap max-h-[70vh] overflow-y-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10"><tr><th>E Code</th><th>E Name</th><th>Batch / Track</th>{isManager && <th>Trainer</th>}<th>DOJ</th><th>TCD / LWD</th><th>Status</th><th>RAG</th><th>Remarks</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.map((t) => {
                  const canEdit = canEditRag(t, profile);
                  return (
                    <tr key={t.id} className={t.rag === 'red' ? 'bg-red-50/40' : ''}>
                      <td className="text-slate-600">{t.employee_code || '—'}</td>
                      <td><div className="font-semibold text-slate-800">{t.name}</div>{t.designation && <div className="text-xs text-slate-400">{t.designation}</div>}</td>
                      <td className="text-slate-600">{[t._batch?.code, t.track].filter(Boolean).join(' · ') || '—'}</td>
                      {isManager && <td className="text-slate-600">{names[t.trainer_id] || '—'}</td>}
                      <td className="text-slate-600">{fmtMedium(t.joining_date)}</td>
                      <td className="text-slate-600">{t.tcd_lwd ? fmtMedium(t.tcd_lwd) : '—'}</td>
                      <td className="text-slate-600">{statusText(t)}</td>
                      <td><RagChip rag={t.rag} onClick={canEdit ? () => setEditing(t) : undefined} /></td>
                      <td className="min-w-[240px] max-w-md whitespace-normal text-slate-700">{t.rag_remark || <span className="text-slate-300">—</span>}</td>
                      <td className="text-xs text-slate-400">{t.rag_updated_at ? `${fmtDateTime(t.rag_updated_at, tz)}${t.rag_updated_by ? ` · ${t.rag_updated_by === profile.id ? 'You' : names[t.rag_updated_by] || 'Manager'}` : ''}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <RagModal trainee={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
