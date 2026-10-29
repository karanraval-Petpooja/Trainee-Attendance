-- =====================================================================
-- UPDATE: "Attendance only" Dossier upload.
-- Imports P / AB / HD / Holiday from the Dossier's Day 1…Day 40 columns for trainees already in the app.
--  • only dates BEFORE the cut-off (e.g. 2026-10-01) — anything on/after it is never touched (enforced here)
--  • days already marked in the app are kept, unless p_replace = true
--  • nothing else changes (no names, statuses, trainers, batches, RAG)
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
create or replace function public.import_dossier_attendance(p_rows jsonb, p_before date, p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ins int := 0; rep int := 0; kept int := 0; late int := 0; r record;
begin
  if not public.is_manager() then raise exception 'Only a manager can import attendance'; end if;
  if p_before is null then raise exception 'Choose the cut-off date (attendance from this date on is never changed)'; end if;
  for r in
    select x.t as trainee_id, x.d as day, x.s as status
    from jsonb_to_recordset(p_rows) as x(t uuid, d date, s text)
    where x.s in ('present', 'absent', 'half_day', 'holiday')
      and exists (select 1 from trainees tr where tr.id = x.t and tr.deleted_at is null)
  loop
    if r.day >= p_before then late := late + 1; continue; end if;           -- on/after the cut-off: never touched
    insert into attendance (trainee_id, attendance_date, status, marked_by, is_late, source)
    values (r.trainee_id, r.day, r.status, auth.uid(), false, 'dossier')
    on conflict (trainee_id, attendance_date) do nothing;
    if found then ins := ins + 1;
    elsif p_replace then
      update attendance set status = r.status, source = 'dossier', marked_by = auth.uid(), marked_at = now()
      where trainee_id = r.trainee_id and attendance_date = r.day and status <> r.status;
      if found then rep := rep + 1; else kept := kept + 1; end if;
    else kept := kept + 1;
    end if;
  end loop;
  return jsonb_build_object('added', ins, 'replaced', rep, 'kept', kept, 'skipped_after_cutoff', late);
end $$;
grant execute on function public.import_dossier_attendance(jsonb, date, boolean) to authenticated;

notify pgrst, 'reload schema';
select 'Attendance-only Dossier upload is on' as result;
