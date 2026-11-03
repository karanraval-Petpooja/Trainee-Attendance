// Webhook for the Petpooja LMS (learn.petpooja.com). The LMS calls this when a trainee finishes an assessment.
// POST /api/lms-result   header: x-lms-secret: <LMS_WEBHOOK_SECRET>   body: one result, or { "results": [ ... ] } (up to 500)
// Safe to send the same attempt again: results are keyed by the LMS's attempt id, so nothing is duplicated.
import { timingSafeEqual } from 'node:crypto';
import { normalizeResult } from '@/lib/lmsResult';
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function POST(req) {
  try {
    const secret = (process.env.LMS_WEBHOOK_SECRET || '').trim();
    if (!secret) throw httpError(503, 'LMS_WEBHOOK_SECRET is not set on the server');
    const given = (req.headers.get('x-lms-secret') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')).trim();
    if (!given || !safeEqual(given, secret)) throw httpError(401, 'Wrong secret');

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') throw httpError(400, 'Send a JSON body');
    if (body.test === true) return Response.json({ ok: true, test: true, message: 'Connected. Nothing was saved.' });

    const list = Array.isArray(body) ? body : Array.isArray(body.results) ? body.results : [body];
    if (!list.length) throw httpError(400, 'No results in the request');
    if (list.length > 500) throw httpError(400, 'Send at most 500 results per request');

    const rejected = [];
    const byId = new Map(); // the same attempt twice in one request: the last one wins
    list.forEach((o, i) => {
      const { row, error } = normalizeResult(o, i);
      if (error) rejected.push(error); else byId.set(row.external_id, row);
    });
    const rows = [...byId.values()];
    if (!rows.length) return Response.json({ ok: false, error: 'No valid result in the request', rejected }, { status: 400 });

    const a = admin();
    const ids = rows.map((r) => r.external_id);
    const { data: before } = await a.from('lms_results').select('external_id, passed').in('external_id', ids);
    const was = new Map((before || []).map((x) => [x.external_id, x.passed]));
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i += 200) {
      // trainee_id / match_via are NOT sent, so a match (or a manager's manual link) made earlier is kept on an update
      const { error } = await a.from('lms_results').upsert(rows.slice(i, i + 200).map((r) => ({ ...r, updated_at: now })), { onConflict: 'external_id' });
      if (error) throw httpError(500, /lms_results/.test(error.message) ? `Run supabase/update_lms_results.sql first. ${error.message}` : error.message);
    }
    const { data: matchedNow } = await a.rpc('match_lms_results');

    // Tell the trainer (and their phone) about NEW results of their trainees: passed → "mark training complete?", failed → retraining
    let notified = 0;
    const fresh = rows.filter((r) => !was.has(r.external_id) || (was.get(r.external_id) === false && r.passed));
    if (fresh.length) {
      const { data: saved } = await a.from('lms_results').select('external_id, trainee_id').in('external_id', fresh.map((r) => r.external_id)).not('trainee_id', 'is', null);
      const traineeOf = new Map((saved || []).map((x) => [x.external_id, x.trainee_id]));
      const tIds = [...new Set(traineeOf.values())];
      if (tIds.length) {
        const { data: trainees } = await a.from('trainees').select('id, name, trainer_id').in('id', tIds);
        const tmap = new Map((trainees || []).map((t) => [t.id, t]));
        const notes = [];
        fresh.forEach((r) => {
          const t = tmap.get(traineeOf.get(r.external_id));
          if (!t?.trainer_id) return;
          const pct = r.percentage !== null ? ` (${r.percentage}%)` : '';
          notes.push(r.passed
            ? { user_id: t.trainer_id, notification_type: 'system', title: `${t.name} passed the assessment`, message: `${t.name} passed “${r.assessment}”${pct} on the LMS. If their training is complete, mark “Training complete”. Details: Reports → LMS Results.` }
            : { user_id: t.trainer_id, notification_type: 'system', title: `${t.name} did not pass`, message: `${t.name} did not pass “${r.assessment}”${pct}, attempt ${r.attempt}. Details: Reports → LMS Results.` });
        });
        if (notes.length) { const { error } = await a.from('notifications').insert(notes); if (!error) notified = notes.length; }
      }
    }
    return Response.json({ ok: true, received: list.length, saved: rows.length, newlyMatched: Number(matchedNow) || 0, notified, rejected });
  } catch (e) {
    return errorResponse(e);
  }
}
