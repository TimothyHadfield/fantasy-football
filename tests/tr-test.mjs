// The Trade page, end to end: the real trade.html with its real module.
//
//   node tr-test.mjs
//
// `test-trade.mjs` proves the engine. This proves the PAGE — that the depth map
// and the finder actually reach the screen, that the controls repaint the right
// panel, and that none of them costs a request. Those are the failures a pure
// engine suite cannot see, and the ones that only ever show up in a browser.
//
// One scenario per child process: an ES module initialises once per process and
// `js/trade-page.js` self-boots on import, so two boots cannot share one.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { machineSpeed, scaledBudget } from './settle.mjs';
import { emit } from './emit.mjs';

// ------------------------------------------------------------------ harness

/**
 * `wide` is the WINDOW, and since 2026-09-19 one thing on this page reads it.
 *
 * The custom box draws its week-by-week breakdown beside the builder only where
 * there is room for it — `(min-width: 900px)` — and REMOVES it from the
 * document where there is not (`roomBesideBuilder` in js/trade-page.js). So the
 * stub answers `min-width` queries with this flag instead of a flat `false`,
 * and the two branches are two scenarios rather than one.
 *
 * Wide is the default because everything else in this suite is about a page on
 * a laptop. `(hover: none)` and every other feature stay false, which is the
 * old behaviour exactly — this changes no other assertion.
 */
async function boot(page = 'trade.html', search = '', seed = null, { wide = true } = {}) {
  const html = readFileSync(path.join(REPO, page), 'utf8');
  const { window, document } = parseHTML(html);

  // linkedom defines <select>.value on HTMLSelectElement.prototype and returns
  // undefined; shimming HTMLElement.prototype does nothing (it is shadowed) and
  // would break <input> too. See tests/README.md.
  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const s = this.querySelector('option[selected]') || this.querySelector('option');
        return s ? s.getAttribute('value') ?? s.textContent : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        }
      },
    });
  }

  // Take the table prototype from an element linkedom actually made, NOT from
  // window.HTMLTableElement — they are not always the same object here, and
  // defining on the wrong one leaves table.tBodies undefined.
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const rows = [];
      const head = kids(this, 'THEAD')[0];
      if (head) rows.push(...kids(head, 'TR'));
      for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
      return rows;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  // js/bridge.js reads window.location.origin on every ping and linkedom
  // provides no location; the throw would surface as an unhandled rejection out
  // of connection.js and kill the child, which looks like a page failure.
  window.location = {
    href: `http://localhost/${page}${search}`, origin: 'http://localhost',
    protocol: 'http:', pathname: `/${page}`, search, hash: '',
  };
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  // Seeded BEFORE the page's modules are imported, because connection.js and
  // prefs.js both read storage on first touch — a league written afterwards
  // would arrive too late to put the page on live data.
  const store = new Map(Object.entries(seed || {}));
  // THE GOAL IS PINNED, and to the one whose span is the regular season.
  //
  // Since 2026-09-21 the page opens on a goal, and "Win it all" — the default —
  // PRICES the playoff weeks. Every scenario in this file was written, and
  // re-derives its numbers, on the span that stops at the regular season and
  // shows the bracket for reference; that is exactly "Don't finish last" now,
  // where the page prices as it always did. So those scenarios run there, and
  // the title goal has scenarios of its own (`goalTitle`, `goalLive`) that
  // re-derive the playoff-weeks span instead. `TR_GOAL` picks; a seed that
  // names a goal itself wins over both.
  {
    const goal = process.env.TR_GOAL || 'last';
    let prefs = {};
    try { prefs = JSON.parse(store.get('ff.prefs') || '{}'); } catch { prefs = {}; }
    if (!('trade.goal' in prefs)) prefs['trade.goal'] = goal;
    // `TR_KIND` narrows the finder (and so the combo) to one package kind —
    // how the merged-combo checks reach two 1-for-1 deals with one manager now
    // that the 2-for-2 search offers the same four men as a single deal.
    if (process.env.TR_KIND && !('trade.kind' in prefs)) prefs['trade.kind'] = process.env.TR_KIND;
    store.set('ff.prefs', JSON.stringify(prefs));
  }
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const fetchCalls = [];
  Object.assign(globalThis, {
    window, document, localStorage,
    fetch: async (u) => { fetchCalls.push(String(u)); throw new Error(`unexpected network call: ${u}`); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: (q) => ({
      matches: wide && /min-width/.test(String(q)),
      media: String(q),
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    }),
  });
  window.localStorage = localStorage;
  window.matchMedia = globalThis.matchMedia;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };

  for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((x) => x[1])) {
    await import(pathToFileURL(path.join(REPO, m)).href);
  }
  await settle();
  console.error = origError;

  return { document, window, errors, fetchCalls };
}

/**
 * Let the deferred work finish: it hands off through rAF then a timeout.
 *
 * The default covers a scalar search, which is a quarter of a second. The
 * WEEKLY search is a different animal — every offer is priced by re-filling
 * nine to thirteen lineups — and needs seconds rather than milliseconds, which
 * is itself a cost the page states.
 */
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until the Trade page has FINISHED, rather than for a guessed number of
 * seconds (2026-09-21). Since the goal landed the page searches on points,
 * re-searches on the goal's week weights once the simulation can be built,
 * then plays every offer out — and a fixed wait long enough for the old page
 * caught the new one between the two searches, reading a row that was about
 * to be replaced. So: poll until the finder's line says how it was ranked and
 * the combo is not still working, then a moment more for the last repaint.
 *
 * AND THE CEILING IS SCALED BY HOW BUSY THE MACHINE IS (2026-09-23). Polling
 * for the page's own signal was only half the fix AUDIT §3 made: the ceiling
 * that ends the poll was still a flat 45 seconds, which is the same guess one
 * layer up. Measured on the day: with eleven unrelated `node` jobs holding every
 * core, the goal rank ran past 45s and three scenarios read a table that still
 * said "playing each offer out … (5 of 40)" — three assertions failing on code
 * that had not changed, twice in a row on different scenarios, which is the
 * signature of a wait and not of a defect (PROGRESS Traps, "the machine is
 * shared"). `machineSpeed()`/`scaledBudget()` in settle.mjs are the project's
 * own answer to exactly this and fc-test already uses them for its budgets.
 * Measured ONCE per child and cached: the benchmark costs about a third of a
 * second, and `settleGoal` is called a dozen times in some scenarios.
 */
let machine = null;
const machineFactor = () => (machine || (machine = machineSpeed())).factor;

async function settleGoal(document, idleMax = 45000) {
  const max = scaledBudget(idleMax, machineFactor());
  const t0 = Date.now();
  await settle(1500);
  const txt = (id) => {
    const el = document.getElementById(id);
    return el ? el.textContent.replace(/\s+/g, ' ') : '';
  };
  while (Date.now() - t0 < max) {
    const count = txt('tradeCount');
    const done = /ranked by your|not ranked by your/.test(count) && !/playing each offer out/.test(count);
    const empty = !document.querySelector('#tradeTable tbody tr') && !/Trying every swap/.test(txt('tradeEmpty')) &&
      txt('tradeEmpty').length > 0;
    if ((done || empty) && !/Trying every set/.test(txt('comboBody'))) break;
    await settle(250);
  }
  await settle(400);
}

function fire(el, type = 'change') {
  const ev = new globalThis.Event(type, { bubbles: true });
  el.dispatchEvent(ev);
}

// ------------------------------------------------------------------- reading

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

/**
 * THE PANELS, IN DOCUMENT ORDER — which is the whole of what this reads.
 *
 * Tim asked for them ordered by usefulness (2026-09-17): the finder, then the
 * best combo, then the depth map, under the one toolbar that stays at the top.
 * The depth map used to be first because it is what the engine computes first,
 * and a reader had to scroll a ten-by-six table to reach the answer.
 *
 * `querySelectorAll` returns document order, so this is the real sequence of
 * `<section class="panel">` on the page and not a list anybody maintains. The
 * finder's heading has the reader's own squad appended to it at paint time
 * ("Trades that help both squads · Alex"), so the name is cut back to the
 * fixed half — the part the markup owns — and the id is carried alongside,
 * because an id is what the module and every other test address a panel by.
 *
 * FALSIFIABLE: swap two sections in trade.html and the sequence this returns
 * changes, so the assertion built on it fails. Nothing else on the page would.
 */
function readPanelOrder(document) {
  return [...document.querySelectorAll('section.panel')].map((section) => {
    const h = section.querySelector('h2');
    return {
      id: (h && h.getAttribute('id')) || '',
      heading: text(h).split(' · ')[0],
    };
  });
}

function readDepth(document) {
  const table = document.getElementById('depthTable');
  const heads = [...table.querySelectorAll('thead th')].map((th) => text(th));
  const rows = [...table.querySelectorAll('tbody tr')].map((tr) => ({
    team: text(tr.querySelector('td.name')),
    me: tr.getAttribute('class') === 'me',
    cells: [...tr.querySelectorAll('td.cell')].map((td) => ({
      v: td.getAttribute('data-v'),
      text: text(td),
      deep: (td.getAttribute('class') || '').includes('deep'),
      thin: (td.getAttribute('class') || '').includes('thin'),
      tip: td.getAttribute('title') || '',
    })),
    total: text(tr.querySelector('td.grouped')),
  }));
  return { heads, rows, bars: [...document.querySelectorAll('#depthBars .bar-chip')].map(text) };
}

/** The ESPN id out of a `waivers.html?player=123` href, which is the identity. */
const idOfHref = (href) => {
  const m = String(href || '').match(/player=(-?\d+)/);
  return m ? Number(m[1]) : null;
};

/**
 * One man as the page drew him.
 *
 * `pos` is the POSITION TAG and is '' when the page suppressed it, which is the
 * whole of the D/ST assertion. `val` is the one number beside him — there must
 * only ever be one now, so `vals` counts them and a second would fail.
 */
function readMan(m) {
  const a = m.querySelector('a.pref');
  return {
    id: a ? idOfHref(a.getAttribute('href')) : null,
    text: text(m),
    pos: text(m.querySelector('.pp')),
    val: text(m.querySelector('.val')),
    vals: [...m.querySelectorAll('.val')].map(text),
    // The per-week twin the packages USED to carry beside a season total. It
    // must not come back: one number per player, and it is the per-week one.
    extras: [...m.querySelectorAll('.per')].map(text),
  };
}

/**
 * Every offer row of one table — the finder's and the combo's are the same
 * markup now, so they get the same reader. A second reader would let the two
 * drift apart without any test noticing, which is exactly the failure mode the
 * shared row builder exists to prevent.
 */
function readOfferRows(table) {
  if (!table) return [];
  return [...table.querySelectorAll('tbody tr')].map((tr) => {
    const men = (td) => (td ? [...td.querySelectorAll('.man')].map(readMan) : []);
    // BY CLASS, NOT BY POSITION. The combo's tables drop two of the finder's
    // columns (see below), so an index-based reader would have read the wrong
    // cell there and reported the ESPN link as a gain. The classes are what
    // `offerRow` writes and are the same in all three tables that use it.
    const cell = (c) => tr.querySelector(`td.${c}`);
    const name = cell('name');
    const send = cell('send');
    const recv = cell('recv');
    const ba = cell('before-after');
    const gain = cell('gain');
    const their = cell('their-gain');
    const espn = cell('espn');
    // A COLOURED CELL IS COLOURED BY js/heat.js AND NOTHING ELSE. `heat` is on
    // every measured cell (including the neutral band), the step class is what
    // paints, and `.heatmark` is the end-of-scale glyph.
    const heat = (td) => {
      if (!td) return { on: false, cls: '', mark: '', title: '' };
      const cls = td.getAttribute('class') || '';
      return {
        on: /\bheat\b/.test(cls),
        cls: (cls.match(/heat-(?:up|dn)-\d|heat-0/) || [''])[0],
        mark: text(td.querySelector('.heatmark')),
        title: td.getAttribute('title') || '',
        // Phase 5, V4: the mark sits BESIDE the number, i.e. before the cell's
        // `.sub` line. null when there is no mark or no sub to compare with.
        markBeforeSub: (() => {
          const html = td.innerHTML || '';
          const m = html.indexOf('class="heatmark"');
          const s = html.indexOf('class="sub"');
          return m < 0 || s < 0 ? null : m < s;
        })(),
      };
    };
    return {
      // The name only — the merged badge lives beside it in the same cell and
      // is a different fact.
      partner: text(name.querySelector('.mgr') || name),
      merged: !!tr.querySelector('.merged-tag'),
      mergedText: text(tr.querySelector('.merged-tag')),
      fromTag: text(tr.querySelector('.from-tag')),
      shape: text(cell('deal')),
      send: men(send),
      receive: men(recv),
      churn: text(recv ? recv.querySelector('.churn') : null),
      // PRESENT-OR-ABSENT is the claim for the two columns the combo drops, so
      // both the text and the existence of the cell are reported.
      hasLineup: !!ba,
      hasMyGain: !!gain,
      beforeAfter: text(ba),
      // Without the scale's glyph: the format assertions are about "per week
      // first, the total underneath", and the ▲ is a separate claim read below.
      gainText: textNoMark(gain),
      myGain: gain ? Number(gain.getAttribute('data-v')) : NaN,
      // YOU GAIN IS NET (2026-09-30, Tim: "add the change in opponent proj to
      // the total +/- gain"). `myGain` is the cell as shown: your change minus
      // his change in the week(s) you play him. `ownGain` puts his change back,
      // i.e. your lineup alone, which is the engine's raw `myGain`.
      ownGain: (() => {
        if (!gain) return NaN;
        const v = Number(gain.getAttribute('data-v'));
        const o = cell('opp-proj');
        const s = o && o.hasAttribute('data-v') && o.getAttribute('data-v') !== '' ? Number(o.getAttribute('data-v')) : 0;
        return Math.round((v + s) * 10) / 10;
      })(),
      theirGain: their ? Number(their.getAttribute('data-v')) : NaN,
      // THE GOAL CELL (2026-09-21): the headline change, the "before → after ·
      // N% yes" line under it, and `data-v` — the expected change, the rank key.
      //
      // THE RANK IS READ AS ITSELF (2026-09-23). `.place` carries "3" or "3=" in
      // front of the change, and a tie group's rows share it. It is pulled out of
      // `head` rather than left in it so every assertion below still means what it
      // said before: `head` is the CHANGE, the way it always was, and `place` is
      // the new claim. `head` does now carry the ± band after the figure, which is
      // deliberate — a change is not printed anywhere on this page without it.
      goal: (() => {
        const td = cell('goal-cell');
        if (!td) return null;
        const sub = td.querySelector('.sub');
        const all = text(td);
        const subText = text(sub);
        const placeText = text(td.querySelector('.place'));
        let head = subText ? all.slice(0, all.length - subText.length).trim() : all;
        if (placeText && head.startsWith(placeText)) head = head.slice(placeText.length).trim();
        return {
          place: placeText,
          level: /=$/.test(placeText),
          band: text(td.querySelector('.band')),
          head,
          sub: subText,
          v: Number(td.getAttribute('data-v')),
          cls: td.getAttribute('class') || '',
          title: td.getAttribute('title') || '',
          index: [...tr.children].indexOf(td),
        };
      })(),
      // THE OTHER GOAL, AS A PREVIEW (2026-09-29, Tim: "show 2 columns on the
      // trade, one for change of win % and one for change of losing %"). The
      // ranked goal stays `goal`; this is the goal NOT selected, read the same way.
      alt: (() => {
        const td = cell('alt-goal-cell');
        if (!td) return null;
        const sub = td.querySelector('.sub');
        const all = text(td);
        const subText = text(sub);
        return {
          head: subText ? all.slice(0, all.length - subText.length).trim() : all,
          sub: subText,
          v: td.hasAttribute('data-v') ? Number(td.getAttribute('data-v')) : NaN,
          cls: td.getAttribute('class') || '',
          wait: /\bgoal-wait\b/.test(td.getAttribute('class') || ''),
          title: td.getAttribute('title') || '',
          index: [...tr.children].indexOf(td),
        };
      })(),
      // HIS PROJECTION IN THE WEEK(S) HE PLAYS YOU (2026-09-29, Tim: "make a opp
      // proj diff that calculates how much my opponent's projection changes
      // after the trade, only for the week that I play them").
      opp: (() => {
        const td = cell('opp-proj');
        if (!td) return null;
        const sub = td.querySelector('.sub');
        const all = text(td);
        const subText = text(sub);
        return {
          head: subText ? all.slice(0, all.length - subText.length).trim() : all,
          sub: subText,
          v: td.hasAttribute('data-v') && td.getAttribute('data-v') !== ''
            ? Number(td.getAttribute('data-v')) : null,
          sign: (((td.getAttribute('class') || '').match(/\b(pos|neg)\b/) || ['', ''])[1]),
          index: [...tr.children].indexOf(td),
        };
      })(),
      myHeat: heat(gain),
      theirHeat: heat(their),
      // THE SIGN ON THE TWO GAIN CELLS (2026-09-23). `offerRow` wrote `pos` on
      // both of them unconditionally, so every negative figure on the page — all
      // forty "He gains" cells on the sample league — was painted the colour that
      // means good. Read as the class actually on the cell, '' for neither, so a
      // cell that rounds to nothing can be asserted to carry no colour at all.
      mySign: !gain ? null : (((gain.getAttribute('class') || '').match(/\b(pos|neg)\b/) || ['', ''])[1]),
      theirSign: !their ? null : (((their.getAttribute('class') || '').match(/\b(pos|neg)\b/) || ['', ''])[1]),
      espn: (() => {
        const a = espn ? espn.querySelector('a') : null;
        return a ? a.getAttribute('href') : text(espn || null);
      })(),
      // Every man named carries a card key. The card itself is opened below;
      // this is only "was one registered at all".
      cards: [...tr.querySelectorAll('.man[data-tip]')].length,
      links: [...tr.querySelectorAll('a.pref')].map((a) => a.getAttribute('href')),
      // The keyboard route into the pop-up, and the key focus returns to.
      openKey: tr.getAttribute('data-key'),
      opener: !!tr.querySelector('button.wk-open'),
      // "Ask AI" (Tim, 2026-09-30: "just remove the "deal" column … and then
      // add the ask ai button on the end"). Read off the row's LAST cell, so a
      // button anywhere else does not count.
      hasDeal: !!cell('deal'),
      lastAsk: (() => {
        const last = tr.children[tr.children.length - 1];
        const b = last ? last.querySelector('button.ask-ai') : null;
        return b ? text(b) : null;
      })(),
      askButtons: tr.querySelectorAll('button.ask-ai').length,
    };
  });
}

const readTrades = (document) => readOfferRows(document.getElementById('tradeTable'));

/** Just the printed names, for the assertions that only care about who. */
const names = (men) => men.map((m) => m.text).join(' ');

/**
 * "+12.3" / "−4.0" / "12.3" -> a number. The minus sign is U+2212.
 *
 * The ▲/▼ at the end of the red/green scale (js/heat.js, 2026-09-19) is drawn
 * INSIDE the cell, so a reader that took the cell's text straight to `Number`
 * started handing it "5.2 ▲" and getting NaN — which read as every row's
 * arithmetic being wrong rather than as a glyph nobody had stripped.
 */
// The glyph goes with the space `heatMarkHtml` puts before it: since V4 the
// mark sits mid-cell (after the number, before the `.sub` total), where a
// left-behind space would read as a change to the cell's own format.
const noMark = (s) => String(s).replace(/\s*[▲▼]/g, '').replace(/\s+/g, ' ').trim();
const num = (s) => Number(noMark(s).replace(/−/g, '-').replace(/\+/g, ''));
/** A cell's text with the scale's glyph taken off, for the format assertions. */
const textNoMark = (el) => noMark(text(el));

/** The week-by-week table inside a container: one row per week, then totals. */
function readWeekTable(el) {
  const table = el ? el.querySelector('table.weeks') : null;
  if (!table) return null;
  // THIS TABLE'S OWN ROWS. Below 900px the week's slot-by-slot detail is put
  // in a row of its own after the open week (`tr.wkx-row`, trade plan Phase 5
  // V12), with a table of its own inside — neither is a week.
  const all = [...table.querySelectorAll('tbody tr')]
    .filter((tr) => tr.closest('table') === table && !(tr.getAttribute('class') || '').includes('wkx-row'));
  const cls = (tr) => tr.getAttribute('class') || '';
  const has = (tr, c) => cls(tr).split(/\s+/).includes(c);
  // Two lines now: the played weeks' (above the priced rows) and the playoff
  // weeks' (below the totals). Each is read as itself.
  const divider = all.find((tr) => has(tr, 'divider') && !has(tr, 'po-divider'));
  const poDivider = all.find((tr) => has(tr, 'po-divider'));
  // THE PLAYOFF WEEKS: after the totals, below their own line, uncoloured, and
  // in no figure (Tim, 2026-09-17: shown, not priced — his call).
  const playoff = all.filter((tr) => has(tr, 'po')).map((tr) => {
    const tds = [...tr.children];
    return {
      label: text(tds[0]),
      week: parseInt(text(tds[0]).replace(/^Week /, ''), 10),
      before: num(text(tds[1])),
      after: num(text(tds[2])),
      delta: num(text(tds[3])),
      coloured: /\b(up|down)\b/.test(tds[3].getAttribute('class') || ''),
      belowLine: !!poDivider && all.indexOf(tr) > all.indexOf(poDivider),
      afterTotals: all.indexOf(tr) > Math.max(...all.map((x, i) => (has(x, 'total') ? i : -1))),
    };
  });
  // PLAYED WEEKS sit above a divider, uncoloured, in no total — Tim's ask. They
  // are read separately so nothing below mistakes them for priced weeks.
  const past = all.filter((tr) => cls(tr).includes('past')).map((tr) => {
    const tds = [...tr.children];
    return {
      label: text(tds[0]),
      delta: num(text(tds[3])),
      coloured: /\b(up|down)\b/.test(tds[3].getAttribute('class') || ''),
      aboveLine: !!divider && all.indexOf(tr) < all.indexOf(divider),
    };
  });
  const rows = all.filter((tr) => !has(tr, 'past') && !has(tr, 'divider') && !has(tr, 'po')).map((tr) => {
    const tds = [...tr.children];
    return {
      // THE WEEK BUTTON'S OWN TEXT. Since 2026-09-29 a week you play the other
      // manager carries a note under the button in the same cell (`.vs-note`),
      // and the label is still just "Week 9".
      label: text(tds[0].querySelector('button') || tds[0]),
      vs: text(tds[0].querySelector('.vs-note')),
      // The partner's half of the custom box (2026-09-29): "plays 62%" under a
      // week he may not be playing in. No note is a week he plays for sure.
      reach: (() => {
        const m = text(tds[0].querySelector('.reach-note')).match(/plays (\d+)%/);
        return m ? Number(m[1]) / 100 : 1;
      })(),
      reachNote: !!tds[0].querySelector('.reach-note'),
      total: (tr.getAttribute('class') || '').includes('total'),
      before: num(text(tds[1])),
      after: num(text(tds[2])),
      // YOUR OWN change. In the week you play him (2026-09-30) the cell prints
      // yours minus his as `shown`, with yours in `.net-sub` under it.
      ...(() => {
        const sub = tds[3].querySelector('.net-sub');
        const c = tds[3].cloneNode(true);
        for (const s of [...c.querySelectorAll('.net-sub')]) s.remove();
        const shown = num(text(c));
        return {
          shown,
          netted: !!sub,
          delta: sub ? num(text(sub).replace(/^you\s*/, '')) : shown,
        };
      })(),
      // (G) THE SCALE ON THE DIFFERENCE COLUMN, each week against the other
      // weeks of this deal. The played and playoff rows are in no total and so
      // in no scale, which is read separately below.
      heat: ((tds[3].getAttribute('class') || '').match(/heat-(?:up|dn)-\d|heat-0/) || [''])[0],
      heatTitle: tds[3].getAttribute('title') || '',
    };
  });
  return {
    weeks: rows.filter((r) => !r.total),
    totals: rows.filter((r) => r.total),
    // Channel 4 of "never colour alone" — the key under this table, in points.
    heatKey: text(el.querySelector('.heat-key')),
    past,
    playoff,
    divider: divider ? text(divider) : '',
    poDivider: poDivider ? text(poDivider) : '',
    // By LABEL, not position: Tim asked for per week first and the total under
    // it, and a reader keyed on order silently swaps the two.
    totalRow: rows.find((r) => r.total && /^All /.test(r.label)) || null,
    perRow: rows.find((r) => r.total && /^Per week/.test(r.label)) || null,
    perFirst: /^Per week/.test(rows.filter((r) => r.total).map((r) => r.label)[0] || ''),
    heads: [...table.querySelectorAll('thead th')].map(text),
  };
}

function readCost(document) {
  return {
    button: text(document.getElementById('loadWeeks')),
    spent: text(document.getElementById('costSpent')),
    note: text(document.getElementById('costNote')),
  };
}

/**
 * The before-and-after list, entry by entry, out of the DOM rather than by
 * splitting its text.
 *
 * It has to be the DOM: the tag on one of his own men reads "(yours, benched)"
 * and a reader that split the line on commas would tear that in half and call
 * "benched)" a player. Each `<b>` opens an entry and a following `.own` span
 * belongs to it, which is exactly how the line is built.
 */
function readChurnEntries(root) {
  const out = [];
  if (!root) return out;
  for (const dir of ['in', 'out']) {
    const span = root.querySelector(`.churn .${dir}`);
    if (!span) continue;
    let cur = null;
    for (const node of [...span.childNodes]) {
      const tag = node.tagName || '';
      if (tag === 'B') {
        cur = { dir, name: text(node), own: '' };
        out.push(cur);
      } else if (tag === 'SPAN' && (node.getAttribute('class') || '').includes('own') && cur) {
        cur.own = text(node);
      }
    }
  }
  return out;
}

/**
 * The drill-down, which is now a MODAL.
 *
 * `hidden` is the element's own `hidden` property rather than a class, because
 * that is what the page sets — and `present` is the separate question Tim's
 * fifth ask turns on: a week table that is merely invisible is still in the
 * document, still findable, still read out by a screen reader. Both are
 * asserted, and they are not the same claim.
 */
function readDeal(document) {
  const modal = document.getElementById('dealModal');
  const body = document.getElementById('dealBody');
  return {
    hidden: !!modal.hidden,
    present: !!body.querySelector('table.weeks'),
    bodyLength: (body.innerHTML || '').length,
    dialog: (() => {
      const card = document.getElementById('dealPanel');
      return {
        role: card.getAttribute('role'),
        modal: card.getAttribute('aria-modal'),
        labelledby: card.getAttribute('aria-labelledby'),
      };
    })(),
    closeButton: (() => {
      const b = document.getElementById('dealClose');
      return b ? b.tagName : '';
    })(),
    title: text(document.getElementById('dealTitle')),
    note: text(document.getElementById('dealNote')),
    body: text(body),
    weeks: readWeekTable(body),
    espn: (() => {
      const a = body.querySelector('a.espn-open');
      return a ? a.getAttribute('href') : '';
    })(),
    cards: [...body.querySelectorAll('.man[data-tip]')].length,
    men: [...body.querySelectorAll('.man')].map(readMan),
    // What the deal does to the lineup. This lives ONLY here now — Tim had it
    // taken off the finder's rows, where it mostly repeated the two package
    // columns beside it.
    churn: text(body.querySelector('.churn')),
    churnEntries: readChurnEntries(body),
  };
}

/**
 * ONE WEEK, SLOT BY SLOT — the panel that opens inside the pop-up when a week
 * is hovered, tapped or tabbed to.
 *
 * Read out of the DOM element by element rather than by splitting text: a cell
 * runs a mark into a name into a number, and a reader that split on spaces
 * would call "IN" a player. `mark` and `markClass` are read separately on
 * purpose — the mark's WORD is the half that survives greyscale, and the whole
 * of the site's rule is that the colour is never carrying it alone.
 */
function readBreakdown(document) {
  const host = document.getElementById('dealWeek');
  if (!host) return null;
  const table = host.querySelector('table.wkx-table');

  const cellOf = (td) => {
    const a = td.querySelector('a.pref');
    const mark = td.querySelector('.wkx-mark');
    return {
      text: text(td),
      name: text(td.querySelector('.wkx-name')),
      id: a ? idOfHref(a.getAttribute('href')) : null,
      v: text(td.querySelector('.wkx-v')),
      mark: text(mark),
      markClass: mark ? (mark.getAttribute('class') || '') : '',
    };
  };

  const all = table
    ? [...table.querySelectorAll('tbody tr')].map((tr) => {
      const cells = [...tr.children];
      const cls = tr.getAttribute('class') || '';
      return {
        slot: text(cells[0]),
        isTotal: cls.includes('wkx-total'),
        changed: cls.split(/\s+/).includes('changed'),
        same: cls.split(/\s+/).includes('same'),
        before: cellOf(cells[1]),
        after: cellOf(cells[2]),
        delta: text(cells[3]),
      };
    })
    : [];

  return {
    present: !!table,
    empty: !!host.querySelector('.wkx-empty'),
    title: text(host.querySelector('.wkx-title')),
    heads: table ? [...table.querySelectorAll('thead th')].map(text) : [],
    slots: all.filter((r) => !r.isTotal).map((r) => r.slot),
    rows: all.filter((r) => !r.isTotal),
    totals: all.find((r) => r.isTotal) || null,
    key: text(host.querySelector('.wkx-key')),
    scope: text(host.querySelector('.wkx-scope')),
    // What is drawn before anybody picks a week (trade plan Phase 5, V17).
    lead: text(host.querySelector('.wkx-lead')),
    // WHERE the panel sits (V12): in the side column, or in a row of its own
    // straight after one week's row — and which week that row is.
    inSideColumn: !!(host.closest && host.closest('.deal-detail')),
    afterRow: (() => {
      const tr = host.closest ? host.closest('tr.wkx-row') : null;
      const prev = tr ? tr.previousElementSibling : null;
      return prev ? prev.getAttribute('data-wk') : null;
    })(),
    sideColumnKids: (() => {
      const col = document.querySelector('#dealBody .deal-detail');
      return col ? col.children.length : -1;
    })(),
    sides: [...host.querySelectorAll('[data-side]')].map((b) => ({
      side: b.getAttribute('data-side'),
      label: text(b),
      pressed: b.getAttribute('aria-pressed'),
    })),
    // Every mark drawn in the TABLE, so "a word as well as a colour" can be
    // asserted over all of them rather than over a chosen row. Read from the
    // table alone: the key underneath prints one of each by design, and pooling
    // the two would make an empty table look fully marked.
    marks: table
      ? [...table.querySelectorAll('.wkx-mark')].map((m) => ({
        word: text(m), cls: m.getAttribute('class') || '',
      }))
      : [],
    keyMarks: [...host.querySelectorAll('.wkx-key .wkx-mark')].map(text),
    // The key, split the way Tim's "no words under the pop-up" ask splits it:
    // what a reader SEES, and what only a screen reader gets. Read separately
    // and never through `textContent`, which returns the hidden half too and
    // would pass whether the words were drawn or not.
    keyVisible: (() => {
      const p = host.querySelector('.wkx-key');
      if (!p) return '';
      const clone = p.cloneNode(true);
      clone.querySelectorAll('.sr-only').forEach((n) => n.remove());
      return text(clone);
    })(),
    keySr: text(host.querySelector('.wkx-key .sr-only')),
    // What the WEEK TABLE says is open, which must agree with what is drawn.
    expanded: [...document.querySelectorAll('#dealBody .wk-peek')]
      .filter((b) => b.getAttribute('aria-expanded') === 'true')
      .map((b) => b.getAttribute('data-wk')),
    peeking: [...document.querySelectorAll('#dealBody tr.peeking')]
      .map((tr) => tr.getAttribute('data-wk')),
  };
}

/**
 * The combo panel. The BEST packing and the "most trades" alternative are read
 * separately on purpose: they are two different packings of the same offers, so
 * a man may legitimately appear in both, and a reader that pooled them would
 * report a disjointness failure that is not one.
 */
function readCombo(document) {
  const body = document.getElementById('comboBody');
  const best = body.querySelector('.combo-best') || body;
  const alt = body.querySelector('.combo-alt');
  const rows = readOfferRows(document.getElementById('comboTable'));
  const altRows = readOfferRows(document.getElementById('comboAltTable'));
  // The men, by ESPN's own id rather than by their printed name: the cell text
  // runs a name into a position into a number, and the whole point of the
  // site's link contract is that the id is the identity.
  const ids = (list) => list.flatMap((r) => r.links);
  return {
    head: text(best.querySelector('.combo-head')),
    // THE LINEUP FOR THE WHOLE PACKING, once, and the sentence that says why
    // there is one figure and not one per deal (Tim, 2026-09-19).
    lineup: text(best.querySelector('.combo-lineup')),
    oneNumber: text(best.querySelector('.combo-one')),
    heads: [...(document.getElementById('comboTable') || { querySelectorAll: () => [] })
      .querySelectorAll('thead th')].map(text),
    rows,
    altRows,
    names: ids(rows),
    altNames: ids(altRows),
    // Each row's two sides, as ESPN ids, so the whole packing can be re-priced
    // from the engine rather than read back off the page that printed it.
    perTrade: rows.map((r) => ({
      partner: r.partner,
      send: r.send.map((m) => m.id).filter((v) => v !== null),
      receive: r.receive.map((m) => m.id).filter((v) => v !== null),
    })),
    // THE HEADLINE, PER WEEK — the figure the whole packing is worth, off the
    // big number the panel leads with. Read as a number so it can be compared
    // against the finder's own rows, which is the comparison Tim's 2026-09-19
    // report is about: a combo can never be worth less than the best single
    // offer, because every singleton is a packing the search considers.
    headlineGain: (() => {
      const big = best.querySelector('.combo-head .big');
      if (!big) return null;
      const n = Number(text(big).replace('−', '-').replace('+', ''));
      return Number.isFinite(n) ? n : null;
    })(),
    alt: text(alt),
    weeks: readWeekTable(best),
    body: text(body),
    note: text(document.getElementById('comboNote')),
  };
}

/** Open the hover card on one named player, and read what it drew. */
function openCard(document, selector) {
  const man = document.querySelector(selector);
  if (!man) return null;
  man.dispatchEvent(new globalThis.Event('mouseover', { bubbles: true }));
  const el = document.getElementById('tipCard');
  if (!el) return null;
  return {
    hidden: !!el.hidden,
    ident: text(el.querySelector('.tc-ident')),
    heading: text(el.querySelector('.tc-head')),
    // THE WEEK NUMBER, NOT THE WHOLE HEADER CELL. Since 2026-09-19 a week
    // header can also carry screen-reader text — "(not in your lineup)",
    // "(he starts)", "(first week still to come)" — which the bold-weeks work
    // added (js/player-card.js). A reader matching `/^\d+$/` on the whole cell
    // silently dropped every week that carried one, which is most of them, and
    // then reported the card as five weeks long.
    weeks: [...el.querySelectorAll('.tc-run thead th')]
      .map((th) => (text(th).match(/^\d+/) || [''])[0])
      .filter(Boolean),
    projs: [...el.querySelectorAll('.tc-run tbody td')].map(text),
    // The manager of the row the card was opened in (the list can re-rank
    // between reading it and opening a card, so the row itself is asked).
    rowPartner: text((man.closest('tr') || man).querySelector('.mgr')),
    // The weeks carrying the "you play him" arrow, and what it says aloud.
    vs: [...el.querySelectorAll('.tc-run thead th')]
      .filter((th) => th.querySelector('.tc-vs'))
      .map((th) => Number((text(th).match(/^\d+/) || ['0'])[0])),
    vsSpoken: [...el.querySelectorAll('.tc-run thead th .sr-only')].map(text)
      .filter((t) => /you play/.test(t)),
    // THE THREE ROWS, KEPT APART. The card draws the weeks, then Proj, then
    // Act, and `projs` above flattens all of them — which is fine for counting
    // cells and useless for the one claim Tim made on 2026-09-19: "it shows the
    // act in the preview, but it doesn't actually display any previous weeks in
    // the chart, so that whole row is useless." The Act row can only ever be
    // filled from a week already PLAYED, so telling it from the Proj row is the
    // whole test. A wrapped card has several `.tc-run` tables; the rows are
    // read by their own label so the lines join up rather than being counted
    // as more rows.
    rows: (() => {
      const out = new Map();
      // `tbody tr` ALONE MISSES THE ACT ROW, which is the one this is for: the
      // card puts Proj in a `<tbody>` and Act in a `<tfoot>` (js/player-card.js,
      // so the two bands read apart on every wrapped line). A selector that
      // only looked at the body would report the Act row as absent and every
      // assertion about it would pass by being about nothing.
      for (const tr of el.querySelectorAll('.tc-run tr')) {
        const label = text(tr.querySelector('th')) || '?';
        const cells = [...tr.querySelectorAll('td')].map(text);
        out.set(label, (out.get(label) || []).concat(cells));
      }
      return Object.fromEntries(out);
    })(),
    // -- (H) THE BOLD WEEKS, and the line between what has happened and what
    //        has not. `wk-start` is `js/player-card.js`'s class for a week this
    //        man makes the best lineup; `split-start` is the first column after
    //        `splitAfter`. Read as WEEK NUMBERS so the parent can compare them
    //        with a lineup it solves itself rather than with the page's markup.
    bold: [...el.querySelectorAll('.tc-run thead th.wk-start')]
      .map((th) => Number((text(th).match(/^\d+/) || [0])[0])),
    splitAt: (() => {
      const th = el.querySelector('.tc-run thead th.split-start');
      return th ? Number((text(th).match(/^\d+/) || [0])[0]) : null;
    })(),
    // The plain-words line saying what bold MEANS in this context, which is the
    // half that tells a man you own from a man you are trading for.
    notes: [...el.querySelectorAll('.tc-note')].map(text),
    hovered: text(man),
  };
}

/**
 * One of the custom box's two roster lists, row by row.
 *
 * `order` is the ORDER THE CELLS ARE EMITTED IN, which is the whole of the
 * mirroring claim (Tim, 2026-09-19: "mirror the opponent user's order of
 * columns ... so that both user's numbers are in the middle with the player's
 * names on the outside"). It is read off the DOM rather than from a class,
 * because a class saying "mirror" proves nothing about what was actually drawn.
 */
function readCustomList(document, id) {
  const host = document.getElementById(id);
  if (!host) return [];
  return [...host.querySelectorAll('.cu-man')].map((row) => {
    const line = row.querySelector('.cu-line') || row;
    const order = [...line.children]
      .map((el) => {
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input') return 'box';
        const cls = (el.getAttribute('class') || '').split(/\s+/);
        for (const k of ['sl', 'gap', 'nm', 'pos', 'pv']) if (cls.includes(k)) return k;
        return '?';
      });
    const pv = row.querySelector('.pv');
    return {
      order,
      mirror: (row.getAttribute('class') || '').split(/\s+/).includes('mirror'),
      slot: text(row.querySelector('.sl')),
      // VISIBLE text only: a marked name (bye pill, injury underline) carries
      // sr-only words inside `.nm` since 2026-09-29 (Traps: read them apart).
      name: (() => {
        const nm = row.querySelector('.nm');
        if (!nm) return '';
        const c = nm.cloneNode(true);
        for (const s of [...c.querySelectorAll('.sr-only')]) s.remove();
        return text(c);
      })(),
      pos: text(row.querySelector('.pos')),
      v: text(pv),
      // The scale on the value column, per POSITION across the two squads.
      heat: pv ? (((pv.getAttribute('class') || '').match(/heat-(?:up|dn)-\d|heat-0/) || [''])[0]) : '',
      heatTitle: pv ? (pv.getAttribute('title') || '') : '',
      // A card on the name — the whole of ask H's reachability.
      // The card hangs off the NUMBER, not the name: the row is a `<label>`
      // and the card's own tap handler preventDefaults, so a card on the name
      // would stop the biggest target on the row from ticking the man.
      card: !!row.querySelector('.pv[data-tip]'),
      // Since 2026-09-30 the NAME carries it too, but HOVER ONLY: a tap there
      // is still the tick (`data-tip-hover`, see js/player-card.js).
      nameIsNotTheCard: !row.querySelector('.nm[data-tip]:not([data-tip-hover])'),
      nameHover: !!row.querySelector('.nm[data-tip][data-tip-hover]'),
      // THE ATTRIBUTE, not the property. The list is rebuilt on every tick now
      // (the suggestion marks and the cards' trade context both change with
      // it), so the element whose `.checked` property a test set is gone by the
      // time the next one is drawn — the markup is the only durable answer.
      checked: !!(row.querySelector('input') || { hasAttribute: () => false })
        .hasAttribute('checked'),
    };
  });
}

// ------------------------------------------------------------------ scenarios

const SCENARIOS = {
  /**
   * CUSTOM TRADES (Tim, 2026-09-18): build a deal by hand between any two
   * squads, price it, keep it.
   *
   * Driven through the real controls — change a picker, tick a checkbox, press
   * Save — rather than by calling the module's functions, because what is being
   * tested is that the panel WORKS, and every defect this page has had was in
   * the wiring rather than in the arithmetic.
   */
  async custom() {
    const { document, window, errors } = await boot();
    const out = {};
    const $ = (id) => document.getElementById(id);
    const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

    // The page prices itself on load; the suggestions and the inline breakdown
    // both want the weeks, so this waits for them exactly as the other weekly
    // scenarios do.
    await settleGoal(document);

    // THERE IS NO A-SIDE PICKER ANY MORE (Tim, 2026-09-19). Both halves are
    // asserted: the select is gone from the document, and the label that
    // replaced it names the manager selected at the top of the page.
    out.noTeamAPicker = !$('cuTeamA');
    out.youLine = text($('cuYou'));
    out.teamOptions = [...$('cuTeamB').querySelectorAll('option')].map(text);
    // Soonest opponent first, with the weeks after the name (Tim, 2026-09-30).
    out.optWeeks = out.teamOptions.map((t) => {
      const m = / · wks? ([\d, ]+)$/.exec(t);
      return m ? m[1].split(',').map((x) => Number(x.trim())) : [];
    });
    out.startsEmpty = text($('cuEmpty'));
    // THE INSTRUCTION, PRINTED ONCE (Phase 5, V5): counted over the whole
    // panel's text before anything is ticked. It was in `#cuPreview` AND in
    // `#cuEmpty`, ~120px apart.
    out.tickInstructions = (text($('customPanel')).match(/Tick who moves on each side/g) || []).length;
    out.wrapHiddenAtFirst = $('cuWrap').hidden;
    out.saveDisabledAtFirst = $('cuSave').disabled;

    // "YOU" FOLLOWS THE TOP PICKER. Driven through `#teamSelect` — the page's
    // one manager control — which is the claim: there is exactly one place the
    // reader says who he is.
    const teamSel = $('teamSelect');
    const ids = [...teamSel.querySelectorAll('option')].map((o) => Number(o.value));
    const a = ids[ids.length - 1];
    teamSel.value = String(a);
    fire(teamSel, 'change');
    await settle(4000);
    out.followedTop = {
      you: text($('cuYou')),
      headA: text($('cuHeadA')),
      // The B picker must never offer the squad that is now "you".
      bOptions: [...$('cuTeamB').querySelectorAll('option')].map((o) => Number(o.value)),
      teamName: text([...teamSel.querySelectorAll('option')].find((o) => Number(o.value) === a)),
    };

    const b = [...$('cuTeamB').querySelectorAll('option')].map((o) => Number(o.value))[0];
    $('cuTeamB').value = String(b);
    fire($('cuTeamB'), 'change');
    out.picked = { a, b };
    out.headA = text($('cuHeadA'));
    out.headB = text($('cuHeadB'));
    out.listA = $('cuListA').querySelectorAll('.cu-man').length;
    out.listB = $('cuListB').querySelectorAll('.cu-man').length;
    // -- (C) THE MIRROR, AND THE CONDENSING -------------------------------
    out.rowsA = readCustomList(document, 'cuListA');
    out.rowsB = readCustomList(document, 'cuListB');
    out.heatKey = text($('cuHeatKey'));
    // -- (F) THE BREAKDOWN, BESIDE THE BUILDER ----------------------------
    // NULL-SAFE, because since 2026-09-19 the host is REMOVED from the
    // document on a narrow window. A bare `$('cuInline').innerHTML` threw, and
    // a scenario that throws reports as a boot failure instead of as the
    // assertion it actually is.
    out.inlineBeforeTick = {
      html: (($('cuInline') || {}).innerHTML || '').length,
      table: !!($('cuInline') && $('cuInline').querySelector('table.weeks')),
      text: text($('cuInline')),
    };
    // SPLIT DOWN THE MIDDLE (Tim, 2026-09-29): two halves in ONE row, yours
    // [week box, roster] and his [roster, week box]. Read as each half's
    // children in document order, which is also the Tab order.
    out.buildRow = (() => {
      const row = document.querySelector('.cu-build');
      if (!row) return null;
      return [...row.children].map((el) => el.getAttribute('class') || el.id || '');
    })();
    out.halves = [...document.querySelectorAll('.cu-build > .cu-half')]
      .map((h) => [...h.children].map((el) => (el.getAttribute('class') || '').split(/\s+/)[0]));
    // THE OTHER HALF OF THE WIDTH RULE: with room beside the builder the host
    // IS in the document. Asserted here as well as in `customNarrow`, so the
    // pair reads as one claim with two answers.
    out.inlinePresent = !!$('cuInline');
    // BOTH SIDES AS A LINEUP (Tim, 2026-09-19: "display the two teams players
    // ... with order of positions and overall starting lineup (QB, RB1, RB2,
    // ... BE, BE, BE, etc.)"). The slot labels in document order are what the
    // claim is about, so they are read rather than the names.
    out.slotsA = [...$('cuListA').querySelectorAll('.cu-man .sl')].map(text);
    out.slotsB = [...$('cuListB').querySelectorAll('.cu-man .sl')].map(text);
    out.openDisabledAtFirst = $('cuOpen').disabled;

    // One man each way. NOT the first checkbox any more — the list is a lineup
    // now, so the first row is the quarterback and picking him on both sides
    // makes a QB-for-QB deal, which the engine prices at nearly nothing and
    // would make the gain assertions below vacuous.
    const boxes = (id) => [...$(id).querySelectorAll('input[type="checkbox"]')];
    const boxA = boxes('cuListA')[0];
    // RE-QUERIED AFTER EVERY TICK, never held across one. The lists are rebuilt
    // on a tick now — the suggestion marks and every card's trade context both
    // change with it — so a checkbox captured beforehand is a detached element
    // whose event bubbles to nothing. That is a silent no-op, and it is exactly
    // how this scenario first "passed" while saving a one-sided deal.
    const bIndex = boxes('cuListB').length > 1 ? 1 : 0;
    out.men = { a: boxA.value, b: boxes('cuListB')[bIndex].value };
    boxA.checked = true;
    fire(boxA, 'change');
    out.previewOneSided = text($('cuPreview'));
    const boxB = boxes('cuListB')[bIndex];
    boxB.checked = true;
    fire(boxB, 'change');
    out.preview = text($('cuPreview'));
    out.saveEnabled = !$('cuSave').disabled;
    out.openEnabled = !$('cuOpen').disabled;
    // EACH SIDE'S FIGURE, UNDER ITS OWN SIDE (Tim: "right now they're both
    // under the first players trade"). Read out of the two containers, which is
    // the only way to tell "under its own side" from "both in one paragraph".
    const gain = (id) => ({
      num: text($(id).querySelector('.cu-num')),
      cls: ($(id).querySelector('.cu-num') || {}).getAttribute
        ? $(id).querySelector('.cu-num').getAttribute('class')
        : '',
      sub: text($(id).querySelector('.cu-sub')),
    });
    out.gainA = gain('cuGainA');
    out.gainB = gain('cuGainB');
    // The tick survives the redraw the suggestions and the cards now force —
    // read off the MARKUP, because the element the test ticked no longer
    // exists.
    out.stillChecked = boxes('cuListA')[0].hasAttribute('checked');
    out.litRow = ($('cuListA').querySelector('.cu-man').getAttribute('class') || '').includes('on');

    // -- "ALSO SEND" IS GONE (Tim, 2026-09-29: "could we remove the 'also
    // send' suggestions? I haven't found them usefull at all yet.") ----------
    out.suggestGone = {
      line: !!$('cuSuggest'),
      marks: document.querySelectorAll('.cu-sug, .cu-man.sug').length,
      words: /also send/i.test(text($('customPanel'))),
    };
    // -- (F) THE BREAKDOWN, once there is a deal ---------------------------
    out.inline = {
      present: !!$('cuInline'),
      table: !!($('cuInline') && $('cuInline').querySelector('table.weeks')),
      weeks: $('cuInline') ? readWeekTable($('cuInline')) : null,
      host: !!document.getElementById('cuWeek'),
      title: text($('cuInline') && $('cuInline').querySelector('.cu-inline-title')),
    };
    // -- HIS HALF (2026-09-29): the same table from his lineup ----------------
    const readB = () => {
      const node = $('cuInlineB');
      const brk = document.getElementById('cuWeekB');
      return {
        present: !!node,
        table: !!(node && node.querySelector('table.weeks')),
        weeks: node ? readWeekTable(node) : null,
        host: !!brk,
        title: text(node && node.querySelector('.cu-inline-title')),
        opening: brk ? {
          title: text(brk.querySelector('.wkx-title')),
          lead: text(brk.querySelector('.wkx-lead')),
          pressed: [...brk.querySelectorAll('[data-side][aria-pressed="true"]')]
            .map((x) => x.getAttribute('data-side')),
        } : null,
      };
    };
    out.inlineB = readB();
    out.vsA = $('cuInline')
      ? [...$('cuInline').querySelectorAll('tr[data-wk] .vs-note')].map((n) => n.closest('tr').getAttribute('data-wk'))
      : [];
    out.vsB = $('cuInlineB')
      ? [...$('cuInlineB').querySelectorAll('tr[data-wk] .vs-note')].map((n) => n.closest('tr').getAttribute('data-wk'))
      : [];
    out.cuWeekTitleBefore = text(document.querySelector('#cuWeek .wkx-title'));
    // BEFORE any week is hovered it is already filled, on the week the deal
    // moves most (Phase 5, V17 — "same for #cuInline").
    out.inlineOpening = (() => {
      const host = document.getElementById('cuWeek');
      return host
        ? {
          table: !!host.querySelector('table.wkx-table'),
          title: text(host.querySelector('.wkx-title')),
          lead: text(host.querySelector('.wkx-lead')),
        }
        : null;
    })();
    // Hover a week inside it: the slot-by-slot panel is the pop-up's own, and
    // it must open HERE without touching the modal.
    const inlineWeekRow = $('cuInline') &&
      $('cuInline').querySelector('table.weeks tbody tr[data-wk]');
    if (inlineWeekRow) fire(inlineWeekRow.querySelector('td.name'), 'mouseover');
    out.inlineBreak = (() => {
      const host = document.getElementById('cuWeek');
      if (!host) return null;
      const table = host.querySelector('table.wkx-table');
      return {
        present: !!table,
        title: text(host.querySelector('.wkx-title')),
        slots: table ? [...table.querySelectorAll('tbody tr th')].map(text) : [],
        sides: [...host.querySelectorAll('[data-side]')].map((x) => x.getAttribute('data-side')),
        modalStillShut: !!$('dealModal').hidden,
      };
    })();

    // Hover a week in HIS half: his breakdown moves, and yours stays put.
    {
      const rowsB = $('cuInlineB') ? [...$('cuInlineB').querySelectorAll('table.weeks tbody tr[data-wk]')] : [];
      const target = rowsB[rowsB.length - 1];
      out.hoverB = { week: target ? target.getAttribute('data-wk') : null, mineBefore: text(document.querySelector('#cuWeek .wkx-title')) };
      if (target) fire(target.querySelector('td.name'), 'mouseover');
      out.hoverB.theirs = text(document.querySelector('#cuWeekB .wkx-title'));
      out.hoverB.mineAfter = text(document.querySelector('#cuWeek .wkx-title'));
    }

    // THE SLOT-BY-SLOT IS A CARD ON THE WEEK LABEL (Tim, 2026-09-30: "instead of
    // showing the 'week __, slot by slot' as a box below the week by week
    // details in the custome trade, could you just show them as a big preview
    // if the user hovers over the 'week __ ' label").
    out.float = (() => {
      const f = document.getElementById('cuWeek');
      const fb = document.getElementById('cuWeekB');
      const label = $('cuInline') && $('cuInline').querySelector('table.weeks tbody tr[data-wk] td.name');
      const ev = (type, extra) => {
        const e = new window.Event(type, { bubbles: true });
        for (const [k, v] of Object.entries(extra || {})) Object.defineProperty(e, k, { value: v });
        return e;
      };
      const r = {
        boxInHalf: !!($('cuInline') && $('cuInline').querySelector('.wkx')) ||
          !!($('cuInlineB') && $('cuInlineB').querySelector('.wkx')),
        bodyChild: !!f && f.parentElement === document.body && f.classList.contains('wkx-float'),
        bodyChildB: !!fb && fb.parentElement === document.body,
        hiddenAtFirst: !!f && f.hidden,
      };
      if (!f || !label) return r;
      label.dispatchEvent(ev('mouseover'));
      r.hoverShows = !f.hidden;
      r.hoverWeek = label.closest('tr').getAttribute('data-wk');
      r.hoverTitle = text(f.querySelector('.wkx-title'));
      label.dispatchEvent(ev('mouseout', { relatedTarget: $('cuTeamB') }));
      r.leaveHides = null; // read after the grace, below
      label.dispatchEvent(ev('click'));
      r.clickPins = !f.hidden;
      label.dispatchEvent(ev('mouseout', { relatedTarget: $('cuTeamB') }));
      r.pinnedStays = !f.hidden;
      const close = f.querySelector('.wkx-close');
      if (close) close.dispatchEvent(ev('click'));
      r.closeHides = f.hidden;
      label.dispatchEvent(ev('click'));
      document.dispatchEvent(ev('keydown', { key: 'Escape' }));
      r.escapeHides = f.hidden;
      label.dispatchEvent(ev('click'));
      $('cuTeamB').dispatchEvent(ev('click'));
      r.outsideHides = f.hidden;
      return r;
    })();
    {
      const f = document.getElementById('cuWeek');
      const label = $('cuInline') && $('cuInline').querySelector('table.weeks tbody tr[data-wk] td.name');
      if (f && label) {
        const e1 = new window.Event('mouseover', { bubbles: true });
        label.dispatchEvent(e1);
        const e2 = new window.Event('mouseout', { bubbles: true });
        Object.defineProperty(e2, 'relatedTarget', { value: $('cuTeamB') });
        label.dispatchEvent(e2);
        out.float.leaveStillShownAtOnce = !f.hidden;
        await new Promise((res) => setTimeout(res, 300));
        out.float.leaveHides = f.hidden;
      }
    }
    // The weeks the two squads meet, at the top of the box (Tim, 2026-09-30).
    out.meetTop = { text: text($('cuMeet')), inPick: !!document.querySelector('.cu-pick #cuMeet') };

    // THE BUILDER'S OWN POP-UP — the deal being built, not one already saved.
    // That is the half of his 2026-09-19 ask that did not exist: a saved row
    // has opened the finder's pop-up since 2026-09-18, and there was no way to
    // look at a deal week by week BEFORE committing it to the list.
    fire($('cuOpen'), 'click');
    out.builderModal = {
      open: !$('dealModal').hidden,
      title: text($('dealTitle')),
      weeks: $('dealBody').querySelectorAll('tbody tr').length,
    };
    const closeBuilder = $('dealClose');
    if (closeBuilder) fire(closeBuilder, 'click');

    fire($('cuSave'), 'click');
    // -- (E) A SAVED ROW IS A FINDER ROW -----------------------------------
    //
    // Read with the SAME reader the finder's and the combo's rows go through.
    // That is the claim: not "it looks similar" but "it is the same builder",
    // and a reader that could not parse it would fail here rather than passing
    // on a hand-written row that merely resembled one.
    out.savedRows = readOfferRows($('cuTable'));
    out.savedHeads = [...$('cuTable').querySelectorAll('thead th')].map(text);
    out.savedRemove = $('cuRows').querySelectorAll('button[data-drop]').length;
    // The saved row's LAST cell and the buttons stacked in it, top to bottom
    // (Tim, 2026-10-01: Assume, Remove and Ask AI stacked in one column).
    out.savedLastTwo = (() => {
      const tr = $('cuRows').querySelector('tr');
      const last = tr ? tr.children[tr.children.length - 1] : null;
      if (!last) return '';
      return (last.getAttribute('class') || '') + ':' +
        [...last.querySelectorAll('button')].map(text).join('/');
    })();
    out.savedKey = text($('cuTableKey'));
    out.wrapShown = !$('cuWrap').hidden;
    out.emptyHiddenAfterSave = ($('cuEmpty').getAttribute('class') || '').includes('hidden');
    out.ticksClearedAfterSave =
      $('cuListA').querySelectorAll('input:checked').length +
      $('cuListB').querySelectorAll('input:checked').length;
    out.pickersKept = { a: Number($('teamSelect').value), b: Number($('cuTeamB').value) };
    const readPrefs = () => {
      try { return JSON.parse(window.localStorage.getItem('ff.prefs') || '{}'); } catch { return {}; }
    };
    out.stored = readPrefs()['trade.custom'] || null;

    // The same deal a second time is one deal. Re-queried between the two
    // ticks, for the reason above.
    const boxA2 = boxes('cuListA')[0];
    boxA2.checked = true; fire(boxA2, 'change');
    const boxB2 = boxes('cuListB')[bIndex];
    boxB2.checked = true; fire(boxB2, 'change');
    fire($('cuSave'), 'click');
    out.rowsAfterDuplicate = $('cuRows').querySelectorAll('tr').length;

    // A saved row opens the finder's own pop-up.
    fire($('cuRows').querySelector('tr'), 'click');
    out.modalOpen = !$('dealModal').hidden;
    out.modalTitle = text($('dealTitle'));
    out.modalWeeks = $('dealBody').querySelectorAll('tbody tr').length;
    out.modalBody = text($('dealBody')).length;
    const close = $('dealClose');
    if (close) fire(close, 'click');

    // Removing it empties the box again.
    fire($('cuRows').querySelector('button[data-drop]'), 'click');
    out.rowsAfterDrop = $('cuRows').querySelectorAll('tr').length;
    out.storedAfterDrop = readPrefs()['trade.custom'] || null;

    out.note = text($('cuNote'));
    out.errors = errors;
    return out;
  },

  /**
   * THE SAME BOX ON A NARROW WINDOW — the other side of the width rule.
   *
   * Tim asked for the breakdown "to the side of the custom trade setup", and
   * the ask carries its own condition: "(There will be enough space to the side
   * of the box once we condense it…)". Below 900px there is no side, and
   * leaving it in cost +767px of panel at a 900px window and +191px at 390px,
   * because the breakdown took enough width off the two mirrored rosters that
   * THEY stacked as well.
   *
   * So this boots the identical page with only the window changed and asserts
   * the answer flips — and asserts it about the DOCUMENT rather than about a
   * style, because "hidden" would keep every one of those costs and would keep
   * a stale week table one resize away from being shown.
   */
  async customNarrow() {
    const { document, window, errors } = await boot('trade.html', '', null, { wide: false });
    const out = { errors };
    const $ = (id) => document.getElementById(id);
    const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
    await settleGoal(document);

    // Before a deal exists: the host is not in the document at all.
    out.hostBeforeTick = !!$('cuInline');
    out.buildRow = [...document.querySelector('.cu-build').children]
      .map((el) => el.getAttribute('class') || el.id || '');
    out.halves = [...document.querySelectorAll('.cu-build > .cu-half')]
      .map((h) => [...h.children].map((el) => (el.getAttribute('class') || '').split(/\s+/)[0]));

    // Build a real deal, exactly as the wide scenario does.
    const boxes = (id) => [...$(id).querySelectorAll('input[type="checkbox"]')];
    const boxA = boxes('cuListA')[0];
    boxA.checked = true; fire(boxA, 'change');
    const bIndex = boxes('cuListB').length > 1 ? 1 : 0;
    const boxB = boxes('cuListB')[bIndex];
    boxB.checked = true; fire(boxB, 'change');
    await settle(1500);

    // With a deal priced and the two big figures on screen, there is still no
    // breakdown ANYWHERE in the panel — not an empty host, not a hidden table.
    out.priced = text($('cuGainA').querySelector('.cu-num'));
    out.host = !!$('cuInline');
    out.inlineNodes = document.querySelectorAll('.cu-inline').length;
    out.panelWeekTables = $('customPanel').querySelectorAll('table.weeks').length;
    out.panelInlineTitles = $('customPanel').querySelectorAll('.cu-inline-title').length;

    // AND THE ROUTE IN IS STILL THERE. Nothing may lose a tap route on a phone
    // (HANDOFF): the "Week by week" button opens the same breakdown, in the
    // pop-up every other trade on this page has always used.
    out.openEnabled = !$('cuOpen').disabled;
    fire($('cuOpen'), 'click');
    out.modal = {
      open: !$('dealModal').hidden,
      weeks: $('dealBody').querySelectorAll('table.weeks tbody tr[data-wk]').length,
      title: text($('dealTitle')),
    };
    const close = $('dealClose');
    if (close) fire(close, 'click');
    out.modalClosed = !!$('dealModal').hidden;
    return out;
  },

  /** The page as it opens: demo data, both panels populated. */
  async fresh() {
    const { document, errors, fetchCalls } = await boot();
    // SETTLED, since 2026-09-21: the page now searches on points, then again
    // on the goal's week weights once the simulation can be built, then ranks
    // — a table read mid-way is a list that is about to be replaced.
    await settle(25000);
    return {
      errors, fetchCalls,
      depth: readDepth(document),
      trades: readTrades(document),
      heads: [...document.querySelectorAll('#tradeTable thead th')].map(text),
      count: text(document.getElementById('tradeCount')),
      note: text(document.getElementById('depthNote')),
      // Phase 5, V18: the depth map's tint rule, in its VISIBLE key.
      depthKey: text(document.getElementById('depthKey')),
      depthKeyHidden: (() => {
        const el = document.getElementById('depthKey');
        if (!el) return true;
        return !!el.hidden || !!el.closest('details');
      })(),
      tintedDepthCells: document.querySelectorAll('#depthTable td.deep, #depthTable td.thin').length,
      tradeNote: text(document.getElementById('tradeNote')),
      empty: text(document.getElementById('tradeEmpty')),
      emptyHidden: (document.getElementById('tradeEmpty').getAttribute('class') || '').includes('hidden'),
      badge: text(document.getElementById('modeBadge')),
      teams: [...document.querySelectorAll('#teamSelect option')].map(text),
      partners: [...document.querySelectorAll('#partnerSelect option')].map(text),
      // The shape filter, label by label. `kind` is the stored preference and
      // `label` is only what it is called — the two must be able to move apart,
      // which is the whole reason the buttons were relabelled without touching
      // a single saved value.
      kinds: [...document.querySelectorAll('#kindToggle button')].map((b) => ({
        kind: b.getAttribute('data-kind'),
        label: text(b),
        title: b.getAttribute('title') || '',
      })),
      kindHint: text(document.querySelector('#kindToggle ~ .ctl-hint')),
      panels: readPanelOrder(document),
    };
  },

  /** Every package shape, searched separately. */
  async shapes() {
    const { document, fetchCalls, errors } = await boot();
    const out = { fetchCalls, errors, byKind: {} };
    for (const kind of ['all', 'even', 'consolidate', 'depth']) {
      const btn = document.querySelector(`#kindToggle button[data-kind="${kind}"]`);
      btn.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
      await settle();
      out.byKind[kind] = {
        on: btn.getAttribute('class') || '',
        rows: readTrades(document).map((r) => ({
          shape: r.shape, send: r.send.length, get: r.receive.length, hasDeal: r.hasDeal, lastAsk: r.lastAsk,
        })),
        empty: text(document.getElementById('tradeEmpty')),
      };
    }
    return out;
  },

  /**
   * "ASK AI" (Tim, 2026-09-30): the button on the end of every offer row copies
   * a prompt for an AI chat. The clipboard is stubbed and RECORDS what it was
   * given, so the text is read back exactly as the page wrote it. With
   * `TR_NO_CLIPBOARD` there is no Clipboard API at all and the page must fall
   * back to `execCommand('copy')` on a hidden textarea (an http page, an old
   * Safari) — the stub records the textarea's value at the moment of the copy.
   */
  async askAi() {
    const { document, window, errors, fetchCalls } = await boot();
    await settleGoal(document);
    const copied = [];
    const noApi = !!process.env.TR_NO_CLIPBOARD;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: noApi ? { userAgent: 'test' } : {
        userAgent: 'test',
        clipboard: { writeText: (t) => { copied.push({ via: 'api', text: String(t) }); return Promise.resolve(); } },
      },
    });
    document.execCommand = (cmd) => {
      const ta = document.querySelector('textarea');
      copied.push({ via: `exec:${cmd}`, text: ta ? ta.value : '' });
      return true;
    };
    const out = { errors, fetchCalls, noApi };
    const heads = (table) => [...table.querySelectorAll('thead th')].map(text);
    out.finderHeads = heads(document.getElementById('tradeTable'));
    out.comboHeads = [...document.querySelectorAll('#comboBody table')].map(heads);
    out.cuHeads = heads(document.getElementById('cuTable'));
    out.finder = readTrades(document).map((r) => ({ hasDeal: r.hasDeal, lastAsk: r.lastAsk, n: r.askButtons }));
    out.combo = [...document.querySelectorAll('#comboBody table')].flatMap((t) => readOfferRows(t))
      .map((r) => ({ hasDeal: r.hasDeal, lastAsk: r.lastAsk, n: r.askButtons }));
    out.headCellsMatchRow = (() => {
      const tr = document.querySelector('#tradeTable tbody tr');
      return tr ? tr.children.length === out.finderHeads.length : null;
    })();

    // The first finder row, as the page drew it.
    const tr = document.querySelector('#tradeTable tbody tr');
    const split = (td) => {
      if (!td) return null;
      const sub = text(td.querySelector('.sub'));
      const all = text(td).replace(/\s*[▲▼]/g, '');
      return { head: all.slice(0, all.length - sub.length).replace(/\s+/g, '').trim(), sub };
    };
    const nameOf = (m) => {
      const a = m.querySelector('a.pref');
      return a ? (a.getAttribute('aria-label') || '').split(' — ')[0] : '';
    };
    out.row = {
      partner: text(tr.querySelector('.mgr')),
      gain: split(tr.querySelector('td.gain')),
      their: split(tr.querySelector('td.their-gain')),
      send: [...tr.querySelectorAll('td.send .man')].map((m) => ({ name: nameOf(m), val: text(m.querySelector('.val')) })),
      receive: [...tr.querySelectorAll('td.recv .man')].map((m) => ({ name: nameOf(m), val: text(m.querySelector('.val')) })),
      goal: (() => {
        const td = tr.querySelector('td.goal-cell');
        const sub = text(td && td.querySelector('.sub'));
        return { sub, yes: (sub.match(/(\d+)% yes/) || [])[1] || null };
      })(),
      opp: text(tr.querySelector('td.opp-proj')),
    };
    out.dealHiddenBefore = document.getElementById('dealModal').hidden;

    const btn = tr.querySelector('button.ask-ai');
    out.labelBefore = text(btn);
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await settle(50);
    out.labelAfter = text(btn);
    out.dealHiddenAfter = document.getElementById('dealModal').hidden;
    out.textareasLeft = document.querySelectorAll('textarea').length;
    out.copied = copied.slice();
    await settle(2200);
    out.labelLater = text(btn);

    // A COMBO row's button copies its own deal too.
    const comboBtn = document.querySelector('#comboBody table tbody tr button.ask-ai');
    if (comboBtn) {
      comboBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      await settle(50);
      const ctr = comboBtn.closest('tr');
      out.comboPartner = text(ctr.querySelector('.mgr'));
      out.comboCopied = copied.length > out.copied.length ? copied[copied.length - 1].text : '';
    }
    return out;
  },

  /** Switching team repaints both panels; switching partner narrows one. */
  async controls() {
    const { document, fetchCalls, errors } = await boot();
    const before = { depth: readDepth(document), trades: readTrades(document) };

    const teamSel = document.getElementById('teamSelect');
    const second = [...teamSel.querySelectorAll('option')][3];
    teamSel.value = second.getAttribute('value');
    fire(teamSel);
    await settle();
    const afterTeam = { depth: readDepth(document), trades: readTrades(document) };

    // Narrow to a manager who DOES have offers, so "only his offers" is a real
    // claim rather than a vacuous one about an empty list — and then to one who
    // has none, which is the path that used to leave stale rows in the document.
    const partnerSel = document.getElementById('partnerSelect');
    const options = [...partnerSel.querySelectorAll('option')].slice(1);
    const withOffers = afterTeam.trades.length ? afterTeam.trades[0].partner : null;
    const busy = options.find((o) => text(o) === withOffers) || options[0];
    const quiet =
      options.find((o) => !afterTeam.trades.some((t) => t.partner === text(o))) || null;

    const narrow = (option) => {
      partnerSel.value = option.getAttribute('value');
      fire(partnerSel);
      return {
        name: text(option),
        trades: readTrades(document),
        // Read raw from the tbody rather than from what is visible. Hiding the
        // wrapper without emptying it is exactly the bug this scenario found,
        // and a reader that skipped hidden rows would have agreed with it.
        wrapHidden: (document.getElementById('tradeWrap').getAttribute('class') || '').includes('hidden'),
        empty: text(document.getElementById('tradeEmpty')),
      };
    };

    const afterPartner = narrow(busy);
    await settle();
    const afterQuietPartner = quiet ? narrow(quiet) : null;
    await settle();

    // Back to everybody: a filter has to be reversible.
    partnerSel.value = 'all';
    fire(partnerSel);
    await settle();
    const afterReset = readTrades(document);

    const measure = document.getElementById('measureSelect');
    measure.value = 'week';
    fire(measure);
    await settle();
    const afterMeasure = { depth: readDepth(document), note: text(document.getElementById('depthNote')) };

    return {
      fetchCalls, errors, before, afterTeam,
      afterPartner, afterQuietPartner, afterReset, afterMeasure,
    };
  },

  /**
   * The weekly measure on demo data — WHICH THE PAGE NOW BUYS ITSELF.
   *
   * Tim, 2026-09-19: "make this price action an automatic action with the page
   * (it should not load if it doesn't price it)". So this scenario's `after` is
   * what the page looks like having been left alone, and its `scalar` is what
   * it looks like once a reader deliberately picks one of the cheap measures.
   *
   * THAT IS THE REVERSE OF WHAT IT USED TO BE, and it is why the comparison
   * still works: the two bases have to produce genuinely different numbers or
   * one of them is being ignored, and it does not matter which way round they
   * are read. Every week is in hand either way by then, so switching costs
   * nothing and the difference cannot be a loading artefact.
   *
   * Demo generates its weeks inside the page, so this costs no requests — which
   * is exactly why it is the scenario that can check the whole of the weekly
   * path (the drill-down, the combo, the cards) while still asserting that the
   * page made no network call at all.
   */
  async weekly() {
    const { document, errors, fetchCalls } = await boot();
    // Long enough for the auto-load AND the re-rank behind it: thirteen weeks
    // of lineup fills per offer is seconds, not milliseconds.
    await settleGoal(document);

    const after = {
      cost: readCost(document),
      depth: readDepth(document),
      trades: readTrades(document),
      combo: readCombo(document),
      heads: [...document.querySelectorAll('#tradeTable thead th')].map(text),
      note: text(document.getElementById('tradeNote')),
      // The visible line under the finder, which now also carries the colour
      // key — channel 4 of "never colour alone".
      count: text(document.getElementById('tradeCount')),
      depthNote: text(document.getElementById('depthNote')),
      spares: [...document.querySelectorAll('#spareStrip .spare-chip[data-tip]')].map(text),
      measure: document.getElementById('measureSelect').value,
      weeks: [...document.querySelectorAll('#weekSelect option')].map((o) => o.getAttribute('value')),
      week: document.getElementById('weekSelect').value,
    };

    // Now DOWN to a scalar measure, deliberately chosen. Nothing is fetched —
    // every week is already held — so any difference below is the measure and
    // nothing else.
    const measure = document.getElementById('measureSelect');
    measure.value = 'typical';
    fire(measure);
    await settle(2000);
    const scalar = {
      cost: readCost(document),
      depth: readDepth(document),
      trades: readTrades(document),
      combo: readCombo(document),
      measure: measure.value,
    };
    // And back, so everything below reads the weekly page.
    measure.value = 'weeks';
    fire(measure);
    await settleGoal(document);
    const before = scalar;

    // Click the first offer: the drill-down is the whole of ask 3. Its own
    // advertised gain is read off THAT row as it is clicked — the list can
    // re-rank behind the pop-up, and `after.trades` was read before that.
    const row = document.querySelector('#tradeTable tbody tr');
    const dealRowGain = row
      ? Number((row.querySelector('td.gain') || {}).getAttribute?.('data-v'))
      : NaN;
    if (row) row.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(1200);
    const deal = readDeal(document);

    // And a card on a player name, which is ask 1.
    const card = openCard(document, '#tradeTable .man[data-tip]');
    const spareCard = openCard(document, '#spareStrip .spare-chip[data-tip]');

    // A deal that moves one of HIS OWN men, found by opening the offers in
    // order. The top row is no longer that deal by construction: since the goal
    // chooses the candidates, the best one often moves only the men traded. So
    // the own-man claims are checked on the first offer that has any, and the
    // scenario says how many it opened to find it.
    let ownDeal = null;
    let ownOpened = 0;
    const nRows = document.querySelectorAll('#tradeTable tbody tr').length;
    for (let i = 0; i < nRows; i++) {
      if (!document.getElementById('dealModal').hidden) {
        document.getElementById('dealClose').dispatchEvent(new globalThis.Event('click', { bubbles: true }));
        await settle(300);
      }
      // Looked up fresh each time: the table can repaint behind the pop-up.
      const r = document.querySelectorAll('#tradeTable tbody tr')[i];
      if (!r) break;
      r.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
      await settle(600);
      ownOpened++;
      const d = readDeal(document);
      if (!d.hidden && d.churnEntries.some((e) => e.own)) { ownDeal = d; break; }
    }

    return {
      errors, fetchCalls, before, after, deal, card, spareCard, ownDeal, ownOpened, dealRowGain,
      // What the parent needs to rebuild the same league and price the same
      // packing independently.
      myTeamId: document.getElementById('teamSelect').value,
      week: Number(document.getElementById('weekSelect').value),
    };
  },

  /**
   * The drill-down as a POP-UP: Tim's fifth ask, and every way out of it.
   *
   * "Only show the weekly current/change if the user clicks on it (including
   * the best combo), and show it as a pop-up, not a separate box below
   * everything."
   *
   * Three things have to be true and they are three different claims: it does
   * not EXIST until something is clicked; it opens from the finder AND from a
   * combo row; and it closes all three ways a modal has to close — its own
   * button, Escape, and a click outside it. A pop-up that only closes one way
   * is one somebody gets stuck under, which is the same rule the player card's
   * sheet already follows.
   */
  async modal() {
    const { document, errors, fetchCalls } = await boot();
    const click = (el) => {
      if (el) el.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    };
    const key = (k) => {
      const ev = new globalThis.Event('keydown', { bubbles: true });
      ev.key = k;
      document.dispatchEvent(ev);
    };

    // The page buys its own weeks now (2026-09-19) and re-ranks behind the
    // first paint, so this waits rather than pressing. The press is a RE-READ
    // and would only spend the same weeks again.
    await settleGoal(document);

    // Nothing has been clicked yet, so there must be no dialog and no table.
    const before = readDeal(document);

    // -- from a finder row, by its KEYBOARD route rather than the row click,
    //    because that is the half a <tr> cannot do on its own.
    click(document.querySelector('#tradeTable tbody tr button.wk-open'));
    await settle(1200);
    const opened = readDeal(document);

    // -- closed by its own button
    click(document.getElementById('dealClose'));
    await settle(600);
    const closedByButton = readDeal(document);

    // -- opened again, closed by Escape
    click(document.querySelector('#tradeTable tbody tr'));
    await settle(1200);
    const reopened = readDeal(document);
    key('Escape');
    await settle(600);
    const closedByEscape = readDeal(document);

    // -- opened again, closed by a click anywhere outside the card
    click(document.querySelector('#tradeTable tbody tr'));
    await settle(1200);
    click(document.getElementById('depthNote'));
    await settle(600);
    const closedByOutside = readDeal(document);

    // -- and from a COMBO row, which is the other half of the ask
    const comboRow = document.querySelector('#comboTable tbody tr');
    click(comboRow);
    await settle(1200);
    const fromCombo = readDeal(document);

    // A click INSIDE the card must not close it — the backdrop is outside, the
    // thing you are reading is not.
    click(document.getElementById('dealNote'));
    await settle(400);
    const stillOpen = readDeal(document);

    // And the WHOLE packing, which is the other thing that used to be printed
    // inline under the list. "Including the best combo" is the half of ask 5
    // that is about this button.
    key('Escape');
    await settle(400);
    const headButton = document.querySelector('#comboBody .combo-head button.wk-open');
    click(headButton);
    await settle(1500);
    const wholeCombo = readDeal(document);

    return {
      errors, fetchCalls,
      before, opened, closedByButton, reopened, closedByEscape, closedByOutside,
      fromCombo, stillOpen, wholeCombo,
      hadHeadButton: !!headButton,
      headLabel: text(headButton),
      // Nothing may be printing a week-by-week table outside the pop-up now.
      strayWeekTables: document.querySelectorAll('#comboBody table.weeks').length +
        document.querySelectorAll('#tradeTable table.weeks').length,
      hadComboRow: !!comboRow,
      comboPartner: comboRow ? text(comboRow.querySelector('.mgr')) : '',
      // The modal frame is a direct child of <body>, not of a scrolling panel:
      // a `position: fixed` box inside `overflow: auto` is positioned against
      // that box rather than the window.
      parent: (document.getElementById('dealModal').parentNode || {}).tagName || '',
      // Nothing may lock the page's own scrolling. A modal that sets an
      // overflow on <body> and then fails to unset it leaves a page nobody can
      // scroll and no way to tell why.
      bodyStyle: document.body.getAttribute('style') || '',
    };
  },

  /**
   * The pop-up opened BEFORE anybody pressed the page's weekly button.
   *
   * Tim's report, 2026-09-16: the pop-up held "just words" — a sentence telling
   * him to press a button at the top — rather than the week-by-week numbers. A
   * click on a deal is the ask for them, so the click buys them, and it must
   * neither move the page off the measure he chose nor re-run the search (which
   * would shut the pop-up he just opened).
   *
   * SINCE 2026-09-19 THE PAGE BUYS THE WEEKS ITSELF, so "unpriced" is no longer
   * a state a reader can be left in — but the claim underneath it is not about
   * the button at all, and it is still exactly right: a reader who has chosen
   * one of the cheap measures must still get the week-by-week numbers when he
   * clicks a deal, and the page must not move him off the measure he chose to
   * give them to him. So the seed is the OTHER way round now: `trade.measure`
   * pinned to a typical week, which is the deliberate choice the default is no
   * longer.
   *
   * `weeksChosen` is the second half: the page left entirely alone, on the
   * weekly measure it now defaults to. The list is re-ranked week by week
   * behind the reader, and a pop-up opened while that is happening has to
   * survive it.
   */
  async unpriced(weeksChosen = false) {
    const seed = weeksChosen
      ? null
      : { 'ff.prefs': JSON.stringify({ 'trade.measure': 'typical' }) };
    const { document, errors, fetchCalls } = await boot('trade.html', '', seed);
    const before = {
      deal: readDeal(document),
      trades: readTrades(document),
      measure: document.getElementById('measureSelect').value,
    };
    const row = document.querySelector('#tradeTable tbody tr');
    const title = row ? text(row.querySelector('.mgr')) : '';
    if (row) row.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    const immediately = readDeal(document);
    await settle(weeksChosen ? 12000 : 1500);
    const deal = readDeal(document);
    const trades = readTrades(document);
    document.getElementById('dealClose').dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(300);
    return {
      errors, fetchCalls, before, immediately, deal, title,
      closed: readDeal(document),
      afterTrades: trades,
      measure: document.getElementById('measureSelect').value,
      cost: readCost(document),
    };
  },

  unpricedWeeksChosen() { return SCENARIOS.unpriced(true); },

  /**
   * "OPEN IN CUSTOM TRADES" (Tim, 2026-09-30): a button by "Open in ESPN" that
   * ticks the deal's men in the custom builder, for both squads. Pressed on a
   * finder row, and again from inside the pop-up.
   */
  async cuLoad() {
    const { document, errors } = await boot();
    const $ = (id) => document.getElementById(id);
    const click = (el) => { if (el) el.dispatchEvent(new globalThis.Event('click', { bubbles: true })); };
    await settleGoal(document);

    const checkedNames = (id) => readCustomList(document, id).filter((r) => r.checked).map((r) => r.name);
    const rowOf = (i) => {
      const row = document.querySelectorAll('#tradeTable tbody tr')[i];
      if (!row) return null;
      return {
        partner: text(row.querySelector('.mgr')),
        send: text(row.querySelector('.pkg.send')),
        recv: text(row.querySelector('.pkg.recv')),
        button: row.querySelector('button[data-cu-load]'),
      };
    };

    const r0 = rowOf(0);
    click(r0 && r0.button);
    await settle(1500);
    const fromRow = {
      partner: r0 ? r0.partner : '',
      send: r0 ? r0.send : '',
      recv: r0 ? r0.recv : '',
      hadButton: !!(r0 && r0.button),
      buttonText: r0 && r0.button ? text(r0.button) : '',
      pickedB: text([...$('cuTeamB').querySelectorAll('option')].find((o) => o.selected) || null).replace(/ · wks? [\d, ]+$/, ''),
      ticksA: checkedNames('cuListA'),
      ticksB: checkedNames('cuListB'),
      dealOpen: !readDeal(document).hidden,
    };

    // From the pop-up: open the second row's deal, press the button inside it.
    const r1 = rowOf(1);
    click(document.querySelectorAll('#tradeTable tbody tr')[1]);
    await settle(1500);
    const popButton = document.querySelector('#dealBody button[data-cu-load]');
    const popHadButton = !!popButton;
    click(popButton);
    await settle(1500);
    const fromPop = {
      partner: r1 ? r1.partner : '',
      send: r1 ? r1.send : '',
      recv: r1 ? r1.recv : '',
      hadButton: popHadButton,
      pickedB: text([...$('cuTeamB').querySelectorAll('option')].find((o) => o.selected) || null).replace(/ · wks? [\d, ]+$/, ''),
      ticksA: checkedNames('cuListA'),
      ticksB: checkedNames('cuListB'),
      dealOpen: !readDeal(document).hidden,
    };
    return { errors, fromRow, fromPop };
  },

  /**
   * A remembered team that is not yours, on a live league that knows yours.
   *
   * Demo ids count from 1 as ESPN's do, so a squad picked while browsing the
   * sample survives the switch to live looking perfectly valid — and every ESPN
   * link then stages another manager's players against a screen that shows
   * your own roster.
   */
  async liveOtherTeam() {
    const seed = {
      'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
      'ff.prefs': JSON.stringify({ 'trade.source': 'live', 'trade.team': 2 }),
    };
    const { document, errors } = await boot('trade.html', '', seed);
    // WAIT FOR THE PAGE, don't read it 400ms after boot (2026-09-23). `ownLinks`
    // counts rows in the finder, and on a machine with every core taken the
    // finder had not painted yet — the assertion read 0 links off an empty table
    // and reported a missing feature. The page's own "I have finished" signal is
    // the only honest moment to count its rows.
    await settleGoal(document);
    // Read off the depth map's highlighted row, not the <select>: the harness's
    // select shim falls back to the FIRST option, which is team 1 either way.
    const nameOf = (id) =>
      text([...document.querySelectorAll('#teamSelect option')].find((o) => o.getAttribute('value') === String(id)));
    const mine = readDepth(document).rows.find((r) => r.me);
    const opened = mine ? (mine.team === nameOf(1) ? '1' : mine.team === nameOf(2) ? '2' : mine.team) : '';
    const ownLinks = document.querySelectorAll('#tradeTable a.espn-open').length;

    const sel = document.getElementById('teamSelect');
    sel.value = '2';
    fire(sel);
    await settle(1500);
    const cells = [...document.querySelectorAll('#tradeTable tbody tr')]
      // The ESPN cell by name: "Ask AI" is the last cell now.
      .map((tr) => text(tr.querySelector('td.espn') || tr.lastElementChild));

    // A hand-picked squad survives a change of week. The empty render while a
    // week loads used to null it, and the page then fell back to your own.
    const weekSel = document.getElementById('weekSelect');
    const otherWeek = [...weekSel.querySelectorAll('option')]
      .map((o) => o.getAttribute('value'))
      .find((v) => v !== weekSel.value);
    weekSel.value = otherWeek;
    fire(weekSel);
    await settle(1500);
    const afterWeek = readDepth(document).rows.find((r) => r.me);
    return {
      afterWeek: afterWeek ? afterWeek.team : null,
      otherName: nameOf(2),
      errors, opened, ownLinks,
      meRow: mine ? mine.team : null,
      names: [nameOf(1), nameOf(2)],
      saved: globalThis.localStorage.getItem('ff.prefs'),
      otherLinks: document.querySelectorAll('#tradeTable a.espn-open').length,
      otherRows: cells.length,
      cells,
    };
  },

  /**
   * A real league, stubbed: what the weekly measure COSTS, and what the ESPN
   * deep link says.
   *
   * The stub is four squads built so the two measures disagree on purpose —
   * see tr-stub-season.mjs. Everything here is re-derived from that fixture
   * rather than read back off the page.
   */
  async live() {
    const seed = {
      'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
      'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
    };
    const { document, errors } = await boot('trade.html', '', seed);
    const stub = await import('./tr-stub-season.mjs');

    // THE PAGE HAS ALREADY BOUGHT ITS WEEKS by the time `boot` returns (Tim,
    // 2026-09-19), so `before` is what a reader is handed having pressed
    // nothing at all — which is the point of the whole change.
    const before = {
      week: document.getElementById('weekSelect').value,
      badge: text(document.getElementById('modeBadge')),
      cost: readCost(document),
      trades: readTrades(document),
      requests: stub.calls.week.length,
      asked: stub.calls.week.slice(),
      measure: document.getElementById('measureSelect').value,
    };

    // THE CARD, BEFORE ANY DEAL IS CLICKED. That timing is the whole point.
    //
    // This is the one scenario where "the whole season" and "the weeks this
    // page prices" are genuinely different sets — the span is weeks 5-14 and
    // weeks 1-4 have results — so it is the only place the Act row can be
    // proved to have stopped being empty. On demo the two sets coincide and the
    // claim is vacuous.
    //
    // And it has to be read BEFORE the deal below is opened, because opening a
    // deal has always bought the played weeks for the pop-up's own reference
    // rows. A card read after that click would pass on the old code too — the
    // defect Tim reported is a card hovered in the finder, which is where
    // almost every card on this page is hovered.
    const liveCard = openCard(document, '#tradeTable .man[data-tip]');

    // -- (H) TWO CARDS OUT OF ONE OFFER, and they must answer differently.
    //
    // Tim, 2026-09-19: "if you are hovering over a player you currently own,
    // then bold all the week #s that that player is currently projected to
    // start for you ... If you're hovering over another user's player (that
    // you're trading for), then bold all the week #s that that player would
    // start for you IF the trade would be made."
    //
    // So one card is read off the YOU SEND column (a man on his own squad) and
    // one off YOU GET (a man he would be trading for). The parent re-solves
    // both lineups from the fixture and checks the weeks, which is the only
    // way to tell a with-trade answer from a plain one.
    const firstRow = document.querySelector('#tradeTable tbody tr');
    const markAndOpen = (sel, flag) => {
      const el = firstRow ? firstRow.querySelector(sel) : null;
      if (!el) return null;
      el.setAttribute('data-probe', flag);
      return openCard(document, `[data-probe="${flag}"]`);
    };
    const sendCard = markAndOpen('td.send .man[data-tip]', 'send');
    const getCard = markAndOpen('td.recv .man[data-tip]', 'get');
    const topOffer = readTrades(document)[0] || null;

    // The scalar measure, deliberately chosen. Nothing is fetched — every week
    // is in hand — so any difference is the measure and nothing else.
    const measureSel = document.getElementById('measureSelect');
    measureSel.value = 'typical';
    fire(measureSel);
    await settle(1500);
    const scalar = {
      trades: readTrades(document),
      requests: stub.calls.week.length,
    };
    measureSel.value = 'weeks';
    fire(measureSel);
    await settle(6000);

    // And the RE-READ, which is what the button does now.
    document
      .getElementById('loadWeeks')
      .dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settleGoal(document);

    const after = {
      cost: readCost(document),
      trades: readTrades(document),
      combo: readCombo(document),
      depth: readDepth(document),
      heads: [...document.querySelectorAll('#tradeTable thead th')].map(text),
      note: text(document.getElementById('tradeNote')),
      requests: stub.calls.week.length,
      asked: stub.calls.week.slice(),
      measure: document.getElementById('measureSelect').value,
    };

    // Drill into the offer with Cy, which survives both measures.
    const rows = [...document.querySelectorAll('#tradeTable tbody tr')];
    const idx = after.trades.findIndex((t) => t.partner === 'Cy');
    if (idx >= 0) rows[idx].dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(1500);
    const deal = readDeal(document);
    const dealLinkKeyed = !!document.querySelector('#dealBody a.espn-open[data-offer]');

    // CLICKING "Open in ESPN". A browser's window.open, faithfully: with
    // `noopener` in the features it opens the tab and hands back NULL, always.
    // Tim's report was this button doing nothing, and that rule is why — so a
    // stub that returned a tab regardless would pass the broken page.
    const { window } = globalThis;
    const opened = [];
    window.open = (u, target, features) => {
      const tab = { closed: false, opener: window, location: { href: u } };
      opened.push({ u, target, features: features || '', tab });
      return /noopener/.test(features || '') ? null : tab;
    };
    // Pop-up shut first. linkedom does not run capture listeners ahead of
    // bubbling ones, so with it open the outside-click handler would repaint
    // (and re-key every link) before the ESPN handler — an order no browser
    // uses. The pop-up's own link is checked separately above.
    const esc = new globalThis.Event('keydown', { bubbles: true });
    esc.key = 'Escape';
    document.dispatchEvent(esc);
    await settle(100);
    const startHref = window.location.href;
    const tableLink = document.querySelector('#tradeTable a.espn-open');
    const click = new globalThis.Event('click', { bubbles: true, cancelable: true });
    if (tableLink) tableLink.dispatchEvent(click);
    await settle(200);
    const espnClick = {
      had: !!tableLink,
      href: tableLink ? tableLink.getAttribute('href') : '',
      prevented: click.defaultPrevented,
      opens: opened.length,
      landed: opened[0] ? opened[0].tab.location.href : '',
      opener: opened[0] ? (opened[0].tab.opener === null ? null : 'still set') : 'none',
      pageMoved: window.location.href !== startHref,
      outcomeShown: !document.getElementById('espnOutcome').hidden,
      outcomeBad: (document.getElementById('espnOutcome').getAttribute('class') || '').includes('bad'),
      outcome: text(document.getElementById('espnOutcomeText')),
    };
    document.getElementById('espnOutcomeClose')
      .dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    espnClick.outcomeDismissed = !!document.getElementById('espnOutcome').hidden;

    return {
      errors, before, after, scalar, deal, dealLinkKeyed, espnClick, liveCard,
      sendCard, getCard, topOffer,
      openWeek: Number(document.getElementById('weekSelect').value),
      offer: idx >= 0 ? after.trades[idx] : null,
      rosters: { 1: stub.rosterIds(1), 2: stub.rosterIds(2), 3: stub.rosterIds(3) },
      // Every man the page drew anywhere, so the per-week arithmetic and the
      // D/ST rule can be checked against the fixture's own numbers rather than
      // against a hand-picked row.
      men: [
        ...after.trades.flatMap((t) => [...t.send, ...t.receive]),
        ...after.combo.rows.flatMap((t) => [...t.send, ...t.receive]),
        ...deal.men,
      ],
      // The scalar basis draws a different set of offers, and it is the one
      // that puts a quarterback on screen — which is what the D/ST rule is
      // checked AGAINST, since a rule that suppressed every tag would pass a
      // test that only looked at defences.
      menBefore: scalar.trades.flatMap((t) => [...t.send, ...t.receive]),
      // Weeks 5..14 — everything with NO result against it. Week 5 is also
      // the week the page opens on; weeks 1-4 are played and not in here.
      span: stub.WEEKS - stub.PLAYED_THROUGH,
      played: stub.PLAYED_THROUGH,
      // EVERY week the page reads: the priced span, the played weeks behind it
      // (for the card's whole-season run and its Act row) and the bracket in
      // front. Counted off the requests the stub actually saw rather than
      // derived from the fixture, because the number of bracket weeks is
      // `capture.playoffWeeks`'s answer and not this file's to assume — but it
      // is checked for exactly one request per DISTINCT week above, so a page
      // that read a week twice cannot hide inside it.
      weeksAll: new Set(before.asked).size,
      byeWeek: stub.BYE_WEEK,
    };
  },
};

/**
 * HOVER A WEEK, SEE THAT WEEK'S LINEUP — Tim's ask, on the stubbed real league.
 *
 * His words: "if you hover over a specific week, it shows the positions of each
 * proj for that week, before and after your trade, with the specific players
 * that are being traded color coded so you can see how the new player affected
 * your lineup for that specific week."
 *
 * The stub league is used rather than demo because every projection in it is
 * hand-known (see tr-stub-season.mjs), so the parent can re-derive the lineups
 * from the fixture and the engine alone — nothing read back off the page.
 *
 * Four routes in are exercised and they are four different claims: a HOVER on
 * the row, a TAP on the button (which is all a phone has), a FOCUS from the
 * keyboard, and Escape back out. Then the side toggle, then a plain mouse click
 * on another offer — which must still open that offer, exactly as before.
 */
SCENARIOS.weekPeek = async function weekPeek() {
  const seed = {
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
  };
  const { document, errors } = await boot('trade.html', '', seed);
  const stub = await import('./tr-stub-season.mjs');

  // Priced by the page itself (2026-09-19); pressing the button would only
  // re-read the same weeks. Long enough for the weekly re-rank behind the
  // first paint.
  await settleGoal(document);

  const trades = readTrades(document);
  const idx = trades.findIndex((t) => t.partner === 'Cy');
  // RE-QUERIED EVERY TIME, never held. `paint()` rewrites the finder's tbody,
  // so a row captured before a repaint is a detached element whose click
  // bubbles to nothing — which is a silent no-op rather than a failure, and
  // exactly how this scenario first passed while doing nothing at all.
  const openOffer = async (i) => {
    const rows = [...document.querySelectorAll('#tradeTable tbody tr')];
    if (rows[i]) rows[i].dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(1500);
  };
  await openOffer(idx);

  const fireOn = (el, type) => {
    if (el) el.dispatchEvent(new globalThis.Event(type, { bubbles: true }));
  };
  const key = (k) => {
    const ev = new globalThis.Event('keydown', { bubbles: true });
    ev.key = k;
    document.dispatchEvent(ev);
  };
  const weekRow = (w) => document.querySelector(`#dealBody table.weeks tr[data-wk="${w}"]`);
  const weekBtn = (w) => document.querySelector(`#dealBody .wk-peek[data-wk="${w}"]`);

  // The requests spent up to this point. NOTHING below may add to it: every
  // projection the breakdown reads was bought when the deal was opened.
  const requestsBefore = stub.calls.week.length;

  const deal = readDeal(document);
  const shut = readBreakdown(document);          // nothing hovered yet

  fireOn(weekRow(7), 'mouseover');               // -- a mouse resting on a row
  const hovered = readBreakdown(document);

  fireOn(weekBtn(9), 'click');                   // -- a thumb on the button
  const tapped = readBreakdown(document);

  fireOn(weekBtn(11), 'focusin');                // -- the keyboard
  const focused = readBreakdown(document);

  key('Escape');                                 // -- Escape shuts the breakdown
  const afterEscape = {
    breakdown: readBreakdown(document),
    dealStillOpen: !document.getElementById('dealModal').hidden,
  };
  key('Escape');                                 // -- and then the pop-up itself
  const afterSecondEscape = { dealOpen: !document.getElementById('dealModal').hidden };

  // Re-open, hover a week, and flip to the other manager's lineup.
  await openOffer(idx);
  fireOn(weekRow(7), 'mouseover');
  const mineSide = readBreakdown(document);
  fireOn(document.querySelector('#dealWeek [data-side="theirs"]'), 'click');
  const theirSide = readBreakdown(document);
  fireOn(document.querySelector('#dealWeek [data-side="mine"]'), 'click');
  const backToMine = readBreakdown(document);

  // A PLAYED week (above the heavy line) and a PLAYOFF week (below it) both
  // open too, and each says it is in no total.
  fireOn(weekRow(2), 'mouseover');
  const playedWeek = readBreakdown(document);
  const poWeek = deal.weeks && deal.weeks.playoff.length ? deal.weeks.playoff[0].week : null;
  fireOn(poWeek ? weekRow(poWeek) : null, 'mouseover');
  const playoff = poWeek ? readBreakdown(document) : null;

  const requestsAfter = stub.calls.week.length;

  // A PLAIN MOUSE CLICK ON ANOTHER OFFER still opens that offer — the whole of
  // "a mouse click behaves as before".
  // Another manager's deal if the finder keeps one, else another Cy deal: since
  // the net gain (2026-09-30) the stub's Bo deals can all fall away, since Ana
  // plays Bo nearly every week and whatever helps him costs her then.
  let other = trades.findIndex((t) => t.partner !== 'Cy');
  if (other < 0) other = trades.findIndex((t, i) => i !== idx);
  await openOffer(other);
  const afterOtherClick = {
    title: text(document.getElementById('dealTitle')),
    partner: other >= 0 ? trades[other].partner : '',
    breakdown: readBreakdown(document),
    weeks: readWeekTable(document.getElementById('dealBody')),
  };

  return {
    errors, deal, shut, hovered, tapped, focused,
    afterEscape, afterSecondEscape,
    mineSide, theirSide, backToMine, playedWeek, playoff, poWeek,
    afterOtherClick,
    requestsBefore, requestsAfter,
    offer: idx >= 0 ? trades[idx] : null,
    partnerName: 'Cy',
    // What the parent needs to re-derive the same lineups from the fixture.
    baseWeek: Number(document.getElementById('weekSelect').value),
    myTeamId: 1,
    partnerId: 3,
    weeks: stub.WEEKS,
    playedThrough: stub.PLAYED_THROUGH,
  };
};

/**
 * THE WEEK PEEK ON A PHONE (trade plan Phase 5, V12). Below 900px there is no
 * side to put the week's detail on, and under the whole week table it landed
 * ~1,500px below the row a thumb had just tapped. It must sit in a row of its
 * own straight after the open week's row, and follow the week when another is
 * tapped. Same stub league and offer as `weekPeek`; only the window differs.
 */
SCENARIOS.weekPeekNarrow = async function weekPeekNarrow() {
  const seed = {
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
  };
  const { document, errors } = await boot('trade.html', '', seed, { wide: false });
  await settleGoal(document);
  const trades = readTrades(document);
  const idx = trades.findIndex((t) => t.partner === 'Cy');
  const rows = [...document.querySelectorAll('#tradeTable tbody tr')];
  if (rows[idx]) rows[idx].dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settle(1500);
  const fireOn = (el, type) => { if (el) el.dispatchEvent(new globalThis.Event(type, { bubbles: true })); };
  const weekBtn = (w) => document.querySelector(`#dealBody .wk-peek[data-wk="${w}"]`);

  const deal = readDeal(document);
  const opened = readBreakdown(document);
  fireOn(weekBtn(9), 'click');                   // a thumb on week 9
  const tapped = readBreakdown(document);
  fireOn(weekBtn(12), 'click');                  // and then on week 12
  const retapped = readBreakdown(document);
  // The week table must still read as the same weeks with the detail inside it.
  const weeksAfter = readWeekTable(document.getElementById('dealBody'));
  return { errors, found: idx >= 0, deal, opened, tapped, retapped, weeksAfter };
};

/**
 * The bye rule on the Trade page (2026-09-16): a 0.00 is a bye only in his NFL
 * team's bye week. Same stub league, with TR_BYES saying where team 1's bye
 * really is; reads `Bills D/ST` (id 112, 0.00 in week 8) wherever he is drawn.
 */
SCENARIOS.liveByes = async function liveByes() {
  const seed = {
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
  };
  const { document, errors } = await boot('trade.html', '', seed);
  // Priced by the page itself since 2026-09-19; this waits for the re-rank
  // rather than pressing a button that would only read the same weeks again.
  await settleGoal(document);
  const rows = [...document.querySelectorAll('#tradeTable tbody tr')];
  const idx = readTrades(document).findIndex((t) => t.partner === 'Cy');
  if (idx >= 0) rows[idx].dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settle(1500);
  const men = [...document.querySelectorAll('.man')].map(readMan);
  const bills = men.find((m) => m.id === 112) || null;
  const probe = [...document.querySelectorAll('.man')].find((m) => {
    const a = m.querySelector('a.pref');
    return a && /player=112$/.test(a.getAttribute('href'));
  });
  if (probe) probe.setAttribute('data-probe', '1');
  const card = probe ? openCard(document, '.man[data-probe="1"]') : null;
  return { errors, bills, card };
};

/**
 * A MAN ON BYE IN A WEEK YOU PLAY THE PARTNER (Tim, 2026-09-29): "highlight a
 * player's name if they have a BYE the week that the users play against each
 * other … me giving the player away … green … me recieving … yellow."
 *
 * The stub league with `TR_PRO_SPLIT` (each squad its own NFL team), `TR_MEET`
 * (weeks Ana plays Cy) and `TR_BYES`. Reads every place a deal names a man —
 * the finder, the combo, the pop-up, the custom box's two lists and a saved
 * custom row — with the VISIBLE text and the sr-only text read apart (Traps).
 */
function readByeMarks(root) {
  if (!root) return [];
  const visible = (el) => {
    const c = el.cloneNode(true);
    for (const s of [...c.querySelectorAll('.sr-only')]) s.remove();
    return text(c);
  };
  return [...root.querySelectorAll('.man, .cu-man[data-man]')].map((m) => {
    const a = m.querySelector('a.pref');
    const hl = m.querySelector('.bye-hl');
    const td = m.closest ? m.closest('td') : null;
    const tr = m.closest ? m.closest('tr') : null;
    return {
      partner: tr ? text(tr.querySelector('td.name')) : '',
      id: a ? idOfHref(a.getAttribute('href')) : Number(m.getAttribute('data-man')),
      cell: td ? ((td.getAttribute('class') || '').match(/\b(send|recv)\b/) || [''])[0] : '',
      side: m.getAttribute('data-side') || '',
      cls: hl ? (hl.getAttribute('class') || '') : '',
      title: hl ? (hl.getAttribute('title') || '') : '',
      hlText: hl ? visible(hl) : '',
      // The injury underline (2026-09-29): its class and its own tooltip.
      injCls: m.querySelector('.inj') ? (m.querySelector('.inj').getAttribute('class') || '') : '',
      injTitle: m.querySelector('.inj') ? (m.querySelector('.inj').getAttribute('title') || '') : '',
      // The preseason arrow (2026-09-29): its direction, tooltip, glyph as seen,
      // and whether it sits inside the positioned `.trend` (sr-only escapes
      // otherwise — Traps).
      trend: m.querySelector('.trend')
        ? ((m.querySelector('.trend').getAttribute('class') || '').match(/\btrend-(up|down)\b/) || ['', '?'])[1]
        : '',
      trendTitle: m.querySelector('.trend') ? (m.querySelector('.trend').getAttribute('title') || '') : '',
      trendSeen: m.querySelector('.trend') ? visible(m.querySelector('.trend')) : '',
      trendSr: m.querySelector('.trend .sr-only') ? text(m.querySelector('.trend .sr-only')) : '',
      sr: [...m.querySelectorAll('.sr-only')].map(text).join(' '),
      visible: visible(m),
    };
  });
}

SCENARIOS.byeMark = async function byeMark() {
  const seed = {
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
  };
  const { document, errors } = await boot('trade.html', '', seed);
  const $ = (id) => document.getElementById(id);
  const click = (el) => el.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settleGoal(document);
  const trs = [...document.querySelectorAll('#tradeTable tbody tr')];
  const finder = trs.map((tr) => ({ partner: text(tr.querySelector('td.name')), men: readByeMarks(tr) }));
  const combo = readByeMarks($('comboBody'));
  const finderKey = text($('tradeByeKey'));
  const note = text($('tradeNote'));
  // The pop-up, on the first Cy deal — or, with TR_DEAL_WITH, the first deal
  // naming that man (the preseason-arrow run opens one that carries an arrow).
  const dealWith = Number(process.env.TR_DEAL_WITH) || null;
  const idx = dealWith
    ? finder.findIndex((r) => r.men.some((m) => m.id === dealWith))
    : finder.findIndex((r) => /^Cy\b/.test(r.partner));
  let deal = [];
  let dealKey = '';
  if (idx >= 0) {
    click(trs[idx]);
    await settle(1500);
    deal = [...document.querySelectorAll('#dealBody .deal-side')].map((s) => ({
      head: text(s.querySelector('h3')), men: readByeMarks(s),
    }));
    dealKey = text(document.querySelector('#dealBody .bye-key'));
    const shut = document.querySelector('#dealClose, [data-close]');
    if (shut) click(shut);
  }
  // The custom box with Bo first (whom Ana plays nearly every week), then Cy.
  // Since the net gain (2026-09-30) the finder may offer no Bo deal at all —
  // every deal that helps Bo costs Ana in the nine weeks she plays him — so the
  // multi-week tooltip is read here, where it does not depend on the finder.
  const boOpt = [...$('cuTeamB').options].find((o) => /^Bo\b/.test(o.textContent.trim()));
  let listABo = [];
  let cuKeyBo = '';
  if (boOpt) {
    $('cuTeamB').value = boOpt.value;
    fire($('cuTeamB'), 'change');
    await settle(500);
    listABo = readByeMarks($('cuListA'));
    cuKeyBo = text($('cuByeKey'));
  }
  // The custom box, with Cy as the partner and nothing ticked yet.
  $('cuTeamB').value = '3';
  fire($('cuTeamB'), 'change');
  await settle(500);
  const listA = readByeMarks($('cuListA'));
  const listB = readByeMarks($('cuListB'));
  const cuKey = text($('cuByeKey'));
  // Tick one a side and save it: the saved row names them too.
  const tick = (sel) => {
    const box = document.querySelector(sel);
    if (!box) return false;
    box.checked = true;
    fire(box, 'change');
    return true;
  };
  tick('#cuListA input[type="checkbox"]');
  tick('#cuListB input[type="checkbox"]');
  await settle(1000);
  click($('cuSave'));
  await settle(1500);
  const saved = readByeMarks($('cuTable'));
  return { errors, finder, combo, finderKey, note, deal, dealKey, listA, listB, cuKey, saved, listABo, cuKeyBo };
};

/**
 * WHEN TO ACCEPT (Tim, 2026-09-30: "calculate when that official date and time
 * is for when the trade needs to be ACCEPTED (not just sent)"). Stubbed real
 * league (or demo with TR_ACCEPT_DEMO): opens the first Cy deal's pop-up (demo:
 * the first row) and reads its accept line, then the custom box's "Accept by"
 * with Cy picked, before and after ticking one of his men.
 */
SCENARIOS.acceptBy = async function acceptByScenario() {
  const demo = !!process.env.TR_ACCEPT_DEMO;
  const seed = demo ? null : {
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
  };
  const { document, errors } = await boot('trade.html', '', seed);
  const $ = (id) => document.getElementById(id);
  const click = (el) => el.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settleGoal(document);
  const trs = [...document.querySelectorAll('#tradeTable tbody tr')];
  const idx = demo ? 0 : trs.findIndex((tr) => /^Cy\b/.test(text(tr.querySelector('td.name'))));
  let deal = null;
  if (idx >= 0 && trs[idx]) {
    click(trs[idx]);
    await settle(1500);
    const line = document.querySelector('#dealBody .deal-accept');
    const espnAt = [...document.querySelectorAll('#dealBody > *')].findIndex((el) => el.querySelector && el.querySelector('a.espn-open, .espn-off'));
    const lineAt = [...document.querySelectorAll('#dealBody > *')].indexOf(line);
    deal = {
      open: !$('dealModal').hidden,
      get: text(document.querySelector('#dealBody .deal-side:nth-child(2)')) ||
        [...document.querySelectorAll('#dealBody .deal-side')].map(text).join(' | '),
      line: line ? text(line) : null,
      title: line ? line.getAttribute('title') : null,
      beforeEspn: line ? lineAt >= 0 && espnAt === lineAt + 1 : null,
    };
    const shut = document.querySelector('#dealClose, [data-close]');
    if (shut) click(shut);
  }
  const box = () => ({ hidden: !!$('cuAcceptBox').hidden, text: text($('cuAccept')), title: $('cuAccept').getAttribute('title') });
  if (!demo) {
    $('cuTeamB').value = '3';
    fire($('cuTeamB'), 'change');
    await settle(500);
  }
  const before = box();
  const tickB = document.querySelector('#cuListB input[type="checkbox"]');
  if (tickB) { tickB.checked = true; fire(tickB, 'change'); }
  await settle(1000);
  const after = box();
  return { errors, deal, before, after, ticked: !!tickB, deadlineLine: text($('deadlineLine')) };
};

/**
 * ONE WEEK FOR BOTH SLOT-BY-SLOT PANELS (Tim, 2026-09-29: "it shows different
 * numbers in different places for the same player ... need to be consistient
 * and accurate in every place"). The halves of the custom box used to keep a
 * week each and a hover moved only its own; the pointer drifting down to read
 * a panel re-picked the week on the way. Reads the two titles and every man's
 * figure in both panels, both tabs, and the pop-up, against the stub's own
 * week projections (checked in the parent).
 */
SCENARIOS.slotWeek = async function slotWeek() {
  const seed = {
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
  };
  const { document, errors } = await boot('trade.html', '', seed);
  const $ = (id) => document.getElementById(id);
  const on = (el, type, rel) => {
    if (!el) return false;
    const ev = new globalThis.Event(type, { bubbles: true });
    if (rel !== undefined) { try { Object.defineProperty(ev, 'relatedTarget', { value: rel }); } catch { /* */ } }
    el.dispatchEvent(ev);
    return true;
  };
  await settleGoal(document);
  const title = (id) => text(document.querySelector(`#${id} .wkx-title`));
  const weekOf = (t) => { const m = /^Week (\d+)/.exec(t || ''); return m ? Number(m[1]) : null; };
  const figures = (id) => {
    const host = $(id);
    if (!host) return [];
    const w = weekOf(title(id));
    return [...host.querySelectorAll('td.wkx-cell')].map((td) => {
      const a = td.querySelector('a.pref');
      const v = td.querySelector('.wkx-v');
      return a && v ? { panel: id, week: w, id: idOfHref(a.getAttribute('href')), v: text(v) } : null;
    }).filter(Boolean);
  };
  // Both tabs of one panel: its own side first, then the other, then back.
  const bothTabs = (id) => {
    const out = [];
    const host = $(id);
    if (!host) return out;
    const start = host.querySelector('[data-side][aria-pressed="true"]');
    const startSide = start ? start.getAttribute('data-side') : 'mine';
    for (const s of ['mine', 'theirs']) {
      on($(id).querySelector(`[data-side="${s}"]`), 'click');
      out.push(...figures(id).map((f) => ({ ...f, side: s })));
    }
    on($(id).querySelector(`[data-side="${startSide}"]`), 'click');
    return out;
  };

  $('cuTeamB').value = '3';
  on($('cuTeamB'), 'change');
  await settle(500);
  const pick = (id) => {
    const b = [...$(id).querySelectorAll('input[type="checkbox"]')];
    const box = b.length > 1 ? b[1] : b[0];
    if (box) { box.checked = true; on(box, 'change'); }
  };
  pick('cuListA');
  pick('cuListB');
  await settle(1500);

  const atOpen = { mine: title('cuWeek'), his: title('cuWeekB') };
  const peekBtn = (host, w) => document.querySelector(`#${host} .wk-peek[data-wk="${w}"]`);
  const weeksIn = (host) => [...document.querySelectorAll(`#${host} .wk-peek`)]
    .map((b) => Number(b.getAttribute('data-wk')));
  const avail = weeksIn('cuInline').filter((w) => w > 4 && w <= 14);
  const openW = weekOf(atOpen.mine);
  const other = avail.find((w) => w !== openW && w !== weekOf(atOpen.his)) ?? null;

  // A hover in YOUR table moves HIS panel too.
  on(peekBtn('cuInline', other), 'mouseover');
  const crossHover = { week: other, mine: title('cuWeek'), his: title('cuWeekB') };

  // Click W (pin), drift over a later row, leave the table: back to W.
  const W = avail.find((w) => w !== other) ?? null;
  const later = avail.filter((w) => w > W).slice(-1)[0] ?? null;
  on(peekBtn('cuInline', W), 'click');
  const pinned = { mine: title('cuWeek'), his: title('cuWeekB') };
  on(peekBtn('cuInline', later), 'mouseover');
  const drifting = { mine: title('cuWeek'), his: title('cuWeekB') };
  on(document.querySelector('#cuInline table.weeks'), 'mouseout', $('cuTeamB'));
  const leftTable = { W, later, mine: title('cuWeek'), his: title('cuWeekB') };
  // A hover in HIS table moves yours, and leaving his returns both.
  on(peekBtn('cuInlineB', later), 'mouseover');
  const crossBack = { mine: title('cuWeek'), his: title('cuWeekB') };
  on(document.querySelector('#cuInlineB table.weeks'), 'mouseout', $('cuTeamB'));
  const leftB = { mine: title('cuWeek'), his: title('cuWeekB') };

  // Every figure in both panels, both tabs, at the pinned week and at another.
  const guard = [...bothTabs('cuWeek'), ...bothTabs('cuWeekB')];
  on(peekBtn('cuInline', later), 'click');
  guard.push(...bothTabs('cuWeek'), ...bothTabs('cuWeekB'));

  // A played week says so, in the custom box if it shows one, and in the pop-up.
  const playedBtn = document.querySelector('#cuInline .wk-peek[data-wk="2"]');
  let playedCu = null;
  if (playedBtn) { on(playedBtn, 'click'); playedCu = title('cuWeek'); }

  on($('cuOpen'), 'click');
  await settle(1500);
  const popup = { open: !$('dealModal').hidden };
  for (const w of [W, later]) {
    on(document.querySelector(`#dealBody .wk-peek[data-wk="${w}"]`), 'click');
    guard.push(...bothTabs('dealWeek'));
  }
  // The pop-up's own week: pinned by a click, a drift, then leaving its table.
  on(document.querySelector(`#dealBody .wk-peek[data-wk="${W}"]`), 'click');
  on(document.querySelector(`#dealBody .wk-peek[data-wk="${later}"]`), 'mouseover');
  popup.drift = title('dealWeek');
  on(document.querySelector('#dealBody table.weeks'), 'mouseout', $('dealClose'));
  popup.left = title('dealWeek');
  on(document.querySelector('#dealBody .wk-peek[data-wk="2"]'), 'click');
  popup.played = title('dealWeek');
  on(document.querySelector('#dealBody .wk-peek[data-wk="7"]'), 'click');
  popup.unplayed = title('dealWeek');
  popup.avgKey = text(document.querySelector('#dealBody .avg-key'));
  const avgKeys = { finder: text($('tradeAvgKey')), custom: text($('cuAvgKey')) };

  return {
    errors, atOpen, crossHover, pinned, drifting, leftTable, crossBack, leftB,
    playedCu, popup, guard, avgKeys, span: avail,
  };
};

/**
 * WHICH WEEK A LIVE LEAGUE OPENS ON, and so whose rosters the finder reads.
 *
 * Tim's complaint (2026-09-17): the page opened on the last PLAYED week all
 * week, so his own pickups were missing and men he had dropped were still being
 * offered. Run with TR_PICKUP set, the stub has Ana drop `Ana WR4` (111) and
 * pick up `Ana WR Pickup` (150) for week 5 — the first week with no result.
 *
 * TR_SAVED_WEEK seeds a week remembered from an earlier visit. A played one
 * (2) must be ignored; an unplayed one (7) must be honoured. After reading,
 * the reader picks week 3 by hand and the league is re-entered: a week picked
 * THIS visit stays picked, past or not.
 */
SCENARIOS.livePickup = async function livePickup() {
  const prefsSeed = { 'trade.source': 'live' };
  if (process.env.TR_SAVED_WEEK) prefsSeed['trade.week'] = Number(process.env.TR_SAVED_WEEK);
  const seed = {
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify(prefsSeed),
  };
  const { document, errors } = await boot('trade.html', '', seed);
  const stub = await import('./tr-stub-season.mjs');
  // The page buys its weeks and re-ranks behind the first paint (2026-09-19),
  // so the table read here has to be the settled one — a list caught mid-rerank
  // would make this scenario intermittent rather than wrong.
  await settleGoal(document);
  const trades = readTrades(document);
  // Every man the page names ANYWHERE, by ESPN id: depth map, spare strip,
  // finder, combo. A dropped man must be on none of them.
  const everyId = () => [...document.querySelectorAll('a.pref')]
    .map((a) => idOfHref(a.getAttribute('href')));
  const opened = {
    week: document.getElementById('weekSelect').value,
    asked: stub.calls.week.slice(),
    sent: trades.flatMap((t) => t.send.map((m) => m.id)),
    sentNames: trades.flatMap((t) => t.send.map((m) => m.text)),
    ids: everyId(),
    status: text(document.getElementById('sourceStatus')),
  };

  // Picked by hand this visit, then the league re-entered.
  const sel = document.getElementById('weekSelect');
  sel.value = '3';
  fire(sel);
  await settle(800);
  document.querySelector('#sourceToggle button[data-src="live"]')
    .dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settle(1500);
  const repicked = {
    week: document.getElementById('weekSelect').value,
    status: text(document.getElementById('sourceStatus')),
  };
  return { errors, opened, repicked, pickup: stub.PICKUP, played: stub.PLAYED_THROUGH };
};

/**
 * THE GOAL — "Win it all", the default (Tim, 2026-09-21).
 *
 * Demo, nothing pressed: the page opens on the title goal, prices the playoff
 * weeks, plays every offer out in the season simulation and ranks by the
 * expected change in the title chance. Then the reader flips to "Don't finish
 * last" and the span, the heading and the order all follow.
 *
 * The parent re-derives the top row's chance from the demo generator and the
 * engine alone — nothing of the page's in it — so a page that simulated a
 * different season from the one it claims cannot pass.
 */
SCENARIOS.goalTitle = async function goalTitle() {
  const { document, errors, fetchCalls } = await boot();
  // The page finishing, not a fixed 20s (PROGRESS trap): it searches twice and
  // plays every offer through the simulation, which takes as long as it takes.
  await settleGoal(document);
  const read = () => ({
    trades: readTrades(document),
    heads: [...document.querySelectorAll('#tradeTable thead th')].map(text),
    count: text(document.getElementById('tradeCount')),
    note: text(document.getElementById('tradeNote')),
    // THE PANEL'S OWN WORDS. Both were claims about what the search does, and
    // both had stopped being true (2026-09-23) — read here so the assertion is
    // about what a reader is told rather than about a class name.
    finderTitle: text(document.getElementById('finderTitle')),
    lede: text(document.querySelector('#finderTitle ~ .lede')),
    goalOn: text(document.querySelector('#goalToggle button.on')),
    week: document.getElementById('weekSelect').value,
    team: document.getElementById('teamSelect').value,
    teams: [...document.querySelectorAll('#teamSelect option')]
      .map((o) => ({ id: o.getAttribute('value'), name: text(o) })),
  });
  const title = read();

  // The top row's pop-up: under this goal the bracket weeks are IN the priced
  // table, so there is no "for reference" section after it.
  const row = document.querySelector('#tradeTable tbody tr');
  if (row) row.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settle(3000);
  const deal = readDeal(document);
  const dealGoal = text(document.querySelector('#dealBody .deal-goal'));
  document.getElementById('dealClose').dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settle(300);

  // A CUSTOM deal: one man ticked each side, then saved.
  const tick = (sel) => {
    const box = document.querySelector(sel);
    if (!box) return false;
    box.checked = true;
    box.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
    return true;
  };
  const ticked = tick('#cuListA input[type="checkbox"]') && tick('#cuListB input[type="checkbox"]');
  await settle(1500);
  const cuPreview = text(document.getElementById('cuPreview'));
  document.getElementById('cuSave').dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settle(1500);
  const cuRow = readOfferRows(document.getElementById('cuTable'))[0] || null;
  const cuHeads = [...document.querySelectorAll('#cuTable thead th')].map(text);
  const comboHeads = [...document.querySelectorAll('#comboTable thead th')].map(text);
  const comboRows = readOfferRows(document.getElementById('comboTable'));
  const comboGoal = text(document.querySelector('#comboBody .combo-goal'));

  document.querySelector('#goalToggle button[data-goal="last"]')
    .dispatchEvent(new globalThis.Event('click', { bubbles: true }));
  await settleGoal(document);
  const last = read();
  const stored = (() => {
    try { return JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}')['trade.goal']; } catch { return null; }
  })();
  return {
    errors, fetchCalls, title, deal, dealGoal, ticked, cuPreview, cuRow, cuHeads,
    comboHeads, comboRows, comboGoal, last, stored,
  };
};

/**
 * HIS HALF OF THE CUSTOM BOX, UNDER "WIN IT ALL" (2026-09-29). His week table
 * counts a bracket week by the chance he is still playing in it (the same
 * weights `hisSideOf` gives "He gains"), and a week he plays you is marked in
 * BOTH halves. The partner is chosen as the first one you still meet, so the
 * meeting-week check is never vacuous.
 */
SCENARIOS.customHalves = async function customHalves() {
  const { document, window, errors } = await boot();
  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  await settleGoal(document);
  const boxes = (id) => [...$(id).querySelectorAll('input[type="checkbox"]')];
  // Not the quarterbacks (row 0): a QB-for-QB deal prices at nearly nothing.
  const pick = (id) => { const b = boxes(id); return b.length > 1 ? b[1] : b[0]; };
  const vsWeeks = (id) => ($(id)
    ? [...$(id).querySelectorAll('tr[data-wk] .vs-note')].map((n) => n.closest('tr').getAttribute('data-wk'))
    : []);
  const options = [...$('cuTeamB').querySelectorAll('option')].map((o) => o.value);
  let tried = 0;
  for (const v of options) {
    tried += 1;
    $('cuTeamB').value = v;
    fire($('cuTeamB'), 'change');
    const a = pick('cuListA'); a.checked = true; fire(a, 'change');
    const b = pick('cuListB'); b.checked = true; fire(b, 'change');
    if (vsWeeks('cuInline').length) break;
  }
  await settle(500);
  const B = $('cuInlineB');
  return {
    errors, tried,
    vsA: vsWeeks('cuInline'),
    vsB: vsWeeks('cuInlineB'),
    vsTextB: B ? [...B.querySelectorAll('tr[data-wk] .vs-note')].map(text) : [],
    weeksA: $('cuInline') ? readWeekTable($('cuInline')) : null,
    weeksB: B ? readWeekTable(B) : null,
    titleB: text(B && B.querySelector('.cu-inline-title')),
    // The builder's own "You gain" total, the "+11.0 over weeks …" line.
    cuGainA: text($('cuGainA') && $('cuGainA').querySelector('.cu-sub')),
  };
};

/**
 * THE TWO SEASON BOXES UNDER THE BUILDER (Tim, 2026-09-30: "have 2 different
 * boxes of the season by week box … One is an exact copy of the current season
 * by week box, and the other is a 'after the trade' season by week box. Also
 * make two buttons above these boxes: one of each user's name").
 */
SCENARIOS.customSeason = async function customSeason() {
  const { document, window, errors } = await boot();
  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  await settleGoal(document);
  const sec = () => $('cuSeason');
  const before = { present: !!sec(), hidden: sec() ? !!sec().hidden : null, html: sec() ? sec().innerHTML : '' };
  const boxes = (id) => [...$(id).querySelectorAll('input[type="checkbox"]')];
  const pick = (id) => { const b = boxes(id); return b.length > 1 ? b[1] : b[0]; };
  const vsWeeks = () => [...$('cuInline').querySelectorAll('tr[data-wk] .vs-note')]
    .map((n) => Number(n.closest('tr').getAttribute('data-wk')));
  const options = [...$('cuTeamB').querySelectorAll('option')].map((o) => o.value);
  let tried = 0;
  for (const v of options) {
    tried += 1;
    $('cuTeamB').value = v;
    fire($('cuTeamB'), 'change');
    const a = pick('cuListA'); a.checked = true; fire(a, 'change');
    const b = pick('cuListB'); b.checked = true; fire(b, 'change');
    if (vsWeeks().length) break;
  }
  await settle(500);
  // Every week row of a week table (played, priced, playoff): its two lineups
  // and the Difference column (his own change in HIS table).
  const weekRows = (id) => {
    const t = $(id) && $(id).querySelector('table.weeks');
    if (!t) return [];
    return [...t.querySelectorAll('tbody tr[data-wk]')]
      .filter((tr) => tr.closest('table') === t)
      .map((tr) => {
        const tds = [...tr.children];
        // A meeting week in YOUR table prints yours minus his, with your own
        // change in `.net-sub` ("you +1.6"): that one is the squad's change.
        const sub = tds[3].querySelector('.net-sub');
        return {
          week: Number(tr.getAttribute('data-wk')),
          past: /\bpast\b/.test(tr.getAttribute('class') || ''),
          before: num(text(tds[1])), after: num(text(tds[2])),
          delta: sub ? num(text(sub).replace(/^you\s*/, '')) : num(text(tds[3])),
        };
      });
  };
  const box = (which) => {
    const t = sec() && sec().querySelector(`table.sbw-table[data-box="${which}"]`);
    if (!t) return null;
    const heads = [...t.querySelectorAll('thead th.wk')].map((th) => ({
      week: parseInt(text(th), 10),
      played: /\bplayed\b/.test(th.getAttribute('class') || ''),
      vs: /↑/.test(th.textContent),
    }));
    const band = [...t.querySelectorAll('tbody.split td.wk')].map((td) => ({
      week: Number(td.getAttribute('data-wk')), v: num(text(td)),
    }));
    const opp = [...t.querySelectorAll('tbody.sbw-opp td.wk')].map((td, i) => ({
      week: heads[i] ? heads[i].week : null, text: text(td),
      v: td.getAttribute('data-v') === null ? null : Number(td.getAttribute('data-v')),
      cls: td.getAttribute('class') || '',
    }));
    const oppLabel = text(t.querySelector('tbody.sbw-opp td.name'));
    // Every week cell in a played column, slot rows and band alike.
    const playedIdx = new Set(heads.map((h, i) => (h.played ? i : -1)).filter((i) => i >= 0));
    const playedHeat = [];
    const liveHeat = [];
    for (const tr of t.querySelectorAll('tbody tr')) {
      [...tr.querySelectorAll('td.wk')].forEach((td, i) => {
        const c = td.getAttribute('class') || '';
        if (playedIdx.has(i)) { if (/\bheat\b/.test(c)) playedHeat.push(c); }
        else if (/\bheat\b/.test(c)) liveHeat.push(c);
      });
    }
    return {
      heads, band, opp, oppLabel, playedHeat, liveHeat: liveHeat.length,
      slots: t.querySelectorAll('tbody:not(.split):not(.sbw-opp) tr').length,
      cards: t.querySelectorAll('[data-tip]').length,
    };
  };
  const view = () => ({
    buttons: sec() ? [...sec().querySelectorAll('button[data-sbw-side]')].map((b) => ({
      side: b.getAttribute('data-sbw-side'), text: text(b), on: b.getAttribute('aria-pressed') === 'true',
    })) : [],
    titles: sec() ? [...sec().querySelectorAll('h3')].map(text) : [],
    now: box('before'), after: box('after'),
  });
  const A = view();
  const nameB = text($('cuTeamB').querySelector('option[selected]') || $('cuTeamB').querySelector('option')).replace(/ · wks? [\d, ]+$/, '');
  const btnB = sec() && sec().querySelector('button[data-sbw-side="theirs"]');
  if (btnB) fire(btnB, 'click');
  const B = view();
  const btnA = sec() && sec().querySelector('button[data-sbw-side="mine"]');
  if (btnA) fire(btnA, 'click');
  const back = view();
  // TOTAL / DIFFERENCE on the after box (Tim, 2026-09-30): every cell, the
  // band and the Avg column included, read as {v (data-v), text, cls}.
  const grid = (which) => {
    const t = sec() && sec().querySelector(`table.sbw-table[data-box="${which}"]`);
    if (!t) return null;
    return [...t.querySelectorAll('tbody:not(.sbw-opp) tr')].map((tr) =>
      [...tr.querySelectorAll('td.avg, td.wk')].map((td) => ({
        v: td.getAttribute('data-v') === null ? null : Number(td.getAttribute('data-v')),
        text: text(td), cls: td.getAttribute('class') || '',
      })));
  };
  const viewBtns = () => (sec() ? [...sec().querySelectorAll('button[data-sbw-view]')].map((b) => ({
    view: b.getAttribute('data-sbw-view'), text: text(b), on: b.getAttribute('aria-pressed') === 'true',
  })) : []);
  const diffView = { buttonsAtFirst: viewBtns(), nowGrid: grid('before'), totalGrid: grid('after') };
  const dBtn = sec() && sec().querySelector('button[data-sbw-view="diff"]');
  if (dBtn) fire(dBtn, 'click');
  diffView.buttonsDiff = viewBtns();
  diffView.diffGrid = grid('after');
  diffView.nowAfterDiff = grid('before');
  diffView.diffAttr = !!(sec() && sec().querySelector('table.sbw-table[data-box="after"][data-view="diff"]'));
  // His side keeps the view.
  const bB = sec() && sec().querySelector('button[data-sbw-side="theirs"]');
  if (bB) fire(bB, 'click');
  diffView.hisNow = grid('before');
  diffView.hisDiff = grid('after');
  const bA = sec() && sec().querySelector('button[data-sbw-side="mine"]');
  if (bA) fire(bA, 'click');
  const tBtn = sec() && sec().querySelector('button[data-sbw-view="total"]');
  if (tBtn) fire(tBtn, 'click');
  diffView.totalAgain = grid('after');
  return {
    errors, tried, before, A, B, back, nameB, diffView,
    shown: { present: !!sec(), hidden: sec() ? !!sec().hidden : null },
    vs: vsWeeks(),
    weeksA: weekRows('cuInline'),
    weeksB: weekRows('cuInlineB'),
  };
};

// ---- THE ASSUMED TRADE (Tim, 2026-09-30) ------------------------------------

/** One season box's Starting lineup band, `{week, v, played}` per column. */
function sbwBand(host, which) {
  const t = host && host.querySelector(`table.sbw-table[data-box="${which}"]`);
  if (!t) return null;
  return [...t.querySelectorAll('tbody.split td.wk')].map((td) => ({
    week: Number(td.getAttribute('data-wk')),
    v: Number(td.getAttribute('data-v')),
    played: /\bplayed\b/.test(td.getAttribute('class') || ''),
  }));
}

/** What an assumed-trade scenario reads off the page, at any moment. */
function readAssumed(document) {
  const $ = (id) => document.getElementById(id);
  const ids = (id) => [...$(id).querySelectorAll('input[type="checkbox"]')].map((b) => String(b.value));
  const panel = $('assumedPanel');
  return {
    present: !!panel,
    hidden: panel ? !!panel.hidden : null,
    rows: panel ? readOfferRows($('assumedTable')) : [],
    heads: panel ? [...$('assumedTable').querySelectorAll('thead th')].map(text) : [],
    cuHeads: [...$('cuTable').querySelectorAll('thead th')].map(text),
    line: panel ? text($('assumedLine')) : '',
    note: $('assumeNote') ? { hidden: !!$('assumeNote').hidden, text: text($('assumeNote')) } : null,
    dropped: $('assumedDropped') ? { hidden: !!$('assumedDropped').hidden, text: text($('assumedDropped')) } : null,
    after: panel ? sbwBand($('assumedSeason'), 'after') : null,
    saved: document.querySelectorAll('#cuRows tr[data-cu]').length,
    assumeButtons: document.querySelectorAll('#cuRows button[data-assume]').length,
    listA: ids('cuListA'),
    listB: ids('cuListB'),
    teamB: $('cuTeamB').value,
    finder: readOfferRows($('tradeTable')).map((r) => ({
      partner: r.partner, send: r.send.map((m) => String(m.id)), receive: r.receive.map((m) => String(m.id)),
    })),
  };
}

SCENARIOS.assumeTrade = async function assumeTrade() {
  const { document, window, errors } = await boot();
  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  await settleGoal(document);
  const boxes = (id) => [...$(id).querySelectorAll('input[type="checkbox"]')];
  // A 1-for-1 with the first manager the builder offers: each side's second man.
  const partner = $('cuTeamB').value;
  const a = boxes('cuListA')[1]; a.checked = true; fire(a, 'change');
  const b = boxes('cuListB')[1]; b.checked = true; fire(b, 'change');
  const sent = String(a.value);
  const got = String(b.value);
  await settle(500);
  const sec = $('cuSeason');
  const pre = { mine: sbwBand(sec, 'after'), now: sbwBand(sec, 'before') };
  fire(sec.querySelector('button[data-sbw-side="theirs"]'), 'click');
  pre.his = sbwBand(sec, 'after');
  fire(sec.querySelector('button[data-sbw-side="mine"]'), 'click');
  fire($('cuSave'), 'click');
  fire($('cuClear'), 'click');
  await settle(300);
  const saved = readAssumed(document);
  const savedRow = readOfferRows($('cuTable'))[0] || null;

  // ASSUME it.
  const btn = document.querySelector('#cuRows button[data-assume]');
  if (btn) fire(btn, 'click');
  await settleGoal(document);
  // The builder back on the same partner, so its two lists are his and mine.
  $('cuTeamB').value = partner; fire($('cuTeamB'), 'change');
  await settle(300);
  const assumed = readAssumed(document);
  // ASK AI with a trade assumed: a finder row's text says so; the block's own does not.
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'test', clipboard: { writeText: (t) => { copied.push(String(t)); return Promise.resolve(); } } },
  });
  const askF = document.querySelector('#tradeTable button[data-ask-ai]');
  if (askF) fire(askF, 'click');
  const askB = document.querySelector('#assumedRows button[data-ask-ai]');
  if (askB) fire(askB, 'click');
  await settle(100);
  assumed.ask = { finder: copied[0] || null, block: copied[1] || null };
  const asm = $('assumedSeason');
  const hisBtn = asm && asm.querySelector('button[data-sbw-side="theirs"]');
  if (hisBtn) fire(hisBtn, 'click');
  assumed.hisAfter = sbwBand(asm, 'after');
  const myBtn = asm && asm.querySelector('button[data-sbw-side="mine"]');
  if (myBtn) fire(myBtn, 'click');

  // A FRESH custom trade on the assumed rosters: tick one of his men (not the
  // one you sent him). Its "before" box is your assumed squad's season.
  const his = boxes('cuListB').find((x) => String(x.value) !== sent);
  if (his) { his.checked = true; fire(his, 'change'); }
  await settle(500);
  const fresh = { now: sbwBand($('cuSeason'), 'before'), preview: text($('cuPreview')) };
  fire($('cuClear'), 'click');
  await settle(200);

  let prefs = null;
  try { prefs = JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}'); } catch { prefs = null; }

  // REMOVE it.
  const rm = document.querySelector('#assumedPanel button[data-unassume]');
  if (rm) fire(rm, 'click');
  await settleGoal(document);
  $('cuTeamB').value = partner; fire($('cuTeamB'), 'change');
  await settle(300);
  const removed = readAssumed(document);
  let prefsAfter = null;
  try { prefsAfter = JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}'); } catch { prefsAfter = null; }
  return {
    errors, partner, sent, got, pre, saved, savedRow, assumed, fresh, removed,
    prefs: prefs ? { assumed: prefs['trade.assumed'] || null, custom: prefs['trade.custom'] || null } : null,
    prefsAfter: prefsAfter ? { assumed: prefsAfter['trade.assumed'] ?? null, custom: prefsAfter['trade.custom'] || null } : null,
  };
};

/**
 * SUGGESTED (Tim, 2026-10-01): "when I select player(s) in custom trades with
 * another user … show all the potential additions as suggested trades (with
 * the players that are already selected) directly underneath the player
 * selection menu, and above the saved trades list … Always show at least 3".
 *
 * Demo. Ticks one of HIS men, then one of MINE, reading the list each time
 * (waiting on the list's own `data-rows`, never a fixed time); a fast double
 * tick (the stale case); a row click (the pop-up); "Open in custom trades";
 * Clear. Then saves and ASSUMES a deal and ticks one of his men again, so the
 * suggestions can be checked against the assumed rosters.
 */
SCENARIOS.customSuggest = async function customSuggest() {
  const { document, window, errors } = await boot();
  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el && el.dispatchEvent(new window.Event(type, { bubbles: true }));
  await settleGoal(document);
  const boxes = (id) => [...$(id).querySelectorAll('input[type="checkbox"]')];
  const ids = (id) => boxes(id).map((b) => String(b.value));
  const tick = (box, on = true) => { box.checked = on; fire(box, 'change'); };
  const host = () => $('cuSug');
  const read = () => {
    const h = host();
    if (!h) return { present: false };
    return {
      present: true,
      hidden: !!h.hidden,
      rowsAttr: h.getAttribute('data-rows'),
      ms: h.hasAttribute('data-ms') ? Number(h.getAttribute('data-ms')) : null,
      wait: $('cuSugWait') ? !$('cuSugWait').hidden : null,
      heads: [...h.querySelectorAll('thead th')].map(text),
      rows: readOfferRows($('cuSugTable')).map((r) => ({
        partner: r.partner, send: r.send.map((m) => String(m.id)), receive: r.receive.map((m) => String(m.id)),
        myGain: r.myGain, theirGain: r.theirGain, gainText: r.gainText, goal: r.goal && r.goal.head,
        alt: r.alt && r.alt.head,
      })),
      buttons: [...h.querySelectorAll('tbody tr')].map((tr) => ({
        load: !!tr.querySelector('button[data-cu-load]'),
        ask: !!tr.querySelector('button[data-ask-ai]'),
        open: !!tr.querySelector('button.wk-open'),
      })),
    };
  };
  const max = scaledBudget(30000, machineFactor());
  const waitList = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < max) {
      const h = host();
      if (!h || h.hidden || h.getAttribute('data-rows')) break;
      await settle(50);
    }
    await settle(50);
    return read();
  };
  // In document order: the builder, then this list, then the saved table.
  const order = (() => {
    const all = [...document.querySelectorAll('#customPanel *')];
    const at = (el) => (el ? all.indexOf(el) : -1);
    return { build: at(document.querySelector('#customPanel .cu-build')), sug: at(host()), saved: at($('cuWrap')) };
  })();

  const partner = $('cuTeamB').value;
  const partnerName = text($('cuTeamB').querySelector('option[selected]') || $('cuTeamB').querySelector('option')).split(' · ')[0];
  const before = read();
  const his = boxes('cuListB')[1];
  const hisId = String(his.value);
  tick(his);
  const rightAfter = read();
  const one = await waitList();
  const mineBox = boxes('cuListA')[1];
  const mineId = String(mineBox.value);
  tick(mineBox);
  const rightAfter2 = read();
  const two = await waitList();

  // The pop-up from a suggested row.
  let pop = null;
  const firstRow = host().querySelector('tbody tr');
  if (firstRow) {
    fire(firstRow.querySelector('td.name'), 'click');
    await settle(300);
    pop = { open: !$('dealModal').hidden, title: text($('dealTitle')) };
    fire($('dealClose'), 'click');
    await settle(100);
  }

  // A FAST DOUBLE TICK: a second of his men before the first answer is in.
  tick(mineBox, false);
  const his2 = boxes('cuListB')[2];
  const his2Id = String(his2.value);
  tick(his2);
  const between = read();
  const dbl = await waitList();

  // OPEN IN CUSTOM TRADES from a suggestion: its men become the ticks, and the
  // builder's own figures equal the row's.
  let load = null;
  const lb = host().querySelector('tbody tr button[data-cu-load]');
  const lrow = dbl.rows[0] || null;
  if (lb) {
    fire(lb, 'click');
    await settle(200);
    // The ATTRIBUTE: a re-rendered box carries `checked` in its markup, which
    // linkedom does not mirror into the property (readCustomList reads it so).
    const ticked = (id) => boxes(id).filter((b) => b.hasAttribute('checked')).map((b) => String(b.value)).sort();
    load = {
      row: lrow, a: ticked('cuListA'), b: ticked('cuListB'),
      gainA: text($('cuGainA')), gainB: text($('cuGainB')),
    };
    await waitList();
  }

  // Clear: nothing ticked, no list.
  fire($('cuClear'), 'click');
  await settle(300);
  const cleared = read();

  // THE ASSUMED TRADE: save a 1-for-1, assume it, then tick one of his men.
  const a1 = boxes('cuListA')[1]; tick(a1);
  const b1 = boxes('cuListB')[1]; tick(b1);
  const sent = String(a1.value);
  const got = String(b1.value);
  await settle(300);
  fire($('cuSave'), 'click');
  fire($('cuClear'), 'click');
  await settle(200);
  fire(document.querySelector('#cuRows button[data-assume]'), 'click');
  await settleGoal(document);
  $('cuTeamB').value = partner; fire($('cuTeamB'), 'change');
  await settle(300);
  const listA = ids('cuListA');
  const listB = ids('cuListB');
  const hisA = boxes('cuListB').find((x) => String(x.value) !== sent && String(x.value) !== got);
  const hisAId = hisA ? String(hisA.value) : null;
  if (hisA) tick(hisA);
  const assumed = await waitList();
  // And with the man you RECEIVED in the assumed trade ticked on your side.
  if (hisA) tick(hisA, false);
  const gotBox = boxes('cuListA').find((x) => String(x.value) === got);
  if (gotBox) tick(gotBox);
  const assumedGot = await waitList();

  return {
    errors, order, partner, partnerName, before, rightAfter, one, rightAfter2, two, pop, between, dbl,
    hisId, mineId, his2Id, load, cleared,
    asm: { sent, got, listA, listB, hisAId, rows: assumed, gotRows: assumedGot, block: !$('assumedPanel').hidden },
  };
};

/** A reload with an assumed trade stored (`TR_ASSUMED` = the prefs to seed). */
SCENARIOS.assumeReload = async function assumeReload() {
  const seed = { 'ff.prefs': process.env.TR_ASSUMED || '{}' };
  const { document, window, errors } = await boot('trade.html', '', seed);
  const $ = (id) => document.getElementById(id);
  await settleGoal(document);
  const partner = process.env.TR_PARTNER;
  if (partner) {
    $('cuTeamB').value = partner;
    $('cuTeamB').dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(300);
  }
  let prefs = null;
  try { prefs = JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}'); } catch { prefs = null; }
  return { errors, page: readAssumed(document), prefs: prefs ? { assumed: prefs['trade.assumed'] ?? null, custom: prefs['trade.custom'] || null } : null };
};

/** The title goal on the stubbed REAL league: the live half of `goalInputs`. */
SCENARIOS.goalLive = async function goalLive() {
  const seed = {
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
  };
  const { document, errors } = await boot('trade.html', '', seed);
  // WAIT FOR THE PAGE TO FINISH, not for a fixed 15s (PROGRESS trap): the page
  // searches twice and then plays every offer through the simulation, which on
  // a loaded machine takes longer than any number written here.
  await settleGoal(document);
  const dl = document.getElementById('deadlineLine');
  return {
    errors,
    deadline: { hidden: !!dl.hidden, text: text(dl), warn: /\bwarn-line\b/.test(dl.getAttribute('class') || '') },
    combo: text(document.getElementById('comboBody')),
    kinds: [...document.querySelectorAll('#kindToggle button')].map(text),
    trades: readTrades(document),
    heads: [...document.querySelectorAll('#tradeTable thead th')].map(text),
    count: text(document.getElementById('tradeCount')),
    note: text(document.getElementById('tradeNote')),
  };
};

/**
 * THE TABLE IS TRUE BEFORE IT IS FINISHED (trade plan Phase 2, 2026-09-24).
 *
 * Demo, title goal. Polls the page while it plays the offers out and keeps
 * the first snapshot in which some rows carry a rank and the line still says
 * it is working — the moment the old page never had, since it sat in points
 * order until the very last offer was scored. Then waits for the finish.
 */
SCENARIOS.goalStaged = async function goalStaged() {
  const { document, errors } = await boot();
  const max = scaledBudget(45000, machineFactor());
  const t0 = Date.now();
  const snap = () => ({
    count: text(document.getElementById('tradeCount')),
    rows: [...document.querySelectorAll('#tradeTable tbody tr')].map((tr) => ({
      unranked: /\bunranked\b/.test(tr.getAttribute('class') || ''),
    })),
    trades: readTrades(document),
  });
  let staged = null;
  let sawRunning = false;
  while (Date.now() - t0 < max) {
    const s = snap();
    const running = /playing each offer out/.test(s.count);
    if (running) sawRunning = true;
    if (running && s.trades.some((t) => t.goal && t.goal.place)) { staged = s; break; }
    if (sawRunning && !running && /ranked by your/.test(s.count)) break;
    await settle(20);
  }
  await settleGoal(document);
  const final = snap();
  return { errors, sawRunning, staged, final };
};

/**
 * ONE WEEKLY SEARCH PER LOAD (trade plan Phase 3, 2026-09-24).
 *
 * Reads the page's own count of weekly searches (`data-weekly-searches` on the
 * finder's table) once it has finished. The page used to search on points once
 * the span was in, then again on the goal's weights once the played weeks
 * landed. `TR_ONCE_SEED=live` runs it on the stubbed real league (played weeks
 * to buy); otherwise demo.
 *
 * A PAGE WITHOUT THE COUNTER CANNOT PASS: a missing attribute reads as null,
 * not as one.
 */
SCENARIOS.searchOnce = async function searchOnce() {
  const seed = process.env.TR_ONCE_SEED === 'live'
    ? {
      'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
      'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
    }
    : null;
  const { document, errors } = await boot('trade.html', '', seed);
  // NOT settleGoal: with every week read slowed, the first line is the typical
  // week's "…NOT ranked by your title chance: the goal needs every remaining
  // week read…", which settleGoal accepts as finished (rightly, for a settled
  // goal) — it returned with the title ranking at 2 of 40 (2026-09-25), so the
  // count was read before a second search could have happened. Wait for the
  // goal ranking itself: "ranked by your", not "not ranked", not still playing.
  const max = scaledBudget(150000, machineFactor());
  const t0 = Date.now();
  const line = () => (document.getElementById('tradeCount')?.textContent || '').replace(/\s+/g, ' ');
  const ranked = () => /ranked by your/.test(line()) && !/not ranked/.test(line()) &&
    !/playing each offer out/.test(line());
  while (Date.now() - t0 < max && !ranked()) await settle(250);
  await settle(400);
  // And a moment more, in case a second search was about to start.
  await settle(3000);
  const n = document.getElementById('tradeTable').getAttribute('data-weekly-searches');
  return {
    errors,
    searches: n === null ? null : Number(n),
    waitedMs: Date.now() - t0,
    count: text(document.getElementById('tradeCount')),
    trades: readTrades(document).length,
  };
};

/**
 * BOTH GOALS ON EVERY ROW, THE GOAL SWITCH ON EVERY PANEL, AND HIS PROJECTION
 * IN THE WEEK HE PLAYS YOU (2026-09-29). Tim:
 *
 *   "Still have the user choose win or loose but in addition, show 2 columns on
 *   the trade, one for change of win % and one for change of losing %, as a
 *   preview for the setting that the user isn't currently on. Also above every
 *   box in the trade section have the to win or to not lose choice and it
 *   changes for all of the other identical buttons aswell … just make a opp
 *   proj diff that calculates how much my opponent's projection changes after
 *   the trade, only for the week that I play them."
 *
 * Demo (or the stubbed live league with `TR_TWO_SEED=live`, for timing). Waits
 * on the page's own signals: the ranked line, then no preview cell still
 * waiting. Then opens a row that meets you, then switches the goal from the
 * COMBO panel's copy of the control — not the top one — and waits again.
 */
SCENARIOS.twoGoals = async function twoGoals() {
  const seed = process.env.TR_TWO_SEED === 'live'
    ? {
      'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
      'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
    }
    : null;
  const t0 = Date.now();
  const { document, errors, fetchCalls } = await boot('trade.html', '', seed);
  const max = scaledBudget(150000, machineFactor());
  const line = () => text(document.getElementById('tradeCount'));
  const rankedOn = (chance) => new RegExp(`ranked by your ${chance}`).test(line()) &&
    !/not ranked/.test(line()) && !/playing each offer out/.test(line());
  const altPending = () => document.querySelectorAll('#tradeTable td.alt-goal-cell.goal-wait').length;
  const hasAlt = () => !!document.querySelector('#tradeTable td.alt-goal-cell');
  const startGoal = process.env.TR_GOAL || 'last';
  const chanceOf = (g) => (g === 'title' ? 'title chance' : 'chance of finishing last');

  while (Date.now() - t0 < max && !rankedOn(chanceOf(startGoal))) await settle(100);
  const tRanked = Date.now() - t0;
  // A page with no preview column at all has nothing to wait for — give up on
  // it in seconds rather than at the ceiling, so the failure is quick to see.
  const waitAlt = async (from) => {
    const since = Date.now();
    while (Date.now() - from < max && (hasAlt() ? altPending() > 0 : Date.now() - since < 5000)) await settle(100);
  };
  await waitAlt(t0);
  const tAlt = Date.now() - t0;
  await settle(400);

  const toggles = () => [...document.querySelectorAll('[data-goal-toggle]')].map((g) => {
    const sec = g.closest('section.panel');
    const h = sec ? sec.querySelector('h2') : null;
    return {
      panel: h ? text(h).split(' · ')[0] : '',
      role: g.getAttribute('role'),
      label: g.getAttribute('aria-label') || g.getAttribute('aria-labelledby') || '',
      on: text(g.querySelector('button.on')),
      buttons: [...g.querySelectorAll('button')].map((b) => ({
        goal: b.getAttribute('data-goal'),
        on: /\bon\b/.test(b.getAttribute('class') || ''),
        pressed: b.getAttribute('aria-pressed'),
        type: b.getAttribute('type'),
      })),
    };
  });
  const panels = () => [...document.querySelectorAll('section.panel')].map((s) => ({
    heading: text(s.querySelector('h2')).split(' · ')[0],
    copies: s.querySelectorAll('[data-goal-toggle]').length,
  }));
  const read = () => ({
    trades: readTrades(document),
    heads: [...document.querySelectorAll('#tradeTable thead th')].map(text),
    count: line(),
    note: text(document.getElementById('tradeNote')),
    comboHeads: [...document.querySelectorAll('#comboTable thead th')].map(text),
    comboRows: readOfferRows(document.getElementById('comboTable')),
    comboGoal: text(document.querySelector('#comboBody .combo-goal')),
    comboNote: text(document.getElementById('comboNote')),
    week: document.getElementById('weekSelect').value,
    team: document.getElementById('teamSelect').value,
    teams: [...document.querySelectorAll('#teamSelect option')]
      .map((o) => ({ id: o.getAttribute('value'), name: text(o) })),
    toggles: toggles(),
    panels: panels(),
  });
  const first = read();

  // The pop-up of the first row that meets you in the weeks left.
  let deal = null;
  const rows = [...document.querySelectorAll('#tradeTable tbody tr')];
  const meetAt = first.trades.findIndex((t) => t.opp && t.opp.v !== null);
  if (meetAt >= 0 && rows[meetAt]) {
    rows[meetAt].dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(2500);
    const weeks = readWeekTable(document.getElementById('dealBody'));
    deal = { row: meetAt, weeks, goal: text(document.querySelector('#dealBody .deal-goal')) };
    document.getElementById('dealClose').dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(300);
  }

  // SWITCH FROM A COPY, not from the top control: the combo panel's.
  const other = startGoal === 'title' ? 'last' : 'title';
  const copy = document.querySelector(`#comboPanel [data-goal-toggle] button[data-goal="${other}"]`);
  const t1 = Date.now();
  if (copy) {
    copy.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await settle(300);
    while (Date.now() - t1 < max && !rankedOn(chanceOf(other))) await settle(100);
  }
  const tRanked2 = Date.now() - t1;
  if (copy) await waitAlt(t1);
  const tAlt2 = Date.now() - t1;
  await settle(400);
  const second = read();
  const stored = (() => {
    try { return JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}')['trade.goal']; } catch { return null; }
  })();
  return {
    errors, fetchCalls, startGoal, first, deal, switched: !!copy, second, stored,
    timing: { tRanked, tAlt, tRanked2, tAlt2 },
  };
};

// --------------------------------------------------------------- child runner

const self = fileURLToPath(import.meta.url);

// How a scenario answers — `emit` from ./emit.mjs, which writes the whole line
// before it exits. That file carries the whole story; in short, this suite's
// payloads are 148-227 KB and a `console.log` + `process.exit` pair loses most
// of that on Linux, where stdout to a pipe is asynchronous and non-blocking.
if (process.argv[2]) {
  const name = process.argv[2];
  try {
    emit(await SCENARIOS[name](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

/** `stub: true` redirects js/season.js to tr-stub-season.mjs in the child. */
function run(name, { stub = false, env = {} } = {}) {
  const args = stub ? ['--import', './tr-register.mjs', self, name] : [self, name];
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...env },
    // 64 MB, NOT node's 1 MB default. A scenario answers with its whole page
    // state as one JSON line - the weekly one is several hundred KB - and at
    // the default the pipe is TRUNCATED rather than failed: the `@@` line
    // arrives cut in half and the log fills with JSON instead of an
    // assertion. CI reported exactly that on 2026-09-23 while every local
    // run passed.
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    // The reason FIRST, and a short dump: a megabyte of page state pushes the
    // real error off the end of a CI log.
    const why = res.error ? `${res.error.code || res.error.name}: ${res.error.message}`
      : `exit ${res.status}${res.signal ? ` (${res.signal})` : ''}`;
    const NL = String.fromCharCode(10);
    const tail = (t) => String(t || '').trimEnd().split(NL).slice(-6)
      .map((l) => (l.length > 300 ? `${l.slice(0, 300)}... [${l.length} chars]` : l)).join(NL);
    throw new Error([
      `no result for ${name} - ${why}`,
      'stderr:', tail(res.stderr),
      'stdout:', tail(res.stdout),
    ].join(NL));
  }
  try {
    return JSON.parse(line.slice(2));
  } catch (err) {
    // A PAYLOAD THAT DOES NOT PARSE IS A TRUNCATED PIPE, not a broken suite,
    // and it must say so in one line. Raw, this arrives as node printing the
    // whole cut-off JSON as the offending source with the error somewhere past
    // the end of the log — which is how the 2026-09-23 CI failure hid for a day.
    const body = line.slice(2);
    throw new Error(`the ${name} scenario's answer did not parse — ${err.message}. `
      + `${body.length} bytes, ending "${body.slice(-60)}". `
      + 'That means the child was cut off mid-write: see tests/emit.mjs.');
  }
}

// ------------------------------------------------------------------ assertions

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 260)}` : ''}`);
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- it opens, on demo data, with both panels full ------------------------

// ---- Phase 5: three CSS defects, read off trade.html's own <style> ----------
//
// linkedom computes no styles, so these read the rules themselves. Each was
// seen failing against the stylesheet as it was.
{
  const html = readFileSync(path.join(REPO, 'trade.html'), 'utf8');
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Every rule as { selectors, body, media } — media is the enclosing @media, if any.
  const rules = [];
  const walk = (src, media) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1; let j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head);
      else rules.push({ selectors: head.split(',').map((s) => s.trim()), body, media });
      i = j;
    }
  };
  walk(css, null);
  const decl = (sel, prop, media = null) => {
    let v = null;
    for (const r of rules) {
      if (!r.selectors.includes(sel)) continue;
      if (media && !(r.media || '').includes(media)) continue;
      const m = r.body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
      if (m) v = m[1].trim();
    }
    return v;
  };

  // V3: the pop-up's package lines are `.deal-side`, not `.pkg`.
  eq(decl('.deal-side .man', 'display'), 'block',
    'the pop-up’s You send / You get put each man on his own line (V3)');
  eq(decl('.deal-side .pp', 'margin'), '0 4px',
    'and space the position tag off the name and number (V3)');

  // V5: the builder's one instruction is readable, not a rule colour.
  eq(decl('.cu-preview .muted', 'color'), 'var(--dim)',
    '"Tick who moves on each side" is drawn in --dim, not --line-2 (V5)');

  // V7: on a phone the shape filter's five buttons fill their grid with no
  // empty cell. Auto-placement, row by row, with each button's span.
  {
    const cols = Number(((decl('#kindToggle', 'grid-template-columns', 'max-width: 760px') || '')
      .match(/repeat\(\s*(\d+)/) || [])[1]);
    const spanOf = (n) => {
      let s = 1;
      for (const r of rules) {
        if (!(r.media || '').includes('max-width: 760px')) continue;
        const hit = r.selectors.some((sel) => {
          if (sel === '#kindToggle button') return true;
          const m = sel.match(/^#kindToggle button:nth-child\(n\+(\d+)\)$/);
          return m ? n >= Number(m[1]) : false;
        });
        const m = hit && r.body.match(/grid-column\s*:\s*span\s+(\d+)/);
        if (m) s = Number(m[1]);
      }
      return s;
    };
    const buttons = (html.match(/<div class="segmented" id="kindToggle">([\s\S]*?)<\/div>/) || ['', ''])[1]
      .match(/<button/g) || [];
    let x = 0;
    for (let n = 1; n <= buttons.length; n++) {
      const s = Math.min(spanOf(n), cols);
      if (x + s > cols) x = 0;
      x = (x + s) % cols;
    }
    ok('the phone shape filter leaves no empty cell in its grid (V7)',
      Number.isFinite(cols) && buttons.length === 5 && x === 0,
      `cols=${cols}, buttons=${buttons.length}, last row filled to ${x || cols} of ${cols}`);
  }
}

const fresh = run('fresh');
ok('the page boots', !fresh.boot, fresh.boot);
if (!fresh.boot) {
  ok('no console errors', fresh.errors.length === 0, fresh.errors.slice(0, 2).join(' | '));
  ok('and no network call at all — the page is one week of rosters, read twice',
    fresh.fetchCalls.length === 0, fresh.fetchCalls.slice(0, 2).join(' | '));
  eq(fresh.badge, 'Demo', 'it opens on demo data and says so');

  // ---- Phase 5, V18: the depth map says what its tint is, in view ---------
  //
  // Its deep/thin shades borrow the ±1 SD scale's red and green under a
  // different rule (a rank within each column), and the visible part of the
  // panel did not say so. One sentence (rule 16), not behind the toggle.
  ok('the depth map tints some cells, so the key has something to describe',
    fresh.tintedDepthCells > 0, String(fresh.tintedDepthCells));
  ok('its visible key says the three deepest and thinnest are tinted',
    /three deepest and three thinnest/.test(fresh.depthKey) && !fresh.depthKeyHidden, fresh.depthKey);
  ok('and that this is not the ±1 SD scale used above',
    /not the ±1 SD scale/.test(fresh.depthKey), fresh.depthKey);
  ok('in one sentence',
    (fresh.depthKey.match(/[.!?](\s|$)/g) || []).length === 1, fresh.depthKey);

  // ---- the panels are in order of usefulness -----------------------------
  //
  // Tim, 2026-09-17: the finder first, then the best combo, then the depth map,
  // with the Data source toolbar above all three. The depth map had been first
  // — it is what the engine computes first, which is a fact about the code and
  // not about anybody reading the page.
  //
  // Asserted as a SEQUENCE rather than as "the finder is somewhere above the
  // depth map", because the weaker claim passes with the combo panel anywhere
  // at all, and where the combo sits is half of what he asked for. Both the
  // heading and the id are checked: the heading is what he sees, the id is what
  // every other test and the module itself address the panel by, and a rename
  // of one without the other is its own defect.
  // CUSTOM TRADES was added on 2026-09-18 and went LAST, deliberately: his
  // ordering of the three panels above is left exactly as he set it, and a new
  // panel inserted among them would have quietly re-ordered a thing he chose.
  // The sequence below still pins all of that — it is the same assertion with
  // one more entry, not a weaker one.
  // RE-AIMED 2026-09-23, not weakened: the finder's heading changed, because
  // "Trades that help both squads" was a claim about a search rule the page gave
  // up when the goal weights landed (the other manager may lose up to 2 a week,
  // and on the sample league every offer makes him worse). The sequence is still
  // pinned as a sequence, with the same number of entries; only the one word that
  // moved has moved. These scenarios open on "Don't finish last" (`boot`), so the
  // heading names that goal's chance.
  eq(
    fresh.panels.map((p) => p.heading).join(' > '),
    'Data source > Trades ranked by your chance of finishing last > Best combo > Depth map > Custom trades',
    'the panels read finder, combo, depth map, custom — under the toolbar'
  );
  ok('and the finder no longer claims a trade helps both squads — it cannot, and does not',
    !/help(s)? both squads/i.test(fresh.panels.map((p) => p.heading).join(' ')),
    fresh.panels.map((p) => p.heading).join(' > '));
  eq(
    fresh.panels.map((p) => p.id).join(','),
    ',finderTitle,,depthTitle,',
    'and the two ids the module writes into are on the right panels'
  );
  ok('the depth map still comes after the finder and the combo, and before custom',
    fresh.panels.length === 5 &&
    fresh.panels[3].id === 'depthTitle' &&
    fresh.panels[4].heading === 'Custom trades',
    fresh.panels.map((p) => p.heading).join(' > '));

  // ---- the depth map -----------------------------------------------------
  eq(fresh.depth.rows.length, 10, 'a row per manager');
  eq(fresh.teams.length, 10, 'every manager is offered as "your team"');
  eq(fresh.partners.length, 10, 'and nine partners plus "Any manager"');
  eq(fresh.partners[0], 'Any manager', 'the partner filter opens wide');
  ok('exactly one row is marked as yours',
    fresh.depth.rows.filter((r) => r.me).length === 1,
    `${fresh.depth.rows.filter((r) => r.me).length} marked`);

  eq(fresh.depth.heads[0], 'Manager', 'the first column names the manager');
  ok('the positions are the ones this league starts',
    fresh.depth.heads.slice(1, -1).join(',') === 'QB,RB,WR,TE,DST,K',
    fresh.depth.heads.join(','));
  eq(fresh.depth.heads[fresh.depth.heads.length - 1], 'Lineup', 'and the squad total closes it');

  ok('every cell carries a sortable value', fresh.depth.rows.every((r) =>
    r.cells.length === 6 && r.cells.every((c) => c.v !== null && c.v !== '')),
    JSON.stringify(fresh.depth.rows[0]));

  // COLOUR IS NEVER THE ONLY CUE. Every cell prints a number, and every cell
  // that is not exactly level prints its own sign — so the table reads with the
  // tint off, in greyscale, or to anyone who cannot separate the two hues. Same
  // rule as the two greens on the Players page. A true zero is left unsigned
  // because it has no sign to print; it is also, by definition, the one value
  // that is not saying anything.
  ok('every cell prints a number', fresh.depth.rows.every((r) =>
    r.cells.every((c) => /^[+−]?\d/.test(c.text))),
    fresh.depth.rows.flatMap((r) => r.cells.map((c) => c.text)).join(' '));
  ok('and every cell that is not level carries an explicit sign',
    fresh.depth.rows.every((r) =>
      r.cells.every((c) => Number(c.v) === 0 || /^[+−]/.test(c.text))),
    fresh.depth.rows.flatMap((r) => r.cells.filter((c) => !/^[+−]/.test(c.text)).map((c) => `${c.v}:${c.text}`)).join(' '));

  // The tint is a ranking within a column, so it cannot be all of one column
  // or none of it.
  for (let i = 0; i < 6; i++) {
    const deep = fresh.depth.rows.filter((r) => r.cells[i].deep).length;
    const thin = fresh.depth.rows.filter((r) => r.cells[i].thin).length;
    const pos = fresh.depth.heads[i + 1];
    ok(`${pos}: the tint marks some squads, not all of them`,
      deep + thin < fresh.depth.rows.length, `${deep} deep, ${thin} thin of 10`);
    ok(`${pos}: no squad is both deep and thin`,
      !fresh.depth.rows.some((r) => r.cells[i].deep && r.cells[i].thin));
  }

  ok('every cell explains itself on hover',
    fresh.depth.rows.every((r) => r.cells.every((c) => /startable/.test(c.tip))),
    fresh.depth.rows[0].cells[0].tip);

  ok('the replacement bar for every column is stated, not implied',
    fresh.depth.bars.length === 6, fresh.depth.bars.join(' | '));

  // The note has to say what the number IS. This is the house rule: state the
  // basis of every derived number in a panel note.
  for (const phrase of ['points above replacement', 'not starting anywhere', 'down a column']) {
    ok(`the depth note explains "${phrase}"`, fresh.note.includes(phrase), fresh.note.slice(0, 160));
  }

  // ---- the finder --------------------------------------------------------
  ok('the finder found trades in the demo league', fresh.trades.length > 0,
    `${fresh.trades.length} offers · ${fresh.empty}`);
  ok('the finder is not left saying it is still searching',
    !/still searching|Trying every swap/.test(fresh.empty), fresh.empty);

  // THE PREMISE MOVED ON 2026-09-21, and these say what replaced it. It was
  // "every offer helps both squads, ranked by your points". With the goal the
  // finder keeps a deal when it helps YOUR GOAL (points weighted by week) and
  // lets HIM lose up to 2 a week, discounted by how likely he is to say yes —
  // and the list is ranked by the goal's expected change, not by points.
  {
    const m = (fresh.heads.find((h) => /^You gain a week \(weeks/.test(h)) || '').match(/weeks (\d+)–(\d+)/);
    const n = m ? Number(m[2]) - Number(m[1]) + 1 : null;
    ok('the gain heading names the priced span', !!n, fresh.heads.join(' | '));
    ok('no offer costs him more than 2 points a week — the tolerance, and no more',
      !!n && fresh.trades.every((t) => t.theirGain >= -2 * n - 0.05),
      JSON.stringify(fresh.trades.map((t) => t.theirGain)));
    ok('offers are ranked by the expected change in your goal, best first',
      /ranked by your chance of finishing last/.test(fresh.count) &&
        fresh.trades.every((t, i) => i === 0 || fresh.trades[i - 1].goal.v >= t.goal.v - 0.0001),
      `${fresh.count.slice(0, 160)} · ${fresh.trades.map((t) => t.goal && t.goal.v.toFixed(4)).join(',')}`);
  }

  ok('every offer names who it is with',
    fresh.trades.every((t) => t.partner.length > 0));
  ok('every offer moves at least one man each way',
    fresh.trades.every((t) => t.send.length >= 1 && t.receive.length >= 1));
  ok('every offer shows your lineup before and after',
    fresh.trades.every((t) => /→/.test(t.beforeAfter)), fresh.trades[0].beforeAfter);

  // REPLACED, 2026-09-17. This used to assert that every row printed
  // "starts: … / drops out: …" under the You get column. Tim had that removed —
  // two wrapped lines in two strong colours, repeating the names already in the
  // two columns either side — so the claim is now its absence, and the
  // before-and-after is asserted in the pop-up where it moved to.
  ok('no row carries the old churn block any more',
    fresh.trades.every((t) => t.churn === ''),
    fresh.trades.map((t) => t.churn).filter(Boolean).join(' | '));
  ok('and no row says "starts:" or "drops out:" anywhere in it',
    fresh.trades.every((t) => !/starts:|drops out:|starts more:|starts less:/.test(
      [names(t.send), names(t.receive), t.shape, t.beforeAfter].join(' '))),
    JSON.stringify(fresh.trades[0] || {}).slice(0, 200));

  // The site-wide click-through contract. link-check.mjs follows these ids to
  // the Players page; here we only insist the page emits them at all.
  const links = fresh.trades.flatMap((t) => t.links);
  ok('every player named is a link to his row on the Players page',
    links.length >= fresh.trades.length * 2 &&
    links.every((h) => /^waivers\.html\?player=\d+$/.test(h)),
    `${links.length} links, e.g. ${links[0]}`);

  // ---- the shape filter says what a shape IS ------------------------------
  //
  // Tim, 2026-09-17: "I also don't understand what the straight swap,
  // consolidate, or any shape trade categories means." A count each way needs
  // no teaching, so the labels are counts and the consequence is said once,
  // under the control. Two claims, and they are separate: the LABELS changed,
  // and the stored preference values did NOT — a rename that quietly moved the
  // saved key would log him out of his own filter.
  // FIVE since 2026-09-21: 2 for 2 is searched now. The four older values are
  // unchanged, which is the half of this claim about his saved preference.
  const want = { all: 'Any shape', even: '1 for 1', consolidate: '2 for 1', depth: '1 for 2', two: '2 for 2' };
  ok('the shape filter keeps its four choices and adds 2 for 2',
    fresh.kinds.map((k) => k.kind).join(',') === 'all,even,consolidate,depth,two',
    fresh.kinds.map((k) => k.kind).join(','));
  ok('and each is labelled with the count each way, not a description of it',
    fresh.kinds.every((k) => k.label === want[k.kind]),
    fresh.kinds.map((k) => `${k.kind}=${k.label}`).join(' | '));
  ok('no old wording survives on any of them',
    !/Straight swap|You consolidate|You add depth/.test(fresh.kinds.map((k) => k.label).join(' ')),
    fresh.kinds.map((k) => k.label).join(' | '));
  // HANDOFF: a control's explanation may never live in a `title`, because
  // js/touch-titles.js deliberately leaves controls alone and a tap on a button
  // has to work the button. So it is a `.ctl-hint`, in view.
  ok('and none of them hides its meaning in a title nobody on a phone can read',
    fresh.kinds.every((k) => k.title === ''),
    fresh.kinds.map((k) => `${k.kind}:${k.title}`).join(' | '));
  ok('the hint under the control explains 2 for 1 and 1 for 2',
    /2 for 1/.test(fresh.kindHint) && /1 for 2/.test(fresh.kindHint) &&
    /send two/.test(fresh.kindHint) && /send one/.test(fresh.kindHint),
    fresh.kindHint);

  // "both totals go up" became "your goal-weighted total" on 2026-09-21: the
  // finder keeps deals by the goal now, and the note has to say so.
  for (const phrase of ['goal-weighted total', 'loses no more than 2 a week', 'Nothing is sent to ESPN', 'drop somebody']) {
    ok(`the finder note explains "${phrase}"`, fresh.tradeNote.includes(phrase),
      fresh.tradeNote.slice(0, 200));
  }
}

// ---- "Ask AI" on the end of every row; the Deal column gone (2026-09-30) ----
//
// Tim: "I also want a "ask AI" button on each trade which just allows the user
// to copy a script or text … The trade display is a little crowded now so just
// remove the "deal" column (2 for 2, etc) and then add the ask ai button on the
// end." Run twice: with the Clipboard API, and without it (the textarea path).
for (const noApi of [false, true]) {
  const tag = noApi ? ' (no Clipboard API: textarea + execCommand)' : '';
  const ai = run('askAi', { env: noApi ? { TR_NO_CLIPBOARD: '1' } : {} });
  ok(`the Ask AI scenario boots${tag}`, !ai.boot, ai.boot);
  if (ai.boot) continue;
  ok(`no console errors${tag}`, ai.errors.length === 0, ai.errors.slice(0, 2).join(' | '));
  ok(`and no request${tag}`, ai.fetchCalls.length === 0, ai.fetchCalls.slice(0, 2).join(' | '));
  if (!noApi) {
    ok('the finder has no Deal column', !ai.finderHeads.includes('Deal'), ai.finderHeads.join(' | '));
    ok('the combo tables have no Deal column', ai.comboHeads.length > 0 && ai.comboHeads.every((h) => !h.includes('Deal')),
      JSON.stringify(ai.comboHeads));
    ok('nor the saved custom trades', !ai.cuHeads.includes('Deal'), ai.cuHeads.join(' | '));
    ok('the finder head has one cell per row cell (Ask AI has no column of its own)', ai.headCellsMatchRow === true,
      `${ai.finderHeads.length} heads`);
    ok('every finder row: no Deal cell, one "Ask AI", and it is the LAST cell',
      ai.finder.length > 0 && ai.finder.every((r) => !r.hasDeal && r.n === 1 && r.lastAsk === 'Ask AI'),
      JSON.stringify(ai.finder.slice(0, 3)));
    ok('every combo row the same', ai.combo.length > 0 && ai.combo.every((r) => !r.hasDeal && r.n === 1 && r.lastAsk === 'Ask AI'),
      JSON.stringify(ai.combo.slice(0, 3)));
  }
  eq(ai.copied.length, 1, `one press copies once${tag}`);
  const c = ai.copied[0] || { via: '', text: '' };
  eq(c.via, noApi ? 'exec:copy' : 'api', `through ${noApi ? 'the textarea fallback' : 'the Clipboard API'}${tag}`);
  const t = c.text;
  ok(`it asks the AI for what the page cannot see${tag}`,
    /^Evaluate this fantasy football trade/.test(t) && /injury reports/.test(t) && /accept, counter, or wait/.test(t),
    t.slice(0, 200));
  ok(`it names the partner as the row does${tag}`, ai.row.partner && t.includes(`Trading with: ${ai.row.partner}`),
    `${ai.row.partner} / ${t.slice(0, 600)}`);
  ok(`MY +/- is the row's own You gain, per week and total${tag}`,
    !!ai.row.gain && t.includes(`My lineup gain: ${ai.row.gain.head} (${ai.row.gain.sub})`),
    `${JSON.stringify(ai.row.gain)} / ${(t.match(/My lineup gain:.*/) || [''])[0]}`);
  // NET (2026-09-30): You gain is your own lineup less his in the week(s) you
  // play him, so the copied line says so with both parts, and they add up.
  {
    const line = (t.match(/My lineup gain:.*/) || [''])[0];
    const hisMeet = num((t.match(/this trade changes his lineup ([+−-]?[\d.]+)/) || [])[1] || '0');
    const m = line.match(/\(([+−-]?[\d.]+) total\), net: my own lineup ([+−-]?[\d.]+) minus his ([+−-]?[\d.]+) in the week/);
    ok(`MY +/- is net of his change in the week(s) I play him, both parts stated${tag}`,
      Math.abs(hisMeet) < 0.05 ? !/net:/.test(line)
        : !!m && Math.abs(num(m[3]) - hisMeet) <= 0.051 && Math.abs(num(m[2]) - num(m[3]) - num(m[1])) <= 0.051,
      `${line} · his ${hisMeet}`);
  }
  ok(`HIS +/- is the row's own He gains, per week and total${tag}`,
    !!ai.row.their && t.includes(`His lineup gain: ${ai.row.their.head} (${ai.row.their.sub}`),
    `${JSON.stringify(ai.row.their)} / ${(t.match(/His lineup gain:.*/) || [''])[0]}`);
  const sendAt = t.indexOf('I send:');
  const getAt = t.indexOf('I get:');
  ok(`every man sent is listed under "I send" with the row's per-week figure${tag}`,
    ai.row.send.length > 0 && ai.row.send.every((m) => {
      const at = t.indexOf(`- ${m.name} (`);
      return at > sendAt && at < getAt && t.includes(`${m.val.replace('/wk', '')} pts/wk projected`);
    }), JSON.stringify(ai.row.send));
  ok(`every man received is listed under "I get"${tag}`,
    ai.row.receive.length > 0 && ai.row.receive.every((m) => t.indexOf(`- ${m.name} (`) > getAt),
    JSON.stringify(ai.row.receive));
  ok(`it carries today's date and the week${tag}`, /^Date: \w{3}, \w{3} \d+, \d{4} · fantasy week \d+/m.test(t),
    (t.match(/^Date:.*/m) || [''])[0]);
  ok(`and the league's own shape${tag}`, /^League: 10 teams · PPR · starters: QB/m.test(t), (t.match(/^League:.*/m) || [''])[0]);
  ok(`the goal and the yes chance as the goal cell gives them${tag}`,
    !!ai.row.goal.yes && t.includes(`${ai.row.goal.yes}% he accepts`) && t.includes(ai.row.goal.sub.split(' · ')[0]),
    `${JSON.stringify(ai.row.goal)} / ${(t.match(/chance \(my goal.*/) || [''])[0]}`);
  ok(`my remaining roster, by position${tag}`, /Rest of my roster \(pts\/wk\):\nQB: /.test(t), t.slice(-400));
  ok(`no "undefined", "NaN" or "null" anywhere${tag}`, !/undefined|NaN|\bnull\b|\[object/.test(t), t);
  ok(`and it stays short (${t.split(/\s+/).length} words)${tag}`, t.split(/\s+/).length <= 400, t.split(/\s+/).length);
  eq(ai.labelBefore, 'Ask AI', `the button reads "Ask AI"${tag}`);
  eq(ai.labelAfter, 'Copied', `then "Copied"${tag}`);
  eq(ai.labelLater, 'Ask AI', `and goes back${tag}`);
  ok(`the press does not open the week-by-week pop-up${tag}`, ai.dealHiddenBefore && ai.dealHiddenAfter,
    `${ai.dealHiddenBefore} ${ai.dealHiddenAfter}`);
  eq(ai.textareasLeft, 0, `no textarea is left in the page${tag}`);
  ok(`a combo row's button copies ITS deal${tag}`,
    !!ai.comboCopied && ai.comboCopied.includes(`Trading with: ${ai.comboPartner}`) && !/undefined|NaN/.test(ai.comboCopied),
    `${ai.comboPartner} / ${String(ai.comboCopied).slice(0, 300)}`);
  if (!noApi && process.env.TR_SHOW_ASK) console.log(`--- Ask AI, first finder row, as copied ---\n${t}\n---`);
}

// ---- the shape filter is a search, and it is honest about what it returns --

const shapes = run('shapes');
ok('the shape scenario boots', !shapes.boot, shapes.boot);
if (!shapes.boot) {
  ok('changing the shape costs no request', shapes.fetchCalls.length === 0,
    shapes.fetchCalls.join(' | '));
  ok('and logs no error', shapes.errors.length === 0, shapes.errors.slice(0, 2).join(' | '));

  const want = {
    even: (r) => r.send === 1 && r.get === 1,
    consolidate: (r) => r.send === 2 && r.get === 1,
    depth: (r) => r.send === 1 && r.get === 2,
  };
  // THE DEAL COLUMN IS GONE (Tim, 2026-09-30: "The trade display is a little
  // crowded now so just remove the "deal" column (2 for 2, etc) and then add the
  // ask ai button on the end"). The shape is still checked above, by the counts
  // of men in the two package columns; what each row must now carry is no Deal
  // cell and "Ask AI" as its last one — under every shape, not just one.
  for (const [kind, test] of Object.entries(want)) {
    const got = shapes.byKind[kind];
    ok(`the ${kind} button lights up when pressed`, /\bon\b/.test(got.on), got.on);
    ok(`searching ${kind} returns only that shape`, got.rows.every(test),
      JSON.stringify(got.rows.slice(0, 4)));
    ok(`and every ${kind} row has no Deal cell and ends in "Ask AI"`,
      got.rows.length > 0 && got.rows.every((r) => !r.hasDeal && r.lastAsk === 'Ask AI'),
      JSON.stringify(got.rows.slice(0, 3)));
  }

  // "Any shape" must be a superset — if it returned fewer than a narrowed
  // search, the narrowing would be finding things the wide search misses.
  const all = shapes.byKind.all.rows.length;
  ok('"Any shape" returns at least as much as any one shape',
    all >= Math.max(...Object.keys(want).map((k) => shapes.byKind[k].rows.length)),
    `all=${all}, ${Object.keys(want).map((k) => `${k}=${shapes.byKind[k].rows.length}`).join(' ')}`);

  // A shape with nothing to offer says so in words rather than showing a blank
  // panel. In the demo league the straight swaps are genuinely empty, which is
  // the case worth having covered.
  for (const kind of Object.keys(want)) {
    const got = shapes.byKind[kind];
    ok(`${kind}: an empty result is explained, not left blank`,
      got.rows.length > 0 || /No trade here helps your goal/.test(got.empty),
      got.empty.slice(0, 140));
  }
}

// ---- the controls repaint the right panel, and cost nothing ---------------

const ctl = run('controls');
ok('the controls scenario boots', !ctl.boot, ctl.boot);
if (!ctl.boot) {
  ok('driving every control costs no request', ctl.fetchCalls.length === 0,
    ctl.fetchCalls.join(' | '));
  ok('and logs no error', ctl.errors.length === 0, ctl.errors.slice(0, 2).join(' | '));

  // Changing YOUR team moves the highlight and re-runs the search from the new
  // squad. The depth numbers themselves are a property of the league, not of
  // who is reading, so they must NOT move.
  const wasMine = ctl.before.depth.rows.findIndex((r) => r.me);
  const nowMine = ctl.afterTeam.depth.rows.findIndex((r) => r.me);
  ok('picking another team moves the highlight', wasMine !== nowMine, `${wasMine} -> ${nowMine}`);
  ok('exactly one row is still yours',
    ctl.afterTeam.depth.rows.filter((r) => r.me).length === 1);
  ok('but the depth numbers do not move — they are the league, not the reader',
    JSON.stringify(ctl.before.depth.rows.map((r) => r.cells.map((c) => c.v))) ===
    JSON.stringify(ctl.afterTeam.depth.rows.map((r) => r.cells.map((c) => c.v))));
  ok('and the search is re-run from the new squad',
    JSON.stringify(ctl.before.trades.map((t) => t.send)) !==
    JSON.stringify(ctl.afterTeam.trades.map((t) => t.send)),
    'the offers are identical after switching team');
  ok('you are never offered a trade with yourself',
    ctl.afterTeam.trades.every((t) => t.partner !== ctl.afterTeam.depth.rows[nowMine].team),
    ctl.afterTeam.depth.rows[nowMine].team);

  // The partner select is the one true filter on the page: it can only ever
  // narrow what the whole-league search already found.
  ok('narrowing to a manager who has offers actually shows some',
    ctl.afterPartner.trades.length > 0,
    `${ctl.afterPartner.name} came back empty, so the next assertion means nothing`);
  ok('and shows only his',
    ctl.afterPartner.trades.every((t) => t.partner === ctl.afterPartner.name),
    `${ctl.afterPartner.name}: ${[...new Set(ctl.afterPartner.trades.map((t) => t.partner))].join(',')}`);
  ok('and never invents one the wide search had not found',
    ctl.afterPartner.trades.length <= ctl.afterTeam.trades.length,
    `${ctl.afterPartner.trades.length} vs ${ctl.afterTeam.trades.length}`);

  // A filter that matches nothing must EMPTY the table, not merely hide it.
  // Leaving the previous rows in a hidden wrapper is invisible on screen and
  // completely wrong in the document, which is how it survived being looked at.
  if (ctl.afterQuietPartner) {
    ok('a manager with no offers leaves NO stale rows behind',
      ctl.afterQuietPartner.trades.length === 0,
      `${ctl.afterQuietPartner.trades.length} rows still in the table for ${ctl.afterQuietPartner.name}`);
    ok('and the table is hidden rather than showing an empty frame',
      ctl.afterQuietPartner.wrapHidden);
    ok('and the page says why in words',
      /No trade here helps your goal/.test(ctl.afterQuietPartner.empty),
      ctl.afterQuietPartner.empty.slice(0, 140));
    // And it sends the reader the right way. The message pointed at "the depth
    // map above" while the map was first; the map is last now.
    ok('and points DOWN to the depth map, which now sits under it',
      /depth map below/.test(ctl.afterQuietPartner.empty) &&
      !/depth map above/.test(ctl.afterQuietPartner.empty),
      ctl.afterQuietPartner.empty.slice(-160));
  }

  ok('going back to "Any manager" restores the whole list',
    ctl.afterReset.length === ctl.afterTeam.trades.length,
    `${ctl.afterReset.length} vs ${ctl.afterTeam.trades.length}`);

  // The measure really is wired to both panels.
  ok('switching to the week measure changes the depth numbers',
    JSON.stringify(ctl.afterMeasure.depth.rows.map((r) => r.cells.map((c) => c.v))) !==
    JSON.stringify(ctl.afterTeam.depth.rows.map((r) => r.cells.map((c) => c.v))),
    'the measure toggle changed nothing, so one of the two is being ignored');
  ok('and the note says which basis is in use',
    /selected week/.test(ctl.afterMeasure.note), ctl.afterMeasure.note.slice(0, 200));
}

// ------------------------------------------------- re-deriving, not reading
//
// The suite's own copy of the arithmetic, built from the SAME demo generator
// the page uses but with nothing of the page in it. Everything here is the
// engine called directly, so a page that printed a plausible wrong number has
// nowhere to hide.

/**
 * The weeks a demo page prices, re-derived here rather than read off the page.
 *
 * `js/demo-rosters.js` marks every game played, so the page treats the SELECTED
 * week as "now" and prices what comes after it. That rule lives in
 * `playedWeeks()` in js/trade-page.js; this is the suite's own copy of it, which
 * is the point — if the page changed its mind, these two would disagree.
 */
const DEMO_WEEKS = 13;   // js/demo-rosters.js really is a thirteen-week season

const demoSpan = (week) => {
  const out = [];
  for (let w = Number(week) + 1; w <= DEMO_WEEKS; w++) out.push(w);
  return out;
};

/**
 * One finder row's goal figures, re-derived with nothing of the page's in it.
 *
 * The demo league rebuilt from its generators; the deal priced for BOTH squads
 * over the goal's weeks (the title goal adds the demo bracket, 14–16); the
 * season built with the Schedule page's functions and simulated on
 * js/trade-odds.js's seed; the yes-chance from the same two halves the page
 * names. Returns `{before, after, accept}` for your side.
 */
async function rederiveGoal(page, row, goal) {
  const { generateDemoWeekRosters } = await import(moduleUrl('js/demo-rosters.js'));
  const { generateDemoLeague } = await import(moduleUrl('js/demo.js'));
  const { priceTradeAcrossWeeks, slotsForLeague } = await import(moduleUrl('js/trade.js'));
  const { slotCountsFromLineups } = await import(moduleUrl('js/projection.js'));
  const capture = await import(moduleUrl('js/capture.js'));
  const odds = await import(moduleUrl('js/trade-odds.js'));

  const week = Number(page.week);
  const bracket = [14, 15, 16];
  const span = demoSpan(week).concat(goal === 'title' ? bracket : []);
  const base = generateDemoWeekRosters(week);
  const slots = slotsForLeague(slotCountsFromLineups(base.teams));
  const idx = new Map();
  const weekTeams = new Map();
  for (const w of [...span, ...bracket]) {
    const r = generateDemoWeekRosters(w);
    weekTeams.set(w, r.teams);
    const m = new Map();
    for (const t of r.teams) for (const p of t.players) m.set(p.playerId, p.projected);
    idx.set(w, m);
  }
  const projFor = (p, w) => { const v = idx.get(w)?.get(p.playerId); return typeof v === 'number' ? v : null; };

  const myId = Number(page.team);
  const me = base.teams.find((t) => t.id === myId);
  const partner = base.teams.find((t) => t.name === row.partner) ||
    base.teams.find((t) => (page.teams.find((o) => o.name === row.partner) || {}).id === String(t.id));
  if (!me || !partner) return null;
  const byId = new Map();
  for (const t of base.teams) for (const p of t.players) byId.set(p.playerId, p);
  const send = row.send.map((m) => byId.get(m.id)).filter(Boolean);
  const receive = row.receive.map((m) => byId.get(m.id)).filter(Boolean);
  if (send.length !== row.send.length || receive.length !== row.receive.length) return null;

  const mine = priceTradeAcrossWeeks({ players: me.players, send, receive, slots, weeks: span, projFor });
  const his = priceTradeAcrossWeeks({ players: partner.players, send: receive, receive: send, slots, weeks: span, projFor });
  const deltas = odds.offerDeltas({ partner: { id: partner.id }, byWeek: mine.byWeek, theirByWeek: his.byWeek }, myId);

  const d = generateDemoLeague();
  const data = capture.normalizeSchedule({
    teams: d.teams.map((t) => ({ id: t.id, name: t.name })),
    games: d.games.map((g) => ({
      week: g.week, homeId: g.homeId, homeScore: g.homeActual, homeProjected: g.homeProjected,
      awayId: g.awayId, awayScore: g.awayActual, awayProjected: g.awayProjected, played: true,
    })),
  }, { isDemo: true });
  const isRemaining = (g) => g.week > week || capture.gameState(g) !== 'final';
  const built = capture.buildProjection(data, capture.pickWeeks(weekTeams, bracket), null);
  const spread = capture.leagueSpread(data, (g) => !isRemaining(g), null);
  const inputs = capture.simulationInputs({ data, isRemaining, proj: built ? built.proj : null, sigma: spread.sigma });
  const before = odds.goalChance(odds.simulateWith(inputs), myId, goal);
  const after = odds.goalChance(odds.simulateWith(inputs, deltas), myId, goal);

  const ros = (list) => list.reduce((a, p) => a + span.reduce((s, w) => s + (projFor(p, w) ?? 0), 0), 0);
  const accept = odds.acceptChance({
    lineupPerWeek: his.delta / span.length,
    lookPerWeek: (ros(send) - ros(receive)) / span.length,
  });
  return { before, after, accept };
}

/**
 * HIS PROJECTION IN THE WEEKS HE PLAYS YOU, for every row, from nothing of the
 * page's: the demo rosters, the engine's own pricing of HIS side over the
 * goal's span, and the demo schedule's own games for which weeks the two of
 * you meet. Only regular-season weeks still to play — a playoff meeting is not
 * known in advance. `null` for a row whose partner you never meet again.
 */
async function rederiveHis(page, rowList, goal) {
  const { generateDemoWeekRosters } = await import(moduleUrl('js/demo-rosters.js'));
  const { generateDemoLeague } = await import(moduleUrl('js/demo.js'));
  const { priceTradeAcrossWeeks, slotsForLeague } = await import(moduleUrl('js/trade.js'));
  const { slotCountsFromLineups } = await import(moduleUrl('js/projection.js'));
  const week = Number(page.week);
  const regular = demoSpan(week);
  const span = regular.concat(goal === 'title' ? [14, 15, 16] : []);
  const base = generateDemoWeekRosters(week);
  const slots = slotsForLeague(slotCountsFromLineups(base.teams));
  const idx = new Map();
  for (const w of span) {
    const m = new Map();
    for (const t of generateDemoWeekRosters(w).teams) for (const p of t.players) m.set(p.playerId, p.projected);
    idx.set(w, m);
  }
  const projFor = (p, w) => { const v = idx.get(w)?.get(p.playerId); return typeof v === 'number' ? v : null; };
  const byId = new Map();
  for (const t of base.teams) for (const p of t.players) byId.set(p.playerId, p);
  const myId = Number(page.team);
  const games = generateDemoLeague().games;
  return rowList.map((row) => {
    const partner = base.teams.find((t) => t.name === row.partner);
    if (!partner) return { error: `no partner ${row.partner}` };
    const meet = [...new Set(games
      .filter((g) => (g.homeId === myId && g.awayId === partner.id) || (g.homeId === partner.id && g.awayId === myId))
      .map((g) => g.week))].filter((w) => regular.includes(w)).sort((a, b) => a - b);
    const send = row.send.map((m) => byId.get(m.id)).filter(Boolean);
    const receive = row.receive.map((m) => byId.get(m.id)).filter(Boolean);
    const his = priceTradeAcrossWeeks({ players: partner.players, send: receive, receive: send, slots, weeks: span, projFor });
    const sum = meet.length
      ? Math.round(his.byWeek.filter((w) => meet.includes(w.week)).reduce((a, w) => a + w.delta, 0) * 10) / 10
      : null;
    // YOUR side over the same span, so the row's net You gain can be rebuilt.
    const me = base.teams.find((t) => t.id === myId);
    const mine = me ? priceTradeAcrossWeeks({ players: me.players, send, receive, slots, weeks: span, projFor }).delta : NaN;
    return { meet, sum, byWeek: his.byWeek, mine };
  });
}

/** Price one packing of trades across the rest of the season, from scratch. */
async function repriceCombo(week, teamId, perTrade) {
  if (!perTrade || !perTrade.length) return null;
  const { generateDemoWeekRosters } = await import(moduleUrl('js/demo-rosters.js'));
  const { priceTradeAcrossWeeks, slotsForLeague } = await import(moduleUrl('js/trade.js'));
  const { slotCountsFromLineups } = await import(moduleUrl('js/projection.js'));

  const base = generateDemoWeekRosters(week);
  const slots = slotsForLeague(slotCountsFromLineups(base.teams));

  const span = demoSpan(week);

  const byWeek = new Map();
  for (const w of span) {
    const idx = new Map();
    for (const t of generateDemoWeekRosters(w).teams) {
      for (const p of t.players) idx.set(p.playerId, p.projected);
    }
    byWeek.set(w, idx);
  }
  const projFor = (p, w) => {
    const idx = byWeek.get(w);
    const v = idx ? idx.get(p.playerId) : undefined;
    return typeof v === 'number' ? v : null;
  };

  const me = base.teams.find((t) => String(t.id) === String(teamId));
  if (!me) return null;
  const byId = new Map();
  for (const t of base.teams) for (const p of t.players) byId.set(p.playerId, p);

  // Every send and every receive TOGETHER, in one pricing — which is the only
  // honest way to price a set of trades, and the thing the page must be doing.
  const send = [];
  const receive = [];
  for (const t of perTrade) {
    for (const id of t.send) send.push(byId.get(id) || id);
    for (const id of t.receive) if (byId.get(id)) receive.push(byId.get(id));
  }
  const mine = priceTradeAcrossWeeks({ players: me.players, send, receive, slots, weeks: span, projFor });
  // NET (2026-09-30): minus each partner's own change in the regular-season
  // week(s) of the span in which you play him, priced from his side alone.
  const { generateDemoLeague } = await import(moduleUrl('js/demo.js'));
  const games = generateDemoLeague().games;
  let opp = 0;
  for (const t of perTrade) {
    const partner = base.teams.find((x) => x.name === t.partner);
    if (!partner) return { ...mine, net: NaN };
    const meet = new Set(games
      .filter((g) => (g.homeId === me.id && g.awayId === partner.id) || (g.homeId === partner.id && g.awayId === me.id))
      .map((g) => g.week));
    const his = priceTradeAcrossWeeks({
      players: partner.players,
      send: t.receive.map((id) => byId.get(id)).filter(Boolean),
      receive: t.send.map((id) => byId.get(id)).filter(Boolean),
      slots, weeks: span, projFor,
    });
    opp += his.byWeek.filter((w) => meet.has(w.week)).reduce((a, w) => a + w.delta, 0);
  }
  return { ...mine, net: Math.round((mine.delta - opp) * 10) / 10 };
}

/**
 * What the page WOULD have claimed if it had added the offers' own gains up.
 *
 * Re-derived from the page's own two tables rather than from a phrase printed
 * in the combo list, which no longer exists — the combo's rows are merged per
 * manager and carry a re-priced gain, so their own numbers are deliberately not
 * the finder's. Each combo row is matched back to the finder rows it was built
 * from (the finder offers whose players are all inside it), and THOSE gains are
 * what the naive sum is made of. Which is the only honest way to check the
 * warning: it has to be the sum of the things somebody would have added up.
 */
function naiveFromFinder(comboRows, finderRows) {
  let total = 0;
  let matched = 0;
  for (const c of comboRows) {
    const ids = new Set([...c.send, ...c.receive].map((m) => m.id));
    for (const f of finderRows) {
      const fIds = [...f.send, ...f.receive].map((m) => m.id);
      if (!fIds.length || !fIds.every((id) => ids.has(id))) continue;
      // Only the offers with this same partner: a different manager's deal
      // cannot be a part of this row however its ids fall.
      if (f.partner !== c.partner) continue;
      total += f.myGain;
      matched++;
    }
  }
  return { total: Math.round(total * 10) / 10, matched };
}

/** `[a, a+1, … b]`, and a label for it that reads like the page's own. */
const weekRange = (a, b) => {
  const out = [];
  for (let w = a; w <= b; w++) out.push(w);
  return out;
};
const weekLabel = (weeks) => `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;

/**
 * The stubbed league, rebuilt in THIS process, with a `projFor` that reads the
 * fixture's own week functions.
 *
 * Nothing of the page is in here: the rosters come from the stub, the slot
 * shape from `slotCountsFromLineups` as the page derives it, and every weekly
 * number from `projectionFor`. So the engine can be run over any span at all —
 * including the span the page is NOT supposed to be using, which is how "a
 * played week changes nothing" becomes a thing that can fail.
 */
async function stubLeague() {
  const stub = await import('./tr-stub-season.mjs');
  const { slotsForLeague } = await import(moduleUrl('js/trade.js'));
  const { slotCountsFromLineups } = await import(moduleUrl('js/projection.js'));
  const { teams } = await stub.fetchWeekRosters(stub.PLAYED_THROUGH);
  const slots = slotsForLeague(slotCountsFromLineups(teams));
  const byId = new Map();
  for (const t of teams) for (const p of t.players) byId.set(p.playerId, p);
  // ESPN's id, the way the stub mints it: team * 100 + roster slot.
  const projFor = (p, w) => {
    const id = p ? p.playerId : null;
    if (id === null || id === undefined) return null;
    const v = stub.projectionFor(Math.floor(id / 100), id % 100, w);
    return typeof v === 'number' ? v : null;
  };
  return { stub, teams, slots, byId, projFor };
}

/** Two offers with the same partner that share no player — a mergeable pair. */
function disjointPair(offers) {
  const idsOf = (o) => new Set([...o.send, ...o.receive].map((p) => p.playerId));
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      if (offers[i].partner.id !== offers[j].partner.id) continue;
      const a = idsOf(offers[i]);
      if ([...idsOf(offers[j])].some((id) => a.has(id))) continue;
      return [offers[i], offers[j]];
    }
  }
  return null;
}

// ---- the weekly measure, on demo data -------------------------------------
//
// Three asks land here: the 13-week card on every name, the per-week drill-down
// and the best-combo section. All three only exist once the weeks are priced,
// and the press that prices them is the first thing asserted.

const wk = run('weekly');
ok('the weekly scenario boots', !wk.boot, wk.boot);
if (!wk.boot) {
  ok('no console errors on the weekly path', wk.errors.length === 0,
    wk.errors.slice(0, 2).join(' | '));
  // The whole point of demo: the weekly measure can be shown off for nothing.
  ok('pricing every week on DEMO data still costs no network call',
    wk.fetchCalls.length === 0, wk.fetchCalls.slice(0, 2).join(' | '));

  // -- the cost is on screen BEFORE it is spent ----------------------------
  //
  // MOVED, and the old line encoded the old truth: the span used to START at
  // the selected week. It is now the weeks with no result against them, and in
  // demo — where every sample game is marked played — that is everything AFTER
  // the week picker. Same derivation as `demoSpan` above.
  const spanLen = wk.after.weeks.filter((w) => Number(w) > Number(wk.after.week) &&
    Number(w) <= 13).length;
  ok('the page opens on a week with a rest of season to price', spanLen > 1,
    `week ${wk.after.week} of ${wk.after.weeks.join(',')}`);

  // -- THE PAGE PRICES ITSELF (Tim, 2026-09-19) ----------------------------
  //
  // Nothing was pressed in this scenario at all, and the page is on the weekly
  // measure with every week in hand. That is the whole of his ask — "it should
  // not load if it doesn't price it" — and it is the exact reverse of what this
  // block asserted for three days, when a press was the only thing that could
  // spend anything. FALSIFIABLE: take `autoLoad()` out of `useDemo` and the
  // measure is 'weeks' with no weeks behind it, so `basis()` falls back to the
  // typical week and both of these fail.
  eq(wk.after.measure, 'weeks', 'the page is on the weekly measure with nothing pressed');
  ok('and it has actually priced them, not merely selected the measure',
    /a week \(weeks \d+–\d+\)/.test(wk.after.heads.join(' | ')), wk.after.heads.join(' | '));
  ok('the button is now a RE-READ rather than a purchase',
    /Rebuild|Re-read/.test(wk.after.cost.button), wk.after.cost.button);
  ok('and the cost note names the real number of weeks',
    wk.after.cost.note.includes(`${spanLen} weeks`), wk.after.cost.note.slice(0, 220));
  ok('and says what it would cost on a real league — one request per week',
    /one per week/.test(wk.after.cost.note), wk.after.cost.note.slice(0, 260));
  ok('and says demo data itself costs nothing',
    /no requests at all/.test(wk.after.cost.note), wk.after.cost.note.slice(0, 200));
  ok('and says the page prices itself, and what is kept between pages',
    /prices itself/.test(wk.after.cost.note), wk.after.cost.note.slice(0, 400));
  ok('and names the weeks it reads but never prices',
    /shows but does not price/.test(wk.after.cost.note), wk.after.cost.note.slice(0, 600));

  // -- the combo is there too, unasked -------------------------------------
  ok('the best combo is computed without a press', wk.after.combo.rows.length > 0,
    wk.after.combo.body.slice(0, 200));

  // TIM'S OWN COMPLAINT, AS A PAGE-LEVEL ASSERTION (2026-09-19): "the best
  // combo gives me a single trade that is a 2-1 that has a lower +/week than
  // the top trade". It cannot — every single offer is a packing the search
  // considers — so a headline below the best row is proof the two panels are
  // pricing on different bases. They were: `bestCombo` took no `floors` option
  // at all, so the rows were floored and the packing was not.
  //
  // `test-trade-weekly.mjs` proves this in the engine, against a stand-in wire
  // strong enough to make it fail without the fix. This is the same claim read
  // off the rendered page, which is where he saw it.
  {
    const topRow = Math.max(...wk.after.trades.map((t) => t.myGain));
    ok('the best combo is never worth less than the best single offer above it',
      wk.after.combo.headlineGain === null ||
      wk.after.combo.headlineGain * demoSpan(wk.week).length + 0.6 >= topRow,
      `headline ${wk.after.combo.headlineGain}/wk vs top row ${topRow} total`);
  }
  ok('and the combo panel says it is priced on the same basis as the rows',
    /same basis as the offers above/.test(wk.after.combo.note) ||
    !/positional floor/.test(wk.after.combo.note),
    wk.after.combo.note.slice(-400));
  // A DELIBERATE SCALAR MEASURE STILL TURNS IT OFF, and the panel still names
  // the control by its exact face. It used to get those words by reading
  // `#loadWeeks`'s textContent back off the page — a panel that was right only
  // because the toolbar happened to be painted first. Both halves derive the
  // label from `weeksButton()` now, so the paint order is free; what this holds
  // down is the thing that WOULD be visible, the two labels agreeing character
  // for character.
  ok('picking a scalar measure empties the combo, and it says why',
    /every remaining week/i.test(wk.before.combo.body), wk.before.combo.body.slice(0, 160));
  ok('and quotes the weekly button word for word',
    wk.before.cost.button.length > 0 && wk.before.combo.body.includes(wk.before.cost.button),
    `button "${wk.before.cost.button}" vs combo "${wk.before.combo.body.slice(0, 200)}"`);
  eq(wk.before.measure, 'typical', 'and a chosen scalar measure is honoured');

  // -- THE SCALE IS STATED, which is the trap worth nine times the truth ----
  ok('the gain column says it is per week, and over which weeks',
    /You gain a week \(weeks \d+–\d+\)/.test(wk.after.heads.join(' | ')), wk.after.heads.join(' | '));
  // PER WEEK LEADS, the total follows — Tim, 2026-09-16. The leading number is
  // re-derived from the row's own total (its sort key) over the demo span.
  {
    const n = demoSpan(wk.week).length;
    const bad = wk.after.trades.filter((t) => {
      const m = t.gainText.match(/^([+−]?\d+(?:\.\d+)?)\/wk([+−]?\d+(?:\.\d+)?) total$/);
      return !m || Math.abs(num(m[1]) - t.myGain / n) > 0.051 || Math.abs(num(m[2]) - t.myGain) > 0.051;
    });
    ok('every gain leads with per week and carries the total underneath',
      wk.after.trades.length > 0 && bad.length === 0,
      bad.slice(0, 2).map((t) => `${t.gainText} (total ${t.myGain})`).join(' | '));
  }
  // -- (G) THE RED/GREEN SCALE ON THE FINDER'S TWO GAIN COLUMNS -----------
  //
  // Tim, 2026-09-19: "the coloring is good right now but it needs to be added
  // to all the other places a number is referred to across the whole site. For
  // example trade views..."
  //
  // PER COLUMN, and the two columns are two different squads' answers — one
  // scale across both would be ranking him against the manager he is trading
  // with, which is not a comparison. The group is the OTHER OFFERS ON SCREEN,
  // which is honest: every one of them is points added to a best lineup over
  // the same span.
  //
  // FALSIFIABLE: pass `null` for both scales in `renderFinder` and the first
  // three of these fail; pool the two columns into one scale and the fourth
  // fails, because the two scales' thresholds would then be identical.
  {
    const rows = wk.after.trades;
    const litMine = rows.filter((r) => /heat-(up|dn)-\d/.test(r.myHeat.cls));
    const litTheirs = rows.filter((r) => /heat-(up|dn)-\d/.test(r.theirHeat.cls));
    ok('every gain cell has been MEASURED, which is a different thing from painted',
      rows.length > 2 && rows.every((r) => r.myHeat.on && r.theirHeat.on),
      JSON.stringify(rows.slice(0, 2).map((r) => [r.myHeat.cls, r.theirHeat.cls])));
    ok('some rows are tinted and not all of them — a scale with a middle band',
      litMine.length > 0 && litMine.length < rows.length,
      `${litMine.length} of ${rows.length} tinted in You gain`);
    ok('and the same is true of He gains, which is its own scale',
      litTheirs.length > 0 && litTheirs.length < rows.length,
      `${litTheirs.length} of ${rows.length} tinted in He gains`);
    // THE TWO SCALES ARE NOT ONE. A row whose two gains are far apart must be
    // able to land on different steps; pooling them would make the top row of
    // one column and the top row of the other agree by construction.
    ok('the two columns are scaled apart, not pooled into one',
      rows.some((r) => r.myHeat.cls !== r.theirHeat.cls),
      JSON.stringify(rows.map((r) => `${r.myHeat.cls}/${r.theirHeat.cls}`)));
    ok('every tinted cell says in words exactly where it stands',
      litMine.every((r) => /SD (above|below)/.test(r.myHeat.title)) &&
      litTheirs.every((r) => /SD (above|below)/.test(r.theirHeat.title)),
      (litMine[0] || {}).title);
    ok('and names its own comparison group, never the other column’s',
      litMine.every((r) => /gain you/.test(r.myHeat.title)) &&
      litTheirs.every((r) => /gain the other manager/.test(r.theirHeat.title)),
      `${(litMine[0] || {}).title} | ${(litTheirs[0] || {}).title}`);
    // CHANNEL 2: the end of the scale carries a glyph as well as a tint.
    const ends = rows.filter((r) => /heat-(up|dn)-4/.test(r.myHeat.cls));
    ok('a cell at the end of the scale carries ▲ or ▼ as well as its colour',
      ends.length === 0 || ends.every((r) => /[▲▼]/.test(r.myHeat.mark)),
      JSON.stringify(ends.map((r) => [r.myHeat.cls, r.myHeat.mark])));
    // Phase 5, V4: THE GLYPH SITS BESIDE THE NUMBER, before the "total" sub
    // line — not orphaned at the foot of a tall cell. Both columns; and not
    // vacuous: at least one marked cell with a sub line must exist to check.
    const marked = rows.flatMap((r) => [r.myHeat, r.theirHeat]).filter((h) => h.markBeforeSub !== null);
    ok('the ▲/▼ is drawn beside the per-week number, before its "total" line',
      marked.length > 0 && marked.every((h) => h.markBeforeSub === true),
      `${marked.filter((h) => h.markBeforeSub).length} of ${marked.length} marks before the sub line`);
    // CHANNEL 4, AND IT IS SPLIT IN TWO (2026-09-19). The VISIBLE key is one
    // short sentence — what the colour compares, which way round it runs, and
    // that the far end carries a mark and heavier type, so none of it depends
    // on separating the hues. `describeHeatPerColumn`'s full 86 words were here
    // and took this one status line from 37px to 206px tall at 390px; they are
    // in the method below now, beside the thresholds they belong with.
    ok('the key under the finder says what the colour compares, in one line',
      /only with the other offers in the same column/i.test(wk.after.count) &&
        /[▲▼]/.test(wk.after.count) && /heavier type/i.test(wk.after.count),
      wk.after.count.slice(0, 200));
    ok('and it is SHORT — a key, not the method',
      wk.after.count.split(/\s+/).length < 60, `${wk.after.count.split(/\s+/).length} words`);
    // The THRESHOLDS in points live behind the toggle with the rest of the
    // method — the visible key is a small line, which is the panel shape
    // HANDOFF describes and what `text-audit.mjs` measures.
    ok('and the method carries the per-column rule the visible line no longer spells out',
      /per column and never across the table/i.test(wk.after.note),
      wk.after.note.slice(-900));
    ok('and the thresholds in points are in the method, so a cell can be checked by hand',
      /reaching full colour 1 standard deviation away/i.test(wk.after.note),
      wk.after.note.slice(-600));
    ok('which says the two columns are scaled apart and why',
      /two different squads’ answers/.test(wk.after.note), wk.after.note.slice(-400));
  }

  ok('the note says these are rest-of-season totals, not weekly figures',
    /rest-of-season total/.test(wk.after.note), wk.after.note.slice(0, 400));
  ok('and every gain carries its per-week twin',
    wk.after.trades.length > 0 && wk.after.trades.every((t) => /\/wk/.test(t.gainText)),
    (wk.after.trades[0] || {}).gainText);
  ok('the depth map says it is still per week, unlike the panels above it',
    /per week/.test(wk.after.depthNote), wk.after.depthNote.slice(0, 400));
  // THE PROSE HAS TO FOLLOW THE PANELS. The depth note pointed at "the panels
  // below" and "the deals below" while the map sat first; it is last now, and a
  // note telling a reader to look the wrong way is a defect of exactly the kind
  // the reorder was meant to remove rather than create.
  ok('and points UP at the deals, now that it sits under them',
    /panels above/.test(wk.after.depthNote) && /deals above/.test(wk.after.depthNote) &&
    !/(panels|deals|offer) below/.test(wk.after.depthNote),
    wk.after.depthNote.slice(0, 600));

  // The two bases must actually produce different numbers, or one of them is
  // being ignored — the failure this whole scenario exists to catch.
  ok('the weekly basis moves the depth numbers',
    JSON.stringify(wk.before.depth.rows.map((r) => r.cells.map((c) => c.v))) !==
    JSON.stringify(wk.after.depth.rows.map((r) => r.cells.map((c) => c.v))));
  ok('and the gains are on a different scale entirely',
    wk.after.trades.length > 0 && wk.before.trades.length > 0 &&
    Math.max(...wk.after.trades.map((t) => t.myGain)) >
      Math.max(...wk.before.trades.map((t) => t.myGain)) * 2,
    `${wk.before.trades[0] && wk.before.trades[0].myGain} -> ${wk.after.trades[0] && wk.after.trades[0].myGain}`);

  // -- ask 6: the depth map and the drill-down cannot contradict each other -
  ok('the depth note explains that a surplus is not a gain',
    /surplus is not the same as a gain/i.test(wk.after.depthNote),
    wk.after.depthNote.slice(0, 500));
  ok('and says the two panels are the same projections',
    /cannot disagree/.test(wk.after.depthNote), wk.after.depthNote.slice(-300));

  // -- ask 1: a card on every name -----------------------------------------
  ok('every man in the finder carries a card',
    wk.after.trades.every((t) => t.cards === t.send.length + t.receive.length),
    JSON.stringify(wk.after.trades.map((t) => [t.cards, t.send.length + t.receive.length])));
  ok('your spare men are named under the depth map', wk.after.spares.length > 0,
    wk.after.spares.join(' | '));

  ok('hovering a player name opens the card', wk.card && wk.card.hidden === false,
    JSON.stringify(wk.card));
  if (wk.card) {
    ok('the card names the man it was opened on',
      wk.card.ident.length > 0 && wk.card.hovered.includes(wk.card.ident.split(' · ')[0]),
      `${wk.card.ident} vs ${wk.card.hovered}`);
    // THE WHOLE SEASON, WEEK 1 ONWARDS (Tim, 2026-09-19: "it doesn't actually
    // display any previous weeks in the chart, so that whole row is useless ...
    // just start displaying all weeks 1-17").
    //
    // It used to be "every week the page HOLDS", which is the priced span plus
    // the one on screen — so the run began at the current week and the Act row,
    // which can only be filled from a week already PLAYED, was empty for every
    // player on this page by construction. The heading names the real range.
    ok('the run starts at week 1 and reaches the last playoff week',
      /for weeks 1–\d+/i.test(wk.card.heading), wk.card.heading);
    ok('and it is longer than the priced span, because the past is in it',
      wk.card.projs.length > spanLen + 1,
      `${wk.card.projs.length} cells for a ${spanLen}-week span`);
    ok('and says whose numbers they are, and for which weeks',
      /projections for weeks \d+–\d+/i.test(wk.card.heading), wk.card.heading);
    // THE STARTS COUNT, his third ask of the day: "the number of starting weeks
    // in that user's lineup". It says WHICH weeks it is over and WHOSE squad it
    // is about, both of which move — a man who has changed hands has two
    // managers in his season, and a half-loaded page has fewer weeks than a
    // whole one.
    ok('the card says how many weeks he is in the best lineup for',
      /in the best lineup for .+ in \d+ of \d+ weeks read/.test(wk.card.heading),
      wk.card.heading);
  }
  // THE ARROW ON THE WEEKS YOU PLAY HIM (Tim, 2026-09-21: "add a little arrow
  // pointing to the week that the user is playing you in the preview"). The
  // card was opened on the first man of a finder row, so the arrows must sit on
  // exactly the weeks the demo schedule has your squad meeting that row's
  // manager — re-derived here from js/demo-rosters.js, not read off the page.
  if (wk.card) {
    const { generateDemoSchedule } = await import(moduleUrl('js/demo-rosters.js'));
    const sched = generateDemoSchedule();
    const partnerName = wk.card.rowPartner;
    const partner = sched.teams.find((t) => t.name === partnerName);
    const me = String(wk.myTeamId);
    const want = partner
      ? [...new Set(sched.games.filter((g) =>
        (String(g.homeId) === me && String(g.awayId) === String(partner.id)) ||
        (String(g.awayId) === me && String(g.homeId) === String(partner.id)))
        .map((g) => g.week))].sort((a, b) => a - b)
      : [];
    ok('the fixture really has you meeting the top offer’s manager, or this proves nothing',
      want.length > 0, `${partnerName} vs team ${me}`);
    ok('the card marks exactly the weeks you play that manager',
      JSON.stringify(wk.card.vs) === JSON.stringify(want),
      `card ${JSON.stringify(wk.card.vs)} vs schedule ${JSON.stringify(want)} (${partnerName})`);
    ok('and says so in words, naming him, for a screen reader',
      wk.card.vsSpoken.length === want.length &&
      wk.card.vsSpoken.every((t) => t.includes(partnerName)), JSON.stringify(wk.card.vsSpoken));
  }
  ok('a spare chip is about no deal, so it carries no arrow',
    wk.spareCard && wk.spareCard.vs.length === 0, JSON.stringify(wk.spareCard && wk.spareCard.vs));
  ok('a spare chip opens the same card', wk.spareCard && wk.spareCard.hidden === false,
    JSON.stringify(wk.spareCard));

  // -- ask 3: the drill-down -----------------------------------------------
  ok('clicking an offer opens the deal', wk.deal && !wk.deal.hidden, JSON.stringify(wk.deal).slice(0, 200));

  // THE BEFORE-AND-AFTER LIVES HERE NOW, and only here. The rows gave it up
  // (Tim, 2026-09-17) because beside the two package columns it was mostly
  // their own names again — so what has to be true of it is the opposite claim
  // to the one the rows used to carry, plus the one fact those columns never
  // could say: which of these men are HIS, promoted or benched by the deal
  // without ever being part of it.
  const churn = (wk.deal && wk.deal.churnEntries) || [];
  ok('the pop-up still carries the before-and-after the rows gave up',
    /starts/.test((wk.deal && wk.deal.churn) || '') && churn.length > 0,
    ((wk.deal && wk.deal.churn) || '').slice(0, 200));
  // The two packages, read off the pop-up's own head rather than assumed.
  const dealt = (wk.deal.men || []).map((m) => m.text);
  const inDeal = (name) => dealt.some((t) => t.startsWith(name));
  ok('every man tagged "yours" is one who is NOT in the trade',
    churn.filter((e) => e.own).every((e) => !inDeal(e.name)),
    churn.filter((e) => e.own && inDeal(e.name)).map((e) => e.name).join(', '));
  ok('and every man left untagged IS in one of the two packages',
    churn.filter((e) => !e.own).every((e) => inDeal(e.name)),
    churn.filter((e) => !e.own && !inDeal(e.name)).map((e) => e.name).join(', '));
  // Checked on the first offer that moves one of his own men (see `weekly`):
  // the top row need not be one since the goal chooses the candidates.
  const ownChurn = (wk.ownDeal && wk.ownDeal.churnEntries) || [];
  ok('some offer names at least one man of his own that the deal moves',
    ownChurn.some((e) => e.own), `opened ${wk.ownOpened} offers; top: ${JSON.stringify(churn)}`);
  if (wk.ownDeal) {
    const ownDealt = (wk.ownDeal.men || []).map((m) => m.text);
    ok('and on that deal too, every man tagged "yours" is NOT in the trade',
      ownChurn.filter((e) => e.own).every((e) => !ownDealt.some((t) => t.startsWith(e.name))),
      ownChurn.filter((e) => e.own).map((e) => e.name).join(', '));
  }
  // Colour is never the only cue (HANDOFF). The tag is a WORD — "benched",
  // "promoted", "more weeks", "fewer weeks" — and the shade is beside it.
  ok('and says in words what happened to him, not only in colour',
    ownChurn.filter((e) => e.own).every((e) => /benched|promoted|weeks/.test(e.own)),
    ownChurn.filter((e) => e.own).map((e) => e.own).join(' | '));
  if (wk.deal && wk.deal.weeks) {
    eq(wk.deal.weeks.weeks.length, spanLen, 'one row per remaining week');
    ok('the columns are current, changed and the difference',
      /As you are now/.test(wk.deal.weeks.heads.join(' ')) &&
      /With the trade/.test(wk.deal.weeks.heads.join(' ')) &&
      /Difference/.test(wk.deal.weeks.heads.join(' ')),
      wk.deal.weeks.heads.join(' | '));

    // RE-DERIVED: the rows must add up to the total printed beside them, and
    // the total must be the gain the finder's own row claimed. Rounding is a
    // tenth a row and no more.
    const rows = wk.deal.weeks.weeks;
    const totalRow = wk.deal.weeks.totalRow;
    const sum = rows.reduce((a, r) => a + r.delta, 0);
    ok('the per-week differences sum to the stated total',
      Math.abs(sum - totalRow.delta) <= 0.05 * rows.length + 0.051,
      `rows sum to ${sum.toFixed(2)}, total says ${totalRow.delta}`);
    ok('and each row IS after minus before',
      rows.every((r) => Math.abs((r.after - r.before) - r.delta) <= 0.051),
      JSON.stringify(rows.slice(0, 3)));
    // NET SINCE 2026-09-30: the row's You gain and the total as SHOWN are both
    // your change minus his in the week(s) you play him; `delta` stays yours.
    ok('and the total matches the gain the finder advertised (both net)',
      Math.abs(totalRow.shown - wk.dealRowGain) <= 0.2,
      `deal ${totalRow.shown} (yours ${totalRow.delta}) vs the row it was opened on ${wk.dealRowGain}`);
    ok('the per-week average is shown as well as the total',
      wk.deal.weeks.totals.length === 2 && wk.deal.weeks.perRow &&
      Math.abs(wk.deal.weeks.perRow.delta - totalRow.delta / rows.length) <= 0.06,
      JSON.stringify(wk.deal.weeks.totals));
    ok('and per week comes FIRST, the total under it', wk.deal.weeks.perFirst,
      JSON.stringify(wk.deal.weeks.totals.map((r) => r.label)));
    // The sample league's playoff weeks (14–16) come after the totals.
    const po = wk.deal.weeks.playoff;
    ok('DEMO: the playoff weeks 14–16 are shown, after the totals and below their line',
      po.map((r) => r.week).join(',') === '14,15,16' &&
        po.every((r) => r.belowLine && r.afterTotals && !r.coloured),
      JSON.stringify(po));
    ok('DEMO: and the line says they are for reference, not in the total',
      /Playoffs \(weeks 14–16\) — shown for reference, not in the total/.test(wk.deal.weeks.poDivider),
      wk.deal.weeks.poDivider);
    ok('DEMO: each playoff row is still after minus before, each side’s own lineup',
      po.every((r) => Number.isFinite(r.before) && Number.isFinite(r.after) &&
        Math.abs((r.after - r.before) - r.delta) <= 0.051),
      JSON.stringify(po));
    // -- (G) THE SCALE ON THE PER-WEEK DIFFERENCE COLUMN -------------------
    //
    // The comparison group is THE OTHER WEEKS OF THIS DEAL, which is exactly
    // what the note beside it says the table is for: "the average is not the
    // story", the weeks where the difference collapses are byes you already
    // cover and the weeks where it opens up are what the trade is buying. It
    // composes with the existing green/red on the same cell rather than
    // replacing it — that one is a foreground and means better-or-worse, this
    // is a background and means far-from-this-deal's-own-normal (rule 14).
    //
    // FALSIFIABLE: pass `null` instead of `deltaScale` in `weekTableHtml` and
    // the first two of these fail.
    {
      const rows2 = wk.deal.weeks.weeks;
      const lit = rows2.filter((r) => /heat-(up|dn)-\d/.test(r.heat));
      ok('the weeks are measured against each other, and some stand out',
        rows2.every((r) => r.heat !== '') && lit.length > 0 && lit.length < rows2.length,
        `${lit.length} of ${rows2.length} · ${rows2.map((r) => r.heat).join(',')}`);
      ok('and every tinted week says where it stands against the others',
        lit.every((r) => /other weeks of this deal/.test(r.heatTitle)),
        (lit[0] || {}).heatTitle);
      // A PLAYED WEEK IS IN NO TOTAL, so it is in no scale — putting it in
      // would move the mean of a set it is not drawn from.
      ok('a played week is in no total and therefore carries no colour at all',
        wk.deal.weeks.past.every((r) => !r.coloured),
        JSON.stringify(wk.deal.weeks.past.slice(0, 2)));
      ok('and the key under the table prints the thresholds in points',
        /reaching full colour 1 standard deviation away/i.test(wk.deal.weeks.heatKey) &&
          /Played and playoff weeks are in no total/.test(wk.deal.weeks.heatKey),
        wk.deal.weeks.heatKey.slice(0, 240));
    }
    ok('and the note says both lineups are picked week by week',
      /best legal lineup .{0,20}in that week/.test(wk.deal.note), wk.deal.note.slice(0, 300));
    ok('the deal names its players with cards too', wk.deal.cards >= 2, `${wk.deal.cards} cards`);
    ok('and says there is no ESPN league in demo rather than offering a dead link',
      /no ESPN league to open in demo/.test(wk.deal.body) && wk.deal.espn === '',
      wk.deal.body.slice(-200));
  }

  // -- ask 4: the combo ----------------------------------------------------
  const combo = wk.after.combo;
  ok('the combo section has an answer once the weeks are priced',
    /\d/.test(combo.head), combo.head);
  ok('it states the gain and the number of trades',
    /[+−]\d/.test(combo.head) && /trade/.test(combo.head), combo.head);
  ok('it says a player can only be traded once',
    /only be traded once/.test(combo.note), combo.note.slice(0, 200));
  ok('and warns against adding the offers up',
    /Never add the gains up/.test(combo.note), combo.note.slice(0, 300));
  ok('the naive sum is shown beside the real one',
    /Adding the offers’ own gains/.test(combo.body), combo.body.slice(0, 300));

  // DISJOINTNESS, re-derived from the names on screen rather than trusted.
  ok('no player appears in two trades of the combo',
    combo.names.length > 0 && new Set(combo.names).size === combo.names.length,
    combo.names.join(' | '));
  ok('and none appears twice in the "most trades" packing either',
    new Set(combo.altNames).size === combo.altNames.length, combo.altNames.join(' | '));

  // MOVED. This used to check the combo's own week-by-week table, which was
  // printed inline under the list. Ask 5 put it in the pop-up — "including the
  // best combo" — so the claim now is that it is NOT here, and the rows-add-up
  // check went with it to the `modal` scenario where the table actually lives.
  ok('the combo prints no week-by-week table inline any more', combo.weeks === null,
    'a week table is still sitting under the combo list');

  // THE NUMBER ITSELF, RE-DERIVED. Everything above reads the page back to
  // itself; this rebuilds the same demo league from scratch, takes the packing
  // the page printed, applies every send and every receive TOGETHER, and prices
  // it with the engine. A combo whose headline was the sum of its trades — the
  // one mistake this section exists to avoid — fails here and nowhere else.
  const priced = await repriceCombo(wk.week, wk.myTeamId, combo.perTrade);
  const claimed = num((combo.head.match(/\(([+−]\d+(?:\.\d+)?) total over/) || [])[1]);
  const headPer = num(combo.head.split(' ')[0]);
  ok('the combo headline leads with the PER-WEEK figure',
    !!priced && /^[+−]?\d[\d.]* a week/.test(combo.head) &&
      Math.abs(headPer - priced.net / demoSpan(wk.week).length) <= 0.06,
    `${combo.head.slice(0, 80)} vs ${priced && (priced.net / demoSpan(wk.week).length).toFixed(2)}`);
  // NET since 2026-09-30: your change minus each partner's in the weeks you play him.
  ok('the combo headline survives an independent re-pricing of the same move (net)',
    priced && Math.abs(priced.net - claimed) <= 0.15,
    `page says ${claimed}, a fresh priceTradeAcrossWeeks says ${priced && priced.net} net (${priced && priced.delta} yours)`);
  ok('and the net really differs from your own change here, so the check bites',
    priced && Math.abs(priced.net - priced.delta) > 0.15,
    `${priced && priced.net} vs ${priced && priced.delta}`);
  // The naive figure the page prints must BE the sum of the offers' own gains
  // — otherwise the warning beside it is decoration — and the real answer must
  // differ from it, which is the whole reason the warning exists.
  //
  // MOVED, and the old reading encoded the old markup: the combo used to print
  // each offer's own gain in its list ("on its own +12.4") and the sum was read
  // back out of those words. The rows are merged per manager now and carry a
  // RE-PRICED gain, so the naive sum has to come from the finder's table — the
  // place those original gains still live. Same claim, derived from the page
  // rather than from a sentence the page writes about itself.
  const naive = naiveFromFinder(combo.rows, wk.after.trades);
  ok('every combo row can be traced back to the finder offers it was built from',
    naive.matched >= combo.rows.length,
    `${naive.matched} finder offers matched ${combo.rows.length} combo rows`);
  // The trailing full stop is not part of the number, and a regex that eats it
  // hands Number() a NaN that looks like a mismatch.
  // Per week first now; the total the finder's gains add up to is in brackets.
  const naiveShown =
    (combo.body.match(/own gains would have given [+−]\d+(?:\.\d+)? a week \(([+−]\d+(?:\.\d+)?) over/) || [])[1];
  ok('the naive sum shown is exactly the offers’ own gains added up',
    naiveShown !== undefined && Math.abs(num(naiveShown) - naive.total) <= 0.15,
    `shown ${naiveShown}, the finder's own gains add to ${naive.total.toFixed(1)}`);
  ok('and the real answer is not that sum',
    naive.matched < 2 || Math.abs(priced.delta - naive.total) > 0.15 ||
      /coincidence rather than a rule/.test(combo.body),
    `${priced && priced.delta} vs naive ${naive.total.toFixed(1)}`);

  // ---- ask 6: the combo is a LIST OF OFFERS, in the finder's own shape -----
  ok('the combo draws its trades as offer rows, not a summary',
    combo.rows.length > 0, combo.body.slice(0, 200));
  ok('every combo row names a manager, a package each way and HIS gain',
    combo.rows.every((r) => r.partner && r.send.length && r.receive.length &&
      Number.isFinite(r.theirGain)),
    JSON.stringify(combo.rows.map((r) => [r.partner, r.send.length, r.receive.length, r.theirGain])));

  // -- (A) ONE NUMBER FOR THE PACKING, NOT ONE PER DEAL --------------------
  //
  // Tim, 2026-09-19: "I want their stats to be combined because it should treat
  // it as the same trade made at once. This means the +/week should be shown as
  // 1 number not 2."
  //
  // FALSIFIABLE: put `myGain: true` back on `comboTableHtml`'s call to
  // `offerRow` and the first two of these fail immediately.
  ok('no combo row carries a per-deal “you gain”',
    combo.rows.length > 0 && combo.rows.every((r) => r.hasMyGain === false),
    JSON.stringify(combo.rows.map((r) => r.gainText)));
  ok('and no combo row carries its own lineup before-and-after',
    combo.rows.every((r) => r.hasLineup === false),
    JSON.stringify(combo.rows.map((r) => r.beforeAfter)));
  ok('the FINDER still carries both, so this is the combo’s rule and not a lost column',
    wk.after.trades.every((r) => r.hasMyGain && r.hasLineup),
    JSON.stringify(wk.after.trades.slice(0, 2).map((r) => [r.hasMyGain, r.hasLineup])));
  ok('the combo’s headings name only the manager’s own gain, never yours',
    !/You gain/.test(combo.heads.join(' | ')) && /He gains/.test(combo.heads.join(' | ')),
    combo.heads.join(' | '));
  ok('the whole packing’s lineup before-and-after is on the headline, once',
    /Your lineup, a week/i.test(combo.lineup) && /→/.test(combo.lineup) &&
      /\/wk/.test(combo.lineup),
    combo.lineup);
  // THE CLAIM STAYS IN VIEW — it changes what the number means, and Tim did
  // add the two figures up — but the REASON was printed three times on one
  // panel: in the lead above with this packing's own arithmetic in it, here,
  // and in "How this works". Two 55-word copies of it cost 223px at 390px.
  ok('and the panel says IN WORDS that it is one number and not two',
    /one number, not/i.test(combo.oneNumber) &&
      /priced as a single move/i.test(combo.oneNumber),
    combo.oneNumber.slice(0, 220));
  ok('with the reason behind the toggle rather than a third time on the panel',
    /no longer exists/i.test(combo.note) && !/no longer exists/i.test(combo.oneNumber),
    combo.note.slice(0, 400));
  // REPLACED with the finder's row: the combo's rows are the SAME markup, so
  // when the churn block came off one it had to come off the other. That they
  // agree is the point — one builder, one answer.
  ok('and carries no churn block either, exactly as the finder does not',
    combo.rows.every((r) => r.churn === ''),
    combo.rows.map((r) => r.churn.slice(0, 40)).join(' | '));
  ok('and offers the same week-by-week pop-up',
    combo.rows.every((r) => r.opener && /^c:\d+$/.test(r.openKey || '')),
    JSON.stringify(combo.rows.map((r) => r.openKey)));
  ok('and every man in it links to his row on the Players page',
    combo.names.length >= combo.rows.length * 2 &&
    combo.names.every((h) => /^waivers\.html\?player=\d+$/.test(h)),
    combo.names.slice(0, 3).join(' | '));
  // Demo has no ESPN league, so the cell says so rather than offering a dead
  // link — the same sentence the finder's rows carry. The deep link itself is
  // checked on the stubbed live league below, where there is one to build.
  ok('and the ESPN column is present and honest about demo',
    combo.rows.every((r) => /No ESPN league in demo/.test(r.espn)),
    combo.rows.map((r) => r.espn).join(' | '));

  // ---- ask 2: ONE number per player, and it is the per-week one ------------
  const everyMan = [
    ...wk.after.trades.flatMap((t) => [...t.send, ...t.receive]),
    ...combo.rows.flatMap((t) => [...t.send, ...t.receive]),
    ...((wk.deal && wk.deal.men) || []),
  ];
  ok('there are men on screen to check', everyMan.length > 0);
  ok('every player carries exactly ONE number',
    everyMan.every((m) => m.vals.length === 1),
    JSON.stringify(everyMan.filter((m) => m.vals.length !== 1).slice(0, 3)));
  ok('and it is the per-week one — no rest-of-season total beside a name',
    everyMan.every((m) => /\/wk$/.test(m.val) || m.val === '—'),
    JSON.stringify(everyMan.filter((m) => !/\/wk$/.test(m.val)).slice(0, 3)));
  ok('and the second number that used to sit beside it is gone',
    everyMan.every((m) => m.extras.length === 0),
    JSON.stringify(everyMan.filter((m) => m.extras.length).slice(0, 3)));
}

// ---- ask 5: the drill-down is a POP-UP, and only on demand -----------------

// ---- "Open in custom trades" (Tim, 2026-09-30) ------------------------------
{
  const cl = run('cuLoad');
  ok('the cuLoad scenario boots', !cl.boot, cl.boot);
  if (!cl.boot) {
    ok('OPEN IN CUSTOM: no console errors', cl.errors.length === 0, JSON.stringify(cl.errors).slice(0, 300));
    const good = (x, label) => {
      ok(`OPEN IN CUSTOM (${label}): the button is there`, x.hadButton, JSON.stringify(x).slice(0, 300));
      ok(`OPEN IN CUSTOM (${label}): the partner is picked on the right`,
        !!x.partner && x.pickedB === x.partner, `${x.pickedB} v ${x.partner}`);
      ok(`OPEN IN CUSTOM (${label}): your men are ticked on the left, his on the right, and nobody else`,
        (x.ticksA.length + x.ticksB.length) > 0 &&
          x.ticksA.every((n) => x.send.includes(n)) && x.ticksB.every((n) => x.recv.includes(n)),
        `A ${JSON.stringify(x.ticksA)} in "${x.send}"; B ${JSON.stringify(x.ticksB)} in "${x.recv}"`);
      ok(`OPEN IN CUSTOM (${label}): no pop-up left open`, !x.dealOpen);
    };
    good(cl.fromRow, 'row');
    ok('OPEN IN CUSTOM (row): says what it does', cl.fromRow.buttonText === 'Open in custom trades',
      cl.fromRow.buttonText);
    good(cl.fromPop, 'pop-up');
  }
}

const md = run('modal');
ok('the modal scenario boots', !md.boot, md.boot);
if (!md.boot) {
  ok('no console errors driving the pop-up', md.errors.length === 0,
    md.errors.slice(0, 2).join(' | '));
  ok('and opening and closing it costs no request', md.fetchCalls.length === 0,
    md.fetchCalls.join(' | '));

  // IT DOES NOT EXIST UNTIL SOMETHING IS CLICKED. Two separate claims: the
  // dialog is hidden, AND there is no week table sitting in the document where
  // a search or a screen reader would still find it. The panel this replaced
  // was only ever hidden, and this page has twice been caught leaving a stale
  // answer in a hidden container.
  ok('no pop-up before anything is clicked', md.before.hidden, 'the modal is open on load');
  ok('and no week-by-week table in the document at all', !md.before.present);
  eq(md.before.bodyLength, 0, 'and its body is empty rather than merely hidden');

  // It is a dialog, and it says so — which is what a screen reader announces.
  eq(md.opened.dialog.role, 'dialog', 'the pop-up is a dialog');
  eq(md.opened.dialog.labelledby, 'dealTitle', 'and is named by its own heading');
  // NOT `aria-modal`, and that is the decision rather than the omission: it
  // would tell a screen reader to ignore everything outside this element, and
  // the player card is a <body> child drawn OVER it. See trade.html.
  eq(md.opened.dialog.modal, null,
    'and does not claim modality it cannot honour — the player card is outside it');
  eq(md.opened.closeButton, 'BUTTON',
    'the close control is a real button — in the tab order, and worked by Enter');
  eq(md.parent, 'BODY',
    'the pop-up is a child of <body>, not of a scrolling panel');
  ok('nothing locked the page’s own scrolling',
    !/overflow/.test(md.bodyStyle), md.bodyStyle);

  // -- it opens from the finder, BY KEYBOARD ---------------------------------
  ok('the Week by week button opens it', !md.opened.hidden, JSON.stringify(md.opened).slice(0, 200));
  ok('and it holds the deal week by week', md.opened.present && md.opened.weeks &&
    md.opened.weeks.weeks.length > 1,
    md.opened.weeks ? `${md.opened.weeks.weeks.length} rows` : 'no table');

  // -- THREE WAYS OUT, and all three are tested ------------------------------
  ok('its own Close button shuts it', md.closedByButton.hidden);
  ok('and empties it on the way out', !md.closedByButton.present);
  ok('a row click opens it again', !md.reopened.hidden);
  ok('Escape shuts it', md.closedByEscape.hidden);
  ok('a click outside shuts it', md.closedByOutside.hidden);
  ok('but a click INSIDE it does not', !md.stillOpen.hidden,
    'clicking the note inside the pop-up closed it');

  // -- and it is reachable from the best combo, which is the other half ------
  ok('the combo has a row to open', md.hadComboRow, 'no combo row rendered');
  ok('clicking a combo row opens the same pop-up', !md.fromCombo.hidden);
  ok('and it is about THAT deal — the one with that manager',
    md.fromCombo.title.includes(md.comboPartner),
    `${md.fromCombo.title} vs ${md.comboPartner}`);
  ok('the combo’s pop-up is priced week by week too',
    md.fromCombo.weeks && md.fromCombo.weeks.weeks.length > 1,
    md.fromCombo.weeks ? `${md.fromCombo.weeks.weeks.length} rows` : 'no table');

  // -- and the WHOLE packing, which used to be a box under the list ---------
  ok('the combo headline offers its own week-by-week button',
    md.hadHeadButton && /week by week/i.test(md.headLabel), md.headLabel);
  ok('it opens the pop-up on the whole combination',
    !md.wholeCombo.hidden && md.wholeCombo.present,
    JSON.stringify(md.wholeCombo).slice(0, 200));
  ok('and says it is the combination rather than one trade',
    /combination/i.test(md.wholeCombo.weeks.heads.join(' ')),
    md.wholeCombo.weeks.heads.join(' | '));
  if (md.wholeCombo.weeks) {
    const rows = md.wholeCombo.weeks.weeks;
    const totalRow = md.wholeCombo.weeks.totalRow;
    const sum = rows.reduce((a, r) => a + r.delta, 0);
    ok('the combination’s own rows add up to its own total',
      Math.abs(sum - totalRow.delta) <= 0.05 * rows.length + 0.051,
      `rows sum to ${sum.toFixed(2)}, total says ${totalRow.delta}`);
  }
  ok('and says there is no single ESPN screen for a combination',
    /no one ESPN screen/.test(md.wholeCombo.body), md.wholeCombo.body.slice(-240));

  // NOT A BOX BELOW EVERYTHING any more. The whole of ask 5 is that this stuff
  // lives in the pop-up, so a week table anywhere else on the page is the
  // defect coming back.
  eq(md.strayWeekTables, 0, 'no week-by-week table is printed outside the pop-up');
}

// ---- `hidden` has to WIN over the pop-up's own `display` ------------------
//
// Tim's report, 2026-09-16: the pop-up sat over the page from load and Close
// did nothing. The JS was right all along — every assertion above passed —
// because linkedom reads the `hidden` PROPERTY and applies no CSS. In a browser
// `.modal { display: flex }` outranks the user agent's `[hidden]` rule, so the
// element was hidden in the DOM and fully drawn on screen. Only the stylesheet
// can be checked here, so it is.
{
  const css = readFileSync(path.join(REPO, 'css/app.css'), 'utf8');
  ok('the shared stylesheet makes [hidden] beat any class’s display',
    /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(css),
    'css/app.css has no `[hidden] { display: none !important }`');
  for (const page of ['trade.html', 'analysis.html', 'schedule.html', 'waivers.html',
    'stats.html', 'index.html', 'summary.html']) {
    const html = readFileSync(path.join(REPO, page), 'utf8');
    ok(`${page} links the stylesheet that carries it`,
      /<link[^>]+href="css\/app\.css/.test(html));
  }
}

// ---- live opens on YOUR team, and only your team links to ESPN -------------

const lo = run('liveOtherTeam', { stub: true });
ok('the other-team scenario boots', !lo.boot, lo.boot);
if (!lo.boot) {
  ok('no console errors', lo.errors.length === 0, lo.errors.slice(0, 2).join(' | '));
  eq(lo.opened, '1', 'the live league opens on your own team, not a remembered one');
  ok('your own team gets ESPN links', lo.ownLinks > 0, `${lo.ownLinks} links`);
  ok('another manager’s squad has rows to judge', lo.otherRows > 0, `${lo.otherRows} rows`);
  eq(lo.otherLinks, 0, 'but no ESPN link — ESPN only proposes from your own team');
  ok('and every row says why', lo.cells.every((c) => /Only from your own team/.test(c)),
    lo.cells.slice(0, 3).join(' | '));
  eq(lo.afterWeek, lo.otherName, 'a squad picked by hand survives a change of week');
}

// ---- the pop-up fetches its own weeks: "not just words" --------------------

const up = run('unpriced');
ok('the unpriced scenario boots', !up.boot, up.boot);
if (!up.boot) {
  ok('no console errors', up.errors.length === 0, up.errors.slice(0, 2).join(' | '));
  ok('demo still costs no request', up.fetchCalls.length === 0, up.fetchCalls.join(' | '));
  eq(up.before.measure, 'typical', 'a saved choice of a typical week is honoured');
  ok('no pop-up on load', up.before.deal.hidden && !up.before.deal.present);
  ok('clicking a deal opens it at once', !up.immediately.hidden);
  ok('and it does not tell him to press a button first',
    !/Press/.test(up.immediately.body) && !/Press/.test(up.deal.body), up.deal.body.slice(0, 200));
  ok('it fills with the week-by-week table whatever measure the page is on',
    !up.deal.hidden && up.deal.weeks && up.deal.weeks.weeks.length > 1,
    up.deal.weeks ? `${up.deal.weeks.weeks.length} rows` : up.deal.body.slice(0, 200));
  ok('one row per remaining week, with numbers in it',
    up.deal.weeks && up.deal.weeks.weeks.every((r) => Number.isFinite(r.before) && Number.isFinite(r.after)),
    JSON.stringify(up.deal.weeks && up.deal.weeks.weeks.slice(0, 2)));
  ok('it is the deal that was clicked', up.deal.title.includes(up.title), `${up.deal.title} vs ${up.title}`);
  ok('and it says the list behind was ranked another way',
    /ranked on a typical week/.test(up.deal.note), up.deal.note.slice(0, 200));
  eq(up.measure, 'typical', 'the page measure is left as he chose it');
  ok('and the list behind is not re-ranked',
    JSON.stringify(up.afterTrades.map((t) => t.myGain)) === JSON.stringify(up.before.trades.map((t) => t.myGain)));
  ok('and the button offers a re-read rather than a purchase',
    /Rebuild|Re-read/.test(up.cost.button), up.cost.button);
  ok('Close still shuts it', up.closed.hidden && !up.closed.present);
}

const uw = run('unpricedWeeksChosen');
ok('the weeks-chosen scenario boots', !uw.boot, uw.boot);
if (!uw.boot) {
  ok('no console errors', uw.errors.length === 0, uw.errors.slice(0, 2).join(' | '));
  ok('the pop-up survives the re-rank the page does to itself',
    !uw.deal.hidden && uw.deal.weeks && uw.deal.weeks.weeks.length > 1,
    uw.deal.weeks ? `${uw.deal.weeks.weeks.length} rows` : uw.deal.body.slice(0, 200));
  ok('and has no ranked-another-way caveat, because now it was not',
    !/ranked on/.test(uw.deal.note), uw.deal.note.slice(0, 120));
  eq(uw.measure, 'weeks', 'the page is on the weekly measure with nothing pressed');
  ok('Close still shuts it', uw.closed.hidden);
}

// ---- a real league, stubbed: the cost, the ranking, and the ESPN link ------

const live = run('live', { stub: true });
ok('the live scenario boots', !live.boot, live.boot);
if (!live.boot) {
  ok('no console errors on live data', live.errors.length === 0,
    live.errors.slice(0, 2).join(' | '));
  eq(live.before.badge, 'Live', 'the stubbed league puts the page on live data');

  // -- THE COST, COUNTED AND STATED -----------------------------------------
  //
  // THE PAGE BUYS THE WEEKS ITSELF NOW (Tim, 2026-09-19). What this block used
  // to assert — "nothing was spent before the button was pressed", one request
  // on load — was the truth of its day and is the exact thing he asked to be
  // rid of. What has NOT changed, and is the half worth keeping, is that every
  // request is counted and named: a page that spends sixteen and says ten is
  // worse than one that waits to be asked.
  //
  // THE COMING WEEK, not the last one played (2026-09-17). The week picked is
  // also the week whose ROSTERS the finder reads, so opening on week 4 left out
  // every pickup made since. Weeks 1-4 have results; 5 is the first without.
  eq(live.before.week, String(live.played + 1), 'a live league opens on the first week NOT yet played');
  eq(live.before.asked[0], live.played + 1, 'and that is the FIRST week of rosters it reads');
  const span = live.span;           // every week with no result against it
  const whole = live.weeksAll;      // the span, the played weeks, and the bracket
  ok('it reads the whole season, not just the span it prices',
    live.before.requests === whole,
    `${live.before.requests} requests for ${whole} weeks (span ${span}, played ${live.played})`);
  ok('and asks for each week exactly once',
    new Set(live.before.asked).size === live.before.asked.length,
    live.before.asked.join(','));
  ok('the span it PRICES is still the unplayed weeks only',
    live.before.asked.slice(0, span).every((w) => w > live.played),
    live.before.asked.slice(0, span).join(','));
  ok('the played weeks come AFTER the priced ones — the answer first, the history behind it',
    live.before.asked.slice(span, span + live.played).every((w) => w <= live.played),
    live.before.asked.join(','));
  ok('the spent line says how many went, and does not leave the opening week out',
    live.before.cost.spent.includes(`${whole} requests spent`), live.before.cost.spent);
  ok('the cost note still says what the priced span costs, one request per week',
    live.before.cost.note.includes(`The span itself is ${span} requests`),
    live.before.cost.note.slice(0, 500));
  // AND THAT A CHEAP MEASURE IS NO LONGER A CHEAP PAGE. It used to say "this
  // page costs ONE request on the other two measures", which stopped being
  // true the day it started reading the whole season on load — the card and
  // the pop-up want those weeks whichever measure is drawn. A note that still
  // said the old thing would be the page understating what it spends.
  ok('and says plainly that the other measures are not cheaper',
    /does not make the page cheaper/.test(live.before.cost.note),
    live.before.cost.note.slice(0, 700));
  ok('and names the weeks it reads but never prices',
    /shows but does not price/.test(live.before.cost.note),
    live.before.cost.note.slice(0, 700));
  // THE RE-READ'S FACE NAMES WHAT IT WILL ACTUALLY SPEND. It buys the played
  // weeks and the bracket back too, so quoting the priced span alone would
  // understate the press by about a third — understating a cost is the one
  // dishonesty this project avoids, and the button's face is where that rule
  // is enforced.
  ok('the button is a re-read, and its face names the whole season',
    /Re-read/.test(live.before.cost.button) &&
    live.before.cost.button.includes(`${whole} requests`),
    live.before.cost.button);

  // Pressing it really does read them all again, and counts from zero.
  eq(live.after.requests, whole * 2, 'a re-read spends one request per week, again');
  ok('and the spent line restarts rather than reporting a lifetime figure',
    live.after.cost.spent.includes(`${whole} requests spent`), live.after.cost.spent);

  // -- THE ACT ROW STOPPED BEING EMPTY -------------------------------------
  //
  // Tim, 2026-09-19: "right now in the trade section it shows the act in the
  // preview, but it doesn't actually display any previous weeks in the chart,
  // so that whole row is useless."
  //
  // He was right, and it was structural rather than a bug. The card's run
  // covered the weeks this page HELD, and this page only ever bought the
  // REMAINING span — because a trade cannot move banked points. An "Act" row is
  // actual points, and actual points only exist for a week that has been
  // PLAYED. So the row was empty for every player here, every time, by
  // construction.
  //
  // THIS IS THE SCENARIO THAT CAN TELL, and demo is not: there the span and the
  // season coincide. Here weeks 1-4 have results and the span is 5-14.
  // FALSIFIABLE: make `loadHistory()` return early and the first four cells go
  // back to the card's "not read" dot with nothing in Act at all.
  if (live.liveCard) {
    const act = live.liveCard.rows.Act || [];
    const proj = live.liveCard.rows.Proj || [];
    ok('the card runs from week 1', /for weeks 1–\d+/i.test(live.liveCard.heading),
      live.liveCard.heading);
    eq(act.length, proj.length, 'with an Act cell for every Proj cell');
    const scored = act.filter((t) => /^\d+(\.\d+)?$/.test(t));
    ok('and the Act row carries real numbers for the weeks already played',
      scored.length >= live.played,
      `${scored.length} actuals for ${live.played} played weeks — ${act.join(',')}`);
    ok('and only for those weeks — a week still to come has no actual',
      act.slice(live.played).every((t) => !/^\d+(\.\d+)?$/.test(t)),
      act.join(','));
    ok('the starts count names the squad and the weeks it is over',
      /in the best lineup for \w+ in \d+ of \d+ weeks read/.test(live.liveCard.heading),
      live.liveCard.heading);
  } else {
    ok('a card opened on the live page', false, 'no card');
  }

  // -- THE TWO BASES STILL DISAGREE ----------------------------------------
  //
  // The fixture's point: Ana holds two quarterbacks who alternate 19 and 7, so
  // on one scalar per man she looks weak at QB and Bo's steady 17 is a +4
  // upgrade — while across the weeks she already starts a 19 every week and the
  // 17 is worth nothing. The scalar basis must offer that trade and the weekly
  // one must not.
  //
  // READ THE OTHER WAY ROUND NOW, because the page opens on the weekly measure:
  // `scalar` is what a reader sees having deliberately picked a typical week,
  // and `after` is the page left alone. Which end the comparison starts from
  // does not matter — that the two disagree is the whole claim.
  const gotQB = (list) => list.filter((t) => /Bo QB/.test(names(t.receive)));
  ok('on a typical week the page offers the steady quarterback',
    gotQB(live.scalar.trades).length > 0,
    live.scalar.trades.map((t) => names(t.receive)).join(' | '));
  ok('and across the weeks it does NOT — three quarterbacks already cover it',
    gotQB(live.after.trades).length === 0,
    gotQB(live.after.trades).map((t) => names(t.receive)).join(' | '));
  ok('while the deal that survives both measures is still there',
    live.after.trades.some((t) => t.partner === 'Cy'),
    live.after.trades.map((t) => t.partner).join(','));

  // -- THE ESPN DEEP LINK ---------------------------------------------------
  ok('the offer drilled into is with Cy', live.offer && live.offer.partner === 'Cy',
    JSON.stringify(live.offer && live.offer.partner));
  if (live.offer) {
    const url = live.offer.espn;
    ok('every live offer carries an ESPN deep link',
      /^https:\/\/fantasy\.espn\.com\/football\/team\/trade\?/.test(url), url);

    const q = new URLSearchParams(url.split('?')[1] || '');
    eq(q.get('leagueId'), '476225250', 'the link names the league');
    eq(q.get('seasonId'), '2026', 'and the season');
    eq(q.get('teamId'), '3', 'teamId is the PARTNER — whose screen it opens');
    eq(q.get('fromTeamId'), '1', 'fromTeamId is you');
    eq(q.get('step'), '1', 'and it starts at step 1');

    const ids = (q.get('players') || '').split(',').filter(Boolean);
    ok('it pre-ticks at least one player', ids.length > 0, q.get('players'));
    // An id not on that roster is ignored by ESPN in silence, which is the
    // worst kind of wrong: a screen that opens with one man ticked and no
    // explanation. Re-derived from the fixture's own rosters.
    ok('and every id it names is on THAT manager’s roster',
      ids.every((id) => live.rosters[3].includes(Number(id))),
      `${ids.join(',')} vs ${live.rosters[3].join(',')}`);
    ok('and none of them is one of your own men',
      ids.every((id) => !live.rosters[1].includes(Number(id))),
      ids.join(','));
    ok('it names exactly the men you would receive',
      ids.length === live.offer.receive.length,
      `${ids.length} ids for ${live.offer.receive.length} incoming`);

  }
  // A button that pre-ticks half a trade and says nothing reads as broken on
  // the first click, so the words are part of the feature rather than a
  // courtesy.
  ok('the finder note explains that only HIS side is ticked',
    /HIS players ticked only/.test(live.after.note), live.after.note.slice(-500));
  ok('and that nothing is sent to ESPN from here',
    /Nothing is sent to ESPN/.test(live.after.note), live.after.note.slice(-500));

  // -- clicking it actually gets him to ESPN (Tim, 2026-09-16: "the open in
  //    espn isn't working") ------------------------------------------------
  const ec = live.espnClick;
  ok('there is an Open in ESPN link to click', ec.had);
  ok('the click is taken over, to stage your side first', ec.prevented);
  eq(ec.opens, 1, 'exactly one tab is opened — not a blank one and then a blocked one');
  eq(ec.landed, ec.href, 'and that tab lands on the trade link');
  eq(ec.opener, null, 'with its opener cut, as noopener would have done');
  ok('the Trade page itself stays put', !ec.pageMoved);
  // Tim, same day: "my side of the trade still has no players selected". Every
  // way that can happen used to be silent; the page now says which one it was.
  ok('the page says what became of YOUR side', ec.outcomeShown);
  ok('and, with no extension here, that it is not ticked and why',
    ec.outcomeBad && /extension isn’t running/.test(ec.outcome) && /yourself/.test(ec.outcome),
    ec.outcome);
  ok('and the message can be dismissed', ec.outcomeDismissed);

  if (live.deal && !live.deal.hidden) {
    ok('the deal panel offers the same deep link',
      /^https:\/\/fantasy\.espn\.com\/football\/team\/trade\?/.test(live.deal.espn),
      live.deal.espn);
    ok('and says in words that your own side is not ticked',
      /no parameter for your own side/.test(live.deal.body), live.deal.body.slice(-400));
    ok('the pop-up’s link is registered, so it can stage your side too', live.dealLinkKeyed);
    ok('the deal covers every remaining week',
      live.deal.weeks && live.deal.weeks.weeks.length === span,
      live.deal.weeks ? `${live.deal.weeks.weeks.length} rows` : 'no table');
    if (live.deal.weeks) {
      const rows = live.deal.weeks.weeks;
      const sum = rows.reduce((a, r) => a + r.delta, 0);
      ok('and its rows sum to its total',
        Math.abs(sum - live.deal.weeks.totalRow.delta) <= 0.05 * rows.length + 0.051,
        `${sum} vs ${live.deal.weeks.totalRow.delta}`);
    }
  }

  // =========================================================================
  // RE-DERIVED FROM THE FIXTURE, with the engine and none of the page
  // =========================================================================
  //
  // Everything above this line reads the page and checks it is self-consistent.
  // Everything below rebuilds the same four squads from tr-stub-season.mjs,
  // prices them with js/trade.js directly, and insists the page agrees. A page
  // printing a plausible wrong number has nowhere to hide in here.

  const L = await stubLeague();
  const {
    priceTradeAcrossWeeks, mergeComboByPartner, depthTable, findTrades,
  } = await import(moduleUrl('js/trade.js'));

  // FROM THE STUB'S OWN SEASON LENGTH, never a literal 13. The stub plays
  // FOURTEEN regular-season weeks, the way Tim's league does, precisely so the
  // week-13 cap the page used to enforce is visible here — with a 13-week
  // fixture the cap and the schedule agreed and this suite passed either way.
  const lastWeek = (await import('./tr-stub-season.mjs')).WEEKS;
  const unplayed = weekRange(live.played + 1, lastWeek);   // what the page must price
  const withPlayed = weekRange(live.played, lastWeek);     // what it used to price
  const me = L.teams.find((t) => t.id === 1);
  const priceOver = (weeks, sendIds, receiveIds) =>
    priceTradeAcrossWeeks({
      players: me.players,
      send: sendIds.map((id) => L.byId.get(id) || id),
      receive: receiveIds.map((id) => L.byId.get(id)).filter(Boolean),
      slots: L.slots,
      weeks,
      projFor: L.projFor,
      zeroIsBye: true,
    });

  // -- (H) BOLD WEEKS: "he starts", and for WHOSE lineup ---------------------
  //
  // Tim, 2026-09-19: "in the 14 week preview when you hover over a player in
  // the trade section, if you are hovering over a player you currently own,
  // then bold all the week #s that that player is currently projected to start
  // for you (and stop bolding the current week, however put a line after the
  // last week and current week to separate what's already happened). If you're
  // hovering over another user's player (that you're trading for), then bold
  // all the week #s that that player would start for you IF the trade would be
  // made."
  //
  // TWO DIFFERENT QUESTIONS, and the whole of this is that the page asks the
  // right one of each man. Both answers are RE-DERIVED here from the fixture
  // and `optimalLineup` — the with-trade one by solving over (his roster that
  // week − what he sends + what he receives) — so a page that answered "does he
  // start for his own manager" for a man it is trading FOR would fail, and it
  // would fail on the weeks where the two answers differ rather than on all of
  // them.
  //
  // FALSIFIABLE: make `startsRun` ignore its context and return the own-squad
  // answer for everybody, and the "with the trade made" assertions below fail.
  if (live.topOffer && live.sendCard && live.getCard) {
    const { optimalLineup } = await import(moduleUrl('js/forecast.js'));
    const sendIds = live.topOffer.send.map((m) => m.id);
    const recvIds = live.topOffer.receive.map((m) => m.id);
    const now = live.openWeek;

    /** Team 1's best lineup in one week, optionally with the deal made. */
    const startersAt = (w, trade) => {
      const gone = new Set(trade ? sendIds : []);
      const pool = me.players
        .filter((p) => !gone.has(p.playerId))
        .concat(trade ? recvIds.map((id) => L.byId.get(id)).filter(Boolean) : [])
        .map((p) => ({ ...p, projected: L.projFor(p, w) }));
      return new Set(optimalLineup(pool, L.slots).starters.map((s) => s.playerId));
    };
    // Every week the CARD covers, which is the whole season and then the
    // bracket — read off the card itself rather than assumed.
    const cardWeeks = live.sendCard.weeks.map(Number).filter((w) => Number.isFinite(w));
    const future = cardWeeks.filter((w) => w > now);

    ok('the card covers more weeks than the span, because the past is in it',
      cardWeeks.length > future.length, `${cardWeeks.length} weeks, ${future.length} still to come`);

    // A MAN OF HIS OWN, in the You send column: his own manager's lineup.
    const mineWant = future.filter((w) => startersAt(w, false).has(live.topOffer.send[0].id));
    eq(live.sendCard.bold.join(','), mineWant.join(','),
      'a man he owns bolds the weeks he makes his OWN squad’s best lineup');
    ok('and the card says so in words, not only in weight',
      live.sendCard.notes.some((n) => /Bold, underlined week numbers/.test(n) &&
        /own squad/i.test(n) && /no trade made/i.test(n)),
      JSON.stringify(live.sendCard.notes));

    // A MAN HE IS TRADING FOR, in the You get column: HIS OWN lineup, with the
    // deal made. Solved over the post-trade roster, which is a different pool.
    const theirsWant = future.filter((w) => startersAt(w, true).has(live.topOffer.receive[0].id));
    eq(live.getCard.bold.join(','), theirsWant.join(','),
      'a man he is trading FOR bolds the weeks he would make HIS lineup with the trade made');
    ok('and the card says that is what bold means here',
      live.getCard.notes.some((n) => /WITH THIS TRADE MADE/i.test(n)),
      JSON.stringify(live.getCard.notes));
    ok('the two cards do not say the same thing about what bold means',
      JSON.stringify(live.sendCard.notes) !== JSON.stringify(live.getCard.notes),
      JSON.stringify(live.getCard.notes));
    // NOT VACUOUS. A page that answered "he starts nowhere" for everybody
    // would satisfy an equality between two empty lists, so at least one of
    // the two has to have bolded something.
    ok('and at least one of the two cards actually bolds weeks',
      live.sendCard.bold.length + live.getCard.bold.length > 0,
      `${live.sendCard.bold.length} / ${live.getCard.bold.length}`);
    // AND THE ANSWER IS NOT HIS OWN MANAGER'S. This is the half a page without
    // the trade context would have got wrong: a man on somebody else's squad
    // cannot be in YOUR lineup at all until the deal is made, so the pre-trade
    // answer for him is empty — and the card must not be printing that.
    const before = future.filter((w) => startersAt(w, false).has(live.topOffer.receive[0].id));
    ok('a man he is trading for starts in NO week of his lineup as it stands',
      before.length === 0, before.join(','));
    ok('so the weeks bolded on his card can only come from the with-trade solve',
      live.getCard.bold.length > 0 && before.join(',') !== live.getCard.bold.join(','),
      `pre-trade ${before.join(',')} vs card ${live.getCard.bold.join(',')}`);
    // WHOSE LINEUP, BY NAME. The two answers can legitimately COINCIDE for a
    // man who starts everywhere — he makes his own manager's lineup every week
    // and yours every week too — so a set comparison alone can pass while the
    // page is silently answering the wrong question. The card names the squad
    // it solved against, and that cannot coincide: a man you are trading for
    // must be measured against YOUR squad, never against the one he is on.
    const mineName = (live.after.depth.rows.find((r) => r.me) || {}).team || '';
    ok('the card for a man he is trading for names HIS OWN squad, not the seller’s',
      mineName.length > 0 &&
      live.getCard.notes.some((n) => /Bold, underlined/.test(n) && n.includes(mineName) &&
        !n.includes(live.topOffer.partner)),
      `${mineName} vs ${live.topOffer.partner} — ${JSON.stringify(live.getCard.notes)}`);

    // THE CURRENT WEEK STOPS BEING BOLD, and everything before it. "Who started
    // week 3" is a fact, not a forecast, and no trade can reach it.
    ok('no week at or before the one on screen is bold, on either card',
      live.sendCard.bold.every((w) => w > now) && live.getCard.bold.every((w) => w > now),
      `week ${now} · ${live.sendCard.bold.join(',')} / ${live.getCard.bold.join(',')}`);
    // AND THE LINE AFTER IT. The divider falls on the first week still to come.
    eq(live.sendCard.splitAt, now + 1,
      'and a heavy line falls before the first week still to come');
    ok('which the card also says in words',
      live.sendCard.notes.some((n) => /heavy line before week/i.test(n)),
      JSON.stringify(live.sendCard.notes));
  } else {
    ok('both cards opened out of one offer', false,
      JSON.stringify([!!live.topOffer, !!live.sendCard, !!live.getCard]));
  }

  // ---- ask 1: a week already played changes nothing -----------------------

  eq(unplayed.length, span, 'the weeks with no result against them are the span');

  if (live.offer && live.deal && live.deal.weeks) {
    const sendIds = live.offer.send.map((m) => m.id);
    const recIds = live.offer.receive.map((m) => m.id);
    const fresh = priceOver(unplayed, sendIds, recIds);
    const stale = priceOver(withPlayed, sendIds, recIds);

    ok('the offer’s gain is the deal priced over the UNPLAYED weeks, exactly',
      Math.abs(fresh.delta - live.offer.myGain) <= 0.15,
      `page ${live.offer.myGain}, engine over ${weekLabel(unplayed)} ${fresh.delta}`);
    // The half that makes the assertion above falsifiable: the old span really
    // would have produced a different number, so agreeing with the new one is
    // a fact rather than a coincidence.
    ok('and the old span — with the PLAYED week 4 included — differs',
      Math.abs(stale.delta - fresh.delta) > 0.15,
      `${weekLabel(unplayed)} ${fresh.delta} vs ${weekLabel(withPlayed)} ${stale.delta}`);

    ok('no PRICED row of the week-by-week table is a week that has been played',
      live.deal.weeks.weeks.every((r) => Number(String(r.label).replace(/\D/g, '')) > live.played),
      live.deal.weeks.weeks.map((r) => r.label).join(','));

    // Tim, 2026-09-16: show the played weeks, but above a line and in white.
    const past = live.deal.weeks.past;
    eq(past.map((r) => r.label).join(','),
      Array.from({ length: live.played }, (_, i) => `Week ${i + 1}`).join(','),
      'every played week is shown, in order, for reference');
    ok('all of them above the line', past.length > 0 && past.every((r) => r.aboveLine));
    ok('and none of them red or green', past.every((r) => !r.coloured));
    ok('the line says they are not counted', /not counted/.test(live.deal.weeks.divider),
      live.deal.weeks.divider);

    // ---- the playoff weeks: shown after the totals, priced into nothing ------
    //
    // The stub is a 14-week, four-team league, so capture.playoffWeeks gives a
    // two-round bracket in weeks 15–16. Re-derived with the engine: each row is
    // that week's own before/after, and the offer's figure is still the
    // unplayed REGULAR weeks alone — while pricing the playoff weeks in would
    // have moved it, so the agreement is a fact and not a coincidence.
    {
      const po = live.deal.weeks.playoff;
      const poWeeks = [lastWeek + 1, lastWeek + 2];
      ok('LIVE: the playoff weeks are shown after the totals, below their own line, uncoloured',
        po.map((r) => r.week).join(',') === poWeeks.join(',') &&
          po.every((r) => r.belowLine && r.afterTotals && !r.coloured),
        JSON.stringify(po));
      const truth = priceOver(poWeeks, sendIds, recIds).byWeek;
      ok('LIVE: each playoff row is the engine’s own lineup for that week',
        po.length === truth.length && po.every((r, i) =>
          Math.abs(r.before - truth[i].before) <= 0.051 &&
          Math.abs(r.after - truth[i].after) <= 0.051 &&
          Math.abs(r.delta - truth[i].delta) <= 0.051),
        `${JSON.stringify(po)} vs ${JSON.stringify(truth)}`);
      const withPo = priceOver([...unplayed, ...poWeeks], sendIds, recIds);
      ok('LIVE: THE TOTAL AND THE PER-WEEK FIGURE ARE UNCHANGED BY THEM',
        Math.abs(live.deal.weeks.totalRow.delta - fresh.delta) <= 0.15 &&
          Math.abs(live.deal.weeks.perRow.delta - fresh.delta / unplayed.length) <= 0.06 &&
          Math.abs(live.offer.myGain - fresh.delta) <= 0.15,
        `total ${live.deal.weeks.totalRow.delta}, per week ${live.deal.weeks.perRow.delta}, ` +
        `row ${live.offer.myGain}, engine ${fresh.delta}`);
      ok('LIVE: and pricing the playoff weeks in WOULD have moved it',
        Math.abs(withPo.delta - fresh.delta) > 0.15,
        `${fresh.delta} vs ${withPo.delta} with the playoffs`);
    }
    // THE NUMBER TIM CHECKED BY HAND: the total must be the priced rows alone.
    // If a played week leaked in, the total would be off by that week's delta.
    {
      const sumPriced = live.deal.weeks.weeks.reduce((a, r) => a + r.delta, 0);
      const sumPast = past.reduce((a, r) => a + r.delta, 0);
      const total = live.deal.weeks.totalRow.delta;
      ok('the total is the rows below the line, and only those',
        Math.abs(sumPriced - total) <= 0.05 * live.deal.weeks.weeks.length + 0.051 &&
          (Math.abs(sumPast) < 0.05 || Math.abs(sumPriced + sumPast - total) > 0.05),
        `below ${sumPriced.toFixed(1)}, above ${sumPast.toFixed(1)}, total ${total}`);
    }
  }

  // The fixture's loud played week: Cy's tight end projects 30 in weeks 1-4 and
  // 4 from week 5 on. The depth map's per-week basis must be built from the 4.
  const meanOver = (weeks) => (p) => {
    let sum = 0;
    let counted = 0;
    let byes = 0;
    for (const w of weeks) {
      const v = L.projFor(p, w);
      if (v === null) continue;
      sum += v;
      counted++;
      if (v === 0) byes++;
    }
    const playable = weeks.length - byes;
    return counted && playable > 0 ? Math.round((sum / playable) * 10) / 10 : null;
  };
  const mapRight = depthTable(L.teams, L.slots, meanOver(unplayed));
  const mapWrong = depthTable(L.teams, L.slots, meanOver(withPlayed));
  const cyRow = live.after.depth.rows.find((r) => r.team === 'Cy');
  if (cyRow) {
    // His LINEUP, not his tight-end cell: the cell is points above the
    // replacement bar, and Cy's tight end IS the bar — he is the worst in the
    // league at it either way, so the cell reads 0.0 on both spans and could
    // never tell them apart. The lineup total is the number the 30 would move.
    const shown = Number(cyRow.total);
    const right = mapRight.rows.find((r) => r.team.name === 'Cy').total;
    const wrong = mapWrong.rows.find((r) => r.team.name === 'Cy').total;
    ok('the depth map’s per-week basis is the unplayed weeks too',
      Math.abs(shown - right) <= 0.15, `page ${shown}, engine ${right}`);
    ok('and week 4’s 30-point tight end is nowhere in it',
      Math.abs(right - wrong) > 0.15 && Math.abs(shown - wrong) > 0.15,
      `unplayed ${right}, with the played week ${wrong}, page ${shown}`);
  }

  // The bar every tight-end cell is measured against is the same fact said out
  // loud, and the page prints it in a chip. It must be Cy's 4, not his 6.6.
  const teBar = (map) => {
    const r = map.replacement.get('TE');
    return r ? r.value : null;
  };
  const teChip = live.after.depth.bars.find((b) => /^TE /.test(b)) || '';
  ok('and the replacement bar it prints says the same',
    teChip.includes(teBar(mapRight).toFixed(1)) &&
    !teChip.includes(teBar(mapWrong).toFixed(1)),
    `chip "${teChip}" — unplayed ${teBar(mapRight)}, with the played week ${teBar(mapWrong)}`);

  // ---- ask 3: the per-week figure ignores the bye, hand-computed ----------
  //
  // `Bills D/ST` is Ana's spare defence: 11 a week, and 0.00 in week 8 because
  // his NFL team is off. Nine weeks are priced and one of them is a bye, so the
  // arithmetic is 88 / 8 and not 88 / 9. Both are written out here rather than
  // imported, because a test that took the divisor from the code it is testing
  // would agree with any divisor.
  const BILLS = 112;   // team 1, roster slot 12 — see tr-stub-season.mjs
  const run112 = unplayed.map((w) => L.stub.projectionFor(1, 12, w));
  const byeCount = run112.filter((v) => v === 0).length;
  const total112 = run112.reduce((a, v) => a + v, 0);
  const perPlayed = total112 / (unplayed.length - byeCount);
  const perSpan = total112 / unplayed.length;

  eq(byeCount, 1, 'the fixture really does put a bye inside the priced span');
  ok('and the two readings of it are far enough apart to tell apart',
    Math.abs(perPlayed - perSpan) > 0.5,
    `${perPlayed.toFixed(1)} vs ${perSpan.toFixed(1)}`);

  const bills = live.men.find((m) => m.id === BILLS);
  ok('the man with the bye is on screen', !!bills,
    live.men.map((m) => m.id).join(','));
  if (bills) {
    eq(bills.val, `${perPlayed.toFixed(1)}/wk`,
      `his per-week figure is ${total112} over ${unplayed.length - byeCount} weeks he PLAYS`);
    ok('and it is not the average that counts the bye as a week',
      bills.val !== `${perSpan.toFixed(1)}/wk`,
      `${bills.val} is ${total112}/${unplayed.length}, which counts his bye`);
  }

  // ---- ask 4: no position label on a defence, and still one on a QB -------

  const posOf = (id) => {
    const team = L.stub.TEAMS.find((t) => t.id === Math.floor(id / 100));
    const p = team ? team.players[id % 100] : null;
    return p ? p.position : null;
  };
  const named = [...live.men, ...live.menBefore].filter((m) => m.id !== null);
  const defences = named.filter((m) => posOf(m.id) === 'DST');
  const quarterbacks = named.filter((m) => posOf(m.id) === 'QB');

  ok('a defence is actually rendered somewhere, or this proves nothing',
    defences.length > 0, named.map((m) => `${m.id}:${posOf(m.id)}`).join(' '));
  ok('and no defence carries a position tag — his name already says D/ST',
    defences.every((m) => m.pos === ''),
    JSON.stringify(defences.filter((m) => m.pos !== '').slice(0, 3)));
  ok('and the name really does carry it, which is why the tag is redundant',
    defences.every((m) => /D\/ST/.test(m.text)),
    defences.map((m) => m.text).join(' | '));
  ok('a quarterback is rendered too, so the rule is not "suppress everything"',
    quarterbacks.length > 0);
  ok('and he still carries his position tag',
    quarterbacks.every((m) => m.pos === 'QB'),
    JSON.stringify(quarterbacks.slice(0, 3)));

  // ---- ask 6: the merged combo row ---------------------------------------
  //
  // On the whole finder the combo now takes the 2-for-2 (Cy's 104+110 for
  // 301+303) as ONE deal, so nothing needs merging there. Narrowed to 1-for-2
  // deals the same stub still packs two Cy deals, which is what these checks
  // are about — the merge itself, not which kind of deal wins.
  const lm = run('live', { stub: true, env: { TR_KIND: 'depth' } });
  ok('the narrowed live scenario boots', !lm.boot, lm.boot);
  ok('and it really is narrowed to 1-for-2 deals',
    (lm.after.combo.rows || []).every((r) => r.receive.length > r.send.length),
    JSON.stringify((lm.after.combo.rows || []).map((r) => [r.send.length, r.receive.length])));
  ok('the whole-finder combo is not empty either',
    live.after.combo.rows.length > 0, JSON.stringify(live.after.combo.rows));

  const merged = lm.after.combo.rows.find((r) => r.merged);
  ok('two deals with one manager are shown as ONE offer',
    !!merged, JSON.stringify(lm.after.combo.rows.map((r) => [r.partner, r.merged])));
  if (merged) {
    ok('and the row says so, because a four-player trade is a different conversation',
      /deals? as one/.test(merged.mergedText), merged.mergedText);

    // ONE LINK, CARRYING ALL OF IT. A merged deal that opened ESPN with half
    // its players ticked would be worse than two rows.
    const q = new URLSearchParams((merged.espn || '').split('?')[1] || '');
    const linkIds = (q.get('players') || '').split(',').filter(Boolean).map(Number);
    const incoming = merged.receive.map((m) => m.id);
    ok('one ESPN link, carrying every man coming from that manager',
      incoming.length > 1 &&
      linkIds.length === incoming.length &&
      incoming.every((id) => linkIds.includes(id)),
      `link ${linkIds.join(',')} for incoming ${incoming.join(',')}`);
    ok('and every one of them is on that manager’s roster',
      linkIds.every((id) => lm.rosters[3].includes(id)), linkIds.join(','));

    // -- (A) THE COMBO PRINTS ONE "YOU GAIN", AND IT IS THE HEADLINE ------
    //
    // Tim, 2026-09-19: "right now the best combo just shows the two trades
    // separately. I want their stats to be combined ... the +/week should be
    // shown as 1 number not 2, (and it's probably not the sum of the two
    // separate +/week's)."
    //
    // The per-row "You gain" column is GONE from this table, and so is the
    // per-row lineup — both of those were measured against the roster as it is
    // today, and after the first trade that roster does not exist. Asserted as
    // the CELL being absent rather than as a blank, because a blank cell under
    // a heading that says "You gain" is the same invitation to add them up.
    ok('a combo row carries no per-deal “you gain” at all',
      lm.after.combo.rows.every((r) => r.hasMyGain === false),
      JSON.stringify(lm.after.combo.rows.map((r) => r.gainText)));
    ok('and no per-deal lineup before and after either — there is one, on the headline',
      lm.after.combo.rows.every((r) => r.hasLineup === false),
      JSON.stringify(lm.after.combo.rows.map((r) => r.beforeAfter)));

    // HIS OWN GAIN STAYS, AND IT IS HIS COMBINED SIDE. A partner in two of
    // these deals must show what BOTH of them together do to him — the
    // engine's `entry.partners` figure — not one of the two. Re-derived here
    // from his own roster rather than read back off the page.
    const partner = L.teams.find((t) => t.id === 3);
    const hisSide = priceTradeAcrossWeeks({
      players: partner.players,
      send: incoming.map((id) => L.byId.get(id)).filter(Boolean),
      receive: merged.send.map((m) => L.byId.get(m.id)).filter(Boolean),
      slots: L.slots, weeks: unplayed, projFor: L.projFor, zeroIsBye: true,
    });
    ok('the manager’s own gain on the row is HIS COMBINED side, priced once',
      Math.abs(hisSide.delta - merged.theirGain) <= 0.2,
      `page ${merged.theirGain}, a fresh priceTradeAcrossWeeks ${hisSide.delta}`);

    // The whole-packing figure the headline leads with still re-prices, which
    // is the number that replaced the column.
    const re = priceOver(unplayed, merged.send.map((m) => m.id), incoming);
    ok('and the merged move itself still prices as one roster change',
      Number.isFinite(re.delta), String(re.delta));
  }

  // AND IT IS NOT READ OFF THE OFFERS. The check above would still pass if the
  // page happened to add two gains that summed to the right answer, which in a
  // fixture this small it can. So this doctors the inputs: the same two offers
  // with their own `myGain` replaced by nonsense. A merger that added them up
  // would return the nonsense; one that re-prices cannot see it at all.
  const found = findTrades({
    teams: L.teams, myTeamId: 1, slots: L.slots,
    weeks: unplayed, projFor: L.projFor, zeroIsBye: true,
  });
  const pair = disjointPair(found.offers);
  ok('the fixture offers two disjoint deals with one manager to merge',
    !!pair, `${found.offers.length} offers, none disjoint with a shared partner`);
  if (pair) {
    const opts = {
      players: me.players, slots: L.slots, weeks: unplayed,
      projFor: L.projFor, zeroIsBye: true,
    };
    const honest = mergeComboByPartner({ combo: pair, partners: [] }, opts);
    const doctored = mergeComboByPartner(
      { combo: pair.map((o) => ({ ...o, myGain: 9999 })), partners: [] },
      opts
    );
    eq(honest.length, 1, 'two deals with one manager merge into one offer');
    eq(honest[0].mergedFrom, 2, 'and the row remembers there were two of them');
    ok('the merged send list is the union of both',
      honest[0].send.length === new Set([...pair[0].send, ...pair[1].send]).size,
      `${honest[0].send.length} sent`);
    ok('and the merged receive list is the union of both',
      honest[0].receive.length === new Set([...pair[0].receive, ...pair[1].receive]).size,
      `${honest[0].receive.length} received`);
    ok('a merged gain ignores the offers’ own gains entirely',
      doctored[0].myGain === honest[0].myGain,
      `${honest[0].myGain} became ${doctored[0].myGain} when the inputs were doctored`);
    ok('and it is not their sum, which here would be 19998',
      honest[0].myGain !== 19998);
  }
}

// ---- the bye rule: where it still decides something, and where it no longer does
//
// REWRITTEN 2026-09-20, and the rewrite is the point. Tim: "it should only
// calculate future weeks that actually project any points at all, and then set
// the avg there." So EVERY zero now leaves the per-week divisor, not just a
// bye — and the question "is this zero his bye?" stops deciding the average
// altogether.
//
// This block used to assert the opposite half: bye elsewhere ⇒ the week-8 zero
// counts, 99 / 10 = 9.9. That assertion encoded the old rule faithfully and is
// exactly what HANDOFF's rule 4 describes, so it is REPLACED rather than
// relaxed — and replaced with the stronger claim, that the two runs now agree.
//
// Bills D/ST: 11 a week over weeks 5–14, 0.00 in week 8. Either way the figure
// is 99 / 9 = 11.0, by hand and not from the code.
//
// WHAT THE BYE STILL DECIDES IS WHAT IS DRAWN. Rule 2 is untouched: a 0.00 in
// his team's bye week renders "Bye" and a 0.00 anywhere else renders "0.0",
// because those are two different facts about the player. The last two
// assertions here are that half, and they are why this block is still worth
// running — the two halves have simply come apart, and a future reader needs
// to see that the ONE that went is the average and not the rendering.
{
  const span = [];
  for (let w = 5; w <= 14; w++) span.push(w);
  const total = span.reduce((a, w) => a + (w === 8 ? 0 : 11), 0);
  const scoring = span.length - 1;   // every zero leaves the divisor now, bye or not
  const byeRight = run('liveByes', { stub: true, env: { TR_BYES: '{"1":8}' } });
  const byeElsewhere = run('liveByes', { stub: true, env: { TR_BYES: '{"1":9}' } });
  ok('both bye runs boot', !byeRight.boot && !byeElsewhere.boot, byeRight.boot || byeElsewhere.boot);
  ok('and draw Bills D/ST', !!(byeRight.bills && byeElsewhere.bills),
    JSON.stringify([byeRight.bills, byeElsewhere.bills]));
  if (byeRight.bills && byeElsewhere.bills) {
    eq(byeRight.bills.val, `${(total / scoring).toFixed(1)}/wk`,
      'week 8 IS his bye: a week with no points is out of the per-week divisor');
    eq(byeElsewhere.bills.val, `${(total / scoring).toFixed(1)}/wk`,
      'week 8 is NOT his bye: the zero is still out, because it is still a week ' +
      'he scores nothing in — this is the rule Tim asked for');
    // THE SHARP VERSION OF BOTH. Asserting two values that happen to be equal
    // would pass if the page went back to caring which zero is a bye and the
    // two numbers coincided for some other reason; asserting they are EQUAL,
    // and that the figure is above every week he actually scores in, is the
    // claim he made — "100% of his future weeks are proj above" the average.
    eq(byeElsewhere.bills.val, byeRight.bills.val,
      'and the two agree: where the bye falls no longer moves the per-week figure at all');
    ok('the per-week figure is not below every week he scores in',
      Number.parseFloat(byeRight.bills.val) >= 11,
      `${byeRight.bills.val} against a man who scores 11 in every week he plays`);
  }
  const at8 = (card) => (card ? card.projs[card.weeks.indexOf('8')] : null);
  ok('his card reads Bye in week 8 when that is his bye', at8(byeRight.card) === 'Bye',
    JSON.stringify(byeRight.card));
  ok('and 0.0 when it is not — never Bye', at8(byeElsewhere.card) === '0.0' &&
    !byeElsewhere.card.projs.includes('Bye'), JSON.stringify(byeElsewhere.card));
}

// ---- a man on bye in the week you play the partner (Tim, 2026-09-29) ---------
//
// "highlight a player's name if they have a BYE the week that the users play
// against each other … me giving the player away … green … me recieving …
// yellow." Stub: each squad its own NFL team (TR_PRO_SPLIT), Ana plays Cy in
// week 8 only (TR_MEET), and TR_BYES says whose bye is where. Four runs:
// Ana's men off in 8 (green on what she sends), Cy's men off in 8 (yellow on
// what she gets), both off in 9 (not a meeting week), and a meeting week that
// is already played (week 3).
{
  const base = { TR_PRO_SPLIT: '1', TR_MEET: '8' };
  const sends = run('byeMark', { stub: true, env: { ...base, TR_BYES: '{"1":8}' } });
  const gets = run('byeMark', { stub: true, env: { ...base, TR_BYES: '{"3":8}' } });
  const offWeek = run('byeMark', { stub: true, env: { ...base, TR_BYES: '{"1":9,"3":9}' } });
  const past = run('byeMark', { stub: true, env: { TR_PRO_SPLIT: '1', TR_MEET: '3', TR_BYES: '{"1":3,"3":3}' } });
  const all = { sends, gets, offWeek, past };
  for (const [k, r] of Object.entries(all)) {
    ok(`bye mark (${k}) boots`, !r.boot, r.boot);
    ok(`bye mark (${k}) has no errors`, !r.errors || r.errors.length === 0, JSON.stringify(r.errors));
  }
  const WORDS = 'Bye in week 8, the week you play Cy';
  const cyRows = (r) => (r.finder || []).filter((x) => /^Cy\b/.test(x.partner));
  const otherRows = (r) => (r.finder || []).filter((x) => !/^Cy\b/.test(x.partner));
  const men = (rows, cell) => rows.flatMap((x) => x.men.filter((m) => m.cell === cell));
  const green = (m) => /\bbye-hl\b/.test(m.cls) && /\bbye-send\b/.test(m.cls) && !/bye-get/.test(m.cls);
  const yellow = (m) => /\bbye-hl\b/.test(m.cls) && /\bbye-get\b/.test(m.cls) && !/bye-send/.test(m.cls);
  const plain = (m) => !m.cls && !m.title && !/bye/i.test(m.sr);
  const every = (list, f) => list.length > 0 && list.every(f);
  const dump = (x) => JSON.stringify(x).slice(0, 240);

  // Not vacuous: the finder has Ana/Cy deals to mark in both runs.
  ok('the finder offers Ana/Cy deals (sends run)', cyRows(sends).length > 0, dump(sends.finder));
  ok('the finder offers Ana/Cy deals (gets run)', cyRows(gets).length > 0, dump(gets.finder));

  // GREEN: a man she SENDS who is off in the meeting week.
  const sent = men(cyRows(sends), 'send');
  ok('finder: every man you send to Cy, off in week 8, is on green', every(sent, green), dump(sent));
  ok('with the week and the partner in its tooltip', every(sent, (m) => m.title === WORDS), dump(sent));
  ok('and in sr-only words that say you send him', every(sent, (m) => /bye in week 8/i.test(m.sr) &&
    /play Cy/.test(m.sr) && /you send him/.test(m.sr)), dump(sent));
  ok('the sr-only words are not in the visible text', every(sent, (m) => !/bye in week/i.test(m.visible) &&
    m.hlText.length > 0 && m.visible.startsWith(m.hlText)), dump(sent));
  ok('finder: the men you get (no bye) are not marked', every(men(cyRows(sends), 'recv'), plain),
    dump(men(cyRows(sends), 'recv')));
  ok('finder: deals with managers you do not meet in week 8 are not marked',
    otherRows(sends).every((x) => x.men.every(plain)), dump(otherRows(sends)));
  ok('finder: the key names the colours', /green/i.test(sends.finderKey) && /yellow/i.test(sends.finderKey),
    sends.finderKey);
  ok('the finder\'s How-this-works says what a green or yellow name is',
    /bye/i.test(sends.note) && /green/i.test(sends.note) && /yellow/i.test(sends.note), sends.note.slice(-400));
  const dSend = (sends.deal.find((s) => s.head === 'You send') || { men: [] }).men;
  const dGet = (sends.deal.find((s) => s.head === 'You get') || { men: [] }).men;
  ok('pop-up: the men you send are on green', every(dSend, green), dump(sends.deal));
  ok('pop-up: the men you get are not', every(dGet, plain), dump(sends.deal));
  ok('pop-up: the key is there', /green/i.test(sends.dealKey), sends.dealKey);
  ok('custom box: your list, ticked or not, is on green', every(sends.listA, green), dump(sends.listA));
  ok('custom box: his list is not marked', every(sends.listB, plain), dump(sends.listB));
  ok('custom box: the key is there', /green/i.test(sends.cuKey), sends.cuKey);
  ok('saved custom row: your man is on green, his is not',
    every(men([{ men: sends.saved }], 'send'), green) && every(men([{ men: sends.saved }], 'recv'), plain),
    dump(sends.saved));
  ok('combo: only men you send are marked, and only on green',
    (sends.combo || []).every((m) => plain(m) || (m.cell === 'send' && green(m))), dump(sends.combo));

  // YELLOW: a man she GETS who is off in the meeting week.
  const got = men(cyRows(gets), 'recv');
  ok('finder: every man you get from Cy, off in week 8, is on yellow', every(got, yellow), dump(got));
  ok('with the same tooltip', every(got, (m) => m.title === WORDS), dump(got));
  ok('and sr-only words that say you get him', every(got, (m) => /you get him/.test(m.sr)), dump(got));
  ok('finder: the men you send (no bye) are not marked', every(men(cyRows(gets), 'send'), plain),
    dump(men(cyRows(gets), 'send')));
  const gGet = (gets.deal.find((s) => s.head === 'You get') || { men: [] }).men;
  const gSend = (gets.deal.find((s) => s.head === 'You send') || { men: [] }).men;
  ok('pop-up: the men you get are on yellow, the ones you send are not',
    every(gGet, yellow) && every(gSend, plain), dump(gets.deal));
  ok('custom box: his list is on yellow, yours is not',
    every(gets.listB, yellow) && every(gets.listA, plain), dump([gets.listA, gets.listB]));
  ok('saved custom row: his man is on yellow',
    every(men([{ men: gets.saved }], 'recv'), yellow), dump(gets.saved));
  ok('combo: only men you get are marked, and only on yellow',
    (gets.combo || []).every((m) => plain(m) || (m.cell === 'recv' && yellow(m))), dump(gets.combo));

  // NOTHING: a bye outside the meeting week, or in a meeting week already played.
  // Everything drawn about a deal WITH CY (the pop-up, the custom box and the
  // saved row are all Cy's here). Week 9 IS a meeting week with Bo, though —
  // Ana plays Bo every week but 8 — so Bo's deals are marked, and that is
  // checked too: the multi-week tooltip names every week.
  for (const [k, r] of [['bye in week 9, not a meeting week with Cy', offWeek], ['meeting week already played', past]]) {
    const withCy = (list) => (list || []).filter((m) => /^Cy\b/.test(m.partner));
    const everyone = [...cyRows(r).flatMap((x) => x.men), ...withCy(r.combo),
      ...(r.deal || []).flatMap((s) => s.men), ...(r.listA || []), ...(r.listB || []), ...(r.saved || [])];
    ok(`${k}: the page still draws men`, everyone.length > 20, everyone.length);
    ok(`${k}: nobody is marked`, everyone.every(plain), dump(everyone.filter((m) => !plain(m))));
    ok(`${k}: and no key on the pop-up or the custom box`, !r.cuKey && !r.dealKey,
      JSON.stringify([r.cuKey, r.dealKey]));
  }
  const BO_WORDS = 'Bye in week 9, one of the weeks you play Bo (5, 6, 7, 9, 10, 11, 12, 13, 14)';
  const bo = (offWeek.finder || []).filter((x) => /^Bo\b/.test(x.partner));
  const boSent = men(bo, 'send');
  ok('Bo: every Bo deal the finder keeps marks the men you send, off in week 9, on green',
    boSent.every((m) => green(m) && m.title === BO_WORDS), dump(boSent));
  ok('and the finder key is there exactly when such a man is shown',
    /green/i.test(offWeek.finderKey) === boSent.length > 0, `${boSent.length} · ${offWeek.finderKey}`);
  ok('Bo, custom box: your men off in week 9 (a week you play Bo) are on green, the tooltip naming every week',
    every(offWeek.listABo, (m) => plain(m) || (green(m) && m.title === BO_WORDS)) &&
      offWeek.listABo.some(green), dump(offWeek.listABo));
  ok('and the custom box key is there for them', /green/i.test(offWeek.cuKeyBo), offWeek.cuKeyBo);
  ok('already played: no finder key at all', !past.finderKey, past.finderKey);
}

// ---- when to accept (Tim, 2026-09-30) ----------------------------------------
//
// "calculate when that official date and time is for when the trade needs to be
// ACCEPTED (not just sent) in order for you to actually recieve those players by
// that time" / "our trade review period is 1 day in our league rules."
// Stub: each squad its own NFL team; pro team 1 (Ana) kicks off at K in the
// coming week 5, team 3 (Cy) two days later; the stub's review is 24 h. Every
// expected time is K-based arithmetic formatted the way the page formats it.
{
  const DAY = 86400000;
  const when = (ms) => new Date(ms).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const now = Date.now();
  const far = String(now + 60 * DAY);
  const base = { TR_PRO_SPLIT: '1', TR_DEADLINE: far };
  const dump = (x) => JSON.stringify(x).slice(0, 400);
  const runAcc = (env) => run('acceptBy', { stub: true, env: { ...base, ...env } });

  // A run that dies must FAIL here, not throw past every check after it.
  try {
  // 1. In time for the coming week: Cy's kickoff (K + 2 days) − 24 h.
  const K = now + 3 * DAY;
  const a = runAcc({ TR_KICKOFFS: String(K) });
  ok('accept-by (in time) boots, no errors', !a.boot && a.errors.length === 0, a.boot || dump(a.errors));
  const at1 = when(K + 2 * DAY - DAY);
  ok('pop-up: "Accept by <Cy\'s kickoff − 24 h> to have them for week 5"',
    a.deal && new RegExp(`^Accept by ${at1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to have (him|them) for week 5\\.$`).test(a.deal.line),
    `${a.deal && a.deal.line} | want ${at1}`);
  ok('pop-up: the tooltip says why (his kickoff, the 24-hour review)',
    a.deal && a.deal.title && a.deal.title.includes(when(K + 2 * DAY)) && /24 hours/.test(a.deal.title), a.deal && a.deal.title);
  ok('pop-up: the line sits right before the ESPN link block', a.deal && a.deal.beforeEspn === true, dump(a.deal));
  ok('custom box: "Accept by" is shown, "—" before anything he sends is ticked',
    !a.before.hidden && a.before.text === '—', dump(a.before));
  ok('custom box: after ticking one of Cy\'s men, his time for week 5',
    a.ticked && a.after.text === `${at1} for wk 5`, `${a.after.text} | want ${at1} for wk 5`);

  // 2. Too late for week 5: Cy kicks off in 12 h — the answer is week 6.
  const KL = now - 1.5 * DAY;
  const l = runAcc({ TR_KICKOFFS: String(KL) });
  ok('accept-by (too late) boots, no errors', !l.boot && l.errors.length === 0, l.boot || dump(l.errors));
  const at2 = when(KL + 7 * DAY + 2 * DAY - DAY);
  ok('pop-up: too late for week 5, so the week-6 time',
    l.deal && l.deal.line === `Too late for week 5. Accept by ${at2} to have ${/them/.test(l.deal.line) ? 'them' : 'him'} for week 6.`,
    `${l.deal && l.deal.line} | want ${at2}`);
  ok('custom box: the week-6 time, with "too late for 5"',
    l.after.text === `${at2} for wk 6 too late for 5`, l.after.text);

  // 3. The trade deadline comes before the review cut-off.
  const DL = now + 0.5 * DAY;
  const c = runAcc({ TR_KICKOFFS: String(K), TR_DEADLINE: String(DL) });
  ok('accept-by (deadline first) boots, no errors', !c.boot && c.errors.length === 0, c.boot || dump(c.errors));
  ok('pop-up: accept by the trade deadline instead',
    c.deal && new RegExp(`^Accept by ${when(DL).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(trade deadline\\) to have (him|them) for week 5\\.$`).test(c.deal.line),
    `${c.deal && c.deal.line} | want ${when(DL)}`);
  ok('custom box: the deadline time, marked', c.after.text === `${when(DL)} for wk 5 (deadline)`, c.after.text);

  // 4. Cy's team is on bye in week 5: it is week 6, and NOT "too late".
  const b = runAcc({ TR_KICKOFFS: String(K), TR_KICK_BYE: '3:5' });
  ok('accept-by (bye) boots, no errors', !b.boot && b.errors.length === 0, b.boot || dump(b.errors));
  const at4 = when(K + 7 * DAY + 2 * DAY - DAY);
  ok('pop-up: his bye week is skipped, not called too late',
    b.deal && new RegExp(`^Accept by ${at4.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to have (him|them) for week 6\\.$`).test(b.deal.line),
    `${b.deal && b.deal.line} | want ${at4}`);

  // 5. Demo: no real kickoffs, so no line anywhere.
  const d = run('acceptBy', { env: { TR_ACCEPT_DEMO: '1', TR_KICKOFFS: String(K), TR_DEADLINE: far } });
  ok('accept-by (demo) boots, no errors', !d.boot && d.errors.length === 0, d.boot || dump(d.errors));
  ok('demo: the pop-up opened and has no accept line', d.deal && d.deal.open && d.deal.line === null, dump(d.deal));
  ok('demo: the custom box\'s "Accept by" is hidden', d.before.hidden && d.after.hidden, dump([d.before, d.after]));
  } catch (e) {
    ok('the accept-by checks ran to the end without throwing', false, String(e && e.stack).slice(0, 300));
  }
}

// ---- a man on the injury report is underlined (Tim, 2026-09-29) --------------
//
// "underline a player's name if they are on the injury report in the home
// section." Home's rule (js/injury.js): any status but ACTIVE/NORMAL. Bench men
// too — Home lists starters only because it is about this week's lineup.
// Bills D/ST (112, Ana's, sent to Cy and on bye in the meeting week) is
// QUESTIONABLE, so the underline must sit WITH the green pill; Cy WR2 (304) is
// on IR. Everybody else is healthy and must not be underlined.
{
  const r = run('byeMark', { stub: true, env: {
    TR_PRO_SPLIT: '1', TR_MEET: '8', TR_BYES: '{"1":8}', TR_INJURED: '112:QUESTIONABLE,304:INJURY_RESERVE',
  } });
  ok('injury run boots', !r.boot, r.boot);
  ok('injury run has no errors', !r.errors || r.errors.length === 0, JSON.stringify(r.errors));
  const everyone = [...(r.finder || []).flatMap((x) => x.men), ...(r.combo || []),
    ...(r.deal || []).flatMap((s) => s.men), ...(r.listA || []), ...(r.listB || []), ...(r.saved || [])];
  const dump = (x) => JSON.stringify(x).slice(0, 240);
  const q = everyone.filter((m) => m.id === 112);
  const ir = everyone.filter((m) => m.id === 304);
  const rest = everyone.filter((m) => m.id !== 112 && m.id !== 304);
  ok('the questionable man is drawn in the finder, the pop-up and the custom box',
    (r.finder || []).some((x) => x.men.some((m) => m.id === 112)) &&
    (r.deal || []).some((s) => s.men.some((m) => m.id === 112)) &&
    (r.listA || []).some((m) => m.id === 112), dump(q));
  ok('the questionable man is underlined everywhere he is drawn',
    q.length > 0 && q.every((m) => /\binj\b/.test(m.injCls)), dump(q));
  ok('with "Questionable" in his tooltip, as Home words it',
    q.length > 0 && q.every((m) => /Questionable/.test(m.injTitle)), dump(q));
  ok('and in his sr-only words, not his visible text',
    q.length > 0 && q.every((m) => /Questionable/.test(m.sr) && !/Questionable/.test(m.visible)), dump(q));
  ok('and the green bye pill is still on him',
    q.length > 0 && q.every((m) => /bye-send/.test(m.cls)), dump(q));
  ok('the IR man is underlined, labelled "IR"',
    ir.length > 0 && ir.every((m) => /\binj\b/.test(m.injCls) && /\bIR\b/.test(m.injTitle) && /\bIR\b/.test(m.sr)),
    dump(ir));
  ok('nobody healthy is underlined', rest.length > 20 && rest.every((m) => !m.injCls && !/injury/i.test(m.sr)),
    dump(rest.filter((m) => m.injCls)));
  ok('the finder key mentions the underline', /underlined/i.test(r.finderKey), r.finderKey);
  ok('How this works mentions the injury report', /injury report/i.test(r.note), r.note.slice(-300));
}

// ---- the preseason arrows (Tim, 2026-09-29) ------------------------------------
//
// "put a up or down arrow by that player's name if their rest-of-season
// proj/week has increased or decreased by more than 2 than it was at the
// begginning of the season. make the down arrow red and up arrow green. make
// sure it's small so it's not too distracting."
// TR_TREND gives five stub men real ids from the preseason copy (tr-stub-season
// TREND_IDS) in a half-PPR league; the bye pill and the underline run alongside,
// so all three marks are checked sitting on one man.
{
  const { TREND_IDS } = await import('./tr-stub-season.mjs');
  const r = run('byeMark', { stub: true, env: {
    TR_TREND: '1', TR_PRO_SPLIT: '1', TR_MEET: '8', TR_BYES: '{"1":8}', TR_INJURED: '107:QUESTIONABLE',
    TR_DEAL_WITH: '4429795',
  } });
  ok('trend run boots', !r.boot, r.boot);
  ok('trend run has no errors', !r.errors || r.errors.length === 0, JSON.stringify(r.errors));
  const dump = (x) => JSON.stringify(x).slice(0, 300);
  const places = {
    finder: (r.finder || []).flatMap((x) => x.men),
    combo: r.combo || [],
    'pop-up': (r.deal || []).flatMap((s) => s.men),
    'your custom list': r.listA || [],
    'his custom list': r.listB || [],
    'saved custom row': r.saved || [],
  };
  const everyone = Object.values(places).flat();
  const want = new Map(Object.values(TREND_IDS).map((t) => [t.id, t.want]));
  // "Now" is the site's average of ESPN's weekly projections over the weeks
  // the page prices — never "ESPN's rest-of-season projection", which ESPN
  // does not publish.
  const SAYS = (dir, d, from, to) => new RegExp(`${dir} ${d} a week since preseason: ${from} ` +
    `\\(ESPN’s 9 Sep projection per game\\) → ${to} \\(the site’s average of ESPN’s weekly ` +
    'projections over weeks? \\d+(–\\d+)?\\)');
  const WORDS = {
    4431459: SAYS('Up', '2\\.1', '9\\.9', '12\\.0'),
    [-16033]: SAYS('Up', '5\\.0', '7\\.0', '12\\.0'),
    4429795: SAYS('Down', '4\\.7', '19\\.7', '15\\.0'),
  };
  // Not vacuous: each arrowed man is drawn where he must be.
  ok('the custom lists draw Ana’s TE1 (Warren), her Ravens D/ST and Cy’s RB3 (Gibbs)',
    [4431459, -16033].every((id) => places['your custom list'].some((m) => m.id === id)) &&
    places['his custom list'].some((m) => m.id === 4429795),
    dump([places['your custom list'].map((m) => m.id), places['his custom list'].map((m) => m.id)]));
  for (const [where, list] of Object.entries(places)) {
    const wrong = list.filter((m) => (want.get(m.id) ?? null) !== (m.trend || null));
    ok(`${where}: an arrow on exactly the men who moved more than 2 a week, the right way`,
      list.length > 0 && wrong.length === 0, dump(wrong.length ? wrong : list.map((m) => [m.id, m.trend])));
  }
  const arrowed = everyone.filter((m) => m.trend);
  ok('some finder deal carries an arrow (or the finder check above is vacuous)',
    places.finder.some((m) => m.trend), dump(places.finder.map((m) => [m.id, m.trend])));
  ok('what the eye sees is the glyph alone, ▲ for up and ▼ for down',
    arrowed.length > 5 && arrowed.every((m) => m.trendSeen === (m.trend === 'up' ? '▲' : '▼')), dump(arrowed));
  ok('the words are sr-only, INSIDE the arrow, and say how far and from what',
    arrowed.every((m) => WORDS[m.id] && WORDS[m.id].test(m.trendSr) && !/rest-of-season projection/.test(m.trendSr)),
    dump(arrowed.map((m) => [m.id, m.trendSr])));
  ok('and never in the visible text', everyone.every((m) => !/preseason/.test(m.visible)),
    dump(everyone.filter((m) => /preseason/.test(m.visible))));
  ok('the tooltip carries the same words', arrowed.every((m) => WORDS[m.id].test(m.trendTitle)),
    dump(arrowed.map((m) => m.trendTitle)));
  // Coexisting marks: the Ravens D/ST is sent to Cy in the bye week AND questionable.
  const ravens = everyone.filter((m) => m.id === -16033 && m.cell === 'send');
  ok('the arrow sits with the green bye pill and the injury underline on one man',
    ravens.length > 0 && ravens.every((m) => m.trend === 'up' && /bye-send/.test(m.cls) && /\binj\b/.test(m.injCls)),
    dump(everyone.filter((m) => m.id === -16033)));
  ok('the finder key names the arrow', /Green ▲ \/ red ▼ by a name/.test(r.finderKey || ''), r.finderKey);
  ok('the custom box key names it too', /preseason/.test(r.cuKey || ''), r.cuKey);
  ok('the pop-up (a deal with Gibbs in it) draws his red ▼',
    places['pop-up'].some((m) => m.id === 4429795 && m.trend === 'down'), JSON.stringify(places['pop-up']).slice(0, 300));
  ok('and its key names the arrow too', /preseason/.test(r.dealKey || ''), r.dealKey);
  ok('How this works states the basis: ESPN’s 9 Sep preseason, re-scored with your rules',
    /9 Sep projection per game, re-scored with your league’s rules/.test(r.note || ''), (r.note || '').slice(-600));
}
{
  // The plain stub league: every id is one the preseason copy has never heard
  // of, so "not known" must draw nothing — no arrow, and no key for one.
  const r = run('byeMark', { stub: true, env: { TR_PRO_SPLIT: '1', TR_MEET: '8', TR_BYES: '{"1":8}' } });
  const everyone = [...(r.finder || []).flatMap((x) => x.men), ...(r.combo || []),
    ...(r.deal || []).flatMap((s) => s.men), ...(r.listA || []), ...(r.listB || []), ...(r.saved || [])];
  ok('a league of men the preseason copy has never heard of: no arrow anywhere',
    everyone.length > 20 && everyone.every((m) => !m.trend), JSON.stringify(everyone.filter((m) => m.trend)).slice(0, 240));
  ok('and no arrow sentence in the keys', !/preseason/.test(`${r.finderKey} ${r.cuKey} ${r.dealKey}`),
    `${r.finderKey} | ${r.cuKey} | ${r.dealKey}`);
}

// ---- one week for both slot-by-slot panels (Tim, 2026-09-29) ---------------
//
// "in the week 6, slot by slot, it shows different numbers in different places
// for the same player ... these are massive discrepancies and need to be
// consistient and accurate in every place it's located."
{
  const r = run('slotWeek', { stub: true });
  ok('slot week boots', !r.boot, r.boot);
  ok('slot week has no errors', !r.errors || r.errors.length === 0, JSON.stringify(r.errors));
  const wk = (t) => { const m = /^Week (\d+)/.exec(t || ''); return m ? Number(m[1]) : null; };
  const same = (x) => x && wk(x.mine) !== null && wk(x.mine) === wk(x.his);
  ok('both halves open on the same week', same(r.atOpen), JSON.stringify(r.atOpen));
  ok('a hover in your table moves HIS panel to that week too',
    r.crossHover && r.crossHover.week !== null && wk(r.crossHover.his) === r.crossHover.week &&
      wk(r.crossHover.mine) === r.crossHover.week, JSON.stringify(r.crossHover));
  ok('a click pins that week in both panels',
    wk(r.pinned.mine) === r.leftTable.W && wk(r.pinned.his) === r.leftTable.W, JSON.stringify(r.pinned));
  ok('drifting over a later row previews it while still over the table',
    wk(r.drifting.mine) === r.leftTable.later && wk(r.drifting.his) === r.leftTable.later,
    JSON.stringify({ drifting: r.drifting, later: r.leftTable.later }));
  ok('leaving the table returns both panels to the clicked week',
    wk(r.leftTable.mine) === r.leftTable.W && wk(r.leftTable.his) === r.leftTable.W,
    JSON.stringify(r.leftTable));
  ok('a hover in HIS table moves yours too', same(r.crossBack) && wk(r.crossBack.mine) === r.leftTable.later,
    JSON.stringify(r.crossBack));
  ok('and leaving his table returns both to the clicked week',
    wk(r.leftB.mine) === r.leftTable.W && wk(r.leftB.his) === r.leftTable.W, JSON.stringify(r.leftB));
  ok('the pop-up: a drift previews, leaving its table returns to the clicked week',
    wk(r.popup.drift) === r.leftTable.later && wk(r.popup.left) === r.leftTable.W,
    JSON.stringify(r.popup));
  ok('a played week’s panel title says it was played', /played/i.test(r.popup.played || ''),
    r.popup.played);
  ok('an unplayed week’s title does not', r.popup.unplayed && !/played/i.test(r.popup.unplayed),
    r.popup.unplayed);
  if (r.playedCu !== null) ok('and so does the custom box’s', /played/i.test(r.playedCu), r.playedCu);
  ok('the per-week figures say what they average (finder, custom box, pop-up)',
    /weeks? \d+/.test(r.avgKeys.finder) && /weeks? \d+/.test(r.avgKeys.custom) && /weeks? \d+/.test(r.popup.avgKey),
    JSON.stringify([r.avgKeys, r.popup.avgKey]));

  // THE CONSISTENCY GUARD: every man's figure in both panels, both tabs and the
  // pop-up is the stub's own projection for him THAT week, to the tenth.
  const stub = await import('./tr-stub-season.mjs');
  const proj = new Map();
  for (const g of r.guard || []) {
    if (!proj.has(g.week)) {
      const { teams } = await stub.fetchWeekRosters(g.week);
      const m = new Map();
      for (const t of teams) for (const p of t.players) m.set(String(p.playerId), p.projected);
      proj.set(g.week, m);
    }
  }
  const bad = (r.guard || []).filter((g) => {
    const want = proj.get(g.week) && proj.get(g.week).get(String(g.id));
    return !(typeof want === 'number' && Number(g.v) === Math.round(want * 10) / 10);
  });
  const panels = new Set((r.guard || []).map((g) => `${g.panel}:${g.side}`));
  ok('the guard read both panels, both tabs, and the pop-up',
    ['cuWeek:mine', 'cuWeek:theirs', 'cuWeekB:mine', 'cuWeekB:theirs', 'dealWeek:mine', 'dealWeek:theirs']
      .every((k) => panels.has(k)) && r.guard.length > 40, `${[...panels]} n=${(r.guard || []).length}`);
  ok('every man’s figure is his own projection for that week, everywhere',
    bad.length === 0, JSON.stringify(bad.slice(0, 4)));
}

// ---- hover a week, see that week's lineup slot by slot ---------------------
//
// Tim, 2026-09-17: "if you hover over a specific week, it shows the positions of
// each proj for that week, before and after your trade, with the specific
// players that are being traded color coded so you can see how the new player
// affected your lineup for that specific week."
//
// EVERY NUMBER BELOW IS RE-DERIVED from tr-stub-season.mjs and the engine, never
// read back off the page. The slot LAYOUT is re-implemented here as well —
// deliberately, because js/lineup-slots.js is the thing under test and checking
// it against itself would pass whatever it did.
{
  const SLOT_LINEUP_ORDER = {
    0: 1, 1: 1, 2: 2, 4: 3, 6: 4, 3: 5, 5: 5, 23: 5, 7: 6, 16: 7, 17: 8,
    18: 9, 19: 10, 20: 50, 21: 51,
  };

  /** The suite's own copy of the slot-row rule. See the note above. */
  const ownSlotRows = (slots, LABELS) => {
    const counts = new Map();
    for (const id of slots) counts.set(id, (counts.get(id) || 0) + 1);
    const out = [];
    for (const id of [...counts.keys()].sort(
      (a, b) => (SLOT_LINEUP_ORDER[a] ?? 40) - (SLOT_LINEUP_ORDER[b] ?? 40) || a - b)) {
      const n = counts.get(id);
      for (let i = 1; i <= n; i++) {
        out.push({ key: n > 1 ? `${LABELS[id]}${i}` : LABELS[id], slotId: id, rank: i });
      }
    }
    return out;
  };

  /** And its own copy of the fill: best projection first inside each slot. */
  const ownFill = (starters, rows) => {
    const bySlot = new Map();
    for (const s of starters) {
      if (!bySlot.has(s.slotId)) bySlot.set(s.slotId, []);
      bySlot.get(s.slotId).push(s);
    }
    for (const list of bySlot.values()) {
      list.sort((a, b) => (b.projected ?? -Infinity) - (a.projected ?? -Infinity) ||
        (a.playerId ?? 0) - (b.playerId ?? 0));
    }
    return rows.map((r) => {
      const pick = (bySlot.get(r.slotId) || [])[r.rank - 1] || null;
      return pick
        ? { slot: r.key, id: pick.playerId, name: pick.name, v: Math.round(pick.projected * 10) / 10 }
        : { slot: r.key, id: null, name: '', v: null };
    });
  };

  const stub = await import('./tr-stub-season.mjs');
  const espnMod = await import(moduleUrl('js/espn.js'));
  const { priceTradeAcrossWeeks, slotsForLeague } = await import(moduleUrl('js/trade.js'));
  const { slotCountsFromLineups } = await import(moduleUrl('js/projection.js'));

  const range = (a, b) => { const o = []; for (let w = a; w <= b; w++) o.push(w); return o; };

  /**
   * One week of one side, priced from the fixture and laid out by hand.
   *
   * `span` matters and is passed in rather than assumed: the page prices the
   * played weeks, the remaining weeks and the playoff weeks as three separate
   * calls so nothing about the second or third can reach the first, and the
   * forced cut is decided once per call. Re-deriving a week on the wrong span
   * would be a different question with a plausible answer.
   */
  async function rederive({ week, span, side, sendIds, receiveIds, baseWeek, myTeamId, partnerId }) {
    const base = await stub.fetchWeekRosters(baseWeek);
    const slots = slotsForLeague(slotCountsFromLineups(base.teams));

    const idx = new Map();
    for (const w of span) {
      const { teams } = await stub.fetchWeekRosters(w);
      const m = new Map();
      for (const t of teams) for (const p of t.players) m.set(p.playerId, p.projected);
      idx.set(w, m);
    }
    const projFor = (p, w) => {
      const m = idx.get(w);
      const v = m ? m.get(p.playerId) : undefined;
      return typeof v === 'number' ? v : null;
    };

    const byId = new Map();
    for (const t of base.teams) for (const p of t.players) byId.set(p.playerId, p);
    const mine = side !== 'theirs';
    const team = base.teams.find((t) => t.id === (mine ? myTeamId : partnerId));
    const send = (mine ? sendIds : receiveIds).map((i) => byId.get(i)).filter(Boolean);
    const receive = (mine ? receiveIds : sendIds).map((i) => byId.get(i)).filter(Boolean);

    const priced = priceTradeAcrossWeeks({
      players: team.players, send, receive, slots, weeks: span, projFor,
    });
    const i = span.indexOf(week);
    const rows = ownSlotRows(slots, espnMod.SLOT_LABELS);
    return {
      slots: rows.map((r) => r.key),
      before: ownFill(priced.before.byWeek[i].starters, rows),
      after: ownFill(priced.after.byWeek[i].starters, rows),
      row: priced.byWeek[i],
      startersBefore: priced.before.byWeek[i].starters.map((s) => s.playerId),
      startersAfter: priced.after.byWeek[i].starters.map((s) => s.playerId),
    };
  }

  // The priced week(s) with the largest printed difference either way.
  const swingOf = (wt) => {
    const ws = (wt && wt.weeks) || [];
    const top = Math.max(...ws.map((w) => Math.abs(w.delta)));
    return ws.filter((w) => Math.abs(w.delta) === top).map((w) => w.label.replace(/^Week /, ''));
  };

  const peek = run('weekPeek', { stub: true });
  ok('the hover-a-week scenario boots', !peek.boot, peek.boot);

  if (!peek.boot) {
    ok('no console errors while hovering weeks', peek.errors.length === 0,
      peek.errors.slice(0, 2).join(' | '));
    ok('the Ana/Cy offer was found and opened', !!peek.offer && peek.deal.present,
      JSON.stringify(peek.offer));

    const SPAN = range(peek.playedThrough + 1, peek.weeks);   // 5–14
    const PAST = range(1, peek.playedThrough);                // 1–4
    const sendIds = peek.offer.send.map((m) => m.id);
    const receiveIds = peek.offer.receive.map((m) => m.id);
    const base = {
      baseWeek: peek.baseWeek, myTeamId: peek.myTeamId, partnerId: peek.partnerId,
      sendIds, receiveIds,
    };

    // ---- it OPENS on the week the deal moves most (Phase 5, V17) ----------
    //
    // REPLACED, not relaxed: this used to assert a prompt and no table, which
    // is the blank half-card the plan asked to be rid of. The week is
    // re-derived from the week table's own printed differences — the largest
    // either way; a printed tie (one decimal) accepts either week.
    const swing = swingOf(peek.deal.weeks);
    ok('with no week picked the panel opens on the biggest-swing week, as a table',
      peek.shut && peek.shut.present && !peek.shut.empty &&
      swing.some((w) => peek.shut.title === `Week ${w}, slot by slot — Your lineup`),
      JSON.stringify({ title: peek.shut && peek.shut.title, swing }));
    ok('and says why it is that week', /moves most/.test(peek.shut.lead), peek.shut.lead);
    ok('and the week table marks that week as the open one',
      peek.shut.expanded.length === 1 && swing.includes(peek.shut.expanded[0]),
      JSON.stringify(peek.shut.expanded));
    eq(peek.hovered.lead, '', 'a week picked by hand drops the "moves most" line');

    // ---- three ways in, and they are three different claims ---------------
    //
    // A hover is what Tim asked for; a TAP is the only one of the three a phone
    // has, and HANDOFF's rule is that nothing may be reachable by hover alone;
    // focus is the keyboard, which a <tr> can never answer on its own.
    eq(peek.hovered.title, 'Week 7, slot by slot — Your lineup', 'a HOVER opens that week');
    eq(peek.tapped.title, 'Week 9, slot by slot — Your lineup', 'a TAP on the button opens that week');
    eq(peek.focused.title, 'Week 11, slot by slot — Your lineup', 'and FOCUS opens it from the keyboard');
    eq(peek.hovered.expanded.join(','), '7', 'the week table marks the open week, and only it');
    eq(peek.hovered.peeking.join(','), '7', 'and lights that row');

    // ---- Escape closes the breakdown, then the pop-up ---------------------
    // Since V17 "closed" draws the opening week rather than a prompt, so the
    // first Escape puts the panel back where the pop-up opened it.
    ok('Escape drops the picked week first, back to the week it opened on',
      /moves most/.test(peek.afterEscape.breakdown.lead) &&
      peek.afterEscape.breakdown.expanded.length === 1 &&
      swing.includes(peek.afterEscape.breakdown.expanded[0]),
      JSON.stringify(peek.afterEscape.breakdown.expanded));
    ok('and leaves the pop-up open — the frame is not shut out from under it',
      peek.afterEscape.dealStillOpen);
    ok('a second Escape closes the pop-up', !peek.afterSecondEscape.dealOpen);

    // ---- the slot rows are the league's own shape, in lineup order --------
    eq(peek.hovered.slots.join(','), 'QB,RB1,RB2,WR1,WR2,TE,FLEX,D/ST,K',
      'the rows are the league’s slots in lineup order, numbered within a position');
    eq(peek.hovered.heads.join(' | '), 'Slot | As you are now | With the trade | Difference',
      'and the columns are before, after and the difference');

    // ---- the numbers are the engine's own, re-derived ---------------------
    const cases = [
      { name: 'week 7, your side', got: peek.backToMine, week: 7, span: SPAN, side: 'mine' },
      { name: 'week 7, Cy’s side', got: peek.theirSide, week: 7, span: SPAN, side: 'theirs' },
      { name: 'week 2, a played week', got: peek.playedWeek, week: 2, span: PAST, side: 'mine' },
    ];
    for (const c of cases) {
      const want = await rederive({ ...base, week: c.week, span: c.span, side: c.side });
      // Guarded rather than assumed: a panel that drew nothing at all would
      // otherwise throw here and take the whole suite down instead of reporting
      // the one thing that is wrong.
      ok(`${c.name}: a table was drawn`, !!(c.got && c.got.present && c.got.totals),
        JSON.stringify(c.got && { empty: c.got.empty, title: c.got.title }));
      if (!c.got || !c.got.present || !c.got.totals) continue;
      eq(c.got.slots.join(','), want.slots.join(','), `${c.name}: the same slot rows`);
      const drawn = (col) => c.got.rows.map((r) => `${r.slot}=${r[col].id ?? '-'}@${r[col].v || '-'}`).join(' ');
      const derived = (list) => list.map((e) => `${e.slot}=${e.id ?? '-'}@${e.v === null ? '-' : e.v.toFixed(1)}`).join(' ');
      eq(drawn('before'), derived(want.before), `${c.name}: BEFORE is the engine’s own lineup`);
      eq(drawn('after'), derived(want.after), `${c.name}: AFTER is the engine’s own lineup`);
      eq(num(c.got.totals.before.text), want.row.before, `${c.name}: the totals line’s before`);
      eq(num(c.got.totals.after.text), want.row.after, `${c.name}: the totals line’s after`);
      eq(num(c.got.totals.delta), want.row.delta, `${c.name}: and its difference`);

      // The marks, re-derived from the same two lineups. A man who was traded
      // is marked as traded; one of your own who changed places is marked as
      // that; nobody else is marked at all.
      const wasIn = new Set(want.startersBefore);
      const nowIn = new Set(want.startersAfter);
      const sent = new Set(c.side === 'theirs' ? receiveIds : sendIds);
      const got = new Set(c.side === 'theirs' ? sendIds : receiveIds);
      const markWant = (id, col) => {
        if (id === null) return '';
        if (col === 'before') {
          if (sent.has(id)) return 'OUT';
          return nowIn.has(id) ? '' : 'benched';
        }
        if (got.has(id)) return 'IN';
        return wasIn.has(id) ? '' : 'promoted';
      };
      // "moved" is the one mark the sets above cannot predict — it is a change
      // of SLOT for a man in both lineups — so it is allowed wherever the
      // derivation says no mark and the slot genuinely differs.
      const markOk = c.got.rows.every((r) =>
        ['before', 'after'].every((col) => {
          const want2 = markWant(r[col].id, col);
          return r[col].mark === want2 || (want2 === '' && r[col].mark === 'moved');
        }));
      ok(`${c.name}: every mark is the right one, and nobody else is marked`, markOk,
        c.got.rows.map((r) => `${r.slot}:${r.before.mark}/${r.after.mark}`).join(' '));

      // COLOUR IS NEVER ALONE. Every mark on the table carries a word.
      ok(`${c.name}: every mark carries a word as well as a colour`,
        c.got.marks.length > 0 && c.got.marks.every((m) => m.word.trim().length > 0),
        JSON.stringify(c.got.marks));

      // A ROW THAT CHANGED LOOKS DIFFERENT FROM ONE THAT DID NOT, and that is
      // re-derived too rather than trusted: a row is changed exactly when the
      // man or his number moved.
      const changedOk = c.got.rows.every((r, i) => {
        const moved = want.before[i].id !== want.after[i].id || want.before[i].v !== want.after[i].v;
        return r.changed === moved && r.same === !moved;
      });
      ok(`${c.name}: the rows that changed are marked and the rest are not`, changedOk,
        c.got.rows.map((r) => `${r.slot}:${r.changed ? 'CH' : '--'}`).join(' '));
    }

    // ---- the totals difference IS the week's printed gain ------------------
    //
    // The one number that ties the breakdown to the table above it. If these
    // two ever disagree the panel is describing a different trade.
    const printed = peek.deal.weeks.weeks.find((w) => w.label === 'Week 7');
    ok('the breakdown’s difference is exactly the gain printed for that week',
      printed && num(peek.backToMine.totals.delta) === printed.delta,
      `panel ${peek.backToMine.totals.delta}, table ${printed && printed.delta}`);
    ok('and its before/after are the row’s own two numbers',
      printed && num(peek.backToMine.totals.before.text) === printed.before &&
      num(peek.backToMine.totals.after.text) === printed.after,
      JSON.stringify(printed));

    // ---- one side at a time, his own first --------------------------------
    eq(peek.mineSide.sides.map((s) => `${s.side}:${s.pressed}`).join(' '), 'mine:true theirs:false',
      'it opens on YOUR lineup — both at once is too wide on a phone');
    eq(peek.mineSide.sides[1].label, 'Cy’s lineup', 'and the toggle names the other manager');
    eq(peek.theirSide.title, 'Week 7, slot by slot — Cy’s lineup',
      'pressing it shows his lineup instead');
    ok('his lineup is a different lineup, not yours relabelled',
      peek.theirSide.rows.map((r) => r.before.id).join(',') !==
      peek.mineSide.rows.map((r) => r.before.id).join(','));
    ok('and the toggle goes back', peek.backToMine.title === peek.mineSide.title &&
      peek.backToMine.sides[0].pressed === 'true');

    // The man Cy SENDS is a starter of his, so "OUT" is drawn somewhere on his
    // side — which makes that assertion a real one rather than vacuous. On
    // Ana's side the man she sends is a bench defence and is correctly absent.
    ok('the man being sent is marked OUT where he was starting',
      peek.theirSide.marks.some((m) => m.word === 'OUT' && m.cls.includes('gone')),
      JSON.stringify(peek.theirSide.marks));
    ok('the man being received is marked IN on both sides',
      peek.mineSide.marks.some((m) => m.word === 'IN' && m.cls.includes('got')) &&
      peek.theirSide.marks.some((m) => m.word === 'IN' && m.cls.includes('got')));
    ok('and one of his own men displaced by the deal carries the quiet mark',
      peek.mineSide.marks.some((m) => m.cls.includes('shift')) &&
      peek.theirSide.marks.some((m) => m.cls.includes('shift')),
      JSON.stringify([peek.mineSide.marks, peek.theirSide.marks]));
    // THE KEY UNDER THE TABLE IS ONE CLAUSE NOW (Tim, 2026-09-20: "the popup
    // still has the description below"). REPLACED, not relaxed: the old
    // assertion required all five marks to be SPELLED OUT visibly, which
    // encoded the behaviour he asked to be rid of — and four of the five were
    // restating cells that already say IN, OUT, promoted, benched and moved in
    // English. What is asserted now is the split itself.
    ok('nothing but the heavier-row clause is drawn under the slot table',
      /heavier/.test(peek.mineSide.keyVisible) &&
      !/you receive|you send|untouched/.test(peek.mineSide.keyVisible),
      JSON.stringify(peek.mineSide.keyVisible));
    ok('and the visible key is one short clause, not a paragraph',
      peek.mineSide.keyVisible.split(/\s+/).filter(Boolean).length <= 12,
      peek.mineSide.keyVisible);
    // THE MEANING IS MOVED, NOT DELETED. Weight is a cue with no word attached,
    // so the visible clause keeps it; the four self-describing marks survive
    // for a reader who gets neither colour nor weight.
    ok('every mark is still spelled out for a screen reader',
      ['IN', 'OUT', 'promoted', 'benched', 'moved']
        .every((w) => peek.mineSide.keySr.includes(w)),
      peek.mineSide.keySr);

    // ---- the played and playoff weeks open too, and say what they are ------
    ok('a played week opens and says it is in no total',
      /has been played/.test(peek.playedWeek.scope) && /no total/.test(peek.playedWeek.scope),
      peek.playedWeek.scope);
    ok('a playoff week opens and says it is shown for reference only',
      !!peek.playoff && /playoff week/.test(peek.playoff.scope) && /no total/.test(peek.playoff.scope),
      peek.playoff && peek.playoff.scope);

    // ---- IT COSTS NOTHING -------------------------------------------------
    //
    // The pop-up already bought these weeks. Hovering thirteen of them, tapping,
    // tabbing and flipping the side toggle are all arithmetic over projections
    // that are already in the page.
    eq(peek.requestsAfter, peek.requestsBefore,
      'hovering, tapping, focusing and flipping sides cost NO extra ESPN requests');

    // ---- and a plain mouse click still opens an offer ----------------------
    ok('a mouse click on another offer still opens that offer',
      !!peek.afterOtherClick.partner && peek.afterOtherClick.title.includes(peek.afterOtherClick.partner),
      `${peek.afterOtherClick.title} for ${peek.afterOtherClick.partner}`);
    // Re-aimed with V17: not "no week", but ITS OWN opening week — never the
    // week last picked on the other deal.
    const otherSwing = swingOf(peek.afterOtherClick.weeks);
    ok('and the new pop-up opens on its own biggest-swing week, not the last one picked',
      !!peek.afterOtherClick.breakdown && /moves most/.test(peek.afterOtherClick.breakdown.lead) &&
      otherSwing.some((w) => peek.afterOtherClick.breakdown.title.startsWith(`Week ${w},`)),
      JSON.stringify({ title: peek.afterOtherClick.breakdown && peek.afterOtherClick.breakdown.title, otherSwing }));
    // On a laptop the panel stays in its side column (V12 is below 900px only).
    ok('on a laptop the week detail stays in the side column',
      peek.hovered.inSideColumn && peek.hovered.afterRow === null,
      JSON.stringify({ side: peek.hovered.inSideColumn, after: peek.hovered.afterRow }));
  }

  // ---- the week peek on a phone: under the row that was tapped (V12) --------
  const narrow = run('weekPeekNarrow', { stub: true });
  ok('the narrow week-peek scenario boots', !narrow.boot, narrow.boot);
  if (!narrow.boot) {
    ok('no console errors on the narrow pop-up', narrow.errors.length === 0,
      narrow.errors.slice(0, 2).join(' | '));
    ok('the Cy offer was opened on the narrow window', narrow.found && narrow.deal.present);
    const nSwing = swingOf(narrow.deal.weeks);
    ok('below 900px the opening week’s detail sits in a row straight after that week',
      nSwing.includes(narrow.opened.afterRow) && !narrow.opened.inSideColumn,
      JSON.stringify({ after: narrow.opened.afterRow, side: narrow.opened.inSideColumn, nSwing }));
    ok('a tap on week 9 puts the detail straight after week 9',
      narrow.tapped.afterRow === '9' && narrow.tapped.title.startsWith('Week 9,'),
      JSON.stringify({ after: narrow.tapped.afterRow, title: narrow.tapped.title }));
    ok('and a tap on week 12 moves it after week 12',
      narrow.retapped.afterRow === '12' && narrow.retapped.title.startsWith('Week 12,'),
      JSON.stringify({ after: narrow.retapped.afterRow, title: narrow.retapped.title }));
    eq(narrow.retapped.sideColumnKids, 0, 'and the empty side column is left with nothing in it');
    eq(narrow.weeksAfter && narrow.weeksAfter.weeks.length, narrow.deal.weeks && narrow.deal.weeks.weeks.length,
      'the week table still reads as the same weeks with the detail inside it');
  }
}

// ---- the coming week's rosters: pickups in, drops out ---------------------
//
// Falsifiable by construction: with the page opening on the last PLAYED week
// (4), the finder offers the dropped 111 and never names 150.
{
  const pk = run('livePickup', { stub: true, env: { TR_PICKUP: '1' } });
  ok('the pickup scenario boots', !pk.boot, pk.boot);
  if (!pk.boot) {
    ok('no console errors', pk.errors.length === 0, pk.errors.slice(0, 2).join(' | '));
    const coming = String(pk.played + 1);
    eq(pk.opened.week, coming, 'with nothing saved, the page opens on the coming week');
    eq(String(pk.opened.asked[0]), coming,
      'and the FIRST rosters it reads are that week’s, not a played week’s');
    // The page reads the whole season now (2026-09-19) — the played weeks for
    // the card's Act row, the bracket for its run — so "which weeks were
    // asked for" is no longer the test. Which SQUADS it believes in is, and
    // that comes off the week it opened on.
    //
    // NAMED ON THE PAGE, not "in a package". A page reading the last PLAYED
    // week has never heard of the man picked up since, so naming him anywhere
    // is the claim; whether he lands in a SENT package is a fact about the
    // measure — under the weekly one he is a 12.0 receiver nobody wants to
    // move — and asserting it would tie this scenario to the finder's ranking
    // rather than to the rosters it read.
    ok('the man picked up THIS week is named on the page',
      pk.opened.ids.includes(pk.pickup.added),
      `sent ${pk.opened.sentNames.join(' | ')}`);
    ok('and never in a package he is not on the roster for',
      !pk.opened.sent.includes(pk.pickup.dropped), pk.opened.sent.join(','));
    ok('who is named nowhere on the page',
      !pk.opened.ids.includes(pk.pickup.dropped), pk.opened.ids.join(','));
    ok('the status says the week is still to play, on current rosters',
      /not played yet/.test(pk.opened.status) && /current rosters/.test(pk.opened.status),
      pk.opened.status);
    eq(pk.repicked.week, '3', 'a week picked by hand THIS visit is kept, played or not');
    ok('and the status says that week’s rosters are not today’s',
      /already played/.test(pk.repicked.status), pk.repicked.status);
  }

  const stale = run('livePickup', { stub: true, env: { TR_PICKUP: '1', TR_SAVED_WEEK: '2' } });
  ok('the saved-played-week scenario boots', !stale.boot, stale.boot);
  if (!stale.boot) {
    eq(stale.opened.week, String(stale.played + 1),
      'A SAVED WEEK THAT HAS BEEN PLAYED IS IGNORED: the page opens on the coming week');
    ok('and the pickup is still named on the page', stale.opened.ids.includes(stale.pickup.added),
      stale.opened.sentNames.join(' | '));
  }

  const ahead = run('livePickup', { stub: true, env: { TR_PICKUP: '1', TR_SAVED_WEEK: '7' } });
  ok('the saved-future-week scenario boots', !ahead.boot, ahead.boot);
  if (!ahead.boot) {
    eq(ahead.opened.week, '7', 'a saved week still to be played is honoured');
    // THE FIRST week it reads, not the only one: the page reads the whole
    // season now for the card's run, and which week it OPENS on is what this
    // scenario is about.
    eq(String(ahead.opened.asked[0]), '7', 'and it is the week whose rosters are read first');
  }
}


// ---- CUSTOM TRADES -------------------------------------------------------
//
// Tim, 2026-09-18: "I want to be able to pick whichever trade I want in the
// trade menu... This can be for any player with any team."
//
// The finder always trades FROM his squad. This does not, and the scenario
// deliberately builds a deal between two OTHER managers, because that is the
// half of his ask the existing panel cannot do at all — and because a page
// that priced it against his roster instead would produce numbers that look
// perfectly reasonable and are about the wrong team.
{
  const cu = run('custom');

  // -- (B) "YOU" IS THE MANAGER PICKED AT THE TOP OF THE PAGE ---------------
  //
  // Tim, 2026-09-19: "the custom trade section has the user choose both users
  // to trade, but the 'You' should always be the same user that is selected in
  // the top of the trade section with 'select manager'."
  //
  // THREE SEPARATE CLAIMS, and the first is the one that makes it true rather
  // than merely tidy: there is no second control. A page that kept the picker
  // and merely defaulted it would pass a test that only checked the default.
  //
  // FALSIFIABLE: put `<select id="cuTeamA">` back in trade.html and the first
  // fails; make `syncCustomPickers` stop reading `state.myTeamId` and the
  // second fails.
  eq(cu.noTeamAPicker, true, 'there is no second manager picker in the custom box');
  ok('the box names the manager selected at the top instead',
    /Your team/.test(cu.youLine) && cu.youLine.length > 20, cu.youLine);
  ok('and changing the top picker changes who “you” are in this box',
    cu.followedTop.you.includes(cu.followedTop.teamName) &&
      cu.followedTop.headA.startsWith(cu.followedTop.teamName),
    `${cu.followedTop.teamName} → ${cu.followedTop.you} / ${cu.followedTop.headA}`);
  ok('the partner picker never offers the squad that is now “you”',
    !cu.followedTop.bOptions.includes(cu.picked.a),
    `${cu.picked.a} in ${cu.followedTop.bOptions.join(',')}`);
  eq(cu.teamOptions.length, 9, 'so it offers the other nine managers');
  {
    const firsts = cu.optWeeks.map((w) => (w.length ? w[0] : Infinity));
    ok('OPP ORDER: the partner list names the weeks you play each manager',
      cu.optWeeks.filter((w) => w.length).length >= 5 && cu.optWeeks.every((w) => w.every((x, i) => i === 0 || x > w[i - 1])),
      JSON.stringify(cu.teamOptions));
    ok('OPP ORDER: and is ordered soonest meeting first, never-again last',
      firsts.every((f, i) => i === 0 || f >= firsts[i - 1]), JSON.stringify(cu.teamOptions));
  }

  ok('the box starts empty and says so',
    /No custom trades saved yet/.test(cu.startsEmpty), cu.startsEmpty);
  eq(cu.tickInstructions, 1, '"Tick who moves on each side" is printed once in the panel, not twice');
  eq(cu.wrapHiddenAtFirst, true, 'with no table until there is something in it');
  eq(cu.saveDisabledAtFirst, true, 'and nothing to save');

  ok('the two rosters are listed, one per side',
    cu.listA > 10 && cu.listB > 10, `${cu.listA} / ${cu.listB}`);
  ok('each side is headed by the squad that is sending',
    /sends$/.test(cu.headA) && /sends$/.test(cu.headB), `${cu.headA} | ${cu.headB}`);
  ok('and the two squads are different ones',
    cu.picked.a !== cu.picked.b, JSON.stringify(cu.picked));

  // -- (C) THE COLUMNS ARE MIRRORED, AND THE ROW TAKES THE SLACK -----------
  //
  // Tim, 2026-09-19: "I want to mirror the opponent user's order of columns in
  // the custom trade box so that both user's numbers are in the middle with the
  // player's names on the outside and whatnot. This allows for easier
  // comparison. Also condense the whole custom trade box horizontally."
  //
  // Read as the ORDER THE CELLS ARE ACTUALLY EMITTED IN, which is the only
  // reading that cannot be satisfied by a class name. The two value columns
  // must END UP FACING EACH OTHER: the left list's value is its LAST cell and
  // the right list's is its FIRST.
  //
  // FALSIFIABLE: drop the `mirror` branch in `customList` and the right-hand
  // order comes back as the left-hand one, failing three of these.
  const manned = (rows) => rows.filter((r) => r.name && r.name !== 'nobody');
  const leftRows = manned(cu.rowsA);
  const rightRows = manned(cu.rowsB);
  ok('there are men on both lists to compare', leftRows.length > 5 && rightRows.length > 5,
    `${leftRows.length} / ${rightRows.length}`);
  ok('the LEFT list reads checkbox, slot, name, position, value',
    leftRows.every((r) => r.order.join(',') === 'box,sl,gap,nm,pos,pv'),
    JSON.stringify(leftRows.slice(0, 2).map((r) => r.order)));
  ok('the RIGHT list is that order reversed — value, position, name, slot, checkbox',
    rightRows.every((r) => r.order.join(',') === 'pv,pos,nm,gap,sl,box'),
    JSON.stringify(rightRows.slice(0, 2).map((r) => r.order)));
  ok('so the two value columns face each other down the middle',
    leftRows.every((r) => r.order[r.order.length - 1] === 'pv') &&
    rightRows.every((r) => r.order[0] === 'pv'),
    `${leftRows[0].order.join(',')} | ${rightRows[0].order.join(',')}`);
  ok('and the names are on the outside, next to their own slot labels',
    leftRows.every((r) => r.order.indexOf('nm') > r.order.indexOf('sl')) &&
    rightRows.every((r) => r.order.indexOf('nm') < r.order.indexOf('sl')),
    'names must sit between the slot and the number on both sides');
  // THE SLACK IS BETWEEN THE SLOT AND THE NAME, which is what stops the name
  // pushing the position and the value apart — his literal complaint. A `.gap`
  // adjacent to the name on the number side would be the old layout again.
  ok('the spare width sits between the slot and the name, not between name and position',
    leftRows.every((r) => r.order.indexOf('gap') === r.order.indexOf('nm') - 1) &&
    rightRows.every((r) => r.order.indexOf('gap') === r.order.indexOf('nm') + 1),
    JSON.stringify(leftRows[0].order));
  ok('an empty slot is still a row on both sides',
    cu.rowsA.length > leftRows.length || cu.rowsB.length > rightRows.length ||
      cu.rowsA.length >= 16,
    `${cu.rowsA.length} rows, ${leftRows.length} with a man`);

  // -- (G) THE RED/GREEN SCALE ON THE VALUE COLUMN ------------------------
  //
  // Per POSITION across the two squads shown — never a quarterback against a
  // kicker (HANDOFF rule 14). And never colour alone: the key under the lists
  // says what the colour is measured against, and every tinted cell carries the
  // sentence in its own title.
  const tinted = [...leftRows, ...rightRows].filter((r) => /heat-(up|dn)-\d/.test(r.heat));
  ok('some men are tinted and not all of them',
    tinted.length > 0 && tinted.length < leftRows.length + rightRows.length,
    `${tinted.length} of ${leftRows.length + rightRows.length}`);
  ok('every tinted cell says in words where it stands',
    tinted.every((r) => /SD (above|below)/.test(r.heatTitle)),
    JSON.stringify(tinted.slice(0, 2).map((r) => r.heatTitle)));
  ok('and the cell says which GROUP it was measured against — his own position',
    tinted.every((r) => /on these two squads/.test(r.heatTitle)),
    tinted[0] && tinted[0].heatTitle);
  ok('the key under the lists says the scale is per position, not across the table',
    /his own position/i.test(cu.heatKey) && /these two squads/i.test(cu.heatKey) &&
      /[▲▼]/.test(cu.heatKey) && /heavier type/i.test(cu.heatKey),
    cu.heatKey.slice(0, 200));
  ok('and it is one short line, with the reasoning in the method below',
    cu.heatKey.split(/\s+/).length < 60 &&
      /never a quarterback against a kicker/i.test(cu.note),
    `${cu.heatKey.split(/\s+/).length} words`);
  ok('and the method says why a position rather than the same lineup slot',
    /a group of TWO/i.test(cu.note) && /eight to ten men/i.test(cu.note),
    cu.note.slice(0, 2600));

  // -- (H) THE CARD IS REACHABLE FROM EVERY NAME IN THE BUILDER -----------
  ok('every man in both lists carries a card, on his NUMBER',
    leftRows.every((r) => r.card) && rightRows.every((r) => r.card),
    `${leftRows.filter((r) => !r.card).length} left and ` +
    `${rightRows.filter((r) => !r.card).length} right without one`);
  // A card on the NAME would preventDefault the tap that ticks the man, on the
  // one device Tim reads this site on. The number is the affordance instead.
  ok('and never a TAP card on his name, which is the tap that ticks him',
    [...leftRows, ...rightRows].every((r) => r.nameIsNotTheCard),
    'a card on the name would swallow the tick on a phone');
  // Tim, 2026-09-30: "put the 14 week preview … if the user hovers over the
  // player's name". Hover only, so the tick above still holds.
  ok('CUSTOM LISTS: every name opens his card on a hover',
    leftRows.filter((r) => r.name && r.name !== 'nobody').every((r) => r.nameHover) &&
      rightRows.filter((r) => r.name && r.name !== 'nobody').every((r) => r.nameHover) &&
      leftRows.some((r) => r.nameHover),
    `${[...leftRows, ...rightRows].filter((r) => r.name && r.name !== 'nobody' && !r.nameHover).length} names without one`);

  // -- (F) THE BREAKDOWN SITS BESIDE THE BUILDER --------------------------
  //
  // Tim, 2026-09-19: "the trade analysis pop-up box for the custom trade is
  // great, but I'd like it to be shown to the side of the custom trade setup
  // while the trade is being chosen by the user."
  ok('with room beside the builder, the breakdown IS in the document',
    cu.inlinePresent === true, JSON.stringify(cu.buildRow));
  ok('the builder is split into two halves of ONE row, yours then his',
    Array.isArray(cu.buildRow) && cu.buildRow.length === 2 &&
      /cu-half-a/.test(cu.buildRow[0]) && /cu-half-b/.test(cu.buildRow[1]),
    JSON.stringify(cu.buildRow));
  ok('your half is [week box, roster] and his is [roster, week box], so the rosters meet in the middle',
    JSON.stringify(cu.halves) === JSON.stringify([['cu-inline', 'cu-side'], ['cu-side', 'cu-inline']]),
    JSON.stringify(cu.halves));
  ok('with nothing in it until a deal is being built, and it says so',
    cu.inlineBeforeTick.table === false &&
      /week-by-week breakdown appears here/i.test(cu.inlineBeforeTick.text),
    cu.inlineBeforeTick.text.slice(0, 160));

  // -- BOTH SIDES ARE LAID OUT AS A LINEUP (Tim, 2026-09-19) ---------------
  //
  // "display the two teams players like most other boxes with order of
  // positions and overall starting lineup (QB, RB1, RB2, ... BE, BE, BE, etc.)"
  //
  // It was best-first on the page's own measure, which is a fine order for a
  // list of assets and the wrong one for a list of players. The slot labels
  // come from `js/lineup-slots.js` — the SAME module the Analysis page's season
  // sheet and this page's own deal pop-up use — so a reader seeing WR2 in all
  // three is reading one claim rather than three.
  //
  // FALSIFIABLE: go back to sorting by value and the first label stops being QB
  // and the bench stops being contiguous at the end.
  for (const [side, slots] of [['A', cu.slotsA], ['B', cu.slotsB]]) {
    ok(`side ${side} labels every row with its lineup slot`,
      slots.length === (side === 'A' ? cu.listA : cu.listB) && slots.length > 10,
      `${slots.length} labels for ${side === 'A' ? cu.listA : cu.listB} rows`);
    eq(slots[0], 'QB', `side ${side} starts at quarterback, as a lineup does`);
    ok(`side ${side} numbers a slot the league starts more than one of`,
      slots.includes('RB1') && slots.includes('RB2'), slots.join(','));
    ok(`side ${side} puts the bench last, and all of it together`,
      slots.filter((s) => s === 'BE').length > 0 &&
      slots.slice(slots.indexOf('BE')).every((s) => s === 'BE'),
      slots.join(','));
    ok(`side ${side} shows the WHOLE roster — every starter and every bench man`,
      slots.length >= 16, `${slots.length} rows`);
  }

  // HALF A TRADE IS STILL A TRADE, and is priced: a manager giving somebody
  // away for nothing is a real thing to want to price, and refusing it would
  // be this panel having an opinion, which is the one thing it must not have.
  ok('one man on one side already prices',
    /sends/.test(cu.previewOneSided) && /priced over/.test(cu.previewOneSided),
    cu.previewOneSided);
  ok('the line above the lists says who moves which way, and over which weeks',
    /sends/.test(cu.preview) && /priced over weeks/.test(cu.preview), cu.preview);
  eq(cu.saveEnabled, true, 'and the deal can be saved');

  // -- EACH SIDE'S FIGURE, UNDER ITS OWN SIDE ------------------------------
  //
  // "just show the single # a week (over weeks 2-14) big and colorized in green
  // or red under their side of the trade (right now they're both under the
  // first players trade)."
  //
  // He was describing a real layout fault: both figures lived in one paragraph
  // below a two-column row, which lines up under the LEFT column on a laptop.
  // Reading them out of two separate containers is the only way to tell "under
  // its own side" from "both in one place", which is why this is not a regex
  // over the preview line.
  for (const [side, g] of [['A', cu.gainA], ['B', cu.gainB]]) {
    ok(`side ${side} carries its own per-week figure`, /^[+−]\d/.test(g.num), JSON.stringify(g));
    ok(`side ${side} leads with per week, not the season total`,
      /\/wk$/.test(g.num), g.num);
    ok(`side ${side} carries the rest-of-season total as the sub-number`,
      /^[+−][\d.]+ over weeks? /.test(g.sub), g.sub);
    ok(`side ${side} is coloured up or down`, /\b(up|down|flat)\b/.test(g.cls), g.cls);
    // COLOUR IS NEVER THE ONLY CUE — the sign is printed either way, the same
    // rule the depth map's tints and the Players page's two greens follow.
    ok(`side ${side} prints the sign as well as the colour`,
      /^[+−]/.test(g.num), g.num);
  }
  ok('and the two sides carry different numbers, or this proves nothing about ' +
    'which figure belongs to which squad',
    cu.gainA.num !== cu.gainB.num, `${cu.gainA.num} / ${cu.gainB.num}`);
  // THE COLOUR AGREES WITH THE SIGN, which is the claim — not that one side is
  // up and the other down. A custom trade can perfectly well be bad for both
  // squads, and this panel deliberately has no opinion about that: pricing a
  // deal somebody has offered you is the whole reason it exists.
  for (const [side, g] of [['A', cu.gainA], ['B', cu.gainB]]) {
    const want = g.num.startsWith('+') ? 'up' : g.num.startsWith('−') ? 'down' : 'flat';
    ok(`side ${side}'s colour agrees with the sign it prints`,
      g.cls.includes(want), `${g.num} drawn ${g.cls}`);
  }

  // -- THE BUILDER OPENS THE SAME POP-UP -----------------------------------
  //
  // "allow a trade analysis (identical to the box-pop up that appears when you
  // click on a pre-made trade) for this custom trade just like any other trade
  // that we have."
  //
  // A SAVED row already did this and still does, below. The deal being BUILT
  // could not — there was no way to see a deal week by week without committing
  // it to the list first, which is the wrong way round.
  eq(cu.openDisabledAtFirst, true, 'the Week by week button is off until there is a deal');
  eq(cu.openEnabled, true, 'and on once there is');
  eq(cu.builderModal.open, true, 'the deal being BUILT opens the finder’s own pop-up');
  ok('titled as a custom trade rather than printing undefined',
    /^Custom trade/.test(cu.builderModal.title) && !/undefined/.test(cu.builderModal.title),
    cu.builderModal.title);
  ok('with one row per week in it',
    cu.builderModal.weeks > 1, String(cu.builderModal.weeks));

  // The lists must NOT be rebuilt when a man is ticked. The reason CHANGED on
  // 2026-09-19 and the old one is gone: it used to be the scroll position of a
  // capped scroller, and the scroller went ("don't make a scrolling space").
  // What is left is focus — rebuilding replaces the checkbox that was just
  // operated and sends the keyboard back to the top of the document.
  eq(cu.stillChecked, true, 'ticking a man leaves him ticked');
  eq(cu.litRow, true, 'and lights his row');

  // -- "ALSO SEND" IS GONE (Tim, 2026-09-29) --------------------------------
  ok('the "also send" line is gone from the custom box',
    cu.suggestGone.line === false, JSON.stringify(cu.suggestGone));
  ok('and no roster row is marked as one to add',
    cu.suggestGone.marks === 0, JSON.stringify(cu.suggestGone));
  ok('and the words "also send" are nowhere in the panel',
    cu.suggestGone.words === false, JSON.stringify(cu.suggestGone));
  ok('nor in the method behind the toggle',
    !/also send|closer together/i.test(cu.note), cu.note.slice(0, 300));

  // -- HIS HALF: THE SAME TABLE, FROM HIS LINEUP (2026-09-29) --------------
  //
  // "the current 'this trade, week by week' box ... will also have an identical
  // varient on the opposite side that is for the opponent rather than for the
  // user."
  {
    const B = cu.inlineB;
    const bw = (B.weeks && B.weeks.weeks) || [];
    const aw = (cu.inline.weeks && cu.inline.weeks.weeks) || [];
    ok('his half has its own week-by-week table',
      B.present && B.table && bw.length > 1, JSON.stringify({ present: B.present, n: bw.length }));
    ok('titled with HIS name, not as this deal',
      /’s side, week by week$/.test(B.title) && !/^This deal/.test(B.title), B.title);
    ok('its rows are each after minus before too',
      bw.every((r) => Math.abs((r.after - r.before) - r.delta) <= 0.051),
      JSON.stringify(bw.slice(0, 3)));
    ok('the same weeks as yours, one row each',
      JSON.stringify(bw.map((r) => r.label)) === JSON.stringify(aw.map((r) => r.label)),
      `${bw.map((r) => r.label).join(',')} / ${aw.map((r) => r.label).join(',')}`);
    ok('and HIS numbers, not a copy of yours',
      bw.some((r, i) => aw[i] && r.before !== aw[i].before),
      JSON.stringify([bw[0], aw[0]]));
    ok('its "before" column is headed as his',
      B.weeks && B.weeks.heads[1] === 'As he is now', JSON.stringify(B.weeks && B.weeks.heads));
    ok('its slot-by-slot panel opens by itself, on HIS lineup',
      B.host && B.opening && /moves most/.test(B.opening.lead) &&
        JSON.stringify(B.opening.pressed) === '["theirs"]' && /’s lineup$/.test(B.opening.title),
      JSON.stringify(B.opening));
    ok('and names the same man as the box title',
      B.opening && B.title.split('’s side')[0].length > 0 &&
        B.opening.title.endsWith(`${B.title.split('’s side')[0]}’s lineup`),
      `${B.title} / ${B.opening && B.opening.title}`);
    ok('hovering a week in his half opens that week in HIS panel',
      cu.hoverB.week !== null && cu.hoverB.theirs.startsWith(`Week ${cu.hoverB.week},`),
      JSON.stringify(cu.hoverB));
    // REPLACED 2026-09-29 (Tim: the same player showed different numbers in
    // the two panels): the halves share ONE week now, so a hover in his table
    // moves yours to the same week.
    ok('and moves yours to the same week',
      cu.hoverB.mineAfter.startsWith(`Week ${cu.hoverB.week},`), JSON.stringify(cu.hoverB));
    ok('a week you play him is marked in both halves, the same weeks',
      JSON.stringify(cu.vsA) === JSON.stringify(cu.vsB), `${cu.vsA} / ${cu.vsB}`);
  }

  // -- (F) THE BREAKDOWN, once a deal is being built -----------------------
  ok('a deal in the pickers draws its weeks beside the lists, with no pop-up open',
    cu.inline.table === true && cu.inline.weeks && cu.inline.weeks.weeks.length > 1,
    JSON.stringify(cu.inline.weeks && cu.inline.weeks.weeks.length));
  ok('and it is titled as this deal’s own',
    /week by week/i.test(cu.inline.title), cu.inline.title);
  ok('its rows are each after minus before, exactly as the pop-up’s are',
    cu.inline.weeks && cu.inline.weeks.weeks.every(
      (r) => Math.abs((r.after - r.before) - r.delta) <= 0.051),
    JSON.stringify((cu.inline.weeks && cu.inline.weeks.weeks.slice(0, 3)) || []));
  ok('and per week comes first with the total under it, the same as everywhere else',
    !!(cu.inline.weeks && cu.inline.weeks.perFirst), 'per-week row must lead the totals');
  // V17, "same for #cuInline": before any week is hovered the slot-by-slot
  // panel already shows the week this deal moves most, not a prompt.
  {
    const ws = (cu.inline.weeks && cu.inline.weeks.weeks) || [];
    const top = Math.max(...ws.map((w) => Math.abs(w.delta)));
    const want = ws.filter((w) => Math.abs(w.delta) === top).map((w) => w.label.replace(/^Week /, ''));
    ok('the builder’s breakdown opens on the biggest-swing week before anything is hovered',
      !!cu.inlineOpening && cu.inlineOpening.table && /moves most/.test(cu.inlineOpening.lead) &&
      want.some((w) => cu.inlineOpening.title.startsWith(`Week ${w},`)),
      JSON.stringify({ opening: cu.inlineOpening, want }));
  }
  // THE SLOT-BY-SLOT PANEL IS THE POP-UP'S OWN, reached from inside the
  // builder — one renderer, not a second copy.
  ok('hovering a week in it opens that week slot by slot, in place',
    cu.inlineBreak && cu.inlineBreak.present && cu.inlineBreak.slots.length > 5,
    JSON.stringify(cu.inlineBreak && cu.inlineBreak.slots));
  ok('with the same side toggle the pop-up carries',
    cu.inlineBreak && cu.inlineBreak.sides.join(',') === 'mine,theirs',
    JSON.stringify(cu.inlineBreak && cu.inlineBreak.sides));
  ok('and none of it opens the modal',
    cu.inlineBreak && cu.inlineBreak.modalStillShut === true);

  // THE SLOT-BY-SLOT IS A CARD ON THE WEEK LABEL, not a box under the table
  // (Tim, 2026-09-30).
  {
    const f = cu.float || {};
    ok('SLOT CARD: no slot-by-slot box sits inside either week-by-week half',
      f.boxInHalf === false, JSON.stringify(f));
    ok('SLOT CARD: each half has its own floating card on the page, hidden until asked',
      f.bodyChild === true && f.bodyChildB === true && f.hiddenAtFirst === true, JSON.stringify(f));
    ok('SLOT CARD: hovering a "Week N" label shows that week in the card',
      f.hoverShows === true && new RegExp(`^Week ${f.hoverWeek}( \\(played\\))?,`).test(String(f.hoverTitle || '')),
      JSON.stringify(f));
    ok('SLOT CARD: leaving the label hides it after a short grace, not at once',
      f.leaveStillShownAtOnce === true && f.leaveHides === true, JSON.stringify(f));
    ok('SLOT CARD: a click pins it, and it stays when the pointer leaves',
      f.clickPins === true && f.pinnedStays === true, JSON.stringify(f));
    ok('SLOT CARD: Close, Escape and a click elsewhere each put it away',
      f.closeHides === true && f.escapeHides === true && f.outsideHides === true, JSON.stringify(f));
  }
  ok('MEET TOP: the weeks you play him are named at the top of the custom box',
    !!cu.meetTop && cu.meetTop.inPick && /^Weeks? \d/.test(cu.meetTop.text) &&
      cu.vsA.every((w) => new RegExp(`\\b${w}\\b`).test(cu.meetTop.text)),
    JSON.stringify({ top: cu.meetTop, vs: cu.vsA }));

  // -- (F2) AND ONLY WHERE THERE IS ROOM FOR IT --------------------------
  //
  // His ask carried its own condition — "(There will be enough space to the
  // side of the box once we condense it…)" — and below about 900px of window
  // there is no side. Leaving it in anyway made `#customPanel` 1949px tall at a
  // 900px window against 1182 at HEAD, because the breakdown took enough width
  // off the two mirrored rosters that THEY stacked; at 390px it was +191px, on
  // the page he actually reads.
  //
  // THE CLAIM IS ABOUT THE DOCUMENT, NOT ABOUT A STYLE. `display: none` would
  // keep the flex slot, the gap and a week table holding the previous answer —
  // a defect this page has shipped before — so the assertion is that the node
  // is GONE, with a deal priced and both big figures on screen.
  //
  // FALSIFIABLE, and each of these was watched to fail before being kept:
  //   • make `roomBesideBuilder()` return true and `narrow.host` becomes true,
  //     `inlineNodes` 1 and `panelWeekTables` 1;
  //   • swap the removal for `host.hidden = true` and `inlineNodes` stays 1;
  //   • drop the `min-width` branch from the harness stub and the WIDE
  //     assertions above fail instead.
  {
    const narrow = run('customNarrow');
    ok('on a narrow window the breakdown is not in the document before a deal',
      narrow.hostBeforeTick === false, JSON.stringify(narrow.buildRow));
    ok('and each half is its roster alone',
      JSON.stringify(narrow.halves) === JSON.stringify([['cu-side'], ['cu-side']]),
      JSON.stringify(narrow.halves));
    ok('a deal still prices, with its per-week figure under its own side',
      /[+−-]\d/.test(narrow.priced || ''), narrow.priced);
    ok('and the breakdown is still absent — gone, not hidden',
      narrow.host === false && narrow.inlineNodes === 0 &&
        narrow.panelWeekTables === 0 && narrow.panelInlineTitles === 0,
      `host ${narrow.host}, nodes ${narrow.inlineNodes}, ` +
      `tables ${narrow.panelWeekTables}, titles ${narrow.panelInlineTitles}`);
    // Nothing may lose a tap route on a phone (HANDOFF). The button was always
    // the way every other trade on this page showed its weeks.
    ok('the “Week by week” button is the way in, and it opens the same weeks',
      narrow.openEnabled === true && narrow.modal.open === true && narrow.modal.weeks > 1,
      JSON.stringify(narrow.modal));
    ok('and it closes again', narrow.modalClosed === true);
    ok('with no console errors on the narrow page either',
      Array.isArray(narrow.errors) && narrow.errors.length === 0,
      JSON.stringify((narrow.errors || []).slice(0, 2)));
  }

  // -- (E) A SAVED ROW IS A FOUND ROW -------------------------------------
  //
  // Tim, 2026-09-19, with his own before and after: the saved row was a name, a
  // run-on sentence and two bare figures, while a finder row is a proper table
  // row. It goes through `offerRow` now, so `readOfferRows` — the reader the
  // finder's and the combo's rows go through — has to be able to parse it.
  //
  // FALSIFIABLE: go back to the hand-built row and `readOfferRows` finds no
  // `td.pkg`/`td.gain`/`td.espn` at all, failing every one of these.
  eq(cu.savedRows.length, 1, 'saving puts one row in the box');
  eq(cu.wrapShown, true, 'and reveals the table');
  eq(cu.emptyHiddenAfterSave, true, 'and hides the empty state');
  {
    const r = cu.savedRows[0];
    ok('the saved row names the other squad in its own element',
      r.partner.length > 0, r.partner);
    // No Deal column since 2026-09-30 (Tim: "just remove the "deal" column"),
    // and "Ask AI" on the end, after Remove.
    ok('it has no Deal cell; Assume, Remove and "Ask AI" stacked in its last cell',
      !r.hasDeal && r.lastAsk === 'Ask AI' && r.askButtons === 1 && cu.savedLastTwo === 'cu-remove:Assume/Remove/Ask AI',
      `${r.hasDeal} ${r.lastAsk} ${r.askButtons} ${cu.savedLastTwo}`);
    ok('it lists the men each way, with a card and a link on every one',
      r.send.length + r.receive.length >= 2 &&
      [...r.send, ...r.receive].every((m) => m.id !== null),
      JSON.stringify([r.send.map((m) => m.text), r.receive.map((m) => m.text)]));
    ok('it shows the lineup before and after, per week over the total',
      r.hasLineup && /→/.test(r.beforeAfter) && /\/wk/.test(r.beforeAfter),
      r.beforeAfter);
    ok('it carries both gains, per week with the season total under them',
      r.hasMyGain && /\/wk/.test(r.gainText) && /total/.test(r.gainText) &&
        Number.isFinite(r.myGain) && Number.isFinite(r.theirGain),
      `${r.gainText} · ${r.myGain}/${r.theirGain}`);
    ok('it has the same Week by week button the finder’s rows carry',
      r.opener && r.openKey === 'cu:0', `${r.opener} ${r.openKey}`);
    ok('an ESPN cell, honest about demo like every other row',
      /No ESPN league in demo/.test(r.espn), r.espn);
    eq(cu.savedRemove, 1, 'and Remove as one extra cell on the end');
    ok('the head names every column the row draws',
      cu.savedHeads.join(' | ').includes('You send') &&
      cu.savedHeads.join(' | ').includes('You gain') &&
      cu.savedHeads.join(' | ').includes('ESPN'),
      cu.savedHeads.join(' | '));
  }

  eq(cu.ticksClearedAfterSave, 0, 'saving clears the ticks');
  ok('but keeps the squads, so a second deal between the same two is quick',
    cu.pickersKept.a === cu.picked.a && cu.pickersKept.b === cu.picked.b,
    JSON.stringify(cu.pickersKept));

  // ONLY THE IDENTITIES ARE STORED. A price kept from last week is wrong by
  // this week's projections, so storing one is storing a number that will
  // quietly go stale and never say so.
  ok('the saved trade is kept in prefs', Array.isArray(cu.stored) && cu.stored.length === 1,
    JSON.stringify(cu.stored));
  if (Array.isArray(cu.stored) && cu.stored[0]) {
    const keys = Object.keys(cu.stored[0]).sort().join(',');
    eq(keys, 'a,b,sendA,sendB', 'and holds two squads and two lists — NO PRICE');
  }

  eq(cu.rowsAfterDuplicate, 1, 'saving the same deal twice keeps one row');

  // The pop-up is the finder's own, which is the point of reusing its shape.
  eq(cu.modalOpen, true, 'a saved row opens the finder’s own pop-up');
  ok('and it is titled as a CUSTOM trade, not as one of the finder’s shapes',
    /^Custom trade/.test(cu.modalTitle) && !/undefined/.test(cu.modalTitle), cu.modalTitle);
  ok('naming the squad on the other side', cu.modalTitle.includes('with'), cu.modalTitle);
  ok('and the pop-up has the deal in it', cu.modalBody > 40, String(cu.modalBody));

  eq(cu.rowsAfterDrop, 0, 'removing the row empties the box');
  ok('and forgets it', !cu.storedAfterDrop || cu.storedAfterDrop.length === 0,
    JSON.stringify(cu.storedAfterDrop));

  ok('the note says it prices whatever you build, good or bad',
    /no opinion about whether a deal is good/i.test(cu.note), cu.note.slice(0, 300));
  ok('and that “you” is the manager picked at the top of the page',
    /is the manager selected in Your team at the top/i.test(cu.note), cu.note.slice(0, 900));
  ok('and that any two squads can still be priced, by moving that one picker',
    /Any two squads can still be priced/i.test(cu.note), cu.note.slice(0, 1200));
  ok('and that a saved trade keeps the squads it was built with',
    /never rewritten/i.test(cu.note), cu.note.slice(0, 1400));
  ok('and that only the players are saved, never the price',
    /never the price/i.test(cu.note), cu.note.slice(0, 700));
}

// ---- THE GOAL: "Win it all", the default (Tim, 2026-09-21) -----------------
//
// "the user should essentially open with a goal and all the data aligns with
// that goal … The trade should be ranked by the increase/decrease in this
// chance." Every scenario above is pinned to "Don't finish last" (see `boot`);
// these two are the title goal, on demo and on the stubbed live league.

const gt = run('goalTitle', { env: { TR_GOAL: 'title' } });
ok('the title-goal scenario boots', !gt.boot, gt.boot);
if (!gt.boot) {
  const T = gt.title;
  ok('no console errors under the title goal', gt.errors.length === 0, gt.errors.slice(0, 2).join(' | '));
  ok('and demo still costs no request', gt.fetchCalls.length === 0, gt.fetchCalls.join(' | '));
  eq(T.goalOn, 'Win it all', 'the page opens with the goal "Win it all" lit');

  // -- the column, second, beside the manager --------------------------------
  eq(T.heads[1], 'Δ title chance', 'the column right after Manager is the title chance');
  ok('every row carries a goal cell in that position',
    T.trades.length > 2 && T.trades.every((t) => t.goal && t.goal.index === 1),
    JSON.stringify(T.trades.slice(0, 2).map((t) => t.goal)));

  // -- THE SPAN REACHES THE PLAYOFF WEEKS -------------------------------------
  // Demo's bracket is 14–16 (three rounds after a 13-week season). The gain
  // heading names the priced weeks; under this goal they run to 16.
  const firstWeek = Number(T.week) + 1;
  ok('the playoff weeks are priced: the gains run through week 16',
    T.heads.some((h) => h === `You gain a week (weeks ${firstWeek}–16)`), T.heads.join(' | '));
  ok('and the method says so, and why',
    /The playoff weeks are priced/.test(T.note) && /where the title is won/.test(T.note), T.note.slice(0, 400));
  if (gt.deal && gt.deal.weeks) {
    const labels = gt.deal.weeks.weeks.map((r) => Number(String(r.label).replace(/\D/g, '')));
    ok('the pop-up’s priced table runs through the bracket, weeks 14–16 included',
      [14, 15, 16].every((w) => labels.includes(w)) && labels[0] === firstWeek,
      labels.join(','));
    ok('so there is no "for reference" playoff section after it — they would count twice',
      gt.deal.weeks.playoff.length === 0, JSON.stringify(gt.deal.weeks.playoff));
  } else {
    ok('the top row opens its pop-up', false, JSON.stringify(gt.deal).slice(0, 200));
  }

  // -- RANKED BY THE GOAL ------------------------------------------------------
  ok('the status line says the list is ranked by the title chance',
    /ranked by your title chance/.test(T.count), T.count.slice(0, 300));
  const scored = T.trades.filter((t) => t.goal && Number.isFinite(t.goal.v) && /%/.test(t.goal.head));
  ok('every offer was played out — each goal cell holds a percentage',
    scored.length === T.trades.length, `${scored.length} of ${T.trades.length}`);
  ok('and the rows are in the order of that expected change, best first',
    T.trades.every((t, i, a) => i === 0 || a[i - 1].goal.v >= t.goal.v - 0.0001),
    T.trades.map((t) => t.goal.v.toFixed(4)).join(','));
  ok('which is NOT simply the points order — the goal really does re-rank',
    T.trades.some((t, i, a) => i > 0 && a[i - 1].myGain < t.myGain),
    T.trades.map((t) => t.myGain).join(','));
  ok('each cell says before → after and how likely he is to say yes',
    scored.every((t) => /^\d+\.\d% → \d+\.\d% · \d+% yes$/.test(t.goal.sub)),
    scored.slice(0, 3).map((t) => t.goal.sub).join(' | '));
  ok('and a green cell is one that helps, a red one one that hurts — by sign as well as hue',
    scored.every((t) => (/\bpos\b/.test(t.goal.cls) ? /^\+/.test(t.goal.head) : true) &&
      (/\bneg\b/.test(t.goal.cls) ? /^−/.test(t.goal.head) : true)),
    scored.map((t) => `${t.goal.cls}:${t.goal.head}`).slice(0, 6).join(' '));
  ok('the method prints the yes-curve with its two constants, so a row can be checked',
    /Will he say yes\?/.test(T.note) && /3\) ÷ 1\.5/.test(T.note) && /88% at dead even/.test(T.note),
    T.note.slice(T.note.indexOf('Will he'), T.note.indexOf('Will he') + 400));

  // -- RE-DERIVED: the top row's title chance, from nothing of the page's -----
  //
  // The demo league rebuilt from its generators, the deal priced for BOTH
  // squads with the engine over the same weeks, the season built with the
  // Schedule page's own functions and simulated on the same seed. The page's
  // printed before → after must be that answer. FALSIFIABLE: shift only your
  // side (drop `theirByWeek`), or price the regular season alone, and it moves.
  {
    const top = scored[0];
    const re = top ? await rederiveGoal(T, top, 'title') : null;
    const shown = top ? top.goal.sub.match(/^(\d+\.\d)% → (\d+\.\d)% · (\d+)% yes$/) : null;
    ok('the top row’s title chance re-derives from the engine alone',
      !!re && !!shown && Math.abs(Number(shown[1]) - re.before * 100) <= 0.051 &&
        Math.abs(Number(shown[2]) - re.after * 100) <= 0.151,
      `page ${top && top.goal.sub} vs engine ${re && `${(re.before * 100).toFixed(2)} → ${(re.after * 100).toFixed(2)}`}`);
    ok('and so does the chance he says yes',
      !!re && !!shown && Math.abs(Number(shown[3]) - re.accept * 100) <= 1.01,
      `page ${shown && shown[3]}% vs engine ${re && (re.accept * 100).toFixed(1)}%`);
  }

  // -- THE CANDIDATES FOLLOW THE GOAL ------------------------------------------
  ok('the method says which deals are found follows the goal, and prints the week weights',
    /Which deals are found follows the goal too/.test(T.note) && /wk 16 ×\d+\.\d/.test(T.note),
    T.note.slice(T.note.indexOf('Which deals'), T.note.indexOf('Which deals') + 300));
  {
    const m = T.note.match(/wk (\d+) ×(\d+\.\d)/g) || [];
    const wt = new Map(m.map((s) => { const [, w, x] = s.match(/wk (\d+) ×(\d+\.\d)/); return [Number(w), Number(x)]; }));
    const reg = [...wt].filter(([w]) => w <= 13).map(([, x]) => x);
    const po = [...wt].filter(([w]) => w >= 14).map(([, x]) => x);
    ok('and a playoff week weighs more than any regular week — that is where the title is won',
      po.length === 3 && reg.length > 0 && Math.min(...po) > Math.max(...reg),
      JSON.stringify([...wt]));
  }
  ok('the method says he may lose a little, and how much',
    /loses no more than 2 a week/.test(T.note), T.note.slice(0, 500));

  // -- THE HONESTY PASS (2026-09-23, docs/trade-rework-plan.md phase 1) --------
  //
  // Five claims the page was making that were not true, each with an assertion
  // that fails on the code as it was. They are together because they are one
  // change of mind: the page stops overselling what it knows.

  // (1) THE PANEL SAYS WHAT IT FINDS. "Trades that help both squads" / "Every
  // swap that raises both starting lineups" described the old points finder.
  eq(T.finderTitle.split(' · ')[0], 'Trades ranked by your title chance',
    'the finder is titled by the goal it ranks on, not by a rule it dropped');
  ok('and neither the heading nor the lede claims both squads gain',
    !/both squads/i.test(T.finderTitle) && !/both starting lineups/i.test(T.lede),
    `${T.finderTitle} | ${T.lede}`);

  // (2) LEVEL, NOT RANKED. Tim, 2026-09-23: show near-ties as tied. The band is
  // 0.4 of a percentage point, measured over twelve seeds (js/trade-odds.js
  // TIE_BAND). Every row carries its rank; rows the simulation cannot separate
  // share one with an "=" after it.
  ok('every played-out row carries a rank number',
    scored.length > 0 && scored.every((t) => /^\d+=?$/.test(t.goal.place)),
    scored.map((t) => t.goal.place).slice(0, 8).join(' '));
  eq(T.trades[0].goal.place.replace('=', ''), '1', 'and the top row is rank 1');
  ok('the ranks never go backwards down the table',
    T.trades.every((t, i, a) => i === 0 ||
      Number(a[i - 1].goal.place.replace('=', '')) <= Number(t.goal.place.replace('=', ''))),
    T.trades.map((t) => t.goal.place).join(','));
  // THE DEMO LIST HAS A TIE — measured: the top offer stands alone at +1.5 pp
  // clear, and the rows under it sit inside 0.4 pp of each other. Without one
  // there is nothing to assert, so its absence is a failure rather than a skip.
  const levelled = T.trades.filter((t) => t.goal && t.goal.level);
  ok('the sample league really does produce a group of level offers',
    levelled.length > 1, `${levelled.length} rows marked level`);
  ok('a level group shares ONE rank number, and every row in it is marked "="',
    levelled.length > 1 && new Set(levelled.map((t) => t.goal.place)).size >= 1 &&
      levelled.every((t) => /=$/.test(t.goal.place)),
    levelled.map((t) => t.goal.place).join(','));
  {
    // Rows sharing a rank must sit next to each other AND keep the strict order.
    const groups = new Map();
    T.trades.forEach((t, i) => {
      const k = t.goal.place;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    ok('a rank number is never split across the table — a group is contiguous',
      [...groups.values()].every((idx) => idx[idx.length - 1] - idx[0] === idx.length - 1),
      JSON.stringify([...groups].map(([k, v]) => [k, v])));
    ok('AND THE GROUPING NEVER MOVES A ROW: inside a level group the order is still strict',
      [...groups.values()].every((idx) =>
        idx.every((n, j) => j === 0 || T.trades[idx[j - 1]].goal.v >= T.trades[n].goal.v - 0.0001)),
      T.trades.map((t) => `${t.goal.place}:${t.goal.v.toFixed(4)}`).join(' '));
    ok('and the rank number really is the row\'s position — the first row of its group',
      [...groups].every(([k, idx]) => Number(String(k).replace('=', '')) === idx[0] + 1),
      JSON.stringify([...groups].map(([k, v]) => [k, v[0] + 1])));
  }
  // IN VIEW, AND IN THE LEDE. The status line is capped at sixty words by the
  // heat-key assertion above and already stood at 59, so the notation goes where
  // the panel's other always-true sentence is. Both halves are pinned: the glyph
  // and the reason, so a lede that lost either would fail.
  ok('the panel says in view what a shared rank means, and why',
    /\(=\)/.test(T.lede) && /too close to separate/.test(T.lede), T.lede);
  ok('and the status line is still a short key, not the method',
    T.count.split(/\s+/).length < 60, `${T.count.split(/\s+/).length} words`);
  ok('and the method behind the toggle carries the measured band and the argument',
    /±0\.4 of a percentage point between seeds/.test(T.note) &&
      /standard deviation of 0\.27/.test(T.note) &&
      /closer than 0\.4 of a point are shown as level/.test(T.note) &&
      /the grouping never moves a row/.test(T.note),
    T.note.slice(T.note.indexOf('It still moves'), T.note.indexOf('It still moves') + 700));

  // (3) THE SIGN ON THE TWO GAIN CELLS. `offerRow` wrote `pos` on both of them
  // whatever the number was, so on the sample league all forty "He gains" cells
  // were negative and all forty were green.
  ok('the sample league still offers deals the other manager loses on — or the next check is vacuous',
    T.trades.some((t) => t.theirGain < -0.05), T.trades.map((t) => t.theirGain).slice(0, 6).join(','));
  const signWanted = (v, n) => {
    const per = v / n;
    return per > 0.05 ? 'pos' : per < -0.05 ? 'neg' : '';
  };
  {
    const n = Number((T.heads.find((h) => /^You gain a week \(weeks (\d+)–16\)$/.test(h)) || '')
      .replace(/^You gain a week \(weeks (\d+)–16\)$/, '$1'));
    const span = 16 - n + 1;
    ok('a negative gain cell is red and a positive one green — both columns, by the number in them',
      T.trades.every((t) => t.mySign === signWanted(t.myGain, span) &&
        t.theirSign === signWanted(t.theirGain, span)),
      T.trades.map((t) => `${t.theirGain.toFixed(1)}/${span}→${t.theirSign}`).slice(0, 6).join(' '));
    ok('and no negative figure anywhere in those two columns is painted as a gain',
      T.trades.every((t) => !(t.theirGain < -0.05 && t.theirSign === 'pos')) &&
        T.trades.every((t) => !(t.myGain < -0.05 && t.mySign === 'pos')),
      T.trades.filter((t) => t.theirGain < 0 && t.theirSign === 'pos').length + ' green minus signs');
  }

  // (4) NO FALSE PRECISION. No chance is printed to two decimals anywhere, and a
  // stated change carries the measured band.
  ok('every goal cell prints the ± band beside the change it states',
    scored.every((t) => t.goal.band === '±0.4' && /^[+−]?\d+\.\d% ±0\.4$/.test(t.goal.head)),
    scored.slice(0, 4).map((t) => `"${t.goal.head}" band="${t.goal.band}"`).join(' | '));
  ok('and no chance is quoted to two decimal places — not in a cell, not in a tooltip',
    T.trades.every((t) => !/\d\.\d\d\s*%/.test(`${t.goal.head} ${t.goal.sub} ${t.goal.title}`)) &&
      !/\d\.\d\d\s*%/.test(T.count),
    (T.trades.find((t) => /\d\.\d\d\s*%/.test(t.goal.title)) || { goal: {} }).goal.title || '');
  ok('the pop-up and the combo state the band too, wherever they state a change',
    /±0\.4/.test(gt.dealGoal) && /±0\.4/.test(gt.cuPreview),
    `${gt.dealGoal} | ${gt.cuPreview}`);

  // (5) THE BRACKET-WEEK BASIS, said in the note (rule 7). The gain columns add
  // the playoff weeks up at face value; the goal % weighs them by how often you
  // are there. Measured on the sample league: the top deal read +0.9 over the
  // span while costing 24.9 points across the seven weeks it is certain to play.
  ok('the note says the gain columns and the goal chance are not on the same footing',
    /not on the same footing/.test(T.note) &&
      /as if you were certain to play them/.test(T.note) &&
      /how often the simulation actually has you in it/.test(T.note),
    T.note.slice(T.note.indexOf('not on the same'), T.note.indexOf('not on the same') + 500));
  ok('and under "Don’t finish last", where no playoff week is priced, it does not say it',
    !/not on the same footing/.test(gt.last.note), gt.last.note.slice(0, 200));
  // HIS SIDE'S BASIS (trade plan Phase 3): He gains weighs each of his playoff
  // weeks by the chance he plays it, and that figure decides which deals exist.
  ok('the note states He gains is counted over the weeks he will actually play',
    /He gains counts each playoff week by the chance he plays in it/.test(T.note) &&
      /a first-round bye counts as a week off/.test(T.note) &&
      /decides which deals are found/.test(T.note),
    T.note.slice(T.note.indexOf('He gains counts'), T.note.indexOf('He gains counts') + 400));
  ok('and under "Don’t finish last" it does not, since no playoff week is priced',
    !/He gains counts each playoff week/.test(gt.last.note), gt.last.note.slice(0, 200));

  // -- THE POP-UP AND THE CUSTOM BOX SAY IT TOO ---------------------------------
  ok('the pop-up leads with the same title chance as its row',
    /^Your title chance/.test(gt.dealGoal) && scored[0] && gt.dealGoal.includes(scored[0].goal.head) &&
      gt.dealGoal.includes(scored[0].goal.sub.split(' · ')[0]),
    `${gt.dealGoal} vs ${scored[0] && `${scored[0].goal.head} ${scored[0].goal.sub}`}`);
  ok('a custom deal was built by ticking a man each side', gt.ticked);
  ok('the builder says what the deal does to the title chance as it is built',
    /title chance [+−]?\d+\.\d%/.test(gt.cuPreview) && /he says yes/.test(gt.cuPreview), gt.cuPreview);
  ok('and the saved row carries the goal column like a finder row',
    !!gt.cuRow && gt.cuRow.goal && /%/.test(gt.cuRow.goal.head) && gt.cuRow.goal.index === 1,
    JSON.stringify(gt.cuRow && gt.cuRow.goal));
  // 2026-09-29: the saved table matches the finder's new columns, header and cell.
  ok('the saved table’s head matches the finder’s: both chances, and his projection vs you',
    gt.cuHeads[1] === 'Δ title chance' && gt.cuHeads[2] === 'Δ last chance' && gt.cuHeads.includes('His proj vs you'),
    gt.cuHeads.join(' | '));
  ok('and the saved row fills the preview and his-projection cells',
    !!gt.cuRow && gt.cuRow.alt && gt.cuRow.alt.index === 2 && /%/.test(gt.cuRow.alt.head) && !!gt.cuRow.opp,
    JSON.stringify(gt.cuRow && [gt.cuRow.alt, gt.cuRow.opp]));

  // -- AND THE OTHER GOAL ----------------------------------------------------
  const L = gt.last;
  eq(L.goalOn, 'Don’t finish last', 'pressing "Don’t finish last" lights it');
  eq(gt.stored, 'last', 'and the choice is remembered');
  eq(L.heads[1], 'Δ last chance', 'the column becomes the chance of finishing last');
  ok('and the span drops back to the regular season — the playoffs cannot move last place',
    L.heads.some((h) => h === `You gain a week (weeks ${firstWeek}–13)`), L.heads.join(' | '));
  ok('the status line names the new goal',
    /chance of finishing last/.test(L.count), L.count.slice(0, 300));
  ok('and the method says why the regular season alone is priced',
    /regular-season<\/strong>|regular-season table/.test(L.note) || /bottom of the regular-season/.test(L.note),
    L.note.slice(0, 500));
}

// ---- HIS HALF UNDER "WIN IT ALL" (2026-09-29) ------------------------------
const ch = run('customHalves', { env: { TR_GOAL: 'title' } });
ok('the custom-halves scenario boots', !ch.boot, ch.boot);
if (!ch.boot) {
  ok('no console errors in it', ch.errors.length === 0, ch.errors.slice(0, 2).join(' | '));
  const bw = (ch.weeksB && ch.weeksB.weeks) || [];
  ok('a partner you still play was found (so the meeting check is not vacuous)',
    ch.vsA.length > 0, `tried ${ch.tried}`);
  ok('the week you play him carries the mark in YOUR half and in HIS, the same weeks',
    ch.vsA.length > 0 && JSON.stringify(ch.vsA) === JSON.stringify(ch.vsB), `${ch.vsA} / ${ch.vsB}`);
  ok('in his half the mark says it is the week he plays you',
    ch.vsTextB.length > 0 && ch.vsTextB.every((t) => /vs you/.test(t)), JSON.stringify(ch.vsTextB));
  ok('under "Win it all" his bracket weeks say how likely he is to be playing',
    bw.some((r) => r.reachNote && r.reach < 1), JSON.stringify(bw.map((r) => [r.label, r.reach])));
  ok('and your half carries no such note (your side is already in the goal %)',
    ((ch.weeksA && ch.weeksA.weeks) || []).every((r) => !r.reachNote), '');
  // Tim, 2026-09-30: "for the week that the two user's play, subtract the
  // opponent's projection change to your difference" (+5.6 and his −5.4 is +11.0).
  {
    const aw = (ch.weeksA && ch.weeksA.weeks) || [];
    const meet = aw.filter((r) => /his/.test(r.vs));
    const hisOf = (r) => num((r.vs.match(/his\s*([+−-]?[\d.]+)/) || [])[1] || 'NaN');
    ok('NET WEEK: in YOUR table, a week you play him prints your change minus his',
      meet.length > 0 && meet.every((r) => {
        const his = hisOf(r);
        const want = Math.round((r.delta - his) * 10) / 10;
        // ±0.1: each printed figure is rounded to a tenth on its own.
        return Number.isFinite(his) && Math.abs(r.shown - want) < 0.11 &&
          (Math.abs(his) < 0.05 || r.netted);
      }),
      JSON.stringify(meet.map((r) => [r.label, r.vs, r.delta, r.shown])));
    ok('NET WEEK: and every other week is your change alone',
      aw.filter((r) => !/his/.test(r.vs)).every((r) => !r.netted && r.shown === r.delta), '');
    ok('NET WEEK: his own table is not netted',
      bw.every((r) => !r.netted), '');
    // NET TOTALS (2026-09-30, Tim: "add the change in opponent proj to the
    // total +/- gain"): the total as shown is the sum of the netted weeks, and
    // your own lineup's sum stays under it ("you ±x").
    const tot = ch.weeksA && ch.weeksA.totalRow;
    ok('NET WEEK: the total is the sum of the weeks as shown (net), your own change under it',
      !!tot && tot.netted &&
        Math.abs(tot.shown - aw.reduce((a, r) => a + r.shown, 0)) <= 0.1 + 0.006 * aw.length &&
        Math.abs(tot.delta - aw.reduce((a, r) => a + r.delta, 0)) <= 0.1 + 0.006 * aw.length,
      JSON.stringify(tot));
    const cuTotal = num((ch.cuGainA.match(/^([+−-]?[\d.]+)/) || [])[1] || 'NaN');
    ok('NET WEEK: and the builder’s You gain is that same net total, to the tenth',
      !!tot && Math.abs(cuTotal - tot.shown) <= 0.051 && Math.abs(cuTotal - tot.delta) > 0.05,
      `builder ${ch.cuGainA} · table ${tot && tot.shown} (yours ${tot && tot.delta})`);
  }
  const want = bw.reduce((a, r) => a + r.reach * r.delta, 0);
  const tol = 0.1 + 0.006 * bw.reduce((a, r) => a + Math.abs(r.delta), 0);
  const got = ch.weeksB && ch.weeksB.totalRow ? ch.weeksB.totalRow.delta : NaN;
  ok('his total counts each week by his chance of playing it (Σ chance × difference)',
    Math.abs(got - want) <= tol, `page ${got}, from its own rows ${want.toFixed(2)} ±${tol.toFixed(2)}`);
  const flat = bw.reduce((a, r) => a + r.delta, 0);
  ok('which is not the flat sum, or the weighting is doing nothing',
    Math.abs(flat - want) > 0.05, `flat ${flat.toFixed(2)} vs weighted ${want.toFixed(2)}`);
  ok('and the rows say so',
    ch.weeksB && ch.weeksB.perRow && /he plays/.test(ch.weeksB.perRow.label) &&
      /chance of playing/.test(ch.weeksB.totalRow.label),
    JSON.stringify(ch.weeksB && [ch.weeksB.perRow, ch.weeksB.totalRow].map((r) => r && r.label)));
}

// ---- THE TWO SEASON BOXES UNDER THE BUILDER (2026-09-30) -------------------
const cs = run('customSeason');
ok('the custom-season scenario boots', !cs.boot, cs.boot);
if (!cs.boot) {
  ok('no console errors with the season boxes', cs.errors.length === 0, cs.errors.slice(0, 2).join(' | '));
  ok('SEASON BOXES: nothing is shown before a deal is ticked',
    cs.before.present && cs.before.hidden === true && cs.before.html === '', JSON.stringify(cs.before).slice(0, 200));
  ok('SEASON BOXES: a deal is ticked and shows them', cs.shown.present && cs.shown.hidden === false,
    JSON.stringify(cs.shown));
  ok('SEASON BOXES: a partner you still play was found (so the opponent row is not vacuous)',
    cs.vs.length > 0, `tried ${cs.tried}`);
  const A = cs.A;
  const B = cs.B;
  {
    const D = cs.diffView || {};
    ok('SEASON DIFF: the after box has Total and Difference buttons, Total pressed first',
      JSON.stringify((D.buttonsAtFirst || []).map((b) => [b.text, b.on])) === '[["Total",true],["Difference",false]]',
      JSON.stringify(D.buttonsAtFirst));
    ok('SEASON DIFF: Difference presses its own button and marks the table',
      JSON.stringify((D.buttonsDiff || []).map((b) => b.on)) === '[false,true]' && D.diffAttr === true,
      JSON.stringify(D.buttonsDiff));
    // Every cell, band and Avg included: after − before, to the tenth, as printed.
    const r1 = (n) => Math.round(n * 10) / 10;
    const check = (now, total, diff) => {
      const bad = [];
      let n = 0;
      if (!now || !total || !diff || now.length !== diff.length) return { n, bad: ['shape'] };
      diff.forEach((row, i) => row.forEach((c, j) => {
        const b = now[i][j];
        const a = total ? total[i][j] : null;
        if (!b || b.v === null || !a || a.v === null) return;
        n += 1;
        const want = r1(r1(a.v) - r1(b.v));
        const shown = c.text.replace(/[▲▼]/g, '').trim();
        const wantText = (want > 0 ? '+' : want < 0 ? '−' : '') + Math.abs(want).toFixed(1);
        if (c.v === null || Math.abs(c.v - want) > 0.001 || shown !== wantText) bad.push({ i, j, a: a.v, b: b.v, got: c.text });
      }));
      return { n, bad };
    };
    const mine = check(D.nowGrid, D.totalGrid, D.diffGrid);
    ok('SEASON DIFF: every cell is after minus before, the band and Avg included (yours)',
      mine.n > 50 && mine.bad.length === 0, `${mine.n} cells; ${JSON.stringify(mine.bad.slice(0, 3))}`);
    ok('SEASON DIFF: the band row is in it',
      D.diffGrid && D.diffGrid.length === (D.nowGrid || []).length, JSON.stringify((D.diffGrid || []).length));
    ok('SEASON DIFF: the now box is untouched by the switch',
      JSON.stringify(D.nowGrid) === JSON.stringify(D.nowAfterDiff), 'now box changed');
    ok('SEASON DIFF: played weeks stay grey, live ones are green up / red down',
      (D.diffGrid || []).every((row) => row.every((c) =>
        /\bplayed\b/.test(c.cls) ? !/\bd-(up|down)\b|\bheat\b/.test(c.cls)
          : c.v === null || (c.v > 0.05 ? /\bd-up\b/.test(c.cls) : c.v < -0.05 ? /\bd-down\b/.test(c.cls) : !/\bd-(up|down)\b/.test(c.cls)))) &&
        (D.diffGrid || []).some((row) => row.some((c) => /\bd-(up|down)\b/.test(c.cls))),
      JSON.stringify((D.diffGrid || [])[0]).slice(0, 300));
    ok('SEASON DIFF: Total brings the totals back',
      JSON.stringify(D.totalAgain) === JSON.stringify(D.totalGrid), 'total grid differs after switching back');
    ok('SEASON DIFF: on his side too, the view is kept and is his after minus his now',
      D.hisDiff && D.hisNow && JSON.stringify(D.hisNow) !== JSON.stringify(D.nowGrid) &&
        D.hisDiff.every((row) => row.every((c) => c.v === null || /^[+−]?\d+\.\d$/.test(c.text.replace(/[▲▼]/g, '').trim()))),
      JSON.stringify((D.hisDiff || [])[0]).slice(0, 200));
  }
  ok('SEASON BOXES: two buttons, one per squad, yours pressed first',
    A.buttons.length === 2 && A.buttons[0].on && !A.buttons[1].on && A.buttons[1].text === cs.nameB,
    JSON.stringify(A.buttons));
  ok('SEASON BOXES: the partner button switches both boxes to him',
    B.buttons[1] && B.buttons[1].on && B.titles.length === 2 && B.titles.every((t) => t.endsWith(`· ${cs.nameB}`)) &&
      !A.titles.some((t) => t.endsWith(`· ${cs.nameB}`)),
    JSON.stringify([A.titles, B.titles]));
  ok('SEASON BOXES: and yours switches them back',
    JSON.stringify(cs.back.titles) === JSON.stringify(A.titles), JSON.stringify(cs.back.titles));
  ok('SEASON BOXES: titles are "Season by week" and "After the trade"',
    /^Season by week · /.test(A.titles[0] || '') && /^After the trade · /.test(A.titles[1] || ''),
    JSON.stringify(A.titles));
  ok('SEASON BOXES: both boxes have a row per starting slot and a card on the men',
    A.now && A.after && A.now.slots >= 9 && A.now.slots === A.after.slots && A.now.cards > 0,
    JSON.stringify(A.now && [A.now.slots, A.after.slots, A.now.cards]));
  const drawn = !!(A.now && A.after && B.now && B.after);
  ok('SEASON BOXES: both boxes are drawn for both squads', drawn, '');
}
if (!cs.boot && cs.A.now && cs.A.after && cs.B.now && cs.B.after) {
  const A = cs.A;
  const B = cs.B;

  // The band is the week table's own figure, week for week, both squads.
  const bandMatches = (bx, rows, key) => {
    const at = new Map(rows.map((r) => [r.week, r[key]]));
    const bad = bx.band.filter((c) => !at.has(c.week) || Math.abs(c.v - at.get(c.week)) > 0.1);
    return { good: bx.band.length > 0 && bx.band.length === rows.length && bad.length === 0, bad };
  };
  for (const [label, v, rows] of [['yours', A, cs.weeksA], ['his', B, cs.weeksB]]) {
    const n = bandMatches(v.now, rows, 'before');
    ok(`SEASON BOXES: ${label} "Season by week" band = the week table's "As … now", every week`,
      n.good, JSON.stringify({ bad: n.bad.slice(0, 3), boxWeeks: v.now.band.length, tableWeeks: rows.length }));
    const w = bandMatches(v.after, rows, 'after');
    ok(`SEASON BOXES: ${label} "After the trade" band = the week table's "With the trade", every week`,
      w.good, JSON.stringify({ bad: w.bad.slice(0, 3) }));
    ok(`SEASON BOXES: ${label} boxes differ somewhere (the after box is not a copy)`,
      v.now.band.some((c, i) => v.after.band[i] && Math.abs(c.v - v.after.band[i].v) > 0.05), '');
  }

  // The opponent row: only in the after box, only in meeting weeks, his change.
  const hisAt = new Map(cs.weeksB.map((r) => [r.week, r.delta]));
  const mineAt = new Map(cs.weeksA.map((r) => [r.week, r.delta]));
  const filled = (bx) => bx.opp.filter((c) => c.text !== '');
  ok('SEASON BOXES: the "Season by week" box has no opponent row', A.now.opp.length === 0, '');
  ok('SEASON BOXES: the after box has one, labelled "Opp. change"', A.after.oppLabel === 'Opp. change', A.after.oppLabel);
  ok('SEASON BOXES: filled in exactly the remaining weeks you play him',
    JSON.stringify(filled(A.after).map((c) => c.week)) === JSON.stringify(cs.vs),
    JSON.stringify([filled(A.after).map((c) => c.week), cs.vs]));
  ok('SEASON BOXES: your view shows HIS change that week (his week table’s Difference)',
    filled(A.after).length > 0 && filled(A.after).every((c) => Math.abs(num(c.text) - hisAt.get(c.week)) < 0.051),
    JSON.stringify(filled(A.after).map((c) => [c.week, c.text, hisAt.get(c.week)])));
  ok('SEASON BOXES: his view shows YOUR change that week',
    filled(B.after).length === filled(A.after).length &&
      filled(B.after).every((c) => Math.abs(num(c.text) - mineAt.get(c.week)) < 0.051),
    JSON.stringify(filled(B.after).map((c) => [c.week, c.text, mineAt.get(c.week)])));
  ok('SEASON BOXES: his gain is red in your view, and the other way round',
    filled(A.after).every((c) => (c.v > 0.05 ? /\bneg\b/.test(c.cls) : c.v < -0.05 ? /\bpos\b/.test(c.cls) : true)),
    JSON.stringify(filled(A.after).map((c) => [c.v, c.cls])));
  ok('SEASON BOXES: the meeting weeks carry the ↑ in the column head',
    JSON.stringify(A.after.heads.filter((h) => h.vs).map((h) => h.week)) === JSON.stringify(cs.vs), '');

  // Played weeks: grey, no heat, in both boxes and both squads.
  const pastWeeks = cs.weeksA.filter((r) => r.past).map((r) => r.week);
  for (const [label, bx] of [['now', A.now], ['after', A.after], ['his now', B.now], ['his after', B.after]]) {
    ok(`SEASON BOXES (${label}): the played columns are the week table's played weeks`,
      pastWeeks.length > 0 &&
        JSON.stringify(bx.heads.filter((h) => h.played).map((h) => h.week)) === JSON.stringify(pastWeeks),
      JSON.stringify([bx.heads.filter((h) => h.played).map((h) => h.week), pastWeeks]));
    ok(`SEASON BOXES (${label}): no played cell carries the red/green scale`,
      bx.playedHeat.length === 0, bx.playedHeat.slice(0, 3).join(' | '));
    ok(`SEASON BOXES (${label}): the weeks still to play do (so the check above is not vacuous)`,
      bx.liveHeat > 0, '');
  }
}

// ---- THE ASSUMED TRADE (Tim, 2026-09-30) ------------------------------------
// "make a 'assume trade' feature on a saved trade that basically recalculates
// all other trades assuming the trade that you've made has happened … allow
// the user to remove the assumed trade which just makes the trade go back to
// the saved trades list like normal."
// SUGGESTED, under the custom builder (Tim, 2026-10-01: "show all the potential
// additions as suggested trades … directly underneath the player selection
// menu, and above the saved trades list … Always show at least 3").
{
  const sg = run('customSuggest');
  ok('SUGGESTED: the scenario boots', !sg.boot, sg.boot);
  if (!sg.boot) {
    const has = (list, id) => list.includes(String(id));
    const rowsOk = (L, need) => L.rows.length >= 3 && L.rows.length <= 5 && L.rows.every(need);
    const sum = (L) => L.rows.map((r) => `${r.send.join('+')} for ${r.receive.join('+')}`).join(' | ');
    ok('SUGGESTED: no console errors', sg.errors.length === 0, sg.errors.slice(0, 2).join(' | '));
    ok('SUGGESTED: the list sits under the player pickers and above the saved trades',
      sg.order.build >= 0 && sg.order.build < sg.order.sug && sg.order.sug < sg.order.saved, JSON.stringify(sg.order));
    ok('SUGGESTED: hidden while nothing is ticked', sg.before.present && sg.before.hidden, JSON.stringify(sg.before));
    ok('SUGGESTED: a tick shows the wait line, never an old list', !sg.rightAfter.hidden && sg.rightAfter.wait
      && sg.rightAfter.rows.length === 0, JSON.stringify(sg.rightAfter));
    ok('SUGGESTED: his man ticked - 3 to 5 rows, every one GETS him',
      rowsOk(sg.one, (r) => has(r.receive, sg.hisId) && r.send.length >= 1), sum(sg.one));
    ok('SUGGESTED: every row ADDS a man to the ticked deal',
      sg.one.rows.every((r) => r.send.length + r.receive.length > 1), sum(sg.one));
    ok('SUGGESTED: rows carry the saved table\'s columns', JSON.stringify(sg.one.heads) === JSON.stringify(
      ['With', 'Δ last chance', 'Δ title chance', 'You send', 'You get', 'Your lineup, a week', 'You gain', 'He gains',
        'His proj vs you', 'ESPN']) || (sg.one.heads.length === 10 && sg.one.heads[3] === 'You send'), sg.one.heads.join(' | '));
    ok('SUGGESTED: every row is with the custom partner', sg.one.rows.every((r) => r.partner === sg.partnerName),
      sg.one.rows.map((r) => r.partner).join(','));
    ok('SUGGESTED: every row has Open in custom trades, Ask AI and the week-by-week button',
      sg.one.buttons.length === sg.one.rows.length && sg.one.buttons.every((b) => b.load && b.ask && b.open),
      JSON.stringify(sg.one.buttons));
    ok('SUGGESTED: rows are goal-scored', sg.one.rows.every((r) => r.goal && /%/.test(r.goal)),
      sg.one.rows.map((r) => r.goal).join(','));
    ok('SUGGESTED: the list says how long it took', Number.isFinite(sg.one.ms) && sg.one.ms > 0, String(sg.one.ms));
    ok('SUGGESTED: one of mine ticked too - every row has BOTH',
      rowsOk(sg.two, (r) => has(r.receive, sg.hisId) && has(r.send, sg.mineId)), sum(sg.two));
    ok('SUGGESTED: a row click opens the week-by-week pop-up', !!sg.pop && sg.pop.open, JSON.stringify(sg.pop));
    ok('SUGGESTED: a fast second tick never shows the first tick\'s rows',
      sg.between.rows.length === 0 && rowsOk(sg.dbl, (r) => has(r.receive, sg.hisId) && has(r.receive, sg.his2Id)),
      `${sg.between.rows.length} stale; ${sum(sg.dbl)}`);
    ok('SUGGESTED: Open in custom trades ticks the row\'s men, and the builder agrees with the row', !!sg.load
      && JSON.stringify(sg.load.a) === JSON.stringify([...sg.load.row.send].sort())
      && JSON.stringify(sg.load.b) === JSON.stringify([...sg.load.row.receive].sort())
      && sg.load.gainA.startsWith(sg.load.row.gainText.split('/wk')[0] + '/wk'), JSON.stringify(sg.load));
    ok('SUGGESTED: Clear hides the list', sg.cleared.hidden, JSON.stringify(sg.cleared));
    const A = sg.asm;
    ok('SUGGESTED: assumed - the builder holds the assumed rosters', A.block && has(A.listA, A.got)
      && !has(A.listA, A.sent) && has(A.listB, A.sent), JSON.stringify({ got: A.got, sent: A.sent }));
    ok('SUGGESTED: assumed - every row is on the assumed rosters',
      !!A.hisAId && rowsOk(A.rows, (r) => has(r.receive, A.hisAId) && r.send.every((id) => has(A.listA, id))
        && r.receive.every((id) => has(A.listB, id))), sum(A.rows));
    ok('SUGGESTED: assumed - the man you got in it can be sent on',
      rowsOk(A.gotRows, (r) => has(r.send, A.got) && r.send.every((id) => has(A.listA, id))
        && r.receive.every((id) => has(A.listB, id))), sum(A.gotRows));
    console.log(`  (SUGGESTED, linkedom: ${sg.one.ms} ms his man, ${sg.two.ms} ms one each)`);
  }
}

{
  const at = run('assumeTrade');
  ok('ASSUME: the scenario boots', !at.boot, at.boot);
  if (!at.boot) {
    const S = at.saved;
    const A = at.assumed;
    const R = at.removed;
    const r1 = (n) => Math.round(n * 10) / 10;
    const same = (x, y, live = false) => !!x && !!y && x.length > 0 && x.length === y.length &&
      x.every((c, i) => c.week === y[i].week && (live && c.played ? true : r1(c.v) === r1(y[i].v)));
    ok('ASSUME: no console errors', at.errors.length === 0, at.errors.slice(0, 2).join(' | '));
    ok('ASSUME: a saved row carries an Assume button', S.saved === 1 && S.assumeButtons === 1,
      `${S.saved} rows, ${S.assumeButtons} buttons`);
    ok('ASSUME: nothing is assumed before the button is pressed', S.present && S.hidden === true, JSON.stringify(S.hidden));
    // It leaves the saved list and appears at the top with its row.
    eq(A.saved, 0, 'ASSUME: the assumed trade leaves the saved list');
    ok('ASSUME: and is shown at the top, with its summary row', A.hidden === false && A.rows.length === 1 &&
      A.rows[0].partner === (at.savedRow && at.savedRow.partner), JSON.stringify([A.hidden, A.rows.length]));
    ok('ASSUME: the top row says what the saved row said (both gains, the goal)', !!at.savedRow && A.rows.length === 1 &&
      A.rows[0].myGain === at.savedRow.myGain && A.rows[0].theirGain === at.savedRow.theirGain &&
      A.rows[0].goal && at.savedRow.goal && A.rows[0].goal.head === at.savedRow.goal.head,
      JSON.stringify([A.rows[0] && [A.rows[0].myGain, A.rows[0].goal && A.rows[0].goal.head],
        at.savedRow && [at.savedRow.myGain, at.savedRow.goal && at.savedRow.goal.head]]));
    ok('ASSUME: the top table has the saved table\'s columns', A.heads.length > 0 &&
      JSON.stringify(A.heads) === JSON.stringify(A.cuHeads), JSON.stringify([A.heads, A.cuHeads]));
    ok('ASSUME: the line says who sends whom', /^Assuming .+ sends .+ to .+ for .+\./.test(A.line), A.line);
    ok('ASSUME ASK AI: a finder row\'s copied text says the trade is assumed',
      A.ask && /\nAssuming this trade already happened: .+ sends .+ to .+ for .+\./.test(A.ask.finder || ''),
      String(A.ask && A.ask.finder).slice(0, 300));
    ok('ASSUME ASK AI: the assumed trade\'s own row does not (it is priced on the real rosters)',
      A.ask && !!A.ask.block && !/Assuming this trade/.test(A.ask.block), String(A.ask && A.ask.block).slice(0, 200));
    ok('ASSUME: the finder says it starts from the assumed trade', A.note && A.note.hidden === false &&
      /Assuming/.test(A.note.text), JSON.stringify(A.note));
    // Its "After the trade" chart is the one the custom box showed for it, to the tenth.
    ok('ASSUME: the top after-chart equals the custom box\'s after-chart (yours), every week',
      same(A.after, at.pre.mine), JSON.stringify([A.after && A.after.map((c) => c.v), at.pre.mine && at.pre.mine.map((c) => c.v)]));
    ok('ASSUME: and his, every week', same(A.hisAfter, at.pre.his),
      JSON.stringify([A.hisAfter && A.hisAfter.map((c) => c.v), at.pre.his && at.pre.his.map((c) => c.v)]));
    // The rosters every panel reads: yours and his, with the trade made.
    ok('ASSUME: your roster now has the man you received, not the man you sent',
      A.listA.includes(at.got) && !A.listA.includes(at.sent), JSON.stringify([at.got, at.sent, A.listA]));
    ok('ASSUME: his roster has the man you sent him, not the man he sent you',
      A.listB.includes(at.sent) && !A.listB.includes(at.got) && A.teamB === at.partner,
      JSON.stringify([at.sent, at.got, A.listB]));
    ok('ASSUME: and before assuming they were the other way round (so the two checks above are not vacuous)',
      S.listA.includes(at.sent) && !S.listA.includes(at.got) && S.listB.includes(at.got),
      JSON.stringify([S.listA, S.listB]));
    // The finder searches the assumed rosters.
    ok('ASSUME: no finder offer sends the man you traded away',
      A.finder.length > 0 && A.finder.every((f) => !f.send.includes(at.sent)),
      `${A.finder.filter((f) => f.send.includes(at.sent)).length} of ${A.finder.length}`);
    ok('ASSUME: every finder offer sends only men on your assumed roster',
      A.finder.every((f) => f.send.every((id) => A.listA.includes(id))),
      JSON.stringify(A.finder.filter((f) => !f.send.every((id) => A.listA.includes(id))).slice(0, 2)));
    ok('ASSUME: no finder offer asks his squad for the man he gave you',
      A.finder.every((f) => !f.receive.includes(at.got)), '');
    ok('ASSUME: and offers with him ask only for men on his assumed roster',
      A.finder.filter((f) => f.partner === (at.savedRow && at.savedRow.partner))
        .every((f) => f.receive.every((id) => A.listB.includes(id))), '');
    ok('ASSUME: before assuming, the finder did offer the man you then sent (so the check above is not vacuous)',
      S.finder.some((f) => f.send.includes(at.sent)), `${S.finder.filter((f) => f.send.includes(at.sent)).length}`);
    // A fresh custom trade starts from the assumed squad: its "now" box is the after chart.
    ok('ASSUME: a fresh custom trade\'s season-as-it-stands equals the assumed after-chart (unplayed weeks)',
      same(at.fresh.now, at.pre.mine, true),
      JSON.stringify([at.fresh.now && at.fresh.now.map((c) => c.v), at.pre.mine && at.pre.mine.map((c) => c.v)]));
    // And the chances start from it too: the fresh deal's "before" is the assumed trade's "after".
    {
      const sub = (A.rows[0] && A.rows[0].goal && A.rows[0].goal.sub) || '';
      const afterPct = (sub.match(/→\s*([\d.]+)%/) || [])[1];
      const freshBefore = (at.fresh.preview.match(/\(([\d.]+)%\s*→/) || [])[1];
      ok('ASSUME: a fresh deal\'s chance "now" is the assumed trade\'s chance "after"',
        !!afterPct && afterPct === freshBefore, JSON.stringify([sub, at.fresh.preview.slice(-80)]));
    }
    ok('ASSUME: it is stored, and the saved list without it',
      at.prefs && at.prefs.assumed && at.prefs.assumed.entry && at.prefs.assumed.entry.b === Number(at.partner) &&
        Array.isArray(at.prefs.custom) && at.prefs.custom.length === 0, JSON.stringify(at.prefs));
    // REMOVE: back in the saved list, rosters real again.
    ok('ASSUME REMOVE: the block goes and the trade is back in the saved list',
      R.hidden === true && R.saved === 1 && R.assumeButtons === 1 && R.note && R.note.hidden === true,
      JSON.stringify([R.hidden, R.saved, R.note]));
    ok('ASSUME REMOVE: the rosters are real again',
      R.listA.includes(at.sent) && !R.listA.includes(at.got) && R.listB.includes(at.got) && !R.listB.includes(at.sent),
      JSON.stringify([R.listA, R.listB]));
    ok('ASSUME REMOVE: and the finder offers the man you had sent again',
      R.finder.some((f) => f.send.includes(at.sent)), '');
    ok('ASSUME REMOVE: nothing is stored as assumed any more',
      at.prefsAfter && at.prefsAfter.assumed === null && at.prefsAfter.custom.length === 1, JSON.stringify(at.prefsAfter));

    // A RELOAD keeps it assumed.
    if (at.prefs && at.prefs.assumed) {
      const seed = JSON.stringify({ 'trade.goal': 'last', 'trade.assumed': at.prefs.assumed, 'trade.custom': [] });
      const rl = run('assumeReload', { env: { TR_ASSUMED: seed, TR_PARTNER: at.partner } });
      ok('ASSUME RELOAD: the scenario boots', !rl.boot, rl.boot);
      if (!rl.boot) {
        const P = rl.page;
        ok('ASSUME RELOAD: no console errors', rl.errors.length === 0, rl.errors.slice(0, 2).join(' | '));
        ok('ASSUME RELOAD: still assumed after a reload, at the top, out of the saved list',
          P.hidden === false && P.rows.length === 1 && P.saved === 0, JSON.stringify([P.hidden, P.rows.length, P.saved]));
        ok('ASSUME RELOAD: with the same after-chart', same(P.after, at.pre.mine),
          JSON.stringify(P.after && P.after.map((c) => c.v)));
        ok('ASSUME RELOAD: and the rosters assumed', P.listA.includes(at.got) && !P.listA.includes(at.sent) &&
          P.listB.includes(at.sent), JSON.stringify([P.listA, P.listB]));
      }
      // A stored trade whose man has left the squad is put back, with one line why.
      const gone = { ...at.prefs.assumed, entry: { ...at.prefs.assumed.entry, sendB: ['987654321'] } };
      const dseed = JSON.stringify({ 'trade.goal': 'last', 'trade.assumed': gone, 'trade.custom': [] });
      const dr = run('assumeReload', { env: { TR_ASSUMED: dseed, TR_PARTNER: at.partner } });
      ok('ASSUME DROPPED: the scenario boots', !dr.boot, dr.boot);
      if (!dr.boot) {
        const P = dr.page;
        ok('ASSUME DROPPED: a stored trade that no longer holds is not assumed',
          P.hidden === true && P.listA.includes(at.sent) && !P.listA.includes(at.got), JSON.stringify([P.hidden, P.listA]));
        ok('ASSUME DROPPED: it goes back to the saved list', P.saved === 1 && dr.prefs && dr.prefs.assumed === null &&
          dr.prefs.custom.length === 1, JSON.stringify([P.saved, dr.prefs]));
        ok('ASSUME DROPPED: and one line says why', P.dropped && P.dropped.hidden === false &&
          /^Stopped assuming your trade with .+\. .+/.test(P.dropped.text), JSON.stringify(P.dropped));
      }
    }
  }
}

// ---- STAGED RANKING (trade plan Phase 2, 2026-09-24) -----------------------
//
// Before: the table sat in points order until the last offer was played out.
// After: the first ten are ranked and repainted at the top while the rest are
// still being scored, and those rest are marked rather than presented as ranked.
const gs = run('goalStaged', { env: { TR_GOAL: 'title' } });
ok('the staged-ranking scenario boots', !gs.boot, gs.boot);
if (!gs.boot) {
  ok('no console errors while ranking in stages', gs.errors.length === 0, gs.errors.slice(0, 2).join(' | '));
  ok('the page was caught while it was still playing offers out', gs.sawRunning);
  const S = gs.staged;
  ok('goal-ranked rows reach the table BEFORE the whole list is scored', !!S,
    'the table showed no rank number until the ranking had finished');
  if (S) {
    const m = S.count.match(/\((\d+) of (\d+)\)/);
    ok('and it was genuinely part-way: fewer offers played out than there are',
      m && Number(m[1]) < Number(m[2]), S.count);
    const ranked = S.trades.filter((t) => t.goal && t.goal.place);
    const firstUnranked = S.rows.findIndex((r) => r.unranked);
    ok('the ranked rows are the top of the table, in one block',
      ranked.length >= 10 && S.trades.slice(0, ranked.length).every((t) => t.goal && t.goal.place),
      S.trades.map((t) => (t.goal && t.goal.place) || '·').join(' '));
    ok('in the order of their expected change, best first',
      ranked.every((t, i, a) => i === 0 || a[i - 1].goal.v >= t.goal.v - 0.0001),
      ranked.map((t) => t.goal.v.toFixed(4)).join(','));
    ok('every row under them is marked unranked', firstUnranked === ranked.length &&
      S.rows.slice(ranked.length).every((r) => r.unranked),
      `first unranked ${firstUnranked}, ranked ${ranked.length}, rows ${S.rows.length}`);
    ok('and an unranked row prints no rank and no chance, even once it has been scored',
      S.trades.slice(ranked.length).every((t) => t.goal && !t.goal.place && !/%/.test(t.goal.head)),
      S.trades.slice(ranked.length, ranked.length + 3).map((t) => t.goal && t.goal.head).join(' | '));
    ok('the status line says which part is ranked and which is still in points order',
      new RegExp(`top ${ranked.length} ranked by your title chance`).test(S.count) &&
        /faded rows in points order/.test(S.count), S.count);
  }
  const F = gs.final;
  ok('once finished, nothing is left marked unranked', F.rows.length > 0 && F.rows.every((r) => !r.unranked),
    `${F.rows.filter((r) => r.unranked).length} of ${F.rows.length}`);
  ok('and every row has its rank', F.trades.every((t) => t.goal && t.goal.place),
    F.trades.map((t) => (t.goal && t.goal.place) || '·').join(' '));
  ok('with the line back to plain "ranked by your title chance"',
    /ranked by your title chance/.test(F.count) && !/points order/.test(F.count), F.count);
}

// ---- ONE WEEKLY SEARCH PER LOAD (trade plan Phase 3, 2026-09-24) -----------
//
// On the stubbed real league with every week read taking 150 ms, as a network
// does. The old page searched on points as soon as the span was in and again
// once the played weeks landed: measured 2 on both goals before the fix, 1 after.
for (const goal of ['title', 'last']) {
  const so = run('searchOnce', { stub: true, env: { TR_GOAL: goal, TR_ONCE_SEED: 'live', TR_WEEK_DELAY: '150' } });
  ok(`search-once (${goal}) boots`, !so.boot, so.boot);
  if (so.boot) continue;
  ok(`search-once (${goal}): no console errors`, so.errors.length === 0, so.errors.slice(0, 2).join(' | '));
  eq(so.searches, 1, `a live load under "${goal}" runs ONE weekly search, not a points search and then another`);
  ok(`search-once (${goal}): and it still ends ranked by the goal, with offers`,
    so.trades > 0 && /ranked by your/.test(so.count) && !/not ranked/.test(so.count), so.count.slice(0, 200));
}

// 11.5 days out: "12 days left", and not yet red.
const DEADLINE = Date.now() + 11.5 * 86400000;
const gl = run('goalLive', { stub: true, env: { TR_GOAL: 'title', TR_DEADLINE: String(DEADLINE) } });
ok('the live title-goal scenario boots', !gl.boot, gl.boot);
if (!gl.boot) {
  // -- THE TRADE DEADLINE (AUDIT §6.7) ----------------------------------------
  ok('the league’s trade deadline is on the page, with the days left',
    !gl.deadline.hidden && /must be accepted by/.test(gl.deadline.text) && /12 days left/.test(gl.deadline.text),
    JSON.stringify(gl.deadline));
  ok('and the review window ESPN sent', /24 hours for league review/.test(gl.deadline.text), gl.deadline.text);
  ok('not yet in red, with more than a week to go', !gl.deadline.warn);
  // -- THE COMBO AND 2-FOR-2 --------------------------------------------------
  ok('the combo headline says what the whole slate does to the title chance',
    /Your title chance [+−]?\d+\.\d%/.test(gl.combo) || /Nothing to combine|Making none/.test(gl.combo),
    gl.combo.slice(0, 240));
  ok('the shape filter offers 2 for 2', gl.kinds.includes('2 for 2'), gl.kinds.join(' | '));
  ok('no console errors on the live title path', gl.errors.length === 0, gl.errors.slice(0, 2).join(' | '));
  eq(gl.heads[1], 'Δ title chance', 'the live page carries the title-chance column');
  ok('and every live offer was played out and ranked',
    gl.trades.length > 0 && gl.trades.every((t) => t.goal && /%/.test(t.goal.head)) &&
      /ranked by your title chance/.test(gl.count),
    `${gl.count.slice(0, 200)} · ${JSON.stringify(gl.trades.slice(0, 2).map((t) => t.goal))}`);
  ok('in order of the expected change',
    gl.trades.every((t, i, a) => i === 0 || a[i - 1].goal.v >= t.goal.v - 0.0001),
    gl.trades.map((t) => t.goal.v).join(','));
  ok('and the live bracket weeks (15–16) are in the priced span',
    gl.heads.some((h) => /You gain a week \(weeks \d+–16\)/.test(h)), gl.heads.join(' | '));
}

// ---- BOTH GOALS, THE SWITCH ON EVERY PANEL, HIS PROJECTION VS YOU ----------
//
// Tim, 2026-09-29: "show 2 columns on the trade, one for change of win % and
// one for change of losing %, as a preview for the setting that the user isn't
// currently on. Also above every box in the trade section have the to win or to
// not lose choice and it changes for all of the other identical buttons aswell
// … make a opp proj diff that calculates how much my opponent's projection
// changes after the trade, only for the week that I play them."
//
// Demo, opening on "Win it all", then switched from the COMBO panel's copy.
// Every figure below is re-derived in this process from the engine alone.
{
  const tw = run('twoGoals', { env: { TR_GOAL: 'title' } });
  ok('the two-goals scenario boots', !tw.boot, tw.boot);
  // A page without these columns must FAIL here, not throw half-way and hide
  // every assertion after the one that tripped.
  if (!tw.boot) try {
    const A = tw.first;
    const B = tw.second;
    ok('no console errors with both goal columns', tw.errors.length === 0, tw.errors.slice(0, 2).join(' | '));
    ok('and demo still costs no request', tw.fetchCalls.length === 0, tw.fetchCalls.join(' | '));
    const chanceRe = /^[+−]?\d+\.\d% ±0\.4$/;
    const subRe = /^(\d+\.\d)% → (\d+\.\d)%$/;
    // A missing cell reads as blank, so an absent column fails its checks rather than throwing.
    const NA = { head: '', sub: '', cls: '', v: NaN, sign: '?' };

    // -- (1) TWO CHANCE COLUMNS: the ranked one, then the other as a preview --
    eq(A.heads[1], 'Δ title chance', 'under "Win it all" the ranked column, second, is the title chance');
    eq(A.heads[2], 'Δ last chance', 'and beside it, a preview column for the chance of finishing last');
    ok('every row carries the preview cell, third, filled in (not still waiting)',
      A.trades.length > 2 && A.trades.every((t) => t.alt && t.alt.index === 2 && !t.alt.wait),
      JSON.stringify(A.trades.slice(0, 2).map((t) => t.alt)));
    ok('each preview states the change with its ± band, and before → after under it',
      A.trades.every((t) => t.alt && chanceRe.test(t.alt.head) && subRe.test(t.alt.sub)),
      A.trades.slice(0, 3).map((t) => `${t.alt && t.alt.head} / ${t.alt && t.alt.sub}`).join(' | '));
    ok('a last-place chance that DROPS is green and one that rises is red — sign and hue agree',
      A.trades.every((t) => {
        const m = (t.alt || NA).sub.match(subRe);
        if (!m) return false;
        const d = Number(m[2]) - Number(m[1]);
        return (/\bpos\b/.test((t.alt || NA).cls) ? /^−/.test((t.alt || NA).head) && d <= 0 : true) &&
          (/\bneg\b/.test((t.alt || NA).cls) ? /^\+/.test((t.alt || NA).head) && d >= 0 : true);
      }),
      A.trades.map((t) => `${(t.alt || NA).cls.replace('alt-goal-cell', '').trim()}:${(t.alt || NA).head}`).slice(0, 8).join(' '));
    ok('and the sample league offers both colours there, or the check above is vacuous',
      A.trades.some((t) => /\bpos\b/.test((t.alt || NA).cls)) || A.trades.some((t) => /\bneg\b/.test((t.alt || NA).cls)),
      A.trades.map((t) => (t.alt || NA).cls).slice(0, 8).join(' '));
    ok('the ranking is unchanged: still in the order of the TITLE figure, best first',
      A.trades.every((t, i, a) => i === 0 || a[i - 1].goal.v >= t.goal.v - 0.0001),
      A.trades.map((t) => t.goal.v.toFixed(4)).join(','));
    ok('the method names what the preview column is and what it is priced over',
      /Δ last chance/.test(A.note) && /regular season/.test(A.note.slice(A.note.indexOf('Δ last chance'))),
      A.note.slice(A.note.indexOf('Δ last chance'), A.note.indexOf('Δ last chance') + 300));

    // THE PREVIEW IS AN INDEPENDENT RUN OF THE OTHER GOAL, on its own weeks.
    // FALSIFIABLE: read pTitle off a "last" run, or price the "last" preview
    // over the title span, and these move.
    for (const row of A.trades.slice(0, 3)) {
      const re = await rederiveGoal(A, row, 'last');
      const m = (row.alt || NA).sub.match(subRe);
      ok(`the last-chance preview of ${row.partner}'s deal re-derives from the engine alone`,
        !!re && !!m && Math.abs(Number(m[1]) - re.before * 100) <= 0.051 &&
          Math.abs(Number(m[2]) - re.after * 100) <= 0.151,
        `page ${row.alt.sub} vs engine ${re && `${(re.before * 100).toFixed(2)} → ${(re.after * 100).toFixed(2)}`}`);
    }

    // -- (3) HIS PROJECTION IN THE WEEK HE PLAYS YOU ---------------------------
    ok('the finder has a "His proj vs you" column', A.heads.includes('His proj vs you'), A.heads.join(' | '));
    const his = await rederiveHis(A, A.trades, 'title');
    ok('every row re-derives (partner found)', his.every((h) => !h.error), JSON.stringify(his.find((h) => h.error)));
    ok('each row prints the sum of HIS lineup change over the regular-season weeks you still play him',
      A.trades.every((t, i) => t.opp && (his[i].sum === null
        ? (t.opp || NA).v === null && (t.opp || NA).head === '—'
        : (t.opp || NA).v !== null && Math.abs((t.opp || NA).v - his[i].sum) <= 0.051)),
      A.trades.map((t, i) => `${t.partner}: page ${t.opp && (t.opp || NA).head} (${t.opp && (t.opp || NA).v}) vs ${his[i].sum} @${his[i].meet}`)
        .slice(0, 6).join(' | '));
    ok('and names the week(s) under it',
      A.trades.every((t, i) => his[i].sum === null ||
        his[i].meet.every((w) => new RegExp(`\\b${w}\\b`).test((t.opp || NA).sub))),
      A.trades.map((t, i) => `${t.opp && (t.opp || NA).sub} vs ${his[i].meet}`).slice(0, 6).join(' | '));
    ok('the sample league has rows that meet you again — or the check is vacuous',
      his.some((h) => h.sum !== null), his.map((h) => h.meet.join('+')).join(' '));
    console.log(`twoGoals: ${his.filter((h) => h.sum === null).length} of ${his.length} rows never meet you again (—)`);
    // NET (2026-09-30, Tim: "add the change in opponent proj to the total +/-
    // gain"): You gain = your own change minus his in the weeks you play him,
    // rebuilt from the engine; a partner you never meet again nets to nothing.
    ok('NET: every row’s You gain is your own change minus his column, from the engine',
      A.trades.every((t, i) => Math.abs(t.myGain - (his[i].mine - (his[i].sum ?? 0))) <= 0.15),
      A.trades.map((t, i) => `${t.partner}: page ${t.myGain} vs ${his[i].mine.toFixed(1)} − ${his[i].sum}`).slice(0, 6).join(' | '));
    ok('NET: and some row really moves by it (the check bites)',
      his.some((h) => h.sum !== null && Math.abs(h.sum) > 0.15), his.map((h) => h.sum).join(' '));
    ok('his gain is YOUR red and his loss your green',
      A.trades.every((t) => (t.opp || NA).v === null ? (t.opp || NA).sign === ''
        : (t.opp || NA).v > 0.05 ? (t.opp || NA).sign === 'neg' : (t.opp || NA).v < -0.05 ? (t.opp || NA).sign === 'pos' : (t.opp || NA).sign === ''),
      A.trades.map((t) => `${(t.opp || NA).v}:${(t.opp || NA).sign}`).slice(0, 8).join(' '));
    ok('the method says what the column is, over which weeks, and that playoff meetings are not known',
      /His proj vs you/.test(A.note) && /playoff/i.test(A.note.slice(A.note.indexOf('His proj vs you'),
        A.note.indexOf('His proj vs you') + 400)),
      A.note.slice(A.note.indexOf('His proj vs you'), A.note.indexOf('His proj vs you') + 400));
    // The pop-up of a row that meets you: the meeting week's row says so, with his change.
    ok('a row that meets you opens its pop-up', !!tw.deal && !!tw.deal.weeks, JSON.stringify(tw.deal).slice(0, 200));
    if (tw.deal && tw.deal.weeks) {
      const row = A.trades[tw.deal.row];
      const h = his[tw.deal.row];
      const marked = tw.deal.weeks.weeks.filter((w) => w.vs);
      ok('the pop-up marks exactly the weeks you play him',
        marked.map((w) => Number(w.label.replace(/\D/g, ''))).join(',') === h.meet.join(','),
        `${marked.map((w) => w.label).join(',')} vs ${h.meet.join(',')}`);
      ok('and each marked week gives his lineup change that week, adding up to the row’s figure',
        marked.length > 0 && Math.abs(marked.reduce((a, w) => a + num((w.vs.match(/[+−]?\d+\.\d/) || ['NaN'])[0]), 0) -
          (row.opp || NA).v) <= 0.051,
        `${marked.map((w) => w.vs).join(' | ')} vs ${(row.opp || NA).v}`);
    }

    // -- (1b) THE COMBO: his proj per manager, and the preview on the headline --
    ok('the combo table carries "His proj vs you" per manager',
      A.comboRows.length === 0 || (A.comboHeads.includes('His proj vs you') && A.comboRows.every((r) => r.opp)),
      A.comboHeads.join(' | '));
    ok('and its headline previews the other goal beside the ranked one',
      A.comboRows.length === 0 || (/Your title chance/.test(A.comboGoal) && /last chance [+−]?\d+\.\d%/.test(A.comboGoal)),
      A.comboGoal);

    // -- (2) THE GOAL SWITCH ABOVE EVERY PANEL, acting as one -------------------
    ok('every panel of the Trade page carries the goal switch, once',
      A.panels.length >= 5 && A.panels.every((p) => p.copies === 1),
      JSON.stringify(A.panels));
    ok('each copy is a labelled group of two real buttons',
      A.toggles.length === A.panels.length && A.toggles.every((g) => g.role === 'group' && g.label &&
        g.buttons.length === 2 && g.buttons.every((b) => b.type === 'button')),
      JSON.stringify(A.toggles.map((g) => [g.panel, g.role, g.label, g.buttons.length])));
    ok('every copy shows "Win it all" selected, and aria-pressed says the same',
      A.toggles.every((g) => g.on === 'Win it all' &&
        g.buttons.every((b) => b.pressed === String(b.on) && b.on === (b.goal === 'title'))),
      JSON.stringify(A.toggles.map((g) => [g.panel, g.on, g.buttons.map((b) => b.pressed)])));
    ok('the combo panel’s copy was there to press', tw.switched);
    ok('pressing it switches EVERY copy', B.toggles.every((g) => g.on === 'Don’t finish last' &&
      g.buttons.every((b) => b.pressed === String(b.on) && b.on === (b.goal === 'last'))),
    JSON.stringify(B.toggles.map((g) => [g.panel, g.on, g.buttons.map((b) => b.pressed)])));
    eq(tw.stored, 'last', 'and the choice is remembered, one preference');
    eq(B.heads[1], 'Δ last chance', 'the ranked column becomes the chance of finishing last');
    eq(B.heads[2], 'Δ title chance', 'and the preview becomes the title chance');
    ok('and the list is re-ranked on it', /ranked by your chance of finishing last/.test(B.count), B.count.slice(0, 200));
    {
      const key = (t) => `${t.partner}|${names(t.send)}|${names(t.receive)}`;
      ok('in exactly the order the top control produces',
        !gt.boot && B.trades.map(key).join(' ; ') === gt.last.trades.map(key).join(' ; '),
        `${B.trades.slice(0, 4).map(key).join(' ; ')} vs ${gt.last && gt.last.trades.slice(0, 4).map(key).join(' ; ')}`);
    }
    // The title preview under "Don't finish last" is priced over the title's
    // own span — the bracket bought and priced — not read off the "last" run.
    for (const row of B.trades.slice(0, 3)) {
      const re = await rederiveGoal(B, row, 'title');
      const m = row.alt && (row.alt || NA).sub.match(subRe);
      ok(`the title-chance preview of ${row.partner}'s deal re-derives on the title's own weeks`,
        !!re && !!m && Math.abs(Number(m[1]) - re.before * 100) <= 0.051 &&
          Math.abs(Number(m[2]) - re.after * 100) <= 0.151,
        `page ${row.alt && row.alt.sub} vs engine ${re && `${(re.before * 100).toFixed(2)} → ${(re.after * 100).toFixed(2)}`}`);
    }
    {
      const hisB = await rederiveHis(B, B.trades, 'last');
      ok('his projection vs you follows the new span and still re-derives',
        B.trades.every((t, i) => t.opp && (hisB[i].sum === null ? (t.opp || NA).v === null
          : Math.abs((t.opp || NA).v - hisB[i].sum) <= 0.051)),
        B.trades.map((t, i) => `${t.opp && (t.opp || NA).v} vs ${hisB[i].sum}`).slice(0, 6).join(' | '));
    }
    console.log(`twoGoals timing (demo): title ranked ${tw.timing.tRanked} ms, preview filled ${tw.timing.tAlt} ms; ` +
      `after switch: ranked ${tw.timing.tRanked2} ms, preview ${tw.timing.tAlt2} ms`);
  } catch (e) {
    ok('the two-goals checks ran to the end without throwing', false, String(e && e.stack).slice(0, 300));
  }

  // THE SAME ON THE STUBBED LIVE LEAGUE, with every week read slowed as a
  // network does — timing, and that a slow load still fills the preview.
  const tl = run('twoGoals', { stub: true, env: { TR_GOAL: 'title', TR_TWO_SEED: 'live', TR_WEEK_DELAY: '150' } });
  ok('the two-goals scenario boots on the slowed live league', !tl.boot, tl.boot);
  if (!tl.boot) try {
    ok('no console errors there', tl.errors.length === 0, tl.errors.slice(0, 2).join(' | '));
    ok('and every row’s preview is filled once the ranking is done',
      tl.first.trades.length > 0 && tl.first.trades.every((t) => t.alt && !t.alt.wait && /%/.test(t.alt.head)),
      JSON.stringify(tl.first.trades.slice(0, 2).map((t) => t.alt)));
    console.log(`twoGoals timing (live stub, 150 ms/week): title ranked ${tl.timing.tRanked} ms, ` +
      `preview filled ${tl.timing.tAlt} ms; after switch: ranked ${tl.timing.tRanked2} ms, preview ${tl.timing.tAlt2} ms`);
  } catch (e) {
    ok('the slowed-live two-goals checks ran without throwing', false, String(e && e.stack).slice(0, 300));
  }
}

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log('FAIL ' + f);
  if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
