// Called by the database (trigger on notifications) for every new notification:
// sends it as a phone notification to every device the person turned notifications on for.
import webpush from 'web-push';
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Where a tap on the notification opens the app
const urlFor = (n) => (/handover|training not ended/i.test(n.title) ? '/trainees'
  : /trainees handed|batch assigned/i.test(n.title) ? '/attendance'
    : /attendance/i.test(n.title) ? '/attendance' : '/notifications');

export async function POST(req) {
  try {
    const a = admin();
    const { data: cfg } = await a.from('push_config').select('secret').eq('id', 1).single();
    if (!cfg?.secret || req.headers.get('x-push-secret') !== cfg.secret) throw httpError(401, 'Wrong push secret');
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) throw httpError(503, 'VAPID keys are not set in Vercel');
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);

    const { id } = await req.json();
    const { data: n } = await a.from('notifications').select('*').eq('id', id).single();
    if (!n) return Response.json({ ok: true, sent: 0 });
    const { data: subs } = await a.from('push_subscriptions').select('*').eq('user_id', n.user_id);
    const payload = JSON.stringify({ title: n.title, body: n.message, url: urlFor(n), tag: n.id });
    let sent = 0;
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        sent += 1;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await a.from('push_subscriptions').delete().eq('id', s.id); // phone unsubscribed
      }
    }));
    return Response.json({ ok: true, sent });
  } catch (e) {
    return errorResponse(e);
  }
}
