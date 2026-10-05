// OJT attendance + score workbook (Google Meet attendance export + assessment scores).
// Tabs are found by their headings:
//   Attendance: Full Name | Email | Duration | Time joined | Time exited | Attendance (P / A)
//   Score:      Full Name | Score | Total | Pass/ Fail
// Works in the browser and in Node.

const norm = (v) => String(v ?? '').replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
const nameKey = (v) => norm(v).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');

const cellValue = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return v.text;
    if (v.error) return '';
  }
  return v;
};
const timeText = (v) => {
  const x = cellValue(v);
  if (x instanceof Date) {
    let h = x.getUTCHours(); const m = x.getUTCMinutes(); const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
  }
  return norm(x);
};

// "3 hr 24 min", "51 min", "1 hr", "2:15:00" → minutes
export function parseDuration(v) {
  const s = norm(cellValue(v)).toLowerCase();
  if (!s) return null;
  const hm = s.match(/^(\d+):(\d{2})(?::\d{2})?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  let total = 0; let found = false;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/); if (h) { total += Number(h[1]) * 60; found = true; }
  const m = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/); if (m) { total += Number(m[1]); found = true; }
  const sec = s.match(/(\d+)\s*(?:s|sec|secs|second|seconds)\b/); if (sec) { total += Number(sec[1]) / 60; found = true; }
  return found ? Math.floor(total) : null;
}
export const fmtDuration = (m) => (m === null || m === undefined ? '' : m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
export const toMinutesOfDay = (t) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(norm(t));
  if (!m) return null;
  let h = Number(m[1]) % 12; if (m[3] && m[3].toUpperCase() === 'PM') h += 12; if (!m[3]) h = Number(m[1]);
  return h * 60 + Number(m[2]);
};

// "JITESH GANGARE" → "Jitesh Gangare"; mixed-case names are kept as typed
function niceName(v) {
  const s = norm(v);
  if (!s || s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s.split(' ').map((w) => (w.length > 2 ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');
}

// Google Meet file name: "<Meeting name> - 2026/10/05 11:00 IST - Attendance (1).xlsx"
// (underscores when downloaded: "PP_Invoice_…_-_2026_10_05_11_00_IST_-_Attendance__1_.xlsx")
// Suggested session length in minutes: start (from the file name, else first join) → typical end, rounded to 5 min
export function suggestSessionMinutes(span, startHHMM) {
  if (!span) return null;
  const [h, m] = String(startHHMM || '').split(':').map(Number);
  const start = startHHMM ? h * 60 + m : span.first;
  const len = span.end - start;
  return len > 0 ? Math.max(5, Math.round(len / 5) * 5) : null;
}

export function parseMeetFileName(fileName) {
  let s = String(fileName || '').replace(/\.xlsx$/i, '').replace(/_/g, ' ').replace(/\s*\(\d+\)\s*$/, '').replace(/\s+\d+\s*$/, '');
  s = s.replace(/\s*-\s*Attendance\s*$/i, '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?)\s*-\s*(\d{4})[\s/.-](\d{1,2})[\s/.-](\d{1,2})(?:\s+(\d{1,2})[\s:.](\d{2}))?/);
  if (!m) return { title: s, date: null, time: null };
  const pad = (x) => String(x).padStart(2, '0');
  return { title: m[1].trim(), date: `${m[2]}-${pad(m[3])}-${pad(m[4])}`, time: m[5] ? `${pad(m[5])}:${m[6]}` : null };
}

function findSheet(wb, needed) {
  return wb.worksheets.find((ws) => {
    const head = (ws.getRow(1).values || []).map((x) => norm(cellValue(x)).toLowerCase());
    return needed.every((n) => head.some((h) => h === n || h.replace(/\s/g, '') === n.replace(/\s/g, '')));
  });
}
function headerIndex(ws) {
  const idx = {};
  (ws.getRow(1).values || []).forEach((x, i) => { const k = norm(cellValue(x)).toLowerCase().replace(/\s/g, ''); if (k) idx[k] = i; });
  return idx;
}

/**
 * Read the workbook → { participants, warnings }.
 * options.requiredMinutes: if set, Present only when time attended ≥ this (one minute less = Absent),
 *   overriding the sheet's P / A column
 * options.minPresentMinutes: used only when the Attendance column is empty and no requiredMinutes (default 105)
 * options.passPercent: used only when Pass/ Fail is empty (default 70)
 */
export async function readOjtWorkbook(buffer, { requiredMinutes = null, minPresentMinutes = 105, passPercent = 70, includeScores = true } = {}) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const warnings = [];

  const att = findSheet(wb, ['full name', 'duration']) || findSheet(wb, ['first name', 'duration'])
    || findSheet(wb, ['full name', 'email']) || findSheet(wb, ['first name', 'email']);
  const sc = includeScores ? findSheet(wb, ['full name', 'score']) : null;
  if (!att && !sc) throw new Error('No attendance tab was found. Use the Google Meet attendance file (First name, Last name, Email, Duration, Time joined, Time exited) or a sheet with Full Name, Email, Duration.');

  // Attendance: one person may have several rows (left and re-joined) → merge by email (or name)
  const people = new Map();
  if (att) {
    const h = headerIndex(att);
    const get = (row, key) => (h[key] ? cellValue(row.getCell(h[key]).value) : ''); // missing column → empty
    att.eachRow((row, n) => {
      if (n === 1) return;
      const name = h.fullname ? norm(get(row, 'fullname')) : niceName(`${norm(get(row, 'firstname'))} ${norm(get(row, 'lastname'))}`);
      if (!name) return;
      const email = norm(get(row, 'email')).toLowerCase() || null;
      const key = email || nameKey(name);
      const dur = parseDuration(get(row, 'duration'));
      const joined = h.timejoined ? timeText(row.getCell(h.timejoined).value) : '';
      const exited = h.timeexited ? timeText(row.getCell(h.timeexited).value) : '';
      const mark = norm(get(row, 'attendance')).toUpperCase().charAt(0);
      const p = people.get(key) || { full_name: name, email, duration_minutes: null, time_joined: '', time_exited: '', marks: [], rows: 0 };
      p.rows += 1;
      if (dur !== null) p.duration_minutes = (p.duration_minutes || 0) + dur;
      if (joined && (!p.time_joined || (toMinutesOfDay(joined) ?? 1e9) < (toMinutesOfDay(p.time_joined) ?? 1e9))) p.time_joined = joined;
      if (exited && (!p.time_exited || (toMinutesOfDay(exited) ?? -1) > (toMinutesOfDay(p.time_exited) ?? -1))) p.time_exited = exited;
      if (mark === 'P' || mark === 'A') p.marks.push(mark);
      people.set(key, p);
    });
    people.forEach((p) => {
      if (p.rows > 1) warnings.push(`${p.full_name}: ${p.rows} join records merged (${fmtDuration(p.duration_minutes)} in total)`);
      if (requiredMinutes) {
        p.attendance = p.duration_minutes !== null && p.duration_minutes >= requiredMinutes ? 'P' : 'A';
        p.belowMinimum = p.attendance === 'A';
      } else {
        p.attendance = p.marks.includes('P') ? 'P' : p.marks.length ? 'A'
          : (p.duration_minutes !== null && p.duration_minutes >= minPresentMinutes ? 'P' : 'A');
      }
    });
  }

  // Scores: matched to attendance by name (the score tab has no email)
  if (sc) {
    const h = headerIndex(sc);
    const passKey = Object.keys(h).find((k) => k.startsWith('pass')) || null;
    const byName = new Map();
    people.forEach((p) => byName.set(nameKey(p.full_name), p));
    const seen = new Set();
    sc.eachRow((row, n) => {
      if (n === 1) return;
      const name = norm(cellValue(row.getCell(h.fullname).value));
      if (!name) return;
      const k = nameKey(name);
      if (seen.has(k)) { warnings.push(`${name}: listed twice in the Score tab, first entry kept`); return; }
      seen.add(k);
      const rawScore = cellValue(row.getCell(h.score).value);
      const total = Number(cellValue(row.getCell(h.total || 0).value)) || null;
      const absent = /absent/i.test(String(rawScore));
      const score = absent || rawScore === '' ? null : Number(rawScore);
      let result = passKey ? norm(cellValue(row.getCell(h[passKey]).value)) : '';
      result = /^pass/i.test(result) ? 'Pass' : /^fail/i.test(result) ? 'Fail' : /absent/i.test(result) ? 'Absent' : '';
      if (!result) result = absent ? 'Absent' : score !== null && total ? (score / total * 100 >= passPercent ? 'Pass' : 'Fail') : '';
      let p = byName.get(k);
      if (!p) {
        p = { full_name: name, email: null, duration_minutes: null, time_joined: '', time_exited: '', attendance: att ? 'A' : null };
        people.set(`score:${k}`, p);
        byName.set(k, p);
        if (att) warnings.push(`${name}: in the Score tab but not in Attendance`);
      }
      Object.assign(p, { score: Number.isFinite(score) ? score : null, total, result: result || null });
    });
  }

  const participants = [...people.values()].map((p) => ({
    full_name: p.full_name, email: p.email, duration_minutes: p.duration_minutes, time_joined: p.time_joined || null,
    time_exited: p.time_exited || null, attendance: p.attendance || null, score: p.score ?? null, total: p.total ?? null, result: p.result || null,
  }));
  if (sc) participants.filter((p) => !p.result && p.attendance).forEach((p) => warnings.push(`${p.full_name}: no score`));
  const joins = participants.map((p) => toMinutesOfDay(p.time_joined)).filter((x) => x !== null);
  const exits = participants.map((p) => toMinutesOfDay(p.time_exited)).filter((x) => x !== null);
  // Typical end = when 80% of people had left (ignores the one person who stayed late)
  const sortedExits = [...exits].sort((x, y) => x - y);
  const typicalEnd = sortedExits.length ? sortedExits[Math.min(sortedExits.length - 1, Math.floor(sortedExits.length * 0.8))] : null;
  const span = joins.length && exits.length ? { first: Math.min(...joins), last: Math.max(...exits), end: typicalEnd } : null;
  return { participants, warnings, span };
}

export const hasScores = (rows) => rows.some((r) => r.result || (r.score !== null && r.score !== undefined));

export function summarizeOjt(rows) {
  const c = { participants: rows.length, present: 0, absent: 0, pass: 0, fail: 0, assessAbsent: 0, noScore: 0, scoreSum: 0, scored: 0, minutes: 0, timed: 0 };
  rows.forEach((r) => {
    if (r.attendance === 'P') c.present += 1; else if (r.attendance === 'A') c.absent += 1;
    if (r.result === 'Pass') c.pass += 1; else if (r.result === 'Fail') c.fail += 1; else if (r.result === 'Absent') c.assessAbsent += 1; else c.noScore += 1;
    if (r.score !== null && r.score !== undefined && r.total) { c.scoreSum += r.score / r.total * 100; c.scored += 1; }
    if (r.duration_minutes) { c.minutes += r.duration_minutes; c.timed += 1; }
  });
  const appeared = c.pass + c.fail;
  c.attendancePct = c.present + c.absent ? Math.round(c.present * 1000 / (c.present + c.absent)) / 10 : null;
  c.passPct = appeared ? Math.round(c.pass * 1000 / appeared) / 10 : null;
  c.avgScorePct = c.scored ? Math.round(c.scoreSum * 10 / c.scored) / 10 : null;
  c.avgMinutes = c.timed ? Math.round(c.minutes / c.timed) : null;
  return c;
}

// Download in the same 3-tab layout: Attendance, Score, Pivot Table
export async function downloadOjtWorkbook(rows, filename) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const head = (ws) => ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2750' } }; });
  const a = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 1 }] });
  a.addRow(['Full Name', 'Email', 'Duration', 'Time joined', 'Time exited', 'Attendance']);
  rows.forEach((r) => {
    const row = a.addRow([r.full_name, r.email || '', fmtDuration(r.duration_minutes), r.time_joined || '', r.time_exited || '', r.attendance || '']);
    if (r.attendance === 'A') {
      row.eachCell((c) => { c.font = { color: { argb: 'FFB91C1C' } }; });
      row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } };
      row.getCell(6).font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
  });
  [34, 38, 14, 13, 13, 12].forEach((w, i) => { a.getColumn(i + 1).width = w; });
  head(a);
  const withScores = rows.some((r) => r.result || (r.score !== null && r.score !== undefined));
  if (withScores) {
  const s = wb.addWorksheet('Score', { views: [{ state: 'frozen', ySplit: 1 }] });
  s.addRow(['Full Name', 'Score', 'Total', 'Pass/ Fail']);
  rows.filter((r) => r.result || r.score !== null).forEach((r) => s.addRow([r.full_name, r.result === 'Absent' ? 'Absent' : r.score, r.total, r.result || '']));
  [34, 10, 10, 12].forEach((w, i) => { s.getColumn(i + 1).width = w; });
  head(s);
  const c = summarizeOjt(rows);
  const p = wb.addWorksheet('Pivot Table');
  p.addRow([]); p.addRow([]); p.addRow([]);
  p.addRow(['', 'Pass/ Fail']);
  p.addRow(['', 'Absent', 'Fail', 'Pass', 'Grand Total']);
  p.addRow(['Count of Score', c.assessAbsent, c.fail, c.pass, c.assessAbsent + c.fail + c.pass]);
  p.getRow(5).font = { bold: true }; p.getColumn(1).width = 16;
  }
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
