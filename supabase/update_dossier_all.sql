-- =====================================================================
-- ONE UPDATE FOR THE DOSSIER SHEET FEATURES (safe to run more than once)
--  1) "Drop Out" as its own training status
--  2) any status other than Handover = not joining: off training attendance
--     (Resigned, Not Certified, Drop Out, Offer Revoked, DOJ Revised, Service Not Required)
--  3) Dossier "Trainer Name" kept on every trainee (trainers who left: name only)
--  4) the 14 Aug 2026 cut-off removed, so the full sheet history is read
--     (can be set again any time: Settings → Dossier connection)
-- Paste ALL of this into Supabase → SQL Editor → Run.
-- =====================================================================

-- 1) Drop Out status
alter table public.trainees drop constraint if exists trainees_exit_reason_check;
alter table public.trainees add constraint trainees_exit_reason_check
  check (exit_reason in ('handover', 'resigned', 'not_certified', 'service_not_required', 'doj_revised', 'offer_revoked', 'drop_out'));

-- 2) Not joining = off training attendance
create or replace function public.trainee_active_on(t public.trainees, d date) returns boolean
language sql immutable as $$
  -- Any status other than Handover (Resigned, Not Certified, Drop Out, Offer Revoked, DOJ Revised,
  -- Service Not Required) = not joining: that (latest) training period is off the attendance.
  select t.status = 'active'
     and case
           when coalesce(jsonb_array_length(t.training_periods), 0) = 0
             then coalesce(t.exit_reason, 'handover') = 'handover'
                  and d >= t.joining_date and (t.tcd_lwd is null or d <= t.tcd_lwd)
           else exists (
             select 1 from jsonb_array_elements(t.training_periods) with ordinality p(v, i)
             where d >= (p.v->>'start')::date and (p.v->>'end' is null or d <= (p.v->>'end')::date)
               and not (p.i = jsonb_array_length(t.training_periods) and coalesce(p.v->>'reason', 'handover') <> 'handover'))
         end;
$$;

-- Clear missed-attendance alerts that only exist because of these trainees
delete from public.attendance_alerts al
where not exists (
  select 1 from public.trainees t
  where t.trainer_id = al.trainer_id and t.batch_id is not distinct from al.batch_id
    and public.trainee_active_on(t, al.attendance_date)
    and not exists (select 1 from public.attendance x where x.trainee_id = t.id and x.attendance_date = al.attendance_date));


-- 3) Trainer name from the sheet
alter table public.trainees add column if not exists trainer_label text;

-- 4) No cut-off date
alter table public.settings add column if not exists dossier_from_date date;
update public.settings set dossier_from_date = null where id = 1;

notify pgrst, 'reload schema';

select 'Done' as result;
