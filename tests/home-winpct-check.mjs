// Home and Schedule quote the SAME win chance for the same game.
//
// They once did not: on Tim's real league Charlie v Luke read 41.6% on Home
// and 49.3% on Schedule, because Home compared the lineups as currently SET
// against an assumed 27-point spread, while Schedule compared the BEST legal
// lineups against the spread measured from the league's played weeks.
//
// Every number starts as a raw ESPN payload behind a stub `fetch`, and both
// real pages are booted on it, each in its own child process (the page
// modules self-boot on import). A third child works the chance out along the
// Schedule page's own route, one js/capture.js primitive at a time — not
// through `capture.matchupOdds`, which is what Home now calls — so the
// reference is not Home agreeing with itself. Then:
//
//   - Home's unrounded chance (data-home-win) equals the reference to 0.1 pt;
//   - the whole percent each page PRINTS is the same, and is the reference's;
//   - the fixture discriminates: the old Home method (set lineup, 27 points)
//     lands at least 3 points away on at least one game, so reverting Home to
//     it fails this suite.
//
// Two leagues:
//   calibrated  weeks 1-3 final (12 team-weeks, so the spread is MEASURED —
//               about 5 points here, far from 27); week 4 is the one quoted.
//   assumed     week 1 final only (4 team-weeks: the spread is 27);
//               week 2 is the one quoted.
// In both, team 1 has a QB on the bench projected 14 points above the one he
// starts, and team 3 an RB 8 points above his — so set and best lineups differ.
//
//   node home-winpct-check.mjs                    parent
//   node home-winpct-check.mjs <page> <league>    child (page: home | home-slow | schedule | reference)

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

// ------------------------------------------------------------------ fixture

const LEAGUE_ID = '5550077';
const SEASON = 2026;
const MY_TEAM = 2;
const REGULAR_WEEKS = 6;
const TEAMS = [
  { id: 1, abbrev: 'ALP', name: 'Alpha' },
  { id: 2, abbrev: 'BRA', name: 'Bravo' },
  { id: 3, abbrev: 'CHA', name: 'Charlie' },
  { id: 4, abbrev: 'DEL', name: 'Delta' },
];

const LEAGUES = {
  calibrated: { decided: 3, quoted: 4, calibrated: true },
  assumed: { decided: 1, quoted: 2, calibrated: false },
};

/** Round-robin pairings for four teams, cycling every three weeks. */
function pairs(week) {
  return [
    [[1, 2], [3, 4]],
    [[1, 3], [2, 4]],
    [[1, 4], [2, 3]],
  ][(week - 1) % 3];
}

// How far each team's QB lands from his projection in a played week. Spread
// about 5 points — a measured sigma nowhere near 27.
const QB_DELTA = {
  1: [6, -4, 2],
  2: [-7, 5, -1],
  3: [3, -6, 8],
  4: [-2, 4, -5],
};

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * One team's roster for one week: [slot, position id, projected, actual|null].
 * Slots: 0 QB, 2 RB, 16 D/ST, 17 K, 20 bench. Positions: 1 QB, 2 RB, 5 K, 16 D/ST.
 *
 * DELTA'S KICKER AND D/ST PROJECT 0.00 (AUDIT §1.3): the case the positional
 * floor exists for. Schedule lifts those two slots to the waiver wire's
 * third-best at each position; a Home page that does not quotes a different
 * chance for every Delta game. Everyone else's K and D/ST project above the
 * floor, so only Delta moves.
 */
function rosterFor(teamId, week, decided) {
  const qbStart = 15 + teamId;
  const rbStart = r1(10 + week * 0.5);
  const qbBench = teamId === 1 ? 30 : 5;          // team 1: best lineup starts him
  const rbBench = teamId === 3 ? 20 : 3;          // team 3: likewise at RB
  const kProj = teamId === 4 ? 0 : 9;
  const dstProj = teamId === 4 ? 0 : 8;
  const played = week <= decided;
  const qbActual = played ? qbStart + QB_DELTA[teamId][(week - 1) % 3] : null;
  const rbActual = played ? rbStart : null;
  return [
    { slot: 0, pos: 1, proj: qbStart, actual: qbActual },
    { slot: 2, pos: 2, proj: rbStart, actual: rbActual },
    { slot: 16, pos: 16, proj: dstProj, actual: played ? dstProj : null },
    { slot: 17, pos: 5, proj: kProj, actual: played ? kProj : null },
    { slot: 20, pos: 1, proj: qbBench, actual: played ? qbBench : null },
    { slot: 20, pos: 2, proj: rbBench, actual: played ? rbBench : null },
  ];
}

/**
 * The waiver wire for one week, as ESPN's kona_player_info sends it: five free
 * agents at each of QB, RB, K and D/ST. The third-best — the floor — moves with
 * the week (K 5.0 + w/4, D/ST 4.0 + w/4), so a page that reads the wire for
 * the wrong week lands on a different floor and a different chance.
 */
const WIRE_BASE = { 1: 12, 2: 6, 5: 5, 16: 4 };
function wirePayload(week) {
  const players = [];
  for (const [pos, base] of Object.entries(WIRE_BASE)) {
    for (let i = 0; i < 5; i++) {
      const id = 9000 + Number(pos) * 10 + i;
      // i = 2 is the third-best: base + week/4 exactly.
      const proj = r1(base + week / 4 + (2 - i) * 0.7);
      players.push({
        id, status: 'FREEAGENT',
        player: {
          id, fullName: `Wire ${pos}-${i}`, defaultPositionId: Number(pos), proTeamId: 10 + i,
          injuryStatus: 'ACTIVE',
          stats: [{ scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: proj }],
        },
      });
    }
  }
  return { players };
}

const startedScore = (teamId, week, decided) =>
  r1(rosterFor(teamId, week, decided).filter((p) => p.slot !== 20).reduce((a, p) => a + p.actual, 0));

function scheduleRaw(decided) {
  const games = [];
  for (let w = 1; w <= REGULAR_WEEKS; w++) {
    for (const [h, a] of pairs(w)) {
      const done = w <= decided;
      const hp = done ? startedScore(h, w, decided) : 0;
      const ap = done ? startedScore(a, w, decided) : 0;
      games.push({
        matchupPeriodId: w,
        home: { teamId: h, totalPoints: hp },
        away: { teamId: a, totalPoints: ap },
        winner: done ? (hp > ap ? 'HOME' : ap > hp ? 'AWAY' : 'TIE') : 'UNDECIDED',
        playoffTierType: 'NONE',
      });
    }
  }
  return games;
}

function leaguePayload(decided) {
  return {
    settings: {
      name: 'Odds League',
      size: 4,
      scheduleSettings: { matchupPeriodCount: REGULAR_WEEKS, playoffTeamCount: 2 },
      rosterSettings: { lineupSlotCounts: { 0: 1, 2: 1, 16: 1, 17: 1, 20: 2 } },
    },
    members: [],
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, roster: { entries: [] } })),
    schedule: scheduleRaw(decided),
  };
}

function rosterPayload(week, decided) {
  return {
    settings: { name: 'Odds League' },
    members: [],
    teams: TEAMS.map((t) => ({
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      roster: {
        entries: rosterFor(t.id, week, decided).map((p, i) => ({
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
                ...(p.actual === null
                  ? []
                  : [{ scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: p.actual }]),
                { seasonId: SEASON, statSourceId: 1, statSplitTypeId: 0, appliedTotal: p.proj * 14 },
              ],
            },
          },
        })),
      },
    })),
  };
}

/** ESPN for the league's reads; a 404 for anything else (the snapshot archive). */
function installFetch(decided, { slowWeeks = [], slowMs = 0 } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const wk = Number((u.match(/scoringPeriodId=(\d+)/) || [])[1]);
    if (slowWeeks.includes(wk) && !/kona_player_info/.test(u)) await new Promise((r) => setTimeout(r, slowMs));
    const notFound = { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    if (!/fantasy\.espn\.com/.test(u)) return notFound;
    let body;
    if (/proTeamSchedules_wl/.test(u)) body = { settings: { proTeams: [] } };
    else if (/kona_player_info/.test(u)) body = wirePayload(wk);
    else if (/scoringPeriodId=(\d+)/.test(u)) body = rosterPayload(Number(u.match(/scoringPeriodId=(\d+)/)[1]), decided);
    else {
      body = leaguePayload(decided);
      if (!/view=mSettings/.test(u)) delete body.settings;
    }
    const text = JSON.stringify(body);
    return { ok: true, status: 200, async json() { return JSON.parse(text); }, async text() { return text; } };
  };
}

// ------------------------------------------------------------------ page harness

async function until(cond, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

async function bootPage(page, moduleRel, decided, extraPrefs = {}, fetchMode = {}) {
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
    'ff.connection': JSON.stringify({ leagueId: LEAGUE_ID, season: SEASON, teamId: MY_TEAM }),
    'ff.prefs': JSON.stringify(extraPrefs),
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
  installFetch(decided, fetchMode);
  await import(moduleUrl(moduleRel));
  return { document };
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const nameOf = (id) => TEAMS.find((t) => t.id === id).name;

/**
 * A card's claim as { fav, pct }: the favourite's name (null when level) and
 * the favourite's whole-percent chance. Home prints the OWNER's chance on his
 * card, which is turned into the favourite's here.
 */
function claimFrom(meta, homeName, awayName) {
  const mine = meta.match(/your win chance (\d+)%/);
  const by = meta.match(/(?:Best lineups: )?(\w+) by [\d.]+ · (?:your win chance )?(\d+)%/);
  const level = /level · (\d+)%/i.exec(meta);
  if (level) return { fav: null, pct: Number(level[1]) };
  if (!by) return null;
  const fav = by[1];
  let pct = Number(by[2]);
  if (mine) {
    const myName = nameOf(MY_TEAM);
    pct = fav === myName ? Number(mine[1]) : 100 - Number(mine[1]);
  }
  if (fav !== homeName && fav !== awayName) return null;
  return { fav, pct };
}

// ------------------------------------------------------------------ children

async function homeChild(league) {
  const L = LEAGUES[league];
  const { document } = await bootPage('index.html', 'js/home-page.js', L.decided);
  const cards = () => Array.from(document.querySelectorAll('#matchups .game'));
  await until(() => cards().length === 2 && cards().every((c) => c.hasAttribute('data-home-win')));
  const title = clean(document.getElementById('matchupsTitle')?.textContent);
  const out = cards().map((c) => {
    const names = Array.from(c.querySelectorAll('.tname')).map((n) => clean(n.textContent).replace(/ \(you\)$/, ''));
    const meta = clean(c.querySelector('.gmeta')?.textContent);
    return {
      home: names[0], away: names[1], meta,
      exact: c.hasAttribute('data-home-win') ? Number(c.getAttribute('data-home-win')) : null,
      claim: claimFrom(meta, names[0], names[1]),
      proj: Array.from(c.querySelectorAll('.tproj')).map((n) => clean(n.textContent)),
    };
  });
  return {
    title,
    cards: out,
    note: clean(document.getElementById('matchupsNote')?.textContent),
    explain: clean(document.getElementById('matchupsExplain')?.textContent),
  };
}

/**
 * ESPN slow on two of the played weeks: the cards must be drawn without
 * waiting for them, say the chance is being worked out, then fill it in.
 */
async function slowHomeChild(league) {
  const L = LEAGUES[league];
  const { document } = await bootPage('index.html', 'js/home-page.js', L.decided, {}, {
    slowWeeks: [1, 2], slowMs: 2500,
  });
  const cards = () => Array.from(document.querySelectorAll('#matchups .game'));
  const t0 = Date.now();
  await until(() => /^Week /.test(clean(document.getElementById('matchupsTitle')?.textContent)) && cards().length === 2, 2000);
  const early = {
    ms: Date.now() - t0,
    withPct: cards().filter((c) => c.hasAttribute('data-home-win')).length,
    metas: cards().map((c) => clean(c.querySelector('.gmeta')?.textContent)),
  };
  await until(() => cards().length === 2 && cards().every((c) => c.hasAttribute('data-home-win')));
  const late = {
    withPct: cards().filter((c) => c.hasAttribute('data-home-win')).length,
    metas: cards().map((c) => clean(c.querySelector('.gmeta')?.textContent)),
  };
  return { early, late };
}

async function scheduleChild(league) {
  const L = LEAGUES[league];
  const { document } = await bootPage('schedule.html', 'js/schedule-page.js', L.decided, {
    'schedule.source': 'live',
    'schedule.week': L.quoted,
  });
  const cards = () => Array.from(document.querySelectorAll('#matchups .game.upcoming'));
  await until(() => cards().length === 2 && cards().every((c) => /%/.test(c.querySelector('.gmeta')?.textContent || '')));
  return {
    title: clean(document.getElementById('matchupsTitle')?.textContent),
    note: clean(document.getElementById('matchupsNote')?.textContent),
    cards: cards().map((c) => {
      const home = clean(c.querySelector('.side.home .tname')?.textContent);
      const away = clean(c.querySelector('.side.away .tname')?.textContent);
      const meta = clean(c.querySelector('.gmeta')?.textContent);
      return {
        home, away, meta,
        claim: claimFrom(meta, home, away),
        proj: [clean(c.querySelector('.tscore.home')?.textContent), clean(c.querySelector('.tscore.away')?.textContent)],
      };
    }),
  };
}

/**
 * The Schedule page's route, step by step (schedule-page.js refreshStrength,
 * scoringSpread and homeWinChance), from the capture.js primitives it calls.
 * Also the OLD Home figure, for the discrimination check.
 */
async function referenceChild(league) {
  const L = LEAGUES[league];
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  const capture = await import(moduleUrl('js/capture.js'));
  const forecast = await import(moduleUrl('js/forecast.js'));
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '' });
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  installFetch(L.decided);

  const data = capture.normalizeSchedule(await season.fetchSchedule(), { isDemo: false });
  const plan = capture.rosterPlan(data);
  const weekTeams = await season.fetchWeeksRosters(plan.asking);
  // THE FLOOR, as Schedule reads it: one wire read, for the first week still to
  // be played — spelt out here as `plan.project[0]` rather than through any
  // helper the pages share, so the reference is not the pages agreeing with
  // themselves.
  const floorWeek = plan.project[0];
  const floors = await season.fetchFloors(floorWeek);
  const projection = capture.buildProjection(data, capture.pickWeeks(weekTeams, plan.project), floors);
  const bare = capture.buildProjection(data, capture.pickWeeks(weekTeams, plan.project));
  const started = capture.startedProjections(weekTeams, plan.decided);
  const spread = capture.leagueSpread(data, (g) => capture.gameState(g) === 'final', started);

  const setTotals = new Map((weekTeams.get(L.quoted) || []).map((t) => [t.id, t.projectedTotal]));
  const games = (data.byWeek.get(L.quoted) || []).map((g) => {
    const h = capture.projectedPoints(g, 'home', projection?.proj);
    const a = capture.projectedPoints(g, 'away', projection?.proj);
    const p = forecast.winProbability(h, a, spread.sigma);
    const old = forecast.winProbability(setTotals.get(g.homeId), setTotals.get(g.awayId), forecast.DEFAULT_SIGMA);
    // The same game with no floor — what Home quoted before AUDIT §1.3.
    const unfloored = forecast.winProbability(
      capture.projectedPoints(g, 'home', bare?.proj), capture.projectedPoints(g, 'away', bare?.proj), spread.sigma);
    return {
      home: nameOf(g.homeId), away: nameOf(g.awayId),
      homeBest: h, awayBest: a,
      homeSet: setTotals.get(g.homeId), awaySet: setTotals.get(g.awayId),
      p, old, unfloored,
    };
  });
  return {
    spread, games, projectionOk: Boolean(projection),
    floorWeek,
    floors: Object.fromEntries([...(floors || new Map())].map(([k, f]) => [k, f.value])),
  };
}

// ------------------------------------------------------------------ run

const [childPage, childLeague] = process.argv.slice(2);
if (childPage) {
  let res;
  try {
    const fn = { home: homeChild, 'home-slow': slowHomeChild, schedule: scheduleChild, reference: referenceChild }[childPage];
    res = await fn(childLeague);
  } catch (err) {
    res = { error: String(err && err.stack || err) };
  }
  process.stdout.write('\n@@RESULT@@' + JSON.stringify(res) + '\n');
  process.exit(0);
}

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 400)}` : ''}`);
};

const self = fileURLToPath(import.meta.url);
function child(page, league) {
  const res = spawnSync(process.execPath, [self, page, league], { encoding: 'utf8', timeout: 120000 });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@RESULT@@'));
  if (!line) return { error: `no result: ${(res.stdout || '').slice(-600)} ${(res.stderr || '').slice(-900)}` };
  return JSON.parse(line.slice('@@RESULT@@'.length));
}

const pctOf = (p) => Math.round(p * 100);
const favClaim = (g) => {
  const d = g.homeBest - g.awayBest;
  if (Math.abs(d) < 0.5) return { fav: null, pct: 50 };
  return { fav: d > 0 ? g.home : g.away, pct: pctOf(Math.max(g.p, 1 - g.p)) };
};

for (const league of Object.keys(LEAGUES)) {
  const L = LEAGUES[league];
  const tag = `[${league}]`;
  const ref = child('reference', league);
  const home = child('home', league);
  const sched = child('schedule', league);
  for (const [n, r] of [['reference', ref], ['home', home], ['schedule', sched]]) {
    ok(`${tag} ${n} child ran`, !r.error, r.error);
  }
  if (ref.error || home.error || sched.error) continue;

  // The fixture is what it claims to be.
  ok(`${tag} the reference built a projection`, ref.projectionOk);
  ok(`${tag} spread is ${L.calibrated ? 'measured' : 'assumed'}`, ref.spread.calibrated === L.calibrated, JSON.stringify(ref.spread));
  if (L.calibrated) {
    ok(`${tag} the measured spread is far from 27`, Math.abs(ref.spread.sigma - 27) > 10, ref.spread.sigma);
    ok(`${tag} from 12 team-weeks`, ref.spread.sample === 12, ref.spread.sample);
  } else {
    ok(`${tag} the assumed spread is 27`, ref.spread.sigma === 27, ref.spread.sigma);
  }
  const benchBetter = ref.games.some((g) => g.homeBest !== g.homeSet || g.awayBest !== g.awaySet);
  ok(`${tag} a team's best lineup differs from the one set`, benchBetter, JSON.stringify(ref.games));
  const moved = Math.max(...ref.games.map((g) => Math.abs(g.p - g.old)));
  ok(`${tag} the old Home method is at least 3 points away somewhere (falsifiable)`, moved >= 0.03, moved);

  // THE FLOOR IS IN PLAY (AUDIT §1.3). The fixture used to answer the wire with
  // nobody, so both pages had an empty floor map and agreed by having nothing
  // to disagree about. Now the map is real, read for the first unplayed week,
  // and leaving it off moves a chance by at least 3 points.
  ok(`${tag} the reference read the wire for week ${L.quoted}, the first unplayed`, ref.floorWeek === L.quoted, ref.floorWeek);
  ok(`${tag} the floor map is NOT empty: K and D/ST both floored`,
    ref.floors.K > 0 && ref.floors.DST > 0, JSON.stringify(ref.floors));
  const unfloorMoved = Math.max(...ref.games.map((g) => Math.abs(g.p - g.unfloored)));
  ok(`${tag} an unfloored Home is at least 3 points away somewhere (falsifiable)`, unfloorMoved >= 0.03, unfloorMoved);

  // Both pages are on the quoted week.
  ok(`${tag} Home shows week ${L.quoted}`, new RegExp(`^Week ${L.quoted} `).test(home.title), home.title);
  ok(`${tag} Schedule shows week ${L.quoted}`, new RegExp(`^Week ${L.quoted} `).test(sched.title), sched.title);

  for (const g of ref.games) {
    const label = `${tag} ${g.home} v ${g.away}`;
    const h = home.cards.find((c) => c.home === g.home && c.away === g.away);
    const s = sched.cards.find((c) => c.home === g.home && c.away === g.away);
    ok(`${label}: Home has the card`, Boolean(h), JSON.stringify(home.cards));
    ok(`${label}: Schedule has the card`, Boolean(s), JSON.stringify(sched.cards));
    if (!h || !s) continue;

    // Home's unrounded chance is the Schedule route's, to 0.1 percentage point.
    ok(`${label}: Home's exact chance ${h.exact} equals Schedule's ${g.p.toFixed(4)} to 0.1 pt`,
      typeof h.exact === 'number' && Math.abs(h.exact - g.p) < 0.001, h.meta);

    // What each page PRINTS: the same favourite and the same whole percent.
    const want = favClaim(g);
    ok(`${label}: Schedule prints ${JSON.stringify(want)}`, JSON.stringify(s.claim) === JSON.stringify(want), s.meta);
    ok(`${label}: Home prints the same as Schedule`, JSON.stringify(h.claim) === JSON.stringify(s.claim),
      `home "${h.meta}" / schedule "${s.meta}"`);

    // The margin beside the percentage is the best-lineup one on both.
    if (want.fav) {
      const margin = Math.abs(g.homeBest - g.awayBest).toFixed(1);
      ok(`${label}: Home's margin is the best-lineup ${margin}`, h.meta.includes(`by ${margin}`), h.meta);
      ok(`${label}: Schedule's margin is the best-lineup ${margin}`, s.meta.includes(`by ${margin}`), s.meta);
    }

    // Home's Proj column is the lineup as SET, and says so.
    ok(`${label}: Home's Proj is the set lineup`,
      JSON.stringify(h.proj) === JSON.stringify([g.homeSet.toFixed(1), g.awaySet.toFixed(1)]), JSON.stringify(h.proj));

    const mine = g.home === nameOf(MY_TEAM) || g.away === nameOf(MY_TEAM);
    ok(`${label}: ${mine ? 'his card says "your win chance"' : 'no "your win chance" on another card'}`,
      /your win chance/.test(h.meta) === mine, h.meta);
  }

  // The basis is stated, with the spread's real source.
  ok(`${tag} the note says best lineup, our model`, /best\b.*lineup/i.test(home.note) && /our model, not ESPN/.test(home.note), home.note);
  ok(`${tag} the note says Proj is the lineup as set`, /Proj is each lineup as set/.test(home.note), home.note);
  if (L.calibrated) {
    ok(`${tag} How this works names the measured spread`,
      home.explain.includes(`${ref.spread.sigma.toFixed(1)} points, measured from 12 completed team-weeks`), home.explain);
  } else {
    ok(`${tag} How this works says 27 is assumed, and why`,
      /27 points — assumed/.test(home.explain) && /only 4 completed team-weeks carries/.test(home.explain), home.explain);
  }
  ok(`${tag} How this works says best legal lineup`, /best legal lineup/.test(home.explain), home.explain);
  // Rule 7: the floor moves the chance, so Home says so — with the numbers.
  ok(`${tag} How this works states the floor, with the K and D/ST values and the week`,
    /No slot is assessed below what the waiver wire would give you/.test(home.explain) &&
    home.explain.includes(`K ${ref.floors.K.toFixed(1)}`) && home.explain.includes(`DST ${ref.floors.DST.toFixed(1)}`) &&
    home.explain.includes(`in week ${L.quoted}`), home.explain);
  // And so does Schedule, under the cards it moves (AUDIT §1.5) — without the
  // old claim that a bye "sits down on its own", false once a floor lifts it.
  ok(`${tag} Schedule's matchup note states the same floor, for the same week`,
    /No slot is assessed below what the waiver wire would give you/.test(sched.note) &&
    sched.note.includes(`K ${ref.floors.K.toFixed(1)}`) && sched.note.includes(`in week ${L.quoted}`), sched.note);
  ok(`${tag} and no longer says a bye sits down on its own`, !/sit down on their own/.test(sched.note), sched.note);
}

// A slow ESPN never holds the matchups back.
{
  const slow = child('home-slow', 'calibrated');
  ok('[slow] child ran', !slow.error, slow.error);
  if (!slow.error) {
    ok('[slow] the cards are drawn before the played weeks arrive', slow.early.ms < 2000 && slow.early.withPct === 0,
      JSON.stringify(slow.early));
    ok('[slow] his card says the chance is being worked out',
      slow.early.metas.some((m) => /win chance: working out/.test(m)), JSON.stringify(slow.early.metas));
    ok('[slow] and the chance is filled in when they land',
      slow.late.withPct === 2 && slow.late.metas.some((m) => /your win chance \d+%/.test(m)), JSON.stringify(slow.late));
  }
}

for (const f of fails) console.log(`   - ${f}`);
if (fails.length) {
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`\nAll ${pass} assertions passed`);
