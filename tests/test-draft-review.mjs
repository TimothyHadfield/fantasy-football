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

// ------------------------------------------------- against the preseason rank
// Tim, 2026-10-08: "if Jahmar gibbs was drafted 5th, then his number should
// show +4, because he was ranked #1 at the start of the season. If a player was
// drafted earlier than they were ranked then put it negative (-)".
{
  const pk = (overall, playerId) => ({ overall, round: 1, roundPick: overall, teamId: overall, playerId, bid: null, keeper: false });
  // Five picks. ESPN's ranks: the fifth man taken is its 1; the first is its 3;
  // the third is a defence ESPN has 520th; the fourth it never ranked.
  const d = { type: 'snake', done: true, order: [1, 2, 3, 4, 5], picks: [pk(1, 11), pk(2, 12), pk(3, 13), pk(4, 14), pk(5, 15)] };
  const ranks = { 11: 3, 12: 2, 13: 520, 14: 0, 15: 1 };
  const places = R.preseasonPlaces(d.picks, ranks);
  eq([15, 12, 11, 13].map((id) => places.get(id).place), [1, 2, 3, 4], 'pre: places run best rank first among the men drafted');
  eq(places.get(13), { place: 4, rank: 520 }, 'pre: ESPN’s 520th is the fourth of the four ranked, and keeps ESPN’s number beside it');
  ok(!places.has(14), 'pre: a man ESPN did not rank (0) has no place');
  eq(R.preseasonPlaces(d.picks, new Map(Object.entries(ranks).map(([k, v]) => [Number(k), v]))).get(15).place, 1, 'pre: a Map of ranks reads the same');
  eq(R.preseasonPlaces(d.picks, null).size, 0, 'pre: no ranks, no places');

  const players = new Map([11, 12, 13, 14, 15].map((id) => [id, { name: `P${id}`, position: 'RB', soFar: 0, rest: 100 - id, total: 100 - id }]));
  const rv = R.reviewDraft({ draft: d, players, slots: [2], teams: 5, ranks });
  const by = new Map(rv.rows.map((r) => [r.playerId, r]));
  eq([by.get(15).at, by.get(15).pre, by.get(15).preDiff], [5, 1, 4], 'pre: drafted 5th, ranked 1st: +4');
  eq([by.get(11).at, by.get(11).pre, by.get(11).preDiff], [1, 3, -2], 'pre: drafted 1st, ranked 3rd: −2 (earlier than ranked)');
  eq(by.get(12).preDiff, 0, 'pre: drafted where he was ranked: 0');
  eq([by.get(13).espnRank, by.get(13).pre, by.get(13).preDiff], [520, 4, -1], 'pre: the defence is −1, not −517');
  eq([by.get(14).espnRank, by.get(14).pre, by.get(14).preDiff], [null, null, null], 'pre: the unranked man has no difference');
  ok(rv.rows.every((r) => r.diff !== null), 'pre: and the worth-now difference is untouched by it');
  const noRanks = R.reviewDraft({ draft: d, players, slots: [2], teams: 5 });
  eq(noRanks.rows.map((r) => r.diff), rv.rows.map((r) => r.diff), 'pre: with or without ranks, worth now is the same');
  ok(noRanks.rows.every((r) => r.preDiff === null), 'pre: without ranks every preseason difference is empty');

  // A team's two ends, on either difference.
  const two = { ...d, picks: d.picks.map((p) => ({ ...p, teamId: p.overall <= 3 ? 1 : 2 })) };
  const rv2 = R.reviewDraft({ draft: two, players, slots: [2], teams: 2, ranks });
  const t2 = R.teamReview(rv2.rows, 2, 'preDiff');
  eq([t2.steal && t2.steal.playerId, t2.miss], [15, null], 'pre: team 2’s biggest slide is the +4, and it reached for nobody ranked');
  const t1 = R.teamReview(rv2.rows, 1, 'preDiff');
  eq([t1.steal, t1.miss && t1.miss.playerId], [null, 11], 'pre: team 1’s biggest reach is the −2');
  eq(R.teamReview(rv2.rows, 1).picks.length, 3, 'pre: left alone, a team’s review is still on worth now');
}

// THE REAL LEAGUE'S RANKS (fixtures/draft-ranks-1241838-2026.json: ESPN's PPR
// draft rank of each of the 170, as kona_player_info sent them on 2026-10-08).
{
  const RK = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-ranks-1241838-2026.json'), 'utf8')).ranks;
  const players = new Map(Object.entries(FX.players).map(([id, p]) => [Number(id), { name: p.name, position: p.position, soFar: 0, rest: 0, total: 0 }]));
  const rv = R.reviewDraft({ draft, players, slots: [0, 2, 2, 4, 4, 4, 6, 16, 17, 23], teams: 10, ranks: RK });
  eq(Object.keys(RK).length, 170, 'real ranks: every drafted man has one');
  ok(Math.max(...Object.values(RK)) > 900, 'real ranks: ESPN’s own numbers run past 900 (why the page counts among the drafted)');
  eq(rv.rows.map((r) => r.pre).sort((a, b) => a - b), Array.from({ length: 170 }, (_, i) => i + 1), 'real ranks: the places are 1 to 170, each once');
  const gibbs = rv.rows.find((r) => r.name === 'Jahmyr Gibbs');
  eq([gibbs.espnRank, gibbs.pre, gibbs.preDiff], [1, 1, gibbs.at - 1], 'real ranks: Gibbs is ESPN’s 1, so his number is where he went less one');
  ok(rv.rows.every((r) => r.preDiff === r.at - r.pre), 'real ranks: every difference is drafted-at less the place');
  ok(Math.min(...rv.rows.map((r) => r.preDiff)) > -170 && Math.max(...rv.rows.map((r) => r.preDiff)) < 170, 'real ranks: and none is off the draft’s own scale');
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
  const sr = R.sampleRanks(teams, slots);
  eq([...sr.values()].sort((x, y) => x - y), Array.from({ length: n * size }, (_, i) => i + 1), 'sample ranks: every man ranked once, 1 to the last');
  const first = d.picks.filter((p) => p.round === 1).map((p) => sr.get(p.playerId));
  ok(Math.min(...first) === 1, 'sample ranks: the best-ranked man went in round one', first.join(','));
}

// ------------------------------------------------- the expected-value line
// Tim, 2026-10-09: "list all the players based on preseason rank, and then take
// their expected value (before the season started). This expected value can
// fluctuate quite a bit so make a smoothed equation line based on these numbers."
const neverRises = (c) => c.y.every((v, i) => i === 0 || v <= c.y[i - 1] + 1e-12);
{
  eq(R.expectedCurve([]), null, 'curve: no points, no line');
  eq(R.expectedCurve([{ place: 1, value: null }, { place: 2, value: null }]), null, 'curve: nobody with a preseason projection, no line');
  eq([R.curveRadius(170), R.curveRadius(40), R.curveRadius(5)], [4, 1, 1], 'curve: the averaging is a fortieth of the draft each side, at least 1');

  // BY HAND, unsmoothed: 5 then 7 is a rise, so the two share their average.
  const steps = R.expectedCurve([10, 5, 7, 2].map((value, i) => ({ place: i + 1, value })), { radius: 0 });
  eq(steps, { n: 4, y: [10, 6, 6, 2] }, 'curve: a later place worth more than an earlier one is pooled with it');
  // Smoothed with one each side, twice; the ends keep their own height.
  const soft = R.expectedCurve([10, 5, 7, 2].map((value, i) => ({ place: i + 1, value })), { radius: 1 });
  // pass 1: [10, 22/3, 14/3, 2]; pass 2: [10, 22/3, 14/3, 2] (a straight line is left alone)
  near(soft.y[0], 10, 'curve: the first place keeps its height');
  near(soft.y[1], 22 / 3, 'curve: a step becomes a slope');
  near(soft.y[2], 14 / 3, 'curve: on both sides of it');
  near(soft.y[3], 2, 'curve: the last place keeps its height');

  // A place nobody has a projection for is skipped, and filled from the line.
  const gap = R.expectedCurve([{ place: 1, value: 9 }, { place: 2, value: null }, { place: 3, value: 5 }, { place: 4, value: null }], { radius: 0 });
  eq(gap, { n: 4, y: [9, 7, 5, 5] }, 'curve: a missing place is filled from the line, and counts as a place');
  eq(R.expectedCurve([{ place: 2, value: 4 }, { place: 1, value: null }], { radius: 0 }).y, [4, 4], 'curve: a missing first place takes the next one’s height');
  eq(R.expectedCurve([{ place: 1, value: -3 }, { place: 2, value: 1 }], { radius: 0 }).y, [0.5, 0.5], 'curve: nothing counts for less than 0');

  // A NOISY DRAFT: a falling line with big swings on it (the same every run).
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const noisy = Array.from({ length: 170 }, (_, i) => ({ place: i + 1, value: Math.max(0, 12 * Math.exp(-i / 35) + (rand() - 0.5) * 5) }));
  const raw = noisy.map((p) => p.value);
  const c = R.expectedCurve(noisy);
  const c0 = R.expectedCurve(noisy, { radius: 0 });
  ok(raw.some((v, i) => i > 0 && v > raw[i - 1] + 1), 'noisy: the input really does rise in places');
  eq([c.n, c.y.length], [170, 170], 'noisy: a height for every place');
  ok(neverRises(c) && neverRises(c0), 'noisy: the line never rises');
  ok(c.y.every((v) => v >= 0), 'noisy: and is never below 0');
  const biggest = (ys) => Math.max(...ys.slice(1).map((v, i) => Math.abs(v - ys[i])));
  const rough = (ys) => ys.slice(2).reduce((a, v, i) => a + Math.abs(v - 2 * ys[i + 1] + ys[i]), 0);
  ok(biggest(c.y) < biggest(c0.y) / 2 && biggest(c0.y) < biggest(raw) , 'noisy: its biggest step is under half the stepped line’s', [biggest(raw), biggest(c0.y), biggest(c.y)]);
  ok(rough(c.y) < rough(c0.y) / 3, 'noisy: and it bends far less', [rough(c0.y), rough(c.y)]);
  const mean = (ys) => ys.reduce((a, b) => a + b, 0) / ys.length;
  near(mean(c0.y), mean(raw), 'noisy: pooling keeps the average of the points', 1e-9);
  near(mean(c.y), mean(raw), 'noisy: and smoothing all but keeps it', 0.05);
  near(c.y[0], c0.y[0], 'noisy: the first place is not pulled down by the smoothing');

  // READING IT.
  const line = { n: 4, y: [10, 6, 4, 1] };
  eq([R.expectedAt(line, 1), R.expectedAt(line, 3), R.expectedAt(line, 4)], [10, 4, 1], 'read: at a place');
  eq([R.expectedAt(line, 0), R.expectedAt(line, -5), R.expectedAt(line, 4.5), R.expectedAt(line, 900)], [10, 10, 1, 1], 'read: held at both ends');
  near(R.expectedAt(line, 1.5), 8, 'read: half way between two places');
  near(R.expectedAt(line, 3.25), 3.25, 'read: a quarter of the way');
  eq([R.expectedAt(null, 2), R.expectedAt(line, null), R.expectedAt(line, NaN)], [null, null, null], 'read: no line or no place, nothing');
}

// ------------------------------------------ vs worth now on Value, by hand
// Five running backs taken 1-5; ESPN ranked them 13, 11, 12, 14, 15. Lines:
// waiver 6, starter 10. Preseason points a week by id: 11→18, 12→14, 13→20,
// 14→9, 15→(none). So in preseason order (13, 11, 12, 14, 15) the preseason
// Values are 12, 10, 6, 1.5, — and that already never rises.
{
  const base = { v: 1, setAt: 0, week: 5, lines: { RB: { waiver: 6, starter: 10, agents: 3, starters: 4 } } };
  const d = R.parseDraft({
    settings: { draftSettings: { type: 'SNAKE' } },
    draftDetail: { drafted: true, picks: [11, 12, 13, 14, 15].map((playerId, i) => ({ overallPickNumber: i + 1, roundId: 1, roundPickNumber: i + 1, teamId: (i % 2) + 1, playerId, bidAmount: 0 })) },
  });
  const players = new Map([11, 12, 13, 14, 15].map((id) => [id, { name: `P${id}`, position: 'RB', soFar: 0, rest: 100 - id, total: 100 - id }]));
  const ranks = { 11: 20, 12: 30, 13: 10, 14: 40, 15: 50 };
  const pre = new Map([[11, 18], [12, 14], [13, 20], [14, 9]]);
  const now = new Map([[11, 12.5], [12, 0], [13, 9.9], [14, 4.2], [15, 0.4]]);
  const rv = R.reviewDraft({ draft: d, players, slots: [2], teams: 2, ranks, worth: { base, now, pre } });
  // The line, unsmoothed: 12, 10, 6, 1.5, 1.5 (the fifth has no point). With
  // one each side: [12, 9.333, 5.833, 3, 1.5]; and again: [12, 9.056, 6.056, 3.444, 1.5].
  eq(rv.curve.n, 5, 'value: a line over the five places');
  near(rv.curve.y[1], (12 + (12 + 10 + 6) / 3 + (10 + 6 + 1.5) / 3) / 3, 'value: the line at place 2, by hand');
  // Pick 1 (id 11) is read at place 1 — where he was DRAFTED — not at 2, his own preseason place.
  eq(rv.rows.map((r) => r.expected), [12, 9.1, 6.1, 3.4, 1.5], 'value: expected is the line at the pick, to the tenth');
  eq(rv.rows.map((r) => r.valueNow), [12.5, 0, 9.9, 4.2, 0.4], 'value: his Value today');
  eq(rv.rows.map((r) => r.valueDiff), [0.5, -9.1, 3.8, 0.8, -1.1], 'value: the difference is today less expected');
  ok(rv.rows.every((r) => Math.abs(r.valueDiff - (r.valueNow - r.expected)) < 1e-9 + 0.05 && Number.isInteger(Math.round(r.valueDiff * 10))), 'value: the printed ends subtract to the printed difference');
  eq(rv.rows.map((r) => [r.now, r.diff, r.preDiff]), R.reviewDraft({ draft: d, players, slots: [2], teams: 2, ranks }).rows.map((r) => [r.now, r.diff, r.preDiff]), 'value: the place-based numbers are untouched');

  eq([...R.teamValues(rv.rows)], [[1, 22.8], [2, 4.2]], 'value: a team’s total is the Value today of the men it drafted');
  const t1 = R.teamReview(rv.rows, 1, 'valueDiff');
  eq([t1.steal.playerId, t1.miss.playerId], [13, 15], 'value: a team’s two ends on this difference');

  // A FIGURE THAT IS NOT A DIFFERENCE ("Expected value" and "Value now", Tim
  // 2026-10-09): a team's two ends are its highest and lowest, whatever the sign.
  // Team 1 drafted 11, 13, 15 (expected 12 / 6.1 / 1.5; today 12.5 / 9.9 / 0.4); team 2 drafted 12, 14 (9.1 / 3.4; 0 / 4.2).
  const plain = (team, key) => {
    const t = R.teamReview(rv.rows, team, key, { plain: true });
    return [t.steal && t.steal.playerId, t.miss && t.miss.playerId];
  };
  eq([plain(1, 'expected'), plain(2, 'expected')], [[11, 15], [12, 14]], 'plain ends: a team’s highest and lowest expected value');
  eq([plain(1, 'valueNow'), plain(2, 'valueNow')], [[11, 15], [14, 12]], 'plain ends: and its highest and lowest Value today — a man worth 0 is its lowest');
  const signedEnds = R.teamReview(rv.rows, 2, 'valueNow');
  eq([signedEnds.steal.playerId, signedEnds.miss], [14, null], 'plain ends: (left alone, the two ends are still a steal above zero and a miss below it)');
  eq(R.teamReview(rv.rows, 1, 'expected', { plain: true }).picks.map((r) => r.playerId), [11, 13, 15], 'plain ends: the picks are the same picks');
  eq([...R.teamValues(rv.rows, 'expected')], [[1, 19.6], [2, 12.5]], 'expected: a team’s total of the line read at each of its picks');

  // HIS OWN PRESEASON VALUE (Tim, 2026-10-09: "put the value at the top … as
  // what it was proj to be based on preseason predictions (which is different
  // than the preseason expected value we talked about before)"): the raw figure
  // of each man, not the line. 18 → 2 + 8, 14 → 2 + 4, 20 → 2 + 10, 9 → 1.5.
  eq(rv.rows.map((r) => r.valuePre), [10, 6, 12, 1.5, null], 'valuePre: each man’s own preseason Value; none without a preseason projection');
  ok(rv.rows.some((r) => r.valuePre !== null && r.valuePre !== r.expected), 'valuePre: which is not the line read at his pick', JSON.stringify(rv.rows.map((r) => [r.valuePre, r.expected])));
  eq([...R.teamValues(rv.rows, 'valuePre')], [[1, 22], [2, 7.5]], 'valuePre: a team’s preseason total adds them up, a man without one adding 0');
  eq([...R.teamValues(rv.rows, 'valueNow')], [...R.teamValues(rv.rows)], 'valuePre: and the total is of Value today unless asked otherwise');

  // WITHOUT THE LINES nothing is made up.
  const none = R.reviewDraft({ draft: d, players, slots: [2], teams: 2, ranks });
  eq([none.curve, none.rows.map((r) => [r.valueNow, r.expected, r.valueDiff])], [null, Array(5).fill([null, null, null])], 'value: no lines, no Value numbers');
  eq(none.rows.map((r) => r.valuePre), Array(5).fill(null), 'valuePre: no lines, no preseason Value');
  const bad = R.reviewDraft({ draft: d, players, slots: [2], teams: 2, ranks, worth: { base: { v: 99 }, now, pre } });
  eq(bad.curve, null, 'value: lines this code cannot read count as none');
  const noPre = R.reviewDraft({ draft: d, players, slots: [2], teams: 2, ranks, worth: { base, now, pre: new Map() } });
  eq([noPre.curve, noPre.rows[0].valueDiff], [null, null], 'value: no preseason projection for anybody, no line and no difference');
  eq([...R.teamValues(none.rows)], [[1, 0], [2, 0]], 'value: and a total of nothing');
  // A function does as well as a Map.
  const fn = R.reviewDraft({ draft: d, players, slots: [2], teams: 2, ranks, worth: { base, now: (id) => now.get(id), pre: (id) => pre.get(id) ?? null } });
  eq(fn.rows.map((r) => r.valueDiff), rv.rows.map((r) => r.valueDiff), 'value: the two sources may be functions');
}

// --------------------------------------------- vs worth now on Value, real
// The real league: its own frozen lines, every man's weeks as captured, and the
// repo's preseason file (tests/draft-stub-value.mjs).
{
  const { WORTH, nowOf, preOf, BASE } = await import('./draft-stub-value.mjs');
  const V = await import(moduleUrl('js/value.js'));
  const RK = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-ranks-1241838-2026.json'), 'utf8')).ranks;
  const players = new Map(Object.entries(FX.players).map(([id, p]) => [Number(id), { name: p.name, position: p.position, soFar: 0, rest: 0, total: 0 }]));
  const rv = R.reviewDraft({ draft, players, slots: [0, 2, 2, 4, 4, 4, 6, 16, 17, 23], teams: 10, ranks: RK, worth: WORTH });
  const by = (name) => rv.rows.find((r) => r.name === name);
  eq([rv.curve.n, rv.rows.filter((r) => r.valueDiff !== null).length], [170, 170], 'real: a line over 170 places and a difference for all 170');
  ok(draft.picks.every((p) => preOf(p.playerId) > 0), 'real: every man drafted is in the preseason file');
  ok(neverRises(rv.curve) && rv.curve.y.every((v) => v >= 0), 'real: the line never rises and is never below 0');
  const gibbs = by('Jahmyr Gibbs');
  eq([gibbs.pre, gibbs.at], [1, 1], 'real: Gibbs, ranked first and the dearest');
  near(rv.curve.y[0], V.valueOf(BASE, 'RB', preOf(gibbs.playerId)), 'real: the top of the line is his own preseason Value', 0.05);
  ok(rv.curve.y[0] > 10 && rv.curve.y[24] > 4 && rv.curve.y[24] < 8 && rv.curve.y[99] < 2 && rv.curve.y[169] < 0.5, 'real: about 13 at the top, 6 at 25, under 2 by 100, nothing at the end',
    [1, 25, 50, 100, 170].map((p) => rv.curve.y[p - 1].toFixed(2)).join(' '));
  ok(rv.rows.every((r) => r.expected === Math.round(R.expectedAt(rv.curve, r.at) * 10) / 10), 'real: every pick is read at its price’s rank');
  eq(rv.rows.filter((r) => r.valueNow !== nowOf(r.playerId)).length, 0, 'real: every man’s Value today');
  // A dear man hurt since is the miss; a dollar man who starts is the steal.
  const achane = by("De'Von Achane");
  const hubbard = by('Chuba Hubbard');
  ok(achane.bid === 44 && achane.valueNow === 0 && achane.valueDiff < -5, 'real: Achane, $44 and worth nothing now, is a big miss', JSON.stringify([achane.expected, achane.valueNow, achane.valueDiff]));
  ok(hubbard.bid === 1 && hubbard.valueDiff > 3 && hubbard.expected < 1, 'real: Hubbard, $1 and a starter, is a steal', JSON.stringify([hubbard.expected, hubbard.valueNow, hubbard.valueDiff]));
  const totals = R.teamValues(rv.rows);
  eq(totals.size, 10, 'real: a total for each of the ten teams');
  near([...totals.values()].reduce((a, b) => a + b, 0), rv.rows.reduce((a, r) => a + r.valueNow, 0), 'real: which together are everybody’s Value', 0.5);
  eq(totals.get(8), Math.round(rv.rows.filter((r) => r.teamId === 8).reduce((a, r) => a + r.valueNow, 0) * 10) / 10, 'real: team 8’s is its seventeen men’s');
  // THE PRESEASON TOTALS: each man's own preseason Value, added up a team.
  eq(rv.rows.filter((r) => r.valuePre !== V.valueOf(BASE, r.position, preOf(r.playerId))).length, 0, 'real: every man’s own preseason Value');
  const preTotals = R.teamValues(rv.rows, 'valuePre');
  eq(preTotals.get(8), Math.round(rv.rows.filter((r) => r.teamId === 8).reduce((a, r) => a + r.valuePre, 0) * 10) / 10, 'real: team 8’s preseason total is its seventeen men’s');
  ok([...preTotals].every(([id, v]) => v > 0 && v !== totals.get(id)), 'real: ten preseason totals, none of them the total today', JSON.stringify([...preTotals]));
}

// ------------------------------------------------- the board's Avg column
// Tim, 2026-10-10: "add a column on the far left that is just the avg of that
// row or that line of drafting". By hand first, then the real league.
{
  near(R.meanOf([1, 2, 4]), 7 / 3, 'mean: of three numbers, unrounded');
  near(R.meanOf([1.25, null, 2.5, undefined, '—', NaN]), 1.875, 'mean: what is not a number is left out, not counted as 0');
  eq([R.meanOf([]), R.meanOf([null, undefined, '—']), R.meanOf(null)], [null, null, null], 'mean: nothing to average is null');
  eq(R.meanOf([0, 0]), 0, 'mean: a real 0 is a number and counts');

  // Three teams, four rows: a full row, a row with an empty slot, a row with
  // one man who has no figure, and a row nobody picked in.
  const pk = (id) => ({ playerId: id });
  const board = [
    [pk(1), pk(2), pk(3)],
    [pk(4), null, pk(5)],
    [null, pk(6), pk(7)],
    [null, null, null],
  ];
  const rows = [
    { playerId: 1, diff: 3, valueNow: 10.1 }, { playerId: 2, diff: -1, valueNow: 5.2 }, { playerId: 3, diff: 2, valueNow: 0 },
    { playerId: 4, diff: -7, valueNow: 3.3 }, { playerId: 5, diff: 4, valueNow: 1.2 },
    { playerId: 6, diff: null, valueNow: null }, { playerId: 7, diff: 5, valueNow: 0.4 },
  ];
  const d = R.roundAverages(board, rows, 'diff');
  eq(d.length, 4, 'avg: one a row of the board');
  near(d[0], 4 / 3, 'avg: a full row is the mean of its three, not rounded');
  near(d[1], -1.5, 'avg: an empty slot is left out — the mean of the other two');
  near(d[2], 5, 'avg: and so is a man with no figure');
  eq(d[3], null, 'avg: a row with no number at all is null');
  const v = R.roundAverages(board, rows, 'valueNow');
  near(v[0], (10.1 + 5.2 + 0) / 3, 'avg: on another figure — and a Value of 0 counts');
  near(v[1], 2.25, 'avg: another figure, the empty slot left out');
  near(R.roundAverages(board, rows)[0], 4 / 3, 'avg: the figure defaults to the place difference');
  eq([R.roundAverages([], rows, 'diff'), R.roundAverages(null, null, 'diff')], [[], []], 'avg: no board, no averages');
  eq(R.roundAverages(board, [], 'diff'), [null, null, null, null], 'avg: picks the review does not know are left out');

  // THE REAL LEAGUE: ten men a row, seventeen rows, each figure of the four views.
  const { WORTH } = await import('./draft-stub-value.mjs');
  const RK = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-ranks-1241838-2026.json'), 'utf8')).ranks;
  const players = new Map(Object.entries(FX.players).map(([id, p]) => [Number(id), { name: p.name, position: p.position, soFar: 0, rest: 0, total: 0 }]));
  const rv = R.reviewDraft({ draft, players, slots: [0, 2, 2, 4, 4, 4, 6, 16, 17, 23], teams: 10, ranks: RK, worth: WORTH });
  const b = R.boardOf(draft);
  const byId = new Map(rv.rows.map((r) => [r.playerId, r]));
  for (const key of ['valueDiff', 'expected', 'valueNow', 'preDiff', 'diff']) {
    const got = R.roundAverages(b.rows, rv.rows, key);
    const want = b.rows.map((row) => row.reduce((a, p) => a + byId.get(p.playerId)[key], 0) / 10);
    ok(got.length === 17 && got.every((x, i) => Math.abs(x - want[i]) < 1e-9), `real avg: ${key} — each of seventeen rows is the mean of its ten men`, got.slice(0, 3).join(' '));
  }
  const now = R.roundAverages(b.rows, rv.rows, 'valueNow');
  ok(now[0] > 5 && now[16] < 1.5 && now.slice(1).every((x) => x < now[0]), 'real avg: the dearest row is worth far more today than any other, the cheapest next to nothing', [now[0], now[8], now[16]].map((x) => x.toFixed(2)).join(' '));
  ok(now.some((x) => Math.abs(x * 10 - Math.round(x * 10)) > 1e-6), 'real avg: (and they are not rounded to the tenth)');
}

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
