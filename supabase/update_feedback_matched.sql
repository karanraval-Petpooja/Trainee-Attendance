-- =====================================================================
-- UPDATE: show WHO a feedback response is from, also to a trainer who does not own that trainee.
-- A response that names a trainer (for example every response in one trainer's feedback sheet) can be linked to a trainee
-- who belongs to another trainer, and a trainer cannot read other trainers' trainees. So the trainee's name, E Code and
-- batch are copied onto the feedback row when it is linked, and the Feedback Report shows them in the normal list.
-- Nothing new becomes visible: the trainer could already read that response (it names her).
-- Run once in Supabase → SQL Editor (safe to run again). Run it BEFORE deploying the matching app update.
-- =====================================================================
alter table public.feedback_responses add column if not exists matched_name  text;
alter table public.feedback_responses add column if not exists matched_code  text;
alter table public.feedback_responses add column if not exists matched_batch text;

-- Filled whenever a response gets linked (automatic match, a manager's manual link) or un-linked
create or replace function public.feedback_fill_matched() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.trainee_id is null then
    new.matched_name := null; new.matched_code := null; new.matched_batch := null;
  else
    select t.name, t.employee_code, b.code into new.matched_name, new.matched_code, new.matched_batch
      from trainees t left join batches b on b.id = t.batch_id where t.id = new.trainee_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_feedback_fill_matched on public.feedback_responses;
create trigger trg_feedback_fill_matched before insert or update of trainee_id on public.feedback_responses
  for each row execute function public.feedback_fill_matched();

-- Kept up to date when the trainee is renamed, gets an E Code, or moves to another batch
create or replace function public.feedback_refresh_matched() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update feedback_responses f
     set matched_name = new.name, matched_code = new.employee_code, matched_batch = (select b.code from batches b where b.id = new.batch_id)
   where f.trainee_id = new.id;
  return null;
end $$;
drop trigger if exists trg_trainees_feedback_matched on public.trainees;
create trigger trg_trainees_feedback_matched after update of name, employee_code, batch_id on public.trainees
  for each row execute function public.feedback_refresh_matched();

-- Responses that are already linked
update public.feedback_responses f
   set matched_name = t.name, matched_code = t.employee_code, matched_batch = b.code
  from public.trainees t left join public.batches b on b.id = t.batch_id
 where t.id = f.trainee_id;

notify pgrst, 'reload schema';
select count(*) filter (where matched_name is not null) as linked_with_name, count(*) as all_responses from public.feedback_responses;
