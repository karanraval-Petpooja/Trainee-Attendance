// Shared by the manual "Import from Dossier" (browser) and the automatic sync (server).
// Works with any Supabase client: the browser client (manager login) or the admin client.

const keyOf = (name, doj) => `${(name || '').trim().toLowerCase()}|${doj}`;

// Sheet trainer name → trainer account. Reads the FULL name:
// 1) exact full name ("Karan Raval" ≠ "Karan Kumar")
// 2) every word of one name found in the other ("Karan Raval" ↔ "Karan Raval Patel"), only if one trainer fits
// 3) a first name alone ("Samir") only when exactly one trainer has that first name
// Two or more possible trainers → no match (never guessed).
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
export function matchTrainerName(name, trainers) {
  const w = words(name);
  if (!w.length) return null;
  const full = w.join(' ');
  const exact = trainers.filter((t) => words(t.name).join(' ') === full);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;
  if (w.length > 1) {
    const contains = trainers.filter((t) => { const tw = words(t.name); return w.every((x) => tw.includes(x)) || (tw.length > 1 && tw.every((x) => w.includes(x))); });
    return contains.length === 1 ? contains[0].id : null;
  }
  const byFirst = trainers.filter((t) => words(t.name)[0] === w[0]);
  return byFirst.length === 1 ? byFirst[0].id : null;
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
      const finalTcd = takeExit ? tcd : ex.tcd_lwd;
      const finalExit = takeExit ? r.exit_reason : ex.exit_reason;
      updates.set(ex.id, {
        id: ex.id,
        employee_code: r.employee_code || ex.employee_code || null,
        name: r.name || ex.name,
        joining_date: multi ? ex.joining_date : r.joining_date,
        tcd_lwd: finalTcd,
        exit_reason: finalExit,
        // Training may start after the DOJ (existing employees who are retrained)
        training_periods: multi || (finalTcd && finalTcd < start)
          ? ex.training_periods
          : [{ start, end: finalTcd || null, reason: finalExit || null }],
        reporting_manager: r.reporting_manager || ex.reporting_manager || null,
        department: r.department || ex.department || null,
        designation: r.designation || ex.designation || null,
        city: r.city || ex.city || null,
        official_email: r.official_email || ex.official_email || null,
        personal_email: r.personal_email || ex.personal_email || null,
        batch_id: ex.batch_id || null,
        _batchCode: r.batchCode || null, _batchType: r.batchType || null, _doj: r.joining_date, _trainer: null,
        track: r.track || ex.track || null,
        rag: ex.rag || r.rag || null,
        rag_remark: ex.rag ? ex.rag_remark : ex.rag_remark || r.rag_remark || null,
        rag_updated_at: ex.rag || ex.rag_remark ? ex.rag_updated_at : (r.rag || r.rag_remark ? now : null),
        // Sheet trainer wins (fixes wrong matches), except for trainees switched to another trainer in the app
        trainer_id: switched.has(ex.id) ? ex.trainer_id : (r.trainerName && trainerFor(r.trainerName)) || ex.trainer_id || null,
      });
      links.push({ row: r, id: ex.id });
    } else {
      const k = r.employee_code || (r.official_email && r.official_email.toLowerCase()) || keyOf(r.name, r.joining_date);
      const start = r.trainingStart && r.trainingStart > r.joining_date ? r.trainingStart : r.joining_date;
      inserts.set(k, {
        employee_code: r.employee_code, name: r.name, joining_date: r.joining_date, tcd_lwd: tcd, exit_reason: r.exit_reason,
        training_periods: [{ start, end: tcd || null, reason: r.exit_reason || null }],
        reporting_manager: r.reporting_manager, department: r.department, designation: r.designation, city: r.city,
        official_email: r.official_email, personal_email: r.personal_email || null, batch_id: null,
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
      const { data: b, error } = await client.from('batches')
        .insert({ code, name: rows.find((x) => x._batchType)?._batchType || null, trainer_id: trainer, start_date: start, purpose: 'NHT', created_by: createdBy })
        .select('id').single();
      if (error) errors.push(`Batch ${code}: ${error.message}`); else map[code] = b.id;
    }
  }
  return items.map(({ _batchCode, _batchType, _doj, _trainer, ...rest }) => ({
    ...rest,
    batch_id: _batchCode && map[_batchCode.trim().toUpperCase()] ? map[_batchCode.trim().toUpperCase()] : rest.batch_id ?? null,
  }));
}

export async function executeDossierSync(client, plan, { withAttendance = true, overwrite = false, createdBy = null, onProgress } = {}) {
  const errors = [];
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
  return { added, updated, days, errors };
}
