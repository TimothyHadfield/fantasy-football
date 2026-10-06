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
const { leastSquares, offPerfect, SERIES_COLORS } = await mod('js/charts.js');
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

// --- "Colour by", the chips, and the two numbers on the graph ---------------
// Tim, 2026-10-04: "sorted by a variety of metricts. For example Position, User
// (team), week ... highlight these specific moments ... or just colorized" and
// "show on each of those graphs how closely the true line is to the dotted
// line, as well as how closely the true line is to the dots (R^2 ...)".
const press = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const chips = (id) => all($(id), '.ff-scatter-legend button[data-group]');
const by = (id, v) => $(id).querySelector(`button[data-by="${v}"]`);
const onScreen = (el) => {
  for (let n = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden')) return false;
    if (n.tagName === 'DETAILS') return false;
  }
  return true;
};
const prefsNow = () => JSON.parse(localStorage.getItem('ff.prefs') || '{}');
const stat = (id) => (($(id) || {}).textContent || '').trim();
const r2Of = (pairs) => leastSquares(pairs).r2.toFixed(2);
const gapOf = (pairs) => `${offPerfect(pairs).toFixed(1)} pts`;
const positionOf = new Map();
const ownerOf = new Map();
for (const w of weeks) {
  for (const t of generateDemoWeekRosters(w).teams) {
    for (const p of t.players) { positionOf.set(p.playerId, p.position); ownerOf.set(`${w}:${p.playerId}`, t.id); }
  }
}

{
  // The numbers, before anything is grouped: every dot's.
  for (const id of ['fitTeamsR2', 'fitTeamsGap', 'fitPlayersR2', 'fitPlayersGap']) {
    ok($(id) && onScreen($(id)), `${id} is on the face of the panel, not behind the toggle`);
  }
  eq(stat('fitTeamsR2'), r2Of(teamPairs), 'teams: R² is the square of an independent fit\'s r');
  eq(stat('fitTeamsGap'), gapOf(teamPairs), 'teams: Off perfect is the independent mean gap to y = x');
  eq(stat('fitPlayersR2'), r2Of(playerPairs), 'players: R², independently');
  eq(stat('fitPlayersGap'), gapOf(playerPairs), 'players: Off perfect, independently');
  ok(!/NaN|undefined|null/.test(['fitTeamsR2', 'fitTeamsGap', 'fitPlayersR2', 'fitPlayersGap'].map(stat).join(' ')),
    'and none of them reads NaN');
  for (const id of ['fitTeamsNote', 'fitPlayersNote']) {
    const note = $(id).textContent;
    ok(/R²/.test(note) && /Off perfect/.test(note), `${id} says what the two numbers are (rule 7)`);
    ok(/0 = the lines coincide/.test(note), `${id} says what 0 off perfect means`);
  }

  // The control: None by default, and None is the graph as it was.
  eq(all($('fitPlayersBy'), 'button').map((b) => b.textContent.trim()).join('|'), 'None|Position|Team|Week',
    'players can be coloured by position, team or week');
  eq(all($('fitTeamsBy'), 'button').map((b) => b.textContent.trim()).join('|'), 'None|Team|Week',
    'teams by team or week');
  eq(all($('fitPlayersBy'), 'button.on').map((b) => b.dataset.by).join(), 'none', 'None is the default');
  eq(chips('chartFitPlayers').length, 0, 'and None shows no legend');
  ok(dots('chartFitPlayers').every((d) => !d.hasAttribute('fill')), 'and colours no dot');
  eq(chips('chartFitTeams').length, 0, 'the same on the teams graph');
}
{
  // ---- players by position ----
  press(by('fitPlayersBy', 'position'));
  eq(all($('fitPlayersBy'), 'button.on').map((b) => b.dataset.by).join(), 'position', 'the pressed option is marked');
  eq(by('fitPlayersBy', 'position').getAttribute('aria-pressed'), 'true', 'for a screen reader too');
  eq(prefsNow()['stats.fitPlayersBy'], 'position', 'the grouping is remembered');
  const ch = chips('chartFitPlayers');
  eq(ch.map((b) => b.textContent.trim()).join('|'), 'QB|RB|WR|TE|K|D/ST', 'a chip per position, in lineup order');
  const colour = Object.fromEntries(ch.map((b) => [b.getAttribute('data-group'),
    /background:\s*([^;]+)/.exec(b.querySelector('.ff-chip-sw').getAttribute('style'))[1].trim()]));
  eq(colour.QB, SERIES_COLORS[6], 'QB is green (Tim\'s example)');
  eq(colour.RB, SERIES_COLORS[9], 'RB is red (Tim\'s example)');
  eq(new Set(Object.values(colour)).size, 6, 'six positions, six colours');
  // Every dot carries its own position's colour.
  const svg = $('chartFitPlayers').querySelector('svg');
  const host = $('chartFitPlayers');
  let wrong = 0, checked = 0;
  for (const d of dots('chartFitPlayers').filter((_, i) => i % 37 === 0)) {
    tap(svg, d);
    const m = /player=(\d+)/.exec(host.querySelector('.ff-scatter-tip').getAttribute('href') || '');
    if (!m) continue;
    checked++;
    if (d.getAttribute('fill') !== colour[positionOf.get(Number(m[1]))]) wrong++;
  }
  ok(checked > 30, 'sampled dots open previews', String(checked));
  eq(wrong, 0, 'and each is coloured by the position of the player it opens');
  eq(dots('chartFitPlayers').length, playerPairs.length, 'colouring adds or drops no dot');
  eq(stat('fitPlayersR2'), r2Of(playerPairs), 'and changes neither number: R²');
  eq(stat('fitPlayersGap'), gapOf(playerPairs), 'nor Off perfect');

  // ---- highlight RB ----
  const rb = playerPairs.filter((p) => positionOf.get(p.id) === 'RB');
  ok(rb.length > 200 && rb.length < playerPairs.length, 'the season has a real number of RB weeks', String(rb.length));
  const r2All = stat('fitPlayersR2'), gapAll = stat('fitPlayersGap');
  press(chips('chartFitPlayers').find((b) => b.getAttribute('data-group') === 'RB'));
  eq(chips('chartFitPlayers').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()).join(),
    'RB', 'pressing RB focuses it');
  const lit = dots('chartFitPlayers').filter((d) => !/\bff-dot-dim\b/.test(d.getAttribute('class')));
  eq(lit.length, rb.length, 'exactly the RB dots stay lit');
  eq(dots('chartFitPlayers').length, playerPairs.length, 'the rest are still drawn, dimmed');
  eq(stat('fitPlayersR2'), r2Of(rb), 'R² is now the RB dots\' own');
  eq(stat('fitPlayersGap'), gapOf(rb), 'and so is Off perfect');
  ok(stat('fitPlayersR2') !== r2All || stat('fitPlayersGap') !== gapAll, 'so the numbers on the graph changed',
    `${r2All} ${gapAll} -> ${stat('fitPlayersR2')} ${stat('fitPlayersGap')}`);
  const note = $('fitPlayersNote').textContent;
  ok(note.includes(`${rb.length.toLocaleString('en-US')} highlighted dots (RB)`), 'the note says which dots the line is fitted to', note.slice(0, 900));
  ok(note.includes(leastSquares(rb).slope.toFixed(2)), 'and gives their slope');
  eq(prefsNow()['stats.fitPlayersBy'], 'position', 'the grouping is still remembered');
  ok(!JSON.stringify(prefsNow()).includes('RB'), 'the highlight is not');
  // Only RB can be opened now.
  const svg2 = host.querySelector('svg');
  let notRb = 0, opened = 0;
  for (const d of dots('chartFitPlayers').filter((_, i) => i % 23 === 0)) {
    tap(svg2, d);
    const tip = host.querySelector('.ff-scatter-tip');
    if (tip.hasAttribute('hidden')) continue;
    opened++;
    const m = /player=(\d+)/.exec(tip.getAttribute('href') || '');
    if (!m || positionOf.get(Number(m[1])) !== 'RB') notRb++;
  }
  ok(opened > 0, 'taps still open previews', String(opened));
  eq(notRb, 0, 'and only ever an RB\'s');

  // ---- any click on the graph goes there ----
  window.location = { href: 'about:blank' };
  press(document.body);                      // not on the graph
  eq(window.location.href, 'about:blank', 'a click elsewhere on the page goes nowhere');
  const sel = host.querySelector('.ff-scatter-tip').getAttribute('href');
  ok(/^waivers\.html\?player=\d+&week=\d+$/.test(sel || ''), 'a dot is selected', String(sel));
  const far = new window.Event('pointerdown', { bubbles: true });
  Object.assign(far, { pointerType: 'touch', clientX: 700, clientY: 20 });   // top-right corner: no dot
  svg2.dispatchEvent(far);
  eq(host.querySelector('.ff-scatter-tip').getAttribute('href'), sel, 'a tap on empty graph keeps the selection');
  const click = new window.Event('click', { bubbles: true });
  Object.assign(click, { clientX: 700, clientY: 20 });
  svg2.dispatchEvent(click);
  eq(window.location.href, sel, 'and sends the page to the selected dot\'s link');
  window.location = { href: 'about:blank' };

  // ---- clear, then another grouping ----
  press(chips('chartFitPlayers').find((b) => b.getAttribute('data-group') === 'RB'));
  eq(all($('chartFitPlayers'), 'circle.ff-dot-dim').length, 0, 'pressing RB again clears the highlight');
  eq(stat('fitPlayersR2'), r2All, 'and the numbers are every dot\'s again');
  press(chips('chartFitPlayers').find((b) => b.getAttribute('data-group') === 'QB'));
  press(by('fitPlayersBy', 'team'));
  eq(all($('chartFitPlayers'), 'circle.ff-dot-dim').length, 0, 'choosing another grouping clears a highlight too');
  eq(chips('chartFitPlayers').map((b) => b.textContent.trim()).join('|'), stats.teams.map((t) => t.name).join('|'),
    'by team: a chip per fantasy team, named as everywhere else on the page');
  const teamColour = Object.fromEntries(chips('chartFitPlayers').map((b) => [b.getAttribute('data-group'),
    /background:\s*([^;]+)/.exec(b.querySelector('.ff-chip-sw').getAttribute('style'))[1].trim()]));
  stats.teams.forEach((t, i) => {
    eq(teamColour[String(t.id)], SERIES_COLORS[i % SERIES_COLORS.length], `${t.name} keeps the colour the line charts give it`);
  });
  const t0 = stats.teams[2];
  const owned = playerPairs.filter((p) => ownerOf.get(`${p.week}:${p.id}`) === t0.id);
  press(chips('chartFitPlayers').find((b) => b.getAttribute('data-group') === String(t0.id)));
  eq(dots('chartFitPlayers').length - all($('chartFitPlayers'), 'circle.ff-dot-dim').length, owned.length,
    'highlighting a team lights the players on ITS roster each week');
  eq(stat('fitPlayersR2'), r2Of(owned), 'with their own R²');

  press(by('fitPlayersBy', 'week'));
  eq(chips('chartFitPlayers').map((b) => b.textContent.trim()).join('|'), weeks.map((w) => `Wk ${w}`).join('|'),
    'by week: a chip per finished week, in week order');
  eq(new Set(chips('chartFitPlayers').map((b) => b.querySelector('.ff-chip-sw').getAttribute('style'))).size, weeks.length,
    'each week its own colour');
  const wk = weeks[4];
  const inWeek = playerPairs.filter((p) => p.week === wk);
  press(chips('chartFitPlayers').find((b) => b.getAttribute('data-group') === String(wk)));
  eq(dots('chartFitPlayers').length - all($('chartFitPlayers'), 'circle.ff-dot-dim').length, inWeek.length,
    'highlighting a week lights that week\'s players');
  eq(stat('fitPlayersGap'), gapOf(inWeek), 'with their own Off perfect');

  press(by('fitPlayersBy', 'none'));
  eq(chips('chartFitPlayers').length, 0, 'None takes the legend away');
  ok(dots('chartFitPlayers').every((d) => !d.hasAttribute('fill') && !/ff-dot-dim/.test(d.getAttribute('class'))),
    'and the graph is as it was');
  eq(prefsNow()['stats.fitPlayersBy'], undefined, 'and nothing is left remembered');
}
{
  // ---- teams by week, one week highlighted ----
  press(by('fitTeamsBy', 'week'));
  eq(chips('chartFitTeams').length, 13, 'thirteen week chips on the teams graph');
  eq(chips('chartFitPlayers').length, 0, 'the players graph keeps its own choice');
  const wk = weeks[6];
  const inWeek = teamPairs.filter((p) => p.week === wk);
  const before = stat('fitTeamsR2') + ' ' + stat('fitTeamsGap');
  press(chips('chartFitTeams').find((b) => b.getAttribute('data-group') === String(wk)));
  eq(dots('chartFitTeams').length - all($('chartFitTeams'), 'circle.ff-dot-dim').length, 10, 'ten teams in the highlighted week');
  eq(stat('fitTeamsR2'), r2Of(inWeek), 'R² of that week\'s ten dots');
  eq(stat('fitTeamsGap'), gapOf(inWeek), 'and their Off perfect');
  ok(before !== stat('fitTeamsR2') + ' ' + stat('fitTeamsGap'), 'both moved off the all-dots figures');
  ok($('fitTeamsNote').textContent.includes(`10 highlighted dots (Wk ${wk})`), 'and the note names the week');
  press(by('fitTeamsBy', 'team'));
  eq(chips('chartFitTeams').length, 10, 'by team: ten chips');
  press(by('fitTeamsBy', 'none'));
  eq(stat('fitTeamsR2'), r2Of(teamPairs), 'back on None the numbers are every dot\'s');
}

// --- nothing new to read on the face of the page ---------------------------
for (const id of ['panelFitTeams', 'panelFitPlayers']) {
  const panel = $(id);
  ok(panel && !panel.hasAttribute('hidden'), `${id} is shown on a played season`);
  eq(all(panel, 'p.lede').length, 0, `${id} adds no lede: the page is at its prose ceiling`);
}
eq(generateDemoSchedule().weeks.length >= 13, true, 'sanity: the demo schedule covers the season');

// --- Week by week on a phone ------------------------------------------------
// linkedom lays nothing out, so this cannot measure a width. What it can hold
// is that the rules which make the table fit are in the page's phone block and
// nowhere wider: measured in Safari's engine at 393px on 2026-10-06, four to
// six week columns plus Avg sit inside the 337px box with them (385px in a
// 363px box without), and the seven measure buttons fill their two rows.
{
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
  const at = css.indexOf('@media (max-width: 760px)');
  const phone = at < 0 ? '' : css.slice(at, css.indexOf('\n}', at));
  const wide = at < 0 ? css : css.slice(0, at) + css.slice(css.indexOf('\n}', at));
  const rule = (sel) => (phone.match(new RegExp(`${sel.replace(/[.#,]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) || ['', ''])[1];
  const px = (decl, prop) => Number((decl.match(new RegExp(`${prop}:\\s*(\\d+)px`)) || [])[1]);
  const cellRule = rule('#weeklyTable th, #weeklyTable td');
  ok(px(cellRule, 'padding-left') <= 3 && px(cellRule, 'padding-right') <= 3,
    'phone: the weekly table\'s cells sit closer than the site\'s 7px', cellRule);
  const name = rule('#weeklyTable .name');
  ok(/width:\s*100%/.test(name) && px(name, 'max-width') >= 56 && px(name, 'max-width') <= 72,
    'phone: its name column takes what is left, down to a floor that six weeks leave room for', name);
  ok(/display:\s*flex/.test(rule('#weeklyMetric')) && /flex-wrap:\s*wrap/.test(rule('#weeklyMetric')) &&
    /flex:\s*1 1/.test(rule('#weeklyMetric button')),
    'phone: the measure buttons share their last row, no empty cell', rule('#weeklyMetric'));
  ok(!/#weeklyTable|#weeklyMetric/.test(wide), 'and none of it applies at laptop width');
  eq(all($('weeklyMetric'), 'button').length, 7, 'seven measures to lay out');
  ok($('weeklyTable').closest('.table-scroll'), 'past six weeks the table scrolls inside its own box');
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
