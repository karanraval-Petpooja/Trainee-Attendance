-- =====================================================================
-- UPDATE: keep the real DOJ for existing employees who are retrained later
-- (training starts after the DOJ). Keeps all your data. Run once.
-- =====================================================================
-- DOJ (employment date) and training periods are separate: an existing employee
-- (DOJ 2024) can be trained from Aug 2026. Only managers change DOJ / handover / status.
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

-- DOJ revised / offer revoked hide a trainee only if they never worked (no LWD)
create or replace function public.trainee_active_on(t public.trainees, d date) returns boolean
language sql immutable as $$
  select t.status = 'active'
     and (coalesce(t.exit_reason, '') not in ('doj_revised', 'offer_revoked') or t.tcd_lwd is not null)
     and case
           when coalesce(jsonb_array_length(t.training_periods), 0) = 0
             then d >= t.joining_date and (t.tcd_lwd is null or d <= t.tcd_lwd)
           else exists (
             select 1 from jsonb_array_elements(t.training_periods) p
             where d >= (p->>'start')::date and (p->>'end' is null or d <= (p->>'end')::date))
         end;
$$;

create or replace function public.transfer_trainees(p_trainees uuid[], p_trainer uuid, p_from date, p_purpose text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  me    profiles;
  t     trainees;
  cur   trainee_assignments;
  n     int := 0;
  codes text;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then raise exception 'Sign in as a trainer or manager'; end if;
  if not exists (select 1 from profiles where id = p_trainer and role = 'trainer' and status = 'active') then
    raise exception 'Choose an active trainer';
  end if;
  if p_from is null then raise exception 'Choose the date the new trainer takes over'; end if;

  for t in select * from trainees where id = any(p_trainees) loop
    if me.role <> 'manager' and t.trainer_id is distinct from me.id then
      raise exception 'You can only switch trainees who are currently with you (% is not)', t.name;
    end if;
    if t.trainer_id = p_trainer then continue; end if;
    if t.trainer_id is null then
      update trainees set trainer_id = p_trainer where id = t.id;
      n := n + 1;
      continue;
    end if;

    -- First switch for this trainee: record their history so far
    if not exists (select 1 from trainee_assignments where trainee_id = t.id) then
      insert into trainee_assignments (trainee_id, trainer_id, start_date, purpose, created_by)
      values (t.id, t.trainer_id, least(t.joining_date, p_from - 1),
              coalesce((select purpose from batches where id = t.batch_id), 'NHT'), me.id);
    end if;

    select * into cur from trainee_assignments where trainee_id = t.id order by start_date desc limit 1;
    if p_from <= cur.start_date then
      raise exception '% can only be switched after %', t.name, to_char(cur.start_date, 'FMDD Mon YYYY');
    end if;
    update trainee_assignments set end_date = p_from - 1 where id = cur.id;
    insert into trainee_assignments (trainee_id, trainer_id, start_date, purpose, created_by)
    values (t.id, p_trainer, p_from, coalesce(nullif(trim(p_purpose), ''), cur.purpose), me.id);
    update trainees set trainer_id = p_trainer where id = t.id;
    n := n + 1;
  end loop;

  if n > 0 then
    select string_agg(distinct b.code, ', ') into codes from trainees x join batches b on b.id = x.batch_id where x.id = any(p_trainees);
    insert into notifications (user_id, notification_type, title, message)
    values (p_trainer, 'system', 'Trainees handed to you',
            format('%s trainee(s)%s are yours from %s%s. Mark their attendance from that day.', n,
                   coalesce(' from ' || codes, ''), to_char(p_from, 'FMDD FMMonth YYYY'),
                   coalesce(' (' || nullif(trim(p_purpose), '') || ')', '')));
  end if;
  return n;
end $$;

notify pgrst, 'reload schema';
