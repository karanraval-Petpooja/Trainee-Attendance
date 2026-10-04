// Gives the Google Apps Script what to write back into the Dossier:
// attendance marked in the app (not imported days) and RAG / remarks.
// Protected by DOSSIER_SYNC_SECRET.
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';
import { addDays, nowInTz } from '@/lib/dates';

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

export async function GET(req) {
  try {
    const secret = process.env.DOSSIER_SYNC_SECRET;
    if (!secret || secret.length < 16) throw httpError(503, 'DOSSIER_SYNC_SECRET is not set on the server');
    if (req.headers.get('x-sync-secret') !== secret) throw httpError(401, 'Wrong sync secret');

    const a = admin();
    const { data: settings } = await a.from('settings').select('timezone').eq('id', 1).single();
    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 90, 1), 400);
    const since = addDays(nowInTz(settings?.timezone || 'Asia/Kolkata').date, -days);

    const trainees = await fetchAll(() => a.from('trainees')
      .select('id, employee_code, official_email, name, joining_date, training_periods, rag, rag_remark')
      .is('deleted_at', null));
    const att = await fetchAll(() => a.from('attendance').select('trainee_id, attendance_date, status')
      .eq('source', 'app').gte('attendance_date', since).order('attendance_date'));
    const byTrainee = {};
    att.forEach((x) => { (byTrainee[x.trainee_id] ||= []).push([x.attendance_date, x.status]); });

    return Response.json({
      since,
      trainees: trainees.map((t) => ({
        code: t.employee_code || '',
        email: (t.official_email || '').toLowerCase(),
        name: t.name,
        doj: t.joining_date,
        start: t.training_periods?.[0]?.start || t.joining_date, // Dossier "Day 1"
        rag: t.rag || '',
        ragRemark: t.rag_remark || '',
        attendance: byTrainee[t.id] || [],
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
