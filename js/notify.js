// NOTIFICATIONS — what needs doing for YOUR team, as a list of lines.
//
// Tim, 2026-10-11: "a notifications section which basically helps the user with
// basic instrucitons or important issues or upcoming decisions … suggested
// players to pick up, warnings for future weeks that have missing positions or
// if you're currently starting someone you shouldn't, messages on any trade
// notifications you have, or elete trade opportunities … for the easy ones like
// the weekly lineup, make it so you just have to click a button".
//
// THERE IS NO NEW MATHS IN HERE. Every line is the answer of an engine a page
// already shows, so a line can never disagree with the page its button opens:
//
//   start      js/start-sit.js `startSit`       Home's "Start A over B"
//   bad-start  js/injury.js + the bye weeks     a starter who is out or on bye
//   hole       js/forecast.js `optimalLineup`   a coming week with a slot the
//                                               best legal lineup cannot fill
//   pickup     js/waiver-gain.js `gainOf`       the Players page's Gain column
//   offer      season.fetchPendingTrades()      a trade offer waiting on ESPN
//   claim      season.fetchPendingMoves()       a waiver claim / queued move
//   trade      the deals the Trade page saved   its ranked list, with their age
//   send-later a saved custom trade's "After wk N"  once week N is played
//
// A line is `{ id, kind, level, title, detail, suggest, action }`.
//   suggest the SUGGESTED ACTION, drawn under the line (Tim, 2026-10-11: "could
//           you also show a suggested action underneath it. For example, "drop
//           ____, add ___ for 1 week" or whatever"): one short instruction that
//           names the men, or null when there is nothing honest to name. It
//           never repeats the detail, and never invents a player.
//   level   'now'  this week, acts before a kickoff
//           'pending' a move made and waiting on ESPN (claim, your offer, review)
//           'soon' a coming week
//           'idea' pick-ups and trades
//   action  `{ label, href }`, or for a lineup change
//           `{ label, href, lineup: { label, week, teamId, moves } }` where
//           `moves` is `[{ playerId, fromSlotId, toSlotId }]` in ESPN's own
//           lineupSlotIds (bench 20) and `href` is the fallback: ESPN's lineup
//           screen for that team and week.
//
//   ended      season.fetchPendingMoves().ended  an offer you sent that ended
//                                               without going through
//
// A line disappears when its cause does: there is no read mark. The one
// exception is `ended` (2026-10-22): it carries `dismiss` and goes when you
// dismiss it or follow it up (js/trade-outcome.js remembers that).
//
// Pure: no DOM, no clock (`now` comes in), no request, no storage. See
// tests/test-notify.mjs.

import { SLOT_ELIGIBILITY, SLOT_LABELS } from './espn.js';
import { startSit, hasPlayed } from './start-sit.js';
import { optimalLineup } from './forecast.js';
import { gainBase, gainOf } from './waiver-gain.js';
import { INJURY_RANK } from './injury.js';
import { playerHref, positionHref, dealHref, espnLineupHref } from './links.js';
import { describeAge } from './store.js';
import { offerDeadline, claimWhat, claimTitle, claimDetail, whenText } from './pending-view.js';

const BENCH_SLOT = 20;
const IR_SLOT = 21;

/**
 * The levels, most urgent first — the order of the list. 'pending' (2026-10-22)
 * is a move already made and waiting on ESPN: your own offer, an accepted trade
 * in review, a waiver claim. Nothing to do, but the bell counts it.
 */
export const LEVELS = ['now', 'pending', 'soon', 'idea'];

/** How many pick-ups are suggested, and how many saved deals are listed. */
export const PICKUP_MAX = 3;
export const TRADE_MAX = 3;

/** ESPN will not take more than this many moves in one lineup change. */
export const MOVES_MAX = 4;

const has = (v) => v !== null && v !== undefined;
const num = (v) => (Number.isFinite(v) ? v : 0);
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const fits = (slotId, position) => (SLOT_ELIGIBILITY[slotId] || []).includes(position);
const slotLabel = (slotId) => SLOT_LABELS[slotId] ?? String(slotId);

/** A slot as the Players page's position filter names it. */
const filterOf = (slotId) => {
  const eligible = SLOT_ELIGIBILITY[slotId] || [];
  if (eligible.length === 1) return eligible[0];
  return eligible.length ? 'FLEX' : null;
};

/** Ruled out, on IR, suspended: ESPN's worst designations (js/injury.js). */
const ruledOut = (p) => (INJURY_RANK[p && p.injuryStatus] ?? 0) === 3;

/** Why a man cannot play, in two or three words; '' when nothing is known. */
function whyNot(p, week, byes) {
  if (onBye(p, week, byes)) return 'is on bye';
  if (p.injuryStatus === 'INJURY_RESERVE') return 'is on IR';
  if (p.injuryStatus === 'SUSPENSION') return 'is suspended';
  if (ruledOut(p)) return 'is out';
  return '';
}

/**
 * Is this week his NFL team's bye? Only ever a KNOWN bye: `byes` is
 * `{ [proTeamId]: week }` (js/season.js `fetchByeWeeks`), and a team missing
 * from it is "unknown", never "no bye".
 */
export function onBye(p, week, byes) {
  if (!p || !has(week)) return false;
  if (Number.isFinite(p.byeWeek)) return p.byeWeek === Number(week);
  if (!byes || !has(p.proTeamId)) return false;
  const b = Number(byes[p.proTeamId]);
  return Number.isFinite(b) && b > 0 && b === Number(week);
}

const listNames = (men) => men.map((m) => m.name).filter(Boolean).join(', ');

/** A man as the Gain engine wants him. */
const bare = (p) => ({ playerId: p.playerId, name: p.name, position: p.position });

// ------------------------------------------------------------------ start

/**
 * The moves that make one swap on ESPN, or null when it cannot be done in
 * `MOVES_MAX` moves.
 *
 * `startSit` pairs a man coming in with a man going out only to SAY the change
 * (same position first, then whoever is left), so the man coming in does not
 * always fit the other's slot — a receiver in for a running back when the flex
 * holds a back. Then a third man moves: the starter whose slot takes the new
 * man and who himself fits the slot being emptied.
 */
export function movesFor(swap, { players = [], slots = [], isLocked = hasPlayed } = {}) {
  const inn = swap && swap.in;
  if (!inn || !has(inn.playerId)) return null;
  const from = has(inn.lineupSlotId) ? inn.lineupSlotId : BENCH_SLOT;
  const starters = (players || []).filter((p) => p && p.started && p.lineupSlotId !== IR_SLOT);
  const out = swap.out;

  if (!out) {
    // Into a slot that stands empty: the league's slots less the ones taken.
    const open = (slots || []).slice();
    for (const p of starters) {
      const i = open.indexOf(p.lineupSlotId);
      if (i >= 0) open.splice(i, 1);
    }
    const to = open.find((id) => fits(id, inn.position));
    return to === undefined ? null : [{ playerId: inn.playerId, fromSlotId: from, toSlotId: to }];
  }

  if (!has(out.playerId)) return null;
  const emptied = out.lineupSlotId;
  const bench = { playerId: out.playerId, fromSlotId: emptied, toSlotId: BENCH_SLOT };
  if (fits(emptied, inn.position)) {
    return [bench, { playerId: inn.playerId, fromSlotId: from, toSlotId: emptied }];
  }
  const via = starters.find((p) =>
    p.playerId !== out.playerId && has(p.playerId) && !isLocked(p) &&
    fits(p.lineupSlotId, inn.position) && fits(emptied, p.position));
  if (!via) return null;
  return [
    bench,
    { playerId: via.playerId, fromSlotId: via.lineupSlotId, toSlotId: emptied },
    { playerId: inn.playerId, fromSlotId: from, toSlotId: via.lineupSlotId },
  ];
}

/**
 * The moves of a swap in words: "Move A into FLEX, bench B" — every man who
 * goes into a starting slot (the new man first), then the man who comes out.
 * null without moves.
 */
function movesText(moves, players) {
  if (!moves || !moves.length) return null;
  const nameOf = new Map((players || []).map((p) => [p.playerId, p.name]));
  const into = moves.filter((m) => m.toSlotId !== BENCH_SLOT);
  const off = moves.filter((m) => m.toSlotId === BENCH_SLOT);
  if (!into.length || moves.some((m) => !nameOf.get(m.playerId))) return null;
  into.sort((a, b) => (b.fromSlotId === BENCH_SLOT) - (a.fromSlotId === BENCH_SLOT));
  const parts = into.map((m, i) => `${i ? '' : 'Move '}${nameOf.get(m.playerId)} into ${slotLabel(m.toSlotId)}`);
  for (const m of off) parts.push(`bench ${nameOf.get(m.playerId)}`);
  return parts.join(', ');
}

function startNotes({ week, teamId, league, team, slots, isLocked }) {
  const players = (team && team.players) || [];
  const s = startSit({ players, slots, isLocked });
  if (!s || s.best) return { notes: [], benched: new Set() };
  const href = espnLineupHref({ ...(league || {}), teamId, week });
  const benched = new Set();
  const notes = s.swaps.map((w) => {
    if (w.out && has(w.out.playerId)) benched.add(w.out.playerId);
    const moves = movesFor(w, { players, slots, isLocked });
    // The sample league has no ESPN page: the button shows the man instead.
    const action = href
      ? { label: 'Open ESPN', href }
      : { label: 'See him', href: playerHref(w.in.playerId) };
    if (href && moves && moves.length <= MOVES_MAX) {
      action.lineup = { label: 'Change it', week, teamId, moves };
    }
    return {
      id: `start-${w.in.playerId}-${w.out ? w.out.playerId : 0}`,
      kind: 'start',
      level: 'now',
      title: w.out ? `Start ${w.in.name} over ${w.out.name}` : `Start ${w.in.name}`,
      detail: `+${fmt1(w.points)} pts this week`,
      suggest: movesText(moves, players),
      action,
    };
  });
  return { notes, benched };
}

// -------------------------------------------------------------- bad-start

/**
 * The best man on the bench who may stand in `p`'s slot: fits it, can still be
 * moved, is not himself out or on bye, and is not already named for another
 * slot. The highest projection; null when the bench has nobody.
 */
function standIn(p, { week, team, isLocked, byes, taken }) {
  let best = null;
  for (const b of (team && team.players) || []) {
    if (!b || b.started || b.lineupSlotId === IR_SLOT || b.slot === 'IR') continue;
    if (!has(b.playerId) || !b.name || taken.has(b.playerId)) continue;
    if (!fits(p.lineupSlotId, b.position) || isLocked(b) || whyNot(b, week, byes)) continue;
    if (!best || num(b.projected) > num(best.projected)) best = b;
  }
  return best;
}

function badStartNotes({ week, team, isLocked, byes, benched }) {
  const out = [];
  const taken = new Set();
  for (const p of (team && team.players) || []) {
    if (!p || !p.started || p.lineupSlotId === IR_SLOT) continue;
    if (isLocked(p)) continue;                       // his game has started: nothing to do
    if (has(p.playerId) && benched.has(p.playerId)) continue;   // a swap line already says it
    const why = whyNot(p, week, byes);
    if (!why) continue;
    const sub = standIn(p, { week, team, isLocked, byes, taken });
    if (sub) taken.add(sub.playerId);
    out.push({
      id: `bad-${p.playerId}`,
      kind: 'bad-start',
      level: 'now',
      title: `${p.name} ${why}`,
      detail: `In your lineup at ${p.slot || slotLabel(p.lineupSlotId)}`,
      suggest: sub ? `Start ${sub.name} instead` : `Add a ${slotLabel(p.lineupSlotId)} this week`,
      action: { label: 'See him', href: playerHref(p.playerId) },
    });
  }
  return out;
}

// ------------------------------------------------------------------- hole

/**
 * The starting slots of one week the best legal lineup cannot fill: left
 * empty, or filled by a man projected 0 (a bye, a man ruled out).
 *
 * @returns {Array<{slotId:number, men:Object[]}>} one entry per kind of slot
 *   that is short; `men` are the zero-projected men standing in it.
 */
export function holesIn(players, slots) {
  const pool = (players || [])
    .filter((p) => p && p.lineupSlotId !== IR_SLOT && p.slot !== 'IR')
    .map((p) => ({ position: p.position, projected: num(p.projected), p }));
  const lineup = optimalLineup(pool, slots);
  const asked = new Map();
  for (const id of slots || []) asked.set(id, (asked.get(id) || 0) + 1);
  const out = [];
  for (const [slotId, want] of asked) {
    const here = lineup.starters.filter((s) => s.slotId === slotId);
    const real = here.filter((s) => s.projected > 0);
    if (real.length >= want) continue;
    out.push({ slotId, men: here.filter((s) => !(s.projected > 0)).map((s) => s.p) });
  }
  return out;
}

/** The coming weeks that have a hole, soonest first: the weeks whose wire is worth reading. */
export function holeWeeks({ coming = [], slots = [] } = {}) {
  return (coming || [])
    .filter((c) => c && c.players && c.players.length && holesIn(c.players, slots).length)
    .map((c) => Number(c.week))
    .sort((a, b) => a - b);
}

/**
 * Who fills a hole: the best free agent of THAT week who fits the slot, and
 * the man the Gain engine would drop for him (js/waiver-gain.js `gainOf`, as
 * for a pick-up line), priced over `fill.weeks` and the week of the hole.
 *
 * @param {Object|null} o.fill `{ byWeek: Map<week, freeAgents>, weeks, projFor, floors }`
 * @returns {{add:Object, drop:Object|null}|null} null when that week's wire was
 *   not read, or has nobody for the slot — a player is never invented
 */
function fillFor({ week, slotId, players, slots, fill, used }) {
  const agents = fill && fill.byWeek && typeof fill.byWeek.get === 'function' ? fill.byWeek.get(Number(week)) : null;
  if (!agents || !agents.length) return null;
  const held = new Set(players.map((p) => p && p.playerId));
  let add = null;
  for (const a of agents) {
    if (!a || !has(a.playerId) || !a.name || held.has(a.playerId) || used.add.has(a.playerId)) continue;
    if (!fits(slotId, a.position) || !(num(a.projected) > 0)) continue;
    if (!add || a.projected > add.projected) add = a;
  }
  if (!add) return null;
  used.add.add(add.playerId);

  // One week alone cannot say who to drop: a star on bye that week would cost
  // it nothing. With fewer than two weeks to price, nobody is named.
  const weeks = [...new Set([...(fill.weeks || []).map(Number), Number(week)])].sort((a, b) => a - b);
  let drop = null;
  if (weeks.length >= 2 && typeof fill.projFor === 'function') {
    const mine = players.filter((p) => p && has(p.playerId)).map(bare);
    const base = gainBase({ players: mine, slots, weeks, projFor: fill.projFor, floors: fill.floors || null });
    const g = gainOf(base, bare(add), { prune: false });
    if (g.drop && g.drop.name && !used.drop.has(g.drop.playerId)) {
      drop = g.drop;
      used.drop.add(drop.playerId);
    }
  }
  return { add, drop };
}

function holeNotes({ coming, slots, byes, fill }) {
  const out = [];
  const weeks = (coming || []).slice().sort((a, b) => a.week - b.week);
  for (const { week, players } of weeks) {
    if (!players || !players.length) continue;       // that week could not be read
    const used = { add: new Set(), drop: new Set() };   // two holes never name the same man
    for (const { slotId, men } of holesIn(players, slots)) {
      const label = slotLabel(slotId);
      const man = men[0] || null;
      const why = man ? whyNot(man, week, byes) || 'projects 0' : '';
      // "for 1 week" only when it IS one week: his own man is on a known bye
      // and back the week after. Anything else names the week.
      const span = man && onBye(man, week, byes) ? 'for 1 week' : `for week ${week}`;
      const f = fillFor({ week, slotId, players, slots, fill, used });
      const suggest = !f ? `Add a ${label} before week ${week}`
        : f.drop ? `Drop ${f.drop.name}, add ${f.add.name} ${span}`
          : `Add ${f.add.name} ${span}`;
      out.push({
        id: `hole-${week}-${slotId}`,
        kind: 'hole',
        level: 'soon',
        title: `Week ${week}: no ${label}`,
        detail: man ? `${man.name} ${why}` : 'Nobody on your roster fits',
        suggest,
        action: { label: 'Find one', href: positionHref(filterOf(slotId)) || 'waivers.html' },
      });
    }
  }
  return out;
}

// ----------------------------------------------------------------- pickup

/**
 * The free agents worth most to your lineup, best first: the Players page's
 * Gain, fed exactly as that page feeds it (`gainBase` once, `gainOf` per man).
 *
 * @param {Object} wire `{ weeks, pool, projFor, floors }` — the weeks priced,
 *   the free agents (`playerId`, `name`, `position`), and the projection of any
 *   man in any of those weeks
 */
export function pickups({ team, slots, wire }) {
  if (!wire || !team || !(wire.weeks || []).length) return [];
  const man = bare;
  const mine = (team.players || []).filter((p) => p && has(p.playerId)).map(man);
  if (!mine.length) return [];
  const base = gainBase({
    players: mine, slots, weeks: wire.weeks, projFor: wire.projFor, floors: wire.floors || null,
  });
  const held = new Set(mine.map((p) => p.playerId));
  const out = [];
  for (const p of wire.pool || []) {
    if (!p || !has(p.playerId) || held.has(p.playerId)) continue;
    const g = gainOf(base, man(p));
    // "+0.0 a week" is not a suggestion: the gain has to show at the figure printed.
    if (!(g.total > 0) || Math.round(g.perWeek * 10) < 1) continue;
    out.push({ player: man(p), gain: g });
  }
  out.sort((a, b) => b.gain.total - a.gain.total || a.player.playerId - b.player.playerId);
  return out.slice(0, PICKUP_MAX);
}

function pickupNotes(input) {
  return pickups(input).map(({ player, gain }) => ({
    id: `pickup-${player.playerId}`,
    kind: 'pickup',
    level: 'idea',
    title: `Pick up ${player.name}`,
    detail: `+${fmt1(gain.perWeek)} pts a week`,
    // Without a man to drop the title has already said it all.
    suggest: gain.drop && gain.drop.name ? `Drop ${gain.drop.name}, add ${player.name}` : null,
    action: { label: 'See him', href: playerHref(player.playerId) },
  }));
}

// ------------------------------------------------------------------ offer

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** " Saturday" for an expiry inside the coming six days (so a day's name means one day); else ''. */
function expiryDay(expiresAt, now) {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) return '';
  const ahead = expiresAt - now;
  if (ahead <= 0 || ahead >= 6 * 24 * 60 * 60 * 1000) return '';
  return ` ${DAYS[new Date(expiresAt).getDay()]}`;
}

function offerNotes({ offers, teams, offersAt, now }) {
  const nameOf = new Map();
  const teamName = new Map();
  for (const t of teams || []) {
    teamName.set(String(t.id), t.name);
    for (const p of t.players || []) if (has(p.playerId)) nameOf.set(String(p.playerId), p.name);
  }
  const names = (ids) => (ids || []).map((id) => nameOf.get(String(id))).filter(Boolean).join(', ');
  // On the phone an offer is as old as the last sync, and the line says so.
  const age = Number.isFinite(offersAt) ? ` · as of ${describeAge(now - offersAt)}` : '';
  const out = [];
  for (const o of Array.isArray(offers) ? offers : []) {
    if (!o || !has(o.withTeamId)) continue;
    const who = teamName.get(String(o.withTeamId)) || 'another team';
    const get = names(o.get);
    const send = names(o.send);
    const deal = get && send ? `Get ${get} for ${send}` : get ? `Get ${get}` : send ? `Send ${send}` : 'Open it to see the deal';
    // Its clock (2026-10-22): when it lapses, or when an accepted one goes through.
    const clock = offerDeadline(o, now);
    const review = o.review === true;
    // Who sent it, in the Trade page's own words (its Saved trades row).
    const sent = review ? 'Accepted' : o.fromMe ? 'Sent by you' : 'Sent to you';
    out.push({
      id: `offer-${has(o.id) ? o.id : `${o.withTeamId}-${(o.get || []).join('.')}-${(o.send || []).join('.')}`}`,
      kind: 'offer',
      // EVERY TRADE WAITING ON ESPN is a pending move, whichever way it was
      // sent (Tim, 2026-10-22: "also in the notifications setting show pending
      // trades aswell"): one Pending section, matching Trade's Saved trades.
      level: 'pending',
      title: review ? `Trade with ${who} accepted` : o.fromMe ? `Your offer to ${who}` : `Trade offer from ${who}`,
      detail: `${sent} · ${deal}` + (clock ? ` · ${clock}` : '') + age,
      // No verdict is worked out here (that is the Trade page's own search).
      // Your own offer waits on him: there is nothing for you to do.
      suggest: review || o.fromMe ? null : `Check it on Trade before it expires${expiryDay(o.expiresAt, now)}`,
      action: {
        label: 'Open it',
        href: dealHref({ with: o.withTeamId, get: o.get, send: o.send }) || 'trade.html',
      },
    });
  }
  return out;
}

// ------------------------------------------------------------------ ended

/** "Declined", "Expired", … per reason (js/trade-outcome.js). */
const ENDED_TITLE = {
  declined: (who) => `${who} declined your offer`,
  expired: (who) => `Your offer to ${who} expired`,
  vetoed: (who) => `Your trade with ${who} was vetoed`,
  gone: (who) => `Your offer to ${who} is no longer pending`,
};

/**
 * YOUR SENT OFFERS THAT ENDED WITHOUT GOING THROUGH (Tim, 2026-10-22: "If a
 * sent trade is either expired or denied, put it in the notifications section
 * where it asks the user if they want to follow up or not, or dismiss it").
 * One 'pending' line each, from `season.fetchPendingMoves().ended`: who it went
 * to, the deal, why and when it ended. Two buttons: Follow up (the deal back in
 * the Trade page's builder, kept as a saved trade) and Dismiss.
 *
 * `action` `{ label: 'Follow up', href, followUp: { id, a, b, sendA, sendB } }`
 * (a = your team, b = his; the men each side sends, as the Trade page saves
 * them) and `dismiss: id`.
 */
export function endedNotes({ ended, teams, teamId, now = Date.now() } = {}) {
  const nameOf = new Map();
  const teamName = new Map();
  for (const t of teams || []) {
    teamName.set(String(t.id), t.name);
    for (const p of t.players || []) if (has(p.playerId)) nameOf.set(String(p.playerId), p.name);
  }
  const names = (ids, kept) => (ids || [])
    .map((id, i) => nameOf.get(String(id)) || (kept && kept[i]) || '')
    .filter(Boolean).join(', ');
  const out = [];
  for (const e of Array.isArray(ended) ? ended : []) {
    if (!e || !has(e.id) || !has(e.withTeamId) || !ENDED_TITLE[e.reason]) continue;
    const who = teamName.get(String(e.withTeamId)) || 'another team';
    const get = names(e.get, e.getNames);
    const send = names(e.send, e.sendNames);
    const deal = get && send ? `Get ${get} for ${send}` : get ? `Get ${get}` : send ? `Send ${send}` : 'The deal';
    const when = whenText(e.at, now);
    out.push({
      id: `ended-${e.id}`,
      kind: 'ended',
      level: 'pending',
      title: ENDED_TITLE[e.reason](who),
      detail: deal + (when ? ` · ${e.reason === 'gone' ? 'noticed' : 'ended'} ${when}` : ''),
      suggest: 'Follow up to change it and send again, or dismiss it',
      action: {
        label: 'Follow up',
        href: dealHref({ with: e.withTeamId, get: e.get, send: e.send }) || 'trade.html',
        followUp: {
          id: String(e.id),
          a: Number(teamId),
          b: Number(e.withTeamId),
          sendA: (e.send || []).map(String),
          sendB: (e.get || []).map(String),
        },
      },
      dismiss: String(e.id),
    });
  }
  return out;
}

// ------------------------------------------------------------------ claim

/**
 * YOUR OTHER MOVES WAITING ON ESPN (Tim, 2026-10-22: "If I have a player being
 * pulled from the waivers that should show up somewhere"): one 'pending' line
 * per waiver claim, queued add or drop, or lineup change, from
 * `season.fetchPendingMoves().claims` (js/pending.js `pendingClaims`). The
 * button shows the claimed man on Players (or the man cut, for a drop).
 */
export function claimNotes({ claims, claimsAt = null, now = Date.now() } = {}) {
  const age = Number.isFinite(claimsAt) ? ` · as of ${describeAge(now - claimsAt)}` : '';
  const out = [];
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!c || !has(c.id)) continue;
    const detail = [claimWhat(c), claimDetail(c, now)].filter(Boolean).join(' · ');
    const man = has(c.add) ? c.add : has(c.drop) ? c.drop : null;
    out.push({
      id: `claim-${c.id}`,
      kind: 'claim',
      level: 'pending',
      title: claimTitle(c),
      detail: detail + age,
      suggest: null,
      action: man !== null
        ? { label: 'See him', href: playerHref(man) }
        : { label: 'Open Players', href: 'waivers.html' },
    });
  }
  return out;
}

// ------------------------------------------------------------------ trade

/**
 * The deals the Trade page saved when its ranked list last finished
 * (`ff.notes.trades.<leagueId>-<season>`), for THIS team only: another team's
 * list is nobody's suggestion here.
 */
function tradeNotes({ saved, teamId, now }) {
  const mine = saved && saved.v === 1 && String(saved.team) === String(teamId) && Array.isArray(saved.deals)
    ? saved.deals.filter((d) => d && has(d.withTeamId)).slice(0, TRADE_MAX)
    : [];
  if (!mine.length) {
    return [{
      id: 'trade-look',
      kind: 'trade',
      level: 'idea',
      title: 'Look for trades',
      detail: 'No deals found yet',
      suggest: null,
      action: { label: 'Open Trade', href: 'trade.html' },
    }];
  }
  const age = Number.isFinite(saved.at) ? `found ${describeAge(now - saved.at)}` : '';
  const unit = saved.perWeek === false ? 'pts' : 'pts a week';
  return mine.map((d, i) => {
    const get = listNames(d.get || []);
    const send = listNames(d.send || []);
    // The deal itself is the suggestion; the detail keeps why, and how old.
    const gain = Number.isFinite(d.gain) && d.gain > 0 ? `+${fmt1(d.gain)} ${unit}` : '';
    const why = [gain, age].filter(Boolean).join(' · ') || 'saved on Trade';
    return {
      id: `trade-${i}-${d.withTeamId}`,
      kind: 'trade',
      level: 'idea',
      title: `Trade with ${d.withName || 'another team'}`,
      detail: why.charAt(0).toUpperCase() + why.slice(1),
      suggest: get && send ? `Offer ${send} for ${get}` : get ? `Ask for ${get}` : send ? `Offer ${send}` : null,
      action: {
        label: 'Open it',
        href: dealHref({ with: d.withTeamId, get: (d.get || []).map((p) => p.id), send: (d.send || []).map((p) => p.id) }),
      },
    };
  });
}

// ------------------------------------------------------------- send-later

/**
 * SEND LATER (Tim, 2026-10-15: "… select after a future week so that you can
 * get a notification in the notifications menu so that you know to send that
 * trade that future week").
 *
 * The Trade page's saved custom trades (`ff.prefs` → `trade.custom`, entries
 * `{ a, b, sendA, sendB, sendAfter? }`: squad ids, the men each squad sends as
 * id strings, and the week after which to send it). One line per trade of
 * YOURS whose week has been played — `week`, the week being played next, is
 * past it. Before then nothing is listed.
 *
 * @param {Array} o.later  the saved entries, as stored
 * @param {Array} o.teams  every squad this week (names)
 */
export function sendLaterNotes({ later = [], teamId, teams = [], week } = {}) {
  if (!Array.isArray(later) || !has(teamId) || !Number.isFinite(Number(week))) return [];
  const nameOf = new Map();
  const teamName = new Map();
  for (const t of teams || []) {
    teamName.set(String(t.id), t.name);
    for (const p of t.players || []) if (has(p.playerId)) nameOf.set(String(p.playerId), p.name);
  }
  const names = (ids) => ids.map((id) => nameOf.get(String(id))).filter(Boolean).join(', ');
  const out = [];
  for (const e of later) {
    if (!e || typeof e !== 'object') continue;
    const at = Number(e.sendAfter);
    if (!has(e.sendAfter) || e.sendAfter === '' || !Number.isFinite(at) || !(Number(week) > at)) continue;
    const meA = String(e.a) === String(teamId);
    if (!meA && String(e.b) !== String(teamId)) continue;   // not a trade you can send
    const partner = meA ? e.b : e.a;
    const sendIds = ((meA ? e.sendA : e.sendB) || []).map(String);
    const getIds = ((meA ? e.sendB : e.sendA) || []).map(String);
    const send = names(sendIds);
    const get = names(getIds);
    out.push({
      id: `later-${partner}-${sendIds.slice().sort().join('.')}-${getIds.slice().sort().join('.')}`,
      kind: 'send-later',
      level: 'now',
      title: `Send your trade with ${teamName.get(String(partner)) || 'another team'}`,
      detail: `Saved for after week ${at}`,
      suggest: get && send ? `Offer ${send} for ${get}` : get ? `Ask for ${get}` : send ? `Offer ${send}` : null,
      action: {
        label: 'Open it',
        href: dealHref({ with: partner, get: getIds, send: sendIds }) || 'trade.html',
      },
    });
  }
  return out;
}

// ------------------------------------------------------------------- all

/**
 * Every line for one team, most urgent first.
 *
 * @param {Object} o
 * @param {number} o.week       the week being played next
 * @param {*} o.teamId          your team
 * @param {{leagueId, season}|null} [o.league]  for the link to ESPN; null on the sample league
 * @param {Object|null} o.team  your squad this week (js/season.js shape: `players` with
 *                              `playerId`, `position`, `lineupSlotId`, `started`, `projected`)
 * @param {Array} [o.teams]     every squad this week (names for the offers)
 * @param {number[]} o.slots    the lineupSlotIds the league starts
 * @param {(p) => boolean} [o.isLocked]  true for a man whose game has started
 * @param {Object|null} [o.byes]  `{ [proTeamId]: byeWeek }`, or null when unknown
 * @param {Array<{week, players}>} [o.coming]  your squad as read for each later week
 * @param {Object|null} [o.wire]  see `pickups`; null until the wire has been read
 * @param {Array} [o.offers]    `season.fetchPendingTrades()`
 * @param {number|null} [o.offersAt]  when the offers were read, if that is not now (a synced copy)
 * @param {Array} [o.claims]    `season.fetchPendingMoves().claims` (read with the offers)
 * @param {Array} [o.ended]     `season.fetchPendingMoves().ended` (see `endedNotes`)
 * @param {Object|null} [o.saved]  the Trade page's saved deals
 * @param {Array} [o.later]     the Trade page's saved custom trades (see `sendLaterNotes`)
 * @param {number} [o.now]      epoch ms, for the ages
 * @param {Object|null} [o.fill]  `{ byWeek: Map<week, freeAgents>, weeks, projFor, floors }`:
 *                              the wire of the weeks that have a hole, for what to do about it
 * @returns {Array<{id, kind, level, title, detail, suggest, action}>}
 */
export function buildNotes({
  week, teamId, league = null, team = null, teams = [], slots = [],
  isLocked = hasPlayed, byes = null, coming = [], wire = null, fill = null,
  offers = [], offersAt = null, claims = [], ended = [], saved = null, later = [], now = Date.now(),
} = {}) {
  if (!team) return [];
  const start = startNotes({ week, teamId, league, team, slots, isLocked });
  const all = [
    ...start.notes,
    ...badStartNotes({ week, team, isLocked, byes, benched: start.benched }),
    ...holeNotes({ coming, slots, byes, fill }),
    ...pickupNotes({ team, slots, wire }),
    // Ended offers first among the pending lines: they are the ones that ask something.
    ...endedNotes({ ended, teams, teamId, now }),
    ...offerNotes({ offers, teams, offersAt, now }),
    ...claimNotes({ claims, claimsAt: offersAt, now }),
    ...sendLaterNotes({ later, teamId, teams, week }),
    ...tradeNotes({ saved, teamId, now }),
  ];
  // Stable: within a level the lines keep the order they were made in — swaps
  // biggest first, weeks soonest first, pick-ups by Gain.
  return all
    .map((n, i) => ({ n, i }))
    .sort((a, b) => LEVELS.indexOf(a.n.level) - LEVELS.indexOf(b.n.level) || a.i - b.i)
    .map(({ n }) => n);
}

/** How many lines stand at each level: what the bell's count is made of. */
export function countNotes(notes) {
  const c = { now: 0, pending: 0, soon: 0, idea: 0 };
  for (const n of notes || []) if (n && n.level in c) c[n.level]++;
  return c;
}
