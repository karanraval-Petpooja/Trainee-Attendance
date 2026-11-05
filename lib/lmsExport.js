// Trainees → the LMS "user import" file (Data + Instructions sheets, exactly like the LMS team's template).
// Rules: values come from Contact Details first, then from the trainee's own record. "Manages Departments" and
// "Joining Date" are always left blank. Anything unknown (for example an Employee Code) is left blank, never guessed.
import { LMS_HEADERS, LMS_INSTRUCTIONS, LMS_MAX_ROWS } from '@/lib/lmsTemplate';
import { nameKey } from '@/lib/feedbackSheet';
import { isRetraining, notJoining, periodsOf, sentToFloor, traineeActiveOn } from '@/lib/status';

// Who needs a NEW LMS account? Only people in their FIRST training.
//   new          → in training now, first time                          (listed)
//   upcoming     → joins in the future, not started yet                 (hidden unless asked for)
//   reassessment → failed once and is training again, or did before     (hidden: already in the LMS)
//   completed    → trainer sent them to the floor / handed over         (hidden: not needed)
//   other        → removed, inactive, never joined, resigned, not certified, trainer switched… (never listed)
export function lmsStage(t, today) {
  if (!t || t.deleted_at || t.status !== 'active' || notJoining(t)) return 'other';
  const ps = periodsOf(t);
  if (sentToFloor(t) || t.exit_reason === 'handover' || ps.some((p) => p.reason === 'handover')) return 'completed';
  if (isRetraining(t) || ps.some((p) => p.reason === 'retraining')) return 'reassessment';
  if (traineeActiveOn(t, today)) return 'new';
  const first = ps[0];
  if (first && first.start > today && !first.end) return 'upcoming';
  return 'other';
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const lower = (v) => clean(v).toLowerCase();
export const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// "ABHISHEK KUMAR" / "abhishek kumar" → "Abhishek Kumar"; a name already in normal case is left alone
const properCase = (s) => {
  const t = clean(s);
  if (!t || (t !== t.toUpperCase() && t !== t.toLowerCase())) return t;
  return t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
};
const TITLE = /^(mr|mrs|ms|miss|dr|shri|smt)\.?$/i;
// First word = First Name, everything after it = Last Name. One word only → no Last Name (the LMS requires one).
export function splitName(full) {
  const parts = clean(full).split(' ').filter(Boolean);
  while (parts.length > 1 && TITLE.test(parts[0])) parts.shift();
  return { first: properCase(parts[0] || ''), last: properCase(parts.slice(1).join(' ')) };
}

// 10 digits when we can tell (98765 43210, +91 98765 43210, 098765 43210); anything else is left as typed
export function cleanPhone(v) {
  const raw = clean(v);
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.length === 10 ? d : raw;
}

// Contact Details lookups. Active people win over people who left.
export function buildContactIndex(contacts) {
  const byEmail = new Map(); const byCode = new Map(); const byName = new Map();
  const prefer = (map, key, c) => { if (!key) return; const old = map.get(key); if (!old || (old.active === false && c.active !== false)) map.set(key, c); };
  contacts.forEach((c) => {
    prefer(byEmail, lower(c.official_email), c); prefer(byEmail, lower(c.personal_email), c); prefer(byCode, lower(c.employee_code), c);
    const k = nameKey(c.name); if (k) byName.set(k, [...(byName.get(k) || []), c]);
  });
  return { byEmail, byCode, byName };
}
// E Code, then email (official or personal), then the full name, only when ONE person has that name
export function findContact(t, idx) {
  const code = idx.byCode.get(lower(t.employee_code)); if (code) return { contact: code, via: 'E Code' };
  for (const e of [lower(t.official_email), lower(t.personal_email)]) { const c = e && idx.byEmail.get(e); if (c) return { contact: c, via: 'email' }; }
  const list = idx.byName.get(nameKey(t.name)) || [];
  const live = list.filter((c) => c.active !== false);
  if (list.length === 1) return { contact: list[0], via: 'name' };
  if (live.length === 1) return { contact: live[0], via: 'name' };
  return { contact: null, via: '' };
}

export function buildRow(t, contact, via = '') {
  const nm = splitName(contact?.name || t.name);
  return {
    id: t.id, matched: Boolean(contact), via,
    code: clean(contact?.employee_code || t.employee_code),
    email: lower(contact?.official_email || t.official_email),          // the LMS wants the WORK email: personal is never used
    first: nm.first, last: nm.last,
    phone: cleanPhone(contact?.phone || t.phone),
    department: clean(contact?.department), designation: clean(contact?.designation),
  };
}

// Missing / wrong mandatory details of one row (the template's Required = Yes columns)
export function problemsOf(r, roles) {
  const p = [];
  if (!r.email) p.push('Email'); else if (!EMAIL_OK.test(r.email)) p.push('Email is not valid');
  if (!r.first) p.push('First Name');
  if (!r.last) p.push('Last Name');
  if (!clean(roles)) p.push('Roles');
  return p;
}
// Email and Employee Code must be unique in the file: every row that repeats one gets a problem
export function duplicateProblems(rows) {
  const out = new Map();
  const mark = (key, label) => {
    const seen = new Map();
    rows.forEach((r) => { const k = lower(r[key]); if (k) seen.set(k, [...(seen.get(k) || []), r.id]); });
    seen.forEach((ids) => { if (ids.length > 1) ids.forEach((id) => out.set(id, [...(out.get(id) || []), label])); });
  };
  mark('email', 'Email is repeated'); mark('code', 'Employee Code is repeated');
  return out;
}

// The row as the template wants it: Employee Code | Email | First Name | Last Name | Phone | Department | Designation | Roles | Manages Departments | Joining Date
// (null = a truly empty cell, which is what an importer treats as "not given")
export const toLine = (r, roles) => [r.code || null, r.email || null, r.first || null, r.last || null, /^\d{10}$/.test(r.phone) ? Number(r.phone) : r.phone || null, r.department || null, r.designation || null, clean(roles) || null, null, null];

export async function buildLmsWorkbook(rows, roles) {
  if (rows.length > LMS_MAX_ROWS) throw new Error(`The LMS accepts at most ${LMS_MAX_ROWS} rows in one upload.`);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(LMS_HEADERS);
  rows.forEach((r) => ws.addRow(toLine(r, roles)));
  ws.getRow(1).height = 22.05;
  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC52031' } };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
  });
  [18, 32, 18, 18, 20, 24, 22, 16, 28, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(1).numFmt = '@'; // an Employee Code keeps its leading zeros
  const ins = wb.addWorksheet('Instructions');
  LMS_INSTRUCTIONS.forEach((r) => ins.addRow(r));
  ins.getRow(1).font = { name: 'Calibri', size: 11, bold: true };
  [22, 12, 28, 70].forEach((w, i) => { ins.getColumn(i + 1).width = w; });
  return wb;
}

export async function downloadLmsFile(rows, roles, filename) {
  const wb = await buildLmsWorkbook(rows, roles);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
