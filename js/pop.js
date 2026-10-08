// THE STAT CARD — "what is this number made of", one card for the whole site.
//
// Tim, 2026-10-08: "If the user is curious about a number or it's breakdown or
// a detail about a stat or column or anything they should be able to hover over
// it and show a preview. … Also connectors to other places in the cite using
// previews is a huge advantage as well so check that out and build any
// connectors by clicking on the preview."
//
// This is the Stats page's breakdown popover (2026-10-05/06: the parts of a
// luck cell, the fixtures behind a schedule gap) lifted out so every page can
// open the same thing. It is the sibling of the player card
// (js/player-card.js): that one is about a MAN, this one about a NUMBER, and
// they share one frame (`.tipcard` in css/app.css) so they are visibly the same
// family.
//
// ===========================================================================
// THE API
// ===========================================================================
//
//   statCard(spec, opts?) -> ' data-pop="n:12" tabindex="0"'
//       Registers a card and returns the ATTRIBUTE that goes on the element
//       the reader points at — the same pattern as the player card's
//       `tipAttr(registerRun(…))`, in one call:
//           `<td${statCard({ title: 'Luck score', rows, total })}>+12.4</td>`
//       opts: { prefix = 'n', focusable = true }
//         `prefix`    names the container, for `clearPops(prefix)`.
//         `focusable` adds tabindex="0" so the keyboard reaches it; pass false
//                     for an element that already takes focus (an <a>, a
//                     <button>).
//
//   spec = {
//     title,              'Kenny' — the bold line at the top
//     sub?,               'Luck score' — dim, after a middle dot
//     head?,              ['Wk', 'Opponent', 'Proj'] — column headings, when
//                         the rows need them (most cards do not)
//     rows: [{ label, value, note?, lead?, html? }],
//                         label left, value right. `note` is a few dim words
//                         after the label; `lead` is a narrow first column (a
//                         week number); `html` is the value as trusted markup
//                         when it needs a class (a signed +/−).
//     totals?: [{ label, value, html? }],   dim lines above the total
//     total?: { label, value, html? } | number | string,
//                         the last line, in bold: the figure the rows come to.
//                         A bare value is labelled "Total".
//     foot?,              one short dim line under the rows
//     href?, hrefLabel?,  THE CONNECTOR: where a click goes (js/links.js), and
//                         what the sheet's button says ('Open' if omitted).
//   }
//   A number value is printed to one decimal; a string is printed as given.
//
//   registerPop(spec, prefix?) -> key     popAttr(key, opts?) -> attribute
//       the two halves of `statCard`, for a caller that wants the key.
//   clearPops(prefix?)     every registered card (of that prefix) is dead —
//                          call it before re-rendering the markup that carries
//                          the keys.
//   wirePops(container, { selector?, card? })
//       One delegated set of listeners; safe to call again on the same
//       container. By default it serves elements carrying `data-pop`. With
//       `selector` + `card(el) -> spec | null` it serves any element WITHOUT
//       registering anything: the card is built when it is asked for (the
//       Stats page's fifty cells do this — `td[data-explain]`).
//   hidePop()              close whatever is open.
//   statCardHtml(spec, sheet?) -> string   the card's markup, for a test.
//   teamWeekCard({ team, week, total, starters, href?, hrefLabel? }) -> attr
//       a team's week broken into its starters — see below.
//
// ===========================================================================
// HOW IT BEHAVES — the same as the player card, and deliberately so
// ===========================================================================
//
//   A MOUSE: hover (or keyboard focus) shows the card beside the figure;
//     moving off hides it. The card is `pointer-events: none`, so it can never
//     be the thing the mouse is over. A CLICK on the figure follows `href` —
//     that is the connector — and Enter does the same from the keyboard. A
//     figure with no `href` does nothing on click. Ctrl/cmd/shift/middle
//     clicks are left alone.
//   A FINGER (`coarsePointer()`): there is no hover, so a tap opens the same
//     card as a SHEET at the foot of the window, with `href` as a button
//     (`.tc-open`) and a Close. Escape or a tap outside also closes it.
//
//   ONE PREVIEW PER NUMBER. An element that opens a card must not also carry a
//   `title` — the browser would draw its own tooltip over the card, and
//   js/touch-titles.js would open a second sheet. `statCard` emits none, and a
//   `title` found on the element when its card opens is removed.
//
//   ONE CARD OPEN AT A TIME, site-wide: opening a stat card closes the player
//   card and the reverse.
//
// See tests/pop-check.mjs.

import { coarsePointer } from './connection.js';
import { hideTip } from './player-card.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export const POP_ATTR = 'data-pop';
/** Marks an element whose click goes somewhere, so the cursor can say so. */
export const POP_GO_ATTR = 'data-pop-go';

const POPS = new Map();   // key -> spec
let seq = 0;              // a bare counter, never wound back (see player-card.js)

/** Register one card; the key goes in the markup through `popAttr`. */
export function registerPop(spec, prefix = 'n') {
  const key = `${prefix}:${seq++}`;
  POPS.set(key, spec || {});
  return key;
}

/** ` data-pop="…"`, ready to drop into a tag. Leading space included. */
export function popAttr(key, { focusable = true } = {}) {
  const spec = POPS.get(key);
  return ` ${POP_ATTR}="${esc(key)}"${spec && spec.href ? ` ${POP_GO_ATTR}` : ''}` +
    `${focusable ? ' tabindex="0"' : ''}`;
}

/** Register a card and get its attribute, in one call. */
export function statCard(spec, { prefix = 'n', focusable = true } = {}) {
  return popAttr(registerPop(spec, prefix), { focusable });
}

/** Forget every registered card, or every one of a prefix. */
export function clearPops(prefix = null) {
  if (prefix === null) { POPS.clear(); return; }
  const head = `${prefix}:`;
  for (const key of [...POPS.keys()]) if (key.startsWith(head)) POPS.delete(key);
}

// ------------------------------------------------------------ the markup

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** A value as a cell prints it: trusted `html`, a number to a tenth, or text. */
function valueHtml(r) {
  if (r && r.html !== undefined && r.html !== null) return String(r.html);
  const v = r ? r.value : null;
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  return isNum(v) ? v.toFixed(1) : esc(v);
}

/**
 * The card's markup. `sheet` adds the actions row (the link button and Close);
 * a hover card has neither, because it cannot be clicked.
 */
export function statCardHtml(spec, sheet = false) {
  const s = spec || {};
  const rows = Array.isArray(s.rows) ? s.rows : [];
  const lead = rows.some((r) => r.lead !== undefined && r.lead !== null);
  const pad = lead ? '<td></td>' : '';
  const title = `<div class="tc-ident">${esc(s.title ?? '')}` +
    `${s.sub ? ` <span class="muted">· ${esc(s.sub)}</span>` : ''}</div>`;
  const head = Array.isArray(s.head) && s.head.length
    ? `<thead><tr>${s.head.map((h, i) =>
      `<th class="${(lead && i === 0) || i === s.head.length - 1 ? 'num' : 'name'}">${esc(h)}</th>`).join('')}</tr></thead>`
    : '';
  const body = rows.map((r) =>
    `<tr>${lead ? `<td class="num sc-lead">${esc(r.lead ?? '')}</td>` : ''}` +
    `<td class="name">${esc(r.label ?? '')}${r.note ? `<span class="sc-note">${esc(r.note)}</span>` : ''}</td>` +
    `<td class="num">${valueHtml(r)}</td></tr>`).join('');
  const total = s.total === undefined || s.total === null ? null
    : (typeof s.total === 'object' ? s.total : { label: 'Total', value: s.total });
  const footRow = (r, cls = '') =>
    `<tr${cls ? ` class="${cls}"` : ''}>${pad}<td class="name">${esc(r.label ?? '')}</td>` +
    `<td class="num">${valueHtml(r)}</td></tr>`;
  const foots = (Array.isArray(s.totals) ? s.totals : []).map((r) => footRow(r)).join('') +
    (total ? footRow(total, 'sc-total') : '');
  // `tableHtml` (trusted): a table of more than three columns, drawn as given.
  const table = s.tableHtml ? String(s.tableHtml) : rows.length || foots
    ? `<table class="sc-rows">${head}<tbody>${body}</tbody>${foots ? `<tfoot>${foots}</tfoot>` : ''}</table>`
    : '';
  const foot = s.foot ? `<div class="sc-foot">${esc(s.foot)}</div>` : '';
  const actions = sheet
    ? '<div class="tc-actions">' +
      (s.href ? `<a class="tc-open" href="${esc(s.href)}">${esc(s.hrefLabel || 'Open')} &rarr;</a>` : '') +
      '<button type="button" class="tc-close">Close</button></div>'
    : '';
  return `${title}${table}${foot}${actions}`;
}

// --------------------------------------------------- opening and closing

let cardEl = null;
let asSheet = false;
let openFor = null;       // the element the open card belongs to

function cardNode() {
  if (cardEl) return cardEl;
  cardEl = document.createElement('div');
  cardEl.id = 'statCard';
  cardEl.className = 'tipcard statcard';
  cardEl.setAttribute('role', 'tooltip');
  cardEl.hidden = true;
  document.body.appendChild(cardEl);
  return cardEl;
}

/** Close whatever is open. */
export function hidePop() {
  if (cardEl) cardEl.hidden = true;
  asSheet = false;
  openFor = null;
}

/** Is a stat card open as a sheet? (The player card asks before it opens.) */
export const popIsSheet = () => asSheet;

/**
 * Beside the figure: its right edge on the figure's, below it unless only
 * above has the room — where the Stats page's first card of this kind sat.
 * Guarded: a test harness has no layout, and a card is never worth throwing
 * out of a render for.
 */
function place(el) {
  const c = cardEl;
  if (!c || typeof el.getBoundingClientRect !== 'function') return;
  try {
    const r = el.getBoundingClientRect();
    const w = c.offsetWidth || 0;
    const h = c.offsetHeight || 0;
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const left = Math.max(8, Math.min(r.right - w, vw - w - 8));
    const below = r.bottom + 6;
    const top = below + h <= vh - 8 ? below : Math.max(8, r.top - h - 6);
    c.style.left = `${Math.round(left)}px`;
    c.style.top = `${Math.round(top)}px`;
  } catch { /* no layout: the card is still correct, just unplaced */ }
}

function show(el, spec, sheet) {
  if (!spec) return false;
  // ONE PREVIEW PER NUMBER: a `title` beside the card would be a second one.
  if (el.hasAttribute && el.hasAttribute('title')) el.removeAttribute('title');
  hideTip();
  const c = cardNode();
  asSheet = sheet;
  openFor = el;
  c.innerHTML = statCardHtml(spec, sheet);
  c.classList.toggle('sheet', sheet);
  c.setAttribute('role', sheet ? 'dialog' : 'tooltip');
  c.hidden = false;
  c.style.top = '';
  c.style.left = '';
  if (!sheet) place(el);
  return true;
}

/** Follow a card's link the way a click on a link would. */
function go(href) {
  if (!href || typeof window === 'undefined' || !window.location) return;
  if (typeof window.location.assign === 'function') window.location.assign(href);
  else window.location.href = href;
}

const WIRED = '__popWired';

/**
 * One delegated set of listeners per (container, selector).
 *
 * @param {Element} el the container; it may be re-rendered freely afterwards
 * @param {Object} [o]
 * @param {string} [o.selector] the elements that open a card. Default: any
 *        element carrying `data-pop` (a `statCard(...)` attribute).
 * @param {(el: Element) => Object|null} [o.card] the spec for one of them,
 *        built on demand. Default: the registered spec for its `data-pop` key.
 */
export function wirePops(el, { selector = `[${POP_ATTR}]`, card = null } = {}) {
  if (!el) return;
  const done = el[WIRED] || (el[WIRED] = new Set());
  if (done.has(selector)) return;
  done.add(selector);

  const cellOf = (e) => (e.target && e.target.closest ? e.target.closest(selector) : null);
  const specOf = (cell) => (card ? card(cell)
    : POPS.get(cell.getAttribute(POP_ATTR)) || null);

  el.addEventListener('mouseover', (e) => {
    const cell = cellOf(e);
    // A phone fires a mouseover on every tap; the tap's own handler opens it.
    if (cell && !asSheet && !coarsePointer()) show(cell, specOf(cell), false);
  });
  el.addEventListener('mouseout', (e) => {
    if (asSheet) return;      // a sheet is dismissed deliberately, never by drift
    const cell = cellOf(e);
    // Moving between the parts of one figure (a value and its ±) is not leaving it.
    if (cell && e.relatedTarget && cell.contains(e.relatedTarget)) return;
    if (cell) hidePop();
  });
  el.addEventListener('focusin', (e) => {
    const cell = cellOf(e);
    if (cell && !asSheet && !coarsePointer()) show(cell, specOf(cell), false);
  });
  el.addEventListener('focusout', (e) => {
    if (cellOf(e) && !asSheet) hidePop();
  });

  el.addEventListener('click', (e) => {
    const cell = cellOf(e);
    if (!cell) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    const spec = specOf(cell);
    if (!spec) return;
    if (coarsePointer()) {
      // The tap that opens the sheet is not an outside tap, and it must not
      // also follow a link or open a title sheet underneath.
      e.preventDefault();
      e.stopPropagation();
      show(cell, spec, true);
      return;
    }
    // A mouse: the click is the connector. A real link inside the figure (or
    // the figure being one) is left to do its own job.
    if (!spec.href) return;
    if (e.target.closest && e.target.closest('a[href]')) return;
    e.preventDefault();
    hidePop();
    go(spec.href);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const cell = cellOf(e);
    if (!cell || cell !== e.target) return;
    if (cell.matches && cell.matches('a[href], button')) return;
    const spec = specOf(cell);
    if (!spec) return;
    if (coarsePointer()) { e.preventDefault(); show(cell, spec, true); return; }
    if (spec.href) { e.preventDefault(); hidePop(); go(spec.href); }
  });
}

// Escape, the sheet's own Close, and a tap outside it: once for the page.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePop();
  });
  document.addEventListener('click', (e) => {
    if (!asSheet || !cardEl || cardEl.hidden) return;
    const inside = typeof cardEl.contains === 'function' && cardEl.contains(e.target);
    if (!inside || (e.target.closest && e.target.closest('.tc-close'))) hidePop();
  });
}

// ---------------------------------------------------- a team's week, in parts
//
// The total a team scored (or is projected) in one week, broken into the
// starters it is the sum of. Slot, name and points a row; with `proj` on a
// starter the projection sits dim beside his name, so a played week reads
// "scored 18.4 (proj 14.2)" without a fourth column.
//
//   teamWeekCard({
//     team,                 'Kenny'
//     week,                 5
//     total,                118.2 — the cell this hangs off; printed as given
//     starters: [{ slot, name, pts, proj? }],
//     href?, hrefLabel?,    default: nothing / 'Open roster'
//   }, opts?) -> attribute  (as `statCard`)
//
// If the starters' printed points fall a tenth short of `total` (they are
// rounded one by one) a "Rounding" row says so, as the Stats cards do, rather
// than a figure being nudged to fit.

/** The spec `teamWeekCard` registers — exported so a page can adjust it. */
export function teamWeekSpec({ team = '', week = null, total = null, starters = [], href = null, hrefLabel = null } = {}) {
  const t10 = (v) => Math.round(v * 10);
  const rows = (starters || []).map((s) => ({
    lead: s.slot ?? '',
    label: s.name ?? '—',
    note: isNum(s.proj) ? `proj ${s.proj.toFixed(1)}` : '',
    value: isNum(s.pts) ? s.pts : null,
  }));
  if (isNum(total) && rows.length && rows.every((r) => isNum(r.value))) {
    const miss = t10(total) - rows.reduce((a, r) => a + t10(r.value), 0);
    if (miss && Math.abs(miss) <= rows.length) rows.push({ lead: '', label: 'Rounding', value: miss / 10 });
  }
  return {
    title: team,
    sub: week === null || week === undefined || week === '' ? '' : `Week ${week}`,
    rows,
    total: total === null || total === undefined ? null : { label: 'Total', value: total },
    href,
    hrefLabel: hrefLabel || (href ? 'Open roster' : null),
  };
}

export function teamWeekCard(o, opts) {
  return statCard(teamWeekSpec(o), opts);
}
