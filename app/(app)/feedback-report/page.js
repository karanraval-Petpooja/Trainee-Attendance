'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCopy, FileSpreadsheet, Link2, RefreshCw, Search, Star } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, ErrorText, Modal, PageHeader, PageLoader, Spinner, StatCard } from '@/components/ui';
import { authFetch, sb } from '@/lib/supabase';
import { fetchAll, useTrainees, useTrainers } from '@/lib/hooks';
import { useFeedback } from '@/lib/useFeedback';
import { fmtDateTime } from '@/lib/dates';
import { FEEDBACK_FORMS, formById } from '@/lib/feedbackForms';
import { EXIT_LABELS, notJoining, scopeTo, sentToFloor, traineeActiveOn } from '@/lib/status';
import { downloadTableXlsx } from '@/lib/monthlySheet';

// Who is tracked for "pending" on each form. Upskill / OJT-PIP forms are filled by session participants, who are not
// in the trainee list, so for them the report lists the responses only.
const isSales = (t) => /sales/i.test(`${t._batch?.purpose || ''} ${t.track || ''}`);
const TRACK = { nht: (t) => !isSales(t), sales: (t) => isSales(t) };
// The Sales feedback is always for Jasmin Babla, whoever the trainee's own trainer is
const SALES_TRAINER = 'Jasmin Babla';
const VIA = { code: 'E Code', email: 'email', name: 'name', manual: 'linked by manager' };

// 0-5 stars, partly filled for averages (4.5 = four and a half stars)
function Stars({ value, size = 14 }) {
  const v = Number(value) || 0;
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${v.toFixed(1)} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
          <Star size={size} className="text-slate-200" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${Math.max(0, Math.min(1, v - i)) * 100}%` }}><Star size={size} className="fill-amber-400 text-amber-400" /></span>
        </span>
      ))}
    </span>
  );
}
const RatingCell = ({ r }) => (r?.rating != null
  ? <span className="inline-flex items-center gap-1.5"><Stars value={r.rating} /><span className="text-xs font-semibold text-slate-700">{Number(r.rating).toFixed(1)}</span></span>
  : <span className="text-slate-300">—</span>);

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
  const list = useMemo(() => trainees.filter((t) => !t.deleted_at && [t.name, t.employee_code, t.official_email].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 60), [trainees, q]);
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
  const { trainees, loading, reload: reloadTrainees } = useTrainees({ includeInactive: true, includeDeleted: true, trainerId: isManager ? null : profile.id });
  const { trainers } = useTrainers();
  const { rows: responses, loading: rLoading, reload: reloadResponses } = useFeedback(form);
  // The other tracked form too: it tells us which batches are filling THAT form, so they are not listed as pending here
  const otherForm = form === 'sales' ? 'nht' : 'sales';
  const { rows: otherResponses, reload: reloadOther } = useFeedback(otherForm);
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

  // A response that names ME as the trainer can be linked to a trainee who is not in my own trainee list (a trainer cannot read
  // other trainers' trainees). It still belongs in the normal list: its name, E Code and batch were copied onto the response.
  const ghosts = useMemo(() => {
    if (!tracked) return [];
    const mine = new Set(trainees.map((t) => t.id));
    const seen = new Set();
    const out = [];
    responses.forEach((r) => {
      if (!r.trainee_id || mine.has(r.trainee_id) || seen.has(r.trainee_id)) return;
      seen.add(r.trainee_id);
      out.push({ id: r.trainee_id, ghost: true, name: r.matched_name || r.respondent_name || r.respondent_email || 'Trainee', employee_code: r.matched_code || null,
        official_email: r.respondent_email || null, status: 'active', trainer_id: r.trainer_id, batch_id: null, _batch: r.matched_batch ? { code: r.matched_batch } : null, deleted_at: null });
    });
    return out;
  }, [trainees, responses, tracked]);
  const pool = useMemo(() => {
    if (trainerId === 'all') return [...scopeTo(trainees, 'all'), ...ghosts];
    const mine = scopeTo(trainees, trainerId);
    const have = new Set(mine.map((t) => t.id));
    const named = new Set(responses.filter((r) => r.trainee_id && r.trainer_id === trainerId).map((r) => r.trainee_id));   // feedback that names this trainer
    return [...mine, ...trainees.filter((t) => named.has(t.id) && !have.has(t.id))];
  }, [trainees, trainerId, ghosts, responses]);
  const batchKey = (t) => t._batch?.code || t.batch_id || 'none';   // a batch code is unique, so people of one batch always group together
  // Everyone who has given feedback is listed (even if removed from attendance later). Someone with NO feedback is "pending"
  // only if they can still be asked: active, joined, and not resigned / not certified / dropped out.
  const expected = (t) => t.status === 'active' && !t.deleted_at && !notJoining(t) && (!t.exit_reason || t.exit_reason === 'handover');
  // Who belongs to THIS form? Not the batch label alone (a batch can be labelled "NHT" while it is really filling the Sales
  // form). Someone with feedback in this form belongs to it, and so does the rest of their batch. A batch that is filling the
  // OTHER form is left out. Only when there is no feedback either way does the batch label decide.
  const inForm = useMemo(() => {
    if (!tracked) return [];
    const byId = Object.fromEntries(pool.map((t) => [t.id, t]));
    const batchesOf = (rs) => new Set(rs.filter((r) => r.trainee_id && byId[r.trainee_id]?.batch_id).map((r) => byId[r.trainee_id].batch_id));
    const mine = batchesOf(responses); const theirs = batchesOf(otherResponses);
    const gaveOther = new Set(otherResponses.filter((r) => r.trainee_id).map((r) => r.trainee_id));
    return pool.filter((t) => {
      if (byTrainee[t.id]) return true;                                    // has feedback in this form
      if (!expected(t) || gaveOther.has(t.id)) return false;               // cannot be asked, or gave the other form's feedback
      const m = mine.has(t.batch_id); const o = theirs.has(t.batch_id);
      if (m !== o) return m;                                               // their batch clearly fills one of the two forms
      return TRACK[form](t);                                               // no evidence either way: the batch label decides
    });
  }, [pool, tracked, form, byTrainee, responses, otherResponses]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const finished = (t) => t.ghost || !traineeActiveOn(t, now.date) || sentToFloor(t);
  const stageLabel = (t) => (t.ghost ? '' : t.deleted_at ? 'Removed' : t.exit_reason && t.exit_reason !== 'handover' ? EXIT_LABELS[t.exit_reason] || 'Left' : finished(t) ? 'Finished' : 'In training');
  const afterTraining = useMemo(() => inForm.filter((t) => t.ghost || training === 'all' || (training === 'finished' ? finished(t) : !finished(t))), [inForm, training, now.date]); // eslint-disable-line react-hooks/exhaustive-deps
  const batches = useMemo(() => {
    const m = new Map();
    afterTraining.forEach((t) => {
      const k = batchKey(t);
      const g = m.get(k) || { id: k, code: t._batch?.code || 'No batch', total: 0, done: 0 };
      g.total += 1; if (byTrainee[t.id]) g.done += 1;
      m.set(k, g);
    });
    return [...m.values()].sort((a, b) => (b.total - b.done) - (a.total - a.done) || a.code.localeCompare(b.code));
  }, [afterTraining, byTrainee]);

  const scoped = afterTraining.filter((t) => batchId === 'all' || batchKey(t) === batchId);
  const submitted = scoped.filter((t) => byTrainee[t.id]).length;
  const pending = scoped.length - submitted;
  const rows = scoped
    .filter((t) => status === 'all' || (status === 'submitted' ? byTrainee[t.id] : !byTrainee[t.id]))
    .filter((t) => [t.name, t.employee_code, t.official_email].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => Number(Boolean(byTrainee[a.id])) - Number(Boolean(byTrainee[b.id])) || (a._batch?.code || '').localeCompare(b._batch?.code || '') || a.name.localeCompare(b.name));
  // Stars: the average of the rating questions in the responses being looked at (follows the batch / trainer / stage filters)
  const wholeView = trainerId === 'all' && batchId === 'all' && training === 'all';
  const scopedIds = new Set(scoped.map((t) => t.id));
  const basis = !tracked || wholeView ? responses : responses.filter((r) => {
    if (trainerId !== 'all' && r.trainer_id && r.trainer_id !== trainerId) return false;                          // it names ANOTHER trainer: not theirs
    if (trainerId !== 'all' && batchId === 'all' && training === 'all' && r.trainer_id === trainerId) return true;  // it names THIS trainer, whoever wrote it
    return Boolean(r.trainee_id && scopedIds.has(r.trainee_id));
  });
  const rated = basis.filter((r) => r.rating != null);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const avg = rated.length ? mean(rated.map((r) => Number(r.rating))) : null;
  const dist = [5, 4, 3, 2, 1].map((n) => rated.filter((r) => Math.min(5, Math.max(1, Math.round(Number(r.rating)))) === n).length);
  const byQuestion = (() => {
    const m = {};
    rated.forEach((r) => Object.entries(r.ratings || {}).forEach(([q, v]) => { (m[q] ||= []).push(Number(v)); }));
    return Object.entries(m).map(([q, a]) => ({ q, avg: mean(a), n: a.length })).sort((a, b) => b.avg - a.avg);
  })();
  const byTrainer = (() => {
    if (!isManager) return [];
    const m = {};
    rated.forEach((r) => {
      const t = r.trainee_id ? tById[r.trainee_id] : null;
      // The trainer the feedback is FOR comes first (named in the form, or the trainer a whole sheet belongs to). The trainee's own
      // trainer is only the fallback, for forms that do not say.
      const name = form === 'sales' ? SALES_TRAINER : (r.trainer_id && names[r.trainer_id]) || r.trainer_name || (t && (names[t.trainer_id] || t.trainer_label)) || '';
      if (name) (m[name] ||= []).push(Number(r.rating));
    });
    return Object.entries(m).map(([name, a]) => ({ name, avg: mean(a), n: a.length })).sort((a, b) => b.avg - a.avg);
  })();
  const trainerOf = (t) => (form === 'sales' ? SALES_TRAINER : null) || names[t.trainer_id] || t.trainer_label || '—';

  const refresh = async () => {
    setRefreshing(true);
    try {
      const j = await authFetch('/api/feedback-run', { method: 'POST' });
      showToast(j.running ? j.message : `Feedback sheet read: ${j.rows} response${j.rows === 1 ? '' : 's'}${j.matched ? `, ${j.matched} newly matched` : ''}.`);
      await Promise.all([reloadResponses(), reloadOther(), reloadTrainees()]);
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
    headers: ['E Code', 'E Name', 'Batch', 'Trainer', 'Status', meta.label + ' feedback', 'Rating (out of 5)', 'Submitted on'],
    rows: rows.map((t) => [t.employee_code || '', t.name, t._batch?.code || '', trainerOf(t), stageLabel(t),
      byTrainee[t.id] ? 'Submitted' : 'Pending', byTrainee[t.id]?.rating ?? '', byTrainee[t.id]?.submitted_at ? fmtDateTime(byTrainee[t.id].submitted_at, tz) : '']),
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
        headers: ['Submitted on', 'Rating (out of 5)', 'Name (form)', 'Email', 'Trainer (form)', 'Batch (form)', 'Matched trainee', 'E Code', 'Matched batch', ...qs],
        rows: all.map((r) => {
          const t = tmap[r.trainee_id];
          const a = Object.fromEntries((r.answers || []).map((x) => [x.q, x.a]));
          return [r.submitted_at ? fmtDateTime(r.submitted_at, tz) : '', r.rating ?? '', r.respondent_name || '', r.respondent_email || '', r.trainer_name || '', r.batch_code || '',
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
        {rated.length > 0 ? (
          <div className="panel p-5">
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="flex items-center gap-4">
                <div className="font-display text-5xl font-bold tracking-tight text-ink-800">{avg.toFixed(1)}</div>
                <div>
                  <Stars value={avg} size={22} />
                  <div className="mt-1 text-xs text-slate-500">{rated.length} rating{rated.length === 1 ? '' : 's'} · out of 5{!wholeView ? ' · current filters' : ''}</div>
                </div>
              </div>
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map((n, i) => (
                  <div key={n} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="w-6 shrink-0">{n} ★</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-400" style={{ width: `${(dist[i] * 100) / rated.length}%` }} /></div>
                    <span className="w-6 shrink-0 text-right">{dist[i]}</span>
                  </div>
                ))}
              </div>
              <div>
                {byTrainer.length >= 1 ? (
                  <>
                    <div className="mb-2 text-xs font-semibold text-slate-500">{byTrainer.length > 1 ? 'Top rated trainers' : 'Rated trainer'}</div>
                    <div className="space-y-1.5">
                      {byTrainer.slice(0, 5).map((t, i) => (
                        <div key={t.name} className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate text-slate-700"><span className="mr-1.5 text-xs text-slate-400">{i + 1}.</span>{t.name}</span>
                          <span className="flex shrink-0 items-center gap-1.5"><Stars value={t.avg} size={12} /><b className="w-7 text-right text-slate-800">{t.avg.toFixed(1)}</b><span className="w-9 text-xs text-slate-400">({t.n})</span></span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <div className="text-xs text-slate-500">Stars are the average of the rating questions in the form (1–5 scale; a 1–10 question is converted to 5 stars).</div>}
              </div>
            </div>
            {byQuestion.length > 1 && (
              <div className="mt-5 grid gap-x-8 gap-y-2 border-t border-slate-100 pt-4 sm:grid-cols-2">
                {byQuestion.map((x) => (
                  <div key={x.q} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-slate-600" title={x.q}>{x.q}</span>
                    <span className="flex shrink-0 items-center gap-1.5"><Stars value={x.avg} size={12} /><b className="w-7 text-right text-slate-800">{x.avg.toFixed(1)}</b></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (responses.length > 0 && isManager && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
            No star ratings yet. They appear when the form has rating questions (a 1–5 scale) and the sheet has been refreshed (Refresh from sheet).
          </div>
        ))}

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
                <label className="label" htmlFor="fb-training">Stage</label>
                <select id="fb-training" className="input" value={training} onChange={(e) => { setTraining(e.target.value); setBatchId('all'); }}>
                  <option value="all">All</option><option value="finished">Finished / left</option><option value="training">Still in training</option>
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
                    <thead className="sticky top-0 z-10"><tr><th>E Code</th><th>E Name</th><th>Batch</th>{isManager && <th>Trainer</th>}<th>Status</th><th>Feedback</th><th>Rating</th><th>Submitted</th><th /></tr></thead>
                    <tbody>
                      {rows.map((t) => {
                        const r = byTrainee[t.id];
                        return (
                          <tr key={t.id} className={r ? '' : 'bg-amber-50/40'}>
                            <td className="text-slate-600">{t.employee_code || '—'}</td>
                            <td><div className="font-semibold text-slate-800">{t.name}</div>{t.ghost && <div className="text-[11px] text-slate-400">Named you as the trainer</div>}</td>
                            <td className="text-slate-600">{t._batch?.code || '—'}</td>
                            {isManager && <td className="text-slate-600">{trainerOf(t)}</td>}
                            <td className="text-slate-600">{stageLabel(t)}</td>
                            <td>{r
                              ? <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">✓ Submitted</span>
                              : <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">⏳ Pending</span>}</td>
                            <td><RatingCell r={r} /></td>
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
                <thead className="sticky top-0 z-10"><tr><th>Name in form</th><th>Email</th><th>Trainer in form</th><th>Batch in form</th>{tracked && <th>Status</th>}<th>Rating</th><th>Submitted</th><th /></tr></thead>
                <tbody>
                  {rest.map((r) => (
                    <tr key={r.id}>
                      <td className="font-semibold text-slate-800">{r.respondent_name || '—'}</td>
                      <td className="text-slate-600">{r.respondent_email || '—'}</td>
                      <td className="text-slate-600">{form === 'sales' ? SALES_TRAINER : r.trainer_name || (r.trainer_id ? names[r.trainer_id] : '') || '—'}</td>
                      <td className="text-slate-600">{r.batch_code || '—'}</td>
                      {tracked && <td className="text-xs text-slate-600">{r.trainee_id ? `Linked to ${tById[r.trainee_id]?.name || 'a trainee'}, not in the list above` : 'Not linked'}</td>}
                      <td><RatingCell r={r} /></td>
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
