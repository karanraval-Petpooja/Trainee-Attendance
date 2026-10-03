-- =====================================================================
-- UPDATE: Dossier connection (automatic sync from Google Sheets).
-- Keeps all your data. Run once in Supabase → SQL Editor
-- (after update_dossier_rag.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dossier connection (Google Apps Script → /api/dossier-sync)
-- ---------------------------------------------------------------------
create table if not exists public.sync_log (
  id               uuid primary key default gen_random_uuid(),
  run_id           text,
  source           text not null default 'dossier',
  rows_received    int not null default 0,
  added            int not null default 0,
  updated          int not null default 0,
  attendance_days  int not null default 0,
  errors           text,
  created_at       timestamptz not null default now()
);
create index if not exists sync_log_created_idx on public.sync_log (created_at desc);
alter table public.sync_log enable row level security;
drop policy if exists sync_log_select on public.sync_log;
create policy sync_log_select on public.sync_log for select to authenticated using (public.is_manager());

-- Attendance import: managers, or the server sync (service role, no signed-in user)
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
      insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late)
      values (t.id, d, r->>'status', auth.uid(), now(), false)
      on conflict (trainee_id, attendance_date) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();
    else
      insert into attendance (trainee_id, attendance_date, status, marked_by, marked_at, is_late)
      values (t.id, d, r->>'status', auth.uid(), now(), false)
      on conflict (trainee_id, attendance_date) do nothing;
    end if;
    get diagnostics cnt = row_count;
    n := n + cnt;
  end loop;
  return n;
end $$;
grant execute on function public.import_attendance(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
