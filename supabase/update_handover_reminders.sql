-- =====================================================================
-- UPDATE: probable handover date from the sheet + reminders
-- (trainer + manager: 7 days before, 1 day before; overdue if training has not ended).
-- Keeps all your data. Run once in Supabase → SQL Editor.
-- =====================================================================
-- Probable handover date from the sheet + reminders (7 days before, 1 day before, overdue)
alter table public.trainees add column if not exists probable_handover_date date;
create table if not exists public.handover_reminders (
  trainee_id  uuid not null references public.trainees(id) on delete cascade,
  due_date    date not null,
  kind        text not null,               -- week | day | overdue
  created_at  timestamptz not null default now(),
  primary key (trainee_id, due_date, kind)
);
alter table public.handover_reminders enable row level security;

create or replace function public.process_handover_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  s      settings;
  today  date;
  t      record;
  kind   text;
  n      int := 0;
  left_d int;
  title  text;
  msg    text;
  who    uuid;
begin
  select * into s from settings where id = 1;
  today := (now() at time zone coalesce(s.timezone, 'Asia/Kolkata'))::date;
  for t in
    select tr.*, p.name as trainer_name, p.manager_id
    from trainees tr left join profiles p on p.id = tr.trainer_id
    where tr.status = 'active' and tr.deleted_at is null and tr.exit_reason is null and tr.tcd_lwd is null
      and tr.probable_handover_date is not null
      and tr.probable_handover_date between today - 60 and today + 7
  loop
    left_d := t.probable_handover_date - today;
    kind := case when left_d < 0 then 'overdue' when left_d = 1 then 'day' when left_d between 2 and 7 then 'week' else null end;
    continue when kind is null;
    insert into handover_reminders (trainee_id, due_date, kind) values (t.id, t.probable_handover_date, kind)
    on conflict do nothing;
    continue when not found;
    if kind = 'overdue' then
      title := 'Training not ended';
      msg := format('%s''s probable handover date was %s, but the training has not ended yet.', t.name, to_char(t.probable_handover_date, 'DD Mon'));
    else
      title := 'Handover coming up';
      msg := format('%s''s probable handover is on %s (%s).', t.name, to_char(t.probable_handover_date, 'DD Mon'),
                    case when left_d = 1 then 'tomorrow' else 'in ' || left_d || ' days' end);
    end if;
    -- trainer
    if t.trainer_id is not null then
      insert into notifications (user_id, notification_type, title, message)
      values (t.trainer_id, case when kind = 'overdue' then 'attention' else 'reminder' end, title, msg);
    end if;
    -- manager(s): the trainer's manager, else every active manager
    for who in select id from profiles where role = 'manager' and status = 'active'
                 and (id = t.manager_id or t.manager_id is null) loop
      insert into notifications (user_id, notification_type, title, message)
      values (who, case when kind = 'overdue' then 'attention' else 'reminder' end, title,
              msg || coalesce(' Trainer: ' || t.trainer_name || '.', ''));
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.process_handover_reminders() to authenticated;

notify pgrst, 'reload schema';
