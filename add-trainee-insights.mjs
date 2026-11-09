// Adds "Trainee insights" to the manager dashboard. Run once from the project folder (the one with package.json):
//     node add-trainee-insights.mjs
// It checks both places first and changes NOTHING if one cannot be found. Safe to run twice.
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'components', 'dashboards', 'ManagerDashboard.jsx');
if (!fs.existsSync(file)) { console.error('Run this from the project folder: components/dashboards/ManagerDashboard.jsx was not found here.'); process.exit(1); }
if (!fs.existsSync(path.join(process.cwd(), 'components', 'dashboards', 'TraineeInsights.jsx'))) { console.error('components/dashboards/TraineeInsights.jsx is missing. Extract trainee-insights.zip into the project first.'); process.exit(1); }

let src = fs.readFileSync(file, 'utf8');
if (src.includes('TraineeInsights')) { console.log('The manager dashboard already has Trainee insights. Nothing to change.'); process.exit(0); }

const eol = src.includes('\r\n') ? '\r\n' : '\n';
const importRe = /^import \{[^}]*\} from '\.\.\/ui';\r?$/m;                          // the line that imports from '../ui'
const endRe = /(\r?\n)([ \t]*)<\/div>(\r?\n)([ \t]*)\);(\r?\n)\}\s*$/;                // the end of the page: </div> );  }
if (src.split('\n').filter((l) => importRe.test(l)).length !== 1) { console.error("STOPPED, nothing was changed. Could not find the import from '../ui' exactly once."); process.exit(1); }
if (!endRe.test(src)) { console.error('STOPPED, nothing was changed. Could not find the end of the dashboard page.'); process.exit(1); }

src = src.replace(importRe, (m) => `${m.replace(/\r$/, '')}${eol}import TraineeInsights from './TraineeInsights';${m.endsWith('\r') ? '\r' : ''}`);
src = src.replace(endRe, (_, a, ind, b, ind2, c) => `${a}${ind}  <TraineeInsights trainees={trainees} trainers={trainers} today={today} />${a}${ind}</div>${b}${ind2});${c}}${eol}`);
fs.writeFileSync(file, src);
console.log('Done: the manager dashboard now ends with the "Trainee insights" section (2 small changes).');
console.log('Optional check: npm run build. Then git add / commit / push.');
