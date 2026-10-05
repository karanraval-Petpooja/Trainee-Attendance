// "Get new trainees" button: asks the Google Apps Script web app to run the Dossier sync now.
// The script then sends the rows to /api/dossier-sync like the hourly trigger does.
import { errorResponse, httpError, requireManager } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { a } = await requireManager(req); // manager only
    const snapshot = async () => {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await a.from('trainees').select('id, trainer_id').range(from, from + 999);
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return Object.fromEntries(all.map((t) => [t.id, t.trainer_id]));
    };
    const before = await snapshot();
    const secret = process.env.DOSSIER_SYNC_SECRET;
    if (!secret) throw httpError(503, 'DOSSIER_SYNC_SECRET is not set on the server');
    const { data: st } = await a.from('settings').select('dossier_script_url').eq('id', 1).single();
    const url = (st?.dossier_script_url || '').trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      throw httpError(400, 'The Google script web app address is not set. Manager: Settings → Dossier connection.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);
    let res;
    try {
      res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(secret)}`, { redirect: 'follow', signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      if (e.name === 'AbortError') return Response.json({ ok: true, running: true, message: 'Sync started. It is taking a while, so check again in a minute.' });
      throw httpError(502, `Could not reach the Google script: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    if (!body) throw httpError(502, /<html/i.test(text) ? 'The Google script answered with a web page. Check the web app is deployed with access "Anyone" (see Settings → Dossier connection).' : text.slice(0, 200));
    if (!body.ok) throw httpError(502, body.error || 'The Google script reported a problem');
    if (!body.busy) {
      const after = await snapshot();
      body.trainersChanged = Object.keys(before).filter((id) => id in after && before[id] && after[id] && before[id] !== after[id]).length;
    }
    return Response.json(body);
  } catch (e) {
    return errorResponse(e);
  }
}
