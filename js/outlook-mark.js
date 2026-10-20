// IS HE PROJECTED TO DO BETTER OR WORSE THAN HE HAS? One small mark by a name.
//
// Tim, 2026-10-12: "right now we already have some markers for players to
// represent a couple different things. I want to add some more markers to these
// players and display them in the trade menu. If the player's future proj is 2
// more than their current avg, then put a diamond symbol by their name. If it's
// 2 less, then put a coin symbol by their name."
//
//   FUTURE PROJ = the page's average of ESPN's weekly projections over the
//   weeks left he is projected to play (the "Proj" on his card).
//   CURRENT AVG = ESPN's season average of what he has actually scored.
//
// Both are rounded to the tenth first, as printed, and the mark is drawn when
// they are 2.0 or more apart ("2 more" — so exactly 2.0 counts, unlike the
// preseason arrow's "more than 2"). NO MARK when either number is missing, or
// when his average is nothing: a man who has not played has no average to be
// above, and a diamond on every one of them would say nothing.
//
// A FLAT 2 ON HIS PLAIN AVERAGE, ON PURPOSE (Tim, 2026-10-19): "I don't like
// what you did with changing my formula to remove luck with the coins and
// diamonds in the trade menu. I use that as a form of appeal from other players
// and to measure how expensive/valueable they are. Keep it at the +2/-2 mark".
// Trade audit Phase 4 (3255389) had scaled the gap with games played and left
// injury-shortened games out of the average; both were taken back out. Those
// games are part of a man's luck and cost, which is what the marks measure.

export const THRESHOLD = 2;

const round1 = (n) => Math.round(n * 10) / 10;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {number|null} proj his average projection over the weeks left
 * @param {number|null} avg  his season average so far
 * @returns {{kind:'diamond'|'coin', delta:number, avg:number, proj:number}|null}
 */
export function outlookOf(proj, avg) {
  if (!num(proj) || !num(avg) || avg <= 0 || proj <= 0) return null;
  const to = round1(proj);
  const from = round1(avg);
  const delta = round1(to - from);
  if (Math.abs(delta) < THRESHOLD) return null;
  return { kind: delta > 0 ? 'diamond' : 'coin', delta, avg: from, proj: to };
}

/**
 * APPEAL — how much of a trade is buying men about to do better and selling
 * men who have been doing better than they will.
 *
 * Tim, 2026-10-12: "Make a new collumn in the trade display titled "appeal".
 * This is simply calculated by the (act avg- future proj of their players)
 * minus (act avg-future proj of my players). This is also associated with the
 * diamond and coin features so that high appeal correlates with their players
 * having a diamond and my players having a coin. If a player has never played a
 * game so their act avg is 0 … then just have their act avg be = to their
 * future proj, or essentially don't calculate their number at all."
 *
 * THE SIGN IS THE ONE HIS SECOND SENTENCE ASKS FOR. A diamond is proj ABOVE
 * avg, so "high when their players have a diamond and mine a coin" is
 *   (proj − avg, summed over the men you GET) − (proj − avg, summed over the men you SEND)
 * which is his formula with each bracket turned round (as written it would be
 * at its LOWEST for exactly the trade he calls high).
 *
 * Each man's two numbers go to the tenth first, as the mark reads them. A man
 * with no average (never played) or no projection adds nothing. Null when no
 * man on either side has both numbers — "not known", never 0.
 *
 * @param {Array<{proj:number|null, avg:number|null}>} get  the men you receive
 * @param {Array<{proj:number|null, avg:number|null}>} send the men you give
 * @returns {number|null} points a week, to the tenth
 */
export function appealOf(get, send) {
  let known = 0;
  const gap = (list) => (list || []).reduce((t, m) => {
    if (!m || !num(m.proj) || !num(m.avg) || m.avg <= 0 || m.proj <= 0) return t;
    known++;
    return t + (round1(m.proj) - round1(m.avg));
  }, 0);
  const total = gap(get) - gap(send);
  if (!known) return null;
  const r = round1(total);
  return r === 0 ? 0 : r;
}

/**
 * TOTAL — Appeal plus what the trade does to HIS lineup a week: how the deal
 * looks to the other manager. Your own gain is not in it.
 *
 * Tim, 2026-10-19: "in the trade section the "total" considers my own change
 * in proj/week. Could you make it so that it is just the appeal + change in
 * opp proj/week, and not my own aswell?" (Before that, 2026-10-12, it was
 * Appeal + both gains.)
 *
 * Each figure goes in to the tenth, as it is printed in its own column. Not
 * known when the Appeal is not; a gain with no figure adds nothing.
 */
export function totalOf(appeal, hisPerWeek) {
  if (!num(appeal)) return null;
  const part = (v) => (num(v) ? round1(v) : 0);
  const r = round1(appeal + part(hisPerWeek));
  return r === 0 ? 0 : r;
}

/** The lines behind "How this works". */
export const APPEAL_EXPLAIN =
  `<strong>Appeal</strong>: projection for the weeks left minus season average, added up over the men you get, ` +
  `less the same over the men you send. High means you get men due to score more than they have (💎) for men ` +
  `who have scored more than they are due to (🪙). A man with no average yet adds nothing. ` +
  `<strong>Total</strong>: Appeal plus the other manager’s gain a week.`;

/** The words a screen reader gets, and the card's heading line. */
export function outlookWords(o) {
  if (!o) return '';
  return `Projected ${Math.abs(o.delta).toFixed(1)} a week ${o.delta > 0 ? 'above' : 'below'} his average: ` +
    `${o.avg.toFixed(1)} so far → ${o.proj.toFixed(1)} projected`;
}

export function outlookHtml(o) {
  if (!o) return '';
  const words = outlookWords(o);
  return `<span class="outlook outlook-${o.kind}">` +
    `<span aria-hidden="true">${o.kind === 'diamond' ? '💎' : '🪙'}</span>` +
    `<span class="sr-only"> (${escHtml(words)})</span></span>`;
}

/** The one-sentence key, only where a mark is drawn (rule 16). */
export const OUTLOOK_KEY = '💎 / 🪙 by a name: projected 2 or more a week above / below his average so far.';
export const hasOutlook = (html) => /\boutlook-(diamond|coin)\b/.test(html || '');

/** The line behind "How this works". */
export const OUTLOOK_EXPLAIN =
  `<strong>A 💎 or 🪙 by a name</strong>: his projection for the weeks left is ${THRESHOLD} or more points a week ` +
  `above (💎) or below (🪙) ESPN’s season average of what he has scored. A man with no average yet gets neither.`;
