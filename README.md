# Trainer Attendance

Trainers mark daily attendance for their trainees (Present, Absent, Half Day or Holiday). Days a trainer forgets to mark are caught automatically, the trainer is reminded, and the manager is escalated after repeated misses. Includes a continuous date-wise calendar and the monthly HR attendance sheet with Excel download.

**Stack:** Next.js 14 · Tailwind CSS · Supabase (Auth + PostgreSQL + Realtime)

## Who does what

| | Trainer (e.g. Karan Raval) | Manager |
|---|---|---|
| Logs in | Yes | Yes |
| Trainees | Adds and edits their own trainees (or pastes them from Excel) | Sees and edits all trainees, assigns them to trainers |
| Marks attendance | For their own trainees | For anyone (and can change older entries) |
| Gets notified | Reminder before the deadline, alert for each unmarked day | Attention and escalation when a trainer keeps missing days |

Trainees do **not** log in.

## Setup

1. Create a Supabase project.
2. **SQL Editor:** paste and run `supabase/schema.sql`.
   *Installed the earlier version (where trainers marked their own attendance)? Run `supabase/00_reset_old_version.sql` first, then `schema.sql`.*
3. (Recommended) **Database → Extensions → pg_cron**, then run:
   ```sql
   select cron.schedule('trainer-attendance-check', '*/15 * * * *', $$select public.process_missed_attendance()$$);
   ```
4. Copy `.env.example` to `.env.local` and fill in the Supabase URL, anon key and service_role key.
5. `npm install` then `npm run dev`, open http://localhost:3000
6. Click **Load demo data** on the login page.

Demo logins (password `Demo@123`):

- `manager@demo.com`: manager
- `karan@demo.com` (or Employee ID `TRN-01`): trainer Karan Raval with 10 trainees (Chirag, Sanjukta, …)
- `meet@demo.com` (or `TRN-02`): trainer Meet Shah with 6 trainees, has missed 4 days → escalation

## Daily flow

1. Trainer opens **Dashboard** or **Mark Attendance**, sees today's list of trainees.
2. Taps Present / Absent / Half Day / Holiday for each (or **Mark all: Holiday** for a festival day), then **Save Attendance**.
3. If any trainee is still unmarked after the deadline (default 12:00 PM), that day is flagged **Not Marked**, the trainer is notified, and the missed-day counter goes up.
4. At threshold − 1 the manager gets an attention alert; at the threshold (default 3) and after, an escalation.

Sundays and 2nd/4th Saturdays are week offs automatically (configurable). There is no separate holiday screen; trainers choose **Holiday** while marking.

Trainers can change saved entries for the last few days (Settings → edit window, default 3). Older entries need a manager.

## Monthly sheet (Excel)

**Monthly Sheet** shows and downloads the HR format:

`E Code | E Name | DOJ | TCD / LWD | Reporting manager | 01 … 31 | Present Days | WO | Public Holiday | Absent | HD | Leaves | Total Paid Days | Remarks`

- Cells: `P`, `WO`, `PH` (trainer marked Holiday), `Absent`, `Half day`, `Not Marked`, and `Handover to Reporting Manager` on the day after the TCD.
- Total Paid Days = Present + WO + Public Holiday + Leaves + ½ × HD.
- Remarks: Resigned / Not Certified / DOJ Revised / Offer Revoked and any Not Marked count.

**Handover (manager only):** on Trainees, use **Handover** (one or many) and pick the last training day. From the next day the trainee disappears from attendance, and the monthly sheet shows "Handover to Reporting Manager". Use **Bring back for training** with a restart date when they return. Each stint is kept as a training period.

**Deleting trainees** never removes their attendance: deleted trainees disappear from the list, register, calendar and alerts, but stay in Monthly Sheet, History, Analytics and Excel downloads. Restore them from the *Deleted* filter.

**Paste from Excel** on the Trainees page accepts rows copied straight from that sheet (E Code, E Name, DOJ, TCD / LWD, Reporting manager; remarks from the last column).

## Deploy to Vercel

Import the repo, add the same env vars, deploy. In Supabase → Authentication → URL Configuration, set Site URL to your Vercel URL and add `https://YOUR-APP.vercel.app/reset-password` to Redirect URLs.

## Project map

```
supabase/schema.sql                  tables, RLS, mark_attendance(), process_missed_attendance()
supabase/00_reset_old_version.sql    removes the earlier version before reinstalling
app/(app)/dashboard                  trainer: today's register · manager: trainer-wise status
app/(app)/attendance                 register for any date (manager can pick a trainer)
app/(app)/timeline                   continuous date-wise calendar (batch summary, grid, one trainee)
app/(app)/trainees                   add / edit / paste from Excel
app/(app)/trainers                   trainer login accounts (manager)
app/(app)/reports                    monthly HR sheet + Excel download
app/(app)/history, analytics, notifications, settings, profile
components/Register.jsx              the daily marking list
lib/status.js, lib/dates.js          status rules and date arithmetic
lib/monthlySheet.js                  sheet rules and .xlsx generation
lib/parseTrainees.js                 paste-from-Excel parser
```
