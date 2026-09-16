// Stands in for js/season.js for the Trade page's LIVE scenarios.
//
// Four squads, hand-built so the two measures genuinely disagree — which is the
// only way to prove the page is showing the one it says it is.
//
// THE SHAPE OF THE LEAGUE, and every number below exists to make one of these
// true:
//
//   Ana (team 1) carries TWO quarterbacks whose weeks alternate 19 / 7. On a
//   single scalar per man they are both worth 13, so her lineup shows a 13 at
//   quarterback and Bo's steady 17 looks like a +4 upgrade. Across the weeks
//   she starts whichever of them is on his high week, so she is ALREADY getting
//   19 every week and the 17 is worth exactly nothing. That is Tim's own
//   complaint — "getting a 19 proj QB doesn't really change my team" — built
//   into a fixture, and the Ana/Bo offer must therefore exist on the scalar
//   basis and be GONE on the weekly one.
//
//   Ana ↔ Cy is flat on both sides, so it survives both measures and the table
//   is never empty. Cy is thin at tight end AND at defence, and has backs and
//   receivers to spare; Ana is the other way round. Two holes rather than one
//   is what lets two DISJOINT Ana/Cy deals both be worth making, which is what
//   puts a merged row — two trades with one manager, shown as one offer — on
//   the page at all.
//
//   Di is filler: a balanced squad with a junk bench, so the league is four
//   teams rather than two.
//
// THREE MORE THINGS ARE BUILT IN, each so that an assertion about them can
// actually FAIL rather than passing by luck:
//
//   A PLAYED WEEK THAT WOULD CHANGE THE ANSWER. Cy's tight end projects 30 in
//   weeks 1-4 and 4 from week 5 on. Weeks 1-4 have results against them, so a
//   trade cannot reach them and none of those 30s may show up in any number on
//   the page. If the span ever slips back to including a played week — which is
//   exactly what it used to do, since the page opens on the last week PLAYED —
//   Cy stops looking thin at tight end for that week and the Ana/Cy deal is
//   priced differently. The test prices both spans and insists they differ,
//   so "played weeks are excluded" is falsifiable rather than decorative.
//
//   A BYE, IN AN UNPLAYED WEEK. `Bills D/ST` projects 11 in every week of the
//   span except week 8, where ESPN returns 0.00. Nine weeks are priced, so his
//   per-week figure must be 88 / 8 = 11.0 — not 88 / 9 = 9.8. Hand-computable,
//   and far enough apart that a page still dividing by the whole span cannot
//   round into agreement.
//
//   A D/ST WORTH TRADING. Ana carries TWO defences: she starts the 12 and the
//   11 sits on her bench, and Cy is on a 2. That is what puts a defence into a
//   rendered package at all, so the "no position tag on a D/ST" rule has
//   something to be tested against — and they are named the way ESPN names
//   them (`"<Franchise> D/ST"`, per docs/espn-draft-api.md), which is the whole
//   reason the tag is redundant.
//
// `calls` counts what the page actually spends, which is what the cost note is
// tested against. One request per week, and no bulk form — the same rule the
// real module documents.

export const calls = { schedule: 0, week: [], weeks: [] };

// FOURTEEN, not thirteen, and that is the point of the number.
//
// Tim's real league plays 14 regular-season matchups. The trade page used to
// cap its weekly span at week 13, citing a rule that claimed ESPN published
// nothing beyond it — a rule that turned out to be wrong. With a 13-week
// fixture that cap was invisible: the span ended at 13 either way, so the suite
// passed whether the page read the schedule or ignored it.
//
// At 14 the cap becomes visible. A page still enforcing it drops week 14 from
// every span, every request count and every offer it prices.
export const WEEKS = 14;
export const PLAYED_THROUGH = 4;   // so useLive() opens on week 4
export const LEAGUE = '476225250';
export const SEASON = 2026;

const SLOT = { QB: 0, RB: 2, WR: 4, TE: 6, FLEX: 23, DST: 16, K: 17, BE: 20 };
const LABEL = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'BE' };

const flat = (v) => () => v;
/** 19 on odd weeks and 7 on even, or the other way round. Mean is the same. */
const swing = (hi, lo, oddHigh) => (w) => ((w % 2 === 1) === oddHigh ? hi : lo);
/** Loud in the weeks that are already played, ordinary in the ones that are not. */
const spike = (played, rest) => (w) => (w <= PLAYED_THROUGH ? played : rest);
/** ESPN's 0.00 for a bye — a real number, and not the same thing as a null. */
const bye = (v, week) => (w) => (w === week ? 0 : v);

/** The one unplayed week `Bills D/ST` is off. Named so a test can import it. */
export const BYE_WEEK = 8;

/** name, position, slot, the weekly projection, and the season mean per game. */
const P = (name, position, slot, week, mean) => ({ name, position, slot, week, mean });

export const TEAMS = [
  {
    id: 1,
    name: 'Ana',
    players: [
      P('Ana QB1', 'QB', SLOT.QB, swing(19, 7, true), 13),
      P('Ana RB1', 'RB', SLOT.RB, flat(14), 14),
      P('Ana RB2', 'RB', SLOT.RB, flat(13), 13),
      P('Ana WR1', 'WR', SLOT.WR, flat(14), 14),
      P('Ana WR2', 'WR', SLOT.WR, flat(12), 12),
      P('Ana TE1', 'TE', SLOT.TE, flat(12), 12),
      P('Ana WR3', 'WR', SLOT.FLEX, flat(12), 12),
      // Named as ESPN names one. The position is IN the name, which is the
      // whole of Tim's fourth ask.
      P('Ravens D/ST', 'DST', SLOT.DST, flat(12), 12),
      P('Ana K', 'K', SLOT.K, flat(7), 7),
      P('Ana QB2', 'QB', SLOT.BE, swing(19, 7, false), 13),
      P('Ana TE2', 'TE', SLOT.BE, flat(11), 11),
      P('Ana WR4', 'WR', SLOT.BE, flat(11), 11),
      // The second defence: on her bench, better than anyone else's starter,
      // and off in week 8. He is the man the bye arithmetic is checked on.
      P('Bills D/ST', 'DST', SLOT.BE, bye(11, BYE_WEEK), 11),
    ],
  },
  {
    id: 2,
    name: 'Bo',
    players: [
      P('Bo QB1', 'QB', SLOT.QB, flat(17), 17),
      P('Bo RB1', 'RB', SLOT.RB, flat(13), 13),
      P('Bo RB2', 'RB', SLOT.RB, flat(12), 12),
      P('Bo WR1', 'WR', SLOT.WR, flat(6), 6),
      P('Bo WR2', 'WR', SLOT.WR, flat(5), 5),
      P('Bo TE1', 'TE', SLOT.TE, flat(10), 10),
      P('Bo RB3', 'RB', SLOT.FLEX, flat(11), 11),
      P('Bears D/ST', 'DST', SLOT.DST, flat(7), 7),
      P('Bo K', 'K', SLOT.K, flat(7), 7),
      P('Bo QB2', 'QB', SLOT.BE, flat(14), 14),
      P('Bo WR3', 'WR', SLOT.BE, flat(4), 4),
      P('Bo RB4', 'RB', SLOT.BE, flat(4), 4),
    ],
  },
  {
    id: 3,
    name: 'Cy',
    players: [
      P('Cy QB1', 'QB', SLOT.QB, flat(15), 15),
      P('Cy RB1', 'RB', SLOT.RB, flat(17), 17),
      P('Cy RB2', 'RB', SLOT.RB, flat(16), 16),
      P('Cy WR1', 'WR', SLOT.WR, flat(16), 16),
      P('Cy WR2', 'WR', SLOT.WR, flat(15), 15),
      // Loud in the weeks already played, and ordinary in the ones a trade
      // can actually reach. See the note at the top of this file.
      P('Cy TE1', 'TE', SLOT.TE, spike(30, 4), 4),
      P('Cy WR3', 'WR', SLOT.FLEX, flat(16), 16),
      // Cy is thin at DEFENCE as well as at tight end, and that is what puts
      // Ana's spare D/ST into a rendered package — without it no defence ever
      // reaches the screen and the "no position tag on a D/ST" rule has
      // nothing to be tested against.
      P('Colts D/ST', 'DST', SLOT.DST, flat(2), 2),
      P('Cy K', 'K', SLOT.K, flat(7), 7),
      P('Cy RB3', 'RB', SLOT.BE, flat(15), 15),
      P('Cy WR4', 'WR', SLOT.BE, flat(5), 5),
      P('Cy QB2', 'QB', SLOT.BE, flat(6), 6),
    ],
  },
  {
    id: 4,
    name: 'Di',
    players: [
      P('Di QB1', 'QB', SLOT.QB, flat(12), 12),
      P('Di RB1', 'RB', SLOT.RB, flat(12), 12),
      P('Di RB2', 'RB', SLOT.RB, flat(11), 11),
      P('Di WR1', 'WR', SLOT.WR, flat(11), 11),
      P('Di WR2', 'WR', SLOT.WR, flat(10), 10),
      P('Di TE1', 'TE', SLOT.TE, flat(9), 9),
      P('Di WR3', 'WR', SLOT.FLEX, flat(10), 10),
      P('Dolphins D/ST', 'DST', SLOT.DST, flat(7), 7),
      P('Di K', 'K', SLOT.K, flat(7), 7),
      P('Di QB2', 'QB', SLOT.BE, flat(6), 6),
      P('Di RB3', 'RB', SLOT.BE, flat(5), 5),
      P('Di WR4', 'WR', SLOT.BE, flat(5), 5),
    ],
  },
];

/** ESPN's own id, the way the real payload carries it: team * 100 + slot index. */
export const playerId = (teamId, i) => teamId * 100 + i;

/** Every id on one squad — what the ESPN deep link is allowed to name. */
export function rosterIds(teamId) {
  const team = TEAMS.find((t) => t.id === teamId);
  return team ? team.players.map((_, i) => playerId(teamId, i)) : [];
}

/** What the stub says ESPN projects for one man in one week. */
export function projectionFor(teamId, i, week) {
  const team = TEAMS.find((t) => t.id === teamId);
  return team ? team.players[i].week(week) : null;
}

function playersFor(team, week) {
  return team.players.map((spec, i) => ({
    playerId: playerId(team.id, i),
    name: spec.name,
    position: spec.position,
    proTeam: 'BUF',
    proTeamId: 1,
    lineupSlotId: spec.slot,
    slot: LABEL[spec.slot],
    started: spec.slot !== SLOT.BE,
    projected: spec.week(week),
    // A played week has a result; a week still to come does not. That is what
    // the card's Act row reads, and it must stay a fact about the DATA rather
    // than about the calendar.
    actual: week <= PLAYED_THROUGH ? Math.round(spec.week(week) * 0.9 * 10) / 10 : null,
    seasonProjected: spec.mean * 17,
    injuryStatus: 'ACTIVE',
    percentOwned: null,
  }));
}

export async function fetchWeekRosters(week) {
  calls.week.push(week);
  const teams = TEAMS.map((team) => {
    const players = playersFor(team, week);
    const starters = players.filter((p) => p.started);
    const bench = players.filter((p) => !p.started);
    const total = (arr, key) => {
      const vals = arr.map((p) => p[key]).filter((v) => typeof v === 'number');
      return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10 : null;
    };
    return {
      id: team.id,
      name: team.name,
      teamName: `${team.name}'s squad`,
      abbrev: team.name.slice(0, 2).toUpperCase(),
      players,
      starters,
      bench,
      projectedTotal: total(starters, 'projected'),
      actualTotal: total(starters, 'actual'),
      benchActualTotal: total(bench, 'actual'),
      seasonProjectedTotal: total(starters, 'seasonProjected'),
    };
  });
  return { week, teams };
}

/**
 * One request per week, exactly as the real module does it — the count is the
 * point of this stub, so nothing here is batched away.
 */
export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  calls.weeks.push([...weeks]);
  const out = new Map();
  let done = 0;
  for (const week of weeks) {
    const { teams } = await fetchWeekRosters(week);
    out.set(week, teams);
    done++;
    if (onProgress) onProgress(done, weeks.length, week);
  }
  return out;
}

export async function fetchSchedule() {
  calls.schedule++;
  const weeks = Array.from({ length: WEEKS }, (_, i) => i + 1);
  const games = [];
  for (const week of weeks) {
    games.push(
      { week, homeId: 1, awayId: 2, played: week <= PLAYED_THROUGH },
      { week, homeId: 3, awayId: 4, played: week <= PLAYED_THROUGH }
    );
  }
  return {
    leagueName: 'Stub League',
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name })),
    weeks,
    byWeek: new Map(),
    games,
  };
}

export async function fetchSeasonData() {
  throw new Error('fetchSeasonData is not used by the Trade page');
}
