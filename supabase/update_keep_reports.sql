-- =====================================================================
-- UPDATE: deleting a trainee keeps their attendance and reports.
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Deleting a trainee never removes their attendance or reports.
-- "Delete" only hides the trainee everywhere except Monthly Sheet,
-- Attendance History and Analytics. Nobody can hard-delete trainees.
-- ---------------------------------------------------------------------
alter table public.trainees add column if not exists deleted_at timestamptz;
alter table public.trainees add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
drop policy if exists trainees_delete on public.trainees;

notify pgrst, 'reload schema';
