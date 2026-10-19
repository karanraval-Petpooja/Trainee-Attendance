// A phone / browser turns notifications on (POST) or off (DELETE) for the signed-in person.
import webpush from 'web-push';
import { errorResponse, httpError, requireUser } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { a, me } = await requireUser(req);
    const { subscription, test } = await req.json();
    const { endpoint, keys } = subscription || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) throw httpError(400, 'Not a valid push subscription');
    const { error } = await a.from('push_subscriptions').upsert({
      user_id: me.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: (req.headers.get('user-agent') || '').slice(0, 200),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    if (test && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      await webpush.sendNotification(subscription, JSON.stringify({ title: 'Notifications are on ✓', body: `Hi ${me.name?.split(' ')[0] || ''}, you will now get attendance alerts on this phone.`, url: '/notifications', tag: 'welcome' })).catch(() => null);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req) {
  try {
    const { a, me } = await requireUser(req);
    const { endpoint } = await req.json();
    await a.from('push_subscriptions').delete().eq('user_id', me.id).eq('endpoint', endpoint);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
