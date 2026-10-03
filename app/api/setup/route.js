// Creates the first manager account. Only works while the app has no users.
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const a = admin();
    const { count, error: cErr } = await a.from('profiles').select('id', { count: 'exact', head: true });
    if (cErr) throw httpError(500, `Database not ready: ${cErr.message}`);
    if (count > 0) throw httpError(409, 'A manager already exists. Ask them to add you.');
    const b = await req.json();
    const email = (b.email || '').trim().toLowerCase();
    const name = (b.name || '').trim();
    if (!name || !email) throw httpError(400, 'Enter your name and email');
    if (!b.password || b.password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
    const { data, error } = await a.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { name } });
    if (error) throw httpError(400, error.message);
    const { error: pErr } = await a.from('profiles').insert({
      id: data.user.id, name, email, role: 'manager', employee_id: (b.employee_id || '').trim() || null, department: 'Training', status: 'active',
    });
    if (pErr) { await a.auth.admin.deleteUser(data.user.id); throw httpError(400, pErr.message); }
    return Response.json({ ok: true, email });
  } catch (e) {
    return errorResponse(e);
  }
}
