'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCopy, FileSpreadsheet, Link2, RefreshCw, Search } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, ErrorText, Modal, PageHeader, PageLoader, Spinner, StatCard } from '@/components/ui';
import { authFetch, sb } from '@/lib/supabase';
import { fetchAll, useFeedback, useTrainees, useTrainers } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/dates';
import { FEEDBACK_FORMS, formById } from '@/lib/feedbackForms';
import { notJoining, scopeTo, sentToFloor, traineeActiveOn } from '@/lib/status';
import { downloadTableXlsx } from '@/lib/monthlySheet';

// Who is tracked for "pending" on each form. Upskill / OJT-PIP forms are filled by session participants, who are not
// in the trainee list, so for them the report lists the responses only.
const isSales = (t) => /sales/i.test(`${t._batch?.purpose || ''} ${t.track || ''}`);
const TRACK = { nht: (t) => !isSales(t), sales: (t) => isSales(t) };
const VIA = { code: 'E Code', email: 'email', name: 'name', manual: 'linked by manager' };

function AnswersModal({ id, title, onClose }) {
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    sb().from('feedback_responses').select('*').eq('id', id).single().then(({ data, error: e }) => { if (e) setError(e.message); else setRow(data); });
  }, [id]);
  return (
    <Modal title={title} onClose={onClose} wide footer={<button className="btn-secondary" onClick={onClose}>Close</button>}>
      {error ? <ErrorText>{error}</ErrorText> : !row ? <div className="py-8 text-center"><Spinner /></div> : (
        <div className="space-y-3">
          {(row.answers || []).map((x, i) => (
            <div key={i} className="rounded-xl border border-slate-100 p-3">
              <div className="text-xs font-semibold text-slate-500">{x.q}</div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{x.a}</div>
            </div>
          ))}
          {!row.answers?.length && <Empty title="No answers were saved for this response." />}
        </div>
      )}
    </Modal>
  );
}

function LinkModal({ response, trainees, onClose, onSaved }) {
  const { showToast } = useApp();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const list = useMemo(() => trainees.filter((t) => [t.name, t.employee_code, t.official_email].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 60), [trainees, q]);
  const save = async () => {
    setSaving(true); setError('');
    const { error: e } = await sb().rpc('link_feedback_response', { p_response: response.id, p_trainee: pick || null });
    setSaving(false);
    if (e) { setError(e.message); return; }
    showToast('Feedback linked to the trainee.');
    onSaved(); onClose();
  };
  return (
    <Modal title="Link feedback to a trainee" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !pick}>{saving && <Spinner size={16} />}Link</button></>}>
      <p className="mb-3 text-sm text-slate-600">
        <b>{response.respondent_name || 'No name'}</b>{response.respondent_email ? ` · ${response.respondent_email}` : ''} could not be matched automatically. Choose who it is.
      </p>
      <label className="label" htmlFor="lk-q">Find trainee</label>
      <input id="lk-q" className="input mb-2" placeholder="Name, E Code or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className="input" size={7} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Trainee">
        {list.map((t) => <option key={t.id} value={t.id}>{t.name}{t.employee_code ? ` · ${t.employee_code}` : ''}{t._batch?.code ? ` · ${t._batch.code}` : ''}</option>)}
      </select>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

export default function FeedbackReportPage() {
  const { profile, now, tz, showToast } = useApp();
  const isManager = profile.role === 'manager';
  const [form, setForm] = useState('nht');
  const meta = formById(form);
  const tracked = Boolean(TRACK[form]);
  const { trainees, loading, reload: reloadTrainees } = useTrainees({ includeInactive: true, trainerId: isManager ? null : profile.id });
  const { trainers } = useTrainers();
  const { rows: responses, loading: rLoading, reload: reloadResponses } = useFeedback(form);
  const names = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);

  const [q, setQ] = useState('');
  const [trainerId, setTrainerId] = useState('all');
  const [batchId, setBatchId] = useState('all');
  const [training, setTraining] = useState('all');   // all | finished | training
  const [status, setStatus] = useState('all');       // all | pending | submitted
  const [open, setOpen] = useState(null);            // response id whose answers are shown
  const [linking, setLinking] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyXlsx, setBusyXlsx] = useState(false);
  const rematched = useRef({});

  // Trainees' latest response (the list is newest first)
  const byTrainee = useMemo(() => {
    const m = {};
    responses.forEach((r) => { if (r.trainee_id && !m[r.trainee_id]) m[r.trainee_id] = r; });
    return m;
  }, [responses]);
  const unmatched = useMemo(() => responses.filter((r) => !r.trainee_id), [responses]);

  // A manager opening the page: link responses whose trainee was added / got an email after the last sync
  useEffect(() => {
    if (!isManager || rLoading || !unmatched.length || rematched.current[form]) return;
    rematched.current[form] = true;
    sb().rpc('match_feedback_responses').then(({ data }) => { if (Number(data) > 0) reloadResponses(); });
  }, [isManager, rLoading, unmatched.length, form, reloadResponses]);

  const pool = useMemo(() => scopeTo(trainees, trainerId), [trainees, trainerId]);
  // Everyone who has given feedback is listed (even if removed from attendance later). Someone with NO feedback is "pending"
  // only if they can still be asked: active, joined, and not resigned / not certified / dropped out.
  const expected = (t) => t.status === 'active' && !notJoining(t) && (!t.exit_reason || t.exit_reason === 'handover');
  const inForm = useMemo(() => (tracked ? pool.filter((t) => TRACK[form](t) && (byTrainee[t.id] || expected(t))) : []), [pool, tracked, form, byTrainee]); // eslint-disable-line react-hooks/exhaustive-deps
  const inFormIds = useMemo(() => new Set(inForm.map((t) => t.id)), [inForm]);
  const tById = useMemo(() => Object.fromEntries(trainees.map((t) => [t.id, t])), [trainees]);
  // Account for EVERY response, so the numbers always add up
  const recon = useMemo(() => {
    const linked = responses.filter((r) => r.trainee_id);
    const inList = linked.filter((r) => inFormIds.has(r.trainee_id));
    const distinct = new Set(inList.map((r) => r.trainee_id)).size;
    return { total: responses.length, distinct, repeats: inList.length - distinct, outside: linked.length - inList.length, unlinked: unmatched.length };
  }, [responses, inFormIds, unmatched.length]);
  const lastRead = useMemo(() => responses.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), ''), [responses]);
  // Shown at the bottom: not linked to anyone, or linked to someone who is not in the list above
  const rest = tracked ? responses.filter((r) => !r.trainee_id || (trainerId === 'all' && !inFormIds.has(r.trainee_id))) : responses;
  const finished = (t) => !traineeActiveOn(t, now.date) || sentToFloor(t);
  const afterTraining = useMemo(() => inForm.filter((t) => training === 'all' || (training === 'finished' ? finished(t) : !finished(t))), [inForm, training, now.date]); // eslint-disable-line react-hooks/exhaustive-deps
  const batches = useMemo(() => {
    const m = new Map();
    afterTraining.forEach((t) => {
      const k = t.batch_id || 'none';
      const g = m.get(k) || { id: k, code: t._batch?.code || 'No batch', total: 0, done: 0 };
      g.total += 1; if (byTrainee[t.id]) g.done += 1;
      m.set(k, g);
    });
    return [...m.values()].sort((a, b) => (b.total - b.done) - (a.total - a.done) || a.code.localeCompare(b.code));
  }, [afterTraining, byTrainee]);

  const scoped = afterTraining.filter((t) => batchId === 'all' || (t.batch_id || 'none') === batchId);
  const submitted = scoped.filter((t) => byTrainee[t.id]).length;
  const pending = scoped.length - submitted;
  const rows = scoped
    .filter((t) => status === 'all' || (status === 'submitted' ? byTrainee[t.id] : !byTrainee[t.id]))
    .filter((t) => [t.name, t.employee_code, t.official_email].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => Number(Boolean(byTrainee[a.id])) - Number(Boolean(byTrainee[b.id])) || (a._batch?.code || '').localeCompare(b._batch?.code || '') || a.name.localeCompare(b.name));
  const trainerOf = (t) => names[t.trainer_id] || t.trainer_label || '—';

  const refresh = async () => {
    setRefreshing(true);
    try {
      const j = await authFetch('/api/feedback-run', { method: 'POST' });
      showToast(j.running ? j.message : `Feedback sheet read: ${j.rows} response${j.rows === 1 ? '' : 's'}${j.matched ? `, ${j.matched} newly matched` : ''}.`);
      await Promise.all([reloadResponses(), reloadTrainees()]);
    } catch (e) { showToast(e.message, 'error'); }
    setRefreshing(false);
  };

  const copyPending = async () => {
    const list = rows.filter((t) => !byTrainee[t.id]);
    if (!list.length) { showToast('Nobody is pending in this view.'); return; }
    const text = `${meta.name}: ${list.length} pending\n${list.map((t, i) => `${i + 1}. ${t.name}${t._batch?.code ? ` (${t._batch.code})` : ''}`).join('\n')}\n\nForm: ${meta.url}`;
    try { await navigator.clipboard.writeText(text); showToast('Pending list copied. Paste it in WhatsApp.'); } catch { showToast('Could not copy. Select and copy manually.', 'error'); }
  };

  const downloadTracker = () => downloadTableXlsx({
    headers: ['E Code', 'E Name', 'Batch', 'Trainer', 'Training', meta.label + ' feedback', 'Submitted on'],
    rows: rows.map((t) => [t.employee_code || '', t.name, t._batch?.code || '', trainerOf(t), finished(t) ? 'Finished' : 'In training',
      byTrainee[t.id] ? 'Submitted' : 'Pending', byTrainee[t.id]?.submitted_at ? fmtDateTime(byTrainee[t.id].submitted_at, tz) : '']),
    filename: `Feedback_${meta.label.replace(/\W+/g, '_')}_${now.date}.xlsx`, sheetName: 'Feedback status',
  });

  const downloadAnswers = async () => {
    setBusyXlsx(true);
    try {
      const all = await fetchAll(() => sb().from('feedback_responses').select('*').eq('form_id', form).order('submitted_at'));
      const tmap = Object.fromEntries(trainees.map((t) => [t.id, t]));
      const qs = [];
      all.forEach((r) => (r.answers || []).forEach((x) => { if (!qs.includes(x.q)) qs.push(x.q); }));
      await downloadTableXlsx({
        headers: ['Submitted on', 'Name (form)', 'Email', 'Trainer (form)', 'Batch (form)', 'Matched trainee', 'E Code', 'Matched batch', ...qs],
        rows: all.map((r) => {
          const t = tmap[r.trainee_id];
          const a = Object.fromEntries((r.answers || []).map((x) => [x.q, x.a]));
          return [r.submitted_at ? fmtDateTime(r.submitted_at, tz) : '', r.respondent_name || '', r.respondent_email || '', r.trainer_name || '', r.batch_code || '',
            t?.name || '', t?.employee_code || '', t?._batch?.code || '', ...qs.map((x) => a[x] ?? '')];
        }),
        filename: `Feedback_answers_${meta.label.replace(/\W+/g, '_')}_${now.date}.xlsx`, sheetName: 'Responses',
      });
    } catch (e) { showToast(e.message, 'error'); }
    setBusyXlsx(false);
  };

  if (loading) return <PageLoader />;
  const rate = scoped.length ? Math.round((submitted * 100) / scoped.length) : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Feedback report"
        subtitle={isManager ? 'What trainees wrote in the feedback forms, and who has not filled it yet.' : 'Feedback from your own trainees, and who still has to fill the form.'}
        actions={<>
          <button className="btn-secondary" onClick={refresh} disabled={refreshing} title="Read the Google feedback sheet now">
            {refreshing ? <Spinner size={16} /> : <RefreshCw size={16} />}{refreshing ? 'Reading…' : 'Refresh from sheet'}
          </button>
          <button className="btn-secondary" onClick={downloadAnswers} disabled={busyXlsx || !responses.length}>{busyXlsx ? <Spinner size={16} /> : <FileSpreadsheet size={16} />}Download answers</button>
          {tracked && <button className="btn-primary" onClick={downloadTracker} disabled={!rows.length}><FileSpreadsheet size={16} />Download status</button>}
        </>} />

      <div className="flex flex-wrap gap-2" role="tablist">
        {FEEDBACK_FORMS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={form === f.id} onClick={() => { setForm(f.id); setBatchId('all'); setStatus('all'); }}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${form === f.id ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>{f.label}</button>
        ))}
      </div>

      {rLoading ? <PageLoader /> : (<>
        {tracked ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Trainees" value={scoped.length} tone="slate" />
              <StatCard label="Submitted" value={submitted} tone="green" />
              <StatCard label="Pending" value={pending} tone={pending ? 'amber' : 'green'} hint={pending ? 'Tap Pending below to see who' : 'Everyone has filled it'} />
              <StatCard label="Response rate" value={rate === null ? '—' : `${rate}%`} tone="ink" />
            </div>

            {trainerId === 'all' && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
                <b>{recon.total}</b> response{recon.total === 1 ? '' : 's'} read from the sheet{lastRead ? ` (last read ${fmtDateTime(lastRead, tz)})` : ''} =
                {' '}<b>{recon.distinct}</b> trainee{recon.distinct === 1 ? '' : 's'} counted above
                {recon.repeats > 0 && <> + <b>{recon.repeats}</b> repeat submission{recon.repeats === 1 ? '' : 's'} by the same trainee</>}
                {recon.outside > 0 && <> + <b>{recon.outside}</b> linked to someone not in this list</>}
                {recon.unlinked > 0 && <> + <b>{recon.unlinked}</b> not linked to any trainee</>}.
                {(recon.outside > 0 || recon.unlinked > 0) && ' See the table at the bottom.'}
              </div>
            )}

            {batches.length > 0 && (
              <div className="panel p-4">
                <div className="mb-2 text-xs font-semibold text-slate-500">By batch (tap to open)</div>
                <div className="flex flex-wrap gap-2">
                  {batches.map((b) => {
                    const left = b.total - b.done;
                    return (
                      <button key={b.id} type="button" onClick={() => setBatchId(batchId === b.id ? 'all' : b.id)} aria-pressed={batchId === b.id}
                        className={`min-w-[150px] rounded-xl border px-3 py-2 text-left ${batchId === b.id ? 'border-ink-800 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800"><span>{b.code}</span><span className={left ? 'text-amber-600' : 'text-emerald-600'}>{b.done}/{b.total}</span></div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${b.total ? (b.done * 100) / b.total : 0}%` }} /></div>
                        <div className="mt-1 text-xs text-slate-500">{left ? `${left} pending` : 'All submitted'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative lg:col-span-2">
                <label className="label" htmlFor="fb-q">Search</label>
                <Search size={16} className="absolute bottom-3 left-3.5 text-slate-400" />
                <input id="fb-q" className="input pl-10" placeholder="Name, E Code or email" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fb-status">Feedback</label>
                <select id="fb-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="all">All</option><option value="pending">Pending ({pending})</option><option value="submitted">Submitted ({submitted})</option>
                </select>
              </div>
              {isManager && (
                <div>
                  <label className="label" htmlFor="fb-trainer">Trainer</label>
                  <select id="fb-trainer" className="input" value={trainerId} onChange={(e) => { setTrainerId(e.target.value); setBatchId('all'); }}>
                    <option value="all">All trainers</option>
                    {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label" htmlFor="fb-training">Training</label>
                <select id="fb-training" className="input" value={training} onChange={(e) => { setTraining(e.target.value); setBatchId('all'); }}>
                  <option value="all">All</option><option value="finished">Finished / on the floor</option><option value="training">Still in training</option>
                </select>
              </div>
            </div>

            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div className="text-sm font-semibold text-slate-700">{rows.length} trainee{rows.length === 1 ? '' : 's'}</div>
                <button className="btn-secondary btn-sm" onClick={copyPending}><ClipboardCopy size={14} />Copy pending list</button>
              </div>
              {rows.length === 0 ? <Empty title="No trainees match">{inForm.length ? 'Change the filters above.' : 'No trainees for this form yet.'}</Empty> : (
                <div className="table-wrap max-h-[70vh] overflow-y-auto">
                  <table className="tbl">
                    <thead className="sticky top-0 z-10"><tr><th>E Code</th><th>E Name</th><th>Batch</th>{isManager && <th>Trainer</th>}<th>Training</th><th>Feedback</th><th>Submitted</th><th /></tr></thead>
                    <tbody>
                      {rows.map((t) => {
                        const r = byTrainee[t.id];
                        return (
                          <tr key={t.id} className={r ? '' : 'bg-amber-50/40'}>
                            <td className="text-slate-600">{t.employee_code || '—'}</td>
                            <td className="font-semibold text-slate-800">{t.name}</td>
                            <td className="text-slate-600">{t._batch?.code || '—'}</td>
                            {isManager && <td className="text-slate-600">{trainerOf(t)}</td>}
                            <td className="text-slate-600">{finished(t) ? 'Finished' : 'In training'}</td>
                            <td>{r
                              ? <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">✓ Submitted</span>
                              : <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">⏳ Pending</span>}</td>
                            <td className="text-xs text-slate-500">{r ? <>{r.submitted_at ? fmtDateTime(r.submitted_at, tz) : '—'}{r.match_via && r.match_via !== 'email' && r.match_via !== 'code' && <div className="text-slate-400">matched by {VIA[r.match_via]}</div>}</> : '—'}</td>
                            <td>{r && <button className="btn-ghost btn-sm" onClick={() => setOpen({ id: r.id, title: `${t.name} · ${meta.label} feedback` })}>View</button>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="panel px-5 py-4 text-sm text-slate-600">
            The {meta.label} form is filled by session participants, who are not in the trainee list, so “pending” is tracked for the <b>NHT</b> and <b>Sales</b> forms only. Responses are listed below.
          </div>
        )}

        <div className="panel overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-700">{tracked ? 'Responses not counted above' : `${meta.label} responses`} ({rest.length})</div>
            {tracked && <div className="text-xs text-slate-500">{isManager ? 'The name / email in the form did not match one trainee (or matched someone who is not in the list above). Link it by hand so it counts.' : 'These name you as the trainer but could not be matched to one of your trainees.'}</div>}
          </div>
          {rest.length === 0 ? (
            <Empty title={responses.length || !isManager ? 'Nothing here' : 'No responses received yet'}>
              {!responses.length && isManager ? 'Tap “Refresh from sheet”. If it fails: run supabase/update_feedback.sql, paste the latest Google script and deploy a new version (GO_LIVE.md).' : undefined}
            </Empty>
          ) : (
            <div className="table-wrap max-h-[50vh] overflow-y-auto">
              <table className="tbl">
                <thead className="sticky top-0 z-10"><tr><th>Name in form</th><th>Email</th><th>Trainer in form</th><th>Batch in form</th>{tracked && <th>Status</th>}<th>Submitted</th><th /></tr></thead>
                <tbody>
                  {rest.map((r) => (
                    <tr key={r.id}>
                      <td className="font-semibold text-slate-800">{r.respondent_name || '—'}</td>
                      <td className="text-slate-600">{r.respondent_email || '—'}</td>
                      <td className="text-slate-600">{r.trainer_name || (r.trainer_id ? names[r.trainer_id] : '') || '—'}</td>
                      <td className="text-slate-600">{r.batch_code || '—'}</td>
                      {tracked && <td className="text-xs text-slate-600">{r.trainee_id ? `Linked to ${tById[r.trainee_id]?.name || 'a trainee'}, not in the list above` : 'Not linked'}</td>}
                      <td className="text-xs text-slate-500">{r.submitted_at ? fmtDateTime(r.submitted_at, tz) : '—'}</td>
                      <td className="space-x-1">
                        <button className="btn-ghost btn-sm" onClick={() => setOpen({ id: r.id, title: `${r.respondent_name || 'Response'} · ${meta.label} feedback` })}>View</button>
                        {isManager && tracked && <button className="btn-secondary btn-sm" onClick={() => setLinking(r)}><Link2 size={14} />Link</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>)}

      {open && <AnswersModal id={open.id} title={open.title} onClose={() => setOpen(null)} />}
      {linking && <LinkModal response={linking} trainees={trainees} onClose={() => setLinking(null)} onSaved={reloadResponses} />}
    </div>
  );
}
