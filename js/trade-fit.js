// TIM'S OWN CHECKLIST FOR A TRADE (docs/trade-fit-plan.md).
//
// Tim, 2026-10-31: "the first consideration is of course is it going to
// benifite me. This is looking at my change in future proj as well as change in
// value. I try to get a trade that has positive change in future proj by about
// +2 or more, and a equal or positive change in value. The rest of the
// consideration is all about trying to find something that is appealing to the
// opposite user. … I want to buy low and not high … When finding players to
// send, I try to find players that have a coin on my side (or close to a coin)
// and players that my opponent needs. … my opponents change in this week's
// proj should be positive. … I also try to ballence my trades and make them
// relatively sparce".
//
// Settled against his two saved 3-for-3 trades (2026-10-31, Phase 0):
//   GATES (a deal must pass both, on top of every gate the page already has):
//     You gain ≥ +2.0 a week (the printed You gain);
//     Value change ≥ −1.0 (he takes −0.5 as "equal").
//   CHECKS (order only, never a bar): his This week > 0; his future gain > 0;
//     a man you get fills one of YOUR needed positions; a man you send fills
//     one of HIS; you get a 💎 (or near); you send a 🪙 (or near); Value ≥ 0.
//   A check with nothing to judge it on is "—" (null), never ✗.
//
// THE ORDER: the goal guard on top (a deal that lowers your goal chance never
// sits above one that does not), then the count of checks passed, then his
// This week, then You gain (+2 to +4 all the same, above +4 after), then a
// strict key (manager, then the men's ids) so a tie is a display grouping only
// (rule 19).
//
// FLIP (rule 9): a cheap buy of a high-Value bench man that another manager
// needs. NOT SENT TWICE: a deal sharing a man each way with an offer you sent
// in the last 7 days is left out.
//
// Pure: no DOM, no page state. Packages of any size (1 to 3 a side).

export const MIN_YOU = 2;          // You gain a week, the gate
export const SWEET_MAX = 4;        // above this a week ranks after
export const MIN_VALUE = -1;       // Value change, the gate
export const NEAR_YOU = 1;         // a near miss: You gain from here up to the gate
export const NEAR_VALUE = -2;      // a near miss: Value change from here up to the gate
export const MARK = 2;             // 💎 / 🪙 at ±2 (js/outlook-mark.js, never changed)
export const NEAR_MARK = 1;        // "or near" a mark: within 1.0 of it, order only
export const PER_MANAGER = 2;      // at most this many rows per manager
export const SENT_DAYS = 7;        // an offer sent in the last week is not suggested again

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (n) => { const r = Math.round(n * 10) / 10; return r === 0 ? 0 : r; };
/** "+1.4" / "−1.8" / "0.0", as the page signs a figure. */
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

/** The labels, in the card's order. Wording is Tim's to change. */
export const LABELS = {
  you: 'You gain +2/wk',
  value: 'Value −1 or better',
  hisWeek: 'He gains this week',
  hisGain: 'He gains /wk',
  myNeed: 'You get a need',
  hisNeed: 'He gets a need',
  diamond: 'You get 💎',
  coin: 'You send 🪙',
  valueUp: 'Value 0 or better',
};

/**
 * One deal against the checklist.
 *
 * @param {object} f the deal's figures, as the row prints them
 * @param {number|null} f.youGain      your printed gain a week
 * @param {number|null} f.valueChange  your Value change (null: Values not read)
 * @param {number|null} f.hisThisWeek  his This week (null: not judged)
 * @param {number|null} f.hisGain      his printed gain a week
 * @param {string[]} [f.getPos]        positions of the men you get
 * @param {string[]} [f.sendPos]       positions of the men you send
 * @param {string[]|null} [f.myNeed]   your needed positions (null: not known)
 * @param {string[]|null} [f.hisNeed]  his needed positions
 * @param {Array<number|null>} [f.getDeltas]  proj − avg of each man you get
 * @param {Array<number|null>} [f.sendDeltas] the same of each man you send
 * @returns {{pass:boolean, near:boolean, failed:string[], gates:Array, checks:Array,
 *   count:number, youGain:number|null, hisThisWeek:number|null, needs:object}}
 */
export function fitOf(f = {}) {
  const you = num(f.youGain) ? r1(f.youGain) : null;
  const val = num(f.valueChange) ? r1(f.valueChange) : null;
  const gates = [
    { key: 'you', label: LABELS.you, ok: you !== null && you >= MIN_YOU, shown: you },
    // No Values read: not held to it (as the page's Value gap rule).
    { key: 'value', label: LABELS.value, ok: val === null ? null : val >= MIN_VALUE, shown: val },
  ];
  const failed = gates.filter((g) => g.ok === false).map((g) => g.key);
  const pass = failed.length === 0;
  // A NEAR MISS fails ONE gate, by a little.
  const near = failed.length === 1 && (failed[0] === 'you'
    ? you !== null && you >= NEAR_YOU
    : val !== null && val >= NEAR_VALUE);

  const hits = (pos, need) => {
    if (!Array.isArray(need)) return { ok: null, pos: [] };
    const got = [...new Set((pos || []).filter((p) => need.includes(p)))];
    return { ok: got.length > 0, pos: got };
  };
  const mine = hits(f.getPos, f.myNeed);
  const his = hits(f.sendPos, f.hisNeed);
  const markCheck = (deltas, good) => {
    const known = (deltas || []).filter(num);
    if (!known.length) return null;
    return known.some(good);
  };
  const hw = num(f.hisThisWeek) ? r1(f.hisThisWeek) : null;
  const hg = num(f.hisGain) ? r1(f.hisGain) : null;
  const checks = [
    { key: 'hisWeek', label: LABELS.hisWeek, ok: hw === null ? null : hw > 0, shown: hw },
    { key: 'hisGain', label: LABELS.hisGain, ok: hg === null ? null : hg > 0, shown: hg },
    { key: 'myNeed', label: LABELS.myNeed, ok: mine.ok, pos: mine.pos },
    { key: 'hisNeed', label: LABELS.hisNeed, ok: his.ok, pos: his.pos },
    { key: 'diamond', label: LABELS.diamond, ok: markCheck(f.getDeltas, (d) => r1(d) >= MARK - NEAR_MARK) },
    { key: 'coin', label: LABELS.coin, ok: markCheck(f.sendDeltas, (d) => r1(d) <= -(MARK - NEAR_MARK)) },
    { key: 'valueUp', label: LABELS.valueUp, ok: val === null ? null : val >= 0, shown: val },
  ];
  return {
    pass, near, failed, gates, checks,
    count: checks.filter((c) => c.ok === true).length,
    youGain: you, hisThisWeek: hw,
  };
}

/** You gain's place in the order: +2 to +4 all the same (0), above +4 after (1), anything else last (2). */
export function youBand(you) {
  if (!num(you)) return 2;
  if (you >= MIN_YOU && you <= SWEET_MAX) return 0;
  return you > SWEET_MAX ? 1 : 2;
}

/**
 * The strict order between two deals. Each `{fit, lowers, key}`: `lowers` the
 * goal guard (true: lowers your chance beyond the band), `key` a string that
 * is unique per deal (manager and the men's ids).
 */
export function compareFit(a, b) {
  const low = (x) => (x.lowers ? 1 : 0);
  if (low(a) !== low(b)) return low(a) - low(b);
  if (a.fit.count !== b.fit.count) return b.fit.count - a.fit.count;
  const hw = (x) => (num(x.fit.hisThisWeek) ? x.fit.hisThisWeek : 0);
  if (hw(a) !== hw(b)) return hw(b) - hw(a);
  const ba = youBand(a.fit.youGain);
  const bb = youBand(b.fit.youGain);
  if (ba !== bb) return ba - bb;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** The same rank as the row above it: equal on every key but the strict one. */
export function sameFitPlace(a, b) {
  const hw = (x) => (num(x.fit.hisThisWeek) ? x.fit.hisThisWeek : 0);
  return !!a.lowers === !!b.lowers && a.fit.count === b.fit.count && hw(a) === hw(b) &&
    youBand(a.fit.youGain) === youBand(b.fit.youGain);
}

/** A deal's strict key: manager, then the men's ids each way, sorted. */
export function dealKey(partnerId, sendIds, getIds) {
  const s = (ids) => (ids || []).map(String).sort().join('.');
  return `${partnerId}|${s(sendIds)}|${s(getIds)}`;
}

/** At most `max` per manager, in the order given (the first ones kept). */
export function capPerManager(list, partnerOf, max = PER_MANAGER) {
  const seen = new Map();
  const out = [];
  for (const o of list || []) {
    const p = String(partnerOf(o));
    const n = seen.get(p) || 0;
    if (n >= max) continue;
    seen.set(p, n + 1);
    out.push(o);
  }
  return out;
}

/**
 * FLIP (Tim: "Robert has a QB, Jonas needs a QB, I buy roberts QB for cheap to
 * trade with Jonas. If no one needs a QB, then I won't buy it"): a man you get
 * who sits on the SELLER's bench with his own Value 2 to 4; your Value change
 * +2 to +4; You gain −1 a week or better ("even if my change in future proj is
 * slightly negative (-0-1)") and under the +2 gate (above it, it is an
 * ordinary deal); and a manager other than the seller (and you) needs his
 * position. Returns `{manId, pos, to:[teamId]}` for the best such man, or null.
 *
 * @param {object} f
 * @param {number|null} f.youGain
 * @param {number|null} f.valueChange
 * @param {Array<{id, pos:string, value:number|null, bench:boolean}>} f.get the men you get
 * @param {*} f.sellerId
 * @param {*} f.myId
 * @param {Array<{teamId, need:string[]}>} f.needs every manager's needed positions
 */
export function flipOf(f = {}) {
  const you = num(f.youGain) ? r1(f.youGain) : null;
  const val = num(f.valueChange) ? r1(f.valueChange) : null;
  if (you === null || you < -1 || you >= MIN_YOU) return null;
  if (val === null || val < 2 || val > 4) return null;
  let best = null;
  for (const m of f.get || []) {
    if (!m || !m.bench || !num(m.value) || m.value < 2 || m.value > 4) continue;
    const to = (f.needs || [])
      .filter((n) => String(n.teamId) !== String(f.sellerId) && String(n.teamId) !== String(f.myId) &&
        Array.isArray(n.need) && n.need.includes(m.pos))
      .map((n) => n.teamId);
    if (!to.length) continue;
    if (!best || m.value > best.value) best = { manId: m.id, pos: m.pos, value: m.value, to };
  }
  return best ? { manId: best.manId, pos: best.pos, to: best.to } : null;
}

/** Flip rows' order: Value change, then You gain, then the strict key. */
export function compareFlip(a, b) {
  const v = (x) => (num(x.valueChange) ? x.valueChange : -Infinity);
  if (v(a) !== v(b)) return v(b) - v(a);
  const y = (x) => (num(x.youGain) ? x.youGain : -Infinity);
  if (y(a) !== y(b)) return y(b) - y(a);
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * NOT SENT TWICE: the offer you sent in the last `days` days that this deal
 * shares a man with EACH WAY (same manager, one man you get and one man you
 * send in common), or null. `sent` items: `{withTeamId, get:[ids], send:[ids],
 * proposedAt?, at?}` (js/trade-outcome.js / js/pending.js shapes: `get` = the
 * men you asked for, `send` = the men you offered).
 */
export function sentCopyOf(deal, sent, now, days = SENT_DAYS) {
  if (!deal || !Array.isArray(sent)) return null;
  const ids = (l) => new Set((l || []).map(String));
  const get = ids(deal.getIds);
  const send = ids(deal.sendIds);
  let best = null;
  for (const s of sent) {
    if (!s || String(s.withTeamId) !== String(deal.partnerId)) continue;
    const when = num(s.proposedAt) ? s.proposedAt : num(s.at) ? s.at : null;
    if (when === null || !num(now) || now - when > days * 86400000 || when > now + 86400000) continue;
    const shareGet = (s.get || []).some((id) => get.has(String(id)));
    const shareSend = (s.send || []).some((id) => send.has(String(id)));
    if (!shareGet || !shareSend) continue;
    if (!best || when > best.when) best = { when, offer: s };
  }
  return best;
}

/** "Oct 26" for a time stamp (local time). */
export function shortDate(ms) {
  if (!num(ms)) return '';
  const d = new Date(ms);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${m} ${d.getDate()}`;
}

/** The card's rows: each gate and check with ✓ / ✗ / —. */
export function checklistRows(fit) {
  const mark = (ok) => (ok === true ? '✓' : ok === false ? '✗' : '—');
  const note = (c) => (c.pos && c.pos.length ? c.pos.join(' ') : num(c.shown) ? signed(c.shown) : '');
  return [...fit.gates, ...fit.checks].map((c) => ({ label: c.label, note: note(c), value: mark(c.ok) }));
}

/** The short tag on a row: "✓ 5/7", or for a near miss the gate it failed. */
export function fitTag(fit) {
  if (!fit) return '';
  if (!fit.pass) {
    const g = fit.gates.find((x) => x.ok === false);
    if (g && g.key === 'you') return `✗ You gain ${num(g.shown) ? signed(g.shown) : '—'}`;
    if (g) return `✗ Value ${num(g.shown) ? signed(g.shown) : '—'}`;
  }
  return `✓ ${fit.count}/${fit.checks.length}`;
}
