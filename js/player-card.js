// The player card: one man's identity, and his whole season as a chart.
//
// ===========================================================================
// THE API, stated explicitly because more than one page codes against it.
// ===========================================================================
//
// Building a run (the data the chart is drawn from):
//
//   weekRun({ heading, weeks, projections, actuals, currentWeek, demo })
//       -> { heading, pending, cols, legend } | null
//     `weeks`       [1,2,3,…]   the week numbers, in order.
//     `projections` one entry per week, in the SAME order. Each is either a
//                   number, or one of the four no-number states this site
//                   tells apart by word AND by class:
//                     'wait'    that week has not been read from ESPN yet
//                     'failed'  ESPN refused that week for everybody
//                     'off'     he was not on this roster that week
//                     null      ESPN carried no number for him that week
//                   A number 0 means "no game that week" on LIVE data and is
//                   drawn "Bye"; on demo data a zero is a real zero, which is
//                   what `demo: true` says.
//     `actuals`     one entry per week, same order and same vocabulary. What
//                   he ACTUALLY scored. See "the Act row" below.
//     `currentWeek` the week the rest of the page is showing; it is bracketed.
//     `heading`     the sub-line under the identity, e.g. "ESPN's projection
//                   for weeks 1–13". Say whose numbers they are.
//   Returns null when there is nothing to draw, which the card handles.
//
// Registering one, and getting the key that goes in the markup:
//
//   registerRun({ ident, run, href }, prefix) -> key       an opaque string
//   TIP_ATTR                                              'data-tip'
//   tipAttr(key)                                          ' data-tip="…"'
//   clearRuns()                       every registered run on the page is dead
//
//     `ident` is the identity line — name · position · NFL team · injury.
//     `href`  is the player click-through (waivers.html?player=<espnPlayerId>)
//             or null for a man ESPN gives no id for. It is only READ in the
//             sheet, where it becomes the button the tap preempted.
//
//     Put the key on the element the reader points at:
//         `<td class="…"${tipAttr(key)}>…</td>`
//     Any element carrying `data-tip` works; it does not have to be a <td>.
//
// Wiring a container, and the rest:
//
//   wireTips(element)     delegate hover / focus / tap on any container
//   hideTip()             close whatever is open (call before you rebuild)
//   clickIsPlayer(event)  did this click land on a player, or on the row
//                         around him? Ask this from any OTHER handler on the
//                         same element, so the two cannot disagree.
//
//   The page must also carry the `.tipcard` / `.tc-*` CSS. analysis.html has
//   it; a second page needs the same block.
//
// ===========================================================================
//
// WHY A CARD OF OUR OWN, and what each part of it pays for.
//
// Tim asked for the week run as a chart — week numbers along the top,
// projections underneath — and a native `title` cannot draw one. It renders in
// the OS UI font, where a space is narrower than a digit and "Bye" is nothing
// like either, so no amount of padding lines thirteen columns up. A real table
// does it exactly, and tabular figures keep every column the same width
// whatever is in it.
//
// What that costs, and how each part is paid:
//
//   - Clipping. The analysis grids live in `.table-scroll`, which is
//     `overflow:auto`, and a card inside one would be cut off at its edge. So
//     the card is a child of <body> and positioned `fixed`.
//   - Flicker. `pointer-events:none`, so the card can never be the thing the
//     mouse is over and cannot chase itself around the screen.
//   - Two tooltips. The cells that carry a key must carry NO `title` at all —
//     one beside the card would have the browser draw its own on top a moment
//     later. The link carries `aria-label` instead: same words, nothing drawn.
//   - Keyboard. Shown on focusin too, so tabbing the links reveals the same
//     thing hovering does. Escape closes it.
//
// The data is REGISTERED rather than written into the markup: thirteen weeks
// on 170 cells in each of two grids is tens of kilobytes of duplicated
// attribute for something that is read for two seconds.
//
// THE KEY IS A BARE COUNTER, NOT THE PLAYERID. It was the playerId once, and
// that quietly cost the hover to every man ESPN gives no id for. The card does
// not depend on the link and must not start to. A counter is unique by
// construction and needs nothing at all from the data.
//
// ON A PHONE THERE IS NO HOVER, and this is the one thing on the site that
// would simply cease to exist rather than merely look cramped: on the analysis
// grids every cell is a bare number, the card is the only place the man's NAME
// appears, and a tap on the cell followed the link straight off the page. So a
// touch screen gets the same card as a SHEET — the tap opens it instead of
// navigating, and the navigation it replaced becomes a button inside it, which
// is strictly more than the hover offers.
//
// The two modes differ in three ways and share everything else:
//
//   hover:  floats under the cell, `pointer-events: none`, closes on mouseout.
//   sheet:  pinned to the bottom of the window, interactive, closes on Escape,
//           on its own Close, or on a tap anywhere outside it.
//
// The mode is decided per event by `coarsePointer()` rather than once at load,
// so a tablet with a keyboard attached mid-session gets the right one, and a
// desktop window narrowed to a phone's width keeps its hover card — that is
// about width, and this is about whether there is a pointer at all.

import { coarsePointer } from './connection.js';

// A local copy rather than an import: this module has to stand on its own for
// any page that wants the card, and a four-line escaper is a smaller price
// than a dependency on one page's helpers.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const fmt = (n) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(1);

// -------------------------------------------------------------- the run data

/**
 * How a week's PROJECTION reads, and which of the five states it is.
 *
 * The ways of having no number stay different things, exactly as they are in
 * the season grid — that table tells them apart by class, and so does this.
 */
export function projToken(v, demo = false) {
  if (v === 'wait') return { text: '·', kind: 'wait' };
  if (v === 'failed') return { text: '—', kind: 'none' };
  if (v === 'off') return { text: 'off', kind: 'off' };
  if (v === null || v === undefined) return { text: '—', kind: 'none' };
  // Only ESPN means "no game that week" by a 0.00. The sample data means "we
  // have ruled him out", so demo prints the number rather than claiming a bye
  // it cannot know about — the same rule the season grid follows.
  if (v === 0 && !demo) return { text: 'Bye', kind: 'bye' };
  return { text: fmt(v), kind: 'num' };
}

/**
 * How a week's ACTUAL reads. Tim's ask, in his words: "add another row below
 * proj that is act. If it's week 5, all columns before week 5 should have a
 * filled in act. anything after leave blank."
 *
 * THE RULE IS THE DATA, NOT THE CALENDAR. A week he has actually played has a
 * number recorded against it; a week still to come has none. So the test is
 * "is there an actual?" rather than "is this week number below today's?" —
 * which is also the only test that stays right when a week is postponed, when
 * a league is read mid-game, or when the page is replaying an old snapshot.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 *   - It never draws one of the four no-number marks. `Bye`, `—`, `off` and
 *     `·` each mean something specific in the Proj row above, and repeating
 *     them here would be a second claim made from the same fact. A week with
 *     no actual is simply BLANK, which is the whole of what "we have no result
 *     for him that week" needs to say.
 *   - A ZERO IS A REAL ZERO. A man who played and scored nothing reads "0.0",
 *     not a blank and not a bye. That is the fact a manager most wants to see
 *     under a projection of fourteen points, and turning it into any kind of
 *     absence would be the single worst thing this row could do.
 *
 * The ONE exception is a week that has not been read from ESPN yet: a blank
 * there would claim a result we have simply not looked up, so it keeps the `·`
 * the Proj row uses, and the legend line that already explains it.
 */
export function actToken(v) {
  if (v === 'wait') return { text: '·', kind: 'wait' };
  if (typeof v === 'number' && !Number.isNaN(v)) return { text: fmt(v), kind: 'num' };
  return { text: '', kind: 'blank' };
}

/** Explained only when it actually turns up, so a clean run has no legend. */
export const RUN_KEYS = {
  bye: 'Bye = the 0.00 ESPN returns for a player whose NFL team is off that week',
  none: '— = ESPN carried no number for him that week',
  off: 'off = he was not on this roster that week',
  wait: '· = that week has not been read from ESPN yet',
};

/**
 * One player's whole season, as the data the chart is drawn from.
 *
 * The weeks arrive in batches behind the page, so this has to read correctly
 * when they are not all in — which is why an unread week is its own state and
 * why a run with nothing in it yet says so in words rather than drawing
 * thirteen empty columns.
 */
export function weekRun({
  heading = '',
  weeks = [],
  projections = [],
  actuals = [],
  currentWeek = null,
  demo = false,
} = {}) {
  if (!weeks.length) return null;

  if (projections.every((v) => v === 'wait')) {
    return { heading, pending: 'Not read yet — they fill in behind the page.', cols: [], legend: [] };
  }

  const cols = weeks.map((week, i) => ({
    week,
    proj: projToken(projections[i], demo),
    act: actToken(actuals[i]),
    now: week === currentWeek,
  }));

  // The legend names a mark only where it occurs, and BOTH rows can put one on
  // screen — the Act row's `·` is the same `·`, so it must be able to pull in
  // the same line rather than sitting there unexplained.
  const used = new Set();
  for (const c of cols) { used.add(c.proj.kind); used.add(c.act.kind); }
  const legend = Object.entries(RUN_KEYS).filter(([k]) => used.has(k)).map(([, s]) => s);
  return { heading, pending: '', cols, legend };
}

// --------------------------------------------------- registering and wiring

const RUNS = new Map();   // key -> { ident, run, href }
let seq = 0;              // just a counter: see the key note at the top

export const TIP_ATTR = 'data-tip';

/**
 * Register one man's card and get back the key that goes in the markup.
 *
 * `prefix` is only a debugging courtesy — it lets you see which container a key
 * came from — and nothing reads it back. Uniqueness comes from the counter.
 */
export function registerRun({ ident = '', run = null, href = null } = {}, prefix = 'p') {
  const key = `${prefix}:${seq++}`;
  RUNS.set(key, { ident, run, href });
  return key;
}

/** ` data-tip="…"`, ready to drop into a tag. Leading space included. */
export function tipAttr(key) {
  return ` ${TIP_ATTR}="${esc(key)}"`;
}

/**
 * Every registered run on the page is dead — call this when the markup
 * carrying the keys is about to be replaced.
 *
 * The counter is NOT wound back. It costs nothing to let it climb, and a key
 * that never repeats cannot collide with one still sitting in a container that
 * was not re-rendered — which matters now that a page can have more than one.
 */
export function clearRuns() {
  RUNS.clear();
}

let cardEl = null;
let asSheet = false;      // is the card currently open as a tap-opened sheet?

// `coarsePointer` is imported from connection.js rather than written again
// here. Two things turn on it — whether this card opens as a tap-opened sheet,
// and whether the connection bar tells a reader to install an extension their
// browser cannot load — and two copies of one question is how two answers start.

/**
 * Did this click land on a PLAYER, or on the row around him?
 *
 * The analysis grids are one clickable row per team — clicking one drills into
 * it below — with a cell per player inside. Every click therefore belongs to
 * exactly one of the two, and something has to decide which.
 *
 * With a mouse the LINK decides: a number is an `<a class="pref">`, it is
 * followed, and the row lets it through. A finger has no link to decide with —
 * the tap opens the card instead of navigating — and a man ESPN gave no
 * playerId for has no `<a>` in his cell AT ALL, so on a touch screen the
 * question has to be asked of the CELL rather than of what happens to be
 * inside it. That gap was a real defect: a tap on such a cell opened his card
 * AND silently re-pointed the three panels below at a team nobody picked.
 *
 * Any other handler on the same element must ask this too, in these terms, so
 * the two cannot come to different answers about one click.
 */
export function clickIsPlayer(e) {
  if (!e.target || !e.target.closest) return false;
  if (e.target.closest('a.pref')) return true;
  return coarsePointer() && !!e.target.closest(`[${TIP_ATTR}]`);
}

function cardNode() {
  if (cardEl) return cardEl;
  cardEl = document.createElement('div');
  cardEl.id = 'tipCard';
  cardEl.className = 'tipcard';
  cardEl.setAttribute('role', 'tooltip');
  cardEl.hidden = true;
  document.body.appendChild(cardEl);
  return cardEl;
}

// ----------------------------------------------------------- drawing the card

/**
 * The footer a SHEET gets and a hover card does not.
 *
 * On a phone the tap that opened this card is the tap that used to follow the
 * link, so the link has to come back somewhere — here, as a real `<a href>` so
 * it is still the site's one player-link contract and still opens in a new tab
 * from a long-press. The Close button is beside it because a sheet that can
 * only be dismissed by guessing where "outside" is is a trap.
 */
function actionsHtml(href) {
  if (!asSheet) return '';
  const open = href
    ? `<a class="tc-open" href="${esc(href)}">His next 13 weeks &rarr;</a>`
    : '<span class="tc-open tc-open-off">ESPN gives this man no id to look up</span>';
  return `<div class="tc-actions">${open}<button type="button" class="tc-close">Close</button></div>`;
}

// THE RUN WRAPS; IT NEVER SCROLLS. Tim's ask, in his words: "For the preview,
// remove scrolling on the box, just show the whole thing, no matter how long it
// gets." So `.tc-scroll` and its `overflow-x: auto` are gone, and the run is cut
// into LINES that each fit the space the card has.
//
// Wrapping rather than shrinking the columns, and that was a choice between two
// honest answers:
//
//   - Narrower columns cannot be made to work at the sizes involved. A 390px
//     phone leaves about 300px once the card's padding and the row labels are
//     paid for; thirteen weeks in that is 23px a column, and "18.2" in tabular
//     figures does not fit in 23px at any font size a person would read. It
//     also fails the actual ask — "no matter how long it gets" means the layout
//     has to survive a seventeen-week run, where shrinking gets worse rather
//     than better.
//   - Wrapping scales with BOTH, and costs one thing: the reader's eye has to
//     travel down a line. Week numbers are on every line, so nothing has to be
//     counted to know where you are.
//
// The width is computed from `window.innerWidth` and the constants below rather
// than measured off the rendered card, for the same reason `placeTip` guards
// every measurement: a test harness has no layout, and this must not throw or
// go strange in one. With no window to ask, it assumes a desktop and puts the
// whole run on one line, which is what a desktop gets anyway.
const CHART = {
  col: 36,         // a run column: the 34px floor in the CSS, plus a little
  label: 56,       // the "Week"/"Proj"/"Act" column down the left
  cardPad: 24,     // .tipcard horizontal padding
  sheetPad: 28,    // .tipcard.sheet horizontal padding
  cardMax: 720,    // .tipcard max-width
  cardVw: 0.92,    // .tipcard max-width, the vw half of it
  safety: 8,       // never let the last column sit flush against the edge
  min: 3,          // a line of fewer than three weeks is not a chart
};

/** How many weeks fit on one line of the chart, in this mode, on this screen. */
function perLine(sheet) {
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
  const outer = sheet
    ? vw - CHART.sheetPad
    : Math.min(vw * CHART.cardVw, CHART.cardMax) - CHART.cardPad;
  const room = outer - CHART.label - CHART.safety;
  return Math.max(CHART.min, Math.floor(room / CHART.col));
}

/**
 * Cut the run into lines of at most `cap` weeks, balanced.
 *
 * Balanced rather than greedy: thirteen weeks with room for eight would give
 * 8 + 5 greedily and 7 + 6 balanced, and a line with one or two weeks on it
 * reads as a mistake rather than as the end of a run.
 */
function chartLines(cols, cap) {
  if (cols.length <= cap) return [cols];
  const lines = Math.ceil(cols.length / cap);
  const each = Math.ceil(cols.length / lines);
  const out = [];
  for (let i = 0; i < cols.length; i += each) out.push(cols.slice(i, i + each));
  return out;
}

/**
 * One line of the chart: week numbers, the projection under each, the actual
 * under that.
 *
 * A real table, so the three rows share ONE set of column widths and a number
 * sits under its own week whatever is in it. That is the entire reason this is
 * a table and not a string, and a third row makes it easier to get wrong, not
 * easier to get away with.
 *
 * The Act row is in a `<tfoot>` rather than beside the Proj row in the
 * `<tbody>`: they are one table for the column widths, but the projections are
 * the body of the thing and the actuals are the footnote to them.
 *
 * Lines are not padded out to equal length. Every token in the run is at most
 * four tabular characters — "18.2", "Bye", "off" — which is narrower than the
 * 34px floor on a column, so every column is exactly that floor and the lines
 * align under each other without filler. Filler would also be a SECOND kind of
 * empty cell in the Act row, which is the one row where empty already means
 * something.
 */
function lineHtml(cols) {
  const weeks = cols
    .map((c) => `<th${c.now ? ' class="now"' : ''} scope="col">${c.week}</th>`).join('');
  const projs = cols
    .map((c) => `<td class="k-${c.proj.kind}${c.now ? ' now' : ''}">${esc(c.proj.text)}</td>`).join('');
  const acts = cols
    .map((c) => `<td class="a-${c.act.kind}${c.now ? ' now' : ''}">${esc(c.act.text)}</td>`).join('');
  return (
    '<table class="tc-run">' +
    `<thead><tr><th class="tc-lbl" scope="row">Week</th>${weeks}</tr></thead>` +
    `<tbody><tr><th class="tc-lbl" scope="row">Proj</th>${projs}</tr></tbody>` +
    `<tfoot><tr><th class="tc-lbl" scope="row">Act</th>${acts}</tr></tfoot>` +
    '</table>'
  );
}

/** The identity line, the chart, what the chart means, and the sheet's actions. */
function cardHtml({ ident, run, href }, sheet) {
  const head = `<div class="tc-ident">${esc(ident)}</div>`;
  if (!run) return `${head}${actionsHtml(href)}`;

  const sub = `<div class="tc-head">${esc(run.heading)}</div>`;
  if (run.pending) {
    return `${head}${sub}<div class="tc-pending">${esc(run.pending)}</div>${actionsHtml(href)}`;
  }

  const lines = chartLines(run.cols, perLine(sheet))
    .map(lineHtml).join('');

  // A BLANK IN THE ACT ROW IS A CLAIM, so it is stated rather than left to be
  // guessed at. It goes here rather than in the legend because the legend
  // explains MARKS, and the whole point of a blank is that it is not one.
  const note = run.cols.some((c) => c.act.kind === 'blank')
    ? '<div class="tc-note">Act is what he actually scored. It is blank for a week with no ' +
      'result recorded yet.</div>'
    : '';

  const legend = run.legend.length
    ? `<div class="tc-legend">${run.legend.map((l) => esc(l)).join('<br>')}</div>`
    : '';

  return `${head}${sub}<div class="tc-chart">${lines}</div>${note}${legend}${actionsHtml(href)}`;
}

/**
 * @param {Element} cell  the element carrying the data-tip key
 * @param {boolean} sheet open it as a tap-opened sheet rather than a hover card
 */
function showTip(cell, sheet = false) {
  const data = RUNS.get(cell.dataset ? cell.dataset.tip : cell.getAttribute(TIP_ATTR));
  if (!data) return;
  const el = cardNode();
  asSheet = sheet;                        // read by cardHtml, so set it first
  el.innerHTML = cardHtml(data, sheet);
  el.classList.toggle('sheet', sheet);
  // A hover card is a tooltip; a thing you opened, can read and must dismiss is
  // a dialog, and the difference is what a screen reader announces.
  el.setAttribute('role', sheet ? 'dialog' : 'tooltip');
  el.hidden = false;
  // A sheet is pinned to the foot of the window by CSS and needs no measuring —
  // which is also what makes it reliable on a screen where the cell it came
  // from may be most of the viewport wide. The inline top/left are cleared
  // rather than overridden: on a touchscreen laptop a hover can have placed the
  // card already, and an inline style beats any class rule that follows it.
  if (sheet) {
    el.style.top = '';
    el.style.left = '';
  } else {
    placeTip(cell);
  }
}

/** Close whatever is open. */
export function hideTip() {
  if (cardEl) cardEl.hidden = true;
  asSheet = false;
}

/**
 * Put it under the cell, and keep it on screen.
 *
 * This matters MORE now that the card has no inner scroller: its width is
 * whatever its widest line needs, so it is the one thing standing between a
 * thirteen-week run opened on the right-hand edge of a wide grid and a card
 * hanging off the side of the window. `perLine` keeps a line inside the card's
 * own max-width; this keeps the card inside the window.
 *
 * Every measurement is guarded: a test harness has no layout, and a tooltip is
 * never worth throwing an exception out of a render for. Without geometry it
 * simply sits where it was told, which is still correct markup.
 */
function placeTip(cell) {
  const el = cardEl;
  if (!el || typeof cell.getBoundingClientRect !== 'function') return;
  try {
    const c = cell.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const gap = 8;

    // Below by default; above when there is no room, which there often is not
    // for a row near the foot of a ten-team grid.
    let top = c.bottom + gap;
    if (top + t.height > vh - gap) top = Math.max(gap, c.top - t.height - gap);

    // Left-aligned to the cell, then pulled back inside the window rather than
    // allowed to run off the right of a wide table.
    let left = c.left;
    if (left + t.width > vw - gap) left = Math.max(gap, vw - t.width - gap);

    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  } catch { /* no layout: the card is still correct, just unplaced */ }
}

/**
 * One delegated set per container. `mouseover`/`mouseout` rather than
 * enter/leave because only these bubble, and the cell is found with closest()
 * so moving between the number and its link inside one cell is not a leave.
 *
 * The `click` handler is the touch half, and it does three things in order that
 * all matter:
 *
 *   1. It only acts on a coarse pointer. A mouse click on one of these cells
 *      must still follow the link, which is what every other page's click does
 *      and what `link-check.mjs` follows.
 *   2. It leaves every MODIFIED click alone — ctrl/cmd/shift/middle — so
 *      open-in-new-tab keeps working on a tablet with a keyboard.
 *   3. It stops the event before it reaches the document, where the handler
 *      that closes a sheet on an outside tap is waiting — the tap that OPENED
 *      it is not an outside tap, and without this the sheet would be dismissed
 *      by the gesture that asked for it.
 *
 * What it does NOT do is keep a clickable row underneath from acting: such a
 * handler is on the same element and is usually registered first, so it has
 * already run by the time anything here could stop it. `clickIsPlayer` is
 * where that is settled, by both sides asking the same question.
 */
export function wireTips(el) {
  if (!el) return;
  const cellOf = (e) => (e.target.closest ? e.target.closest(`[${TIP_ATTR}]`) : null);

  el.addEventListener('mouseover', (e) => {
    const cell = cellOf(e);
    if (cell && !asSheet) showTip(cell);
  });
  el.addEventListener('mouseout', (e) => {
    if (asSheet) return;   // a sheet is dismissed deliberately, never by drift
    const cell = cellOf(e);
    // Still inside the same cell — moving onto the link within it — is not a
    // leave, and treating it as one is what makes a card flicker.
    if (cell && e.relatedTarget && cell.contains(e.relatedTarget)) return;
    if (cell) hideTip();
  });
  el.addEventListener('focusin', (e) => {
    const cell = cellOf(e);
    if (cell && !asSheet) showTip(cell);
  });
  el.addEventListener('focusout', (e) => {
    if (cellOf(e) && !asSheet) hideTip();
  });

  el.addEventListener('click', (e) => {
    if (!coarsePointer()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    const cell = cellOf(e);
    if (!cell) return;
    e.preventDefault();
    e.stopPropagation();
    showTip(cell, true);
  });
}

/**
 * Dismissing a sheet. Three ways, because a sheet that can only be closed one
 * way is a sheet somebody gets stuck under: its own Close button, Escape, and
 * a tap anywhere outside it. The cell taps that OPEN one call stopPropagation,
 * so the outside-tap handler never sees the tap that arrived a moment ago.
 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTip();
});

document.addEventListener('click', (e) => {
  if (!asSheet || !cardEl || cardEl.hidden) return;
  const inside = typeof cardEl.contains === 'function' && cardEl.contains(e.target);
  // Inside, but on the Close button, or anywhere outside: gone. The link is the
  // one thing inside that is left to do its own job.
  if (!inside || (e.target.closest && e.target.closest('.tc-close'))) hideTip();
});
