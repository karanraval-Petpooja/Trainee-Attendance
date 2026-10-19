-- =====================================================================
-- UPDATE: notifications on the phone (Web Push).
-- 1) push_subscriptions: the phones / browsers each person turned notifications on for
-- 2) every new row in notifications is handed to the app, which sends it to those phones
-- Run once in Supabase → SQL Editor. CHANGE the app address in STEP 2 to yours.
-- =====================================================================

-- 1) Phones that receive notifications
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private settings for the push hand-over (nobody can read this from the app)
create table if not exists public.push_config (
  id       int primary key default 1 check (id = 1),
  app_url  text,
  secret   text not null default encode(gen_random_bytes(24), 'hex')
);
alter table public.push_config enable row level security;   -- no policies: closed to the app

-- STEP 2: your app address (no / at the end)  ← CHANGE THIS
insert into public.push_config (id, app_url) values (1, 'https://attendance-five-sable.vercel.app')
on conflict (id) do update set app_url = excluded.app_url;

-- 3) Each new notification → the app's /api/push/send (via pg_net, built into Supabase)
create extension if not exists pg_net;

create or replace function public.push_new_notification() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare cfg record;
begin
  select app_url, secret into cfg from public.push_config where id = 1;
  if cfg.app_url is null or not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    return new;                                   -- nobody to send to: nothing to do
  end if;
  perform net.http_post(
    url     := rtrim(cfg.app_url, '/') || '/api/push/send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret),
    body    := jsonb_build_object('id', new.id)
  );
  return new;
exception when others then
  return new;                                     -- a push problem never blocks the notification itself
end $$;

drop trigger if exists trg_push_new_notification on public.notifications;
create trigger trg_push_new_notification after insert on public.notifications
  for each row execute function public.push_new_notification();

notify pgrst, 'reload schema';
select 'Phone notifications are on' as result, app_url from public.push_config;
