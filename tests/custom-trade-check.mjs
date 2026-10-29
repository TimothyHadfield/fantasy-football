// The Trade page's custom box, Tim's three asks of 2026-10-28:
//
//   1 "When you click "save trade" in the custome trade section, don't
//     unselect the players"
//   2 "The Red boxes by a player in the custom trade section are bigger than
//     the other boxes and too red. When you select that player, check it like
//     the other players but make the background redish instead of blue."
//   3 "Undearneath the player selectoin area in the custom trade show all past
//     trades you've made or offered with that user so you don't accidentily
//     send the same or too similar of a trade."
//
//   node custom-trade-check.mjs
//
// Part A is js/trade-history.js on its own; part B reads trade.html's rules for
// the red box (a real size is measured headless in WebKit, not here: linkedom
// has no layout); part C boots the real page on the stubbed live league
// (tr-test.mjs `customTrade`, in a child process).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fails.push(name); console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DAY = 86400000;
const T0 = Date.parse('2026-09-30T12:00:00Z');
// Shapes as the page gets them: season.js trade moves, trade-outcome.js
// `cleanEnded`, pending.js `pendingTrades`.
const MOVES = [
  { id: '901', kind: 'trade', week: 3, at: T0, teamId: 1, adds: [], drops: [], trade: { withTeamId: 2, gives: [210], gets: [111] } },
  { id: 'inferred:4:1:3', kind: 'trade', week: 4, at: T0 + 7 * DAY, teamId: 3, adds: [], drops: [], trade: { withTeamId: 1, gives: [305], gets: [103] }, inferred: true },
  { id: '902', kind: 'trade', week: 4, at: T0 + 8 * DAY, teamId: 2, adds: [], drops: [], trade: { withTeamId: 3, gives: [204], gets: [304] } },
  { id: '903', kind: 'add', week: 4, at: T0 + 8 * DAY, teamId: 1, adds: [150], drops: [111], trade: null },
];
const ENDED = [
  { id: 'e1', withTeamId: 2, get: [203], send: [106], reason: 'declined', at: T0 + 14 * DAY, proposedAt: T0 + 13 * DAY, expiresAt: null },
  { id: 'e2', withTeamId: 3, get: [302], send: [107], reason: 'expired', at: T0 + 15 * DAY, proposedAt: T0 + 12 * DAY, expiresAt: T0 + 15 * DAY },
];
const PENDING = [
  { id: 'p1', withTeamId: 2, get: [201], send: [104], proposedAt: T0 + 20 * DAY, expiresAt: T0 + 40 * DAY, fromMe: true },
  { id: 'p2', withTeamId: 3, get: [301], send: [105], proposedAt: T0 + 21 * DAY, expiresAt: T0 + 40 * DAY, fromMe: false },
];

// ------------------------------------------------------------- A: the module
let mod = null;
try { mod = await import(pathToFileURL(path.join(REPO, 'js', 'trade-history.js')).href); }
catch (err) { ok('A: js/trade-history.js loads', false, err && err.message); }
if (mod) {
  const { tradeHistory } = mod;
  const bo = tradeHistory({ moves: MOVES, ended: ENDED, pending: PENDING, a: 1, b: 2, me: 1 });
  ok('A: with Bo — his pending offer, the declined one, the trade made; nobody else\'s',
    same(bo.map((r) => r.status), ['sent', 'declined', 'traded']), JSON.stringify(bo));
  ok('A: you give / you get are from YOUR side, for each kind',
    same(bo.map((r) => [r.give, r.get]), [[['104'], ['201']], [['106'], ['203']], [['210'], ['111']]]), JSON.stringify(bo));
  ok('A: a trade carries its week; an offer its time',
    bo[2].week === 3 && bo[0].week === null && bo[0].at === T0 + 20 * DAY && bo[1].at === T0 + 13 * DAY, JSON.stringify(bo));
  const cy = tradeHistory({ moves: MOVES, ended: ENDED, pending: PENDING, a: 1, b: 3, me: 1 });
  ok('A: with Cy — a trade HE recorded is turned round to your side',
    same(cy.map((r) => [r.status, r.give, r.get]), [['received', ['105'], ['301']], ['expired', ['107'], ['302']], ['traded', ['103'], ['305']]]),
    JSON.stringify(cy));
  const other = tradeHistory({ moves: MOVES, ended: ENDED, pending: PENDING, a: 2, b: 3, me: 1 });
  ok('A: another squad in the box: only its trades, never your offers',
    same(other.map((r) => [r.status, r.give, r.get]), [['traded', ['204'], ['304']]]), JSON.stringify(other));
  ok('A: nobody traded with: empty', tradeHistory({ moves: MOVES, ended: ENDED, pending: PENDING, a: 1, b: 4, me: 1 }).length === 0);
  ok('A: no partner, or junk: empty, never throws',
    tradeHistory({ moves: MOVES, a: 1, b: null }).length === 0 &&
      tradeHistory({ moves: [null, { kind: 'trade' }, 7], ended: 'x', pending: [{}], a: 1, b: 2, me: 1 }).length === 0);
  const review = tradeHistory({ pending: [{ ...PENDING[0], review: true, fromMe: null }], a: 1, b: 2, me: 1 });
  ok('A: an accepted trade in review says so', review.length === 1 && review[0].status === 'review', JSON.stringify(review));
  const named = tradeHistory({ ended: [{ ...ENDED[0], getNames: ['Bo RB2'], sendNames: ['Ana TE1'] }], a: 1, b: 2, me: 1 });
  ok('A: an ended offer keeps the names it was saved with',
    same([named[0].giveNames, named[0].getNames], [['Ana TE1'], ['Bo RB2']]), JSON.stringify(named));
}

// ------------------------------------------------------------- B: the red box
const html = readFileSync(path.join(REPO, 'trade.html'), 'utf8');
const style = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const rulesFor = (sel) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(style))) {
    const sels = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.some((s) => s === sel || s.startsWith(`${sel}:`) || s.startsWith(`${sel}::`))) out.push({ sel: m[1].trim(), body: m[2] });
  }
  return out;
};
const past = rulesFor('.cu-man.cu-past input');
const pastBody = past.map((r) => r.body).join(';');
ok('B: the red box has its rule', past.length > 0, JSON.stringify(past));
ok('B: it is the browser\'s own checkbox — no appearance:none, so the same size and the same check as the others',
  !/appearance\s*:\s*none/.test(pastBody), pastBody);
ok('B: it sets no size, fill or drawn check of its own',
  !/(^|;)\s*(width|height|background|content)\s*:/.test(pastBody), pastBody);
ok('B: ticked, its fill is a red accent instead of the blue',
  /accent-color\s*:/.test(pastBody), pastBody);
const pastVar = (style.match(/--cu-past\s*:\s*(#[0-9a-f]{6})/i) || [])[1] || null;
const rgb = pastVar ? [1, 3, 5].map((i) => parseInt(pastVar.slice(i, i + 2), 16)) : null;
ok('B: the red is reddish and muted, not the full error red (#e0525f)',
  !!rgb && rgb[0] > rgb[1] + 60 && rgb[0] > rgb[2] + 50 && rgb[0] < 0xe0 && pastVar.toLowerCase() !== '#e0525f', pastVar);
ok('B: no drawn tick on the page is a broken glyph', !/¹3/.test(html));

// ------------------------------------------------------------- C: the page
const env = {
  ...process.env,
  TR_PAST_TRADES: JSON.stringify(MOVES),
  TR_PENDING: JSON.stringify(PENDING),
  TR_SENT: JSON.stringify({ v: 1, team: 1, seen: [], ended: ENDED, handled: [] }),
};
const res = spawnSync(process.execPath, ['--import', './tr-register.mjs', path.join(HERE, 'tr-test.mjs'), 'customTrade'], {
  encoding: 'utf8', cwd: HERE, env, maxBuffer: 64 * 1024 * 1024,
});
const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
const d = line ? JSON.parse(line.slice(2)) : null;
if (!d || d.boot) {
  ok('C: the customTrade scenario answered', false,
    d ? d.boot : `exit ${res.status}: ${String(res.stderr || '').trim().split('\n').slice(-6).join(' | ')}`);
} else {
  ok('C: boots with no errors', (d.errors || []).length === 0, JSON.stringify(d.errors));
  // 1
  ok('C1: one man ticked a side', d.save.ticks.every(Boolean), JSON.stringify(d.save));
  ok('C1: the deal was saved', d.save.rows >= 1, JSON.stringify(d.save));
  ok('C1: SAVE KEEPS THE TICKS — both men still ticked after Save',
    same(d.save.after, d.save.ticks.slice().sort()), JSON.stringify(d.save));
  ok('C1: and Save can be pressed again', d.save.saveEnabled === true, JSON.stringify(d.save));
  ok('C1: Clear still empties them', d.save.afterClear.length === 0, JSON.stringify(d.save));
  // 2: the red state is still worked out (its look is part B)
  ok('C2: the men traded with Bo are still marked', same(d.red.slice().sort(), ['111', '210']), JSON.stringify(d.red));
  // 3
  const b = d.bo;
  ok('C3: under the lists, a past-trades block for Bo', b && !b.hidden && /Bo/.test(b.title), JSON.stringify(b));
  ok('C3: its columns', b && same(b.heads, ['When', 'Status', 'You give', 'You get']), JSON.stringify(b && b.heads));
  ok('C3: Bo: pending offer, declined offer, trade made — names, not ids',
    b && same(b.rows.map((r) => r.cells.slice(1)), [
      ['Pending, sent by you', 'Ana WR2', 'Bo RB1'],
      ['Declined', 'Ana WR3', 'Bo WR1'],
      ['Traded', 'Bo WR3', 'Ana WR4'],
    ]), JSON.stringify(b && b.rows));
  ok('C3: a trade says its week', b && b.rows[2] && b.rows[2].cells[0] === 'Wk 3', JSON.stringify(b && b.rows));
  ok('C3: an offer says its date', b && b.rows[0] && /^[A-Z][a-z]{2} \d{1,2}$/.test(b.rows[0].cells[0]), JSON.stringify(b && b.rows));
  const c = d.cy;
  ok('C3: picking Cy shows Cy\'s, not Bo\'s',
    c && /Cy/.test(c.title) && same(c.rows.map((r) => r.status), ['received', 'expired', 'traded']), JSON.stringify(c));
  ok('C3: nobody traded with: one short line', d.di && !d.di.hidden && /^No trades with Di yet\.$/.test(d.di.none) && d.di.rows.length === 0,
    JSON.stringify(d.di));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
