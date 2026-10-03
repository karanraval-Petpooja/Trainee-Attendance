// Trainer login accounts (managers only)
import { requireManager, errorResponse, httpError } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function POST(req) {
  try {
    const { a, me } = await requireManager(req);
    const b = await req.json();
    const email = clean(b.email)?.toLowerCase();
    if (!clean(b.name) || !email) throw httpError(400, 'Enter a name and email');
    if (!b.password || b.password.length < 6) throw httpError(400, 'Password must be at least 6 characters');

    const { data, error } = await a.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { name: b.name.trim() } });
    if (error) throw httpError(400, error.message);

    const { error: pErr } = await a.from('profiles').insert({
      id: data.user.id, name: b.name.trim(), email, role: 'trainer',
      manager_id: clean(b.manager_id) || me.id, employee_id: clean(b.employee_id), department: clean(b.department), status: 'active',
    });
    if (pErr) {
      await a.auth.admin.deleteUser(data.user.id);
      throw httpError(400, pErr.message.includes('employee_id') ? 'That Employee ID is already in use' : pErr.message);
    }
    return Response.json({ ok: true, id: data.user.id });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req) {
  try {
    const { a } = await requireManager(req);
    const b = await req.json();
    if (!b.id) throw httpError(400, 'Missing trainer id');
    const { data: cur } = await a.from('profiles').select('*').eq('id', b.id).single();
    if (!cur || cur.role !== 'trainer') throw httpError(404, 'Trainer not found');

    const patch = {};
    if (b.name !== undefined) patch.name = clean(b.name) || cur.name;
    if (b.employee_id !== undefined) patch.employee_id = clean(b.employee_id);
    if (b.department !== undefined) patch.department = clean(b.department);
    if (b.manager_id !== undefined) patch.manager_id = clean(b.manager_id);
    if (b.status !== undefined) patch.status = b.status === 'inactive' ? 'inactive' : 'active';

    const authPatch = {};
    const email = clean(b.email)?.toLowerCase();
    if (email && email !== cur.email) { authPatch.email = email; authPatch.email_confirm = true; patch.email = email; }
    if (patch.status && patch.status !== cur.status) authPatch.ban_duration = patch.status === 'inactive' ? '876000h' : 'none';
    if (Object.keys(authPatch).length) {
      const { error } = await a.auth.admin.updateUserById(b.id, authPatch);
      if (error) throw httpError(400, error.message);
    }
    const { error } = await a.from('profiles').update(patch).eq('id', b.id);
    if (error) throw httpError(400, error.message.includes('employee_id') ? 'That Employee ID is already in use' : error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
