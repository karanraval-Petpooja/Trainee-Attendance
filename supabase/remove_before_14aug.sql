-- =====================================================================
-- Remove trainees whose training started before 14 Aug 2026, and stop the
-- Dossier sync / Excel import from adding them again.
-- Run in Supabase → SQL Editor. Run STEP 1 first to see what will go.
-- =====================================================================

-- Cut-off saved in the app (Settings → Dossier connection shows and edits it)
alter table public.settings add column if not exists dossier_from_date date;
update public.settings set dossier_from_date = '2026-08-14' where id = 1;

-- STEP 1 (preview): how many trainees will be removed / kept
select
  count(*) filter (where gone)     as will_be_removed,
  count(*) filter (where not gone) as will_stay
from (
  select t.joining_date < '2026-08-14'
         and not exists (select 1 from jsonb_array_elements(coalesce(t.training_periods, '[]'::jsonb)) p
                         where (p->>'start') >= '2026-08-14') as gone
  from public.trainees t
) x;

-- STEP 2: remove them (their attendance, RAG and reminders go with them).
-- Someone whose DOJ is older but who was retrained in a batch from 14 Aug onward is KEPT.
delete from public.trainees t
where t.joining_date < '2026-08-14'
  and not exists (select 1 from jsonb_array_elements(coalesce(t.training_periods, '[]'::jsonb)) p
                  where (p->>'start') >= '2026-08-14');

-- STEP 3: remove batches that are now empty and started before the cut-off
delete from public.batches b
where coalesce(b.start_date, '1900-01-01') < '2026-08-14'
  and not exists (select 1 from public.trainees t where t.batch_id = b.id);

notify pgrst, 'reload schema';

-- Check
select count(*) as trainees_left, min(joining_date) as earliest_doj from public.trainees;
