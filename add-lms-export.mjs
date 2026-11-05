// Adds "Export for LMS" inside Trainees & Batches. Run once from the project folder (the one with package.json):
//     node add-lms-export.mjs
// It checks every spot first and changes NOTHING if one cannot be found. Safe to run twice.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tp = path.join(root, 'app', '(app)', 'trainees', 'page.js');
const shell = path.join(root, 'components', 'AppShell.jsx');
const oldPage = path.join(root, 'app', '(app)', 'lms-users');
const panel = path.join(root, 'components', 'trainees', 'LmsExport.jsx');

if (!fs.existsSync(tp)) { console.error('Run this from the project folder: app/(app)/trainees/page.js was not found here.'); process.exit(1); }
if (!fs.existsSync(panel)) { console.error('components/trainees/LmsExport.jsx is missing. Extract lms-export-in-trainees.zip into the project first.'); process.exit(1); }

let src = fs.readFileSync(tp, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const steps = [];

if (src.includes('LmsExportButton')) {
  console.log('Trainees page: already has Export for LMS. Nothing to change there.');
} else {
  const once = (name, anchor, make) => {
    const n = src.split(anchor).length - 1;
    if (n !== 1) { console.error(`STOPPED, nothing was changed. Could not find the place for "${name}" exactly once (found ${n}).`); process.exit(1); }
    steps.push([anchor, make(anchor)]);
  };
  once('import', "import NhtFeedbackShare from '@/components/NhtFeedbackShare';", (a) => `${a}${eol}import LmsExport, { LmsExportButton } from '@/components/trainees/LmsExport';`);
  once('state', 'const [dossier, setDossier] = useState(false);', (a) => `${a}${eol}  const [lmsOpen, setLmsOpen] = useState(false);`);
  once('button', '<button className="btn-secondary" onClick={() => setNewBatch(true)}>', (a) => `<LmsExportButton onClick={() => setLmsOpen(true)} />${eol}            ${a}`);
  once('panel', '{dossier && <DossierImport trainers={trainers} trainees={trainees} onClose={() => setDossier(false)} onDone={(m) => { showToast(m); reload(); }} />}',
    (a) => `${a}${eol}      {lmsOpen && <LmsExport trainees={trainees} batches={batches} trainers={trainers} onClose={() => setLmsOpen(false)} />}`);
  for (const [anchor, replacement] of steps) src = src.replace(anchor, () => replacement);
  fs.writeFileSync(tp, src);
  console.log('Trainees page: added the "Export for LMS" button and panel (4 small changes).');
}

// If the separate menu item / page from the earlier version was added, take it out again
if (fs.existsSync(shell)) {
  let s = fs.readFileSync(shell, 'utf8');
  const before = s;
  s = s.replace(/^[ \t]*\{ href: '\/lms-users', label: 'LMS User Export', icon: UserPlus \},\r?\n/gm, '').replace(/ UserPlus,/, '');
  if (s !== before) { fs.writeFileSync(shell, s); console.log('AppShell.jsx: removed the separate "LMS User Export" menu item.'); }
}
if (fs.existsSync(oldPage)) { fs.rmSync(oldPage, { recursive: true, force: true }); console.log('Removed the old separate page app/(app)/lms-users.'); }
console.log('Done. Now run: npm run build   (optional check), then git add / commit / push.');
