-- =====================================================================
-- UPDATE: manager-only Handover + Bring back for training.
-- Keeps all your existing trainees and attendance. Run once in
-- Supabase → SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Training periods (handover / bring back)
-- training_periods = [{"start":"2026-08-03","end":"2026-09-11","reason":"handover"},
--                     {"start":"2026-10-05","end":null,"reason":null}]
-- A trainee is only on the register on dates inside a period.
-- joining_date / tcd_lwd / exit_reason are kept in sync automatically
-- (first start, last end, last reason).
-- Only managers can change DOJ, handover dates or training status.
-- ---------------------------------------------------------------------
alter table public.trainees add column if not exists training_periods jsonb not null default '[]'::jsonb;

update public.trainees
set training_periods = jsonb_build_array(jsonb_build_object('start', joining_date, 'end', tcd_lwd, 'reason', exit_reason))
where training_periods = '[]'::jsonb;

create or replace function public.trainee_active_on(t public.trainees, d date) returns boolean
language sql immutable as $$
  select t.status = 'active'
     and coalesce(t.exit_reason, '') not in ('doj_revised', 'offer_revoked')
     and case
           when coalesce(jsonb_array_length(t.training_periods), 0) = 0
             then d >= t.joining_date and (t.tcd_lwd is null or d <= t.tcd_lwd)
           else exists (
             select 1 from jsonb_array_elements(t.training_periods) p
             where d >= (p->>'start')::date and (p->>'end' is null or d <= (p->>'end')::date))
         end;
$$;

create or replace function public.trainees_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mgr     boolean := auth.uid() is null or is_manager();   -- SQL editor / service role count as manager
  n       int;
  p       jsonb;
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
    -- Form edits of DOJ / TCD / status without touching periods → apply them to the periods
    if new.training_periods is not distinct from old.training_periods
       and coalesce(jsonb_array_length(new.training_periods), 0) > 0 then
      n := jsonb_array_length(new.training_periods);
      new.training_periods := jsonb_set(new.training_periods, '{0,start}', to_jsonb(new.joining_date));
      new.training_periods := jsonb_set(new.training_periods, array[(n - 1)::text, 'end'], coalesce(to_jsonb(new.tcd_lwd), 'null'::jsonb));
      new.training_periods := jsonb_set(new.training_periods, array[(n - 1)::text, 'reason'], coalesce(to_jsonb(new.exit_reason), 'null'::jsonb));
    end if;
  end if;

  if new.training_periods is null or jsonb_array_length(new.training_periods) = 0 then
    new.training_periods := jsonb_build_array(jsonb_build_object('start', new.joining_date, 'end', new.tcd_lwd, 'reason', new.exit_reason));
  end if;

  -- Sort, validate, and derive the summary columns
  select jsonb_agg(x order by (x->>'start')::date) into new.training_periods from jsonb_array_elements(new.training_periods) x;
  prev_end := null;
  for p in select * from jsonb_array_elements(new.training_periods) loop
    if p->>'start' is null then raise exception 'Every training period needs a start date'; end if;
    if p->>'end' is not null and (p->>'end')::date < (p->>'start')::date then
      raise exception 'Handover date cannot be before the training start date';
    end if;
    if prev_end is not null and (p->>'start')::date <= prev_end then
      raise exception 'Training must restart after the previous handover date';
    end if;
    prev_end := coalesce((p->>'end')::date, '9999-12-31'::date);
  end loop;

  n := jsonb_array_length(new.training_periods);
  new.joining_date := (new.training_periods->0->>'start')::date;
  new.tcd_lwd := (new.training_periods->(n - 1)->>'end')::date;
  new.exit_reason := nullif(new.training_periods->(n - 1)->>'reason', '');
  return new;
end $$;

drop trigger if exists trg_trainees_before_write on public.trainees;
create trigger trg_trainees_before_write before insert or update on public.trainees
for each row execute function public.trainees_before_write();

-- ---------------------------------------------------------------------
-- Deleting a trainee never removes their attendance or reports.
-- "Delete" only hides the trainee everywhere except Monthly Sheet,
-- Attendance History and Analytics. Nobody can hard-delete trainees.
-- ---------------------------------------------------------------------
alter table public.trainees add column if not exists deleted_at timestamptz;
alter table public.trainees add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
drop policy if exists trainees_delete on public.trainees;

notify pgrst, 'reload schema';
