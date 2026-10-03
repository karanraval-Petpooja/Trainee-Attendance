-- =====================================================================
-- Run this ONLY if you already installed the earlier version
-- (where trainers marked their own attendance). It removes the old
-- tables, functions and the demo/app logins, so schema.sql can be
-- installed cleanly. Other Supabase users not created by this app are kept.
-- =====================================================================

-- 1) Remove logins that belong to this app
do $$ begin
  if to_regclass('public.profiles') is not null then
    delete from auth.users where id in (select id from public.profiles);
  end if;
end $$;

-- 2) Remove the scheduled job if it exists
do $$ begin
  perform cron.unschedule('trainer-attendance-check');
exception when others then null; end $$;

-- 3) Remove old tables and functions
drop trigger if exists trg_holiday_added on public.holidays;
drop table if exists public.attendance_alerts cascade;
drop table if exists public.notifications cascade;
drop table if exists public.attendance cascade;
drop table if exists public.holidays cascade;
drop table if exists public.trainees cascade;
drop table if exists public.batch_assignments cascade;
drop table if exists public.trainee_assignments cascade;
drop table if exists public.sync_log cascade;
drop table if exists public.batches cascade;
drop table if exists public.settings cascade;
drop table if exists public.profiles cascade;

drop function if exists public.notify_holiday() cascade;
drop function if exists public.day_type(date) cascade;
drop function if exists public.mark_attendance(date, text) cascade;
drop function if exists public.mark_attendance(date, jsonb) cascade;
drop function if exists public.process_missed_attendance() cascade;
drop function if exists public.resolve_login(text) cascade;
drop function if exists public.app_has_users() cascade;
drop function if exists public.is_manager() cascade;
drop function if exists public.my_manager_id() cascade;
drop function if exists public.is_week_off(date) cascade;
drop function if exists public.trainees_before_write() cascade;

drop function if exists public.create_batch(uuid, date, text, text) cascade;
drop function if exists public.transfer_batch(uuid, uuid, date, text) cascade;
drop function if exists public.undo_batch_transfer(uuid) cascade;
drop function if exists public.batch_current_trainer(uuid) cascade;
drop function if exists public.my_batch_ids() cascade;
drop function if exists public.trainees_batch_sync() cascade;
-- Now run schema.sql
drop function if exists public.transfer_trainees(uuid[], uuid, date, text) cascade;
drop function if exists public.undo_trainee_transfer(uuid[]) cascade;
drop function if exists public.my_trainee_ids() cascade;
drop function if exists public.trainees_batch_default() cascade;
drop function if exists public.import_attendance(jsonb, boolean) cascade;
drop function if exists public.set_rag(uuid, text, text) cascade;
drop function if exists public.review_rag(uuid[], text) cascade;
