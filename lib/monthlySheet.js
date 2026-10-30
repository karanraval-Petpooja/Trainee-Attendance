// Monthly attendance sheet in the HR format:
// E Code | E Name | DOJ | TCD / LWD | Reporting manager | 01..31 | Present Days | WO |
// Public Holiday | Absent | HD | Leaves | Total Paid Days | Remarks
import { addDays, endOfMonth, fromKey, MONTHS, MONTHS_SHORT, pad, rangeKeys, startOfMonth } from './dates';
import { EXIT_LABELS, attendancePeriods, notJoining, notJoiningReason, periodsOf, traineeActiveOn, weekOffReason } from './status';

export { EXIT_LABELS };

export const CELL = {
  P: 'P',
  WO: 'WO',
  PH: 'PH',
  ABSENT: 'Absent',
  HALF: 'Half day',
  LEAVE: 'Leave',
  NOT_FILLED: 'Not Marked',
  HANDOVER: 'Handover to Reporting Manager',
};

// 06-Jul-26
export function fmtSheetDate(k) {
  if (!k) return '';
  const d = fromKey(k);
  return `${pad(d.getUTCDate())}-${MONTHS_SHORT[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}
// 01-Sep
export function fmtDayHeader(k) {
  const d = fromKey(k);
  return `${pad(d.getUTCDate())}-${MONTHS_SHORT[d.getUTCMonth()]}`;
}

export function tcdLabel(t) {
  if (notJoiningReason(t.exit_reason)) return EXIT_LABELS[t.exit_reason]; // Resigned, Drop Out… (not joining)
  if (t.tcd_lwd) return fmtSheetDate(t.tcd_lwd);
  return 'In Training';
}

// Handover to the reporting manager: the day AFTER the TCD (TCD 20 → 21, even if the 21st is a week off);
// when the TCD is the last day of its month (30 / 31), the handover is shown on the TCD itself.
export const handoverDayOf = (end) => (end === endOfMonth(end) ? end : addDays(end, 1));

// Who belongs on a month's sheet: any training period (or its handover day) overlaps the month
// Exits after real training days: the days from DOJ up to the exit date (LWD) are worked days
export const WORKED_EXITS = new Set(['resigned', 'drop_out', 'not_certified', 'service_not_required']);

export function inMonth(t, monthKey) {
  const s = startOfMonth(monthKey);
  const e = endOfMonth(monthKey);
  // Listed in every month its training touches: DOJ → TCD / LWD / exit date (Resigned in Oct after joining in Aug:
  // Aug, Sep and Oct). An exit without a date (e.g. DOJ Revised, Offer Revoked) is only listed in the DOJ month.
  const ps = periodsOf(t);
  if (notJoining(t) && !ps[ps.length - 1]?.end) return t.joining_date >= s && t.joining_date <= e;
  return ps.some((p) => {
    const last = p.end ? (p.reason === 'handover' ? handoverDayOf(p.end) : p.end) : null;
    return p.start <= e && (!last || last >= s);
  });
}

/**
 * One row per trainee. Week offs are shown for the whole
 * month (matching the HR sheet); attendance only between DOJ and TCD / LWD.
 */
// Contact Details lookup (like a VLOOKUP): official email, then personal email.
// Without an email match: the same name AND the same DOJ (±3 days) is a sure match (e.g. a second "Tanmay Singh"
// who joined months later gets his own E Code). A name-only match takes the closest DOJ and is flagged for checking.
export function contactLookup(contacts = []) {
  const low = (x) => String(x || '').trim().toLowerCase();
  const nm = (x) => low(x).replace(/[^a-z]/g, '');
  const days = (a, b) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 864e5 : Infinity);
  const byEmail = new Map(); const byName = new Map();
  for (const c of contacts) {
    for (const e of [c.official_email, c.personal_email]) if (low(e)) { const k = low(e); if (!byEmail.has(k) || (byEmail.get(k).active === false && c.active !== false)) byEmail.set(k, c); }
    const n = nm(c.name); if (n) (byName.get(n) || byName.set(n, []).get(n)).push(c);
  }
  return (t) => {
    for (const e of [t.official_email, t.personal_email]) { const hit = low(e) && byEmail.get(low(e)); if (hit) return { contact: hit, via: 'email' }; }
    const list = byName.get(nm(t.name));
    if (!list?.length) return null;
    const sorted = [...list].sort((a, b) => days(a.joining_date, t.joining_date) - days(b.joining_date, t.joining_date));
    if (t.joining_date && days(sorted[0].joining_date, t.joining_date) <= 3) return { contact: sorted[0], via: 'name+doj', same: list.length };
    const best = sorted[0].joining_date ? sorted[0] : (list.find((c) => c.active !== false) || list[0]);
    return { contact: best, via: 'name', same: list.length };
  };
}

export function buildMonthlySheet({ monthKey, trainees, recordsByTrainee, trainerNames = {}, settings, now, contacts = [] }) {
  const days = rangeKeys(startOfMonth(monthKey), endOfMonth(monthKey));
  // A "DOJ revised / offer revoked" row is replaced by the same person's later joining row
  // Attendance a trainer actually marked is ALWAYS on the HR sheet, whatever the trainee's status is now
  // (Resigned, Drop Out, Not Certified…): their marked days stay, from the training start up to the last marked day.
  const marked = (t) => Object.keys(recordsByTrainee[t.id] || {}).filter((k) => k >= days[0] && k <= days[days.length - 1]).sort();
  const markedRange = (t) => {
    const ps = periodsOf(t);
    const last = ps[ps.length - 1];
    // Resigned / Drop Out / Not Certified … with an exit date: worked from the start of that period up to the exit date
    if (last && WORKED_EXITS.has(last.reason) && last.end) {
      const ks = marked(t);
      const end = ks.length && ks[ks.length - 1] > last.end ? ks[ks.length - 1] : last.end;
      return { start: last.start, end };
    }
    const ks = marked(t);
    if (!notJoining(t) || !ks.length) return null;
    const start = ps.length ? ps[ps.length - 1].start : t.joining_date;
    return { start: start <= ks[0] ? start : ks[0], end: ks[ks.length - 1] };
  };
  const neverJoined = (t) => notJoining(t) && !marked(t).length;
  const superseded = (t) => neverJoined(t) && trainees.some((o) => o.id !== t.id
    && o.name.trim().toLowerCase() === t.name.trim().toLowerCase() && o.joining_date > t.joining_date);
  const atEnd = (t) => t.exit_reason === 'doj_revised' || t.exit_reason === 'offer_revoked';
  // the same person joining again later (same E Code, official email or name)
  const same = (a, b) => (a.employee_code && b.employee_code && String(a.employee_code) === String(b.employee_code))
    || (a.official_email && b.official_email && a.official_email.toLowerCase() === b.official_email.toLowerCase())
    || a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
  const laterJoin = (t) => trainees.filter((o) => o.id !== t.id && same(o, t) && o.joining_date > t.joining_date && o.exit_reason !== 'doj_revised')
    .sort((a, b) => (a.joining_date < b.joining_date ? -1 : 1))[0];
  const laterRow = (t) => trainees.some((o) => o.id !== t.id && same(o, t) && o.joining_date > t.joining_date); // any later DOJ
  const look = contactLookup(contacts);
  const rows = trainees
    // DOJ revised (once or several times): only the person's LATEST DOJ is shown — earlier revised rows and their attendance are not
    .filter((t) => (inMonth(t, monthKey) || marked(t).length > 0) && !superseded(t) && !(t.exit_reason === 'doj_revised' && laterRow(t)))
    .sort((a, b) => (atEnd(a) !== atEnd(b) ? (atEnd(a) ? 1 : -1)
      : a.joining_date === b.joining_date ? a.name.localeCompare(b.name) : a.joining_date < b.joining_date ? -1 : 1))
    .map((t) => {
      const recs = recordsByTrainee[t.id] || {};
      const range = markedRange(t); // not joining but attendance was marked: these days count
      const onTraining = (k) => (range ? k >= range.start && k <= range.end : traineeActiveOn({ ...t, status: 'active' }, k) || Boolean(recs[k]));
      // handover day → is it the TCD itself (month end) or the day after?
      const handovers = new Map(periodsOf(t).filter((p) => p.reason === 'handover' && p.end).map((p) => [handoverDayOf(p.end), handoverDayOf(p.end) === p.end]));
      const totals = { present: 0, wo: 0, ph: 0, absent: 0, hd: 0, leaves: 0, notFilled: 0 };

      const pres = days.map(() => false); // present days (blank on screen = present; "P" in the Excel file)
      const cells = days.map((k, di) => {
        const rec = recs[k];
        // Week offs count only while the trainee is in training (not before DOJ, not after handover / last day)
        if (handovers.has(k)) {
          if (handovers.get(k)) {
            // TCD on the last day of the month: the TCD itself shows the handover and counts as a worked day
            if (!(rec && rec.status !== 'present')) {
              if (weekOffReason(k, settings)) totals.wo += 1;
              else if (rec || k <= now.date) { totals.present += 1; if (!rec) totals.notFilled += 1; }
              return CELL.HANDOVER;
            }
          } else if (!rec) return CELL.HANDOVER; // the day after the TCD (also on a Sunday / week off): not a training day
        }
        if (!onTraining(k)) return '';
        if (weekOffReason(k, settings)) { totals.wo += 1; return CELL.WO; }
        if (rec) {
          if (rec.status === 'present') { totals.present += 1; pres[di] = true; return ''; } // blank = present (HR format)
          if (rec.status === 'absent') { totals.absent += 1; return CELL.ABSENT; }
          if (rec.status === 'half_day') { totals.hd += 1; return CELL.HALF; }
          if (rec.status === 'holiday') { totals.ph += 1; return CELL.PH; }
        }
        // Not marked: blank and counted as present (only up to today)
        if (k <= now.date) { totals.present += 1; totals.notFilled += 1; pres[di] = true; }
        return '';
      });

      const paid = totals.present + totals.wo + totals.ph + totals.leaves + totals.hd / 2;
      // Remarks only carry the exit type (left, DOJ revised, offer revoked, failed training …).
      // RAG and trainer remarks live in the separate RAG report.
      let remarks = t.exit_reason && t.exit_reason !== 'handover' ? EXIT_LABELS[t.exit_reason] : '';
      if (t.exit_reason === 'doj_revised') { const n = laterJoin(t); if (n) remarks += ` · new DOJ ${fmtSheetDate(n.joining_date)}`; }
      // Emp ID from Contact Details (Active + Left): by email; a name-only match is filled in but flagged for checking
      const c = look(t);
      let code = t.employee_code || '';
      let codeCheck = null;
      if (c && (c.via === 'email' || c.via === 'name+doj') && !code) code = c.contact.employee_code || '';
      if (c && c.via === 'name') {
        if (!code) code = c.contact.employee_code || '';
        const who = `${c.contact.name}${c.contact.employee_code ? `, E Code ${c.contact.employee_code}` : ''}${c.contact.joining_date ? `, DOJ ${fmtSheetDate(c.contact.joining_date)}` : ''}, ${c.contact.employment === 'left' || c.contact.active === false ? 'Left' : 'Active'}`;
        codeCheck = c.same > 1
          ? `Check E Code manually: ${c.same} people named ${c.contact.name} in Contact Details, closest DOJ taken (${who})`
          : `Check E Code manually: name-only match in Contact Details (${who})`;
        remarks = remarks ? `${remarks} · ${codeCheck}` : codeCheck;
      }

      return {
        id: t.id,
        code,
        codeCheck,
        contactStatus: c ? (c.contact.employment === 'left' || c.contact.active === false ? 'Left' : 'Active') : null,
        name: t.name,
        doj: t.joining_date,
        dojLabel: fmtSheetDate(t.joining_date),
        tcd: t.tcd_lwd,
        tcdLabel: tcdLabel(t),
        reportingManager: t.reporting_manager || '',
        trainer: trainerNames[t.trainer_id] || t.trainer_label || '',
        cells,
        pres,
        totals,
        paid,
        remarks,
      };
    });

  return { days, rows, title: `${MONTHS[fromKey(monthKey).getUTCMonth()]} ${fromKey(monthKey).getUTCFullYear()}` };
}

// Cell colours used by both the on-screen preview and the Excel file
export const CELL_STYLE = {
  [CELL.P]: { fill: 'D1FAE5', font: '065F46', tw: 'bg-emerald-50 text-emerald-800' },
  [CELL.WO]: { fill: 'DBEAFE', font: '1E40AF', tw: 'bg-sky-100 text-sky-800' },
  [CELL.PH]: { fill: 'FEF3C7', font: '92400E', tw: 'bg-amber-100 text-amber-800' },
  [CELL.ABSENT]: { fill: 'FECACA', font: '991B1B', tw: 'bg-rose-100 text-rose-800' },
  [CELL.HALF]: { fill: 'FFEDD5', font: '9A3412', tw: 'bg-orange-100 text-orange-800' },
  [CELL.LEAVE]: { fill: 'EDE9FE', font: '5B21B6', tw: 'bg-violet-100 text-violet-800' },
  [CELL.NOT_FILLED]: { fill: 'FEE2E2', font: 'B91C1C', tw: 'bg-red-50 text-red-700' },
  [CELL.HANDOVER]: { fill: 'C7F0D8', font: '14532D', tw: 'bg-green-200 text-green-900' },
};

export const TOTAL_HEADERS = ['Present Days', 'WO', 'Public Holiday', 'Absent', 'HD', 'Leaves', 'Total Paid Days', 'Remarks'];

const monthTab = (monthKey) => { const d = fromKey(monthKey); return `${MONTHS_SHORT[d.getUTCMonth()]}'${String(d.getUTCFullYear()).slice(2)}`; }; // Oct'26
const fileTag = (monthKey) => monthTab(monthKey).replace("'", '_');                                                                     // Oct_26

// one month as one worksheet
// HR template format (Attendance Sheet – Oct'26): P / WO / H / AB / HD / L codes, live COUNTIF totals
const XL_CODE = { [CELL.WO]: 'WO', [CELL.PH]: 'H', [CELL.ABSENT]: 'AB', [CELL.HALF]: 'HD', [CELL.LEAVE]: 'L', [CELL.HANDOVER]: CELL.HANDOVER, [CELL.NOT_FILLED]: '' };
const XL_TOTALS = ['Present Days', 'WO', 'Public Holiday', 'AB', 'HD', 'Leaves', 'Total Paid Days', 'Remarks'];
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const XL_FILL = { WO: 'FFD9D9D9', H: 'FFFFF2CC', AB: 'FFF8CBAD', HD: 'FFFCE4D6', L: 'FFE2EFDA', [CELL.HANDOVER]: 'FFC6EFCE' };

function addMonthTab(wb, sheet, monthKey) {
  const d = fromKey(monthKey);
  const tab = `${MONTHS_SHORT[d.getUTCMonth()]}'${String(d.getUTCFullYear()).slice(2)}`; // Oct'26
  const ws = wb.addWorksheet(tab, { views: [{ state: 'frozen', xSplit: 5, ySplit: 1 }] });
  const asDate = (k) => { const x = fromKey(k); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); };
  const nDays = sheet.days.length;
  const first = 6; const last = 5 + nDays;                       // F … AI for a 31-day month
  const F = colLetter(first); const L = colLetter(last);
  const T = (k) => colLetter(last + 1 + k);                      // AK = Present Days … AR = Remarks (31 days)
  ws.addRow(['E Code', 'E Name', 'DOJ', 'TCD / LWD', 'Reporting manager', ...sheet.days.map(asDate), ...XL_TOTALS]);
  sheet.rows.forEach((r, i) => {
    const n = i + 2;
    const days = r.cells.map((c) => (c === '' ? '' : (XL_CODE[c] ?? c))); // present days stay blank
    const hd = r.totals.hd / 2;
    ws.addRow([
      r.code ? (Number.isFinite(Number(r.code)) ? Number(r.code) : r.code) : 'NA',
      r.name,
      asDate(r.doj),
      r.tcd ? asDate(r.tcd) : r.tcdLabel,
      r.reportingManager,
      ...days.map((v) => (v === '' ? null : v)),
      r.totals.present,                                               // present days are blank, so this is the count itself
      { formula: `COUNTIF(${F}${n}:${L}${n},"WO")`, result: r.totals.wo },
      { formula: `COUNTIF(${F}${n}:${L}${n},"H")`, result: r.totals.ph },
      { formula: `COUNTIF(${F}${n}:${L}${n},"AB")`, result: r.totals.absent },
      { formula: `COUNTIF(${F}${n}:${L}${n},"HD")/2`, result: hd },
      { formula: `COUNTIF(${F}${n}:${L}${n},"L")`, result: r.totals.leaves },
      { formula: `${T(0)}${n}+${T(1)}${n}+${T(2)}${n}+${T(4)}${n}+${T(5)}${n}`, result: r.totals.present + r.totals.wo + r.totals.ph + hd + r.totals.leaves },
      r.remarks || null,
    ]);
  });
  const totalsFrom = last + 1; const remarksCol = last + 8;
  ws.columns.forEach((col, i) => {
    const c = i + 1;
    col.width = c === 1 ? 7 : c === 2 ? 33 : c === 3 ? 10 : c === 4 ? 13 : c === 5 ? 20 : c <= last ? 8 : c === remarksCol ? 30 : 12;
  });
  ws.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      if (c > remarksCol) return;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: rowNumber === 1 || cell.value === CELL.HANDOVER };
      cell.font = { name: c >= first && c <= last && rowNumber > 1 ? 'Arial' : 'Calibri', size: 10 };
      if (rowNumber === 1) {
        const fill = c >= first && c <= last ? 'FFFCE4D6' : c >= totalsFrom && c < remarksCol ? 'FFFFFF00' : 'FFF8CBAD';
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.font = { name: 'Calibri', size: 10, bold: true };
        if (c >= first && c <= last) cell.numFmt = 'd-mmm';
        return;
      }
      if ((c === 3 || c === 4) && cell.value instanceof Date) cell.numFmt = 'd-mmm-yy';
      if (c >= first && c <= last && XL_FILL[cell.value]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_FILL[cell.value] } };
    });
    if (rowNumber > 1 && row.values.some((v) => v === CELL.HANDOVER)) row.height = 40;
  });
  ws.getRow(1).height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: remarksCol } };
  // E Code found only by name in Contact Details: yellow, to be checked manually
  sheet.rows.forEach((r, n) => { if (r.codeCheck) ws.getRow(n + 2).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; });
  return tab;
}

function addLegend(wb) {
  const legend = wb.addWorksheet('Legend');
  legend.addRow(['Code', 'Meaning']);
  [
    ['(blank) in training', 'Present (also a training day not marked, up to today); counted in Present Days'], ['WO', 'Week off (Sunday, 2nd & 4th Saturday) during training'],
    ['H', 'Public holiday'], ['AB', 'Absent'], ['HD', 'Half day (counted as ½ paid day)'], ['L', 'Leave'],
    [CELL.HANDOVER, 'The day after the TCD (even on a week off); on the TCD itself when it is the last day of the month'],
    ['(blank) outside training', 'Before DOJ, after TCD / LWD, or a future day: not counted'],
    ['E Code in yellow', 'Found only by name in Contact Details: check it manually (see Remarks)'],
    ['NA', 'No E Code found'],
    ['Total Paid Days', 'Present + WO + Public Holiday + HD (½ each) + Leaves'],
  ].forEach(([code, meaning]) => {
    const row = legend.addRow([code, meaning]);
    const f = XL_FILL[code] || (code === 'E Code in yellow' ? 'FFFFFF00' : null);
    if (f) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } };
  });
  legend.getRow(1).font = { bold: true };
  legend.getColumn(1).width = 32;
  legend.getColumn(2).width = 80;
}

async function saveWorkbook(wb, fileName) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


export async function downloadMonthlySheetXlsx(sheet, monthKey) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Trainer Attendance';
  wb.created = new Date();
  const tab = addMonthTab(wb, sheet, monthKey);
  addLegend(wb);
  await saveWorkbook(wb, `Attendance_Sheet_-_${fileTag(monthKey)}.xlsx`);
}

// Several months in one file: a Summary tab (paid days per month), then one tab per month, then the legend
export async function downloadMonthsXlsx(months) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Trainer Attendance';
  wb.created = new Date();
  const tabs = months.map((m) => monthTab(m.monthKey));
  const sum = wb.addWorksheet('Summary', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const people = new Map();
  months.forEach((m, i) => m.sheet.rows.forEach((r) => {
    const key = r.id || `${r.code}|${r.name}`;
    const p = people.get(key) || { code: r.code, name: r.name, rm: r.reportingManager, paid: Array(months.length).fill(null), present: 0, absent: 0, hd: 0 };
    p.paid[i] = r.paid; p.present += r.totals.present; p.absent += r.totals.absent; p.hd += r.totals.hd;
    people.set(key, p);
  }));
  const head = ['E Code', 'E Name', 'Reporting manager', ...tabs.map((t) => `Paid days ${t}`), 'Total paid days', 'Present (all months)', 'Absent (all months)', 'HD (all months)'];
  sum.addRow(head);
  [...people.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((p) => {
    const total = p.paid.reduce((a, v) => a + (v || 0), 0);
    sum.addRow([p.code ? (Number.isFinite(Number(p.code)) ? Number(p.code) : p.code) : '', p.name, p.rm, ...p.paid.map((v) => (v == null ? '' : v)), total, p.present, p.absent, p.hd]);
  });
  sum.columns.forEach((col, i) => { col.width = i === 1 ? 34 : i === 2 ? 24 : 14; });
  sum.getRow(1).eachCell((cell) => { cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2750' } }; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  sum.getRow(1).height = 30;
  sum.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
  months.forEach((m) => addMonthTab(wb, m.sheet, m.monthKey));
  addLegend(wb);
  await saveWorkbook(wb, `Attendance_Sheet_-_${fileTag(months[0].monthKey)}_to_${fileTag(months[months.length - 1].monthKey)}.xlsx`);
}

// Generic table → .xlsx (used by Attendance History)
export async function downloadTableXlsx({ headers, rows, filename, sheetName = 'Attendance' }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2750' } };
  });
  ws.columns.forEach((col, i) => {
    const longest = Math.max(String(headers[i] || '').length, ...rows.map((r) => String(r[i] ?? '').length));
    col.width = Math.min(40, Math.max(10, longest + 2));
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
