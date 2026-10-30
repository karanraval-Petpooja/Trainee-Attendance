/**
 * FINAL script for the Trainer Attendance app (paste it into your SAME Apps Script project,
 * replacing all the old code). It does only two things, and never opens the Dossier sheet:
 * (trainees are updated only by uploading the Dossier file in the app)
 *
 *  • Training Log: Upskill / Refresher sessions pushed from the app (Push to Training Log)
 *    are written into your Training Log sheet, one row per participant; Sr. No continues per trainer.
 *  • Contact Details: the employee list (Name, Department, Location, Designation …) is sent to the app
 *    every few hours and with the app's "Refresh contacts" button. It fills Location / Location Type /
 *    Designation / Department in the Training Log rows.
 *
 * SET UP (once):
 *  1. Fill APP_URL and SYNC_SECRET below (SYNC_SECRET = DOSSIER_SYNC_SECRET in Vercel). Save.
 *  2. Choose "syncContacts" → Run → Allow (Google asks once for access to the sheets).
 *  3. Deploy → New deployment → ⚙️ Web app → Execute as: Me, Who has access: Anyone → Deploy.
 *     Copy the Web app URL into the app: Settings → Google script → Save.
 *  4. Choose "createTrigger" → Run (Contact Details refresh every few hours).
 *  After changing this code later: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.
 */
const SCRIPT_VERSION = '2026-10-29 final-v11'; // shown in the log, so you can see which code is running

const CONFIG = {
  APP_URL: 'https://YOUR-APP.vercel.app',          // your app address (no / at the end)
  SYNC_SECRET: 'PASTE-THE-SAME-SECRET-AS-IN-VERCEL', // = DOSSIER_SYNC_SECRET in Vercel

  // Training Log sheet: Upskill / Refresher sessions pushed from the app
  TRAINING_LOG: {
    SHEET_ID: '14w9Ahgbxw732KaR6SuGtSzcZHP8CAHS6j4lQs1kbhKI',
    TAB_GID: 1134105869,                           // the tab from the link (…#gid=1134105869)
  },

  // Contact Details sheet → app (fills Location / Designation / Department). YOUR account needs view access.
  CONTACTS: {
    SHEET_ID: '1FDODawNLYPxIp9PdJm8NDHFrEBbOKGZcOwS7WkDZOt4', // Contact Details sheet
    TAB_GID: '',                                    // optional: tab ID from the link (…#gid=…); empty = use TAB_NAME
    TAB_NAME: 'ACTIVE',                             // tab name at the bottom of the Contact Details sheet
    LEFT_TAB_NAME: '',                              // tab with LEFT employees; empty = any tab called Left / Exit / Resigned / Inactive
    FIRST_DATA_ROW: 0,                              // 0 = find the heading row automatically (Name + Department)
    REFRESH_EVERY_HOURS: 6,                         // automatic refresh; also on demand: app → Contact Details → Refresh
    EMAIL_COLUMN: '',                               // optional (old method): column letter with the official email
    CODE_COLUMN: '',                                // optional (old method): column letter with the E Code
  },
};

// The app calls this web app address with the secret: action=trainingLog (push) or action=contacts (refresh)
function doGet(e) {
  var out;
  if (!e || !e.parameter || String(e.parameter.key || '').trim() !== String(CONFIG.SYNC_SECRET).trim()) out = { ok: false, error: 'Wrong key' };
  else {
    try {
      const action = e.parameter.action;
      if (action === 'version') { out = { ok: true, version: SCRIPT_VERSION, trainingLog: true }; return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON); }
      if (action === 'trainingLog') out = pushTrainingLog_(JSON.parse((e.postData && e.postData.contents) || '{}'));
      else if (action === 'contacts') out = syncContacts();
      else out = { ok: false, error: 'Unknown action. This script serves the Training Log (action=trainingLog) and Contact Details (action=contacts) only.' };
    } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) { return doGet(e); }

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

// rows of a Contact Details tab: heading row = the first row (top 10) with a Name and a Department-type heading
function contactRows_(sheet, firstRow) {
  const last = sheet.getLastRow(); const width = sheet.getLastColumn();
  if (!last || !width) return null;
  var first = firstRow || 0;
  if (!first) {
    const top = sheet.getRange(1, 1, Math.min(10, last), width).getDisplayValues();
    for (var h = 0; h < top.length && !first; h++) {
      const cells = top[h].map(function (x) { return String(x).trim().toLowerCase(); });
      const hasName = cells.some(function (x) { return /name/.test(x); });
      const hasDept = cells.some(function (x) { return /depart|\bdept\b|^team( name)?$|^function$/.test(x.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()); });
      if (hasName && hasDept) first = h + 2;
    }
    if (!first) return null;
  }
  const header = sheet.getRange(first - 1, 1, 1, width).getDisplayValues()[0];
  const values = last >= first ? sheet.getRange(first, 1, last - first + 1, width).getDisplayValues() : [];
  return { header: header, rows: values.filter(function (r) { return r.join('').trim(); }) };
}

// send one list to the app: status 'active' (ACTIVE tab) or 'left' (LEFT tab)
function sendContacts_(data, status, runId) {
  const total = { rows: 0, added: 0, updated: 0, deactivated: 0 };
  const step = 500;
  for (var i = 0; i < data.rows.length || i === 0; i += step) {
    const chunk = data.rows.slice(i, i + step);
    const res = UrlFetchApp.fetch(CONFIG.APP_URL.replace(/\/$/, '') + '/api/contacts-sync', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-sync-secret': String(CONFIG.SYNC_SECRET).trim() },
      payload: JSON.stringify({ header: data.header, rows: chunk, runId: runId, status: status, final: i + step >= data.rows.length }),
    });
    const code = res.getResponseCode(); const text = res.getContentText() || '';
    var body = null;
    try { body = JSON.parse(text || '{}'); } catch (e) {
      throw new Error('Contacts: the app at ' + CONFIG.APP_URL + ' answered HTTP ' + code + ' and not JSON (' + text.replace(/\s+/g, ' ').slice(0, 160) + '). ' +
        (code === 401 || /vercel/i.test(text) ? 'Vercel Deployment Protection may be blocking it (Vercel → Settings → Deployment Protection).' : 'Check APP_URL and that the latest app is deployed.'));
    }
    if (!body.ok) throw new Error('Contacts: HTTP ' + code + ' – ' + (body.error || 'error'));
    total.rows += body.rows; total.added += body.added; total.updated += body.updated; total.deactivated += body.deactivated || 0;
    if (!data.rows.length) break;
  }
  return total;
}

function syncContacts() {
  Logger.log('Script version ' + SCRIPT_VERSION);
  const c = CONFIG.CONTACTS;
  if (!c || !c.SHEET_ID) throw new Error('Fill CONTACTS.SHEET_ID and CONTACTS.TAB_NAME in CONFIG first.');
  const sheet = contactsTab_(c);
  const active = contactRows_(sheet, c.FIRST_DATA_ROW || 0);
  if (!active) throw new Error('Contact Details: no heading row with "Name" and "Department" in the first 10 rows of "' + sheet.getName() + '".');
  const runId = Utilities.getUuid();
  const a = sendContacts_(active, 'active', runId);
  Logger.log('Contacts – Active (tab "' + sheet.getName() + '"): ' + a.rows + ' rows, ' + a.added + ' added, ' + a.updated + ' updated, ' + a.deactivated + ' no longer active.');
  // LEFT employees: the tab named in LEFT_TAB_NAME, or any tab called Left / Exit / Resigned / Inactive
  const book = SpreadsheetApp.openById(c.SHEET_ID);
  const want = String(c.LEFT_TAB_NAME || '').trim().toLowerCase();
  const leftTab = book.getSheets().filter(function (t) { const n = t.getName().trim().toLowerCase(); return (want && n === want) || (!want && /\bleft\b|exit|resign|inactive|ex[-\s]?employee/.test(n)); })[0];
  var l = null;
  if (leftTab && leftTab.getSheetId() !== sheet.getSheetId()) {
    const data = contactRows_(leftTab, 0);
    if (data) { l = sendContacts_(data, 'left', runId); Logger.log('Contacts – Left (tab "' + leftTab.getName() + '"): ' + l.rows + ' rows, ' + l.added + ' added, ' + l.updated + ' updated.'); }
  } else Logger.log('Contacts – Left: no Left tab found (set CONFIG.CONTACTS.LEFT_TAB_NAME).');
  return { ok: true, rows: a.rows + (l ? l.rows : 0), added: a.added + (l ? l.added : 0), updated: a.updated + (l ? l.updated : 0), deactivated: a.deactivated, left: l ? l.rows : 0 };
}

// Contact Details refresh every few hours (Training Log needs no trigger: the app pushes it)
function createTrigger() {
  removeTrigger();
  if (CONFIG.CONTACTS && CONFIG.CONTACTS.SHEET_ID) ScriptApp.newTrigger('syncContacts').timeBased().everyHours(CONFIG.CONTACTS.REFRESH_EVERY_HOURS || 6).create();
  Logger.log('Contact Details refresh: every ' + (CONFIG.CONTACTS.REFRESH_EVERY_HOURS || 6) + ' hour(s).');
}

// Removes every time trigger of this project (also any old Dossier sync trigger)
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('All automatic triggers removed.');
}
