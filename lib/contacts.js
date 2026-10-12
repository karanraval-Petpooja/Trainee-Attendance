// Contact Details sheet → contacts (employee list with departments).
// Columns are found by their headings, so the column order in the sheet does not matter.
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const FIELDS = {
  name: ['name', 'employee name', 'emp name', 'full name', 'e name', 'ename', 'employee full name'],
  employee_code: ['e code', 'emp id', 'employee code', 'employee id', 'emp code', 'ecode', 'emp no', 'employee no', 'code'],
  official_email: ['official email', 'official email id', 'company email', 'work email', 'office email', 'official mail id', 'email', 'email id', 'mail id'],
  personal_email: ['personal email', 'personal email id', 'personal mail id'],
  department: ['department', 'dept', 'department name', 'team', 'sub department', 'function'],
  designation: ['designation', 'role', 'position'],
  location: ['location', 'city', 'base location', 'work location'],
  phone: ['mobile', 'mobile no', 'mobile number', 'phone', 'phone number', 'contact', 'contact no', 'contact number', 'number'],
  reporting_manager: ['reporting manager', 'reporting authority', 'manager', 'reporting to'],
  status: ['status', 'employee status', 'emp status'],
};
export function contactColumns(header) {
  const heads = (header || []).map(norm);
  const col = {};
  Object.entries(FIELDS).forEach(([f, names]) => {
    let i = -1;
    for (const n of names) { i = heads.indexOf(n); if (i >= 0) break; } // names are in order of preference
    if (i < 0) i = heads.findIndex((h) => h && names.some((n) => n.length > 3 && h.includes(n)));
    col[f] = i;
  });
  // "Email" alone may be picked for both: keep personal separate
  if (col.personal_email >= 0 && col.official_email === col.personal_email) col.official_email = heads.findIndex((h, i) => i !== col.personal_email && /email|mail/.test(h));
  return col;
}
export const isContactsSheet = (header) => { const c = contactColumns(header); return c.name >= 0 && c.department >= 0; };

const INACTIVE = /resign|left|inactive|terminat|abscond|exit|separated/i;
export function parseContacts(header, rows) {
  const col = contactColumns(header);
  const errors = [];
  if (col.name < 0) errors.push('No "Name" column found.');
  if (col.department < 0) errors.push('No "Department" column found.');
  if (errors.length) return { contacts: [], errors };
  const get = (r, i) => (i >= 0 ? String(r[i] ?? '').replace(/\s+/g, ' ').trim() : '');
  const seen = new Set();
  const contacts = [];
  rows.forEach((r) => {
    const name = get(r, col.name);
    if (!name) return;
    const email = get(r, col.official_email).toLowerCase();
    const code = get(r, col.employee_code).replace(/\.0$/, '');
    const key = code || email || `${name.toLowerCase()}|${get(r, col.department).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({
      name,
      employee_code: /^[A-Za-z0-9-]{1,12}$/.test(code) ? code : null,
      official_email: email.includes('@') ? email : null,
      personal_email: get(r, col.personal_email).toLowerCase() || null,
      phone: get(r, col.phone) || null,
      department: get(r, col.department) || null,
      designation: get(r, col.designation) || null,
      location: get(r, col.location) || null,
      reporting_manager: get(r, col.reporting_manager) || null,
      active: !INACTIVE.test(get(r, col.status)),
    });
  });
  return { contacts, errors };
}

// Save contacts: update by E Code, else by official email, else insert.
export async function saveContacts(client, contacts, { runId } = {}) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('contacts').select('id, employee_code, official_email').range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const byCode = new Map(all.filter((c) => c.employee_code).map((c) => [c.employee_code, c.id]));
  const byEmail = new Map(all.filter((c) => c.official_email).map((c) => [c.official_email.toLowerCase(), c.id]));
  const now = new Date().toISOString();
  const updates = []; const inserts = [];
  contacts.forEach((c) => {
    const id = (c.employee_code && byCode.get(c.employee_code)) || (c.official_email && byEmail.get(c.official_email));
    const row = { ...c, updated_at: now, ...(runId ? { last_seen_run: runId } : {}) };
    if (id) updates.push({ id, ...row }); else inserts.push(row);
  });
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await client.from('contacts').insert(inserts.slice(i, i + 500));
    if (error) throw error;
  }
  for (let i = 0; i < updates.length; i += 500) {
    const { error } = await client.from('contacts').upsert(updates.slice(i, i + 500));
    if (error) throw error;
  }
  return { added: inserts.length, updated: updates.length };
}

// Match a Meet participant to a contact: email first, then the name (word order ignored)
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
export function contactMatcher(participants) {
  const emails = new Set(participants.map((p) => (p.email || '').toLowerCase()).filter(Boolean));
  const names = new Set(participants.map((p) => nameKey(p.full_name)).filter(Boolean));
  return (c) => (c.official_email && emails.has(c.official_email.toLowerCase()))
    || (c.personal_email && emails.has(c.personal_email.toLowerCase()))
    || names.has(nameKey(c.name));
}
// People of the picked department(s) who are not in the Meet file → Absent, "Not attended"
export function addNotAttended(participants, contacts, departments, { withScores } = {}) {
  const picked = new Set((departments || []).map((d) => d.toLowerCase()));
  if (!picked.size) return participants;
  const inDept = contacts.filter((c) => c.active && c.department && picked.has(c.department.toLowerCase()));
  const byEmail = new Map(inDept.filter((c) => c.official_email).map((c) => [c.official_email.toLowerCase(), c]));
  const byName = new Map(inDept.map((c) => [nameKey(c.name), c]));
  // fill code / department for those who did attend
  const attended = participants.map((p) => {
    const c = byEmail.get((p.email || '').toLowerCase()) || byName.get(nameKey(p.full_name));
    return c ? { ...p, employee_code: p.employee_code || c.employee_code || null, department: c.department } : p;
  });
  const has = contactMatcher(participants);
  const missing = inDept.filter((c) => !has(c)).map((c) => ({
    full_name: c.name, email: c.official_email || c.personal_email || null, duration_minutes: null,
    time_joined: null, time_exited: null, attendance: 'A', score: null, total: null,
    result: withScores ? 'Absent' : null, not_attended: true, employee_code: c.employee_code || null, department: c.department,
  }));
  return [...attended, ...missing];
}
