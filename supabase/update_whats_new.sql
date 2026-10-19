-- =====================================================================
-- UPDATE: "What's new" walkthrough remembers, per person, what they have already seen.
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
alter table public.profiles add column if not exists whats_new_seen_at timestamptz;

create or replace function public.mark_whats_new_seen() returns void
language sql security definer set search_path = public as $$
  update public.profiles set whats_new_seen_at = now() where id = auth.uid();
$$;
grant execute on function public.mark_whats_new_seen() to authenticated;

notify pgrst, 'reload schema';
select 'What''s new walkthrough is on' as result;
