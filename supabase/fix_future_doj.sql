-- =====================================================================
-- FIX: trainees saved with day and month swapped (12-10-2026 read as 10 Dec 2026),
-- which makes them "Joining soon". Nobody joins in the future, so:
--   DOJ in the future whose swap is in the past  →  swap it (10 Dec → 12 Oct)
--   handover / probable dates more than ~10 months after the new DOJ → one year back (2027 → 2026)
-- Also corrects their training period, trainer history and batch start date.
-- Attendance, RAG and everything else stay as they are.
-- Run in Supabase → SQL Editor. STEP 1 shows what will change.
-- =====================================================================

-- STEP 1 (preview)
select t.name, b.code as batch, t.joining_date as doj_now,
       make_date(extract(year from t.joining_date)::int, extract(day from t.joining_date)::int, extract(month from t.joining_date)::int) as doj_fixed,
       t.tcd_lwd, t.probable_handover_date, t.exit_reason
from public.trainees t left join public.batches b on b.id = t.batch_id
where t.joining_date > current_date
  and extract(day from t.joining_date) <= 12
  and make_date(extract(year from t.joining_date)::int, extract(day from t.joining_date)::int, extract(month from t.joining_date)::int) <= current_date
order by b.code, t.name;

-- STEP 2 (fix)
drop table if exists fix_doj;
create temporary table fix_doj as
select t.id, t.joining_date as old_doj,
       make_date(extract(year from t.joining_date)::int, extract(day from t.joining_date)::int, extract(month from t.joining_date)::int) as new_doj
from public.trainees t
where t.joining_date > current_date
  and extract(day from t.joining_date) <= 12
  and make_date(extract(year from t.joining_date)::int, extract(day from t.joining_date)::int, extract(month from t.joining_date)::int) <= current_date;

-- a date more than 300 days after the new DOJ was put a year too late
create or replace function pg_temp.back_a_year(d date, doj date) returns date language sql immutable as
$$ select case when d is not null and d > doj + 300 then (d - interval '1 year')::date else d end $$;

update public.trainees t set
  joining_date = f.new_doj,
  probable_handover_date = pg_temp.back_a_year(t.probable_handover_date, f.new_doj),
  training_periods = (
    select jsonb_agg(jsonb_build_object(
             'start', case when (p->>'start')::date = f.old_doj then to_jsonb(f.new_doj) else p->'start' end,
             'end', case when p->>'end' is null then 'null'::jsonb else to_jsonb(pg_temp.back_a_year((p->>'end')::date, f.new_doj)) end,
             'reason', coalesce(p->'reason', 'null'::jsonb)) order by ord)
    from jsonb_array_elements(coalesce(nullif(t.training_periods, '[]'::jsonb),
           jsonb_build_array(jsonb_build_object('start', t.joining_date, 'end', t.tcd_lwd, 'reason', t.exit_reason)))) with ordinality x(p, ord))
from fix_doj f
where f.id = t.id;

update public.trainee_assignments a set start_date = f.new_doj
from fix_doj f where a.trainee_id = f.id and a.start_date = f.old_doj;

update public.batches b set start_date = f.new_doj
from fix_doj f join public.trainees t on t.id = f.id
where b.id = t.batch_id and b.start_date = f.old_doj;

notify pgrst, 'reload schema';

drop table if exists fix_doj;

-- Check: should be 0
select count(*) as still_joining_soon from public.trainees where joining_date > current_date and deleted_at is null;
