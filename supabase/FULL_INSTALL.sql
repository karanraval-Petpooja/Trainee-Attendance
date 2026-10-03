-- =====================================================================
-- ONE-STEP INSTALL: removes any earlier version, installs the current
-- database, and refreshes Supabase's table cache. Paste ALL of this into
-- Supabase → SQL Editor → New query → Run.
-- =====================================================================

-- 1) Remove logins that belong to this app
do $$ begin
  if to_regclass('public.profiles') is not null then
    delete from auth.users where id in (select id from public.profiles);
  end if;
end $$;

-- 2) Remove the scheduled job if it exists
do $$ begin
  perform cron.unschedule('trainer-attendance-check');
exception when others then null; end $$;

-- 3) Remove old tables and functions
drop trigger if exists trg_holiday_added on public.holidays;
drop table if exists public.attendance_alerts cascade;
drop table if exists public.notifications cascade;
drop table if exists public.attendance cascade;
drop table if exists public.holidays cascade;
drop table if exists public.trainees cascade;
drop table if exists public.batch_assignments cascade;
drop table if exists public.trainee_assignments cascade;
drop table if exists public.sync_log cascade;
drop table if exists public.batches cascade;
drop table if exists public.settings cascade;
drop table if exists public.profiles cascade;

drop function if exists public.notify_holiday() cascade;
drop function if exists public.day_type(date) cascade;
drop function if exists public.mark_attendance(date, text) cascade;
drop function if exists public.mark_attendance(date, jsonb) cascade;
drop function if exists public.process_missed_attendance() cascade;
drop function if exists public.resolve_login(text) cascade;
drop function if exists public.app_has_users() cascade;
drop function if exists public.is_manager() cascade;
drop function if exists public.my_manager_id() cascade;
drop function if exists public.is_week_off(date) cascade;
drop function if exists public.trainees_before_write() cascade;

drop function if exists public.create_batch(uuid, date, text, text) cascade;
drop function if exists public.transfer_batch(uuid, uuid, date, text) cascade;
drop function if exists public.undo_batch_transfer(uuid) cascade;
drop function if exists public.batch_current_trainer(uuid) cascade;
drop function if exists public.my_batch_ids() cascade;
drop function if exists public.trainees_batch_sync() cascade;
drop function if exists public.transfer_trainees(uuid[], uuid, date, text) cascade;
drop function if exists public.undo_trainee_transfer(uuid[]) cascade;
drop function if exists public.my_trainee_ids() cascade;
drop function if exists public.trainees_batch_default() cascade;
drop function if exists public.import_attendance(jsonb, boolean) cascade;
drop function if exists public.set_rag(uuid, text, text) cascade;
drop function if exists public.review_rag(uuid[], text) cascade;
drop function if exists public.trainee_active_on(public.trainees, date) cascade;
drop function if exists public.trainee_trainer_on(public.trainees, date) cascade;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- People who log in: trainers and managers
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null,
  email        text not null unique,
  role         text not null check (role in ('trainer', 'manager')),
  manager_id   uuid references public.profiles(id) on delete set null,
  employee_id  text unique,
  department   text,
  status       text not null default 'active' check (status in ('active', 'inactive')),
  created_at   timestamptz not null default now()
);

create table if not exists public.settings (
  id                             int primary key default 1 check (id = 1),
  attendance_deadline            time not null default '12:00',
  escalation_threshold           int  not null default 3 check (escalation_threshold >= 1),
  reminder_enabled               boolean not null default true,
  browser_notifications_enabled  boolean not null default true,
  sunday_week_off                boolean not null default true,
  second_saturday_week_off       boolean not null default true,
  fourth_saturday_week_off       boolean not null default true,
  edit_window_days               int  not null default 3 check (edit_window_days >= 0),
  tracking_start_date            date not null default current_date, -- no missed-day alerts before this
  timezone                       text not null default 'Asia/Kolkata',
  updated_at                     timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Trainees do not log in; their trainer marks attendance for them
create table if not exists public.trainees (
  id                 uuid primary key default gen_random_uuid(),
  employee_code      text,
  name               text not null,
  trainer_id         uuid references public.profiles(id) on delete set null,
  department         text,
  reporting_manager  text,
  joining_date       date not null default current_date,
  tcd_lwd            date,  -- last training day / last working day
  exit_reason        text check (exit_reason in ('handover', 'resigned', 'not_certified', 'service_not_required', 'doj_revised', 'offer_revoked')),
  status             text not null default 'active' check (status in ('active', 'inactive')),
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists trainees_trainer_idx on public.trainees (trainer_id);

create table if not exists public.attendance (
  id               uuid primary key default gen_random_uuid(),
  trainee_id       uuid not null references public.trainees(id) on delete cascade,
  attendance_date  date not null,
  status           text not null check (status in ('present', 'absent', 'half_day', 'holiday')),
  marked_by        uuid references public.profiles(id) on delete set null,
  marked_at        timestamptz not null default now(),
  is_late          boolean not null default false,
  unique (trainee_id, attendance_date)
);
create index if not exists attendance_date_idx on public.attendance (attendance_date);

create table if not exists public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  notification_type  text not null, -- reminder | missed | attention | escalation | system
  title              text not null,
  message            text not null,
  read_status        boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- One row per trainer per day they did not finish marking by the deadline
create table if not exists public.attendance_alerts (
  id                uuid primary key default gen_random_uuid(),
  trainer_id        uuid not null references public.profiles(id) on delete cascade,
  attendance_date   date not null,
  unmarked_count    int  not null default 0,
  miss_number       int  not null default 1,   -- running missed-day counter for the trainer
  manager_notified  boolean not null default false,
  resolved          boolean not null default false, -- true once every trainee is marked (late)
  created_at        timestamptz not null default now(),
  unique (trainer_id, attendance_date)
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'manager' and status = 'active');
$$;

create or replace function public.my_manager_id() returns uuid
language sql stable security definer set search_path = public as $$
  select manager_id from profiles where id = auth.uid();
$$;

-- Sunday / 2nd Saturday / 4th Saturday, from live settings
create or replace function public.is_week_off(d date) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s   settings;
  dow int := extract(isodow from d);
  nth int := ceil(extract(day from d) / 7.0);
begin
  select * into s from settings where id = 1;
  return (dow = 7 and s.sunday_week_off)
      or (dow = 6 and nth = 2 and s.second_saturday_week_off)
      or (dow = 6 and nth = 4 and s.fourth_saturday_week_off);
end $$;

-- Is this trainee expected to have attendance on this date?
-- trainee_active_on() is defined in the training-periods section below

-- ---------------------------------------------------------------------
-- Training periods (handover / bring back)
-- training_periods = [{"start":"2026-08-03","end":"2026-09-11","reason":"handover"},
--                     {"start":"2026-10-05","end":null,"reason":null}]
-- A trainee is only on the register on dates inside a period.
-- joining_date / tcd_lwd / exit_reason are kept in sync automatically
-- (first start, last end, last reason).
-- Only managers can change DOJ, handover dates or training status.
-- ---------------------------------------------------------------------
alter table public.trainees add column if not exists training_periods jsonb not null default '[]'::jsonb;

update public.trainees
set training_periods = jsonb_build_array(jsonb_build_object('start', joining_date, 'end', tcd_lwd, 'reason', exit_reason))
where training_periods = '[]'::jsonb;

create or replace function public.trainee_active_on(t public.trainees, d date) returns boolean
language sql immutable as $$
  select t.status = 'active'
     and (coalesce(t.exit_reason, '') not in ('doj_revised', 'offer_revoked') or t.tcd_lwd is not null)
     and case
           when coalesce(jsonb_array_length(t.training_periods), 0) = 0
             then d >= t.joining_date and (t.tcd_lwd is null or d <= t.tcd_lwd)
           else exists (
             select 1 from jsonb_array_elements(t.training_periods) p
             where d >= (p->>'start')::date and (p->>'end' is null or d <= (p->>'end')::date))
         end;
$$;

create or replace function public.trainees_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mgr      boolean := auth.uid() is null or is_manager();   -- SQL editor / service role count as manager
  n        int;
  p        jsonb;
  prev_end date;
begin
  if tg_op = 'INSERT' then
    if not mgr then
      new.tcd_lwd := null; new.exit_reason := null; new.training_periods := '[]'::jsonb;
    end if;
  else
    if not mgr and (new.training_periods is distinct from old.training_periods
                    or new.tcd_lwd is distinct from old.tcd_lwd
                    or new.exit_reason is distinct from old.exit_reason
                    or new.joining_date is distinct from old.joining_date) then
      raise exception 'Only a manager can change DOJ, handover or training status';
    end if;
    -- Form edits of TCD / status (or DOJ) without touching the periods → apply them to the periods
    if new.training_periods is not distinct from old.training_periods
       and coalesce(jsonb_array_length(new.training_periods), 0) > 0 then
      n := jsonb_array_length(new.training_periods);
      if new.joining_date is distinct from old.joining_date
         and (new.training_periods->0->>'start')::date = old.joining_date then
        new.training_periods := jsonb_set(new.training_periods, '{0,start}', to_jsonb(new.joining_date));
      end if;
      if new.tcd_lwd is distinct from old.tcd_lwd or new.exit_reason is distinct from old.exit_reason then
        new.training_periods := jsonb_set(new.training_periods, array[(n - 1)::text, 'end'], coalesce(to_jsonb(new.tcd_lwd), 'null'::jsonb));
        new.training_periods := jsonb_set(new.training_periods, array[(n - 1)::text, 'reason'], coalesce(to_jsonb(new.exit_reason), 'null'::jsonb));
      end if;
    end if;
  end if;

  if new.training_periods is null or jsonb_array_length(new.training_periods) = 0 then
    new.training_periods := jsonb_build_array(jsonb_build_object('start', new.joining_date, 'end', new.tcd_lwd, 'reason', new.exit_reason));
  end if;

  -- Sort, validate, and keep TCD / status in step with the latest period
  select jsonb_agg(x order by (x->>'start')::date) into new.training_periods from jsonb_array_elements(new.training_periods) x;
  prev_end := null;
  for p in select * from jsonb_array_elements(new.training_periods) loop
    if p->>'start' is null then raise exception 'Every training period needs a start date'; end if;
    if (p->>'start')::date < new.joining_date then raise exception 'Training cannot start before the DOJ'; end if;
    if p->>'end' is not null and (p->>'end')::date < (p->>'start')::date then
      raise exception 'Handover date cannot be before the training start date';
    end if;
    if prev_end is not null and (p->>'start')::date <= prev_end then
      raise exception 'Training must restart after the previous handover date';
    end if;
    prev_end := coalesce((p->>'end')::date, '9999-12-31'::date);
  end loop;

  n := jsonb_array_length(new.training_periods);
  new.tcd_lwd := (new.training_periods->(n - 1)->>'end')::date;
  new.exit_reason := nullif(new.training_periods->(n - 1)->>'reason', '');
  return new;
end $$;

drop trigger if exists trg_trainees_before_write on public.trainees;
create trigger trg_trainees_before_write before insert or update on public.trainees
for each row execute function public.trainees_before_write();

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
    if t.trainer_id is null then
      update trainees set trainer_id = p_trainer where id = t.id;
      n := n + 1;
      continue;
    end if;

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

-- ---------------------------------------------------------------------
-- Dossier fields, RAG status, extra exit reason, attendance import
-- ---------------------------------------------------------------------
alter table public.trainees add column if not exists designation text;
alter table public.trainees add column if not exists city text;
alter table public.trainees add column if not exists official_email text;
alter table public.trainees add column if not exists track text;            -- Onboarding / Upselling / NPU …
alter table public.trainees add column if not exists rag text;
alter table public.trainees add column if not exists rag_remark text;
alter table public.trainees add column if not exists rag_updated_at timestamptz;
alter table public.trainees add column if not exists rag_updated_by uuid references public.profiles(id) on delete set null;
alter table public.trainees drop constraint if exists trainees_rag_check;
alter table public.trainees add constraint trainees_rag_check check (rag in ('green', 'amber', 'red'));
alter table public.trainees drop constraint if exists trainees_exit_reason_check;
alter table public.trainees add constraint trainees_exit_reason_check
  check (exit_reason in ('handover', 'resigned', 'not_certified', 'service_not_required', 'doj_revised', 'offer_revoked'));

-- import_attendance() is defined in the Dossier connection section

-- ---------------------------------------------------------------------
-- RAG updates by trainers and managers
-- ---------------------------------------------------------------------
alter table public.trainees add column if not exists rag_review_status text;
alter table public.trainees add column if not exists rag_reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.trainees add column if not exists rag_reviewed_at timestamptz;
alter table public.trainees add column if not exists rag_review_note text;
alter table public.trainees drop constraint if exists trainees_rag_review_status_check;
alter table public.trainees add constraint trainees_rag_review_status_check check (rag_review_status in ('pending', 'reviewed'));

-- Trainer (any trainee they have or had) or manager sets RAG + remark. No approval step.
create or replace function public.set_rag(p_trainee uuid, p_rag text, p_remark text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me  profiles;
  t   trainees;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then raise exception 'Sign in as a trainer or manager'; end if;
  select * into t from trainees where id = p_trainee;
  if t.id is null then raise exception 'Trainee not found'; end if;
  if me.role <> 'manager' and not (t.trainer_id = me.id or exists (select 1 from trainee_assignments where trainee_id = t.id and trainer_id = me.id)) then
    raise exception 'You can only update RAG for your own trainees';
  end if;
  if p_rag is not null and p_rag not in ('green', 'amber', 'red') then raise exception 'Choose Green, Amber or Red'; end if;
  update trainees set rag = p_rag, rag_remark = nullif(trim(p_remark), ''), rag_updated_at = now(), rag_updated_by = me.id,
         rag_review_status = null, rag_reviewed_by = null, rag_reviewed_at = null, rag_review_note = null
  where id = t.id;
end $$;

drop function if exists public.review_rag(uuid[], text);

grant execute on function public.set_rag(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Dossier connection (Google Apps Script → /api/dossier-sync)
-- ---------------------------------------------------------------------
create table if not exists public.sync_log (
  id               uuid primary key default gen_random_uuid(),
  run_id           text,
  source           text not null default 'dossier',
  rows_received    int not null default 0,
  added            int not null default 0,
  updated          int not null default 0,
  attendance_days  int not null default 0,
  errors           text,
  created_at       timestamptz not null default now()
);
create index if not exists sync_log_created_idx on public.sync_log (created_at desc);
alter table public.sync_log enable row level security;
drop policy if exists sync_log_select on public.sync_log;
create policy sync_log_select on public.sync_log for select to authenticated using (public.is_manager());

-- Attendance import: managers, or the server sync (service role, no signed-in user)
create or replace function public.import_attendance(p_rows jsonb, p_overwrite boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r   jsonb;
  t   trainees;
  d   date;
  n   int := 0;
  cnt int;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'Only a manager can import attendance'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    d := (r->>'date')::date;
    if r->>'status' not in ('present', 'absent', 'half_day', 'holiday') then continue; end if;
    if d > (now() at time zone (select timezone from settings where id = 1))::date then continue; end if;
    if is_week_off(d) then continue; end if;
    select * into t from trainees where id = (r->>'trainee_id')::uuid;
    if t.id is null or not trainee_active_on(t, d) then continue; end if;
    if p_overwrite then
      insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late)
      values (t.id, d, r->>'status', auth.uid(), now(), false)
      on conflict (trainee_id, attendance_date) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();
    else
      insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late)
      values (t.id, d, r->>'status', auth.uid(), now(), false)
      on conflict (trainee_id, attendance_date) do nothing;
    end if;
    get diagnostics cnt = row_count;
    n := n + cnt;
  end loop;
  return n;
end $$;
grant execute on function public.import_attendance(jsonb, boolean) to authenticated;

create or replace function public.resolve_login(p_identifier text) returns text
language sql stable security definer set search_path = public as $$
  select email from profiles where lower(employee_id) = lower(trim(p_identifier)) and status = 'active' limit 1;
$$;

create or replace function public.app_has_users() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles);
$$;

-- ---------------------------------------------------------------------
-- Mark attendance for one or many trainees on one date
-- p_items: [{"trainee_id": "...", "status": "present|absent|half_day|holiday"}]
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Missed attendance detection + reminders + escalation (idempotent)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.settings          enable row level security;
alter table public.trainees          enable row level security;
alter table public.attendance        enable row level security;
alter table public.notifications     enable row level security;
alter table public.attendance_alerts enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using (true);
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists trainees_select on public.trainees;
create policy trainees_select on public.trainees for select to authenticated
  using (trainer_id = auth.uid() or public.is_manager() or id in (select public.my_trainee_ids()));
drop policy if exists trainees_insert on public.trainees;
create policy trainees_insert on public.trainees for insert to authenticated
  with check (trainer_id = auth.uid() or public.is_manager());
drop policy if exists trainees_update on public.trainees;
create policy trainees_update on public.trainees for update to authenticated
  using (trainer_id = auth.uid() or public.is_manager())
  with check (trainer_id = auth.uid() or public.is_manager());
-- ---------------------------------------------------------------------
-- Deleting a trainee never removes their attendance or reports.
-- "Delete" only hides the trainee everywhere except Monthly Sheet,
-- Attendance History and Analytics. Nobody can hard-delete trainees.
-- ---------------------------------------------------------------------
alter table public.trainees add column if not exists deleted_at timestamptz;
alter table public.trainees add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
drop policy if exists trainees_delete on public.trainees;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.is_manager() or exists (select 1 from public.trainees t where t.id = trainee_id and public.trainee_trainer_on(t, attendance_date) = auth.uid()));
-- Writes only through mark_attendance()

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

drop policy if exists alerts_select on public.attendance_alerts;
create policy alerts_select on public.attendance_alerts for select to authenticated
  using (trainer_id = auth.uid() or public.is_manager());

grant execute on function public.resolve_login(text) to anon, authenticated;
grant execute on function public.app_has_users() to anon, authenticated;
grant execute on function public.mark_attendance(date, jsonb) to authenticated;
grant execute on function public.process_missed_attendance() to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Optional: run the check every 15 minutes (enable pg_cron first)
--   select cron.schedule('trainer-attendance-check', '*/15 * * * *',
--                        $$select public.process_missed_attendance()$$);
-- ---------------------------------------------------------------------

notify pgrst, 'reload schema';

select table_name from information_schema.tables where table_schema = 'public' and table_name in ('profiles','settings','trainees','attendance','notifications','attendance_alerts','batches','trainee_assignments','sync_log') order by 1;
