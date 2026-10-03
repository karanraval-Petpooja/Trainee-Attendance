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

export async function readDossierXlsx(buffer) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((s) => {
    const head = (s.getRow(1).values || []).map((x) => cellText(x).toLowerCase());
    return head.includes('name') && head.includes('doj') && head.includes('day 1');
  });
  if (!ws) throw new Error('No sheet with the Dossier headings (Name, DOJ, Day 1) was found in this file.');
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
