// Parse rows pasted from Excel / Google Sheets in the HR sheet layout:
// E Code | E Name | DOJ | TCD / LWD | Reporting manager | (… day columns / totals …) | Remarks
import { MONTHS_SHORT, pad } from './dates';

export function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/,]*(\d{2,4})$/);
  if (m) {
    const mi = MONTHS_SHORT.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(mi + 1)}-${pad(+m[1])}`;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // dd/mm/yyyy
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  return null;
}

export function parseTraineeRows(text) {
  const rows = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cols = line.includes('\t') ? line.split('\t') : line.split(',');
    const [code, name, doj, tcd, rm] = cols.map((c) => (c || '').trim());
    if (/^e\s*code$/i.test(code) || /^e\s*name$/i.test(name)) return; // header row
    const remarks = (cols[cols.length - 1] || '').trim().toLowerCase();
    if (!name) { errors.push(`Line ${i + 1}: name is missing`); return; }
    const joining = parseDate(doj);
    if (!joining) { errors.push(`Line ${i + 1} (${name}): DOJ "${doj || ''}" is not a date`); return; }

    let tcdDate = parseDate(tcd);
    let exit = null;
    const t = (tcd || '').toLowerCase();
    if (t.includes('doj revised') || remarks.includes('doj revised')) { exit = 'doj_revised'; tcdDate = null; }
    else if (t.includes('offer revoked') || remarks.includes('offer revoked')) { exit = 'offer_revoked'; tcdDate = null; }
    else if (tcdDate) {
      exit = remarks.includes('resign') ? 'resigned' : remarks.includes('not certified') ? 'not_certified' : 'handover';
    }
    rows.push({
      employee_code: code && !/^#/.test(code) ? code : null,
      name,
      joining_date: joining,
      tcd_lwd: tcdDate,
      exit_reason: exit,
      reporting_manager: rm || null,
    });
  });
  return { rows, errors };
}
