-- =====================================================================
-- UPDATE: feedback status at "Training complete" — the trainer's answer, shown to managers.
--   taken  = "Yes, feedback taken"      shared = form shown / sent ("Not yet" → Done)
-- Run once in Supabase → SQL Editor (safe to run again).
-- =====================================================================
create table if not exists public.trainee_feedback (
  trainee_id  uuid primary key references public.trainees(id) on delete cascade,
  status      text not null check (status in ('taken', 'shared')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
alter table public.trainee_feedback enable row level security;
drop policy if exists trainee_feedback_read on public.trainee_feedback;
create policy trainee_feedback_read on public.trainee_feedback for select to authenticated using (true);

-- the trainer (for their own trainees) or a manager records the answer
create or replace function public.set_trainee_feedback(p_trainees uuid[], p_status text) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mgr boolean := me is null or public.is_manager(); n int;
begin
  if p_status not in ('taken', 'shared') then raise exception 'Unknown feedback status'; end if;
  insert into trainee_feedback (trainee_id, status, updated_at, updated_by)
  select t.id, p_status, now(), me from trainees t
  where t.id = any(p_trainees) and (mgr or t.trainer_id = me)
  on conflict (trainee_id) do update
    set status = case when trainee_feedback.status = 'taken' then 'taken' else excluded.status end,  -- "taken" is never downgraded
        updated_at = now(), updated_by = excluded.updated_by;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.set_trainee_feedback(uuid[], text) to authenticated;

notify pgrst, 'reload schema';
select 'Feedback status is on' as result;
