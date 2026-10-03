-- =====================================================================
-- CLEAR TRAINEE DATA — keeps every login (manager + trainers).
-- Deletes all trainees, their attendance, batches, missed-day alerts,
-- notifications and sync history, so you can import the Dossier fresh.
-- Run in Supabase → SQL Editor.
-- =====================================================================
delete from public.attendance;
delete from public.attendance_alerts;
delete from public.notifications;
delete from public.trainee_assignments;
delete from public.trainees;
delete from public.batches;
delete from public.sync_log;
update public.settings set tracking_start_date = (now() at time zone timezone)::date where id = 1;
notify pgrst, 'reload schema';
select (select count(*) from public.profiles) as logins_kept,
       (select count(*) from public.profiles where role = 'trainer') as trainers_kept,
       (select count(*) from public.trainees) as trainees_left;
