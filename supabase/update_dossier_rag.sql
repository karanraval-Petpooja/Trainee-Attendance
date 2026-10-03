-- =====================================================================
-- UPDATE: Dossier import + RAG status/remarks + "Service Not Required".
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- (Run update_handover, update_keep_reports and update_batches first if
--  you haven't yet.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dossier fields, RAG status, extra exit reason, attendance import
-- ---------------------------------------------------------------------
alter table public.trainees add column if not exists designation text;
alter table public.trainees add column if not exists city text;
alter table public.trainees add column if not exists official_email text;
alter table public.trainees add column if not exists track text;            -- Onboarding / Upselling / NPU …
alter table public.trainees add column if not exists rag text;
alter table public.trainees add column if not exists rag_remark text;
alter table public.trainees add column if not exists rag_updated_at timestamptz;
alter table public.trainees add column if not exists rag_updated_by uuid references public.profiles(id) on delete set null;
alter table public.trainees drop constraint if exists trainees_rag_check;
alter table public.trainees add constraint trainees_rag_check check (rag in ('green', 'amber', 'red'));
alter table public.trainees drop constraint if exists trainees_exit_reason_check;
alter table public.trainees add constraint trainees_exit_reason_check
  check (exit_reason in ('handover', 'resigned', 'not_certified', 'service_not_required', 'doj_revised', 'offer_revoked'));

-- Manager: load past attendance (e.g. from the Dossier). Skips week offs and
-- days outside a trainee's training; existing entries are kept unless p_overwrite.
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
  if not is_manager() then raise exception 'Only a manager can import attendance'; end if;
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
