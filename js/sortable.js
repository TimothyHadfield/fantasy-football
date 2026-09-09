// Click-to-sort for any table on the site.
//
// Every table behaves the same way: click a column header to sort by it,
// click again to reverse. Mark sortable headers with `data-sort`:
//
//   <th data-sort>Team</th>
//
// Values are read from the cell text and auto-detected as numeric or text.
// When the displayed text isn't what you want to sort on — a "8-5" record, a
// formatted "+12.3" — put the real value on the cell instead:
//
//   <td data-v="8.0512">8-5</td>
//
// Tables that re-render should call resort(table) afterwards so the user's
// chosen sort survives the rebuild.
//
// Clicks are handled by ONE delegated listener on the table, not per-header,
// so a table that rewrites its own <thead> keeps working.

const STATE = new WeakMap();

/** Numbers hidden inside display formatting: "+12.3", "1,467", "68%", "—". */
function parseCell(td) {
  if (td.dataset.v !== undefined) {
    const n = Number(td.dataset.v);
    return Number.isNaN(n) ? td.dataset.v.toLowerCase() : n;
  }

  const raw = (td.textContent || '').trim();
  if (!raw || raw === '—' || raw === '-' || raw === 'N/A') return null;

  // Normalise the unicode minus and strip formatting before testing numeric.
  const cleaned = raw.replace(/−/g, '-').replace(/[,+$%\s]/g, '');
  if (cleaned !== '' && cleaned !== '-' && !Number.isNaN(Number(cleaned))) {
    return Number(cleaned);
  }
  return raw.toLowerCase();
}

/**
 * Nulls always sort to the bottom regardless of direction — an empty cell is
 * missing data, not the smallest value.
 */
function compare(a, b, asc) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const bothNumeric = typeof a === 'number' && typeof b === 'number';
  const d = bothNumeric ? a - b : String(a).localeCompare(String(b));
  return asc ? d : -d;
}

// Child traversal rather than the HTMLTableElement conveniences (tHead,
// tBodies, rows, cells). Same result, but it also copes with tables that omit
// <thead>/<tbody>, and it keeps the module testable outside a real browser.

const kids = (el, tag) =>
  el ? Array.from(el.children).filter((c) => c.tagName === tag) : [];

/** The last header row is the one carrying the real column labels. */
function headerCells(table) {
  const head = kids(table, 'THEAD')[0];
  const rows = head ? kids(head, 'TR') : kids(table, 'TR');
  const row = rows[rows.length - 1];
  return row ? Array.from(row.children) : [];
}

function paintHeaders(table) {
  const st = STATE.get(table);
  headerCells(table).forEach((th, i) => {
    if (th.dataset.sort === undefined) return;
    // Re-applied on every paint so headers rebuilt by a re-render still get
    // their affordances back.
    th.classList.add('sortable');
    th.tabIndex = 0;
    th.setAttribute('role', 'columnheader');

    const active = st && st.index === i;
    th.classList.toggle('sorted', Boolean(active));
    th.classList.toggle('asc', Boolean(active && st.asc));
    th.setAttribute('aria-sort', active ? (st.asc ? 'ascending' : 'descending') : 'none');
  });
}

/**
 * Re-apply the current sort. Call after re-rendering a table's rows.
 *
 * EVERY <tbody> is sorted, and each one independently. Nearly every table on
 * the site has exactly one, so for those this is what it always was. The one
 * that does not is the roster detail — starters, a totals row, then the bench —
 * and sorting each group on its own is what makes that grouping survive a
 * click: sort by Projected and you get your starters ranked and then your bench
 * ranked, instead of the two shuffled together and the total stranded in the
 * middle of them. A tbody of one row is left alone, which is what pins the
 * totals row where it belongs.
 */
export function resort(table) {
  const st = STATE.get(table);
  if (!st) return;
  if (st.index < 0) { paintHeaders(table); return; }

  for (const tbody of kids(table, 'TBODY')) {
    const rows = kids(tbody, 'TR');
    if (rows.length < 2) continue;

    // Decorate-sort-undecorate: parse each cell once rather than once per
    // comparison, and keep the original index so the sort is stable.
    const keyed = rows.map((row, i) => {
      const cell = row.children[st.index];
      return { row, i, key: cell ? parseCell(cell) : null };
    });

    keyed.sort((a, b) => compare(a.key, b.key, st.asc) || a.i - b.i);

    const frag = document.createDocumentFragment();
    for (const k of keyed) frag.appendChild(k.row);
    tbody.appendChild(frag);
  }

  paintHeaders(table);
}

function activate(table, th) {
  const st = STATE.get(table);
  const i = headerCells(table).indexOf(th);
  if (i < 0) return;

  // Same column: flip direction. New column: start descending, because for
  // stats the interesting end is almost always the top.
  if (st.index === i) st.asc = !st.asc;
  else { st.index = i; st.asc = st.firstClickAsc; }
  resort(table);
}

/**
 * Turn on click-to-sort for a table. Safe to call more than once.
 *
 * @param {HTMLTableElement} table
 * @param {object} [opts]
 * @param {number}  [opts.defaultIndex]      column to sort by on load
 * @param {boolean} [opts.defaultAsc=false]  direction for that first sort
 * @param {boolean} [opts.firstClickAsc=false] direction a fresh column starts in
 */
export function enableSort(table, opts = {}) {
  if (!table || STATE.has(table)) return;

  STATE.set(table, {
    index: opts.defaultIndex ?? -1,
    asc: opts.defaultAsc ?? false,
    firstClickAsc: opts.firstClickAsc ?? false,
  });

  // Delegated, so headers can be rewritten freely by the page.
  table.addEventListener('click', (e) => {
    const th = e.target.closest && e.target.closest('th[data-sort]');
    if (th && table.contains(th)) activate(table, th);
  });

  table.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target.closest && e.target.closest('th[data-sort]');
    if (th && table.contains(th)) { e.preventDefault(); activate(table, th); }
  });

  if (opts.defaultIndex !== undefined) resort(table);
  else paintHeaders(table);
}

/** Turn on sorting for every table under `root` that has sortable headers. */
export function enableSortAll(root = document) {
  root.querySelectorAll('table').forEach((table) => {
    if (table.querySelector('th[data-sort]')) enableSort(table);
  });
}
