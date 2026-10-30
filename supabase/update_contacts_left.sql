-- =====================================================================
-- UPDATE: Contact Details keeps both Active and Left employees, with their DOJ (used to look up E Code by email
-- for the Monthly Sheet). Someone on both lists counts as Active.
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
alter table public.contacts add column if not exists employment text not null default 'active'
  check (employment in ('active', 'left'));
alter table public.contacts add column if not exists joining_date date;   -- DOJ, to tell apart people with the same name
update public.contacts set employment = 'left' where active = false and employment = 'active';
create index if not exists contacts_personal_email_idx on public.contacts (lower(personal_email));
notify pgrst, 'reload schema';
select employment, count(*) from public.contacts group by employment order by 1;
