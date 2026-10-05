'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowRightLeft, ClipboardPaste, FileUp, Layers, Repeat, Undo2, Pencil, Plus, RotateCcw, Search, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, ErrorText, Modal, PageHeader, PageLoader, Spinner } from '@/components/ui';
import { useTrainees, useTrainers } from '@/lib/hooks';
import { sb } from '@/lib/supabase';
import { addDays, fmtMedium } from '@/lib/dates';
import { EXIT_LABELS, openPeriod, periodsOf, traineeActiveOn } from '@/lib/status';
import { parseTraineeRows } from '@/lib/parseTrainees';
import DossierImport from '@/components/trainees/DossierImport';
import RagModal, { canEditRag, RagChip } from '@/components/trainees/RagModal';
import SyncNowButton from '@/components/SyncNowButton';

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Batches this user can put trainees into: manager → any active batch;
// trainer → batches they own or that have trainees currently with them
function usableBatches(batches, trainees, profile) {
  return batches.filter((b) => b.status === 'active' && (profile.role === 'manager' || b.trainer_id === profile.id
    || trainees.some((t) => t.batch_id === b.id && t.trainer_id === profile.id)));
}

function BatchSelect({ id, value, onChange, batches, trainees, trainerNames, allowNone = true }) {
  const { profile } = useApp();
  const list = usableBatches(batches, trainees, profile);
  return (
    <select id={id} className="input" value={value || ''} onChange={onChange}>
      {allowNone && <option value="">No batch</option>}
      {list.map((b) => <option key={b.id} value={b.id}>{b.code}{b.name ? ` · ${b.name}` : ''}{profile.role === 'manager' && b.trainer_id ? ` (${trainerNames[b.trainer_id] || 'trainer'})` : ''}</option>)}
    </select>
  );
}

// Trainer history of one trainee
function TrainerHistory({ t, trainerNames }) {
  const { profile } = useApp();
  const list = t._assign?.length ? t._assign : [{ trainer_id: t.trainer_id, start_date: t.joining_date, end_date: null, purpose: t._batch?.purpose || 'NHT' }];
  return (
    <ol className="space-y-1.5 text-sm">
      {list.map((a, i) => (
        <li key={a.id || i} className="flex flex-wrap items-center gap-2">
          {i > 0 && <ArrowRight size={13} className="text-slate-400" />}
          <span className="font-semibold text-slate-800">{a.trainer_id === profile.id ? 'You' : trainerNames[a.trainer_id] || 'Trainer'}</span>
          <span className="rounded bg-ink-50 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">{a.purpose}</span>
          <span className="text-slate-500">{fmtMedium(a.start_date)} → {a.end_date ? fmtMedium(a.end_date) : 'now'}</span>
        </li>
      ))}
    </ol>
  );
}

// Switch selected trainees (all / half a batch / one) to another trainer from a date
function SwitchTrainer({ items, title, trainers, trainerNames, onClose, onDone }) {
  const { now, profile } = useApp();
  const [trainerId, setTrainerId] = useState('');
  const [from, setFrom] = useState(now.date);
  const [purpose, setPurpose] = useState('Sales Training');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const currentNames = [...new Set(items.map((t) => (t.trainer_id === profile.id ? 'You' : trainerNames[t.trainer_id] || 'Not assigned')))].join(', ');
  const save = async () => {
    if (!trainerId) { setError('Choose the new trainer.'); return; }
    setSaving(true);
    setError('');
    const { data, error: err } = await sb().rpc('transfer_trainees', { p_trainees: items.map((t) => t.id), p_trainer: trainerId, p_from: from, p_purpose: purpose });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onDone(`${data} trainee${data === 1 ? '' : 's'} switched to ${trainerNames[trainerId]} from ${fmtMedium(from)}.`);
    onClose();
  };
  return (
    <Modal title={title || `Switch ${items.length} trainee${items.length === 1 ? '' : 's'} to another trainer`} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner size={16} />}Switch trainer</button></>}>
      <ul className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
        {items.map((t) => <li key={t.id} className="py-0.5">{t.name}{t._batch ? <span className="text-slate-400"> · {t._batch.code}</span> : null}</li>)}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Currently with: {currentNames}. Only the trainees listed here move; the rest of their batch stays as it is.</p>
      <div className="mt-4 space-y-4">
        <div>
          <label className="label" htmlFor="sw-trainer">New trainer</label>
          <select id="sw-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
            <option value="">Choose trainer</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sw-from">New trainer takes over from</label>
          <input id="sw-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          {from && <p className="mt-1.5 text-xs text-slate-500">Days up to {fmtMedium(addDays(from, -1))} stay with the current trainer. From {fmtMedium(from)} these trainees appear on the new trainer’s register, calendar and sheet.</p>}
        </div>
        <div>
          <label className="label" htmlFor="sw-purpose">Training</label>
          <input id="sw-purpose" className="input" list="purpose-list" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          <datalist id="purpose-list">{['NHT', 'Sales Training', 'Product Training', 'Refresher Training'].map((p) => <option key={p} value={p} />)}</datalist>
        </div>
      </div>
      <div className="mt-4"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

function NewBatch({ trainers, batches, onClose, onDone }) {
  const { profile, settings, now } = useApp();
  const isManager = profile.role === 'manager';
  const [trainerId, setTrainerId] = useState(isManager ? '' : profile.id);
  const [start, setStart] = useState(now.date);
  const [purpose, setPurpose] = useState('NHT');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const prefix = settings.batch_prefix || 'NHT';
  const max = batches.reduce((n, b) => { const m = b.code.match(new RegExp(`^${prefix}(\\d+)$`)); return m ? Math.max(n, +m[1]) : n; }, 0);
  const nextCode = `${prefix}${String(max + 1).padStart(2, '0')}`;
  const save = async () => {
    if (!trainerId) { setError('Choose the trainer.'); return; }
    setSaving(true);
    setError('');
    const { data, error: err } = await sb().rpc('create_batch', { p_trainer: trainerId, p_start: start, p_purpose: purpose, p_name: name || null });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onDone(`Batch ${data?.code || ''} created. Add trainees to it with Paste from Excel, Add Trainee, or Move to batch.`, data?.id);
    onClose();
  };
  return (
    <Modal title="New batch" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner size={16} />}Create batch</button></>}>
      <div className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-800">The code is generated automatically. Next: <b>{nextCode}</b></div>
      <div className="mt-4 space-y-4">
        {isManager ? (
          <div>
            <label className="label" htmlFor="nb-trainer">Trainer</label>
            <select id="nb-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="">Choose trainer</option>
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        ) : <div className="text-sm text-slate-600">Trainer: <b>{profile.name}</b></div>}
        <div><label className="label" htmlFor="nb-start">Batch starts on</label><input id="nb-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><label className="label" htmlFor="nb-purpose">Training</label><input id="nb-purpose" className="input" list="purpose-list-nb" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          <datalist id="purpose-list-nb">{['NHT', 'Sales Training', 'Product Training', 'Refresher Training'].map((p) => <option key={p} value={p} />)}</datalist></div>
        <div><label className="label" htmlFor="nb-name">Label (optional)</label><input id="nb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmedabad October joiners" /></div>
      </div>
      <div className="mt-4"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

// Summary card for the selected batch
function BatchPanel({ batch, members, trainerNames, isManager, onSwitchAll, onSelectAll, onUndoAll, onStatus }) {
  const { profile, now } = useApp();
  const live = members.filter((t) => !t.deleted_at);
  const inTraining = live.filter((t) => traineeActiveOn(t, now.date)).length;
  const byTrainer = live.reduce((m, t) => { const k = t.trainer_id || 'none'; m[k] = (m[k] || 0) + 1; return m; }, {});
  // Combined history: who had how many trainees, from when
  const segs = {};
  live.forEach((t) => (t._assign || []).forEach((a) => {
    const key = `${a.trainer_id}|${a.start_date}|${a.end_date || ''}|${a.purpose}`;
    (segs[key] ||= { ...a, count: 0 }).count += 1;
  }));
  const history = Object.values(segs).sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
  const name = (id) => (id === profile.id ? 'You' : trainerNames[id] || 'Not assigned');
  const canSwitch = isManager || live.some((t) => t.trainer_id === profile.id);
  return (
    <div className="panel p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-ink-500" />
            <span className="font-display text-2xl font-extrabold tracking-tight text-ink-900">{batch.code}</span>
            <span className="rounded bg-ink-50 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">{batch.purpose}</span>
            {batch.status === 'closed' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Closed</span>}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {batch.name ? `${batch.name} · ` : ''}Started {batch.start_date ? fmtMedium(batch.start_date) : '—'} by {name(batch.trainer_id)} · {inTraining} of {live.length} in training today
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSwitch && live.length > 0 && <button className="btn-secondary btn-sm" onClick={onSwitchAll}><Repeat size={14} />Switch whole batch</button>}
          {live.length > 0 && <button className="btn-secondary btn-sm" onClick={onSelectAll}>Select trainees to switch part</button>}
          {isManager && history.length > 0 && <button className="btn-ghost btn-sm" onClick={onUndoAll}><Undo2 size={14} />Undo last switch</button>}
          {isManager && (batch.status === 'active'
            ? <button className="btn-ghost btn-sm" onClick={() => onStatus('closed')}>Close batch</button>
            : <button className="btn-ghost btn-sm" onClick={() => onStatus('active')}>Reopen</button>)}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(byTrainer).map(([id, n]) => (
          <span key={id} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{name(id === 'none' ? null : id)}: {n} trainee{n === 1 ? '' : 's'} now</span>
        ))}
      </div>
      {history.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-semibold text-slate-500">Trainer history</div>
          <ul className="space-y-1 text-sm">
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800">{name(h.trainer_id)}</span>
                <span className="rounded bg-ink-50 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">{h.purpose}</span>
                <span className="text-slate-500">{fmtMedium(h.start_date)} → {h.end_date ? fmtMedium(h.end_date) : 'now'} · {h.count} trainee{h.count === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TraineeForm({ initial, trainers, isManager, onClose, onSaved, batches, trainees, trainerNames }) {
  const { profile } = useApp();
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isNew = !f.id;
  const multi = !isNew && periodsOf(initial).length > 1;

  const save = async () => {
    if (!clean(f.name) || !f.joining_date) { setError('Enter the trainee name and DOJ.'); return; }
    if (isManager && f.tcd_lwd && f.tcd_lwd < periodsOf(f).slice(-1)[0].start) { setError('TCD / LWD cannot be before the current training start date.'); return; }
    const becomesHandover = isManager && f.tcd_lwd && (f.exit_reason || 'handover') === 'handover'
      && !(initial.tcd_lwd === f.tcd_lwd && (initial.exit_reason || '') === 'handover');
    if (becomesHandover && !initial.rag) { setError('Mark RAG for this trainee before handover. Click the RAG chip in the list, then set the TCD.'); return; }
    setSaving(true);
    setError('');
    const row = {
      name: f.name.trim(), employee_code: clean(f.employee_code), department: clean(f.department),
      official_email: clean(f.official_email)?.toLowerCase() || null, personal_email: clean(f.personal_email)?.toLowerCase() || null,
      reporting_manager: clean(f.reporting_manager),
      batch_id: f.batch_id || null,
    };
    // Trainer is chosen when adding. Later changes go through "Switch trainer" so history is kept.
    if (isNew) row.trainer_id = isManager ? (f.trainer_id || null) : profile.id;
    // DOJ, TCD and training status: managers only (trainers can set DOJ when adding a new trainee)
    if (isManager) {
      row.joining_date = f.joining_date;
      row.tcd_lwd = f.tcd_lwd || null;
      row.exit_reason = f.exit_reason || (f.tcd_lwd ? 'handover' : null);
    } else if (isNew) {
      row.joining_date = f.joining_date;
    }
    const { error: err } = isNew
      ? await sb().from('trainees').insert({ ...row, created_by: profile.id })
      : await sb().from('trainees').update(row).eq('id', f.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved(isNew ? 'Trainee added.' : 'Trainee updated.');
    onClose();
  };

  return (
    <Modal title={isNew ? 'Add trainee' : 'Edit trainee'} onClose={onClose} wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner size={16} />}{isNew ? 'Add trainee' : 'Save changes'}</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="t-name">E Name</label><input id="t-name" className="input" value={f.name} onChange={set('name')} /></div>
        <div><label className="label" htmlFor="t-code">E Code</label><input id="t-code" className="input" value={f.employee_code || ''} onChange={set('employee_code')} placeholder="5601" /></div>
        <div><label className="label" htmlFor="t-pmail">Personal email</label><input id="t-pmail" type="email" className="input" value={f.personal_email || ''} onChange={set('personal_email')} placeholder="name@gmail.com" /></div>
        <div><label className="label" htmlFor="t-omail">Official email</label><input id="t-omail" type="email" className="input" value={f.official_email || ''} onChange={set('official_email')} placeholder="name@petpooja.com" /><p className="mt-1 text-xs text-slate-400">Shown instead of the personal email once filled in.</p></div>
        <div>
          <label className="label" htmlFor="t-doj">DOJ</label>
          <input id="t-doj" type="date" className="input disabled:bg-slate-50 disabled:text-slate-500" value={f.joining_date || ''} onChange={set('joining_date')} disabled={!isManager && !isNew} />
          {!isManager && !isNew && <p className="mt-1 text-xs text-slate-400">Only a manager can change the DOJ.</p>}
        </div>
        <div><label className="label" htmlFor="t-rm">Reporting manager</label><input id="t-rm" className="input" value={f.reporting_manager || ''} onChange={set('reporting_manager')} placeholder="Handed over to after training" /></div>
        {isManager && (
          <>
            <div>
              <label className="label" htmlFor="t-exit">Training status{multi ? ' (current period)' : ''}</label>
              <select id="t-exit" className="input" value={f.exit_reason || ''} onChange={set('exit_reason')}>
                {Object.entries(EXIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="t-tcd">TCD / LWD{multi ? ' (current period)' : ''}</label>
              <input id="t-tcd" type="date" className="input" value={f.tcd_lwd || ''} onChange={set('tcd_lwd')} />
              <p className="mt-1 text-xs text-slate-400">Last training day. To hand over, you can also use the Handover button.</p>
            </div>
          </>
        )}
        <div><label className="label" htmlFor="t-dept">Department</label><input id="t-dept" className="input" value={f.department || ''} onChange={set('department')} /></div>
        <div>
          <label className="label" htmlFor="t-batch">Batch</label>
          <BatchSelect id="t-batch" value={f.batch_id} onChange={set('batch_id')} batches={batches} trainees={trainees} trainerNames={trainerNames} />
        </div>
        {isManager && isNew && (
          <div>
            <label className="label" htmlFor="t-trainer">Trainer</label>
            <select id="t-trainer" className="input" value={f.trainer_id || ''} onChange={set('trainer_id')}>
              <option value="">{f.batch_id ? 'Batch’s trainer' : 'Not assigned'}</option>
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {!isNew && (
        <div className="mt-4 rounded-xl border border-slate-200 p-3.5">
          <div className="mb-2 text-xs font-semibold text-slate-500">Trainer history <span className="font-normal">(use Switch trainer to change)</span></div>
          <TrainerHistory t={initial} trainerNames={trainerNames} />
        </div>
      )}
      {!isManager && <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">Handover to the reporting manager and TCD / LWD are set by your manager.</p>}
      {!isNew && (
        <div className="mt-4 rounded-xl border border-slate-200 p-3.5">
          <div className="mb-2 text-xs font-semibold text-slate-500">Training history</div>
          <PeriodList t={initial} />
        </div>
      )}
      <div className="mt-4"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

/** Manager only: hand over to reporting manager, or bring back for training. Works for one or many trainees. */
function HandoverModal({ items: initialItems, mode, onClose, onDone, onSetRag }) {
  const { now } = useApp();
  const [items, setItems] = useState(initialItems);
  const single = items.length === 1 ? items[0] : null;
  const [date, setDate] = useState(now.date);
  const [rm, setRm] = useState(single?.reporting_manager || '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const isHandover = mode === 'handover';

  const missingRag = isHandover ? items.filter((t) => !t.rag && !periodsOf(t)[periodsOf(t).length - 1].end) : [];
  const setRagFor = (t) => onSetRag(t, (saved) => setItems((list) => list.map((x) => (x.id === t.id ? { ...x, ...saved } : x))));

  const run = async () => {
    if (!date) { setError('Choose a date.'); return; }
    if (missingRag.length) { setError(''); return; }
    setWorking(true);
    setError('');
    let done = 0;
    const skipped = [];
    for (const t of items) {
      const periods = periodsOf(t).map((p) => ({ ...p }));
      const last = periods[periods.length - 1];
      const row = {};
      if (isHandover) {
        if (last.end) { skipped.push(`${t.name} (already handed over)`); continue; }
        if (date < last.start) { skipped.push(`${t.name} (training started ${fmtMedium(last.start)})`); continue; }
        last.end = date;
        last.reason = 'handover';
        if (rm.trim()) row.reporting_manager = rm.trim();
      } else {
        if (!last.end) { skipped.push(`${t.name} (still in training)`); continue; }
        if (date <= last.end) { skipped.push(`${t.name} (must be after ${fmtMedium(last.end)})`); continue; }
        periods.push({ start: date, end: null, reason: null });
        row.status = 'active';
      }
      row.training_periods = periods;
      const { error: err } = await sb().from('trainees').update(row).eq('id', t.id);
      if (err) { skipped.push(`${t.name}: ${err.message}`); continue; }
      done += 1;
    }
    setWorking(false);
    if (skipped.length) {
      setError(`${done} updated. Skipped: ${skipped.join('; ')}`);
      onDone(null);
      return;
    }
    onDone(isHandover ? `${done} trainee${done === 1 ? '' : 's'} handed over.` : `${done} trainee${done === 1 ? '' : 's'} back in training.`);
    onClose();
  };

  return (
    <Modal title={isHandover ? 'Handover to reporting manager' : 'Bring back for training'} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={run} disabled={working || missingRag.length > 0}>{working && <Spinner size={16} />}{isHandover ? 'Confirm handover' : 'Bring back'}</button></>}>
      <p className="text-sm text-slate-600">{single ? <b>{single.name}</b> : <b>{items.length} trainees</b>}</p>
      <label className="label mt-4" htmlFor="ho-date">{isHandover ? 'Last training day (TCD)' : 'Training restarts on'}</label>
      <input id="ho-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      <p className="mt-1.5 text-xs text-slate-500">
        {isHandover
          ? (date ? `They stay on the register up to ${fmtMedium(date)}. From ${fmtMedium(addDays(date, 1))} they disappear from attendance, and the monthly sheet shows "Handover to Reporting Manager" on that day.` : '')
          : (date ? `They appear on their trainer's register again from ${fmtMedium(date)}. Their earlier attendance is kept.` : '')}
      </p>
      {missingRag.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <div className="font-semibold">Mark RAG before handover</div>
          <p className="mt-0.5 text-xs">{missingRag.length === 1 ? 'This trainee has' : `${missingRag.length} trainees have`} no RAG yet. Click a name to set it, then confirm the handover.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missingRag.map((t) => (
              <button key={t.id} onClick={() => setRagFor(t)} className="rounded-full border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">{t.name} · Set RAG</button>
            ))}
          </div>
        </div>
      )}
      {isHandover && (
        <>
          <label className="label mt-4" htmlFor="ho-rm">Reporting manager</label>
          <input id="ho-rm" className="input" value={rm} onChange={(e) => setRm(e.target.value)} placeholder={single ? 'Who they are handed over to' : 'Leave blank to keep each trainee’s current one'} />
        </>
      )}
      <div className="mt-4"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

function BulkAdd({ trainers, isManager, onClose, onSaved, batches, trainees, trainerNames, defaultBatch }) {
  const { profile } = useApp();
  const [text, setText] = useState('');
  const [trainerId, setTrainerId] = useState(isManager ? '' : profile.id);
  const [batchId, setBatchId] = useState(defaultBatch || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => parseTraineeRows(text), [text]);

  const save = async () => {
    if (!parsed.rows.length) { setError('Paste at least one row.'); return; }
    if (isManager && !trainerId && !batchId) { setError('Choose a batch or a trainer for these trainees.'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await sb().from('trainees').insert(parsed.rows.map((r) => ({ ...r, trainer_id: isManager ? (trainerId || null) : profile.id, batch_id: batchId || null, created_by: profile.id })));
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved(`${parsed.rows.length} trainees added.`);
    onClose();
  };

  return (
    <Modal title="Add trainees from Excel" onClose={onClose} wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !parsed.rows.length}>{saving && <Spinner size={16} />}Add {parsed.rows.length || ''} trainees</button></>}>
      <p className="text-sm text-slate-600">Copy rows from your attendance sheet starting at the <b>E Code</b> column and paste them below. The first 5 columns are used: E Code, E Name, DOJ, TCD / LWD, Reporting manager. Remarks like Resigned or Not Certified are picked up from the last column.</p>
      {!isManager && <p className="mt-2 text-xs text-slate-500">TCD / LWD and handover columns are ignored here. Your manager sets those.</p>}
      <div className="mt-4">
        <label className="label" htmlFor="b-batch">Batch</label>
        <BatchSelect id="b-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} batches={batches} trainees={trainees} trainerNames={trainerNames} />
      </div>
      {isManager && !batchId && (
        <div className="mt-4">
          <label className="label" htmlFor="b-trainer">Trainer</label>
          <select id="b-trainer" className="input" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
            <option value="">Choose trainer</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <textarea className="input mt-4 h-48 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'5393\tPrince Jagadish Singh\t06-Jul-26\tIn Training\tNabeel Ahmed\n5411\tRasamalla Steven\t06-Jul-26\t01-Sep-26\tA Rama Chary'} aria-label="Pasted rows" />
      {parsed.rows.length > 0 && (
        <div className="mt-3 max-h-40 overflow-auto rounded-xl border border-slate-200">
          <table className="tbl text-xs">
            <thead><tr><th>E Code</th><th>E Name</th><th>DOJ</th><th>TCD / LWD</th><th>Status</th><th>Reporting manager</th></tr></thead>
            <tbody>{parsed.rows.map((r, i) => (
              <tr key={i}><td>{r.employee_code || '—'}</td><td>{r.name}</td><td>{fmtMedium(r.joining_date)}</td><td>{isManager && r.tcd_lwd ? fmtMedium(r.tcd_lwd) : '—'}</td><td>{EXIT_LABELS[isManager ? (r.exit_reason || '') : '']}</td><td>{r.reporting_manager || '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {parsed.errors.length > 0 && <div className="mt-3"><ErrorText>{parsed.errors.slice(0, 5).join(' · ')}{parsed.errors.length > 5 ? ` · +${parsed.errors.length - 5} more` : ''}</ErrorText></div>}
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

function MoveToBatch({ items, batches, trainees, trainerNames, onClose, onDone }) {
  const [batchId, setBatchId] = useState(defaultBatch || '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setWorking(true);
    setError('');
    const ids = items.map((t) => t.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error: err } = await sb().from('trainees').update({ batch_id: batchId || null }).in('id', ids.slice(i, i + 100));
      if (err) { setError(err.message); setWorking(false); return; }
    }
    setWorking(false);
    onDone(batchId ? `${ids.length} trainee${ids.length === 1 ? '' : 's'} moved to the batch.` : `${ids.length} removed from their batch.`);
    onClose();
  };
  return (
    <Modal title={`Move ${items.length} trainee${items.length === 1 ? '' : 's'} to a batch`} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={run} disabled={working}>{working && <Spinner size={16} />}Move</button></>}>
      <label className="label" htmlFor="mv-batch">Batch</label>
      <BatchSelect id="mv-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} batches={batches} trainees={trainees} trainerNames={trainerNames} />
      <p className="mt-2 text-xs text-slate-500">This only changes the batch code. Their trainer stays the same; use Switch trainer to change it from a date.</p>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

function BulkDelete({ items, onClose, onDone }) {
  const { profile } = useApp();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setWorking(true);
    setError('');
    const ids = items.map((t) => t.id);
    let done = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error: err } = await sb().from('trainees')
        .update({ deleted_at: new Date().toISOString(), deleted_by: profile.id, status: 'inactive' })
        .in('id', ids.slice(i, i + 100)).select('id');
      if (err) { setError(err.message); setWorking(false); return; }
      done += (data || []).length;
    }
    setWorking(false);
    onDone(`${done} trainee${done === 1 ? '' : 's'} deleted. Their attendance and reports are kept.`);
    onClose();
  };
  return (
    <Modal title={`Delete ${items.length} trainee${items.length === 1 ? '' : 's'}?`} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={run} disabled={working}>{working && <Spinner size={16} />}Delete</button></>}>
      <ul className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
        {items.map((t) => <li key={t.id} className="py-0.5">{t.name}{t.employee_code ? <span className="text-slate-400"> · {t.employee_code}</span> : null}</li>)}
      </ul>
      <div className="mt-4 grid gap-2 text-sm">
        <div className="rounded-xl bg-red-50 px-3.5 py-2.5 text-red-800"><b>Removed from:</b> trainee list, daily register, calendar, dashboards and missed-day alerts.</div>
        <div className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-emerald-800"><b>Kept in:</b> Monthly Sheet, Excel downloads, Attendance History and Analytics. All their marked attendance stays.</div>
      </div>
      <p className="mt-3 text-xs text-slate-500">You can restore them later from the <b>Deleted</b> filter.</p>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

export default function TraineesPage() {
  const { profile, now, showToast } = useApp();
  const isManager = profile.role === 'manager';
  const { trainees, batches, loading, reload } = useTrainees(isManager ? { includeInactive: true, includeDeleted: true } : { includeInactive: true, includeDeleted: true, trainerId: profile.id });
  const { trainers } = useTrainers();
  const [switchItems, setSwitchItems] = useState(null); // { items, title }
  const [newBatch, setNewBatch] = useState(false);
  const [dossier, setDossier] = useState(false);
  const [ragFor, setRagFor] = useState(null);
  const trainerNames = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);
  const [batchFilter, setBatchFilter] = useState('all');
  const [moveItems, setMoveItems] = useState(null);
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('batch');
    if (b) { setBatchFilter(b); setShow('all'); }
  }, []);
  const trainerName = (id) => trainers.find((t) => t.id === id)?.name || 'Not assigned';
  const [q, setQ] = useState('');
  const [show, setShow] = useState('training');
  const [trainerFilter, setTrainerFilter] = useState('all');
  const [form, setForm] = useState(null);
  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [handover, setHandover] = useState(null); // { items, mode }

  const stage = (t) => (t.deleted_at ? 'deleted' : t.status !== 'active' ? 'inactive' : traineeActiveOn(t, now.date) ? 'training' : t.joining_date > now.date ? 'upcoming' : 'done');
  const filtered = trainees.filter((t) => ((show === 'all' && !t.deleted_at) || stage(t) === show)
    && (trainerFilter === 'all' || t.trainer_id === trainerFilter)
    && (batchFilter === 'all' || (batchFilter === 'none' ? !t.batch_id : t.batch_id === batchFilter))
    && [t.name, t.employee_code, t.reporting_manager, t.track, t.official_email, t.personal_email].some((v) => v?.toLowerCase().includes(q.toLowerCase())));
  const counts = trainees.reduce((m, t) => ({ ...m, [stage(t)]: (m[stage(t)] || 0) + 1 }), {});

  const toggle = async (t) => {
    const next = t.status === 'active' ? 'inactive' : 'active';
    const patch = next === 'active' ? { status: next, deleted_at: null, deleted_by: null } : { status: next };
    const { error } = await sb().from('trainees').update(patch).eq('id', t.id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast(next === 'inactive' ? 'Trainee removed from attendance.' : 'Trainee restored.');
    reload();
  };
  const visibleIds = filtered.map((t) => t.id);
  const selectedRows = trainees.filter((t) => selected.has(t.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allVisibleSelected) visibleIds.forEach((id) => n.delete(id)); else visibleIds.forEach((id) => n.add(id));
    return n;
  });
  const clearSelection = () => setSelected(new Set());
  const bulkStatus = async (status) => {
    const ids = selectedRows.map((t) => t.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await sb().from('trainees').update({ status }).in('id', ids.slice(i, i + 100));
      if (error) { showToast(error.message, 'error'); return; }
    }
    showToast(status === 'inactive' ? `${ids.length} removed from attendance.` : `${ids.length} restored.`);
    if (status === 'active') {
      for (let i = 0; i < ids.length; i += 100) await sb().from('trainees').update({ deleted_at: null, deleted_by: null }).in('id', ids.slice(i, i + 100));
    }
    clearSelection();
    reload();
  };

  const saved = (m) => { showToast(m); reload(); };
  const batch = batches.find((b) => b.id === batchFilter) || null;
  const batchMembers = batch ? trainees.filter((t) => t.batch_id === batch.id) : [];
  const batchCount = (id) => trainees.filter((t) => t.batch_id === id && !t.deleted_at).length;
  const undoSwitch = async (items) => {
    if (!window.confirm(`Undo the latest trainer switch for ${items.length} trainee${items.length === 1 ? '' : 's'}?`)) return;
    const { data, error } = await sb().rpc('undo_trainee_transfer', { p_trainees: items.map((t) => t.id) });
    if (error) { showToast(error.message, 'error'); return; }
    showToast(data ? `Switch undone for ${data} trainee${data === 1 ? '' : 's'}.` : 'Nothing to undo.');
    clearSelection();
    reload();
  };
  const setBatchStatus = async (status) => {
    const { error } = await sb().from('batches').update({ status }).eq('id', batch.id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast(status === 'closed' ? `${batch.code} closed.` : `${batch.code} reopened.`);
    reload();
  };
  const blank = { name: '', employee_code: '', official_email: '', personal_email: '', joining_date: now.date, tcd_lwd: '', exit_reason: '', reporting_manager: '', department: '', trainer_id: isManager ? '' : profile.id, batch_id: batchFilter !== 'all' && batchFilter !== 'none' ? batchFilter : '' };

  return (
    <div className="space-y-5">
      <PageHeader title={isManager ? 'Trainees & batches' : 'My trainees & batches'} subtitle={`${counts.training || 0} in training today`}
        actions={(
          <>
            <SyncNowButton onDone={reload} />
            {isManager && <button className="btn-secondary" onClick={() => setDossier(true)}><FileUp size={16} />Import from Dossier</button>}
            <button className="btn-secondary" onClick={() => setNewBatch(true)}><Layers size={16} />New Batch</button>
            <button className="btn-secondary" onClick={() => setBulk(true)}><ClipboardPaste size={16} />Paste from Excel</button>
            <button className="btn-primary" onClick={() => setForm(blank)}><Plus size={16} />Add Trainee</button>
          </>
        )} />

      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Batches">
        {[{ id: 'all', code: 'All trainees' }, ...batches.filter((b) => b.status === 'active' || b.id === batchFilter), { id: 'none', code: 'No batch' }].flatMap((b) => {
          const live = trainees.filter((t) => !t.deleted_at);
          const n = b.id === 'all' ? live.length : b.id === 'none' ? live.filter((t) => !t.batch_id).length : batchCount(b.id);
          const card = (key, title, sub, active, onClick) => (
            <button key={key} role="tab" aria-selected={active} onClick={onClick}
              className={`shrink-0 rounded-2xl border px-4 py-2.5 text-left transition-colors ${active ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
              <div className="text-sm font-bold">{title}</div>
              <div className={`text-[11px] ${active ? 'text-ink-200' : 'text-slate-400'}`}>{sub}</div>
            </button>
          );
          const pick = (batchId, trainerId) => { setBatchFilter(batchId); setTrainerFilter(trainerId); clearSelection(); if (batchId !== 'all') setShow('all'); };
          if (b.id === 'all' || b.id === 'none') {
            return [card(b.id, b.code, `${n} trainee${n === 1 ? '' : 's'}`, batchFilter === b.id && trainerFilter === 'all', () => pick(b.id, 'all'))];
          }
          // Split each batch by its current trainer so every trainer's group can be checked separately
          const byTrainer = {};
          live.filter((t) => t.batch_id === b.id).forEach((t) => { const k = t.trainer_id || 'none'; byTrainer[k] = (byTrainer[k] || 0) + 1; });
          const groups = Object.entries(byTrainer).sort((x, y) => y[1] - x[1]);
          const nameOf = (id) => (id === 'none' ? 'No trainer' : id === profile.id ? 'You' : trainerNames[id] || '—');
          const cards = [];
          if (groups.length !== 1) cards.push(card(b.id, b.code, `${n} trainee${n === 1 ? '' : 's'} · all trainers`, batchFilter === b.id && trainerFilter === 'all', () => pick(b.id, 'all')));
          groups.forEach(([tid, c]) => cards.push(card(`${b.id}-${tid}`, b.code, `${c} · ${nameOf(tid)}`,
            batchFilter === b.id && (trainerFilter === tid || (groups.length === 1 && trainerFilter === 'all')), () => pick(b.id, groups.length === 1 ? 'all' : tid))));
          return cards;
        })}
        {batches.some((b) => b.status === 'closed') && (
          <select className="input w-auto shrink-0" value="" onChange={(e) => { if (e.target.value) { setBatchFilter(e.target.value); setShow('all'); } }} aria-label="Closed batches">
            <option value="">Closed batches…</option>
            {batches.filter((b) => b.status === 'closed').map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </select>
        )}
      </div>

      {batch && (
        <BatchPanel batch={batch} members={batchMembers} trainerNames={trainerNames} isManager={isManager}
          onSwitchAll={() => setSwitchItems({ items: batchMembers.filter((t) => !t.deleted_at && (isManager || t.trainer_id === profile.id)), title: `Switch ${batch.code} to another trainer` })}
          onSelectAll={() => { setShow('all'); setSelected(new Set(batchMembers.filter((t) => !t.deleted_at).map((t) => t.id))); }}
          onUndoAll={() => undoSwitch(batchMembers)}
          onStatus={setBatchStatus} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="Search name, E Code or reporting manager" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trainees" />
        </div>
        {isManager && (
          <select className="input sm:w-52" value={trainerFilter} onChange={(e) => setTrainerFilter(e.target.value)} aria-label="Trainer">
            <option value="all">All trainers</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select className="input sm:w-56" value={show} onChange={(e) => setShow(e.target.value)} aria-label="Status filter">
          <option value="training">In training ({counts.training || 0})</option>
          <option value="upcoming">Joining soon ({counts.upcoming || 0})</option>
          <option value="done">Handed over / ended ({counts.done || 0})</option>
          <option value="inactive">Removed ({counts.inactive || 0})</option>
          <option value="deleted">Deleted, reports kept ({counts.deleted || 0})</option>
          <option value="all">All, except deleted ({trainees.filter((t) => !t.deleted_at).length})</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">
          <span className="font-semibold">{selected.size} selected</span>
          <button onClick={clearSelection} className="rounded-lg p-1 text-ink-200 hover:bg-white/10" aria-label="Clear selection"><X size={16} /></button>
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => bulkStatus('inactive')}><UserX size={14} />Remove from attendance</button>
            <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setSwitchItems({ items: selectedRows })}><Repeat size={14} />Switch trainer</button>
            {isManager && <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => undoSwitch(selectedRows)}><Undo2 size={14} />Undo switch</button>}
            <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setMoveItems(selectedRows)}><Layers size={14} />Move to batch</button>
            <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => bulkStatus('active')}><UserCheck size={14} />Restore</button>
            {isManager && <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setHandover({ items: selectedRows, mode: 'handover' })}><ArrowRightLeft size={14} />Handover</button>}
            {isManager && <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setHandover({ items: selectedRows, mode: 'return' })}><RotateCcw size={14} />Bring back for training</button>}
            {show !== 'deleted' && <button className="btn btn-sm bg-red-600 text-white hover:bg-red-700" onClick={() => setConfirmDelete(selectedRows)}><Trash2 size={14} />Delete</button>}
          </div>
        </div>
      )}

      <div className="panel overflow-hidden">
        {loading ? <PageLoader /> : filtered.length === 0 ? (
          <Empty title="No trainees here">Add trainees one by one, or paste rows straight from your Excel sheet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>
                <th className="w-10"><input type="checkbox" className="h-4 w-4 accent-ink-800" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all shown trainees" /></th>
                <th>E Code</th><th>E Name</th><th>Email</th><th>Batch</th><th>DOJ</th><th>TCD / LWD</th><th>Reporting manager</th><th>Trainer now</th><th>RAG</th><th className="text-right">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className={`${t.status !== 'active' ? 'opacity-60' : ''} ${selected.has(t.id) ? 'bg-ink-50' : ''}`}>
                    <td><input type="checkbox" className="h-4 w-4 accent-ink-800" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} aria-label={`Select ${t.name}`} /></td>
                    <td className="text-slate-600">{t.employee_code || '—'}</td>
                    <td>
                      <Link href={`/timeline?trainee=${t.id}`} className="font-semibold text-slate-800 hover:underline">{t.name}</Link>
                      {(t.track || t.designation) && <div className="text-xs text-slate-400">{[t.track, t.designation].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td className="text-xs">
                      {t.official_email ? <span className="text-slate-700">{t.official_email}</span>
                        : t.personal_email ? <span className="text-slate-500">{t.personal_email}<span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">personal</span></span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td>{t._batch ? <span className="rounded-md bg-ink-50 px-2 py-0.5 text-xs font-bold text-ink-700">{t._batch.code}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className="text-slate-600">{fmtMedium(t.joining_date)}</td>
                    <td className="text-slate-600">
                      {t.tcd_lwd ? fmtMedium(t.tcd_lwd) : EXIT_LABELS[t.exit_reason || '']}
                      {!t.tcd_lwd && !t.exit_reason && t.probable_handover_date && (() => {
                        const left = Math.round((Date.parse(t.probable_handover_date) - Date.parse(now.date)) / 86400000);
                        return (
                          <div className={`text-xs font-semibold ${left < 0 ? 'text-red-600' : left <= 7 ? 'text-amber-700' : 'text-slate-400'}`}>
                            Probable {fmtMedium(t.probable_handover_date)}{left < 0 ? ' · overdue' : left === 0 ? ' · today' : left <= 7 ? ` · in ${left} day${left === 1 ? '' : 's'}` : ''}
                          </div>
                        );
                      })()}
                      {t.tcd_lwd && t.exit_reason && <div className="text-xs text-slate-400">{EXIT_LABELS[t.exit_reason]}</div>}
                      {periodsOf(t).length > 1 && <div className="text-xs font-semibold text-ink-600">{openPeriod(t) ? 'Back in training' : 'Trained'} · {periodsOf(t).length} periods</div>}
                    </td>
                    <td className="text-slate-600">{t.reporting_manager || '—'}</td>
                    <td className="text-slate-600">
                      {t.trainer_id === profile.id ? 'You' : trainerNames[t.trainer_id] || trainerName(t.trainer_id)}
                      {t._assign?.length > 1 && <div className="text-xs text-slate-400">since {fmtMedium(t._assign[t._assign.length - 1].start_date)}</div>}
                    </td>
                    <td><RagChip rag={t.rag} onClick={canEditRag(t, profile) ? () => setRagFor(t) : undefined} /></td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {isManager && !['doj_revised', 'offer_revoked'].includes(t.exit_reason) && (openPeriod(t)
                          ? <button className="btn-ghost btn-sm" onClick={() => setHandover({ items: [t], mode: 'handover' })} title="Handover to reporting manager"><ArrowRightLeft size={14} />Handover</button>
                          : <button className="btn-ghost btn-sm" onClick={() => setHandover({ items: [t], mode: 'return' })} title="Bring back for training"><RotateCcw size={14} />Bring back</button>)}
                        <button className="btn-ghost btn-sm" onClick={() => setForm({ ...t, tcd_lwd: t.tcd_lwd || '', exit_reason: t.exit_reason || '' })} aria-label={`Edit ${t.name}`}><Pencil size={14} /></button>
                        <button className="btn-ghost btn-sm" onClick={() => toggle(t)} aria-label={t.status === 'active' ? `Remove ${t.name}` : `Restore ${t.name}`} title={t.status === 'active' ? 'Remove from attendance' : 'Restore'}>
                          {t.status === 'active' ? <UserX size={14} className="text-red-600" /> : <UserCheck size={14} className="text-emerald-600" />}
                        </button>
                        {!t.deleted_at && <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete([t])} aria-label={`Delete ${t.name}`} title="Delete (reports are kept)"><Trash2 size={14} className="text-red-600" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && <TraineeForm initial={form} trainers={trainers} isManager={isManager} batches={batches} trainees={trainees} trainerNames={trainerNames} onClose={() => setForm(null)} onSaved={saved} />}
      {bulk && <BulkAdd trainers={trainers} isManager={isManager} batches={batches} trainees={trainees} trainerNames={trainerNames} defaultBatch={batch?.id} onClose={() => setBulk(false)} onSaved={saved} />}
      {moveItems && <MoveToBatch items={moveItems} batches={batches} trainees={trainees} trainerNames={trainerNames} onClose={() => setMoveItems(null)} onDone={(m) => { showToast(m); clearSelection(); reload(); }} />}
      {switchItems && <SwitchTrainer items={switchItems.items} title={switchItems.title} trainers={trainers} trainerNames={trainerNames} onClose={() => setSwitchItems(null)} onDone={(m) => { showToast(m); clearSelection(); reload(); }} />}
      {dossier && <DossierImport trainers={trainers} trainees={trainees} onClose={() => setDossier(false)} onDone={(m) => { showToast(m); reload(); }} />}
      {newBatch && <NewBatch trainers={trainers} batches={batches} onClose={() => setNewBatch(false)} onDone={(m, id) => { showToast(m); reload(); if (id) { setBatchFilter(id); setShow('all'); } }} />}
      {handover && (
        <HandoverModal items={handover.items} mode={handover.mode} onClose={() => setHandover(null)}
          onSetRag={(t, done) => setRagFor({ ...t, _after: done })}
          onDone={(msg) => { if (msg) showToast(msg); clearSelection(); reload(); }} />
      )}
      {confirmDelete && (
        <BulkDelete items={confirmDelete} onClose={() => setConfirmDelete(null)}
          onDone={(msg) => { if (msg) showToast(msg); clearSelection(); reload(); }} />
      )}
      {/* last, so it opens on top of the handover dialog */}
      {ragFor && <RagModal trainee={ragFor} onClose={() => setRagFor(null)} onSaved={(saved) => { ragFor._after?.(saved); reload(); }} />}
    </div>
  );
}
