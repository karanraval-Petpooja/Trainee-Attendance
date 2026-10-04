-- =====================================================================
-- UPDATE: write attendance / RAG marked in the app back to the Dossier.
-- Adds attendance.source so imported days are never written back.
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- =====================================================================
-- First run only: add the column and treat everything already in the app as imported,
-- so old data is not pushed back into the Dossier. New marks from now on are written back.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'attendance' and column_name = 'source') then
    alter table public.attendance add column source text not null default 'app';
    update public.attendance set source = 'dossier';
  end if;
end $$;

create or replace function public.import_attendance(p_rows jsonb, p_overwrite boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r   jsonb;
  t   trainees;
  d   date;
  n   int := 0;
  cnt int;
begin
  if auth.uid() is not null and not is_manager() then raise exception 'Only a manager can import attendance'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    d := (r->>'date')::date;
    if r->>'status' not in ('present', 'absent', 'half_day', 'holiday') then continue; end if;
    if d > (now() at time zone (select timezone from settings where id = 1))::date then continue; end if;
    if is_week_off(d) then continue; end if;
    select * into t from trainees where id = (r->>'trainee_id')::uuid;
    if t.id is null or not trainee_active_on(t, d) then continue; end if;
    if p_overwrite then
      insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late, source)
      values (t.id, d, r->>'status', auth.uid(), now(), false, 'dossier')
      on conflict (trainee_id, attendance_date) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now(), source = 'dossier';
    else
      insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late, source)
      values (t.id, d, r->>'status', auth.uid(), now(), false, 'dossier')
      on conflict (trainee_id, attendance_date) do nothing;
    end if;
    get diagnostics cnt = row_count;
    n := n + cnt;
  end loop;
  return n;
end $$;

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
  late := p_date < local_ts::date or local_ts::time > s.attendance_deadline;

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

notify pgrst, 'reload schema';
