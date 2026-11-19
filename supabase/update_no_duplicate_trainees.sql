-- =====================================================================
-- NO DUPLICATE TRAINEES when the sheet is pushed again.
-- Part 1: a guard in the database. A trainee who already exists (not deleted) is never added again:
--         same E Code, or same official email, or same name + same DOJ (when the emails do not
--         clearly belong to two different people, or both are in the same batch).
--         Existing trainees are only UPDATED by the sheet (status, TCD, details) – as before.
-- Part 2: merges the copies that were already created (attendance, RAG, codes are kept).
-- Nothing else changes. Run once in Supabase → SQL Editor.
-- =====================================================================

-- ---------------- Part 1: guard ----------------
create or replace function public.trainees_no_duplicate() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nm   text := lower(regexp_replace(regexp_replace(coalesce(new.name, ''), '[^A-Za-z ]', ' ', 'g'), '\s+', ' ', 'g'));
  hit  public.trainees;
begin
  nm := trim(nm);
  -- two pushes at the same moment: the second waits for the first, then sees its row
  perform pg_advisory_xact_lock(hashtext('trainee|' || nm || '|' || coalesce(new.joining_date::text, '')));
  if coalesce(trim(new.employee_code), '') <> '' then
    perform pg_advisory_xact_lock(hashtext('trainee-code|' || trim(new.employee_code)));
  end if;

  select * into hit from public.trainees t
  where t.deleted_at is null and t.id <> new.id and (
        (coalesce(trim(new.employee_code), '') <> '' and trim(t.employee_code) = trim(new.employee_code))
     or (coalesce(trim(new.official_email), '') <> '' and new.joining_date = t.joining_date
         and lower(trim(t.official_email)) = lower(trim(new.official_email)))
     or (nm <> '' and t.joining_date = new.joining_date
         and trim(lower(regexp_replace(regexp_replace(coalesce(t.name, ''), '[^A-Za-z ]', ' ', 'g'), '\s+', ' ', 'g'))) = nm
         and (coalesce(t.official_email, '') = '' or coalesce(new.official_email, '') = ''
              or lower(trim(t.official_email)) = lower(trim(new.official_email))
              or (t.batch_id is not null and t.batch_id = new.batch_id))))
  limit 1;

  if hit.id is not null then
    raise exception 'Trainee % (DOJ %) already exists – not added again', new.name, new.joining_date;
  end if;
  return new;
end $$;

drop trigger if exists trg_trainees_no_duplicate on public.trainees;
create trigger trg_trainees_no_duplicate before insert on public.trainees
for each row execute function public.trainees_no_duplicate();

-- ---------------- Part 2: merge the copies already created ----------------
-- STEP 1 (preview): duplicate groups
select coalesce(b.code, '—') as batch, min(t.name) as name, count(*) as copies,
       string_agg(t.joining_date::text || ' · ' || (select count(*) from public.attendance a where a.trainee_id = t.id) || ' days marked', '  |  ') as copies_detail
from public.trainees t left join public.batches b on b.id = t.batch_id
where t.deleted_at is null and t.status = 'active'
group by t.batch_id, b.code, lower(regexp_replace(trim(t.name), '\s+', ' ', 'g'))
having count(*) > 1
order by 1, 2;

-- STEP 2 (merge)
do $$
declare
  k text; g record; keep uuid; d uuid; merged int := 0;
begin
  foreach k in array array['email', 'code', 'name', 'batch'] loop
    for g in
      select array_agg(t.id order by
               (select count(*) from public.attendance a where a.trainee_id = t.id) desc,
               (t.rag is not null) desc, (t.employee_code is not null) desc, t.created_at, t.id) as ids
      from public.trainees t
      where t.deleted_at is null
        and case k when 'email' then coalesce(t.official_email, '') <> ''
                   when 'code'  then coalesce(t.employee_code, '')  <> ''
                   when 'batch' then t.batch_id is not null and t.status = 'active' and t.exit_reason is null
                   else true end
      group by case when k = 'batch' then t.batch_id::text else t.joining_date::text end,
               case k when 'email' then lower(trim(t.official_email))
                      when 'code'  then trim(t.employee_code)
                      else lower(regexp_replace(trim(t.name), '\s+', ' ', 'g')) end
      having count(*) > 1
    loop
      keep := g.ids[1];
      foreach d in array g.ids[2:array_length(g.ids, 1)] loop
        update public.attendance a set trainee_id = keep
        where a.trainee_id = d
          and not exists (select 1 from public.attendance x where x.trainee_id = keep and x.attendance_date = a.attendance_date);
        update public.trainees kt set
          employee_code     = coalesce(nullif(kt.employee_code, ''),     dt.employee_code),
          official_email    = coalesce(nullif(kt.official_email, ''),    dt.official_email),
          personal_email    = coalesce(nullif(kt.personal_email, ''),    dt.personal_email),
          phone             = coalesce(nullif(kt.phone, ''),             dt.phone),
          rag               = coalesce(kt.rag, dt.rag),
          rag_remark        = coalesce(nullif(kt.rag_remark, ''),        dt.rag_remark),
          reporting_manager = coalesce(nullif(kt.reporting_manager, ''), dt.reporting_manager)
        from public.trainees dt
        where kt.id = keep and dt.id = d;
        delete from public.trainees where id = d;
        merged := merged + 1;
      end loop;
    end loop;
  end loop;
  raise notice 'Duplicates merged: %', merged;
end $$;
notify pgrst, 'reload schema';

-- Check: should return no rows
select coalesce(b.code, '—') as batch, min(t.name) as name, count(*)
from public.trainees t left join public.batches b on b.id = t.batch_id
where t.deleted_at is null and t.status = 'active'
group by t.batch_id, b.code, lower(regexp_replace(trim(t.name), '\s+', ' ', 'g'))
having count(*) > 1;
