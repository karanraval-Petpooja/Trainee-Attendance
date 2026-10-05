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
 *  To stop the automatic sync: choose "removeTrigger" → Run.
 */
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
  WRITE_BACK: false,                                // true = write RAG / RAG Remarks from the app into the sheet
  WRITE_ATTENDANCE: false,                          // false = never write attendance (Day columns) into the sheet
  WRITE_BACK_DAYS: 90,                              // how far back to write attendance marked in the app
  WRITE_BACK_FROM: '2026-10-05',                    // only trainees whose training starts on/after this date are written
                                                    // (existing rows in the Dossier are never changed)
  HEADER_ROW: 1,                                    // row with the headings (Name, DOJ, Day 1, RAG …)

  // OPTIONAL: fill missing E Codes from the Contact Details sheet.
  // Works if YOUR Google account can view that sheet. Leave SHEET_ID empty to switch off.
  CONTACTS: {
    SHEET_ID: '',                                   // long code from the Contact Details sheet URL
    TAB_NAME: '',                                   // tab name, e.g. 'Contact Details'
    FIRST_DATA_ROW: 2,                              // first row below the headings
    EMAIL_COLUMN: '',                               // column letter with the official email, e.g. 'D'
    CODE_COLUMN: '',                                // column letter with the E Code, e.g. 'A'
  },
  ROWS_PER_REQUEST: 60,
};

function syncDossier() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TAB_NAME);
  if (!sheet) throw new Error('Tab "' + CONFIG.TAB_NAME + '" not found. Tabs: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(', '));
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.FIRST_DATA_ROW) { Logger.log('No rows to sync.'); return; }
  const n = lastRow - CONFIG.FIRST_DATA_ROW + 1;
  const header = sheet.getRange(CONFIG.HEADER_ROW || 1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const heads = header.map(function (h) { return String(h).trim().toLowerCase(); });
  const nameCol = heads.indexOf('name') >= 0 ? heads.indexOf('name') : 4;   // Master Dossier: column E
  const dojCol = heads.indexOf('doj') >= 0 ? heads.indexOf('doj') : 1;      // Master Dossier: column B
  const values = sheet.getRange(CONFIG.FIRST_DATA_ROW, 1, n, sheet.getLastColumn()).getDisplayValues();
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
  if (CONFIG.WRITE_BACK) writeBackToDossier();
  Logger.log('Synced ' + total.rows + ' rows: ' + total.added + ' added, ' + total.updated + ' updated, ' +
             total.attendanceDays + ' attendance days.' + (total.errors.length ? '\nProblems:\n' + total.errors.join('\n') : ''));
}

// Official email → E Code, from the Contact Details sheet (optional)
function readContactCodes() {
  const c = CONFIG.CONTACTS;
  if (!c || !c.SHEET_ID) return {};
  const sheet = SpreadsheetApp.openById(c.SHEET_ID).getSheetByName(c.TAB_NAME);
  if (!sheet) throw new Error('Contact Details tab "' + c.TAB_NAME + '" not found');
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
  if (n < 1) return;
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
  ScriptApp.newTrigger('syncDossier').timeBased().everyHours(CONFIG.SYNC_EVERY_HOURS).create();
  Logger.log('Automatic sync is on: every ' + CONFIG.SYNC_EVERY_HOURS + ' hour(s).');
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncDossier') ScriptApp.deleteTrigger(t);
  });
}
