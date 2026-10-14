// Shared by the manual "Import from Dossier" (browser) and the automatic sync (server).
// Works with any Supabase client: the browser client (manager login) or the admin client.

const keyOf = (name, doj) => `${(name || '').trim().toLowerCase()}|${doj}`;

// Sheet trainer name → trainer account. Each word of the sheet name must match a word of the trainer's name:
//   same word (any order: "Mehta Swapnil" = "Swapnil Mehta"), an initial ("Karan R" = Karan Raval,
//   "Karan K" = Karan Kumar) or a small typo ("Karan Kuamr" = Karan Kumar). At least one full word must match.
// The trainer with the best match wins; if two trainers match equally ("Karan" alone) → no match (never guessed).
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
function typoDistance(a, b) { // edit distance, a swap of two letters counts as one
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
function wordScore(sw, tw) {
  if (sw === tw) return 3;                                                     // same word
  if (sw.length <= 2 && tw.startsWith(sw)) return 1;                           // initial: "R" / "Ra"
  if (sw.length >= 3 && tw.length >= 3) {
    const allowed = Math.min(sw.length, tw.length) >= 5 ? 2 : 1;
    if (sw[0] === tw[0] && typoDistance(sw, tw) <= allowed) return 2;          // small typo
    if (tw.startsWith(sw) || sw.startsWith(tw)) return 2;                      // short form: "Swap" / "Raval-ji"
  }
  return 0;
}
export function matchTrainerName(name, trainers) {
  const w = words(name);
  if (!w.length) return null;
  let best = null; let bestScore = 0; let tie = false;
  trainers.forEach((t) => {
    const tw = words(t.name);
    if (!tw.length) return;
    const used = new Set();
    let total = 0; let fullWords = 0;
    for (const x of w) {
      let top = 0; let at = -1;
      tw.forEach((y, i) => { if (used.has(i)) return; const sc = wordScore(x, y); if (sc > top) { top = sc; at = i; } });
      if (!top) return;                    // a word of the sheet name does not fit this trainer
      used.add(at); total += top; if (top === 3) fullWords += 1;
    }
    if (!fullWords && !(w.length === 1 && total >= 2)) return;
    if (used.size === tw.length) total += 0.5; // the trainer's whole name is covered
    if (total > bestScore) { best = t; bestScore = total; tie = false; } else if (total === bestScore) tie = true;
  });
  return best && !tie ? best.id : null;
}

export function makeTrainerResolver(trainers, { mapping = {}, defaultTrainerId = null } = {}) {
  const byEmail = Object.fromEntries(trainers.map((t) => [t.email.toLowerCase(), t.id]));
  return (name) => {
    if (name) {
      const m = mapping[name];
      if (m && byEmail[String(m).toLowerCase()]) return byEmail[String(m).toLowerCase()];
      if (m && trainers.some((t) => t.id === m)) return m;
      const hit = matchTrainerName(name, trainers);
      if (hit) return hit;
    }
    return defaultTrainerId || null;
  };
}

/**
 * Decide what to insert / update. Rules when a trainee already exists in the app:
 * - Dossier fills in details (code, manager, designation, track …) when it has a value.
 * - TCD / status come from the Dossier when it has them, unless the trainee was brought back
 *   for training in the app (more than one training period) — the app keeps those.
 * - RAG / remarks and trainer set in the app are never overwritten; the Dossier only fills blanks.
 * - Deleted / removed trainees stay deleted.
 */
// Find the app trainee for a Dossier row. E Codes are often added to the Dossier later,
// so we fall back to the official email, then Name + DOJ. When the code arrives it is saved.
export function makeMatcher(existing) {
  const byCode = {};
  const byEmail = {};
  const byKey = {};
  const byPersonal = {};
  existing.forEach((t) => {
    if (t.employee_code) byCode[t.employee_code] = t;
    if (t.personal_email) byPersonal[`${t.personal_email.toLowerCase()}|${t.joining_date}`] = t;
    if (t.official_email) byEmail[`${t.official_email.toLowerCase()}|${t.joining_date}`] = t;
    byKey[keyOf(t.name, t.joining_date)] = t;
  });
  return (r) => (r.employee_code && byCode[r.employee_code])
    || (r.official_email && byEmail[`${r.official_email.toLowerCase()}|${r.joining_date}`])
    || (r.personal_email && byPersonal[`${r.personal_email.toLowerCase()}|${r.joining_date}`])
    || byKey[keyOf(r.name, r.joining_date)]
    || null;
}

// Retraining from the sheet (same rule as the Failed button):
//   1st time "Retraining"            → current training ends ("retraining") + a new training period starts
//   in retraining + Handover / exit   → the retraining period ends with that status
//   in retraining + Not certified, or "Retraining Status" = Fail → 2nd fail → Not Certified (removed)
const addDay = (k, n) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function sheetRetraining(periods, r, tcd, today) {
  const ps = (periods || []).map((p) => ({ ...p }));
  if (!ps.length) return null;
  const failedBefore = ps.slice(0, -1).some((p) => p.reason === 'retraining');
  const last = ps[ps.length - 1];
  const inRetraining = failedBefore;
  const exit = r.retrainingResult === 'fail' && inRetraining ? 'not_certified' : r.exit_reason;
  if (r.statusRetraining && !exit) {
    if (inRetraining) {                       // already retraining: keep it open
      if (last.end && last.reason !== 'handover') { last.end = null; last.reason = null; return ps; }
      return null;
    }
    // first fail: close the current training, retraining starts the next day
    const failOn = last.end && last.end >= last.start ? last.end : (addDay(today, -1) >= last.start ? addDay(today, -1) : last.start);
    last.end = failOn; last.reason = 'retraining';
    ps.push({ start: addDay(failOn, 1), end: null, reason: null });
    return ps;
  }
  if (inRetraining && exit && !last.end) {    // retraining finished: handover, 2nd fail, resigned…
    if (exit === 'handover' && !(tcd && tcd >= last.start)) return null; // handover needs its date
    last.end = tcd && tcd >= last.start ? tcd : today;
    last.reason = exit;
    return ps;
  }
  return null;
}

export function planDossierSync(rows, existing, trainerFor, { switched = new Set() } = {}) {
  const match = makeMatcher(existing);
  const now = new Date().toISOString();
  const updates = new Map();
  const inserts = new Map();
  const links = [];

  for (const r of rows) {
    const tcd = r.tcd_lwd && r.tcd_lwd < r.joining_date ? null : r.tcd_lwd;
    const ex = match(r);
    if (ex) {
      const multi = (ex.training_periods?.length || 0) > 1;
      const start = r.trainingStart && r.trainingStart > r.joining_date ? r.trainingStart : r.joining_date;
      const takeExit = !multi && (r.exit_reason || tcd) && !(tcd && tcd < start);
      const keepOld = r.tcdGuessed && ex.tcd_lwd && (ex.exit_reason || null) === (r.exit_reason || null);
      const reopen = !multi && r.statusInTraining && (ex.exit_reason || ex.tcd_lwd);
      let finalTcd = reopen ? null : takeExit ? (keepOld ? ex.tcd_lwd : tcd) : ex.tcd_lwd;
      let finalExit = reopen ? null : takeExit ? r.exit_reason : ex.exit_reason;
      const retrainPs = sheetRetraining(ex.training_periods?.length ? ex.training_periods : [{ start, end: ex.tcd_lwd || null, reason: ex.exit_reason || null }], r, tcd, now.slice(0, 10));
      if (retrainPs) { const lp = retrainPs[retrainPs.length - 1]; finalTcd = lp.end || null; finalExit = lp.reason || null; }
      updates.set(ex.id, {
        id: ex.id,
        employee_code: r.employee_code || ex.employee_code || null,
        name: r.name || ex.name,
        joining_date: multi ? ex.joining_date : r.joining_date,
        tcd_lwd: finalTcd,
        exit_reason: finalExit,
        // Training may start after the DOJ (existing employees who are retrained)
        training_periods: retrainPs || (multi || (finalTcd && finalTcd < start)
          ? ex.training_periods
          : [{ start, end: finalTcd || null, reason: finalExit || null }]),
        reporting_manager: r.reporting_manager || ex.reporting_manager || null,
        department: r.department || ex.department || null,
        designation: r.designation || ex.designation || null,
        city: r.city || ex.city || null,
        official_email: r.official_email || ex.official_email || null,
        personal_email: r.personal_email || ex.personal_email || null,
        phone: r.phone || ex.phone || null,
        probable_handover_date: r.probable_handover_date || ex.probable_handover_date || null,
        batch_id: ex.batch_id || null,
        _batchCode: r.batchCode || null, _batchType: r.batchType || null, _doj: r.joining_date, _trainer: null,
        track: r.track || ex.track || null,
        rag: ex.rag || r.rag || null,
        rag_remark: ex.rag ? ex.rag_remark : ex.rag_remark || r.rag_remark || null,
        rag_updated_at: ex.rag || ex.rag_remark ? ex.rag_updated_at : (r.rag || r.rag_remark ? now : null),
        // Sheet trainer wins (fixes wrong matches), except for trainees switched to another trainer in the app
        trainer_id: switched.has(ex.id) ? ex.trainer_id : (r.trainerName && trainerFor(r.trainerName)) || ex.trainer_id || null,
        _oldTrainer: ex.trainer_id || null,
      });
      links.push({ row: r, id: ex.id });
    } else {
      const k = r.employee_code || (r.official_email && r.official_email.toLowerCase()) || keyOf(r.name, r.joining_date);
      const start = r.trainingStart && r.trainingStart > r.joining_date ? r.trainingStart : r.joining_date;
      inserts.set(k, {
        employee_code: r.employee_code, name: r.name, joining_date: r.joining_date, tcd_lwd: tcd, exit_reason: r.exit_reason,
        training_periods: (r.statusRetraining && sheetRetraining([{ start, end: null, reason: null }], r, tcd, now.slice(0, 10)))
          || [{ start, end: tcd || null, reason: r.exit_reason || null }],
        reporting_manager: r.reporting_manager, department: r.department, designation: r.designation, city: r.city,
        official_email: r.official_email, personal_email: r.personal_email || null, batch_id: null, phone: r.phone || null,
        probable_handover_date: r.probable_handover_date || null,
        _batchCode: r.batchCode || null, _batchType: r.batchType || null, _doj: r.joining_date,
        track: r.track, rag: r.rag, rag_remark: r.rag_remark,
        rag_updated_at: r.rag || r.rag_remark ? now : null, trainer_id: trainerFor(r.trainerName) || null,
      });
      links.push({ row: r, insertKey: k });
    }
  }
  return { updates: [...updates.values()], inserts: [...inserts.entries()], links };
}

// Batch Id from the sheet (GN144, C143 …) → batch in the app; created when it does not exist yet
async function resolveBatches(client, items, createdBy, errors) {
  const withCode = items.filter((x) => x._batchCode);
  const codes = [...new Set(withCode.map((x) => x._batchCode.trim().toUpperCase()))];
  const map = {};
  if (codes.length) {
    const { data: have } = await client.from('batches').select('id, code').in('code', codes);
    (have || []).forEach((b) => { map[b.code.toUpperCase()] = b.id; });
    for (const code of codes.filter((c) => !map[c])) {
      const rows = withCode.filter((x) => x._batchCode.trim().toUpperCase() === code);
      const count = {};
      rows.forEach((x) => { if (x.trainer_id) count[x.trainer_id] = (count[x.trainer_id] || 0) + 1; });
      const trainer = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const start = rows.map((x) => x._doj).filter(Boolean).sort()[0] || null;
      const anyOpen = rows.some((x) => !x.exit_reason && !x.tcd_lwd);
      const { data: b, error } = await client.from('batches')
        .insert({ code, name: rows.find((x) => x._batchType)?._batchType || null, trainer_id: trainer, start_date: start, purpose: 'NHT', created_by: createdBy, status: anyOpen ? 'active' : 'closed' })
        .select('id').single();
      if (error) errors.push(`Batch ${code}: ${error.message}`); else map[code] = b.id;
    }
  }
  // Main trainer of each sheet batch = the trainer with most of its trainees now
  for (const code of codes.filter((c) => map[c])) {
    const count = {};
    withCode.filter((x) => x._batchCode.trim().toUpperCase() === code).forEach((x) => { if (x.trainer_id) count[x.trainer_id] = (count[x.trainer_id] || 0) + 1; });
    const main = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (main) await client.from('batches').update({ trainer_id: main }).eq('id', map[code]);
  }
  return items.map(({ _batchCode, _batchType, _doj, _trainer, _oldTrainer, ...rest }) => ({
    ...rest,
    batch_id: _batchCode && map[_batchCode.trim().toUpperCase()] ? map[_batchCode.trim().toUpperCase()] : rest.batch_id ?? null,
  }));
}

export async function executeDossierSync(client, plan, { withAttendance = true, overwrite = false, createdBy = null, onProgress } = {}) {
  const errors = [];
  const trainersChanged = plan.updates.filter((u) => u._oldTrainer && u.trainer_id && u._oldTrainer !== u.trainer_id).length;
  {
    const ups = await resolveBatches(client, [...plan.updates, ...plan.inserts.map(([, v]) => v)], createdBy, errors);
    plan = { ...plan, updates: ups.slice(0, plan.updates.length), inserts: plan.inserts.map(([k], i) => [k, ups[plan.updates.length + i]]) };
  }
  let updated = 0;
  let added = 0;
  // Updates (one upsert call per 200 rows; falls back to row by row if a batch fails)
  for (let i = 0; i < plan.updates.length; i += 200) {
    onProgress?.(`Updating trainees ${Math.min(i + 200, plan.updates.length)} / ${plan.updates.length}`);
    const chunk = plan.updates.slice(i, i + 200);
    const { error } = await client.from('trainees').upsert(chunk, { onConflict: 'id' });
    if (!error) { updated += chunk.length; continue; }
    for (const u of chunk) {
      const { id, ...fields } = u;
      const { error: e } = await client.from('trainees').update(fields).eq('id', id);
      if (e) errors.push(`${u.name}: ${e.message}`); else updated += 1;
    }
  }
  // Inserts
  const idForKey = {};
  for (let i = 0; i < plan.inserts.length; i += 200) {
    onProgress?.(`Adding trainees ${Math.min(i + 200, plan.inserts.length)} / ${plan.inserts.length}`);
    const chunk = plan.inserts.slice(i, i + 200);
    const { data, error } = await client.from('trainees').insert(chunk.map(([, v]) => ({ ...v, created_by: createdBy }))).select('id');
    if (!error) { chunk.forEach(([k], j) => { idForKey[k] = data[j].id; }); added += chunk.length; continue; }
    for (const [k, v] of chunk) {
      const { data: one, error: e } = await client.from('trainees').insert({ ...v, created_by: createdBy }).select('id').single();
      if (e) errors.push(`${v.name}: ${e.message}`); else { idForKey[k] = one.id; added += 1; }
    }
  }
  // Attendance
  let days = 0;
  if (withAttendance) {
    const all = plan.links.flatMap(({ row, id, insertKey }) => {
      const tid = id || idForKey[insertKey];
      return tid ? row.attendance.map((x) => ({ trainee_id: tid, date: x.date, status: x.status })) : [];
    });
    for (let i = 0; i < all.length; i += 1000) {
      onProgress?.(`Importing attendance ${Math.min(i + 1000, all.length)} / ${all.length}`);
      const { data, error } = await client.rpc('import_attendance', { p_rows: all.slice(i, i + 1000), p_overwrite: overwrite });
      if (error) { errors.push(`Attendance: ${error.message}`); break; }
      days += data || 0;
    }
  }
  return { added, updated, days, errors, trainersChanged };
}
