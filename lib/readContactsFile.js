// Read a Contact Details file (.xlsx or .csv) in the browser → { header, rows } as the sheet shows them.
import { isContactsSheet } from './contacts';

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const text = (cell) => {
  const v = cell?.value;
  const x = v && typeof v === 'object' && 'result' in v ? v.result : v;
  if (x === null || x === undefined) return '';
  if (x instanceof Date) return `${pad(x.getUTCDate())}-${M[x.getUTCMonth()]}-${x.getUTCFullYear()}`;
  if (typeof x === 'object') {
    if (x.richText) return x.richText.map((t) => t.text).join('');
    if ('text' in x) return String(x.text);
    if (x.error) return '';
  }
  if (typeof x === 'number' && Number.isInteger(x)) return String(x);
  return String(x).replace(/[\t\r\n]+/g, ' ').trim();
};

function splitCsv(src) {
  const out = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (q) { if (ch === '"' && src[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

const pickHeader = (rows) => {
  const i = rows.slice(0, 10).findIndex((r) => isContactsSheet(r));
  if (i < 0) throw new Error('No heading row with "Name" and "Department" was found in the first 10 rows.');
  return { header: rows[i], rows: rows.slice(i + 1).filter((r) => r.some((c) => String(c).trim())) };
};

export async function readContactsFile(file) {
  if (/\.(csv|txt|tsv)$/i.test(file.name)) return { sheetName: file.name, ...pickHeader(splitCsv(await file.text())) };
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      for (let c = 1; c <= ws.columnCount; c += 1) cells.push(text(row.getCell(c)));
      rows.push(cells);
    });
    try { return { sheetName: ws.name, ...pickHeader(rows) }; } catch { /* try the next tab */ }
  }
  throw new Error('No tab with the headings "Name" and "Department" was found in this file.');
}
export const pasteToRows = (src) => pickHeader(splitCsv(src));
