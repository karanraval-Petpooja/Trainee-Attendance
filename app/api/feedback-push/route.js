// NEW (does not change the existing feedback sync): receives feedback form rows pushed by a Google Apps Script
// (integrations/upskill-feedback.gs) and adds them to feedback_responses. Rows already in the app are skipped,
// so pushing the same sheet again never creates copies. Protected by the same secret as the Dossier sync.
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';
import { matchTrainerName } from '@/lib/dossierSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FORMS = ['upskill', 'ojt-pip', 'nht', 'sales'];
const SKIP = /^(timestamp|email address|email|score)$|^column \d+$/i;   // not questions
const clean = (h) => String(h || '').replace(/\s+/g, ' ').trim();
const plain = (h) => clean(h).replace(/^\d+\s*[.)]\s*/, '').toLowerCase();

async function fetchAll(build) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw httpError(500, error.message);
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

// "tushar.makwana@petpooja.com" → "Tushar Makwana"
const nameFromEmail = (e) => String(e || '').split('@')[0].replace(/\d+/g, '').split(/[._-]+/).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || null;

export async function POST(req) {
  try {
    const secret = process.env.FEEDBACK_SYNC_SECRET || process.env.DOSSIER_SYNC_SECRET;
    if (!secret || secret.trim().length < 16) throw httpError(503, 'DOSSIER_SYNC_SECRET is not set on the server');
    if (String(req.headers.get('x-sync-secret') || '').trim() !== secret.trim()) throw httpError(401, 'Wrong sync secret');

    const body = await req.json();
    const formId = String(body.formId || '').trim().toLowerCase();
    if (!FORMS.includes(formId)) throw httpError(400, `formId must be one of: ${FORMS.join(', ')}`);
    if (!Array.isArray(body.header) || !Array.isArray(body.rows)) throw httpError(400, 'Send { formId, header: [...], rows: [[...], ...] }');

    const header = body.header.map(clean);
    const find = (re) => header.findIndex((h) => re.test(plain(h)));
    const cTime = find(/^timestamp$/);
    const cEmail = find(/^email( address)?$/);
    const cTrainer = find(/trainer/);
    const cName = find(/^(your )?(full )?name$/);
    if (cTime < 0) throw httpError(400, 'No "Timestamp" column in the sheet');

    const a = admin();
    const trainers = await fetchAll(() => a.from('profiles').select('id, name').in('role', ['trainer', 'manager']).order('id'));
    // Already in the app for this form: same email + same submitted time
    const have = await fetchAll(() => a.from('feedback_responses').select('id, respondent_email, submitted_at').eq('form_id', formId).order('id'));
    const keyOf = (email, t) => `${String(email || '').trim().toLowerCase()}|${new Date(t).getTime()}`;
    const seen = new Set(have.map((r) => keyOf(r.respondent_email, r.submitted_at)));

    const out = [];
    for (const row of body.rows) {
      if (!Array.isArray(row)) continue;
      const t = row[cTime] ? new Date(row[cTime]) : null;
      if (!t || Number.isNaN(t.getTime())) continue;                       // empty / broken row
      const email = cEmail >= 0 ? String(row[cEmail] || '').trim().toLowerCase() || null : null;
      const k = keyOf(email, t);
      if (seen.has(k)) continue;
      seen.add(k);
      const answers = []; const ratings = {};
      header.forEach((h, i) => {
        if (!h || SKIP.test(plain(h)) || i === cTime || i === cEmail) return;
        const v = row[i]; const s = String(v ?? '').trim();
        if (!s) return;
        answers.push({ q: h, a: s });
        const n = Number(s);
        if (i !== cTrainer && /^\d+(\.\d+)?$/.test(s) && n >= 1 && n <= 10) ratings[h] = n > 5 ? Math.round((n / 2) * 10) / 10 : n; // 1–10 → 5 stars
      });
      const vals = Object.values(ratings);
      const trainerName = cTrainer >= 0 ? String(row[cTrainer] || '').trim() || null : null;
      out.push({
        form_id: formId,
        submitted_at: t.toISOString(),
        respondent_email: email,
        respondent_name: (cName >= 0 && String(row[cName] || '').trim()) || nameFromEmail(email),
        trainer_name: trainerName,
        trainer_id: trainerName ? matchTrainerName(trainerName, trainers) : null,
        rating: vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10 : null,
        ratings: vals.length ? ratings : null,
        answers,
      });
    }

    // Insert new ones. A column your database does not have is left out, so the rest still saves.
    const errors = [];
    const dropped = new Set();
    const missing = (e) => { const m = String(e?.message || '').match(/find the '([a-z_]+)' column|column "?([a-z_]+)"? (?:of relation "?feedback_responses"? )?does not exist/i); return m ? (m[1] || m[2]) : null; };
    const strip = (r) => { const o = { ...r }; dropped.forEach((c) => delete o[c]); return o; };
    const insert = async (list) => {
      for (let tries = 0; tries < 8; tries += 1) {
        const res = await a.from('feedback_responses').insert(list.map(strip));
        const col = res.error && missing(res.error);
        if (!col || dropped.has(col)) return res;
        dropped.add(col);
      }
      return a.from('feedback_responses').insert(list.map(strip));
    };
    let added = 0;
    for (let i = 0; i < out.length; i += 200) {
      const chunk = out.slice(i, i + 200);
      const { error } = await insert(chunk);
      if (!error) { added += chunk.length; continue; }
      for (const r of chunk) {
        const { error: e } = await insert([r]);
        if (e) errors.push(`${r.respondent_email || 'row'} (${r.submitted_at}): ${e.message}`); else added += 1;
      }
    }
    // Link responses to trainees by email (the app's own matching), if that function exists
    if (added) await a.rpc('match_feedback_responses').then(() => {}, () => {});

    return Response.json({ ok: true, form: formId, rowsReceived: body.rows.length, added, alreadyInApp: body.rows.length - out.length,
      skippedColumns: [...dropped], errors: errors.slice(0, 20) });
  } catch (e) {
    return errorResponse(e);
  }
}
