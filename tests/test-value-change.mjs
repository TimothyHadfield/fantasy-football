// Change in value (Tim, 2026-11-10): a man's Value now minus his Value off the
// projections saved as of the last week his team played — js/value-change.js.
//
//   node test-value-change.mjs
//
// The copies are the stored shape (js/proj-history.js) at a real size: ten
// squads of sixteen, `weeks` from the copy's week through 17, plus a wire.
// Every expected number is worked by hand below.

import { moduleUrl } from './repo.mjs';

const vc = await import(moduleUrl('js/value-change.js'));

let pass = 0;
let fail = 0;
function check(ok, msg) {
  if (ok) pass++;
  else { fail++; console.log(`FAIL: ${msg}`); }
}

// WR lines: waiver 8, starter 12. Value(avg) = (min(avg,12) − 8) × 0.5 + max(0, avg − 12).
const BASE = { v: 1, setAt: 0, week: 1, lines: {
  WR: { waiver: 8, starter: 12, agents: 3, starters: 30 },
  RB: { waiver: 7, starter: 11, agents: 3, starters: 30 },
} };
const STAR = 4262921;
const FA = 4430807;
const BYE = 9;
const COLS = ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'];

/** A copy as of `asOf`: 10 squads × 16 men; the star on squad 3 projected `starAt(w)`. */
function copyOf(asOf, starAt, { withStar = true, faOnWire = true } = {}) {
  const weeks = [];
  for (let w = asOf; w <= 17; w++) weeks.push(w);
  const teams = {};
  let id = 1000;
  for (let t = 1; t <= 10; t++) {
    const rows = [];
    for (let i = 0; i < 16; i++) {
      id += 1;
      rows.push([id, `Man ${id}`, i % 2 ? 'WR' : 'RB', 'MIN', i < 9 ? i : 20, 'ACTIVE', weeks.map((w) => (w === 7 ? 0 : 9 + (i % 5)))]);
    }
    teams[String(t)] = rows;
  }
  if (withStar) teams['3'][0] = [STAR, 'Star Receiver', 'WR', 'MIN', 4, 'ACTIVE', weeks.map(starAt)];
  const rec = { v: 1, leagueId: '1241838', season: 2026, week: asOf, takenAt: '2026-11-01T18:00:00.000Z', weeks, cols: COLS, teams };
  if (faOnWire) {
    rec.wireCols = [...COLS, 'ros'];
    rec.wire = [];
    for (let i = 0; i < 150; i++) rec.wire.push([i === 0 ? FA : 5000 + i, `Free ${i}`, 'WR', 'NYJ', null, 'ACTIVE', weeks.map((w, k) => (k === 0 ? 9.1 : null)), 104.5]);
  }
  return rec;
}

// Week 8's copy: 15 a week, 0 in his bye (week 9).
const COPY8 = copyOf(8, (w) => (w === BYE ? 0 : 15));
// Week 6's copy: 11 a week (an older week, never the one asked for here).
const COPY6 = copyOf(6, (w) => (w === BYE ? 0 : 11));
// Today (week 10 in play, nobody's game over): 16 a week, ruled out (0) in week 12.
const NOW_WEEKS = [10, 11, 12, 13, 14, 15, 16, 17];
const NOW = Object.fromEntries(NOW_WEEKS.map((w) => [w, w === 12 ? 0 : 16]));

// ------------------------------------------------------------ lastPlayedWeek
check(vc.lastPlayedWeek({ currentWeek: 10, byeWeek: 9 }) === 8, 'bye week 9 skipped: last played 8');
check(vc.lastPlayedWeek({ currentWeek: 10, byeWeek: 4 }) === 9, 'bye elsewhere: last played 9');
check(vc.lastPlayedWeek({ currentWeek: 10, byeWeek: 9, playedThisWeek: true }) === 10, 'game over this week: this week');
check(vc.lastPlayedWeek({ currentWeek: 10, byeWeek: 10, playedThisWeek: false }) === 9, 'bye this week: last week');
check(vc.lastPlayedWeek({ currentWeek: 1 }) === null, 'week 1 not played yet: none');
check(vc.lastPlayedWeek({ currentWeek: 2, byeWeek: 1 }) === null, 'only week before was his bye: none');
check(vc.lastPlayedWeek({ currentWeek: null }) === null, 'no current week: none');

// ------------------------------------------------------------ the change, byes skipped
{
  const res = vc.valueChange({
    base: BASE, position: 'WR', playerId: STAR, nowByWeek: NOW, nowWeeks: NOW_WEEKS,
    byeWeek: BYE, currentWeek: 10, copies: [COPY6, COPY8],
  });
  // Then: weeks 8–17, nine at 15 and the bye at the waiver line 8 -> 14.3 -> 2 + 2.3 = 4.3.
  // Now: weeks 10–17, seven at 16 and the 0 at 8 -> 15 -> 2 + 3 = 5.0.
  check(res.asOf === 8, `as of week 8 (bye 9 skipped), got ${res.asOf}`);
  check(res.then === 4.3, `value then 4.3, got ${res.then}`);
  check(res.now === 5, `value now 5.0, got ${res.now}`);
  check(res.change === 0.7, `change +0.7, got ${res.change}`);
  check(res.why === 'ok', 'why ok');
  check(vc.changeText(res.change) === '+0.7', `printed +0.7, got ${vc.changeText(res.change)}`);
  const wk = (w) => res.rows.find((r) => r.week === w);
  check(wk(8) && wk(8).then === 15 && wk(8).now === 'played', 'week 8 counted then, played since');
  check(wk(9) && wk(9).then === 0 && wk(9).now === 'played', 'week 9 (bye) counted then, gone now');
  check(wk(12) && wk(12).then === 15 && wk(12).now === 0, 'week 12: 15 -> 0');
  check(wk(10) && wk(10).then === 15 && wk(10).now === 16, 'week 10: 15 -> 16');
  check(res.rows.length === 10, `ten weeks behind it, got ${res.rows.length}`);
  const card = vc.changeCard('Star Receiver', res);
  check(card.sub === 'Since week 8: Value 4.3 → 5.0', `preview line, got "${card.sub}"`);
  check(card.total.value === '+0.7' && card.rows.length === 10, 'preview total and rows');
  check(card.rows.find((r) => r.label === 'Week 12').value === '15.0 → 0.0', 'preview row: then → now');
}

// ------------------------------------------------------------ a drop prints with a minus
{
  const down = Object.fromEntries(NOW_WEEKS.map((w) => [w, 13]));
  const res = vc.valueChange({
    base: BASE, position: 'WR', playerId: STAR, nowByWeek: down, nowWeeks: NOW_WEEKS,
    byeWeek: BYE, currentWeek: 10, copies: [COPY8],
  });
  // Now 13 -> 2 + 1 = 3.0; 3.0 − 4.3 = −1.3.
  check(res.change === -1.3 && vc.changeText(res.change) === '−1.3', `drop −1.3, got ${res.change}`);
}

// ------------------------------------------------------------ no saved copy -> null
{
  const res = vc.valueChange({
    base: BASE, position: 'WR', playerId: STAR, nowByWeek: NOW, nowWeeks: NOW_WEEKS,
    byeWeek: BYE, currentWeek: 10, copies: [COPY6],
  });
  check(res.change === null && res.why === 'noCopy' && res.asOf === 8, 'no copy of week 8: null');
  check(res.now === 5, 'value now still known');
  check(vc.changeText(res.change) === '—', 'printed as a dash');
  check(vc.whyText(res) === 'No projections were saved as of week 8.', 'says why');
}
{
  // His game this week is over: the copy asked for is week 10's, which is not held.
  const res = vc.valueChange({
    base: BASE, position: 'WR', playerId: STAR, nowByWeek: NOW, nowWeeks: NOW_WEEKS,
    byeWeek: BYE, currentWeek: 10, playedThisWeek: true, copies: [COPY8],
  });
  check(res.asOf === 10 && res.change === null && res.why === 'noCopy', 'played this week: week 10 copy wanted, none');
}
{
  const res = vc.valueChange({
    base: BASE, position: 'WR', playerId: STAR, nowByWeek: NOW, nowWeeks: NOW_WEEKS,
    byeWeek: BYE, currentWeek: 10, copies: [copyOf(8, () => 15, { withStar: false })],
  });
  check(res.change === null && res.why === 'notHeld', 'copy without him: null');
}
{
  // A free agent held only on the wire (one week, not his season): null.
  const res = vc.valueChange({
    base: BASE, position: 'WR', playerId: FA, nowByWeek: NOW, nowWeeks: NOW_WEEKS,
    byeWeek: null, currentWeek: 9, copies: [COPY8],
  });
  check(res.asOf === 8 && res.change === null && res.why === 'notHeld', 'wire-only row: null');
}

// ------------------------------------------------------------ has not played yet
{
  const res = vc.valueChange({
    base: BASE, position: 'WR', playerId: STAR, nowByWeek: NOW, nowWeeks: NOW_WEEKS,
    byeWeek: null, currentWeek: 1, copies: [COPY8],
  });
  check(res.change === null && res.why === 'notYet' && res.asOf === null, 'week 1: not played yet');
  check(vc.whyText(res) === 'His team has not played yet.', 'says not played yet');
}

// ------------------------------------------------------------ no lines -> null
{
  const res = vc.valueChange({
    base: null, position: 'WR', playerId: STAR, nowByWeek: NOW, nowWeeks: NOW_WEEKS,
    byeWeek: BYE, currentWeek: 10, copies: [COPY8],
  });
  check(res.change === null && res.why === 'noValue', 'no lines: null');
}

// ------------------------------------------------------------ rounded first, then signed
check(vc.changeText(0.04) === '0.0' && vc.changeText(-0.04) === '0.0', 'tiny change: 0.0, no sign');
check(vc.changeText(-0.06) === '−0.1' && vc.changeText(2) === '+2.0', 'signs after rounding');
check(vc.changeText(null) === '—', 'null: dash');

// ------------------------------------------------------------ copyFor
check(vc.copyFor([COPY6, COPY8], 8) === COPY8 && vc.copyFor([COPY6], 8) === null, 'copyFor');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
