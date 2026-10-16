-- =====================================================================
-- EXPORT: every attendance day marked in the app (nothing is changed).
-- Run in Supabase → SQL Editor, then click "Download CSV" (top right of the
-- results) and open it in Excel. Change the two dates for another period.
-- =====================================================================
select
  t.employee_code                         as "E Code",
  t.name                                  as "Name",
  b.code                                  as "Batch",
  to_char(t.joining_date, 'DD-Mon-YYYY')  as "DOJ",
  coalesce(p.name, t.trainer_label)       as "Trainer",
  to_char(a.attendance_date, 'DD-Mon-YYYY') as "Date",
  to_char(a.attendance_date, 'Dy')        as "Day",
  case a.status when 'present' then 'Present' when 'absent' then 'Absent'
                when 'half_day' then 'Half Day' when 'holiday' then 'Holiday' else a.status end as "Attendance",
  case when a.is_late then 'Yes' else '' end as "Marked late",
  m.name                                  as "Marked by",
  case coalesce(t.exit_reason, '') when '' then 'In Training' else initcap(replace(t.exit_reason, '_', ' ')) end as "Status now"
from public.attendance a
join public.trainees t on t.id = a.trainee_id
left join public.batches b  on b.id = t.batch_id
left join public.profiles p on p.id = coalesce((select x.trainer_id from public.trainee_assignments x
                                                where x.trainee_id = t.id and x.start_date <= a.attendance_date
                                                order by x.start_date desc limit 1), t.trainer_id)
left join public.profiles m on m.id = a.marked_by
where a.attendance_date between date '2026-10-01' and date '2026-10-31'
  and coalesce(a.source, 'app') = 'app'
order by b.code, t.name, a.attendance_date;
