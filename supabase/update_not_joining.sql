  -- =====================================================================
  -- UPDATE: any training status other than Handover = not joining.
  -- Resigned, Not Certified, Service Not Required, DOJ Revised, Offer Revoked and
  -- Drop Out are removed from training attendance straight away (register,
  -- missed-attendance alerts, reports). Attendance records are kept, so changing
  -- the status back brings them back. Run once in Supabase → SQL Editor.
  -- =====================================================================
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

  notify pgrst, 'reload schema';
