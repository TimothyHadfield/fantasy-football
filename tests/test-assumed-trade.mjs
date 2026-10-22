// THE ASSUMED TRADE, SITE-WIDE (Tim, 2026-10-15).
//
// "could you make it so that if a trade is assumed in the trade section, the
// other sections that talk about each user's current team or future
// predictions such as the analysis section, the future schedule, the current
// player on draft or anything else are adjusted so that that user has updated
// information?"
//
//   node test-assumed-trade.mjs              all scenarios, one child each
//   node test-assumed-trade.mjs <scenario>   one
//
// pure            js/assumed-trade.js `applyAssumed`: sends, receives (on the
//                 bench), forced cuts, totals, played weeks and "send after
//                 week N" untouched, the same array when nothing changes
// record          the stored record: parsed, wrong league ignored, Stop puts
//                 the trade back in the saved list
// notice          the one line under the bar, and where it is not drawn
// season          the REAL js/season.js on a stub ESPN: unplayed weeks come
//                 back with the trade made, played / under-way weeks and the
//                 store's own copy stay real, `assumed: false` is real
// schedule-page   the REAL schedule.html: week 4's card moves by the traded
//                 QBs' difference with a trade assumed; the other game does not
// home-page       the REAL index.html: the same for Home's card
// trade-persist   the REAL trade.html (tr-test.mjs `assumeLive`) keeps the
//                 worked-out moves for the other pages, and Remove clears them

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 400)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ------------------------------------------------------------------ storage

function installStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  globalThis.localStorage = ls;
  return ls;
}

// ------------------------------------------------------------------ fixture
//
// A real-shaped league (the shape js/season.js decodes ESPN into). Four squads,
// six regular weeks, weeks 1–3 decided, week 4 the coming one, where Alpha (1)
// plays Bravo (2) and Charlie (3) plays Delta (4).
//
// THE TRADE: Bravo (you, team 2) sends his starting QB (id 200, 17 points) to
// Alpha for Alpha's bench QB (id 104, 30 points). Bravo's best QB goes 17 -> 30,
// Alpha's 30 -> 17: thirteen points each way, every week the trade is made.

const LEAGUE_ID = '5550088';
const SEASON = 2026;
const MY_TEAM = 2;
const REGULAR_WEEKS = 6;
const DECIDED = 3;
const TEAMS = [
  { id: 1, abbrev: 'ALP', name: 'Alpha' },
  { id: 2, abbrev: 'BRA', name: 'Bravo' },
  { id: 3, abbrev: 'CHA', name: 'Charlie' },
  { id: 4, abbrev: 'DEL', name: 'Delta' },
];
const r1 = (n) => Math.round(n * 10) / 10;

const MOVES = {
  src: `live:${LEAGUE_ID}:${SEASON}`,
  a: 2, b: 1, aName: 'Bravo', bName: 'Alpha',
  sendA: ['200'], sendB: ['104'], cutA: [], cutB: [], after: null,
};

function pairs(week) {
  return [[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [2, 3]]][(week - 1) % 3];
}

/** [slot, position id, projected, actual|null]. Slots 0 QB, 2 RB, 16 D/ST, 17 K, 20 bench. */
function rosterFor(teamId, week, { live = null } = {}) {
  const played = week <= DECIDED || week === live;
  const qbBench = teamId === 1 ? 30 : 5;
  const rows = [
    { slot: 0, pos: 1, proj: 15 + teamId },
    { slot: 2, pos: 2, proj: r1(10 + week * 0.5) },
    { slot: 16, pos: 16, proj: 8 },
    { slot: 17, pos: 5, proj: 9 },
    { slot: 20, pos: 1, proj: qbBench },
    { slot: 20, pos: 2, proj: 3 },
  ];
  return rows.map((r) => ({ ...r, actual: played ? r.proj + 1 : null }));
}

const startedScore = (teamId, week) =>
  r1(rosterFor(teamId, week).filter((p) => p.slot !== 20).reduce((a, p) => a + p.actual, 0));

function leaguePayload() {
  const schedule = [];
  for (let w = 1; w <= REGULAR_WEEKS; w++) {
    for (const [h, a] of pairs(w)) {
      const done = w <= DECIDED;
      const hp = done ? startedScore(h, w) : 0;
      const ap = done ? startedScore(a, w) : 0;
      schedule.push({
        matchupPeriodId: w,
        home: { teamId: h, totalPoints: hp },
        away: { teamId: a, totalPoints: ap },
        winner: done ? (hp > ap ? 'HOME' : ap > hp ? 'AWAY' : 'TIE') : 'UNDECIDED',
        playoffTierType: 'NONE',
      });
    }
  }
  return {
    settings: {
      name: 'Assume League',
      size: 4,
      scheduleSettings: { matchupPeriodCount: REGULAR_WEEKS, playoffTeamCount: 2 },
      rosterSettings: { lineupSlotCounts: { 0: 1, 2: 1, 16: 1, 17: 1, 20: 2 } },
    },
    members: [],
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, roster: { entries: [] } })),
    schedule,
  };
}

function rosterPayload(week, mode) {
  return {
    settings: { name: 'Assume League' },
    members: [],
    teams: TEAMS.map((t) => ({
      id: t.id, name: t.name, abbrev: t.abbrev,
      roster: {
        entries: rosterFor(t.id, week, mode).map((p, i) => ({
          playerId: t.id * 100 + i,
          lineupSlotId: p.slot,
          playerPoolEntry: {
            player: {
              id: t.id * 100 + i,
              fullName: `${t.abbrev} P${i}`,
              defaultPositionId: p.pos,
              proTeamId: 1 + i,
              injuryStatus: 'ACTIVE',
              stats: [
                { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: p.proj },
                ...(p.actual === null ? [] : [{ scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: p.actual }]),
                { seasonId: SEASON, statSourceId: 1, statSplitTypeId: 0, appliedTotal: p.proj * 14 },
              ],
            },
          },
        })),
      },
    })),
  };
}

function wirePayload(week) {
  const players = [];
  for (const [pos, base] of Object.entries({ 1: 12, 2: 6, 5: 5, 16: 4 })) {
    for (let i = 0; i < 5; i++) {
      const id = 9000 + Number(pos) * 10 + i;
      players.push({
        id, status: 'FREEAGENT',
        player: {
          id, fullName: `Wire ${pos}-${i}`, defaultPositionId: Number(pos), proTeamId: 10 + i, injuryStatus: 'ACTIVE',
          stats: [{ scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: r1(base + (2 - i) * 0.7) }],
        },
      });
    }
  }
  return { players };
}

function installFetch(mode = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const notFound = { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    if (!/fantasy\.espn\.com/.test(u)) return notFound;
    const wk = Number((u.match(/scoringPeriodId=(\d+)/) || [])[1]);
    let body;
    if (/proTeamSchedules_wl/.test(u)) body = { settings: { proTeams: [] } };
    else if (/kona_player_info/.test(u)) body = wirePayload(wk);
    else if (wk) body = rosterPayload(wk, mode);
    else {
      body = leaguePayload();
      if (!/view=mSettings/.test(u)) delete body.settings;
    }
    const text = JSON.stringify(body);
    return { ok: true, status: 200, async json() { return JSON.parse(text); }, async text() { return text; } };
  };
}

// A squad as js/season.js hands it out, for the pure scenario.
function squad(id, players) {
  const ps = players.map(([pid, position, started, projected, actual = null]) => ({
    playerId: pid, name: `P${pid}`, position, proTeam: 'FA', proTeamId: null,
    lineupSlotId: started ? 0 : 20, slot: started ? 'QB' : 'BE', started, projected, actual,
    seasonProjected: projected * 14, injuryStatus: 'ACTIVE', percentOwned: null, seasonAvg: null, posRank: null,
  }));
  const starters = ps.filter((p) => p.started);
  const bench = ps.filter((p) => !p.started);
  const tot = (arr, k) => { const v = arr.map((p) => p[k]).filter((x) => typeof x === 'number'); return v.length ? r1(v.reduce((s, x) => s + x, 0)) : null; };
  return {
    id, name: `Team ${id}`, owner: `Owner ${id}`, abbrev: `T${id}`, players: ps, starters, bench,
    projectedTotal: tot(starters, 'projected'), actualTotal: tot(starters, 'actual'),
    benchActualTotal: tot(bench, 'actual'), seasonProjectedTotal: tot(starters, 'seasonProjected'),
  };
}

const has = (team, id) => (team.players || []).some((p) => String(p.playerId) === String(id));
const man = (team, id) => (team.players || []).find((p) => String(p.playerId) === String(id)) || null;
const teamOf = (teams, id) => (teams || []).find((t) => t.id === id);

// ------------------------------------------------------------------ page harness

async function until(cond, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

async function bootPage(page, moduleRel, prefs = {}) {
  const { parseHTML } = await import('linkedom');
  const html = readFileSync(path.join(REPO, page), 'utf8');
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
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });
  const localStorage = installStorage({
    'ff.connection': JSON.stringify({ leagueId: LEAGUE_ID, season: SEASON, teamId: MY_TEAM }),
    'ff.prefs': JSON.stringify(prefs),
  });
  window.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: `/${page}` };
  window.postMessage = () => {};
  window.localStorage = localStorage;
  Object.assign(globalThis, {
    window, document, localStorage,
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
    location: window.location,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '' });
  installFetch();
  await import(moduleUrl(moduleRel));
  return { document, localStorage };
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const withMoves = (extra = {}) => ({ 'trade.assumedMoves': { ...MOVES, ...extra } });

async function scheduleChild(variant) {
  const prefs = { 'schedule.source': 'live', 'schedule.week': 4, ...(variant === 'assumed' ? withMoves() : {}) };
  const { document, localStorage } = await bootPage('schedule.html', 'js/schedule-page.js', prefs);
  const cards = () => Array.from(document.querySelectorAll('#matchups .game.upcoming'));
  await until(() => cards().length === 2 && cards().every((c) => /%/.test(c.querySelector('.gmeta')?.textContent || '')));
  await new Promise((r) => setTimeout(r, 300));
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem('ff.prefs') || '{}')['trade.assumedMoves'] ?? null; } catch { kept = null; }
  return {
    title: clean(document.getElementById('matchupsTitle')?.textContent),
    cards: cards().map((c) => ({
      home: clean(c.querySelector('.side.home .tname')?.textContent),
      away: clean(c.querySelector('.side.away .tname')?.textContent),
      meta: clean(c.querySelector('.gmeta')?.textContent),
      proj: [clean(c.querySelector('.tscore.home')?.textContent), clean(c.querySelector('.tscore.away')?.textContent)],
    })),
    // What the page kept: the time machine's readings and the projection history.
    snapshotKeys: [...Array(localStorage.length)].map((_, i) => localStorage.key(i))
      .filter((k) => /^ff\.(snap|projhist)/i.test(k) && !/attempt/i.test(k)).sort(),
    kept,
  };
}

async function homeChild(variant) {
  const prefs = variant === 'assumed' ? withMoves() : {};
  const { document } = await bootPage('index.html', 'js/home-page.js', prefs);
  const cards = () => Array.from(document.querySelectorAll('#matchups .game'));
  await until(() => cards().length === 2 && cards().every((c) => c.hasAttribute('data-home-win')));
  await new Promise((r) => setTimeout(r, 300));
  return {
    title: clean(document.getElementById('matchupsTitle')?.textContent),
    cards: cards().map((c) => ({
      names: Array.from(c.querySelectorAll('.tname')).map((n) => clean(n.textContent).replace(/ \(you\)$/, '')),
      meta: clean(c.querySelector('.gmeta')?.textContent),
      win: c.hasAttribute('data-home-win') ? Number(c.getAttribute('data-home-win')) : null,
      proj: Array.from(c.querySelectorAll('.tproj')).map((n) => clean(n.textContent)),
    })),
  };
}

async function seasonChild(variant) {
  installStorage({
    'ff.connection': JSON.stringify({ leagueId: LEAGUE_ID, season: SEASON, teamId: MY_TEAM }),
    'ff.prefs': JSON.stringify(variant === 'none' ? {} : variant === 'other-league'
      ? { 'trade.assumedMoves': { ...MOVES, src: `live:9999999:${SEASON}` } }
      : variant === 'after4' ? withMoves({ after: 4 }) : withMoves()),
  });
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '' });
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  const store = await import(moduleUrl('js/store.js'));
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  installFetch(variant === 'live4' ? { live: 4 } : {});
  const weeks = [1, 2, 3, 4, 5, 6];
  const all = await season.fetchWeeksRosters(weeks);
  const one = (await season.fetchWeekRosters(5)).teams;
  const real = await season.fetchWeeksRosters(weeks, { assumed: false });
  const realOne = (await season.fetchWeekRosters(5, { assumed: false })).teams;
  const shape = (teams) => {
    const b = teamOf(teams, 2);
    const a = teamOf(teams, 1);
    const p104 = b && man(b, 104);
    return {
      bHas200: b ? has(b, 200) : null, bHas104: b ? has(b, 104) : null,
      aHas104: a ? has(a, 104) : null, aHas200: a ? has(a, 200) : null,
      p104: p104 ? { started: p104.started, slot: p104.lineupSlotId, label: p104.slot } : null,
      bStarters: b ? b.starters.map((p) => p.playerId) : null,
      bTotal: b ? b.projectedTotal : null,
      others: [3, 4].map((id) => JSON.stringify(teamOf(teams, id))),
    };
  };
  const stored = store.readWeek(LEAGUE_ID, SEASON, 5);
  return {
    weeks: Object.fromEntries(weeks.map((w) => [w, shape(all.get(w))])),
    real: Object.fromEntries(weeks.map((w) => [w, shape(real.get(w))])),
    one: shape(one),
    realOne: shape(realOne),
    stored: stored ? shape(stored.teams) : null,
  };
}

async function noticeChild(variant) {
  const { parseHTML } = await import('linkedom');
  const page = variant === 'decisions' ? 'decisions.html' : variant === 'trade' ? 'trade.html' : 'analysis.html';
  const { window, document } = parseHTML(readFileSync(path.join(REPO, page), 'utf8'));
  let reloaded = 0;
  const loc = { pathname: `/fantasy-football/${page}`, reload: () => { reloaded++; } };
  Object.assign(globalThis, { window, document, location: loc });
  document.location = loc;
  const entry = { a: 2, b: 1, sendA: ['200'], sendB: ['104'] };
  installStorage({
    'ff.connection': JSON.stringify({ leagueId: LEAGUE_ID, season: SEASON, teamId: variant === 'other-team' ? 3 : MY_TEAM }),
    'ff.prefs': JSON.stringify({
      ...(variant === 'none' ? {} : withMoves()),
      'trade.assumed': { entry, src: MOVES.src, at: 1 },
      'trade.custom': [{ a: 2, b: 3, sendA: ['201'], sendB: ['301'] }, { a: 2, b: 4, sendA: ['202'], sendB: ['401'] }],
    }),
  });
  const mod = await import(moduleUrl('js/assumed-trade.js'));
  const el = mod.mountNotice(document);
  const note = document.getElementById('assumeSite');
  const bar = document.getElementById('connBar');
  const out = {
    drawn: !!note,
    returned: !!el,
    text: note ? clean(note.textContent) : null,
    afterBar: note ? bar.nextElementSibling === note : null,
    hasStop: !!document.getElementById('assumeStop'),
  };
  const stop = document.getElementById('assumeStop');
  if (stop) stop.dispatchEvent(new window.Event('click', { bubbles: true }));
  const prefs = JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}');
  out.after = {
    reloaded,
    gone: !document.getElementById('assumeSite'),
    moves: prefs['trade.assumedMoves'] ?? null,
    assumed: prefs['trade.assumed'] ?? null,
    custom: prefs['trade.custom'] ?? null,
  };
  return out;
}

// ------------------------------------------------------------------ scenarios

const SCENARIOS = {
  async pure() {
    const { applyAssumed, parseMoves } = await import(moduleUrl('js/assumed-trade.js'));
    // Bravo (2) sends 21 (starting QB) + 23 (bench RB) for Alpha's 11 (bench QB);
    // Alpha, a man over, cuts 14. Bravo cuts nobody.
    const teams = () => [
      squad(1, [[10, 'QB', true, 16], [11, 'QB', false, 30], [12, 'RB', true, 12], [13, 'K', true, 9], [14, 'RB', false, 2]]),
      squad(2, [[20, 'RB', true, 11], [21, 'QB', true, 17], [22, 'K', true, 8], [23, 'RB', false, 6]]),
      squad(3, [[30, 'QB', true, 15]]),
    ];
    const m = parseMoves({ src: 'live:1:2026', a: 2, b: 1, sendA: ['21', 23], sendB: [11], cutA: [], cutB: ['14'], after: null });
    const t = teams();
    const out = applyAssumed(t, 5, m);
    const a = teamOf(out, 1);
    const b = teamOf(out, 2);
    eq(b.players.map((p) => p.playerId), [20, 22, 11], 'Bravo: what he sends is gone, what he gets is in');
    eq(a.players.map((p) => p.playerId).sort(), [10, 12, 13, 21, 23], 'Alpha: gets both, sends 11, cuts 14');
    const arrived = man(b, 11);
    eq([arrived.started, arrived.lineupSlotId, arrived.slot], [false, 20, 'BE'], 'an arriving man sits on the bench');
    eq(man(a, 21).started, false, 'his starting QB arrives on Alpha\'s bench too');
    eq(b.starters.map((p) => p.playerId), [20, 22], 'Bravo\'s starters: the QB he sent is no longer one');
    eq(b.bench.map((p) => p.playerId), [11], 'and his bench is the man who arrived');
    eq(b.projectedTotal, 19, 'the set lineup\'s total is worked out again (11 + 8)');
    eq(a.projectedTotal, 37, 'Alpha\'s set lineup is unchanged: 16 + 12 + 9');
    ok('the third squad is the same object', out[2] === t[2]);
    ok('nothing in the input was changed', teamOf(t, 2).players.length === 4 && has(teamOf(t, 1), 11) && teamOf(t, 2).projectedTotal === 36);
    eq(out.map((x) => x.id), [1, 2, 3], 'squads keep their order');

    ok('no record: the same array', applyAssumed(t, 5, null) === t);
    ok('a played week (array): the same array', applyAssumed(t, 3, m, { played: [1, 2, 3] }) === t);
    ok('a played week (Set): the same array', applyAssumed(t, 3, m, { played: new Set([3]) }) === t);
    ok('a played week (function): the same array', applyAssumed(t, 3, m, { played: (w) => w <= 3 }) === t);
    ok('an unplayed week with played weeks named: made', applyAssumed(t, 4, m, { played: [1, 2, 3] }) !== t);
    const later = parseMoves({ ...m, sendA: [...m.sendA], sendB: [...m.sendB], cutA: [], cutB: [...m.cutB], after: 5 });
    ok('sent after week 5: week 5 keeps the real squads', applyAssumed(t, 5, later) === t);
    ok('sent after week 5: week 4 too', applyAssumed(t, 4, later) === t);
    ok('sent after week 5: week 6 has the trade made', has(teamOf(applyAssumed(t, 6, later), 2), 11));
    const two = [t[0], t[2]];
    ok('a squad missing from the week: the same array', applyAssumed(two, 5, m) === two);
    ok('an empty week: the same array', (() => { const e = []; return applyAssumed(e, 5, m) === e; })());
    // A squad the payload never totalled keeps not having totals.
    const bare = teams().map(({ projectedTotal, actualTotal, benchActualTotal, seasonProjectedTotal, ...rest }) => rest);
    const bout = applyAssumed(bare, 5, m);
    ok('no totals invented on a squad that had none', !('projectedTotal' in teamOf(bout, 2)));
  },

  async record() {
    installStorage({
      'ff.connection': JSON.stringify({ leagueId: LEAGUE_ID, season: SEASON, teamId: MY_TEAM }),
      'ff.prefs': JSON.stringify(withMoves()),
    });
    const mod = await import(moduleUrl('js/assumed-trade.js'));
    const m = mod.movesFor(LEAGUE_ID, SEASON);
    ok('the record is read for its own league', !!m);
    ok('... with Sets of string ids', m && m.sendA instanceof Set && m.sendA.has('200') && m.sendB.has('104'));
    eq(mod.movesFor('9999999', SEASON), null, 'another league: nothing assumed');
    eq(mod.movesFor(LEAGUE_ID, SEASON - 1), null, 'another season: nothing assumed');
    eq(mod.movesFor(null, SEASON), null, 'no league: nothing assumed');
    eq(mod.parseMoves({ ...MOVES, a: 2, b: 2 }), null, 'a trade with yourself is refused');
    eq(mod.parseMoves({ ...MOVES, sendA: [], sendB: [] }), null, 'a trade of nobody is refused');
    eq(mod.parseMoves({ ...MOVES, src: '' }), null, 'a record without a league is refused');
    eq(mod.parseMoves('junk'), null, 'junk is refused');
    eq(mod.serializeMoves(mod.parseMoves(MOVES)), MOVES, 'stored, read and stored again: the same record');
    eq(mod.noticeText(m, 2), 'Assuming your trade with Alpha', 'your trade, named by the other side');
    eq(mod.noticeText(m, 1), 'Assuming your trade with Bravo', 'from the other side\'s seat');
    eq(mod.noticeText(m, 3), 'Assuming Bravo\'s trade with Alpha', 'somebody else\'s trade');
    mod.writeMoves(null);
    eq(mod.readMoves(), null, 'writeMoves(null) clears it');
  },

  async notice() {
    const r = await child('child-notice', 'mine');
    ok('drawn on Analysis', r.drawn && r.returned, JSON.stringify(r));
    eq(r.text, 'Assuming your trade with Alpha · Stop', 'its words');
    ok('right under the bar', r.afterBar === true);
    eq(r.after.reloaded, 1, 'Stop loads the page again');
    ok('Stop takes the line away', r.after.gone);
    eq(r.after.moves, null, 'Stop clears the moves');
    eq(r.after.assumed, null, 'and the assumed trade');
    eq((r.after.custom || []).map((e) => `${e.a}-${e.b}`), ['2-3', '2-1', '2-4'],
      'and puts the trade back in the saved list where it was');
    const other = await child('child-notice', 'other-team');
    eq(other.text, 'Assuming Bravo\'s trade with Alpha · Stop', 'a trade between two other squads names both');
    const dec = await child('child-notice', 'decisions');
    ok('not drawn on Decisions', dec.drawn === false && dec.hasStop === false, JSON.stringify(dec));
    const tr = await child('child-notice', 'trade');
    ok('not drawn on the Trade page (it has its own block)', tr.drawn === false, JSON.stringify(tr));
    const none = await child('child-notice', 'none');
    ok('nothing assumed: not drawn', none.drawn === false, JSON.stringify(none));
  },

  async season() {
    const r = await child('child-season', 'assumed');
    for (const w of [1, 2, 3]) {
      const s = r.weeks[w];
      ok(`week ${w} (played): Bravo still has his QB, Alpha his bench QB`,
        s.bHas200 === true && s.bHas104 === false && s.aHas104 === true && s.aHas200 === false, JSON.stringify(s));
    }
    for (const w of [4, 5, 6]) {
      const s = r.weeks[w];
      ok(`week ${w} (to play): the trade is made`,
        s.bHas200 === false && s.bHas104 === true && s.aHas104 === false && s.aHas200 === true, JSON.stringify(s));
      eq(s.p104, { started: false, slot: 20, label: 'BE' }, `week ${w}: the QB Bravo gets is on his bench`);
      eq(s.others, r.real[w].others, `week ${w}: Charlie and Delta untouched`);
    }
    eq(r.weeks[5].bStarters, [201, 202, 203], 'Bravo\'s set lineup has no QB until he sets one');
    eq(r.weeks[5].bTotal, r1(10 + 5 * 0.5 + 8 + 9), 'and its total is worked out from it');
    ok('one week read alone: the trade is made', r.one.bHas104 && !r.one.bHas200, JSON.stringify(r.one));
    for (const w of [1, 2, 3, 4, 5, 6]) {
      ok(`assumed: false, week ${w}: the real squads`, r.real[w].bHas200 && !r.real[w].bHas104, JSON.stringify(r.real[w]));
    }
    ok('assumed: false, one week: the real squads', r.realOne.bHas200 && !r.realOne.bHas104);
    ok('the browser\'s stored week is ESPN\'s, untouched', r.stored && r.stored.bHas200 && !r.stored.bHas104, JSON.stringify(r.stored));

    const other = await child('child-season', 'other-league');
    ok('a record for another league changes nothing', [4, 5, 6].every((w) => other.weeks[w].bHas200 && !other.weeks[w].bHas104),
      JSON.stringify(other.weeks[5]));
    const after = await child('child-season', 'after4');
    ok('sent after week 4: week 4 is real', after.weeks[4].bHas200 && !after.weeks[4].bHas104, JSON.stringify(after.weeks[4]));
    ok('sent after week 4: weeks 5 and 6 have it', [5, 6].every((w) => after.weeks[w].bHas104 && !after.weeks[w].bHas200));
    const live = await child('child-season', 'live4');
    // Flipped 2026-10-15 (Tim: "I can't see the chagnes in the other
    // sections" — the week under way was held real): it has the trade now.
    ok('a week under way (scores in, not decided) has the trade', live.weeks[4].bHas104 && !live.weeks[4].bHas200,
      JSON.stringify(live.weeks[4]));
    ok('... and the week after it has the trade', live.weeks[5].bHas104 && !live.weeks[5].bHas200);
  },

  async 'schedule-page'() {
    const base = await child('child-schedule', 'none');
    const asm = await child('child-schedule', 'assumed');
    ok('both runs drew week 4', /Week 4/.test(base.title) && /Week 4/.test(asm.title), `${base.title} / ${asm.title}`);
    const game = (r, h) => r.cards.find((c) => c.home === h) || null;
    const b12 = game(base, 'Alpha');
    const a12 = game(asm, 'Alpha');
    ok('Alpha v Bravo is on the card both times', b12 && a12, JSON.stringify([base.cards, asm.cards]));
    if (b12 && a12) {
      const n = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
      eq(r1(n(a12.proj[0]) - n(b12.proj[0])), -13, 'Alpha (gave the 30-point QB) is 13 lower');
      eq(r1(n(a12.proj[1]) - n(b12.proj[1])), 13, 'Bravo (got him) is 13 higher');
      ok('the chance on the card moved', a12.meta !== b12.meta, `${b12.meta} / ${a12.meta}`);
    }
    eq(game(asm, 'Charlie'), game(base, 'Charlie'), 'Charlie v Delta reads exactly the same');
    // The fixture is one the page DOES keep a reading of with nothing assumed,
    // so an empty list with a trade assumed is the page refusing, not failing.
    ok('with nothing assumed the page keeps week 4\'s reading and projections',
      base.snapshotKeys.some((k) => /^ff\.snap\.\d+\.\d+\.4$/.test(k)) && base.snapshotKeys.some((k) => /^ff\.projhist/.test(k)),
      JSON.stringify(base.snapshotKeys));
    eq(asm.snapshotKeys, [], 'with a trade assumed it keeps neither (the assumed squads are not ESPN\'s)');
    ok('the Schedule page leaves the record alone', asm.kept && asm.kept.src === MOVES.src);
  },

  async 'home-page'() {
    const base = await child('child-home', 'none');
    const asm = await child('child-home', 'assumed');
    const find = (r, name) => r.cards.find((c) => c.names.includes(name)) || null;
    const b = find(base, 'Bravo');
    const a = find(asm, 'Bravo');
    ok('Home drew Bravo\'s game both times', b && a, JSON.stringify([base, asm]));
    if (b && a) {
      ok('Home\'s win chance for it moved', a.win !== b.win, `${b.win} / ${a.win}`);
      ok('towards Bravo, who got the better QB (away side)', a.win < b.win, `${b.win} -> ${a.win}`);
    }
    eq(find(asm, 'Charlie'), find(base, 'Charlie'), 'the other game is the same');
  },

  async 'trade-persist'() {
    // A 1-for-2: Ana (1, you) sends her WR1 (103) for Bo's RB1 + RB2 (201, 202).
    const entry = { a: 1, b: 2, sendA: ['103'], sendB: ['201', '202'] };
    const prefs = JSON.stringify({
      'trade.source': 'live',
      'trade.assumed': { entry, src: 'live:476225250:2026', at: 0 },
      'trade.custom': [],
    });
    // `--import ./tr-register.mjs` puts js/season.js on tr-stub-season.mjs's
    // offline league, as tr-test.mjs's own `stub: true` children do.
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const res = spawnSync(process.execPath, ['--import', './tr-register.mjs', path.join(testsDir, 'tr-test.mjs'), 'assumeLive'], {
      cwd: testsDir, encoding: 'utf8', env: { ...process.env, TR_ASSUMED: prefs }, maxBuffer: 64 * 1024 * 1024, timeout: 240000,
    });
    const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
    if (!line) { ok('tr-test assumeLive answered', false, String(res.stderr || '').slice(-1500)); return; }
    const d = JSON.parse(line.slice(2));
    ok('the Trade page booted with no errors', (d.errors || []).length === 0, JSON.stringify(d.errors));
    ok('it shows the assumed block', d.block === true);
    const m = d.moves || {};
    eq(m.src, 'live:476225250:2026', 'the moves are kept for this league');
    eq([m.a, m.b], [1, 2], 'between the two squads');
    eq([m.sendA, m.sendB], [['103'], ['201', '202']], 'with what each sends');
    eq([m.aName, m.bName], ['Ana', 'Bo'], 'and both names, for the notice');
    ok('the forced cuts are lists of ids', Array.isArray(m.cutA) && Array.isArray(m.cutB), JSON.stringify(m));
    ok('Ana, a man over, cuts one of hers', (m.cutA || []).length === 1, JSON.stringify(m.cutA));
    eq(m.after, null, 'sent now');
    ok('Remove was there', d.removed === true);
    eq(d.movesAfter, null, 'Remove clears the moves');
    eq(d.assumedAfter, null, '... and the assumed trade');
    eq((d.customAfter || []).length, 1, '... which is back in the saved list');
  },

  // PENDING TRADES (Tim, 2026-10-22: "If someone sent a trade or I sent a
  // trade, then That should be an automatically saved trade on the cite with a
  // label of some sort saying it's a pending move and showing the deadline").
  async 'trade-pending'() {
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const expiresAt = Date.now() + 2 * 864e5;
    const saved = [{ a: 1, b: 3, sendA: ['104'], sendB: ['301'] }, { a: 1, b: 2, sendA: ['105'], sendB: ['202'] }];
    const offers = [
      { id: 'p-in', withTeamId: 2, get: [201], send: [103], fromMe: false, expiresAt },   // Bo sent it to me
      { id: 'p-out', withTeamId: 3, get: [301], send: [104], fromMe: true, expiresAt },   // I sent it to Cy: already saved
    ];
    const page = (pending) => {
      const res = spawnSync(process.execPath, ['--import', './tr-register.mjs', path.join(testsDir, 'tr-test.mjs'), 'pendingLive'], {
        cwd: testsDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000,
        env: { ...process.env, TR_PENDING: JSON.stringify(pending), TR_SAVED: JSON.stringify(saved) },
      });
      const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
      return line ? JSON.parse(line.slice(2)) : { boot: String(res.stderr || '').slice(-1500) };
    };
    const d = page(offers);
    ok('the Trade page answered', !d.boot, d.boot);
    if (d.boot) return;
    ok('with no errors', (d.errors || []).length === 0, JSON.stringify(d.errors));
    eq(d.rows.length, 3, 'two saved + one offer that was not saved: three rows (the saved one is not drawn twice)');
    const bo = d.rows.find((r) => r.mgr === 'Bo' && r.pend);
    const cy = d.rows.find((r) => r.mgr === 'Cy');
    ok('the offer TO me is a row of its own, labelled', !!bo && /^Pending Sent to you · expires \w{3} \d/.test(bo.pend), JSON.stringify(bo));
    ok('... with Assume but no Remove or Send later', !!bo && bo.assume && !bo.remove && !bo.later, JSON.stringify(bo));
    ok('the offer BY me marks the trade I saved', !!cy && /^Pending Sent by you · expires/.test(cy.pend || ''), JSON.stringify(cy));
    ok('... which keeps its Remove', !!cy && cy.remove, JSON.stringify(cy));
    ok('my other saved trade has no label', d.rows.some((r) => r.mgr === 'Bo' && !r.pend && r.remove), JSON.stringify(d.rows));
    eq(d.custom, saved, 'nothing pending is written to the saved list');

    // The offers answered, lapsed or withdrawn: ESPN lists none.
    const e = page([]);
    ok('the page answered again', !e.boot, e.boot);
    if (e.boot) return;
    eq(e.rows.length, 2, 'the offer no longer listed is gone');
    ok('and nothing is labelled pending', e.rows.every((r) => !r.pend), JSON.stringify(e.rows));
    eq(e.custom, saved, 'both trades I saved are still saved');
  },
};

// ------------------------------------------------------------------ run

const self = fileURLToPath(import.meta.url);

function child(kind, variant) {
  const res = spawnSync(process.execPath, [self, kind, variant], { encoding: 'utf8', timeout: 120000 });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@RESULT@@'));
  if (!line) throw new Error(`${kind} ${variant} gave no answer: ${String(res.stderr || '').slice(-1500)}`);
  const r = JSON.parse(line.slice('@@RESULT@@'.length));
  if (r && r.error) throw new Error(`${kind} ${variant}: ${r.error}`);
  return r;
}

const [arg, variant] = process.argv.slice(2);
if (arg && arg.startsWith('child-')) {
  let res;
  try {
    const fn = { 'child-schedule': scheduleChild, 'child-home': homeChild, 'child-season': seasonChild, 'child-notice': noticeChild }[arg];
    res = await fn(variant);
  } catch (err) {
    res = { error: String(err && err.stack || err) };
  }
  process.stdout.write('\n@@RESULT@@' + JSON.stringify(res) + '\n');
  process.exit(0);
}

if (arg) {
  try {
    await SCENARIOS[arg]();
  } catch (err) {
    fails.push(`threw: ${err && err.stack || err}`);
  }
  console.log(JSON.stringify({ scen: arg, pass, fails }));
  process.exit(fails.length ? 1 : 0);
}

let total = 0;
let bad = 0;
for (const name of Object.keys(SCENARIOS)) {
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8', timeout: 600000 });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  let r = null;
  try { r = JSON.parse(line); } catch { /* below */ }
  if (!r) {
    bad++;
    console.log(`FAIL ${name}\n  stdout=${(res.stdout || '').slice(0, 800)}\n  stderr=${(res.stderr || '').slice(0, 1500)}`);
    continue;
  }
  total += r.pass;
  if (r.fails.length) {
    bad++;
    console.log(`FAIL ${name}  (${r.pass} assertions)`);
    for (const f of r.fails) console.log(`   - ${f}`);
  } else {
    console.log(`PASS ${name}  (${r.pass} assertions)`);
  }
}
if (bad) {
  console.log(`\n${total} passed, ${bad} failed (scenarios)`);
  process.exit(1);
}
console.log(`\nAll ${total} assertions passed across ${Object.keys(SCENARIOS).length} scenarios`);
