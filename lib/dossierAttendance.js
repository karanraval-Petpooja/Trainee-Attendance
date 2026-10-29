// "Attendance only" Dossier upload: reads Day 1 … Day 40 (Day 1 = DOJ, Sundays have no column)
// for trainees already in the app. Nothing else is read or changed.
import { parseDate } from './parseTrainees';

const CODE = { P: 'present', PRESENT: 'present', AB: 'absent', A: 'absent', ABSENT: 'absent', HD: 'half_day', 'HALF DAY': 'half_day',
  HOLIDAY: 'holiday', H: 'holiday', PH: 'holiday', 'PUBLIC HOLIDAY': 'holiday' };
const WEEK_OFF = /^(week\s*off|wo|w\/o|weekoff)$/i;

const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const addDay = (k, n) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const isSunday = (k) => new Date(`${k}T00:00:00Z`).getUTCDay() === 0;

// the date of "Day n" for a DOJ: Day 1 = DOJ (or the Monday after, if the DOJ is a Sunday), Sundays skipped
export function dayDates(doj, count) {
  const out = []; let k = doj;
  while (isSunday(k)) k = addDay(k, 1);
  for (let n = 1; n <= count; n += 1) {
    if (n > 1) { k = addDay(k, 1); while (isSunday(k)) k = addDay(k, 1); }
    out.push(k);
  }
  return out;
}

function cellValue(cell) {
  let v = cell?.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) v = v.result;
    else if (Array.isArray(v.richText)) v = v.richText.map((r) => r.text).join('');
    else if ('text' in v) v = v.text;
  }
  return v;
}

// Read the workbook: the tab whose first row has Name, DOJ and Day 1
export async function readAttendanceWorkbook(buffer) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const low = (x) => String(x ?? '').trim().toLowerCase();
  const headOf = (s) => { const r = s.getRow(1); const h = []; for (let c = 1; c <= s.columnCount; c += 1) h.push(low(cellValue(r.getCell(c)))); return h; };
  const ws = wb.worksheets.find((s) => { const h = headOf(s); return h.includes('name') && h.includes('doj') && h.includes('day 1'); });
  if (!ws) throw new Error('No tab with the headings Name, DOJ and Day 1 was found in this file.');
  const h = headOf(ws);
  const col = (...names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i + 1; } return 0; };
  const C = {
    name: col('name'), doj: col('doj'), official: col('official email', 'company email', 'company email id'),
    personal: col('personal email'), code: col('emp code', 'emp id', 'e code', 'employee code'), phone: col('number', 'phone', 'mobile'),
  };
  const days = h.map((x, i) => { const m = x.match(/^day\s*(\d+)$/); return m ? { n: +m[1], c: i + 1 } : null; }).filter(Boolean).sort((a, b) => a.n - b.n);
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const name = String(cellValue(row.getCell(C.name)) ?? '').trim();
    if (!name) continue;
    const dv = cellValue(row.getCell(C.doj));
    const doj = dv instanceof Date ? iso(dv) : parseDate(dv);
    const marks = days.map((d) => { const v = cellValue(row.getCell(d.c)); return v == null ? '' : String(v).trim(); });
    rows.push({
      name, joining_date: doj,
      official_email: C.official ? String(cellValue(row.getCell(C.official)) ?? '').trim() : '',
      personal_email: C.personal ? String(cellValue(row.getCell(C.personal)) ?? '').trim() : '',
      employee_code: C.code ? String(cellValue(row.getCell(C.code)) ?? '').trim().replace(/\.0$/, '') : '',
      phone: C.phone ? String(cellValue(row.getCell(C.phone)) ?? '').trim() : '',
      marks, dayNumbers: days.map((d) => d.n),
    });
  }
  return { sheetName: ws.name, rows };
}

// Work out what the upload would do. existing = { traineeId: { 'YYYY-MM-DD': status } } (app entries before the cut-off)
export function planAttendance(rows, match, existing, cutoff) {
  const plan = { add: [], differ: [], same: 0, afterCutoff: 0, beforeDoj: 0, weekOffs: 0, unknown: {}, unmatched: [], noDoj: [], matched: 0, byMonth: {} };
  for (const r of rows) {
    if (!r.joining_date) { if (r.marks.some(Boolean)) plan.noDoj.push(r.name); continue; }
    if (!r.marks.some(Boolean)) continue;
    const t = match(r);
    if (!t) { plan.unmatched.push(`${r.name} (DOJ ${r.joining_date})`); continue; }
    plan.matched += 1;
    const dates = dayDates(r.joining_date, Math.max(...r.dayNumbers));
    r.marks.forEach((m, i) => {
      if (!m) return;
      if (WEEK_OFF.test(m)) { plan.weekOffs += 1; return; }
      const s = CODE[m.toUpperCase()];
      if (!s) { plan.unknown[m] = (plan.unknown[m] || 0) + 1; return; }
      const d = dates[r.dayNumbers[i] - 1];
      if (d >= cutoff) { plan.afterCutoff += 1; return; }
      // an older stint in the sheet (re-joiner): never attach its days to the current stint in the app
      const first = (t.training_periods?.[0]?.start) || t.joining_date;
      if (first && d < first) { plan.beforeDoj += 1; return; }
      const have = existing[t.id]?.[d];
      if (!have) { plan.add.push({ t: t.id, d, s }); plan.byMonth[d.slice(0, 7)] = (plan.byMonth[d.slice(0, 7)] || 0) + 1; }
      else if (have !== s) plan.differ.push({ t: t.id, d, s, was: have, name: t.name });
      else plan.same += 1;
    });
  }
  return plan;
}
