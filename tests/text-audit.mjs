// How wordy is each page? Not a suite — a measuring tool.
//
//   node text-audit.mjs            every page, a summary per panel
//   node text-audit.mjs trade.html one page
//
// Boots each page's real HTML and modules on demo data (the same harness as
// test-pages-render.mjs) and counts the PROSE a reader is shown: paragraphs,
// panel notes and similar — not table cells, which are data. Text inside a
// closed <details> is counted separately, as "tucked away", since a reader
// only sees it on asking.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO } from './repo.mjs';

const PAGES = [
  'index.html', 'stats.html', 'analysis.html', 'schedule.html',
  'waivers.html', 'trade.html', 'summary.html',
];

const words = (s) => (String(s || '').trim().match(/\S+/g) || []).length;

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
  await new Promise((r) => setTimeout(r, 1500));

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
    return {
      title: h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 50) : '(untitled)',
      hidden: !!tucked(p) || p.hasAttribute('hidden'),
      shown,
      away,
      tables: p.querySelectorAll('table').length,
      controls: p.querySelectorAll('button, select, input').length,
    };
  });
  return { page, rows };
}

if (process.argv[2] && process.argv[3] === '--child') {
  const out = await audit(process.argv[2]);
  console.log('@@' + JSON.stringify(out));
  process.exit(0);
}

const self = fileURLToPath(import.meta.url);
const pages = process.argv[2] ? [process.argv[2]] : PAGES;
let grand = 0;
for (const page of pages) {
  const res = spawnSync(process.execPath, [self, page, '--child'], { encoding: 'utf8', cwd: path.dirname(self) });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) { console.log(`${page}: no result\n${(res.stderr || '').slice(0, 400)}`); continue; }
  const { rows } = JSON.parse(line.slice(2));
  const visible = rows.filter((r) => !r.hidden);
  const total = visible.reduce((a, r) => a + r.shown, 0);
  grand += total;
  console.log(`\n${page} — ${total} words of prose shown across ${visible.length} panels`);
  for (const r of rows) {
    console.log(
      `  ${r.hidden ? '·' : ' '} ${String(r.shown).padStart(5)} shown` +
      `${r.away ? ` ${String(r.away).padStart(5)} tucked` : '             '}` +
      `  ${r.tables}t ${String(r.controls).padStart(2)}c  ${r.title}`
    );
  }
}
if (pages.length > 1) console.log(`\nAll pages: ${grand} words of prose shown`);
