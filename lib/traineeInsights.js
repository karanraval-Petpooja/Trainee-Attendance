// Numbers for the manager dashboard "Trainee insights": department, designation, location, joining trend, handover rate.
// Department / designation / location / reporting authority come from Contact Details (matched like the LMS export:
// E Code → email → unique name). A trainee who is not in Contact Details is counted as "Not in Contact Details", so totals add up.
import { findContact } from '@/lib/lmsExport';
import { NEVER_JOINED, notJoining, periodsOf, traineeActiveOn } from '@/lib/status';

export const NOT_LISTED = 'Not in Contact Details';
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// "Ahmedabad" / "Outside Ahmedabad" (any other location) / "Unknown" (not in Contact Details, or no location filled)
export const locationOf = (contact) => {
  const l = clean(contact?.location);
  return !l ? 'Unknown' : /ahmedabad/i.test(l) ? 'Ahmedabad' : 'Outside Ahmedabad';
};

// training → in their training now · completed → handed over · ended → trained for some days, then resigned / not certified /
// service not required … · upcoming → starts in the future · never → never joined (offer revoked, DOJ revised, drop out) or deleted.
// (The app takes a period that ended with anything but a handover off the register, so "ended" is told apart by its last day.)
export function outcomeOf(t, today) {
  if (!t || t.deleted_at) return 'never';
  if (notJoining(t)) {
    const last = periodsOf(t).at(-1);
    return last && last.end && !NEVER_JOINED.includes(last.reason) ? 'ended' : 'never';
  }
  if (traineeActiveOn(t, today)) return 'training';
  const first = periodsOf(t)[0];
  if (first && first.start > today && !first.end) return 'upcoming';
  if (t.exit_reason === 'handover' || periodsOf(t).some((p) => p.reason === 'handover')) return 'completed';
  return 'ended';
}

export function enrich(trainees, idx, today) {
  return trainees.map((t) => {
    const { contact } = findContact(t, idx);
    return { t, outcome: outcomeOf(t, today), code: clean(contact?.employee_code) || clean(t.employee_code), dept: clean(contact?.department) || NOT_LISTED, desig: clean(contact?.designation) || NOT_LISTED,
      loc: locationOf(contact), mgr: clean(contact?.reporting_manager) || NOT_LISTED };
  });
}

const tally = (list, key) => {
  const m = new Map();
  list.forEach((r) => m.set(r[key], [...(m.get(r[key]) || []), r]));
  return [...m.entries()].map(([label, rows]) => ({ label, n: rows.length, rows }));
};
// biggest first, the smallest folded into "Others"; "Not in Contact Details" always stays its own last row
const top = (items, max) => {
  const real = items.filter((x) => x.label !== NOT_LISTED).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const unknown = items.filter((x) => x.label === NOT_LISTED);
  const keep = real.slice(0, max);
  const folded = real.slice(max).flatMap((x) => x.rows);
  return [...keep, ...(folded.length ? [{ label: 'Others', n: folded.length, rows: folded }] : []), ...unknown];
};

export function buildInsights(rows, today, f = {}) {
  const started = (r) => r.outcome !== 'never' && r.outcome !== 'upcoming';
  const opts = (key) => [...new Set(rows.filter(started).map((r) => r[key]))].sort((a, b) => (a === NOT_LISTED) - (b === NOT_LISTED) || a.localeCompare(b));
  const options = {
    trainers: [...new Set(rows.filter(started).map((r) => r.t.trainer_id).filter(Boolean))],
    batches: [...new Set(rows.filter(started).map((r) => r.t._batch?.code).filter(Boolean))].sort(),
    depts: opts('dept'), locs: opts('loc'), mgrs: opts('mgr'),
  };
  const base = rows.filter((r) => started(r)
    && (!f.trainer || r.t.trainer_id === f.trainer) && (!f.batch || r.t._batch?.code === f.batch)
    && (!f.dept || r.dept === f.dept) && (!f.loc || r.loc === f.loc) && (!f.mgr || r.mgr === f.mgr));
  const inTraining = base.filter((r) => r.outcome === 'training');
  const completed = base.filter((r) => r.outcome === 'completed');
  const ended = base.filter((r) => r.outcome === 'ended');
  const month = String(today).slice(0, 7);
  const joinedThisMonth = base.filter((r) => String(r.t.joining_date || '').slice(0, 7) === month);
  const byDate = new Map();
  base.forEach((r) => { const d = r.t.joining_date; if (d) byDate.set(d, [...(byDate.get(d) || []), r]); });
  return {
    options, population: base.length,
    kpi: { inTraining: inTraining.length, joinedThisMonth: joinedThisMonth.length,
      handoverRate: completed.length + ended.length ? Math.round((completed.length * 100) / (completed.length + ended.length)) : null, finished: completed.length + ended.length, completed: completed.length },
    lists: { inTraining, joinedThisMonth, finished: [...completed, ...ended] },   // the people behind each number card
    dept: top(tally(inTraining, 'dept'), 7),
    desig: top(tally(inTraining, 'desig'), 6),
    loc: ['Ahmedabad', 'Outside Ahmedabad', 'Unknown'].map((label) => { const rs = inTraining.filter((r) => r.loc === label); return { label, n: rs.length, rows: rs }; }).filter((x) => x.n > 0),
    trend: [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([date, rs]) => ({ date, n: rs.length, rows: rs })),
  };
}

export const OUTCOME_LABEL = { training: 'In training', completed: 'Handed over', ended: 'Left', upcoming: 'Not started', never: 'Never joined' };
