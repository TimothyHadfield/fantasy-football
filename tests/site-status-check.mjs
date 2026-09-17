// js/site-status.js: the "Site updated" stamp, the newer-version bar, and the
// red strip for a page that broke.
//
// The script is a CLASSIC script, so it is run here the way a browser runs one:
// the shipped file, in a vm context, against a linkedom document. The window is
// a plain object this suite controls — linkedom's own window neither routes an
// element's error event to window listeners nor has location or fetch — so the
// listeners the script registers are recorded and called by hand, with events
// shaped like the ones a browser sends.
//
// One scenario runs it against linkedom's bare window as-is, because the other
// suites use exactly that and the script must not be what breaks them.

import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { repoFile } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const SOURCE = fs.readFileSync(repoFile('js/site-status.js'), 'utf8');

const PAGE = `<!doctype html><html><head><title>t</title></head>
<body><header class="site"><nav><a href="index.html">Home</a></nav></header><main>page</main></body></html>`;

// document.lastModified's format: local time, MM/DD/YYYY hh:mm:ss.
const PUBLISHED = '09/16/2026 18:52:07';
const PUBLISHED_DATE = new Date(PUBLISHED);
/** An HTTP date an hour after the page's own, whatever this machine's time zone. */
const LATER = new Date(PUBLISHED_DATE.getTime() + 3600e3).toUTCString();
const NO_STAMP = Symbol('no lastModified');

/**
 * Boot the script. Returns the document, the recorded listeners and timers,
 * and what fetch was asked for.
 */
function boot({
  href = 'https://timothyhadfield.github.io/fantasy-football/index.html',
  lastModified = PUBLISHED,
  readyState = 'complete',
  visibility = 'visible',
  fetchImpl,
} = {}) {
  const { document } = parseHTML(PAGE);
  const url = new URL(href);
  if (lastModified !== NO_STAMP) Object.defineProperty(document, 'lastModified', { value: lastModified });
  Object.defineProperty(document, 'readyState', { value: readyState, configurable: true });
  let vis = visibility;
  Object.defineProperty(document, 'visibilityState', { get: () => vis, configurable: true });

  const listeners = [];
  const timers = [];
  const fetches = [];
  let reloads = 0;
  const logs = [];

  const win = {
    document,
    location: { href: url.href, protocol: url.protocol, origin: url.origin, reload: () => { reloads++; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture: Boolean(capture) }),
    fetch: (u, init) => {
      fetches.push({ u, init });
      return fetchImpl ? fetchImpl(u, init) : Promise.reject(new Error('no fetch in this scenario'));
    },
  };
  const quiet = { log: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a), info: (...a) => logs.push(a), debug: (...a) => logs.push(a) };
  const context = vm.createContext({ window: win, console: quiet });
  vm.runInContext(SOURCE, context, { filename: 'site-status.js' });

  const fire = (type, event) => {
    for (const l of listeners.filter((x) => x.type === type)) l.fn(event);
  };
  const runTimers = () => { for (const t of timers.splice(0)) t.fn(); };
  const settle = () => new Promise((r) => setImmediate(r));
  const bars = (cls) => [...document.querySelectorAll(`.site-bar${cls ? '.' + cls : ''}`)];

  return {
    document, win, listeners, timers, fetches, logs, fire, runTimers, settle, bars,
    reloads: () => reloads,
    setVisible: (v) => { vis = v; },
    run: () => vm.runInContext(SOURCE, context, { filename: 'site-status.js' }),
  };
}

const headReply = (lastModified, { ok: good = true } = {}) => async () => ({
  ok: good,
  status: good ? 200 : 404,
  headers: { get: (h) => (h.toLowerCase() === 'last-modified' ? lastModified : null) },
});

// ---- 1. the stamp ----------------------------------------------------------
{
  const b = boot();
  const footers = b.document.querySelectorAll('footer.site-stamp');
  eq(footers.length, 1, 'one stamp footer');
  const f = footers[0];
  eq(f.textContent, 'Site updated 16 Sep 18:52', 'the stamp reads "Site updated d Mon HH:MM"');
  eq(b.document.body.lastElementChild, f, 'and it is the last thing in <body>');
  eq(f.querySelector('time').getAttribute('datetime'), PUBLISHED_DATE.toISOString(), 'with a machine-readable time');
  ok(b.document.querySelector('style[data-site-status]'), 'its styles are injected, not left to app.css');
  ok(/var\(--dim/.test(b.document.querySelector('style[data-site-status]').textContent), 'using the site’s own colour tokens');
  eq(b.logs.length, 0, 'and nothing is logged');

  // Loaded twice (a page that lists it twice) is still one of everything.
  b.run();
  eq(b.document.querySelectorAll('footer.site-stamp').length, 1, 'a second copy of the script adds no second stamp');
  eq(b.listeners.filter((l) => l.type === 'error').length, 1, 'nor a second error listener');
}
{
  const b = boot({ lastModified: '03/05/2026 07:04:00' });
  eq(b.document.querySelector('footer.site-stamp').textContent, 'Site updated 5 Mar 07:04', 'single-digit day, padded time');
}
for (const lm of [NO_STAMP, '', 'not a date']) {
  const b = boot({ lastModified: lm });
  eq(b.document.querySelectorAll('footer.site-stamp').length, 0, `no stamp when lastModified is ${String(lm === NO_STAMP ? 'absent' : JSON.stringify(lm))}`);
  b.runTimers();
  eq(b.fetches.length, 0, `and no check either (${lm === NO_STAMP ? 'absent' : JSON.stringify(lm)})`);
}

// ---- 2. the newer-version bar ------------------------------------------------
{
  // Newer live: one HEAD, uncached, to this page; the bar appears; Reload reloads.
  const b = boot({ fetchImpl: headReply(LATER) });
  eq(b.fetches.length, 0, 'nothing is fetched at load');
  eq(b.timers.length, 1, 'one timer is set');
  eq(b.timers[0].ms, 5000, 'for five seconds');
  b.runTimers();
  eq(b.fetches.length, 1, 'then exactly one request');
  eq(b.fetches[0].u, 'https://timothyhadfield.github.io/fantasy-football/index.html', 'of this page');
  eq(b.fetches[0].init.method, 'HEAD', 'as a HEAD');
  eq(b.fetches[0].init.cache, 'no-store', 'past the cache');
  await b.settle();
  const bars = b.bars('is-newer');
  eq(bars.length, 1, 'a newer copy shows the bar');
  ok(/A newer version of the site is live/.test(bars[0].textContent), 'saying so', bars[0].textContent);
  eq(b.document.body.firstElementChild, bars[0], 'at the top of the page');
  eq(b.bars('is-broken').length, 0, 'and it is not the error strip');
  bars[0].querySelector('button').click();
  eq(b.reloads(), 1, 'Reload reloads');
  b.runTimers();
  eq(b.fetches.length, 1, 'and it never asks again');
}
{
  // The same Last-Modified as the page, or an older one: silence.
  for (const lm of [
    new Date(PUBLISHED).toUTCString(),
    new Date(PUBLISHED_DATE.getTime() - 60000).toUTCString(),
    new Date(PUBLISHED_DATE.getTime() + 900).toUTCString(),   // same second
  ]) {
    const b = boot({ fetchImpl: headReply(lm) });
    b.runTimers();
    await b.settle();
    eq(b.bars().length, 0, `no bar when live is ${lm}`);
  }
}
{
  // Every way the check can fail is silent.
  const cases = [
    ['a rejected fetch', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a fetch that throws', () => { throw new Error('sync'); }],
    ['a 404', headReply(LATER, { ok: false })],
    ['no Last-Modified', headReply(null)],
    ['a garbage Last-Modified', headReply('yesterday-ish')],
    ['a non-promise', () => 42],
  ];
  for (const [why, impl] of cases) {
    const b = boot({ fetchImpl: impl });
    b.runTimers();
    await b.settle();
    eq(b.bars().length, 0, `silent on ${why}`);
    eq(b.logs.length, 0, `nothing logged on ${why}`);
  }
}
{
  // Hidden tab: no request until the reader comes back.
  const b = boot({ visibility: 'hidden', fetchImpl: headReply(LATER) });
  b.runTimers();
  eq(b.fetches.length, 0, 'a hidden tab is not checked');
  // linkedom documents do dispatch their own events.
  b.document.dispatchEvent(new b.document.defaultView.Event('visibilitychange'));
  eq(b.fetches.length, 0, 'a visibility change that is still hidden does nothing');
  b.setVisible('visible');
  b.document.dispatchEvent(new b.document.defaultView.Event('visibilitychange'));
  eq(b.fetches.length, 1, 'coming back to the tab checks once');
  b.document.dispatchEvent(new b.document.defaultView.Event('visibilitychange'));
  eq(b.fetches.length, 1, 'and only once');
  await b.settle();
  eq(b.bars('is-newer').length, 1, 'and shows the bar');
}
{
  // Not yet loaded: the timer waits for the load event.
  const b = boot({ readyState: 'interactive', fetchImpl: headReply(null) });
  eq(b.timers.length, 0, 'no timer before load');
  b.fire('load', {});
  eq(b.timers.length, 1, 'the timer starts on load');
}
for (const href of ['file:///C:/site/index.html', 'about:blank']) {
  const b = boot({ href, fetchImpl: headReply(LATER) });
  b.fire('load', {});
  b.runTimers();
  eq(b.fetches.length, 0, `never checks on ${href}`);
  eq(b.document.querySelectorAll('footer.site-stamp').length, 1, `but still stamps on ${href}`);
}

// ---- 3. the error strip ------------------------------------------------------
{
  const b = boot();
  const errorL = b.listeners.find((l) => l.type === 'error');
  ok(errorL && errorL.capture, 'the error listener is on the capture phase (resource errors do not bubble)');
  ok(b.listeners.some((l) => l.type === 'unhandledrejection'), 'unhandled rejections are listened for');
  eq(b.bars().length, 0, 'no strip on a healthy page');

  // A module script that failed to load.
  const script = b.document.createElement('script');
  script.setAttribute('type', 'module');
  script.setAttribute('src', 'js/trade-page.js');
  b.document.head.appendChild(script);
  b.fire('error', { target: script });
  let strips = b.bars('is-broken');
  eq(strips.length, 1, 'a failed module load shows the strip');
  ok(/Part of this page failed to load/.test(strips[0].textContent), 'saying so');
  eq(strips[0].getAttribute('role'), 'alert', 'as an alert');
  const details = strips[0].querySelector('details');
  ok(details, 'the specifics are in a <details>');
  ok(/trade-page\.js/.test(details.textContent), 'naming the file', details.textContent);
  eq(b.document.body.firstElementChild, strips[0], 'at the top of the page');

  // An uncaught error, then a rejection: still ONE strip, now three entries.
  b.fire('error', { target: b.win, message: 'Uncaught TypeError: x is undefined', filename: 'https://timothyhadfield.github.io/fantasy-football/js/stats.js', lineno: 42, error: new TypeError('x') });
  b.fire('unhandledrejection', { reason: new Error('ESPN said no') });
  strips = b.bars('is-broken');
  eq(strips.length, 1, 'several failures share one strip');
  const items = [...strips[0].querySelectorAll('li')].map((li) => li.textContent);
  eq(items.length, 3, 'one line per failure');
  ok(/x is undefined \(stats\.js:42\)/.test(items[1]), 'an uncaught error names its file and line', items[1]);
  eq(items[2], 'ESPN said no', 'a rejection gives its message');

  strips[0].querySelector('button').click();
  eq(b.reloads(), 1, 'the strip’s Reload reloads');

  // It stops listing after a handful.
  for (let i = 0; i < 20; i++) b.fire('unhandledrejection', { reason: 'r' + i });
  const n = b.bars('is-broken')[0].querySelectorAll('li').length;
  eq(n, 6, 'the list is capped (five, then "And more.")');
  eq(b.logs.length, 0, 'and nothing was logged throughout');
}
{
  // Resource errors that are not scripts do not break a page.
  const b = boot();
  const img = b.document.createElement('img');
  img.setAttribute('src', 'https://a.espncdn.com/headshot.png');
  b.fire('error', { target: img });
  const link = b.document.createElement('link');
  b.fire('error', { target: link });
  eq(b.bars().length, 0, 'a missing headshot or link is not a broken page');
}

// ---- 3b. what is filtered out ------------------------------------------------
{
  const noise = [
    ['error', { target: null, message: 'Uncaught Error: boom', filename: 'chrome-extension://abcdef/content.js', lineno: 1 }, 'a Chrome extension’s error'],
    ['error', { message: 'boom', filename: 'moz-extension://1234-5678/inject.js' }, 'a Firefox extension’s error'],
    ['error', { message: 'boom', filename: 'safari-web-extension://x/y.js' }, 'a Safari extension’s error'],
    ['error', { message: 'boom', filename: '', error: Object.assign(new Error('boom'), { stack: 'Error: boom\n    at chrome-extension://abc/x.js:1:1' }) }, 'an error whose stack is an extension’s'],
    ['error', { message: 'ResizeObserver loop completed with undelivered notifications.' }, 'the ResizeObserver loop notice'],
    ['error', { message: 'ResizeObserver loop limit exceeded' }, 'the older ResizeObserver wording'],
    ['error', { message: 'Script error.', filename: '' }, 'an opaque cross-origin "Script error."'],
    ['unhandledrejection', { reason: Object.assign(new Error('x'), { stack: 'Error: x\n    at moz-extension://abc/bg.js:2:3' }) }, 'a rejection from an extension'],
    ['unhandledrejection', { reason: Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }) }, 'an aborted request'],
  ];
  for (const [type, event, why] of noise) {
    const b = boot();
    b.fire(type, event);
    eq(b.bars().length, 0, `ignored: ${why}`);
  }
  {
    const b = boot();
    const s = b.document.createElement('script');
    s.setAttribute('src', 'chrome-extension://abc/injected.js');
    b.fire('error', { target: s });
    eq(b.bars().length, 0, 'ignored: a script an extension injected that failed to load');
  }
  {
    // A reporter that is handed garbage must not itself throw.
    const b = boot();
    let threw = false;
    try {
      b.fire('error', undefined);
      b.fire('error', { get target() { throw new Error('hostile'); } });
      b.fire('unhandledrejection', undefined);
      b.fire('unhandledrejection', { reason: null });
    } catch { threw = true; }
    ok(!threw, 'odd events never throw out of the handlers');
  }
}

// ---- 4. linkedom's bare window, as the other suites use it --------------------
{
  const { window, document } = parseHTML(PAGE);
  let threw = null;
  try {
    const context = vm.createContext({ window, console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(SOURCE, context, { filename: 'site-status.js' });
  } catch (err) { threw = err; }
  eq(threw, null, 'runs against a bare linkedom window without throwing');
  eq(document.querySelectorAll('.site-bar').length, 0, 'and shows nothing there');
}
{
  // No window at all (a worker, a Node import): nothing happens.
  let threw = null;
  try { vm.runInContext(SOURCE, vm.createContext({}), { filename: 'site-status.js' }); } catch (err) { threw = err; }
  eq(threw, null, 'runs with no window at all');
}
{
  // It must stay a classic script: no import/export, no top-level await.
  ok(!/^\s*(import|export)\b/m.test(SOURCE), 'no import or export statements');
  ok(!/\bconsole\./.test(SOURCE.replace(/\/\/.*$/gm, '')), 'no console calls');
  const fetchCalls = SOURCE.replace(/\/\/.*$/gm, '').match(/\bfetch\s*\(/g) || [];
  eq(fetchCalls.length, 1, 'exactly one fetch in the source');
}

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
