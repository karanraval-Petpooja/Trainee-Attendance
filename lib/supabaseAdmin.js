import { createClient } from '@supabase/supabase-js';

export function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function errorResponse(e) {
  return Response.json({ error: e.message || String(e) }, { status: e.status || 500 });
}

export async function requireManager(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw httpError(401, 'Sign in again to continue');
  const a = admin();
  const { data, error } = await a.auth.getUser(token);
  if (error || !data?.user) throw httpError(401, 'Your session has expired. Sign in again.');
  const { data: me } = await a.from('profiles').select('*').eq('id', data.user.id).single();
  if (!me || me.role !== 'manager' || me.status !== 'active') throw httpError(403, 'Only managers can do this');
  return { a, me };
}

export async function requireUser(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw httpError(401, 'Sign in again to continue');
  const a = admin();
  const { data, error } = await a.auth.getUser(token);
  if (error || !data?.user) throw httpError(401, 'Your session has expired. Sign in again.');
  const { data: me } = await a.from('profiles').select('*').eq('id', data.user.id).single();
  if (!me || me.status !== 'active') throw httpError(403, 'Your account is not active');
  return { a, me };
}
