// Prints the forecast panel as rendered, for reading. Not a test -- it
// asserts nothing; it exists so a refactor can be proved a no-op by diffing
// its output before against after. See README.md.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const HERE = path.dirname(self);

if (process.argv[2]) {
  const { boot } = await import('./fc-test.mjs').catch(() => ({}));
  process.exit(0);
}

// Re-use fc-test's boot by importing it as a child with a DUMP env flag is
// messy; instead just run a tiny inline child per scenario.
const child = `
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';
const { window, document } = parseHTML(readFileSync(path.join(REPO, 'schedule.html'), 'utf8'));
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true,
  get(){ const s=this.querySelector('option[selected]')||this.querySelector('option'); return s? (s.getAttribute('value') ?? s.textContent):''; },
  set(v){ for (const o of this.querySelectorAll('option')) { if ((o.getAttribute('value') ?? o.textContent)===String(v)) o.setAttribute('selected',''); else o.removeAttribute('selected'); } } });
const TP = Object.getPrototypeOf(document.createElement('table'));
const kids=(el,t)=> el?Array.from(el.children).filter(c=>c.tagName===t):[];
Object.defineProperty(TP,'tBodies',{configurable:true,get(){return kids(this,'TBODY');}});
Object.defineProperty(TP,'tHead',{configurable:true,get(){return kids(this,'THEAD')[0]||null;}});
Object.defineProperty(TP,'rows',{configurable:true,get(){const h=kids(this,'THEAD')[0];const r=[];if(h)r.push(...kids(h,'TR'));for(const b of kids(this,'TBODY'))r.push(...kids(b,'TR'));return r;}});
const RP = Object.getPrototypeOf(document.createElement('tr'));
Object.defineProperty(RP,'cells',{configurable:true,get(){return Array.from(this.children).filter(c=>c.tagName==='TD'||c.tagName==='TH');}});
window.location = { href:'http://localhost/', origin:'http://localhost', pathname:'/schedule.html', search:'', hash:'' };
globalThis.location = window.location; window.postMessage = () => {};
const store = new Map(JSON.parse(process.env.FC_STORE));
Object.assign(globalThis, { window, document,
  localStorage:{ getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k), clear:()=>store.clear() },
  fetch: async (u) => { throw new Error('net '+u); },
  HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
  getComputedStyle: () => ({ position:'', getPropertyValue: () => '' }),
  requestAnimationFrame: fn => setTimeout(fn,0), cancelAnimationFrame: id => clearTimeout(id),
  ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
  matchMedia: () => ({ matches:false, addEventListener(){}, removeEventListener(){} }) });
window.localStorage = globalThis.localStorage; window.ResizeObserver = globalThis.ResizeObserver;
await import(pathToFileURL(path.join(REPO, 'js/schedule-page.js')).href);
await new Promise(r => setTimeout(r, 400));
const $ = id => document.getElementById(id);
const t = el => el ? el.textContent.replace(/\\s+/g,' ').trim() : '';
console.log('TITLE  :', t($('forecastTitle')));
console.log('STATS  :', Array.from($('forecastStats').querySelectorAll('.stat')).map(s=>t(s)).join('   |   '));
console.log('ROWS   :');
for (const tr of $('forecastTable').querySelectorAll('tbody tr')) {
  console.log('   ', (tr.getAttribute('class')||'   ').padEnd(4), Array.from(tr.children).map(td=>t(td).padStart(9)).join(''));
}
console.log('CHART  :', $('forecastChart').querySelectorAll('svg').length ? $('forecastChart').querySelectorAll('path.ff-bar').length + ' bars' : 'none');
console.log('NOTE   :');
for (const line of $('forecastNote').innerHTML.split('<br>')) console.log('    -', line.replace(/<[^>]*>/g,'').replace(/\\s+/g,' ').trim());
console.log('WEEK   :', t($('weekNote')));
console.log('STAND  :', t($('standingsNote')));
console.log('MATCH  :', t($('matchupsNote')));
console.log('RESULT :', t($('resultsNote')));
console.log('CARDS  :');
for (const g of Array.from(document.querySelectorAll('#matchups .game.upcoming')).slice(0,4)) console.log('    ', t(g));
`;

import { writeFileSync } from 'node:fs';
writeFileSync(path.join(HERE, 'fc-dump-child.mjs'), child);

const cases = [
  ['DEMO (default week)', false, { 'schedule.source': 'demo' }, null],
  ['DEMO (from week 5)', false, { 'schedule.source': 'demo', 'schedule.week': 5 }, null],
  ['LIVE (week 2 of 13)', true, { 'schedule.source': 'live', 'schedule.week': 'all', 'schedule.results': 'all' }, { leagueId: '99', season: 2026, teamId: 4 }],
];

for (const [label, stub, prefs, conn] of cases) {
  const store = [['ff.prefs', JSON.stringify(prefs)]];
  if (conn) store.push(['ff.connection', JSON.stringify(conn)]);
  const args = stub ? ['--import', './fc-register.mjs', 'fc-dump-child.mjs'] : ['fc-dump-child.mjs'];
  const r = spawnSync(process.execPath, args, {
    cwd: HERE, encoding: 'utf8', env: { ...process.env, FC_STORE: JSON.stringify(store) },
  });
  console.log('\n========== ' + label + ' ==========');
  console.log(r.stdout || '');
  if (r.stderr) console.log('STDERR', r.stderr.slice(0, 800));
}
