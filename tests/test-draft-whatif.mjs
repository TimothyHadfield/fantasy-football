// Checks the Draft page's "What if" maths in js/draft-review.js (Tim,
// 2026-10-26: "click on a single player while a user is selected, and then you
// can replace that player with any other player that was drafted after that
// player and the what if will calculate the outcomes as if that user drafted
// that player").
//
//   node test-draft-whatif.mjs
//
// A hand-made four-team, three-round snake small enough that every shift,
// lineup, score, record and rank below is worked out by hand in the comments;
// then the sample league (js/demo-rosters.js, 10 teams × 16 rounds, 13 played
// weeks) at its real size for the invariants: no swap = the real season to the
// point, every week's points add up, and a man never plays for two teams.

import { moduleUrl } from './repo.mjs';

const R = await import(moduleUrl('js/draft-review.js'));
const capture = await import(moduleUrl('js/capture.js'));
const demo = await import(moduleUrl('js/demo-rosters.js'));

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, name, tol = 1e-9) => ok(typeof a === 'number' && Math.abs(a - b) <= tol, name, `got ${a}, want ${b}`);

// ------------------------------------------------------------ the small league
// Teams 1-4, a snake: round 1 picks 1-4 = teams 1,2,3,4; round 2 picks 5-8 =
// 4,3,2,1; round 3 picks 9-12 = 1,2,3,4. Pick n is man 100+n.
const TEAM_AT = [1, 2, 3, 4, 4, 3, 2, 1, 1, 2, 3, 4];
const picks = TEAM_AT.map((teamId, i) => ({
  overall: i + 1, round: Math.floor(i / 4) + 1, roundPick: (i % 4) + 1, teamId, playerId: 101 + i, bid: null, keeper: false,
}));
const men = (order) => order.map((p) => p.playerId);
const REAL = picks.map((p) => p.playerId);

// ------------------------------------------------------------------ the shift
{
  eq(men(R.whatIfOrder(picks, [])), REAL, 'shift: no swap is the real draft');
  eq(R.shiftUp([1, 2, 3, 4, 5], 1, 3), [1, 4, 2, 3, 5], 'shift: the man at 3 moves up to 1, the men in between slide one later');
  eq(R.shiftUp([1, 2, 3], 2, 0), [1, 2, 3], 'shift: an earlier man never moves down');

  // Team 1 at pick 1 takes man 105 (pick 5): 101-104 each slide one pick later.
  const one = R.whatIfOrder(picks, [{ overall: 1, playerId: 105 }]);
  eq(men(one), [105, 101, 102, 103, 104, 106, 107, 108, 109, 110, 111, 112], 'shift: 105 to pick 1, picks 1-4 slide to 2-5');
  eq(one.map((p) => p.teamId), TEAM_AT, 'shift: every slot keeps its team');
  eq([one[0].from, one[1].from, one[4].from, one[5].from], [5, 1, 4, 6], 'shift: each man says where he was really taken');

  // Stacked: then team 1 at pick 8 takes man 111 (still at pick 11).
  const two = R.whatIfOrder(picks, [{ overall: 1, playerId: 105 }, { overall: 8, playerId: 111 }]);
  eq(men(two), [105, 101, 102, 103, 104, 106, 107, 111, 108, 109, 110, 112], 'stacked: the second swap is made on the first one’s board');
  // The same pick again: team 1 at pick 1 now takes 112 instead.
  const again = R.whatIfOrder(picks, [{ overall: 1, playerId: 105 }, { overall: 1, playerId: 112 }]);
  eq(men(again), [112, 105, 101, 102, 103, 104, 106, 107, 108, 109, 110, 111], 'stacked: the same pick changed again shifts the board again');
  // Undo = the list without its last swap; back to normal = no swaps.
  eq(men(R.whatIfOrder(picks, [{ overall: 1, playerId: 105 }])), men(one), 'undo: dropping the last swap gives the board before it');
  eq(men(R.whatIfOrder(picks, [])), REAL, 'reset: no swaps is the real draft again');

  // A swap whose man is no longer later on the board is not made.
  eq(R.whatIfApplied(picks, [{ overall: 1, playerId: 105 }, { overall: 3, playerId: 105 }, { overall: 5, playerId: 999 }]),
    [{ overall: 1, playerId: 105 }], 'applied: a man above the pick, or unknown, is skipped');
  eq(men(R.whatIfOrder(picks, [{ overall: 1, playerId: 105 }, { overall: 3, playerId: 105 }])), men(one), 'applied: and the board ignores it too');

  // Candidates: everyone after the pick, on the board as it stands.
  eq(men(R.whatIfCandidates(R.whatIfOrder(picks, []), 9)), [110, 111, 112], 'candidates: the men drafted after pick 9');
  eq(men(R.whatIfCandidates(one, 4)), [104, 106, 107, 108, 109, 110, 111, 112], 'candidates: on the what-if board, after its pick 4');
  eq(R.whatIfCandidates(one, 99), [], 'candidates: no such pick, none');

  // The changes each team makes.
  const ch = R.whatIfChanges(picks, one);
  eq([...ch.keys()], [1, 2, 3, 4], 'changes: every team owning a slot from 1 to 5');
  eq(ch.get(1), [{ overall: 1, out: 101, in: 105 }], 'changes: team 1 swaps 101 for 105');
  eq(ch.get(4), [{ overall: 4, out: 104, in: 103 }, { overall: 5, out: 105, in: 104 }], 'changes: team 4 loses 104 and 105, gets 103 and 104');
  eq(R.whatIfChanges(picks, R.whatIfOrder(picks, [])).size, 0, 'changes: none without a swap');

  // perfectOrder still makes the same shift through the shared helper.
  const pf = R.perfectOrder(picks, (id) => (id === 105 ? 99 : 1), 1);
  eq(men(pf).slice(0, 5), [105, 101, 102, 103, 104], 'perfect draft: the same shift through shiftUp');
}

// ------------------------------------------------------------- the season
// Positions and ESPN's projection / what he scored, the same both weeks:
const POS = { 101: 'RB', 102: 'RB', 103: 'WR', 104: 'WR', 105: 'RB', 106: 'WR', 107: 'RB', 108: 'WR', 109: 'RB', 110: 'WR', 111: 'RB', 112: 'WR' };
const PROJ = { 101: 15, 102: 14, 103: 13, 104: 12, 105: 11, 106: 10, 107: 9, 108: 8, 109: 7, 110: 6, 111: 5, 112: 4 };
const ACT = { 101: 10, 102: 20, 103: 8, 104: 12, 105: 25, 106: 5, 107: 9, 108: 18, 109: 30, 110: 6, 111: 4, 112: 3 };
const SLOTS = [2, 4];   // one RB, one WR
const squad = (ids, final) => ids.map((id) => ({
  playerId: id, position: POS[id], lineupSlotId: 20, projected: PROJ[id], actual: final ? ACT[id] : null,
}));
const DRAFTED = { 1: [101, 108, 109], 2: [102, 107, 110], 3: [103, 106, 111], 4: [104, 105, 112] };
const week = (final, edit = (x) => x) => [1, 2, 3, 4].map((id) => ({ id, players: squad(edit(DRAFTED[id].slice(), id), final) }));
const rosters = new Map([[1, week(true)], [2, week(true)], [3, week(false)], [4, week(false)]]);
const manOf = (id) => ({
  position: POS[id],
  byWeek: Object.fromEntries([1, 2, 3, 4].map((w) => [w, { proj: PROJ[id], act: w <= 2 ? ACT[id] : null, counts: w <= 2 ? ACT[id] : PROJ[id], done: w <= 2 }])),
});
// Real scores (the managers' own lineups): week 1 T1 40 v T2 30, T3 25 v T4 35;
// week 2 T1 20 v T3 30, T2 22 v T4 40; week 3 still to come, T1 v T4, T2 v T3.
const games = [
  { week: 1, homeId: 1, awayId: 2, homeScore: 40, awayScore: 30, final: true },
  { week: 1, homeId: 3, awayId: 4, homeScore: 25, awayScore: 35, final: true },
  { week: 2, homeId: 1, awayId: 3, homeScore: 20, awayScore: 30, final: true },
  { week: 2, homeId: 2, awayId: 4, homeScore: 22, awayScore: 40, final: true },
  { week: 3, homeId: 1, awayId: 4, homeScore: 0, awayScore: 0, final: false },
  { week: 3, homeId: 2, awayId: 3, homeScore: 0, awayScore: 0, final: false },
];
const base = { teamIds: [1, 2, 3, 4], games, rosters, slots: SLOTS, manOf };
const team = (s, id) => s.teams.find((t) => t.teamId === id);
const rec = (x) => `${x.w}-${x.l}${x.t ? `-${x.t}` : ''}`;

{
  // NO SWAP: the what-if season IS the real one.
  const s = R.whatIfSeason({ ...base, changes: new Map() });
  eq(s.teams.map((t) => rec(t.whatIf)), ['1-1', '0-2', '1-1', '2-0'], 'no swap: the real records');
  eq(s.teams.map((t) => [t.whatIf.pf, t.whatIf.pa]), [[60, 60], [52, 80], [55, 55], [75, 47]], 'no swap: real points for and against');
  eq(s.teams.map((t) => JSON.stringify(t.whatIf) === JSON.stringify(t.real)), [true, true, true, true], 'no swap: every figure equals the real one');
  eq(s.teams.map((t) => t.real.rank), [2, 4, 3, 1], 'no swap: ranks by record, then points for (T1 and T3 are 1-1: 60 > 55)');
  eq(s.changed.size, 0, 'no swap: no team changed');
  eq(s.left, 2, 'two games still to come');
}

{
  // Team 1 takes 105 at pick 1. Week 1 and 2 lineups (best by projection, one RB + one WR):
  //   T1 real 101+108 = 10+18 = 28; what-if 105+108 = 25+18 = 43     -> +15
  //   T2 real 102+110 = 20+6  = 26; what-if 101+110 = 10+6  = 16     -> −10
  //   T3 real 111+103 = 4+8   = 12; what-if 102+106 = 20+5  = 25     -> +13
  //   T4 real 105+104 = 25+12 = 37; what-if no RB, 103 = 8           -> −29
  const order = R.whatIfOrder(picks, [{ overall: 1, playerId: 105 }]);
  const s = R.whatIfSeason({ ...base, changes: R.whatIfChanges(picks, order) });
  const w1 = (id) => team(s, id).weeks.find((w) => w.week === 1);
  eq([1, 2, 3, 4].map((id) => w1(id).delta), [15, -10, 13, -29], 'season: week 1’s change to each lineup, by hand');
  eq([1, 2, 3, 4].map((id) => w1(id).whatIf.pts), [55, 20, 38, 6], 'season: week 1 what-if score = real score + the change');
  eq([w1(1).whatIf.res, w1(3).whatIf.res, w1(4).real.res], ['W', 'W', 'W'], 'season: T1 still beats T2; T3 now beats T4 (real: T4 won)');
  // Week 2: T1 20+15 = 35 v T3 30+13 = 43; T2 22−10 = 12 v T4 40−29 = 11.
  eq(s.teams.map((t) => rec(t.whatIf)), ['1-1', '1-1', '2-0', '0-2'], 'season: what-if records');
  eq(s.teams.map((t) => rec(t.real)), ['1-1', '0-2', '1-1', '2-0'], 'season: the real records beside them');
  eq(s.teams.map((t) => [t.whatIf.pf, t.whatIf.pa]), [[90, 63], [32, 66], [81, 41], [17, 50]], 'season: what-if points for and against');
  eq(s.teams.map((t) => t.whatIf.rank), [2, 3, 1, 4], 'season: what-if ranks (T1 and T2 1-1: 90 > 32)');
  eq(s.teams.map((t) => t.whatIf.avg), [45, 16, 40.5, 8.5], 'season: average a played week');
  eq([team(s, 1).whatIf.best, team(s, 1).whatIf.worst], [{ week: 1, pts: 55 }, { week: 2, pts: 35 }], 'season: best and worst week');
  eq(w1(1).ins, [{ playerId: 105, act: 25, proj: 11, start: true }], 'season: the man swapped in, what he scored, and that he started');
  eq(w1(1).outs, [{ playerId: 101, act: 10, proj: 15, start: true }], 'season: the man swapped out, what he scored, and that he started');
  eq(w1(4).ins.map((p) => [p.playerId, p.start]), [[103, true], [104, false]], 'season: T4’s men in (104 is both out and in: he only sits now)');
  // Week 3 is to come: projections only, best lineup each way. T1 real 101+108 = 23, what-if 105+108 = 19.
  const w3 = team(s, 1).weeks.find((w) => w.week === 3);
  eq([w3.final, w3.real.pts, w3.whatIf.pts, w3.whatIf.res], [false, 23, 19, null], 'season: a week to come is projected, not a result');
  eq(team(s, 1).whatIf.games, 2, 'season: only played weeks make the record');
  eq([...s.changed].sort(), ['1', '2', '3', '4'], 'season: all four teams changed');
}

{
  // THE PLAYOFF CHANCE: the site's simulation, both ways, same spread and seed.
  const PO = { teams: 2, weeks: [4] };
  const none = R.whatIfSeason({ ...base, changes: new Map(), playoff: PO, sigma: 20, runs: 2000 });
  ok(none.simulated, 'sim: ran');
  eq(none.teams.map((t) => t.whatIf.pPlayoffs), none.teams.map((t) => t.real.pPlayoffs), 'sim: no swap gives the real chance to the last digit');
  near(none.teams.reduce((a, t) => a + t.real.pPlayoffs, 0), 2, 'sim: two places, shared out', 1e-9);
  const order = R.whatIfOrder(picks, [{ overall: 1, playerId: 105 }]);
  const s = R.whatIfSeason({ ...base, changes: R.whatIfChanges(picks, order), playoff: PO, sigma: 20, runs: 2000 });
  ok(team(s, 3).whatIf.pPlayoffs > team(s, 3).real.pPlayoffs, 'sim: 2-0 T3 is likelier in after the swap', `${team(s, 3).real.pPlayoffs} -> ${team(s, 3).whatIf.pPlayoffs}`);
  ok(team(s, 4).whatIf.pPlayoffs < team(s, 4).real.pPlayoffs, 'sim: 0-2 T4 is less likely in', `${team(s, 4).real.pPlayoffs} -> ${team(s, 4).whatIf.pPlayoffs}`);
  const off = R.whatIfSeason({ ...base, changes: new Map(), playoff: PO, sigma: null });
  eq([off.simulated, team(off, 1).whatIf.pPlayoffs], [false, null], 'sim: no spread, no chance (a dash, not a guess)');
}

{
  // THE ROSTER RULE: a swap only in weeks the team still holds its man, and only when the new man is free.
  const changes = R.whatIfChanges(picks, R.whatIfOrder(picks, [{ overall: 1, playerId: 105 }]));
  const real = week(true);
  const on = R.whatIfWeekSwaps(real, changes);
  eq([...on.keys()], [1, 2, 3, 4], 'roster: every swap on when every team still holds its man');
  // T1 dropped 101 that week: its own swap is off; 101 is then on nobody's squad, so T2 still gets him.
  const dropped = real.map((t) => (t.id === 1 ? { ...t, players: t.players.filter((p) => p.playerId !== 101) } : t));
  const d = R.whatIfWeekSwaps(dropped, changes);
  eq([d.has(1), d.has(2), d.has(3), d.has(4)], [false, true, true, true], 'roster: T1 no longer holds 101 → its swap is off that week; 101 is free, so T2 gets him');
  // 105 traded from T4 to T2 that week: T1’s new man is on a squad that keeps him → T1 off,
  // so 101 stays on T1 → T2 (new man 101) off → T3 (new man 102) off → T4's 103 off; T4 no longer holds 105.
  const traded = real.map((t) => (t.id === 4 ? { ...t, players: t.players.filter((p) => p.playerId !== 105) }
    : t.id === 2 ? { ...t, players: [...t.players, ...squad([105], true)] } : t));
  eq(R.whatIfWeekSwaps(traded, changes).size, 0, 'roster: a traded man takes the whole chain with him — nobody plays for two teams');
  // And the season with T1 having dropped 101 in week 2: T1's week 2 is its real 20.
  const rs = new Map(rosters);
  rs.set(2, dropped.map((t) => ({ ...t })));
  const s = R.whatIfSeason({ ...base, rosters: rs, changes });
  eq(team(s, 1).weeks.find((w) => w.week === 2).whatIf.pts, 20, 'roster: a week the swap is off scores the real score');
}

// --------------------------------------------- the sample league, real size
{
  const data = capture.normalizeSchedule(demo.generateDemoSchedule(), { isDemo: true });
  const weeks = [...data.weeks, ...capture.playoffWeeks(data)];
  const rs = new Map(weeks.map((w) => [w, demo.generateDemoWeekRosters(w).teams]));
  const first = rs.get(weeks[0]);
  const slots = R.slotsFromLineups(first);
  const draft = R.sampleDraft(first, slots);
  eq([draft.picks.length, data.teams.length, data.weeks.length], [160, 10, 13], 'sample: 160 picks, 10 teams, 13 weeks');
  // Every drafted man's weeks off the squads (what the page's `assemble` does).
  const byWeek = new Map();
  for (const w of weeks) for (const t of rs.get(w)) for (const p of t.players) {
    if (!byWeek.has(p.playerId)) byWeek.set(p.playerId, { position: p.position, byWeek: {} });
    const done = w <= 13;
    byWeek.get(p.playerId).byWeek[w] = { proj: p.projected, act: done ? p.actual : null, counts: done ? p.actual : p.projected, done };
  }
  const g = data.games.map((x) => ({ ...x, final: capture.gameState(x) === 'final' }));
  const args = { teamIds: data.teams.map((t) => t.id), games: g, rosters: rs, slots, manOf: (id) => byWeek.get(id) || null };
  const none = R.whatIfSeason({ ...args, changes: new Map() });
  const realRec = new Map(data.teams.map((t) => [t.id, { w: 0, l: 0 }]));
  for (const x of data.games) {
    const win = capture.winnerOf(x);
    realRec.get(x.homeId)[win === 'home' ? 'w' : 'l']++;
    realRec.get(x.awayId)[win === 'away' ? 'w' : 'l']++;
  }
  eq(none.teams.map((t) => `${t.whatIf.w}-${t.whatIf.l}`), data.teams.map((t) => `${realRec.get(t.id).w}-${realRec.get(t.id).l}`),
    'sample: no swap = ESPN’s records, every team');

  // Team at pick 3 takes the man at pick 40.
  const at = draft.picks[2];
  const want = draft.picks[39].playerId;
  const order = R.whatIfOrder(draft.picks, [{ overall: 3, playerId: want }]);
  eq([order[2].playerId, order[3].playerId, order[39].playerId], [want, at.playerId, draft.picks[38].playerId], 'sample: the man at 40 to pick 3, 3-39 one later');
  const s = R.whatIfSeason({ ...args, changes: R.whatIfChanges(draft.picks, order) });
  let sumOk = true;
  let twice = 0;
  for (const t of s.teams) {
    const pf = t.weeks.filter((w) => w.final).reduce((a, w) => a + w.whatIf.pts, 0);
    if (Math.abs(pf - t.whatIf.pf) > 1e-6) sumOk = false;
    for (const w of t.weeks) if (w.final && Math.abs(w.whatIf.pts - w.real.pts - w.delta) > 1e-9) sumOk = false;
  }
  for (const w of data.weeks) {
    const on = R.whatIfWeekSwaps(rs.get(w), R.whatIfChanges(draft.picks, order));
    const seen = new Map();
    for (const t of rs.get(w)) for (const p of t.players) seen.set(p.playerId, (seen.get(p.playerId) || 0) + 1);
    for (const [, list] of on) for (const c of list) { seen.set(c.out, seen.get(c.out) - 1); seen.set(c.in, (seen.get(c.in) || 0) + 1); }
    twice += [...seen.values()].filter((n) => n > 1).length;
  }
  ok(sumOk, 'sample: each team’s points for = its weeks added up, and each week = real + change');
  eq(twice, 0, 'sample: no man on two squads in any week');
  const wins = s.teams.reduce((a, t) => a + t.whatIf.w + t.whatIf.t / 2, 0);
  eq(wins, data.games.length, 'sample: one win a game, what-if as real');
  ok(s.changed.size >= 2, 'sample: the swap changed several teams', s.changed.size);
}

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
