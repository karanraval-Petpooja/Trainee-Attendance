// Receives the Contact Details sheet from the Google Apps Script (syncContacts) in chunks.
// The last chunk marks everyone not in the sheet as inactive.
import { parseContacts, saveContacts } from '@/lib/contacts';
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const secret = (process.env.DOSSIER_SYNC_SECRET || '').trim();
    if (!secret || (req.headers.get('x-sync-secret') || '').trim() !== secret) throw httpError(401, 'Wrong sync secret');
    const body = await req.json();
    if (!Array.isArray(body.header) || !Array.isArray(body.rows)) throw httpError(400, 'Send { header: [...], rows: [[...]] }');
    const { contacts, errors } = parseContacts(body.header, body.rows);
    if (errors.length) throw httpError(400, errors.join(' '));
    const a = admin();
    const runId = String(body.runId || '');
    const status = body.status === 'left' ? 'left' : 'active';
    const res = await saveContacts(a, contacts, { runId: runId || null, status });
    let deactivated = 0;
    if (status === 'active' && body.final && runId) {
      const { data } = await a.from('contacts').update({ active: false, employment: 'left' }).neq('last_seen_run', runId).eq('active', true).select('id');
      deactivated = data?.length || 0;
      const { data: nulls } = await a.from('contacts').update({ active: false, employment: 'left' }).is('last_seen_run', null).eq('active', true).select('id');
      deactivated += nulls?.length || 0;
    }
    return Response.json({ ok: true, rows: contacts.length, ...res, deactivated });
  } catch (e) {
    return errorResponse(e);
  }
}
