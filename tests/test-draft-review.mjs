// Checks js/draft-review.js — the draft looked back on: where each man went,
// what he is worth now, and the difference.
//
//   node test-draft-review.mjs
//
// Two kinds of input:
//   - THE REAL LEAGUE (fixtures/draft-1241838-2026.json is ESPN's mDraftDetail
//     payload as sent; fixtures/draft-players-1241838-2026.json is every one of
//     its 170 men, week by week, as kona_player_info sent them on 2026-10-08).
//     An auction with keepers: weeks 1-4 final, 5-17 projected.
//   - hand-made leagues small enough that every bar, rank and difference below
//     is written out by hand.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HERE, moduleUrl } from './repo.mjs';

const R = await import(moduleUrl('js/draft-review.js'));
const { slotsFromCounts } = await import(moduleUrl('js/forecast.js'));
const demo = await import(moduleUrl('js/demo-rosters.js'));

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, name, tol = 1e-9) => ok(typeof a === 'number' && Math.abs(a - b) <= tol, name, `got ${a}, want ${b}`);

const RAW = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-1241838-2026.json'), 'utf8'));
const FX = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-players-1241838-2026.json'), 'utf8'));

// ------------------------------------------------------- the real draft payload
const draft = R.parseDraft(RAW);
{
  eq(draft.type, 'auction', 'real: an auction');
  eq(draft.done, true, 'real: the draft is over');
  eq(draft.picks.length, 170, 'real: 170 picks');
  eq(draft.order, [3, 10, 9, 1, 2, 8, 7, 4, 6, 5], 'real: the teams in ESPN’s pickOrder');
  eq(draft.picks[0], { overall: 1, round: 1, roundPick: 1, teamId: 1, playerId: 4685382, bid: 28, keeper: true }, 'real: pick 1 as sent');
  eq(draft.picks[169], { overall: 170, round: 17, roundPick: 10, teamId: 6, playerId: 4360689, bid: 1, keeper: false }, 'real: pick 170 as sent');
  ok(draft.picks.every((p, i) => p.overall === i + 1), 'real: in pick order');
  eq(draft.picks.filter((p) => p.keeper).length, 6, 'real: six keepers');
  const perTeam = {};
  for (const p of draft.picks) perTeam[p.teamId] = (perTeam[p.teamId] || 0) + 1;
  eq(Object.values(perTeam), Array(10).fill(17), 'real: seventeen a team');
  eq(new Set(draft.picks.map((p) => p.playerId)).size, 170, 'real: nobody twice');
}

// ----------------------------------------------------------- a snake, by hand
// Four teams, three rounds, ESPN's own field names. Pick 12 has not been made.
const snakeRaw = {
  settings: { draftSettings: { type: 'SNAKE', pickOrder: [4, 2, 1, 3] } },
  draftDetail: {
    drafted: false, inProgress: true,
    picks: [4, 2, 1, 3, 3, 1, 2, 4, 4, 2, 1, 3].map((teamId, i) => ({
      id: i + 1, overallPickNumber: i + 1, roundId: Math.floor(i / 4) + 1, roundPickNumber: (i % 4) + 1,
      teamId, playerId: i === 11 ? 0 : 100 + i, bidAmount: 0, keeper: false, lineupSlotId: 20,
    })).reverse(), // sent out of order, to see them sorted
  },
};
const snake = R.parseDraft(snakeRaw);
{
  eq(snake.type, 'snake', 'snake: read as a snake');
  eq(snake.done, false, 'snake: not over');
  eq(snake.picks.length, 11, 'snake: the pick not made yet is left out');
  eq(snake.picks.map((p) => p.overall), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'snake: sorted by pick');
  eq(snake.order, [4, 2, 1, 3], 'snake: the teams in round-one order');
  eq(snake.picks[4], { overall: 5, round: 2, roundPick: 1, teamId: 3, playerId: 104, bid: null, keeper: false }, 'snake: a pick has no price');
  eq(R.parseDraft({ draftDetail: { picks: [{ overallPickNumber: 1, teamId: 1, playerId: 5, bidAmount: 12 }] } }).type, 'auction', 'no settings: a price means an auction');
  eq(R.parseDraft(null), { type: 'snake', done: false, order: [], picks: [] }, 'nothing sent: an empty draft');
  eq(R.parseDraft({ draftDetail: { drafted: false, picks: [] } }).picks, [], 'not drafted yet: no picks');
}

// ------------------------------------------------------------------ drafted at
{
  const at = R.draftedAt(snake.picks, 'snake');
  eq([...at.values()], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'snake: drafted at his overall pick');

  // An auction by hand: 30, 20, 20, 5, 1, 1, 1 -> 1, then 2-3 share 3 (2.5 rounded), 4, then 5-7 share 6.
  const bids = [1, 20, 30, 1, 5, 20, 1];
  const hand = bids.map((bid, i) => ({ overall: i + 1, teamId: 1, playerId: 10 + i, bid }));
  const a = R.draftedAt(hand, 'auction');
  eq(hand.map((p) => a.get(p.playerId)), [6, 3, 1, 6, 4, 3, 6], 'auction: his price’s rank, ties at the middle of their places');

  const real = R.draftedAt(draft.picks, 'auction');
  const dollar = draft.picks.filter((p) => p.bid === 1);
  eq(dollar.length, 57, 'real: 57 men cost a dollar');
  ok(dollar.every((p) => real.get(p.playerId) === 142), 'real: and share place 142 (the middle of 114-170)');
  const top = draft.picks.slice().sort((x, y) => y.bid - x.bid)[0];
  eq(real.get(top.playerId), 1, 'real: the dearest man is 1');
}

// ------------------------------------------------------------------- the board
{
  const b = R.boardOf(snake);
  eq(b.teamIds, [4, 2, 1, 3], 'board: a column a team, in round-one order');
  eq(b.rows.map((row) => row.map((p) => (p ? p.overall : null))),
    [[1, 2, 3, 4], [8, 7, 6, 5], [9, 10, 11, null]], 'board: a snake’s row is its round, and a pick not made is a gap');

  const rb = R.boardOf(draft);
  eq(rb.teamIds, draft.order, 'real board: ESPN’s order');
  eq(rb.rows.length, 17, 'real board: seventeen rows');
  eq(rb.rows.flat().filter(Boolean).length, 170, 'real board: every pick placed');
  eq(new Set(rb.rows.flat().map((p) => p.playerId)).size, 170, 'real board: each once');
  ok(rb.teamIds.every((id, c) => rb.rows.every((row) => row[c].teamId === id)), 'real board: each man in his team’s column');
  ok(rb.teamIds.every((_, c) => rb.rows.every((row, r) => r === 0 || rb.rows[r - 1][c].bid >= row[c].bid)),
    'real board: an auction’s column runs dearest first');
}

// -------------------------------------------------------------- a man's season
{
  const weeks = [1, 2, 3, 4, 5];
  const s = R.seasonOf({
    1: { counts: 10.5, done: true }, 2: { counts: 0, done: true }, 3: { counts: 7.25, done: true },
    4: { counts: 12, done: false }, 5: { counts: null, done: false },
  }, weeks);
  eq(s, { soFar: 17.75, rest: 12, total: 29.75 }, 'season: finished weeks so far, the rest projected, a week with no number counts nothing');
  eq(R.seasonOf({}, weeks), { soFar: 0, rest: 0, total: 0 }, 'season: a man with no weeks is nothing');
  eq(R.seasonOf({ 9: { counts: 50, done: true } }, weeks), { soFar: 0, rest: 0, total: 0 }, 'season: a week outside the season is not counted');
}

// --------------------------------------------------------------------- the bar
const man = (playerId, position, total, lineupSlotId = 20) => ({ playerId, position, total, lineupSlotId, started: lineupSlotId !== 20 && lineupSlotId !== 21 });
{
  eq(R.slotsFromLineups([
    { players: [man(1, 'QB', 0, 0), man(2, 'RB', 0, 2), man(3, 'RB', 0, 2), man(4, 'WR', 0, 23), man(5, 'WR', 0, 20)] },
    { players: [man(6, 'QB', 0, 0), man(7, 'RB', 0, 2), man(8, 'K', 0, 17), man(9, 'TE', 0, 21)] },
  ]), [0, 2, 2, 17, 23], 'slots: the most of each slot any team starts; bench and IR are not slots');

  // TWO TEAMS, each starting QB, RB, RB, FLEX. The league starts 2 QB and 6 of RB/WR.
  //   QB  400 380 | 300 250 200        backups 300 250 200 -> middle 250, best 300
  //   RB  300 280 260 240 | 100 90     backups 100 90      -> the better of two: 100
  //   WR  270 250 | 200 150 120 60     (two WRs take the flex spots: 270 and 250 beat RB 240? no —
  //                                     the six RB/WR places go to 300 280 270 260 250 240)
  //   K   130                          nobody starts one: every K is a backup -> bar 130
  const pool = [
    ...[400, 380, 300, 250, 200].map((t, i) => man(100 + i, 'QB', t)),
    ...[300, 280, 260, 240, 100, 90].map((t, i) => man(200 + i, 'RB', t)),
    ...[270, 250, 200, 150, 120, 60].map((t, i) => man(300 + i, 'WR', t)),
    man(400, 'K', 130),
  ];
  const bars = R.leagueBars(pool, [0, 2, 2, 23], 2);
  eq(bars.get('QB'), { bar: 250, starterBar: 300, starters: 2, backups: 3 }, 'bars: QB — two start, the middle of three backups');
  eq(bars.get('RB'), { bar: 100, starterBar: 100, starters: 4, backups: 2 }, 'bars: RB — four start (two in the flex), the better of two backups');
  eq(bars.get('WR'), { bar: 150, starterBar: 200, starters: 2, backups: 4 }, 'bars: WR — two start in the flex, the upper middle of four backups');
  eq(bars.get('K'), { bar: 130, starterBar: 130, starters: 0, backups: 1 }, 'bars: K — no slot, so the one kicker is the bar');
  // Everybody at a position starting: the worst starter is the bar, as in js/trade.js.
  eq(R.leagueBars([man(1, 'QB', 300), man(2, 'QB', 250)], [0], 2).get('QB'),
    { bar: 250, starterBar: 250, starters: 2, backups: 0 }, 'bars: no backup at all — the worst starter');
  eq(R.leagueBars([man(1, 'QB', null), man(2, '', 5)], [0], 1).size, 0, 'bars: a man with no number or no position is not in the pool');
}

// ---------------------------------------------------- the review, all by hand
// Two teams, a three-round snake (1 2 | 2 1 | 1 2), lineup QB, RB, FLEX.
//   pick  team  man          total   bar    value   now   diff
//    1     1    QB Alpha      380    300     +80     2     −1
//    2     2    RB Bravo      300    100    +200     1     +1
//    3     2    QB Charlie    400    300    +100  -> wait: see below
// Written out properly:
//   QBs 400 380 300(backup)        2 start -> one backup -> bar 300
//   RBs 300 150 100(backup)        2 start + flex... the league starts 2 RB and 2 FLEX of RB/WR:
//                                  RB/WR places = 4 -> RB 300, WR 200, RB 150, WR 120 start
//   WRs 200 120                    both start in the flex -> no backup -> bar 120 (worst starter)
//   RB backup 100 -> bar 100
{
  const picks = [
    [1, 1, 11], [2, 2, 12], [3, 2, 13], [4, 1, 14], [5, 1, 15], [6, 2, 16], [7, 2, 17], [8, 1, 18],
  ].map(([overall, teamId, playerId]) => ({ overall, round: Math.ceil(overall / 2), roundPick: 2 - (overall % 2), teamId, playerId, bid: null, keeper: false }));
  const d = { type: 'snake', done: true, order: [1, 2], picks };
  const P = (name, position, soFar, rest) => ({ name, position, soFar, rest, total: soFar + rest });
  const players = new Map([
    [11, P('QB Alpha', 'QB', 100, 280)],    // 380  value  +80
    [12, P('RB Bravo', 'RB', 90, 210)],     // 300  value +200
    [13, P('QB Charlie', 'QB', 120, 280)],  // 400  value +100
    [14, P('WR Delta', 'WR', 50, 150)],     // 200  value  +80  (level with Alpha: fewer points, so behind him)
    [15, P('RB Echo', 'RB', 0, 100)],       // 100  value    0
    [16, P('QB Foxtrot', 'QB', 60, 240)],   // 300  value    0  (level with Echo: more points, so ahead)
    [17, P('RB Golf', 'RB', 40, 110)],      // 150  value  +50
    [18, P('WR Hotel', 'WR', 20, 100)],     // 120  value    0  (level too: 120 points, between them)
  ]);
  const rv = R.reviewDraft({ draft: d, players, slots: [0, 2, 23], teams: 2 });
  eq([...rv.bars].map(([pos, b]) => [pos, b.bar]).sort(), [['QB', 300], ['RB', 100], ['WR', 120]], 'review: the three bars');
  const by = (id) => rv.rows.find((r) => r.playerId === id);
  eq(rv.rows.map((r) => r.value), [80, 200, 100, 80, 0, 0, 50, 0], 'review: value = total − the bar at his position');
  eq(rv.rows.map((r) => r.now), [3, 1, 2, 4, 8, 6, 5, 7], 'review: worth now — by value, then points, then the earlier pick');
  eq(rv.rows.map((r) => r.diff), [-2, 1, 1, 0, -3, 0, 2, 1], 'review: difference = drafted at − worth now');
  eq(rv.rows.reduce((a, r) => a + r.diff, 0), 0, 'review: in a snake the differences cancel');
  ok(by(13).total > by(12).total && by(12).now < by(13).now, 'review: the QB has more points and the RB is still worth more');
  eq(rv.ranked, 8, 'review: all eight have a place');
  eq([by(11).soFar, by(11).rest, by(11).name, by(11).position], [100, 280, 'QB Alpha', 'QB'], 'review: his parts ride along');

  // Against the best backup instead (js/trade.js's bar): QB 300, RB 100, WR 120 here too,
  // because no position has more than one backup — so nothing moves.
  eq(R.reviewDraft({ draft: d, players, slots: [0, 2, 23], teams: 2, against: 'starterBar' }).rows.map((r) => r.now),
    [3, 1, 2, 4, 8, 6, 5, 7], 'review: with one backup a position the two bars agree');

  // A MAN NOBODY COULD READ: no place and no difference, and the rest still ranked.
  const fewer = new Map(players);
  fewer.delete(12);
  const rv2 = R.reviewDraft({ draft: d, players: fewer, slots: [0, 2, 23], teams: 2 });
  const gone = rv2.rows.find((r) => r.playerId === 12);
  eq([gone.total, gone.value, gone.now, gone.diff, gone.name], [null, null, null, null, ''], 'missing man: no numbers at all');
  eq(rv2.ranked, 7, 'missing man: seven have a place');
  eq(rv2.rows.filter((r) => r.now !== null).map((r) => r.now).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7], 'missing man: the others fill 1-7');

  // ONE TEAM'S REVIEW.
  const t1 = R.teamReview(rv.rows, 1);
  eq(t1.picks.map((r) => r.playerId), [11, 14, 15, 18], 'team: its picks, in pick order');
  eq([t1.steal && t1.steal.playerId, t1.miss && t1.miss.playerId], [18, 15], 'team 1: best steal Hotel (+1), biggest miss Echo (−3)');
  const t2 = R.teamReview(rv.rows, '2');
  eq([t2.steal && t2.steal.playerId, t2.miss], [17, null], 'team 2: best steal Golf (+2), and no miss at all (a team id may arrive as text)');
  eq(R.teamReview(rv2.rows, 2).picks.length, 4, 'team: a man with no numbers is still one of its picks');
}

// -------------------------------------------------- the review, the real league
{
  const starters = Object.fromEntries(Object.entries(FX.lineupSlotCounts).filter(([slot, n]) => n > 0 && slot !== '20' && slot !== '21'));
  const slots = slotsFromCounts(starters);
  eq(slots, [0, 2, 2, 4, 4, 4, 6, 16, 17, 23], 'real: the league starts QB, 2 RB, 3 WR, TE, D/ST, K, FLEX');
  const finished = new Set(FX.finished);
  const players = new Map();
  for (const [id, p] of Object.entries(FX.players)) {
    const byWeek = {};
    for (const w of FX.weeks) {
      const [proj, act] = p.weeks[w] || [null, null];
      byWeek[w] = finished.has(w) ? { counts: act ?? 0, done: true } : { counts: proj ?? 0, done: false };
    }
    players.set(Number(id), { name: p.name, position: p.position, ...R.seasonOf(byWeek, FX.weeks) });
  }
  eq(players.size, 170, 'real: all 170 men have weeks');

  const rv = R.reviewDraft({ draft, players, slots });
  eq(rv.ranked, 170, 'real: all 170 ranked');
  eq(rv.rows.map((r) => r.now).sort((a, b) => a - b), Array.from({ length: 170 }, (_, i) => i + 1), 'real: worth now is every place from 1 to 170, once');
  ok(rv.rows.every((r) => r.diff === r.at - r.now), 'real: every difference is drafted at − worth now');
  const named = (name) => rv.rows.find((r) => r.name === name);

  // Read off tests/_measure output on 2026-10-08, and each checkable by hand from the fixture.
  const hub = named('Chuba Hubbard');
  eq([hub.bid, hub.at, hub.now, hub.diff], [1, 142, 17, 125], 'real: Hubbard cost $1 (place 142), worth 17th now: +125, the steal of the draft');
  near(hub.soFar + hub.rest, hub.total, 'real: his points so far and his projected rest are his total');
  near(hub.total, 235.33, 'real: Hubbard’s season stands at 235.3', 0.006);
  const ach = named("De'Von Achane");
  eq([ach.bid, ach.at, ach.now, ach.diff], [44, 11, 162, -151], 'real: Achane cost $44 (11th dearest), worth 162nd now: −151, the miss of the draft');
  eq(Math.max(...rv.rows.map((r) => r.diff)), 125, 'real: nobody beats +125');
  eq(Math.min(...rv.rows.map((r) => r.diff)), -151, 'real: nobody is under −151');

  const bar = (pos) => Math.round(rv.bars.get(pos).bar);
  eq(['QB', 'RB', 'WR', 'TE', 'DST', 'K'].map(bar), [223, 104, 114, 120, 70, 131], 'real: the six bars, in points');
  eq(['QB', 'RB', 'WR', 'TE', 'DST', 'K'].map((pos) => rv.bars.get(pos).starters), [10, 27, 30, 13, 10, 10], 'real: who starts — 100 places, the flex going to 7 RB, 0 WR… as the points fall');

  // FAIR ACROSS POSITIONS. On raw points half the top ten are quarterbacks;
  // by value it is not, and a quarterback is a steal no more often than not.
  const byTotal = rv.rows.slice().sort((a, b) => b.total - a.total).slice(0, 10);
  const byNow = rv.rows.slice().sort((a, b) => a.now - b.now).slice(0, 10);
  eq(byTotal.filter((r) => r.position === 'QB').length, 5, 'real: five of the ten biggest totals are quarterbacks');
  eq(byNow.filter((r) => r.position === 'QB').length, 0, 'real: none of the ten most valuable men is');
  const qbs = rv.rows.filter((r) => r.position === 'QB');
  eq([qbs.length, qbs.filter((r) => r.diff > 0).length], [19, 10], 'real: 10 of the 19 quarterbacks are steals, not all of them');

  // THE KICKER PROBLEM, measured — why the bar is the middle backup.
  const top20 = (rows) => rows.slice().sort((a, b) => b.diff - a.diff).slice(0, 20);
  const kd = (rows) => rows.filter((r) => r.position === 'K' || r.position === 'DST').length;
  eq(kd(top20(rv.rows)), 2, 'real: 2 of the 20 biggest steals are a kicker or a defence');
  const strict = R.reviewDraft({ draft, players, slots, against: 'starterBar' });
  eq(kd(top20(strict.rows)), 8, 'real: against the best backup it would be 8 of 20');

  const t8 = R.teamReview(rv.rows, 8);
  eq(t8.picks.length, 17, 'real: team 8 made seventeen picks');
  ok(t8.steal && t8.miss && t8.steal.diff === Math.max(...t8.picks.map((r) => r.diff)) &&
    t8.miss.diff === Math.min(...t8.picks.map((r) => r.diff)), 'real: its best steal and biggest miss are its extremes');
}

// ------------------------------------------------------------ the sample draft
{
  const teams = demo.generateDemoWeekRosters(1).teams;
  const slots = R.slotsFromLineups(teams);
  eq(slots, [0, 2, 2, 4, 4, 6, 16, 17, 23], 'sample: the sample league’s lineup, off its lineups');
  const d = R.sampleDraft(teams, slots);
  const n = teams.length;
  const size = teams[0].players.length;
  eq([d.type, d.done, d.picks.length], ['snake', true, n * size], 'sample: a finished snake, every man drafted');
  eq(d.order, teams.map((t) => t.id), 'sample: in the order the teams are listed');
  eq(new Set(d.picks.map((p) => p.playerId)).size, n * size, 'sample: nobody twice');
  eq(d.picks.slice(0, n).map((p) => p.teamId), teams.map((t) => t.id), 'sample: round one runs down the list');
  eq(d.picks.slice(n, 2 * n).map((p) => p.teamId), teams.map((t) => t.id).reverse(), 'sample: round two runs back up it');
  ok(d.picks.every((p, i) => p.overall === i + 1 && p.round === Math.floor(i / n) + 1), 'sample: picks and rounds number themselves');
  const own = new Map(teams.flatMap((t) => t.players.map((p) => [p.playerId, t.id])));
  ok(d.picks.every((p) => own.get(p.playerId) === p.teamId), 'sample: each team drafts its own men');
  const b = R.boardOf(d);
  ok(b.rows.every((row, r) => row.every((p) => p && p.round === r + 1)), 'sample board: row r is round r');
}

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
