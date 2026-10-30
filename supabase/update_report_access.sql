-- =====================================================================
-- UPDATE: "Reports for all trainees" right.
-- A manager can give one (or more) trainers the right to SEE and DOWNLOAD every trainee's attendance
-- (Monthly Sheet, Attendance History) to share with HR. It is read-only: they still mark / change
-- only their own trainees. Only managers can grant or remove it.
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
alter table public.profiles add column if not exists report_access boolean not null default false;

create or replace function public.has_report_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select report_access from profiles where id = auth.uid() and status = 'active'), false)
$$;
grant execute on function public.has_report_access() to authenticated;

-- extra READ rights (added next to the existing rules; writing is unchanged)
drop policy if exists trainees_select_reports on public.trainees;
create policy trainees_select_reports on public.trainees for select to authenticated using (public.has_report_access());
drop policy if exists attendance_select_reports on public.attendance;
create policy attendance_select_reports on public.attendance for select to authenticated using (public.has_report_access());
drop policy if exists batches_select_reports on public.batches;
create policy batches_select_reports on public.batches for select to authenticated using (public.has_report_access());
drop policy if exists trainee_assignments_select_reports on public.trainee_assignments;
create policy trainee_assignments_select_reports on public.trainee_assignments for select to authenticated using (public.has_report_access());
do $$ begin
  if to_regclass('public.contacts') is not null then
    execute 'drop policy if exists contacts_select_reports on public.contacts';
    execute 'create policy contacts_select_reports on public.contacts for select to authenticated using (public.has_report_access())';
  end if;
end $$;

-- only a manager can change it (profiles are already manager-only to update; this makes it explicit)
create or replace function public.profiles_guard_report_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.report_access is distinct from old.report_access and auth.uid() is not null and not public.is_manager() then
    raise exception 'Only a manager can give or remove report access';
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_guard_report_access on public.profiles;
create trigger trg_profiles_guard_report_access before update of report_access on public.profiles
  for each row execute function public.profiles_guard_report_access();

-- tell the trainer when the right is given / removed
create or replace function public.profiles_notify_report_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.report_access is distinct from old.report_access then
    insert into notifications (user_id, notification_type, title, message)
    values (new.id, 'system',
            case when new.report_access then 'You can now take reports for all trainees' else 'Reports for all trainees removed' end,
            case when new.report_access
                 then 'Reports → Monthly Sheet and Attendance History now show every trainee (all trainers). Download them to share with HR. You still mark attendance only for your own trainees.'
                 else 'Reports now show only your own trainees again.' end);
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_notify_report_access on public.profiles;
create trigger trg_profiles_notify_report_access after update of report_access on public.profiles
  for each row execute function public.profiles_notify_report_access();

notify pgrst, 'reload schema';
select name, email from public.profiles where report_access order by name;
