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
// they are far enough apart (below). NO MARK when either number is missing, or
// when his average is nothing: a man who has not played has no average to be
// above, and a diamond on every one of them would say nothing.
//
// HOW FAR APART (Trade audit finding 9, Phase 4, authorized 2026-10-15). Tim's
// 2 is the gap for a man with a full season behind him. Early on an average of
// a few games is mostly luck: one man's score moves about 6.7 points from week
// to week (SPREAD below: the standard deviation of one man's weekly scores,
// median man — docs/trade-audit-plan.md finding 9; re-measured 2026-10-15 on
// public league 1241838, weeks 1–5, the 88 rostered men averaging 8+ over 4+
// games: median 6.73, pooled 7.75), so an average of n games
// is only good to about 6.7 / √n — ±3.0 after 5 games, which is wider than 2.
// The gap needed is therefore one of those standard errors, never less than 2:
//   needed = max(2, 6.7 / √games)   →  4 games 3.4 · 5 games 3.0 · 8 games 2.4
//                                       · 12 games and on 2 (Tim's own figure)
// "2 or more" still means exactly the needed gap counts.
//
// THE AVERAGE LEAVES OUT A GAME CUT SHORT BY INJURY (same finding). ESPN's feed
// has no "left the game hurt" flag (measured 2026-10-15 on 1241838: a week's
// stat line is yards, catches, targets and "210" games played; the player's
// `injuryStatus` is today's, not that week's). What it does keep, for every
// played week, is ESPN's final projection for that game — 0 when he was ruled
// out (Doubtful projects 0 too). So a game is left out only when BOTH hold:
//   · he scored under half (SHORT_SHARE) of the median of his other games, and
//   · ESPN projected him at 0 for his team's NEXT game (he was ruled out of it).
// A bad game he walked away from — Lamb's 1.9 in week 5, still projected 14.9
// for week 6 — stays in: nothing in the data says he was hurt. The left-out
// game comes off ESPN's own average (avg × games − his score, over games − 1),
// so games this page never saw still count. Measured 2026-10-15 on 1241838:
// 12 of the 154 rostered men averaging 5+ lose a game this way (Nacua week 1,
// Jefferson week 3, Samuel week 5, …), and the share of them marked goes from
// 66 (43%) under the flat 2 to 33 (21%).

export const THRESHOLD = 2;
/** One man's week-to-week spread in points (see above). */
export const SPREAD = 6.7;
/** "Far below his other games" = under this share of their median. */
export const SHORT_SHARE = 0.5;

const round1 = (n) => Math.round(n * 10) / 10;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * The gap a man's numbers must be apart for a mark, given how many games his
 * average is of. Unknown games (a caller with no count) gets Tim's 2.
 */
export function neededGap(games) {
  if (!num(games) || games <= 0) return THRESHOLD;
  return Math.max(THRESHOLD, SPREAD / Math.sqrt(games));
}

/**
 * @param {number|null} proj his average projection over the weeks left
 * @param {number|null} avg  his season average so far (the cleaned one, `cleanAvgOf`)
 * @param {number|null} [games] how many games that average is of
 * @param {Array<number>} [skipped] weeks left out of it as cut short by injury
 * @returns {{kind:'diamond'|'coin', delta:number, avg:number, proj:number, games:number|null, skipped:number[]}|null}
 */
export function outlookOf(proj, avg, games = null, skipped = []) {
  if (!num(proj) || !num(avg) || avg <= 0 || proj <= 0) return null;
  const to = round1(proj);
  const from = round1(avg);
  const delta = round1(to - from);
  // The needed gap is compared at the tenth, as the two numbers are.
  if (Math.abs(delta) < round1(neededGap(games))) return null;
  return {
    kind: delta > 0 ? 'diamond' : 'coin', delta, avg: from, proj: to,
    games: num(games) ? games : null, skipped: Array.isArray(skipped) ? skipped.slice() : [],
  };
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * HIS AVERAGE WITHOUT A GAME CUT SHORT BY INJURY, and how many games it is of.
 *
 * @param {Object} a
 * @param {number|null} a.avg   ESPN's season average
 * @param {number|null} a.games ESPN's games played (season line stat "210");
 *   null when not known — then the games this page holds are counted and
 *   nothing is left out (the left-out score could not come off a total that is
 *   not known)
 * @param {Array<{week:number, actual:number|null, proj:number|null}>} a.weeks
 *   the weeks this page holds for him: `actual` his score in a PLAYED week
 *   (null otherwise), `proj` ESPN's projection for that week's game as it stood
 *   before kickoff (null when not known)
 * @param {number|null} [a.bye] his bye week, which is never "his next game"
 * @returns {{avg:number|null, games:number|null, skipped:number[]}}
 */
export function cleanAvgOf({ avg, games, weeks, bye = null } = {}) {
  const list = (Array.isArray(weeks) ? weeks : [])
    .filter((w) => w && num(w.week) && w.week !== bye)
    .sort((x, y) => x.week - y.week);
  // A played game: a score, and not a week he was ruled out and scored nothing
  // (ESPN sends a 0 line for a man who sat — Jacobs, Charbonnet on 1241838).
  const played = list.filter((w) => num(w.actual) && !(w.actual === 0 && w.proj === 0));
  const out = { avg: num(avg) ? avg : null, games: num(games) && games > 0 ? games : (played.length || null), skipped: [] };
  if (out.avg === null || !(num(games) && games > 0)) return out;
  let total = avg * games;
  let n = games;
  for (const g of played) {
    const others = played.filter((o) => o !== g).map((o) => o.actual);
    if (others.length < 2) continue;
    if (!(g.actual < SHORT_SHARE * median(others))) continue;
    // His team's next game: the week after, or the one after that when the
    // week after is his bye. A week this page does not hold says nothing.
    const nextWeek = g.week + 1 === bye ? g.week + 2 : g.week + 1;
    const next = list.find((w) => w.week === nextWeek);
    if (!next || next.proj !== 0) continue;
    if (n - 1 < 1) break;
    total -= g.actual;
    n -= 1;
    out.skipped.push(g.week);
  }
  if (out.skipped.length) {
    out.avg = total / n;
    out.games = n;
  }
  return out;
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
 * TOTAL — Appeal plus what the trade does to BOTH lineups a week.
 *
 * Tim, 2026-10-12: "I want to change the appeal collumn so it doesn't add the
 * opponents pts/week dif like it did before. However, I want to make a new
 * "total" collumn that is just the appeal + both user's pts/week diff. Ex:
 * appeal=+4, my pts/week dif = +2, opp pts/week dif = -1, total=+5."
 *
 * Each figure goes in to the tenth, as it is printed in its own column. Not
 * known when the Appeal is not; a gain with no figure adds nothing.
 */
export function totalOf(appeal, myPerWeek, hisPerWeek) {
  if (!num(appeal)) return null;
  const part = (v) => (num(v) ? round1(v) : 0);
  const r = round1(appeal + part(myPerWeek) + part(hisPerWeek));
  return r === 0 ? 0 : r;
}

/** The lines behind "How this works". */
export const APPEAL_EXPLAIN =
  `<strong>Appeal</strong>: projection for the weeks left minus season average (the 💎/🪙 one, without a game cut ` +
  `short by injury), added up over the men you get, ` +
  `less the same over the men you send. High means you get men due to score more than they have (💎) for men ` +
  `who have scored more than they are due to (🪙). A man with no average yet adds nothing. ` +
  `<strong>Total</strong>: Appeal plus your gain a week plus the other manager’s.`;

/** The words a screen reader gets, and the card's heading line. */
export function outlookWords(o) {
  if (!o) return '';
  const left = o.skipped && o.skipped.length
    ? ` (without week${o.skipped.length > 1 ? 's' : ''} ${o.skipped.join(', ')}, cut short by injury)` : '';
  return `Projected ${Math.abs(o.delta).toFixed(1)} a week ${o.delta > 0 ? 'above' : 'below'} his average: ` +
    `${o.avg.toFixed(1)} so far${left} → ${o.proj.toFixed(1)} projected`;
}

export function outlookHtml(o) {
  if (!o) return '';
  const words = outlookWords(o);
  return `<span class="outlook outlook-${o.kind}">` +
    `<span aria-hidden="true">${o.kind === 'diamond' ? '💎' : '🪙'}</span>` +
    `<span class="sr-only"> (${escHtml(words)})</span></span>`;
}

/** The one-sentence key, only where a mark is drawn (rule 16). */
// The gap itself is a threshold, so it lives behind the toggle (rule 16).
export const OUTLOOK_KEY = '💎 / 🪙 by a name: projected well above / below his average so far.';
export const hasOutlook = (html) => /\boutlook-(diamond|coin)\b/.test(html || '');

/** The line behind "How this works". */
export const OUTLOOK_EXPLAIN =
  `<strong>A 💎 or 🪙 by a name</strong>: his projection for the weeks left is above (💎) or below (🪙) ` +
  `ESPN’s season average of what he has scored by at least ${SPREAD} ÷ √(games he has played), and never less ` +
  `than ${THRESHOLD} points a week: ${neededGap(5).toFixed(1)} after 5 games, ${THRESHOLD} from 12 games on, ` +
  `because an average of a few games is mostly luck (one man’s score moves about ${SPREAD} a week). ` +
  `A game he scored under half his usual in and was then ruled out of the next is left out of the average. ` +
  `A man with no average yet gets neither.`;
