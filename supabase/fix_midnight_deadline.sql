-- =====================================================================
-- FIX: a 12:00 AM deadline means the END of the day.
--  • Marking attendance any time on the same day is ON TIME (only a later day is late)
--  • The "mark before the deadline" reminder goes out between 11 PM and midnight
--  • Entries already saved as late although they were marked on the same day are corrected
-- Other deadlines (e.g. 11:00 AM) work exactly as before. Run once in Supabase → SQL Editor.
-- =====================================================================
create or replace function public.mark_attendance(p_date date, p_items jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  me        profiles;
  s         settings;
  local_ts  timestamp;
  item      jsonb;
  tr        trainees;
  st        text;
  existing  attendance;
  late      boolean;
  n         int := 0;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then raise exception 'Sign in as an active trainer or manager'; end if;

  select * into s from settings where id = 1;
  local_ts := now() at time zone s.timezone;
  if p_date > local_ts::date then raise exception 'Attendance cannot be marked for a future date'; end if;
  if is_week_off(p_date) then raise exception 'This date is a week off. No attendance is needed.'; end if;
  -- a 12:00 AM (00:00) deadline means the END of the day: marking on the same day is on time
  late := p_date < local_ts::date or (s.attendance_deadline <> time '00:00' and local_ts::time > s.attendance_deadline);

  for item in select * from jsonb_array_elements(p_items) loop
    st := item->>'status';
    if st not in ('present', 'absent', 'half_day', 'holiday') then raise exception 'Choose Present, Absent, Half Day or Holiday'; end if;

    select * into tr from trainees where id = (item->>'trainee_id')::uuid;
    if tr.id is null then raise exception 'Trainee not found'; end if;
    if me.role = 'trainer' and trainee_trainer_on(tr, p_date) is distinct from me.id then
      raise exception 'You can only mark attendance for your own trainees';
    end if;
    if not trainee_active_on(tr, p_date) then
      raise exception '% is not in training on this date', tr.name;
    end if;

    select * into existing from attendance where trainee_id = tr.id and attendance_date = p_date;
    if existing.id is not null and me.role = 'trainer' and p_date < local_ts::date - s.edit_window_days then
      raise exception 'Attendance older than % days can only be changed by a manager', s.edit_window_days;
    end if;

    insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late)
    values (tr.id, p_date, st, me.id, now(), late)
    on conflict (trainee_id, attendance_date) do update
      set status = excluded.status, marked_by = excluded.marked_by, marked_at = now(), source = 'app';
    n := n + 1;
  end loop;

  -- Close alerts for this date once every trainee of that trainer is marked
  update attendance_alerts a set resolved = true
  where a.attendance_date = p_date and not a.resolved
    and not exists (
      select 1 from trainees t
      where trainee_trainer_on(t, p_date) = a.trainer_id and trainee_active_on(t, p_date)
        and not exists (select 1 from attendance x where x.trainee_id = t.id and x.attendance_date = p_date));

  return n;
end $$;

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
       and local_ts::time between ((case when s.attendance_deadline = time '00:00' then time '23:59:59' else s.attendance_deadline end) - interval '60 minutes')
                          and (case when s.attendance_deadline = time '00:00' then time '23:59:59' else s.attendance_deadline end)
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

-- Correct entries marked on the same day but saved as late (only with the 12:00 AM deadline)
update public.attendance a set is_late = false
from public.settings s
where s.id = 1 and s.attendance_deadline = time '00:00'
  and a.is_late
  and (a.marked_at at time zone s.timezone)::date = a.attendance_date;

notify pgrst, 'reload schema';
select (select to_char('2000-01-01'::date + attendance_deadline, 'FMHH12:MI AM') from public.settings where id = 1) as deadline,
       (select count(*) from public.attendance where is_late) as still_marked_late;
