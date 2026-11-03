-- =====================================================================
-- UPDATE: Feedback Report. Form responses from the Google Sheet (via the Google script)
-- are kept here, matched to trainees, and shown in Reports → Feedback Report:
--   • a trainer sees ONLY the feedback of the trainees they have (or had), or that names them as trainer
--   • a manager sees everything
--   • "Pending" = a trainee with no response yet
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
create table if not exists public.feedback_responses (
  id                uuid primary key default gen_random_uuid(),
  form_id           text not null default 'nht',          -- nht | sales | upskill | ojt-pip
  source            text not null default '',              -- which sheet tab it came from (older tabs / older forms can feed the same form)
  row_key           text not null,                         -- timestamp + email / name: one row per submission
  submitted_at      timestamptz,
  respondent_name   text,
  respondent_email  text,                                  -- lower case
  respondent_code   text,                                  -- E Code, if the form asks for it
  trainer_name      text,                                  -- as typed / picked in the form
  batch_code        text,                                  -- as typed / picked in the form
  answers           jsonb not null default '[]'::jsonb,    -- [{"q": "question", "a": "answer"}, …] in form order
  trainee_id        uuid references public.trainees(id) on delete set null,
  trainer_id        uuid references public.profiles(id) on delete set null,
  match_via         text,                                  -- code | email | name | manual
  last_seen_run     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (form_id, row_key)
);
alter table public.feedback_responses add column if not exists source text not null default '';
create index if not exists feedback_responses_trainee_idx on public.feedback_responses (form_id, trainee_id);
create index if not exists feedback_responses_trainer_idx on public.feedback_responses (trainer_id);
create index if not exists feedback_responses_email_idx   on public.feedback_responses (respondent_email);

alter table public.feedback_responses enable row level security;
drop policy if exists feedback_responses_select on public.feedback_responses;
create policy feedback_responses_select on public.feedback_responses for select to authenticated
  using (public.is_manager()
         or trainer_id = auth.uid()
         or trainee_id in (select public.my_trainee_ids()));
-- No insert / update / delete policy: only the server (sync) and the functions below write.

-- Name without word order, case or punctuation: "Mehta Swapnil" = "swapnil mehta"
create or replace function public.feedback_name_key(p text) returns text
language sql immutable as $$
  select coalesce(string_agg(w, ' ' order by w), '')
  from unnest(string_to_array(regexp_replace(lower(coalesce(p, '')), '[^a-z ]+', ' ', 'g'), ' ')) as w
  where w <> '';
$$;

-- Link responses that have no trainee yet: E Code, then email (official or personal), then the exact name
-- (only when ONE trainee has that name — never guessed). Returns how many were linked.
create or replace function public.match_feedback_responses() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  c int;
begin
  -- 1) E Code
  update feedback_responses f set trainee_id = x.tid, match_via = 'code'
  from (
    select distinct on (f2.id) f2.id as fid, t.id as tid
    from feedback_responses f2
    join trainees t on t.deleted_at is null and t.employee_code is not null
                   and lower(trim(t.employee_code)) = lower(trim(f2.respondent_code))
    where f2.trainee_id is null and coalesce(trim(f2.respondent_code), '') <> ''
    order by f2.id, (t.joining_date <= coalesce(f2.submitted_at::date, current_date)) desc, t.joining_date desc
  ) x
  where f.id = x.fid;
  get diagnostics c = row_count; n := n + c;

  -- 2) Email (a re-joiner has several rows: take the stint that had started by then, latest first)
  update feedback_responses f set trainee_id = x.tid, match_via = 'email'
  from (
    select distinct on (f2.id) f2.id as fid, t.id as tid
    from feedback_responses f2
    join trainees t on t.deleted_at is null
                   and (lower(trim(t.official_email)) = f2.respondent_email or lower(trim(t.personal_email)) = f2.respondent_email)
    where f2.trainee_id is null and coalesce(f2.respondent_email, '') <> ''
    order by f2.id, (t.joining_date <= coalesce(f2.submitted_at::date, current_date)) desc, t.joining_date desc
  ) x
  where f.id = x.fid;
  get diagnostics c = row_count; n := n + c;

  -- 3) Name, only when it is unique among trainees
  update feedback_responses f set trainee_id = x.tid, match_via = 'name'
  from (
    select f2.id as fid, (array_agg(t.id))[1] as tid
    from feedback_responses f2
    join trainees t on t.deleted_at is null and feedback_name_key(t.name) = feedback_name_key(f2.respondent_name)
    where f2.trainee_id is null and feedback_name_key(f2.respondent_name) <> ''
    group by f2.id
    having count(*) = 1
  ) x
  where f.id = x.fid;
  get diagnostics c = row_count; n := n + c;

  return n;
end $$;
grant execute on function public.match_feedback_responses() to authenticated;

-- Manager: link a response to a trainee by hand (or pass null to unlink it)
create or replace function public.link_feedback_response(p_response uuid, p_trainee uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Only a manager can link feedback to a trainee'; end if;
  update feedback_responses
     set trainee_id = p_trainee, match_via = case when p_trainee is null then null else 'manual' end, updated_at = now()
   where id = p_response;
end $$;
grant execute on function public.link_feedback_response(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
select count(*) as feedback_rows from public.feedback_responses;
