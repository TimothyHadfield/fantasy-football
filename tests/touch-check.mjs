// THE HOVER CARD ON A SCREEN WITH NO HOVER.
//
//   node touch-check.mjs
//
// The analysis grids are the only place on the site where every cell is a bare
// number and the player's NAME exists nowhere on the page — it is in the hover
// card and nowhere else. A phone has no hover, so before this the card could
// not be reached at all there and a tap on a cell simply left the page by its
// link. `js/analysis-page.js` now opens the same card as a SHEET on a coarse
// pointer, and this suite is what keeps the two modes honest with each other.
//
// Why it is its own suite rather than a scenario inside an-test.mjs: every
// assertion here turns on ONE global (`window.matchMedia` answering
// `(hover: none)`), an-test.mjs sets that global to "no" for all eight of its
// scenarios, and a suite whose whole subject is a flag should not be smuggled
// in behind a flag somebody else owns. It boots the same real analysis.html
// with the same real module.
//
// What it asserts, and why each one is here rather than assumed:
//
//   touch   the tap opens a sheet instead of following the link, the sheet is
//           about the man whose cell was tapped, its link is the SAME href the
//           cell's own <a> carries (a second way of naming a player is exactly
//           how the click-through's two halves drift apart), and the tap does
//           NOT also drill into the team — the row underneath is clickable too.
//   mouse   the same click with a mouse is left completely alone, so the
//           desktop click-through link-check.mjs follows is unchanged.
//   no-id   a man ESPN gave no playerId for has no <a> in his cell at all, and
//           his card must still open. The card has never depended on the link
//           and must not start to; here it says so instead of offering one.
//   part    a season that is only half played, on a phone-sized window: the
//           Act row, and the run wrapping rather than scrolling. See below.
//
// Each scenario gets its own child process: a module initialises once per
// process and analysis-page.js self-boots on import, so two of these in one
// process would share a DOM and a Map of tips.
//
// ---------------------------------------------------------------------------
// THE CHART IS THREE ROWS NOW, AND IT DOES NOT SCROLL.
//
// Tim asked for both, in these words: "add another row below proj that is act.
// If it's week 5, all columns before week 5 should have a filled in act.
// anything after leave blank", and "For the preview, remove scrolling on the
// box, just show the whole thing, no matter how long it gets."
//
// So there are three claims here that were not here before, and each is the
// kind that looks fine while being wrong:
//
//   1. THE ROWS LINE UP COLUMN FOR COLUMN. This is the entire reason the chart
//      is a table rather than a string — a native `title` renders in the OS UI
//      font and cannot be padded into columns — and a third row makes it
//      easier to get wrong, not harder. Asserted per line of the run and again
//      across the whole run.
//   2. A WEEK WITH NO RESULT IS BLANK, AND A PLAYED ONE IS NOT. The demo season
//      is 100% played, so it cannot show this at all; the `part` scenario
//      doctors it so weeks 6–13 carry no actual. Note that the demo SCHEDULE
//      still says every week was played — which is the point: the rule reads
//      the data, not the calendar, and this fixture is the only thing that can
//      tell the two apart.
//   3. NOTHING INSIDE THE CARD SCROLLS. `.tc-scroll` and its `overflow-x: auto`
//      are gone and the sheet's `max-height` with them; the run wraps onto more
//      lines instead. A scrollbar quietly reintroduced anywhere in the card is
//      the regression this suite is here to catch, so the CSS is read as text
//      and every rule that touches the card is checked for one.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

// ------------------------------------------------- a demo league with no ids
//
// Built here as data: URLs and registered from inside the child, the same trick
// an-test.mjs uses for the same reason: js/demo-rosters.js is not this suite's
// file to change, and every player in it has an id. This blanks one man on
// every team — the first starter, so he lands in a lineup column of both grids
// — and leaves everything else exactly as it was.

const DEMO_URL = moduleUrl('js/demo-rosters.js');
const dataUrl = (src) => `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`;

const NO_ID_DEMO = dataUrl(`
  import * as real from ${JSON.stringify(DEMO_URL)};
  export * from ${JSON.stringify(DEMO_URL)};

  export function generateDemoWeekRosters(week) {
    const got = real.generateDemoWeekRosters(week);
    const teams = got.teams.map((t) => {
      const blanked = new Set([t.starters[0] && t.starters[0].playerId]);
      const players = t.players.map((p) =>
        (blanked.has(p.playerId) ? { ...p, playerId: null } : p));
      return {
        ...t,
        players,
        starters: players.filter((p) => p.started),
        bench: players.filter((p) => !p.started),
      };
    });
    return { ...got, teams };
  }
`);

// ------------------------------------------ a season that is only half played
//
// THE DEMO SEASON IS OVER BY DEFINITION — js/demo-rosters.js hardcodes
// `played: true` on every game — so on demo data every column of the Act row
// has a number in it and the half of the rule Tim actually stated ("anything
// after leave blank") is never exercised at all. This blanks the actual for
// weeks 6–13 and leaves everything else, INCLUDING the schedule, exactly as it
// was: the schedule still claims all thirteen weeks were played, so a card that
// filled the Act row from the calendar rather than from the data would fill in
// all thirteen and fail here. That is the only way to tell the two rules apart.
//
// Week 1 also gets ONE man scoring an honest nothing. A zero in a played week
// is a real result and the single worst thing this row could do is draw it as
// one of the four ways of having no number.

const PLAYED_THROUGH = 5;

const PART_DEMO = dataUrl(`
  import * as real from ${JSON.stringify(DEMO_URL)};
  export * from ${JSON.stringify(DEMO_URL)};

  export function generateDemoWeekRosters(week) {
    const got = real.generateDemoWeekRosters(week);
    const teams = got.teams.map((t) => {
      const zeroed = t.starters[0] && t.starters[0].playerId;
      const players = t.players.map((p) => {
        if (week > ${PLAYED_THROUGH}) return { ...p, actual: null };
        if (week === 1 && p.playerId === zeroed) return { ...p, actual: 0 };
        return p;
      });
      return {
        ...t,
        players,
        starters: players.filter((p) => p.started),
        bench: players.filter((p) => !p.started),
      };
    });
    return { ...got, teams };
  }
`);

/** Swap js/demo-rosters.js for a doctored copy, from inside the child. */
const loaderFor = (mod) => dataUrl(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && /\\/demo-rosters\\.js$/.test(spec)) {
      return next(${JSON.stringify(mod)}, ctx);
    }
    return next(spec, ctx);
  }
`);

const SCENARIOS = {
  touch: { label: '(a) a coarse pointer: a tap opens the card as a sheet', coarse: true },
  mouse: { label: '(b) a mouse: the click-through is untouched', coarse: false },
  'no-id': {
    label: '(c) a man ESPN gave no id: a card, and no link to offer',
    coarse: true, demo: NO_ID_DEMO, noId: true,
  },
  // A phone-shaped window as well as a phone-shaped pointer. 390px is an
  // iPhone 14, and it is the width at which a 13-week run laid out on one line
  // is about 130px wider than the screen — which is what the scroller used to
  // be for and what the wrap now has to absorb.
  part: {
    label: '(d) half a season, on a 390px screen: the Act row, and the wrap',
    coarse: true,
    demo: PART_DEMO,
    width: 390,
  },
};

// ------------------------------------------------------------------- booting

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  if (cfg.demo) register(loaderFor(cfg.demo));

  const html = readFileSync(path.join(REPO, 'analysis.html'), 'utf8');
  const { window, document } = parseHTML(html);

  // linkedom gives <select> a `value` that returns undefined, and the page sets
  // and reads it. Shim the SELECT prototype specifically: put it on
  // HTMLElement and it is shadowed there and breaks <input> here.
  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const sel = this.querySelector('option[selected]') || this.querySelector('option');
        return sel ? sel.getAttribute('value') ?? sel.textContent : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        }
      },
    });
  }

  // The table conveniences, taken off a REAL element's prototype rather than
  // off window.HTMLTableElement — under linkedom those are not always the same
  // object, and defining on the wrong one leaves tBodies undefined.
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const head = kids(this, 'THEAD')[0];
      const rows = [];
      if (head) rows.push(...kids(head, 'TR'));
      for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
      rows.push(...kids(this, 'TR'));
      return rows;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  // js/bridge.js reads window.location.origin on every ping, and linkedom has
  // no location: the throw surfaces as an unhandled rejection out of
  // connection.js and kills the child, which looks exactly like a page failure.
  if (!window.location) {
    window.location = {
      href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:',
      pathname: '/analysis.html', search: '', hash: '',
    };
  }
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map([['ff.prefs', JSON.stringify({ 'analysis.source': 'demo' })]]);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    throw new Error(`unexpected network call: ${url}`);
  };

  // THE ONE GLOBAL THIS SUITE IS ABOUT. `coarsePointer()` asks for
  // '(hover: none)' by name, so the stub answers that query and nothing else —
  // a stub that returned `matches: true` for every query would also claim the
  // page was printing, or in high contrast, and would pass for the wrong
  // reason. It goes on `window`, not only on globalThis, because that is where
  // the page module looks.
  const matchMedia = (q) => ({
    media: String(q),
    matches: cfg.coarse && String(q).includes('hover: none'),
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });

  Object.assign(globalThis, {
    window, document, localStorage, fetch, matchMedia,
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  });
  window.localStorage = localStorage;
  window.matchMedia = matchMedia;
  // HOW WIDE THE WINDOW IS, which is a different fact from whether there is a
  // pointer — an iPad in landscape is coarse and wide, a narrowed desktop
  // window is fine-pointered and narrow. The card asks matchMedia for the one
  // and window.innerWidth for the other, and this suite sets them separately
  // for exactly that reason. Left undefined unless a scenario says otherwise,
  // so the default stays "no layout at all", which is the case every other
  // suite boots in.
  if (cfg.width) {
    window.innerWidth = cfg.width;
    window.innerHeight = 844;
  }
  window.ResizeObserver = globalThis.ResizeObserver;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  const rejections = [];
  process.on('unhandledRejection', (r) => rejections.push(String((r && r.stack) || r)));

  await import(pathToFileURL(path.join(REPO, 'js/analysis-page.js')).href);
  // Every page carries this as its own <script> tag. linkedom does not run
  // script tags, so the suite imports it the way a browser would load it —
  // after the page module, which is the order the markup states.
  await import(pathToFileURL(path.join(REPO, 'js/touch-titles.js')).href);
  await new Promise((r) => setTimeout(r, 600));
  console.error = origError;

  return { document, window, errors, fetchCalls, rejections, cfg };
}

// ---------------------------------------------------------------- assertions

function makeChecker() {
  const out = [];
  return {
    out,
    ok(name, pass, detail = '') { out.push({ name, pass: !!pass, detail: pass ? '' : detail }); },
    eq(name, got, want) {
      out.push({ name, pass: got === want, detail: got === want ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}` });
    },
  };
}

/**
 * Close anything already open before a fresh claim is made about what opens.
 * Both sheets dismiss on an outside tap, and a stale one left over from the
 * assertions above would make the next "it opened" pass for the wrong reason.
 */
function hideTitleish(document, window) {
  const esc = new window.Event('keydown', { bubbles: true });
  esc.key = 'Escape';
  document.dispatchEvent(esc);
}

// ------------------------------------------------------------- reading the run

/**
 * Read the chart out of an open card, one LINE at a time.
 *
 * A line is one `<table class="tc-run">`: the week numbers in its `<thead>`,
 * the projections in its `<tbody>`, the actuals in its `<tfoot>`. The run wraps
 * onto as many of them as the window needs, so anything that wants the whole
 * run has to walk the lines in order rather than assume there is one.
 *
 * The first cell of every row is its label — "Week" / "Proj" / "Act" — and is
 * dropped here, because it is not data and counting it as a column is exactly
 * how a three-row alignment check passes while being wrong.
 */
function readRun(card) {
  return [...card.querySelectorAll('.tc-chart .tc-run')].map((t) => {
    const row = (sel) => [...t.querySelectorAll(sel)];
    const drop = (cells) => cells.filter((el) => !el.classList.contains('tc-lbl'));
    const label = (sel) => {
      const first = t.querySelector(sel);
      return first ? first.textContent.trim() : '';
    };
    return {
      labels: [label('thead th'), label('tbody th'), label('tfoot th')],
      weeks: drop(row('thead th')).map((el) => el.textContent.trim()),
      projs: drop(row('tbody td')).map((el) => el.textContent.trim()),
      acts: drop(row('tfoot td')).map((el) => el.textContent.trim()),
      projKinds: drop(row('tbody td')).map((el) => el.getAttribute('class') || ''),
      actKinds: drop(row('tfoot td')).map((el) => el.getAttribute('class') || ''),
    };
  });
}

/**
 * The whole run, lines flattened back into one sequence of columns.
 *
 * A missing cell comes back as `null` rather than throwing. A row that has lost
 * a column is the exact defect the assertions below are for, and a suite that
 * crashes on it reports "boot failed" and throws away every other result in the
 * scenario — which is a worse answer than the one it was asked for.
 */
function runColumns(lines) {
  const out = [];
  for (const l of lines) {
    for (let i = 0; i < l.weeks.length; i++) {
      out.push({
        // parseInt, not Number: a playoff week's header reads "14PO (playoffs)".
        week: parseInt(l.weeks[i], 10),
        proj: l.projs[i] ?? null, projKind: l.projKinds[i] ?? '',
        act: l.acts[i] ?? null, actKind: l.actKinds[i] ?? '',
      });
    }
  }
  return out;
}

// The four ways of having NO number, each of which means something specific in
// the Proj row. None of them may ever appear in the Act row: a week with no
// result is blank there, and a zero is a real zero.
const NO_NUMBER_MARKS = ['Bye', '—', 'off'];

/**
 * No element inside the card may scroll, and the only honest way to check that
 * without a layout engine is to read the page's own CSS.
 *
 * Every rule whose selector mentions the card is inspected for an
 * `overflow: auto|scroll` in any axis. This is the assertion that would have
 * caught the scroller being quietly put back — which is a tempting fix for any
 * later "the card is too wide" report, and is precisely what Tim asked to have
 * removed.
 */
function cssScrollers(html) {
  const style = html.slice(html.indexOf('<style'), html.lastIndexOf('</style>'));
  const bad = [];
  for (const block of style.split('}')) {
    const at = block.lastIndexOf('{');
    if (at < 0) continue;
    const selector = block.slice(0, at).split('\n').pop().trim();
    const body = block.slice(at + 1);
    if (!/\.tipcard|\.tc-/.test(selector)) continue;
    if (/overflow(-x|-y)?\s*:\s*(auto|scroll)/.test(body)) bad.push(selector);
  }
  return bad;
}

/** Dispatch a click the way a browser does, and say whether anything cancelled it. */
function clickOn(window, el, init = {}) {
  const ev = new window.Event('click', { bubbles: true, cancelable: true });
  Object.assign(ev, { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, init);
  el.dispatchEvent(ev);
  return ev;
}

function check(scenario, { document, window, errors, rejections }) {
  const c = makeChecker();
  const cfg = SCENARIOS[scenario];

  c.eq('the page booted with no console errors', errors.length, 0);
  c.eq('and no unhandled rejections', rejections.length, 0);

  // --- the connection bar's advice -----------------------------------------
  //
  // The other thing that turns on a coarse pointer, and it shares one exported
  // `coarsePointer()` with the card so the two cannot disagree about what kind
  // of device this is. The bridge is an unpacked extension: no phone or tablet
  // browser can load one, so telling a reader there to install it sends them
  // looking for a button that does not exist and leaves them thinking the site
  // is broken. Asserted in both directions, because a message that appeared
  // everywhere would be just as wrong as one that appeared nowhere.
  const bar = document.getElementById('connBar');
  const advice = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  c.ok('the connection bar rendered', advice.length > 10, `bar read "${advice}"`);

  // THE FIELD EXISTS WITH NO EXTENSION, and this is the half that was a real
  // bug rather than a wording problem. The bar used to render a sentence and
  // nothing else when the bridge was absent, so there was no way to connect at
  // all — which quietly made a PUBLIC league unreachable from any browser
  // without the extension, phone or desktop, even though js/espn.js has always
  // read one over a plain fetch. Asserted in BOTH scenarios: it is not a phone
  // feature, it is the thing that was missing everywhere.
  c.ok('there is a league ID field even with no extension',
    !!document.getElementById('connLeague'), 'no #connLeague in the bar');
  c.ok('and a button to submit it', !!document.getElementById('connSync'), 'no #connSync');

  if (cfg.coarse) {
    c.ok('a phone is not told to install an extension it cannot install',
      !/Install the Fantasy Football/i.test(advice), advice);
    c.ok('it is told where a private league has to be read instead',
      /cannot install/i.test(advice) && /on your computer/i.test(advice), advice);
    c.ok('and that a public league does work here',
      /public league works here/i.test(advice), advice);
  } else {
    c.ok('a desktop still gets the install prompt',
      /Install the Fantasy Football/i.test(advice), advice);
  }

  const grid = document.getElementById('overviewTable');
  const cells = [...grid.querySelectorAll('td[data-tip]')];
  c.ok('the season grid has cells carrying a tip', cells.length > 10, `only ${cells.length}`);

  // Deliberately a cell in a row that is NOT the team already drilled into
  // below, so "the tap did not also load this team" is a claim with something
  // to prove rather than a tautology.
  const picked = document.querySelector('#overviewTable tbody tr.picked');
  const pickedTeam = picked ? picked.getAttribute('data-team') : null;
  const row = [...grid.querySelectorAll('tbody tr[data-team]')]
    .find((tr) => tr.getAttribute('data-team') !== pickedTeam);
  c.ok('there is another team to tap into', !!row, 'every row is the picked one');
  if (!row) return c.out;

  const cell = row.querySelector('td[data-tip]');
  const link = cell.querySelector('a.pref');
  const rosterTitleBefore = document.getElementById('rosterTitle').textContent.trim();

  if (cfg.noId) {
    // The whole point of the scenario: the cell really has no link in it, so
    // whatever the card does next it is not reading one off the page.
    c.ok('the no-id cell carries no link at all', !link, 'it has an <a>');
  } else {
    c.ok('the cell carries the click-through link', !!link, 'no a.pref in the cell');
  }

  // --------------------------------------------------------------- the tap
  const ev = clickOn(window, link || cell);
  const card = document.getElementById('tipCard');

  if (!cfg.coarse) {
    // A MOUSE. Nothing about the click-through may have changed: link-check.mjs
    // follows exactly this click on exactly these cells.
    c.eq('a mouse click is not intercepted', ev.defaultPrevented, false);
    c.ok('and no sheet was opened', !card || card.hidden || !card.classList.contains('sheet'),
      'a sheet appeared under a mouse');

    // The hover still works, and still works the way it always did.
    cell.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
    const hover = document.getElementById('tipCard');
    c.ok('hovering still opens the card', hover && !hover.hidden, 'no card on mouseover');
    if (hover) {
      c.eq('as a tooltip, not a sheet', hover.getAttribute('role'), 'tooltip');
      c.eq('with no sheet class', hover.classList.contains('sheet'), false);
      c.eq('and no actions in it', hover.querySelectorAll('.tc-actions').length, 0);
      c.ok('and it names the player', hover.querySelector('.tc-ident').textContent.trim().length > 3);
    }

    // And the title sheet stays out of the way entirely: with a pointer, a
    // `title` already draws a native tooltip, and a second panel opening on
    // every click would be an answer to a question nobody asked. A mechanism
    // that fired everywhere would be as wrong as one that fired nowhere.
    const titled = [...document.querySelectorAll('#seasonTable td[title], #seasonTable th[title]')]
      .find((el) => !el.closest('a, button'));
    c.ok('the season grid still explains its cells with a title', !!titled);
    if (titled) {
      clickOn(window, titled);
      const ts = document.getElementById('titleSheet');
      c.ok('and a mouse click on one opens no title sheet', !ts || ts.hidden,
        'the title sheet opened under a mouse');
    }

    // --- "Season by week" under a MOUSE ------------------------------------
    // Its rows are lineup slots and every cell is a bare number, so the two
    // things that name the man — the line above the table and the highlight —
    // have to be on the hover here and on the tap in the other mode. A click
    // must still simply follow the link, which link-check.mjs relies on.
    {
      const season = document.getElementById('seasonTable');
      const sc = season.querySelector('tbody td[data-pid]');
      c.ok('the season panel has cells standing for a player', !!sc, 'no data-pid cells');
      if (sc) {
        const pid = sc.getAttribute('data-pid');
        const his = season.querySelectorAll(`td[data-pid="${pid}"]`).length;
        // Escape first. The GRID above legitimately opened its own card a few
        // assertions ago and it is still on screen, so without this the check
        // below would find that one and report the season panel as broken —
        // which is a test measuring the wrong table, not a defect.
        const escC = new window.Event('keydown', { bubbles: true });
        escC.key = 'Escape';
        document.dispatchEvent(escC);
        c.eq('the grid card can be dismissed before this check',
          document.getElementById('tipCard').hidden, true);

        sc.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
        const pick = document.getElementById('seasonPick').textContent.replace(/\s+/g, ' ').trim();
        // Name, season proj and average — no week run, which is the change Tim
        // asked for on 2026-09-18. The card is asserted ABSENT below.
        c.ok('hovering a number names him above the table', /·/.test(pick) && pick.length > 8, pick);
        c.ok('with his season projection and his average',
          /season proj \d|no season projection/.test(pick) && /avg \d|nothing scored yet/.test(pick),
          pick);
        const noCard = document.getElementById('tipCard');
        c.ok('and opens no card on this panel', !noCard || noCard.hidden,
          'a card opened on the season panel under a mouse');
        c.eq('and lights every week he holds a slot',
          season.querySelectorAll('td.lit').length, his);
        const ev4 = clickOn(window, sc.querySelector('a.pref'));
        c.eq('and a mouse click on one is not intercepted', ev4.defaultPrevented, false);
      }
    }
    return c.out;
  }

  // A FINGER.
  c.eq('the tap is intercepted rather than following the link', ev.defaultPrevented, true);
  c.ok('a card is open', card && !card.hidden, 'no card after the tap');
  if (!card) return c.out;

  c.eq('as a sheet', card.classList.contains('sheet'), true);
  c.eq('announced as a dialog rather than a tooltip', card.getAttribute('role'), 'dialog');

  // --- it is about the man whose cell was tapped -------------------------
  //
  // Re-derived from the CELL rather than read back off the card: the aria-label
  // the page put on the link is built from the same identity line the card
  // shows, so the two agreeing is a real cross-check. In the no-id scenario
  // there is no label to compare against, so the claim narrows to "it named
  // somebody", which is still the thing that would break.
  const ident = card.querySelector('.tc-ident').textContent.trim();
  c.ok('the sheet names a player', ident.length > 3, `ident was "${ident}"`);
  if (link) {
    const label = link.getAttribute('aria-label') || '';
    c.ok('and it is the man the tapped cell is about', label.startsWith(ident),
      `card "${ident}" vs cell "${label}"`);
  }

  // --- the chart: three rows, and they line up column for column ---------
  //
  // The alignment IS the feature. The card exists because a native `title`
  // renders in the OS UI font and no amount of padding lines thirteen columns
  // up; a third row under the projections is a third chance to get that wrong.
  // Checked per line and then again across the whole run, because a run that
  // wraps can be internally consistent on each line and still have lost a
  // column between them.
  const lines = readRun(card);
  c.ok('the week run is in the sheet', lines.length >= 1, 'no .tc-run in the card');

  c.ok('every line of the run is labelled Week / Proj / Act',
    lines.every((l) => JSON.stringify(l.labels) === JSON.stringify(['Week', 'Proj', 'Act'])),
    JSON.stringify(lines.map((l) => l.labels)));
  c.ok('EVERY WEEK HAS A PROJECTION AND AN ACTUAL DIRECTLY UNDER IT',
    lines.every((l) => l.weeks.length === l.projs.length && l.weeks.length === l.acts.length),
    JSON.stringify(lines.map((l) => [l.weeks.length, l.projs.length, l.acts.length])));
  c.ok('and no line is empty, which would be a column lost in the wrap',
    lines.every((l) => l.weeks.length > 0), JSON.stringify(lines.map((l) => l.weeks.length)));

  const cols = runColumns(lines);
  // Thirteen regular weeks and the sample league's three playoff weeks (14–16),
  // which every week preview now carries after a heavy line (Tim, 2026-09-17).
  c.eq('the run covers the whole demo season and its playoffs', cols.length, 16);
  c.ok('the weeks read 1 to 16 in order, across however many lines it took',
    JSON.stringify(cols.map((k) => k.week)) ===
      JSON.stringify(Array.from({ length: 16 }, (_, i) => i + 1)),
    JSON.stringify(cols.map((k) => k.week)));

  // --- the playoff line ----------------------------------------------------
  // One column carries it — week 14, the first playoff week — in all three
  // rows, whichever wrapped line it landed on; and the header says so in words.
  {
    const lined = [...card.querySelectorAll('.tc-run th, .tc-run td')]
      .filter((el) => el.classList.contains('po-start'));
    const head = lined.find((el) => el.tagName === 'TH');
    c.ok('THE PLAYOFF LINE IS ON WEEK 14, IN THE WEEK, PROJ AND ACT ROWS, AND NOWHERE ELSE',
      lined.length === 3 && head && parseInt(head.textContent, 10) === 14 &&
      lined.filter((el) => el.tagName === 'TD').length === 2,
      lined.map((el) => `${el.tagName}:${el.textContent.trim()}`).join(' '));
    c.ok('and its header says PO, with "playoffs" for a screen reader',
      head && /PO/.test(head.textContent) && /playoffs/.test(head.textContent),
      head && head.textContent);
    c.ok('the card explains the line in words',
      /PO = the playoffs \(weeks 14–16\)/.test(card.textContent), card.textContent.slice(0, 300));
  }
  c.eq('exactly one column is marked as the week the page is showing',
    cols.filter((k) => k.projKind.includes('now')).length, 1);
  c.ok('and the Act row marks the same one, not a different one',
    cols.findIndex((k) => k.actKind.includes('now')) ===
      cols.findIndex((k) => k.projKind.includes('now')),
    `${cols.findIndex((k) => k.actKind.includes('now'))} vs ` +
    `${cols.findIndex((k) => k.projKind.includes('now'))}`);

  // --- an actual is never dressed up as one of the four no-number marks ---
  // `Bye`, `—`, `off` and `·` each say something specific in the Proj row, and
  // the Act row has nothing to say with them: a week with no result is blank.
  c.ok('the Act row never borrows one of the Proj row’s no-number marks',
    cols.every((k) => !NO_NUMBER_MARKS.includes(k.act)),
    JSON.stringify(cols.filter((k) => NO_NUMBER_MARKS.includes(k.act)).map((k) => k.week)));
  c.ok('every filled Act cell is a number and says so in its class',
    cols.filter((k) => k.act !== '' && k.act !== '·')
      .every((k) => /^\d+\.\d$/.test(k.act) && /\ba-num\b/.test(k.actKind)),
    JSON.stringify(cols.filter((k) => k.act !== '' && k.act !== '·')
      .map((k) => `${k.act}/${k.actKind}`).slice(0, 4)));
  c.ok('and every empty one is marked as blank rather than left unclassed',
    cols.filter((k) => k.act === '').every((k) => /\ba-blank\b/.test(k.actKind)),
    JSON.stringify(cols.filter((k) => k.act === '').map((k) => k.actKind).slice(0, 4)));

  // --- nothing in the card scrolls ---------------------------------------
  c.ok('no element in the card carries an inline overflow',
    ![...card.querySelectorAll('*')].some((el) => /overflow/.test(el.getAttribute('style') || '')),
    'an inline overflow appeared inside the card');
  c.eq('and the old .tc-scroll box is gone rather than merely emptied',
    card.querySelectorAll('.tc-scroll').length, 0);
  const scrollers = cssScrollers(readFileSync(path.join(REPO, 'analysis.html'), 'utf8'));
  c.ok('NO RULE FOR THE CARD DECLARES A SCROLLING OVERFLOW',
    scrollers.length === 0, `these still scroll: ${scrollers.join(' | ')}`);

  // --- the wrap, and the half-played season ------------------------------
  if (cfg.width) {
    // 390px cannot hold thirteen 34px columns plus the row labels, and there is
    // no scroller to hide the rest in any more, so the run MUST have wrapped.
    c.ok('ON A PHONE THE RUN WRAPS ONTO MORE THAN ONE LINE',
      lines.length > 1, `${lines.length} line(s) for 16 weeks at ${cfg.width}px`);
    // The line still reads on a wrapped run: the week-14 column opens a
    // playoff stretch INSIDE a line here (16 weeks at 390px are 8 + 8), and
    // every column of that line is still there under it.
    c.ok('the playoff line survives the wrap — its column is whole in its own line',
      lines.some((l) => l.weeks.some((w) => /^14PO/.test(w)) &&
        l.weeks.length === l.projs.length && l.weeks.length === l.acts.length),
      JSON.stringify(lines.map((l) => l.weeks)));
    // Each line has to actually fit: the label column plus its own columns at
    // the 32px floor the phone stylesheet sets, inside the screen.
    const widest = Math.max(...lines.map((l) => l.weeks.length));
    c.ok('and every line fits the screen it wrapped for',
      56 + widest * 34 + 28 <= cfg.width, `${widest} columns wide at ${cfg.width}px`);
    c.ok('the lines are balanced rather than leaving an orphan at the end',
      lines[lines.length - 1].weeks.length >= 3,
      JSON.stringify(lines.map((l) => l.weeks.length)));

    // THE RULE IS THE DATA, NOT THE CALENDAR. The demo schedule still says all
    // thirteen weeks were played; only the actuals say otherwise. A card that
    // filled the Act row from the week number would fill in all thirteen here.
    c.ok(`weeks after ${PLAYED_THROUGH} have no actual, though the schedule claims they were played`,
      cols.filter((k) => k.week > PLAYED_THROUGH && /\bk-num\b/.test(k.projKind))
        .every((k) => k.act === ''),
      JSON.stringify(cols.filter((k) => k.week > PLAYED_THROUGH).map((k) => `w${k.week}:${k.act}`)));
    c.ok(`and every week up to ${PLAYED_THROUGH} that he played has one`,
      cols.filter((k) => k.week <= PLAYED_THROUGH && /\bk-num\b/.test(k.projKind))
        .every((k) => /^\d+\.\d$/.test(k.act)),
      JSON.stringify(cols.filter((k) => k.week <= PLAYED_THROUGH).map((k) => `w${k.week}:${k.act}`)));
    c.ok('which is a real split, not every column falling the same way',
      cols.some((k) => k.act !== '') && cols.some((k) => k.act === ''),
      JSON.stringify(cols.map((k) => k.act)));

    // A ZERO IN A PLAYED WEEK IS A RESULT. One man was doctored to score
    // nothing in week 1; his card has to read "0.0" there rather than a blank,
    // a dash or a bye — the one mistake this row could make that would quietly
    // turn a bad week into no week at all.
    const everyCard = [...row.querySelectorAll('td[data-tip]')].map((td) => {
      clickOn(window, td.querySelector('a.pref') || td);
      return runColumns(readRun(document.getElementById('tipCard')));
    });
    const zeroes = everyCard.filter((k) => k[0] && k[0].act === '0.0');
    c.ok('a man who played and scored nothing reads 0.0 in week 1',
      zeroes.length === 1, `${zeroes.length} of ${everyCard.length} cards show a week-1 zero`);
    c.ok('every card in the row tells the same story about which weeks are blank',
      everyCard.every((k) =>
        k.filter((x) => x.week > PLAYED_THROUGH && /\bk-num\b/.test(x.projKind))
          .every((x) => x.act === '')),
      'a card filled in a week that has no result');
    hideTitleish(document, window);
    clickOn(window, link || cell);   // leave the sheet open for what follows
  } else {
    // With no window to measure — which is a desktop, and is also every other
    // suite's world — the whole run stays on one line, exactly as it was.
    c.eq('with room for it, the run is still one unbroken line', lines.length, 1);
  }

  // --- the link it gives back --------------------------------------------
  const open = card.querySelector('.tc-open');
  c.ok('the sheet offers the action the tap preempted', !!open, 'no .tc-open in the sheet');
  if (link) {
    c.eq('and it is the SAME href the cell carried, not a second way of naming him',
      open && open.getAttribute('href'), link.getAttribute('href'));
  } else {
    c.eq('with no id there is no link, and the sheet says so rather than offering one',
      open && open.tagName, 'SPAN');
    c.eq('marked as the off state', open && open.classList.contains('tc-open-off'), true);
  }

  // --- and it did not ALSO drill into the team ---------------------------
  // The row under the cell loads that team into the roster detail. Without
  // stopPropagation a single tap would open a card AND change the panel below.
  c.eq('the tap did not also load this team below',
    document.getElementById('rosterTitle').textContent.trim(), rosterTitleBefore);

  // --- dismissal, all three ways -----------------------------------------
  clickOn(window, card.querySelector('.tc-close'));
  c.eq('Close dismisses it', card.hidden, true);

  clickOn(window, link || cell);
  c.eq('tapping the cell again reopens it', card.hidden, false);
  clickOn(window, document.body);
  c.eq('a tap outside dismisses it', card.hidden, true);

  clickOn(window, link || cell);
  c.eq('and once more', card.hidden, false);
  const esc = new window.Event('keydown', { bubbles: true });
  esc.key = 'Escape';
  document.dispatchEvent(esc);
  c.eq('Escape dismisses it', card.hidden, true);

  // --- a modified tap is left to the browser -----------------------------
  // A tablet with a keyboard can still open-in-new-tab, and that must reach
  // the link rather than the card.
  const modded = clickOn(window, link || cell, { metaKey: true });
  c.eq('a cmd-click is left alone', modded.defaultPrevented, false);
  c.eq('and opens no sheet', card.hidden, true);

  // --- the row is still clickable where it is not a number ---------------
  // Only the cells with numbers in them are taken over. Tapping the team name
  // must still drill in, or the touch fix would have cost the drill-down.
  const nameCell = row.querySelector('td.name');
  c.ok('the row has a name cell that carries no tip', nameCell && !nameCell.dataset.tip);
  if (nameCell) {
    clickOn(window, nameCell);
    c.ok('tapping the team still loads it below',
      document.getElementById('rosterTitle').textContent.trim() !== rosterTitleBefore,
      'the roster detail did not change');
  }

  // --- `title` attributes, which draw nothing at all on iOS ---------------
  //
  // The site puts real content in them — three different reasons a cell can
  // read `—`, seventeen column definitions on the stats page — and a phone
  // could read none of it. js/touch-titles.js opens the same words as a sheet.
  // Asserted here on the analysis page's season grid because that is a page
  // this suite already boots; the module is generic and every page loads it.
  hideTitleish(document, window);
  const titled = [...document.querySelectorAll('#seasonTable td[title], #seasonTable th[title]')]
    .find((el) => !el.closest('a, button'));
  c.ok('the season grid still explains its cells with a title', !!titled,
    'no titled cell found — did the explanations move?');
  if (titled) {
    const want = titled.getAttribute('title');
    clickOn(window, titled);
    const ts = document.getElementById('titleSheet');
    c.ok('tapping it opens the title sheet', ts && !ts.hidden, 'no #titleSheet after the tap');
    if (ts) {
      c.ok('and the sheet carries the words the title carried',
        ts.textContent.includes(want), `sheet read "${ts.textContent.trim().slice(0, 120)}"`);
      clickOn(window, ts.querySelector('.ts-close'));
      c.eq('Close dismisses it', ts.hidden, true);
    }
  }

  // A CONTROL MUST STILL WORK. A `title` on a link is the player click-through's
  // own label, and swallowing that tap would break the one contract holding the
  // pages together; a tap on a button has to press the button. Both are why the
  // FLEX filters' and the run count's explanations were moved onto the page.
  const titledLink = document.querySelector('a[title]');
  if (titledLink) {
    const ev3 = clickOn(window, titledLink);
    const ts = document.getElementById('titleSheet');
    c.eq('a titled LINK is not swallowed', ev3.defaultPrevented, false);
    c.ok('and opens no title sheet', !ts || ts.hidden, 'a link tap opened the sheet');
  }
  const titledButton = document.querySelector('button[title]');
  if (titledButton) {
    clickOn(window, titledButton);
    const ts = document.getElementById('titleSheet');
    c.ok('nor does a titled BUTTON', !ts || ts.hidden, 'a button tap opened the sheet');
  }

  // --- THE MEASURE SWITCH LEAVES THE GRID WIRED --------------------------
  //
  // The page used to stack TWO all-teams grids, and this block used to tap a
  // cell in the second one, because two calls to wireTips is exactly the kind
  // of pair where one gets missed. They were merged into one panel on
  // 2026-09-17 and the measure became a control inside it, which moves the
  // hazard rather than removing it: pressing it rebuilds every row under the
  // reader, so a card wired to the ROWS would be thrown away with them and
  // would look perfectly fine until a finger arrived. wireTips is registered
  // once, on the table, and this is what says so.
  //
  // CHANGED 2026-09-19: the Proj avg measure is one column per LINEUP SLOT
  // averaged over the season, so it opens NO card — an average over fourteen
  // weeks is usually several men and there is nobody for a card to be about.
  // That makes the round trip the thing worth asserting: away and back, and the
  // cards have to be working again on the other side of it.
  {
    const toggle = document.getElementById('measureToggle');
    c.ok('the all-teams panel carries the measure switch', !!toggle, 'no #measureToggle');
    const avg = toggle && toggle.querySelector('button[data-measure="avg"]');
    c.ok('with a proj-avg setting on it', !!avg, 'no avg button');
    if (avg) {
      clickOn(window, avg);
      c.ok('pressing it lights that button', /\bon\b/.test(avg.getAttribute('class') || ''),
        avg.getAttribute('class') || '');
      c.ok('THE SLOT AVERAGE OPENS NO CARD — a slot is not a man',
        !document.querySelector('#overviewTable td[data-tip]') &&
        !document.querySelector('#overviewTable tbody a.pref'),
        `${document.querySelectorAll('#overviewTable td[data-tip]').length} tips, ` +
        `${document.querySelectorAll('#overviewTable tbody a.pref').length} links`);
      c.ok('but it says who fills the slot in a title, which a finger can open',
        [...document.querySelectorAll('#overviewTable tbody td.slot-avg')]
          .every((td) => td.hasAttribute('title')) &&
        document.querySelectorAll('#overviewTable tbody td.slot-avg').length > 0,
        'a slot-average cell with nothing to say');

      // Back to the week measure, and the cards have to come back with it —
      // which is the original hazard: the rows were rebuilt twice under the
      // reader, and a card wired to a ROW rather than to the table would be
      // gone by now and would look perfectly fine until a finger arrived.
      const wk = toggle.querySelector('button[data-measure="week"]');
      if (wk) clickOn(window, wk);
      const repainted = document.querySelector('#overviewTable td[data-tip]');
      c.ok('and the grid carries tip cells again after the round trip', !!repainted);
      if (repainted) {
        const ev2 = clickOn(window, repainted.querySelector('a.pref') || repainted);
        c.eq('a tap on the repainted grid still opens a sheet', ev2.defaultPrevented, true);
        c.eq('which is the same card', document.getElementById('tipCard').hidden, false);
      }
    }
  }

  // --- "SEASON BY WEEK" UNDER A FINGER ------------------------------------
  //
  // Its rows are lineup SLOTS: the cells are bare numbers and no row carries a
  // name, so the things that put a person back into the grid — the line above
  // the table and the highlight across his other weeks — are on a hover. A
  // phone has no hover, so a tap has to do them instead of leaving the page by
  // the link, which is exactly the defect this suite exists for.
  //
  // CHANGED 2026-09-18, on Tim's ask: this panel NO LONGER OPENS THE CARD.
  // "Because the player's season-wide proj is highlighted when you hover over
  // that number, we don't need to be providing the 14 week preview when you
  // hover over it as well." The assertions below used to require the sheet and
  // read its link; they now require the opposite — no card at all — and read
  // the link off the pick line, which is where the action the tap preempted
  // went. The two grids at the top of the page still open the card, and the
  // scenarios above still prove it, so "the card works" is not being weakened
  // here, only moved off one table.
  {
    const season = document.getElementById('seasonTable');
    const sc = season.querySelector('tbody td[data-pid]');
    c.ok('the season panel has cells standing for a player', !!sc, 'no data-pid cells');
    if (sc) {
      const pid = sc.getAttribute('data-pid');
      const his = [...season.querySelectorAll(`td[data-pid="${pid}"]`)];
      const seasonLink = sc.querySelector('a.pref');
      const before = document.getElementById('seasonPick').textContent.trim();
      const ev5 = clickOn(window, seasonLink || sc);
      c.eq('A TAP ON A SEASON NUMBER DOES NOT FOLLOW ITS LINK', ev5.defaultPrevented, true);
      const card2 = document.getElementById('tipCard');
      c.ok('AND IT OPENS NO CARD — this panel has none by design',
        !card2 || card2.hidden, 'a card opened on the season panel');
      const line = document.getElementById('seasonPick');
      const pick = line.textContent.replace(/\s+/g, ' ').trim();
      c.ok('THE TAP NAMES HIM ABOVE THE TABLE, WHERE A HOVER WOULD HAVE',
        /·/.test(pick) && pick !== before, pick);
      // The three things Tim asked for, each checked for itself: a line that
      // named him and quietly dropped a number would otherwise pass.
      c.ok('the line carries his season projection',
        /season proj \d/.test(pick) || /no season projection/.test(pick), pick);
      c.ok('and what he is averaging',
        /avg \d/.test(pick) || /nothing scored yet/.test(pick), pick);
      c.ok('and NOT the week run the card used to draw',
        !/Week 1\b.*Week 2\b/.test(pick), pick);
      c.eq('AND LIGHTS EVERY OTHER WEEK HE HOLDS A SLOT',
        season.querySelectorAll('td.lit').length, his.length);
      c.ok('which is more than the one cell that was tapped', his.length > 1, `${his.length}`);
      // THE WAY OUT OF THE PANEL. On a phone the tap no longer navigates, so
      // without this link the click-through would be desktop-only from here —
      // the same capability the sheet's own button used to provide.
      if (seasonLink) {
        const open2 = line.querySelector('a.pick-open');
        c.eq('the line offers the link the tap preempted',
          open2 && open2.getAttribute('href'), seasonLink.getAttribute('href'));
      }
      // Escape clears the highlight, so one gesture puts the panel back to rest.
      const esc2 = new window.Event('keydown', { bubbles: true });
      esc2.key = 'Escape';
      document.dispatchEvent(esc2);
      c.eq('Escape clears the highlight', season.querySelectorAll('td.lit').length, 0);
    }
  }

  return c.out;
}

// -------------------------------------------------------------------- runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const scenario = process.argv[2];
  try {
    const booted = await boot(scenario);
    const results = check(scenario, booted);
    console.log('@@' + JSON.stringify({ scenario, results }));
    process.exit(results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    console.log('@@' + JSON.stringify({
      scenario,
      results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }],
    }));
    process.exit(1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const res = spawnSync(process.execPath, [self, scenario], {
    encoding: 'utf8',
    cwd: path.dirname(self),
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    console.log(`FAIL ${scenario} — no result\n  stdout: ${res.stdout}\n  stderr: ${(res.stderr || '').slice(0, 2000)}`);
    failed++;
    continue;
  }
  const { results } = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  total += results.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario}  ${cfg.label}  (${results.length - bad.length}/${results.length})`);
  for (const r of bad) console.log(`   x ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  failed += bad.length;
}

console.log(failed ? `\n${failed} of ${total} assertions failed` : `\nAll ${total} assertions passed`);
process.exit(failed ? 1 : 0);
