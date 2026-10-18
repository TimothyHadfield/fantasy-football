// THE TRADE PAGE'S PREVIEWS, as arithmetic — js/trade-cards.js is pure.
//
//   node test-trade-cards.mjs
//
// Two promises are checked here, on figures the size the real league produces
// (league 1241838, 2026-10-08: forty offers gaining +20.9 … +62.2 over thirteen
// weeks, his side −10.9 … −21.9):
//
//   1. THE GAIN SCALE NEVER DRAWS RED ON A PLUS (docs/colour-plan.md, Trade).
//      Scaled against the other offers, the weakest good offer was `heat-dn-3`.
//      Section 1 runs the same column through the OLD scale first and shows it
//      going red, so the check is known to be able to fail.
//   2. EVERY CARD ENDS ON THE NUMBER ITS CELL PRINTS, and its rows add up to it
//      — or say "Rounding" for the tenth they miss by.
//
// And one rule from docs/wave-brief.md: no card says SD, z-score or "step n of 4".

import { heatScale, heatOf } from '../js/heat.js';
import {
  zeroScale, signed, gainWeeksSpec, slotChangeSpec, goalSpec, altGoalSpec, oppSpec,
  teamSpec, recordOf, meetSpec, yesSpec,
} from '../js/trade-cards.js';
import { acceptVerdict } from '../js/accept.js';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra !== '' ? ` — ${String(extra).slice(0, 260)}` : ''}`);
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/** Every word a reader could see in a card spec. */
const wordsOf = (spec) => JSON.stringify(spec).replace(/<[^>]+>/g, ' ');
const num = (s) => Number(String(s).replace('−', '-').replace('+', ''));
/** The +/− column of a week table, row by row, and its footer figures. */
const tableOf = (spec) => {
  const rows = [...spec.tableHtml.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
  const body = rows.filter((r) => /^\d/.test(r[0]));
  return { head: rows[0], body, foot: rows.slice(1 + body.length) };
};

// ---------------------------------------------------------- 1. the gain scale
{
  // The finder's "You gain" column as measured: every offer a plus.
  const gains = [53.9, 59, 47.7, 36.3, 40.6, 41.2, 46.5, 37.8, 41.9, 43.7, 41, 31.7, 44.4, 39.8, 47.5, 46.4,
    25.9, 47, 30, 30, 28.4, 50.2, 41.4, 49, 62.2, 34.7, 35.4, 31.9, 37.4, 30, 36.9, 49.3, 33.1, 28.5, 45.1,
    20.9, 25, 28.2, 35, 30.3];
  const old = heatScale(gains);
  const oldRed = gains.filter((g) => /heat-dn/.test((heatOf(g, old) || {}).cls || '')).length;
  ok('THE OLD SCALE DID DRAW RED ON A PLUS (so this check can fail)', oldRed > 0, `${oldRed} of ${gains.length}`);

  const z = zeroScale(gains);
  ok('a column of gains has a scale', !!z && z.mean === 0 && z.sd > 0);
  const cls = gains.map((g) => (heatOf(g, z) || {}).cls || '');
  eq(cls.filter((c) => /heat-dn/.test(c)).length, 0, 'anchored at zero, no plus is red');
  ok('and the biggest plus is the strongest green', /heat-up-4/.test(cls[gains.indexOf(62.2)]), cls[gains.indexOf(62.2)]);

  // "They gain": every figure a minus, and none may be green.
  const his = [-19.2, -19.5, -13, -14.8, -19.1, -13.8, -18.2, -16.5, -17.4, -12.8, -10.9, -21.9];
  const hz = zeroScale(his);
  eq(his.filter((g) => /heat-up/.test((heatOf(g, hz) || {}).cls || '')).length, 0, 'no minus is green');

  // A mixed column: the sign decides the hue, the size the strength.
  const mixed = [12, 3, 0.4, -0.4, -3, -12];
  const mz = zeroScale(mixed);
  const mc = mixed.map((g) => (heatOf(g, mz) || {}).cls || '');
  ok('a mixed column: plus green, minus red', mc.slice(0, 2).every((c) => /heat-up/.test(c)) &&
    mc.slice(4).every((c) => /heat-dn/.test(c)), mc.join(' '));
  ok('and never the wrong hue for the sign', mixed.every((g, i) => !(g > 0 && /heat-dn/.test(mc[i])) &&
    !(g < 0 && /heat-up/.test(mc[i]))), mc.join(' '));
  eq(zeroScale([0, 0.01, -0.02]), null, 'a column of nothing has no scale');
  eq(zeroScale([]), null, 'nor an empty one');
}

// ----------------------------------------------------- 2. a gain, week by week
{
  // The first finder row as measured: thirteen weeks, a meeting in week 12.
  const byWeek = [[5, 119.1, 125.7], [6, 125.1, 130.6], [7, 125.4, 125.0], [8, 110.8, 109.6], [9, 117.1, 124.4],
    [10, 119.9, 128.2], [11, 126.3, 129.8], [12, 125.2, 129.9], [13, 124.2, 121.4], [14, 122.8, 127.3],
    [15, 121.9, 127.3], [16, 126.0, 131.1], [17, 124.4, 129.8]]
    .map(([week, before, after]) => ({ week, before, after, delta: after - before }));
  const spec = gainWeeksSpec({
    title: 'You gain', sub: 'with Luke', byWeek, vs: new Map([[12, -2.0]]), vsName: 'Luke',
    shown: '+4.1', totalShown: '+53.9',
  });
  const t = tableOf(spec);
  eq(t.body.length, 13, 'one row a week');
  eq(t.head.join('|'), 'Wk|Now|With trade|+/−', 'now / with trade / the change');
  const sum = t.body.reduce((a, r) => a + Math.round(num(r[3]) * 10), 0) / 10;
  eq(sum, 53.9, 'the weeks add up to the cell’s total');
  eq(t.foot[0][3], '+4.1', 'the last line is the cell’s own figure');
  eq(t.foot[1][3], '+53.9', 'and its sub-figure under it');
  ok('the week they meet is netted and marked', /^12↑/.test(t.body[7][0]) && t.body[7][3] === '+6.7', t.body[7].join(' '));
  ok('and the foot says why', /week 12: you play Luke/.test(spec.foot), spec.foot);

  // His side, a playoff week counted by the chance he is still playing.
  const his = gainWeeksSpec({
    title: 'He gains', byWeek: [{ week: 14, before: 132.7, after: 130.8 }, { week: 15, before: 131.1, after: 128.0 }],
    reach: new Map([[14, 1], [15, 0.49]]), shown: '−2.3', totalShown: '−3.4',
  });
  const h = tableOf(his);
  ok('a week he may not play is weighted, and says by how much', h.body[1][0] === '15 49%' && h.body[1][3] === '−1.5',
    h.body[1].join(' '));
  eq(h.body[0][3], '−1.9', 'a week he certainly plays is not');
  ok('and the weeks still add up to the total', Math.abs(h.body.reduce((a, r) => a + num(r[3]), 0) - -3.4) < 0.051);
  ok('the foot explains the percentage', /chance he is still playing/.test(his.foot), his.foot);

  // A one-number measure has no weeks: now, with, the change.
  const flat = gainWeeksSpec({ title: 'You gain', byWeek: null, before: 120, after: 123.5, shown: '+3.5' });
  ok('without weeks: lineup now, with the trade, and the cell’s figure',
    flat.rows.length === 2 && flat.rows[0].value === 120 && flat.rows[1].value === 123.5 && /\+3\.5/.test(flat.total.html));
}

// ------------------------------------------------ 3. one week, slot by slot
{
  const spec = slotChangeSpec({
    title: 'Week 5', sub: 'your lineup',
    slots: [
      { slot: 'QB', before: { name: 'Bo Nix', v: 16.1 }, after: { name: 'Bo Nix', v: 16.1 } },
      { slot: 'RB1', before: { name: 'Hampton', v: 16.1 }, after: { name: 'Taylor', v: 16.3 } },
      { slot: 'RB2', before: { name: 'Warren', v: 11.3 }, after: { name: 'Hampton', v: 16.1 } },
      { slot: 'FLEX', before: { name: 'Rice', v: 11.7 }, after: { name: 'Warren', v: 11.3 } },
      { slot: 'K', before: null, after: { name: 'Boswell', v: 8.0 } },
    ],
    before: 118.8, after: 131.4, shown: '+12.6',
  });
  eq(spec.rows.filter((r) => r.lead).length, 4, 'only the slots that changed');
  ok('an unchanged slot is left out', !spec.rows.some((r) => r.lead === 'QB'));
  ok('each line names who left and who came in', /Warren 11\.3 → Hampton 16\.1/.test(spec.rows[1].label), spec.rows[1].label);
  ok('an empty slot reads as nobody', /^nobody → Boswell 8\.0$/.test(spec.rows[3].label), spec.rows[3].label);
  const sum = spec.rows.reduce((a, r) => a + Math.round(num(String(r.html).replace(/<[^>]+>/g, '')) * 10), 0) / 10;
  eq(sum, 12.6, 'the lines add up to the lineup’s change');
  ok('which is the cell’s own figure', /\+12\.6/.test(spec.total.html) && spec.total.label === 'Difference');

  const off = slotChangeSpec({
    title: 'Week 5', slots: [{ slot: 'QB', before: { name: 'A', v: 10 }, after: { name: 'B', v: 12 } }],
    before: 100, after: 102.1, shown: '+2.1',
  });
  ok('a tenth short is called rounding', off.rows[1].label === 'Rounding' && /\+0\.1/.test(off.rows[1].html), JSON.stringify(off.rows));
  const far = slotChangeSpec({
    title: 'Week 5', slots: [{ slot: 'QB', before: { name: 'A', v: 10 }, after: { name: 'B', v: 12 } }],
    before: 100, after: 100, shown: '0.0',
  });
  ok('two points short is NOT called rounding', far.rows[1].label !== 'Rounding', far.rows[1].label);
  // A man on a bye counts at the slot's waiver floor — that is what the lineup
  // total counts, so the line has to print it or the lines stop adding up
  // (measured on league 1241838, week 7: DJ Moore 0.0 left "+8.3" unexplained).
  const bye = slotChangeSpec({
    title: 'Week 7',
    slots: [
      { slot: 'RB1', before: { name: 'Warren', v: 13.7 }, after: { name: 'Taylor', v: 15.6 } },
      { slot: 'RB2', before: { name: 'Pollard', v: 12.6 }, after: { name: 'Warren', v: 13.7 } },
      { slot: 'WR3', before: { name: 'Smith', v: 13.0 }, after: { name: 'DJ Moore', v: 8.3, floor: true } },
      { slot: 'FLEX', before: { name: 'Rice', v: 11.3 }, after: { name: 'Pollard', v: 12.6 } },
    ],
    before: 125.4, after: 125.0, shown: '−0.4',
  });
  ok('a man counted at the waiver floor is starred, and the foot says what the star is',
    /DJ Moore 8\.3\*$/.test(bye.rows[2].label) && /^\* the waiver floor/.test(bye.foot), `${bye.rows[2].label} / ${bye.foot}`);
  eq(bye.rows.length, 4, 'and with him at the floor the lines add up: no leftover row');
  const none = slotChangeSpec({ title: 'Week 5', slots: [], before: 100, after: 100, shown: '0.0' });
  ok('no change says so', /No slot changes/.test(none.rows[0].label));

  const net = slotChangeSpec({
    title: 'Week 12', slots: [{ slot: 'QB', before: { name: 'A', v: 10 }, after: { name: 'B', v: 14.7 } }],
    before: 125.2, after: 129.9, vs: -2.0, vsName: 'Luke', shown: '+6.7',
  });
  ok('a week they meet shows his change beside the lineup’s', net.totals.length === 2 && /Luke change/.test(net.totals[1].label) &&
    /−2\.0/.test(net.totals[1].html), JSON.stringify(net.totals));
}

// ------------------------------------------------------------- 4. the goal
{
  const g = goalSpec({
    chance: 'title chance', partner: 'Luke', mine: { before: 0.024, after: 0.053 },
    theirs: { before: 0.154, after: 0.121 }, accept: 0.95,
  });
  eq(g.rows.length, 3, 'three lines');
  // Whole percent since trade audit Phase 4 (finding 10, 2026-10-15).
  eq(g.rows[0].value, '2% → 5%', 'you, now → with');
  eq(g.rows[1].label, 'Luke', 'him, by name');
  eq(g.rows[1].value, '15% → 12%', 'him, now → with');
  ok('and the chance he says yes', g.rows[2].label === 'Chance he says yes' && g.rows[2].value === '95%');
  // Since 2026-10-15 (trade audit Phase 3, "show words") the page hands the word in.
  const gw = goalSpec({ mine: { before: 0.024, after: 0.053 }, accept: 0.2, word: 'unlikely' });
  eq(gw.rows[gw.rows.length - 1].value, 'unlikely (20%)', 'the chance he says yes is the word, then its %');
  eq(g.title, 'Title chance', 'titled by the goal');
  const a = altGoalSpec({ chance: 'chance of finishing last', partner: 'Luke', before: 0.155, after: 0.098, weeks: 'weeks 5–14' });
  ok('the other goal: yours only, and it says it ranks nothing', a.rows.length === 1 && /does not rank/.test(a.foot), a.foot);
  eq(a.rows[0].value, '16% → 10%', 'the other goal in whole percent too');
}

// ------------------------------------- 4a. a season-sim chance, printed whole
//
// Trade audit finding 10 (measured): 12 seeds × 10,000 seasons moved a title
// change by 0.47 points, so "22.8% → 27.3%" claimed precision the run lacks.
// The change beside two printed ends is those ends subtracted (house rule).
{
  const cards = await import('../js/trade-cards.js');
  ok('chancePct is exported', typeof cards.chancePct === 'function' && typeof cards.chanceChange === 'function');
  const P = cards.chancePct || (() => '');
  const C = cards.chanceChange || (() => '');
  eq(P(0.228), '23%', 'a chance prints whole: 22.8% is 23%');
  eq(P(0.273), '27%', '27.3% is 27%');
  eq(P(0), '0%', 'nothing is 0%');
  eq(P(NaN), '—', 'not known is a dash');
  eq(C(0.228, 0.273), '+4%', '"23% → 27%" reads +4%, its ends subtracted (the exact change is 4.5)');
  eq(C(0.226, 0.274), '+4%', '22.6 → 27.4 is 23% → 27%: +4%, never +5%');
  eq(C(0.224, 0.226), '+1%', '22.4 → 22.6 prints 22% → 23%, so +1%');
  eq(C(0.221, 0.224), '0%', 'a change that prints the same both ends is a plain 0%, unsigned');
  eq(C(0.30, 0.21), '−9%', 'a fall carries a real minus');
  eq(C(null, 0.2), '—', 'an end not known: a dash');
}

// ------------------------------------------------- 4b. will he say yes?
//
// The yes-word's preview (trade audit Phase 3; Tim, 2026-10-14: "Rebuild, show
// words"). The verdict is js/accept.js's own, on the Allen + Charbonnet shape:
// he loses 2 a week, gets an Out RB, gives up more on ESPN's numbers.
{
  const v = acceptVerdict({
    lineupPerWeek: -2,
    gets: [{ name: 'Charbonnet', pos: 'RB', avg: 9.4, last: 0, rank: 30, status: 'OUT' },
      { name: 'Hollywood', pos: 'WR', avg: 7.1, last: 6.3, rank: 50 }],
    sends: [{ name: 'Allen', pos: 'QB', avg: 22.3, last: 19.8, rank: 3 }],
    standing: 0.6,
  });
  const y = yesSpec({ partner: 'Nolan', verdicts: [{ v }] });
  ok('one manager: a row per part of the verdict', y.rows.length >= v.parts.length && v.parts.length >= 3, JSON.stringify(y.rows));
  const val = (h) => Number(String(h).replace('−', '-'));
  const sum = Math.round(y.rows.reduce((a, r) => a + val(r.html), 0) * 10) / 10;
  ok('the parts (and Rounding) add up to "In all"', y.totals[0].label === 'In all' && Math.abs(sum - val(y.totals[0].html)) < 0.051,
    `${y.rows.map((r) => r.html).join(' ')} = ${sum} vs ${y.totals[0].html}`);
  eq(y.totals[0].html, signed(v.feel), '"In all" is the verdict’s feel, rounded then signed');
  eq(y.total.value, `${v.word} (${Math.round(v.p * 100)}%)`, 'the last line is the word and its %');
  ok('the Allen + Charbonnet shape reads unlikely', v.word === 'unlikely', v.word);
  ok('and the why is in the foot', y.foot.includes(v.why), y.foot);
  ok('a part is labelled by its own words, capitalised', y.rows.some((r) => /^He loses 2 a week$/.test(r.label)), JSON.stringify(y.rows.map((r) => r.label)));
  // Rounding: three parts of 0.04 each print 0.0 but add to 0.1.
  const tiny = { p: 0.51, word: 'maybe', why: 'about even for him', feel: 0.12,
    parts: [{ key: 'a', v: 0.04, text: 'a' }, { key: 'b', v: 0.04, text: 'b' }, { key: 'c', v: 0.04, text: 'c' }] };
  const t = yesSpec({ verdicts: [{ v: tiny }] });
  ok('tenths that miss say "Rounding"', t.rows.some((r) => r.label === 'Rounding' && r.html === '+0.1'), JSON.stringify(t.rows));
  // Several managers: each one's word, then all of them.
  const m = yesSpec({ verdicts: [{ partner: 'Nolan', v: { p: 0.7, word: 'likely' } }, { partner: 'Bo', v: { p: 0.5, word: 'maybe' } }],
    p: 0.35, word: 'maybe' });
  ok('a packing: one row a manager, and the chance they all say yes',
    m.rows.length === 2 && m.rows[0].value === 'likely (70%)' && m.total.value === 'maybe (35%)', JSON.stringify(m));
}

// ------------------------------------------------- 5. his lineup against you
{
  const o = oppSpec({ partner: 'Luke', per: [{ week: 12, delta: -2, before: 135.5, after: 133.5 }], shown: '−2.0' });
  ok('one line a meeting, now → with and the change', o.rows.length === 1 && o.rows[0].label === '135.5 → 133.5' &&
    /−2\.0/.test(o.rows[0].html), JSON.stringify(o.rows));
  eq(o.total, null, 'one meeting needs no total');
  const two = oppSpec({ partner: 'Luke', per: [{ week: 5, delta: 1, before: 100, after: 101 }, { week: 14, delta: 2, before: 100, after: 102 }], shown: '+3.0' });
  ok('two meetings end on the cell’s figure', /\+3\.0/.test(two.total.html));
  const none = oppSpec({ partner: 'Luke', per: [], why: 'You do not play him again.' });
  ok('no meeting: the reason, and no rows', none.rows.length === 0 && /do not play/.test(none.foot));
}

// ------------------------------------------------------------- 7. a manager
{
  const games = [
    { week: 1, homeId: 1, awayId: 2, homeScore: 107.5, awayScore: 118.0, played: true },
    { week: 2, homeId: 3, awayId: 1, homeScore: 99, awayScore: 120.3, played: true },
    { week: 3, homeId: 1, awayId: 4, homeScore: 101, awayScore: 101, played: true },
    { week: 5, homeId: 1, awayId: 2, homeScore: 0, awayScore: 0, played: false },
  ];
  const r = recordOf(games, 1);
  eq(r.text, '1–1–1', 'won, lost, tied — the unplayed week is not counted');
  eq(r.games, 3, 'three games');
  ok('and the average of what he scored', Math.abs(r.avg - (107.5 + 120.3 + 101) / 3) < 1e-9);
  const t = teamSpec({ name: 'Austin', record: r.text, avg: r.avg, games: r.games, week: 5, proj: 116, href: 'analysis.html?team=1#rosterDetail' });
  ok('record, average, this week’s projection', t.rows.map((x) => x.label).join('|') === 'Record|Avg score|Week 5 projected');
  ok('and the click goes to his roster', t.href === 'analysis.html?team=1#rosterDetail' && t.hrefLabel === 'Open roster');
  const m = meetSpec({ partner: 'Luke', meetings: [{ week: 3, played: true, mine: 107.5, theirs: 118 }, { week: 12, played: false, mine: 121.9, theirs: 131.6 }] });
  ok('a meeting played is a result, one to come is a projection',
    m.rows[0].value === 'Lost' && m.rows[0].label === '107.5 – 118.0' && m.rows[1].value === 'Projected', JSON.stringify(m.rows));
}

// ------------------------------------------------- 8. the words nobody wants
{
  const all = [
    gainWeeksSpec({ title: 'You gain', byWeek: [{ week: 5, before: 1, after: 2 }], reach: new Map([[5, 0.5]]), vs: new Map([[5, 1]]), shown: '+1.0', totalShown: '+1.0' }),
    slotChangeSpec({ title: 'Week 5', slots: [], before: 1, after: 2, vs: 1, shown: '+1.0' }),
    goalSpec({ mine: { before: 0.1, after: 0.2 }, theirs: { before: 0.1, after: 0.2 }, accept: 0.5 }),
    altGoalSpec({ before: 0.1, after: 0.2 }), oppSpec({ per: [{ week: 5, delta: 1 }] }),
    teamSpec({ name: 'A', record: '1–0', avg: 100, games: 1, proj: 100 }), meetSpec({ partner: 'B', meetings: [] }),
  ];
  for (const spec of all) {
    const w = wordsOf(spec);
    ok(`no SD, z-score or step wording in "${spec.title}"`, !/\bSD\b|z-score|standard deviation|step \d of \d/i.test(w), w.slice(0, 160));
  }
  eq(signed(0.04), '0.0', 'a rounded zero carries no sign');
  eq(signed(-2), '−2.0', 'a real minus sign');
}

if (fails.length) for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
