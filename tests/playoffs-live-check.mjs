// The Playoffs page's player list on a LIVE league: which league it reads.
// Sweep 2026-10-16 rows 12 and 13 (js/playoffs-players.js):
//   12  the Value lines are asked for AFTER espn is pointed at the league, so a
//       league's player cards never get the previous league's Values;
//   13  connecting league B while league A is still loading reads B (it used to
//       be thrown away, and A stayed on screen).
//
//   node playoffs-live-check.mjs
//
// The module's ./season.js, ./espn.js and ./connection.js are stubbed for it
// alone (po-live-loader.mjs); the rest of the page is real. Re-runs itself
// under the loader.

import { spawnSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.PO_LIVE_CHILD) {
  const res = spawnSync(process.execPath, ['--import', './po-live-register.mjs', path.join(HERE, 'playoffs-live-check.mjs')], {
    encoding: 'utf8', cwd: HERE, env: { ...process.env, PO_LIVE_CHILD: '1' }, timeout: 120000,
  });
  process.stdout.write(res.stdout || '');
  if (res.status !== 0 && !/passed, \d+ failed/.test(res.stdout || '')) {
    console.log(String(res.stderr || '').trimEnd().split('\n').slice(-10).join('\n'));
    console.log('\n0 passed, 1 failed');
  }
  process.exit(res.status === null ? 1 : res.status);
}

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) { pass++; console.log(`PASS ${msg}`); }
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};

const { window, document } = parseHTML(
  '<!doctype html><html><body><section class="panel" id="poPlayers"></section></body></html>');
window.location = { href: 'http://localhost/playoffs.html', origin: 'http://localhost',
  protocol: 'http:', pathname: '/playoffs.html', search: '', hash: '' };
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
Object.assign(globalThis, {
  window, document, localStorage, location: window.location,
  fetch: async (u) => { throw new Error(`unexpected network call: ${u}`); },
  HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
  getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});
window.localStorage = localStorage;
if (!window.postMessage) window.postMessage = () => {};

// League A's schedule never arrives (a slow ESPN); B's comes back at once.
const po = globalThis.__po = {
  calls: [], listeners: [],
  saved: { leagueId: 'A', season: 2026 },
  schedule: (id) => (id === 'A' ? new Promise(() => {}) : Promise.resolve({ weeks: [] })),
};

const mod = await import(pathToFileURL(path.join(REPO, 'js/playoffs-players.js')).href);
const host = document.getElementById('poPlayers');
mod.mountPlayoffPlayers(host); // never settles: A is still loading
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
await tick();

ok(po.calls.includes('fetchSchedule:A'), 'league A starts loading', po.calls.join(' '));
ok(!po.calls.includes('fetchPlayerValues:OLD'), 'ROW 12: VALUES ARE NOT ASKED FOR UNDER THE PREVIOUS LEAGUE', po.calls.join(' '));
ok(po.calls.includes('fetchPlayerValues:A'), 'they are asked for under league A', po.calls.join(' '));

// The reader connects league B while A is still loading.
po.saved = { leagueId: 'B', season: 2026 };
for (const fn of po.listeners) fn({ leagueId: 'B' });
await tick(60);
ok(po.calls.includes('fetchSchedule:B'), 'ROW 13: CONNECTING B WHILE A LOADS READS B', po.calls.join(' '));
ok(po.calls.includes('fetchPlayerValues:B'), 'and asks for B’s Values', po.calls.join(' '));

// The same league again is not a second read.
const n = po.calls.filter((c) => c === 'fetchSchedule:B').length;
for (const fn of po.listeners) fn({ leagueId: 'B' });
await tick(60);
ok(po.calls.filter((c) => c === 'fetchSchedule:B').length === n, 'the same league again starts no second read', po.calls.join(' '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
