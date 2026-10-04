# Going live + connecting the Master Dossier

## A. Database (Supabase → SQL Editor → New query → Run each file once)
Run any you haven't run yet, in this order:
1. `supabase/update_handover.sql`
2. `supabase/update_keep_reports.sql`
3. `supabase/update_batches.sql`
4. `supabase/update_dossier_rag.sql`
5. `supabase/update_rag_review.sql`
6. `supabase/update_dossier_sync.sql`
7. `supabase/update_retraining.sql`
8. `supabase/update_writeback.sql`  ← new
(Fresh project instead? Run only `supabase/FULL_INSTALL.sql`.)

## B. Put the code on GitHub
1. github.com → **New repository** → name `trainer-attendance` → **Private** → Create.
2. On the new repo page click **uploading an existing file**.
3. Drag in everything from your project folder **except** `node_modules`, `.next` and `.env.local`.
4. Click **Commit changes**.

## C. Deploy on Vercel
1. vercel.com → sign in with GitHub → **Add New → Project** → import `trainer-attendance`.
2. Open **Environment Variables** and add (values from your `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DOSSIER_SYNC_SECRET` (generate it in the app: Settings → Dossier connection → Generate a secret)
   - `NEXT_PUBLIC_SHOW_DEMO_HINT` = `false`
3. Click **Deploy**. Copy the address, e.g. `https://trainer-attendance.vercel.app`.
4. Supabase → **Authentication → URL Configuration** → Site URL = that address. Add
   `https://trainer-attendance.vercel.app/reset-password` under Redirect URLs. Save.
5. Optional: Supabase → Database → Extensions → enable **pg_cron**, then in SQL Editor:
   `select cron.schedule('trainer-attendance-check', '*/15 * * * *', $$select public.process_missed_attendance()$$);`

## D. Connect the Master Dossier (Google Apps Script)
1. script.google.com → **New project** → name it *Dossier Sync* → paste `integrations/dossier-sync.gs`.
2. Fill CONFIG:
   - `APP_URL` = your Vercel address
   - `SYNC_SECRET` = same as DOSSIER_SYNC_SECRET
   - `SHEET_ID` = from the Dossier link (between /d/ and /edit)
   - `TAB_NAME` = `Master Data - 13622` (or the current tab name)
   - `HEADER_ROW` = 1, `FIRST_DATA_ROW` = 2
   - `WRITE_BACK` = `true` if you can type in the Day, RAG and RAG Remarks columns (locked first columns are fine)
3. Ctrl + S → choose `syncDossier` → **Run** → Allow access.
4. Choose `createTrigger` → **Run** → syncs every hour.

### What the connection does
| Direction | What | Needs |
|---|---|---|
| Dossier → app | New trainees added automatically; details, TCD / status, colours, RAG, attendance | View access |
| App → Dossier | Attendance marked in the app (P / AB / HD / Holiday) into Day 1…Day 40, RAG and RAG Remarks — cell by cell | You can type in those columns (first columns may stay locked) + `WRITE_BACK: true` |

- Imported days are never written back — only what trainers / managers mark in the app.
- The app never deletes anything in the Dossier and never touches other columns.
- Attendance, RAG and remarks set in the app win over the Dossier.

## E. Every update after this
Replace the changed folders in your project → upload the changed files to GitHub (or re-upload the folder) → Vercel redeploys by itself → run any new `.sql` file.
