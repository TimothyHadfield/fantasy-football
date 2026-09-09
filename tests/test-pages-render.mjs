// Boots each page's REAL html with its REAL module against linkedom.
//
// This is the suite that catches what nothing else does: a missing element id,
// a typo in a querySelector, an import that doesn't resolve. Those sail through
// unit tests and only surface in a browser.
//
// Run from tests/:  node test-pages-render.mjs  (or a single page:
// node test-pages-render.mjs waivers.html)
// Every page is loaded in ITS OWN child process, because an ES module only
// initialises once per process and each page module self-boots on import.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';

// index.html's module is discovered from the page itself, so a renamed module
// is caught rather than hard-coded around.
const PAGES = ['index.html', 'stats.html', 'analysis.html', 'schedule.html'];

/** Parse the <script type="module" src="..."> tags a page actually declares. */
function moduleSrcs(html) {
  const out = [];
  const re = /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

async function renderOne(page) {
  const html = readFileSync(path.join(REPO, page), 'utf8');
  const { window, document } = parseHTML(html);

  // --- shims for what linkedom does not implement -------------------------
  // These are all standard in a real browser, so page code using them is
  // correct; the harness is what's lacking.

  // <select>.value is defined on HTMLSelectElement.prototype and returns
  // undefined. Shimming HTMLElement.prototype does nothing (it's shadowed) and
  // would break <input>, so patch the select prototype specifically.
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

  // HTMLTableElement conveniences.
  //
  // Take the prototype from an element linkedom actually made, rather than
  // from window.HTMLTableElement — the two are not always the same object
  // here, and defining on the wrong one leaves table.tBodies undefined.
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) =>
    el ? Array.from(el.children).filter((c) => c.tagName === tag) : [];
  if (TableProto) {
    Object.defineProperty(TableProto, 'tBodies', {
      configurable: true,
      get() { return kids(this, 'TBODY'); },
    });
    Object.defineProperty(TableProto, 'tHead', {
      configurable: true,
      get() { return kids(this, 'THEAD')[0] || null; },
    });
    Object.defineProperty(TableProto, 'rows', {
      configurable: true,
      get() {
        const head = kids(this, 'THEAD')[0];
        const bodies = kids(this, 'TBODY');
        const rows = [];
        if (head) rows.push(...kids(head, 'TR'));
        for (const b of bodies) rows.push(...kids(b, 'TR'));
        rows.push(...kids(this, 'TR'));
        return rows;
      },
    });
  }
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  if (RowProto) {
    Object.defineProperty(RowProto, 'cells', {
      configurable: true,
      get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
    });
  }

  // linkedom gives the window no location, and js/bridge.js posts to
  // window.location.origin on every ping. Without this the bridge probe throws
  // an unhandled rejection that kills the process before the page settles.
  if (!window.location) {
    window.location = {
      href: 'http://localhost/', origin: 'http://localhost',
      protocol: 'http:', host: 'localhost', hostname: 'localhost',
      pathname: '/' + page, search: '', hash: '',
    };
  }
  globalThis.location = window.location;

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  // No network in the harness: any real fetch is a failure we want to see.
  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url));
    throw new Error(`unexpected network call: ${url}`);
  };

  Object.assign(globalThis, {
    window, document, localStorage, fetch,
    HTMLElement: window.HTMLElement,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Node: window.Node,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;
  // linkedom has no location/postMessage. bridge.js reads window.location.origin
  // when its ping timer fires (~400ms in), and the throw surfaces as an
  // unhandled rejection out of connection.js's init(), killing the child --
  // but only when a page's own work delays the harness past that timer, which
  // makes it look like a page failure. Both exist in every real browser.
  if (!window.location) window.location = { origin: 'null', href: 'about:blank' };
  if (!window.postMessage) window.postMessage = () => {};

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); origError(...a); };

  const srcs = moduleSrcs(html);
  if (!srcs.length) throw new Error(`${page}: declares no module scripts`);

  for (const src of srcs) {
    const abs = path.join(REPO, src);
    await import(pathToFileURL(abs).href + `?t=${Date.now()}`);
  }

  // Let self-booting modules finish their microtasks/timers.
  await new Promise((r) => setTimeout(r, 250));
  console.error = origError;

  const body = document.body.innerHTML;
  return { page, srcs, errors, fetchCalls, bodyLen: body.length, document };
}

// ---------------------------------------------------------------- child mode
if (process.argv[2]) {
  const page = process.argv[2];
  try {
    const r = await renderOne(page);

    const problems = [];
    if (r.errors.length) problems.push(`console.error: ${r.errors.slice(0, 3).join(' | ')}`);
    if (r.fetchCalls.length) problems.push(`made ${r.fetchCalls.length} network call(s): ${r.fetchCalls[0]}`);

    // A page that rendered nothing into its panels is a silent failure.
    const tables = r.document.querySelectorAll('table').length;
    const filledCells = r.document.querySelectorAll('tbody td').length;

    console.log(JSON.stringify({
      page, ok: problems.length === 0, problems,
      modules: r.srcs, tables, filledCells,
    }));
    process.exit(problems.length ? 1 : 0);
  } catch (err) {
    console.log(JSON.stringify({ page, ok: false, problems: [String(err && err.stack || err)] }));
    process.exit(1);
  }
}

// --------------------------------------------------------------- parent mode
const self = fileURLToPath(import.meta.url);
let failed = 0;
for (const page of PAGES) {
  const res = spawnSync(process.execPath, [self, page], { encoding: 'utf8' });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* fall through */ }

  if (!parsed) {
    console.log(`FAIL ${page}\n  no result. stdout=${res.stdout}\n  stderr=${(res.stderr || '').slice(0, 1200)}`);
    failed++;
    continue;
  }
  if (parsed.ok) {
    console.log(`PASS ${page}  (modules: ${parsed.modules.join(', ')}; ${parsed.tables} tables, ${parsed.filledCells} body cells)`);
  } else {
    failed++;
    console.log(`FAIL ${page}`);
    for (const p of parsed.problems) console.log(`  - ${p.slice(0, 900)}`);
  }
}

console.log(failed ? `\n${failed} page(s) failed` : `\nAll ${PAGES.length} pages rendered`);
process.exit(failed ? 1 : 0);
