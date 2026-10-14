-- =====================================================================
-- UPDATE: "Drop Out" as its own training status (from the Dossier sheet and the
-- Handover window). A drop out without a date never joined: never on the register.
-- Run once in Supabase → SQL Editor.
-- =====================================================================
alter table public.trainees drop constraint if exists trainees_exit_reason_check;
alter table public.trainees add constraint trainees_exit_reason_check
  check (exit_reason in ('handover', 'resigned', 'not_certified', 'service_not_required', 'doj_revised', 'offer_revoked', 'drop_out'));

create or replace function public.trainee_active_on(t public.trainees, d date) returns boolean
language sql immutable as $$
  select t.status = 'active'
     and (coalesce(t.exit_reason, '') not in ('doj_revised', 'offer_revoked', 'drop_out') or t.tcd_lwd is not null)
     and case
           when coalesce(jsonb_array_length(t.training_periods), 0) = 0
             then d >= t.joining_date and (t.tcd_lwd is null or d <= t.tcd_lwd)
           else exists (
             select 1 from jsonb_array_elements(t.training_periods) p
             where d >= (p->>'start')::date and (p->>'end' is null or d <= (p->>'end')::date))
         end;
$$;

notify pgrst, 'reload schema';
