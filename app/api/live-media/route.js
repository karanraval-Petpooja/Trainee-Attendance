// TEST FEATURE — the "Meet Recordings" Google Apps Script sends the recordings / transcripts it finds
// in the host's Drive; each one is attached to the live session with the same Meet code.
// Protected by the same secret as the other Google scripts (DOSSIER_SYNC_SECRET). Only fills empty links.
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const secret = (process.env.DOSSIER_SYNC_SECRET || '').trim();
    if (!secret || (req.headers.get('x-sync-secret') || '').trim() !== secret) throw httpError(401, 'Wrong sync secret');
    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
    const { data, error } = await admin().rpc('attach_live_media', { p_items: items });
    if (error) throw httpError(500, error.message);
    return Response.json({ ok: true, received: items.length, attached: data || 0 });
  } catch (e) {
    return errorResponse(e);
  }
}
