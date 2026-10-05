-- =====================================================================
-- UPDATE: personal email for trainees + batches created from the sheet's Batch Id.
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- =====================================================================
-- Personal email (until the company email arrives)
alter table public.trainees add column if not exists personal_email text;

-- Managers may create batches directly (Dossier import creates GN144, C143 … from the sheet)
drop policy if exists batches_insert on public.batches;
create policy batches_insert on public.batches for insert to authenticated with check (public.is_manager());

notify pgrst, 'reload schema';
