-- =====================================================================
-- FIX: data-usage alert showed 2.5 GB while Supabase → Usage shows 0.67 GB.
-- The app counted data UNcompressed; Supabase counts it compressed (much smaller).
-- Now the app's number is multiplied by a correction factor, set from Supabase's real figure.
-- Run once in Supabase → SQL Editor. No trainee / attendance data is touched.
-- =====================================================================
alter table public.settings add column if not exists egress_factor numeric not null default 1;

-- raw count from the devices (uncompressed)
create or replace function public.egress_raw_gb() returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce(sum(bytes), 0) / 1073741824.0, 3) from egress_usage where day >= public.egress_cycle_start()
$$;
grant execute on function public.egress_raw_gb() to authenticated;

-- used so far in this cycle (GB), corrected to match Supabase
create or replace function public.egress_used_gb() returns numeric
language sql stable security definer set search_path = public as $$
  select round(public.egress_raw_gb() * coalesce((select egress_factor from settings where id = 1), 1), 3)
$$;
grant execute on function public.egress_used_gb() to authenticated;

-- Manager types what Supabase → Usage shows (Egress, GB) → the factor is worked out
create or replace function public.calibrate_egress(p_actual_gb numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare raw numeric := public.egress_raw_gb(); s record;
begin
  if not is_manager() then raise exception 'Only a manager can do this'; end if;
  if p_actual_gb is null or p_actual_gb < 0 then raise exception 'Enter the Egress GB shown in Supabase → Usage'; end if;
  if raw <= 0 then raise exception 'No usage counted yet in this cycle'; end if;
  update settings set egress_factor = least(1, greatest(0.05, round(p_actual_gb / raw, 4))) where id = 1;
  select * into s from settings where id = 1;
  -- below the alert level again → the alert can fire again this cycle when it is really reached
  if public.egress_used_gb() < s.egress_alert_gb then update settings set egress_alerted_cycle = null where id = 1; end if;
  return public.egress_used_gb();
end $$;
grant execute on function public.calibrate_egress(numeric) to authenticated;

-- One-time correction with today's figure from Supabase (0.67 GB) and removal of the early alert
do $$
declare raw numeric := public.egress_raw_gb();
begin
  if raw > 0 then update settings set egress_factor = least(1, greatest(0.05, round(0.67 / raw, 4))) where id = 1; end if;
  update settings set egress_alerted_cycle = null where id = 1;
  delete from notifications where notification_type = 'system' and title like 'Supabase data usage:%'
    and created_at >= public.egress_cycle_start();
end $$;

notify pgrst, 'reload schema';
select public.egress_raw_gb() as counted_raw_gb, (select egress_factor from settings where id = 1) as factor, public.egress_used_gb() as now_shown_gb;
