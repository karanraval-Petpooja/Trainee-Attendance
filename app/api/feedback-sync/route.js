// Receives the feedback form responses from the Google Apps Script (syncFeedback) in chunks.
// Responses are saved, matched to trainees (E Code → email → exact name) and to the trainer named in the form.
// The last chunk removes responses that were deleted from the sheet.
import { cleanTrainerName, parseFeedback } from '@/lib/feedbackSheet';
import { matchTrainerName } from '@/lib/dossierSync';
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FORMS = ['nht', 'sales', 'upskill', 'ojt-pip'];

export async function POST(req) {
  try {
    const secret = (process.env.DOSSIER_SYNC_SECRET || '').trim();
    if (!secret || (req.headers.get('x-sync-secret') || '').trim() !== secret) throw httpError(401, 'Wrong sync secret');
    const body = await req.json();
    const formId = String(body.formId || '');
    if (!FORMS.includes(formId)) throw httpError(400, `formId must be one of: ${FORMS.join(', ')}`);
    if (!Array.isArray(body.header) || !Array.isArray(body.rows)) throw httpError(400, 'Send { formId, header: [...], rows: [[...]] }');

    // A sheet can belong to ONE trainer ("all feedback in this sheet is for Jasmin Babla"): trainerName or trainerEmail
    const forcedName = String(body.trainerName || '').trim();
    const forcedEmail = String(body.trainerEmail || '').trim().toLowerCase();
    const forcedOn = Boolean(forcedName || forcedEmail);
    const { responses, errors } = parseFeedback(body.header, body.rows, formId, { allowAnonymous: forcedOn });
    if (errors.length) throw httpError(400, errors.join(' '));

    const a = admin();
    const runId = String(body.runId || '') || null;
    const source = String(body.source || '').slice(0, 200); // the sheet tab: several tabs can feed one form
    const { data: trainers } = await a.from('profiles').select('id, name, email').eq('role', 'trainer');
    let forcedId = null;
    if (forcedOn) {
      forcedId = forcedEmail
        ? (trainers || []).find((t) => String(t.email || '').trim().toLowerCase() === forcedEmail)?.id || null
        : matchTrainerName(cleanTrainerName(forcedName), trainers || []);
      if (!forcedId) throw httpError(400, `Trainer "${forcedName || forcedEmail}" was not found among the trainers in the app, or the name fits more than one trainer. Check the spelling under Trainers, or use TRAINER_EMAIL in the script.`);
    }
    const now = new Date().toISOString();
    // trainer_id: the trainer this whole sheet belongs to, else the trainer name written in the form; trainee_id / match_via are NOT sent,
    // so a match (or a manager's manual link) made earlier is kept when the same response is updated.
    const rows = responses.map((r) => ({
      ...r,
      source,
      trainer_id: forcedId || (r.trainer_name ? matchTrainerName(r.trainer_name, trainers || []) : null),
      trainer_name: forcedId ? (forcedName || r.trainer_name || null) : r.trainer_name,
      last_seen_run: runId,
      updated_at: now,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await a.from('feedback_responses').upsert(rows.slice(i, i + 200), { onConflict: 'form_id,row_key' });
      if (error) throw httpError(500, error.message.includes('feedback_responses') ? 'Run supabase/update_feedback.sql first. ' + error.message : error.message);
    }

    let removed = 0;
    if (body.final && runId && Number(body.totalRows) > 0) {
      const { data } = await a.from('feedback_responses').delete().eq('form_id', formId).eq('source', source).neq('last_seen_run', runId).select('id');
      removed = data?.length || 0;
    }
    let matched = 0;
    if (body.final) {
      const { data } = await a.rpc('match_feedback_responses');
      matched = Number(data) || 0;
    }
    const trainer = forcedId ? (trainers || []).find((t) => t.id === forcedId)?.name || null : null;   // who the sheet was attached to (shown in the script log)
    return Response.json({ ok: true, rows: rows.length, removed, matched, trainerId: forcedId, trainer });
  } catch (e) {
    return errorResponse(e);
  }
}
