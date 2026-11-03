// Feedback form responses (Google Sheet → app). Columns are found by their HEADINGS, so the order of the
// questions in the form does not matter. Every question and answer is kept (in order) in `answers`.
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

// A heading that is about something else than the person's own name
const NOT_A_PERSON = /trainer|manager|batch|course|training|session|topic|company|department|team|college|city|location|designation|father|mother|rate|rating|feedback/;

export function feedbackColumns(header) {
  const heads = (header || []).map(norm);
  const exact = (list) => { for (const n of list) { const i = heads.indexOf(n); if (i >= 0) return i; } return -1; };
  const find = (test) => heads.findIndex((h) => h && test(h));
  const ts = (() => { const i = find((h) => h === 'timestamp' || h.startsWith('timestamp')); return i; })();
  let email = exact(['email address', 'email', 'email id', 'official email', 'official email id', 'company email', 'company email id', 'mail id', 'your email', 'your email id', 'email id official']);
  if (email < 0) email = find((h) => /\bemail\b|\bmail id\b/.test(h) && !/personal/.test(h));
  if (email < 0) email = find((h) => /\bemail\b|\bmail id\b/.test(h));
  let code = exact(['e code', 'ecode', 'emp code', 'emp id', 'employee code', 'employee id', 'employee number', 'emp no', 'employee no', 'e code employee code']);
  if (code < 0) code = find((h) => /\b(e code|ecode|emp code|emp id|employee code|employee id)\b/.test(h));
  let name = exact(['name', 'your name', 'full name', 'employee name', 'e name', 'trainee name', 'name of the trainee', 'name of trainee', 'participant name', 'candidate name', 'name of employee', 'name of the employee']);
  if (name < 0) name = find((h) => /\bname\b/.test(h) && !NOT_A_PERSON.test(h));
  let trainer = exact(['trainer name', 'name of trainer', 'name of the trainer', 'trainer', 'trainers name', 'trainer s name', 'your trainer', 'your trainer name', 'trainer name nht', 'trainer name sales']);
  if (trainer < 0) trainer = find((h) => /trainer/.test(h) && /\bname\b/.test(h));
  let batch = exact(['batch', 'batch code', 'batch id', 'batch no', 'batch number', 'batch name']);
  if (batch < 0) batch = find((h) => /\bbatch\b/.test(h) && /\b(code|id|no|number)\b/.test(h));
  return { ts, email, code, name, trainer, batch };
}

const HONORIFICS = /\b(bhai|bhaiya|bhaisaab|sir|ji|mam|madam|ma'am|maam|mr|mrs|ms|dr)\b\.?/gi;
// "Swapnil bhai" → "Swapnil": the way people write a trainer's name in a form
export const cleanTrainerName = (s) => String(s || '').replace(HONORIFICS, ' ').replace(/\s+/g, ' ').trim();

function parseWhen(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s); // the Google script sends ISO timestamps (with the time zone)
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// header + rows (as text, straight from the sheet) → responses ready to save
export function parseFeedback(header, rows, formId) {
  const col = feedbackColumns(header);
  const errors = [];
  if (!(header || []).length) errors.push('The feedback sheet has no heading row.');
  if (col.name < 0 && col.email < 0 && col.code < 0) {
    errors.push('No Name, Email or E Code column was found in the feedback sheet headings, so responses cannot be matched to trainees.');
  }
  if (errors.length) return { responses: [], errors, cols: col };
  const get = (r, i) => (i >= 0 ? String(r[i] ?? '').replace(/\s+/g, ' ').trim() : '');
  const used = new Map();
  const responses = [];
  rows.forEach((r) => {
    if (!r.some((x) => String(x ?? '').trim())) return;
    const email = get(r, col.email).toLowerCase();
    const name = get(r, col.name);
    const when = get(r, col.ts);
    const who = email || nameKey(name) || get(r, col.code).toLowerCase() || 'row';
    let key = `${when}|${who}`;
    const seen = (used.get(key) || 0) + 1; // two identical keys in one upload: keep both
    used.set(key, seen);
    if (seen > 1) key += `#${seen}`;
    responses.push({
      form_id: formId,
      row_key: key,
      submitted_at: parseWhen(when),
      respondent_name: name || null,
      respondent_email: email.includes('@') ? email : null,
      respondent_code: get(r, col.code).replace(/\.0$/, '') || null,
      trainer_name: cleanTrainerName(get(r, col.trainer)) || null,
      batch_code: get(r, col.batch).toUpperCase() || null,
      answers: header.map((q, i) => ({ q: String(q || '').trim(), a: String(r[i] ?? '').trim() })).filter((x) => x.q && x.a),
    });
  });
  return { responses, errors, cols: col };
}
