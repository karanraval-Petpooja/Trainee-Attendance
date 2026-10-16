// Push an Upskill / Refresher session to the Training Log Google Sheet (via the Google Apps Script web app).
// One row per participant, in the sheet's columns:
// Sr. No | Date | Month | Name | Mail Id | Location | Location Type | Designation | Department | Course type | Topic | Completion Status | Trainer Name
import { errorResponse, httpError, requireUser } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const low = (x) => String(x || '').trim().toLowerCase();
const nameKey = (s) => low(s).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const COURSE = { upskill: 'Upskill', refresher: 'Refresher' };

async function allContacts(a) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await a.from('contacts').select('name, official_email, personal_email, location, designation, department').range(from, from + 999);
    if (error) break; // Contact Details not set up: details stay empty
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function POST(req) {
  try {
    const { a, me } = await requireUser(req);
    const body = await req.json();
    const topic = String(body.topic || '').trim();
    if (!body.sessionId) throw httpError(400, 'sessionId is missing');
    if (topic.length < 2) throw httpError(400, 'Write the topic of the session.');

    const { data: s } = await a.from('ojt_sessions').select('*').eq('id', body.sessionId).single();
    if (!s) throw httpError(404, 'Session not found');
    if (me.role !== 'manager' && s.trainer_id !== me.id && s.created_by !== me.id) throw httpError(403, 'Only the session trainer or a manager can push this session.');
    if (s.pushed_at) throw httpError(409, `Already pushed to the Training Log on ${String(s.pushed_at).slice(0, 10)}${s.pushed_sr ? ` (Sr. No ${s.pushed_sr})` : ''}. A session can be pushed once.`);
    const course = COURSE[low(s.session_type)];
    if (!course) throw httpError(400, 'Only Upskill and Refresher sessions go to the training sheet.');

    const { data: all } = await a.from('ojt_participants').select('*').eq('session_id', s.id).order('full_name');
    // only the participants the trainer ticked
    const ids = Array.isArray(body.participantIds) ? new Set(body.participantIds.map(String)) : null;
    const parts = (all || []).filter((p) => !ids || ids.has(String(p.id)));
    if (!parts.length) throw httpError(400, 'Tick at least one participant to push.');
    const { data: tr } = await a.from('profiles').select('name').eq('id', s.trainer_id || s.created_by).single();
    const trainerName = tr?.name || me.name || '';

    // Location / Designation / Department from Contact Details (email first, then name)
    const contacts = await allContacts(a);
    const byEmail = new Map(); const byName = new Map();
    contacts.forEach((c) => {
      [c.official_email, c.personal_email].forEach((e) => { if (e) byEmail.set(low(e), c); });
      byName.set(nameKey(c.name), c);
    });
    const rows = parts.map((p) => {
      const c = byEmail.get(low(p.email)) || byName.get(nameKey(p.full_name)) || {};
      const location = c.location || '';
      return {
        name: p.full_name,
        mail: p.email || c.official_email || '',
        location,
        locationType: !location ? '' : /ahmedabad/i.test(location) ? 'Ahmedabad' : 'Outside Ahmedabad',
        designation: c.designation || '',
        department: c.department || p.department || '',
        completion: p.attendance === 'P' ? 'Completed' : 'Not Completed',
      };
    });

    const { data: st } = await a.from('settings').select('dossier_script_url').eq('id', 1).single();
    const url = (st?.dossier_script_url || '').trim();
    const secret = process.env.DOSSIER_SYNC_SECRET;
    if (!secret) throw httpError(503, 'DOSSIER_SYNC_SECRET is not set on the server');
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw httpError(400, 'The Google script web app address is not set (Settings → Dossier connection).');

    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(secret)}&action=trainingLog`, {
      method: 'POST', redirect: 'follow', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain' }, // simple body for Apps Script
      body: JSON.stringify({ date: s.session_date, course, topic, trainer: trainerName, rows }),
    });
    const text = await res.text();
    let out;
    try { out = JSON.parse(text); } catch { throw httpError(502, 'The Google script did not answer with JSON. Paste the latest script, then Deploy → New version.'); }
    if (!out.ok) throw httpError(502, out.error || 'The Google script reported an error.');
    if (typeof out.added !== 'number') throw httpError(502, 'The Google script is an older version: paste the latest script, then Deploy → Manage deployments → Edit → New version.');

    await a.from('ojt_sessions').update({
      topic, pushed_at: new Date().toISOString(), pushed_by: me.id,
      pushed_rows: out.added,
      pushed_sr: out.added ? `${out.from}–${out.to}` : null,
    }).eq('id', s.id);
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
