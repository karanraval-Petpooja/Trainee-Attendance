import { requireManager, errorResponse, httpError } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { a } = await requireManager(req);
    const { id, password } = await req.json();
    if (!id) throw httpError(400, 'Missing trainer id');
    if (!password || password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
    const { data: t } = await a.from('profiles').select('role').eq('id', id).single();
    if (!t || t.role !== 'trainer') throw httpError(404, 'Trainer not found');
    const { error } = await a.auth.admin.updateUserById(id, { password });
    if (error) throw httpError(400, error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
