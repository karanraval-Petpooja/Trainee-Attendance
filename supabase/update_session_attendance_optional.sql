-- =====================================================================
-- UPDATE: Upskill / Refresher sessions can skip attendance ("Take attendance" off):
-- the participant list is saved as it is and pushed to the Training Log as Completed.
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
alter table public.ojt_sessions add column if not exists attendance_tracked boolean not null default true;
notify pgrst, 'reload schema';
select 'Optional attendance for sessions is on' as result;
