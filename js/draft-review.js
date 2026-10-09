// The draft, looked back on: what each pick is worth now, against where he went.
//
// Tim, 2026-10-08: "I also want to expand the draft section to show what our
// draft looked like and allow the user to select a specific user and see which
// big misses or steals they had based on current season proj and information."
//
// Pure functions only — no DOM, no fetching (tests/test-draft-review.mjs).
// js/draft-page.js reads the draft and the weeks and draws what these return.
//
// THE THREE NUMBERS ON A PICK
//
//   drafted at   his overall pick. In an AUCTION there is no pick order worth
//                the name (it is the order men were put up for bidding), so it
//                is his PRICE'S rank: the dearest man is 1, and men who cost
//                the same share the middle of the places they fill.
//   worth now    his place among everyone drafted if the same men were drafted
//                again today, by value (below).
//   difference   drafted at − worth now. Above zero he went later than he is
//                worth (a steal); below zero, earlier (a miss).
//
// THE OTHER COMPARISON (Tim, 2026-10-08: "instead of showing where the players
// should have been drafted, show where they were drafted relative to where they
// were ranked at the start of the season. for example if Jahmar gibbs was
// drafted 5th, then his number should show +4, because he was ranked #1 at the
// start of the season. If a player was drafted earlier than they were ranked
// then put it negative (-)"):
//
//   preseason    his place among everyone drafted by ESPN's own draft rank
//                (`draftRanksByRankType.PPR.rank`, which ESPN sets before the
//                season). AMONG THE MEN DRAFTED, not ESPN's number itself:
//                measured on league 1241838, its ranks run to 981 (16 of the
//                170 drafted are past 250 — every kicker and defence), so a
//                defence taken 140th would read −380. Gibbs is ESPN's 1 and
//                the first of the drafted either way.
//   difference   drafted at − preseason (`preDiff`). Above zero he went later
//                than he was ranked; below zero, earlier.
//
// VALUE is his season as it stands — points scored in the weeks that are over
// plus ESPN's projection for every week left — MINUS THE BAR AT HIS POSITION,
// so a quarterback's bigger totals do not make every quarterback a steal.
//
// THE BAR comes off the league's own lineup, the way js/trade.js sets its
// replacement level: fill every starting slot in the league with the best men
// drafted (the league's slots, once per team — `optimalLineup`), and whoever is
// left at a position is its backups. The bar is THE MIDDLE BACKUP (the better
// of the two when there are two): the man who would really take a starter's
// place.
//
// Why not the BEST backup, which is js/trade.js's bar exactly? Measured on the
// real league this was written against (1241838, 170 picks, 2026-10-08):
// against the best backup every starter is above zero and every backup below
// it, so the twenty kickers and defences that start rank 41st to 107th — and,
// having cost a dollar each, 8 of the 20 biggest "steals" in the league were
// kickers and defences. Against the middle backup a bench running back is
// worth more than a kicker, as he is in any real draft: they rank 78th to
// 138th, and 2 of the 20 are defences (the two best ones). Both bars are
// returned (`bar`, `starterBar`), and `against` picks one.

import { optimalLineup } from './forecast.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ------------------------------------------------------------------ the draft

/**
 * ESPN's `mDraftDetail` payload, as the picks the page draws.
 *
 * @returns {{ type:'snake'|'auction', done:boolean, order:number[],
 *   picks:Array<{overall:number, round:number, roundPick:number, teamId:number,
 *   playerId:number, bid:number|null, keeper:boolean}> }}
 *   `picks` in pick order; `order` is the teams left to right (a snake's first
 *   round; an auction's `pickOrder`). A pick nobody has made yet is left out.
 */
export function parseDraft(raw) {
  const dd = (raw && raw.draftDetail) || {};
  const settings = (raw && raw.settings && raw.settings.draftSettings) || {};
  const list = Array.isArray(dd.picks) ? dd.picks : [];
  const said = String(settings.type || '').toUpperCase();
  const type = said === 'AUCTION' || (!said && list.some((p) => Number(p && p.bidAmount) > 0))
    ? 'auction' : 'snake';

  const picks = list
    .filter((p) => p && Number(p.teamId) > 0 && Number(p.overallPickNumber) > 0 &&
      Number.isFinite(Number(p.playerId)) && Number(p.playerId) !== 0)
    .map((p) => ({
      overall: Number(p.overallPickNumber),
      round: Number(p.roundId) || 0,
      roundPick: Number(p.roundPickNumber) || 0,
      teamId: Number(p.teamId),
      playerId: Number(p.playerId),
      bid: type === 'auction' ? (Number(p.bidAmount) || 0) : null,
      keeper: p.keeper === true,
    }))
    .sort((a, b) => a.overall - b.overall);

  const seen = [];
  for (const p of picks) if (!seen.includes(p.teamId)) seen.push(p.teamId);
  const listed = type === 'auction' && Array.isArray(settings.pickOrder)
    ? settings.pickOrder.map(Number).filter((id) => seen.includes(id)) : [];
  const order = [...listed, ...seen.filter((id) => !listed.includes(id))];

  return { type, done: dd.drafted === true, order, picks };
}

/**
 * Where each man was drafted: `Map<playerId, number>`.
 * A snake: his overall pick. An auction: his price's rank (see the top).
 */
export function draftedAt(picks, type) {
  const out = new Map();
  if (type !== 'auction') {
    for (const p of picks || []) out.set(p.playerId, p.overall);
    return out;
  }
  const byPrice = (picks || []).slice().sort((a, b) => b.bid - a.bid || a.overall - b.overall);
  for (let i = 0; i < byPrice.length;) {
    let j = i;
    while (j + 1 < byPrice.length && byPrice[j + 1].bid === byPrice[i].bid) j++;
    // Places i+1 … j+1 are shared: everyone in them stands at their middle.
    const at = Math.round((i + 1 + j + 1) / 2);
    for (let k = i; k <= j; k++) out.set(byPrice[k].playerId, at);
    i = j + 1;
  }
  return out;
}

/**
 * Each drafted man's place among the men drafted, by ESPN's preseason rank:
 * `Map<playerId, number>`, 1 the best ranked. Equal ranks go in pick order; a
 * man ESPN did not rank (no rank, or 0) has no place.
 *
 * @param {Array} picks
 * @param {Map<number, number>|Object<number, number>|null} ranks playerId -> ESPN's rank
 */
export function preseasonPlaces(picks, ranks) {
  const get = (id) => {
    const v = ranks instanceof Map ? ranks.get(id) ?? ranks.get(String(id)) : ranks ? ranks[id] : null;
    return num(v) !== null && v > 0 ? v : null;
  };
  const ranked = (picks || []).map((p) => ({ p, rank: get(p.playerId) })).filter((x) => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.p.overall - b.p.overall);
  const out = new Map();
  ranked.forEach((x, i) => out.set(x.p.playerId, { place: i + 1, rank: x.rank }));
  return out;
}

/**
 * The board: one column a team (in `order`), one row a round.
 *
 * Row r of a column is that team's r-th pick — in a snake that IS round r; in
 * an auction it is the r-th dearest man it bought.
 *
 * @returns {{ teamIds:number[], rows:Array<Array<object|null>> }} `rows[r][c]`
 *   is the pick (one of `picks`' own objects) or null where a team has fewer.
 */
export function boardOf(draft) {
  const cols = new Map(draft.order.map((id) => [id, []]));
  for (const p of draft.picks) {
    if (!cols.has(p.teamId)) cols.set(p.teamId, []);
    cols.get(p.teamId).push(p);
  }
  if (draft.type === 'auction') {
    for (const list of cols.values()) list.sort((a, b) => b.bid - a.bid || a.overall - b.overall);
  }
  const teamIds = [...cols.keys()];
  const depth = Math.max(0, ...teamIds.map((id) => cols.get(id).length));
  const rows = Array.from({ length: depth }, (_, r) => teamIds.map((id) => cols.get(id)[r] || null));
  return { teamIds, rows };
}

// ------------------------------------------------------------- a man's season

/**
 * One man's season as it stands.
 *
 * @param {Object<number, {counts:number|null, done:boolean}>} byWeek what each
 *   week counts for him and whether it is behind him. A week with no entry
 *   counts nothing.
 * @param {number[]} weeks every week of the season
 * @returns {{ soFar:number, rest:number, total:number }}
 */
export function seasonOf(byWeek, weeks) {
  let soFar = 0;
  let rest = 0;
  for (const w of weeks || []) {
    const e = byWeek && byWeek[w];
    const v = e ? num(e.counts) : null;
    if (v === null) continue;
    if (e.done) soFar += v; else rest += v;
  }
  return { soFar, rest, total: soFar + rest };
}

// -------------------------------------------------------------------- the bar

/** The league's lineup from the lineups in use: the most of each slot any team starts. */
export function slotsFromLineups(teams) {
  const most = new Map();
  for (const t of teams || []) {
    const mine = new Map();
    for (const p of t.players || []) {
      if (!p.started) continue;
      mine.set(p.lineupSlotId, (mine.get(p.lineupSlotId) || 0) + 1);
    }
    for (const [slot, n] of mine) if (n > (most.get(slot) || 0)) most.set(slot, n);
  }
  const slots = [];
  for (const [slot, n] of [...most].sort((a, b) => a[0] - b[0])) {
    for (let i = 0; i < n; i++) slots.push(Number(slot));
  }
  return slots;
}

/**
 * The bar at each position — see "THE BAR" at the top.
 *
 * @param {Array<{position:string, total:number}>} pool everyone drafted
 * @param {number[]} slots ONE team's starting lineup, as lineupSlotIds
 * @param {number} teams how many teams fill it
 * @returns {Map<string, {bar:number, starterBar:number, starters:number, backups:number}>}
 *   `starterBar` is the best backup (js/trade.js's bar); with no backup at all
 *   both bars are the worst starter, as there.
 */
export function leagueBars(pool, slots, teams) {
  const men = (pool || []).filter((p) => p && p.position && num(p.total) !== null);
  const league = [];
  for (let i = 0; i < teams; i++) league.push(...(slots || []));
  const starting = new Map();
  for (const s of optimalLineup(men.map((p) => ({ position: p.position, projected: p.total })), league).starters) {
    starting.set(s.position, (starting.get(s.position) || 0) + 1);
  }

  const byPos = new Map();
  for (const p of men) {
    if (!byPos.has(p.position)) byPos.set(p.position, []);
    byPos.get(p.position).push(p.total);
  }
  const out = new Map();
  for (const [position, totals] of byPos) {
    totals.sort((a, b) => b - a);
    const n = Math.min(starting.get(position) || 0, totals.length);
    const backups = totals.slice(n);
    const worstStarter = totals[totals.length - 1];
    out.set(position, {
      bar: backups.length ? backups[Math.floor((backups.length - 1) / 2)] : worstStarter,
      starterBar: backups.length ? backups[0] : worstStarter,
      starters: n,
      backups: backups.length,
    });
  }
  return out;
}

// ----------------------------------------------------------------- the review

/**
 * Every pick with its three numbers.
 *
 * @param {Object} o
 * @param {ReturnType<typeof parseDraft>} o.draft
 * @param {Map<number, {name:string, position:string, soFar:number, rest:number, total:number}>} o.players
 *   by playerId; a drafted man who is not in it gets no rank and no difference
 * @param {number[]} o.slots one team's starting lineup
 * @param {number} [o.teams] defaults to the teams that drafted
 * @param {'bar'|'starterBar'} [o.against] which bar value is measured from
 * @param {Map|Object|null} [o.ranks] playerId -> ESPN's preseason rank
 * @returns {{ rows:Array, bars:Map, ranked:number }} `rows` in pick order, each
 *   the pick plus `{ at, name, position, soFar, rest, total, value, now, diff,
 *   espnRank, pre, preDiff }` (`value`, `now`, `diff` null for a man with no
 *   numbers; the last three null for a man ESPN did not rank); `ranked` is how
 *   many men have a place.
 */
export function reviewDraft({ draft, players, slots, teams = null, against = 'bar', ranks = null }) {
  const at = draftedAt(draft.picks, draft.type);
  const pre = preseasonPlaces(draft.picks, ranks);
  const rows = draft.picks.map((pk) => {
    const p = players.get(pk.playerId) || null;
    const known = Boolean(p && p.position && num(p.total) !== null);
    return {
      ...pk,
      at: at.get(pk.playerId),
      name: (p && p.name) || '',
      position: (p && p.position) || '',
      soFar: known ? p.soFar : null,
      rest: known ? p.rest : null,
      total: known ? p.total : null,
      value: null, now: null, diff: null,
      // ESPN's preseason rank, his place by it among the drafted, and the difference.
      espnRank: pre.has(pk.playerId) ? pre.get(pk.playerId).rank : null,
      pre: pre.has(pk.playerId) ? pre.get(pk.playerId).place : null,
      preDiff: pre.has(pk.playerId) ? at.get(pk.playerId) - pre.get(pk.playerId).place : null,
    };
  });

  const pool = rows.filter((r) => r.total !== null);
  const bars = leagueBars(pool, slots, teams || draft.order.length);
  for (const r of pool) r.value = r.total - bars.get(r.position)[against];
  // A strict order: value, then points, then the earlier pick.
  const order = pool.slice().sort((a, b) => b.value - a.value || b.total - a.total || a.overall - b.overall);
  order.forEach((r, i) => { r.now = i + 1; r.diff = r.at - r.now; });

  return { rows, bars, ranked: order.length };
}

/**
 * One team's picks, with its best steal and its biggest miss (null when it has
 * none). `key` is the difference they are the ends of: `diff` (worth now) or
 * `preDiff` (preseason rank).
 */
export function teamReview(rows, teamId, key = 'diff') {
  const picks = (rows || []).filter((r) => String(r.teamId) === String(teamId));
  const rated = picks.filter((r) => r[key] !== null && r[key] !== undefined);
  const best = rated.reduce((a, r) => (a === null || r[key] > a[key] ? r : a), null);
  const worst = rated.reduce((a, r) => (a === null || r[key] < a[key] ? r : a), null);
  return {
    picks,
    steal: best && best[key] > 0 ? best : null,
    miss: worst && worst[key] < 0 ? worst : null,
  };
}

// ------------------------------------------------------------ the sample draft

/** What was expected of a sample man before the season, over the bar at his position. */
function sampleWorth(list, slots) {
  const pool = list.flatMap((t) => (t.players || []).map((p) => ({ position: p.position, total: num(p.seasonProjected) ?? 0 })));
  const bars = leagueBars(pool, slots, list.length);
  return (p) => (num(p.seasonProjected) ?? 0) - ((bars.get(p.position) || {}).bar || 0);
}

/**
 * The sample league's preseason ranks, which no one ever published: every man
 * in it best first by the same worth `sampleDraft` drafts on. `Map<playerId, rank>`.
 */
export function sampleRanks(teams, slots) {
  const list = teams || [];
  const worth = sampleWorth(list, slots);
  const all = list.flatMap((t) => t.players || []).slice().sort((a, b) => worth(b) - worth(a) || a.playerId - b.playerId);
  return new Map(all.map((p, i) => [p.playerId, i + 1]));
}

/**
 * A draft for the sample league, which never had one: a snake in the order the
 * teams are listed, each team taking its own men best first by what was
 * expected of them before the season (`seasonProjected` over the bar).
 *
 * @param {Array<{id:number, players:Array}>} teams week 1's squads
 * @param {number[]} slots one team's starting lineup
 * @returns {ReturnType<typeof parseDraft>}
 */
export function sampleDraft(teams, slots) {
  const list = teams || [];
  const worth = sampleWorth(list, slots);
  const lists = list.map((t) => (t.players || []).slice().sort((a, b) => worth(b) - worth(a) || a.playerId - b.playerId));
  const rounds = Math.max(0, ...lists.map((l) => l.length));
  const n = list.length;
  const picks = [];
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < n; k++) {
      const col = r % 2 === 0 ? k : n - 1 - k;
      const p = lists[col][r];
      if (!p) continue;
      picks.push({
        overall: r * n + k + 1, round: r + 1, roundPick: k + 1,
        teamId: list[col].id, playerId: p.playerId, bid: null, keeper: false,
      });
    }
  }
  return { type: 'snake', done: true, order: list.map((t) => t.id), picks };
}
