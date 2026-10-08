// A link INTO the Analysis page's roster detail:
//
//   analysis.html?team=<teamId>&week=<week>#rosterDetail
//
// The Stats page's graph sends a reader here from one dot (Tim, 2026-10-04:
// "bring them to the roster detail box in the analysis section with it
// automatically selected as the week it's referring to"). This boots the REAL
// analysis.html + js/analysis-page.js and checks the receiving end:
//
//   - with both params the roster detail is on that team in that week, in demo
//     and on a (stubbed) live league, and when live data replaces demo AFTER
//     the page has loaded;
//   - the link is this visit's answer: nothing is written to the saved prefs;
//   - it is applied once: a team or week picked by hand afterwards stands;
//   - a link that names nothing this league has is the page as it always was.
//
//   node roster-link-check.mjs

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';

const LIVE = {
  stub: true,
  prefs: { 'analysis.source': 'live' },
  conn: { leagueId: '99', season: 2026, teamId: 4 },
};
// Demo with a saved week and a saved team, so "the saved preference is
// untouched" is a claim about values that are really there to be overwritten.
const DEMO = { prefs: { 'analysis.week': 9, 'analysis.team': 2 } };

// The demo league's names, by id (js/demo.js) — the stub's are "Team <id>".
const DEMO_NAME = { 2: 'Jonas', 3: 'Miles', 7: 'Robert' };

/** What the stubbed live league opens on with no link: the coming week, your team. */
const LIVE_AS_TODAY = { week: 8, team: 4, name: 'Team 4' };
const DEMO_AS_TODAY = { week: 9, team: 2, name: DEMO_NAME[2] };

const SCENARIOS = {
  'demo-link': {
    label: 'demo: ?team=7&week=5 opens the roster detail on that team and week',
    ...DEMO,
    search: '?team=7&week=5',
    want: { week: 5, team: 7, name: DEMO_NAME[7] },
    landed: true,
    saved: { week: 9, team: 2 },
    byHand: true,
  },
  'demo-plain': {
    label: 'demo: no params, nothing changes',
    ...DEMO,
    search: '',
    want: DEMO_AS_TODAY,
    landed: false,
    saved: { week: 9, team: 2 },
  },
  'demo-bad-team': {
    label: 'demo: a team this league does not have is ignored, week and all',
    ...DEMO,
    search: '?team=99&week=5',
    want: DEMO_AS_TODAY,
    landed: false,
    saved: { week: 9, team: 2 },
  },
  'live-link': {
    label: 'live: ?team=7&week=3 opens on a played week and another manager',
    ...LIVE,
    search: '?team=7&week=3',
    want: { week: 3, team: 7, name: 'Team 7' },
    landed: true,
    saved: { week: undefined, team: undefined },
    byHand: true,
  },
  'live-link-slow': {
    label: 'live, every week read 120 ms late: the link still lands, and the panel is followed',
    ...LIVE,
    env: { AN_DELAY: '120' },
    search: '?team=7&week=3',
    want: { week: 3, team: 7, name: 'Team 7' },
    landed: true,
    saved: { week: undefined, team: undefined },
    settleMs: 9000,
  },
  'live-plain': {
    label: 'live: no params, nothing changes',
    ...LIVE,
    search: '',
    want: LIVE_AS_TODAY,
    landed: false,
    saved: { week: undefined, team: undefined },
  },
  'live-bad-team': {
    label: 'live: unknown team id is ignored, and the week goes back to the coming one',
    ...LIVE,
    search: '?team=99&week=3',
    want: LIVE_AS_TODAY,
    landed: false,
    saved: { week: undefined, team: undefined },
  },
  'live-bad-week': {
    label: 'live: a week past the schedule is ignored, team and all',
    ...LIVE,
    search: '?team=7&week=40',
    want: LIVE_AS_TODAY,
    landed: false,
    saved: { week: undefined, team: undefined },
  },
  'live-half': {
    // 2026-10-08: the team alone IS a link now — a team card's click when it is
    // not about one week. It lands on that team, on the week the page opens on.
    label: 'live: a team with no week lands on that team, on the week the page opens on',
    ...LIVE,
    search: '?team=7',
    want: { ...LIVE_AS_TODAY, team: 7, name: 'Team 7' },
    landed: true,
    saved: { week: undefined, team: undefined },
  },
  'live-junk': {
    label: 'live: params that are not numbers are ignored',
    ...LIVE,
    search: '?team=abc&week=3x',
    want: LIVE_AS_TODAY,
    landed: false,
    saved: { week: undefined, team: undefined },
  },
  'late-live': {
    label: 'demo first, then the bar connects: the link is applied again to the real league',
    stub: true,
    conn: { leagueId: '99', season: 2026, teamId: 4 },
    search: '?team=7&week=3',
    want: { week: 3, team: 7, name: DEMO_NAME[7] },
    landed: true,
    saved: { week: undefined, team: undefined },
    thenConnect: { week: 3, team: 7, name: 'Team 7' },
  },
};

// ------------------------------------------------------------------- child

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(cfg) {
  const html = readFileSync(path.join(REPO, 'analysis.html'), 'utf8');
  const { window, document } = parseHTML(html);

  // linkedom's <select> has no working `.value`; the same shim an-test uses.
  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const sel = this.querySelector('option[selected]') || this.querySelector('option');
        return sel ? sel.getAttribute('value') ?? sel.textContent : '';
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
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const head = kids(this, 'THEAD')[0];
      const rows = [];
      if (head) rows.push(...kids(head, 'TR'));
      for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
      rows.push(...kids(this, 'TR'));
      return rows;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  // THE LINK. Exactly what the Stats page writes, hash included.
  window.location = {
    href: `http://localhost/analysis.html${cfg.search}#rosterDetail`,
    origin: 'http://localhost', protocol: 'http:',
    pathname: '/analysis.html', search: cfg.search, hash: '#rosterDetail',
  };
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  // Every scroll the page asks for, by the id of what it asked to see. linkedom
  // has no scrollIntoView at all, so this is the only way one can be observed.
  const scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
    scrolls.push(this.getAttribute('id') || this.tagName);
  };

  const store = new Map();
  if (cfg.prefs) store.set('ff.prefs', JSON.stringify(cfg.prefs));
  if (cfg.conn) store.set('ff.connection', JSON.stringify(cfg.conn));
  const writes = [];
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { writes.push(k); store.set(k, String(v)); },
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const fetch = async (url) => { throw new Error(`unexpected network call: ${url}`); };

  Object.assign(globalThis, {
    window, document, localStorage, fetch,
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.ResizeObserver = globalThis.ResizeObserver;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));

  await import(pathToFileURL(path.join(REPO, 'js/analysis-page.js')).href);
  return { window, document, scrolls, store, writes, errors };
}

const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

/** Everything the roster detail says about which squad and week it is on. */
function read(document) {
  const glance = {};
  for (const s of document.querySelectorAll('#teamGlance .stat')) {
    glance[txt(s.querySelector('.k'))] = txt(s.querySelector('.v'));
  }
  const names = [...document.querySelectorAll('#rosterStarters tr td.name, #rosterBench tr td.name')]
    .map((td) => txt(td));
  return {
    week: Number(document.getElementById('weekSelect').value),
    team: Number(document.getElementById('teamSelect').value),
    seasonTeam: Number(document.getElementById('seasonTeamSelect').value),
    title: txt(document.getElementById('rosterTitle')),
    seasonTitle: txt(document.getElementById('seasonTitle')),
    glanceWeek: Number(glance.Week),
    players: names.length,
    names,
    badge: txt(document.getElementById('modeBadge')),
    // The season grid has stopped arriving: nothing above the panel still grows.
    seasonDone: !/Loading|Reading/i.test(txt(document.getElementById('seasonProgress'))),
  };
}

const on = (got, want) =>
  got.week === want.week && got.team === want.team && got.seasonTeam === want.team &&
  got.glanceWeek === want.week && got.title === `Roster detail · ${want.name}` && got.players > 0;

/** Wait for the page to be on `want`, or give up; then a beat for anything that fights it. */
async function settle(document, want, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const got = read(document);
    if (on(got, want) && got.seasonDone) break;
    await sleep(25);
  }
  await sleep(250);
  return read(document);
}

const savedPrefs = (store) => JSON.parse(store.get('ff.prefs') || '{}');

async function run(scenario) {
  const cfg = SCENARIOS[scenario];
  const out = [];
  const ok = (name, cond, detail = '') =>
    out.push({ name, pass: Boolean(cond), detail: cond ? '' : String(detail).slice(0, 400) });

  const { window, document, scrolls, store, errors } = await boot(cfg);
  const change = (id, v) => {
    const sel = document.getElementById(id);
    sel.value = String(v);
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const toPanel = () => scrolls.filter((s) => s === 'rosterDetail').length;

  const got = await settle(document, cfg.want, cfg.settleMs);
  const brief = (g) => JSON.stringify({ week: g.week, team: g.team, seasonTeam: g.seasonTeam,
    glanceWeek: g.glanceWeek, title: g.title, players: g.players, badge: g.badge });

  ok('the panel has the id the link points at', document.getElementById('rosterDetail') &&
    document.getElementById('rosterDetail').contains(document.getElementById('rosterTable')) &&
    document.getElementById('rosterDetail').contains(document.getElementById('teamSelect')),
    'no #rosterDetail around the roster table');
  ok(`the roster detail is on week ${cfg.want.week}, ${cfg.want.name}`, on(got, cfg.want), brief(got));
  ok('both team pickers and the season panel name the same squad',
    got.seasonTeam === got.team && got.seasonTitle.includes(cfg.want.name), `${got.seasonTeam} / ${got.seasonTitle}`);
  if (cfg.stub && !cfg.thenConnect) {
    ok('and the rows are that squad’s own men',
      got.names.length > 0 && got.names.every((n) => n.startsWith(`T${cfg.want.team} Player`)),
      got.names.slice(0, 3).join(' | '));
  }
  if (cfg.landed) {
    ok('the panel was scrolled to', toPanel() >= 1, `scrolls: ${JSON.stringify(scrolls)}`);
  } else {
    ok('nothing was scrolled anywhere', scrolls.length === 0, `scrolls: ${JSON.stringify(scrolls)}`);
  }
  const saved = savedPrefs(store);
  ok('THE SAVED WEEK IS UNTOUCHED', saved['analysis.week'] === cfg.saved.week,
    `saved ${saved['analysis.week']}, was ${cfg.saved.week}`);
  ok('THE SAVED TEAM IS UNTOUCHED', saved['analysis.team'] === cfg.saved.team,
    `saved ${saved['analysis.team']}, was ${cfg.saved.team}`);

  // It stops: with the season in, a further beat asks for no more scrolling.
  const before = scrolls.length;
  await sleep(300);
  ok('and once settled it stops scrolling', scrolls.length === before,
    `${scrolls.length - before} more after settling`);

  if (cfg.thenConnect) {
    // The connection bar finishing its round trip, exactly as connection.js
    // announces it. The page was on demo; the league it now reads is the stub.
    const atDemo = toPanel();
    document.dispatchEvent(new window.CustomEvent('ff:connection', { detail: cfg.conn }));
    const live = await settle(document, cfg.thenConnect);
    ok('LIVE DATA REPLACED DEMO AND THE LINK STILL HOLDS: same week, that team in the real league',
      on(live, cfg.thenConnect) && live.badge === 'Live', brief(live));
    ok('the rows are the real league’s men, not the sample’s',
      live.names.length > 0 && live.names.every((n) => n.startsWith(`T${cfg.thenConnect.team} Player`)),
      live.names.slice(0, 3).join(' | '));
    ok('and the panel was brought back into view after the page changed under it',
      toPanel() > atDemo, `${toPanel()} scrolls, ${atDemo} before connecting`);
    const s = savedPrefs(store);
    ok('still nothing saved', s['analysis.week'] === undefined && s['analysis.team'] === undefined,
      JSON.stringify(s));
  }

  if (cfg.byHand) {
    // After landing the controls are the reader's again.
    const scrolled = scrolls.length;
    const other = cfg.want.team === 3 ? 2 : 3;
    const otherName = cfg.stub ? `Team ${other}` : DEMO_NAME[other];
    change('teamSelect', other);
    await sleep(300);
    const a = read(document);
    ok('A TEAM PICKED BY HAND STANDS — the link does not pull it back',
      on(a, { week: cfg.want.week, team: other, name: otherName }), brief(a));

    change('weekSelect', 11);
    const b = await settle(document, { week: 11, team: other, name: otherName });
    ok('and so does a week picked by hand, on the team picked by hand',
      on(b, { week: 11, team: other, name: otherName }), brief(b));
    ok('a week picked by hand IS saved, as it always was',
      savedPrefs(store)['analysis.week'] === 11, JSON.stringify(savedPrefs(store)));
    ok('and neither moved the page back to the panel',
      scrolls.slice(scrolled).every((s) => s !== 'rosterDetail'), JSON.stringify(scrolls.slice(scrolled)));
  }

  ok('no errors', errors.length === 0, errors.join(' || '));
  return out;
}

// ------------------------------------------------------------------ runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  try {
    const results = await run(process.argv[2]);
    emit({ results }, results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    emit({ results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }] }, 1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const args = cfg.stub ? ['--import', './an-register.mjs', self, scenario] : [self, scenario];
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: path.dirname(self),
    env: { ...process.env, ...(cfg.env || {}) },
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    console.log(`FAIL ${scenario} — no result\n  stdout: ${res.stdout}\n  stderr: ${(res.stderr || '').slice(0, 2000)}`);
    failed++;
    continue;
  }
  const { results } = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  total += results.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario}  ${cfg.label}  (${results.length - bad.length}/${results.length})`);
  for (const r of bad) console.log(`   x ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  failed += bad.length;
}

console.log(failed ? `\n${failed} of ${total} assertions failed` : `\nAll ${total} assertions passed`);
process.exit(failed ? 1 : 0);
