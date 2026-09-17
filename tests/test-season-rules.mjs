// What counts as a RESULT, what counts as the REGULAR SEASON, and the small
// reads around them — js/season.js and js/espn.js, then the two pages that
// rank a table by record.
//
//   node test-season-rules.mjs            all scenarios, one child each
//   node test-season-rules.mjs <scenario> one (no loader needed by any of them)
//
// Every number here starts life as a RAW ESPN payload fed through a stub
// `fetch`, so the real decoders, the real routing and the real pages are what
// is under test. The fixture is shaped to make each rule falsifiable:
//
//   week 1   A–C 50–50 TIE          B–D 150–10 HOME
//   week 2   A–D 50–40 HOME         B–C 150–151 AWAY
//   week 3   A–B 0–0 UNDECIDED      C–D 30–20 UNDECIDED   <- Thursday night
//   week 4   A–B 200–0 HOME, playoffTierType WINNERS_BRACKET
//            C–D  90–80 HOME, LOSERS_CONSOLATION_LADDER
//            (and a bye seed: home only, UNDECIDED)
//
// Records through the regular season: A 1-0-1 (PF 100), B 1-1 (PF 300),
// C 1-0-1 (PF 201), D 0-2 (PF 50). By ESPN's order — win percentage with a
// tie as half a win, then points for — that is C, A, B, D. Sorting by wins
// alone puts B first; counting week 3 makes C 2-0-1; counting week 4 makes A
// 2-0-1 and first. Each of those mistakes moves a visible answer.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

// ------------------------------------------------------------------ scoring

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ------------------------------------------------------------------ fixture

const LEAGUE_ID = '5550001';
const SEASON = 2026;
const TEAMS = [
  { id: 1, abbrev: 'A', name: 'Alpha' },
  { id: 2, abbrev: 'B', name: 'Bravo' },
  { id: 3, abbrev: 'C', name: 'Charlie' },
  { id: 4, abbrev: 'D', name: 'Delta' },
];

const game = (week, h, hp, a, ap, winner, tier = 'NONE') => ({
  matchupPeriodId: week,
  home: { teamId: h, totalPoints: hp },
  away: { teamId: a, totalPoints: ap },
  winner,
  playoffTierType: tier,
});

function scheduleRaw({ legacy = false } = {}) {
  const games = [
    game(1, 1, 50, 3, 50, 'TIE'),
    game(1, 2, 150, 4, 10, 'HOME'),
    game(2, 1, 50, 4, 40, 'HOME'),
    game(2, 2, 150, 3, 151, 'AWAY'),
    // ESPN order puts his game (Delta's) SECOND, so "his game first" is a
    // real reordering rather than an accident of the feed.
    game(3, 1, 0, 2, 0, 'UNDECIDED'),
    game(3, 3, 30, 4, 20, 'UNDECIDED'),
    game(4, 1, 200, 2, 0, 'HOME', 'WINNERS_BRACKET'),
    game(4, 3, 90, 4, 80, 'HOME', 'LOSERS_CONSOLATION_LADDER'),
    { matchupPeriodId: 4, home: { teamId: 1, totalPoints: 0 }, winner: 'UNDECIDED', playoffTierType: 'WINNERS_BRACKET' },
  ];
  if (legacy) {
    // An old synced copy / hand fixture: no `winner`, no tier. Week 3's
    // in-progress game then counts as played under the old points rule — the
    // fallback keeps exactly the behaviour these payloads always had.
    for (const g of games) { delete g.winner; delete g.playoffTierType; }
    return games.filter((g) => g.matchupPeriodId <= 3);
  }
  return games;
}

function leaguePayload(opts) {
  return {
    settings: {
      name: 'Rules League',
      size: 4,
      scheduleSettings: { matchupPeriodCount: 3, playoffTeamCount: 2 },
      rosterSettings: { lineupSlotCounts: { 0: 1, 20: 1 } },
    },
    members: [],
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, roster: { entries: [] } })),
    schedule: scheduleRaw(opts),
  };
}

/** One QB starting, one on the bench, projections for every week. */
function rosterPayload(week) {
  return {
    settings: { name: 'Rules League' },
    members: [],
    teams: TEAMS.map((t) => ({
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      roster: {
        entries: [0, 20].map((slot, i) => ({
          playerId: t.id * 100 + i,
          lineupSlotId: slot,
          playerPoolEntry: {
            player: {
              id: t.id * 100 + i,
              fullName: `${t.abbrev} QB${i}`,
              defaultPositionId: 1,
              proTeamId: 1 + i,
              injuryStatus: 'ACTIVE',
              stats: [
                { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 20 + t.id + i },
                ...(week <= 2
                  ? [{ scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: i ? 30 + t.id : 10 + t.id }]
                  : []),
                { seasonId: SEASON, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 300 + t.id },
              ],
            },
          },
        })),
      },
    })),
  };
}

const WAIVER_MS = 1789714800000;

function wirePayload(week) {
  const fa = (id, status, extra = {}) => ({
    id,
    status,
    ...extra,
    player: {
      id,
      fullName: `Free ${id}`,
      defaultPositionId: 2,
      proTeamId: 3,
      stats: [{ scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 5 }],
    },
  });
  return {
    players: [
      fa(901, 'WAIVERS', { waiverProcessDate: WAIVER_MS }),
      fa(902, 'FREEAGENT'),
      fa(903, undefined),
      fa(904, 'WAIVERS'),              // no date: status kept, clears unknown
      fa(905, 'FREEAGENT', { waiverProcessDate: WAIVER_MS }), // a date on a FA means nothing
    ],
  };
}

const BYES = { settings: { proTeams: [{ id: 1, byeWeek: 7 }, { id: 2, byeWeek: 9 }, { id: 0, byeWeek: 0 }] } };

/**
 * A counting ESPN. `mode.failNext` makes the next N league reads fail; `mode.dead`
 * refuses everything (a phone that cannot reach a private league).
 */
function installFetch(mode = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (mode.dead) return { ok: false, status: 401, async json() { return {}; } };
    if (mode.failNext > 0) {
      mode.failNext--;
      return { ok: false, status: 500, async json() { return {}; } };
    }
    let body;
    if (/proTeamSchedules_wl/.test(u)) body = BYES;
    else if (/kona_player_info/.test(u)) body = wirePayload(Number((u.match(/scoringPeriodId=(\d+)/) || [])[1] || 1));
    else if (/scoringPeriodId=(\d+)/.test(u)) body = rosterPayload(Number(u.match(/scoringPeriodId=(\d+)/)[1]));
    else {
      body = leaguePayload(mode);
      // As ESPN does (checked on league 1241838): no `settings` unless asked.
      if (!/view=mSettings/.test(u)) delete body.settings;
    }
    return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
  };
  return calls;
}

const leagueCalls = (calls) => calls.filter((u) => /\/leagues\//.test(u));

// ------------------------------------------------------------ scenarios

const SCENARIOS = {
  // 1 + 2: fetchSchedule and fetchSeasonData on a live payload.
  async schedule() {
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });           // no cloud at all
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
    installFetch();

    const s = await season.fetchSchedule();
    eq(s.leagueName, 'Rules League', 'the league name comes through (mSettings rides on the matchups read)');
    eq(s.playoffs && s.playoffs.playoffTeams, 2, 'the playoff field size comes through');
    eq(s.weeks, [1, 2, 3], 'regular season only: the playoff week is not a schedule week');
    eq(s.games.length, 6, 'six regular-season games');
    ok('no playoff game in games', s.games.every((g) => g.week <= 3));
    ok('no playoff game in byWeek', !s.byWeek.has(4));
    eq(s.playoffGames.length, 3, 'the playoff and consolation games are kept apart');
    eq(s.playoffGames.map((g) => g.tier),
      ['WINNERS_BRACKET', 'LOSERS_CONSOLATION_LADDER', 'WINNERS_BRACKET'], 'each carries its tier');
    const bye = s.playoffGames[2];
    eq([bye.awayId, bye.played], [null, false], 'the bye seed is a bye and never a result');

    const w3 = s.byWeek.get(3);
    const live = w3.find((g) => g.homeId === 3);
    eq([live.homeScore, live.awayScore], [30, 20], 'the in-progress game keeps its running points');
    eq(live.played, false, 'both sides have points but ESPN says UNDECIDED: NOT played');
    eq([live.margin, live.winner], [null, null], 'an undecided game has no margin and no winner');
    eq(w3.find((g) => g.homeId === 1).played, false, 'an unstarted game is not played');

    const tie = s.byWeek.get(1).find((g) => g.homeId === 1);
    eq([tie.played, tie.winner, tie.margin], [true, 'tie', 0], 'a TIE is a result, and a tie');
    const away = s.byWeek.get(2).find((g) => g.homeId === 2);
    eq([away.played, away.winner, away.margin], [true, 'away', -1], 'an AWAY win');
    eq(s.games.filter((g) => g.played).length, 4, 'four decided games in all');
    eq(Object.keys(s.games[0]).sort(),
      ['awayId', 'awayName', 'awayScore', 'homeId', 'homeName', 'homeScore', 'margin', 'played', 'week', 'winner'],
      'the normalised game shape is unchanged');

    const d = await season.fetchSeasonData();
    eq(d.games.length, 4, 'the stats path keeps only decided regular-season games');
    eq([...new Set(d.games.map((g) => g.week))].sort(), [1, 2], 'no week-3 and no week-4 game reaches the stats');
    eq(d.weeks, 2, 'two weeks played');
    ok('every stats game has a projection', d.games.every((g) => g.homeProjected > 0 && g.awayProjected > 0));
  },

  // 1 (fallback): no `winner` field, the old points rule.
  async legacy() {
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
    installFetch({ legacy: true });

    const s = await season.fetchSchedule();
    eq(s.weeks, [1, 2, 3], 'no tier means regular season');
    const w3 = s.byWeek.get(3);
    eq(w3.find((g) => g.homeId === 3).played, true, 'no winner field: points on the board still count, as before');
    eq(w3.find((g) => g.homeId === 3).winner, 'home', 'and the winner comes from the points');
    eq(w3.find((g) => g.homeId === 1).played, false, 'no winner field and no points: not played');
    const d = await season.fetchSeasonData();
    eq(d.games.length, 5, 'the stats path applies the same fallback');

    // The rules in isolation.
    eq(season.isDecidedEntry({ home: { totalPoints: 1 }, away: { totalPoints: 2 }, winner: 'UNDECIDED' }), false, 'UNDECIDED beats points');
    eq(season.isDecidedEntry({ home: { totalPoints: 0 }, away: { totalPoints: 0 }, winner: 'TIE' }), true, 'a 0-0 TIE is decided');
    eq(season.isDecidedEntry({ home: { totalPoints: 5 }, winner: 'HOME' }), false, 'a bye is never a result');
    eq(season.isRegularSeasonEntry({ playoffTierType: 'NONE' }), true, 'NONE is regular season');
    eq(season.isRegularSeasonEntry({}), true, 'absent is regular season');
    eq(season.isRegularSeasonEntry({ playoffTierType: 'WINNERS_CONSOLATION_LADDER' }), false, 'a ladder is not');
  },

  // 4, 5, 9, 10 with no cloud.
  async reads() {
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

    // --- 4: waiver status on the parsed free agent
    const parsed = wirePayload(3).players.map((e) => espn.parseFreeAgent(e, 3));
    eq(parsed.map((p) => p.status), ['WAIVERS', 'FREEAGENT', null, 'WAIVERS', 'FREEAGENT'], 'status per entry');
    eq(parsed.map((p) => p.waiverClears), [WAIVER_MS, null, null, null, null], 'waiverClears only on a dated WAIVERS entry');

    // --- 9: de-duplication
    let calls = installFetch();
    const [a, b] = await Promise.all([espn.fetchMatchups(), espn.fetchMatchups()]);
    eq(leagueCalls(calls).length, 1, 'two concurrent identical reads cost one request');
    ok('and share one answer', a === b);
    await espn.fetchMatchups();
    eq(leagueCalls(calls).length, 1, 'a third within the minute is shared too');
    await Promise.all([espn.fetchRosters(1), espn.fetchRosters(2), espn.fetchRosters(1)]);
    eq(leagueCalls(calls).length, 3, 'different weeks are different reads');
    await espn.fetchFreeAgents(1, 100);
    await espn.fetchFreeAgents(1, 150);
    await espn.fetchFreeAgents(1, 100);
    eq(leagueCalls(calls).length, 5, 'a different filter is a different read');
    await espn.fetchDraft();
    await espn.fetchDraft();
    eq(leagueCalls(calls).length, 7, 'the polled draft read is never shared');

    espn.clearReadCache();
    calls = installFetch({ failNext: 1 });
    let threw = false;
    try { await espn.fetchMatchups(); } catch { threw = true; }
    ok('a failing read rejects', threw);
    const again = await espn.fetchMatchups();
    eq(leagueCalls(calls).length, 2, 'a failure is not shared: the retry asks again');
    ok('and gets an answer', again && Array.isArray(again.schedule));

    espn.configure({ leagueId: '5550002' });
    await espn.fetchMatchups();
    eq(leagueCalls(calls).length, 3, 'another league is another read');
    espn.configure({ leagueId: LEAGUE_ID });

    // --- 5: bye weeks, direct
    espn.clearReadCache();
    const byesFail = installFetch({ dead: true });
    const empty = await season.fetchByeWeeks();
    eq(empty, {}, 'a failed bye read is {} and does not throw');
    calls = installFetch();
    const byes = await season.fetchByeWeeks();
    eq(byes, { 1: 7, 2: 9 }, 'byes by pro team id, zero-byes dropped (failure was not cached)');
    byes[1] = 99;
    const byes2 = await season.fetchByeWeeks();
    eq(byes2, { 1: 7, 2: 9 }, 'cached, and each caller gets its own copy');
    eq(calls.filter((u) => /proTeamSchedules_wl/.test(u)).length, 1, 'one bye request for the page');
    ok('the dead ESPN was asked once', byesFail.length === 1);

    // --- 10: the wire honours the limit, and carries the status (live path).
    // After the bye checks: the wire reads the byes too (the bye rule), and
    // run first it would cache a good answer before the failure case.
    const wire = await season.fetchWireWeek(3, 100);
    eq(wire.map((p) => p.status), ['WAIVERS', 'FREEAGENT', null, 'WAIVERS', 'FREEAGENT'], 'fetchWireWeek carries status');
    ok('fetchWireWeek asked ESPN for the limit given', calls.some((u) => /kona_player_info/.test(u)));


    espn.configure({ leagueId: 'demo' });
    const demo = await season.fetchByeWeeks();
    eq(demo, {}, 'demo never claims a bye');
    eq(calls.filter((u) => /proTeamSchedules_wl/.test(u)).length, 1, 'and asks nobody (the wire reused the cached byes)');
  },

  // 2, 4, 5, 10 through the cloud: sync on a "desktop", read on a "phone".
  async cloud() {
    const cloud = await import(moduleUrl('js/cloud.js'));
    const ownerUid = (readFileSync(path.join(REPO, 'js/cloud.js'), 'utf8').match(/ownerUid:\s*'([^']*)'/) || [])[1];
    const docs = new Map();
    const user = { uid: ownerUid, email: 't@example.com', name: 'T' };
    cloud.configure({
      transport: {
        async signIn() { return user; },
        async signOut() {},
        currentUser() { return user; },
        onAuth(cb) { cb(user); return () => {}; },
        async getDoc(p) { const r = docs.get(p); return r === undefined ? null : JSON.parse(r); },
        async setDoc(p, d) { docs.set(p, JSON.stringify(d)); },
      },
    });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

    // Desktop: nothing synced yet, so every read goes to ESPN.
    installFetch();
    const payload = await season.buildCloudPayload();
    eq(payload.weeks, [1, 2, 3, 4], 'the sync covers the regular season AND the playoff week');
    eq(payload.schedule.weeks, [1, 2, 3], 'while the synced schedule stays regular-season');
    eq(payload.byes, { 1: 7, 2: 9 }, 'the byes go up');
    const w = payload.wire.get(1);
    eq(w.map((p) => p.status), ['WAIVERS', 'FREEAGENT', null, 'WAIVERS', 'FREEAGENT'], 'the wire goes up with its status');
    const up = await cloud.syncUp(LEAGUE_ID, SEASON, payload);
    ok('the sync is written', up.ok, up.reason);

    // Phone: ESPN refuses everything; the cloud must answer.
    espn.clearReadCache();
    const calls = installFetch({ dead: true });

    const byes = await season.fetchByeWeeks();
    eq(byes, { 1: 7, 2: 9 }, 'byes come from the synced copy');

    const wire = await season.fetchWireWeek(1, 3);
    eq(wire.length, 3, 'the synced wire is sliced to the limit asked for');
    eq(wire.map((p) => p.status), ['WAIVERS', 'FREEAGENT', null], 'status survives the round trip');
    eq(wire.map((p) => p.waiverClears), [WAIVER_MS, null, null], 'waiverClears survives the round trip');
    const all = await season.fetchWireWeek(1);
    eq(all.length, 5, 'no limit: the whole synced list');

    const s = await season.fetchSchedule();
    eq(s.weeks, [1, 2, 3], 'the synced schedule is regular-season only');
    eq(s.playoffGames.length, 3, 'with its playoff games alongside');
    eq(s.byWeek.get(3).find((g) => g.homeId === 3).played, false, 'the in-progress game is still not played');

    const d = await season.fetchSeasonData();
    eq(d.games.length, 4, 'the stats path from the cloud sees the same four results');
    eq(leagueCalls(calls).length + calls.filter((u) => /proTeam/.test(u)).length, 0, 'the phone asked ESPN for nothing');
  },

  // 3, 6, 7, 8: the home page, booted on a fresh device with a league saved.
  async 'home-live'() { await homeScenario({ demoPref: false }); },
  async 'home-demo-pref'() { await homeScenario({ demoPref: true }); },

  // 3 on the stats page, end to end.
  async 'stats-ties'() {
    const { document } = await bootPage('stats.html', 'js/stats-page.js', {
      'ff.prefs': JSON.stringify({ 'stats.source': 'live' }),
    });
    await until(() => /Loaded/.test(document.getElementById('sourceStatus')?.textContent || ''));
    const glance = (document.getElementById('glance')?.textContent || '').replace(/\s+/g, ' ');
    ok('Best record is Charlie, 1–0–1 on points for', /Best record\s*1–0–1 Charlie/.test(glance), glance.slice(0, 300));
    const rows = Array.from(document.querySelectorAll('#mainTable tbody tr')).map((tr) => ({
      name: tr.children[0].textContent.trim(),
      rec: tr.children[1].textContent.trim(),
      key: Number(tr.children[1].getAttribute('data-v')),
    }));
    eq(Object.fromEntries(rows.map((r) => [r.name, r.rec]).sort()),
      { Alpha: '1–0–1', Bravo: '1–1', Charlie: '1–0–1', Delta: '0–2' },
      'records count only decided regular-season games');
    const order = [...rows].sort((a, b) => b.key - a.key).map((r) => r.name);
    eq(order, ['Charlie', 'Alpha', 'Bravo', 'Delta'], 'the W–L sort key is ESPN order: win %, then points for');
  },
};

// ---------------------------------------------------------- page harness

async function until(cond, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

async function bootPage(page, moduleRel, extraStore = {}) {
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

  const store = new Map(Object.entries({
    'ff.connection': JSON.stringify({ leagueId: LEAGUE_ID, season: SEASON, teamId: 4 }),
    ...extraStore,
  }));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  window.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '' };
  window.postMessage = () => {};
  window.localStorage = localStorage;

  Object.assign(globalThis, {
    window, document, localStorage,
    HTMLElement: window.HTMLElement,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Node: window.Node,
    location: window.location,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });

  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '' });
  const calls = installFetch();
  const mod = await import(moduleUrl(moduleRel));
  return { window, document, mod, calls };
}

async function homeScenario({ demoPref }) {
  const { document, mod, calls } = await bootPage(
    'index.html', 'js/home-page.js',
    demoPref ? { 'ff.prefs': JSON.stringify({ 'home.source': 'demo' }) } : {}
  );
  const text = (id) => (document.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();

  if (demoPref) {
    await new Promise((r) => setTimeout(r, 1500));
    eq(text('modeBadge'), 'Demo', 'an explicit Demo choice is respected');
    eq(leagueCalls(calls).filter((u) => /mMatchupScore/.test(u)).length, 0, 'and the league schedule is not read');
    return;
  }

  const live = await until(() => text('modeBadge') === 'Live');
  ok('a fresh device with a saved league goes live on its own', live, text('sourceStatus'));
  await until(() => /Week 3/.test(text('matchupsTitle')));

  eq(text('matchupsTitle'), 'Week 3 of 3', 'lands on week 3: week 2 is decided, week 3 is not (week 4 is playoffs)');
  eq(document.querySelectorAll('#weekSelect option').length, 3, 'three regular-season weeks to pick from');

  const cards = Array.from(document.querySelectorAll('#matchups .game'));
  eq(cards.length, 2, 'two matchups in week 3');
  ok('his game (Delta) is first', cards[0] && cards[0].classList.contains('mine') && /Delta/.test(cards[0].textContent));
  ok('and still highlighted', cards[0] && cards[0].className.includes('mine'));
  eq(cards.filter((c) => c.classList.contains('upcoming')).length, 2, 'the in-progress game is not shown as final');
  // His game is UNDER WAY (30–20, undecided), and since 2026-09-17 Home prices
  // a game exactly as Schedule does — which quotes no win chance for a game in
  // progress. tests/home-winpct-check.mjs covers the percentage itself.
  const meta = cards[0] ? cards[0].querySelector('.gmeta').textContent : '';
  ok('his in-progress game carries no win chance, as on Schedule', !/win chance \d/.test(meta), meta);
  ok('the basis is stated: our model, not ESPN’s', /our model, not ESPN/.test(text('matchupsNote')), text('matchupsNote'));
  ok('the method sits behind the toggle', /not one measured on this league/.test(text('matchupsExplain')) && !document.getElementById('matchupsExplain').closest('details').hasAttribute('hidden'), text('matchupsExplain'));

  // Bench: week 3 is not final, so week 2 is shown and says so.
  const benchRows = document.querySelectorAll('#bench tbody tr').length;
  eq(benchRows, 4, 'the bench panel shows the last final week, all four teams');
  ok('its key says which week', /Week 2, the latest final week/.test(text('benchKey')), text('benchKey'));
  ok('and the key is visible', !document.getElementById('benchKey').hasAttribute('hidden'));
  ok('the note is about week 2', /in week 2\./.test(text('benchNote')), text('benchNote'));

  // Standings: C, A, B, D. With equal games W−L and win % agree, so the
  // ordering claim is made on unequal games through the model below too.
  const st = Array.from(document.querySelectorAll('#standings tbody tr')).map((tr) => tr.children[0].textContent.trim());
  eq(st, ['Charlie', 'Alpha', 'Bravo', 'Delta'], 'standings: win %, then points for, regular season only');

  // Unequal games: X 2-1 with big points, Y 1-0-1. Win % puts Y first
  // (.750 > .667); wins-minus-losses calls them level and points pick X.
  const sched = {
    leagueName: 'x', teams: [{ id: 1, name: 'X' }, { id: 2, name: 'Y' }, { id: 3, name: 'Z' }, { id: 4, name: 'W' }],
    weeks: [1, 2, 3],
    byWeek: new Map(),
    games: [],
  };
  const g = (week, h, hs, a, as) => ({
    week, homeId: h, awayId: a, homeScore: hs, awayScore: as, played: true,
    homeName: '', awayName: '', margin: hs - as, winner: hs > as ? 'home' : as > hs ? 'away' : 'tie',
  });
  sched.games = [g(1, 1, 150, 3, 10), g(1, 2, 50, 4, 50), g(2, 1, 150, 4, 10), g(2, 2, 60, 3, 10), g(3, 1, 140, 3, 141)];
  for (const x of sched.games) {
    if (!sched.byWeek.has(x.week)) sched.byWeek.set(x.week, []);
    sched.byWeek.get(x.week).push(x);
  }
  const m = mod.buildModel({ schedule: sched, rosters: null, week: 3 });
  eq(m.standings.map((r) => `${r.name} ${r.w}-${r.l}-${r.t}`), ['Y 1-0-1', 'X 2-1-0', 'Z 1-2-0', 'W 0-1-1'],
    'a tie is half a win: 1-0-1 ranks above 2-1');
  eq(mod.winPct({ w: 0, l: 0, t: 2 }), 0.5, 'two ties are .500');
  eq(mod.winPct({ w: 0, l: 0, t: 0 }), null, 'no games, no percentage');
  eq(mod.benchWeekFor(sched, 3), 3, 'a final week is its own bench week');
}

// ------------------------------------------------------------------ run

const scen = process.argv[2];
if (scen) {
  try {
    await SCENARIOS[scen]();
  } catch (err) {
    fails.push(`threw: ${err && err.stack || err}`);
  }
  console.log(JSON.stringify({ scen, pass, fails }));
  process.exit(fails.length ? 1 : 0);
}

const self = fileURLToPath(import.meta.url);
let total = 0;
let bad = 0;
for (const name of Object.keys(SCENARIOS)) {
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8', timeout: 60000 });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  let r = null;
  try { r = JSON.parse(line); } catch { /* below */ }
  if (!r) {
    bad++;
    console.log(`FAIL ${name}\n  stdout=${(res.stdout || '').slice(0, 800)}\n  stderr=${(res.stderr || '').slice(0, 1500)}`);
    continue;
  }
  total += r.pass;
  console.log(`${r.fails.length ? 'FAIL' : 'PASS'} ${name}  (${r.pass} assertions)`);
  for (const f of r.fails) console.log(`   - ${f}`);
  if (r.fails.length) bad++;
}
if (bad) {
  console.log(`\n${bad} scenario(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${total} assertions passed across ${Object.keys(SCENARIOS).length} scenarios`);
