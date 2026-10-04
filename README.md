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
- `karan@demo.com` (or Employee ID `TRN-01`): trainer Karan Raval: ran NHT01 until the switch, now runs NHT03
- `meet@demo.com` (or `TRN-02`): trainer Meet Shah (NHT02), has missed 4 days → escalation
- `sanjukta@demo.com` (or `TRN-03`): took over half of NHT01 from Karan for Sales Training 7 days ago

## Batches (inside Trainees & Batches)

- **New Batch** creates the next code automatically (`NHT01`, `NHT02`, … — prefix in Settings) for a trainer.
- Put trainees in a batch (Add Trainee, *Paste from Excel*, or select rows → **Move to batch**).
- **Switch trainer** works for any set of trainees from a date: the whole batch, half of it, or one person. The rest stay where they are.
  - Example: NHT01 with Karan from 1 Oct; 10 trainees → Sanjukta and 5 → Meet from 15 Oct; 5 stay with Karan.
  - Each trainer's register, calendar, sheet and alerts show only their own days; the manager sees everything.
  - Managers can **Undo switch** (selected trainees or the whole batch).
- Click a batch chip to see who has how many trainees now and the trainer history.

## Going live with real data

1. Supabase SQL Editor: run `supabase/remove_demo_data.sql` (deletes demo logins, trainees and attendance).
2. Open the app. If no login is left, the login page lets you **create the first manager**.
3. Manager → **Trainers**: add the trainers (e.g. Samir, Istiyak, Navya, Khushal, Karan Raval).
4. Manager → **Trainees & Batches → Import from Dossier**: upload the Dossier Excel file (File → Download → Microsoft Excel) or paste whole rows. Row colours are understood: light blue = DOJ revised, yellow = left, dark pink / cream = handed over, white = in training. For Embedded Finance, Payroll, Invoice and NPU, a handed-over (pink) row counts the days the Dossier stopped updating, up to the TCD, as Present. It reads E Code, DOJ, TCD / LWD, status, trainer, track, RAG, remarks and the daily attendance (P / AB / HD / Holiday, counted from the DOJ, Sundays skipped). Pasting again later updates the same trainees.

## Dossier connection (automatic)

Full step-by-step: **GO_LIVE.md**. With edit access and `WRITE_BACK: true`, attendance, RAG and remarks marked in the app are also written back into the Dossier.


The app must be online (Vercel) for this — Google can't reach localhost.
1. Supabase: run `supabase/update_dossier_sync.sql`.
2. Settings → Dossier connection → **Generate a secret**. Add it as `DOSSIER_SYNC_SECRET` in Vercel (and `.env.local`), redeploy.
3. Settings → **Download Google script** (or `integrations/dossier-sync.gs`). In script.google.com create a new project, paste it, fill in CONFIG (app URL, secret, Dossier sheet ID, tab name, first data row).
4. Run `syncDossier` once (allow access), then run `createTrigger` → syncs every hour.

Matching: E Code → official email → Name + DOJ, so trainees added before they get an E Code are updated (not duplicated) when the code appears. Optional: the script can fill missing E Codes from the Contact Details sheet (CONFIG.CONTACTS) if your Google account can view it.

Sync rules: the Dossier is only read. New people are added; existing ones get updated details, TCD and status. RAG / remarks and trainers set in the app are never overwritten (the Dossier only fills blanks). Attendance only fills days not yet marked in the app. Trainees brought back for training in the app keep their app dates.

## RAG & remarks

- Trainers set **RAG (Green / Amber / Red) + remarks** for trainees they have or had (click the RAG chip on Trainees or in the RAG Report).
- No approval step: what the trainer saves is final.
- **Handover needs RAG:** a trainee can't be handed over until their RAG is marked (the Handover dialog lists who is missing and lets you set it right there).
- **RAG Report** lists and downloads them (Excel). They are **not** part of the Monthly Sheet.
- The Monthly Sheet's *Remarks* column only shows the exit type: Resigned, DOJ Revised, Offer Revoked, Not Certified, Service Not Required.

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
supabase/update_batches.sql          adds batches to an existing install (keeps data)
supabase/update_dossier_rag.sql      adds RAG, Dossier fields and attendance import (keeps data)
supabase/update_rag_review.sql       trainer/manager RAG updates, no approval (keeps data)
supabase/remove_demo_data.sql        deletes demo data before going live
app/(app)/rag                        RAG & remarks report
lib/parseDossier.js                  Dossier paste parser
lib/dossierSync.js                   shared rules for Dossier import / sync
app/api/dossier-sync                 endpoint the Google script sends rows to
app/api/dossier-export               what the script writes back into the Dossier
supabase/update_writeback.sql        tracks app vs imported attendance (keeps data)
integrations/dossier-sync.gs         Google Apps Script (also downloadable in Settings)
supabase/update_dossier_sync.sql     adds the sync log (keeps data)
app/(app)/dashboard                  trainer: today's register · manager: trainer-wise status
app/(app)/attendance                 register for any date (manager can pick a trainer)
app/(app)/timeline                   continuous date-wise calendar (batch summary, grid, one trainee)
app/(app)/trainees                   trainees + batches: add, paste from Excel, switch trainer, handover
app/(app)/trainers                   trainer login accounts (manager)
app/(app)/reports                    monthly HR sheet + Excel download
app/(app)/history, analytics, notifications, settings, profile
components/Register.jsx              the daily marking list
lib/status.js, lib/dates.js          status rules and date arithmetic
lib/monthlySheet.js                  sheet rules and .xlsx generation
lib/parseTrainees.js                 paste-from-Excel parser
```
