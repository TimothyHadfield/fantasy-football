// Demo-mode ROSTER and SCHEDULE data.
//
// EVERYTHING HERE IS FAKE. No ESPN call is made. The players do not exist —
// the names are invented, only the NFL team abbreviations are real.
//
// This module is the roster-level companion to demo.js. demo.js decides what
// every team scored in every week; this file decides *who* scored it. The two
// must agree, so the contract is one-directional:
//
//     demo.js is the source of truth. Nothing here may change a team total.
//
// Individual player scores are generated first from position/depth-chart
// priors, then the nine starters are stretched or squeezed so their sum lands
// exactly on demo.js's number for that team-week (see fitToTotal). Bench
// players are unconstrained — they never feed a total anyone checks.
//
// Everything is deterministic: the same week always yields byte-identical
// output, because every random draw is seeded from (playerId, week) or
// (teamId, week) rather than from a running stream.

import { generateDemoLeague } from './demo.js';

// --------------------------------------------------------------- lineup slots

const SLOT = {
  QB: 0,
  RB: 2,
  WR: 4,
  TE: 6,
  DST: 16,
  K: 17,
  BENCH: 20,
  FLEX: 23,
};

const SLOT_LABEL = {
  0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'D/ST', 17: 'K', 20: 'BE', 23: 'FLEX',
};

// One QB, two RB, two WR, one TE, one FLEX, one D/ST, one K. Nine starters.
const LINEUP = [
  { slot: SLOT.QB, eligible: ['QB'] },
  { slot: SLOT.RB, eligible: ['RB'] },
  { slot: SLOT.RB, eligible: ['RB'] },
  { slot: SLOT.WR, eligible: ['WR'] },
  { slot: SLOT.WR, eligible: ['WR'] },
  { slot: SLOT.TE, eligible: ['TE'] },
  { slot: SLOT.FLEX, eligible: ['RB', 'WR', 'TE'] },
  { slot: SLOT.DST, eligible: ['DST'] },
  { slot: SLOT.K, eligible: ['K'] },
];

// Sixteen-man roster. Held fixed for the whole season: every waiver move in
// this file is a same-position swap, so a team can always fill all nine slots
// no matter how the churn falls.
const ROSTER_SHAPE = { QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DST: 1 };

const SEED = 12345;
const WEEKS = 13;

// ------------------------------------------------------------- scoring priors
//
// Means are per-week fantasy points by depth-chart rank. The nine-starter sum
// of a league-average roster comes to ~115, which sits just under demo.js's
// 118.5 actual mean — close enough that the fit step below is a nudge rather
// than a rewrite.

const DEPTH_MEANS = {
  QB: [20.5, 15.0],
  RB: [16.5, 13.0, 10.0, 7.5, 5.5],
  WR: [16.0, 13.0, 10.5, 8.0, 5.5],
  TE: [10.0, 6.0],
  K: [8.2],
  DST: [7.5],
};

// Week-to-week volatility. Kickers are metronomes; receivers are not.
function sdFor(position, mean) {
  if (position === 'K') return 2.4;
  if (position === 'DST') return 3.2;
  if (position === 'TE') return Math.max(2.2, mean * 0.42);
  if (position === 'QB') return Math.max(3.0, mean * 0.26);
  return Math.max(2.5, mean * 0.40);
}

// Free-agent talent bands. Deliberately overlapping the back of a roster, so a
// waiver add is sometimes an upgrade and sometimes a lateral move.
const FA_BANDS = {
  QB: [8, 17], RB: [3, 12], WR: [3, 12], TE: [2.5, 8.5], K: [6.5, 8.5], DST: [4.5, 9],
};

const FA_SHAPE = { QB: 10, RB: 22, WR: 22, TE: 10, K: 8, DST: 8 };

// How often each position turns over. Kickers and defenses get streamed hard;
// nobody drops their QB1's backup twice a month.
const CHURN_WEIGHTS = [
  ['RB', 30], ['WR', 30], ['TE', 12], ['DST', 10], ['K', 10], ['QB', 8],
];

// -------------------------------------------------------------------- rosters

const PRO_TEAM_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET',
  'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE',
  'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WSH',
];

// Real franchises, since a D/ST *is* a franchise. Everything else is invented.
const DST_TEAMS = [
  ['BAL', 'Ravens'], ['KC', 'Chiefs'], ['SF', '49ers'], ['BUF', 'Bills'],
  ['PIT', 'Steelers'], ['DAL', 'Cowboys'], ['NYJ', 'Jets'], ['DEN', 'Broncos'],
  ['PHI', 'Eagles'], ['MIN', 'Vikings'], ['CLE', 'Browns'], ['GB', 'Packers'],
  ['HOU', 'Texans'], ['DET', 'Lions'], ['SEA', 'Seahawks'], ['TB', 'Buccaneers'],
  ['LAC', 'Chargers'], ['NO', 'Saints'], ['ARI', 'Cardinals'], ['NE', 'Patriots'],
];

// Invented players only. These name pools are chosen to avoid colliding with
// active NFL players; the combination step also refuses duplicates.
const FIRST_NAMES = [
  'Dane', 'Corbin', 'Rylan', 'Jasper', 'Ezra', 'Bodie', 'Kellan', 'Tobias',
  'Quinton', 'Braylon', 'Amari', 'Donovan', 'Malachi', 'Cedric', 'Rashad',
  'Emmett', 'Sawyer', 'Griffin', 'Holden', 'Weston', 'Kaden', 'Silas', 'Rowan',
  'Nash', 'Zane', 'Beau', 'Cormac', 'Deshawn', 'Jamari', 'Tyrese', 'Lamont',
  'Dontae', 'Keandre', 'Julius', 'Ellis', 'Vance', 'Roscoe', 'Otis', 'Hollis',
  'Barrett', 'Sterling', 'Pierce', 'Lachlan', 'Kian', 'Ansel', 'Thaddeus',
  'Gideon', 'Jovan', 'Dax', 'Rhett', 'Cassius', 'Marquel', 'Deveon', 'Tarik',
  'Isaias', 'Ovid', 'Ramsey', 'Sullivan', 'Trace', 'Wilder',
];

const LAST_NAMES = [
  'Ashworth', 'Braddock', 'Hargett', 'Pemberton', 'Thackery', 'Mallory',
  'Ravenscroft', 'Fenwick', 'Larkin', 'Bramble', 'Cavendish', 'Ostrander',
  'Quillen', 'Vandermeer', 'Whitlock', 'Yarborough', 'Zelaya', 'Alderman',
  'Brackett', 'Cordova', 'Dellinger', 'Ebersole', 'Fairbanks', 'Hollister',
  'Ingersoll', 'Jessup', 'Kingsbury', 'Ledbetter', 'Marchetti', 'Nordquist',
  'Oglesby', 'Quintero', 'Rutherford', 'Stanhope', 'Tillinghast', 'Underhill',
  'Vickery', 'Wainwright', 'Yoakum', 'Abernathy', 'Beaumont', 'Castellano',
  'Draeger', 'Eastland', 'Ferraro', 'Gallardo', 'Hathaway', 'Ivers', 'Jarnigan',
  'Kowalczyk', 'Lindquist', 'Marlowe', 'Nightingale', 'Ocampo', 'Pettibone',
  'Radcliffe', 'Sandoval', 'Trentham', 'Vasquez', 'Winterbourne',
];

// ------------------------------------------------------------------------ rng

/** mulberry32 — tiny, fast, seedable. Inlined so this file has no dependencies. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-ish mix, so any tuple of small integers becomes a usable seed. */
function hashSeed(...nums) {
  let h = 0x811c9dc5;
  for (const n of nums) {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

function rngFor(...nums) {
  return mulberry32(hashSeed(...nums));
}

/** Standard normal via Box-Muller. */
function gaussian(rand) {
  const u1 = 1 - rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

// ------------------------------------------------------------ player universe

let universe = null;

/**
 * Build every player who will ever appear this season: 160 rostered plus 80
 * free agents. Done once, cached, and never mutated afterwards — weekly state
 * is only ever *which ids* a team holds.
 */
function buildUniverse() {
  if (universe) return universe;

  const league = generateDemoLeague(SEED);
  const rand = mulberry32(hashSeed(SEED, 0x1057e));

  // Team strength, read back out of demo.js's own scores. A team that averages
  // 130 should look like it has better players, not just luckier ones — and it
  // also keeps the fit step's scale factor close to 1.
  const totals = new Map(league.teams.map((t) => [t.id, { sum: 0, n: 0 }]));
  for (const g of league.games) {
    totals.get(g.homeId).sum += g.homeActual;
    totals.get(g.homeId).n += 1;
    totals.get(g.awayId).sum += g.awayActual;
    totals.get(g.awayId).n += 1;
  }
  const teamFactor = new Map();
  for (const t of league.teams) {
    const rec = totals.get(t.id);
    teamFactor.set(t.id, clamp((rec.sum / rec.n) / 118.5, 0.88, 1.12));
  }

  const usedNames = new Set();
  const nextName = () => {
    for (let attempt = 0; attempt < 5000; attempt++) {
      const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
      const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
      const name = `${first} ${last}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    // Unreachable with 3600 combinations against ~230 draws, but never loop
    // forever on a name pool someone later shrinks.
    const fallback = `Player ${usedNames.size + 1}`;
    usedNames.add(fallback);
    return fallback;
  };

  const byId = new Map();
  let nextId = 1001;
  let dstCursor = 0;

  const makePlayer = (position, mean) => {
    const id = nextId++;
    const isDst = position === 'DST';
    const dst = isDst ? DST_TEAMS[dstCursor++ % DST_TEAMS.length] : null;
    const player = {
      playerId: id,
      name: isDst ? `${dst[1]} D/ST` : nextName(),
      position,
      proTeam: isDst ? dst[0] : PRO_TEAM_CODES[Math.floor(rand() * PRO_TEAM_CODES.length)],
      mean: round1(Math.max(1.5, mean)),
      sd: 0,
      seasonProjected: 0,
      percentOwned: 0,
      spells: null,
    };
    player.sd = round1(sdFor(position, player.mean));
    // A season projection is a mean times a season, plus the forecaster's own
    // optimism about games played.
    player.seasonProjected = round1(player.mean * (15.5 + rand() * 2.5));
    player.percentOwned = round1(clamp(6 + player.mean * 5.2 + gaussian(rand) * 6, 0.3, 99.8));
    byId.set(id, player);
    return player;
  };

  // --- rostered players, by team, by depth chart -----------------------------
  const rosters = new Map();
  for (const team of league.teams) {
    const factor = teamFactor.get(team.id);
    const ids = [];
    for (const [position, count] of Object.entries(ROSTER_SHAPE)) {
      for (let depth = 0; depth < count; depth++) {
        const base = DEPTH_MEANS[position][depth];
        const jitter = gaussian(rand) * (position === 'K' ? 0.5 : 1.4);
        ids.push(makePlayer(position, base * factor + jitter).playerId);
      }
    }
    rosters.set(team.id, ids);
  }

  // --- the waiver wire ------------------------------------------------------
  const freeAgents = [];
  for (const [position, count] of Object.entries(FA_SHAPE)) {
    const [lo, hi] = FA_BANDS[position];
    for (let i = 0; i < count; i++) {
      freeAgents.push(makePlayer(position, lo + rand() * (hi - lo)).playerId);
    }
  }

  // --- injuries -------------------------------------------------------------
  // Given per player rather than per week, so a hamstring lasts across weeks
  // instead of flickering on and off.
  for (const player of byId.values()) {
    player.spells = buildSpells(player);
  }

  universe = {
    league,
    teams: league.teams,
    byId,
    initialRosters: rosters,
    initialFreeAgents: freeAgents,
  };
  return universe;
}

/** Zero, one, or two multi-week absences for one player. Kickers and D/STs never miss. */
function buildSpells(player) {
  if (player.position === 'K' || player.position === 'DST') return [];
  const rand = rngFor(player.playerId, 0x9e37);
  const spells = [];
  const add = () => {
    const start = 2 + Math.floor(rand() * 11); // weeks 2-12
    const length = 1 + Math.floor(rand() * 4); // 1-4 weeks
    spells.push({
      start,
      end: start + length - 1,
      status: length >= 3 ? 'INJURY_RESERVE' : 'OUT',
    });
  };
  if (rand() < 0.4) add();
  if (rand() < 0.12) add();
  return spells;
}

/**
 * A player's availability in one week.
 * Returns "ACTIVE" | "QUESTIONABLE" | "OUT" | "INJURY_RESERVE".
 */
function injuryStatusFor(player, week) {
  for (const spell of player.spells) {
    if (week >= spell.start && week <= spell.end) return spell.status;
    if (week === spell.start - 1) return 'QUESTIONABLE'; // listed before he sits
  }
  if (player.position === 'K' || player.position === 'DST') return 'ACTIVE';
  return rngFor(player.playerId, week, 0x51c)() < 0.07 ? 'QUESTIONABLE' : 'ACTIVE';
}

function isOut(status) {
  return status === 'OUT' || status === 'INJURY_RESERVE';
}

// --------------------------------------------------------------- weekly churn

const rosterStateCache = new Map();

function pickWeighted(rand, pairs) {
  const total = pairs.reduce((a, p) => a + p[1], 0);
  let roll = rand() * total;
  for (const [value, weight] of pairs) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

/**
 * Who each team holds in a given week.
 *
 * Replayed from week 1 every time rather than stored, so calling week 7 first
 * gives exactly the same answer as walking there from week 1. Cheap: 13 weeks
 * of ~25 swaps.
 */
function rosterStateForWeek(week) {
  const target = clamp(Math.round(week), 1, WEEKS);
  if (rosterStateCache.has(target)) return rosterStateCache.get(target);

  const uni = buildUniverse();
  const rosters = new Map();
  for (const [teamId, ids] of uni.initialRosters) rosters.set(teamId, ids.slice());
  let pool = uni.initialFreeAgents.slice();

  if (!rosterStateCache.has(1)) {
    rosterStateCache.set(1, new Map([...rosters].map(([k, v]) => [k, v.slice()])));
  }

  const meanOf = (id) => uni.byId.get(id).mean;

  for (let w = 2; w <= target; w++) {
    for (const team of uni.teams) {
      const rand = rngFor(0x51ed, team.id, w);
      const roll = rand();
      const moves = roll < 0.35 ? 1 : roll < 0.75 ? 2 : 3;

      for (let m = 0; m < moves; m++) {
        const position = pickWeighted(rand, CHURN_WEIGHTS);

        // Best available at this position, best first.
        const available = pool
          .filter((id) => uni.byId.get(id).position === position)
          .sort((a, b) => meanOf(b) - meanOf(a) || a - b);
        if (!available.length) continue;

        // Managers chase the top of the wire but rarely land the very best.
        const addId = available[Math.floor(Math.pow(rand(), 1.6) * available.length)];

        // Drop from the back of the depth chart — the core never gets cut.
        const held = rosters.get(team.id)
          .filter((id) => uni.byId.get(id).position === position)
          .sort((a, b) => meanOf(a) - meanOf(b) || a - b);
        const bottom = Math.max(1, Math.ceil(held.length / 2));
        const dropId = held[Math.floor(Math.pow(rand(), 1.5) * bottom)];
        if (dropId === undefined || dropId === addId) continue;

        // Swap. Same position both ways, so ROSTER_SHAPE is invariant.
        const ids = rosters.get(team.id);
        ids[ids.indexOf(dropId)] = addId;
        pool[pool.indexOf(addId)] = dropId;
      }
    }
    if (!rosterStateCache.has(w)) {
      rosterStateCache.set(w, new Map([...rosters].map(([k, v]) => [k, v.slice()])));
    }
  }

  return rosterStateCache.get(target);
}

// ------------------------------------------------------------- weekly scoring

/**
 * One player's raw week, before it is reconciled with the team total.
 * Seeded from (playerId, week) so a player scores the same thing no matter
 * which team is asking or in what order.
 */
function rawWeek(player, week, status) {
  if (isOut(status)) return { projected: 0, actual: 0 };

  const rand = rngFor(player.playerId, week, 0x5c0);
  const questionable = status === 'QUESTIONABLE';

  // Projections are smoothed: they know the player's mean and little else.
  let projected = player.mean + gaussian(rand) * player.sd * 0.32;
  if (questionable) projected *= 0.88;

  // Reality is noisier, and skill positions have a long right tail.
  let actual = player.mean + gaussian(rand) * player.sd;
  if (player.position !== 'K' && rand() < 0.11) {
    actual += -Math.log(1 - rand()) * player.sd * 0.9; // the boom week
  }
  if (questionable && rand() < 0.45) actual *= 0.55; // played hurt, left early

  return {
    projected: Math.max(0, projected),
    actual: Math.max(0, actual),
  };
}

/**
 * Stretch or squeeze a set of values so they sum to exactly `target`.
 *
 * Under target, every value grows by a share of the shortfall weighted by
 * `weights` (volatile players absorb more of a big week, which is what
 * actually happens). Over target, everything scales down proportionally,
 * which cannot push anyone negative.
 *
 * A weight of 0 pins a value where it is — used for players ruled OUT, who
 * must stay on zero however the arithmetic lands.
 *
 * Returns values rounded to 0.1 whose sum is exactly `target`.
 */
function fitToTotal(values, weights, target) {
  const n = values.length;
  if (!n) return [];

  const sum = values.reduce((a, b) => a + b, 0);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let out;

  if (sum > 0 && target <= sum) {
    const factor = target / sum;
    out = values.map((v) => v * factor);
  } else if (weightSum > 0) {
    const delta = target - sum;
    out = values.map((v, i) => v + (delta * weights[i]) / weightSum);
  } else {
    out = values.slice();
    out[0] += target - sum;
  }

  const rounded = out.map(round1);
  const diff = round1(target - rounded.reduce((a, b) => a + b, 0));
  if (Math.abs(diff) > 1e-9) {
    // Park the rounding crumb on the biggest unpinned contributor.
    let index = -1;
    let best = -Infinity;
    for (let i = 0; i < rounded.length; i++) {
      if (weights[i] > 0 && rounded[i] > best) {
        best = rounded[i];
        index = i;
      }
    }
    if (index === -1) index = 0;
    rounded[index] = round1(rounded[index] + diff);
  }
  return rounded;
}

/** Fill the nine starting slots from a roster, best projection first. */
function chooseLineup(entries) {
  const remaining = entries.slice().sort(
    (a, b) => b.rawProjected - a.rawProjected || a.player.playerId - b.player.playerId
  );
  const starters = [];

  for (const spot of LINEUP) {
    // Healthy bodies first; if a position is wiped out, a ruled-out player has
    // to start, exactly as it goes in a real league.
    let index = remaining.findIndex(
      (e) => spot.eligible.includes(e.player.position) && !isOut(e.status)
    );
    if (index === -1) {
      index = remaining.findIndex((e) => spot.eligible.includes(e.player.position));
    }
    if (index === -1) continue;
    const [entry] = remaining.splice(index, 1);
    entry.lineupSlotId = spot.slot;
    starters.push(entry);
  }

  for (const entry of remaining) entry.lineupSlotId = SLOT.BENCH;
  return { starters, bench: remaining };
}

function abbrevFor(name) {
  return name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
}

// ------------------------------------------------------------------- exports

const weekRosterCache = new Map();

/**
 * One week's rosters for all ten demo teams.
 *
 * Same shape as season.js's fetchWeekRosters(week), minus the promise — this
 * one is synchronous because there is nothing to fetch.
 *
 * Guarantee: every team's `actualTotal` and `projectedTotal` equal that team's
 * score in demo.js's game for this week.
 *
 * @param {number} week 1-13
 */
export function generateDemoWeekRosters(week) {
  const target = clamp(Math.round(week) || 1, 1, WEEKS);
  if (weekRosterCache.has(target)) return weekRosterCache.get(target);

  const uni = buildUniverse();
  const state = rosterStateForWeek(target);

  // demo.js's verdict for this week, which everything below has to match.
  const scores = new Map();
  for (const g of uni.league.games) {
    if (g.week !== target) continue;
    scores.set(g.homeId, { actual: g.homeActual, projected: g.homeProjected });
    scores.set(g.awayId, { actual: g.awayActual, projected: g.awayProjected });
  }

  const teams = uni.teams.map((team) => {
    const entries = state.get(team.id).map((id) => {
      const player = uni.byId.get(id);
      const status = injuryStatusFor(player, target);
      const raw = rawWeek(player, target, status);
      return {
        player,
        status,
        rawProjected: raw.projected,
        rawActual: raw.actual,
        lineupSlotId: SLOT.BENCH,
      };
    });

    const { starters, bench } = chooseLineup(entries);
    const goal = scores.get(team.id) || { actual: 0, projected: 0 };

    // Pin anyone ruled out at zero; let volatile players soak up the rest.
    const liveWeights = starters.map((e) =>
      isOut(e.status) ? 0 : (e.rawActual + 2) * e.player.sd
    );
    const projWeights = starters.map((e) => (isOut(e.status) ? 0 : e.rawProjected + 2));

    const fittedActual = fitToTotal(starters.map((e) => e.rawActual), liveWeights, goal.actual);
    const fittedProj = fitToTotal(
      starters.map((e) => e.rawProjected), projWeights, goal.projected
    );

    starters.forEach((entry, i) => {
      entry.actual = fittedActual[i];
      entry.projected = fittedProj[i];
    });
    for (const entry of bench) {
      entry.actual = round1(entry.rawActual);
      entry.projected = round1(entry.rawProjected);
    }

    const toPlayer = (entry) => ({
      playerId: entry.player.playerId,
      name: entry.player.name,
      position: entry.player.position,
      proTeam: entry.player.proTeam,
      lineupSlotId: entry.lineupSlotId,
      slot: SLOT_LABEL[entry.lineupSlotId] ?? String(entry.lineupSlotId),
      started: entry.lineupSlotId !== SLOT.BENCH,
      projected: entry.projected,
      actual: entry.actual,
      seasonProjected: entry.player.seasonProjected,
      injuryStatus: entry.status,
      percentOwned: entry.player.percentOwned,
    });

    // Starters in lineup order, then the bench — the order the UI wants.
    const starterRows = starters.map(toPlayer);
    const benchRows = bench
      .slice()
      .sort((a, b) => b.rawProjected - a.rawProjected)
      .map(toPlayer);

    const total = (arr, key) =>
      Math.round(arr.reduce((a, p) => a + (p[key] || 0), 0) * 10) / 10;

    return {
      id: team.id,
      name: team.name,
      abbrev: abbrevFor(team.name),
      players: [...starterRows, ...benchRows],
      starters: starterRows,
      bench: benchRows,
      projectedTotal: total(starterRows, 'projected'),
      actualTotal: total(starterRows, 'actual'),
      benchActualTotal: total(benchRows, 'actual'),
      seasonProjectedTotal: total(starterRows, 'seasonProjected'),
    };
  });

  const result = { week: target, teams };
  weekRosterCache.set(target, result);
  return result;
}

/**
 * The full demo season schedule, week by week.
 *
 * Same shape as season.js's fetchSchedule(). Read straight off demo.js's games
 * — no scores are invented here, only reshaped.
 */
export function generateDemoSchedule() {
  const league = generateDemoLeague(SEED);
  const nameById = new Map(league.teams.map((t) => [t.id, t.name]));

  const byWeek = new Map();
  for (const g of league.games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push({
      week: g.week,
      homeId: g.homeId,
      homeName: nameById.get(g.homeId) || `Team ${g.homeId}`,
      homeScore: g.homeActual,
      awayId: g.awayId,
      awayName: nameById.get(g.awayId) || `Team ${g.awayId}`,
      awayScore: g.awayActual,
      played: true, // the demo season is over by definition
      margin: round1(g.homeActual - g.awayActual),
      winner:
        g.homeActual > g.awayActual ? 'home' : g.awayActual > g.homeActual ? 'away' : 'tie',
    });
  }

  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  return {
    leagueName: league.name,
    teams: league.teams.map((t) => ({ id: t.id, name: t.name })),
    weeks,
    byWeek,
    games: weeks.flatMap((w) => byWeek.get(w)),
  };
}
