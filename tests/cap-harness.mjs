// A page boot for test-capture.mjs and cross-sim-check.mjs.
//
// The same shims every page suite here installs (see README.md, "Two linkedom
// gotchas"), plus two things those suites need and the others do not:
//
//   - a localStorage whose backing Map is handed back, so a child can read
//     what the time machine wrote;
//   - optionally, THE BRIDGE EXTENSION, simulated at its own seam: the page's
//     window answers `postMessage` the way the extension does, so
//     js/bridge.js's `isAvailable()` and js/connection.js's probe are the real
//     code. Same technique as test-cloud-wiring.mjs.
//
// `fetch` records and throws, so a real network call is visible and never
// succeeds.

import { parseHTML } from 'linkedom';

export const LEAGUE = '99';
export const SEASON = 2026;

export function bootDom({ html, store = {}, bridge = false, teams = [] }) {
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

  window.location = {
    href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:',
    host: 'localhost', hostname: 'localhost', pathname: '/', search: '', hash: '',
  };
  globalThis.location = window.location;

  const bridgeCalls = [];
  if (bridge) {
    window.postMessage = (msg) => {
      if (!msg || msg.source !== 'ff-site') return;
      const req = msg.request || {};
      bridgeCalls.push(req.type);
      let data = null;
      if (req.type === 'PING') data = { version: 'test' };
      else if (req.type === 'GET_CONFIG') data = { leagueId: LEAGUE };
      else if (req.type === 'PROBE') {
        data = { leagueId: LEAGUE, season: SEASON, name: 'Capture Stub League', teamCount: teams.length, teams };
      }
      queueMicrotask(() => {
        const ev = new window.Event('message');
        ev.data = { source: 'ff-ext', id: msg.id, ok: true, data };
        ev.source = window;
        window.dispatchEvent(ev);
      });
    };
  } else {
    window.postMessage = () => {};
  }

  const map = new Map(Object.entries(store).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const localStorage = {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
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
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;

  return { window, document, map, fetchCalls, bridgeCalls };
}

/** Poll until `fn()` is truthy or `ms` passes. Resolves to the last value. */
export async function waitFor(fn, ms = 10000, step = 25) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

/** A reading with the one field that legitimately differs taken out. */
export function comparable(snap) {
  if (!snap) return null;
  const { takenAt, ...rest } = snap;
  return JSON.stringify(rest);
}
