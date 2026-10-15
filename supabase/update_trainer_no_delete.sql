-- =====================================================================
-- UPDATE: only a manager can remove from attendance, restore or delete a trainee.
-- Trainers keep everything else (marking attendance, RAG, editing details).
-- Run once in Supabase → SQL Editor.
-- =====================================================================
create or replace function public.trainees_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mgr      boolean := auth.uid() is null or is_manager();   -- SQL editor / service role count as manager
  n        int;
  p        jsonb;
  prev_end date;
begin
  if tg_op = 'INSERT' then
    if not mgr then
      new.tcd_lwd := null; new.exit_reason := null; new.training_periods := '[]'::jsonb;
    end if;
  else
    if not mgr and (new.training_periods is distinct from old.training_periods
                    or new.tcd_lwd is distinct from old.tcd_lwd
                    or new.exit_reason is distinct from old.exit_reason
                    or new.joining_date is distinct from old.joining_date) then
      raise exception 'Only a manager can change DOJ, handover or training status';
    end if;
    if not mgr and (new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at) then
      raise exception 'Only a manager can remove, restore or delete a trainee';
    end if;
    -- Form edits of TCD / status (or DOJ) without touching the periods → apply them to the periods
    if new.training_periods is not distinct from old.training_periods
       and coalesce(jsonb_array_length(new.training_periods), 0) > 0 then
      n := jsonb_array_length(new.training_periods);
      if new.joining_date is distinct from old.joining_date
         and (new.training_periods->0->>'start')::date = old.joining_date then
        new.training_periods := jsonb_set(new.training_periods, '{0,start}', to_jsonb(new.joining_date));
      end if;
      if new.tcd_lwd is distinct from old.tcd_lwd or new.exit_reason is distinct from old.exit_reason then
        new.training_periods := jsonb_set(new.training_periods, array[(n - 1)::text, 'end'], coalesce(to_jsonb(new.tcd_lwd), 'null'::jsonb));
        new.training_periods := jsonb_set(new.training_periods, array[(n - 1)::text, 'reason'], coalesce(to_jsonb(new.exit_reason), 'null'::jsonb));
      end if;
    end if;
  end if;

  if new.training_periods is null or jsonb_array_length(new.training_periods) = 0 then
    new.training_periods := jsonb_build_array(jsonb_build_object('start', new.joining_date, 'end', new.tcd_lwd, 'reason', new.exit_reason));
  end if;

  -- Sort, validate, and keep TCD / status in step with the latest period
  select jsonb_agg(x order by (x->>'start')::date) into new.training_periods from jsonb_array_elements(new.training_periods) x;
  prev_end := null;
  for p in select * from jsonb_array_elements(new.training_periods) loop
    if p->>'start' is null then raise exception 'Every training period needs a start date'; end if;
    if (p->>'start')::date < new.joining_date then raise exception 'Training cannot start before the DOJ'; end if;
    if p->>'end' is not null and (p->>'end')::date < (p->>'start')::date then
      raise exception 'Handover date cannot be before the training start date';
    end if;
    if prev_end is not null and (p->>'start')::date <= prev_end then
      raise exception 'Training must restart after the previous handover date';
    end if;
    prev_end := coalesce((p->>'end')::date, '9999-12-31'::date);
  end loop;

  n := jsonb_array_length(new.training_periods);
  new.tcd_lwd := (new.training_periods->(n - 1)->>'end')::date;
  new.exit_reason := nullif(new.training_periods->(n - 1)->>'reason', '');
  return new;
end $$;

-- deleting a trainee row outright: managers only
drop policy if exists trainees_delete on public.trainees;
create policy trainees_delete on public.trainees for delete to authenticated using (public.is_manager());

notify pgrst, 'reload schema';
