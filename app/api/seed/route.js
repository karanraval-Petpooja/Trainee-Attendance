// First-launch demo data. Only runs when there are no users yet.
import { admin, errorResponse, httpError } from '@/lib/supabaseAdmin';
import { addDays, nowInTz, pad, rangeKeys } from '@/lib/dates';
import { traineeActiveOn, weekOffReason } from '@/lib/status';

export const dynamic = 'force-dynamic';
const PASSWORD = 'Demo@123';

async function userCount(a) {
  const { count, error } = await a.from('profiles').select('id', { count: 'exact', head: true });
  if (error) throw httpError(500, `Database not ready: ${error.message}. Run supabase/FULL_INSTALL.sql first.`);
  return count || 0;
}

export async function GET() {
  try { return Response.json({ hasUsers: (await userCount(admin())) > 0 }); } catch (e) { return errorResponse(e); }
}

export async function POST() {
  try {
    const a = admin();
    if ((await userCount(a)) > 0) throw httpError(409, 'Demo data can only be loaded into an empty app');

    const { data: settings } = await a.from('settings').select('*').eq('id', 1).single();
    const tz = settings.timezone || 'Asia/Kolkata';
    const now = nowInTz(tz);
    const today = now.date;
    const offset = tz === 'Asia/Kolkata' ? '+05:30' : 'Z';
    const isWorking = (k) => !weekOffReason(k, settings);
    const workingBefore = (k) => { let d = k; while (!isWorking(d)) d = addDays(d, -1); return d; };
    const prefix = settings.batch_prefix || 'NHT';

    const start = addDays(today, -45);
    await a.from('settings').update({ tracking_start_date: start }).eq('id', 1);

    const createUser = async (p) => {
      const { data, error } = await a.auth.admin.createUser({ email: p.email, password: PASSWORD, email_confirm: true, user_metadata: { name: p.name } });
      if (error) throw httpError(400, `${p.email}: ${error.message}`);
      const row = { ...p, id: data.user.id, status: 'active' };
      const { error: e2 } = await a.from('profiles').insert(row);
      if (e2) throw httpError(400, e2.message);
      return row;
    };

    const manager = await createUser({ name: 'Anjali Mehta', email: 'manager@demo.com', role: 'manager', employee_id: 'MGR-001', department: 'Training & Development' });
    const karan = await createUser({ name: 'Karan Raval', email: 'karan@demo.com', role: 'trainer', manager_id: manager.id, employee_id: 'TRN-01', department: 'NHT' });
    const meet = await createUser({ name: 'Meet Shah', email: 'meet@demo.com', role: 'trainer', manager_id: manager.id, employee_id: 'TRN-02', department: 'NHT' });
    const sanjukta = await createUser({ name: 'Sanjukta', email: 'sanjukta@demo.com', role: 'trainer', manager_id: manager.id, employee_id: 'TRN-03', department: 'Sales Training' });

    // Batches. NHT01 (Karan): half of it moves to Sanjukta for Sales Training from switchDay.
    const switchDay = workingBefore(addDays(today, -7));
    const batchDefs = [
      { code: `${prefix}01`, name: 'October joiners', owner: karan.id, start: addDays(today, -40), purpose: 'NHT',
        trainees: ['Chirag', 'Nisha Rao', 'Aarav Mehta', 'Diya Shah', 'Ishaan Patel', 'Kavya Nair', 'Rohan Desai', 'Tanvi Joshi'],
        moveToSanjukta: ['Chirag', 'Nisha Rao', 'Aarav Mehta', 'Ishaan Patel'] },
      { code: `${prefix}02`, name: null, owner: meet.id, start: addDays(today, -40), purpose: 'NHT',
        trainees: ['Harsh Vora', 'Pooja Iyer', 'Nikhil Rana', 'Riya Kulkarni', 'Aditya Sen', 'Simran Gill'], moveToSanjukta: [] },
      { code: `${prefix}03`, name: null, owner: karan.id, start: addDays(today, -12), purpose: 'NHT',
        trainees: ['Zoya Khan', 'Kabir Sinha', 'Meera Pillai', 'Arjun Das'], moveToSanjukta: [] },
    ];
    const rms = ['Meera Kapoor', 'Arjun Bhatt', 'Farhan Qureshi', 'Divya Menon', 'Nidhi Rao', 'Sameer Das'];

    let code = 5601;
    const all = [];
    for (const bd of batchDefs) {
      const { data: b, error: bErr } = await a.from('batches').insert({
        code: bd.code, name: bd.name, trainer_id: bd.owner, start_date: bd.start, purpose: bd.purpose, created_by: manager.id,
      }).select().single();
      if (bErr) throw httpError(400, bErr.message);

      const rows = bd.trainees.map((name, i) => {
        const moved = bd.moveToSanjukta.includes(name);
        const t = {
          employee_code: String(code++), name, batch_id: b.id, trainer_id: moved ? sanjukta.id : bd.owner,
          department: bd.purpose, reporting_manager: rms[i % rms.length], joining_date: bd.start,
          status: 'active', created_by: manager.id, created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
        };
        if (bd.code.endsWith('01') && i === 3) { t.tcd_lwd = workingBefore(addDays(today, -20)); t.exit_reason = 'resigned'; }
        if (bd.code.endsWith('01') && i === 7) {
          t.training_periods = [
            { start: t.joining_date, end: workingBefore(addDays(today, -25)), reason: 'handover' },
            { start: workingBefore(addDays(today, -4)), end: null, reason: null },
          ];
        }
        if (bd.code.endsWith('02') && i === 2) { t.tcd_lwd = workingBefore(addDays(today, -6)); t.exit_reason = 'handover'; }
        return t;
      });
      const { data: inserted, error: tErr } = await a.from('trainees').insert(rows).select();
      if (tErr) throw httpError(400, tErr.message);

      const hist = [];
      for (const t of inserted) {
        if (bd.moveToSanjukta.includes(t.name)) {
          const assign = [
            { trainee_id: t.id, trainer_id: bd.owner, start_date: bd.start, end_date: addDays(switchDay, -1), purpose: 'NHT', created_by: manager.id },
            { trainee_id: t.id, trainer_id: sanjukta.id, start_date: switchDay, end_date: null, purpose: 'Sales Training', created_by: manager.id },
          ];
          hist.push(...assign);
          all.push({ ...t, _assign: assign });
        } else {
          all.push({ ...t, _assign: [{ trainer_id: bd.owner, start_date: bd.start, end_date: null }] });
        }
      }
      if (hist.length) {
        const { error: hErr } = await a.from('trainee_assignments').insert(hist);
        if (hErr) throw httpError(400, hErr.message);
      }
    }

    const responsible = (t, k) => {
      const hit = t._assign.find((x) => x.start_date <= k && (!x.end_date || k <= x.end_date));
      return (hit || t._assign[0]).trainer_id;
    };

    // Days each trainer forgot to mark (drives alerts + escalation)
    const days = rangeKeys(start, addDays(today, -1)).filter(isWorking);
    const holidayDay = workingBefore(addDays(today, -15));
    const pick = (list, n) => { const out = new Set(); for (let j = 0; j < n; j += 1) out.add(list[Math.floor(((j + 0.5) * list.length) / n)]); out.delete(holidayDay); return out; };
    const missed = {
      [karan.id]: pick(days.filter((k) => k < switchDay && k > addDays(today, -30)), 1),
      [meet.id]: pick(days.slice(-20), 4),
      [sanjukta.id]: new Set(),
    };

    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const rows = [];
    for (const k of days) {
      for (const t of all) {
        if (!traineeActiveOn(t, k)) continue;
        const who = responsible(t, k);
        if (missed[who]?.has(k)) continue;
        const r = rnd();
        const status = k === holidayDay ? 'holiday' : r < 0.06 ? 'absent' : r < 0.09 ? 'half_day' : 'present';
        rows.push({ trainee_id: t.id, attendance_date: k, status, marked_by: who, marked_at: `${k}T${pad(9 + Math.floor(rnd() * 2))}:${pad(Math.floor(rnd() * 60))}:00${offset}`, is_late: false });
      }
    }
    // Today: Sanjukta has marked her batch, Karan is half way, Meet hasn't started
    if (isWorking(today)) {
      const time = `09:${pad(20 + Math.floor(rnd() * 30))}:00`;
      const markedAt = now.time > time ? `${today}T${time}${offset}` : new Date().toISOString();
      let karanCount = 0;
      for (const t of all) {
        if (!traineeActiveOn(t, today)) continue;
        const who = responsible(t, today);
        if (who === meet.id) continue;
        if (who === karan.id && karanCount++ >= 2) continue;
        rows.push({ trainee_id: t.id, attendance_date: today, status: rnd() < 0.12 ? 'absent' : 'present', marked_by: who, marked_at: markedAt, is_late: false });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await a.from('attendance').insert(rows.slice(i, i + 500));
      if (error) throw httpError(400, error.message);
    }

    const { error: pErr } = await a.rpc('process_missed_attendance');
    if (pErr) throw httpError(400, pErr.message);

    await a.from('notifications').insert([manager, karan, meet, sanjukta].map((u) => ({
      user_id: u.id, notification_type: 'system', title: 'Welcome to Trainer Attendance',
      message: u.role === 'manager'
        ? 'Demo data is ready. Half of NHT01 moved from Karan to Sanjukta for Sales Training. Open Trainees & Batches → NHT01 to see it.'
        : 'Mark attendance for your batch every working day before the deadline.',
    })));

    return Response.json({ ok: true, accounts: { manager: 'manager@demo.com', trainer: 'karan@demo.com', password: PASSWORD } });
  } catch (e) {
    return errorResponse(e);
  }
}
