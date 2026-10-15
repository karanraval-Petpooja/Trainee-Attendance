-- =====================================================================
-- MERGE DUPLICATE TRAINEES (same person added twice by an upload).
-- Same person = same DOJ and the same official email, E Code or name.
-- Kept: the copy with attendance, then RAG, then E Code, then the oldest.
-- From the extra copy: attendance days (not already on the kept one), RAG,
-- E Code, mobile, emails … are moved to the kept one; then the extra copy is deleted.
-- Run in Supabase → SQL Editor. STEP 1 shows the duplicates.
-- =====================================================================

-- STEP 1 (preview): every duplicate group
select t.joining_date, lower(coalesce(t.official_email, t.name)) as person, count(*) as copies, string_agg(t.name, ' / ') as names
from public.trainees t
where t.deleted_at is null
group by t.joining_date, lower(coalesce(t.official_email, t.name))
having count(*) > 1
order by 1 desc, 2;

-- STEP 2 (merge)
do $$
declare
  k text;
  g record;
  keep uuid;
  d uuid;
  merged int := 0;
begin
  foreach k in array array['email', 'code', 'name'] loop
    for g in
      select array_agg(t.id order by
               (select count(*) from public.attendance a where a.trainee_id = t.id) desc,
               (t.rag is not null) desc, (t.employee_code is not null) desc, t.created_at, t.id) as ids
      from public.trainees t
      where t.deleted_at is null
        and case k when 'email' then t.official_email is not null and t.official_email <> ''
                   when 'code'  then t.employee_code  is not null and t.employee_code  <> ''
                   else true end
      group by t.joining_date,
               case k when 'email' then lower(trim(t.official_email))
                      when 'code'  then trim(t.employee_code)
                      else lower(regexp_replace(trim(t.name), '\s+', ' ', 'g')) end
      having count(*) > 1
    loop
      keep := g.ids[1];
      foreach d in array g.ids[2:array_length(g.ids, 1)] loop
        -- attendance days the kept copy does not have yet
        update public.attendance a set trainee_id = keep
        where a.trainee_id = d
          and not exists (select 1 from public.attendance x where x.trainee_id = keep and x.attendance_date = a.attendance_date);
        -- details the kept copy is missing
        update public.trainees kt set
          employee_code  = coalesce(nullif(kt.employee_code, ''),  dt.employee_code),
          official_email = coalesce(nullif(kt.official_email, ''), dt.official_email),
          personal_email = coalesce(nullif(kt.personal_email, ''), dt.personal_email),
          phone          = coalesce(nullif(kt.phone, ''),          dt.phone),
          rag            = coalesce(kt.rag, dt.rag),
          rag_remark     = coalesce(nullif(kt.rag_remark, ''),     dt.rag_remark),
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
select t.joining_date, lower(coalesce(t.official_email, t.name)) as person, count(*)
from public.trainees t where t.deleted_at is null
group by 1, 2 having count(*) > 1;
