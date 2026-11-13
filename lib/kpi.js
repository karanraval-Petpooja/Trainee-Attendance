// Trainer KPI: First Attempt Pass (FAP) and Throughput.
//  Counted: everyone who joined, EXCEPT people who left the organisation (Resigned, Drop Out, Service Not
//  Required) or never joined (DOJ Revised, Offer Revoked).
//  FAP %        = passed on the first attempt (first training period ended in Handover) ÷ counted with a first result
//  Throughput % = passed in the end (final Handover, also after retraining)          ÷ counted with a final result
//  Still in training / retraining → "in progress": counted once their result is known.
import { periodsOf } from './status';

export const EXCLUDED = { resigned: 'Resigned', drop_out: 'Drop Out', service_not_required: 'Service Not Required', doj_revised: 'DOJ Revised', offer_revoked: 'Offer Revoked' };

// one trainee's result
export function kpiResult(t) {
  if (t.deleted_at || t.status !== 'active') return { kind: 'ignore' };
  if (EXCLUDED[t.exit_reason]) return { kind: 'excluded', why: EXCLUDED[t.exit_reason] };
  const ps = periodsOf(t);
  const first = ps[0]?.reason || null;            // how the first attempt ended
  const final = t.exit_reason || null;            // how it ended in the end
  const firstDone = first === 'handover' || first === 'retraining' || first === 'not_certified';
  const finalDone = final === 'handover' || final === 'not_certified';
  return {
    kind: 'counted', firstDone, finalDone,
    firstPass: first === 'handover',
    retrained: first === 'retraining',
    retrainPass: first === 'retraining' && final === 'handover',
    finalPass: final === 'handover',
  };
}

// totals for a group of trainees
export function kpiOf(list) {
  const k = { joined: 0, excluded: 0, excludedBy: {}, counted: 0, inProgress: 0, firstDecided: 0, fap: 0, firstFail: 0, retrained: 0, retrainPass: 0, finalDecided: 0, passed: 0, notCertified: 0,
    people: { fap: [], firstFail: [], retrainPass: [], passed: [], notCertified: [], inProgress: [], excluded: [] } };
  for (const t of list) {
    const r = kpiResult(t);
    if (r.kind === 'ignore') continue;
    k.joined += 1;
    if (r.kind === 'excluded') { k.excluded += 1; k.excludedBy[r.why] = (k.excludedBy[r.why] || 0) + 1; k.people.excluded.push(t); continue; }
    k.counted += 1;
    if (r.firstDone) { k.firstDecided += 1; if (r.firstPass) { k.fap += 1; k.people.fap.push(t); } else { k.firstFail += 1; k.people.firstFail.push(t); } }
    if (r.retrained) k.retrained += 1;
    if (r.retrainPass) { k.retrainPass += 1; k.people.retrainPass.push(t); }
    if (r.finalDone) { k.finalDecided += 1; if (r.finalPass) { k.passed += 1; k.people.passed.push(t); } else { k.notCertified += 1; k.people.notCertified.push(t); } }
    else { k.inProgress += 1; k.people.inProgress.push(t); }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  k.fapPct = pct(k.fap, k.firstDecided);
  k.throughputPct = pct(k.passed, k.finalDecided);
  return k;
}
