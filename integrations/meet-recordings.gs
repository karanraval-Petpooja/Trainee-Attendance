/**
 * MEET RECORDINGS → Trainer Attendance (TEST FEATURE: Live sessions)
 * Runs in the Google account that HOSTS the Meet sessions. Every 15 minutes it looks in
 * Drive → "Meet Recordings" for new recordings and transcripts, reads the meeting code from the file
 * name (e.g. "abc-defg-hij (2026-11-13 10:02 GMT+5:30) - Transcript") and sends the links to the app,
 * which attaches them to the live session started with that Meet link.
 * It only READS your Drive (and, if you choose, shares the files inside your company). Separate from the
 * Training Log script.
 *
 * SET UP (once, in the hosting account):
 *  1. script.google.com → New project → paste this file. Fill APP_URL and SYNC_SECRET (same as the other script). Save.
 *  2. Choose "syncMeetRecordings" → Run → Allow.  The log shows what was found and sent.
 *  3. Choose "createTrigger" → Run  (every 15 minutes from now on).  "removeTrigger" stops it.
 */
const MR_VERSION = '2026-11-13 meet-recordings-v1';
const MR = {
  APP_URL: 'https://attendance-five-sable.vercel.app',   // your app address (the test copy's address while testing)
  SYNC_SECRET: 'PASTE-THE-SAME-SECRET-AS-IN-VERCEL',     // = DOSSIER_SYNC_SECRET in Vercel
  DAYS_BACK: 3,                                          // look at files from the last few days
  SHARE_IN_COMPANY: false,                               // true = make the files viewable by anyone in your company with the link
};

function syncMeetRecordings() {
  Logger.log('Script version ' + MR_VERSION);
  const folders = DriveApp.getFoldersByName('Meet Recordings');
  if (!folders.hasNext()) { Logger.log('No "Meet Recordings" folder in this Drive yet (it appears after the first recording / transcript).'); return { found: 0 }; }
  const since = new Date(Date.now() - MR.DAYS_BACK * 864e5);
  const byCode = {};
  while (folders.hasNext()) {
    const files = folders.next().getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.getDateCreated() < since) continue;
      const name = f.getName();
      const m = name.match(/\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i);
      if (!m) continue;
      const code = m[1].toLowerCase();
      const it = byCode[code] || (byCode[code] = { code: code });
      const mime = f.getMimeType();
      if (/^video\//.test(mime) && !it.recording_url) it.recording_url = f.getUrl();
      else if (mime === 'application/vnd.google-apps.document' && /transcript/i.test(name) && !it.transcript_url) it.transcript_url = f.getUrl();
      else continue;
      if (MR.SHARE_IN_COMPANY) { try { f.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { Logger.log('Could not share ' + name + ': ' + e); } }
    }
  }
  const items = Object.keys(byCode).map(function (k) { return byCode[k]; }).filter(function (x) { return x.recording_url || x.transcript_url; });
  if (!items.length) { Logger.log('No new recordings or transcripts.'); return { found: 0 }; }
  const res = UrlFetchApp.fetch(MR.APP_URL.replace(/\/$/, '') + '/api/live-media', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-sync-secret': String(MR.SYNC_SECRET).trim() },
    payload: JSON.stringify({ items: items }),
  });
  var body = {}; try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { /* not JSON */ }
  if (res.getResponseCode() !== 200 || !body.ok) throw new Error('App answered HTTP ' + res.getResponseCode() + ': ' + (body.error || res.getContentText().slice(0, 200)));
  Logger.log('Found ' + items.length + ' meeting(s) with files; attached to ' + body.attached + ' session(s).');
  return { found: items.length, attached: body.attached };
}

function createTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('syncMeetRecordings').timeBased().everyMinutes(15).create();
  Logger.log('Meet Recordings check: every 15 minutes.');
}
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncMeetRecordings') ScriptApp.deleteTrigger(t); });
}
