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
//
// Each scenario gets its own child process: a module initialises once per
// process and analysis-page.js self-boots on import, so two of these in one
// process would share a DOM and a Map of tips.

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

const NO_ID_LOADER = dataUrl(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && /\\/demo-rosters\\.js$/.test(spec)) {
      return next(${JSON.stringify(NO_ID_DEMO)}, ctx);
    }
    return next(spec, ctx);
  }
`);

const SCENARIOS = {
  touch: { label: '(a) a coarse pointer: a tap opens the card as a sheet', coarse: true },
  mouse: { label: '(b) a mouse: the click-through is untouched', coarse: false },
  'no-id': { label: '(c) a man ESPN gave no id: a card, and no link to offer', coarse: true, noId: true },
};

// ------------------------------------------------------------------- booting

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  if (cfg.noId) register(NO_ID_LOADER);

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
  if (cfg.coarse) {
    c.ok('a phone is not told to install an extension it cannot install',
      !/Install the Fantasy Football/i.test(advice), advice);
    c.ok('it is told where the live numbers are instead',
      /cannot install one/i.test(advice) && /on your computer/i.test(advice), advice);
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

  // --- the two-row chart is still two rows of the same length ------------
  const heads = card.querySelectorAll('.tc-run thead th');
  const vals = card.querySelectorAll('.tc-run tbody td');
  c.ok('the week run is in the sheet', heads.length > 2, `${heads.length} columns`);
  c.eq('and every week has its own projection under it', vals.length, Math.max(0, heads.length - 1));

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

  // --- the second grid is wired the same way -----------------------------
  // Two grids are built by one renderGrid and wired by two calls to wireTips;
  // one of them being missed is exactly the kind of thing that looks fine.
  const weekCell = document.querySelector('#weeklyTable td[data-tip]');
  c.ok('the week grid has tip cells too', !!weekCell);
  if (weekCell) {
    const ev2 = clickOn(window, weekCell.querySelector('a.pref') || weekCell);
    c.eq('and a tap there opens a sheet as well', ev2.defaultPrevented, true);
    c.eq('which is the same card', document.getElementById('tipCard').hidden, false);
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
