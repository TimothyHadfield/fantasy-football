// DUE BACK FROM IR — "back wk N" before, an estimate (not 0, not IR) after.
//
//   node test-ir-return.mjs
//
// Tim, 2026-11-04: "for devante adams on the app it says Est. Return 11/25/26,
// which is before week 12 If I'm not mistaken, but our cite shows the 17 week
// preview being out for the season (all weeks after week 7 IR)." Then: "yeah
// mark those weeks as back wk 12. Is there any way we could reasonably fill in
// those weeks 12+ with numbers that aren't 0 (and still reasonably accurate),
// and also make sure to not label those weeks as IR so we don't get confused?"
//
// ESPN projects an IR man 0 in EVERY week until he is activated, even with a
// return date. Davante Adams (LAR, bye 11), public league 1241838, read
// 2026-11-04: injuryStatus INJURY_RESERVE, injuryDetails.expectedReturnDate
// [2026,11,25], outForSeason false, projected 0 in weeks 7–17; his last
// healthy projection (week 6) 13.8. The current week is 9.
//
// The estimate is his last healthy projection: backtested 2026-11-04 on the
// 500 most-owned men, weeks 1–9 of 2026 (the numbers are in js/injury-gains.js).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

// js/player-card.js adds two document listeners as it loads: the smallest
// stub that lets it import (test-heat.mjs's, which can assert nothing itself).
globalThis.document = globalThis.document || {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {} }),
  body: { appendChild() {} },
};
globalThis.window = globalThis.window || {
  addEventListener() {}, location: { origin: 'http://localhost' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
globalThis.matchMedia = globalThis.matchMedia || globalThis.window.matchMedia;
globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null,
};

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const gains = await imp('js/injury-gains.js');
const card = await imp('js/player-card.js');

let pass = 0;
let fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const has = (fn, name) => ok(typeof fn === 'function', `${name} exists`);

// ------------------------------------------------------------------ fixtures
const LAR = 14;
const BYE = 11;
// LAR's 2026 kickoffs, Sundays 1:05 pm local, week 11 its bye (no game).
const kick = (y, m, d) => new Date(y, m - 1, d, 13, 5).getTime();
const KICKOFFS = { [LAR]: {
  6: kick(2026, 10, 18), 7: kick(2026, 10, 25), 8: kick(2026, 11, 1), 9: kick(2026, 11, 8),
  10: kick(2026, 11, 15), 12: kick(2026, 11, 29), 13: kick(2026, 12, 6), 14: kick(2026, 12, 13),
  15: kick(2026, 12, 20), 16: kick(2026, 12, 27), 17: kick(2027, 1, 3),
} };
const ADAMS_DETAILS = { outForSeason: false, returnDate: '2026-11-25' };
// His projections as ESPN filed them, weeks 1–17 (0 from week 7 on: IR).
const ADAMS_PROJ = { 1: 14.6, 2: 14.1, 3: 13.2, 4: 14.4, 5: 13.5, 6: 13.8 };
for (let w = 7; w <= 17; w++) ADAMS_PROJ[w] = 0;

// ---------------------------------------------------------------- the return week
eq(gains.returnWeek(ADAMS_DETAILS, KICKOFFS, LAR), 12,
  'ESPN’s Nov 25 for Adams is week 12 — LAR’s first game on or after it (11 is the bye)');
eq(gains.returnWeek({ outForSeason: true, returnDate: null }, KICKOFFS, LAR), 'season',
  'out for the season stays "season"');

// ---------------------------------------------------------------- lastHealthy
has(gains.lastHealthy, 'lastHealthy');
has(gains.fillReturnWeeks, 'fillReturnWeeks');
if (typeof gains.lastHealthy === 'function') {
  const got = gains.lastHealthy({ before: 9, projOf: (w) => ADAMS_PROJ[w], bye: BYE });
  eq(got && got.est, 13.8, 'his estimate is his last projection above 0 before the current week (week 6, 13.8)');
  eq(got && got.week, 6, '… taken from week 6');
  const need = gains.lastHealthy({ before: 9, projOf: (w) => (w >= 7 ? 0 : undefined), bye: BYE });
  eq(need && need.need, 6, 'a week not held yet is asked for, not skipped');
  const byeSkip = gains.lastHealthy({ before: 12, projOf: (w) => (w === 11 ? undefined : w === 10 ? 9.9 : 0), bye: 11 });
  eq(byeSkip && byeSkip.est, 9.9, 'his bye week is skipped, never asked for');
  eq(gains.lastHealthy({ before: 9, projOf: () => 0, bye: BYE }), null, 'no projection above 0 in reach: no estimate');
}

// ---------------------------------------------------------------- fillReturnWeeks
const adams = (w) => ({
  playerId: 16800, name: 'Davante Adams', position: 'WR', proTeamId: LAR,
  injuryStatus: 'INJURY_RESERVE', projected: ADAMS_PROJ[w], actual: null,
});
const other = { playerId: 1, name: 'Healthy Man', position: 'WR', proTeamId: 2, injuryStatus: 'ACTIVE', projected: 11.2 };
const weekTeams = (w) => {
  const a = adams(w);
  return [{ id: 3, players: [a, other], starters: [other], bench: [a] }];
};
const opts = {
  currentWeek: 9,
  backOf: (p) => (p.playerId === 16800 ? 12 : null),
  estOf: (p) => (p.playerId === 16800 ? { est: 13.8 } : null),
  byeOf: (p) => (p.proTeamId === LAR ? BYE : null),
};
if (typeof gains.fillReturnWeeks === 'function') {
  const at = (w, o = opts) => gains.fillReturnWeeks(w, weekTeams(w), o)[0];
  const t12 = at(12);
  const a12 = t12.players[0];
  eq(a12.projected, 13.8, 'week 12 (his return week): 13.8, not 0');
  eq(a12.projEst, true, '… flagged as our estimate');
  eq(a12.espnProjected, 0, '… and ESPN’s own 0 kept beside it');
  eq(a12.backWeek, 12, '… with his return week on him');
  ok(t12.bench[0] === a12, 'the bench holds the same copy the players list does');
  eq(t12.players[1], other, 'a man with no return week is not copied');
  eq(at(17).players[0].projected, 13.8, 'week 17 is filled too');
  eq(at(10).players[0].projected, 0, 'week 10, before he is back: still 0');
  eq(at(10).players[0].backWeek, 12, '… but carries "back in week 12"');
  eq(at(9).players[0].projected, 0, 'the CURRENT week is never filled (lineups count on ESPN’s number)');
  eq(at(9).players[0].projEst, undefined, '… and not flagged');
  ok(gains.fillReturnWeeks(7, weekTeams(7), opts)[0].players[0].backWeek === undefined, 'a past week carries no return week');
  const upBye = gains.fillReturnWeeks(12, weekTeams(12), { ...opts, byeOf: () => 12 })[0].players[0];
  eq(upBye.projected, 0, 'his bye week stays 0');
  const espnHas = weekTeams(13);
  espnHas[0].players[0].projected = 12.1;
  eq(gains.fillReturnWeeks(13, espnHas, opts)[0].players[0].projected, 12.1, 'ESPN’s own number above 0 wins');
  eq(gains.fillReturnWeeks(13, espnHas, opts)[0].players[0].projEst, undefined, '… and is not flagged');
  const season = gains.fillReturnWeeks(12, weekTeams(12), { ...opts, backOf: () => null })[0].players[0];
  eq(season.projected, 0, 'out for the season (no week number): untouched');
  eq(gains.fillReturnWeeks(12, weekTeams(12), { ...opts, currentWeek: null })[0].players[0].projected, 0,
    'current week unknown: nothing is touched');
}

// ---------------------------------------------------------------- how it reads
eq(card.outMark('INJURY_RESERVE', 10, 12), 'back wk 12', 'a 0 week before his return reads "back wk 12"');
eq(card.outMark('INJURY_RESERVE', 12, 12), 'IR', 'outMark itself still says IR from the return week (the zero rule decides)');
eq(card.outMark('INJURY_RESERVE'), 'IR', 'with no return week known: IR, as before');
eq(card.outMark('ACTIVE', 10, 12), '', 'a healthy man has no mark');
eq(card.zeroKind(0, { week: 12, byeWeek: BYE, injuryStatus: 'INJURY_RESERVE', backWeek: 12 }), 'zero',
  'a 0 left in his return week or later is a plain 0, never IR');
eq(card.zeroKind(0, { week: 10, byeWeek: BYE, injuryStatus: 'INJURY_RESERVE', backWeek: 12 }), 'out',
  'a 0 before it is still a ruled-out 0');
eq(card.zeroKind(0, { week: 11, byeWeek: BYE, injuryStatus: 'INJURY_RESERVE', backWeek: 12 }), 'bye',
  'his bye is a bye');
const t10 = card.projToken(0, false, { week: 10, byeWeek: BYE, injuryStatus: 'INJURY_RESERVE', backWeek: 12 });
eq(t10.mark, 'back wk 12', 'the card’s week 10 cell says back wk 12');
const t12 = card.projToken(13.8, false, { week: 12, byeWeek: BYE, injuryStatus: 'INJURY_RESERVE', backWeek: 12, est: true });
eq(t12.text, '~13.8', 'the card’s week 12 cell reads ~13.8');
eq(t12.est, true, '… marked as an estimate');
ok(!/IR/.test(t12.text) && !t12.mark, '… and never labelled IR');

// The whole card, weeks 7–17 with the current week 9.
if (typeof card.returnArgs === 'function') {
  const weeks = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const entries = weeks.map((w) => {
    const t = typeof gains.fillReturnWeeks === 'function' ? gains.fillReturnWeeks(w, weekTeams(w), opts)[0] : weekTeams(w)[0];
    return t.players[0];
  });
  const run = card.weekRun({
    heading: 'ESPN’s projection', weeks,
    projections: entries.map((e) => e.projected), actuals: weeks.map(() => null),
    currentWeek: 9, byeWeek: BYE, injuryStatus: weeks.map(() => 'INJURY_RESERVE'),
    ...card.returnArgs(entries),
  });
  const shown = run.cols.map((c) => `${c.proj.text}${c.proj.mark ? ` ${c.proj.mark}` : ''}`);
  eq(shown.join(' | '),
    '0.0 IR | 0.0 IR | 0.0 back wk 12 | 0.0 back wk 12 | Bye | ~13.8 | ~13.8 | ~13.8 | ~13.8 | ~13.8 | ~13.8',
    'Adams’ card, weeks 7–17: IR in the past, back wk 12 until then, the bye, ~13.8 after');
} else {
  ok(false, 'returnArgs exists');
}

console.log(fail ? `${fail} FAILED, ${pass} passed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
