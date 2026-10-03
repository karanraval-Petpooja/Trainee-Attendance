'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Search } from 'lucide-react';
import { sb } from '@/lib/supabase';
import { addDays, fmtClock, fmtLong, fmtTime } from '@/lib/dates';
import { MARK_OPTIONS, outOfScope, STATUS, traineeActiveOn, trainerOn, weekOffReason } from '@/lib/status';
import { useApp } from './AppShell';
import { ErrorText, Modal, PageLoader, Spinner } from './ui';

const BTN_ON = {
  present: 'bg-emerald-600 text-white border-emerald-600',
  absent: 'bg-rose-600 text-white border-rose-600',
  half_day: 'bg-orange-500 text-white border-orange-500',
  holiday: 'bg-amber-400 text-amber-950 border-amber-400',
};

/**
 * The daily register: one row per trainee with Present / Absent / Half Day / Holiday.
 * Used inline on the dashboard and attendance page, and inside RegisterModal.
 */
export function RegisterList({ date, trainees, trainerNames, onSaved, maxHeight }) {
  const { profile, settings, now, tz, showToast } = useApp();
  const [records, setRecords] = useState({});
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  const wo = weekOffReason(date, settings);
  const future = date > now.date;
  const lockBefore = addDays(now.date, -settings.edit_window_days);
  const late = date < now.date || now.time > settings.attendance_deadline;

  const idKey = trainees.map((t) => t.id).join(',');
  const load = useCallback(async () => {
    setLoading(true);
    const ids = idKey ? idKey.split(',') : [];
    const map = {};
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb().from('attendance').select('*').in('trainee_id', ids.slice(i, i + 150)).eq('attendance_date', date);
      (data || []).forEach((r) => { map[r.trainee_id] = r; });
    }
    setRecords(map);
    setDraft({});
    setLoading(false);
  }, [date, idKey]);
  useEffect(() => { load(); }, [load]);

  const { active, outside } = useMemo(() => {
    const act = [];
    let out = 0;
    trainees.forEach((t) => (!outOfScope(t, date) && (traineeActiveOn(t, date) || records[t.id]) ? act.push(t) : (out += 1)));
    return { active: act, outside: out };
  }, [trainees, date, records]);

  const isLocked = (t) => profile.role === 'trainer' && records[t.id] && date < lockBefore;
  const valueOf = (t) => draft[t.id] ?? records[t.id]?.status ?? null;
  const changes = active.filter((t) => draft[t.id] && draft[t.id] !== records[t.id]?.status);
  const markedCount = active.filter((t) => valueOf(t)).length;
  const shown = active.filter((t) => [t.name, t.employee_code, t._batch?.code, trainerNames?.[trainerOn(t, date)]].some((v) => v && String(v).toLowerCase().includes(q.toLowerCase())));

  const setAll = (status) => {
    const next = { ...draft };
    active.forEach((t) => { if (!isLocked(t)) next[t.id] = status; });
    setDraft(next);
  };
  const setUnmarked = (status) => {
    const next = { ...draft };
    active.forEach((t) => { if (!isLocked(t) && !valueOf(t)) next[t.id] = status; });
    setDraft(next);
  };

  const save = async () => {
    if (!changes.length) return;
    setSaving(true);
    setError('');
    const { error: err } = await sb().rpc('mark_attendance', {
      p_date: date,
      p_items: changes.map((t) => ({ trainee_id: t.id, status: draft[t.id] })),
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    showToast(`Attendance saved for ${changes.length} trainee${changes.length === 1 ? '' : 's'}.`);
    await load();
    onSaved?.();
  };

  if (wo) {
    return <div className="rounded-2xl bg-sky-50 px-5 py-6 text-center text-sky-800"><div className="text-2xl">🔵</div><div className="mt-1 font-bold">Week Off ({wo})</div><div className="text-sm">No attendance is needed on {fmtLong(date)}.</div></div>;
  }
  if (future) {
    return <div className="rounded-2xl bg-slate-50 px-5 py-6 text-center text-slate-600">Attendance for {fmtLong(date)} can be marked on that day.</div>;
  }
  if (loading) return <PageLoader />;
  if (!active.length) {
    return <div className="rounded-2xl bg-slate-50 px-5 py-6 text-center text-slate-600">No trainees are in training on this date.{profile.role === 'trainer' && ' Add trainees from My Trainees.'}</div>;
  }

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-sm text-slate-600">
          <span className="font-bold text-ink-900">{markedCount}</span> of {active.length} marked
          {changes.length > 0 && <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-700">{changes.length} unsaved</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Mark all:</span>
          {MARK_OPTIONS.map((s) => (
            <button key={s} onClick={() => setAll(s)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300">
              {STATUS[s].icon} {STATUS[s].short}
            </button>
          ))}
          {markedCount > 0 && markedCount < active.length && (
            <button onClick={() => setUnmarked('present')} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50">Remaining → Present</button>
          )}
        </div>
      </div>

      {late && (
        <div className="mt-3 rounded-xl bg-orange-50 px-3.5 py-2 text-xs text-orange-800">
          {date < now.date ? 'This is a past date.' : `The ${fmtClock(settings.attendance_deadline)} deadline has passed.`} New entries will be recorded as late.
        </div>
      )}

      {active.length > 8 && (
        <div className="relative mt-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input py-2 pl-9" placeholder="Search trainee" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trainee" />
        </div>
      )}

      <ul className="mt-2 divide-y divide-slate-100 overflow-y-auto" style={maxHeight ? { maxHeight } : undefined}>
        {shown.map((t) => {
          const v = valueOf(t);
          const locked = isLocked(t);
          const rec = records[t.id];
          const changed = draft[t.id] && draft[t.id] !== rec?.status;
          return (
            <li key={t.id} className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${changed ? 'bg-ink-50/50' : ''}`}>
              <div className="min-w-0 px-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-slate-800">{t.name}</span>
                  {!v && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">Not marked</span>}
                </div>
                <div className="text-xs text-slate-400">
                  {[t.employee_code, t._batch?.code, trainerNames?.[trainerOn(t, date)]].filter(Boolean).join(' · ')}
                  {rec && <> · saved {fmtTime(rec.marked_at, tz)}{rec.is_late ? ' (late)' : ''}</>}
                </div>
              </div>
              <div className="flex items-center gap-1.5" role="radiogroup" aria-label={`Attendance for ${t.name}`}>
                {locked && <Lock size={14} className="mr-1 text-slate-400" aria-label="Locked" />}
                {MARK_OPTIONS.map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={v === s}
                    disabled={locked}
                    onClick={() => setDraft((d) => ({ ...d, [t.id]: s }))}
                    className={`min-w-[64px] rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v === s ? BTN_ON[s] : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                  >
                    {STATUS[s].short}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      {outside > 0 && <p className="mt-2 text-xs text-slate-400">{outside} trainee{outside === 1 ? ' is' : 's are'} not on this register for this date (before DOJ, handed over, or with another trainer).</p>}
      {profile.role === 'trainer' && date < lockBefore && Object.keys(records).length > 0 && (
        <p className="mt-1 text-xs text-slate-400">Saved entries older than {settings.edit_window_days} days are locked. Ask your manager to change them.</p>
      )}

      <div className="sticky bottom-0 mt-3 flex items-center justify-end gap-3 border-t border-slate-100 bg-white pt-3">
        <div className="flex-1"><ErrorText>{error}</ErrorText></div>
        {changes.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setDraft({})}>Undo changes</button>}
        <button className="btn-primary" onClick={save} disabled={saving || !changes.length}>
          {saving && <Spinner size={16} />}Save Attendance{changes.length ? ` (${changes.length})` : ''}
        </button>
      </div>
    </div>
  );
}

export function RegisterModal({ date, trainees, trainerNames, onClose, onSaved }) {
  return (
    <Modal title={`Attendance · ${fmtLong(date)}`} onClose={onClose} wide>
      <RegisterList date={date} trainees={trainees} trainerNames={trainerNames} maxHeight="55vh" onSaved={onSaved} />
    </Modal>
  );
}
