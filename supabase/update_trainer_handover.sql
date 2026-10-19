-- =====================================================================
-- UPDATE: two-step handover.
--  Step 1 (trainer): "Training complete, sent to floor" + date. NOT final: the trainee stays in training,
--          but handover reminders, Overdue and missed-attendance alerts after that date stop, and managers
--          get one notification to confirm. The trainer can undo it until the manager confirms.
--  Step 2 (manager): the final Handover, as before.
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
alter table public.trainees add column if not exists trainer_handover_date date;
alter table public.trainees add column if not exists trainer_handover_by   uuid references public.profiles(id) on delete set null;
alter table public.trainees add column if not exists trainer_handover_at   timestamptz;

-- trainers may set only these new fields (everything else stays manager-only)
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
    -- Trainers may only set RAG, switch trainer and move to a batch; every other detail is manager-only
    if not mgr and (to_jsonb(new) - array['rag', 'rag_remark', 'rag_updated_at', 'rag_updated_by', 'rag_review_status',
                                          'rag_reviewed_by', 'rag_reviewed_at', 'rag_review_note', 'batch_id', 'trainer_id', 'updated_at',
                                          'trainer_handover_date', 'trainer_handover_by', 'trainer_handover_at'])
                   is distinct from
                   (to_jsonb(old) - array['rag', 'rag_remark', 'rag_updated_at', 'rag_updated_by', 'rag_review_status',
                                          'rag_reviewed_by', 'rag_reviewed_at', 'rag_review_note', 'batch_id', 'trainer_id', 'updated_at',
                                          'trainer_handover_date', 'trainer_handover_by', 'trainer_handover_at']) then
      raise exception 'Only a manager can edit trainee details';
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

-- a trainee needs a mark on day d: in training that day and not yet sent to the floor before it
create or replace function public.trainee_needs_mark(t public.trainees, d date) returns boolean
language sql stable as $f$
  select public.trainee_active_on(t, d) and (t.trainer_handover_date is null or d <= t.trainer_handover_date)
$f$;

-- missed-attendance check: same as before, but not after the "sent to floor" date
create or replace function public.process_missed_attendance()
returns int
language plpgsql security definer set search_path = public as $$
declare
  s          settings;
  local_ts   timestamp;
  today      date;
  last_d     date;
  tr         record;
  g          record;
  d          date;
  unmarked   int;
  n          int;
  bname      text;
  created    int := 0;
  mgr        record;
begin
  select * into s from settings where id = 1;
  local_ts := now() at time zone s.timezone;
  today := local_ts::date;
  -- A day only counts as missed once it is over (after midnight); today is never counted
  last_d := today - 1;

  -- Days completed later (every trainee of that batch marked) no longer count as missed
  delete from attendance_alerts al
  where al.attendance_date >= s.tracking_start_date
    and not exists (
      select 1 from trainees t
      where (t.trainer_id = al.trainer_id or t.id in (select trainee_id from trainee_assignments where trainer_id = al.trainer_id))
        and t.batch_id is not distinct from al.batch_id
        and trainee_trainer_on(t, al.attendance_date) = al.trainer_id and trainee_needs_mark(t, al.attendance_date)
        and al.attendance_date >= (t.created_at at time zone s.timezone)::date
        and not exists (select 1 from attendance x where x.trainee_id = t.id and x.attendance_date = al.attendance_date));
  delete from attendance_alerts where attendance_date >= today;

  for tr in select * from profiles where role = 'trainer' and status = 'active' loop

    -- Reminder in the hour before the deadline
    if s.reminder_enabled and not is_week_off(today)
       and local_ts::time between (s.attendance_deadline - interval '60 minutes') and s.attendance_deadline
       and not exists (select 1 from notifications where user_id = tr.id and notification_type = 'reminder'
                       and title = 'Attendance reminder'
                       and (created_at at time zone s.timezone)::date = today) then
      select count(*) into unmarked from trainees t
      where (t.trainer_id = tr.id or t.id in (select trainee_id from trainee_assignments where trainer_id = tr.id))
        and trainee_trainer_on(t, today) = tr.id and trainee_needs_mark(t, today)
        and not exists (select 1 from attendance x where x.trainee_id = t.id and x.attendance_date = today);
      if unmarked > 0 then
        insert into notifications (user_id, notification_type, title, message)
        values (tr.id, 'reminder', 'Attendance reminder',
                format('%s trainee(s) still need attendance today. Mark before %s.', unmarked,
                       to_char('2000-01-01'::date + s.attendance_deadline, 'FMHH12:MI AM')));
      end if;
    end if;

    -- Missed days, counted separately for each batch of this trainer
    d := greatest(s.tracking_start_date, today - 60);
    while d <= last_d loop
      if not is_week_off(d) then
        for g in
          select t.batch_id, count(*) as unmarked
          from trainees t
          where (t.trainer_id = tr.id or t.id in (select trainee_id from trainee_assignments where trainer_id = tr.id))
            and trainee_trainer_on(t, d) = tr.id and trainee_needs_mark(t, d)
            and d >= (t.created_at at time zone s.timezone)::date
            and not exists (select 1 from attendance x where x.trainee_id = t.id and x.attendance_date = d)
          group by t.batch_id
        loop
          continue when exists (select 1 from attendance_alerts
                                where trainer_id = tr.id and attendance_date = d and batch_id is not distinct from g.batch_id);
          select count(*) + 1 into n from attendance_alerts where trainer_id = tr.id and batch_id is not distinct from g.batch_id;
          bname := coalesce((select 'batch ' || code from batches where id = g.batch_id), 'trainees without a batch');

          insert into attendance_alerts (trainer_id, batch_id, attendance_date, unmarked_count, miss_number, manager_notified)
          values (tr.id, g.batch_id, d, g.unmarked, n, n >= s.escalation_threshold or (s.escalation_threshold > 1 and n = s.escalation_threshold - 1));

          insert into notifications (user_id, notification_type, title, message)
          values (tr.id, 'missed', 'Attendance not marked',
                  format('Attendance for %s trainee(s) of %s on %s was not marked. Please update it. Missed days for this batch: %s (manager is alerted at %s).',
                         g.unmarked, bname, to_char(d, 'FMDD FMMonth YYYY'), n, s.escalation_threshold));

          if n >= s.escalation_threshold or (s.escalation_threshold > 1 and n = s.escalation_threshold - 1) then
            for mgr in select id from profiles
                       where role = 'manager' and status = 'active'
                         and (id = tr.manager_id or tr.manager_id is null) loop
              if n >= s.escalation_threshold then
                insert into notifications (user_id, notification_type, title, message)
                values (mgr.id, 'escalation', 'Repeated attendance failure',
                        format('%s has missed marking attendance for %s %s times (latest: %s, %s trainee(s) unmarked). Please review.',
                               tr.name, bname, n, to_char(d, 'FMDD FMMonth YYYY'), g.unmarked));
              else
                insert into notifications (user_id, notification_type, title, message)
                values (mgr.id, 'attention', 'Attendance needs attention',
                        format('%s has missed marking attendance for %s %s times (latest: %s). One more miss for this batch triggers an escalation.',
                               tr.name, bname, n, to_char(d, 'FMDD FMMonth YYYY')));
              end if;
            end loop;
          end if;

          created := created + 1;
        end loop;
      end if;
      d := d + 1;
    end loop;
  end loop;
  return created;
end $$;

-- handover reminders: not for trainees the trainer already sent to the floor
create or replace function public.process_handover_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  s      settings;
  today  date;
  t      record;
  kind   text;
  n      int := 0;
  left_d int;
  title  text;
  msg    text;
  who    uuid;
begin
  select * into s from settings where id = 1;
  today := (now() at time zone coalesce(s.timezone, 'Asia/Kolkata'))::date;
  for t in
    select tr.*, p.name as trainer_name, p.manager_id
    from trainees tr left join profiles p on p.id = tr.trainer_id
    where tr.status = 'active' and tr.deleted_at is null and tr.exit_reason is null and tr.tcd_lwd is null
      and tr.trainer_handover_date is null                 -- trainer already sent them to the floor
      and tr.probable_handover_date is not null
      and tr.probable_handover_date between today - 60 and today + 7
  loop
    left_d := t.probable_handover_date - today;
    kind := case when left_d < 0 then 'overdue' when left_d = 1 then 'day' when left_d between 2 and 7 then 'week' else null end;
    continue when kind is null;
    insert into handover_reminders (trainee_id, due_date, kind) values (t.id, t.probable_handover_date, kind)
    on conflict do nothing;
    continue when not found;
    if kind = 'overdue' then
      title := 'Training not ended';
      msg := format('%s''s probable handover date was %s, but the training has not ended yet.', t.name, to_char(t.probable_handover_date, 'DD Mon'));
    else
      title := 'Handover coming up';
      msg := format('%s''s probable handover is on %s (%s).', t.name, to_char(t.probable_handover_date, 'DD Mon'),
                    case when left_d = 1 then 'tomorrow' else 'in ' || left_d || ' days' end);
    end if;
    -- trainer
    if t.trainer_id is not null then
      insert into notifications (user_id, notification_type, title, message)
      values (t.trainer_id, case when kind = 'overdue' then 'attention' else 'reminder' end, title, msg);
    end if;
    -- manager(s): the trainer's manager, else every active manager
    for who in select id from profiles where role = 'manager' and status = 'active'
                 and (id = t.manager_id or t.manager_id is null) loop
      insert into notifications (user_id, notification_type, title, message)
      values (who, case when kind = 'overdue' then 'attention' else 'reminder' end, title,
              msg || coalesce(' Trainer: ' || t.trainer_name || '.', ''));
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Step 1: the trainer marks "Training complete, sent to floor" (or undoes it)
create or replace function public.trainer_mark_handover(p_trainees uuid[], p_date date, p_undo boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mgr boolean := me is null or public.is_manager();
  n int := 0;
  g record;
  who text;
begin
  if p_undo then
    update trainees t set trainer_handover_date = null, trainer_handover_by = null, trainer_handover_at = null
    where t.id = any(p_trainees) and t.exit_reason is null and (mgr or t.trainer_id = me);
    get diagnostics n = row_count;
    return n;
  end if;
  if p_date is null then raise exception 'Choose the date the trainees went to the floor'; end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date + 1 then raise exception 'The date cannot be in the future'; end if;

  update trainees t set trainer_handover_date = p_date, trainer_handover_by = me, trainer_handover_at = now()
  where t.id = any(p_trainees) and t.status = 'active' and t.deleted_at is null and t.exit_reason is null
    and (mgr or t.trainer_id = me);
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;

  -- one notification per batch to every manager
  select name into who from profiles where id = me;
  for g in
    select coalesce(b.code, 'no batch') as code, count(*) as cnt
    from trainees t left join batches b on b.id = t.batch_id
    where t.id = any(p_trainees) and t.trainer_handover_date = p_date and t.trainer_handover_by is not distinct from me
    group by 1
  loop
    insert into notifications (user_id, notification_type, title, message)
    select p.id, 'system', 'Training completed: confirm handover',
           format('%s completed training for %s trainee(s) of %s (sent to floor %s). Please confirm the final handover.',
                  coalesce(who, 'A trainer'), g.cnt, g.code, to_char(p_date, 'DD Mon'))
    from profiles p where p.role = 'manager' and p.status = 'active';
  end loop;
  return n;
end $$;
grant execute on function public.trainer_mark_handover(uuid[], date, boolean) to authenticated;

notify pgrst, 'reload schema';
select 'Two-step handover is on' as result;
