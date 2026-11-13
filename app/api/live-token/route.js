// TEST FEATURE — pass to join an in-app session. The trainer of the session (or a manager) joins as host;
// anyone with the join link joins as a guest, and only while the session is live.
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';
import { jaasToken, jitsiConfig, roomOf } from '@/lib/jitsi';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const cfg = jitsiConfig();
    if (!cfg) throw httpError(503, 'In-app video is not set up yet (JaaS keys or NEXT_PUBLIC_JITSI_DOMAIN missing in Vercel).');
    const { code, name } = await req.json().catch(() => ({}));
    const a = admin();
    const { data: s } = await a.from('live_sessions').select('id, code, title, status, provider, trainer_id').eq('code', String(code || '')).single();
    if (!s || s.provider !== 'app') throw httpError(404, 'Session not found');
    if (s.status !== 'live') throw httpError(410, 'This session has ended');
    // host? (signed-in trainer of this session, or a manager)
    let me = null;
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (token) {
      const { data } = await a.auth.getUser(token);
      if (data?.user) ({ data: me } = await a.from('profiles').select('id, name, role, status').eq('id', data.user.id).single());
    }
    const host = Boolean(me && me.status === 'active' && (me.id === s.trainer_id || me.role === 'manager'));
    const display = host ? me.name : String(name || '').trim().slice(0, 60) || 'Trainee';
    const room = roomOf(s.code);
    if (cfg.mode === 'jaas') {
      return Response.json({ domain: cfg.domain, room: `${cfg.appId}/${room}`, script: `https://8x8.vc/${cfg.appId}/external_api.js`, jwt: jaasToken({ appId: cfg.appId, room: '*', name: display, id: me?.id, moderator: host }), host, name: display, title: s.title });
    }
    return Response.json({ domain: cfg.domain, room, script: `https://${cfg.domain}/external_api.js`, jwt: null, host, name: display, title: s.title });
  } catch (e) {
    return errorResponse(e);
  }
}
