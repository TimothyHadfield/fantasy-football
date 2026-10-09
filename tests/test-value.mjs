// Checks js/value.js: a player's VALUE, in points a week over what is free.
//
// Tim, 2026-10-09: "heavily be based on the line of where top waiver players of
// that position are, aswell as where the line of where actual league mates are
// starting that position or not. Players low inside the waiver will have no
// value and there will be no players with negative value."
// And: "I only want a player's value to change if their actual future
// projections have changed for some reason, not because we're moving the
// baselines or whatnot."
//
// Every expected number below is worked on paper from the fixture, never read
// back from the module.
//
// THE LEAGUE: two teams, each starting QB, 2 RB, 2 WR, TE, FLEX, D/ST, K — a
// real lineup's shape (lineupSlotIds 0, 2, 2, 4, 4, 6, 23, 16, 17).
//
//   rostered  QB 20 18 12      RB 16 15 14 13 9 8     WR 17 14 12 11 10 7
//             TE 9 8 5         K 8 7                   D/ST 6 5
//   the league starts (best men, every slot of both teams):
//             QB 20 18         RB 16 15 14 13 + flex 9
//             WR 17 14 12 11 + flex 10                 TE 9 8    K 8 7   D/ST 6 5
//   free      QB 15 13 11 5    RB 10 8 6 2    WR 12 11 10    TE 6 4
//             D/ST 6 6 3       K nobody
//
//   line      waiver (top 3 free, averaged)     starter (worst man started)
//   QB        13                                18
//   RB        8                                 9
//   WR        11                                10 -> 11 (never below the waiver line)
//   TE        5   (only two free: their mean)   8
//   D/ST      5                                 5
//   K         no free agent to measure from: no line, and no value

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (c, msg, extra = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); } };

let v = null;
try {
  v = await import('../js/value.js');
} catch (err) {
  console.log(`FAIL js/value.js does not load: ${String(err && err.message).split('\n')[0]}`);
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}

// ------------------------------------------------------------------- restAvg
eq(v.restAvg({ 5: 10, 6: 0, 7: 20 }, [5, 6, 7], 6), 15, 'his bye is left out: (10 + 20) / 2');
eq(v.restAvg({ 5: 10, 6: 0, 7: 20 }, [5, 6, 7], null), 10, 'a 0 with no bye known counts as the 0 it is');
eq(v.restAvg({ 5: 10, 6: 0, 7: 20 }, [5, 6, 7], 9), 10, 'a 0 in a week that is NOT his bye (hurt, suspended) counts');
eq(v.restAvg({ 5: 10, 6: null, 7: 20 }, [5, 6, 7]), 15, 'a week ESPN said nothing about is skipped');
eq(v.restAvg({ 5: 10, 7: 20 }, [5, 6, 7]), 15, 'and so is a week that is absent');
eq(v.restAvg({ 4: 99, 5: 10, 7: 20 }, [5, 7]), 15, 'a week that is not left does not count');
eq(v.restAvg(new Map([[5, 10], [6, 0], [7, 20]]), [5, 6, 7], 6), 15, 'a Map works the same');
eq(v.restAvg({ 6: 0 }, [6], 6), null, 'only his bye left: no average');
eq(v.restAvg({ 5: 10 }, [], null), null, 'no weeks left: no average');
eq(v.restAvg(null, [5, 6], null), null, 'nothing known about him: no average');
eq(v.restAvg({ 5: 10, 6: 0, 7: 20 }, [5, 6, 7], '6'), 15, 'the bye may arrive as a string (a JSON key)');
// The point of leaving the bye out: the average is the same before and after it.
eq(v.restAvg({ 6: 0, 7: 12, 8: 14 }, [6, 7, 8], 6), v.restAvg({ 6: 0, 7: 12, 8: 14 }, [7, 8], 6),
  'a bye going by does not move his average');

// --------------------------------------------------- Tim's own example
// "a player worth twice as much as another player is worth two of that other
// player": waiver line 10, a 20 against two 15s.
const flat = { v: v.BASE_VERSION, setAt: 1, week: 5, lines: { WR: { waiver: 10, starter: 10, agents: 3, starters: 4 } } };
eq(v.valueOf(flat, 'WR', 20), 10, 'starter line = waiver line 10: a 20 is worth 10');
eq(v.valueOf(flat, 'WR', 15), 5, '…and a 15 is worth 5');
eq(v.valueOf(flat, 'WR', 20), 2 * v.valueOf(flat, 'WR', 15), 'so the 20 is worth two 15s');
const stepped = { v: v.BASE_VERSION, setAt: 1, week: 5, lines: { WR: { waiver: 10, starter: 13, agents: 3, starters: 4 } } };
eq(v.valueOf(stepped, 'WR', 20), 8.5, 'starter line 13: (13 − 10) at half + (20 − 13) in full = 8.5');
eq(v.valueOf(stepped, 'WR', 15), 3.5, '…and the 15: 1.5 + 2 = 3.5');
eq(v.valueOf(stepped, 'WR', 13), 1.5, 'a man exactly on the starter line: 3 points at half');
eq(v.valueOf(stepped, 'WR', 12), 1, 'a bench man between the lines: 2 points at half');
eq(v.BENCH_WEIGHT, 0.5, 'points between the two lines count half (his pick)');
eq(v.WAIVER_TOP, 3, 'the waiver line is the top 3 free agents (his pick)');

// ----------------------------------------------------------- the floor at 0
eq(v.valueOf(stepped, 'WR', 10), 0, 'on the waiver line: 0');
eq(v.valueOf(stepped, 'WR', 9.9), 0, 'just under it: 0, not −0.05');
eq(v.valueOf(stepped, 'WR', 2), 0, 'low inside the waiver: no value');
eq(v.valueOf(stepped, 'WR', 0), 0, 'a man projected nothing: 0, never negative');
eq(v.valueOf(stepped, 'WR', -3), 0, 'even a negative projection (a D/ST can have one) is 0');
for (const a of [-5, 0, 3, 9.99, 10, 10.01, 11.5, 13, 13.01, 30]) {
  ok(v.valueOf(stepped, 'WR', a) >= 0, `never below 0 (avg ${a})`);
}
eq(v.valueOf(stepped, 'WR', 10.26), 0.1, 'to the tenth: 0.26 at half is 0.13');
// Value never falls as the average rises.
{
  let last = -1;
  let rising = true;
  for (let a = 0; a <= 30; a += 0.25) {
    const got = v.valueOf(stepped, 'WR', a);
    if (got < last) rising = false;
    last = got;
  }
  ok(rising, 'a better average is never worth less');
}

// -------------------------------------------------------- no line: no value
eq(v.valueOf(stepped, 'K', 9), null, 'no line at his position: null, not 0');
eq(v.valueOf(null, 'WR', 15), null, 'no baseline: null');
eq(v.valueOf(stepped, 'WR', null), null, 'no average: null');
eq(v.valueOf(stepped, 'WR', NaN), null, 'NaN is no average');
eq(v.valueOf(stepped, 'WR', '15'), null, 'a string is no average');
eq(v.valueOf({ ...stepped, v: 99 }, 'WR', 15), null, 'a baseline from another version is not read');
eq(v.valueOf({ v: v.BASE_VERSION, lines: { WR: { waiver: 10 } } }, 'WR', 15), null, 'a line missing a number is not a baseline');
eq(v.isBase(stepped), true, 'isBase: a real one');
eq(v.isBase(null), false, 'isBase: null');
eq(v.isBase({}), false, 'isBase: an empty object');
eq(v.isBase({ v: v.BASE_VERSION }), false, 'isBase: no lines');
eq(v.isBase(JSON.parse(JSON.stringify(stepped))), true, 'isBase: survives a JSON round trip (storage, the sync)');
eq(v.lineOf(stepped, 'WR').starter, 13, 'lineOf: the line');
eq(v.lineOf(stepped, 'QB'), null, 'lineOf: none');
eq(v.valueText(5.5), '5.5', 'valueText: one decimal');
eq(v.valueText(5), '5.0', 'valueText: a whole number keeps its decimal');
eq(v.valueText(0), '0.0', 'valueText: zero is a value');
eq(v.valueText(null), '—', 'valueText: cannot be said');

// ------------------------------------------------------------- the two lines
const men = (position, avgs) => avgs.map((avg) => ({ position, avg }));
const ROSTERED = [
  ...men('QB', [20, 18, 12]), ...men('RB', [16, 15, 14, 13, 9, 8]), ...men('WR', [17, 14, 12, 11, 10, 7]),
  ...men('TE', [9, 8, 5]), ...men('K', [8, 7]), ...men('DST', [6, 5]),
];
const FREE = [
  ...men('QB', [15, 13, 11, 5]), ...men('RB', [10, 8, 6, 2]), ...men('WR', [12, 11, 10]),
  ...men('TE', [6, 4]), ...men('DST', [6, 6, 3]),
];
const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17];
const base = v.buildBase({ rostered: ROSTERED, freeAgents: FREE, slots: SLOTS, teams: 2, week: 5, now: 1234 });

eq(v.isBase(base), true, 'buildBase returns a baseline');
eq(base.v, v.BASE_VERSION, 'stamped with its version');
eq(base.setAt, 1234, 'and when it was set');
eq(base.week, 5, 'and the week it was set in');
eq(base.lines.QB.waiver, 13, 'QB waiver line: (15 + 13 + 11) / 3');
eq(base.lines.QB.starter, 18, 'QB starter line: the worse of the two the league starts');
eq(base.lines.QB.starters, 2, 'two QBs started');
eq(base.lines.RB.waiver, 8, 'RB waiver line: (10 + 8 + 6) / 3');
eq(base.lines.RB.starter, 9, 'RB starter line: the flex RB, the worst RB anybody starts');
eq(base.lines.RB.starters, 5, 'five RBs started (four slots and one flex)');
eq(base.lines.WR.waiver, 11, 'WR waiver line: (12 + 11 + 10) / 3');
eq(base.lines.WR.starter, 11, 'WR starter line: the worst WR started is a 10, but the line is NEVER below the waiver line');
eq(base.lines.TE.waiver, 5, 'TE waiver line: only two free agents, so their mean');
eq(base.lines.TE.agents, 2, '…and it says it was made from two');
eq(base.lines.TE.starter, 8, 'TE starter line');
eq(base.lines.DST.waiver, 5, 'D/ST waiver line: (6 + 6 + 3) / 3');
eq(base.lines.DST.starter, 5, 'D/ST starter line');
eq('K' in base.lines, false, 'no free kicker to measure from: no line');
for (const [pos, line] of Object.entries(base.lines)) {
  ok(line.starter >= line.waiver, `${pos}: the starter line is never below the waiver line`, JSON.stringify(line));
}

// A man's value off those lines.
eq(v.valueOf(base, 'QB', 20), 4.5, 'QB 20: (18 − 13) at half + 2 in full');
eq(v.valueOf(base, 'QB', 18), 2.5, 'QB 18: 5 at half');
eq(v.valueOf(base, 'QB', 12), 0, 'QB 12: under the waiver line');
eq(v.valueOf(base, 'RB', 16), 7.5, 'RB 16: 1 at half + 7 in full');
eq(v.valueOf(base, 'WR', 17), 6, 'WR 17: the lines meet, so 6 in full');
eq(v.valueOf(base, 'TE', 9), 2.5, 'TE 9: 3 at half + 1 in full');
eq(v.valueOf(base, 'K', 8), null, 'K: no line, so no value');
{
  const parts = v.valueParts(base, 'QB', 20);
  eq(parts.bench, 5, 'valueParts: the points between the lines');
  eq(parts.over, 2, 'valueParts: the points over the starter line');
  eq(parts.bench * v.BENCH_WEIGHT + parts.over, parts.value, 'valueParts: its parts make the value');
  eq(v.valueParts(base, 'QB', 12).value, 0, 'valueParts: under the waiver line is 0');
  eq(v.valueParts(base, 'QB', 12).bench, 0, '…with nothing between the lines');
  eq(v.valueParts(base, 'K', 8), null, 'valueParts: no line, null');
}

// Men the lines must not be made from.
{
  const noisy = v.buildBase({
    rostered: [...ROSTERED, { position: 'UNK', avg: 50 }, { position: 'QB', avg: null }, null],
    freeAgents: [...FREE, { position: 'UNK', avg: 99 }, { position: 'WR', avg: null }, { position: 'WR' }, undefined],
    slots: SLOTS, teams: 2, week: 5, now: 1234,
  });
  eq(JSON.stringify(noisy.lines), JSON.stringify(base.lines), 'a man with no position or no average changes no line');
  const empty = v.buildBase({ rostered: [], freeAgents: [], slots: SLOTS, teams: 2 });
  eq(Object.keys(empty.lines).length, 0, 'nobody read: no lines at all');
  const alone = v.buildBase({ rostered: [], freeAgents: men('WR', [9, 6, 3]), slots: SLOTS, teams: 2 });
  eq(alone.lines.WR.starter, 6, 'nobody rostered at a position: the starter line is the waiver line');
}

// ============================================================ THE FROZEN RULE
// After `buildBase`, changing the free agents changes nobody's value.
{
  const kept = JSON.parse(JSON.stringify(base));                 // as storage / the sync keep it
  const before = ROSTERED.map((p) => v.valueOf(kept, p.position, p.avg));
  ok(before.some((x) => typeof x === 'number' && x > 0), 'the league has value in it to begin with', JSON.stringify(before));

  // The wire moves: every free agent is claimed and three stars are dropped.
  const moved = [...men('QB', [30, 29, 28]), ...men('RB', [30, 29, 28]), ...men('WR', [30, 29, 28]), ...men('TE', [30, 29, 28])];
  FREE.length = 0;
  FREE.push(...moved);
  const after = ROSTERED.map((p) => v.valueOf(kept, p.position, p.avg));
  eq(JSON.stringify(after), JSON.stringify(before), 'FROZEN: the free agents changed and nobody’s value did');
  eq(JSON.stringify(ROSTERED.map((p) => v.valueOf(base, p.position, p.avg))), JSON.stringify(before),
    'the baseline object itself holds no reference to the free agents either');

  // And this is not vacuous: lines made from the NEW wire would have moved everyone.
  const fresh = v.buildBase({ rostered: ROSTERED, freeAgents: FREE, slots: SLOTS, teams: 2, week: 6 });
  eq(fresh.lines.QB.waiver, 29, 'a baseline built again WOULD move (QB waiver 13 -> 29)…');
  ok(JSON.stringify(ROSTERED.map((p) => v.valueOf(fresh, p.position, p.avg))) !== JSON.stringify(before),
    '…which is why it is built once and kept');

  // What DOES move a value: his own projection.
  eq(v.valueOf(kept, 'QB', 20), 4.5, 'same projection, same value');
  eq(v.valueOf(kept, 'QB', 22), 6.5, 'his projection rises 2 above the starter line: his value rises 2');
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
