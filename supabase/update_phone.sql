-- =====================================================================
-- UPDATE: trainee mobile number (from the sheet's "Number" column).
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- =====================================================================
-- Mobile number from the sheet ("Number" column)
alter table public.trainees add column if not exists phone text;

notify pgrst, 'reload schema';
