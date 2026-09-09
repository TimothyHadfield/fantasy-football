// Prints the "Simulate season" panel as rendered, for reading. Not a test --
// it asserts nothing; it exists so a refactor can be proved a no-op by diffing
// its output before against after. See README.md.
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Same boot preamble as fc-dump-child.mjs, up to the import of the page.
const preamble = readFileSync(path.join(HERE, 'fc-dump-child.mjs'), 'utf8')
  .split("await import(pathToFileURL")[0];

const child = preamble + `
await import(pathToFileURL(path.join(REPO, 'js/schedule-page.js')).href);
await new Promise(r => setTimeout(r, 900));
const $ = id => document.getElementById(id);
const t = el => el ? el.textContent.replace(/\\s+/g,' ').trim() : '';
console.log('RUNS   :', Array.from($('simRuns').querySelectorAll('button')).map(b => (b.className.includes('on')?'['+t(b)+']':' '+t(b)+' ')).join(''));
console.log('STATS  :', Array.from($('simStats').querySelectorAll('.stat')).map(s=>t(s)).join('   |   '));
console.log('CAP    :', t($('simCap')));
console.log('CHART  :', $('simChart').querySelectorAll('path.ff-bar').length + ' bars; titles: ' +
  Array.from($('simChart').querySelectorAll('path.ff-bar title')).map(x=>t(x)).join(', '));
console.log('TABLE  :');
for (const tr of $('simTable').querySelectorAll('tbody tr')) {
  console.log('   ', (tr.getAttribute('class')||'').padEnd(10), Array.from(tr.children).map(td=>t(td).padStart(12)).join(''));
}
console.log('NOTE   :');
for (const line of $('simNote').innerHTML.split('<br>')) console.log('    -', line.replace(/<[^>]*>/g,'').replace(/\\s+/g,' ').trim());
console.log('FC EXP :', Array.from($('forecastStats').querySelectorAll('.stat')).map(s=>t(s)).join(' | '));
console.log('FC TEAM:', t($('forecastTitle')));
`;

writeFileSync(path.join(HERE, 'sim-dump-child.mjs'), child);

const cases = [
  ['DEMO (default week)', false, { 'schedule.source': 'demo' }, null],
  ['DEMO (from week 5)', false, { 'schedule.source': 'demo', 'schedule.week': 5 }, null],
  ['LIVE (week 2 of 13)', true, { 'schedule.source': 'live', 'schedule.week': 'all' }, { leagueId: '99', season: 2026, teamId: 4 }],
];

for (const [label, stub, prefs, conn] of cases) {
  const store = [['ff.prefs', JSON.stringify(prefs)]];
  if (conn) store.push(['ff.connection', JSON.stringify(conn)]);
  const args = stub ? ['--import', './fc-register.mjs', 'sim-dump-child.mjs'] : ['sim-dump-child.mjs'];
  const r = spawnSync(process.execPath, args, {
    cwd: HERE, encoding: 'utf8', env: { ...process.env, FC_STORE: JSON.stringify(store) },
  });
  console.log('\n========== ' + label + ' ==========');
  console.log(r.stdout || '');
  if (r.stderr) console.log('STDERR', r.stderr.slice(0, 1200));
}
