-- =====================================================================
-- UPDATE: LMS results (learn.petpooja.com → app). The LMS calls /api/lms-result when a trainee finishes an
-- assessment; each result is kept here, matched to the trainee, and shown in Reports → LMS Results.
--   • a trainer sees ONLY the results of the trainees they have (or had); a manager sees everything
--   • one row per ATTEMPT (retries from the LMS never create duplicates: external_id is unique)
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
create table if not exists public.lms_results (
  id             uuid primary key default gen_random_uuid(),
  external_id    text not null unique,                 -- the LMS's own attempt / result id
  employee_code  text,
  email          text,                                 -- lower case
  name           text,
  assessment     text not null,                        -- course / test name
  score          numeric,
  max_score      numeric,
  percentage     numeric(5,2),
  passed         boolean not null,
  attempt        int not null default 1,
  completed_at   timestamptz not null default now(),
  raw            jsonb,                                -- exactly what the LMS sent
  trainee_id     uuid references public.trainees(id) on delete set null,
  match_via      text,                                 -- code | email | name | manual
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists lms_results_trainee_idx    on public.lms_results (trainee_id, assessment);
create index if not exists lms_results_email_idx      on public.lms_results (email);
create index if not exists lms_results_assessment_idx on public.lms_results (assessment);

alter table public.lms_results enable row level security;
drop policy if exists lms_results_select on public.lms_results;
create policy lms_results_select on public.lms_results for select to authenticated
  using (public.is_manager() or trainee_id in (select public.my_trainee_ids()));
-- No insert / update / delete policy: only the server (the LMS webhook) and the functions below write.

create or replace function public.feedback_name_key(p text) returns text
language sql immutable as $$
  select coalesce(string_agg(w, ' ' order by w), '')
  from unnest(string_to_array(regexp_replace(lower(coalesce(p, '')), '[^a-z ]+', ' ', 'g'), ' ')) as w
  where w <> '';
$$;

-- Link results that have no trainee yet: E Code, then email (official or personal), then the exact name (only when ONE
-- trainee has that name). Trainees who left / were removed are matched too; one still in the app is always preferred.
create or replace function public.match_lms_results() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  update lms_results f set trainee_id = x.tid, match_via = 'code'
  from (
    select distinct on (f2.id) f2.id as fid, t.id as tid
    from lms_results f2
    join trainees t on t.employee_code is not null and lower(trim(t.employee_code)) = lower(trim(f2.employee_code))
    where f2.trainee_id is null and coalesce(trim(f2.employee_code), '') <> ''
    order by f2.id, (t.deleted_at is null) desc, (t.joining_date <= f2.completed_at::date) desc, t.joining_date desc
  ) x where f.id = x.fid;
  get diagnostics c = row_count; n := n + c;

  update lms_results f set trainee_id = x.tid, match_via = 'email'
  from (
    select distinct on (f2.id) f2.id as fid, t.id as tid
    from lms_results f2
    join trainees t on (lower(trim(t.official_email)) = f2.email or lower(trim(t.personal_email)) = f2.email)
    where f2.trainee_id is null and coalesce(f2.email, '') <> ''
    order by f2.id, (t.deleted_at is null) desc, (t.joining_date <= f2.completed_at::date) desc, t.joining_date desc
  ) x where f.id = x.fid;
  get diagnostics c = row_count; n := n + c;

  update lms_results f set trainee_id = x.tid, match_via = 'name'
  from (
    select f2.id as fid, (array_agg(t.id))[1] as tid
    from lms_results f2
    join trainees t on t.deleted_at is null and feedback_name_key(t.name) = feedback_name_key(f2.name)
    where f2.trainee_id is null and feedback_name_key(f2.name) <> ''
    group by f2.id having count(*) = 1
  ) x where f.id = x.fid;
  get diagnostics c = row_count; n := n + c;

  update lms_results f set trainee_id = x.tid, match_via = 'name'
  from (
    select f2.id as fid, (array_agg(t.id))[1] as tid
    from lms_results f2
    join trainees t on t.deleted_at is not null and feedback_name_key(t.name) = feedback_name_key(f2.name)
    where f2.trainee_id is null and feedback_name_key(f2.name) <> ''
    group by f2.id having count(*) = 1
  ) x where f.id = x.fid;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
grant execute on function public.match_lms_results() to authenticated;

-- Manager: link a result to a trainee by hand (null = unlink)
create or replace function public.link_lms_result(p_result uuid, p_trainee uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Only a manager can link an LMS result to a trainee'; end if;
  update lms_results set trainee_id = p_trainee, match_via = case when p_trainee is null then null else 'manual' end, updated_at = now()
   where id = p_result;
end $$;
grant execute on function public.link_lms_result(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
select count(*) as lms_rows from public.lms_results;
