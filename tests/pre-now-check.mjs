// The Stats page's "Preseason vs now — players" panel, on the REAL stats.html +
// js/stats-page.js, booted on the fixture league (pre-now-fixture.mjs: 10 squads
// of 16, a 150-man wire) with js/season.js stubbed and no network.
//
// Tim, 2026-10-11: "could you add a chart in the stats section that has to do
// with the proj vs actual that is the proj season avg (before the season
// started) vs the current season avg for every player? Allow the user to
// sort/filter them by position, rostered, or user."
//
//   node pre-now-check.mjs            -> every scenario, each in its own process
//   node pre-now-check.mjs <scenario> -> child mode
//
//   live        the panel: both views, the switch, each filter on both views,
//               the filters agreeing, the sort, the links and cards
//   demo        the sample league: no panel, no request
//   past        an earlier season: no panel, the wire never asked for
//   norules     scoring not known: no panel
//   zero        nothing played: no panel
//   synced      the phone's copy WITHOUT the week's wire: rostered only, one
//               line saying so, and the wire is never asked for (rule 20)
//   syncedwire  the phone's copy with it: free agents shown
//   wirefail    the wire read throws: rostered only, one line saying so
//
// THE FINISHED SIGNAL is the panel's own: its note says how many free agents it
// holds, or that they were not read. Polled, never slept through.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';
import * as fx from './pre-now-fixture.mjs';

const SCEN = process.argv[2];
const SCENARIOS = ['live', 'demo', 'past', 'norules', 'zero', 'synced', 'syncedwire', 'wirefail'];
const repoUrl = (p) => pathToFileURL(path.join(REPO, p)).href;

async function boot(scenario) {
  const { window, document } = parseHTML(readFileSync(path.join(REPO, 'stats.html'), 'utf8'));

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
  if (scenario !== 'demo') {
    // No team chosen: the bell (js/notify-load.js) then reads nothing of its own.
    store.set('ff.connection', JSON.stringify({ leagueId: '112233', season: scenario === 'past' ? 2025 : fx.SEASON }));
    store.set('ff.prefs', JSON.stringify({ 'stats.source': 'live' }));
  }
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
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };

  // The preseason copy is the fixture's, handed to the module the page imports.
  const trend = await import(repoUrl('js/proj-trend.js'));
  trend.setBaseline(fx.baseline());

  let stub = null;
  if (scenario !== 'demo') {
    const { register } = await import('node:module');
    register('./pre-now-loader.mjs', import.meta.url);
    stub = await import('./pre-now-stub-season.mjs');
  }
  await import(repoUrl('js/stats-page.js'));
  await import(repoUrl('js/connection.js'));

  return { window, document, store, errors, fetchCalls, stub, restore: () => { console.error = orig; } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const got = fn();
    if (got || Date.now() > end) return got;
    await sleep(20);
  }
}

async function run(scenario) {
  let pass = 0;
  const problems = [];
  const ok = (c, msg, extra = '') => {
    if (c) pass++;
    else problems.push(`${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`);
  };
  const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

  const page = await boot(scenario);
  const { window, document, store, stub } = page;
  const $ = (id) => document.getElementById(id);
  const all = (root, sel) => (root ? Array.from(root.querySelectorAll(sel)) : []);
  const clean = (s) => (s || '').replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim();
  const panel = $('panelPreNow');
  const shown = () => !panel.hasAttribute('hidden');
  const note = () => clean($('preNowNote').textContent);
  const wireCalls = () => (stub ? stub.calls.filter((c) => c.startsWith('fetchWireWeek')) : []);
  const press = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
  const btn = (id, attr, v) => $(id).querySelector(`button[data-${attr}="${v}"]`);
  const dots = () => all($('chartPreNow'), 'circle.ff-dot');
  const rows = () => all($('preNowTable'), 'tbody tr').filter((tr) => tr.children.length === 6)
    .map((tr) => {
      const c = Array.from(tr.children);
      const a = c[0].querySelector('a');
      return {
        id: Number((/player=(\d+)/.exec((a && a.getAttribute('href')) || '') || [])[1]),
        name: clean(c[0].textContent), pos: clean(c[1].textContent),
        pre: clean(c[2].textContent), avg: clean(c[3].textContent), diff: clean(c[4].textContent),
        diffV: Number(c[4].getAttribute('data-v')), team: clean(c[5].textContent),
        tip: a ? a.getAttribute('data-tip') : null, link: a ? a.getAttribute('href') : null,
      };
    });

  ok(panel, 'stats.html has the panel');
  // Where it sits: directly after the row that holds the two projected-vs-actual graphs.
  const before = panel.previousElementSibling;
  ok(before && before.querySelector('#panelFitPlayers'), 'directly after "Projected vs actual — players"');
  eq(clean(panel.querySelector('h2').textContent), 'Preseason vs now — players', 'under its heading');

  // -------------------------------------------------------- the hidden states
  if (['demo', 'past', 'norules', 'zero'].includes(scenario)) {
    // The page's own finished signal: Schedule luck has drawn its bars (or, with
    // nothing to draw them from, said so) - the same read the panel waits on.
    // The sample league draws the neighbouring players graph instead.
    const settled = await until(() => all($('oppProjChart'), '.bar').length > 0 ||
      all($('chartFitPlayers'), 'circle.ff-dot').length > 0 ||
      /no fixtures|no usable|could not/i.test($('oppProjChart').textContent), 15000);
    ok(settled, 'the page reached its own finished state within the poll’s ceiling');
    await sleep(150);
    ok(!shown(), 'the panel is not shown');
    eq(dots().length, 0, 'and no dot was drawn');
    eq(wireCalls().length, 0, 'the free agents were never asked for');
    eq(page.fetchCalls.length, 0, 'and nothing went to the network');
    page.restore();
    eq(page.errors.length, 0, `no console error${page.errors[0] ? ` (${page.errors[0]})` : ''}`);
    return { pass, problems };
  }

  // ------------------------------------------------- rostered only, said so
  if (scenario === 'synced' || scenario === 'wirefail') {
    const done = await until(() => shown() && /free agents not read/.test(note()) && !$('preNowMsg').hasAttribute('hidden'));
    ok(done, 'the page reached its own finished state within the poll’s ceiling', note().slice(0, 200));
    const want = fx.expected({ wire: false });
    eq(dots().length, want.length, 'the graph holds the squads’ players alone');
    eq(rows().length, want.length, 'and so does the list');
    ok(rows().every((r) => r.team !== 'Free agent'), 'no free agent is listed');
    const said = clean($('preNowMsg').textContent);
    if (scenario === 'synced') {
      eq(said, 'Free agents are not in the synced copy: rostered players only.', 'one short line says why');
      eq(wireCalls().length, 0, 'and the wire was NEVER asked for: a synced copy must not fall through to ESPN');
      ok(stub.calls.includes('cloudSource'), 'because the copy was asked what it holds first');
    } else {
      eq(said, 'Free agents could not be read: rostered players only.', 'one short line says so');
      eq(wireCalls().length, 1, 'the failed read is not retried on every repaint');
    }
    ok(said.split(' ').length <= 15, 'in under fifteen words');
    // Rostered does not show free agents, so it has nothing to apologise for.
    press(btn('preNowRos', 'ros', 'rostered'));
    ok($('preNowMsg').hasAttribute('hidden'), 'the line goes when Rostered is chosen');
    eq(rows().length, want.length, 'and the same players stay');
    press(btn('preNowRos', 'ros', 'free'));
    eq(dots().length, 0, 'Free agents: an empty graph');
    ok(/No player matches/.test($('preNowTable').textContent), 'and a list that says nobody matches');
    ok(!$('preNowMsg').hasAttribute('hidden'), 'with the line back');
    eq(wireCalls().length, scenario === 'synced' ? 0 : 1, 'and still no further read');
    eq(page.fetchCalls.length, 0, 'nothing went to the network');
    page.restore();
    eq(page.errors.length, 0, `no console error${page.errors[0] ? ` (${page.errors[0]})` : ''}`);
    return { pass, problems };
  }

  // ---------------------------------------------------------------- the panel
  const want = fx.expected();
  const free = want.filter((w) => w.teamId === null);
  const done = await until(() => shown() && /most-owned free agents/.test(note()));
  ok(done, 'the page reached its own finished state within the poll’s ceiling', note().slice(0, 200));
  eq(wireCalls().join(), `fetchWireWeek:${fx.CURRENT}`, 'ONE wire read, for the current week');
  ok($('preNowMsg').hasAttribute('hidden'), 'no warning line when the free agents were read');

  if (scenario === 'syncedwire') {
    eq(dots().length, want.length, 'a synced copy that holds the week’s wire shows its free agents');
    eq(rows().filter((r) => r.team === 'Free agent').length, free.length, 'all of them');
    page.restore();
    eq(page.errors.length, 0, `no console error${page.errors[0] ? ` (${page.errors[0]})` : ''}`);
    return { pass, problems };
  }

  const wantById = new Map(want.map((w) => [w.id, w]));
  eq(dots().length, want.length, `the graph draws one dot a player (${want.length})`);
  eq(rows().length, want.length, 'and the list one row a player');
  ok(note().includes(`${want.length} players: ${want.length - free.length} on a roster in week ${fx.CURRENT}, ` +
    `and ${free.length} of the 150 most-owned free agents`), 'the note states those counts (rule 7)', note().slice(0, 400));
  ok(!$('preNowNote').closest('details').hasAttribute('open'), 'behind the toggle, closed');
  eq(all($('chartPreNow'), 'line.ff-perfect').length, 1, 'the y = x line is drawn');
  ok(/No change/.test($('chartPreNow').textContent), 'and named');
  ok(/Preseason avg/.test($('chartPreNow').textContent) && /Season avg/.test($('chartPreNow').textContent),
    'both axes are labelled');

  // Every row against the fixture's own arithmetic.
  let bad = '';
  for (const r of rows()) {
    const w = wantById.get(r.id);
    const sign = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
    if (!w || r.pre !== w.pre.toFixed(1) || r.avg !== (Math.round(w.avg * 10) / 10).toFixed(1) ||
        r.diff !== sign(w.diff) || r.team !== w.team || r.pos !== (w.position === 'DST' ? 'D/ST' : w.position)) {
      bad = bad || `${JSON.stringify(r)} vs ${JSON.stringify(w)}`;
    }
    if (Math.abs(Number(r.avg) - Number(r.pre) - Number(r.diff.replace('+', ''))) > 0.051) bad = bad || `Diff of ${r.name}`;
  }
  eq(bad, '', 'every row prints his Pre, Avg, Diff = Avg − Pre, position and team');
  const first = rows()[0];
  ok(first.link === `waivers.html?player=${first.id}` && first.tip, 'a name links to him on Players and carries his card');
  eq(new Set(rows().map((r) => r.tip)).size, want.length, 'one card a player');
  ok(all($('preNowTable'), 'td[class*="heat"]').length > 20, 'the Diff column is on the red–green scale');

  // Default sort: Diff, biggest first.
  const sortedDesc = (list) => list.every((v, i) => i === 0 || list[i - 1] >= v);
  const sortedAsc = (list) => list.every((v, i) => i === 0 || list[i - 1] <= v);
  ok(sortedDesc(rows().map((r) => r.diffV)), 'the list opens on Diff, biggest first');
  eq(rows()[0].diffV, Math.max(...want.map((w) => w.avg - w.pre)), 'the top row is the biggest riser');
  const head = (text) => all($('preNowTable'), 'th').find((th) => clean(th.textContent) === text);
  eq(all($('preNowTable'), 'th').map((th) => clean(th.textContent)).join(' '), 'Player Pos Pre Avg Diff Team', 'the columns');
  press(head('Pre'));
  ok(sortedDesc(rows().map((r) => Number(r.pre))), 'pressing Pre sorts by it, biggest first');
  press(head('Pre'));
  ok(sortedAsc(rows().map((r) => Number(r.pre))), 'pressing it again reverses');
  press(head('Player'));
  press(head('Player'));
  ok(sortedAsc(rows().map((r) => r.name.toLowerCase())) || rows().map((r) => r.name).join() ===
    rows().map((r) => r.name).sort((a, b) => a.localeCompare(b)).join(), 'and Player sorts by name');
  press(head('Diff'));

  // The view switch: both stay in the layout, one is out of reach; remembered.
  const offOf = (id) => $(id).getAttribute('aria-hidden') === 'true' && $(id).hasAttribute('inert');
  const pref = () => JSON.parse(store.get('ff.prefs') || '{}')['stats.preNowView'];
  ok(!offOf('chartPreNow') && offOf('preNowList'), 'it opens on the graph, the list out of reach');
  eq(btn('preNowView', 'view', 'chart').getAttribute('aria-pressed'), 'true', 'Chart is the pressed button');
  press(btn('preNowView', 'view', 'list'));
  ok(offOf('chartPreNow') && !offOf('preNowList'), 'List shows the list and puts the graph out of reach');
  eq(btn('preNowView', 'view', 'list').getAttribute('aria-pressed'), 'true', 'List is the pressed button');
  eq(pref(), 'list', 'and the choice is remembered (js/prefs.js)');
  eq(dots().length, want.length, 'the graph is still drawn underneath, so nothing resizes');
  press(btn('preNowView', 'view', 'chart'));
  ok(!offOf('chartPreNow') && offOf('preNowList') && pref() === undefined, 'Chart puts it back and forgets the choice');

  // Position: every button narrows both views to the fixture's own count.
  const chips = () => all($('chartPreNow'), 'button[data-group]').map((b) => clean(b.textContent)).join(' ');
  eq(chips(), 'QB RB WR TE K D/ST', 'All positions: coloured by position, a chip each');
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
    press(btn('preNowPos', 'pos', pos));
    const n = want.filter((w) => w.position === pos).length;
    eq(dots().length, n, `Position ${pos}: ${n} dots`);
    eq(rows().length, n, `Position ${pos}: ${n} rows`);
    ok(rows().every((r) => r.pos === (pos === 'DST' ? 'D/ST' : pos)), `Position ${pos}: nobody else`);
    eq(btn('preNowPos', 'pos', pos).getAttribute('aria-pressed'), 'true', `Position ${pos}: its button is pressed`);
    eq(chips(), '', `Position ${pos}: one position, no chips`);
  }
  press(btn('preNowPos', 'pos', 'all'));
  eq(dots().length, want.length, 'All brings everybody back');

  // Rostered.
  press(btn('preNowRos', 'ros', 'rostered'));
  eq(dots().length, want.length - free.length, 'Rostered: the squads’ players on the graph');
  ok(rows().length === want.length - free.length && rows().every((r) => r.team !== 'Free agent'), 'and in the list');
  press(btn('preNowRos', 'ros', 'free'));
  eq(dots().length, free.length, 'Free agents: the wire’s players on the graph');
  ok(rows().length === free.length && rows().every((r) => r.team === 'Free agent'), 'and in the list');
  ok(!rows().some((r) => r.id === fx.STALE_ID), 'a wire man who is on a squad is not a free agent');
  press(btn('preNowRos', 'ros', 'all'));

  // User: a team implies rostered, and the two controls say the same thing.
  const sel = $('preNowTeam');
  eq(all(sel, 'option').map((o) => clean(o.textContent)).join('|'),
    ['All teams', ...fx.TEAMS.map((t) => t.name)].join('|'), 'the picker lists All teams and each team');
  const pick = (v) => { sel.value = v; sel.dispatchEvent(new window.Event('change', { bubbles: true })); };
  pick('4');
  const mine = want.filter((w) => w.teamId === 4);
  eq(dots().length, mine.length, `a user: his ${mine.length} players on the graph`);
  ok(rows().length === mine.length && rows().every((r) => r.team === 'Squad 4'), 'and in the list');
  eq(btn('preNowRos', 'ros', 'rostered').getAttribute('aria-pressed'), 'true', 'Rostered follows the user');
  eq(btn('preNowRos', 'ros', 'all').getAttribute('aria-pressed'), 'false', 'All is let go');
  press(btn('preNowPos', 'pos', 'RB'));
  eq(rows().length, mine.filter((w) => w.position === 'RB').length, 'a position narrows a user’s players too');
  press(btn('preNowPos', 'pos', 'all'));
  press(btn('preNowRos', 'ros', 'free'));
  eq(sel.value, 'all', 'Free agents lets go of the user');
  eq(dots().length, free.length, 'and shows the free agents');
  pick('7');
  press(btn('preNowRos', 'ros', 'all'));
  eq(sel.value, 'all', 'All lets go of the user too');
  eq(dots().length, want.length, 'and everybody is back');

  // A tapped dot opens the player's card, and the chart is his link.
  {
    const svg = $('chartPreNow').querySelector('svg');
    const d = dots()[40];
    const e = new window.Event('pointerdown', { bubbles: true });
    Object.assign(e, { pointerType: 'touch', clientX: Number(d.getAttribute('cx')), clientY: Number(d.getAttribute('cy')) });
    svg.dispatchEvent(e);
    const card = $('tipCard');
    ok(card && !card.hasAttribute('hidden') && /Player \d+/.test(card.textContent), 'a tapped dot opens the player card');
    ok(/^waivers\.html\?player=\d+$/.test($('chartPreNow').querySelector('.ff-scatter-tip').getAttribute('href') || ''),
      'and links to him on Players');
  }

  eq(wireCalls().length, 1, 'after all of that, still ONE wire read');
  eq(page.fetchCalls.length, 0, 'and nothing went to the network');
  page.restore();
  eq(page.errors.length, 0, `no console error${page.errors[0] ? ` (${page.errors[0]})` : ''}`);
  return { pass, problems };
}

// ---------------------------------------------------------------- child mode
if (SCEN) {
  let out;
  try {
    out = await run(SCEN);
  } catch (err) {
    out = { pass: 0, problems: [String((err && err.stack) || err)] };
  }
  emit({ scenario: SCEN, ...out }, out.problems.length ? 1 : 0);
}

// --------------------------------------------------------------- parent mode
const self = fileURLToPath(import.meta.url);
let pass = 0;
let fail = 0;
for (const scenario of SCENARIOS) {
  const res = spawnSync(process.execPath, [self, scenario], {
    encoding: 'utf8', env: { ...process.env, FF_SCEN: scenario === 'demo' ? 'live' : scenario },
  });
  const line = (res.stdout || '').split('\n').filter((l) => l.startsWith('@@')).pop();
  let got = null;
  try { got = JSON.parse(line.slice(2)); } catch { /* reported below */ }
  if (!got) {
    fail++;
    console.log(`FAIL ${scenario}  no result\n  ${(res.stderr || res.stdout || '').slice(0, 2000)}`);
    continue;
  }
  pass += got.pass;
  fail += got.problems.length;
  console.log(`${got.problems.length ? 'FAIL' : 'PASS'} ${scenario}`);
  for (const p of got.problems) console.log(`  - ${p}`);
}
console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
