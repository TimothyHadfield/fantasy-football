// The main menu, signed in: leagues.html + js/leagues-page.js with the REAL
// js/leagues.js and the real js/cloud.js behind a fake transport.
//
//   node menu-account-check.mjs
//
// Tim, 2026-10-10: "add different leagues to their account" and "Anyone can
// sign up". What is tested is what a person meets: a sign-in control in the
// header, a second device that shows the account's leagues without being told,
// a removed league that stays removed — and the price, which has to stay
// small on a free project: AT MOST ONE READ when the menu loads and ONE WRITE
// when the list changed. tests/leagues-check.mjs is the same page signed out,
// against a stub; tests/test-accounts.mjs is the merge and the document.
//
// A page module boots once per process, so each scenario is a child. `fetch`
// throws: every league here has its seasons already, so the page has no
// reason to ask ESPN anything.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { emit } from './emit.mjs';

const PAGE = 'leagues.html';
const SCENARIOS = ['signed-out', 'phone', 'laptop', 'removed', 'sign-in', 'owner', 'unread'];

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const FRIEND = { uid: 'uid-friend', email: 'friend@example.com', name: 'A Friend' };
const LIST = 'users/uid-friend/menu/leagues';
const A = '476225250';
const B = '1241838';
const NOW = 2026;

/** The six transport methods. `user` may arrive late, or only on a sign-in click. */
function makeFake({ user = FRIEND, arrivesAfter = 20, signedIn = true, failReads = false } = {}) {
  const docs = new Map();
  const log = { reads: [], writes: [], signIns: 0 };
  const listeners = [];
  let here = null;
  return {
    docs, log,
    async signIn() { log.signIns++; here = user; return user; },
    async signOut() { here = null; },
    currentUser() { return here; },
    onAuth(cb) {
      listeners.push(cb);
      setTimeout(() => { if (signedIn) here = user; cb(here); }, arrivesAfter);
      return () => {};
    },
    async getDoc(p) {
      log.reads.push(p);
      if (failReads) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
      const raw = docs.get(p);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async setDoc(p, data) { log.writes.push(p); docs.set(p, JSON.stringify(data)); },
  };
}

/** A packed document, as js/cloud.js writes one. */
const packed = (body) => {
  const json = JSON.stringify(body);
  return JSON.stringify({ v: 1, kind: 'menu', id: 'leagues', syncedAt: '2026-10-09T12:00:00.000Z', chars: json.length, json: [json] });
};
const bodyOf = (fake, p) => { const raw = fake.docs.get(p); return raw ? JSON.parse(JSON.parse(raw).json.join('')) : null; };
const acctEntry = (leagueId, over = {}) => ({
  leagueId, name: `League ${leagueId}`, teamCount: 10, seasons: [NOW, NOW - 1], teams: {}, teamAt: {}, infoAt: 0, addedAt: 1000, ...over,
});
const stored = (leagueId, over = {}) => ({
  leagueId, name: `League ${leagueId}`, teamCount: 10, seasons: [NOW, NOW - 1], teams: {}, lastOpened: null, addedAt: 1000, ...over,
});

async function boot({ fake, storage = {} }) {
  const html = readFileSync(path.join(REPO, PAGE), 'utf8');
  const { window, document } = parseHTML(html);
  const fetches = [];
  window.location = {
    href: `http://localhost/${PAGE}`, origin: 'http://localhost', protocol: 'http:',
    host: 'localhost', hostname: 'localhost', pathname: `/${PAGE}`, search: '', hash: '', assign() {},
  };
  window.postMessage = () => {};
  const map = new Map(Object.entries(storage).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const localStorage = {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  Object.assign(globalThis, {
    window, document, localStorage, location: window.location,
    fetch: async (u) => { fetches.push(String(u)); throw new Error(`the menu asked the network: ${u}`); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  process.on('unhandledRejection', (r) => errors.push(String((r && r.stack) || r)));

  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ transport: fake, ownerUid: 'uid-tim' });
  const srcs = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of srcs) await import(moduleUrl(src));
  await tick(120);
  console.error = origError;

  const fire = (el, type) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  };
  return {
    document, map, fetches, errors, fire, cloud,
    ids: () => [...document.querySelectorAll('#lgList > li')].map((li) => li.getAttribute('data-league')).sort(),
    row: (id) => document.querySelector(`#lgList > li[data-league="${id}"]`),
    account: () => text(document.getElementById('lgAccount')),
    json: (k) => (map.has(k) ? JSON.parse(map.get(k)) : null),
  };
}

// ---------------------------------------------------------------- child mode
if (process.argv[2]) {
  const scenario = process.argv[2];
  const results = [];
  const ok = (pass, msg, extra = '') => results.push({ pass: Boolean(pass), msg, extra: pass ? '' : String(extra).slice(0, 400) });
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  try {
    if (scenario === 'signed-out') {
      const fake = makeFake({ signedIn: false });
      fake.docs.set(LIST, packed({ v: 1, leagues: [acctEntry(B)], removed: {} }));
      const p = await boot({ fake, storage: { 'ff.leagues': { v: 1, leagues: [stored(A)], removed: [], probe: null, source: null } } });
      const before = p.map.get('ff.leagues');
      eq(p.ids(), [A], 'signed out, the menu is this device’s list and nothing else');
      const b = p.document.getElementById('lgSignIn');
      eq([b && b.tagName, text(b)], ['BUTTON', 'Sign in with Google'], 'with the connection bar’s own "Sign in with Google" in the header');
      ok(b && b.closest('header.site') && !p.document.getElementById('lgSignOut'), 'in the header, and no Sign out');
      eq([fake.log.reads, fake.log.writes, fake.log.signIns], [[], [], 0], 'NOTHING IS READ OR WRITTEN, and no sign-in window is opened by itself');
      eq(p.map.get('ff.leagues'), before, 'the stored list is untouched');
      eq([p.fetches, p.errors], [[], []], 'no network, no error');
    }

    if (scenario === 'phone') {
      // A second device: nothing saved here, the account has two leagues.
      const fake = makeFake();
      fake.docs.set(LIST, packed({
        v: 1,
        leagues: [
          acctEntry(A, { name: 'The Keeper League', seasons: [NOW, NOW - 1, NOW - 2], teams: { [NOW]: { id: 7, name: 'Team Seven' } }, teamAt: { [NOW]: 5000 } }),
          acctEntry(B, { name: 'Work League', teamCount: 12, addedAt: 2000 }),
        ],
        removed: {},
      }));
      const p = await boot({ fake });
      eq(p.ids(), [B, A].sort(), 'A DEVICE THAT WAS NEVER TOLD SHOWS THE ACCOUNT’S LEAGUES');
      eq([text(p.row(A).querySelector('.lg-name')), text(p.row(A).querySelector('.lg-meta'))], ['The Keeper League', '10 teams · You are Team Seven'],
        'by name, with the team that account chose');
      eq([...p.row(A).querySelectorAll('.lg-seasons button')].map(text), [String(NOW), String(NOW - 1), String(NOW - 2)], 'and every season');
      eq(fake.log.reads, [LIST], 'FOR ONE READ: users/{uid}/menu/leagues');
      eq(fake.log.writes, [], 'and no write, the account’s list being what it already was');
      eq(p.account(), 'Signed in as friend@example.com.Sign out', 'the header says who is signed in, and offers Sign out');
      ok(!p.document.getElementById('lgSignIn'), 'and no longer offers to sign in');
      eq(p.document.querySelectorAll('[title]').length, 0, 'nothing carries a `title`');
      eq([p.map.has('ff.connection'), p.fetches, p.errors], [false, [], []], 'no league was opened by it, ESPN was asked nothing, nothing thrown');

      // Coming back to the page costs nothing more.
      p.fire(globalThis.window, 'focus');
      p.fire(globalThis.window, 'pageshow');
      await tick(60);
      eq([fake.log.reads.length, fake.log.writes.length], [1, 0], 'coming back to the tab reads and writes nothing more');
    }

    if (scenario === 'laptop') {
      // The device has a league; the account has never had a list.
      const fake = makeFake();
      const p = await boot({ fake, storage: { 'ff.leagues': { v: 1, leagues: [stored(A, { name: 'The Keeper League', teams: { [NOW]: { id: 7, name: 'Team Seven' } }, teamAt: { [NOW]: 5000 } })], removed: [], probe: null, source: null } } });
      eq([fake.log.reads, fake.log.writes], [[LIST], [LIST]], 'a device’s league goes to an account that had none: one read, ONE WRITE');
      const up = bodyOf(fake, LIST) || { leagues: [] };
      eq([up.leagues.map((l) => l.leagueId), up.leagues[0] && up.leagues[0].teams[NOW], up.leagues[0] && up.leagues[0].seasons],
        [[A], { id: 7, name: 'Team Seven' }, [NOW, NOW - 1]], 'the league, its "You are" and its seasons are on the account');
      const doc = JSON.parse(fake.docs.get(LIST) || '{}');
      ok(doc.v === 1 && typeof doc.kind === 'string' && Array.isArray(doc.json) && Object.keys(doc).length <= 16, 'as a packed document, which is what the rules let an account write', JSON.stringify(Object.keys(doc)));

      // Removing it: one more write, and the account knows it was removed.
      p.fire(p.row(A).querySelector('.lg-remove'), 'click');
      p.fire(p.row(A).querySelector('.lg-yes'), 'click');
      await tick(60);
      eq(p.ids(), [], 'Remove takes it off the list');
      eq(fake.log.writes, [LIST, LIST], 'for one more write');
      const after = bodyOf(fake, LIST) || { leagues: [null], removed: {} };
      eq([after.leagues, Object.keys(after.removed)], [[], [A]], 'the account’s list no longer has it, and notes it as removed');
      eq(fake.log.reads, [LIST], 'and the account’s list was never read again');
      eq([p.fetches, p.errors], [[], []], 'no network, no error');
    }

    if (scenario === 'removed') {
      // Removed on this device; the account still lists it.
      const fake = makeFake();
      fake.docs.set(LIST, packed({ v: 1, leagues: [acctEntry(A), acctEntry(B)], removed: {} }));
      const p = await boot({
        fake,
        storage: {
          'ff.leagues': { v: 1, leagues: [stored(B)], removed: [A], removedAt: { [A]: 5000 }, probe: null, source: null },
          [`ff.weeks.1.${A}.${NOW}.4`]: 'a saved week',
        },
      });
      eq(p.ids(), [B], 'A LEAGUE REMOVED HERE IS NOT BROUGHT BACK BY THE ACCOUNT’S LIST');
      eq((p.json('ff.leagues') || {}).removed, [A], 'it is still noted as removed on this device');
      const up = bodyOf(fake, LIST) || { leagues: [], removed: {} };
      eq([up.leagues.map((l) => l.leagueId), up.removed], [[B], { [A]: 5000 }], 'and the account is told, in one write');
      eq([fake.log.reads, fake.log.writes], [[LIST], [LIST]], 'one read, one write');
      eq(p.map.get(`ff.weeks.1.${A}.${NOW}.4`), 'a saved week', 'nothing saved for it is deleted');
      eq(p.errors, [], 'nothing thrown');
    }

    if (scenario === 'sign-in') {
      // Signed out; the click signs in, and the lists come together.
      const fake = makeFake({ signedIn: false });
      fake.docs.set(LIST, packed({ v: 1, leagues: [acctEntry(B, { name: 'Work League' })], removed: {} }));
      const p = await boot({ fake, storage: { 'ff.leagues': { v: 1, leagues: [stored(A)], removed: [], probe: null, source: null } } });
      eq([p.ids(), fake.log.reads], [[A], []], '(signed out: this device’s list, nothing read)');
      p.fire(p.document.getElementById('lgSignIn'), 'click');
      await tick(80);
      eq(fake.log.signIns, 1, 'the button signs in');
      eq(p.ids(), [B, A].sort(), 'and the list is this device’s leagues AND the account’s');
      eq([fake.log.reads, fake.log.writes], [[LIST], [LIST]], 'one read, and one write for the league the account did not have');
      eq((bodyOf(fake, LIST) || { leagues: [] }).leagues.map((l) => l.leagueId), [B, A].sort(), 'which now holds both');
      eq(p.account(), 'Signed in as friend@example.com.Sign out', 'the header says who');

      // Signing out leaves the list as it is on this device.
      p.fire(p.document.getElementById('lgSignOut'), 'click');
      await tick(60);
      eq([p.ids(), text(p.document.getElementById('lgSignIn'))], [[B, A].sort(), 'Sign in with Google'], 'Sign out: the list stays on this device, and the button is back');
      // Adding or removing while signed out writes nothing to any account.
      p.fire(p.row(A).querySelector('.lg-remove'), 'click');
      p.fire(p.row(A).querySelector('.lg-yes'), 'click');
      await tick(60);
      eq([p.ids(), fake.log.writes.length], [[B], 1], 'a change made signed out is this device’s alone');
      eq(p.errors, [], 'nothing thrown');
    }

    if (scenario === 'owner') {
      // Tim's own account: the list is beside his profile, and nothing else of his is touched.
      const OWNER = { uid: 'uid-tim', email: 'tim@example.com', name: 'Tim' };
      const fake = makeFake({ user: OWNER });
      const profile = JSON.stringify({ leagueId: A, season: NOW, teamId: 7, updatedAt: 'before' });
      const index = JSON.stringify({ v: 1, kind: 'meta', leagueName: 'The Keeper League', json: ['{}'] });
      fake.docs.set('users/uid-tim', profile);
      fake.docs.set(`leagues/${A}/seasons/${NOW}`, index);
      const p = await boot({ fake, storage: { 'ff.leagues': { v: 1, leagues: [stored(A)], removed: [], probe: null, source: null } } });
      eq([fake.log.reads, fake.log.writes], [['users/uid-tim/menu/leagues'], ['users/uid-tim/menu/leagues']], 'the owner’s list: one read and one write, at users/{owner}/menu/leagues');
      eq([fake.docs.get('users/uid-tim'), fake.docs.get(`leagues/${A}/seasons/${NOW}`)], [profile, index], 'HIS PROFILE AND HIS LEAGUE DATA ARE EXACTLY AS THEY WERE');
      eq(p.ids(), [A], 'and his menu shows what it did');
      eq(p.errors, [], 'nothing thrown');
    }

    if (scenario === 'unread') {
      // The account's list could not be read: nothing is merged, and above all
      // nothing is written over a list that was never seen.
      const fake = makeFake({ failReads: true });
      const p = await boot({ fake, storage: { 'ff.leagues': { v: 1, leagues: [stored(A)], removed: [], probe: null, source: null } } });
      eq([p.ids(), fake.log.reads, fake.log.writes], [[A], [LIST], []], 'a list that could not be read is not written over');
      p.fire(p.row(A).querySelector('.lg-remove'), 'click');
      p.fire(p.row(A).querySelector('.lg-yes'), 'click');
      await tick(60);
      eq([p.ids(), fake.log.writes], [[], []], 'not even after a change here — the device’s own list still works');
      eq(p.errors, [], 'quietly');
    }
  } catch (err) {
    results.push({ pass: false, msg: `scenario ${scenario} threw`, extra: String((err && err.stack) || err).slice(0, 600) });
  }
  emit(results, results.some((r) => !r.pass) ? 1 : 0);
}

// --------------------------------------------------------------- parent mode
let pass = 0;
let fail = 0;
for (const scenario of SCENARIOS) {
  const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), scenario], { encoding: 'utf8', timeout: 60000 });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    fail++;
    console.log(`FAIL ${scenario} — no result\n${((res.stdout || '') + (res.stderr || '')).split('\n').slice(-12).join('\n')}`);
    continue;
  }
  const results = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  pass += results.length - bad.length;
  fail += bad.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario}  (${results.length - bad.length} assertions)`);
  for (const r of bad) console.log(`   ✗ ${r.msg}${r.extra ? ` — ${r.extra}` : ''}`);
}
console.log(fail
  ? `\n${pass} passed, ${fail} failed`
  : `\nAll ${pass} assertions passed across ${SCENARIOS.length} scenarios`);
process.exit(fail ? 1 : 0);
