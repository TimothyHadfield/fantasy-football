// HAS HIS PROJECTION MOVED SINCE THE PRESEASON? One small arrow by a name.
//
// Tim, 2026-09-29: "I want to see some way if the proj of a player has
// increased or decreased recently. To do this, just put a up or down arrow by
// that player's name if their rest-of-season proj/week has increased or
// decreased by more than 2 than it was at the begginning of the season. make
// the down arrow red and up arrow green. make sure it's small so it's not too
// distracting."
//
// THE TWO SIDES, and why each is what it is:
//
//   PRESEASON = ESPN's own season projection from 9 September 2026 (the day
//   before kickoff), per game. ESPN overwrites that projection as the season
//   goes (rule 8), so it is kept in `data/baselines/2026-preseason.json`, built
//   once by `tools/build-baseline.mjs` from a Wayback copy of ESPN's feed. The
//   copy holds RAW projected stats, so it is RE-SCORED HERE WITH YOUR LEAGUE'S
//   OWN RULES (`scoringItems`, position overrides included) — the copy itself is
//   ESPN's default PPR, and a half-PPR league's numbers differ by a point or
//   more a week for a receiver. Per week = that total ÷ his projected games.
//
//   NOW = the site's per-week average of ESPN's weekly projections over the
//   REST OF THE SEASON (D7: the mean over the weeks projecting above zero). ESPN
//   publishes no rest-of-season per-week number, and the words say so. Passed in
//   by the page: the Trade page's own per-week figure; on the Players page the
//   remaining weeks whatever span is shown, so switching Next 3 / Next 6 /
//   Rest of season never changes an arrow.
//
// AN ARROW ONLY WHEN THE MOVE IS MORE THAN 2 POINTS A WEEK, strictly: +2.0 is
// no arrow, +2.1 is. Both sides are rounded to the tenth first, as printed.
// NO ARROW AT ALL when he is not in the copy (a rookie ESPN had no line for, a
// demo player — the demo's men are invented), when his projected games or
// total were zero, or when this league's scoring is not known (a phone reading
// an older synced copy): a missing arrow is "not known", never "unchanged".
//
// The site never fetches Wayback. The file is read once per page and cached.

export const THRESHOLD = 2;

export const BASELINE_DATE = '9 Sep';

// ESPN's DEFAULT PPR rules (`leaguedefaults/3`, mSettings, read 2026-09-30).
// The capture's `appliedTotal` was scored with exactly these — the unit test
// re-scores with them and must land on it. Used as the demo's scoring.
// [statId, points, overrides keyed by defaultPositionId]
const DEFAULT_ROWS = [
  [20, -2], [72, -2], [85, -1], [89, 0, { 16: 5 }], [90, 0, { 16: 4 }], [91, 0, { 16: 3 }],
  [92, 0, { 16: 1 }], [95, 0, { 16: 2 }], [96, 0, { 16: 2 }], [97, 0, { 16: 2 }], [98, 0, { 16: 2 }],
  [99, 0, { 16: 1 }], [123, 0, { 16: -1 }], [124, 0, { 16: -3 }], [125, 0, { 16: -5 }],
  [128, 0, { 16: 5 }], [129, 0, { 16: 3 }], [130, 0, { 16: 2 }], [132, 0, { 16: -1 }],
  [133, 0, { 16: -3 }], [134, 0, { 16: -5 }], [135, 0, { 16: -6 }], [136, 0, { 16: -7 }],
  [3, 0.04], [24, 0.1], [42, 0.1], [53, 1], [86, 1], [209, 1, { 16: 1 }], [19, 2], [26, 2],
  [44, 2], [206, 2, { 16: 2 }], [80, 3], [4, 4], [77, 4], [198, 5], [25, 6], [43, 6], [63, 6],
  [93, 6, { 16: 6 }], [101, 6, { 16: 6 }], [102, 6, { 16: 6 }], [103, 6, { 16: 6 }],
  [104, 6, { 16: 6 }], [201, 6],
];
export const DEFAULT_PPR = DEFAULT_ROWS.map(([statId, points, pointsOverrides]) =>
  (pointsOverrides ? { statId, points, pointsOverrides } : { statId, points }));

/**
 * THE ONE SEASON THE COPY IS OF. A league opened on any other season (an
 * earlier one from the main menu) gets no arrow and no preseason figure: a
 * 2025 projection set against the 2026 preseason is two different years.
 */
export const BASELINE_SEASON = 2026;

const BASELINE_URL = new URL(`../data/baselines/${BASELINE_SEASON}-preseason.json`, import.meta.url);

/**
 * The league's rules when the copy is of THIS season, else null — and null
 * rules mean no arrow anywhere (`baselineOf`, `trendOf`), exactly as for a
 * league whose scoring is not known.
 *
 * @param {Array|null} scoring the league's rules (or DEFAULT_PPR)
 * @param {number|string} season the season the page is showing
 */
export function scoringForSeason(scoring, season) {
  return Array.isArray(scoring) && Number(season) === BASELINE_SEASON ? scoring : null;
}

let baseline = null;
let loading = null;
// scoring array -> Map(playerId -> {perWeek, total, games} | null)
let memo = new WeakMap();

/** Hand the module a baseline directly (the test stubs), or clear it with null. */
export function setBaseline(b) {
  baseline = b && b.players ? b : null;
  loading = baseline ? Promise.resolve(baseline) : null;
  memo = new WeakMap();
}

/** Is the copy in hand? Until it is, every trend is null. */
export const ready = () => baseline !== null;

/**
 * Read the copy once. Resolves to it, or to null when it cannot be read — the
 * page then simply draws no arrows. Never rejects.
 *
 * `fetch` in a browser. Under node (the test suites) a file: URL cannot be
 * fetched, so the same file is imported as JSON instead — never through
 * `fetch`, which the page suites stub to fail on any network call.
 */
export function loadBaseline() {
  if (loading) return loading;
  loading = (async () => {
    let got = null;
    if (BASELINE_URL.protocol === 'file:') {
      try {
        got = (await import(BASELINE_URL.href, { with: { type: 'json' } })).default;
      } catch { got = null; }
    } else {
      try {
        const res = await fetch(BASELINE_URL);
        if (res.ok) got = await res.json();
      } catch { got = null; }
    }
    if (got && got.players && !baseline) {
      baseline = got;
      memo = new WeakMap();
    }
    return baseline;
  })();
  return loading;
}

/**
 * The league's scoring rules, cut to what scoring needs, from ESPN's
 * `settings.scoringSettings.scoringItems`. Null when there are none.
 */
export function compactScoring(items) {
  if (!Array.isArray(items) || !items.length) return null;
  return items
    .filter((i) => i && Number.isFinite(Number(i.statId)))
    .map((i) => {
      const o = i.pointsOverrides && typeof i.pointsOverrides === 'object' &&
        Object.keys(i.pointsOverrides).length ? { pointsOverrides: i.pointsOverrides } : {};
      return { statId: Number(i.statId), points: Number(i.points) || 0, ...o };
    });
}

/**
 * One player's projected total under a set of rules.
 *
 * A position override wins over the flat value — ESPN's own rule: a half-PPR
 * league with a TE premium scores stat 53 as `points: 0` with
 * `pointsOverrides: {"1":0.5,"2":0.5,"3":0.5,"4":1}`, keyed by the player's
 * defaultPositionId (docs/espn-draft-api.md §3.3).
 *
 * @param {{p:number, s:Object}} entry one baseline player
 * @param {Array} scoring `[{statId, points, pointsOverrides?}]`
 */
export function scoreEntry(entry, scoring) {
  if (!entry || !entry.s || !Array.isArray(scoring)) return null;
  const pos = String(entry.p);
  let total = 0;
  for (const item of scoring) {
    const v = entry.s[item.statId];
    if (!v) continue;
    const o = item.pointsOverrides;
    const pts = o && o[pos] !== undefined && o[pos] !== null ? Number(o[pos]) : Number(item.points) || 0;
    total += v * pts;
  }
  return total;
}

/** `{perWeek, total, games}` for a man in the copy under these rules, or null. */
export function baselineOf(playerId, scoring) {
  if (!baseline || !Array.isArray(scoring) || playerId === null || playerId === undefined) return null;
  let byId = memo.get(scoring);
  if (!byId) { byId = new Map(); memo.set(scoring, byId); }
  const key = String(playerId);
  if (byId.has(key)) return byId.get(key);
  const e = baseline.players[key];
  let out = null;
  if (e && e.g > 0) {
    const total = scoreEntry(e, scoring);
    if (total > 0) out = { perWeek: Math.round((total / e.g) * 10) / 10, total, games: e.g };
  }
  byId.set(key, out);
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * The arrow's facts, or null for no arrow.
 *
 * @param {number|string} playerId ESPN's id
 * @param {number|null} now the per-week figure the page prints for him
 * @param {Array|null} scoring the league's rules (DEFAULT_PPR on demo)
 * @param {string} [over] the weeks `now` averages, e.g. "weeks 5–14", for the words
 * @returns {{dir:'up'|'down', delta:number, from:number, to:number, over:string}|null}
 */
export function trendOf(playerId, now, scoring, over = '') {
  if (!Number.isFinite(now) || now <= 0) return null;
  const base = baselineOf(playerId, scoring);
  if (!base) return null;
  const to = round1(now);
  const delta = round1(to - base.perWeek);
  if (Math.abs(delta) <= THRESHOLD) return null;
  return { dir: delta > 0 ? 'up' : 'down', delta, from: base.perWeek, to, over: over || '' };
}

const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The tooltip words. ESPN publishes no rest-of-season per-week figure, so the
 * "now" side is said to be the site's own average of ESPN's weekly projections:
 * "Up 4.4 a week since preseason: 21.7 (ESPN’s 9 Sep projection per game) →
 * 26.1 (the site’s average of ESPN’s weekly projections over weeks 5–14)".
 */
export function trendWords(t) {
  if (!t) return '';
  const over = t.over ? ` over ${t.over}` : '';
  return `${t.dir === 'up' ? 'Up' : 'Down'} ${Math.abs(t.delta).toFixed(1)} a week since preseason: ` +
    `${t.from.toFixed(1)} (ESPN’s ${BASELINE_DATE} projection per game) → ${t.to.toFixed(1)} ` +
    `(the site’s average of ESPN’s weekly projections${over})`;
}

/**
 * The arrow itself: a small ▲ in green or ▼ in red, after the name. Its words
 * are on the title and, for a screen reader, in an sr-only span INSIDE it —
 * the span is `position: relative` so the absolute sr-only cannot escape a
 * `.table-scroll` and widen the phone page (the bye pill's measured trap).
 */
export function trendHtml(t) {
  if (!t) return '';
  const words = trendWords(t);
  return `<span class="trend trend-${t.dir}" title="${escHtml(words)}">` +
    `<span aria-hidden="true">${t.dir === 'up' ? '▲' : '▼'}</span>` +
    `<span class="sr-only"> (${escHtml(words)})</span></span>`;
}

/** The one-sentence key, only where an arrow is drawn (rule 16). */
export const TREND_KEY = 'Green ▲ / red ▼ by a name: projection up / down over 2 a week since preseason.';
export const hasTrend = (html) => /\btrend-(up|down)\b/.test(html || '');

/** The line behind "How this works" (rule 7), naming the weeks "now" covers. */
export function trendExplain(weeksLabel, extra = '') {
  return `<strong>A green ▲ or red ▼ by a name</strong>: his per-week projection is more than ` +
    `${THRESHOLD} points above or below ESPN’s preseason one. Preseason is ESPN’s ` +
    `${BASELINE_DATE} projection per game, re-scored with your league’s rules; now is the site’s ` +
    `average of ESPN’s weekly projections${weeksLabel ? `, over ${weeksLabel}` : ''}. A man ESPN had ` +
    `no preseason line for gets no arrow.${extra ? ` ${extra}` : ''}`;
}
