-- =====================================================================
-- UPDATE: trainers and managers update RAG directly (no approval step).
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- Safe whether or not you ran the earlier RAG-review version.
-- =====================================================================
alter table public.trainees add column if not exists rag_review_status text;
alter table public.trainees add column if not exists rag_reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.trainees add column if not exists rag_reviewed_at timestamptz;
alter table public.trainees add column if not exists rag_review_note text;

-- Trainer (any trainee they have or had) or manager sets RAG + remark. No approval step.
create or replace function public.set_rag(p_trainee uuid, p_rag text, p_remark text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me  profiles;
  t   trainees;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then raise exception 'Sign in as a trainer or manager'; end if;
  select * into t from trainees where id = p_trainee;
  if t.id is null then raise exception 'Trainee not found'; end if;
  if me.role <> 'manager' and not (t.trainer_id = me.id or exists (select 1 from trainee_assignments where trainee_id = t.id and trainer_id = me.id)) then
    raise exception 'You can only update RAG for your own trainees';
  end if;
  if p_rag is not null and p_rag not in ('green', 'amber', 'red') then raise exception 'Choose Green, Amber or Red'; end if;
  update trainees set rag = p_rag, rag_remark = nullif(trim(p_remark), ''), rag_updated_at = now(), rag_updated_by = me.id,
         rag_review_status = null, rag_reviewed_by = null, rag_reviewed_at = null, rag_review_note = null
  where id = t.id;
end $$;

grant execute on function public.set_rag(uuid, text, text) to authenticated;
drop function if exists public.review_rag(uuid[], text);
update public.trainees set rag_review_status = null, rag_reviewed_by = null, rag_reviewed_at = null, rag_review_note = null;
delete from public.notifications where notification_type = 'rag';

notify pgrst, 'reload schema';
