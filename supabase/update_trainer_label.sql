-- =====================================================================
-- UPDATE: full Dossier history
--  1) keep the Dossier "Trainer Name" on every trainee, for reference
--     (old trainers who left have no login: their trainees keep the name only)
--  2) remove the 14 Aug 2026 cut-off so every row of the sheet is read
--     (can be set again any time: Settings → Dossier connection)
-- Run once in Supabase → SQL Editor.
-- =====================================================================
alter table public.trainees add column if not exists trainer_label text;
alter table public.settings add column if not exists dossier_from_date date;
update public.settings set dossier_from_date = null where id = 1;
notify pgrst, 'reload schema';
