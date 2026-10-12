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
