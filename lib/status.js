import { addDays, dayOfWeek, nthWeekdayOfMonth, rangeKeys } from './dates';

export const STATUS = {
  present:    { label: 'PRESENT', short: 'Present', icon: '🟢', card: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', chip: 'bg-emerald-100 text-emerald-800', letter: 'P' },
  absent:     { label: 'ABSENT', short: 'Absent', icon: '🔴', card: 'bg-rose-50 border-rose-200', text: 'text-rose-700', chip: 'bg-rose-100 text-rose-800', letter: 'A' },
  half_day:   { label: 'HALF DAY', short: 'Half Day', icon: '🟠', card: 'bg-orange-50 border-orange-200', text: 'text-orange-700', chip: 'bg-orange-100 text-orange-800', letter: 'HD' },
  holiday:    { label: 'HOLIDAY', short: 'Holiday', icon: '🟡', card: 'bg-amber-50 border-amber-200', text: 'text-amber-700', chip: 'bg-amber-100 text-amber-800', letter: 'H' },
  week_off:   { label: 'WEEK OFF', short: 'Week Off', icon: '🔵', card: 'bg-sky-50 border-sky-200', text: 'text-sky-700', chip: 'bg-sky-100 text-sky-800', letter: 'W' },
  not_filled: { label: 'ATTENDANCE NOT MARKED', short: 'Not Marked', icon: '⚠️', card: 'bg-red-50 border-red-300', text: 'text-red-700', chip: 'bg-red-100 text-red-800', letter: '!' },
  pending:    { label: 'ATTENDANCE PENDING', short: 'Pending', icon: '⏳', card: 'bg-white border-ink-300 border-dashed', text: 'text-ink-700', chip: 'bg-ink-100 text-ink-700', letter: '…' },
  marked:     { label: 'ALL MARKED', short: 'Marked', icon: '✅', card: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', chip: 'bg-emerald-100 text-emerald-800', letter: '✓' },
  upcoming:   { label: 'UPCOMING', short: 'Upcoming', icon: '·', card: 'bg-white border-slate-200', text: 'text-slate-400', chip: 'bg-slate-100 text-slate-500', letter: '' },
  not_joined: { label: 'NOT JOINED', short: 'Not joined', icon: '–', card: 'bg-slate-50 border-slate-200', text: 'text-slate-400', chip: 'bg-slate-100 text-slate-500', letter: '' },
  other_trainer: { label: 'WITH OTHER TRAINER', short: 'Other trainer', icon: '↗', card: 'bg-slate-50 border-slate-200', text: 'text-slate-400', chip: 'bg-slate-100 text-slate-500', letter: '' },
  exited:     { label: 'NOT IN TRAINING', short: 'Not in training', icon: '–', card: 'bg-slate-50 border-slate-200', text: 'text-slate-400', chip: 'bg-slate-100 text-slate-500', letter: '' },
  none:       { label: 'NO TRAINEES', short: 'No trainees', icon: '–', card: 'bg-slate-50 border-slate-200', text: 'text-slate-400', chip: 'bg-slate-100 text-slate-500', letter: '' },
};

// Options a trainer picks from when marking
export const MARK_OPTIONS = ['present', 'absent', 'half_day', 'holiday'];

export const NOTIF = {
  reminder:   { icon: '🔔', label: 'Reminder' },
  missed:     { icon: '🔴', label: 'Not marked' },
  attention:  { icon: '⚠️', label: 'Attention' },
  escalation: { icon: '🚨', label: 'Escalation' },
  rag:        { icon: '🚦', label: 'RAG update' },
  system:     { icon: '📢', label: 'System' },
};

export const RAG = {
  green: { label: 'Green', chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  amber: { label: 'Amber', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-400' },
  red:   { label: 'Red', chip: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
};

export const EXIT_LABELS = {
  '': 'In Training',
  handover: 'Handover to Reporting Manager',
  resigned: 'Resigned',
  not_certified: 'Not Certified',
  service_not_required: 'Service Not Required',
  doj_revised: 'DOJ Revised',
  offer_revoked: 'Offer Revoked',
};

// Sunday → 2nd Saturday → 4th Saturday (from settings). Returns the reason or null.
export function weekOffReason(k, settings) {
  const dow = dayOfWeek(k);
  const nth = nthWeekdayOfMonth(k);
  if (dow === 0 && settings.sunday_week_off) return 'Sunday';
  if (dow === 6 && nth === 2 && settings.second_saturday_week_off) return '2nd Saturday';
  if (dow === 6 && nth === 4 && settings.fourth_saturday_week_off) return '4th Saturday';
  return null;
}

// Training periods: [{start, end, reason}] — falls back to DOJ / TCD for older rows
export function periodsOf(t) {
  if (t?.training_periods?.length) return t.training_periods;
  return [{ start: t.joining_date, end: t.tcd_lwd || null, reason: t.exit_reason || null }];
}

// Dates on which a trainee was handed over to the reporting manager (day after each handover period ends)
export function handoverDates(t) {
  return periodsOf(t).filter((p) => p.reason === 'handover' && p.end).map((p) => addDays(p.end, 1));
}

// The period that is still open (no handover date yet), if any
export const openPeriod = (t) => periodsOf(t).find((p) => !p.end) || null;

// Which trainer is responsible for the trainee on a date (follows trainer switches)
export function trainerOn(t, k) {
  const list = t?._assign;
  if (!list?.length) return t?.trainer_id || null;
  const hit = list.filter((a) => a.start_date <= k && (!a.end_date || k <= a.end_date))
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
  if (hit) return hit.trainer_id;
  return [...list].sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0].trainer_id;
}

// Limit a trainee list to one trainer's view: only trainees that trainer has ever had,
// and only on the days that trainer was responsible for them.
export function scopeTo(trainees, trainerId) {
  if (!trainerId || trainerId === 'all') return trainees;
  return trainees
    .filter((t) => t.trainer_id === trainerId || t._assign?.some((a) => a.trainer_id === trainerId))
    .map((t) => ({ ...t, _scope: trainerId }));
}
export const outOfScope = (t, k) => Boolean(t?._scope) && trainerOn(t, k) !== t._scope;

// Is the trainee expected to have attendance on this date?
export function traineeActiveOn(t, k) {
  if (!t || t.status !== 'active') return false;
  if ((t.exit_reason === 'doj_revised' || t.exit_reason === 'offer_revoked') && !t.tcd_lwd) return false;
  if (outOfScope(t, k)) return false;
  return periodsOf(t).some((p) => k >= p.start && (!p.end || k <= p.end));
}

/**
 * Status of one trainee on one date:
 * WEEK OFF → marked status (Present / Absent / Half Day / Holiday) → not in training
 * → future → NOT MARKED (after deadline) → PENDING
 */
export function computeStatus({ dateKey, settings, record, now, trainee }) {
  const wo = weekOffReason(dateKey, settings);
  if (wo) return { status: 'week_off', note: wo };
  if (outOfScope(trainee, dateKey)) return { status: 'other_trainer', note: 'Batch with another trainer' };
  if (record) return { status: record.status, record };
  if (trainee && !traineeActiveOn(trainee, dateKey)) {
    if (dateKey < trainee.joining_date) return { status: 'not_joined' };
    const handedOver = periodsOf(trainee).some((p) => p.reason === 'handover' && p.end && p.end < dateKey);
    return { status: 'exited', note: handedOver ? 'With reporting manager' : undefined };
  }
  if (dateKey > now.date) return { status: 'upcoming' };
  if (dateKey < now.date || now.time > settings.attendance_deadline) return { status: 'not_filled', canMark: true };
  return { status: 'pending', canMark: true };
}

/** Summary of a whole group of trainees on one date (for the trainer's timeline). */
export function groupStatus({ dateKey, settings, trainees, recordsByTrainee, now }) {
  const wo = weekOffReason(dateKey, settings);
  if (wo) return { status: 'week_off', note: wo, counts: {}, total: 0 };
  const counts = { present: 0, absent: 0, half_day: 0, holiday: 0, not_filled: 0, pending: 0 };
  let total = 0;
  for (const t of trainees) {
    if (outOfScope(t, dateKey)) continue;
    const rec = recordsByTrainee[t.id]?.[dateKey];
    if (!rec && !traineeActiveOn(t, dateKey)) continue;
    total += 1;
    const s = computeStatus({ dateKey, settings, record: rec, now, trainee: t }).status;
    if (counts[s] !== undefined) counts[s] += 1;
  }
  if (total === 0) return { status: 'none', counts, total };
  if (dateKey > now.date) return { status: 'upcoming', counts, total };
  const unmarked = counts.not_filled + counts.pending;
  let status = 'marked';
  if (counts.not_filled) status = 'not_filled';
  else if (counts.pending) status = 'pending';
  else if (counts.holiday === total) status = 'holiday';
  return { status, counts, total, unmarked, canMark: true };
}

export function countsText(c) {
  const parts = [];
  if (c.present) parts.push(`${c.present} P`);
  if (c.absent) parts.push(`${c.absent} A`);
  if (c.half_day) parts.push(`${c.half_day} HD`);
  if (c.holiday) parts.push(`${c.holiday} H`);
  return parts.join(' · ');
}

export function summarize({ start, end, settings, records = {}, now, trainee }) {
  const c = { present: 0, absent: 0, half_day: 0, holiday: 0, week_off: 0, not_filled: 0, pending: 0 };
  const last = end < now.date ? end : now.date;
  for (const k of rangeKeys(start, last)) {
    if (!records[k] && !traineeActiveOn(trainee, k)) continue;
    const s = computeStatus({ dateKey: k, settings, record: records[k], now, trainee }).status;
    if (c[s] !== undefined) c[s] += 1;
  }
  const denom = c.present + c.absent + c.half_day + c.not_filled;
  c.percentage = denom ? Math.round(((c.present + c.half_day / 2) * 1000) / denom) / 10 : null;
  return c;
}

export function streaks({ settings, records = {}, now, trainee, lookback = 365 }) {
  let present = 0;
  let absent = 0;
  let pDone = false;
  let aDone = false;
  let k = now.date;
  for (let i = 0; i < lookback && !(pDone && aDone); i += 1, k = addDays(k, -1)) {
    if (k < trainee.joining_date) break;
    const st = computeStatus({ dateKey: k, settings, record: records[k], now, trainee }).status;
    if (['week_off', 'holiday', 'pending', 'upcoming', 'not_joined', 'exited', 'other_trainer'].includes(st)) continue;
    if (!pDone) { if (st === 'present' || st === 'half_day') present += 1; else pDone = true; }
    if (!aDone) { if (st === 'absent') absent += 1; else aDone = true; }
  }
  return { presentStreak: present, absentStreak: absent };
}
