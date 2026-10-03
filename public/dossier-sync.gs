/**
 * Dossier → Trainer Attendance sync (Google Apps Script)
 *
 * Works with VIEW access to the Dossier: this script lives in YOUR Google account
 * and only reads the sheet. It never changes the Dossier.
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
  SHEET_ID: 'PASTE-THE-DOSSIER-SHEET-ID',           // the long code in the Dossier URL between /d/ and /edit
  TAB_NAME: 'Dossier',                              // exact name of the tab with the trainee rows
  FIRST_DATA_ROW: 2,                                // first row with a trainee (below the headings)
  FROM_DOJ: '',                                     // optional: only trainees who joined on/after this date, e.g. '2026-07-01'
  TRAINER_MAP: {                                    // optional: Dossier trainer name → trainer login email in the app
    // 'Samir': 'samir@petpooja.com',
  },
  DEFAULT_TRAINER_EMAIL: '',                        // optional: trainer for rows without a trainer name
  IMPORT_ATTENDANCE: true,                          // also copy P / AB / HD / Holiday (never overwrites app entries)
  SYNC_EVERY_HOURS: 1,                              // 1, 2, 4, 6, 8 or 12

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
  const values = sheet.getRange(CONFIG.FIRST_DATA_ROW, 1, n, sheet.getLastColumn()).getDisplayValues();
  const fills = sheet.getRange(CONFIG.FIRST_DATA_ROW, 5, n, 1).getBackgrounds(); // Name column colour = status
  const keep = [];
  values.forEach(function (r, i) { if (String(r[4] || '').trim() && String(r[1] || '').trim()) keep.push(i); }); // has Name and DOJ
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
