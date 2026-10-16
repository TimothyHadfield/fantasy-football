// The Playoffs page (Tim, 2026-10-16): boots playoffs.html with its real
// module on the sample league and checks the Teams table against the shared
// engine, worked out here independently from the same data:
//
//   - one row per team, one column per playoff week (capture.playoffWeeks);
//   - Playoffs % and Bye % are exactly js/forecast.js's simulateSeason for the
//     same inputs (capture.simulationInputs / leagueSpread, the sample season
//     as of week 4, 10,000 runs, Schedule's seed) — data-v and printed text;
//   - each week's figure is that team's best-lineup total for that week
//     (capture.buildProjection over the sample league's playoff rosters), and
//     never below the lineup the sample league actually set that week;
//   - the chances add up to the field (6 make it, 2 byes) — a sum a wrong
//     column, a swapped pair or a half-counted run would break;
//   - no network call, no console error, the player-list mount is there.
//
// Run from tests/: node playoffs-check.mjs

import { parseHTML } from 'linkedom';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const done = () => {
  console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
  process.exit(fail ? 1 : 0);
};

const PAGE = 'playoffs.html';
const file = path.join(REPO, PAGE);
ok(existsSync(file), `${PAGE} exists`);
if (!existsSync(file)) done();

// ------------------------------------------------------------- the harness
const html = readFileSync(file, 'utf8');
const { window, document } = parseHTML(html);
const TableProto = Object.getPrototypeOf(document.createElement('table'));
const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
Object.defineProperty(TableProto, 'rows', {
  configurable: true,
  get() {
    const r = [];
    const h = kids(this, 'THEAD')[0];
    if (h) r.push(...kids(h, 'TR'));
    for (const b of kids(this, 'TBODY')) r.push(...kids(b, 'TR'));
    return r;
  },
});
const RowProto = Object.getPrototypeOf(document.createElement('tr'));
Object.defineProperty(RowProto, 'cells', {
  configurable: true,
  get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
});
window.location = { href: `http://localhost/${PAGE}`, origin: 'http://localhost', pathname: `/${PAGE}`, search: '', hash: '' };
window.postMessage = () => {};
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const fetchCalls = [];
Object.assign(globalThis, {
  window, document, localStorage, location: window.location,
  fetch: async (url) => { fetchCalls.push(String(url)); throw new Error(`unexpected network call: ${url}`); },
  HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});
window.localStorage = localStorage;
const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.join(' ')); };

await import(pathToFileURL(path.join(REPO, 'js/playoffs-page.js')).href);

// Settled: every body row is a team (the "Simulating…" row is gone).
const rowsNow = () => [...document.querySelectorAll('#poTeams tbody tr')];
for (let i = 0; i < 200; i++) {
  const r = rowsNow();
  if (r.length && r.every((tr) => tr.getAttribute('data-team') !== null)) break;
  await new Promise((res) => setTimeout(res, 50));
}
console.error = origError;

// ----------------------------------------------- the same answer, worked out here
const capture = await import(pathToFileURL(path.join(REPO, 'js/capture.js')).href);
const forecast = await import(pathToFileURL(path.join(REPO, 'js/forecast.js')).href);
const demoRosters = await import(pathToFileURL(path.join(REPO, 'js/demo-rosters.js')).href);
const { generateDemoLeague } = await import(pathToFileURL(path.join(REPO, 'js/demo.js')).href);

const data = capture.normalizeSchedule(demoRosters.generateDemoSchedule(), { isDemo: true });
const byKey = new Map(generateDemoLeague().games.map((g) => [`${g.week}:${g.homeId}`, g]));
for (const g of data.games) {
  const s = byKey.get(`${g.week}:${g.homeId}`);
  if (s && s.awayId === g.awayId) { g.homeProjected = s.homeProjected; g.awayProjected = s.awayProjected; }
}
const asOf = demoRosters.DEMO_CURRENT_WEEK;
const weeks = capture.playoffWeeks(data);
const weekTeams = new Map(weeks.map((w) => [w, demoRosters.generateDemoWeekRosters(w).teams]));
const proj = capture.buildProjection(data, weekTeams, null).proj;
const spread = capture.leagueSpread(data, (g) => g.week < asOf, null);
const inputs = capture.simulationInputs({ data, isRemaining: (g) => g.week >= asOf, proj, sigma: spread.sigma });
const sim = forecast.simulateSeason({
  teamIds: inputs.teamIds, banked: inputs.banked, games: inputs.games, sigma: inputs.sigma,
  runs: 10000, seed: 20260901, playoff: inputs.playoff,
});
const expect = new Map(sim.teams.map((t) => [t.teamId, t]));
const pct = (p) => {
  const v = p * 100;
  if (v > 0 && v < 0.5) return '<1%';
  if (v < 100 && v >= 99.5) return '>99%';
  return `${Math.round(v)}%`;
};

// ---------------------------------------------------------------- the checks
ok(fetchCalls.length === 0, 'no network call on the sample league', fetchCalls[0]);
ok(errors.length === 0, 'no console error', errors.slice(0, 2).join(' | '));
ok(document.querySelector('header.site nav a.active')?.getAttribute('href') === PAGE, 'the nav marks Playoffs as this page');
ok(Boolean(document.querySelector('section.panel#poPlayers')), 'the player list mount is on the page');
ok(Boolean(document.querySelector('link[rel="stylesheet"][href="css/playoffs-players.css"]')), 'the player list stylesheet is linked');
ok(document.getElementById('modeBadge')?.textContent === 'Demo', 'badge says Demo');

ok(weeks.length === 3 && weeks[0] === 14, 'the sample league has three playoff weeks from 14', JSON.stringify(weeks));
const heads = [...document.querySelectorAll('#poTeams thead th')].map((th) => th.textContent.trim());
ok(JSON.stringify(heads) === JSON.stringify(['Team', 'Playoffs %', 'Bye %', ...weeks.map((w) => `Wk ${w}`)]),
  'columns: Team, Playoffs %, Bye %, one per playoff week', JSON.stringify(heads));

const rows = rowsNow();
ok(rows.length === data.teams.length, `one row per team (${data.teams.length})`, `got ${rows.length}`);
const seen = new Set(rows.map((tr) => Number(tr.getAttribute('data-team'))));
ok(seen.size === data.teams.length && data.teams.every((t) => seen.has(t.id)), 'every team once');

let sumPlayoffs = 0, sumBye = 0;
for (const tr of rows) {
  const id = Number(tr.getAttribute('data-team'));
  const team = data.teams.find((t) => t.id === id);
  const t = expect.get(id);
  const cells = tr.cells;
  ok(cells[0].textContent.trim() === team?.name, `${team?.name}: name`);
  const vP = Number(cells[1].getAttribute('data-v'));
  const vB = Number(cells[2].getAttribute('data-v'));
  sumPlayoffs += vP; sumBye += vB;
  ok(vP === t.pPlayoffs, `${team.name}: Playoffs % is forecast.js's`, `${vP} vs ${t.pPlayoffs}`);
  ok(vB === t.pBye, `${team.name}: Bye % is forecast.js's`, `${vB} vs ${t.pBye}`);
  ok(cells[1].textContent.trim().startsWith(pct(t.pPlayoffs)), `${team.name}: Playoffs % printed`, cells[1].textContent);
  ok(cells[2].textContent.trim().startsWith(pct(t.pBye)), `${team.name}: Bye % printed`, cells[2].textContent);
  ok(vB <= vP, `${team.name}: a bye never more likely than the playoffs`);
  weeks.forEach((w, i) => {
    const cell = cells[3 + i];
    const want = proj.get(w).get(id);
    const got = Number(cell.getAttribute('data-v'));
    ok(Math.abs(got - want) < 1e-9, `${team.name}: week ${w} is the best-lineup projection`, `${got} vs ${want}`);
    ok(cell.textContent.trim().startsWith(want.toFixed(1)), `${team.name}: week ${w} printed to a tenth`, cell.textContent);
    const set = weekTeams.get(w).find((x) => x.id === id)?.projectedTotal;
    ok(Number.isFinite(set) && got >= set - 0.05, `${team.name}: week ${w} at least the lineup actually set`, `${got} vs ${set}`);
  });
}
const field = capture.playoffTeams(data);
ok(Math.abs(sumPlayoffs - field) < 1e-9, `Playoffs % adds up to the ${field}-team field`, String(sumPlayoffs));
ok(Math.abs(sumBye - (sim.playoff.byes)) < 1e-9, `Bye % adds up to ${sim.playoff.byes} byes`, String(sumBye));
// Highest Playoffs % first.
const order = rows.map((tr) => Number(tr.cells[1].getAttribute('data-v')));
ok(order.every((v, i) => i === 0 || order[i - 1] >= v), 'rows open highest Playoffs % first', JSON.stringify(order));
ok(!document.getElementById('poKey').hasAttribute('hidden'), 'the colour key is shown under the coloured table');

done();
