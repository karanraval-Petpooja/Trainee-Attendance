// Settings → "Test connection": asks the Google script at the saved web-app link which version it runs.
import { errorResponse, httpError, requireManager } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req) {
  try {
    const { a } = await requireManager(req);
    const secret = process.env.DOSSIER_SYNC_SECRET;
    if (!secret) throw httpError(503, 'DOSSIER_SYNC_SECRET is not set in Vercel.');
    const { data: st } = await a.from('settings').select('dossier_script_url').eq('id', 1).single();
    const url = (st?.dossier_script_url || '').trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw httpError(400, 'No Google script web-app link is saved yet.');
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(secret)}&action=version`, { redirect: 'follow', cache: 'no-store' });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch {
      return Response.json({ ok: false, verdict: 'not_json', message: 'The link did not answer like the script (maybe a sign-in page). Deploy the web app with "Who has access: Anyone".' });
    }
    if (j.ok && j.version) {
      return Response.json({ ok: true, verdict: 'new', version: j.version, message: `Connected. The script at this link is version ${j.version}: Training Log push is ready.` });
    }
    if (/wrong key/i.test(j.error || '')) {
      return Response.json({ ok: false, verdict: 'key', message: 'The script answered "Wrong key": SYNC_SECRET in the script is not the same as DOSSIER_SYNC_SECRET in Vercel.' });
    }
    return Response.json({ ok: false, verdict: 'old', message: 'The script at this link is an OLD version (it does not know the Training Log). Either this link belongs to another deployment or project, or the deployment was not updated. Fix: in the project with the new code, Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy, then copy that Web app URL here and Save.', detail: j.error || null });
  } catch (e) {
    return errorResponse(e);
  }
}
