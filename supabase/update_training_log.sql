-- =====================================================================
-- UPDATE: push Upskill / Refresher sessions to the Training Log Google Sheet.
-- Keeps the topic and when / which Sr. Nos were pushed. Run once in Supabase → SQL Editor.
-- =====================================================================
alter table public.ojt_sessions add column if not exists topic       text;
alter table public.ojt_sessions add column if not exists pushed_at   timestamptz;
alter table public.ojt_sessions add column if not exists pushed_by   uuid references public.profiles(id) on delete set null;
alter table public.ojt_sessions add column if not exists pushed_rows int;
alter table public.ojt_sessions add column if not exists pushed_sr   text;
notify pgrst, 'reload schema';
