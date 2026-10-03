-- =====================================================================
-- UPDATE: Batches (NHT01, NHT02 …) + switch any trainees (all, half,
-- or one) to another trainer from a date. Keeps all your data.
-- Works whether or not you ran the earlier batches update.
-- Run once in Supabase → SQL Editor.
-- (Run update_handover.sql and update_keep_reports.sql first if you
--  haven't yet.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Batches (NHT01, NHT02 …) + date-wise trainer per TRAINEE
-- A batch is a group code with an owner trainer. Any trainees — the
-- whole batch, half of it, or one person — can be switched to another
-- trainer from a date. Earlier days stay with the earlier trainer.
-- ---------------------------------------------------------------------
alter table public.settings add column if not exists batch_prefix text not null default 'NHT';
do $$ begin
  alter table public.settings add constraint settings_batch_prefix_check check (batch_prefix ~ '^[A-Za-z]{1,10}$');
exception when duplicate_object then null; end $$;

create table if not exists public.batches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text,
  status      text not null default 'active' check (status in ('active', 'closed')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.batches add column if not exists trainer_id uuid references public.profiles(id) on delete set null;
alter table public.batches add column if not exists start_date date;
alter table public.batches add column if not exists purpose text not null default 'NHT';

alter table public.trainees add column if not exists batch_id uuid references public.batches(id) on delete set null;
create index if not exists trainees_batch_idx on public.trainees (batch_id);

create table if not exists public.trainee_assignments (
  id          uuid primary key default gen_random_uuid(),
  trainee_id  uuid not null references public.trainees(id) on delete cascade,
  trainer_id  uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  end_date    date,
  purpose     text not null default 'NHT',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists trainee_assignments_trainee_idx on public.trainee_assignments (trainee_id, start_date);
create index if not exists trainee_assignments_trainer_idx on public.trainee_assignments (trainer_id);

-- Upgrade from the earlier batch-level version (if it was installed)
do $$ begin
  if to_regclass('public.batch_assignments') is not null then
    update batches b set trainer_id = x.trainer_id, start_date = x.start_date, purpose = x.purpose
    from (select distinct on (batch_id) batch_id, trainer_id, start_date, purpose
          from batch_assignments order by batch_id, start_date) x
    where x.batch_id = b.id and b.trainer_id is null;

    insert into trainee_assignments (trainee_id, trainer_id, start_date, end_date, purpose, created_by)
    select t.id, a.trainer_id, a.start_date, a.end_date, a.purpose, a.created_by
    from trainees t join batch_assignments a on a.batch_id = t.batch_id
    where not exists (select 1 from trainee_assignments x where x.trainee_id = t.id);

    drop table batch_assignments cascade;
  end if;
end $$;
drop trigger if exists trg_trainees_batch on public.trainees;
drop function if exists public.trainees_batch_sync() cascade;
drop function if exists public.transfer_batch(uuid, uuid, date, text) cascade;
drop function if exists public.undo_batch_transfer(uuid) cascade;
drop function if exists public.batch_current_trainer(uuid) cascade;
drop function if exists public.my_batch_ids() cascade;

-- Which trainer is responsible for this trainee on this date?
create or replace function public.trainee_trainer_on(t public.trainees, d date) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.trainer_id from trainee_assignments a
      where a.trainee_id = t.id and a.start_date <= d and (a.end_date is null or d <= a.end_date)
      order by a.start_date desc limit 1),
    (select a.trainer_id from trainee_assignments a where a.trainee_id = t.id order by a.start_date limit 1),
    t.trainer_id);
$$;

-- Trainees this trainer has now or has had
create or replace function public.my_trainee_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from trainees where trainer_id = auth.uid()
  union select trainee_id from trainee_assignments where trainer_id = auth.uid();
$$;

-- A trainee added to a batch without a trainer goes to the batch owner
create or replace function public.trainees_batch_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.trainer_id is null and new.batch_id is not null then
    select trainer_id into new.trainer_id from batches where id = new.batch_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_trainees_batch_default on public.trainees;
create trigger trg_trainees_batch_default before insert or update on public.trainees
for each row execute function public.trainees_batch_default();

-- New batch with the next code (NHT01, NHT02, …)
drop function if exists public.create_batch(uuid, date, text, text) cascade;
create or replace function public.create_batch(p_trainer uuid, p_start date, p_purpose text default 'NHT', p_name text default null)
returns public.batches
language plpgsql security definer set search_path = public as $$
declare
  me  profiles;
  s   settings;
  n   int;
  b   batches;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then raise exception 'Sign in as a trainer or manager'; end if;
  if me.role = 'trainer' and p_trainer is distinct from me.id then raise exception 'You can only create batches for yourself'; end if;
  if not exists (select 1 from profiles where id = p_trainer and role = 'trainer' and status = 'active') then
    raise exception 'Choose an active trainer';
  end if;
  if p_start is null then raise exception 'Choose the batch start date'; end if;

  select * into s from settings where id = 1;
  lock table batches in share row exclusive mode;
  select coalesce(max(substring(code from length(s.batch_prefix) + 1)::int), 0) + 1 into n
  from batches where code ~ ('^' || s.batch_prefix || '[0-9]+$');

  insert into batches (code, name, trainer_id, start_date, purpose, created_by)
  values (s.batch_prefix || lpad(n::text, 2, '0'), nullif(trim(p_name), ''), p_trainer, p_start,
          coalesce(nullif(trim(p_purpose), ''), 'NHT'), me.id)
  returning * into b;

  if p_trainer <> me.id then
    insert into notifications (user_id, notification_type, title, message)
    values (p_trainer, 'system', 'New batch assigned', format('Batch %s starts with you on %s.', b.code, to_char(p_start, 'FMDD FMMonth YYYY')));
  end if;
  return b;
end $$;

-- Switch some trainees (one, half a batch, or all) to another trainer from a date
create or replace function public.transfer_trainees(p_trainees uuid[], p_trainer uuid, p_from date, p_purpose text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  me    profiles;
  t     trainees;
  cur   trainee_assignments;
  n     int := 0;
  codes text;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then raise exception 'Sign in as a trainer or manager'; end if;
  if not exists (select 1 from profiles where id = p_trainer and role = 'trainer' and status = 'active') then
    raise exception 'Choose an active trainer';
  end if;
  if p_from is null then raise exception 'Choose the date the new trainer takes over'; end if;

  for t in select * from trainees where id = any(p_trainees) loop
    if me.role <> 'manager' and t.trainer_id is distinct from me.id then
      raise exception 'You can only switch trainees who are currently with you (% is not)', t.name;
    end if;
    if t.trainer_id = p_trainer then continue; end if;

    -- First switch for this trainee: record their history so far
    if not exists (select 1 from trainee_assignments where trainee_id = t.id) then
      insert into trainee_assignments (trainee_id, trainer_id, start_date, purpose, created_by)
      values (t.id, t.trainer_id, least(t.joining_date, p_from - 1),
              coalesce((select purpose from batches where id = t.batch_id), 'NHT'), me.id);
    end if;

    select * into cur from trainee_assignments where trainee_id = t.id order by start_date desc limit 1;
    if p_from <= cur.start_date then
      raise exception '% can only be switched after %', t.name, to_char(cur.start_date, 'FMDD Mon YYYY');
    end if;
    update trainee_assignments set end_date = p_from - 1 where id = cur.id;
    insert into trainee_assignments (trainee_id, trainer_id, start_date, purpose, created_by)
    values (t.id, p_trainer, p_from, coalesce(nullif(trim(p_purpose), ''), cur.purpose), me.id);
    update trainees set trainer_id = p_trainer where id = t.id;
    n := n + 1;
  end loop;

  if n > 0 then
    select string_agg(distinct b.code, ', ') into codes from trainees x join batches b on b.id = x.batch_id where x.id = any(p_trainees);
    insert into notifications (user_id, notification_type, title, message)
    values (p_trainer, 'system', 'Trainees handed to you',
            format('%s trainee(s)%s are yours from %s%s. Mark their attendance from that day.', n,
                   coalesce(' from ' || codes, ''), to_char(p_from, 'FMDD FMMonth YYYY'),
                   coalesce(' (' || nullif(trim(p_purpose), '') || ')', '')));
  end if;
  return n;
end $$;

-- Manager: undo the latest switch for these trainees
create or replace function public.undo_trainee_transfer(p_trainees uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  t    record;
  last trainee_assignments;
  prev trainee_assignments;
  n    int := 0;
begin
  if not is_manager() then raise exception 'Only a manager can undo a switch'; end if;
  for t in select id from trainees where id = any(p_trainees) loop
    select * into last from trainee_assignments where trainee_id = t.id order by start_date desc limit 1;
    select * into prev from trainee_assignments where trainee_id = t.id and id <> last.id order by start_date desc limit 1;
    if prev.id is null then continue; end if;
    delete from trainee_assignments where id = last.id;
    update trainee_assignments set end_date = null where id = prev.id;
    update trainees set trainer_id = prev.trainer_id where id = t.id;
    n := n + 1;
  end loop;
  return n;
end $$;

alter table public.batches enable row level security;
alter table public.trainee_assignments enable row level security;
drop policy if exists batches_select on public.batches;
create policy batches_select on public.batches for select to authenticated
  using (public.is_manager() or trainer_id = auth.uid()
         or id in (select batch_id from public.trainees where id in (select public.my_trainee_ids())));
drop policy if exists batches_update on public.batches;
create policy batches_update on public.batches for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
drop policy if exists trainee_assignments_select on public.trainee_assignments;
create policy trainee_assignments_select on public.trainee_assignments for select to authenticated
  using (public.is_manager() or trainee_id in (select public.my_trainee_ids()));

grant execute on function public.create_batch(uuid, date, text, text) to authenticated;
grant execute on function public.transfer_trainees(uuid[], uuid, date, text) to authenticated;
grant execute on function public.undo_trainee_transfer(uuid[]) to authenticated;


create or replace function public.mark_attendance(p_date date, p_items jsonb)
returns int
language plpgsql security definer set search_path = public as $$
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
  late := p_date < local_ts::date or local_ts::time > s.attendance_deadline;

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
    if existing.id is not null and me.role = 'trainer' and p_date < local_ts::date - s.edit_window_days then
      raise exception 'Attendance older than % days can only be changed by a manager', s.edit_window_days;
    end if;

    insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late)
    values (tr.id, p_date, st, me.id, now(), late)
    on conflict (trainee_id, attendance_date) do update
      set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();
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
end $$;

create or replace function public.process_missed_attendance()
returns int
language plpgsql security definer set search_path = public as $$
declare
  s          settings;
  local_ts   timestamp;
  today      date;
  last_d     date;
  tr         record;
  d          date;
  unmarked   int;
  n          int;
  created    int := 0;
  mgr        record;
begin
  select * into s from settings where id = 1;
  local_ts := now() at time zone s.timezone;
  today := local_ts::date;
  last_d := case when local_ts::time > s.attendance_deadline then today else today - 1 end;

  for tr in select * from profiles where role = 'trainer' and status = 'active' loop

    -- Reminder in the hour before the deadline
    if s.reminder_enabled and not is_week_off(today)
       and local_ts::time between (s.attendance_deadline - interval '60 minutes') and s.attendance_deadline
       and not exists (select 1 from notifications where user_id = tr.id and notification_type = 'reminder'
                       and (created_at at time zone s.timezone)::date = today) then
      select count(*) into unmarked from trainees t
      where (t.trainer_id = tr.id or t.id in (select trainee_id from trainee_assignments where trainer_id = tr.id))
        and trainee_trainer_on(t, today) = tr.id and trainee_active_on(t, today)
        and not exists (select 1 from attendance x where x.trainee_id = t.id and x.attendance_date = today);
      if unmarked > 0 then
        insert into notifications (user_id, notification_type, title, message)
        values (tr.id, 'reminder', 'Attendance reminder',
                format('%s trainee(s) still need attendance today. Mark before %s.', unmarked,
                       to_char('2000-01-01'::date + s.attendance_deadline, 'FMHH12:MI AM')));
      end if;
    end if;

    -- Missed days
    d := greatest(s.tracking_start_date, today - 60);
    while d <= last_d loop
      if not is_week_off(d)
         and not exists (select 1 from attendance_alerts where trainer_id = tr.id and attendance_date = d) then

        select count(*) into unmarked from trainees t
        where (t.trainer_id = tr.id or t.id in (select trainee_id from trainee_assignments where trainer_id = tr.id))
          and trainee_trainer_on(t, d) = tr.id and trainee_active_on(t, d)
          and d >= (t.created_at at time zone s.timezone)::date
          and not exists (select 1 from attendance x where x.trainee_id = t.id and x.attendance_date = d);

        if unmarked > 0 then
          select count(*) + 1 into n from attendance_alerts where trainer_id = tr.id;

          insert into attendance_alerts (trainer_id, attendance_date, unmarked_count, miss_number, manager_notified)
          values (tr.id, d, unmarked, n, n >= s.escalation_threshold or (s.escalation_threshold > 1 and n = s.escalation_threshold - 1));

          insert into notifications (user_id, notification_type, title, message)
          values (tr.id, 'missed', 'Attendance not marked',
                  format('Attendance for %s trainee(s) on %s was not marked. Please update it.', unmarked, to_char(d, 'FMDD FMMonth YYYY')));

          if n >= s.escalation_threshold or (s.escalation_threshold > 1 and n = s.escalation_threshold - 1) then
            for mgr in select id from profiles
                       where role = 'manager' and status = 'active'
                         and (id = tr.manager_id or tr.manager_id is null) loop
              if n >= s.escalation_threshold then
                insert into notifications (user_id, notification_type, title, message)
                values (mgr.id, 'escalation', 'Repeated attendance failure',
                        format('%s has missed marking trainee attendance %s times (latest: %s, %s trainee(s) unmarked). Please review.',
                               tr.name, n, to_char(d, 'FMDD FMMonth YYYY'), unmarked));
              else
                insert into notifications (user_id, notification_type, title, message)
                values (mgr.id, 'attention', 'Attendance needs attention',
                        format('%s has missed marking trainee attendance %s times (latest: %s). One more miss triggers an escalation.',
                               tr.name, n, to_char(d, 'FMDD FMMonth YYYY')));
              end if;
            end loop;
          end if;

          created := created + 1;
        end if;
      end if;
      d := d + 1;
    end loop;
  end loop;
  return created;
end $$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (true);
drop policy if exists trainees_select on public.trainees;
create policy trainees_select on public.trainees for select to authenticated
  using (trainer_id = auth.uid() or public.is_manager() or id in (select public.my_trainee_ids()));
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.is_manager() or exists (select 1 from public.trainees t where t.id = trainee_id and public.trainee_trainer_on(t, attendance_date) = auth.uid()));

notify pgrst, 'reload schema';
