-- =====================================================================
-- REMOVE DEMO DATA — start using the app with real data.
-- Deletes ALL trainees, batches, attendance, alerts and notifications,
-- and the demo logins (…@demo.com). Logins you created yourself are kept.
-- Afterwards: if no login is left, the login page lets you create the
-- first manager account.
-- Run once in Supabase → SQL Editor.
-- =====================================================================
delete from public.attendance;
delete from public.attendance_alerts;
delete from public.notifications;
delete from public.trainee_assignments;
delete from public.trainees;
delete from public.batches;
delete from auth.users where email like '%@demo.com';
update public.settings set tracking_start_date = (now() at time zone timezone)::date where id = 1;
notify pgrst, 'reload schema';
select (select count(*) from public.profiles) as logins_left, (select count(*) from public.trainees) as trainees_left;
