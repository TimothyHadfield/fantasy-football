// How wordy is each page? Both a measuring tool AND the suite that gates it.
//
//   node text-audit.mjs            every page, a summary per panel, and the
//                                  per-page ceiling enforced (exits non-zero
//                                  when a page is over it)
//   node text-audit.mjs trade.html one page, reported and not gated
//
// Boots each page's real HTML and modules on demo data (the same harness as
// test-pages-render.mjs) and counts the PROSE a reader is shown. Text inside a
// closed <details> is counted separately, as "tucked away", since a reader
// only sees it on asking.
//
// TWO COUNTS, and the difference between them is the point (AUDIT §3.2).
//
//   tags      the original count: words inside <p>, .panel-note, .note,
//             .ctl-hint and <li>. That is the shape the static markup happens
//             to use, and it MISSED about two thirds of the words on this site
//             — trade measured 196 against 547 actually on screen — because
//             prose written at runtime lands in whatever element the renderer
//             built, which is usually a div or a span.
//   rendered  every word a reader is shown in the panel, whatever element it
//             is in: the whole subtree minus tables (data, not prose), minus
//             controls and their labels, minus headings, minus anything hidden
//             or sr-only. This is the number rule 16 is about, and the number
//             the ceilings in text-ceilings.json are set against.
//
// It also waits for each page to FINISH rather than for a fixed 1.5 s: the
// Trade page prices itself on load, and a fixed wait is what makes a suite
// fail on a loaded machine (PROGRESS.md Traps). The page is settled when the
// rendered word count has stopped changing.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';

const PAGES = [
  'index.html', 'stats.html', 'analysis.html', 'schedule.html',
  'waivers.html', 'trade.html', 'summary.html',
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CEILINGS = JSON.parse(readFileSync(path.join(HERE, 'text-ceilings.json'), 'utf8'));

// Digit groups are joined before counting, so a runner whose locale renders
// `toLocaleString` as "10 000" rather than "10,000" counts the same number of
// words as this machine does. Without it the ceilings below would be a fact
// about one computer, and CI would go red — which now stops the deploy (§3.1).
const words = (s) => (String(s || '')
  .replace(/(\d)[\s  ](?=\d)/g, '$1')
  .trim().match(/\S+/g) || []).length;

// Not prose: data, controls, control labels, the panel's own heading, and
// anything that is not drawn at all.
const NOT_PROSE = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IMG',
  'TABLE', 'SELECT', 'OPTION', 'OPTGROUP', 'BUTTON', 'INPUT', 'TEXTAREA',
  'LABEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

const isOffscreen = (el) => {
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  return /(^|\s)(sr-only|visually-hidden)(\s|$)/.test(el.getAttribute('class') || '');
};

/**
 * Every word a reader is shown under `root`, and every word tucked inside a
 * closed <details> there. A closed toggle's own <summary> is on screen, so it
 * counts as shown even though what it opens does not.
 */
function prose(root) {
  let shown = 0, away = 0;
  const walk = (node, tucked) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {
        const n = words(child.textContent);
        if (tucked) away += n; else shown += n;
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (NOT_PROSE.has(child.tagName)) continue;
      if (isOffscreen(child)) continue;
      if (child.tagName === 'SUMMARY') { walk(child, tucked); continue; }
      walk(child, tucked || (child.tagName === 'DETAILS' && !child.hasAttribute('open')));
    }
  };
  walk(root, false);
  return { shown, away };
}

async function audit(page) {
  const html = readFileSync(path.join(REPO, page), 'utf8');
  const { window, document } = parseHTML(html);
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
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const r = [];
      const h = kids(this, 'THEAD')[0];
      if (h) r.push(...kids(h, 'TR'));
      for (const b of kids(this, 'TBODY')) r.push(...kids(b, 'TR'));
      return r;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });
  window.location = { href: `http://localhost/${page}`, origin: 'http://localhost', pathname: `/${page}`, search: '', hash: '' };
  globalThis.location = window.location;
  window.postMessage = () => {};
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.assign(globalThis, {
    window, document, localStorage,
    fetch: async () => { throw new Error('no network'); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;
  console.error = () => {};
  for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((x) => x[1])) {
    await import(pathToFileURL(path.join(REPO, m)).href);
  }
  // Wait for the page to FINISH, not for a clock. The Trade page prices itself
  // on load and can take several seconds; a fixed wait would under-count it on
  // a quiet machine and fail on a busy one.
  const settled = await settle(document);

  const tucked = (el) => {
    for (let n = el; n; n = n.parentElement) {
      if (n.tagName === 'DETAILS' && !n.hasAttribute('open') && n !== el) return true;
      if (n.hasAttribute && n.hasAttribute('hidden')) return 'hidden';
    }
    return false;
  };

  const panels = [...document.querySelectorAll('section, .panel')].filter(
    (p, i, all) => !all.some((q) => q !== p && q.contains(p))
  );
  const rows = panels.map((p) => {
    const h = p.querySelector('h1, h2, h3');
    let shown = 0;
    let away = 0;
    for (const el of p.querySelectorAll('p, .panel-note, .note, .ctl-hint, li')) {
      if (el.parentElement && el.parentElement.closest('p, .panel-note, li') &&
          el.parentElement.closest('p, .panel-note, li') !== el) continue;
      const t = tucked(el);
      if (t === 'hidden') continue;
      if (t) away += words(el.textContent);
      else shown += words(el.textContent);
    }
    const r = prose(p);
    return {
      title: h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 50) : '(untitled)',
      hidden: !!tucked(p) || p.hasAttribute('hidden'),
      shown,
      away,
      rendered: r.shown,
      renderedAway: r.away,
      tables: p.querySelectorAll('table').length,
      controls: p.querySelectorAll('button, select, input').length,
    };
  });
  return { page, rows, settled };
}

/**
 * Poll until the rendered word count stops moving, then a little longer to be
 * sure. Returns how long it took, which is worth printing: a page that uses the
 * whole budget has not settled and its number is not trustworthy.
 */
async function settle(document) {
  const count = () => prose(document.body).shown;
  const STEP = 200, MIN = 1500, MAX = 25000, STABLE = 4;
  let waited = 0, last = -1, stable = 0;
  while (waited < MAX) {
    await new Promise((r) => setTimeout(r, STEP));
    waited += STEP;
    const n = count();
    if (n === last) stable += 1;
    else { stable = 0; last = n; }
    if (stable >= STABLE && waited >= MIN) return { ms: waited, settled: true };
  }
  return { ms: waited, settled: false };
}

if (process.argv[2] && process.argv[3] === '--child') {
  const out = await audit(process.argv[2]);
  emit(out, 0);
}

const self = fileURLToPath(import.meta.url);
const one = process.argv[2];
const pages = one ? [one] : PAGES;
let grandTags = 0;
let grandRendered = 0;
let pass = 0, fail = 0;

for (const page of pages) {
  const res = spawnSync(process.execPath, [self, page, '--child'], { encoding: 'utf8', cwd: path.dirname(self) });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    fail++;
    console.log(`FAIL ${page}: no result\n${(res.stderr || '').slice(0, 800)}`);
    continue;
  }
  const { rows, settled } = JSON.parse(line.slice(2));
  const visible = rows.filter((r) => !r.hidden);
  const tags = visible.reduce((a, r) => a + r.shown, 0);
  const rendered = visible.reduce((a, r) => a + r.rendered, 0);
  grandTags += tags;
  grandRendered += rendered;

  const cap = CEILINGS.pages[page];
  console.log(
    `\n${page} — ${rendered} words of prose on screen across ${visible.length} panels ` +
    `(the old tag count saw ${tags})` +
    (cap == null ? '' : `, ceiling ${cap}`) +
    (settled && settled.settled ? '' : `  [NOT SETTLED after ${settled ? settled.ms : '?'}ms]`)
  );
  for (const r of rows) {
    console.log(
      `  ${r.hidden ? '·' : ' '} ${String(r.rendered).padStart(5)} shown` +
      `${r.renderedAway ? ` ${String(r.renderedAway).padStart(5)} tucked` : '             '}` +
      `  ${String(r.shown).padStart(4)} by tag` +
      `  ${r.tables}t ${String(r.controls).padStart(2)}c  ${r.title}`
    );
  }

  // The gate. A page may lose words freely; growing past the ceiling is what
  // has to be a decision rather than a drift.
  if (!one) {
    if (!settled || !settled.settled) {
      fail++;
      console.log(`FAIL ${page} never settled, so its word count is not a measurement`);
    } else if (cap == null) {
      fail++;
      console.log(`FAIL ${page} has no ceiling in text-ceilings.json — add one`);
    } else if (rendered > cap) {
      fail++;
      console.log(
        `FAIL ${page} is over its prose ceiling: ${rendered} words on screen, ceiling ${cap} ` +
        `(+${rendered - cap}). Cut words, or ask Tim before raising the ceiling.`
      );
    } else {
      pass++;
    }
  }
}

if (!one) {
  console.log(`\nAll pages: ${grandRendered} words of prose on screen (the old tag count saw ${grandTags})`);
  const cap = CEILINGS.total;
  if (cap != null && grandRendered > cap) {
    fail++;
    console.log(`FAIL the site is over its total ceiling: ${grandRendered} words, ceiling ${cap}`);
  } else if (cap != null) {
    pass++;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
