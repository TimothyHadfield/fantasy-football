// WILL HE SAY YES? — the rebuilt estimate (trade audit Phase 3, docs/trade-audit-plan.md).
//
// Tim, 2026-10-14, asked "Rebuild 'chance he accepts' around what he sees on
// ESPN, starting near 50% for an even deal, and show it as words (likely /
// maybe / unlikely) with a one-line why?": "Rebuild, show words".
//
// WHAT WAS WRONG. The old curve (js/trade-odds.js until 2026-10-15) weighed two
// things — his lineup gain and the sum of ESPN's rest-of-season projections in
// against out — and put a dead-even deal at 88%. Tim's real Allen + Charbonnet
// offer read 73% while the partner lost 2 a week and received an RB tagged Out.
// Real managers refuse most offers, and a casual manager does not add up
// projections for the weeks ahead: he looks at the numbers ESPN's app puts in
// front of him (season AVG, LAST game, positional rank, the injury tag), at
// whether the deal fills a hole in his lineup, and at whether he is still in
// the race — and he values the men he already owns a little more than the
// same men on somebody else's roster.
//
// THE MODEL. Every input is turned into "points a week, as it feels to him",
// added up, and put through a logistic curve centred on zero, so a deal with
// nothing for or against it is exactly 50%:
//
//   feel = W_LINEUP × engaged-weight × his lineup change a week
//        + W_LOOK × how it looks on ESPN (AVG / LAST / rank), a week
//        − an injury penalty for each Out/IR man he receives
//        + a bonus when a man he receives fills an empty or thin starting spot
//        − a shift when he is out of the race
//        − an ownership (endowment) discount on what he sends
//   P(yes) = 1 / (1 + e^(−feel ÷ SCALE))
//
// EVERY CONSTANT BELOW IS A JUDGEMENT, NOT A MEASUREMENT. No published data on
// fantasy trade acceptance exists (plan, "What a casual ESPN manager weighs").
// They are named, commented, exported and tested for DIRECTION only, so the day
// recorded outcomes exist (plan Phase 5) they can be fitted.
//
// Pure: no DOM, no fetching, no page state. js/trade-page.js gathers the
// inputs (`acceptVerdictFor`) and js/trade-odds.js `acceptChance` is this
// file's `p`, for the callers that read a number.

// ------------------------------------------------------------ the constants

/** Weight of his lineup change, a week. Judgement: equal with the ESPN look. */
export const W_LINEUP = 0.5;
/** Weight of how the deal looks on ESPN's numbers, a week. Judgement. */
export const W_LOOK = 0.5;
/**
 * The curve's width, in "feel" points a week: at −SCALE the chance is 27%, at
 * +SCALE 73%. Judgement — wide enough that one factor alone rarely decides.
 */
export const SCALE = 2;

/**
 * ESPN's screen value of a man: his season AVG with his LAST game mixed in, a
 * quarter of the weight — recency is what casual managers react to (plan B21)
 * but one game is noisy. Judgement.
 */
export const LAST_SHARE = 0.25;
/**
 * A name bonus off ESPN's positional rank — the anchoring a top-ranked man
 * carries beyond his average. Judgement: +1 for a top-5 at his position, +0.5
 * for top-12 (roughly a weekly starter in a 10–12 team league).
 */
export const RANK_STAR = 5;
export const RANK_STAR_BONUS = 1;
export const RANK_STARTER = 12;
export const RANK_STARTER_BONUS = 0.5;
/**
 * In a package, the best man counts in full and every other man at this share:
 * "2-for-1 feels like more, but the best player usually wins" (plan, research).
 * Judgement.
 */
export const DEPTH_SHARE = 0.5;

/**
 * Fear of an injury tag on a man he RECEIVES, in feel points a week. Out / IR /
 * suspended / not active: 3 — about what losing a mid starter costs. Doubtful:
 * 1. Questionable and day-to-day count nothing (the site does not discount
 * Questionable men anywhere — plan, "Deliberately NOT planned"). An injured man
 * he SENDS is not counted either way. Judgement.
 */
export const INJURED_OUT_PENALTY = 3;
export const INJURED_DOUBTFUL_PENALTY = 1;

/**
 * Need: a man he receives who would start in a starting spot his lineup has
 * EMPTY (no starter at all) or THIN (his starters there among the league's
 * weakest). Counted once per position. Judgement.
 */
export const HOLE_EMPTY_BONUS = 1.5;
export const HOLE_WEAK_BONUS = 0.75;

/**
 * His standing, 0–1 (his playoff chance from the season simulation, or his win
 * share). At or above CONTENDER he is fully engaged; at or below OUT_OF_IT he
 * is out of the race; linear between. An out-of-it manager is less likely to
 * accept anything (disengaged, fewer replies) — OUT_OF_IT_SHIFT off the feel —
 * and his own lineup gain moves him half as much (OUT_OF_IT_LINEUP_WEIGHT).
 * Unknown standing counts as engaged (no shift). All judgement.
 */
export const CONTENDER = 0.5;
export const OUT_OF_IT = 0.15;
export const OUT_OF_IT_SHIFT = 0.75;
export const OUT_OF_IT_LINEUP_WEIGHT = 0.5;

/**
 * Ownership (endowment): he values what he owns a little above the same man on
 * another roster. A share of the ESPN screen value of what he sends. At 0.04 a
 * one-for-one swap of two 12-a-week starters reads 44%, not 50%. Judgement
 * (the research says "up to ~2×", which would make no trade ever happen).
 */
export const ENDOWMENT_RATE = 0.04;

/**
 * The words. likely at 60% or more, unlikely below 35%, maybe between.
 * Judgement: an even swap (≈ 44–50%) reads "maybe"; the Allen + Charbonnet
 * shape (he loses 2 a week and gets an Out RB) reads "unlikely".
 */
export const LIKELY_AT = 0.6;
export const UNLIKELY_BELOW = 0.35;

// ------------------------------------------------------------ the pieces

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const OUT_CLASS = new Set(['OUT', 'INJURY_RESERVE', 'SUSPENSION', 'NOT_ACTIVE']);

/** 'out' | 'doubtful' | null for an ESPN injury status. */
export function injuryWeight(status) {
  if (!status) return null;
  const s = String(status).toUpperCase();
  if (OUT_CLASS.has(s)) return 'out';
  if (s === 'DOUBTFUL') return 'doubtful';
  return null;
}

/**
 * One man as ESPN's app shows him, in points a week, or null when ESPN shows
 * nothing usable. AVG first (with LAST mixed in); a man with no games yet is
 * read off his PROJ (the glance line's average projection for the weeks left).
 */
export function screenValue(m) {
  if (!m) return null;
  let v = null;
  if (finite(m.avg)) v = finite(m.last) ? (1 - LAST_SHARE) * m.avg + LAST_SHARE * m.last : m.avg;
  else if (finite(m.proj)) v = m.proj;
  if (v === null) return null;
  if (finite(m.rank) && m.rank > 0) {
    if (m.rank <= RANK_STAR) v += RANK_STAR_BONUS;
    else if (m.rank <= RANK_STARTER) v += RANK_STARTER_BONUS;
  }
  return v;
}

/**
 * A package's screen value: best man in full, the rest at DEPTH_SHARE. Null
 * when any man has no value (then the look falls back to the caller's number).
 */
export function packageValue(men) {
  const vals = (men || []).map(screenValue);
  if (vals.some((v) => v === null)) return null;
  vals.sort((a, b) => b - a);
  return vals.reduce((a, v, i) => a + (i === 0 ? v : DEPTH_SHARE * v), 0);
}

/** 0 (out of it) … 1 (contender); unknown is 1. */
export function engagement(standing) {
  if (!finite(standing)) return 1;
  if (standing >= CONTENDER) return 1;
  if (standing <= OUT_OF_IT) return 0;
  return (standing - OUT_OF_IT) / (CONTENDER - OUT_OF_IT);
}

const POS_WORD = { DST: 'D/ST' };
const posWord = (pos) => (pos ? POS_WORD[pos] || String(pos) : 'man');
const num = (v) => {
  const r = Math.round(Math.abs(v) * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
};

// ------------------------------------------------------------ the verdict

/**
 * The chance he says yes, as `{ p, word, why, feel, parts }`.
 *
 * @param {Object} o
 * @param {number|null} o.lineupPerWeek  his lineup change, points a week
 * @param {number|null} o.lookPerWeek    how it looks on ESPN, a week — used only
 *                                       when the men carry no screen values
 * @param {Array} o.gets   men HE receives: {name, pos, avg, last, rank, proj, status, fills}
 *                         `fills`: 'empty' | 'weak' | null — the starting spot he
 *                         would take in HIS lineup
 * @param {Array} o.sends  men HE gives up, the same shape
 * @param {number|null} o.standing  0–1, his playoff chance (or win share)
 * @returns {null|{p:number, word:string, why:string, feel:number, parts:Array}}
 *          null when there is nothing at all to go on
 */
export function acceptVerdict({
  lineupPerWeek = null, lookPerWeek = null, gets = [], sends = [], standing = null,
} = {}) {
  gets = gets || [];
  sends = sends || [];
  const parts = [];
  const add = (key, v, text) => { if (finite(v) && v !== 0) parts.push({ key, v, text }); };

  const engaged = engagement(standing);
  if (finite(lineupPerWeek)) {
    const w = W_LINEUP * (OUT_OF_IT_LINEUP_WEIGHT + (1 - OUT_OF_IT_LINEUP_WEIGHT) * engaged);
    add('lineup', w * lineupPerWeek,
      lineupPerWeek < 0 ? `he loses ${num(lineupPerWeek)} a week` : `he gains ${num(lineupPerWeek)} a week`);
  }

  const inVal = gets.length ? packageValue(gets) : null;
  const outVal = sends.length ? packageValue(sends) : null;
  const menLook = gets.length && sends.length && inVal !== null && outVal !== null ? inVal - outVal : null;
  const look = menLook !== null ? menLook : (finite(lookPerWeek) ? lookPerWeek : null);
  if (look !== null) {
    add('look', W_LOOK * look, look < 0
      ? 'on ESPN he gives up more than he gets'
      : 'on ESPN he gets more than he gives up');
  }

  // The injury tag on what he receives.
  const hurt = gets.map((m) => ({ m, k: injuryWeight(m && m.status) })).filter((e) => e.k);
  if (hurt.length) {
    const pen = hurt.reduce((a, e) => a + (e.k === 'out' ? INJURED_OUT_PENALTY : INJURED_DOUBTFUL_PENALTY), 0);
    const text = hurt.length === 1
      ? `he gets an injured ${posWord(hurt[0].m.pos)}`
      : `he gets ${hurt.length} injured men`;
    add('injury', -pen, text);
  }

  // A hole filled — once per position, never by a man who is out.
  const filled = new Map();
  for (const m of gets) {
    if (!m || !m.fills || injuryWeight(m.status) === 'out') continue;
    const b = m.fills === 'empty' ? HOLE_EMPTY_BONUS : m.fills === 'weak' ? HOLE_WEAK_BONUS : 0;
    if (b > (filled.get(m.pos)?.b || 0)) filled.set(m.pos, { b, kind: m.fills });
  }
  if (filled.size) {
    const best = [...filled].sort((a, b) => b[1].b - a[1].b)[0];
    const bonus = [...filled.values()].reduce((a, f) => a + f.b, 0);
    add('need', bonus, `it fills his ${best[1].kind === 'empty' ? 'empty' : 'thin'} ${posWord(best[0])} spot`);
  }

  add('standing', -OUT_OF_IT_SHIFT * (1 - engaged), 'he is out of the race');

  if (outVal !== null && outVal > 0) add('ownership', -ENDOWMENT_RATE * outVal, 'he values his own men more');

  const anything = finite(lineupPerWeek) || look !== null || hurt.length || filled.size || finite(standing);
  if (!anything) return null;

  const feel = parts.reduce((a, x) => a + x.v, 0);
  const p = 1 / (1 + Math.exp(-feel / SCALE));
  const word = p >= LIKELY_AT ? 'likely' : p < UNLIKELY_BELOW ? 'unlikely' : 'maybe';
  return { p, word, why: whyOf(parts, word), feel, parts };
}

/**
 * The one-line reason: the biggest factor pushing the way the word points
 * (against him for maybe / unlikely, for him for likely), and the second when
 * it is at least half a point. "he loses 2 a week and gets an injured RB".
 */
function whyOf(parts, word) {
  const MIN = 0.25; // judgement: below a quarter of a point a factor is not a reason
  const want = word === 'likely' ? (x) => x.v > 0 : (x) => x.v < 0;
  // Ownership is on every deal he sends anything in, so it is never the
  // reason — it only names itself when there is nothing else.
  const told = parts.filter((x) => x.key !== 'ownership' && Math.abs(x.v) >= MIN);
  let pool = told.filter(want);
  if (!pool.length) pool = told;
  if (!pool.length) return 'about even for him';
  pool.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const first = pool[0].text;
  const second = pool[1] && Math.abs(pool[1].v) >= 0.5 ? pool[1].text.replace(/^he /, '') : null;
  return second ? `${first} and ${second}` : first;
}
