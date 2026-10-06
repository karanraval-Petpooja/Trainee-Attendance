-- =====================================================================
-- Permanently remove trainees that are "Deleted, reports kept" and "Removed",
-- with their attendance, trainer history and reminders. Cannot be undone.
-- Also lets managers delete permanently from the app from now on.
-- Run in Supabase → SQL Editor.
-- =====================================================================

-- STEP 1 — Preview (nothing is deleted)
select case when deleted_at is not null then 'Deleted, reports kept'
            when status <> 'active' then 'Removed'
            else 'Kept (in training / handed over / joining soon)' end as grp,
       count(*) as trainees
from public.trainees group by 1 order by 1;

-- STEP 2 — Delete them permanently
delete from public.trainees where deleted_at is not null;
delete from public.trainees where status <> 'active';

-- STEP 3 — Batches left with no trainees at all (optional tidy-up)
delete from public.batches b where not exists (select 1 from public.trainees t where t.batch_id = b.id);

-- STEP 4 — Allow managers to delete permanently from the app
-- Managers may delete trainees permanently (attendance, history and reminders go with them)
drop policy if exists trainees_delete on public.trainees;
create policy trainees_delete on public.trainees for delete to authenticated using (public.is_manager());

-- STEP 5 — Check
select count(*) filter (where deleted_at is not null) as deleted_left,
       count(*) filter (where status <> 'active')     as removed_left,
       count(*)                                        as trainees_now
from public.trainees;

notify pgrst, 'reload schema';
