-- =====================================================================
-- UPDATE: one Public Holiday calendar for everyone.
-- Managers list holidays once (Settings → Public holidays). On those days, for every trainee:
--   • no attendance is needed (no reminders, no missed-attendance alerts)
--   • the Monthly Sheet shows H (paid), the same for everyone
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
alter table public.settings add column if not exists public_holidays jsonb not null default '[]'::jsonb; -- [{ "date": "2026-11-09", "name": "Diwali" }]

create or replace function public.is_public_holiday(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from settings s, jsonb_array_elements(coalesce(s.public_holidays, '[]'::jsonb)) h
                 where s.id = 1 and (h->>'date')::date = d)
$$;

-- a non-working day for everyone: week off OR public holiday (used by marking, reminders and missed alerts)
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
      or (dow = 6 and nth = 4 and s.fourth_saturday_week_off)
      or public.is_public_holiday(d);
end $$;

notify pgrst, 'reload schema';
select 'Public holiday calendar is on' as result, jsonb_array_length(public_holidays) as holidays from public.settings where id = 1;
