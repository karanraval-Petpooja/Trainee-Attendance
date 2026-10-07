-- =====================================================================
-- UPDATE: missed attendance counted PER BATCH. Each batch of a trainer has its
-- own attempts (escalation after the set number, default 3, for that batch).
-- A day counts only after midnight; days marked later stop counting.
-- Run once in Supabase → SQL Editor.
-- =====================================================================
alter table public.attendance_alerts add column if not exists batch_id uuid references public.batches(id) on delete cascade;
alter table public.attendance_alerts drop constraint if exists attendance_alerts_trainer_id_attendance_date_key;
create unique index if not exists attendance_alerts_trainer_batch_day
  on public.attendance_alerts (trainer_id, coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid), attendance_date);

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
        and trainee_trainer_on(t, al.attendance_date) = al.trainer_id and trainee_active_on(t, al.attendance_date)
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
        and trainee_trainer_on(t, today) = tr.id and trainee_active_on(t, today)
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
            and trainee_trainer_on(t, d) = tr.id and trainee_active_on(t, d)
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

-- Fresh start for per-batch counting (still-unmarked days are flagged again, per batch, on the next check)
delete from public.attendance_alerts;
delete from public.notifications
where title in ('Attendance not marked', 'Repeated attendance failure', 'Attendance needs attention')
  and notification_type in ('missed', 'escalation', 'attention');

notify pgrst, 'reload schema';
