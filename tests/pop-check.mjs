// THE PREVIEW FOUNDATION (2026-10-08) — js/pop.js, js/links.js and the player
// card's connector half, on their own.
//
// Tim: "If the user is curious about a number or it's breakdown … they should
// be able to hover over it and show a preview. … Also connectors to other
// places in the cite using previews is a huge advantage … build any connectors
// by clicking on the preview."
//
// Every page builder after this one hangs its cards off these exports, so what
// is asserted is the CONTRACT they rely on, by behaviour:
//
//   * a mouse: hover (and keyboard focus) shows the card, moving off hides it,
//     a CLICK follows the card's href, Escape closes;
//   * a finger: a tap opens the same card as a sheet with the link as a button
//     and a Close — and does not navigate;
//   * one preview per number: no `title` on a card element, before or after;
//   * one card open at a time, across the two kinds;
//   * teamWeekCard's rows come to its total;
//   * the four hrefs in js/links.js, spelled once;
//   * playerCardFromWeeks builds the classic card from a week -> teams map,
//     with a week nobody held him drawn as `wait`.
//
// The pointer is ONE global (`matchMedia('(hover: none)')`), flipped between
// sections; nothing else distinguishes the two halves.
//
// Run:  node pop-check.mjs

import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + String(extra).slice(0, 400) : ''}`); }
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------- the harness
const { window, document } = parseHTML('<!doctype html><html><body><main id="host"></main></body></html>');
let coarse = false;
const went = [];            // every href the page was sent to
const matchMedia = (q) => ({
  media: String(q),
  matches: coarse && String(q).includes('hover: none'),
  addEventListener() {}, removeEventListener() {},
});
window.matchMedia = matchMedia;
window.location = { origin: 'http://localhost', href: 'http://localhost/home.html', search: '', assign: (h) => went.push(h) };
const store = new Map();
Object.assign(globalThis, {
  window, document, matchMedia,
  location: window.location,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  },
  HTMLElement: window.HTMLElement, Event: window.Event, Node: window.Node, CustomEvent: window.CustomEvent,
  fetch: async (u) => { throw new Error(`unexpected network call: ${u}`); },
});
window.localStorage = globalThis.localStorage;
if (!window.postMessage) window.postMessage = () => {};

const mod = (f) => import(pathToFileURL(path.join(REPO, f)).href);
const links = await mod('js/links.js');
const pop = await mod('js/pop.js');
const card = await mod('js/player-card.js');

const host = document.getElementById('host');
const $ = (id) => document.getElementById(id);
/** Fire a bubbling event with whatever extra fields the handler reads. */
const fire = (el, type, extra = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, extra);
  el.dispatchEvent(e);
  return e;
};
const open = (id) => { const el = $(id); return !!el && !el.hasAttribute('hidden'); };
const text = (id) => ($(id)?.textContent || '').replace(/\s+/g, ' ').trim();
const reset = () => { pop.hidePop(); card.hideTip(); went.length = 0; coarse = false; };

// =========================================================== js/links.js
eq(links.teamHref(7), 'analysis.html?team=7#rosterDetail', 'teamHref: a team’s roster detail');
eq(links.teamHref(7, 3), 'analysis.html?team=7&week=3#rosterDetail', 'teamHref: on one week');
eq(links.playerHref(4262921), 'waivers.html?player=4262921', 'playerHref: his row on the Players page');
eq(links.playerHref(4262921, 5), 'waivers.html?player=4262921&week=5', 'playerHref: on one week');
eq(links.weekHref(3), 'schedule.html?week=3', 'weekHref');
eq(links.statsHref(), 'stats.html', 'statsHref: the page');
eq(links.statsHref(7), 'stats.html?team=7', 'statsHref: with a team marked');
eq([links.teamHref(null), links.playerHref(undefined), links.weekHref('')], [null, null, null],
  'a missing id is no link at all, never a link to nowhere');
eq(links.teamHref(0), 'analysis.html?team=0#rosterDetail', 'team 0 is a team (0 is not "missing")');
eq(links.readParam('team', '?team=7&week=3'), '7', 'readParam reads a parameter');
eq(links.readParam('nope', '?team=7'), null, 'readParam: absent is null');
eq(links.readIntParam('week', '?week=12'), 12, 'readIntParam: a whole number');
eq(links.readIntParam('week', '?week=all'), null, 'readIntParam: anything else is null');
eq(links.readIntParam('week', '?week=3x'), null, 'readIntParam: a number with a tail is not a number');

// ====================================================== the card's markup
const LUCK = {
  title: 'Kenny <b>',
  sub: 'Luck score',
  rows: [
    { label: 'League avg', value: 119.4 },
    { label: 'Opp Avg', html: '<span class="neg">-125.9</span>' },
    { label: 'Luck/wk', value: 0.7, note: 'per week' },
  ],
  total: { label: 'Luck score', value: -1.3 },
  foot: 'Over 4 weeks',
  href: links.statsHref(3),
  hrefLabel: 'Open standings',
};
{
  const h = pop.statCardHtml(LUCK, false);
  ok(h.includes('Kenny &lt;b&gt;') && !h.includes('<b>'), 'the title is escaped', h);
  ok(/class="muted">· Luck score</.test(h), 'the sub line follows a middle dot, dim');
  ok(/<td class="name">League avg<\/td><td class="num">119\.4<\/td>/.test(h), 'a number prints to one decimal');
  ok(h.includes('<span class="neg">-125.9</span>'), 'trusted html is used as the value');
  ok(/Luck\/wk<span class="sc-note">per week<\/span>/.test(h), 'a note sits beside its label');
  ok(/<tfoot><tr class="sc-total"><td class="name">Luck score<\/td><td class="num">-1\.3<\/td>/.test(h), 'the total is the last line');
  ok(/<div class="sc-foot">Over 4 weeks<\/div>/.test(h), 'the foot line is drawn');
  ok(!/\btitle=/.test(h), 'no title attribute anywhere in the card');
  ok(!/<a |<button/.test(h), 'a hover card carries no control: it cannot be clicked');
  const s = pop.statCardHtml(LUCK, true);
  ok(/<a class="tc-open" href="stats\.html\?team=3">Open standings &rarr;<\/a>/.test(s), 'the sheet gives the link as a button', s);
  ok(/<button type="button" class="tc-close">Close<\/button>/.test(s), 'and a Close');
  const bare = pop.statCardHtml({ title: 'A', rows: [{ label: 'x', value: 1 }], total: 1 }, true);
  ok(!/tc-open/.test(bare) && /tc-close/.test(bare), 'no href: the sheet has Close and no link');
  ok(/<td class="name">Total<\/td><td class="num">1\.0<\/td>/.test(bare), 'a bare total is labelled Total');
  ok(pop.statCardHtml({ title: 'A', rows: [{ label: 'x', value: null }] }).includes('<td class="num">—</td>'),
    'a missing value is a dash, never "null"');
  const led = pop.statCardHtml({ title: 'A', head: ['Wk', 'Opponent', 'Proj'], rows: [{ lead: 5, label: 'Kyle', value: 120 }], totals: [{ label: 'Average', value: 120 }], total: { label: 'Gap', value: 1 } });
  ok(/<thead><tr><th class="num">Wk<\/th><th class="name">Opponent<\/th><th class="num">Proj<\/th>/.test(led), 'column headings, when asked for', led);
  ok(/<tr><td class="num sc-lead">5<\/td><td class="name">Kyle<\/td><td class="num">120\.0<\/td><\/tr>/.test(led), 'a lead column (the week)');
  ok(/<tfoot><tr><td><\/td><td class="name">Average<\/td>.*<tr class="sc-total"><td><\/td><td class="name">Gap<\/td>/.test(led), 'dim lines, then the total, each padded under the lead column');
}

// ====================================================== the attribute
{
  pop.clearPops();
  const a = pop.statCard(LUCK);
  ok(/^ data-pop="n:\d+" data-pop-go tabindex="0"$/.test(a), 'statCard returns the attribute, focusable, marked as going somewhere', a);
  const b = pop.statCard({ title: 'x', rows: [] }, { prefix: 'home', focusable: false });
  ok(/^ data-pop="home:\d+"$/.test(b), 'no href: no go mark; focusable:false: no tabindex', b);
  ok(!/title=/.test(a + b), 'the attribute never carries a title');
}

// ====================================================== a mouse
pop.clearPops();
host.innerHTML =
  `<table><tbody><tr>` +
  `<td id="go"${pop.statCard(LUCK)} title="stale">-1.3</td>` +
  `<td id="plain"${pop.statCard({ title: 'Plain', rows: [{ label: 'a', value: 1 }] })}>1.0</td>` +
  `<td id="inner"${pop.statCard(LUCK)}><a id="innerA" href="elsewhere.html">x</a></td>` +
  `<td id="none">no card</td>` +
  `</tr></tbody></table>`;
pop.wirePops(host);
pop.wirePops(host);          // a second call must not double the listeners
{
  reset();
  fire($('go'), 'mouseover');
  ok(open('statCard'), 'hover opens the card');
  ok(/^Kenny <b> · Luck score/.test(text('statCard')), 'with that figure’s card', text('statCard'));
  eq($('statCard').getAttribute('role'), 'tooltip', 'a hover card is a tooltip');
  ok(!$('statCard').classList.contains('sheet') && !$('statCard').querySelector('.tc-actions'), 'not a sheet, no buttons');
  ok($('statCard').classList.contains('tipcard'), 'it wears the player card’s frame (.tipcard)');
  ok(!$('go').hasAttribute('title'), 'ONE PREVIEW PER NUMBER: a title found on the element is removed');
  eq(document.querySelectorAll('#statCard').length, 1, 'one card element');
  fire($('go'), 'mouseout');
  ok(!open('statCard'), 'moving off closes it');

  fire($('go'), 'mouseover');
  fire($('go'), 'mouseout', { relatedTarget: $('go').firstChild?.parentElement === $('go') ? $('go') : null });
  fire($('none'), 'mouseover');
  fire($('plain'), 'mouseover');
  ok(/^Plain/.test(text('statCard')), 'the next figure replaces the card');
  fire($('plain'), 'mouseout');

  fire($('go'), 'focusin');
  ok(open('statCard'), 'keyboard focus opens it');
  fire($('go'), 'focusout');
  ok(!open('statCard'), 'and blur closes it');

  fire($('go'), 'mouseover');
  fire(document, 'keydown', { key: 'Escape' });
  ok(!open('statCard'), 'Escape closes it');

  // THE CONNECTOR
  fire($('go'), 'mouseover');
  const e = fire($('go'), 'click');
  eq(went, ['stats.html?team=3'], 'a click follows the card’s href');
  ok(e.defaultPrevented && !open('statCard'), 'and the card is gone on the way');
  went.length = 0;
  fire($('plain'), 'click');
  eq(went, [], 'a figure with no href goes nowhere on click');
  fire($('go'), 'click', { ctrlKey: true });
  fire($('go'), 'click', { button: 1 });
  eq(went, [], 'ctrl-click and middle-click are left alone');
  fire($('innerA'), 'click');
  eq(went, [], 'a real link inside the figure keeps its own click');
  fire($('go'), 'keydown', { key: 'Enter' });
  eq(went, ['stats.html?team=3'], 'Enter follows it from the keyboard');
  went.length = 0;
  fire($('none'), 'click');
  eq(went, [], 'an element with no card is not touched');
}

// ====================================================== a finger
{
  reset();
  coarse = true;
  fire($('go'), 'mouseover');
  ok(!open('statCard'), 'the mouseover a tap fires does not open a hover card');
  let reachedDocument = 0;
  const spy = () => { reachedDocument++; };
  document.addEventListener('click', spy);
  const e = fire($('go'), 'click');
  document.removeEventListener('click', spy);
  ok(open('statCard') && $('statCard').classList.contains('sheet'), 'a tap opens the card as a sheet');
  eq($('statCard').getAttribute('role'), 'dialog', 'a sheet is a dialog');
  eq(went, [], 'the tap does not navigate');
  ok(e.defaultPrevented, 'and is swallowed (no link followed underneath)');
  eq(reachedDocument, 0, 'and never reaches the document, where js/touch-titles.js and the outside-tap closer wait');
  const link = $('statCard').querySelector('a.tc-open');
  ok(link && link.getAttribute('href') === 'stats.html?team=3' && /Open standings/.test(link.textContent),
    'the sheet carries the link as a button', $('statCard').innerHTML);
  ok($('statCard').querySelector('button.tc-close'), 'and a Close');
  fire($('go'), 'mouseout');
  ok(open('statCard'), 'a sheet is not dismissed by drift');
  fire(link, 'click');
  ok(open('statCard'), 'a tap on the link is left to the link');
  fire($('statCard').querySelector('.tc-close'), 'click');
  ok(!open('statCard'), 'Close closes it');
  fire($('plain'), 'click');
  ok(open('statCard') && !$('statCard').querySelector('.tc-open'), 'a card with no href: a sheet with no link');
  fire($('none'), 'click');
  ok(!open('statCard'), 'a tap outside closes it');
  fire($('go'), 'click');
  fire(document, 'keydown', { key: 'Escape' });
  ok(!open('statCard'), 'Escape closes a sheet too');
}

// ============================== any element, the card built when asked for
{
  reset();
  const box = document.createElement('div');
  box.innerHTML = '<span class="fig" data-k="a" title="t">1</span><span class="fig" data-k="none">2</span>';
  document.body.appendChild(box);
  let asked = 0;
  pop.wirePops(box, { selector: '.fig', card: (el) => { asked++; return el.dataset.k === 'a' ? { title: 'Built late', rows: [{ label: 'r', value: 2 }] } : null; } });
  const [a, none] = box.querySelectorAll('.fig');
  fire(a, 'mouseover');
  ok(open('statCard') && /^Built late/.test(text('statCard')) && asked === 1, 'selector + card(el): built on demand, nothing registered');
  ok(!a.hasAttribute('title'), 'and its title is removed too');
  fire(a, 'mouseout');
  fire(none, 'mouseover');
  ok(!open('statCard'), 'card(el) returning null opens nothing');
}

// ====================================================== a team's week
{
  const starters = [
    { slot: 'QB', name: 'Josh Allen', pts: 24.36, proj: 21.1 },
    { slot: 'RB', name: 'Bijan Robinson', pts: 18.24 },
    { slot: 'WR', name: 'Puka Nacua', pts: 9.94, proj: 14.2 },
  ];
  const spec = pop.teamWeekSpec({ team: 'Kenny', week: 5, total: 52.54, starters, href: links.teamHref(3, 5) });
  eq([spec.title, spec.sub], ['Kenny', 'Week 5'], 'team and week on the top line');
  eq(spec.rows.slice(0, 3).map((r) => [r.lead, r.label, r.value]), [['QB', 'Josh Allen', 24.36], ['RB', 'Bijan Robinson', 18.24], ['WR', 'Puka Nacua', 9.94]],
    'slot, name and points a row');
  eq(spec.rows.map((r) => r.note), ['proj 21.1', '', 'proj 14.2'], 'his projection beside his name, when given');
  const t10 = (v) => Math.round(v * 10);
  eq(spec.rows.reduce((a, r) => a + t10(r.value), 0), t10(52.54), 'the printed rows come to the printed total, to the tenth');
  eq(spec.rows.length, 3, '24.4 + 18.2 + 9.9 is 52.5: nothing to explain, so no extra row');
  const exact = pop.teamWeekSpec({ team: 'K', week: 1, total: 30, starters: [{ slot: 'QB', name: 'a', pts: 10 }, { slot: 'RB', name: 'b', pts: 20 }] });
  eq(exact.rows.length, 2, 'no Rounding row when the rows already add up');
  const off = pop.teamWeekSpec({ team: 'K', week: 1, total: 30.1, starters: [{ slot: 'QB', name: 'a', pts: 10.04 }, { slot: 'RB', name: 'b', pts: 20.04 }] });
  eq(off.rows.map((r) => [r.label, r.value]), [['a', 10.04], ['b', 20.04], ['Rounding', 0.1]], 'a tenth lost to rounding is its own row');
  eq([spec.href, spec.hrefLabel], ['analysis.html?team=3&week=5#rosterDetail', 'Open roster'], 'the connector, and its default label');
  eq(spec.total, { label: 'Total', value: 52.54 }, 'the total is the last line');
  const attr = pop.teamWeekCard({ team: 'Kenny', week: 5, total: 52.5, starters, href: links.teamHref(3, 5) });
  ok(/^ data-pop="n:\d+" data-pop-go tabindex="0"$/.test(attr), 'teamWeekCard returns the same attribute as statCard', attr);
  const h = pop.statCardHtml(spec, true);
  ok(/Kenny <span class="muted">· Week 5<\/span>/.test(h) && /<a class="tc-open" href="analysis\.html\?team=3&amp;week=5#rosterDetail">Open roster/.test(h), 'and draws as a stat card', h);
}

// ====================================================== the player card
const P = { playerId: 77, name: 'Puka Nacua', position: 'WR', proTeam: 'LAR', proTeamId: 14, seasonAvg: 15.1, posRank: 4 };
const man = (o) => ({ ...P, ...o });
const WEEKS = new Map([
  [1, [{ id: 1, players: [man({ projected: 14.2, actual: 18.4 })] }, { id: 2, players: [] }]],
  [2, [{ id: 1, players: [] }, { id: 2, players: [man({ projected: 13.1, actual: 9.9 })] }]],   // traded: another roster
  [3, [{ id: 1, players: [] }, { id: 2, players: [] }]],                                         // nobody held him
  // week 4 was never read
  [5, [{ id: 2, players: [man({ projected: 21.7, pregame: 15.5, done: true, seasonAvg: 16.0, posRank: 3, injuryStatus: 'QUESTIONABLE' })] }]],
  [6, [{ id: 2, players: [man({ projected: 12.5, actual: 4.4, done: false })] }]],
]);
{
  const c = card.playerCardFromWeeks(WEEKS, P, { weeks: [1, 2, 3, 4, 5, 6], currentWeek: 5 });
  eq(c.ident, 'Puka Nacua · WR · LAR · QUESTIONABLE', 'his main details on the top line');
  eq(c.href, 'waivers.html?player=77', 'the connector defaults to his row on the Players page');
  eq(c.glance, { avg: 16, proj: 15.5, rank: 3, pos: 'WR' }, 'the glance line: ESPN’s avg, THIS week’s projection (pre-game), and rank');
  ok(c.run && c.run.cols.length === 6, 'one column a week', JSON.stringify(c.run && c.run.cols.length));
  const cols = c.run.cols;
  const flat = JSON.stringify(cols);
  ok(/14\.2/.test(JSON.stringify(cols[0])) && /18\.4/.test(JSON.stringify(cols[0])), 'week 1: projection and score', JSON.stringify(cols[0]));
  ok(/13\.1/.test(JSON.stringify(cols[1])), 'week 2: found on ANOTHER roster — the card is about him, not a squad', JSON.stringify(cols[1]));
  ok(/wait/.test(JSON.stringify(cols[2])) && !/"off"/.test(JSON.stringify(cols[2])), 'week 3: nobody held him — `wait`, not `off`', JSON.stringify(cols[2]));
  ok(/wait/.test(JSON.stringify(cols[3])), 'week 4: never read — `wait`', JSON.stringify(cols[3]));
  ok(/15\.5/.test(JSON.stringify(cols[4])) && /21\.7/.test(JSON.stringify(cols[4])),
    'week 5, finished early: Proj is the pre-game number and Act his score, never his score twice', JSON.stringify(cols[4]));
  ok(/12\.5/.test(JSON.stringify(cols[5])) && !/4\.4/.test(JSON.stringify(cols[5])), 'week 6, still playing: a running score is not a result', JSON.stringify(cols[5]));
  ok(!/NaN|undefined/.test(flat), 'no NaN or undefined in the run');
  ok(/weeks 1–6/.test(c.run.heading), 'the heading names the span', c.run.heading);

  const asObject = card.playerCardFromWeeks(Object.fromEntries(WEEKS), P, { currentWeek: 5 });
  eq(asObject.run.cols.length, 5, 'a plain object works, and with no `weeks` it draws every week it holds');
  const none = card.playerCardFromWeeks(new Map([[1, [{ players: [] }]], [2, [{ players: [] }]]]), P, { weeks: [1, 2] });
  ok(none.run && /Not read yet/.test(none.run.pending || ''), 'a man held in no week at all says so, rather than drawing empty columns', JSON.stringify(none.run));
  eq(none.glance, { avg: 15.1, proj: null, rank: 4, pos: 'WR' }, '…and his glance line falls back to the player handed in');
  eq(card.playerCardFromWeeks(WEEKS, { name: 'No Id', position: 'K' }, { weeks: [1] }).href, null, 'no playerId: no link');
  eq(card.playerCardFromWeeks(WEEKS, P, { weeks: [1], href: 'x.html', openLabel: 'Go' }).href, 'x.html', 'the caller can point it elsewhere');

  // On the page: hover shows the classic card; a click on a `go` element follows it.
  reset();
  card.clearRuns();
  const key = card.registerRun(c, 'home');
  const key2 = card.registerRun({ ...c, href: null }, 'home');
  const a = card.tipAttr(key, { go: true });
  ok(/^ data-tip="home:\d+" data-tip-go$/.test(a), 'tipAttr(key, { go: true }) marks the element', a);
  ok(!/data-tip-go/.test(card.tipAttr(key)), 'and it is opt-in');
  const box = document.createElement('div');
  box.innerHTML =
    `<span id="pGo"${a}>Puka Nacua</span><span id="pPlain"${card.tipAttr(key)}>Puka</span>` +
    `<span id="pNoHref"${card.tipAttr(key2, { go: true })}>Puka</span>` +
    `<label id="pLabel"${a}><input id="pBox" type="checkbox">Puka</label>`;
  document.body.appendChild(box);
  card.wireTips(box);
  fire($('pGo'), 'mouseover');
  ok(open('tipCard') && /Puka Nacua · WR · LAR/.test(text('tipCard')), 'hover opens the classic player card', text('tipCard').slice(0, 200));
  ok(/Avg 16\.0? · Proj 15\.5 · WR #3/.test(text('tipCard')), 'with the glance line', text('tipCard').slice(0, 200));
  ok($('tipCard').querySelector('.tc-run'), 'and the week / proj / act chart');
  fire($('pGo'), 'click');
  eq(went, ['waivers.html?player=77'], 'a mouse click on a `go` element follows the card’s href');
  ok(!open('tipCard'), 'and closes the card');
  went.length = 0;
  fire($('pPlain'), 'click');
  fire($('pNoHref'), 'click');
  fire($('pBox'), 'click');
  fire($('pGo'), 'click', { metaKey: true });
  eq(went, [], 'not without `go`, not without an href, not through a control inside it, not with a modifier');
  fire($('pGo'), 'keydown', { key: 'Enter' });
  eq(went, ['waivers.html?player=77'], 'Enter follows it from the keyboard');
  went.length = 0;

  coarse = true;
  const e = fire($('pGo'), 'click');
  ok(open('tipCard') && $('tipCard').classList.contains('sheet') && e.defaultPrevented && went.length === 0,
    'a tap opens the sheet and does not navigate');
  const btn = $('tipCard').querySelector('a.tc-open');
  ok(btn && btn.getAttribute('href') === 'waivers.html?player=77', 'whose button is the link', $('tipCard').innerHTML.slice(-300));
  ok($('tipCard').querySelector('.tc-close'), 'beside a Close');
  coarse = false;
  card.hideTip();

  // showCard: beside any element (the scatter chart's dots use this).
  ok(card.showCard(key, $('pPlain')) === true && open('tipCard'), 'showCard(key, el) opens a registered card beside any element');
  ok(card.showCard('nope:1', $('pPlain')) === false, 'and says so when there is no such card');

  // ONE CARD OPEN AT A TIME, site-wide.
  card.showCard(key, $('pPlain'));
  fire($('go'), 'mouseover');
  ok(open('statCard') && !open('tipCard'), 'opening a stat card closes the player card');
  card.showCard(key, $('pPlain'));
  ok(open('tipCard') && !open('statCard'), 'and the reverse');
  reset();
}

// ================================================= the player card's Value
//
// Tim, 2026-10-09: "I want it to be displayed at the top of the player's
// preview." First on the line under the name; a card with no Value is the card
// it was before Value existed.
{
  const c = card.playerCardFromWeeks(WEEKS, P, { weeks: [1, 2, 3, 4, 5, 6], currentWeek: 5 });
  const OLD_HEAD = '<div class="tc-ident">Puka Nacua · WR · LAR · QUESTIONABLE</div>' +
    '<div class="tc-glance">Avg <b>16.0</b> · Proj <b>15.5</b> · WR <b>#3</b></div>';
  const html = () => $('tipCard').innerHTML;
  const show = (key) => { card.hideTip(); card.showCard(key, $('pPlain')); return html(); };

  eq(c.playerId, 77, 'playerCardFromWeeks passes his playerId through');
  eq(card.playerCardFromWeeks(WEEKS, { name: 'No Id', position: 'K' }, { weeks: [1] }).playerId, null, '…and null for a man with none');

  reset();
  card.clearRuns();
  card.setValueSource(null);
  const { playerId: _id, ...bare } = c;
  const kBare = card.registerRun(bare, 'val');          // no playerId, no value
  const kId = card.registerRun(c, 'val');               // his playerId only
  const kNum = card.registerRun({ ...bare, value: 5.5 }, 'val');
  const kBoth = card.registerRun({ ...c, value: 2 }, 'val');
  const kZero = card.registerRun({ ...bare, value: 0 }, 'val');
  const kOnly = card.registerRun({ ident: 'Some Kicker · K', value: 1.25 }, 'val');
  const kJunk = card.registerRun({ ...bare, value: 'lots' }, 'val');

  // WITHOUT a value: the card as it always was.
  const before = show(kBare);
  ok(before.startsWith(OLD_HEAD), 'no value: the top of the card is byte for byte what it was', before.slice(0, 220));
  ok(!/Value|tc-value/.test(before), '…and nothing about Value anywhere in it', before.slice(0, 220));
  eq(show(kId), before, 'a playerId with no source set: the same card exactly');
  eq(show(kJunk), before, 'a value that is not a number: the same card exactly');
  eq(card.glanceHtml(c.glance), '<div class="tc-glance">Avg <b>16.0</b> · Proj <b>15.5</b> · WR <b>#3</b></div>', 'glanceHtml(glance) alone is unchanged (the Players page calls it)');
  eq(card.glanceHtml(null), '', '…and still nothing for no glance');

  // A `value` handed in.
  const withNum = show(kNum);
  ok(withNum.startsWith('<div class="tc-ident">Puka Nacua · WR · LAR · QUESTIONABLE</div>' +
    '<div class="tc-glance"><span class="tc-value">Value <b>5.5</b></span> · Avg <b>16.0</b>'),
    'value: "Value 5.5" is FIRST on the line under the name', withNum.slice(0, 260));
  ok(/^Puka Nacua · WR · LAR · QUESTIONABLE ?Value 5\.5 · Avg 16\.0 · Proj 15\.5 · WR #3/.test(text('tipCard')),
    '…above the chart, before ESPN’s three', text('tipCard').slice(0, 160));
  eq(withNum.replace('<span class="tc-value">Value <b>5.5</b></span> · ', ''), before, '…and it is the only thing that changed in the card');
  ok(/Value <b>0\.0<\/b>/.test(show(kZero)), 'a Value of 0 is shown as 0.0, not hidden', html().slice(0, 220));
  ok(show(kOnly).startsWith('<div class="tc-ident">Some Kicker · K</div><div class="tc-glance"><span class="tc-value">Value <b>1.3</b></span></div>'),
    'a man with a Value and no glance numbers gets a line with only that', html().slice(0, 220));

  // A `playerId`, looked up when the card OPENS.
  const asked = [];
  let table = new Map();      // nothing yet: the page's values have not arrived
  card.setValueSource((id) => { asked.push(id); return table.get(id); });
  eq(show(kId), before, 'a source with no number for him: the same card exactly');
  eq(asked, [77], 'the source is asked for HIS playerId');
  table = new Map([[77, 7.25]]);
  ok(/<span class="tc-value">Value <b>7\.3<\/b><\/span> · Avg/.test(show(kId)),
    'values that arrive AFTER the card was registered show the next time it opens', html().slice(0, 220));
  fire($('pPlain'), 'mouseout');
  card.hideTip();
  eq(show(kBare), before, 'a card registered with no playerId never asks, and is unchanged');
  asked.length = 0;
  ok(/Value <b>2\.0<\/b>/.test(show(kBoth)) && asked.length === 0, 'a `value` handed in wins over the source, which is not asked', `${html().slice(0, 200)} asked ${JSON.stringify(asked)}`);
  card.setValueSource(() => { throw new Error('boom'); });
  eq(show(kId), before, 'a source that throws costs the Value, never the card');
  card.setValueSource(() => 'seven');
  eq(show(kId), before, 'a source that answers with something that is not a number: no Value');
  card.setValueSource(null);
  eq(show(kId), before, 'setValueSource(null) takes the source away');
  reset();
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
