// Read a downloaded Dossier workbook (.xlsx) → text rows + row colours for parseDossier.
// Works in the browser (file upload) and in Node. Picks the first sheet whose heading row
// has "Name", "DOJ" and "Day 1".
import { MONTHS_SHORT, pad } from './dates';

const cellText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result);
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return String(v.text);
    if (v.error) return '';
  }
  return String(v).replace(/[\t\r\n]+/g, ' ').trim();
};
const dojText = (v) => {
  const x = v && typeof v === 'object' && 'result' in v ? v.result : v;
  if (x instanceof Date) return `${pad(x.getUTCDate())}-${MONTHS_SHORT[x.getUTCMonth()]}-${String(x.getUTCFullYear()).slice(2)}`;
  return cellText(x);
};
const fillOf = (cell) => {
  const f = cell.fill;
  if (!f || f.type !== 'pattern' || !f.fgColor) return '';
  return f.fgColor.argb ? `#${f.fgColor.argb.slice(-6)}` : '';
};

// A date cell written the way the sheet displays it (same as Google's display values):
// "d/mmm" → "15-Apr" (no year), "mm/dd/yyyy" → "04/03/2023", otherwise dd/mm/yyyy
const shownDate = (v, fmt) => {
  const f = String(fmt || '').toLowerCase();
  if (f.includes('mmm') && !f.includes('y')) return `${pad(v.getUTCDate())}-${MONTHS_SHORT[v.getUTCMonth()]}`;
  const g = f.replace(/\[[^\]]*\]/g, ''); // drop locale tags like [$-409]
  if (g.includes('d') && g.includes('m') && g.indexOf('m') < g.indexOf('d')) return `${pad(v.getUTCMonth() + 1)}/${pad(v.getUTCDate())}/${v.getUTCFullYear()}`;
  return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
};
const shownText = (cell) => {
  const v = cell.value;
  const x = v && typeof v === 'object' && 'result' in v ? v.result : v;
  if (x instanceof Date) return shownDate(x, cell.numFmt);
  if (typeof x === 'number' && Number.isInteger(x)) return String(x);
  return cellText(v);
};

export async function readDossierXlsx(buffer) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const headOf = (s) => (s.getRow(1).values || []).map((x) => cellText(x).toLowerCase());
  const ws = wb.worksheets.find((s) => { const h = headOf(s); return h.includes('name') && h.includes('doj') && h.includes('day 1'); });
  if (!ws) {
    // Dossier Sheet with headings (DOJ, Emp Id, Name, Trainer Name, Training Status …): read by heading
    const fits = (sh) => { const h = headOf(sh); return h.includes('name') && h.includes('doj') && (h.includes('training status') || h.includes('trainer name')); };
    // a workbook can have many tabs (Pivot, KPI, Training Calendar…): prefer the one called "Dossier Sheet"
    const hs = wb.worksheets.find((sh) => /dossier/i.test(sh.name) && fits(sh)) || wb.worksheets.find(fits);
    if (!hs) throw new Error('No Dossier sheet was found in this file (needs the headings Name and DOJ, plus Day 1 or Training Status).');
    const head = (hs.getRow(1).values || []).map((x) => cellText(x));
    const width = Math.max(1, head.length - 1);
    // Columns whose dates were typed as text (e.g. "17-04-2023") keep the shown text for every cell;
    // in all other columns a real date WITH a year is taken as it really is (ISO), whatever its display format
    // (mm-dd-yy, m/d/yyyy, dd/mm/yyyy…). Year-less dates ("19-Mar") keep the shown text: the year comes from the batch.
    const raw = [];
    let blanks = 0;
    for (let n = 1; n <= hs.rowCount && blanks < 200; n += 1) {
      const row = hs.getRow(n);
      const cells = [];
      for (let c = 1; c <= width; c += 1) cells.push(row.getCell(c));
      if (n > 1 && !cells.some((cell) => shownText(cell))) { blanks += 1; continue; }
      blanks = 0;
      raw.push(cells);
    }
    const valueOf = (cell) => { const v = cell.value; return v && typeof v === 'object' && 'result' in v ? v.result : v; };
    const typedDates = new Set();
    raw.slice(1).forEach((cells) => cells.forEach((cell, c) => {
      const v = valueOf(cell);
      if (typeof v === 'string' && /^\s*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s*$/.test(v)) typedDates.add(c);
    }));
    const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const lines = raw.map((cells, i) => cells.map((cell, c) => {
      const v = valueOf(cell);
      const fmt = String(cell.numFmt || '').toLowerCase();
      const yearless = fmt.includes('m') && fmt.includes('d') && !fmt.includes('y');
      if (i > 0 && v instanceof Date && !typedDates.has(c) && !yearless) return iso(v);
      return shownText(cell).replace(/[\t\r\n]+/g, ' ');
    }).join('\t'));
    return { sheetName: hs.name, text: lines.join('\n'), colors: [], headed: true };
  }
  const width = ws.columnCount;
  const lines = [];
  const colors = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const name = cellText(row.getCell(5).value);
    if (!name) return;
    const cells = [];
    for (let c = 1; c <= width; c += 1) cells.push(c === 2 ? dojText(row.getCell(c).value) : cellText(row.getCell(c).value));
    lines.push(cells.join('\t'));
    colors.push(fillOf(row.getCell(5)));
  });
  return { sheetName: ws.name, text: lines.join('\n'), colors };
}
