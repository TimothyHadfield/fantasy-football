// The Playoffs page's player list (js/playoffs-players.js), mounted on its own
// into a bare host on the sample league, and checked BY HAND against the
// sample league's own generator (js/demo-rosters.js) — never against the
// module's arithmetic.
//
// Tim, 2026-10-16: "a list of players (taken or available) with their current
// avg, their future proj, and their playoff proj avg in collumns as well as
// their proj each week they play in the playoffs. Also show which user they
// currently belong to (just the user's first name). Also show some derived
// columns: (playoff proj avg) - (current avg). Include weeks that the player
// is proj 0 (either BYE or injured) in the avg calculations."
//
// What is pinned:
//   - the columns: Player · Pos · Tm · Owner · Avg · Future · Playoff ·
//     PO − Avg · then the playoff weeks, and NO regular-season week column;
//   - Owner is a first name (and two owners sharing one get an initial);
//   - Playoff and Future are means over EVERY week of their span with a 0
//     counted as 0 — on a man who really has a 0 week, and the expected figure
//     is checked to differ from the zeros-skipped one, so the assertion cannot
//     pass on code that skips zeros;
//   - PO − Avg is Playoff minus Avg as printed, signed;
//   - free agents are rows ("Available"); the position filter; the preview;
//   - the sample league asks the network for nothing.
//
// Run:  node playoffs-players-check.mjs

import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

// ---------------------------------------------------------------- the harness
const { window, document } = parseHTML(
  '<!doctype html><html><body><section class="panel" id="poPlayers"></section></body></html>');
if (!window.location) {
  window.location = { href: 'http://localhost/playoffs.html', origin: 'http://localhost',
    protocol: 'http:', pathname: '/playoffs.html', search: '', hash: '' };
}
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
// No league connected: the sample league, which must not touch the network.
const fetchCalls = [];
const fetch = async (url) => { fetchCalls.push(String(url)); throw new Error(`unexpected network call: ${url}`); };
Object.assign(globalThis, {
  window, document, localStorage, fetch, location: window.location,
  HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
  getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});
window.localStorage = localStorage;
if (!window.postMessage) window.postMessage = () => {};
const rejections = [];
process.on('unhandledRejection', (r) => rejections.push(String(r)));

const url = (rel) => pathToFileURL(path.join(REPO, rel)).href;
let mod;
try {
  mod = await import(url('js/playoffs-players.js'));
} catch (err) {
  ok(false, 'js/playoffs-players.js imports', err.message);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
const demo = await import(url('js/demo-rosters.js'));
const capture = await import(url('js/capture.js'));

eq(typeof mod.mountPlayoffPlayers, 'function', 'mountPlayoffPlayers is exported');

const host = document.getElementById('poPlayers');
await mod.mountPlayoffPlayers(host);

// ---------------------------------------------------------------- the fixture, by hand
const seasonWeeks = demo.generateDemoSchedule().weeks;
const CUR = demo.DEMO_CURRENT_WEEK;
const FUTURE = seasonWeeks.filter((w) => w >= CUR);
const PO = capture.playoffWeeks({ weeks: seasonWeeks });
const r1 = (n) => Math.round(n * 10) / 10;
const sign = (d) => (Math.abs(d) < 1e-9 ? '0' : (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1));

ok(PO.length === 3 && PO[0] === seasonWeeks[seasonWeeks.length - 1] + 1, 'the sample bracket is three weeks after the regular season', PO.join(','));

/** A rostered man's projection in a week, off that week's squads; null when on none. */
const rosterProj = (id, w) => {
  for (const t of demo.generateDemoWeekRosters(w).teams) {
    for (const p of t.players) if (p.playerId === id) return p.projected;
  }
  return null;
};
const anchorTeams = demo.generateDemoWeekRosters(CUR).teams;
const ownerOf = new Map();
for (const t of anchorTeams) for (const p of t.players) ownerOf.set(p.playerId, t);
const glance = demo.demoGlance();

// ---------------------------------------------------------------- the table
const table = host.querySelector('table');
ok(Boolean(table), 'a table is drawn into the host');
const heads = [...table.querySelectorAll('thead th')].map((th) => {
  const clone = th.cloneNode(true);
  clone.querySelectorAll('.sr-only, .po-tag').forEach((n) => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
});
const FIXED = ['Player', 'Pos', 'Tm', 'Owner', 'Avg', 'Future', 'Playoff', 'PO − Avg', 'PO − Fut'];
eq(JSON.stringify(heads.slice(0, FIXED.length)), JSON.stringify(FIXED), 'the columns, in order');
eq(JSON.stringify(heads.slice(FIXED.length)), JSON.stringify(PO.map(String)), 'then exactly the playoff weeks');
ok(!heads.some((h) => /^\d+$/.test(h) && !PO.includes(Number(h))), 'no regular-season week column', heads.join('|'));
ok(table.querySelector('thead th.po-start') && table.querySelector('thead th.po-start').textContent.includes(String(PO[0])),
  'the first playoff week carries the PO line');

const col = (name) => FIXED.indexOf(name);
const rows = [...table.querySelectorAll('tbody tr[data-player]')];
const rowOf = (id) => table.querySelector(`tbody tr[data-player="${id}"]`);
const cellText = (tr, i) => tr.children[i].textContent.replace(/\s+/g, ' ').trim();

// Every rostered man this week, plus the free agents.
const rostered = new Set(anchorTeams.flatMap((t) => t.players.map((p) => p.playerId)));
const pool = demo.generateDemoFreeAgents(CUR).slice()
  .sort((a, b) => (b.percentOwned ?? 0) - (a.percentOwned ?? 0) || a.playerId - b.playerId).slice(0, 100);
eq(rows.length, rostered.size + pool.length, 'one row per rostered man and per free agent');
ok([...rostered].every((id) => rowOf(id)), 'every rostered man has a row');
const faRows = rows.filter((tr) => cellText(tr, col('Owner')) === 'Available');
eq(faRows.length, pool.length, 'every free agent is a row, owned by "Available"');
ok(pool.length > 0, 'the sample wire has free agents to show', String(pool.length));

// ---------------------------------------------------------------- Owner: a first name
let ownersOk = 0;
for (const id of rostered) {
  const tr = rowOf(id);
  const want = String(ownerOf.get(id).name).trim().split(/\s+/)[0];
  if (tr && cellText(tr, col('Owner')) === want) ownersOk++;
}
eq(ownersOk, rostered.size, 'every rostered man’s Owner is his owner’s first name');
const short = mod.firstNames([
  { id: 1, name: 'Ash Ardent' }, { id: 2, name: 'Ash Bellweather' }, { id: 3, name: 'Cal Dunhill' }, { id: 4, name: 'Knox' },
]);
eq(short.get('3'), 'Cal', 'a full name becomes its first name');
eq(short.get('4'), 'Knox', 'a one-word name stays whole');
eq(`${short.get('1')}|${short.get('2')}`, 'Ash A|Ash B', 'two owners sharing a first name get their last initial');

// ---------------------------------------------------------------- the averages, by hand
/** His run over a span, off the generator, and both means (zeros in / zeros out). */
function runOf(id, weeks) {
  const vals = weeks.map((w) => rosterProj(id, w));
  const known = vals.filter((v) => typeof v === 'number');
  const withZeros = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const pos = known.filter((v) => v > 0);
  const skipZeros = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : null;
  return { vals, withZeros, skipZeros, zeros: known.filter((v) => v === 0).length, all: known.length === weeks.length };
}

// A man on a roster all through the playoffs with a 0 in a playoff week.
const poZeroMen = [...rostered].filter((id) => {
  const r = runOf(id, PO);
  return r.all && r.zeros > 0 && r.zeros < PO.length;
});
ok(poZeroMen.length > 0, 'the fixture has a rostered man projected 0 in a playoff week (and above 0 in another)');
for (const id of poZeroMen) {
  const r = runOf(id, PO);
  const tr = rowOf(id);
  ok(r1(r.withZeros) !== r1(r.skipZeros), `man ${id}: zeros-in and zeros-out playoff means differ (the check has teeth)`,
    `${r.withZeros} vs ${r.skipZeros}`);
  eq(cellText(tr, col('Playoff')), r1(r.withZeros).toFixed(1), `man ${id}: Playoff = mean of ${PO.length} weeks, the 0 counted`);
  // His week cells are his projections, the 0 drawn as the Players page draws it.
  PO.forEach((w, i) => {
    const txt = cellText(tr, FIXED.length + i);
    const v = r.vals[i];
    if (v === 0) ok(/^0\.0/.test(txt), `man ${id} week ${w}: a 0 week prints 0.0`, txt);
    else eq(txt.replace(/[▲▼]/g, '').trim(), v.toFixed(1), `man ${id} week ${w}: his projection`);
  });
  // PO − Avg: the two printed figures subtracted, signed.
  const avg = glance.byId.get(id).avg;
  eq(cellText(tr, col('Avg')).replace(/[▲▼]/g, '').trim(), avg === null ? '—' : r1(avg).toFixed(1), `man ${id}: Avg is his season average so far`);
  if (avg !== null) {
    eq(cellText(tr, col('PO − Avg')), sign(r1(r1(r.withZeros) - r1(avg))), `man ${id}: PO − Avg = Playoff − Avg, signed`);
  }
}

// Future: the regular-season weeks left, a 0 week counted.
const futZeroMen = [...rostered].filter((id) => {
  const r = runOf(id, FUTURE);
  return r.all && r.zeros > 0 && r.zeros < FUTURE.length && r1(r.withZeros) !== r1(r.skipZeros);
});
ok(futZeroMen.length > 0, 'the fixture has a rostered man projected 0 in a regular week left');
for (const id of futZeroMen.slice(0, 5)) {
  const r = runOf(id, FUTURE);
  eq(cellText(rowOf(id), col('Future')).replace(/[▲▼]/g, '').trim(), r1(r.withZeros).toFixed(1),
    `man ${id}: Future = mean of ${FUTURE.length} weeks, the ${r.zeros} zero week(s) counted`);
}

// Every row's PO − Avg is its own two printed cells subtracted.
let diffsOk = 0, diffsSeen = 0;
for (const tr of rows) {
  const a = cellText(tr, col('Avg')).replace(/[▲▼]/g, '').trim();
  const p = cellText(tr, col('Playoff')).replace(/[▲▼]/g, '').trim();
  if (a === '—' || p === '—') continue;
  diffsSeen++;
  if (cellText(tr, col('PO − Avg')) === sign(r1(Number(p) - Number(a)))) diffsOk++;
}
ok(diffsSeen > 100, 'most rows have both figures', String(diffsSeen));
eq(diffsOk, diffsSeen, 'every PO − Avg is its row’s Playoff minus Avg, as printed');

// Tim, 2026-10-16: "make another derived column for these playoff players that
// is playoff avg - future proj avg." Every row's PO − Fut, the same way.
let futOk = 0, futSeen = 0;
for (const tr of rows) {
  const f = cellText(tr, col('Future')).replace(/[▲▼]/g, '').trim();
  const p = cellText(tr, col('Playoff')).replace(/[▲▼]/g, '').trim();
  if (f === '—' || p === '—') continue;
  futSeen++;
  if (cellText(tr, col('PO − Fut')) === sign(r1(Number(p) - Number(f)))) futOk++;
}
ok(futSeen > 100, 'most rows have Future and Playoff', String(futSeen));
eq(futOk, futSeen, 'every PO − Fut is its row’s Playoff minus Future, as printed');

// ---------------------------------------------------------------- a free agent's numbers
const fa = pool.find((p) => PO.every((w) => demo.generateDemoFreeAgents(w).some((q) => q.playerId === p.playerId)));
ok(Boolean(fa), 'a free agent stays on the wire through the playoffs');
if (fa) {
  const vals = PO.map((w) => demo.generateDemoFreeAgents(w).find((q) => q.playerId === fa.playerId).projected);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  eq(cellText(rowOf(fa.playerId), col('Playoff')).replace(/[▲▼]/g, '').trim(), r1(mean).toFixed(1), 'a free agent’s Playoff is his wire projections’ mean');
}

// ---------------------------------------------------------------- the position filter
const click = (sel) => host.querySelector(sel).dispatchEvent(new window.Event('click', { bubbles: true }));
click('#poPosFilter button[data-pos="QB"]');
const qbRows = [...table.querySelectorAll('tbody tr[data-player]')];
ok(qbRows.length > 0 && qbRows.every((tr) => cellText(tr, col('Pos')) === 'QB'), 'QB shows only quarterbacks', String(qbRows.length));
click('#poPosFilter button[data-pos="FLEX"]');
const flexRows = [...table.querySelectorAll('tbody tr[data-player]')];
ok(flexRows.length > 0 && flexRows.every((tr) => ['RB', 'WR', 'TE'].includes(cellText(tr, col('Pos')))), 'FLEX shows RB, WR and TE');
click('#poPosFilter button[data-pos="ALL"]');
eq(table.querySelectorAll('tbody tr[data-player]').length, rows.length, 'All brings every row back');

// ---------------------------------------------------------------- the preview on Playoff
{
  const id = poZeroMen[0];
  const cell = rowOf(id).children[col('Playoff')];
  cell.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  const card = document.getElementById('statCard');
  const txt = card ? card.textContent.replace(/\s+/g, ' ') : '';
  ok(card && !card.hidden, 'the Playoff figure opens its preview');
  ok(txt.includes(`Mean of ${PO.length} weeks`), 'the preview says the mean is of every playoff week', txt);
  ok(/counts 0/.test(txt), 'the preview says the 0 week counts', txt);
}

// ---------------------------------------------------------------- the name, the cost
const link = rowOf(poZeroMen[0]).querySelector('td.name a.pref');
ok(link && /^waivers\.html\?player=\d+$/.test(link.getAttribute('href')), 'a name links to his row on the Players page');
eq(fetchCalls.length, 0, 'the sample league asks the network for nothing');
eq(rejections.length, 0, 'no unhandled rejection');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
