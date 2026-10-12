// Checks js/value-measure.js — the search and the sums behind the "Value
// measurement" tool at the top of the custom trades box.
//
//   node test-value-measure.mjs
//
// Tim, 2026-10-12: "Make sure the search is smart so if you just search "cook"
// for james cook III or whatever it will still come up and whatnot."
//
// The names are real NFL players (public figures, and the search is about the
// awkward shapes real names come in); no league or manager is named.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const { searchPlayers, normName, measure } =
  await import(pathToFileURL(path.join(REPO, 'js/value-measure.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const P = (playerId, name, position, team, value) => ({ playerId, name, position, team, value });
const men = [
  P(1, 'James Cook III', 'RB', 'BUF', 3.1),
  P(2, 'Dalvin Cook', 'RB', 'FA', -0.4),
  P(3, 'Brandin Cooks', 'WR', 'DAL', 0.2),
  P(4, 'Patrick Mahomes II', 'QB', 'KC', 2.4),
  P(5, "D'Andre Swift", 'RB', 'CHI', 1.1),
  P(6, 'Amon-Ra St. Brown', 'WR', 'DET', 4.0),
  P(7, 'A.J. Brown', 'WR', 'PHI', 2.2),
  P(8, 'Kenneth Walker III', 'RB', 'SEA', 1.9),
  P(9, 'Marvin Harrison Jr.', 'WR', 'ARI', 1.4),
  P(10, 'Josh Allen', 'QB', 'BUF', 3.6),
  P(11, 'Keenan Allen', 'WR', 'LAC', null),
  P(12, 'Bills D/ST', 'D/ST', 'BUF', 0.3),
  P(13, 'José Ramírez Test', 'K', 'FA', 0.1),
  P(14, 'Jalen Coker', 'WR', 'CAR', 2.3),
  P(15, 'Braelon Allen', 'RB', 'NYJ', 0.5),
];
const names = (q, opts) => searchPlayers(men, q, opts).map((p) => p.name);

// --- Tim's own example ---------------------------------------------------
ok(names('cook')[0] === 'James Cook III', '"cook" brings up James Cook III first', names('cook'));
eq(names('cook'), ['James Cook III', 'Dalvin Cook', 'Brandin Cooks'],
  '"cook": the whole-word Cooks by Value, then the name it only starts');
eq(names('COOK '), names('cook'), 'case and stray spaces do not matter');
eq(names('james cook'), ['James Cook III'], 'both words must fit: "james cook" is one man');
eq(names('cook james'), ['James Cook III'], 'in either order');
eq(names('j cook'), ['James Cook III'], '"j cook": an initial narrows it (not Dalvin)');
eq(names('james cook iii'), ['James Cook III'], 'the suffix may be typed');
eq(names('jamescook'), ['James Cook III'], 'run together still fits');

// --- punctuation, accents, suffixes ---------------------------------------
eq(names('dandre'), ["D'Andre Swift"], 'an apostrophe left out');
eq(names("d'andre"), ["D'Andre Swift"], 'an apostrophe typed');
eq(names('aj brown'), ['A.J. Brown'], 'dots left out');
eq(names('a.j.'), ['A.J. Brown'], 'dots typed');
eq(names('st brown'), ['Amon-Ra St. Brown'], '"st brown"');
eq(names('amon ra'), ['Amon-Ra St. Brown'], 'a hyphen typed as a space');
eq(names('amon-ra'), ['Amon-Ra St. Brown'], 'a hyphen typed');
eq(names('brown'), ['Amon-Ra St. Brown', 'A.J. Brown'], 'two Browns, the higher Value first');
eq(names('mahomes'), ['Patrick Mahomes II'], 'a man with a II');
eq(names('harrison'), ['Marvin Harrison Jr.'], 'a man with a Jr.');
eq(names('jose ramirez'), ['José Ramírez Test'], 'accents left out');
eq(names('bills'), ['Bills D/ST'], 'a defence by its team name');

// --- part of a name, a slip, a position ------------------------------------
eq(names('homes'), ['Patrick Mahomes II'], 'the middle of a name');
eq(names('mahomse'), ['Patrick Mahomes II'], 'two letters swapped');
eq(names('mahoms'), ['Patrick Mahomes II'], 'a letter missing');
ok(!names('cook').includes('Jalen Coker'), 'a slipped letter is not guessed at when the word fits as typed ("cook" is not Coker)', names('cook'));
eq(names('cokre'), ['Jalen Coker'], 'and is, when nothing else fits');
eq(names('wakler'), ['Kenneth Walker III'], 'a swap inside a surname');
eq(names('allen'), ['Josh Allen', 'Braelon Allen', 'Keenan Allen'], 'a man with no Value still comes up, last');
eq(names('allen wr'), ['Keenan Allen'], 'a position narrows it');
eq(names('cook buf'), ['James Cook III'], 'an NFL team narrows it');
ok(names('rb').length === 0, 'a position alone names nobody', names('rb'));

// --- nothing, limits, exclusions --------------------------------------------
eq(names(''), [], 'nothing typed, nothing listed');
eq(names('   '), [], 'spaces are nothing typed');
eq(names('zzzz'), [], 'no such man');
eq(names('cook', { limit: 2 }), ['James Cook III', 'Dalvin Cook'], 'the limit keeps the best');
eq(names('cook', { exclude: [1] }), ['Dalvin Cook', 'Brandin Cooks'], 'a man already picked is not offered again');
eq(names('cook', { exclude: ['1'] }), ['Dalvin Cook', 'Brandin Cooks'], 'whether his id is a number or text');
eq(searchPlayers(null, 'cook'), [], 'no players is no answer, not a crash');
ok(searchPlayers(men, 'cook')[0] === men[0], 'the answer is the page’s own player object');
ok(names('a').length <= 8, 'eight at most by default');

eq(normName('Amon-Ra St. Brown'), 'amon ra st brown', 'normName: hyphen to a space, dot dropped');
eq(normName("D'Andre"), 'dandre', 'normName: apostrophe dropped');
eq(normName(null), '', 'normName: nothing is empty');

// --- the sums ------------------------------------------------------------
eq(measure([3.1, 0.2], [4.0]), { a: 3.3, b: 4, diff: -0.7 }, 'two men for one: totals and the gap');
eq(measure([2.4], [2.4]), { a: 2.4, b: 2.4, diff: 0 }, 'even is 0, never -0');
ok(Object.is(measure([0.1], [0.14]).diff, 0), 'a gap under a twentieth is a plain 0');
eq(measure([1.1, null, undefined, NaN], []), { a: 1.1, b: 0, diff: 1.1 }, 'a man with no Value adds nothing');
eq(measure([], []), { a: 0, b: 0, diff: 0 }, 'nobody on either side');
eq(measure([-0.4], [0.2]), { a: -0.4, b: 0.2, diff: -0.6 }, 'a Value below the line counts against his side');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
