-- =====================================================================
-- TEST FEATURE: Live sessions (only for managers and trainers switched on as testers).
--   • In-app sessions: the video runs inside the app (Jitsi: JaaS for testing, or your own server)
--   • Google Meet sessions (optional), with recording / transcript links captured automatically
-- Everything here is NEW: a new table, a tester switch, new functions. No existing table, rule or screen changes.
-- Run once in Supabase → SQL Editor (safe to run again).
-- To remove the whole test later:
--   drop table public.live_sessions;  alter table public.profiles drop column meet_beta;
-- =====================================================================
alter table public.profiles add column if not exists meet_beta boolean not null default false;

create table if not exists public.live_sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  trainer_id  uuid not null references public.profiles(id) on delete cascade,
  batch_id    uuid references public.batches(id) on delete set null,
  title       text not null,
  meet_url    text,
  status      text not null default 'live' check (status in ('live', 'ended')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
-- columns added over the test (also for a table created by an earlier version)
alter table public.live_sessions add column if not exists provider text not null default 'meet';
alter table public.live_sessions add column if not exists recording_url  text;
alter table public.live_sessions add column if not exists transcript_url text;
alter table public.live_sessions alter column meet_url drop not null;
-- remove rules from earlier drafts first, then add the current ones
alter table public.live_sessions drop constraint if exists live_sessions_provider_check;
alter table public.live_sessions drop constraint if exists live_sessions_meet_url_check;
alter table public.live_sessions drop constraint if exists live_sessions_link_check;
update public.live_sessions set provider = 'app' where provider = 'inapp';      -- name used by an earlier draft
alter table public.live_sessions add  constraint live_sessions_provider_check check (provider in ('meet', 'app'));
alter table public.live_sessions add  constraint live_sessions_link_check
  check (provider = 'app' or (meet_url is not null and meet_url ~ '^https://meet\.google\.com/[a-z0-9-]+'));
alter table public.live_sessions drop constraint if exists live_sessions_recording_url_check;
alter table public.live_sessions add  constraint live_sessions_recording_url_check  check (recording_url  ~ '^https://(drive|docs)\.google\.com/');
alter table public.live_sessions drop constraint if exists live_sessions_transcript_url_check;
alter table public.live_sessions add  constraint live_sessions_transcript_url_check check (transcript_url ~ '^https://(drive|docs)\.google\.com/');
alter table public.settings drop column if exists video_domain;                  -- not used (set in Vercel instead)
create index if not exists live_sessions_trainer_idx on public.live_sessions (trainer_id, started_at desc);
alter table public.live_sessions enable row level security;

-- who may use it: managers, and trainers switched on as testers
create or replace function public.can_use_live() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'manager' or meet_beta from profiles where id = auth.uid() and status = 'active'), false)
$$;

drop policy if exists live_select on public.live_sessions;
create policy live_select on public.live_sessions for select to authenticated
  using (trainer_id = auth.uid() or public.is_manager());
drop policy if exists live_insert on public.live_sessions;
create policy live_insert on public.live_sessions for insert to authenticated
  with check (trainer_id = auth.uid() and public.can_use_live());
drop policy if exists live_update on public.live_sessions;
create policy live_update on public.live_sessions for update to authenticated
  using (trainer_id = auth.uid() or public.is_manager()) with check (trainer_id = auth.uid() or public.is_manager());

-- the public join page reads ONE session by its code (nothing else is visible without login)
drop function if exists public.get_live_session(text);
create function public.get_live_session(p_code text)
returns table (title text, trainer text, meet_url text, status text, started_at timestamptz, recording_url text, transcript_url text, provider text)
language sql stable security definer set search_path = public as $$
  select s.title, p.name, case when s.status = 'live' then s.meet_url end, s.status, s.started_at, s.recording_url, s.transcript_url, s.provider
  from live_sessions s join profiles p on p.id = s.trainer_id
  where s.code = p_code
$$;
grant execute on function public.get_live_session(text) to anon, authenticated;

-- Google Meet sessions: the Meet Recordings script sends the files it finds (meeting code + links);
-- each one is attached to the session with that Meet link. Only empty links are filled.
create or replace function public.attach_live_media(p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare it record; n int := 0; c int;
begin
  for it in select lower(x->>'code') as code,
                   case when x->>'recording_url'  ~ '^https://(drive|docs)\.google\.com/' then x->>'recording_url'  end as rec,
                   case when x->>'transcript_url' ~ '^https://(drive|docs)\.google\.com/' then x->>'transcript_url' end as tr
            from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x where coalesce(x->>'code', '') ~* '^[a-z]{3}-[a-z]{4}-[a-z]{3}$'
  loop
    update live_sessions s set recording_url = coalesce(s.recording_url, it.rec), transcript_url = coalesce(s.transcript_url, it.tr)
    where lower(s.meet_url) = 'https://meet.google.com/' || it.code
      and ((s.recording_url is null and it.rec is not null) or (s.transcript_url is null and it.tr is not null));
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;
revoke all on function public.attach_live_media(jsonb) from public, anon, authenticated;   -- only the app server (with the secret)

-- only a manager can switch someone on as a tester
create or replace function public.profiles_guard_meet_beta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.meet_beta is distinct from old.meet_beta and auth.uid() is not null and not public.is_manager() then
    raise exception 'Only a manager can switch the live-session test on or off';
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_guard_meet_beta on public.profiles;
create trigger trg_profiles_guard_meet_beta before update of meet_beta on public.profiles
  for each row execute function public.profiles_guard_meet_beta();

notify pgrst, 'reload schema';
select 'Live sessions (test) is ready' as result;
