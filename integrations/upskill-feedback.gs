/**
 * Upskill Feedback sheet → Trainer Attendance app (Feedback Report → Upskill tab)
 *
 * SETUP (your Google account needs at least VIEW access to the feedback sheet)
 *  1. https://script.google.com → New project → delete the sample code → paste this file.
 *  2. Fill in CONFIG below (APP_URL and the same SYNC_SECRET you use in the Dossier script) → Save (Ctrl + S).
 *  3. Choose "pushFeedback" in the function list at the top → Run → allow access.
 *     Check "Execution log": it shows how many responses were added.
 *  4. Choose "createTrigger" → Run. New responses are now sent automatically every hour.
 *  To stop: choose "removeTrigger" → Run.
 *
 * Safe to run again and again: responses already in the app are skipped (same email + same time).
 * Nothing in the app is deleted or overwritten.
 */
const CONFIG = {
  APP_URL: 'https://attendance-five-sable.vercel.app',      // your app address
  SYNC_SECRET: 'PASTE-THE-SAME-SECRET-AS-DOSSIER_SYNC_SECRET',
  SHEET_ID: '1F73zTFplQzhWGYCC4Gx_0Pjd2CNtxWgk-ILREC2NAUc', // Upskill Feedback Form (Responses)
  TAB_GID: '1255620033',                                    // tab ID from the link (#gid=…); empty = use TAB_NAME
  TAB_NAME: 'Form Responses 1',
  FORM_ID: 'upskill',                                       // app tab: upskill | ojt-pip | nht | sales
  EVERY_HOURS: 1,                                           // 1, 2, 4, 6, 8 or 12
};

function pushFeedback() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const tabs = ss.getSheets();
  let sheet = CONFIG.TAB_GID ? tabs.filter(function (t) { return String(t.getSheetId()) === String(CONFIG.TAB_GID); })[0] : null;
  if (!sheet) sheet = ss.getSheetByName(CONFIG.TAB_NAME);
  if (!sheet) throw new Error('Tab not found. Tabs: ' + tabs.map(function (t) { return t.getName() + ' (gid ' + t.getSheetId() + ')'; }).join(', '));

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) { Logger.log('No responses yet.'); return; }
  const header = values[0].map(function (h) { return String(h).trim(); });
  const rows = values.slice(1)
    .filter(function (r) { return r[0] !== '' && r[0] !== null; })
    .map(function (r) { return r.map(function (c) { return c instanceof Date ? c.toISOString() : c; }); });

  let added = 0, already = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const res = UrlFetchApp.fetch(CONFIG.APP_URL.replace(/\/$/, '') + '/api/feedback-push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-sync-secret': String(CONFIG.SYNC_SECRET).trim() },
      payload: JSON.stringify({ formId: CONFIG.FORM_ID, header: header, rows: rows.slice(i, i + 100) }),
    });
    const code = res.getResponseCode();
    let j = {};
    try { j = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
    if (code !== 200) throw new Error('App said ' + code + ': ' + (j.error || res.getContentText().slice(0, 300)));
    added += j.added || 0; already += j.alreadyInApp || 0;
    if (j.errors && j.errors.length) { Logger.log('Problems: ' + j.errors.join(' | ')); break; }
    if (j.skippedColumns && j.skippedColumns.length) Logger.log('Columns not in the database (left out): ' + j.skippedColumns.join(', '));
  }
  Logger.log('Responses in sheet: ' + rows.length + ' · newly added: ' + added + ' · already in app: ' + already);
}

function createTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('pushFeedback').timeBased().everyHours(CONFIG.EVERY_HOURS).create();
  Logger.log('Automatic push every ' + CONFIG.EVERY_HOURS + ' hour(s) is on.');
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pushFeedback') ScriptApp.deleteTrigger(t);
  });
}
