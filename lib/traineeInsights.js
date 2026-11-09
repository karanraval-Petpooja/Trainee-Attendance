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
    return { t, outcome: outcomeOf(t, today), dept: clean(contact?.department) || NOT_LISTED, desig: clean(contact?.designation) || NOT_LISTED,
      loc: locationOf(contact), mgr: clean(contact?.reporting_manager) || NOT_LISTED };
  });
}

const tally = (list, key) => {
  const m = new Map();
  list.forEach((r) => m.set(r[key], (m.get(r[key]) || 0) + 1));
  return [...m.entries()].map(([label, n]) => ({ label, n }));
};
// biggest first, the smallest folded into "Others"; "Not in Contact Details" always stays its own last row
const top = (items, max) => {
  const real = items.filter((x) => x.label !== NOT_LISTED).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const unknown = items.filter((x) => x.label === NOT_LISTED);
  const keep = real.slice(0, max);
  const rest = real.slice(max).reduce((s, x) => s + x.n, 0);
  return [...keep, ...(rest ? [{ label: 'Others', n: rest }] : []), ...unknown];
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
  const completed = base.filter((r) => r.outcome === 'completed').length;
  const ended = base.filter((r) => r.outcome === 'ended').length;
  const month = String(today).slice(0, 7);
  const byDate = new Map();
  base.forEach((r) => { const d = r.t.joining_date; if (d) byDate.set(d, (byDate.get(d) || 0) + 1); });
  return {
    options, population: base.length,
    kpi: { inTraining: inTraining.length, joinedThisMonth: base.filter((r) => String(r.t.joining_date || '').slice(0, 7) === month).length,
      handoverRate: completed + ended ? Math.round((completed * 100) / (completed + ended)) : null, finished: completed + ended, completed },
    dept: top(tally(inTraining, 'dept'), 7),
    desig: top(tally(inTraining, 'desig'), 6),
    loc: ['Ahmedabad', 'Outside Ahmedabad', 'Unknown'].map((label) => ({ label, n: inTraining.filter((r) => r.loc === label).length })).filter((x) => x.n > 0),
    trend: [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([date, n]) => ({ date, n })),
  };
}
