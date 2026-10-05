// Parse rows copied from the "Dossier" Google Sheet.
// Layout (fixed first 10 columns): Sr | DOJ | Personal email | Official email | Name | Phone | City |
// Designation | Department | Reporting manager | (Done, Trainer) pairs … | daily attendance … |
// TCD | Status (Resigned / DOJ Revised …) | … | E Code | … | Track | RAG | Remarks
// Daily attendance starts on the DOJ and has one column per day, Sundays skipped.
import { addDays, dayOfWeek, MONTHS_SHORT, nthWeekdayOfMonth } from './dates';
import { parseDate } from './parseTrainees';

const ATT = { P: 'present', AB: 'absent', A: 'absent', ABSENT: 'absent', HD: 'half_day', 'HALF DAY': 'half_day', HOLIDAY: 'holiday', 'WEEK OFF': 'week_off', WO: 'week_off' };
const EXIT = [
  [/doj\s*revised/i, 'doj_revised'], [/offer\s*revoked/i, 'offer_revoked'], [/not\s*certified/i, 'not_certified'],
  [/service\s*not\s*required/i, 'service_not_required'], [/resign/i, 'resigned'],
];
const RAG = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
// Teams where the Dossier stops updating daily attendance once training is complete (row turns pink):
// the days up to the TCD that were not updated count as Present.
export const AUTO_COMPLETE_TEAMS = /(embedded\s*finance|payroll|invoice|\bnpu\b)/i;
const isWeekOffDay = (k) => dayOfWeek(k) === 0 || isSecondOrFourthSat(k);
const isAtt = (v) => ATT[v.trim().toUpperCase()] !== undefined;
const ddmmyyyy = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

// Next day that has a column in the Dossier (Sundays are skipped)
const nextCol = (k) => { let d = k; while (dayOfWeek(d) === 0) d = addDays(d, 1); return d; };
const isSecondOrFourthSat = (k) => dayOfWeek(k) === 6 && [2, 4].includes(nthWeekdayOfMonth(k));

// Map a row's attendance cells to dates starting at `start` (Sundays have no column)
function mapCells(cells, start) {
  const out = [];
  let d = nextCol(start);
  let mismatches = 0;
  for (const v of cells) {
    const st = ATT[v.toUpperCase()];
    if (st === 'week_off' && !isSecondOrFourthSat(d)) mismatches += 1;
    out.push({ date: d, status: st || null });
    d = nextCol(addDays(d, 1));
  }
  return { cells: out, mismatches, lastDate: out.length ? out[out.length - 1].date : null };
}

// Row colours used in the Dossier (Name column): light blue = DOJ revised / offer revoked,
// yellow = left (resigned, not certified …), dark pink / cream = handed over, white = in training.
export function colourStatus(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(hex || '').replace(/^#?ff(?=[0-9a-f]{6}$)/i, ''));
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  if (r > 235 && g > 235 && b > 235) return null;               // white
  if (r < 120 && g > 180 && b > 180) return 'blue';             // cyan / light blue
  if (r > 200 && g > 200 && b < 120) return 'yellow';
  if (r > 200 && g < 120 && b > 180) return 'handover';         // dark pink / magenta
  if (r > 200 && g > 150 && g < 225 && b > 140 && b < 225) return 'handover'; // cream / light pink
  return null;
}

export function parseDossier(text, { colors = [] } = {}) {
  const rows = [];
  const errors = [];
  const raw = [];
  text.split(/\r?\n/).forEach((line, li) => {
    if (!line.trim()) return;
    const c = line.split('\t').map((x) => (x || '').trim());
    if (c.length < 10) { errors.push(`Line ${li + 1}: not enough columns (copy whole rows from the Dossier)`); return; }
    const name = c[4];
    const doj = parseDate(c[1]);
    if (!name || /^name$/i.test(name)) return; // header / empty
    if (!doj) { errors.push(`Line ${li + 1} (${name}): DOJ "${c[1]}" is not a date`); return; }

    // RAG + remarks from the right-hand end
    let ragIdx = -1;
    for (let i = c.length - 1; i >= 10; i -= 1) if (RAG[c[i].toUpperCase()]) { ragIdx = i; break; }
    const rag = ragIdx >= 0 ? RAG[c[ragIdx].toUpperCase()] : null;
    const remark = ragIdx >= 0 ? c.slice(ragIdx + 1).filter(Boolean).join(' ') : '';
    const endIdx = ragIdx >= 0 ? ragIdx : c.length;
    let trackIdx = -1;
    for (let i = endIdx - 1; i >= 10; i -= 1) if (c[i]) { trackIdx = i; break; }
    const track = trackIdx >= 0 && !/^\d+$/.test(c[trackIdx]) && !isAtt(c[trackIdx]) && !ddmmyyyy.test(c[trackIdx]) ? c[trackIdx] : null;

    // E Code: last 3–6 digit number before the track
    let code = null;
    for (let i = (track ? trackIdx : endIdx) - 1; i >= 10; i -= 1) if (/^\d{3,6}$/.test(c[i])) { code = c[i]; break; }

    // Trainer: names written after "Done"
    const counts = {};
    for (let i = 10; i < c.length - 1; i += 1) {
      if (/^done$/i.test(c[i]) && c[i + 1] && /^[A-Za-z][A-Za-z .]*$/.test(c[i + 1]) && !/^done$/i.test(c[i + 1]) && !isAtt(c[i + 1])) {
        counts[c[i + 1]] = (counts[c[i + 1]] || 0) + 1;
      }
    }
    const trainerName = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Attendance block: from the first attendance value to the last one before the TCD
    let tcdIdx = -1;
    for (let i = 10; i < endIdx; i += 1) if (ddmmyyyy.test(c[i])) { tcdIdx = i; break; }
    const attEnd = tcdIdx >= 0 ? tcdIdx : endIdx;
    let first = -1;
    let last = -1;
    for (let i = 10; i < attEnd; i += 1) if (isAtt(c[i])) { if (first < 0) first = i; last = i; }

    // TCD / exit
    const tcd = tcdIdx >= 0 ? parseDate(c[tcdIdx]) : null;
    let exit = null;
    for (let i = 10; i < endIdx; i += 1) {
      const hit = EXIT.find(([re]) => re.test(c[i]));
      if (hit) { exit = hit[1]; break; }
    }
    if (!exit && tcd) exit = 'handover';
    raw.push({ c, first, last, doj, tcd, colour: colourStatus(colors[li]) });
    rows.push({
      line: li + 1,
      employee_code: code,
      name,
      joining_date: doj,
      tcd_lwd: tcd,
      exit_reason: exit,
      reporting_manager: c[9] || null,
      department: c[8] || null,
      designation: c[7] || null,
      city: c[6] || null,
      official_email: /@/.test(c[3]) ? c[3] : null,
      track,
      rag,
      rag_remark: remark || null,
      trainerName,
      attendance: [],
      lastDate: null,
      trainingStart: null,
      warnings: [],
    });
  });

  // Every row's attendance starts in the same column ("training day 1"). Use the most common one.
  const firstCounts = {};
  raw.forEach((r) => { if (r.first >= 0) firstCounts[r.first] = (firstCounts[r.first] || 0) + 1; });
  const startCol = Number(Object.entries(firstCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1);

  // Pass 1: new joiners start on their DOJ → learn the holiday dates used in this sheet
  const holidayCount = {};
  const isRecent = (r) => !r.tcd || r.doj >= addDays(r.tcd, -120);
  const cellsOf = (r) => (r.first < 0 ? [] : r.c.slice(Math.min(r.first, startCol >= 0 ? startCol : r.first), r.last + 1));
  raw.forEach((r) => {
    if (!isRecent(r) || r.first < 0) return;
    const m = mapCells(cellsOf(r), r.doj);
    if (m.mismatches) return;
    m.cells.forEach((x) => { if (x.status === 'holiday') holidayCount[x.date] = (holidayCount[x.date] || 0) + 1; });
  });
  const holidays = new Set(Object.keys(holidayCount).filter((k) => holidayCount[k] >= 2));

  // Pass 2: map each row. Existing employees (old DOJ) are retrained later, so their start date
  // is found by lining up their Week Off / Holiday cells with the calendar, before the TCD.
  raw.forEach((r, idx) => {
    const row = rows[idx];
    const cells = cellsOf(r); // empty when the Dossier has no daily attendance for this row
    let start = r.doj;
    if (!isRecent(r) && cells.length) {
      let best = null;
      const end = r.tcd || addDays(r.doj, 3650);
      for (let s = addDays(end, -150); s <= end; s = addDays(s, 1)) {
        if (s < r.doj || dayOfWeek(s) === 0) continue;
        const m = mapCells(cells, s);
        if (r.tcd && m.lastDate > addDays(r.tcd, 3)) continue;
        const holidayMiss = m.cells.filter((x) => x.status === 'holiday' && holidays.size && !holidays.has(x.date)).length;
        const score = m.mismatches * 2 + holidayMiss * 3;
        if (!best || score < best.score || (score === best.score && m.lastDate > best.last)) best = { s, score, last: m.lastDate };
      }
      if (best) start = best.s;
      if (!best || best.score > 0) row.warnings.push('retraining start date could not be matched exactly');
    }
    const m = mapCells(cells, start);
    // A "Week Off" typed on a holiday (e.g. 15 Aug, a 3rd Saturday) is that holiday
    m.cells.forEach((x) => {
      if (x.status === 'week_off' && !isSecondOrFourthSat(x.date) && holidays.has(x.date)) { x.status = 'holiday'; m.mismatches -= 1; }
    });
    row.trainingStart = start;
    row.attendance = m.cells.filter((x) => x.status && x.status !== 'week_off');
    row.lastDate = m.lastDate;
    if (m.mismatches > 0) row.warnings.push(`${m.mismatches} "Week Off" not on a 2nd/4th Saturday`);
    // Colour fills in what the text leaves out
    const lastWorked = row.attendance.length ? row.attendance[row.attendance.length - 1].date : null;
    if (r.colour === 'handover' && !row.tcd_lwd && !row.exit_reason && lastWorked) {
      row.tcd_lwd = lastWorked; row.exit_reason = 'handover';
      row.warnings.push('marked handed over (colour) without a TCD: last attendance day used');
    }
    if (r.colour === 'yellow' && !row.exit_reason) {
      row.exit_reason = 'resigned'; row.tcd_lwd = row.tcd_lwd || lastWorked;
      row.warnings.push('marked yellow without a reason: saved as Resigned');
    }
    if (r.colour === 'blue' && !row.exit_reason) { row.exit_reason = 'doj_revised'; row.tcd_lwd = null; }

    // Embedded Finance / Payroll / Invoice / NPU: training completed (handed over) → days not updated
    // up to the TCD count as Present
    if (row.exit_reason === 'handover' && row.tcd_lwd
        && [row.department, row.track].some((v) => v && AUTO_COMPLETE_TEAMS.test(v))) {
      const have = new Set(row.attendance.map((x) => x.date));
      let filled = 0;
      for (let k = start; k <= row.tcd_lwd; k = addDays(k, 1)) {
        if (isWeekOffDay(k) || have.has(k)) continue;
        row.attendance.push({ date: k, status: holidays.has(k) ? 'holiday' : 'present', auto: true });
        filled += 1;
      }
      if (filled) {
        row.attendance.sort((a, b) => (a.date < b.date ? -1 : 1));
        row.autoFilled = filled;
        row.lastDate = row.tcd_lwd;
      }
    }
    if (m.lastDate && r.tcd && m.lastDate > addDays(r.tcd, 3)) row.warnings.push('attendance runs past the TCD');
  });
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Sheets with named columns (e.g. the "Dossier Sheet": DOJ | Emp Id | Batch Type | Batch Id |
// Personal Email | Official Email | Name | … | Trainer Name | Training Status |
// Probable Handover Date | Function | … | RAG | Remarks). Columns are found by their heading.
// ---------------------------------------------------------------------------
const HEAD = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const pick = (heads, ...names) => {
  for (const n of names) { const i = heads.indexOf(n); if (i >= 0) return i; }
  for (const n of names) { const i = heads.findIndex((h) => h.startsWith(n)); if (i >= 0) return i; }
  return -1;
};

// The sheet has named columns but no Day 1 … Day 40 attendance block
export const isHeadedDossier = (header) => {
  const heads = (header || []).map(HEAD);
  return heads.includes('name') && heads.includes('doj') && !heads.includes('day 1');
};

// "12-Oct" / "12 Oct" / "12-10" (no year) → the date on/after the DOJ
function dateNoYear(v, doj) {
  const s = String(v || '').trim();
  if (!s) return null;
  const full = parseDate(s);
  if (full) return full;
  let d; let mo;
  let m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,})$/);
  if (m) { d = +m[1]; mo = MONTHS_SHORT.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()) + 1; }
  m = m ? null : s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m) { d = +m[1]; mo = +m[2]; }
  if (!d || !mo || mo < 1) return null;
  const y0 = Number((doj || '').slice(0, 4)) || new Date().getFullYear();
  const pad2 = (x) => String(x).padStart(2, '0');
  let k = `${y0}-${pad2(mo)}-${pad2(d)}`;
  if (doj && k < doj) k = `${y0 + 1}-${pad2(mo)}-${pad2(d)}`;
  return k;
}

const STATUS = [
  [/doj\s*revis/i, 'doj_revised'], [/offer\s*revok/i, 'offer_revoked'], [/not\s*certif/i, 'not_certified'],
  [/service\s*not\s*req/i, 'service_not_required'], [/resign|abscond|left|terminat/i, 'resigned'],
  [/hand\s*over|handed|completed|certified|done|reporting\s*manager/i, 'handover'],
];

/**
 * header: the heading row (array of strings); rows: data rows (arrays). today: 'YYYY-MM-DD'.
 * Returns the same row shape as parseDossier (no attendance — this sheet has none).
 */
export function parseDossierByHeader(header, rows, { today = null } = {}) {
  const heads = (header || []).map(HEAD);
  const col = {
    doj: pick(heads, 'doj', 'date of joining'),
    code: pick(heads, 'emp id', 'emp code', 'employee id', 'employee code', 'e code'),
    name: pick(heads, 'name', 'full name'),
    official: pick(heads, 'official email', 'official mail'),
    city: pick(heads, 'location', 'city'),
    designation: pick(heads, 'designation'),
    department: pick(heads, 'department'),
    rm: pick(heads, 'reporting authority', 'reporting manager', 'rm'),
    trainer: pick(heads, 'trainer name', 'trainer', 'coach'),
    status: pick(heads, 'training status', 'status'),
    probable: pick(heads, 'probable handover date', 'handover date', 'tcd', 'training completion date'),
    lwd: pick(heads, 'lwd', 'last working day'),
    track: pick(heads, 'function', 'track'),
    batch: pick(heads, 'batch id'),
    rag: heads.findIndex((h) => h === 'rag' || h === 'rag status'),
    remark: heads.findIndex((h) => h === 'rag remarks' || h === 'remarks' || h === 'remark' || h === 'rag remark'),
  };
  const out = [];
  const errors = [];
  if (col.name < 0 || col.doj < 0) return { rows: out, errors: ['The heading row needs "Name" and "DOJ" columns.'] };
  const get = (r, i) => (i >= 0 ? String(r[i] ?? '').replace(/[\u202f\u00a0]/g, ' ').trim() : '');

  rows.forEach((r, li) => {
    const name = get(r, col.name).replace(/\s+/g, ' ');
    if (!name) return;
    const doj = parseDate(get(r, col.doj));
    if (!doj) { errors.push(`Row ${li + 2}: "${name}" has no valid DOJ`); return; }
    const statusText = get(r, col.status);
    const exit = (STATUS.find(([re]) => re.test(statusText)) || [])[1] || null;
    const warnings = [];
    let tcd = null;
    if (exit === 'handover') tcd = dateNoYear(get(r, col.probable), doj);
    else if (exit && exit !== 'doj_revised' && exit !== 'offer_revoked') tcd = dateNoYear(get(r, col.lwd), doj) || dateNoYear(get(r, col.probable), doj);
    if (exit && exit !== 'doj_revised' && exit !== 'offer_revoked' && !tcd) {
      tcd = today; warnings.push(`"${statusText}" without a date: today used as the last day`);
    }
    if (tcd && tcd < doj) { tcd = doj; warnings.push('date before DOJ: DOJ used'); }
    const ragText = get(r, col.rag).toLowerCase();
    const code = get(r, col.code).replace(/\.0$/, '');
    out.push({
      employee_code: /^\d{3,8}$/.test(code) ? code : null,
      name,
      joining_date: doj,
      tcd_lwd: tcd,
      exit_reason: exit,
      reporting_manager: get(r, col.rm) || null,
      department: get(r, col.department) || null,
      designation: get(r, col.designation) || null,
      city: get(r, col.city) || null,
      official_email: /@/.test(get(r, col.official)) ? get(r, col.official).toLowerCase() : null,
      track: get(r, col.track) || null,
      rag: ['green', 'amber', 'red'].includes(ragText) ? ragText : null,
      rag_remark: get(r, col.remark) || null,
      trainerName: get(r, col.trainer) || null,
      batchCode: get(r, col.batch) || null,
      attendance: [],
      lastDate: null,
      trainingStart: doj,
      warnings,
    });
  });
  return { rows: out, errors };
}
