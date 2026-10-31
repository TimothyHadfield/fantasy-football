// The site's half of the one write: bridge.canSetLineup() and bridge.setLineup().
//
//   node test-bridge-lineup.mjs
//
// Tim, 2026-10-11: "make it so you just have to click a button to automatically
// change it for your team" — "Yes, lineup only".
//
// The extension decides everything (tests/test-lineup-guard.mjs). What is
// proved here is the page's side of the bargain: the two calls NEVER REJECT,
// `canSetLineup` is true in exactly one situation, and whatever the extension —
// or the lack of one — says comes back as {ok} or {ok:false, reason}.
//
// js/bridge.js keeps its state in the module, so each situation below imports
// its OWN copy of it (a query string makes a fresh module) against its own
// window, the way a page load would.

import { moduleUrl } from './repo.mjs';

let pass = 0;
let fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg,
  `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const CALL = {
  leagueId: 476225250, season: '2026', week: '5', teamId: '4',
  moves: [
    { playerId: '400001', fromSlotId: 20, toSlotId: '2' },
    { playerId: 400000, fromSlotId: 2, toSlotId: 20 },
  ],
};

let n = 0;
/**
 * A page with (or without) an extension behind it.
 *
 * @param extension null for none; otherwise { version, answer(request) } where
 *                  answer returns the reply, or undefined to stay silent.
 */
async function page(extension) {
  const listeners = [];
  const asked = [];
  const win = {
    location: { origin: 'https://timothyhadfield.github.io' },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    postMessage: (data) => {
      setTimeout(() => { for (const fn of listeners.slice()) fn({ source: win, data }); }, 0);
    },
  };
  globalThis.window = win;

  if (extension) {
    // content-site.js: forward what the page posts, post back what comes of it.
    listeners.push((event) => {
      const msg = event.data;
      if (!msg || msg.source !== 'ff-site') return;
      asked.push(msg.request);
      const reply = extension.answer(msg.request);
      if (reply === undefined) return;
      win.postMessage({ ...reply, source: 'ff-ext', id: msg.id });
    });
  }

  const bridge = await import(moduleUrl('js/bridge.js') + `?page=${++n}`);
  if (extension) win.postMessage({ source: 'ff-ext', type: 'HELLO', version: extension.version });
  return { bridge, asked };
}

/** The 0.4.0 extension, as background.js answers. */
const current = ({ allowed, set }) => ({
  version: '0.4.0',
  answer: (req) => {
    if (req.type === 'CAN_SET_LINEUP') return { ok: true, data: { allowed } };
    if (req.type === 'SET_LINEUP') return set;
    return { ok: false, error: `Unknown request "${req.type}".` };
  },
});

// ---- no extension at all (a phone) ----------------------------------------
{
  const { bridge, asked } = await page(null);
  const t0 = Date.now();
  same(await bridge.canSetLineup(), false, 'no extension: canSetLineup is false');
  ok(Date.now() - t0 < 1500, 'and says so within the hello wait, not after a request timeout', `${Date.now() - t0}ms`);
  same(await bridge.setLineup(CALL), { ok: false, reason: 'no-extension' }, 'no extension: setLineup → no-extension');
  same(asked.length, 0, 'and nothing was posted');
}

// ---- an extension from before the switch existed ---------------------------
{
  const { bridge, asked } = await page({
    version: '0.3.3',
    answer: (req) => (req.type === 'PING'
      ? { ok: true, data: { version: '0.3.3' } }
      : { ok: false, error: `Unknown request "${req.type}".` }),
  });
  same(await bridge.canSetLineup(), false, 'an old extension: canSetLineup is false');
  same(await bridge.setLineup(CALL), { ok: false, reason: 'old-extension' }, 'an old extension: setLineup → old-extension');
  ok(asked.some((r) => r.type === 'CAN_SET_LINEUP'), 'it was asked, and did not know the question');
}

// ---- the switch off -------------------------------------------------------
{
  const { bridge } = await page(current({ allowed: false, set: { ok: false, reason: 'off' } }));
  same(await bridge.canSetLineup(), false, 'the switch off: canSetLineup is false');
  same(await bridge.setLineup(CALL), { ok: false, reason: 'off' }, 'the switch off: setLineup → off');
}

// ---- the switch on --------------------------------------------------------
{
  const { bridge, asked } = await page(current({ allowed: true, set: { ok: true } }));
  same(await bridge.canSetLineup(), true, 'the switch on, on the live site: canSetLineup is true');
  same(await bridge.setLineup(CALL), { ok: true }, 'and a change the extension made comes back {ok:true}');

  const sent = asked.find((r) => r.type === 'SET_LINEUP');
  same(sent, {
    type: 'SET_LINEUP',
    leagueId: '476225250',
    season: 2026,
    week: 5,
    teamId: 4,
    moves: [
      { type: 'LINEUP', playerId: 400001, fromSlotId: 20, toSlotId: 2 },
      { type: 'LINEUP', playerId: 400000, fromSlotId: 2, toSlotId: 20 },
    ],
  }, 'the request is the one the extension expects: numbers as numbers, every move a LINEUP move');
  same(asked.filter((r) => r.type === 'SET_LINEUP').length, 1, 'and it was sent once');
}

// ---- a whole-lineup re-sort carries `full: true`, and only then (2026-10-31) --
{
  const { bridge, asked } = await page(current({ allowed: true, set: { ok: true } }));
  same(await bridge.setLineup({ ...CALL, full: true }), { ok: true }, 'full: a re-sort comes back {ok:true}');
  const sent = asked.filter((r) => r.type === 'SET_LINEUP');
  same(sent.length, 1, 'full: sent once');
  same(sent[0].full, true, 'full: the request is marked full');
  for (const full of [false, 'true', 1, undefined]) {
    await bridge.setLineup({ ...CALL, full });
  }
  const rest = asked.filter((r) => r.type === 'SET_LINEUP').slice(1);
  same(rest.length, 4, 'four more requests sent');
  same(rest.filter((r) => 'full' in r).length, 0, 'anything but true sends no `full` at all');
}

// ---- a page the extension will not write for (localhost) -------------------
{
  const { bridge } = await page(current({ allowed: false, set: { ok: false, reason: 'origin' } }));
  same(await bridge.canSetLineup(), false, 'the wrong origin: canSetLineup is false');
  same(await bridge.setLineup(CALL), { ok: false, reason: 'origin' }, 'the wrong origin: setLineup → origin');
}
{
  // The worker's general gate answers with a sentence and no reason.
  const { bridge } = await page({
    version: '0.4.0',
    answer: () => ({ ok: false, error: 'This page is not allowed to use the bridge.' }),
  });
  same(await bridge.canSetLineup(), false, 'a page the bridge will not talk to: canSetLineup is false');
  same(await bridge.setLineup(CALL), { ok: false, reason: 'origin' }, 'and setLineup → origin');
}

// ---- every refusal the extension gives comes through as it is --------------
for (const reason of ['not-your-team', 'stale', 'locked', 'busy', 'signed-out', 'not-lineup', 'too-many', 'espn-409', 'timeout', 'network']) {
  const { bridge } = await page(current({ allowed: true, set: { ok: false, reason } }));
  same(await bridge.setLineup(CALL), { ok: false, reason }, `the extension’s "${reason}" reaches the page unchanged`);
}

// ---- "true" means true ----------------------------------------------------
for (const [reply, why] of [
  [{ ok: true, data: { allowed: 'yes' } }, 'allowed as text'],
  [{ ok: true, data: { allowed: 1 } }, 'allowed as 1'],
  [{ ok: true, data: {} }, 'no allowed at all'],
  [{ ok: true }, 'no data'],
  [{ ok: false, data: { allowed: true } }, 'a failed reply that says allowed'],
  [{ ok: 'true', data: { allowed: true } }, 'ok as text'],
]) {
  const { bridge } = await page({ version: '0.4.0', answer: () => reply });
  same(await bridge.canSetLineup(), false, `canSetLineup is false for ${why}`);
}
{
  const { bridge } = await page({ version: '0.4.0', answer: () => ({ ok: 'true' }) });
  const res = await bridge.setLineup(CALL);
  ok(res.ok === false, 'setLineup is not ok unless the extension said exactly ok:true', JSON.stringify(res));
}
{
  // ok:true must not carry anything else back to the page.
  const { bridge } = await page(current({ allowed: true, set: { ok: true, data: { memberId: '{X}' }, reason: 'off' } }));
  same(await bridge.setLineup(CALL), { ok: true }, 'a success is {ok:true} and nothing else');
}

// ---- silence --------------------------------------------------------------
{
  const { bridge } = await page({
    version: '0.4.0',
    answer: (req) => (req.type === 'SET_LINEUP' || req.type === 'CAN_SET_LINEUP' ? undefined : { ok: true }),
  });
  same(await bridge.setLineup({ ...CALL, timeoutMs: 60 }), { ok: false, reason: 'timeout' },
    'an extension that never answers a write → timeout (not known, so never sent again)');
  const t0 = Date.now();
  same(await bridge.canSetLineup(), false, 'an extension that never answers the question: false');
  ok(Date.now() - t0 < 2500, 'on the short clock', `${Date.now() - t0}ms`);
}

// ---- never rejects, whatever it is handed ----------------------------------
{
  const { bridge, asked } = await page(current({ allowed: true, set: { ok: false, reason: 'bad-request' } }));
  for (const [args, why] of [
    [undefined, 'no argument'],
    [{}, 'an empty object'],
    [{ ...CALL, moves: 'swap' }, 'moves that are not a list'],
    [{ ...CALL, moves: [null, 7, 'x'] }, 'moves that are not objects'],
    [{ ...CALL, leagueId: undefined, teamId: {} }, 'ids that are not ids'],
  ]) {
    const res = await bridge.setLineup(args).then((r) => r, (e) => `REJECTED: ${e && e.message}`);
    same(res, { ok: false, reason: 'bad-request' }, `setLineup with ${why} resolves, to the extension’s refusal`);
  }
  ok(asked.filter((r) => r.type === 'SET_LINEUP').every((r) => Array.isArray(r.moves)),
    'and what it posted always had a list of moves for the extension to judge');
}
{
  // A window that throws on postMessage: still a resolved answer.
  const { bridge } = await page(current({ allowed: true, set: { ok: true } }));
  await bridge.canSetLineup();
  globalThis.window.postMessage = () => { throw new Error('detached'); };
  const res = await bridge.setLineup(CALL).then((r) => r, (e) => `REJECTED: ${e && e.message}`);
  same(res, { ok: false, reason: 'no-extension' }, 'a page that cannot post resolves to no-extension');
  const can = await bridge.canSetLineup().then((r) => r, (e) => `REJECTED: ${e && e.message}`);
  same(can, false, 'and canSetLineup resolves to false');
}

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
