-- =====================================================================
-- UPDATE: a reason is required when RAG is Amber or Red.
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- =====================================================================
-- Amber / Red need a reason (also enforced in the database)
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
  if p_rag in ('amber', 'red') and length(trim(coalesce(p_remark, ''))) < 5 then
    raise exception 'Write the reason for % (at least 5 characters)', initcap(p_rag);
  end if;
  update trainees set rag = p_rag, rag_remark = nullif(trim(p_remark), ''), rag_updated_at = now(), rag_updated_by = me.id,
         rag_review_status = null, rag_reviewed_by = null, rag_reviewed_at = null, rag_review_note = null
  where id = t.id;
end $$;

notify pgrst, 'reload schema';
