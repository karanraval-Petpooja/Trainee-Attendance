'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Link2, RefreshCw, Search } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, ErrorText, Modal, PageHeader, PageLoader, Spinner, StatCard } from '@/components/ui';
import { sb } from '@/lib/supabase';
import { useLmsResults, useTrainees, useTrainers } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/dates';
import { EXIT_LABELS, notJoining, scopeTo } from '@/lib/status';
import { downloadTableXlsx } from '@/lib/monthlySheet';

const CHIP = {
  passed: ['bg-emerald-100 text-emerald-800', '✓ Passed'],
  failed: ['bg-rose-100 text-rose-800', '✗ Failed'],
  pending: ['bg-slate-100 text-slate-600', '⏳ Not attempted'],
};
const VIA = { code: 'E Code', email: 'email', name: 'name', manual: 'linked by manager' };
const scoreText = (r) => (r ? [r.score !== null && r.max_score !== null ? `${+r.score}/${+r.max_score}` : r.score !== null ? `${+r.score}` : '', r.percentage !== null ? `${+r.percentage}%` : ''].filter(Boolean).join(' · ') || '—' : '—');

function LinkModal({ result, trainees, onClose, onSaved }) {
  const { showToast } = useApp();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const list = useMemo(() => trainees.filter((t) => !t.deleted_at && [t.name, t.employee_code, t.official_email].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 60), [trainees, q]);
  const save = async () => {
    setSaving(true); setError('');
    const { error: e } = await sb().rpc('link_lms_result', { p_result: result.id, p_trainee: pick || null });
    setSaving(false);
    if (e) { setError(e.message); return; }
    showToast('Result linked to the trainee.');
    onSaved(); onClose();
  };
  return (
    <Modal title="Link LMS result to a trainee" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !pick}>{saving && <Spinner size={16} />}Link</button></>}>
      <p className="mb-3 text-sm text-slate-600">
        <b>{result.name || 'No name'}</b>{result.email ? ` · ${result.email}` : ''}{result.employee_code ? ` · ${result.employee_code}` : ''} could not be matched automatically. Choose who it is.
      </p>
      <label className="label" htmlFor="lr-q">Find trainee</label>
      <input id="lr-q" className="input mb-2" placeholder="Name, E Code or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className="input" size={7} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Trainee">
        {list.map((t) => <option key={t.id} value={t.id}>{t.name}{t.employee_code ? ` · ${t.employee_code}` : ''}{t._batch?.code ? ` · ${t._batch.code}` : ''}</option>)}
      </select>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

// Results from the Petpooja LMS (learn.petpooja.com): who passed, who failed, who has not attempted yet
export default function LmsResultsPage() {
  const { profile, tz, now, showToast } = useApp();
  const isManager = profile.role === 'manager';
  const { trainees, batches, loading, reload: reloadTrainees } = useTrainees({ includeInactive: true, includeDeleted: true, trainerId: isManager ? null : profile.id });
  const { trainers } = useTrainers();
  const { rows: results, loading: rLoading, reload } = useLmsResults();
  const names = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);
  const [assessment, setAssessment] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [trainerId, setTrainerId] = useState('all');
  const [batchId, setBatchId] = useState('all');
  const [linking, setLinking] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const rematched = useRef(false);

  const assessments = useMemo(() => {
    const m = {};
    results.forEach((r) => { m[r.assessment] = (m[r.assessment] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  }, [results]);
  const sel = assessment && assessments.some((a) => a.name === assessment) ? assessment : assessments[0]?.name || '';
  const forSel = useMemo(() => results.filter((r) => r.assessment === sel), [results, sel]);
  const unmatched = useMemo(() => forSel.filter((r) => !r.trainee_id), [forSel]);

  // The FINAL result of a trainee = the pass (the first one) if they ever passed, otherwise the latest attempt
  const finalOf = useMemo(() => {
    const m = {};
    forSel.forEach((r) => { if (r.trainee_id) (m[r.trainee_id] ||= []).push(r); });
    const out = {};
    Object.entries(m).forEach(([id, list]) => {
      const asc = [...list].sort((a, b) => a.completed_at.localeCompare(b.completed_at));
      out[id] = { ...(asc.find((r) => r.passed) || asc[asc.length - 1]), attempts: list.length };
    });
    return out;
  }, [forSel]);

  // A manager opening the page: link results whose trainee was added / got an email after they arrived
  useEffect(() => {
    if (!isManager || rLoading || !results.some((r) => !r.trainee_id) || rematched.current) return;
    rematched.current = true;
    sb().rpc('match_lms_results').then(({ data }) => { if (Number(data) > 0) reload(); });
  }, [isManager, rLoading, results, reload]);

  // Listed: everyone with a result, plus people who can still be asked to take it (active, joined, not left)
  const expected = (t) => t.status === 'active' && !t.deleted_at && !notJoining(t) && (!t.exit_reason || t.exit_reason === 'handover');
  const pool = useMemo(() => scopeTo(trainees, trainerId).filter((t) => finalOf[t.id] || expected(t)), [trainees, trainerId, finalOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const statusOf = (t) => (finalOf[t.id] ? (finalOf[t.id].passed ? 'passed' : 'failed') : 'pending');
  const scoped = pool.filter((t) => batchId === 'all' || t.batch_id === batchId);
  const count = (k) => scoped.filter((t) => statusOf(t) === k).length;
  const attempted = count('passed') + count('failed');
  const passRate = attempted ? Math.round((count('passed') * 100) / attempted) : null;
  const pcts = scoped.map((t) => finalOf[t.id]?.percentage).filter((v) => v !== null && v !== undefined).map(Number);
  const avg = pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null;
  const order = { pending: 0, failed: 1, passed: 2 };
  const rows = scoped
    .filter((t) => status === 'all' || statusOf(t) === status)
    .filter((t) => [t.name, t.employee_code, t.official_email].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => order[statusOf(a)] - order[statusOf(b)] || (a._batch?.code || '').localeCompare(b._batch?.code || '') || a.name.localeCompare(b.name));
  const trainerOf = (t) => names[t.trainer_id] || t.trainer_label || '—';
  const stageLabel = (t) => (t.deleted_at ? 'Removed' : t.exit_reason && t.exit_reason !== 'handover' ? EXIT_LABELS[t.exit_reason] || 'Left' : '');
  const lastReceived = results.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([reload(), reloadTrainees()]);
    setRefreshing(false);
    showToast('Results reloaded.');
  };
  const download = () => downloadTableXlsx({
    headers: ['E Code', 'E Name', 'Batch', 'Trainer', 'Assessment', 'Result', 'Score', 'Percentage', 'Attempts', 'Completed on', 'Note'],
    rows: rows.map((t) => { const f = finalOf[t.id]; return [t.employee_code || '', t.name, t._batch?.code || '', trainerOf(t), sel, f ? (f.passed ? 'Passed' : 'Failed') : 'Not attempted',
      f && f.score !== null ? `${+f.score}${f.max_score !== null ? `/${+f.max_score}` : ''}` : '', f?.percentage ?? '', f?.attempts ?? '', f ? fmtDateTime(f.completed_at, tz) : '', stageLabel(t)]; }),
    filename: `LMS_Results_${sel.replace(/\W+/g, '_')}_${now.date}.xlsx`, sheetName: 'LMS results',
  });

  if (loading || rLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <PageHeader title="LMS results" subtitle={isManager ? 'Assessment results from learn.petpooja.com. A result appears here as soon as a trainee finishes.' : 'Assessment results of your trainees, from learn.petpooja.com.'}
        actions={<>
          <button className="btn-secondary" onClick={refresh} disabled={refreshing}>{refreshing ? <Spinner size={16} /> : <RefreshCw size={16} />}Reload</button>
          <button className="btn-primary" onClick={download} disabled={!rows.length}><FileSpreadsheet size={16} />Download Excel</button>
        </>} />

      {results.length === 0 ? (
        <div className="panel"><Empty title="No results received yet">
          {isManager ? 'Once the LMS is connected, results appear here by themselves. Give the LMS team docs/LMS_WEBHOOK.md and set LMS_WEBHOOK_SECRET in Vercel.' : 'Results appear here when your trainees finish their assessment on the LMS.'}
        </Empty></div>
      ) : (<>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label className="label" htmlFor="lr-as">Assessment</label>
            <select id="lr-as" className="input" value={sel} onChange={(e) => { setAssessment(e.target.value); setStatus('all'); }}>
              {assessments.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.n})</option>)}
            </select>
          </div>
          <div className="pb-2.5 text-xs text-slate-500">{lastReceived ? `Last result received ${fmtDateTime(lastReceived, tz)} · ` : ''}{results.length} result{results.length === 1 ? '' : 's'} in total</div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Passed" value={count('passed')} tone="green" />
          <StatCard label="Failed" value={count('failed')} tone={count('failed') ? 'red' : 'slate'} />
          <StatCard label="Not attempted" value={count('pending')} tone={count('pending') ? 'amber' : 'slate'} />
          <StatCard label="Pass rate" value={passRate === null ? '—' : `${passRate}%`} tone="ink" hint="Of those who attempted" />
          <StatCard label="Average score" value={avg === null ? '—' : `${avg}%`} tone="ink" />
        </div>

        <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <label className="label" htmlFor="lr-search">Search</label>
            <Search size={16} className="absolute bottom-3 left-3.5 text-slate-400" />
            <input id="lr-search" className="input pl-10" placeholder="Name, E Code or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="lr-status">Result</label>
            <select id="lr-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="pending">Not attempted</option>
            </select>
          </div>
          {isManager && (
            <div>
              <label className="label" htmlFor="lr-trainer">Trainer</label>
              <select id="lr-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
                <option value="all">All trainers</option>
                {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="lr-batch">Batch</label>
            <select id="lr-batch" className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="all">All batches</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
            </select>
          </div>
        </div>

        <div className="panel overflow-hidden">
          {rows.length === 0 ? <Empty title="No trainees match">Change the filters above.</Empty> : (
            <div className="table-wrap max-h-[70vh] overflow-y-auto">
              <table className="tbl">
                <thead className="sticky top-0 z-10"><tr><th>E Code</th><th>E Name</th><th>Batch</th>{isManager && <th>Trainer</th>}<th>Result</th><th>Score</th><th>Attempts</th><th>Completed</th></tr></thead>
                <tbody>
                  {rows.map((t) => {
                    const f = finalOf[t.id]; const st = statusOf(t);
                    return (
                      <tr key={t.id} className={st === 'failed' ? 'bg-rose-50/40' : st === 'pending' ? 'bg-slate-50/60' : ''}>
                        <td className="text-slate-600">{t.employee_code || '—'}</td>
                        <td><div className="font-semibold text-slate-800">{t.name}</div>{stageLabel(t) && <div className="text-xs text-slate-400">{stageLabel(t)}</div>}</td>
                        <td className="text-slate-600">{t._batch?.code || '—'}</td>
                        {isManager && <td className="text-slate-600">{trainerOf(t)}</td>}
                        <td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[st][0]}`}>{CHIP[st][1]}</span></td>
                        <td className="font-semibold text-slate-700">{scoreText(f)}</td>
                        <td className="text-slate-600">{f ? f.attempts : '—'}</td>
                        <td className="text-xs text-slate-500">{f ? <>{fmtDateTime(f.completed_at, tz)}{f.match_via === 'name' && <div className="text-slate-400">matched by name</div>}{f.match_via === 'manual' && <div className="text-slate-400">linked by manager</div>}</> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {isManager && unmatched.length > 0 && (
          <div className="panel overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-semibold text-slate-700">Results not linked to a trainee ({unmatched.length})</div>
              <div className="text-xs text-slate-500">The E Code / email / name from the LMS did not match one trainee. Link it by hand so it counts.</div>
            </div>
            <div className="table-wrap max-h-[50vh] overflow-y-auto">
              <table className="tbl">
                <thead className="sticky top-0 z-10"><tr><th>Name in LMS</th><th>Email</th><th>E Code</th><th>Result</th><th>Score</th><th>Completed</th><th /></tr></thead>
                <tbody>
                  {unmatched.map((r) => (
                    <tr key={r.id}>
                      <td className="font-semibold text-slate-800">{r.name || '—'}</td>
                      <td className="text-slate-600">{r.email || '—'}</td>
                      <td className="text-slate-600">{r.employee_code || '—'}</td>
                      <td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[r.passed ? 'passed' : 'failed'][0]}`}>{CHIP[r.passed ? 'passed' : 'failed'][1]}</span></td>
                      <td className="text-slate-700">{scoreText(r)}</td>
                      <td className="text-xs text-slate-500">{fmtDateTime(r.completed_at, tz)}</td>
                      <td><button className="btn-secondary btn-sm" onClick={() => setLinking(r)}><Link2 size={14} />Link</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>)}
      {linking && <LinkModal result={linking} trainees={trainees} onClose={() => setLinking(null)} onSaved={reload} />}
    </div>
  );
}
