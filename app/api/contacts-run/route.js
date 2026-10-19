// "Refresh contacts" button: asks the Google script web app to send the Contact Details sheet now.
import { errorResponse, httpError, requireUser } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { a } = await requireUser(req); // trainers can refresh too (read-only for them otherwise)
    const secret = (process.env.DOSSIER_SYNC_SECRET || '').trim();
    if (!secret) throw httpError(503, 'DOSSIER_SYNC_SECRET is not set on the server');
    const { data: st } = await a.from('settings').select('dossier_script_url').eq('id', 1).single();
    const url = (st?.dossier_script_url || '').trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw httpError(400, 'The Google script web app address is not set (Settings → Dossier connection).');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);
    let res;
    try {
      res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(secret)}&action=contacts`, { redirect: 'follow', signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      if (e.name === 'AbortError') return Response.json({ ok: true, running: true, message: 'Started. It is taking a while, so check again in a minute.' });
      throw httpError(502, `Could not reach the Google script: ${e.message}`);
    } finally { clearTimeout(timer); }
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { throw httpError(502, 'The Google script did not answer with JSON. Deploy it again as a Web app (access: Anyone).'); }
    if (!body.ok) throw httpError(502, body.error || 'The Google script reported an error.');
    if (typeof body.rows !== 'number' || typeof body.added !== 'number') {
      throw httpError(502, 'The Google script answered, but with the Dossier sync, not Contact Details. It is still the OLD version: in Apps Script paste the new code, then Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.');
    }
    if (body.rows === 0) throw httpError(502, 'The Contact Details tab was read, but no people were found under the headings. Check TAB_NAME in the script and that the tab has a Name and a Department column.');
    return Response.json(body);
  } catch (e) {
    return errorResponse(e);
  }
}
