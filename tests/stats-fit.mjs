// The Stats page's two "Projected vs actual" graphs, on the real page.
//
// Tim, 2026-10-04: "The players graph should be all players proj every single
// week of this season, and their actual score. The Team graph should be all
// user's starting lineup proj ever week of the season ... If the user then
// clicks on that preview bring them straight to the section and box that
// correlates with that performance."
//
//   node stats-fit.mjs
//
// Two layers:
//   1. the pure point builders in js/stats.js, on hand-made fixtures — which
//      weeks and which men become a dot, and which do not;
//   2. the REAL stats.html booted on the demo season (10 teams, 13 weeks, 16-man
//      rosters, no network): the dot counts against an independent count, the
//      fitted line's numbers against an independent fit, and the links a tapped
//      dot's preview carries — the two URLs the Analysis and Players pages
//      answer to.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';

const mod = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

// ================================================================ the builders
const { teamFitPoints, playerFitPoints, computeLeagueStats } = await mod('js/stats.js');
{
  const stats = {
    teams: [
      { id: 4, name: 'Tim', weekly: [
        { week: 1, projected: 110.2, actual: 131.5 },
        { week: 2, projected: 0, actual: 99.1 },        // ESPN returned no projection
        { week: 3, projected: 104.4, actual: 88 },
      ] },
      { id: 9, name: 'Other', weekly: [
        { week: 1, projected: 98.6, actual: 101.3 },
        { week: 3, projected: null, actual: 90 },
      ] },
    ],
  };
  const pts = teamFitPoints(stats);
  eq(pts.length, 3, 'a team-week with a projection and a score is one dot; one without is none');
  eq(JSON.stringify(pts[0]), JSON.stringify({ teamId: 4, name: 'Tim', week: 1, x: 110.2, y: 131.5 }),
    'x is the projection, y the score, and it knows its team and week');
  ok(!pts.some((p) => p.week === 2), 'a week stored with projection 0 is not plotted on the axis');
  eq(teamFitPoints(null).length, 0, 'no stats, no dots');
}
{
  const man = (playerId, projected, actual, started = true) => ({
    playerId, name: `P${playerId}`, position: 'RB', proTeam: 'KC', started, projected, actual,
  });
  const weekTeams = new Map([
    [1, [
      { id: 4, players: [man(1, 12.3, 15.1), man(2, 8, 0), man(3, 0, 0), man(4, null, 6), man(5, 7, null),
        man(6, 4.4, 9.9, false)] },
      { id: 9, players: [man(7, 0, 3.2), man(8, 20.5, -1)] },
    ]],
    [2, [{ id: 4, players: [man(1, 13, 2)] }]],
    [3, [{ id: 4, players: [man(1, 14, 22)] }]],   // not a finished week below
  ]);
  const pts = playerFitPoints(weekTeams, [1, 2]);
  const ids = pts.map((p) => `${p.week}:${p.playerId}`).join(' ');
  eq(ids, '1:1 1:2 1:6 1:7 1:8 2:1', 'who becomes a dot');
  ok(pts.some((p) => p.playerId === 6), 'a BENCH player is a dot too (every rostered man, not just starters)');
  ok(pts.some((p) => p.playerId === 2 && p.y === 0), 'projected 8, scored 0 is a real miss and stays');
  ok(pts.some((p) => p.playerId === 7 && p.x === 0), 'projected 0 but scored is a real miss and stays');
  ok(pts.some((p) => p.playerId === 8 && p.y === -1), 'a negative score is a score');
  ok(!pts.some((p) => p.playerId === 3), 'projected 0 and scored 0 (bye, out) is left off');
  ok(!pts.some((p) => p.playerId === 4), 'no projection (null) is no dot');
  ok(!pts.some((p) => p.playerId === 5), 'no score (null) is no dot');
  ok(!pts.some((p) => p.week === 3), 'a week not in the finished list is not plotted');
  const one = pts[0];
  eq(JSON.stringify(one), JSON.stringify({
    playerId: 1, name: 'P1', position: 'RB', proTeam: 'KC', teamId: 4, week: 1, x: 12.3, y: 15.1,
  }), 'and a dot carries what the preview and the link need');
  // The cloud copy rebuilds `players`; an older shape has only the two views.
  const split = new Map([[1, [{ id: 4, starters: [man(1, 5, 6)], bench: [man(2, 3, 4, false)] }]]]);
  eq(playerFitPoints(split, [1]).length, 2, 'a team with only starters + bench is read the same');
  eq(playerFitPoints(null, [1]).length, 0, 'no rosters, no dots');
}

// ================================================================ the page
const html = readFileSync(path.join(REPO, 'stats.html'), 'utf8');
const { window, document } = parseHTML(html);

const SelectProto = window.HTMLSelectElement?.prototype;
if (SelectProto) {
  Object.defineProperty(SelectProto, 'value', {
    configurable: true,
    get() {
      const s = this.querySelector('option[selected]') || this.querySelector('option');
      return s ? s.getAttribute('value') ?? s.textContent : '';
    },
    set(v) {
      for (const o of this.querySelectorAll('option')) {
        if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
        else o.removeAttribute('selected');
      }
    },
  });
}
const TableProto = Object.getPrototypeOf(document.createElement('table'));
const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const fetchCalls = [];
Object.assign(globalThis, {
  window, document, localStorage,
  fetch: async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected network call'); },
  HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
  Event: window.Event, Node: window.Node,
  getComputedStyle: () => ({ getPropertyValue: () => '', position: 'static' }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});
window.localStorage = localStorage;
window.ResizeObserver = globalThis.ResizeObserver;
if (!window.location) window.location = { origin: 'null', href: 'about:blank' };
if (!window.postMessage) window.postMessage = () => {};

const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.join(' ')); };
await mod('js/stats-page.js');
await mod('js/connection.js');
await new Promise((r) => setTimeout(r, 300));
console.error = origError;

eq(errors.length, 0, `the page boots without a console error${errors[0] ? ` (${errors[0]})` : ''}`);
eq(fetchCalls.length, 0, 'and the demo makes no request for either graph');

const $ = (id) => document.getElementById(id);
const all = (root, sel) => (root ? Array.from(root.querySelectorAll(sel)) : []);
const dots = (id) => all($(id), 'circle.ff-dot');
const num = (el, attr) => Number(el.getAttribute(attr));
const tap = (svg, dot) => {
  const e = new window.Event('pointerdown', { bubbles: true });
  Object.assign(e, { pointerType: 'touch', clientX: num(dot, 'cx'), clientY: num(dot, 'cy') });
  svg.dispatchEvent(e);
};

// --- an independent count of what should be there ---------------------------
const { generateDemoLeague } = await mod('js/demo.js');
const { generateDemoSchedule, generateDemoWeekRosters } = await mod('js/demo-rosters.js');
const { leastSquares } = await mod('js/charts.js');
const league = generateDemoLeague();
const stats = computeLeagueStats(league);
const weeks = stats.weekNumbers;
eq(weeks.length, 13, 'the demo season is 13 finished weeks');
eq(stats.teams.length, 10, 'of 10 teams');

const teamPairs = [];
for (const g of league.games) {
  teamPairs.push({ id: g.homeId, week: g.week, x: g.homeProjected, y: g.homeActual });
  teamPairs.push({ id: g.awayId, week: g.week, x: g.awayProjected, y: g.awayActual });
}
const playerPairs = [];
let benchPairs = 0;
for (const w of weeks) {
  for (const t of generateDemoWeekRosters(w).teams) {
    for (const p of t.players) {
      if (typeof p.projected !== 'number' || typeof p.actual !== 'number') continue;
      if (p.projected === 0 && p.actual === 0) continue;
      playerPairs.push({ id: p.playerId, week: w, x: p.projected, y: p.actual, name: p.name });
      if (!p.started) benchPairs++;
    }
  }
}

// --- teams ------------------------------------------------------------------
{
  const host = $('chartFitTeams');
  ok(host, 'the teams graph has its container');
  const svg = host && host.querySelector('svg');
  eq(teamPairs.length, 130, 'ten teams by thirteen weeks is 130 team-weeks');
  eq(dots('chartFitTeams').length, 130, 'and the teams graph draws one dot for each');
  eq(all(host, 'line.ff-perfect').length, 1, 'with the dotted perfect line');
  eq(all(host, 'line.ff-fit').length, 1, 'and the fitted one');

  const fit = leastSquares(teamPairs);
  const note = ($('fitTeamsNote') || {}).textContent || '';
  ok(note.includes('130 dots'), 'the note states how many dots the line is fitted to (rule 7)', note.slice(0, 200));
  ok(note.includes(fit.slope.toFixed(2)), `and the slope an independent fit gives (${fit.slope.toFixed(2)})`, note);
  ok(note.includes(`r = ${fit.r.toFixed(2)}`), `and r (${fit.r.toFixed(2)})`, note);
  ok($('fitTeamsNote').closest('details') && !$('fitTeamsNote').closest('details').hasAttribute('open'),
    'all of it behind the toggle, closed');

  // Tap a dot: the preview is a link to that team's roster in that week.
  if (svg && dots('chartFitTeams').length) {
    const d = dots('chartFitTeams')[37];
    tap(svg, d);
    const tip = host.querySelector('.ff-scatter-tip');
    ok(tip && !tip.hasAttribute('hidden'), 'a tapped team dot opens its preview');
    const href = (tip && tip.getAttribute('href')) || '';
    const m = /^analysis\.html\?team=(\d+)&week=(\d+)#rosterDetail$/.exec(href);
    ok(m, 'which links to analysis.html?team=<id>&week=<n>#rosterDetail', href);
    if (m) {
      const row = teamPairs.find((p) => p.id === Number(m[1]) && p.week === Number(m[2]));
      const team = stats.teams.find((t) => t.id === Number(m[1]));
      ok(row, 'for a team-week that exists');
      const text = tip.textContent.replace(/\s+/g, ' ');
      ok(text.includes(team.name), 'the preview names that team', text);
      ok(text.includes(`Week ${m[2]}`), 'and that week', text);
      ok(row && text.includes(`Proj ${row.x.toFixed(1)} · Actual ${row.y.toFixed(1)}`),
        'and that week\'s own projection and score', text);
    }
  }
}

// --- players ----------------------------------------------------------------
{
  const host = $('chartFitPlayers');
  ok(host, 'the players graph has its container');
  const svg = host && host.querySelector('svg');
  ok(playerPairs.length > 1500, 'the demo season holds a real season\'s worth of player-weeks',
    String(playerPairs.length));
  ok(benchPairs > 300, 'bench players among them', String(benchPairs));
  eq(dots('chartFitPlayers').length, playerPairs.length,
    'and the players graph draws one dot for each — starters and bench, finished weeks only');
  eq(all(host, 'line.ff-perfect').length, 1, 'with the dotted perfect line');
  eq(all(host, 'line.ff-fit').length, 1, 'and the fitted one');

  const fit = leastSquares(playerPairs);
  const note = ($('fitPlayersNote') || {}).textContent || '';
  ok(note.includes(`${playerPairs.length.toLocaleString('en-US')} dots`),
    'the note states how many dots', note.slice(0, 200));
  ok(note.includes(fit.slope.toFixed(2)), `and the slope an independent fit gives (${fit.slope.toFixed(2)})`, note);
  ok(note.includes(`r = ${fit.r.toFixed(2)}`), `and r (${fit.r.toFixed(2)})`, note);
  ok(/bench/i.test(note), 'and says bench players are counted');

  if (svg && dots('chartFitPlayers').length) {
    const d = dots('chartFitPlayers')[411];
    tap(svg, d);
    const tip = host.querySelector('.ff-scatter-tip');
    ok(tip && !tip.hasAttribute('hidden'), 'a tapped player dot opens its preview');
    const href = (tip && tip.getAttribute('href')) || '';
    const m = /^waivers\.html\?player=(\d+)&week=(\d+)$/.exec(href);
    ok(m, 'which links to waivers.html?player=<id>&week=<n>', href);
    if (m) {
      const row = playerPairs.find((p) => p.id === Number(m[1]) && p.week === Number(m[2]));
      ok(row, 'for a player-week that exists');
      const text = tip.textContent.replace(/\s+/g, ' ');
      ok(row && text.includes(row.name), 'the preview names that player', text);
      ok(text.includes(`Week ${m[2]}`), 'and that week', text);
      ok(row && text.includes(`Proj ${row.x.toFixed(1)} · Actual ${row.y.toFixed(1)}`),
        'and his own projection and score that week', text);
    }
  }
}

// --- nothing new to read on the face of the page ---------------------------
for (const id of ['panelFitTeams', 'panelFitPlayers']) {
  const panel = $(id);
  ok(panel && !panel.hasAttribute('hidden'), `${id} is shown on a played season`);
  eq(all(panel, 'p.lede').length, 0, `${id} adds no lede: the page is at its prose ceiling`);
}
eq(generateDemoSchedule().weeks.length >= 13, true, 'sanity: the demo schedule covers the season');

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
