// Checks js/auto-lineup.js — "Auto-set best lineup" on Notifications.
//
// Tim, 2026-10-31: "could you make a feature in the notifications setting that
// is "fix all future ESPN lineups", which basically automatically sets all my
// lineups on espn so that the players with the highest proj that week are in
// and playing and I can look over them?"
//
//   node auto-lineup-check.mjs
//
// NOTHING HERE TOUCHES ESPN. The run is handed a stubbed read, a stubbed
// `setLineup` that only records what it was asked, and an in-memory store; no
// league (not the demo, not 1241838, never 476225250) is written to.
//
// The squad is a real one's shape (as tests/test-notify.mjs): sixteen men, nine
// starting slots in ESPN's own lineupSlotIds (QB 0, RB 2, RB 2, WR 4, WR 4,
// TE 6, FLEX 23, D/ST 16, K 17), six on the bench (20) and one on IR (21).
// Every name is invented; every expected lineup is written out by hand.

import { moduleUrl } from './repo.mjs';

const A = await import(moduleUrl('js/auto-lineup.js'));
const { bestLineup, decide, sameLineup, movesText, noteFor, runAutoLineup, memoryKey, lineupOf, MOVES_LIMIT, CHECK_EVERY_MS } = A;

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17];
const COUNTS = { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1 };
const FITS = { 0: ['QB'], 2: ['RB'], 4: ['WR'], 6: ['TE'], 23: ['RB', 'WR', 'TE'], 16: ['DST'], 17: ['K'] };
const LABEL = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'BE', 21: 'IR' };
const WEEK = 9;
const ME = 4;
const CFG = { leagueId: '476225250', season: 2026, teamId: ME };
const NOW = Date.UTC(2026, 10, 1, 18, 0, 0);
const MIN = 60 * 1000;

const man = (playerId, name, position, lineupSlotId, projected, extra = {}) => ({
  playerId, name, position, proTeam: 'KC', proTeamId: 12, lineupSlotId, slot: LABEL[lineupSlotId],
  started: lineupSlotId !== 20 && lineupSlotId !== 21,
  projected, actual: null, injuryStatus: 'ACTIVE', ...extra,
});

/** The squad: a lineup that is NOT the best one (three better men on the bench). */
const squad = () => [
  man(1, 'Quinn QB', 'QB', 0, 18.2),
  man(2, 'Rory RB', 'RB', 2, 14.1),
  man(3, 'Reed RB', 'RB', 2, 6.0),          // worse than Rex on the bench
  man(4, 'Wade WR', 'WR', 4, 15.3),
  man(5, 'Walt WR', 'WR', 4, 7.2),          // worse than Wes on the bench
  man(6, 'Tate TE', 'TE', 6, 9.4),
  man(7, 'Finn WR', 'WR', 23, 5.1),         // the flex: worse than Rob on the bench
  man(8, 'Dee DST', 'DST', 16, 6.0),
  man(9, 'Kit K', 'K', 17, 8.0),
  man(10, 'Rex RB', 'RB', 20, 12.0),
  man(11, 'Wes WR', 'WR', 20, 11.5),
  man(12, 'Rob RB', 'RB', 20, 9.0),
  man(13, 'Bo QB', 'QB', 20, 16.0),
  man(14, 'Ty TE', 'TE', 20, 4.0),
  man(15, 'Will WR', 'WR', 20, 3.3),
  man(16, 'Ivan RB', 'RB', 21, 0.0, { injuryStatus: 'INJURY_RESERVE' }),
];
const byId = (players) => new Map(players.map((p) => [p.playerId, p]));

/** What ESPN's lineup would be after the moves (each must start where it says). */
function applyMoves(players, moves) {
  const at = byId(players.map((p) => ({ ...p })));
  for (const m of moves) {
    const p = at.get(m.playerId);
    if (!p || p.lineupSlotId !== m.fromSlotId) throw new Error(`move from the wrong slot: ${JSON.stringify(m)}`);
  }
  for (const m of moves) {
    const p = at.get(m.playerId);
    p.lineupSlotId = m.toSlotId;
    p.slot = LABEL[m.toSlotId];
    p.started = m.toSlotId !== 20 && m.toSlotId !== 21;
  }
  return [...at.values()];
}
/** The lineup is legal: no slot over its count, every man fits his slot. */
function legal(players) {
  const used = {};
  for (const p of players) {
    if (!p.started) continue;
    used[p.lineupSlotId] = (used[p.lineupSlotId] || 0) + 1;
    if (!(FITS[p.lineupSlotId] || []).includes(p.position)) return false;
  }
  return Object.entries(used).every(([s, n]) => n <= (COUNTS[s] || 0));
}
const startersOf = (players) => players.filter((p) => p.started).map((p) => p.playerId).sort((a, b) => a - b);
const total = (players, week = WEEK, byes = null) => players.filter((p) => p.started)
  .reduce((a, p) => a + (byes && byes[p.proTeamId] === week ? 0 : (p.projected || 0)), 0);

// =================================================================== the lineup

// ---- the highest-projection legal lineup ----------------------------------
{
  const players = squad();
  const plan = bestLineup({ players, slots: SLOTS, week: WEEK });
  const after = applyMoves(players, plan.moves);
  // By hand: QB Quinn 18.2; RB Rory 14.1, Rex 12.0; WR Wade 15.3, Wes 11.5;
  // TE Tate 9.4; FLEX Rob 9.0 (beats Walt 7.2, Reed 6.0, Finn 5.1); D/ST; K.
  eq(startersOf(after), [1, 2, 4, 6, 8, 9, 10, 11, 12], 'best: Rex, Wes and Rob in; Reed, Walt and Finn out');
  ok(legal(after), 'best: the lineup left is legal');
  eq(Math.round(total(after) * 10) / 10, 103.5, 'best: projects 103.5 (by hand)');
  eq(Math.round(plan.best * 10) / 10, 103.5, 'best: the plan says the same');
  eq(Math.round(plan.current * 10) / 10, 89.3, 'best: from 89.3 now');
  eq(plan.moves.length, 6, 'best: six moves, three out and three in (more than the old four-move limit)');
  ok(plan.moves.length <= MOVES_LIMIT, 'best: within the full-request limit');
  ok(plan.moves.every((m) => m.fromSlotId !== m.toSlotId), 'best: no move to the slot he is in');
  ok(!plan.moves.some((m) => [1, 2, 4, 6, 8, 9].includes(m.playerId)), 'best: the men who stay in do not move at all');
  eq(movesText(plan.moves, players), 'Start Rex RB (RB), Wes WR (WR), Rob RB (FLEX), bench Reed RB, Walt WR, Finn WR',
    'best: in words, who starts (his slot) and who sits');
  // Brute force over every way to pick the starters: nothing beats it.
  const free = players.filter((p) => p.lineupSlotId !== 21);
  let bestTotal = -1;
  const pickSlots = (i, used, sum) => {
    if (i === SLOTS.length) { bestTotal = Math.max(bestTotal, sum); return; }
    for (const p of free) {
      if (used.has(p.playerId) || !FITS[SLOTS[i]].includes(p.position)) continue;
      used.add(p.playerId); pickSlots(i + 1, used, sum + p.projected); used.delete(p.playerId);
    }
  };
  pickSlots(0, new Set(), 0);
  eq(Math.round(bestTotal * 10) / 10, 103.5, 'best: brute force over every legal lineup agrees');
}

// ---- bye = 0 ----------------------------------------------------------------
{
  const players = squad();
  players.find((p) => p.playerId === 10).proTeamId = 33;   // Rex: his team is on bye in week 9
  players.find((p) => p.playerId === 2).proTeamId = 33;    // and so is Rory, a starter
  const byes = { 33: WEEK };
  const plan = bestLineup({ players, slots: SLOTS, week: WEEK, byes });
  const after = applyMoves(players, plan.moves);
  ok(!after.find((p) => p.playerId === 10).started, 'bye: Rex (12.0, on bye) is not started');
  ok(!after.find((p) => p.playerId === 2).started, 'bye: Rory (14.1, on bye) is benched');
  // RB: Rob 9.0, Reed 6.0; FLEX: Walt 7.2 (WR) beats Finn 5.1 → Walt.
  eq(startersOf(after), [1, 3, 4, 5, 6, 8, 9, 11, 12], 'bye: Rob and Reed at RB, Wes in, Walt to the flex');
  ok(legal(after), 'bye: legal');
  // The same men, a week they are not on bye: they start.
  const other = bestLineup({ players, slots: SLOTS, week: WEEK + 1, byes });
  ok(applyMoves(players, other.moves).find((p) => p.playerId === 10).started, 'bye: Rex starts in a week that is not his bye');
}

// ---- locked men neither move in nor out -----------------------------------
{
  const players = squad();
  const lockedIds = new Set([3, 10]);          // Reed (starting, 6.0) and Rex (bench, 12.0) have kicked off
  const isLocked = (p) => lockedIds.has(p.playerId);
  const plan = bestLineup({ players, slots: SLOTS, week: WEEK, isLocked });
  ok(!plan.moves.some((m) => lockedIds.has(m.playerId)), 'locked: no move names a locked man');
  const after = applyMoves(players, plan.moves);
  ok(after.find((p) => p.playerId === 3).started && after.find((p) => p.playerId === 3).lineupSlotId === 2, 'locked: Reed keeps his RB slot');
  ok(!after.find((p) => p.playerId === 10).started, 'locked: Rex stays on the bench, 12.0 or not');
  // RB left: one slot beside Reed → Rory; FLEX → Rob 9.0; WR → Wes.
  eq(startersOf(after), [1, 2, 3, 4, 6, 8, 9, 11, 12], 'locked: the rest is the best around them');
  ok(legal(after), 'locked: legal');
  // Everything locked: nothing to send.
  eq(bestLineup({ players, slots: SLOTS, week: WEEK, isLocked: () => true }).moves, [], 'locked: everybody locked → no moves');
}

// ---- IR stays IR -------------------------------------------------------------
{
  const players = squad();
  players.find((p) => p.playerId === 16).projected = 40;   // a big number on an IR man
  const plan = bestLineup({ players, slots: SLOTS, week: WEEK });
  ok(!plan.moves.some((m) => m.playerId === 16), 'IR: the IR man is never moved');
  eq(plan.lineup[16], 21, 'IR: and is still on IR afterwards');
}

// ---- already the best: no moves; ties keep the man who is in -----------------
{
  const players = applyMoves(squad(), bestLineup({ players: squad(), slots: SLOTS, week: WEEK }).moves);
  eq(bestLineup({ players, slots: SLOTS, week: WEEK }).moves, [], 'already best → no moves');
  const tie = squad();
  tie.find((p) => p.playerId === 11).projected = 5.1;      // Wes on the bench ties Finn, the weakest WR in
  tie.find((p) => p.playerId === 10).projected = 5.1;      // Rex ties Finn too (and is under Reed)
  tie.find((p) => p.playerId === 12).projected = 5.1;      // Rob ties Finn
  eq(bestLineup({ players: tie, slots: SLOTS, week: WEEK }).moves, [], 'ties → the men who are in stay in');
  // One real gain beside the ties: Rex (12.0) in, Finn (5.1, the weakest) out —
  // in two moves, Reed keeping his RB slot and Rex taking the flex; the bench
  // men tied with Finn (Wes, Rob) are not brought in.
  tie.find((p) => p.playerId === 10).projected = 12.0;
  eq(bestLineup({ players: tie, slots: SLOTS, week: WEEK }).moves, [
    { playerId: 7, fromSlotId: 23, toSlotId: 20 },
    { playerId: 10, fromSlotId: 20, toSlotId: 23 },
  ], 'a gain beside ties: Rex for Finn in two moves, nobody else touched');
  // The same men in a different order of slots is not a reason to move anybody.
  const shuffled = squad().map((p) => (p.playerId === 2 ? { ...p, lineupSlotId: 23, slot: 'FLEX' }
    : p.playerId === 7 ? { ...p, lineupSlotId: 2, slot: 'RB', position: 'RB' } : p));
  const sp = bestLineup({ players: shuffled, slots: SLOTS, week: WEEK });
  ok(!sp.moves.some((m) => m.playerId === 2), 'Rory in the flex stays in the flex (fewest moves)');
}

// ---- a null projection is 0, never a reason to drop a man silently -------------
{
  const players = squad();
  players.find((p) => p.playerId === 9).projected = null;   // the only K: ESPN has nothing
  const plan = bestLineup({ players, slots: SLOTS, week: WEEK });
  eq(plan.lineup[9], 17, 'null projection: the only kicker stays in');
}

// ================================================================ his edits

{
  const players = squad();
  const plan = bestLineup({ players, slots: SLOTS, week: WEEK });
  const memory = { v: 1, week: WEEK, team: ME, lineup: plan.lineup, tried: null };
  const espn = applyMoves(players, plan.moves);
  ok(sameLineup(plan.lineup, espn), 'ESPN showing what was written is "the same"');
  eq(decide({ memory, week: WEEK, teamId: ME, players: espn }), 'run', 'still as written → run');
  const edited = applyMoves(espn, [{ playerId: 12, fromSlotId: 23, toSlotId: 20 }, { playerId: 7, fromSlotId: 20, toSlotId: 23 }]);
  eq(decide({ memory, week: WEEK, teamId: ME, players: edited }), 'hold', 'he put Finn back in the flex → hold');
  eq(decide({ memory, week: WEEK + 1, teamId: ME, players: edited }), 'run', 'a new week → run');
  eq(decide({ memory, week: WEEK, teamId: 7, players: edited }), 'run', 'another team picked as you → run');
  eq(decide({ memory: null, week: WEEK, teamId: ME, players: edited }), 'run', 'nothing remembered → run');
  // A man claimed off waivers lands on the bench: not an edit.
  const claimed = [...espn, man(17, 'New WR', 'WR', 20, 2.0)];
  eq(decide({ memory, week: WEEK, teamId: ME, players: claimed }), 'run', 'a new man on the bench is not his edit');
  const claimedIn = [...espn.filter((p) => p.playerId !== 12), man(17, 'New WR', 'WR', 23, 2.0)];
  eq(decide({ memory, week: WEEK, teamId: ME, players: claimedIn }), 'hold', 'a new man he started himself is');
}

// ================================================================== the run

function harness({ players = squad(), on = true, cfg = CFG, can = true, setResult = { ok: true }, week = WEEK } = {}) {
  const store = new Map();
  const calls = { canWrite: 0, readWeek: 0, setLineup: [] };
  const h = {
    store,
    calls,
    espn: players,
    week,
    run: (opts = {}) => runAutoLineup({
      cfg: 'cfg' in opts ? opts.cfg : cfg,
      on: 'on' in opts ? opts.on : on,
      now: opts.now ?? NOW,
      force: opts.force ?? false,
      canWrite: async () => { calls.canWrite++; return can; },
      readWeek: async () => {
        calls.readWeek++;
        return { week: h.week, players: h.espn, slots: SLOTS, byes: opts.byes || null, isLocked: opts.isLocked || (() => false) };
      },
      setLineup: async (req) => {
        calls.setLineup.push(req);
        const res = typeof setResult === 'function' ? setResult(req) : setResult;
        if (res.ok) h.espn = applyMoves(h.espn, req.moves);   // what ESPN would now show
        return res;
      },
      store: { get: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), set: (k, v) => store.set(k, JSON.stringify(v)) },
    }),
  };
  return h;
}
const KEY = memoryKey(CFG.leagueId, CFG.season, CFG.teamId);

// ---- the switch off, the sample league, no team: nothing at all ------------------
for (const [opts, why] of [
  [{ on: false }, 'the switch off'],
  [{ cfg: null }, 'the sample league (no league connected)'],
  [{ cfg: { leagueId: 'demo', season: 2026, teamId: 1 } }, 'a league id that is not a number'],
  [{ cfg: { ...CFG, teamId: null } }, 'nobody set as you'],
]) {
  const h = harness();
  const res = await h.run(opts);
  eq(res.act, 'off', `${why} → off`);
  eq([h.calls.canWrite, h.calls.readWeek, h.calls.setLineup.length], [0, 0, 0], `${why}: nothing asked, nothing read, nothing written`);
  eq(h.store.size, 0, `${why}: nothing remembered`);
}

// ---- the extension may not write here (phone, its switch off, localhost) -------
{
  const h = harness({ can: false });
  const res = await h.run();
  eq([res.act, res.reason], ['skip', 'no-write'], 'cannot write → skip');
  eq([h.calls.readWeek, h.calls.setLineup.length], [0, 0], 'cannot write: no read, no write');
}

// ---- first load of the week applies, in ONE full request -------------------------
const h = harness();
{
  const res = await h.run();
  eq(res.act, 'set', 'first load of week 9 → set');
  eq(h.calls.setLineup.length, 1, 'one request');
  const req = h.calls.setLineup[0];
  eq([req.leagueId, req.season, req.week, req.teamId, req.full], [CFG.leagueId, CFG.season, WEEK, ME, true],
    'the request: this league, season, the current week, your team, marked full');
  eq(req.moves.length, 6, 'all six moves in it');
  eq(startersOf(h.espn), [1, 2, 4, 6, 8, 9, 10, 11, 12], 'and ESPN now shows the best lineup');
  const mem = JSON.parse(h.store.get(KEY));
  eq([mem.v, mem.week, mem.team, mem.last.kind], [1, WEEK, ME, 'set'], 'remembered: week 9, your team, set');
  ok(sameLineup(mem.lineup, h.espn), 'remembered: the lineup it wrote');
  eq(mem.last.said, 'Start Rex RB (RB), Wes WR (WR), Rob RB (FLEX), bench Reed RB, Walt WR, Finn WR', 'remembered: the moves in words');
  const note = noteFor(mem, { week: WEEK, href: 'https://fantasy.espn.com/football/team?x' });
  eq([note.title, note.detail, note.level, note.action.label], ['Lineup set for week 9', mem.last.said, 'now', 'Open ESPN'],
    'the line: "Lineup set for week 9", the moves, Open ESPN');
}

// ---- a second load inside two minutes shares the first check -----------------------
{
  const res = await h.run({ now: NOW + 30 * 1000 });
  eq([res.act, res.reason], ['skip', 'recent'], 'a load 30 s later → skip');
  eq(h.calls.readWeek, 1, 'and reads nothing');
}

// ---- later the same week: still as written, nothing better → no request ---------
{
  const res = await h.run({ now: NOW + CHECK_EVERY_MS + MIN });
  eq(res.act, 'best', 'later, nothing changed → no request');
  eq(h.calls.setLineup.length, 1, 'still one request in all');
  eq(JSON.parse(h.store.get(KEY)).last.kind, 'set', 'the line still says what was set this week');
}

// ---- projections changed, ESPN still as written → re-applied ----------------------
{
  h.espn = h.espn.map((p) => (p.playerId === 7 ? { ...p, projected: 13.0 } : p));   // Finn now 13.0 on the bench
  const res = await h.run({ now: NOW + 2 * CHECK_EVERY_MS + 2 * MIN });
  eq(res.act, 'set', 'Finn jumps to 13.0 → set again');
  eq(h.calls.setLineup.length, 2, 'a second request');
  eq(h.calls.setLineup[1].moves, [
    { playerId: 12, fromSlotId: 23, toSlotId: 20 },
    { playerId: 7, fromSlotId: 20, toSlotId: 23 },
  ], 'just Rob out of the flex and Finn into it');
  eq(JSON.parse(h.store.get(KEY)).last.said, 'Start Finn WR (FLEX), bench Rob RB', 'and the line says that');
}

// ---- he changed it by hand → left alone for the week ----------------------------
{
  h.espn = applyMoves(h.espn, [{ playerId: 7, fromSlotId: 23, toSlotId: 20 }, { playerId: 15, fromSlotId: 20, toSlotId: 23 }]);
  const res = await h.run({ now: NOW + 3 * CHECK_EVERY_MS + 3 * MIN });
  eq(res.act, 'hold', 'he put Will in the flex himself → hold');
  eq(h.calls.setLineup.length, 2, 'no request');
  const mem = JSON.parse(h.store.get(KEY));
  eq(mem.last.kind, 'held', 'remembered as held');
  eq(noteFor(mem, { week: WEEK, href: null }).title, "You changed week 9's lineup; left as is", 'the line says so');
  h.espn = h.espn.map((p) => (p.playerId === 13 ? { ...p, projected: 40 } : p));   // even with a far better QB
  eq((await h.run({ now: NOW + 4 * CHECK_EVERY_MS + 4 * MIN })).act, 'hold', 'still held, however much better the bench gets');
  eq(h.calls.setLineup.length, 2, 'still no request');
}

// ---- a new week always applies --------------------------------------------------
{
  h.week = WEEK + 1;
  const res = await h.run({ now: NOW + 7 * 24 * 60 * MIN });
  eq(res.act, 'set', 'week 10, first load → set, his week-9 edit forgotten');
  eq(h.calls.setLineup.length, 3, 'one request');
  eq(h.calls.setLineup[2].week, WEEK + 1, 'for week 10');
  // Bo (40.0) in at QB for Quinn, and Finn (13.0) back in the flex for Will (3.3).
  eq(h.calls.setLineup[2].moves.map((m) => m.playerId).sort((a, b) => a - b), [1, 7, 13, 15],
    'Bo in at QB for Quinn; Finn back in the flex for Will');
  eq(noteFor(JSON.parse(h.store.get(KEY)), { week: WEEK }), null, 'the line is for the week on screen only');
  eq(noteFor(JSON.parse(h.store.get(KEY)), { week: WEEK + 1 }).title, 'Lineup set for week 10', 'week 10 has its own');
}

// ---- the switch just turned on runs at once (no two-minute wait) -----------------
{
  const g = harness();
  await g.run();
  g.espn = g.espn.map((p) => (p.playerId === 7 ? { ...p, projected: 13.0 } : p));
  eq((await g.run({ now: NOW + 10 * 1000, force: true })).act, 'set', 'force → runs inside the two minutes');
}

// ---- a write that did not go through ------------------------------------------
{
  const g = harness({ setResult: { ok: false, reason: 'locked' } });
  const res = await g.run();
  eq([res.act, res.reason], ['failed', 'locked'], 'refused → failed, with the reason');
  const mem = JSON.parse(g.store.get(KEY));
  eq(noteFor(mem, { week: WEEK }).title, "Could not set week 9's lineup", 'the line says it could not');
  eq(noteFor(mem, { week: WEEK }).detail, 'a game had started', 'and why, in a few words');
  // The next load (ESPN unchanged) tries again rather than calling it his edit.
  eq(decide({ memory: mem, week: WEEK, teamId: ME, players: g.espn }), 'run', 'unchanged after a refusal → run again');
}
{
  // A timeout that DID land: ESPN shows what was tried. That is not his edit.
  let landed = null;
  const g = harness({ setResult: (req) => { landed = req; return { ok: false, reason: 'timeout' }; } });
  await g.run();
  g.espn = applyMoves(g.espn, landed.moves);
  const mem = JSON.parse(g.store.get(KEY));
  eq(decide({ memory: mem, week: WEEK, teamId: ME, players: g.espn }), 'run', 'a timeout that landed is the auto-set’s own, not his edit');
}

// ---- already the best on the first load: no request, a short line ------------------
{
  const best = applyMoves(squad(), bestLineup({ players: squad(), slots: SLOTS, week: WEEK }).moves);
  const g = harness({ players: best });
  eq((await g.run()).act, 'best', 'already the best → best');
  eq(g.calls.setLineup.length, 0, 'no request');
  eq(noteFor(JSON.parse(g.store.get(KEY)), { week: WEEK }).title, "Week 9's lineup is already the best", 'the line says so');
}

eq(lineupOf([man(1, 'a', 'QB', 0, 1), { name: 'no id' }]), { 1: 0 }, 'lineupOf skips a man with no id');

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
