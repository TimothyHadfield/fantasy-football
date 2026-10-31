// AUTO-SET BEST LINEUP — the decision, and the run with everything handed in.
//
// Tim, 2026-10-31: "could you make a feature in the notifications setting that
// is "fix all future ESPN lineups", which basically automatically sets all my
// lineups on espn so that the players with the highest proj that week are in
// and playing and I can look over them? right now I have to manually change
// them If I'm curious about it. Just a quality of life thing."
//
// ESPN TAKES A LINEUP CHANGE FOR THE CURRENT WEEK ONLY (409
// TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT; sources at the top of
// extension/lineup-guard.js). So "all future lineups" is: each week is set as
// soon as it IS the current week, on the next page load on the laptop with the
// extension. No future week is ever written.
//
// THE LINEUP. ESPN's own weekly projection, with the bye rule (0 in his NFL
// team's bye week) — never Value, never the waiver floor. Solved by the site's
// one lineup solver, js/forecast.js `optimalLineup`, over the men who can still
// move:
//   - a man whose game has started (locked) neither moves in nor out: a locked
//     starter keeps his slot, a locked bench man stays on the bench;
//   - IR stays IR;
//   - a tie keeps the man who is in: starters go into the solver first, and its
//     sort is stable, so an equal bench man never takes a starter's place;
//   - a chosen man keeps his own slot where the lineup allows it, so a lineup
//     with the same men in it moves nobody (fewest moves, `assign`).
// Nothing is sent unless the best lineup projects MORE than the one in place.
//
// RESPECTING HIS OWN EDITS. What the auto-set last wrote is remembered per
// league, season and team, for the week (`ff.autolineup.<league>-<season>-
// <team>`). On a later load in the same week it re-solves (projections move)
// only while ESPN's lineup is still the one it wrote; if he changed it by hand,
// that week is left alone. A new week always starts fresh.
//
// Pure except `runAutoLineup`, which is handed every read, write and the
// storage, so tests/auto-lineup-check.mjs runs it without a browser or ESPN.

import { optimalLineup } from './forecast.js';
import { SLOT_ELIGIBILITY, SLOT_LABELS } from './espn.js';

const BENCH_SLOT = 20;
const IR_SLOT = 21;

/** A full re-sort is one request of at most this many moves (extension 0.5.3, `full`). */
export const MOVES_LIMIT = 20;

/** Two page loads closer than this share one check (each check is one fresh roster read). */
export const CHECK_EVERY_MS = 2 * 60 * 1000;

export const memoryKey = (leagueId, season, teamId) => `ff.autolineup.${leagueId}-${season}-${teamId}`;

const has = (v) => v !== null && v !== undefined;
const num = (v) => (Number.isFinite(v) ? v : 0);
const fits = (slotId, position) => (SLOT_ELIGIBILITY[slotId] || []).includes(position);
const slotLabel = (slotId) => SLOT_LABELS[slotId] ?? String(slotId);
const onIr = (p) => p.lineupSlotId === IR_SLOT || p.slot === 'IR';
const isStarter = (p) => has(p.lineupSlotId) && p.lineupSlotId !== BENCH_SLOT && !onIr(p);

/** Is this week his NFL team's KNOWN bye? (`byes` = `{ [proTeamId]: week }`.) */
function onBye(p, week, byes) {
  if (Number.isFinite(p.byeWeek)) return p.byeWeek === Number(week);
  if (!byes || !has(p.proTeamId)) return false;
  const b = Number(byes[p.proTeamId]);
  return Number.isFinite(b) && b > 0 && b === Number(week);
}

/** His projection for the week as the lineup is judged: ESPN's, 0 on a bye, 0 when ESPN has none. */
export function projOf(p, week, byes) {
  return onBye(p, week, byes) ? 0 : num(p.projected);
}

/** `{ playerId: lineupSlotId }` for every man on the roster. */
export function lineupOf(players) {
  const out = {};
  for (const p of players || []) if (p && has(p.playerId) && has(p.lineupSlotId)) out[p.playerId] = p.lineupSlotId;
  return out;
}

/**
 * Put the chosen men into the open slots with the fewest moves: each keeps his
 * own slot when the rest can still be placed. A small search (a lineup is ten
 * men at most); null when they cannot all be placed, which the solver's own
 * choice never allows.
 */
function assign(men, open) {
  const left = new Map();
  for (const s of open) left.set(s, (left.get(s) || 0) + 1);
  const order = men.slice().sort((a, b) => breadth(a) - breadth(b));
  let best = null;
  let bestCost = Infinity;
  const pick = new Map();
  const walk = (i, cost) => {
    if (cost >= bestCost) return;
    if (i === order.length) { bestCost = cost; best = new Map(pick); return; }
    const p = order[i];
    const own = p.lineupSlotId;
    const slots = [...left.keys()].filter((s) => left.get(s) > 0 && fits(s, p.position));
    slots.sort((a, b) => (b === own) - (a === own));
    for (const s of slots) {
      left.set(s, left.get(s) - 1);
      pick.set(p.playerId, s);
      walk(i + 1, cost + (s === own ? 0 : 1));
      pick.delete(p.playerId);
      left.set(s, left.get(s) + 1);
    }
  };
  walk(0, 0);
  return best;
}
// How many kinds of slot could take him: the narrowest are placed first.
function breadth(p) {
  return Object.keys(SLOT_ELIGIBILITY).filter((s) => fits(Number(s), p.position)).length;
}

/**
 * The best legal lineup for the week, as moves from the one in place.
 *
 * @param {Object} o
 * @param {Array} o.players  his squad this week (js/season.js shape: `playerId`,
 *   `name`, `position`, `lineupSlotId`, `projected`, `proTeamId`)
 * @param {number[]} o.slots the league's starting slots (lineupSlotIds)
 * @param {number} o.week
 * @param {Object|null} [o.byes]
 * @param {(p) => boolean} o.isLocked  true for a man whose game has started
 * @returns {{moves:Array<{playerId, fromSlotId, toSlotId}>, lineup:Object,
 *   current:number, best:number}} `lineup` is the whole roster afterwards
 *   (`lineupOf` shape); no moves when nothing projects better
 */
export function bestLineup({ players = [], slots = [], week, byes = null, isLocked = () => false } = {}) {
  const roster = (players || []).filter((p) => p && has(p.playerId));
  const before = lineupOf(roster);
  const none = (current) => ({ moves: [], lineup: before, current, best: current });

  // The slots still open: the league's, less those a locked starter holds.
  const open = (slots || []).slice();
  for (const p of roster) {
    if (!isStarter(p) || !isLocked(p)) continue;
    const i = open.indexOf(p.lineupSlotId);
    if (i >= 0) open.splice(i, 1);
  }
  // Who may move: not IR, not locked. Starters first, so a tie keeps the man in.
  const free = roster.filter((p) => !onIr(p) && !isLocked(p));
  const pool = [...free.filter(isStarter), ...free.filter((p) => !isStarter(p))]
    .map((p) => ({ position: p.position, projected: projOf(p, week, byes), p }));
  const current = pool.filter((x) => isStarter(x.p)).reduce((a, x) => a + x.projected, 0);
  if (!open.length || !pool.length) return none(current);

  const solved = optimalLineup(pool, open);
  const chosen = solved.starters.map((s) => s.p);
  const best = solved.starters.reduce((a, s) => a + s.projected, 0);
  // Better, or nothing: a tie (or a rounding hair) never moves anybody.
  if (!(best > current + 1e-9)) return none(current);

  const placed = assign(chosen, open);
  if (!placed) return none(current);

  const moves = [];
  const after = { ...before };
  const picked = new Set(chosen.map((p) => p.playerId));
  // Out first, then in: ESPN takes the request whole, the order is for reading.
  for (const p of free) {
    if (isStarter(p) && !picked.has(p.playerId)) {
      moves.push({ playerId: p.playerId, fromSlotId: p.lineupSlotId, toSlotId: BENCH_SLOT });
      after[p.playerId] = BENCH_SLOT;
    }
  }
  for (const p of chosen) {
    const to = placed.get(p.playerId);
    if (to === p.lineupSlotId) continue;
    moves.push({ playerId: p.playerId, fromSlotId: p.lineupSlotId, toSlotId: to });
    after[p.playerId] = to;
  }
  if (!moves.length || moves.length > MOVES_LIMIT) return none(current);
  return { moves, lineup: after, current, best };
}

/**
 * Is ESPN's lineup still `saved` (what the auto-set wrote)? Every man in both
 * sits where it was written; a man new to the roster (a claim that came
 * through) counts only while he is on the bench or IR. A man gone from the
 * roster is not asked about.
 */
export function sameLineup(saved, players) {
  if (!saved || typeof saved !== 'object') return false;
  for (const p of players || []) {
    if (!p || !has(p.playerId)) continue;
    const was = saved[p.playerId];
    if (was === undefined) {
      if (isStarter(p)) return false;
      continue;
    }
    if (was !== p.lineupSlotId) return false;
  }
  return true;
}

/**
 * Apply, leave alone, or nothing to do.
 *
 * @param {Object|null} memory  what is remembered (see `runAutoLineup`)
 * @returns {'run'|'hold'} 'run' = work the best lineup out (first look this
 *   week, or ESPN still shows what was written); 'hold' = he changed it by hand
 */
export function decide({ memory, week, teamId, players }) {
  if (!memory || memory.v !== 1 || Number(memory.week) !== Number(week) || String(memory.team) !== String(teamId)) {
    return 'run';
  }
  if (sameLineup(memory.lineup, players) || sameLineup(memory.tried, players)) return 'run';
  return 'hold';
}

/** "Start X (WR), bench Y": who goes into the lineup (with his slot), then who comes out. */
export function movesText(moves, players) {
  const nameOf = new Map((players || []).map((p) => [p && p.playerId, p && p.name]));
  const into = (moves || []).filter((m) => m.toSlotId !== BENCH_SLOT && m.fromSlotId === BENCH_SLOT);
  const out = (moves || []).filter((m) => m.toSlotId === BENCH_SLOT);
  const parts = [
    ...into.map((m) => `${nameOf.get(m.playerId) || 'a bench man'} (${slotLabel(m.toSlotId)})`),
  ];
  const text = [];
  if (parts.length) text.push(`Start ${parts.join(', ')}`);
  if (out.length) text.push(`bench ${out.map((m) => nameOf.get(m.playerId) || 'a starter').join(', ')}`);
  // Only slots swapped between starters (an RB from RB to FLEX): say that much.
  if (!text.length && (moves || []).length) return 'Starters moved between slots';
  return text.join(', ');
}

/** Short words for a write that did not go through. */
const FAILED = {
  locked: 'a game had started',
  stale: 'ESPN moved on',
  off: 'the extension switch is off',
  'signed-out': 'signed out of ESPN',
  'bad-request': 'update the extension',
  'old-extension': 'update the extension',
  'too-many': 'update the extension',
};

/**
 * The line at the top of Notifications' "This week", or null.
 *
 * @param {Object|null} memory
 * @param {Object} o
 * @param {number} o.week     the week on screen
 * @param {string|null} o.href ESPN's lineup page for that week
 * @returns {{id, kind, level, title, detail, action}|null}
 */
export function noteFor(memory, { week, href = null } = {}) {
  const last = memory && memory.v === 1 && memory.last;
  if (!last || Number(memory.week) !== Number(week)) return null;
  const action = href ? { label: 'Open ESPN', href } : null;
  const base = { id: `auto-lineup-${week}`, kind: 'auto-lineup', level: 'now', action };
  if (last.kind === 'set') return { ...base, title: `Lineup set for week ${week}`, detail: last.said || '' };
  if (last.kind === 'held') return { ...base, title: `You changed week ${week}'s lineup; left as is`, detail: '' };
  if (last.kind === 'best') return { ...base, title: `Week ${week}'s lineup is already the best`, detail: '' };
  if (last.kind === 'failed') {
    return { ...base, title: `Could not set week ${week}'s lineup`, detail: FAILED[last.reason] || '' };
  }
  return null;
}

/**
 * ONE RUN: called on a page load on the laptop with the extension.
 *
 * @param {Object} d
 * @param {{leagueId, season, teamId}|null} d.cfg  null on the sample league
 * @param {boolean} d.on               the switch on Notifications
 * @param {() => Promise<boolean>} d.canWrite   `bridge.canSetLineup`
 * @param {() => Promise<{week, players, slots, byes, isLocked}|null>} d.readWeek
 *   the CURRENT week, his squad as ESPN has it now (a fresh read)
 * @param {(req) => Promise<{ok, reason?}>} d.setLineup  `bridge.setLineup`
 * @param {{get:(k)=>any, set:(k,v)=>void}} d.store  localStorage, JSON in and out
 * @param {number} [d.now]
 * @param {boolean} [d.force]  skip the two-minute spacing (the switch was just turned on)
 * @returns {Promise<{act:string, reason?:string, moves?:Array}>} act = 'off' |
 *   'skip' | 'hold' | 'best' | 'set' | 'failed'
 */
export async function runAutoLineup(d) {
  const { cfg, on, canWrite, readWeek, setLineup, store, now = Date.now(), force = false } = d || {};
  // Never on the sample league, never without a team, never with the switch off.
  if (!on || !cfg || !has(cfg.leagueId) || !/^\d+$/.test(String(cfg.leagueId)) || !has(cfg.teamId)) {
    return { act: 'off' };
  }
  const key = memoryKey(cfg.leagueId, cfg.season, cfg.teamId);
  let memory = null;
  try { memory = store.get(key); } catch { memory = null; }
  if (!force && memory && Number.isFinite(memory.checkedAt) && now - memory.checkedAt >= 0 &&
      now - memory.checkedAt < CHECK_EVERY_MS) {
    return { act: 'skip', reason: 'recent' };
  }
  let allowed = false;
  try { allowed = (await canWrite()) === true; } catch { allowed = false; }
  if (!allowed) return { act: 'skip', reason: 'no-write' };

  let wk = null;
  try { wk = await readWeek(); } catch { wk = null; }
  if (!wk || !has(wk.week) || !Array.isArray(wk.players) || !wk.players.length) return { act: 'skip', reason: 'no-read' };
  const { week, players, slots, byes = null, isLocked = () => false } = wk;

  const fresh = !memory || memory.v !== 1 || Number(memory.week) !== Number(week) || String(memory.team) !== String(cfg.teamId);
  const prior = fresh ? null : memory;
  const keep = (rec) => { try { store.set(key, rec); } catch { /* storage refused: next load asks again */ } };
  const rec = (patch) => ({
    v: 1, week: Number(week), team: cfg.teamId, checkedAt: now,
    lineup: prior ? prior.lineup : lineupOf(players), tried: prior ? prior.tried || null : null,
    last: prior ? prior.last || null : null,
    ...patch,
  });

  if (decide({ memory, week, teamId: cfg.teamId, players }) === 'hold') {
    keep(rec({ last: { kind: 'held', at: now } }));
    return { act: 'hold' };
  }

  const plan = bestLineup({ players, slots, week, byes, isLocked });
  if (!plan.moves.length) {
    // Already the best: this lineup is the one to watch for his edits.
    const last = prior && prior.last && prior.last.kind === 'set' ? prior.last : { kind: 'best', at: now };
    keep(rec({ lineup: lineupOf(players), tried: null, last }));
    return { act: 'best' };
  }

  let res = null;
  try {
    res = await setLineup({
      leagueId: cfg.leagueId, season: cfg.season, week: Number(week), teamId: Number(cfg.teamId),
      moves: plan.moves, full: true,
    });
  } catch { res = { ok: false, reason: 'network' }; }

  if (res && res.ok) {
    keep(rec({ lineup: plan.lineup, tried: null, last: { kind: 'set', at: now, said: movesText(plan.moves, players) } }));
    return { act: 'set', moves: plan.moves };
  }
  // Not known to have landed (a timeout may have): what was tried also counts
  // as the auto-set's own, so finding it on ESPN next time is not "his edit".
  const reason = (res && res.reason) || 'unknown';
  keep(rec({ tried: plan.lineup, last: { kind: 'failed', at: now, reason } }));
  return { act: 'failed', reason, moves: plan.moves };
}
