-- =====================================================================
-- UPDATE: OJT / Upskill / PIP / Refresher sessions (upload attendance + score sheet, charts).
-- Safe to run again (also adds session length + minimum time + type).
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- =====================================================================
-- ---------------------------------------------------------------------
-- OJT (on-the-job training) sessions uploaded from the attendance + score sheet
-- ---------------------------------------------------------------------
create table if not exists public.ojt_sessions (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  session_date     date not null,
  trainer_id       uuid references public.profiles(id) on delete set null,
  batch_id         uuid references public.batches(id) on delete set null,
  pass_percent     numeric not null default 70,
  notes            text,
  source_file      text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create table if not exists public.ojt_participants (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.ojt_sessions(id) on delete cascade,
  full_name         text not null,
  email             text,
  duration_minutes  int,
  time_joined       text,
  time_exited       text,
  attendance        text check (attendance in ('P', 'A')),
  score             numeric,
  total             numeric,
  result            text check (result in ('Pass', 'Fail', 'Absent')),
  created_at        timestamptz not null default now()
);
create index if not exists ojt_participants_session_idx on public.ojt_participants (session_id);

create or replace function public.can_access_ojt(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or exists (
    select 1 from ojt_sessions s where s.id = p_session and (s.created_by = auth.uid() or s.trainer_id = auth.uid()));
$$;

alter table public.ojt_sessions enable row level security;
alter table public.ojt_participants enable row level security;
drop policy if exists ojt_sessions_select on public.ojt_sessions;
create policy ojt_sessions_select on public.ojt_sessions for select to authenticated
  using (public.is_manager() or created_by = auth.uid() or trainer_id = auth.uid());
drop policy if exists ojt_sessions_insert on public.ojt_sessions;
create policy ojt_sessions_insert on public.ojt_sessions for insert to authenticated
  with check (created_by = auth.uid());
drop policy if exists ojt_sessions_update on public.ojt_sessions;
create policy ojt_sessions_update on public.ojt_sessions for update to authenticated
  using (public.is_manager() or created_by = auth.uid()) with check (public.is_manager() or created_by = auth.uid());
drop policy if exists ojt_sessions_delete on public.ojt_sessions;
create policy ojt_sessions_delete on public.ojt_sessions for delete to authenticated
  using (public.is_manager() or created_by = auth.uid());
drop policy if exists ojt_participants_all on public.ojt_participants;
create policy ojt_participants_all on public.ojt_participants for all to authenticated
  using (public.can_access_ojt(session_id)) with check (public.can_access_ojt(session_id));

-- Session length, minimum time to count as Present, and session type (OJT / Upskill / PIP / Refresher)
alter table public.ojt_sessions add column if not exists session_type text not null default 'OJT';
alter table public.ojt_sessions add column if not exists session_minutes int;
alter table public.ojt_sessions add column if not exists min_present_minutes int;
alter table public.ojt_sessions drop constraint if exists ojt_sessions_type_check;
alter table public.ojt_sessions add constraint ojt_sessions_type_check check (session_type in ('OJT', 'Upskill', 'PIP', 'Refresher'));

notify pgrst, 'reload schema';
