// Demo-mode data generator.
//
// EVERYTHING THIS MODULE PRODUCES IS FAKE. No ESPN call is made, no real
// league is read. Its only job is to hand the UI a season that *feels* like a
// real 10-team friend league so the site can be explored without connecting an
// account.
//
// The output is fully deterministic: the same seed always produces the exact
// same league, so the demo looks identical on every page load.
//
// Shape returned by generateDemoLeague() is a fixed contract — other modules
// read it directly. Do not change field names here without changing them there.

// ------------------------------------------------------------------- constants

const TEAM_NAMES = [
  'Autumn', 'Jonas', 'Miles', 'Mitchel', 'Nick',
  'Nolan', 'Robert', 'Stevenson', 'Tim', 'Watkins',
];

const SEASON = 2025;
const WEEKS = 13;

// --- Distribution targets, taken from a real 2025 league's box scores --------
//
// Actual weekly scores:    mean ~117, sd ~25, roughly 49 to 205.
// Projected weekly scores: mean ~122, sd ~11, roughly 87 to 150.
//
// The single most important property is that gap in spread. Projections are
// tight and clustered; actual results scatter wildly around them. Projections
// also run about 5 points hot, because a projection assumes every starter plays
// a normal game and reality does not cooperate.

// Set ~1.5 above the target of 117 because injuries and the blowup cap below
// both pull the realized average down a little.
const ACTUAL_MEAN = 118.5;
const PROJECTED_MEAN = 122.5; // projections run optimistic by ~5 points

// Per-team talent, in points above/below the league average. A fixed ladder
// (rather than random draws) guarantees the standings actually spread out:
// the worst roster is a ~104 team and the best a ~133 team, before a season's
// worth of luck widens that further. Which manager gets which rung is shuffled
// by the seed.
const STRENGTH_LADDER = [-15, -11, -7, -3, -1, 1, 3, 7, 11, 15];

// "Form" is the part of a given week that a projection can genuinely see ahead
// of time: byes, a soft defensive matchup, a starter already ruled out. It is
// real signal, so projections know about it.
const FORM_SD = 10;

// How much of that visible signal a projection actually captures. Below 1
// because projections shrink toward the middle — they rarely call for 90 or
// 160 even when one is coming.
const PROJECTION_SLOPE = 0.69;

// Pure projection error: the model's own noise, independent of the result.
// Deliberately large. Without it the demo's projections call games at 75%+,
// which no real projection does.
const PROJECTION_ERROR_SD = 6;

// The unpredictable remainder of a week — the part no projection can touch.
// This is by far the largest term, which is why projections beat actuals only
// about two times in three.
const RESIDUAL_SD = 15;

// Real scoring is right-skewed: a team can explode for 200 but cannot score
// below zero, so the upper tail is long and the lower tail is short. Modeled
// as an occasional additive "blowup week" on top of the normal noise. Its mean
// is subtracted back out so the league average stays put. Most of the league's
// spread lives in this term rather than in symmetric noise, which is what keeps
// the left side tight (sub-80 weeks stay rare) while 150s and the occasional
// 200 still show up. The cap keeps the exponential's unbounded tail from
// printing a score no real roster could reach.
const BLOWUP_CHANCE = 0.30;
const BLOWUP_MEAN = 21;
const BLOWUP_CAP = 62;

// Nobody in a real league posts a 20. Floor the rare disaster week.
const SCORE_FLOOR = 49;

// Injuries are sparse annotations: roughly one every week and a half, costing
// a handful of points in the week they happen.
const INJURY_MIN = 9;
const INJURY_MAX = 13;

const INJURY_NAMES = [
  'Bucky Irving', 'Christian McCaffrey', 'Puka Nacua', 'Nico Collins',
  'Rashee Rice', 'Kyren Williams', 'Mark Andrews', 'Chris Godwin',
  'Tee Higgins', 'Breece Hall', 'Malik Nabers', "De'Von Achane",
  'Garrett Wilson', 'Trey McBride', 'James Cook', 'Jaylen Waddle',
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

/** Standard normal via Box-Muller. Consumes two draws, keeps nothing cached. */
function gaussian(rand) {
  const u1 = 1 - rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Exponential draw with the given mean — the long right tail on blowup weeks. */
function exponential(rand, mean) {
  return -Math.log(1 - rand()) * mean;
}

/** In-place Fisher-Yates using the seeded stream. */
function shuffle(rand, items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

// ------------------------------------------------------------------- schedule

/**
 * Circle method: 10 teams, 9 rounds, every team meets every other exactly once.
 * Weeks 10-13 replay the first four rounds with home and away swapped, which is
 * how a real 10-team league fills a 13-week season.
 */
function buildSchedule(rand, teamIds) {
  const rotation = shuffle(rand, teamIds);
  const half = rotation.length / 2;
  const rounds = [];

  for (let round = 0; round < rotation.length - 1; round++) {
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const a = rotation[i];
      const b = rotation[rotation.length - 1 - i];
      // Alternate the host each round so home games stay balanced.
      pairs.push(round % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);

    // Pin the first team, rotate the rest one step.
    const fixed = rotation[0];
    const rest = rotation.slice(1);
    rest.unshift(rest.pop());
    rotation.length = 0;
    rotation.push(fixed, ...rest);
  }

  const weeks = [];
  for (let week = 1; week <= WEEKS; week++) {
    if (week <= rounds.length) {
      weeks.push(rounds[week - 1]);
    } else {
      // Rematch weeks: same pairing, reversed home field.
      const source = rounds[week - rounds.length - 1];
      weeks.push(source.map(([home, away]) => [away, home]));
    }
  }
  return weeks;
}

// ------------------------------------------------------------------- injuries

function buildInjuries(rand, teamIds) {
  // One injury per team-week, so there are only so many slots to fill. Asking
  // for more than exist would spin the rejection loop below forever, which is
  // reachable the moment anything shortens the season (a test harness running
  // a two-week league, say).
  const slots = teamIds.length * WEEKS;
  const wanted = INJURY_MIN + Math.floor(rand() * (INJURY_MAX - INJURY_MIN + 1));
  const count = Math.min(wanted, slots);

  const names = shuffle(rand, INJURY_NAMES);
  const injuries = [];
  const used = new Set();

  for (let i = 0; i < count; i++) {
    let teamId;
    let week;
    let key;
    // Random placement, retried until it lands somewhere free. Bounded so a
    // near-full board degrades to fewer injuries rather than hanging.
    let tries = 0;
    do {
      teamId = teamIds[Math.floor(rand() * teamIds.length)];
      week = 1 + Math.floor(rand() * WEEKS);
      key = `${teamId}:${week}`;
    } while (used.has(key) && ++tries < slots * 4);
    if (used.has(key)) break;
    used.add(key);

    injuries.push({
      teamId,
      week,
      points: -(4 + Math.floor(rand() * 9)), // -4 through -12
      note: names[i % names.length],
    });
  }

  injuries.sort((a, b) => a.week - b.week || a.teamId - b.teamId);
  return injuries;
}

// ------------------------------------------------------------------ generator

/**
 * Build a complete fake season.
 *
 * @param {number} seed any integer; the same seed always yields the same league
 * @returns {{season:number,isDemo:boolean,name:string,weeks:number,teams:Array,games:Array,injuries:Array}}
 */
export function generateDemoLeague(seed = 12345) {
  const rand = mulberry32(seed);

  const teams = TEAM_NAMES.map((name, index) => ({ id: index + 1, name }));
  const teamIds = teams.map((t) => t.id);

  // Hand out the strength ladder in shuffled order, then nudge each rung a
  // little so the talent gaps are not perfectly even.
  const ladder = shuffle(rand, STRENGTH_LADDER);
  const strength = new Map();
  teamIds.forEach((id, index) => {
    strength.set(id, ladder[index] + gaussian(rand) * 1.2);
  });

  const schedule = buildSchedule(rand, teamIds);
  const injuries = buildInjuries(rand, teamIds);

  const injuryByKey = new Map();
  for (const injury of injuries) {
    injuryByKey.set(`${injury.teamId}:${injury.week}`, injury.points);
  }

  // One team's week. `signal` is the part a projection could in principle see;
  // everything after it is the noise that makes fantasy football fantasy
  // football.
  const scoreTeamWeek = (teamId, week) => {
    const form = gaussian(rand) * FORM_SD;
    const signal = ACTUAL_MEAN + strength.get(teamId) + form;

    const projected =
      PROJECTED_MEAN +
      PROJECTION_SLOPE * (signal - ACTUAL_MEAN) +
      gaussian(rand) * PROJECTION_ERROR_SD;

    const blowup =
      rand() < BLOWUP_CHANCE
        ? Math.min(exponential(rand, BLOWUP_MEAN), BLOWUP_CAP)
        : 0;
    const residual =
      gaussian(rand) * RESIDUAL_SD + blowup - BLOWUP_CHANCE * BLOWUP_MEAN;

    const hit = injuryByKey.get(`${teamId}:${week}`) || 0;
    const actual = Math.max(SCORE_FLOOR, signal + residual + hit);

    return { actual: round1(actual), projected: round1(projected) };
  };

  const games = [];
  for (let week = 1; week <= WEEKS; week++) {
    for (const [homeId, awayId] of schedule[week - 1]) {
      const home = scoreTeamWeek(homeId, week);
      const away = scoreTeamWeek(awayId, week);
      games.push({
        week,
        homeId,
        awayId,
        homeActual: home.actual,
        homeProjected: home.projected,
        awayActual: away.actual,
        awayProjected: away.projected,
      });
    }
  }

  return {
    season: SEASON,
    isDemo: true,
    name: 'Demo League',
    weeks: WEEKS,
    teams,
    games,
    injuries,
  };
}
