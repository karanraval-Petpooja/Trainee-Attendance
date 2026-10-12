-- =====================================================================
-- UPDATE: Contact Details (employee list with departments) + "Not attended"
-- in OJT / Upskill / PIP / Refresher sessions. Run once in Supabase → SQL Editor.
-- =====================================================================
create table if not exists public.contacts (
  id                uuid primary key default gen_random_uuid(),
  employee_code     text,
  name              text not null,
  official_email    text,
  personal_email    text,
  phone             text,
  department        text,
  designation       text,
  location          text,
  reporting_manager text,
  active            boolean not null default true,
  last_seen_run     text,
  updated_at        timestamptz not null default now()
);
create unique index if not exists contacts_code_uniq  on public.contacts (employee_code) where employee_code is not null;
create unique index if not exists contacts_email_uniq on public.contacts (lower(official_email)) where official_email is not null;
create index if not exists contacts_department_idx on public.contacts (department);

alter table public.contacts enable row level security;
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated using (true);              -- trainers pick a department
drop policy if exists contacts_manage on public.contacts;
create policy contacts_manage on public.contacts for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Sessions: the department picked; participants: who did not appear in the Meet file at all
alter table public.ojt_sessions     add column if not exists department text;
alter table public.ojt_participants add column if not exists not_attended  boolean not null default false;
alter table public.ojt_participants add column if not exists employee_code text;
alter table public.ojt_participants add column if not exists department    text;

notify pgrst, 'reload schema';
