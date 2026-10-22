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

// Future: the regular-season weeks left, a 0 week LEFT OUT (Tim, 2026-10-16).
// Since 2026-10-22 that is only the rule BEFORE the league's Value lines are
// known (as here, at first paint); with them a 0 counts as the waiver line —
// checked under Proj | Value below.
const futZeroMen = [...rostered].filter((id) => {
  const r = runOf(id, FUTURE);
  return r.all && r.zeros > 0 && r.zeros < FUTURE.length && r1(r.withZeros) !== r1(r.skipZeros);
});
ok(futZeroMen.length > 0, 'the fixture has a rostered man projected 0 in a regular week left');
for (const id of futZeroMen.slice(0, 5)) {
  const r = runOf(id, FUTURE);
  // Tim, 2026-10-16: "only count 0 projections for playoff zeros, not regular
  // season zeros. This means if a player has a bye week 9, don't count it
  // against his future proj avg." So Future skips its zero weeks.
  eq(cellText(rowOf(id), col('Future')).replace(/[▲▼]/g, '').trim(), r1(r.skipZeros).toFixed(1),
    `man ${id}: Future = mean of his ${FUTURE.length - r.zeros} non-zero weeks, the ${r.zeros} zero week(s) left out`);
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
// Tim, 2026-10-16: "make it so if you click a players name in the player
// section or the playoffs section it automatically brings you to the cusome
// trade section with the appropriate user and that specific player selected."
// Another manager's man → `trade.html?with=<his team>&get=<him>`; one of yours
// (the sample league's first squad is yours) → `trade.html?send=<him>`; a free
// agent keeps his link to his row on the Players page. Expected hrefs are built
// here from the generator's own rosters, never through the module.
{
  const me = String(anchorTeams[0].id);
  const idsShown = rows.map((tr) => tr.getAttribute('data-player'));
  const owner = (id) => { const t = ownerOf.get(Number(id)) || ownerOf.get(id); return t ? String(t.id) : null; };
  const theirs = idsShown.filter((id) => owner(id) !== null && owner(id) !== me);
  const mine = idsShown.filter((id) => owner(id) === me);
  const free = idsShown.filter((id) => owner(id) === null);
  ok(theirs.length > 5 && mine.length > 0 && free.length > 0, 'the list has other managers’ men, yours and free agents',
    `${theirs.length}/${mine.length}/${free.length}`);
  const hrefOf = (id) => { const a = rowOf(id).querySelector('td.name a.pref'); return a ? a.getAttribute('href') : null; };
  const badTheirs = theirs.filter((id) => hrefOf(id) !== `trade.html?with=${owner(id)}&get=${id}`);
  ok(badTheirs.length === 0, 'ANOTHER MANAGER’S MAN: his name opens the custom trade with that manager and him ticked',
    badTheirs.slice(0, 3).map((id) => `${id} → ${hrefOf(id)} (owner ${owner(id)})`).join(' | '));
  const badMine = mine.filter((id) => hrefOf(id) !== `trade.html?send=${id}`);
  ok(badMine.length === 0, 'YOUR MAN: his name opens the custom trade with him ticked on your side',
    badMine.slice(0, 3).map((id) => `${id} → ${hrefOf(id)}`).join(' | '));
  const badFree = free.filter((id) => !/^waivers\.html\?player=\d+$/.test(hrefOf(id) || '') || hrefOf(id) !== `waivers.html?player=${id}`);
  ok(badFree.length === 0, 'a free agent’s name still links to his row on the Players page',
    badFree.slice(0, 3).map((id) => `${id} → ${hrefOf(id)}`).join(' | '));
  // A tap on a phone must FOLLOW the link (a real <a>), so the card on an
  // owned man's name is hover-only; a free agent's keeps today's tap card.
  const hoverOnly = (id) => { const a = rowOf(id).querySelector('td.name a.pref'); return Boolean(a && a.hasAttribute('data-tip-hover')); };
  ok([...theirs, ...mine].every(hoverOnly), 'an owned man’s card is hover-only, so a tap on his name goes to the trade',
    [...theirs, ...mine].filter((id) => !hoverOnly(id)).slice(0, 3).join(','));
  ok(free.every((id) => !hoverOnly(id)), 'a free agent’s name keeps its tap card', free.filter(hoverOnly).slice(0, 3).join(','));
}
// Tim, 2026-10-16: "show the regular week by week preview that is shown
// everywhere else in the cite when you hover over a player in the playoffs
// section." The site's player card (js/player-card.js), on a hover of his name.
eq(rows.filter((tr) => tr.querySelector('td.name [data-tip]')).length, rows.length, 'every name carries the site’s player card');
{
  const id = poZeroMen[0];
  const a = rowOf(id).querySelector('td.name [data-tip]');
  a.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  const tip = document.getElementById('tipCard');
  const txt = tip ? tip.textContent.replace(/\s+/g, ' ') : '';
  ok(tip && !tip.hidden && /Proj/.test(txt) && /Week/.test(txt), 'hovering a name opens the card: Week and Proj rows', txt.slice(0, 120));
  ok(PO.every((w) => txt.includes(`${w}`)) && /PO/.test(txt), 'the card runs through the playoff weeks, marked PO', txt.slice(0, 300));
}
// ---------------------------------------------------------------- Proj | Value
// Tim, 2026-10-16: "make a proj / value switch in the playoffs section just
// like the other sectoins." The Players page's switch: a "Show" box, Proj |
// Value, shown once the league's lines are known; on Value every projection x
// prints as valueOf(lines, his position, x) — worked out here BY HAND from the
// sample league's frozen lines, never through the module.
const seasonMod = await import(url('js/season.js'));
const BASE = await seasonMod.fetchValueBase({ demo: true });
ok(BASE && BASE.lines && Object.keys(BASE.lines).length > 0, 'the sample league has Value lines', JSON.stringify(BASE && BASE.lines));
/** js/value.js valueOf, by hand: over the waiver line, below the starter line at half, to the tenth. */
const vOf = (pos, a) => {
  const l = BASE.lines[pos];
  if (!l || typeof a !== 'number') return null;
  if (a <= l.waiver) return 0;
  return Math.round(((Math.min(a, l.starter) - l.waiver) * 0.5 + Math.max(0, a - l.starter)) * 10) / 10;
};
const waitFor = async (pred, ms = 3000) => {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
  return pred();
};
const strip = (s) => s.replace(/[▲▼]/g, '').trim();
const showCtl = () => host.querySelector('#poShowCtl');
ok(await waitFor(() => showCtl() && !showCtl().hidden), 'the Proj | Value box is shown once the lines are known');
{
  const box = showCtl();
  const label = box && box.querySelector('.ctl-label');
  eq(label ? label.textContent.trim() : null, 'Show', 'the box is labelled "Show", as on the Players page');
  const seg = box && box.querySelector('.segmented.seg-sm[role="group"]');
  ok(Boolean(seg), 'the control is the site’s small segmented control');
  const btns = seg ? [...seg.querySelectorAll('button[data-show]')].map((b) => `${b.dataset.show}:${b.textContent.trim()}`) : [];
  eq(btns.join('|'), 'proj:Proj|value:Value', 'Proj then Value');
  ok(box && box.closest('.toolbar') && box.closest('.toolbar').querySelector('#poPosFilter'), 'it sits in the filter box beside Position');
  eq(seg && seg.querySelector('button.on') ? seg.querySelector('button.on').dataset.show : null, 'proj', 'it starts on Proj');
}

// The men to sample: every rostered man projected through the playoffs at a
// position with a line, at least one of whose weeks is worth something.
const sample = [...rostered].filter((id) => {
  const r = runOf(id, PO);
  const pos = cellText(rowOf(id), col('Pos'));
  return r.all && BASE.lines[pos] && r.vals.some((v) => v > 0 && vOf(pos, v) > 0);
}).slice(0, 12);
if (poZeroMen[0] && !sample.includes(poZeroMen[0]) && BASE.lines[cellText(rowOf(poZeroMen[0]), col('Pos'))]) sample.push(poZeroMen[0]);
ok(sample.length >= 5, 'enough men to sample on Value', String(sample.length));
const projHtml = table.querySelector('tbody').innerHTML;
const projHead = table.querySelector('thead').innerHTML;

click('#poShowToggle button[data-show="value"]');
eq(host.querySelector('#poShowToggle button.on') ? host.querySelector('#poShowToggle button.on').dataset.show : null, 'value', 'Value is lit after the click');
let differs = 0, weekCells = 0;
for (const id of sample) {
  const tr = rowOf(id);
  const pos = cellText(tr, col('Pos'));
  const r = runOf(id, PO);
  PO.forEach((w, i) => {
    const v = r.vals[i];
    const txt = strip(cellText(tr, FIXED.length + i));
    if (v === 0) { ok(/^0\.0/.test(txt), `Value: man ${id} week ${w}: a 0 week still prints 0.0`, txt); return; }
    weekCells++;
    eq(txt, vOf(pos, v).toFixed(1), `Value: man ${id} week ${w} = valueOf(${pos}, ${v})`);
    if (vOf(pos, v).toFixed(1) !== v.toFixed(1)) differs++;
  });
  // Tim, 2026-10-22: "I do want to count the 0 everywhere, but not as a pure
  // 0. Make the number the base of that position." A 0 week counts as his
  // position's waiver line, and the cell is ONE Value: valueOf of that mean in
  // points (not a mean of weekly Values). Before: a mean of weekly Values,
  // Future leaving its 0 weeks out.
  const fill = BASE.lines[pos].waiver;
  const filledMean = (vals) => vals.reduce((a, v) => a + (v > 0 ? v : fill), 0) / vals.length;
  const poV = vOf(pos, filledMean(r.vals));
  eq(strip(cellText(tr, col('Playoff'))), poV.toFixed(1), `Value: man ${id} Playoff = valueOf of his mean, a 0 week at the waiver line ${fill}`);
  const fr = runOf(id, FUTURE);
  if (fr.all) {
    const futV = fr.vals.length ? vOf(pos, filledMean(fr.vals)) : null;
    eq(strip(cellText(tr, col('Future'))), futV === null ? '—' : futV.toFixed(1), `Value: man ${id} Future = valueOf of his mean, a 0 week at the waiver line ${fill}`);
    if (futV !== null) eq(cellText(tr, col('PO − Fut')), sign(r1(poV - futV)), `Value: man ${id} PO − Fut of the printed Values`);
  }
  // Avg: ESPN's season average as a Value.
  const avg = glance.byId.get(id) ? glance.byId.get(id).avg : null;
  if (avg !== null && avg !== undefined) {
    const avgV = vOf(pos, avg);
    eq(strip(cellText(tr, col('Avg'))), avgV.toFixed(1), `Value: man ${id} Avg = valueOf(${pos}, ESPN avg ${avg})`);
    eq(cellText(tr, col('PO − Avg')), sign(r1(poV - avgV)), `Value: man ${id} PO − Avg of the printed Values`);
  }
}
ok(weekCells >= 20, 'enough week cells sampled', String(weekCells));
ok(differs > 0, 'on Value the cells really change (the check has teeth)', String(differs));
ok(/as a Value/.test(table.querySelector('thead').innerHTML), 'the headers say the numbers are Values');
eq(fetchCalls.length, 0, 'Value asks the network for nothing');

click('#poShowToggle button[data-show="proj"]');
// (The player card's handle is a fresh counter on every paint; everything else must match.)
const noTip = (s) => s.replace(/data-tip="[^"]*"/g, 'data-tip');
eq(noTip(table.querySelector('tbody').innerHTML) === noTip(projHtml), true, 'back on Proj every cell is what it was');
eq(table.querySelector('thead').innerHTML === projHead, true, 'and the headers too');

// Remembered: Value chosen, a new mount opens on Value.
click('#poShowToggle button[data-show="value"]');

// No lines: no box, and the numbers stay projections even with Value remembered.
{
  const host2 = document.createElement('section');
  host2.className = 'panel';
  document.body.appendChild(host2);
  await mod.mountPlayoffPlayers(host2, { fetchValueBase: async () => null });
  await new Promise((r) => setTimeout(r, 100));
  const box = host2.querySelector('#poShowCtl');
  ok(Boolean(box) && box.hidden, 'with no Value lines the Proj | Value box is hidden');
  const id = sample[0];
  const tr = host2.querySelector(`tbody tr[data-player="${id}"]`);
  const r = runOf(id, PO);
  const i = r.vals.findIndex((v) => v > 0);
  eq(tr ? strip(cellText(tr, FIXED.length + i)) : null, r.vals[i].toFixed(1), 'with no lines a week cell is still his projection');
  host2.remove();
}
{
  const host3 = document.createElement('section');
  host3.className = 'panel';
  document.body.appendChild(host3);
  await mod.mountPlayoffPlayers(host3);
  ok(await waitFor(() => host3.querySelector('#poShowToggle button.on[data-show="value"]')), 'a new visit opens on the Value it was left on');
  const id = sample[0];
  const pos = cellText(rowOf(id), col('Pos'));
  const r = runOf(id, PO);
  const i = r.vals.findIndex((v) => v > 0);
  const tr = host3.querySelector(`tbody tr[data-player="${id}"]`);
  eq(tr ? strip(cellText(tr, FIXED.length + i)) : null, vOf(pos, r.vals[i]).toFixed(1), 'and draws Values');
  host3.remove();
}

// The one-line "Reading the league's players…" row spans the whole table, as
// drawn before the list is in (sweep 2026-10-16 #11: it stopped one short).
{
  const host4 = document.createElement('section');
  host4.className = 'panel';
  document.body.appendChild(host4);
  const going = mod.mountPlayoffPlayers(host4);
  const td = host4.querySelector('tbody tr.empty-row td');
  const nHeads = host4.querySelectorAll('thead th').length;
  ok(Boolean(td), 'a list still loading draws its one-line row');
  eq(td ? Number(td.getAttribute('colspan')) : null, nHeads, 'and that row spans every column of the head');
  await going;
  host4.remove();
}

eq(fetchCalls.length, 0, 'the sample league asks the network for nothing');
eq(rejections.length, 0, 'no unhandled rejection');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
