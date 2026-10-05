// Receives Dossier rows from the Google Apps Script (integrations/dossier-sync.gs).
// Protected by DOSSIER_SYNC_SECRET. Uses the shared rules in lib/dossierSync.js.
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';
import { isHeadedDossier, parseDossier, parseDossierByHeader } from '@/lib/parseDossier';
import { nowInTz } from '@/lib/dates';
import { executeDossierSync, makeTrainerResolver, planDossierSync } from '@/lib/dossierSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

// The Settings page uses this to show whether the connection is configured
export async function GET() {
  return Response.json({ configured: Boolean(process.env.DOSSIER_SYNC_SECRET && process.env.DOSSIER_SYNC_SECRET.length >= 16) });
}

export async function POST(req) {
  try {
    const secret = process.env.DOSSIER_SYNC_SECRET;
    if (!secret || secret.length < 16) throw httpError(503, 'DOSSIER_SYNC_SECRET is not set on the server (min 16 characters)');
    if (req.headers.get('x-sync-secret') !== secret) throw httpError(401, 'Wrong sync secret');

    const body = await req.json();
    if (!Array.isArray(body.rows)) throw httpError(400, 'Send { rows: [[…], …] }');
    const a0 = admin();
    const { data: st } = await a0.from('settings').select('timezone').eq('id', 1).single();
    const today = nowInTz(st?.timezone || 'Asia/Kolkata').date;
    let parsed;
    if (Array.isArray(body.header) && isHeadedDossier(body.header)) {
      // Sheet with named columns (DOJ, Name, Trainer Name, Training Status …), no Day columns
      parsed = parseDossierByHeader(body.header, body.rows, { today });
    } else {
      const text = body.rows
        .map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
        .join('\n');
      parsed = parseDossier(text, { colors: Array.isArray(body.colors) ? body.colors : [] });
    }
    const fromDoj = body.fromDoj && /^\d{4}-\d{2}-\d{2}$/.test(body.fromDoj) ? body.fromDoj : null;
    const rows = fromDoj ? parsed.rows.filter((r) => r.joining_date >= fromDoj) : parsed.rows;
    // Codes looked up by the script in the Contact Details sheet fill rows that have no E Code yet
    const codes = body.codesByEmail && typeof body.codesByEmail === 'object' ? body.codesByEmail : {};
    rows.forEach((r) => {
      const c = r.official_email && codes[r.official_email.toLowerCase()];
      if (!r.employee_code && c && /^\d{3,8}$/.test(String(c).trim())) r.employee_code = String(c).trim();
    });

    const a = admin();
    const trainers = await fetchAll(() => a.from('profiles').select('id, name, email').eq('role', 'trainer').eq('status', 'active'));
    const existing = await fetchAll(() => a.from('trainees').select('*'));
    const defaultTrainerId = body.defaultTrainerEmail
      ? trainers.find((t) => t.email.toLowerCase() === String(body.defaultTrainerEmail).toLowerCase())?.id || null
      : null;
    const trainerFor = makeTrainerResolver(trainers, { mapping: body.trainerMap || {}, defaultTrainerId });

    const plan = planDossierSync(rows, existing, trainerFor);
    const res = await executeDossierSync(a, plan, { withAttendance: body.importAttendance !== false, overwrite: false });
    const errors = [...parsed.errors, ...res.errors];

    await a.from('sync_log').insert({
      run_id: String(body.runId || '').slice(0, 64) || null, source: 'dossier', rows_received: rows.length,
      added: res.added, updated: res.updated, attendance_days: res.days, errors: errors.length ? errors.slice(0, 20).join('\n') : null,
    });

    return Response.json({ ok: true, rows: rows.length, added: res.added, updated: res.updated, attendanceDays: res.days, errors: errors.slice(0, 20) });
  } catch (e) {
    return errorResponse(e);
  }
}
