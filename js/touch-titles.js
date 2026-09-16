// EVERY `title` ON THIS SITE, MADE REACHABLE WITH A THUMB.
//
// A `title` attribute draws a native tooltip on a desktop and draws NOTHING on
// iOS — there is no hover for it to hang off. That is not a cosmetic loss here,
// because the site leans on it hard: stats.html heads seventeen columns `PTW`,
// `S+L`, `LS`, `PS`, `AS` and puts the only definition of each in a `title`;
// the analysis page's season grid explains a `—` that way (not on the roster
// that week? ESPN refused the week? on bye? — three different facts, one dash);
// and the Players page explains why a cell is green that way, which is the
// whole argument the page exists to make. On a phone all of it was silent.
//
// So on a coarse pointer a tap on anything carrying a `title` opens it as a
// sheet at the foot of the screen. The attribute itself is left alone: it is
// still the desktop tooltip and still what a screen reader reads, and this is
// only a second way to the same words.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH, and why each one would be a bug:
//
//   - Links and buttons. A `title` on an `<a class="pref">` is the player
//     click-through's own label, and swallowing that tap would break the one
//     contract that holds the pages together. A tap on a control must perform
//     the control. Where a BUTTON's title is the only explanation of what it
//     does — the FLEX filters, the simulation's run count — the answer is to
//     put the words on the page, not to stop the button working; those have
//     been moved into their panel notes.
//   - The analysis grids' cells, which carry no `title` at all on purpose (a
//     `title` beside their tip card would have the browser draw a second
//     tooltip over ours). They have their own richer sheet. Nothing here
//     collides with it: the two match on disjoint sets of elements.
//   - A table header still SORTS. The sort is the primary action and it fires
//     first, from the table's own delegated handler; this runs afterwards, on
//     the document, and adds the glossary. Tapping `PTW` therefore sorts by it
//     AND says what it is, which is both of the things a reader wanted.
//
// Self-installing, like js/connection.js: a page opts in with one script tag
// and no page module changes at all. There is exactly one sheet element on the
// page however many titles there are.

const SKIP = 'a, button, select, input, textarea, label, summary, option';

let sheet = null;

/**
 * Is the thing pointing at this page a finger?
 *
 * The third caller of this question — js/connection.js exports the canonical
 * one, and this module deliberately does NOT import it: connection.js mounts a
 * connection bar as a side effect of being imported, and a page that wants
 * tappable tooltips has not necessarily asked for that. Five guarded lines
 * repeated is a smaller price than an import with a side effect, and unlike
 * the analysis card there is no shared ANSWER here that could drift — both
 * copies ask the browser, not each other.
 */
function coarsePointer() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none)').matches;
  } catch {
    return false;
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function sheetEl() {
  if (sheet) return sheet;
  sheet = document.createElement('div');
  sheet.id = 'titleSheet';
  sheet.className = 'tipsheet';
  sheet.setAttribute('role', 'dialog');
  sheet.hidden = true;
  document.body.appendChild(sheet);
  return sheet;
}

export function hideTitleSheet() {
  if (sheet) sheet.hidden = true;
}

/**
 * @param {string} label  what was tapped — a column heading, a cell's own text
 * @param {string} text   the title attribute
 */
function show(label, text) {
  const el = sheetEl();
  // The label is the reader's anchor: they tapped "S+L" and need to see "S+L"
  // at the top of what opens, or the sheet could be about anything. Trimmed,
  // because a cell's text can be a whole line and this is a heading.
  const head = label && label.length <= 40 && label !== text
    ? `<div class="ts-label">${esc(label)}</div>`
    : '';
  el.innerHTML =
    `${head}<div class="ts-text">${esc(text)}</div>` +
    '<div class="ts-actions"><button type="button" class="ts-close">Close</button></div>';
  el.hidden = false;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;

    // Its own Close, or a tap anywhere outside it while it is open.
    if (sheet && !sheet.hidden) {
      if (target.closest('.ts-close') || !sheet.contains(target)) {
        hideTitleSheet();
        // A tap on the Close is spent. A tap elsewhere is not — it dismissed
        // this and is still allowed to do whatever it was going to do, which is
        // what stops the sheet turning into a modal nobody asked for.
        if (target.closest('.ts-close')) return;
      }
    }

    if (!coarsePointer()) return;
    if (target.closest(SKIP)) return;

    const owner = target.closest('[title]');
    if (!owner) return;
    const text = (owner.getAttribute('title') || '').trim();
    if (!text) return;

    // Not preventDefault and not stopPropagation: nothing here is replacing an
    // action, only adding to one. A sortable header sorts and then explains
    // itself; a plain cell had nothing else to do with the tap anyway.
    show((owner.textContent || '').trim(), text);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTitleSheet();
  });
}
