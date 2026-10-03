// Monthly attendance sheet in the HR format:
// E Code | E Name | DOJ | TCD / LWD | Reporting manager | 01..31 | Present Days | WO |
// Public Holiday | Absent | HD | Leaves | Total Paid Days | Remarks
import { addDays, endOfMonth, fromKey, MONTHS, MONTHS_SHORT, pad, rangeKeys, startOfMonth } from './dates';
import { EXIT_LABELS, handoverDates, periodsOf, traineeActiveOn, weekOffReason } from './status';

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
  if (t.tcd_lwd) return fmtSheetDate(t.tcd_lwd);
  if ((t.exit_reason === 'doj_revised' || t.exit_reason === 'offer_revoked') && !t.tcd_lwd) return EXIT_LABELS[t.exit_reason];
  return 'In Training';
}

// Who belongs on a month's sheet: any training period (or its handover day) overlaps the month
export function inMonth(t, monthKey) {
  const s = startOfMonth(monthKey);
  const e = endOfMonth(monthKey);
  // Never joined (DOJ revised / offer revoked without a last working day): only in the DOJ month
  if ((t.exit_reason === 'doj_revised' || t.exit_reason === 'offer_revoked') && !t.tcd_lwd) return t.joining_date >= s && t.joining_date <= e;
  return periodsOf(t).some((p) => {
    const last = p.end ? (p.reason === 'handover' ? addDays(p.end, 1) : p.end) : null;
    return p.start <= e && (!last || last >= s);
  });
}

/**
 * One row per trainee. Week offs are shown for the whole
 * month (matching the HR sheet); attendance only between DOJ and TCD / LWD.
 */
export function buildMonthlySheet({ monthKey, trainees, recordsByTrainee, trainerNames = {}, settings, now }) {
  const days = rangeKeys(startOfMonth(monthKey), endOfMonth(monthKey));
  // A "DOJ revised / offer revoked" row is replaced by the same person's later joining row
  const neverJoined = (t) => (t.exit_reason === 'doj_revised' || t.exit_reason === 'offer_revoked') && !t.tcd_lwd;
  const superseded = (t) => neverJoined(t) && trainees.some((o) => o.id !== t.id
    && o.name.trim().toLowerCase() === t.name.trim().toLowerCase() && o.joining_date > t.joining_date);
  const rows = trainees
    .filter((t) => inMonth(t, monthKey) && !superseded(t))
    .sort((a, b) => (a.joining_date === b.joining_date ? a.name.localeCompare(b.name) : a.joining_date < b.joining_date ? -1 : 1))
    .map((t) => {
      const recs = recordsByTrainee[t.id] || {};
      const handovers = new Set(handoverDates(t));
      const totals = { present: 0, wo: 0, ph: 0, absent: 0, hd: 0, leaves: 0, notFilled: 0 };

      const cells = days.map((k) => {
        const rec = recs[k];
        if (handovers.has(k) && !traineeActiveOn(t, k)) return CELL.HANDOVER;
        if (weekOffReason(k, settings)) { totals.wo += 1; return CELL.WO; }

        if (!traineeActiveOn({ ...t, status: 'active' }, k)) return '';
        if (rec) {
          if (rec.status === 'present') { totals.present += 1; return CELL.P; }
          if (rec.status === 'absent') { totals.absent += 1; return CELL.ABSENT; }
          if (rec.status === 'half_day') { totals.hd += 1; return CELL.HALF; }
          if (rec.status === 'holiday') { totals.ph += 1; return CELL.PH; }
        }
        const pastDeadline = k < now.date || (k === now.date && now.time > settings.attendance_deadline);
        if (pastDeadline) { totals.notFilled += 1; return CELL.NOT_FILLED; }
        return '';
      });

      const paid = totals.present + totals.wo + totals.ph + totals.leaves + totals.hd / 2;
      // Remarks only carry the exit type (left, DOJ revised, offer revoked, failed training …).
      // RAG and trainer remarks live in the separate RAG report.
      const remarks = t.exit_reason && t.exit_reason !== 'handover' ? EXIT_LABELS[t.exit_reason] : '';

      return {
        id: t.id,
        code: t.employee_code || '',
        name: t.name,
        doj: t.joining_date,
        dojLabel: fmtSheetDate(t.joining_date),
        tcd: t.tcd_lwd,
        tcdLabel: tcdLabel(t),
        reportingManager: t.reporting_manager || '',
        trainer: trainerNames[t.trainer_id] || '',
        cells,
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

export async function downloadMonthlySheetXlsx(sheet, monthKey) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Trainer Attendance';
  wb.created = new Date();
  const d = fromKey(monthKey);
  const tab = `${MONTHS_SHORT[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
  const ws = wb.addWorksheet(tab, { views: [{ state: 'frozen', xSplit: 5, ySplit: 1 }] });

  const header = ['E Code', 'E Name', 'DOJ', 'TCD / LWD', 'Reporting manager', ...sheet.days.map(fmtDayHeader), ...TOTAL_HEADERS];
  ws.addRow(header);

  const asDate = (k) => { const x = fromKey(k); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); };
  sheet.rows.forEach((r) => {
    ws.addRow([
      r.code ? (Number.isFinite(Number(r.code)) ? Number(r.code) : r.code) : '',
      r.name,
      asDate(r.doj),
      r.tcd ? asDate(r.tcd) : r.tcdLabel,
      r.reportingManager,
      ...r.cells,
      r.totals.present, r.totals.wo, r.totals.ph, r.totals.absent, r.totals.hd, r.totals.leaves, r.paid,
      r.remarks,
    ]);
  });

  const firstDay = 6;
  const lastDay = 5 + sheet.days.length;
  const border = { style: 'thin', color: { argb: 'FFD9DEE8' } };

  ws.columns.forEach((col, i) => {
    const c = i + 1;
    col.width = c === 1 ? 9 : c === 2 ? 34 : c <= 4 ? 13 : c === 5 ? 24 : c <= lastDay ? 9 : c === header.length ? 22 : 11;
  });

  ws.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 30 : 20;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.alignment = { vertical: 'middle', horizontal: c === 2 || c === 5 || c === header.length ? 'left' : 'center', wrapText: rowNumber === 1 };
      cell.font = { name: 'Calibri', size: 10 };
      if (rowNumber === 1) {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c >= firstDay && c <= lastDay ? 'FF34437A' : 'FF1D2750' } };
        return;
      }
      if ((c === 3 || c === 4) && cell.value instanceof Date) cell.numFmt = 'dd-mmm-yy';
      if (c >= firstDay && c <= lastDay) {
        const st = CELL_STYLE[cell.value];
        if (st) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${st.fill}` } };
          cell.font = { name: 'Calibri', size: 10, color: { argb: `FF${st.font}` }, bold: cell.value !== CELL.P };
          if (cell.value === CELL.HANDOVER) cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        }
      }
      if (c === lastDay + 7) cell.font = { name: 'Calibri', size: 10, bold: true };
    });
    if (rowNumber > 1 && row.values.some((v) => v === CELL.HANDOVER)) row.height = 30;
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };

  const legend = wb.addWorksheet('Legend');
  legend.addRow(['Code', 'Meaning']);
  [
    [CELL.P, 'Present'], [CELL.WO, 'Week off (Sunday, 2nd & 4th Saturday)'], [CELL.PH, 'Holiday (marked by the trainer)'],
    [CELL.ABSENT, 'Absent'], [CELL.HALF, 'Half day (counted as 0.5 paid day)'],
    [CELL.NOT_FILLED, 'Trainer did not mark attendance by the deadline (unpaid)'], [CELL.HANDOVER, 'Handed over to the reporting manager (day after TCD)'],
    ['(blank)', 'Before DOJ, after TCD / LWD, or not yet due'],
    ['Total Paid Days', 'Present + WO + Public Holiday + Leaves + ½ × HD'],
  ].forEach(([code, meaning]) => {
    const row = legend.addRow([code, meaning]);
    const st = CELL_STYLE[code];
    if (st) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${st.fill}` } };
  });
  legend.getRow(1).font = { bold: true };
  legend.getColumn(1).width = 30;
  legend.getColumn(2).width = 55;

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Trainee_Attendance_${tab}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
