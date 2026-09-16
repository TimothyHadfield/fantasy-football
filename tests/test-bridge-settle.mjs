// The extension's hello arrives AFTER a page module's first ESPN read.
//
//   node test-bridge-settle.mjs
//
// Tim, 2026-09-16: a trade's total included week 1, which had been played. The
// cause was a race, not arithmetic. The content script says hello at
// document_start (before any page module is listening) and again at
// DOMContentLoaded (queued behind the module scripts). The Trade page reads the
// schedule at top level, so `bridge.isAvailable()` was still false, the read
// went DIRECT to ESPN, a private league refused it, and the page — told
// nothing about played weeks — priced every one of them.
//
// This reproduces exactly that order: a window whose hello is posted a tick
// AFTER the first read starts. With `bridge.settled()` in the transport the
// read goes through the bridge; without it, it goes direct.

import { moduleUrl } from './repo.mjs';

let pass = 0;
let fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};

// A window just big enough for bridge.js: postMessage and message listeners.
const listeners = [];
const win = {
  location: { origin: 'https://timothyhadfield.github.io' },
  addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
  postMessage: (data) => {
    setTimeout(() => { for (const fn of listeners) fn({ source: win, data }); }, 0);
  },
};
globalThis.window = win;

// The "extension": answers LEAGUE requests posted by the page.
const bridgeCalls = [];
listeners.push((event) => {
  const msg = event.data;
  if (!msg || msg.source !== 'ff-site') return;
  bridgeCalls.push(msg.request.type);
  setTimeout(() => {
    for (const fn of listeners) {
      fn({ source: win, data: { source: 'ff-ext', id: msg.id, ok: true, data: { schedule: [], teams: [] } } });
    }
  }, 0);
});

// Direct ESPN: a private league refuses.
const directCalls = [];
globalThis.fetch = async (url) => {
  directCalls.push(String(url));
  return { ok: false, status: 401, headers: { get: () => 'application/json' }, json: async () => ({}) };
};

const bridge = await import(moduleUrl('js/bridge.js'));
const espn = await import(moduleUrl('js/espn.js'));
espn.configure({ leagueId: '476225250', season: 2026 });

ok(!bridge.isAvailable(), 'the extension has not said hello when the page starts reading');

// The page's first read starts NOW; the hello lands a tick later, as it does in
// Edge (DOMContentLoaded, queued behind the module scripts).
const read = espn.fetchMatchups().then(() => 'ok', (e) => `threw: ${e.message}`);
win.postMessage({ source: 'ff-ext', type: 'HELLO', version: '0.3.2' });
const outcome = await read;

ok(outcome === 'ok', 'the first read succeeds', outcome);
ok(bridgeCalls.includes('LEAGUE'), 'and went through the extension', JSON.stringify(bridgeCalls));
ok(directCalls.length === 0, 'and never went direct to ESPN, which refuses a private league',
  directCalls.join(' | '));
ok(bridge.extensionVersion() === '0.3.2', 'the hello carried the version the Trade page checks');

// Without an extension at all, the wait is bounded and happens once.
{
  const t0 = Date.now();
  const again = await bridge.settled();
  ok(again === true, 'once detected, settled() answers at once', String(again));
  ok(Date.now() - t0 < 50, 'without waiting', `${Date.now() - t0}ms`);
}

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
