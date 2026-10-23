-- =====================================================================
-- UPDATE: data-usage (egress) alert.
-- The app measures the data it receives from Supabase on every device and adds it up per day.
-- Every hour, the total for the current billing cycle is checked; when it reaches the alert level
-- (default 2.5 GB) the chosen person (default karan.raval@petpooja.com) gets ONE notification per cycle
-- (in the app and as a phone notification).
-- It is a close ESTIMATE of Supabase's egress (measured before compression, so usually a bit higher).
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
create table if not exists public.egress_usage (
  day      date not null,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  bytes    bigint not null default 0,
  primary key (day, user_id)
);
alter table public.egress_usage enable row level security;   -- written only through add_egress()

alter table public.settings add column if not exists egress_cycle_day     int     not null default 1;   -- billing cycle start day (1–28)
alter table public.settings add column if not exists egress_alert_gb      numeric not null default 2.5;
alter table public.settings add column if not exists egress_alert_email   text    not null default 'karan.raval@petpooja.com';
alter table public.settings add column if not exists egress_alerted_cycle date;

-- each device reports the data it received (a few times a minute at most)
create or replace function public.add_egress(p_bytes bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_bytes is null or p_bytes <= 0 then return; end if;
  insert into egress_usage (day, user_id, bytes)
  values ((now() at time zone 'Asia/Kolkata')::date, auth.uid(), least(p_bytes, 200000000))
  on conflict (day, user_id) do update set bytes = egress_usage.bytes + excluded.bytes;
end $$;
grant execute on function public.add_egress(bigint) to authenticated;

-- start of the current billing cycle
create or replace function public.egress_cycle_start() returns date
language sql stable security definer set search_path = public as $$
  with s as (select greatest(1, least(28, coalesce(egress_cycle_day, 1))) d from settings where id = 1),
       t as (select (now() at time zone 'Asia/Kolkata')::date today)
  select case when extract(day from t.today)::int >= s.d
              then (date_trunc('month', t.today) + (s.d - 1) * interval '1 day')::date
              else (date_trunc('month', t.today) - interval '1 month' + (s.d - 1) * interval '1 day')::date end
  from s, t
$$;

-- used so far in this cycle (GB) — shown in Settings
create or replace function public.egress_used_gb() returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce(sum(bytes), 0) / 1073741824.0, 3) from egress_usage where day >= public.egress_cycle_start()
$$;
grant execute on function public.egress_used_gb() to authenticated;
grant execute on function public.egress_cycle_start() to authenticated;

-- hourly: notify once per cycle when the alert level is reached
create or replace function public.check_egress_alert() returns text
language plpgsql security definer set search_path = public as $$
declare s record; used numeric; cyc date; n int;
begin
  select * into s from settings where id = 1;
  cyc := public.egress_cycle_start();
  used := public.egress_used_gb();
  if used < s.egress_alert_gb then return format('%s GB used of %s GB alert level', used, s.egress_alert_gb); end if;
  if s.egress_alerted_cycle is not distinct from cyc then return 'already notified this cycle'; end if;
  insert into notifications (user_id, notification_type, title, message)
  select p.id, 'system', format('Supabase data usage: %s GB reached', s.egress_alert_gb),
         format('About %s GB of the 5 GB monthly data limit (egress) has been used since %s. Plan ahead: reduce what the app loads, or consider upgrading before the limit is reached.',
                used, to_char(cyc, 'DD Mon'))
  from profiles p where lower(p.email) = lower(trim(s.egress_alert_email)) and p.status = 'active';
  get diagnostics n = row_count;
  update settings set egress_alerted_cycle = cyc where id = 1;
  return format('notified %s person(s)', n);
end $$;

-- run the check every hour (needs pg_cron: Database → Extensions → pg_cron)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'egress-alert';
    perform cron.schedule('egress-alert', '5 * * * *', 'select public.check_egress_alert()');
  end if;
end $$;

notify pgrst, 'reload schema';
select 'Data-usage alert is on' as result, public.egress_cycle_start() as cycle_start, public.egress_used_gb() as used_gb_so_far;
