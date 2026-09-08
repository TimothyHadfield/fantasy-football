// Practice drafts: opponents that behave like people, and a grade at the end.
//
// Pure functions, same as draft-model.js — the whole thing runs in node so a
// practice draft can be simulated a thousand times in a test rather than
// clicked through by hand.
//
// The point of practice mode is to find out whether the assistant's advice
// feels right *before* it matters. So the room must behave identically to a
// real draft; only the other nine managers are fake.

import { LEAGUE, rosterState, roundOf } from './draft-model.js';

// ------------------------------------------------------------------- randomness

/** Small seeded PRNG (mulberry32), so a practice draft can be replayed exactly. */
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roughly normal, via the sum of three uniforms. Cheap and good enough. */
function gaussian(rng) {
  return ((rng() + rng() + rng()) - 1.5) * 2;
}

// ------------------------------------------------------------- opponent picks

export const DIFFICULTY = {
  // How far, in picks, a manager strays from consensus. Casual managers reach
  // and panic; sharp ones stay close to the board and respect their roster.
  casual: { noise: 18, needWeight: 0.5, kdstRound: 12 },
  normal: { noise: 10, needWeight: 1.0, kdstRound: 14 },
  sharp: { noise: 5, needWeight: 1.6, kdstRound: 15 },
};

/**
 * One opponent's pick.
 *
 * Deliberately NOT the same engine the user is being advised by. If the room
 * were full of copies of our own model, practice would teach you to beat
 * yourself rather than to beat ten people drafting off ESPN's list. So these
 * managers follow consensus with noise, respect their own roster holes, and
 * make the ordinary mistakes — reaching for a kicker too early, ignoring bye
 * weeks, taking a fourth running back because he is the highest name left.
 */
export function opponentPick(available, roster, round, rounds, rng, level = 'normal') {
  const cfg = DIFFICULTY[level] || DIFFICULTY.normal;
  const state = rosterState(roster);
  const roundsLeft = rounds - round + 1;

  const legal = available.filter((p) => {
    if (state.full[p.pos]) return false;
    // Nobody sensible takes a kicker in round 3.
    if ((p.pos === 'K' || p.pos === 'DST') && round < cfg.kdstRound) return false;
    // But everybody has to end up with one.
    if (roundsLeft <= state.starterHolesLeft && (state.need[p.pos] || 0) === 0
        && !(state.flexOpen > 0 && LEAGUE.flexEligible.includes(p.pos))) return false;
    return true;
  });
  if (!legal.length) return available[0] ?? null;

  const scored = legal.map((p) => {
    // Consensus position, jittered. Lower is better.
    const base = p.adp ?? 250;
    let value = base + gaussian(rng) * cfg.noise;

    // Managers chase their own holes, and harder as the draft runs out.
    if ((state.need[p.pos] || 0) > 0) {
      const urgency = 1 - Math.min(1, (roundsLeft - state.starterHolesLeft) / 6);
      value -= 14 * cfg.needWeight * Math.max(0.25, urgency);
    }
    // And they get bored of a position once they are deep in it.
    const have = state.counts[p.pos] || 0;
    const want = (LEAGUE.starters[p.pos] || 0) + 1;
    if (have >= want) value += 9 * (have - want + 1) * cfg.needWeight;

    return { p, value };
  });

  scored.sort((a, b) => a.value - b.value);
  return scored[0].p;
}

// ---------------------------------------------------------------- the lineup

/**
 * Best legal starting lineup from a set of players.
 *
 * Greedy is exactly right here: the dedicated slots can only be filled by their
 * own position, so taking the best available at each is optimal, and the flex
 * accepts a superset of what is left over.
 */
export function bestLineup(players) {
  const pool = [...players].sort((a, b) => b.proj - a.proj);
  const used = new Set();
  const take = (positions) => {
    const hit = pool.find((p) => positions.includes(p.pos) && !used.has(p.id));
    if (hit) used.add(hit.id);
    return hit || null;
  };

  const slots = [
    { slot: 'QB', player: take(['QB']) },
    { slot: 'RB', player: take(['RB']) },
    { slot: 'RB', player: take(['RB']) },
    { slot: 'WR', player: take(['WR']) },
    { slot: 'WR', player: take(['WR']) },
    { slot: 'TE', player: take(['TE']) },
    { slot: 'FLEX', player: take(LEAGUE.flexEligible) },
    { slot: 'D/ST', player: take(['DST']) },
    { slot: 'K', player: take(['K']) },
  ];

  const total = slots.reduce((sum, s) => sum + (s.player?.proj || 0), 0);
  const bench = pool.filter((p) => !used.has(p.id));
  return { slots, total, bench, holes: slots.filter((s) => !s.player).length };
}

// ------------------------------------------------------------------- grading

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

const GRADES = [
  [1.5, 'A+'], [1.0, 'A'], [0.7, 'A-'], [0.4, 'B+'], [0.1, 'B'],
  [-0.2, 'B-'], [-0.5, 'C+'], [-0.8, 'C'], [-1.2, 'D'],
];

function gradeFor(z) {
  for (const [floor, letter] of GRADES) if (z >= floor) return letter;
  return 'F';
}

/**
 * Score every team's draft and rank them.
 *
 * The headline number is the projected starting lineup, because that is what
 * actually scores points. The grade is relative to this specific room rather
 * than an absolute scale — finishing 1,950 means something different in a
 * league of sharks than in a league of casuals.
 */
export function gradeDraft({ rosters, myIndex, picks = [], byes = true }) {
  const lineups = rosters.map((players) => bestLineup(players));
  const totals = lineups.map((l) => l.total);
  const m = mean(totals);
  const sd = stdev(totals);

  const ranked = totals
    .map((total, i) => ({ i, total }))
    .sort((a, b) => b.total - a.total);
  const rankOf = new Map(ranked.map((r, idx) => [r.i, idx + 1]));

  const mine = lineups[myIndex];
  const z = sd ? (mine.total - m) / sd : 0;

  // Where the roster is strong or weak, slot by slot, against the same slot
  // on every other team.
  const bySlot = mine.slots.map((s, idx) => {
    const others = lineups
      .filter((_, i) => i !== myIndex)
      .map((l) => l.slots[idx]?.player?.proj || 0);
    const avg = mean(others);
    return {
      slot: s.slot,
      player: s.player,
      proj: s.player?.proj || 0,
      leagueAvg: avg,
      edge: (s.player?.proj || 0) - avg,
    };
  });

  // Did the picks come in below their consensus cost?
  const myPicks = picks.filter((p) => p.mine);
  const valueCaptured = myPicks.reduce((sum, p) => {
    if (p.player?.adp == null) return sum;
    return sum + (p.overall - p.player.adp);
  }, 0);

  // Bye-week pile-ups among starters only; bench byes do not matter.
  const byeCounts = {};
  if (byes) {
    for (const s of mine.slots) {
      const b = s.player?.bye;
      if (b) byeCounts[b] = (byeCounts[b] || 0) + 1;
    }
  }
  const worstBye = Object.entries(byeCounts)
    .map(([week, n]) => ({ week: Number(week), count: n }))
    .sort((a, b) => b.count - a.count)[0] || null;

  return {
    lineups,
    totals,
    myTotal: mine.total,
    myLineup: mine,
    rank: rankOf.get(myIndex),
    teams: rosters.length,
    leagueMean: m,
    leagueBest: Math.max(...totals),
    grade: gradeFor(z),
    z,
    bySlot,
    benchTotal: mine.bench.reduce((s, p) => s + p.proj, 0),
    valueCaptured,
    worstBye,
    strengths: [...bySlot].sort((a, b) => b.edge - a.edge).slice(0, 2),
    weaknesses: [...bySlot].sort((a, b) => a.edge - b.edge).slice(0, 2),
  };
}

/** Short, honest sentences about how the draft went. */
export function gradeNotes(result) {
  const out = [];
  const behind = result.leagueBest - result.myTotal;

  if (result.rank === 1) {
    out.push(`Best projected lineup in the league, by ${Math.round(result.myTotal - [...result.totals].sort((a, b) => b - a)[1])} points.`);
  } else {
    out.push(`${ordinal(result.rank)} of ${result.teams}, ${Math.round(behind)} points behind the best lineup.`);
  }

  const s = result.strengths[0];
  if (s && s.edge > 12) {
    out.push(`Your ${s.slot} is the strength — ${Math.round(s.edge)} points clear of the average ${s.slot} in this league.`);
  }
  const w = result.weaknesses[0];
  if (w && w.edge < -12) {
    out.push(`Weakest link is ${w.slot}, ${Math.round(-w.edge)} points below the league average there.`);
  }
  if (result.myLineup.holes) {
    out.push(`You finished with ${result.myLineup.holes} starting slot(s) unfilled — that is points thrown away every week.`);
  }
  if (result.valueCaptured > 25) {
    out.push(`Good value discipline: your picks came ${Math.round(result.valueCaptured)} slots later than consensus in total.`);
  } else if (result.valueCaptured < -25) {
    out.push(`You reached a lot — ${Math.round(-result.valueCaptured)} slots ahead of consensus across the draft.`);
  }
  if (result.worstBye && result.worstBye.count >= 4) {
    out.push(`${result.worstBye.count} of your starters share the week ${result.worstBye.week} bye.`);
  }
  return out;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// -------------------------------------------------------- full auto simulation

/**
 * Run an entire draft with nobody human in it.
 *
 * Used two ways: to seed a practice room, and to answer "what would the
 * assistant have done from here?" once the user has finished, which is the
 * only honest way to tell them whether their own deviations helped.
 */
export function simulateDraft({
  players, teams = LEAGUE.teams, rounds = LEAGUE.rounds,
  seed = 1, level = 'normal', pickFor = null,
}) {
  const rng = makeRng(seed);
  const rosters = Array.from({ length: teams }, () => []);
  const taken = new Set();
  const picks = [];

  for (let overall = 1; overall <= teams * rounds; overall++) {
    const round = roundOf(overall, teams);
    const inRound = overall - (round - 1) * teams;
    const slot = round % 2 === 1 ? inRound : teams - inRound + 1;
    const available = players.filter((p) => !taken.has(p.id));
    if (!available.length) break;

    const chosen = pickFor
      ? (pickFor({ slot, overall, round, available, rosters, picks })
         ?? opponentPick(available, rosters[slot - 1], round, rounds, rng, level))
      : opponentPick(available, rosters[slot - 1], round, rounds, rng, level);

    taken.add(chosen.id);
    rosters[slot - 1].push(chosen);
    picks.push({ playerId: chosen.id, player: chosen, overall, round, slot });
  }

  return { rosters, picks };
}
