// THE GOAL — ranking a trade by what it does to the chance you are playing for.
//
//   node test-trade-odds.mjs
//
// js/trade-odds.js is pure, so this is a hand fixture first: a four-team league
// with two regular weeks and a two-team final, small enough that every
// direction below can be argued on paper before the simulation is run. Then the
// demo league, for the one seam a hand fixture cannot reach — that the finder's
// new `theirByWeek` is the partner's real per-week change.
//
// The sections:
//
//   1. the goals                   — which way is good, for each
//   2. will he say yes             — the curve at the four points the page quotes
//   3. how it looks on ESPN        — his side of the arithmetic
//   4. a deal as per-week points   — offerDeltas
//   5. shifting the season         — the right games, the right weeks, nothing else
//   6. common random numbers       — a tiny change moves the answer a tiny amount
//   7. direction                   — more points help; a stronger rival hurts
//   8. the playoff weeks           — they move the title and NEVER last place
//   9. scoring and ranking         — value = gain × yes, and the tie-breaks
//  10. the seam                    — theirByWeek is the partner's real change

import * as capture from '../js/capture.js';
import {
  GOALS, goalOf, goalChance, goalGain, acceptChance, espnLookPerWeek, offerDeltas,
  shiftSeason, simulateWith, scoreOffer, compareByGoal, ACCEPT_LEEWAY, ACCEPT_SCALE,
} from '../js/trade-odds.js';
import { generateDemoWeekRosters } from '../js/demo-rosters.js';
import { slotCountsFromLineups } from '../js/projection.js';
import { findTrades, priceTradeAcrossWeeks, slotsForLeague } from '../js/trade.js';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra !== '' ? ` — ${String(extra).slice(0, 220)}` : ''}`);
};
const near = (a, b, tol, msg) => ok(msg, Math.abs(a - b) <= tol, `${a} vs ${b}`);

// ------------------------------------------------------------------ fixture
//
// Four teams. Weeks 1 and 2 are the regular season, nothing played. Two teams
// qualify, so the bracket is one round — the final — in week 3.
//
//   team 1  "me"      95 a week
//   team 2  "rival"  100 a week   — I play him in week 1
//   team 3           100 a week   — I play him in week 2
//   team 4            90 a week
//
// Four evenly-matched sides and a spread of 20, so nobody's chances sit near
// 0 or 1 and every change has room to show.

const TEAMS = [1, 2, 3, 4];
const games = [
  { week: 1, homeId: 1, awayId: 2 }, { week: 1, homeId: 3, awayId: 4 },
  { week: 2, homeId: 1, awayId: 3 }, { week: 2, homeId: 2, awayId: 4 },
].map((g) => ({ ...g, homeScore: 0, awayScore: 0, played: false }));
const data = capture.normalizeSchedule({
  teams: TEAMS.map((id) => ({ id, name: `T${id}` })),
  games,
  playoffs: { playoffTeams: 2 },
}, { isDemo: false });
const strength = new Map([[1, 95], [2, 100], [3, 100], [4, 90]]);
const proj = new Map([1, 2, 3].map((w) => [w, new Map(strength)]));
const inputs = capture.simulationInputs({
  data, isRemaining: (g) => capture.gameState(g) !== 'final', proj, sigma: 20,
});

ok('fixture: every regular game is playable', inputs.playable === 4, inputs.playable);
ok('fixture: the bracket is one round in week 3',
  JSON.stringify(inputs.playoff.weeks) === '[3]' && inputs.playoff.teams === 2,
  JSON.stringify(inputs.playoff));
ok('simulationInputs carries each game’s week (the shift needs it)',
  inputs.games.map((g) => g.week).join(',') === '1,1,2,2', inputs.games.map((g) => g.week).join(','));

const RUNS = 20000;
const run = (deltas = null, seed = 7) => simulateWith(inputs, deltas, { runs: RUNS, seed });
const d = (entries) => new Map(entries.map(([team, weeks]) => [team, new Map(weeks)]));
const base = run();
const chance = (res, goal, team = 1) => goalChance(res, team, goal);

// ---------------------------------------------------------------- 1. goals

ok('goalOf falls back to the title for anything it does not know',
  goalOf('nonsense') === GOALS.title && goalOf(undefined) === GOALS.title);
ok('the two goals are title and last', goalOf('last').key === 'last' && goalOf('title').key === 'title');
near(goalGain(0.10, 0.13, 'title'), 0.03, 1e-12, 'title: a chance going UP is a gain');
near(goalGain(0.12, 0.09, 'last'), 0.03, 1e-12, 'last: a chance going DOWN is a gain');
near(goalGain(0.12, 0.15, 'last'), -0.03, 1e-12, 'last: a chance going up is a loss');
ok('goalGain refuses a missing number', goalGain(null, 0.1, 'title') === null);
ok('the title chance is pTitle and last is pLast',
  chance(base, 'title') === base.teams.find((t) => t.teamId === 1).pTitle &&
  chance(base, 'last') === base.teams.find((t) => t.teamId === 1).pLast);

// ---------------------------------------------------- 2. will he say yes?
//
// The four points the page prints in its note. If the constants move, the
// note must move with them, and this is what says so.

ok('the constants are the ones the note quotes', ACCEPT_LEEWAY === 3 && ACCEPT_SCALE === 1.5);
near(acceptChance({ lineupPerWeek: 3, lookPerWeek: 3 }), 0.982, 0.001, '+3 a week ahead → 98%');
near(acceptChance({ lineupPerWeek: 0, lookPerWeek: 0 }), 0.881, 0.001, 'dead even → 88%');
near(acceptChance({ lineupPerWeek: -3, lookPerWeek: -3 }), 0.5, 1e-9, 'giving up 3 a week → 50%');
near(acceptChance({ lineupPerWeek: -6, lookPerWeek: -6 }), 0.119, 0.001, 'giving up 6 a week → 12%');
near(acceptChance({ lineupPerWeek: 2, lookPerWeek: -8 }),
  acceptChance({ lineupPerWeek: -3, lookPerWeek: -3 }), 1e-12,
  'the two halves are weighed equally: +2 and −8 reads as −3');
near(acceptChance({ lineupPerWeek: -3 }), 0.5, 1e-9, 'one half alone stands for both');
ok('with nothing to go on it says nothing', acceptChance({}) === null);
ok('it never goes up as the deal gets worse for him',
  [-9, -6, -3, 0, 3, 6].map((v) => acceptChance({ lineupPerWeek: v, lookPerWeek: v }))
    .every((p, i, a) => i === 0 || p > a[i - 1]));

// ---------------------------------------------------- 3. how it looks on ESPN

{
  // HE receives your `send` and gives up your `receive`.
  const offer = {
    send: [{ projected: 60 }, { projected: 30 }],   // 90 to him
    receive: [{ projected: 120 }],                   // 120 from him
  };
  near(espnLookPerWeek(offer, 10), -3, 1e-12, 'he gets 90, gives 120, over 10 weeks: −3 a week');
  near(espnLookPerWeek({ send: [{ projected: 50 }], receive: [{ projected: null }] }, 5), 10, 1e-12,
    'a man with no number counts as nothing, never NaN');
  ok('no offer, no answer', espnLookPerWeek(null, 5) === null);
}

// ---------------------------------------------------- 4. a deal as points

{
  const offer = {
    partner: { id: 2 },
    byWeek: [{ week: 1, delta: 4 }, { week: 2, delta: 0 }, { week: 3, delta: -2 }],
    theirByWeek: [{ week: 1, delta: 1.5 }, { week: 2, delta: 0 }],
  };
  const m = offerDeltas(offer, 1);
  ok('my side is keyed on my team', m.get(1)?.get(1) === 4 && m.get(1)?.get(3) === -2);
  ok('a week the deal does not touch is left out, not written as 0', !m.get(1).has(2));
  ok('his side is keyed on the partner', m.get(2)?.get(1) === 1.5 && m.get(2).size === 1);
  const custom = offerDeltas({ ...offer, mineTeamId: 4 }, 1);
  ok('a custom deal’s own "mine" wins over the page’s team', custom.has(4) && !custom.has(1));
  ok('an offer with no per-week breakdown contributes nothing',
    offerDeltas({ partner: { id: 2 } }, 1).size === 0);
}

// ---------------------------------------------------- 5. shifting the season

{
  const before = JSON.stringify(inputs.games);
  const shifted = shiftSeason(inputs, d([[1, [[1, 10], [3, 7]]], [3, [[2, -5]]]]));
  const g = (week, home) => shifted.games.find((x) => x.week === week && x.homeId === home);
  ok('week 1: my home projection +10', g(1, 1).homeProj === 105 && g(1, 1).awayProj === 100);
  ok('week 2: I am untouched, team 3 is −5', g(2, 1).homeProj === 95 && g(2, 1).awayProj === 95);
  ok('a game neither side of the deal plays in is untouched',
    g(1, 3).homeProj === 100 && g(1, 3).awayProj === 90);
  ok('the bracket week shifts in the playoff projection', shifted.playoff.proj.get(3).get(1) === 102);
  ok('and nobody else’s bracket number moves', shifted.playoff.proj.get(3).get(2) === 100);
  ok('the inputs themselves are not mutated',
    JSON.stringify(inputs.games) === before && inputs.playoff.proj.get(3).get(1) === 95);

  const holed = { ...inputs, games: [{ week: 1, homeId: 1, awayId: 2, homeProj: null, awayProj: 100 }] };
  ok('a missing projection stays missing — a delta never invents one',
    shiftSeason(holed, d([[1, [[1, 10]]]])).games[0].homeProj === null);
}

// ---------------------------------------------------- 6. common random numbers
//
// THE REASON EVERY RUN SHARES A SEED. Two runs of the SAME league on the same
// seed are identical, and a change of a hundredth of a point moves the answer
// by almost nothing. On different seeds the same league differs by far more —
// which is the noise that would otherwise decide the order of close offers.

{
  const again = run();
  ok('the same league on the same seed is the same answer, exactly',
    chance(again, 'title') === chance(base, 'title') && chance(again, 'last') === chance(base, 'last'));
  const hair = run(d([[1, [[1, 0.01], [2, 0.01], [3, 0.01]]]]));
  const tiny = Math.abs(chance(hair, 'title') - chance(base, 'title'));
  ok('a hundredth of a point a week moves the title chance by under 0.1 of a point', tiny < 0.001, tiny);
  let spread = 0;
  for (const seed of [11, 12, 13, 14]) {
    spread = Math.max(spread, Math.abs(chance(run(null, seed), 'title') - chance(base, 'title')));
  }
  ok('while a different seed moves the SAME league by more than that', spread > tiny, `${spread} vs ${tiny}`);
  ok('an empty deal is the league as it is', chance(run(new Map()), 'title') === chance(base, 'title'));
}

// ------------------------------------------------------------ 7. direction

{
  const stronger = run(d([[1, [[1, 10], [2, 10], [3, 10]]]]));
  ok('ten more points a week raises my title chance',
    chance(stronger, 'title') > chance(base, 'title') + 0.02,
    `${chance(base, 'title')} → ${chance(stronger, 'title')}`);
  ok('and lowers my chance of last',
    chance(stronger, 'last') < chance(base, 'last') - 0.02,
    `${chance(base, 'last')} → ${chance(stronger, 'last')}`);

  // THE RIVAL. The same +5 for me, once alone and once with the partner — whom
  // I play in week 1 and who competes for the same two bracket spots — made 15
  // a week better. The deal that strengthens him is worth less to me.
  const alone = run(d([[1, [[1, 5], [2, 5], [3, 5]]]]));
  const rival = run(d([[1, [[1, 5], [2, 5], [3, 5]]], [2, [[1, 15], [2, 15], [3, 15]]]]));
  ok('a deal that makes a rival stronger is worth less to me than the same points alone',
    chance(rival, 'title') < chance(alone, 'title') - 0.01,
    `${chance(alone, 'title')} vs ${chance(rival, 'title')}`);
  const s = scoreOffer({ base, after: rival, myTeamId: 1, partnerId: 2, goal: 'title', accept: 1 });
  ok('and his own title chance is reported, and went up', s.theirs.gain > 0, s.theirs.gain);
}

// ------------------------------------------------------ 8. the playoff weeks
//
// THE STRONGEST CLAIM IN THIS FILE. The bracket draws from its own random
// stream (js/forecast.js), so a change confined to a playoff week leaves every
// regular-season draw exactly where it was — and last place is decided by the
// regular season alone. So on a shared seed the chance of last must be
// IDENTICAL, not merely close, while the title chance moves.

{
  const finalOnly = run(d([[1, [[3, 15]]]]));
  ok('points in the final week raise the title chance',
    chance(finalOnly, 'title') > chance(base, 'title') + 0.01,
    `${chance(base, 'title')} → ${chance(finalOnly, 'title')}`);
  ok('and leave the chance of last EXACTLY where it was',
    chance(finalOnly, 'last') === chance(base, 'last'),
    `${chance(base, 'last')} vs ${chance(finalOnly, 'last')}`);
  ok('and the chance of reaching the bracket too (seeding is the regular season)',
    finalOnly.teams.find((t) => t.teamId === 1).pPlayoffs === base.teams.find((t) => t.teamId === 1).pPlayoffs);
  const weekOne = run(d([[1, [[1, 15]]]]));
  ok('whereas the same points in a regular week DO move last place',
    chance(weekOne, 'last') < chance(base, 'last'), `${chance(base, 'last')} → ${chance(weekOne, 'last')}`);
}

// --------------------------------------------------- 9. scoring and ranking

{
  const after = run(d([[1, [[1, 10], [2, 10], [3, 10]]]]));
  const half = scoreOffer({ base, after, myTeamId: 1, partnerId: 2, goal: 'title', accept: 0.5 });
  near(half.value, half.mine.gain * 0.5, 1e-12, 'value is my gain times the chance he says yes');
  ok('the chance is carried as given', half.accept === 0.5);
  const sure = scoreOffer({ base, after, myTeamId: 1, partnerId: 2, goal: 'title', accept: null });
  ok('with no estimate the value is the gain itself, and says so', sure.value === sure.mine.gain && sure.accept === null);
  const last = scoreOffer({ base, after, myTeamId: 1, partnerId: 2, goal: 'last', accept: 1 });
  ok('under "last", fewer finishes last reads as a POSITIVE gain', last.mine.gain > 0 &&
    last.mine.after < last.mine.before, JSON.stringify(last.mine));

  const o = (value, gain, myGain) => ({ myGain, goalScore: { value, mine: { gain } } });
  const list = [o(0.01, 0.02, 5), o(0.03, 0.03, 1), o(0.01, 0.03, 2), o(0.01, 0.02, 9), { myGain: 50 }];
  const sorted = list.slice().sort(compareByGoal);
  ok('ranked by value first', sorted[0] === list[1]);
  ok('then by the gain itself', sorted[1] === list[2]);
  ok('then, when the simulation cannot tell them apart, by points', sorted[2] === list[3] && sorted[3] === list[0]);
  ok('an offer the simulation never scored goes last, whatever its points', sorted[4] === list[4]);
  const hair = [o(0.010001, 0.02, 1), o(0.01, 0.02, 3)].sort(compareByGoal);
  ok('a difference below what 10,000 runs can see is a tie, and points break it', hair[0].myGain === 3);
}

// ------------------------------------------------------------- 10. the seam
//
// `theirByWeek` is new on every weekly offer, and the simulation plays it out
// as the partner's change. It must be HIS REAL CHANGE — priced independently
// here through `priceTradeAcrossWeeks` from his side of the deal.

{
  const weeks = [6, 7, 8, 9];
  const byWeek = new Map(weeks.map((w) => [w, generateDemoWeekRosters(w)]));
  const idx = new Map([...byWeek].map(([w, r]) => {
    const m = new Map();
    for (const t of r.teams) for (const p of t.players) m.set(p.playerId, p.projected);
    return [w, m];
  }));
  const projFor = (p, w) => { const v = idx.get(w)?.get(p.playerId); return typeof v === 'number' ? v : null; };
  const now = byWeek.get(6);
  const slots = slotsForLeague(slotCountsFromLineups(now.teams));
  const res = findTrades({ teams: now.teams, myTeamId: 9, slots, weeks, projFor });
  ok('the demo league has offers to check', res.offers.length > 3, res.offers.length);
  let checked = 0;
  let agree = 0;
  for (const offer of res.offers.slice(0, 8)) {
    const partner = now.teams.find((t) => t.id === offer.partner.id);
    const his = priceTradeAcrossWeeks({
      players: partner.players, send: offer.receive, receive: offer.send, slots, weeks, projFor,
    });
    checked++;
    const same = offer.theirByWeek.length === weeks.length && offer.theirByWeek.every((w, i) =>
      w.week === his.byWeek[i].week && Math.abs(w.delta - his.byWeek[i].delta) < 0.051);
    if (same) agree++;
    else fails.push(`theirByWeek for ${offer.partner.name}: ${JSON.stringify(offer.theirByWeek.map((w) => w.delta))} ` +
      `vs ${JSON.stringify(his.byWeek.map((w) => w.delta))}`);
  }
  pass += agree;
  ok(`every checked offer’s theirByWeek is the partner’s own re-priced change (${agree}/${checked})`,
    checked > 0 && agree === checked);
  ok('and it adds up to He gains',
    res.offers.every((o) => Math.abs(o.theirByWeek.reduce((a, w) => a + w.delta, 0) - o.theirGain) < 0.25),
    res.offers.map((o) => `${o.theirByWeek.reduce((a, w) => a + w.delta, 0).toFixed(1)}/${o.theirGain}`).slice(0, 5).join(' '));
}

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log('FAIL ' + f);
  if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
