// Tim's checklist on the Trade finder (Tim, 2026-10-31: "set up the new trade
// algorithm"; docs/trade-fit-plan.md, js/trade-fit.js).
//
//   node tr-fit-check.mjs
//
// Drives tr-test.mjs's `fitFinder` scenario (the real trade.html and
// js/trade-page.js on the stubbed live league, you = Ana) four times:
//   A. the checklist: every row passes both gates (You gain +2/wk, Value −1 or
//      better), carries a "✓ n/7" tag that opens the checklist, at most two rows
//      per manager, ordered by checks met; near misses sit under their own line
//      with the failed gate named;
//   B. an offer you sent two days ago hides the deals that share a man each way
//      with it, and the note names the manager and the day; one sent nine days
//      ago hides nothing;
//   C. Flip on: a cheap high-Value man on Cy's bench is bought for a manager
//      who is NOT Cy and needs his position, and the row says so;
//   D. Flip on, with nobody but the seller needing that position: no such row.
// Fails on the code before it (no tag, no near misses, no Flip switch).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
};

function run(env) {
  const res = spawnSync(process.execPath, ['--import', './tr-register.mjs', path.join(HERE, 'tr-test.mjs'), 'fitFinder'], {
    encoding: 'utf8', cwd: HERE, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env },
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) return { boot: `no answer (exit ${res.status}): ${String(res.stderr || '').trimEnd().split('\n').slice(-6).join(' | ')}` };
  return JSON.parse(line.slice(2));
}

const stub = await import('./tr-stub-season.mjs');
const { shortDate, LABELS } = await import(pathToFileURL(path.join(REPO, 'js', 'trade-fit.js')).href);
const DAY = 86400000;
const HOLES = { TR_SPARE_QB: '1', TR_QB_HOLES: '1' };
const id = (team, i) => stub.playerId(team, i);
const QB3 = id(1, 12); // Ana QB3 under TR_SPARE_QB
const DI_RB3 = id(4, 10);
const DI_WR4 = id(4, 11);
const CY_QB1 = id(3, 0); // projects 2 under TR_SPARE_QB: on Cy's bench
const count = (tag) => { const m = String(tag).match(/^✓ (\d)\/7$/); return m ? Number(m[1]) : null; };
const markOf = (card, label) => { const i = String(card).indexOf(label); const m = i < 0 ? null : String(card).slice(i + label.length).match(/[✓✗—]/); return m && m[0]; };
const byManager = (rows) => rows.reduce((m, r) => m.set(r.partner, (m.get(r.partner) || 0) + 1), new Map());

// ------------------------------------------------------------- A. checklist
const a = run(HOLES);
ok('A: boots clean and the list finishes', !a.boot && (a.errors || []).length === 0 && a.ranked, a.boot || JSON.stringify(a.errors));
if (!a.boot) {
  ok('A: the title says the list is ranked by your checklist', /^Trades ranked by your checklist/.test(a.title), a.title);
  ok('A: Flip and Bench value are off', !a.flipOn && !a.benchOn);
  ok('A: more than one manager has a row (so the cap is tested)', byManager(a.rows).size >= 2, JSON.stringify([...byManager(a.rows)]));
  ok('A: at most two rows per manager', [...byManager(a.rows).values()].every((n) => n <= 2), JSON.stringify([...byManager(a.rows)]));
  ok('A: every row carries a "✓ n/7" tag', a.rows.length > 0 && a.rows.every((r) => count(r.tag) !== null && r.tagCls === 'fit-tag'),
    JSON.stringify(a.rows.map((r) => r.tag)));
  ok('A: every row\'s card passes both gates', a.rows.every((r) => markOf(r.card, LABELS.you) === '✓' && markOf(r.card, LABELS.value) !== '✗'),
    JSON.stringify(a.rows.map((r) => r.card.slice(0, 120))));
  ok('A: the tag\'s count is the card\'s ticks', a.rows.every((r) => {
    const checks = ['hisWeek', 'hisGain', 'myNeed', 'hisNeed', 'diamond', 'coin', 'valueUp'];
    return checks.filter((k) => markOf(r.card, LABELS[k]) === '✓').length === count(r.tag);
  }), JSON.stringify(a.rows.map((r) => [r.tag, r.card])));
  ok('A: rows go from most checks met to fewest', a.rows.every((r, i) => i === 0 || count(a.rows[i - 1].tag) >= count(r.tag)),
    JSON.stringify(a.rows.map((r) => r.tag)));
  ok('A: the near misses sit under their own line', !a.nearHidden && a.nearLine === 'Near misses · one check short' && a.near.length > 0,
    JSON.stringify([a.nearHidden, a.nearLine, a.near.length]));
  ok('A: each near miss names the gate it missed, and its card marks it ✗', a.near.every((r) =>
    /^✗ (You gain|Value) /.test(r.tag) && / miss\b/.test(r.tagCls) &&
    markOf(r.card, r.tag.startsWith('✗ You') ? LABELS.you : LABELS.value) === '✗'),
  JSON.stringify(a.near.map((r) => [r.tag, r.tagCls])));
  ok('A: no sent note with nothing sent', a.sentNote === '', a.sentNote);
}

// ---------------------------------------------------------- B. sent offers
const now = Date.now();
const sentAt = now - 2 * DAY;
const SENT = JSON.stringify({
  v: 1, team: 1, handled: [], ended: [],
  seen: [
    { id: 's1', withTeamId: 4, get: [DI_RB3], send: [QB3], proposedAt: sentAt, expiresAt: now + 5 * DAY },
    // Nine days ago, to Cy, the same men as A's Cy rows: too old to hide them.
    { id: 's2', withTeamId: 3, get: [id(3, 9), id(3, 1)], send: [QB3, id(1, 10)], proposedAt: now - 9 * DAY, expiresAt: now + 5 * DAY },
  ],
});
const b = run({ ...HOLES, TR_SENT: SENT });
ok('B: boots clean and the list finishes', !b.boot && (b.errors || []).length === 0 && b.ranked, b.boot || JSON.stringify(b.errors));
if (!b.boot && !a.boot) {
  const diA = a.rows.filter((r) => r.partner === 'Di');
  const diB = b.rows.filter((r) => r.partner === 'Di');
  ok('B: on A, Di has a row naming RB3 (the man sent for)', diA.some((r) => /RB3/.test(r.deal)), JSON.stringify(diA.map((r) => r.deal)));
  ok('B: no Di row shares a man each way with the offer sent two days ago',
    !diB.some((r) => /RB3/.test(r.deal) && /QB3/.test(r.deal)), JSON.stringify(diB.map((r) => r.deal)));
  ok('B: the note names the manager and the day it was sent',
    b.sentNote === `Left out, close to an offer you sent: Di (sent ${shortDate(sentAt)}).`, b.sentNote);
  ok('B: an offer sent nine days ago hides nothing (Cy\'s rows as on A)',
    JSON.stringify(b.rows.filter((r) => r.partner === 'Cy').map((r) => r.deal)) === JSON.stringify(a.rows.filter((r) => r.partner === 'Cy').map((r) => r.deal)),
    JSON.stringify([a.rows.filter((r) => r.partner === 'Cy').map((r) => r.deal), b.rows.filter((r) => r.partner === 'Cy').map((r) => r.deal)]));
}

// ---------------------------------------------------------------- C/D. Flip
// Values: everyone 1.5 (a Value under 1 is never offered) but Cy's bench
// quarterback, 4, so the only deal that raises your Value by 2–4 buys him.
const BASE = {
  v: 1, setAt: 1760000000000, week: 5,
  lines: {
    QB: { waiver: 10, starter: 15, agents: 3, starters: 4 },
    RB: { waiver: 8, starter: 12, agents: 3, starters: 9 },
    WR: { waiver: 7, starter: 11, agents: 3, starters: 11 },
    TE: { waiver: 6, starter: 9, agents: 3, starters: 4 },
    K: { waiver: 6, starter: 6, agents: 3, starters: 4 },
    DST: { waiver: 5, starter: 8, agents: 3, starters: 4 },
  },
};
const players = {};
for (const team of stub.TEAMS) {
  team.players.forEach((p, i) => { players[id(team.id, i)] = { position: p.position, avg: p.mean, value: 1.5 }; });
}
players[CY_QB1] = { position: 'QB', avg: 2, value: 4 };
const WEEKS_LEFT = Array.from({ length: stub.WEEKS - stub.PLAYED_THROUGH }, (_, i) => stub.PLAYED_THROUGH + 1 + i);
const FF_VALUE = JSON.stringify({ base: BASE, weeks: WEEKS_LEFT, players });

const c = run({ ...HOLES, FF_VALUE, TF_FLIP: '1' });
ok('C: boots clean and the list finishes', !c.boot && (c.errors || []).length === 0 && c.ranked, c.boot || JSON.stringify(c.errors));
if (!c.boot) {
  ok('C: the saved Flip switch is on, Bench value off', c.flipOn && !c.benchOn);
  ok('C: the title says Flip trades', /^Flip trades/.test(c.title), c.title);
  const flips = c.rows.filter((r) => /^Flip to /.test(r.tag));
  ok('C: a row buys Cy\'s bench quarterback', flips.some((r) => r.partner === 'Cy' && /QB1/.test(r.deal)),
    JSON.stringify(c.rows.map((r) => [r.partner, r.tag, r.deal])));
  ok('C: every row says "Flip to <manager> (needs <pos>)", never to the seller',
    c.rows.length > 0 && c.rows.every((r) => /^Flip to (Bo|Di)( \+\d)? \(needs QB\)$/.test(r.tag) && / flip\b/.test(r.tagCls)),
    JSON.stringify(c.rows.map((r) => [r.partner, r.tag])));
  ok('C: its card is the Flip card: the man, his Value, and who needs him',
    flips.length > 0 && flips.every((r) => /^Flip /.test(r.card) && /his bench, Value/.test(r.card) && /needs QB/.test(r.card)),
    JSON.stringify(flips.map((r) => r.card)));
  ok('C: no near misses with Flip on', c.nearHidden && c.near.length === 0, JSON.stringify([c.nearHidden, c.near.length]));
}

// D: Di's quarterback made a 17 (TR_QB_FULL), so only Cy, the seller, is short.
const d = run({ TR_SPARE_QB: '1', TR_QB_FULL: '1', FF_VALUE, TF_FLIP: '1' });
ok('D: boots clean and the search finishes', !d.boot && (d.errors || []).length === 0 && (d.ranked || !!d.empty), d.boot || JSON.stringify([d.errors, d.empty]));
if (!d.boot) {
  ok('D: with only the seller needing a quarterback, no Flip row', d.flipOn && d.rows.length === 0,
    JSON.stringify(d.rows.map((r) => [r.partner, r.tag, r.deal])));
}

for (const f of fails) console.log(`  FAIL ${f}`);
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
