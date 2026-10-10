// The main menu's data layer: js/leagues.js, and the mark js/prefs.js puts on
// the preferences so one league's never land in another's.
//
//   node test-leagues.mjs
//
// Why this suite exists. The site stores one league's choices in single slots
// (`ff.prefs`, `ff-draft-review-v1`) and reads one league through the
// connection slot. The menu switches leagues by PARKING those slots and putting
// another league's back. Every way that can go wrong loses or leaks something a
// person typed: a saved trade naming league A's players showing up in league B,
// a switch that half-happens in a full browser, a page of the league left
// behind writing its whole old picture over the new one, a Remove that deletes
// a season of readings. Each of those is asserted here against storage itself.
//
// The storage is a real Storage's methods over a Map, holding what a browser
// mid-season holds: a connection as js/connection.js saves it (ten teams),
// preferences with saved and assumed trades, weeks, a reading, a draft copy.

import { moduleUrl } from './repo.mjs';

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
};
const eq = (a, b, name) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

let store = new Map();
/** Keys whose write is refused, as a full browser refuses one. */
let refuse = () => false;
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (refuse(k)) throw new Error('QuotaExceededError');
    store.set(k, String(v));
  },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const bridge = await import(moduleUrl('js/bridge.js'));
// Loaded softly, so that against a build without the module every assertion
// fails by name instead of the suite dying on the import.
const leagues = await import(moduleUrl('js/leagues.js')).catch(() => ({
  SEASON_MIN: null, PARKED: [], keyOf: () => '', list: () => [], current: () => null, add: () => null,
  remove: () => false, open: () => ({ ok: false, reason: 'no module' }), lookup: async () => ({ ok: false, reason: 'no module' }),
  isRemoved: () => false, awaitingProbe: () => false, leagueSpecific: () => false,
}));
/** A page's own copy of js/prefs.js: every "tab" gets its own module instance. */
const tab = (name) => import(`${moduleUrl('js/prefs.js')}?tab=${name}`);

const NOW = bridge.currentSeason();
const A = '476225250';
const B = '1241838';
const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, abbrev: `T${i + 1}` }));

const TRADE_1 = { a: 1, b: 2, sendA: ['4262921'], sendB: ['3116406', '15847'] };
const TRADE_2 = { a: 3, b: 7, sendA: ['4426348'], sendB: ['4241389'] };
const ASSUMED = { entry: { a: 4, b: 5, sendA: ['2976212'], sendB: ['4047365'] }, src: 'saved', at: 1759700000000 };
/** League A's preferences: the league's own choices, and display choices. */
const PREFS_A = {
  'home.source': 'live', 'schedule.source': 'demo', 'schedule.week': 4, 'schedule.forecastTeam': 6, 'schedule.runs': 100000,
  'trade.goal': 'title', 'trade.team': 7, 'trade.week': 5, 'trade.custom': [TRADE_1, TRADE_2], 'trade.assumed': ASSUMED,
  'trade.valueView': 'value', 'waivers.team': 7, 'waivers.span': '5', 'waivers.position': 'RB',
  'analysis.team': 7, 'analysis.week': 5, 'analysis.measure': 'weeks', [`analysis.rows.live:${A}:${NOW}`]: 'player',
  'stats.highlight': 7, 'stats.fitTeamsBy': 'linear',
  'decisions.noise': true, [`decisions.team.${A}-${NOW}`]: 7, [`decisions.whatif.${A}-${NOW}`]: [{ id: 'x1', kind: 'trade' }],
  [`decisions.all.${A}-${NOW}`]: true, 'decisions.whatif.demo': [{ id: 'd1' }],
  [`draft.team.${A}-${NOW}`]: 7, 'draft.compare': 'pre',
};
const LEAGUE_ONLY = [
  'schedule.week', 'schedule.forecastTeam', 'trade.team', 'trade.week', 'trade.custom', 'trade.assumed', 'waivers.team',
  'analysis.team', 'analysis.week', `analysis.rows.live:${A}:${NOW}`, 'stats.highlight',
  `decisions.team.${A}-${NOW}`, `decisions.whatif.${A}-${NOW}`, `decisions.all.${A}-${NOW}`, `draft.team.${A}-${NOW}`,
];
const DISPLAY = [
  'schedule.runs', 'trade.goal', 'trade.valueView', 'waivers.span', 'waivers.position', 'analysis.measure',
  'stats.fitTeamsBy', 'decisions.noise', 'decisions.whatif.demo', 'draft.compare',
];
const REVIEW_A = { league: `${A}-${NOW}`, kept: { ranks: { 4262921: 3, 3116406: 11 }, at: 1759000000000 } };

/** League data, keyed by league and season already: never the switch's to touch. */
const DATA = {
  [`ff.weeks.1.${A}.${NOW}.4`]: JSON.stringify({ v: 1, final: true, teams: TEAMS.map((t) => ({ id: t.id, players: [] })) }),
  [`ff.snap.${A}.${NOW}.4`]: JSON.stringify({ v: 2, leagueId: A, season: NOW, week: 4, forecast: [] }),
  [`ff.projhist.1.${A}.${NOW}.4`]: JSON.stringify({ v: 1, week: 4, teams: [] }),
  [`ff.decisions.1.${A}.${NOW}.3`]: JSON.stringify({ v: 1, moves: [], players: {} }),
  [`ff.value.${A}-${NOW}`]: JSON.stringify({ lines: { QB: [14.2, 17.9] } }),
  'ff.cloud': JSON.stringify({ [`${A}::${NOW}`]: { at: 1759700000000, ok: true, wrote: 12, reason: '' } }),
  'ff-draft-room-v1': JSON.stringify({ picks: [1, 2, 3] }),
  'ff-draft-history-v1': JSON.stringify([{ at: 1 }]),
};

/** What js/connection.js `save()` writes, for league A, team 7. */
const CONN_A = {
  leagueId: A, season: NOW, teamId: 7,
  league: { leagueId: A, season: NOW, name: 'The Keeper League', teamCount: 10, currentWeek: 6, teams: TEAMS },
  checkedAt: 1760000000000, source: 'espn',
};

function browser({ prefs = PREFS_A, conn = CONN_A, review = REVIEW_A, extra = {} } = {}) {
  store = new Map();
  refuse = () => false;
  if (conn) {
    store.set('ff.connection', JSON.stringify(conn));
    store.set('ff.config', JSON.stringify({ leagueId: conn.leagueId, season: conn.season }));
  }
  if (prefs) store.set('ff.prefs', JSON.stringify(prefs));
  if (review) store.set('ff-draft-review-v1', JSON.stringify(review));
  for (const [k, v] of Object.entries({ ...DATA, ...extra })) store.set(k, v);
}
const dump = () => JSON.stringify([...store.entries()].sort());
const json = (k) => (store.has(k) ? JSON.parse(store.get(k)) : null);
const dataIntact = () => Object.entries(DATA).every(([k, v]) => store.get(k) === v);

// =========================================================================
// 1. A BROWSER THAT HAS NEVER SEEN THE MENU
// =========================================================================
{
  eq([leagues.SEASON_MIN, leagues.PARKED, leagues.keyOf(A, NOW)], [2019, ['ff.prefs', 'ff-draft-review-v1'], `${A}-${NOW}`],
    'the constants the menu page is written against');

  browser();
  const before = dump();
  const l = leagues.list();
  eq(l, [{
    leagueId: A, name: 'The Keeper League', teamCount: 10, seasons: [NOW],
    teams: { [NOW]: { id: 7, name: 'Team 7' } }, lastOpened: { season: NOW, at: 1760000000000 },
  }], 'the list is the saved connection: its name, its size, its season, the "You are" team');
  eq(leagues.current(), { leagueId: A, season: NOW, teamId: 7 }, 'and current() is what the slot holds');
  ok('reading the list wrote NOTHING and parked nothing', dump() === before);
  ok('no ff.leagues key yet', !store.has('ff.leagues'));

  // The older key alone (index.html wrote it before the bar existed).
  browser({ conn: null, prefs: null, review: null });
  store.set('ff.config', JSON.stringify({ leagueId: B, season: NOW }));
  eq(leagues.current(), { leagueId: B, season: NOW, teamId: null }, 'the older ff.config key alone is read too');
  eq(leagues.list().map((e) => [e.leagueId, e.name, e.seasons, e.teams]), [[B, `League ${B}`, [NOW], {}]],
    'and seeds a league with no name and no team known');

  browser({ conn: null });
  eq([leagues.list(), leagues.current()], [[], null], 'nothing connected: an empty list, and no current league');

  browser({ conn: { leagueId: 'demo', season: NOW } });
  eq(leagues.list(), [], 'a league id that is not a number is never listed');
}

// =========================================================================
// 2. ADDING: A MERGE THAT NEVER DROPS
// =========================================================================
{
  browser();
  const before = store.get('ff.prefs');
  const added = leagues.add({
    leagueId: B, name: 'Work League', teamCount: 12, season: NOW,
    seasons: [NOW, NOW - 1, NOW - 2, 2019, 2018, 2017, 2016],
  });
  eq(added, {
    leagueId: B, name: 'Work League', teamCount: 12, seasons: [NOW, NOW - 1, NOW - 2, 2019].filter((s, i, a) => a.indexOf(s) === i),
    teams: {}, lastOpened: null,
  }, 'a league is added with its seasons newest first, and nothing before 2019');
  eq(leagues.list().map((e) => e.leagueId), [A, B], 'the list is most recently opened first: the open league, then the new one');
  ok('the seeded league went into the stored list with it', json('ff.leagues').leagues.some((e) => e.leagueId === A));
  ok('adding parked nothing and left the preferences alone',
    store.get('ff.prefs') === before && ![...store.keys()].some((k) => k.includes('@')));

  // What the connection bar sends after a connect: this season only.
  const again = leagues.add({ leagueId: B, teamCount: 12, seasons: [NOW], season: NOW, team: { id: 4, name: 'Bench Mob' } });
  eq([again.name, again.seasons.length, again.teams], ['Work League', added.seasons.length, { [NOW]: { id: 4, name: 'Bench Mob' } }],
    'a later add with less in it drops no season and no name, and records the team for its season');
  const third = leagues.add({ leagueId: B, name: 'Work League 2', season: NOW - 1, team: { id: 9, name: 'Last Year' } });
  eq([third.name, third.teams], ['Work League 2', { [NOW - 1]: { id: 9, name: 'Last Year' }, [NOW]: { id: 4, name: 'Bench Mob' } }],
    'a team is kept per season, and a new name replaces the old');
  eq(leagues.add({ leagueId: B, season: NOW, team: undefined }).teams[NOW], { id: 4, name: 'Bench Mob' },
    'an add with no team keeps the known one');
  eq([leagues.add({ leagueId: 'demo', name: 'Demo' }), leagues.add({}), leagues.list().length], [null, null, 2],
    'demo, or nothing, is not added');
}

// =========================================================================
// 3. SWITCHING: PARK, RESTORE, AND BACK AGAIN
// =========================================================================
{
  browser();
  leagues.add({ leagueId: B, name: 'Work League', teamCount: 12, seasons: [NOW, NOW - 1], season: NOW, team: { id: 4, name: 'Bench Mob' } });
  const prefsA = store.get('ff.prefs');
  const reviewA = store.get('ff-draft-review-v1');

  // Opening what is already open changes nothing at all.
  const before = dump();
  eq(leagues.open(A, NOW), { ok: true, href: 'index.html' }, 'opening the league-season already open succeeds');
  ok('and is a no-op', dump() === before);

  const t0 = Date.now();
  eq(leagues.open(B, NOW), { ok: true, href: 'index.html' }, 'opening league B answers with the page to go to');
  eq([store.get('ff.connection'), store.get('ff.config')],
    Array(2).fill(JSON.stringify({ leagueId: B, season: NOW, teamId: 4 })),
    'the connection slot holds ONLY the league, the season and the team — no name, no "checked", so the bar must ask again');
  eq(leagues.current(), { leagueId: B, season: NOW, teamId: 4 }, 'current() follows');
  ok('league A’s preferences are parked under its name, byte for byte', store.get(`ff.prefs@${A}-${NOW}`) === prefsA);
  ok('and its draft copy', store.get(`ff-draft-review-v1@${A}-${NOW}`) === reviewA);
  ok('nothing keyed by league was touched', dataIntact());
  eq(leagues.PARKED.map((k) => store.has(`${k}@${B}-${NOW}`)), [false, false], 'nothing is parked for B: it was not the one left');

  const inB = json('ff.prefs');
  eq(LEAGUE_ONLY.filter((k) => k in inB), [], 'A LEAGUE NEVER OPENED starts with none of A’s teams, weeks or trades');
  eq(DISPLAY.filter((k) => JSON.stringify(inB[k]) !== JSON.stringify(PREFS_A[k])), [], 'and with every display choice carried over');
  eq(['home', 'analysis', 'schedule', 'stats', 'summary', 'trade', 'waivers', 'decisions', 'draft'].map((p) => inB[`${p}.source`]),
    Array(9).fill('live'), 'showing live data on every page (A had Schedule on demo)');
  const prefsMod = await tab('probe');
  eq(inB[prefsMod.STAMP], `${B}-${NOW}`, 'and marked as league B’s, with the mark js/prefs.js reads');
  // No id of A's survives anywhere in B's set: the player ids of its trades.
  const leaked = ['4262921', '3116406', '15847', '4426348', '4241389', '2976212', '4047365'].filter((id) => store.get('ff.prefs').includes(id));
  eq(leaked, [], 'no player of A’s trades is anywhere in B’s preferences');

  const listed = leagues.list();
  eq(listed.map((e) => e.leagueId), [B, A], 'B is now first: most recently opened');
  ok('with when it was opened', listed[0].lastOpened.season === NOW && listed[0].lastOpened.at >= t0, JSON.stringify(listed[0].lastOpened));
  eq([leagues.awaitingProbe(B, NOW), leagues.awaitingProbe(A, NOW)], [true, false], 'the bar is told B has yet to be probed');

  // B's own page sets B's own choices.
  const pageB = await tab('B');
  const TRADE_B = { a: 2, b: 9, sendA: ['111'], sendB: ['222'] };
  pageB.set('trade.custom', [TRADE_B]);
  pageB.set('trade.team', 4);
  pageB.set('trade.goal', 'last');
  eq(json('ff.prefs')[prefsMod.STAMP], `${B}-${NOW}`, 'a page’s own save keeps the mark');
  // The bar connects, and says so.
  leagues.add({ leagueId: B, name: 'Work League', teamCount: 12, seasons: [NOW], season: NOW, team: { id: 4, name: 'Bench Mob' }, source: 'espn' });
  eq(leagues.awaitingProbe(B, NOW), false, 'a connect (add) clears the "yet to be probed" note');
  const prefsB = store.get('ff.prefs');

  // ... and back to A.
  eq(leagues.open(A, NOW).ok, true, 'reopening league A');
  const backA = json('ff.prefs');
  eq(backA['trade.custom'], [TRADE_1, TRADE_2], 'A’s SAVED TRADES ARE BACK');
  eq([backA['trade.assumed'], backA['trade.team'], backA['trade.goal'], backA['schedule.source'], backA['stats.highlight']],
    [ASSUMED, 7, 'title', 'demo', 7], 'with its assumed trade, its team, its goal and its own data sources');
  const { [prefsMod.STAMP]: mark, ...restA } = backA;
  eq([restA, mark], [PREFS_A, `${A}-${NOW}`], 'exactly as they were left, plus the mark');
  ok('B’s trade is nowhere in them', !store.get('ff.prefs').includes('"111"'));
  ok('B’s are parked as B left them', store.get(`ff.prefs@${B}-${NOW}`) === prefsB);
  ok('A’s draft copy is in its slot', store.get('ff-draft-review-v1') === reviewA);
  eq(json('ff.connection'), { leagueId: A, season: NOW, teamId: 7 }, 'and the slot is A, with A’s team');

  // ... and B again.
  leagues.open(B, NOW);
  const backB = json('ff.prefs');
  eq([backB['trade.custom'], backB['trade.team'], backB['trade.goal']], [[TRADE_B], 4, 'last'], 'B’s own choices come back with B');
  ok('and A’s trades are absent again', !store.get('ff.prefs').includes('4262921'));
  ok('through all of it, nothing keyed by league was touched', dataIntact());

  // An earlier season of the same league is its own league-season.
  eq(leagues.open(B, NOW - 1).ok, true, 'opening B’s earlier season');
  eq(json('ff.connection'), { leagueId: B, season: NOW - 1, teamId: null }, 'the slot names that season, and no team is assumed for it');
  const early = json('ff.prefs');
  eq(['trade.custom', 'trade.team'].filter((k) => k in early), [], 'it does not inherit this season’s trades or team');
  eq([early['trade.goal'], early[prefsMod.STAMP]], ['last', `${B}-${NOW - 1}`], 'but does inherit the display choices, under its own mark');
  eq(leagues.list()[0].lastOpened.season, NOW - 1, 'and the list remembers which season was opened last');

  // What cannot be opened.
  const stuck = dump();
  eq(leagues.open('999', NOW).ok, false, 'a league not on the list is refused');
  eq(leagues.open(B, 2017).ok, false, 'and so is a season the league does not list');
  ok('each with a reason', typeof leagues.open('999', NOW).reason === 'string' && leagues.open(B, 2017).reason.length > 5);
  ok('and nothing changed', dump() === stuck);
}

// A browser with no league at all: the first one opened takes the preferences
// in use, and a copy of them is kept rather than lost.
{
  browser({ conn: null, review: null, prefs: { 'home.source': 'demo', 'trade.team': 2, 'schedule.runs': 100000 } });
  const had = store.get('ff.prefs');
  leagues.add({ leagueId: B, name: 'Work League', teamCount: 12, seasons: [NOW], season: NOW });
  eq(leagues.open(B, NOW).ok, true, 'the first league is opened from a browser with none');
  eq([json('ff.prefs')['schedule.runs'], 'trade.team' in json('ff.prefs'), json('ff.prefs')['home.source']], [100000, false, 'live'],
    'display choices carry in, the demo team does not, and the pages go live');
  ok('the preferences it had are kept, not overwritten', store.get('ff.prefs@none') === had);
}

// =========================================================================
// 4. A FULL BROWSER: THE SWITCH DOES NOT HALF-HAPPEN
// =========================================================================
{
  for (const [what, blocked] of [
    ['the park write', (k) => k.startsWith('ff.prefs@')],
    ['the draft copy’s park write', (k) => k.startsWith('ff-draft-review-v1@')],
    ['the preferences’ own write', (k) => k === 'ff.prefs'],
    ['the connection write', (k) => k === 'ff.config'],
    ['the list’s write', (k) => k === 'ff.leagues'],
  ]) {
    browser();
    leagues.add({ leagueId: B, name: 'Work League', teamCount: 12, seasons: [NOW], season: NOW });
    const before = dump();
    refuse = blocked;
    const res = leagues.open(B, NOW);
    refuse = () => false;
    ok(`${what} refused: the switch is refused, with a reason`, res.ok === false && typeof res.reason === 'string' && res.reason.length > 5, JSON.stringify(res));
    ok(`${what} refused: NOTHING changed`, dump() === before);
    eq(leagues.current(), { leagueId: A, season: NOW, teamId: 7 }, `${what} refused: league A is still the open one`);
  }
}

// =========================================================================
// 5. REMOVE TAKES IT OFF THE LIST AND DELETES NOTHING
// =========================================================================
{
  // A league that is not open.
  browser();
  leagues.add({ leagueId: B, name: 'Work League', teamCount: 12, seasons: [NOW], season: NOW });
  leagues.open(B, NOW);
  leagues.open(A, NOW);
  const parkedB = store.get(`ff.prefs@${B}-${NOW}`);
  const slot = store.get('ff.connection');
  eq(leagues.remove(B), true, 'removing a league that is not open');
  eq(leagues.list().map((e) => e.leagueId), [A], 'takes it off the list');
  ok('keeps what it had parked', parkedB != null && store.get(`ff.prefs@${B}-${NOW}`) === parkedB);
  ok('leaves the open league’s slot alone', store.get('ff.connection') === slot);
  eq([leagues.isRemoved(B), leagues.isRemoved(A)], [true, false], 'and is remembered as removed');
  eq(leagues.remove(B), false, 'removing it twice says it was not there');

  // The league that is open.
  browser();
  const prefsA = store.get('ff.prefs');
  eq(leagues.remove(A), true, 'removing the OPEN league');
  eq(leagues.list(), [], 'empties the list');
  eq([store.has('ff.connection'), store.has('ff.config'), leagues.current()], [false, false, null],
    'and the connection slot, so the site does not walk straight back in');
  ok('EVERY WEEK, READING AND SAVED PROJECTION IS STILL THERE', dataIntact());
  ok('its preferences are kept under its name', store.get(`ff.prefs@${A}-${NOW}`) === prefsA);
  ok('its draft copy too', store.get(`ff-draft-review-v1@${A}-${NOW}`) === JSON.stringify(REVIEW_A));
  const left = json('ff.prefs');
  eq([LEAGUE_ONLY.filter((k) => k in left), DISPLAY.filter((k) => !(k in left)), '@league' in left, left['schedule.source']], [[], [], false, 'demo'],
    'what is left in the slot is no league’s: display choices only, unmarked, sources as they were');
  eq(leagues.isRemoved(A), true, 'it is remembered as removed, so nothing reconnects to it by itself');
  // The stored shape test-cloud-wiring.mjs `removed-sticks` hands the bar.
  eq(json('ff.leagues'), { v: 1, leagues: [], removed: [A], probe: null, source: null }, 'the list as stored: empty, with the league noted as removed');

  // Added back by hand, it opens with everything it had.
  leagues.add({ leagueId: A, name: 'The Keeper League', teamCount: 10, seasons: [NOW], season: NOW, team: { id: 7, name: 'Team 7' } });
  eq(leagues.isRemoved(A), false, 'adding it back clears that');
  eq(leagues.open(A, NOW).ok, true, 'and it opens again');
  eq(json('ff.prefs')['trade.custom'], [TRADE_1, TRADE_2], 'with its saved trades');

  // A full browser: the league still comes off, and its preferences are not half-rewritten.
  browser();
  refuse = (k) => k.includes('@');
  leagues.remove(A);
  refuse = () => false;
  eq([leagues.current(), store.get('ff.prefs') === prefsA, dataIntact()], [null, true, true],
    'when the copy cannot be written the preferences stay as they are, and the data is untouched');
}

// =========================================================================
// 6. STORAGE THAT CANNOT BE TRUSTED
// =========================================================================
{
  for (const bad of ['not json', '{"leagues":5}', '[1,2]', 'null', '{"v":1}', '']) {
    browser({ extra: { 'ff.leagues': bad } });
    let l = null;
    try { l = leagues.list(); } catch (err) { l = String(err); }
    eq(Array.isArray(l) && l.map((e) => e.leagueId), [A], `ff.leagues = ${JSON.stringify(bad)}: the list is seeded from the connection`);
  }

  browser({
    conn: null,
    extra: {
      'ff.leagues': JSON.stringify({
        v: 1,
        leagues: [
          null, 7, { name: 'no id' }, { leagueId: 'abc' },
          { leagueId: B, seasons: [NOW, '2020', 1999, 'x', NOW], teams: { [NOW]: { id: 4 }, junk: 5, 2020: null }, lastOpened: 'yesterday', teamCount: 'ten' },
          { leagueId: B, name: 'a second copy' },
        ],
      }),
    },
  });
  eq(leagues.list(), [{ leagueId: B, name: `League ${B}`, teamCount: null, seasons: [NOW, 2020], teams: { [NOW]: { id: 4, name: 'Team 4' } }, lastOpened: null }],
    'a damaged list is read for what is sound in it: one entry per league, real seasons, real teams');

  browser({ extra: { 'ff.connection': '{broken', 'ff.config': 'also broken' } });
  eq([leagues.list(), leagues.current()], [[], null], 'an unreadable connection is no connection');

  // Storage that throws on every touch (blocked site data).
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  let threw = null;
  let out = null;
  try {
    out = [leagues.list(), leagues.current(), leagues.add({ leagueId: B, name: 'Work League', season: NOW }).leagueId,
      leagues.remove(B), leagues.open(B, NOW).ok, leagues.isRemoved(B), leagues.awaitingProbe(B, NOW)];
  } catch (err) { threw = String(err); }
  globalThis.localStorage = real;
  eq([threw, out], [null, [[], null, B, false, false, false, false]], 'with storage refusing everything, nothing throws');
}

// =========================================================================
// 7. THE MARK: A PAGE OF THE LEAGUE LEFT BEHIND CANNOT OVERWRITE
// =========================================================================
{
  // Preferences from before the mark: they are the open league's.
  browser();
  const page = await tab('legacy');
  eq(page.get('trade.team'), 7, 'preferences with no mark read as they always did');
  page.set('trade.goal', 'last');
  const saved = json('ff.prefs');
  eq([saved['@league'], saved['trade.goal'], saved['trade.custom']], [`${A}-${NOW}`, 'last', [TRADE_1, TRADE_2]],
    'their first save marks them as the open league’s, and keeps everything in them');

  // With no league connected nothing is marked: the key is written as it always was.
  browser({ conn: null, review: null, prefs: { 'home.source': 'demo' } });
  const demo = await tab('demo');
  demo.set('schedule.week', 3);
  eq(store.get('ff.prefs'), JSON.stringify({ 'home.source': 'demo', 'schedule.week': 3 }), 'no league, no mark: byte for byte what the old build wrote');
  demo.set('@league', 'forged');
  eq(store.get('ff.prefs'), JSON.stringify({ 'home.source': 'demo', 'schedule.week': 3 }), 'and the mark cannot be set by hand');

  // THE CASE: a tab on league A, and the menu opens league B in another.
  browser();
  leagues.add({ leagueId: B, name: 'Work League', teamCount: 12, seasons: [NOW], season: NOW });
  const stale = await tab('stale');
  eq(stale.get('trade.custom', []).length, 2, 'the page of league A has read A’s two saved trades');
  leagues.open(B, NOW);
  const inB = store.get('ff.prefs');
  stale.set('trade.custom', [TRADE_1, TRADE_2, { a: 1, b: 3, sendA: ['5'], sendB: ['6'] }]);
  ok('ITS WRITE IS DROPPED: league B’s preferences are untouched', store.get('ff.prefs') === inB,
    `${(store.get('ff.prefs') || '').slice(0, 200)}`);
  ok('no trade of A’s reached B', !store.get('ff.prefs').includes('4262921'));
  eq(stale.get('trade.custom', null), null, 'and the page’s own picture is read again: it now sees B’s');
  stale.set('waivers.span', '7');
  eq([json('ff.prefs')['waivers.span'], json('ff.prefs')['@league'], 'trade.custom' in json('ff.prefs')], ['7', `${B}-${NOW}`, false],
    'after which it writes as a page of league B, still without A’s trades');

  // The same tab, and the league it shows is removed on the menu.
  browser();
  const orphan = await tab('orphan');
  eq(orphan.get('trade.team'), 7, 'a page of league A');
  leagues.remove(A);
  const neutral = store.get('ff.prefs');
  orphan.set('trade.team', 3);
  ok('cannot put A’s choices into the unmarked preferences left behind', store.get('ff.prefs') === neutral);

  // The first league ever connected, after the page loaded with none.
  browser({ conn: null, review: null, prefs: { 'home.source': 'demo' } });
  const first = await tab('first');
  eq(first.get('home.source'), 'demo', 'a page loaded with no league');
  store.set('ff.connection', JSON.stringify(CONN_A));
  first.set('home.source', 'live');
  eq(json('ff.prefs'), { 'home.source': 'live', '@league': `${A}-${NOW}` }, 'keeps its save when a league is connected under it, and takes that league’s mark');
}

// =========================================================================
// 8. LOOKING A LEAGUE UP, FOR "ADD A LEAGUE"
// =========================================================================
{
  /** ESPN's league payload for mTeam + mSettings + mStatus. */
  const RAW = {
    settings: { name: 'Work League', size: 12 },
    status: { currentMatchupPeriod: 6, previousSeasons: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].filter((s) => s < NOW) },
    teams: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, location: 'Team', nickname: `No ${i + 1}`, abbrev: `N${i + 1}` })),
  };
  const WANT_SEASONS = [NOW, ...RAW.status.previousSeasons.filter((s) => s >= 2019).sort((a, b) => b - a)];
  const fetcher = (status = 200, body = RAW) => {
    const calls = [];
    const f = async (url, init) => { calls.push({ url: String(url), init }); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
    f.calls = calls;
    return f;
  };
  const noBridge = { settled: async () => false, isAvailable: () => false, league: async () => { throw new Error('no bridge'); } };
  const withBridge = (answer) => {
    const asked = [];
    return { asked, settled: async () => true, isAvailable: () => true, league: async (req) => { asked.push(req); return answer; } };
  };

  browser();
  // The extension: the only reader of a private league.
  let f = fetcher();
  let br = withBridge({ ok: true, data: RAW });
  let res = await leagues.lookup(` ${B} `, { bridge: br, fetch: f });
  eq(res, {
    ok: true, leagueId: B, name: 'Work League', teamCount: 12, seasons: WANT_SEASONS,
    teams: RAW.teams.map((t) => ({ id: t.id, name: `Team ${t.nickname}` })),
  }, 'through the extension: the league, its size, its teams, and this season plus the earlier ones ESPN lists from 2019 on');
  eq([br.asked.length, br.asked[0].leagueId, br.asked[0].season, br.asked[0].views.includes('mStatus'), f.calls.length], [1, B, NOW, true, 0],
    'one bridge read of the current season with the status view, and no direct request');
  res = await leagues.lookup(B, { bridge: withBridge({ ok: false, error: 'ESPN said no.' }), fetch: f });
  eq(res, { ok: false, reason: 'ESPN said no.' }, 'the extension’s refusal is handed on as the reason');

  // No extension: ESPN directly, as the bar does for a public league.
  f = fetcher();
  res = await leagues.lookup(B, { bridge: noBridge, fetch: f, synced: async () => false });
  eq([res.ok, res.name, res.seasons, res.teams.length], [true, 'Work League', WANT_SEASONS, 12], 'without the extension the same answer comes from ESPN directly');
  ok('one request, for that league’s current season, with the status view',
    f.calls.length === 1 && f.calls[0].url.includes(`/seasons/${NOW}/segments/0/leagues/${B}?`) && /view=mStatus/.test(f.calls[0].url) &&
    /view=mTeam/.test(f.calls[0].url) && /view=mSettings/.test(f.calls[0].url), JSON.stringify(f.calls));
  for (const [status, word] of [[401, 'private'], [403, 'private'], [404, 'not found'], [500, '500']]) {
    res = await leagues.lookup(B, { bridge: noBridge, fetch: fetcher(status), synced: async () => false });
    ok(`HTTP ${status} is a reason, not a throw`, res.ok === false && res.reason.toLowerCase().includes(word), JSON.stringify(res));
  }
  res = await leagues.lookup(B, { bridge: noBridge, fetch: async () => { throw new Error('offline'); }, synced: async () => false });
  eq(res.ok, false, 'a request that cannot be made is a reason too');
  res = await leagues.lookup(B, { bridge: noBridge, fetch: fetcher(200, {}), synced: async () => false });
  eq([res.ok, res.name, res.seasons, res.teams], [true, `League ${B}`, [NOW], []], 'an answer with nothing in it still names the league and this season');

  f = fetcher();
  for (const bad of ['', 'abc', '12 34', null, undefined]) {
    res = await leagues.lookup(bad, { bridge: noBridge, fetch: f, synced: async () => false });
    ok(`"${bad}" is not a league id`, res.ok === false && typeof res.reason === 'string', JSON.stringify(res));
  }
  eq(f.calls.length, 0, 'and nothing is asked for one');

  // RULE 20: on the phone's synced copy, ESPN is never asked.
  browser({ conn: { ...CONN_A, source: 'cloud' } });
  f = fetcher();
  res = await leagues.lookup(B, { bridge: noBridge, fetch: f });
  eq([res.ok, typeof res.reason, f.calls.length], [false, 'string', 0], 'the slot says "synced copy": no ESPN request, and a reason instead');

  // The menu has just opened a league there: the slot no longer says, the list does.
  browser({ conn: { ...CONN_A, source: 'cloud' } });
  leagues.add({ leagueId: A, name: 'The Keeper League', teamCount: 10, seasons: [NOW, NOW - 1], season: NOW, source: 'cloud' });
  leagues.open(A, NOW - 1);
  ok('the slot the menu wrote carries no source', !('source' in json('ff.connection')));
  f = fetcher();
  res = await leagues.lookup(B, { bridge: noBridge, fetch: f });
  eq([res.ok, f.calls.length], [false, 0], 'the bar’s last connect was the synced copy: still no ESPN request');

  // A computer with the extension reads live whatever an old slot says.
  browser({ conn: { ...CONN_A, source: 'cloud' } });
  br = withBridge({ ok: true, data: RAW });
  res = await leagues.lookup(B, { bridge: br, fetch: f });
  eq([res.ok, br.asked.length, f.calls.length], [true, 1, 0], 'with the extension present the league is read through it');

  // Once the bar has connected live, the list says so and a lookup is allowed.
  browser();
  leagues.add({ leagueId: A, season: NOW, source: 'cloud' });
  eq(json('ff.leagues').source, 'cloud', 'the bar’s synced connect is noted in the list');
  leagues.add({ leagueId: A, season: NOW, source: 'espn' });
  eq(json('ff.leagues').source, 'espn', 'and a live connect after it replaces the note');
  f = fetcher();
  res = await leagues.lookup(B, { bridge: noBridge, fetch: f, synced: async () => false });
  eq([res.ok, f.calls.length], [true, 1], 'a live connect since then clears the note');
}

// ---------------------------------------------------------------------------

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
