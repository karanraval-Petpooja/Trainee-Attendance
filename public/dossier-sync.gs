/**
 * Dossier → Trainer Attendance sync (Google Apps Script)
 *
 * This script lives in YOUR Google account. Reading needs view access; writing back needs
 * that you can type in the Day / RAG / RAG Remarks columns.
 *
 * Two directions:
 *  • Dossier → app (needs VIEW access): new trainees, details, TCD / status, RAG, attendance.
 *  • App → Dossier (WRITE_BACK: true): for trainees who start on/after WRITE_BACK_FROM, RAG and
 *    RAG Remarks set in the app are written into the RAG and RAG Remarks columns. Attendance is
 *    written into the Day columns only if WRITE_ATTENDANCE is true (off by default). Older rows are never changed.
 *    Locked cells are skipped and logged.
 *
 * SETUP
 *  1. Go to https://script.google.com → New project. Delete the sample code and paste this file.
 *  2. Fill in CONFIG below and press Save (Ctrl + S).
 *  3. Choose "syncDossier" in the function list at the top → Run. Allow access when Google asks.
 *     Check the result under "Execution log".
 *  4. Choose "createTrigger" → Run. From now on it syncs automatically.
 *  5. Optional, for the app's "Get new trainees" button: Deploy → New deployment → type "Web app" →
 *     Execute as: Me, Who has access: Anyone → Deploy. Copy the Web app URL (ends with /exec) and paste it
 *     in the app: Settings → Dossier connection → Google script web app URL → Save.
 *     After changing this code later: Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *  6. Contact Details: choose "syncContacts" → Run once (allow access). createTrigger then refreshes it
 *     every CONTACTS.REFRESH_EVERY_HOURS hours; the app's Contact Details page also has a Refresh button.
 *  To stop the automatic sync: choose "removeTrigger" → Run.
 */
const SCRIPT_VERSION = '2026-10-16 no-dossier-sync-v6'; // shown in the log, so you can see which code is running

const CONFIG = {
  APP_URL: 'https://YOUR-APP.vercel.app',           // your deployed app address (not localhost)
  SYNC_SECRET: 'PASTE-THE-SAME-SECRET-AS-DOSSIER_SYNC_SECRET',
  SHEET_ID: '1F5Ji6NQuV2Q83pYGlpHX7CdFgHCuopNeW3CRgi6zsgw',           // the long code in the Dossier URL between /d/ and /edit
  TAB_NAME: 'Sheet1',                              // exact name of the tab with the trainee rows
  FIRST_DATA_ROW: 2,                                // first row with a trainee (below the headings)
  FROM_DOJ: '',                                     // optional: only trainees who joined on/after this date, e.g. '2026-07-01'
  TRAINER_MAP: {                                    // optional: Dossier trainer name → trainer login email in the app
    // 'Samir': 'samir@petpooja.com',
  },
  DEFAULT_TRAINER_EMAIL: '',                        // optional: trainer for rows without a trainer name
  IMPORT_ATTENDANCE: true,                          // also copy P / AB / HD / Holiday (never overwrites app entries)
  SYNC_EVERY_HOURS: 1,                              // 1, 2, 4, 6, 8 or 12
  WRITE_BACK: true,                                 // true = write RAG / RAG Remarks from the app into the sheet
  WRITE_ATTENDANCE: false,                          // false = never write attendance (Day columns) into the sheet
  WRITE_BACK_DAYS: 90,                              // how far back to write attendance marked in the app
  WRITE_BACK_FROM: '2026-10-05',                    // only trainees whose training starts on/after this date are written
                                                    // (existing rows in the Dossier are never changed)
  HEADER_ROW: 1,                                    // row with the headings (Name, DOJ, Day 1, RAG …)

  // Contact Details sheet → app (employee list with departments, used for "Not attended" in sessions)
  // and for filling missing E Codes. YOUR Google account needs view access. Empty SHEET_ID = off.
  // Training Log sheet: Upskill / Refresher sessions pushed from the app (Push to training sheet)
  TRAINING_LOG: {
    SHEET_ID: '14w9Ahgbxw732KaR6SuGtSzcZHP8CAHS6j4lQs1kbhKI',
    TAB_GID: 1134105869,                           // the tab from the link (…#gid=1134105869)
  },
  CONTACTS: {
    SHEET_ID: '1FDODawNLYPxIp9PdJm8NDHFrEBbOKGZcOwS7WkDZOt4', // Contact Details sheet
    TAB_GID: '',                                    // optional: tab ID from the link (…#gid=…); empty = use TAB_NAME
    TAB_NAME: 'ACTIVE',                             // tab name at the bottom of the Contact Details sheet
    FIRST_DATA_ROW: 0,                              // 0 = find the heading row automatically (Name + Department)
    REFRESH_EVERY_HOURS: 6,                         // automatic refresh; also on demand: app → Contact Details → Refresh
    EMAIL_COLUMN: '',                               // optional (old method): column letter with the official email
    CODE_COLUMN: '',                                // optional (old method): column letter with the E Code
  },
  ROWS_PER_REQUEST: 60,
};

// The Dossier Google Sheet sync is SWITCHED OFF: trainees are updated only by uploading the Dossier file
// in the app (Trainees & Batches → Upload Dossier sheet). This script is kept for Contact Details and the
// Training Log push. Set DOSSIER_SYNC_ON to true only if you ever want the automatic Dossier sync back.
const DOSSIER_SYNC_ON = false;

function syncDossier() {
  if (!DOSSIER_SYNC_ON) return { ok: false, error: 'The Dossier sync is switched off. Upload the Dossier file in the app instead.' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: true, busy: true, message: 'A sync is already running. Try again in a minute.' };
  try { return runSync_(); } finally { lock.releaseLock(); }
}

// "Get new trainees" button in the app calls this web app address (with the sync secret)
function doGet(e) {
  var out;
  if (!e || !e.parameter || e.parameter.key !== CONFIG.SYNC_SECRET) out = { ok: false, error: 'Wrong key' };
  else {
    try {
      const action = e.parameter.action;
      if (action === 'contacts') out = syncContacts();
      else if (action === 'trainingLog') out = pushTrainingLog_(JSON.parse((e.postData && e.postData.contents) || '{}'));
      else out = { ok: false, error: 'Unknown action. This script serves Contact Details (action=contacts) and the Training Log (action=trainingLog).' };
    } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) { return doGet(e); }

function runSync_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TAB_NAME);
  if (!sheet) throw new Error('Tab "' + CONFIG.TAB_NAME + '" not found. Tabs: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(', '));
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.FIRST_DATA_ROW) { Logger.log('No rows to sync.'); return { ok: true, rows: 0, added: 0, updated: 0, attendanceDays: 0, errors: [] }; }
  const n = lastRow - CONFIG.FIRST_DATA_ROW + 1;
  const header = sheet.getRange(CONFIG.HEADER_ROW || 1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const heads = header.map(function (h) { return String(h).trim().toLowerCase(); });
  const nameCol = heads.indexOf('name') >= 0 ? heads.indexOf('name') : 4;   // Master Dossier: column E
  const dojCol = heads.indexOf('doj') >= 0 ? heads.indexOf('doj') : 1;      // Master Dossier: column B
  const dataRange = sheet.getRange(CONFIG.FIRST_DATA_ROW, 1, n, sheet.getLastColumn());
  const values = realDates_(dataRange, ss.getSpreadsheetTimeZone());
  const fills = sheet.getRange(CONFIG.FIRST_DATA_ROW, nameCol + 1, n, 1).getBackgrounds(); // Name column colour = status
  const keep = [];
  values.forEach(function (r, i) { if (String(r[nameCol] || '').trim() && String(r[dojCol] || '').trim()) keep.push(i); }); // has Name and DOJ
  const rows = keep.map(function (i) { return values[i]; });
  const colors = keep.map(function (i) { return fills[i][0]; });

  const codesByEmail = readContactCodes();
  const runId = Utilities.getUuid();
  const total = { rows: 0, added: 0, updated: 0, attendanceDays: 0, errors: [] };
  for (var i = 0; i < rows.length; i += CONFIG.ROWS_PER_REQUEST) {
    const res = UrlFetchApp.fetch(CONFIG.APP_URL.replace(/\/$/, '') + '/api/dossier-sync', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-secret': CONFIG.SYNC_SECRET },
      payload: JSON.stringify({
        runId: runId,
        header: header,
        rows: rows.slice(i, i + CONFIG.ROWS_PER_REQUEST),
        colors: colors.slice(i, i + CONFIG.ROWS_PER_REQUEST),
        fromDoj: CONFIG.FROM_DOJ,
        trainerMap: CONFIG.TRAINER_MAP,
        defaultTrainerEmail: CONFIG.DEFAULT_TRAINER_EMAIL,
        importAttendance: CONFIG.IMPORT_ATTENDANCE,
        codesByEmail: codesByEmail,
      }),
      muteHttpExceptions: true,
    });
    var body = {};
    try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { /* not JSON */ }
    if (res.getResponseCode() !== 200) {
      throw new Error('Sync failed (' + res.getResponseCode() + '): ' + (body.error || res.getContentText().slice(0, 300)));
    }
    total.rows += body.rows; total.added += body.added; total.updated += body.updated;
    total.attendanceDays += body.attendanceDays; total.errors = total.errors.concat(body.errors || []);
  }
  const written = CONFIG.WRITE_BACK ? writeBackToDossier() : null;
  Logger.log('Synced ' + total.rows + ' rows: ' + total.added + ' added, ' + total.updated + ' updated, ' +
             total.attendanceDays + ' attendance days.' + (total.errors.length ? '\nProblems:\n' + total.errors.join('\n') : ''));
  return { ok: true, rows: total.rows, added: total.added, updated: total.updated, attendanceDays: total.attendanceDays,
           errors: total.errors.slice(0, 10), written: written };
}

// Official email → E Code, from the Contact Details sheet (optional)
// ---------------------------------------------------------------------------
// Contact Details → app (employee list with departments, used for "Not attended" in sessions).
// Uses CONTACTS.SHEET_ID and CONTACTS.TAB_NAME; headings must include Name and Department.
// ---------------------------------------------------------------------------
// Dates as they really are, not as the sheet shows them (a sheet shown month-first, e.g. 2/9/2026,
// would otherwise be read as 2 September). Only for date columns that hold real dates WITH a year;
// columns where dates were typed as text keep the shown text, and year-less dates ("19-Mar") keep
// the shown text so the app can take the year from the batch.
function realDates_(range, tz) {
  const shown = range.getDisplayValues();
  const raw = range.getValues();
  const fmts = range.getNumberFormats();
  const cols = shown.length ? shown[0].length : 0;
  for (var c = 0; c < cols; c++) {
    var hasDates = false; var typedDates = false;
    for (var r = 0; r < raw.length; r++) {
      const v = raw[r][c];
      if (v instanceof Date) hasDates = true;
      else if (typeof v === 'string' && /^\s*\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}\s*$/.test(v)) typedDates = true;
    }
    if (!hasDates || typedDates) continue;
    for (var r2 = 0; r2 < raw.length; r2++) {
      const v2 = raw[r2][c];
      if (v2 instanceof Date && /y/i.test(String(fmts[r2][c] || ''))) shown[r2][c] = Utilities.formatDate(v2, tz, 'yyyy-MM-dd');
    }
  }
  return shown;
}

// ---------------------------------------------------------------------------
// Training Log: one row per participant. Sr. No continues per trainer (Karan Raval's last is 50 → 51, 52…).
// Columns are found by their headings: Sr. No, Date, Month, Name, Mail Id, Location, Location Type,
// Designation, Department, Course type, Topic, Completion Status, Trainer Name.
// Rows already in the sheet (same date + mail/name + topic + trainer) are not added again.
// A tab named exactly like the trainer is used if it exists; otherwise the TAB_GID tab.
// ---------------------------------------------------------------------------
function pushTrainingLog_(body) {
  const c = CONFIG.TRAINING_LOG;
  if (!c || !c.SHEET_ID) throw new Error('Fill CONFIG.TRAINING_LOG.SHEET_ID first.');
  if (!body || !body.rows || !body.rows.length) throw new Error('No rows to push.');
  const book = SpreadsheetApp.openById(c.SHEET_ID);
  const tabs = book.getSheets();
  const norm = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  const sheet = tabs.filter(function (t) { return norm(t.getName()) === norm(body.trainer); })[0]
    || tabs.filter(function (t) { return String(t.getSheetId()) === String(c.TAB_GID); })[0]
    || tabs[0];
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const width = Math.max(sheet.getLastColumn(), 13);
  const values = sheet.getRange(1, 1, lastRow, width).getValues();
  // heading row: has "Sr. No" and "Trainer Name"
  var h = -1;
  for (var r = 0; r < Math.min(10, values.length) && h < 0; r++) {
    const cells = values[r].map(norm);
    if (cells.indexOf('srno') >= 0 && cells.indexOf('trainername') >= 0) h = r;
  }
  if (h < 0) throw new Error('No heading row with "Sr. No" and "Trainer Name" in tab "' + sheet.getName() + '".');
  const heads = values[h].map(norm);
  const col = function () { for (var i = 0; i < arguments.length; i++) { const k = heads.indexOf(arguments[i]); if (k >= 0) return k; } return -1; };
  const C = {
    sr: col('srno', 'srnumber', 'sno'), date: col('date'), month: col('month'), name: col('name', 'employeename'),
    mail: col('mailid', 'email', 'emailid', 'mail'), location: col('location'), locType: col('locationtype'),
    designation: col('designation'), department: col('department'), course: col('coursetype', 'course'),
    topic: col('topic'), status: col('completionstatus', 'status'), trainer: col('trainername', 'trainer'),
  };
  const tz = book.getSpreadsheetTimeZone();
  const dayKey = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v || '').trim(); };
  const tKey = norm(body.trainer);
  var maxSr = 0; var lastUsed = h + 1; var monthSample = null;
  const seen = {};
  for (var r2 = h + 1; r2 < values.length; r2++) {
    const row = values[r2];
    if (String(row[C.name] || '').trim() || String(row[C.sr] || '').trim()) lastUsed = r2 + 1;
    if (C.trainer >= 0 && norm(row[C.trainer]) === tKey) {
      const n = parseInt(row[C.sr], 10);
      if (!isNaN(n) && n > maxSr) maxSr = n;
      seen[[dayKey(row[C.date]), norm(row[C.mail] || row[C.name]), norm(row[C.topic])].join('|')] = true;
    }
    if (C.month >= 0 && row[C.month] !== '' && row[C.month] !== null) monthSample = row[C.month];
  }
  // Date and Month written like the rows already there
  const p = String(body.date).split('-');
  const day = new Date(+p[0], +p[1] - 1, +p[2]);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var month;
  if (monthSample instanceof Date) month = new Date(+p[0], +p[1] - 1, 1);
  else {
    const m = MONTHS[+p[1] - 1]; const sample = String(monthSample || '');
    if (/^[A-Za-z]{3}$/.test(sample)) month = m.slice(0, 3);
    else if (/^[A-Za-z]{3}[-\s']\d{2}$/.test(sample)) month = m.slice(0, 3) + sample.charAt(3) + p[0].slice(2);
    else if (/^[A-Za-z]+[-\s]\d{4}$/.test(sample)) month = m + sample.match(/[-\s]/)[0] + p[0];
    else month = m;
  }
  const out = [];
  var sr = maxSr; var skipped = 0;
  body.rows.forEach(function (x) {
    const key = [Utilities.formatDate(day, tz, 'yyyy-MM-dd'), norm(x.mail || x.name), norm(body.topic)].join('|');
    if (seen[key]) { skipped++; return; }
    seen[key] = true;
    sr++;
    const line = new Array(width).fill('');
    const put = function (k, v) { if (C[k] >= 0) line[C[k]] = v; };
    put('sr', sr); put('date', day); put('month', month); put('name', x.name); put('mail', x.mail);
    put('location', x.location); put('locType', x.locationType); put('designation', x.designation);
    put('department', x.department); put('course', body.course); put('topic', body.topic);
    put('status', x.completion); put('trainer', body.trainer);
    out.push(line);
  });
  if (out.length) {
    const start = lastUsed + 1;
    if (sheet.getMaxRows() < start + out.length - 1) sheet.insertRowsAfter(sheet.getMaxRows(), start + out.length - 1 - sheet.getMaxRows());
    if (lastUsed > h + 1) sheet.getRange(lastUsed, 1, 1, width).copyFormatToRange(sheet, 1, width, start, start + out.length - 1);
    sheet.getRange(start, 1, out.length, width).setValues(out);
  }
  return { ok: true, added: out.length, skipped: skipped, from: out.length ? maxSr + 1 : null, to: out.length ? sr : null, tab: sheet.getName() };
}

function contactsTab_(c) {
  const book = SpreadsheetApp.openById(c.SHEET_ID);
  const tabs = book.getSheets();
  const clean = function (x) { return String(x || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  var sheet = null;
  if (c.TAB_GID !== '' && c.TAB_GID !== null && c.TAB_GID !== undefined) {
    sheet = tabs.filter(function (t) { return String(t.getSheetId()) === String(c.TAB_GID); })[0] || null;
  }
  if (!sheet && c.TAB_NAME) sheet = tabs.filter(function (t) { return clean(t.getName()) === clean(c.TAB_NAME); })[0] || null;
  if (!sheet) { // no match: use the first tab whose top rows have a Name and a Department-type heading
    sheet = tabs.filter(function (t) {
      const rows = t.getLastRow(); const cols = t.getLastColumn();
      if (!rows || !cols) return false;
      const top = t.getRange(1, 1, Math.min(10, rows), cols).getDisplayValues();
      return top.some(function (r) {
        const cells = r.map(function (x) { return String(x).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); });
        return cells.some(function (x) { return /name/.test(x); }) && cells.some(function (x) { return /depart|\bdept\b|^team( name)?$|^function$/.test(x); });
      });
    })[0] || null;
    if (sheet) Logger.log('Contact Details: tab "' + c.TAB_NAME + '" not found, using tab "' + sheet.getName() + '" (gid ' + sheet.getSheetId() + ') which has Name + Department headings.');
  }
  if (!sheet && tabs.length === 1) sheet = tabs[0];
  if (!sheet) {
    throw new Error('Contact Details tab not found. Tabs in "' + book.getName() + '": ' +
      tabs.map(function (t) { return '"' + t.getName() + '" (gid ' + t.getSheetId() + ')'; }).join(', ') +
      '. Put the right one in CONFIG.CONTACTS.TAB_GID or TAB_NAME.');
  }
  return sheet;
}

function syncContacts() {
  Logger.log('Script version ' + SCRIPT_VERSION);
  const c = CONFIG.CONTACTS;
  if (!c || !c.SHEET_ID) throw new Error('Fill CONTACTS.SHEET_ID and CONTACTS.TAB_NAME in CONFIG first.');
  const sheet = contactsTab_(c);
  const last = sheet.getLastRow();
  const width = sheet.getLastColumn();
  var first = c.FIRST_DATA_ROW || 0;
  if (!first) { // heading row = first row (within the top 10) that has a Name and a Department-type heading
    const top = sheet.getRange(1, 1, Math.min(10, last), width).getDisplayValues();
    for (var h = 0; h < top.length && !first; h++) {
      const cells = top[h].map(function (x) { return String(x).trim().toLowerCase(); });
      const hasName = cells.some(function (x) { return /name/.test(x); });
      const hasDept = cells.some(function (x) { return /depart|\bdept\b|^team( name)?$|^function$/.test(x.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()); });
      if (hasName && hasDept) first = h + 2;
    }
    if (!first) throw new Error('Contact Details: no heading row with "Name" and "Department" in the first 10 rows of "' + c.TAB_NAME + '".');
  }
  const header = sheet.getRange(first - 1, 1, 1, width).getDisplayValues()[0];
  const values = last >= first ? sheet.getRange(first, 1, last - first + 1, width).getDisplayValues() : [];
  const rows = values.filter(function (r) { return r.join('').trim(); });
  const runId = Utilities.getUuid();
  const total = { ok: true, rows: 0, added: 0, updated: 0, deactivated: 0 };
  const step = 500;
  for (var i = 0; i < rows.length || i === 0; i += step) {
    const chunk = rows.slice(i, i + step);
    const res = UrlFetchApp.fetch(CONFIG.APP_URL.replace(/\/$/, '') + '/api/contacts-sync', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-sync-secret': CONFIG.SYNC_SECRET },
      payload: JSON.stringify({ header: header, rows: chunk, runId: runId, final: i + step >= rows.length }),
    });
    const body = JSON.parse(res.getContentText() || '{}');
    if (!body.ok) throw new Error('Contacts: ' + (body.error || res.getResponseCode()));
    total.rows += body.rows; total.added += body.added; total.updated += body.updated; total.deactivated += body.deactivated || 0;
    if (!rows.length) break;
  }
  Logger.log('Contacts (tab "' + sheet.getName() + '"): ' + total.rows + ' rows, ' + total.added + ' added, ' + total.updated + ' updated, ' + total.deactivated + ' no longer in the sheet.');
  return total;
}

function readContactCodes() {
  const c = CONFIG.CONTACTS;
  if (!c || !c.SHEET_ID || !c.EMAIL_COLUMN || !c.CODE_COLUMN) return {};
  const sheet = contactsTab_(c);
  const last = sheet.getLastRow();
  if (last < c.FIRST_DATA_ROW) return {};
  const n = last - c.FIRST_DATA_ROW + 1;
  const emails = sheet.getRange(c.EMAIL_COLUMN + c.FIRST_DATA_ROW + ':' + c.EMAIL_COLUMN + last).getDisplayValues();
  const codes = sheet.getRange(c.CODE_COLUMN + c.FIRST_DATA_ROW + ':' + c.CODE_COLUMN + last).getDisplayValues();
  const map = {};
  for (var i = 0; i < n; i++) {
    const email = String(emails[i][0] || '').trim().toLowerCase();
    const code = String(codes[i][0] || '').trim();
    if (email.indexOf('@') > 0 && /^\d{3,8}$/.test(code)) map[email] = code;
  }
  Logger.log('Contact Details: ' + Object.keys(map).length + ' E Codes found.');
  return map;
}

// ---------------------------------------------------------------------------
// App → Dossier: attendance marked in the app, RAG and RAG Remarks
// ---------------------------------------------------------------------------
function writeBackToDossier() {
  if (!DOSSIER_SYNC_ON) return;
  const res = UrlFetchApp.fetch(CONFIG.APP_URL.replace(/\/$/, '') + '/api/dossier-export?days=' + CONFIG.WRITE_BACK_DAYS, {
    headers: { 'x-sync-secret': CONFIG.SYNC_SECRET }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('Write-back failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  const data = JSON.parse(res.getContentText());

  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.TAB_NAME);
  const lastCol = sheet.getLastColumn();
  const head = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const col = function (name) { return head.indexOf(name); };
  var cName = col('name'), cDoj = col('doj'), cEmail = col('official email'), cCode = col('emp code');
  const cRag = col('rag') >= 0 ? col('rag') : col('rag status');
  const cRagRemarks = [col('rag remarks'), col('rag remark'), col('remarks'), col('remark')].filter(function (x) { return x >= 0; })[0];
  const cDay1 = col('day 1');
  if (cEmail < 0) cEmail = col('official mail');
  if (cCode < 0) cCode = [col('emp id'), col('employee id'), col('e code'), col('employee code')].filter(function (x) { return x >= 0; })[0];
  if (cName < 0 || cDoj < 0) throw new Error('Headings "Name" and "DOJ" were not found in row ' + CONFIG.HEADER_ROW);
  if (cRag < 0 && cRagRemarks === undefined) Logger.log('No "RAG" / "Remarks" heading found: nothing to write.');
  var nDays = 0;
  while (cDay1 >= 0 && cDay1 + nDays < head.length && /^day \d+$/.test(head[cDay1 + nDays])) nDays++;

  const first = CONFIG.FIRST_DATA_ROW;
  const n = sheet.getLastRow() - first + 1;
  if (n < 1) return { cells: 0, rags: 0 };
  const shown = sheet.getRange(first, 1, n, lastCol).getDisplayValues();
  const days = nDays ? sheet.getRange(first, cDay1 + 1, n, nDays).getDisplayValues() : shown.map(function () { return []; }); // read only

  // Find each trainee's row: Emp code → official email → Name + DOJ
  const byCode = {}, byEmail = {}, byKey = {};
  shown.forEach(function (r, i) {
    if (cCode >= 0 && r[cCode]) byCode[String(r[cCode]).trim()] = i;
    if (cEmail >= 0 && r[cEmail]) byEmail[String(r[cEmail]).trim().toLowerCase()] = i;
    const d = toIso(r[cDoj]);
    if (r[cName] && d) byKey[String(r[cName]).trim().toLowerCase() + '|' + d] = i;
  });

  const CODE = { present: 'P', absent: 'AB', half_day: 'HD', holiday: 'Holiday' };
  var cells = 0, rags = 0, missing = 0, blocked = [];
  // Write one cell; protected (locked) cells are skipped and listed in the log
  const put = function (row, colIdx, value, label) {
    try { sheet.getRange(first + row, colIdx + 1).setValue(value); return true; }
    catch (e) { blocked.push(label + ' (' + shown[row][cName] + ')'); return false; }
  };
  const from = CONFIG.WRITE_BACK_FROM || '0000-01-01';
  var skippedOld = 0;
  data.trainees.forEach(function (t) {
    if (t.start < from) { if (t.attendance.length || t.rag || t.ragRemark) skippedOld++; return; } // existing trainees: leave the sheet as it is
    var i = (t.code && byCode[t.code] !== undefined) ? byCode[t.code]
      : (t.email && byEmail[t.email] !== undefined) ? byEmail[t.email]
      : byKey[t.name.trim().toLowerCase() + '|' + t.doj];
    if (i === undefined) { if (t.attendance.length || t.rag) missing++; return; }
    if (CONFIG.WRITE_ATTENDANCE) t.attendance.forEach(function (a) {
      const k = dayNumber(t.start, a[0]); // 0 = Day 1
      if (k < 0 || k >= nDays) return;
      const v = CODE[a[1]];
      if (v && String(days[i][k]).trim() !== v && put(i, cDay1 + k, v, 'Day ' + (k + 1))) { days[i][k] = v; cells++; }
    });
    // Week Off on 2nd / 4th Saturdays, up to the latest day marked in the app (dropdown value "Week Off")
    const lastMarked = CONFIG.WRITE_ATTENDANCE && t.attendance.length ? t.attendance[t.attendance.length - 1][0] : null;
    if (lastMarked) {
      for (var d = new Date(t.start + 'T00:00:00Z'); toIsoDate(d) <= lastMarked; d.setUTCDate(d.getUTCDate() + 1)) {
        if (d.getUTCDay() !== 6) continue;
        var nth = Math.ceil(d.getUTCDate() / 7);
        if (nth !== 2 && nth !== 4) continue;
        var k2 = dayNumber(t.start, toIsoDate(d));
        if (k2 < 0 || k2 >= nDays || String(days[i][k2]).trim()) continue; // only empty cells
        if (put(i, cDay1 + k2, 'Week Off', 'Day ' + (k2 + 1))) { days[i][k2] = 'Week Off'; cells++; }
      }
    }
    if (cRag >= 0 && t.rag) {
      const ragText = t.rag.charAt(0).toUpperCase() + t.rag.slice(1);
      if (String(shown[i][cRag]).trim() !== ragText && put(i, cRag, ragText, 'RAG')) rags++;
    }
    if (cRagRemarks !== undefined && t.ragRemark && String(shown[i][cRagRemarks]).trim() !== t.ragRemark.trim()) {
      if (put(i, cRagRemarks, t.ragRemark, 'RAG Remarks')) rags++;
    }
  });
  Logger.log('Written to Dossier: ' + (CONFIG.WRITE_ATTENDANCE ? cells + ' attendance cells, ' : '') + rags + ' RAG / remark cells.' +
             (missing ? ' ' + missing + ' trainee(s) from the app were not found in the Dossier.' : '') +
             (skippedOld ? ' Trainees who started before ' + from + ' were left unchanged (' + skippedOld + ').' : '') +
             (blocked.length ? '\nLocked cells skipped (' + blocked.length + '): ' + blocked.slice(0, 15).join(', ') : ''));
  return { cells: cells, rags: rags, blocked: blocked.length };
}

// "06-Jul-26", "06-Jul-2026", "2026-07-06" or "06/07/2026" → "2026-07-06"
function toIso(v) {
  const s = String(v || '').trim();
  const M = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  m = s.match(/^(\d{1,2})[-\s\/]([A-Za-z]{3})[A-Za-z]*[-\s\/,]*(\d{2,4})$/);
  if (m && M[m[2].toLowerCase()]) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(M[m[2].toLowerCase()]) + '-' + pad2(m[1]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
  return '';
}
function pad2(x) { return ('0' + x).slice(-2); }
function toIsoDate(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }

// Dossier day columns skip Sundays: Day 1 = training start
function dayNumber(startIso, dateIso) {
  var d = new Date(startIso + 'T00:00:00Z'), end = new Date(dateIso + 'T00:00:00Z');
  if (end < d || end.getUTCDay() === 0) return -1;
  var k = 0;
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) k++; }
  return k;
}

function createTrigger() {
  removeTrigger();
  if (DOSSIER_SYNC_ON) ScriptApp.newTrigger('syncDossier').timeBased().everyHours(CONFIG.SYNC_EVERY_HOURS).create();
  if (CONFIG.CONTACTS && CONFIG.CONTACTS.SHEET_ID) ScriptApp.newTrigger('syncContacts').timeBased().everyHours(CONFIG.CONTACTS.REFRESH_EVERY_HOURS || 6).create();
  Logger.log('Automatic refresh: Contact Details every ' + (CONFIG.CONTACTS.REFRESH_EVERY_HOURS || 6) + ' hour(s).' + (DOSSIER_SYNC_ON ? ' Dossier every ' + CONFIG.SYNC_EVERY_HOURS + ' hour(s).' : ' Dossier sync: off (upload the file in the app).'));
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncDossier' || t.getHandlerFunction() === 'syncContacts') ScriptApp.deleteTrigger(t);
  });
}
