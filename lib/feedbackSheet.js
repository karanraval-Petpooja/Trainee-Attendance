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

// Rating questions (Google Forms "Linear scale" / "Rating"): a column where nearly every answer is a whole number 1-10.
// A 1-5 column is read as stars out of 5; a column with answers above 5 (or "out of 10" in the question) is out of 10 and
// is converted to the 5-star scale, so every rating can be averaged together.
const NOT_RATING = /year|month|\bage\b|experience|batch|code|phone|mobile|contact|number|\bno\b|count|days|how many|salary|ctc|\bpin\b|zip|\bid\b|roll|\bsr\b/;
export function ratingColumns(header, rows, skip = new Set()) {
  const out = [];
  (header || []).forEach((q, i) => {
    const text = String(q || '').trim();
    if (!text || skip.has(i) || NOT_RATING.test(norm(text))) return;
    const vals = rows.map((r) => String(r[i] ?? '').trim()).filter(Boolean);
    if (!vals.length || vals.length < Math.min(3, rows.length)) return;
    const nums = vals.filter((v) => /^\d{1,2}(\.0+)?$/.test(v)).map(Number);
    if (nums.length < vals.length * 0.9 || nums.some((n) => n < 1 || n > 10)) return;
    const says10 = /(out of|\/|1\s*(to|-)\s*)10\b/.test(text.toLowerCase());
    out.push({ i, q: text, scale: says10 || Math.max(...nums) > 5 ? 10 : 5 });
  });
  return out;
}

function parseWhen(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s); // the Google script sends ISO timestamps (with the time zone)
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// { rating: average out of 5 (or null), ratings: { question: value out of 5 } } for one row
function ratingsOf(r, rcols) {
  const ratings = {};
  rcols.forEach((c) => {
    const n = Number(String(r[c.i] ?? '').trim());
    if (Number.isFinite(n) && n >= 1 && n <= c.scale) ratings[c.q] = Math.round(((n * 5) / c.scale) * 100) / 100;
  });
  const v = Object.values(ratings);
  return { rating: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null, ratings };
}

// header + rows (as text, straight from the sheet) → responses ready to save
// opts.allowAnonymous: a sheet whose responses all belong to ONE named trainer may have no Name / Email / E Code column
export function parseFeedback(header, rows, formId, opts = {}) {
  const col = feedbackColumns(header);
  const errors = [];
  if (!(header || []).length) errors.push('The feedback sheet has no heading row.');
  if (col.name < 0 && col.email < 0 && col.code < 0 && !opts.allowAnonymous) {
    errors.push('No Name, Email or E Code column was found in the feedback sheet headings, so responses cannot be matched to trainees.');
  }
  if (errors.length) return { responses: [], errors, cols: col };
  const get = (r, i) => (i >= 0 ? String(r[i] ?? '').replace(/\s+/g, ' ').trim() : '');
  const used = new Map();
  const responses = [];
  const live = rows.filter((r) => r.some((x) => String(x ?? '').trim()));
  const skip = new Set([col.ts, col.email, col.code, col.name, col.trainer, col.batch].filter((i) => i >= 0));
  const rcols = ratingColumns(header, live, skip);
  live.forEach((r) => {
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
      ...ratingsOf(r, rcols),
      answers: header.map((q, i) => ({ q: String(q || '').trim(), a: String(r[i] ?? '').trim() })).filter((x) => x.q && x.a),
    });
  });
  return { responses, errors, cols: col };
}
