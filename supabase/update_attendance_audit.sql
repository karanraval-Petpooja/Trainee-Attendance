-- =====================================================================
-- UPDATE: (1) WHO MARKED attendance, with a change log   (2) DAY 1 is PRESENT by default
-- Run once in Supabase → SQL Editor (safe to run again).
--
-- (1) Every attendance entry keeps WHO set its status. Saving the same status again no longer replaces the name of the
--     person who marked it, and every change (who, when, old → new) is written to attendance_log. Attendance History shows it.
-- (2) A trainee's first day (joining date) is marked PRESENT automatically, as "Auto · Day 1". The trainer or a manager can
--     still change it. Not applied on week offs / public holidays, and not for trainees who never joined.
--     Only trainees whose joining date is on / after settings.day1_present_from are touched, so past months in the
--     reports do NOT change. To also cover earlier trainees, see the commented line at the end.
-- =====================================================================

-- ---------- (1) change log ----------
create table if not exists public.attendance_log (
  id               bigint generated always as identity primary key,
  trainee_id       uuid not null references public.trainees(id) on delete cascade,
  attendance_date  date not null,
  old_status       text,
  new_status       text not null,
  changed_by       uuid references public.profiles(id) on delete set null,   -- null = automatic (Day 1) or a system import
  source           text not null default 'app',                               -- app | dossier | auto_day1
  is_late          boolean,
  note             text,
  changed_at       timestamptz not null default now()
);
create index if not exists attendance_log_trainee_idx on public.attendance_log (trainee_id, attendance_date);
create index if not exists attendance_log_at_idx      on public.attendance_log (changed_at desc);

alter table public.attendance_log enable row level security;
-- Same visibility as the attendance entries themselves: a manager, a trainer who has "Reports for all trainees",
-- or the trainee's own trainer. (Anyone who can SEE an entry in Attendance History can open its log.)
drop policy if exists attendance_log_select on public.attendance_log;
do $$
begin
  if to_regprocedure('public.has_report_access()') is not null then
    execute 'create policy attendance_log_select on public.attendance_log for select to authenticated
             using (public.is_manager() or public.has_report_access() or trainee_id in (select public.my_trainee_ids()))';
  else
    execute 'create policy attendance_log_select on public.attendance_log for select to authenticated
             using (public.is_manager() or trainee_id in (select public.my_trainee_ids()))';
  end if;
end $$;
-- No insert / update / delete policy: only the trigger below writes.

-- Saving the SAME status again must not replace who marked it (a person who re-saves, or a manager re-importing, is not "the marker").
-- Exception: confirming an automatic Day 1 entry by hand makes that person the marker.
create or replace function public.attendance_keep_marker() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = old.status and old.source is distinct from 'auto_day1' then
    new.marked_by := old.marked_by;
    new.marked_at := old.marked_at;
    new.source    := old.source;
  end if;
  return new;
end $$;
drop trigger if exists trg_attendance_keep_marker on public.attendance;
create trigger trg_attendance_keep_marker before update on public.attendance
  for each row execute function public.attendance_keep_marker();

create or replace function public.attendance_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into attendance_log (trainee_id, attendance_date, old_status, new_status, changed_by, source, is_late, changed_at)
    values (new.trainee_id, new.attendance_date, null, new.status, new.marked_by, new.source, new.is_late, coalesce(new.marked_at, now()));
  elsif new.status is distinct from old.status
     or (old.source = 'auto_day1' and new.source is distinct from 'auto_day1') then
    insert into attendance_log (trainee_id, attendance_date, old_status, new_status, changed_by, source, is_late, changed_at)
    values (new.trainee_id, new.attendance_date, old.status, new.status, new.marked_by, new.source, new.is_late, now());
  end if;
  return null;
end $$;
drop trigger if exists trg_attendance_audit on public.attendance;
create trigger trg_attendance_audit after insert or update on public.attendance
  for each row execute function public.attendance_audit();

-- Entries that already exist: one line each, so the log is never empty for them (earlier edits were not recorded)
insert into public.attendance_log (trainee_id, attendance_date, old_status, new_status, changed_by, source, is_late, note, changed_at)
select a.trainee_id, a.attendance_date, null, a.status, a.marked_by, a.source, a.is_late,
       'Existing entry. Changes made before this update were not recorded.', a.marked_at
from public.attendance a
where not exists (select 1 from public.attendance_log);

-- ---------- (2) Day 1 = present ----------
alter table public.settings add column if not exists day1_auto_present boolean not null default true;
alter table public.settings add column if not exists day1_present_from date;
update public.settings set day1_present_from = (now() at time zone timezone)::date where id = 1 and day1_present_from is null;

create or replace function public.apply_day1_present(p_trainee uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  s     settings;
  today date;
  n     int := 0;
begin
  select * into s from settings where id = 1;
  if s.id is null or not coalesce(s.day1_auto_present, true) then return 0; end if;
  today := (now() at time zone s.timezone)::date;
  insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late, source)
  select t.id, t.joining_date, 'present', null, now(), false, 'auto_day1'
  from trainees t
  where (p_trainee is null or t.id = p_trainee)
    and t.deleted_at is null
    and t.joining_date is not null
    and t.joining_date <= today
    and t.joining_date >= coalesce(s.day1_present_from, today)
    and not is_week_off(t.joining_date)
    and trainee_active_on(t, t.joining_date)
  on conflict (trainee_id, attendance_date) do nothing;      -- never overwrites something a person already marked
  get diagnostics n = row_count;
  return n;
end $$;

-- When a trainee is added or their dates / status change: add Day 1, and remove an automatic Day 1 that no longer applies
-- (joining date moved, offer revoked, never joined, deleted). An entry a person changed is never removed.
create or replace function public.trainee_day1_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from attendance a
   where a.trainee_id = new.id and a.source = 'auto_day1'
     and (new.deleted_at is not null or a.attendance_date is distinct from new.joining_date or not trainee_active_on(new, a.attendance_date));
  perform public.apply_day1_present(new.id);
  return null;
end $$;
drop trigger if exists trg_trainees_day1 on public.trainees;
create trigger trg_trainees_day1 after insert or update of joining_date, status, exit_reason, tcd_lwd, training_periods, deleted_at on public.trainees
  for each row execute function public.trainee_day1_sync();

-- Trainees whose first day has not arrived yet get it when the day comes (checked every 15 minutes, like the missed-attendance check)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('trainer-attendance-day1', '*/15 * * * *', 'select public.apply_day1_present()');
  else
    raise notice 'pg_cron is not enabled: Day 1 is added when a trainee is created / changed, but NOT automatically on the day for future joiners. Enable pg_cron (Database → Extensions) and run this file again.';
  end if;
exception when others then
  raise notice 'Could not schedule the Day 1 job: %', sqlerrm;
end $$;

-- ---------- mark_attendance: same as the live one, with ONE change ----------
-- A trainer may still correct an automatic Day 1 entry after the edit window (nobody "marked" it, so nothing to protect).
create or replace function public.mark_attendance(p_date date, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me        profiles;
  s         settings;
  local_ts  timestamp;
  item      jsonb;
  tr        trainees;
  st        text;
  existing  attendance;
  late      boolean;
  n         int := 0;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then raise exception 'Sign in as an active trainer or manager'; end if;

  select * into s from settings where id = 1;
  local_ts := now() at time zone s.timezone;
  if p_date > local_ts::date then raise exception 'Attendance cannot be marked for a future date'; end if;
  if is_week_off(p_date) then raise exception 'This date is a week off. No attendance is needed.'; end if;
  -- a 12:00 AM (00:00) deadline means the END of the day: marking on the same day is on time
  late := p_date < local_ts::date or (s.attendance_deadline <> time '00:00' and local_ts::time > s.attendance_deadline);

  for item in select * from jsonb_array_elements(p_items) loop
    st := item->>'status';
    if st not in ('present', 'absent', 'half_day', 'holiday') then raise exception 'Choose Present, Absent, Half Day or Holiday'; end if;

    select * into tr from trainees where id = (item->>'trainee_id')::uuid;
    if tr.id is null then raise exception 'Trainee not found'; end if;
    if me.role = 'trainer' and trainee_trainer_on(tr, p_date) is distinct from me.id then
      raise exception 'You can only mark attendance for your own trainees';
    end if;
    if not trainee_active_on(tr, p_date) then
      raise exception '% is not in training on this date', tr.name;
    end if;

    select * into existing from attendance where trainee_id = tr.id and attendance_date = p_date;
    if existing.id is not null and me.role = 'trainer' and existing.source is distinct from 'auto_day1' and p_date < local_ts::date - s.edit_window_days then
      raise exception 'Attendance older than % days can only be changed by a manager', s.edit_window_days;
    end if;

    insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late)
    values (tr.id, p_date, st, me.id, now(), late)
    on conflict (trainee_id, attendance_date) do update
      set status = excluded.status, marked_by = excluded.marked_by, marked_at = now(), source = 'app';
    n := n + 1;
  end loop;

  -- Close alerts for this date once every trainee of that trainer is marked
  update attendance_alerts a set resolved = true
  where a.attendance_date = p_date and not a.resolved
    and not exists (
      select 1 from trainees t
      where trainee_trainer_on(t, p_date) = a.trainer_id and trainee_active_on(t, p_date)
        and not exists (select 1 from attendance x where x.trainee_id = t.id and x.attendance_date = p_date));

  return n;
end $function$;

notify pgrst, 'reload schema';
select public.apply_day1_present() as day1_rows_added_now;
-- To ALSO mark Day 1 present for trainees who joined earlier (this changes past reports!), run:
--   update public.settings set day1_present_from = '2026-01-01' where id = 1;  select public.apply_day1_present();
-- To switch the Day 1 rule off:   update public.settings set day1_auto_present = false where id = 1;
