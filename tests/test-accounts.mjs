// An account's main menu: the list of leagues that follows a Google account
// from device to device.
//
//   node test-accounts.mjs
//
// Tim, 2026-10-10: "add different leagues to their account", and "Anyone can
// sign up". Three things are kept apart here, each of which loses something a
// person did if it is wrong:
//
//   1. WHERE THE LIST LIVES (js/cloud.js `saveLeagueList` / `loadLeagueList`).
//      A document of its own, `users/{uid}/menu/leagues` — NOT inside the
//      profile at `users/{uid}`, which every build of the site writes whole
//      with four fields and would erase it.
//   2. HOW TWO LISTS BECOME ONE (js/leagues.js `mergeAccount`): every league
//      and season either side knows, the newest "You are", and a league that
//      was removed stays removed.
//   3. WHAT A BROWSER REMEMBERS HAVING SENT (js/proj-history.js's note): two
//      accounts on one browser must not be told the other's weeks are up.
//
// Where an account's LEAGUE DATA goes — the owner's paths unchanged, everyone
// else under `users/{uid}/leagues/` — is in tests/test-cloud.mjs, against the
// full-size season there. The page is tests/menu-account-check.mjs.
//
// No network: js/cloud.js's six transport methods are a fake that JSON
// round-trips every document, and storage is a Storage's methods over a Map.

import { moduleUrl } from './repo.mjs';

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
};
const eq = (a, b, name) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

let store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const json = (k) => (store.has(k) ? JSON.parse(store.get(k)) : null);

const cloud = await import(moduleUrl('js/cloud.js'));
const bridge = await import(moduleUrl('js/bridge.js'));
const leagues = await import(moduleUrl('js/leagues.js'));
const H = await import(moduleUrl('js/proj-history.js'));
// Against a build without them every assertion fails by name.
const mergeAccount = typeof leagues.mergeAccount === 'function'
  ? leagues.mergeAccount : () => ({ ok: false, list: { v: 1, leagues: [], removed: {} }, changed: false, local: false });
const saveLeagueList = typeof cloud.saveLeagueList === 'function' ? cloud.saveLeagueList : async () => ({ ok: false, bytes: 0, reason: 'no such function' });
const loadLeagueList = typeof cloud.loadLeagueList === 'function' ? cloud.loadLeagueList : async () => ({ ok: false, found: false, list: null, reason: 'no such function' });

const NOW = bridge.currentSeason();
const A = '476225250';
const B = '1241838';
const C = '90210';
const OWNER = { uid: 'uid-tim', email: 'tim@example.com', name: 'Tim' };
const FRIEND = { uid: 'uid-friend', email: 'friend@example.com', name: 'A Friend' };

function makeFake({ user = FRIEND, arrivesAfter = null } = {}) {
  const docs = new Map();
  const log = { reads: [], writes: [] };
  let here = arrivesAfter == null ? user : null;
  return {
    docs, log,
    async signIn() { return user; },
    async signOut() {},
    currentUser() { return here; },
    onAuth(cb) {
      if (arrivesAfter == null) cb(user);
      else setTimeout(() => { here = user; cb(user); }, arrivesAfter);
      return () => {};
    },
    async getDoc(p) { log.reads.push(p); const raw = docs.get(p); return raw === undefined ? null : JSON.parse(raw); },
    async setDoc(p, data) { log.writes.push(p); docs.set(p, JSON.stringify(data)); },
  };
}

/** A device's stored list, written as js/leagues.js stores it. */
const entry = (leagueId, over = {}) => ({
  leagueId, name: `League ${leagueId}`, teamCount: 10, seasons: [NOW], teams: {}, lastOpened: null, addedAt: 1000, ...over,
});
function device({ list = [], removed = [], removedAt = null, conn = null } = {}) {
  store = new Map();
  const state = { v: 1, leagues: list, removed, probe: null, source: null };
  if (removedAt) state.removedAt = removedAt;
  if (list.length || removed.length) store.set('ff.leagues', JSON.stringify(state));
  if (conn) store.set('ff.connection', JSON.stringify(conn));
}
/** The account's copy, as `mergeAccount` hands it back to be saved. */
const acct = (leagueList = [], removed = {}) => ({
  v: 1,
  leagues: leagueList.map((e) => ({ teams: {}, teamAt: {}, infoAt: 0, addedAt: 1000, teamCount: 10, seasons: [NOW], name: `League ${e.leagueId}`, ...e })),
  removed,
});
/** League A's "You are" team id for this season, on this device. */
const tid = () => (of(A).teams[NOW] || {}).id;
const ids = () => leagues.list().map((l) => l.leagueId).sort();
/** A league on this device's list; blanks when it is not there, so an assertion fails by name. */
const of = (id) => leagues.list().find((l) => l.leagueId === id)
  || { leagueId: null, name: null, teamCount: null, seasons: [], teams: {}, lastOpened: 'not listed' };

// =========================================================================
// 1. WHERE THE LIST LIVES
// =========================================================================
{
  // A list at the size one really is: four leagues, each with every season
  // the menu offers and a "You are" team in each, real-length names.
  const SEASONS = Array.from({ length: NOW - leagues.SEASON_MIN + 1 }, (_, i) => NOW - i);
  device();
  for (const [i, id] of [A, B, C, '55512345'].entries()) {
    for (const season of SEASONS) {
      leagues.add({
        leagueId: id, name: ['The Sunday Regulars', 'Hadfield Family League', 'UVU Engineering Dynasty', 'Work League'][i],
        teamCount: 10 + 2 * (i % 2), seasons: SEASONS, season, team: { id: 1 + ((i + season) % 10), name: 'Montgomery Hollywood-Smith' },
      });
    }
  }
  const first = mergeAccount(null);
  eq([first.ok, first.changed, first.list.leagues.length, first.list.leagues[0] && first.list.leagues[0].seasons.length],
    [true, true, 4, SEASONS.length], 'the fixture is a real one: four leagues with every season the menu offers');

  // Signed out: nothing is read and nothing is written.
  const nobody = makeFake({ user: null });
  cloud.configure({ transport: nobody, ownerUid: OWNER.uid });
  let r = await loadLeagueList();
  eq([r.ok, r.found, nobody.log.reads.length], [false, false, 0], 'signed out, the account’s list is not read');
  r = await saveLeagueList(first.list);
  eq([r.ok, nobody.log.writes.length], [false, 0], 'and not written');

  // Another account.
  const fake = makeFake();
  cloud.configure({ transport: fake, ownerUid: OWNER.uid });
  r = await loadLeagueList();
  eq([r.ok, r.found, r.list, fake.log.reads], [true, false, null, ['users/uid-friend/menu/leagues']],
    'an account with no list yet: one read, of users/{uid}/menu/leagues, and "none" rather than an error');
  r = await saveLeagueList(first.list);
  eq([r.ok, fake.log.writes], [true, ['users/uid-friend/menu/leagues']], 'saving it is ONE write, to users/{uid}/menu/leagues');
  const raw = fake.docs.get('users/uid-friend/menu/leagues');
  const doc = JSON.parse(raw || '{}');
  const bytes = Buffer.byteLength(raw || '', 'utf8');
  console.log(`The main menu's list, four leagues x ${SEASONS.length} seasons, as stored: ${bytes} bytes in ${(doc.json || []).length} piece(s)`);
  ok('the document is packed like every other one (what firebase/firestore.rules lets an account write)',
    doc.v === 1 && typeof doc.kind === 'string' && Array.isArray(doc.json) && doc.json.every((s) => typeof s === 'string' && s.length <= 4000)
    && doc.json.length <= 180 && Object.keys(doc).length <= 16, JSON.stringify(Object.keys(doc)));
  ok(`and is small: ${bytes} bytes for four leagues`, bytes > 1000 && bytes < 8000 && r.bytes === bytes, `${bytes} / ${r.bytes}`);

  // THE PROFILE IS WRITTEN WHOLE, by this build and by every cached older one.
  const before = fake.docs.get('users/uid-friend/menu/leagues');
  r = await cloud.saveProfile({ leagueId: A, season: NOW, teamId: 7 });
  eq(r.ok, true, 'the profile is saved (the connection bar does this on every connect)');
  eq(Object.keys(JSON.parse(fake.docs.get('users/uid-friend'))).sort(), ['leagueId', 'season', 'teamId', 'updatedAt'],
    'as its four fields and nothing else — which is why the list cannot live in it');
  await fake.setDoc('users/uid-friend', { leagueId: B, season: NOW, teamId: 2, updatedAt: 'an older cached build' });
  ok('THE LIST SURVIVES A PROFILE WRITE, untouched', fake.docs.get('users/uid-friend/menu/leagues') === before);
  fake.log.reads.length = 0;
  r = await loadLeagueList();
  eq([r.ok, r.found, fake.log.reads], [true, true, ['users/uid-friend/menu/leagues']], 'and reads back in one read');
  eq(r.list, first.list, 'exactly as it was saved');
  const back = await cloud.loadProfile();
  eq(back.profile && back.profile.leagueId, B, 'the profile reads as before, too');

  // The owner's list is beside the owner's profile, where the rules have always let it write.
  const own = makeFake({ user: OWNER });
  cloud.configure({ transport: own, ownerUid: OWNER.uid });
  await saveLeagueList(first.list);
  eq(own.log.writes, ['users/uid-tim/menu/leagues'], 'the owner’s list goes to users/{owner}/menu/leagues: nothing under leagues/ is written');

  // Sign-in that answers a beat after the page.
  const late = makeFake({ arrivesAfter: 40 });
  late.docs.set('users/uid-friend/menu/leagues', before);
  cloud.configure({ transport: late, ownerUid: OWNER.uid });
  r = await loadLeagueList();
  eq([r.ok, r.found, late.log.reads], [true, true, ['users/uid-friend/menu/leagues']], 'a read made before sign-in has answered waits for it');

  // Something else in the document's place.
  const odd = makeFake();
  odd.docs.set('users/uid-friend/menu/leagues', JSON.stringify({ hello: 'there' }));
  cloud.configure({ transport: odd, ownerUid: OWNER.uid });
  r = await loadLeagueList();
  eq([r.ok, r.found, r.list], [true, false, null], 'a document that is not a list reads as none');
  r = await saveLeagueList([1, 2]);
  eq([r.ok, odd.log.writes.length], [false, 0], 'and something that is not a list is not saved');
}

// =========================================================================
// 2. TWO LISTS AS ONE
// =========================================================================
{
  // A laptop with a league, an account with nothing yet.
  device({ list: [entry(A, { name: 'The Keeper League', seasons: [NOW, NOW - 1], teams: { [NOW]: { id: 7, name: 'Team 7' } }, teamAt: { [NOW]: 5000 }, infoAt: 4000, lastOpened: { season: NOW, at: 9000 } })] });
  const stored = store.get('ff.leagues');
  let m = mergeAccount(null);
  eq([m.ok, m.changed, m.local], [true, true, false], 'a device’s league and an empty account: the account wants writing, the device does not');
  eq(m.list, {
    v: 1,
    leagues: [{ leagueId: A, name: 'The Keeper League', teamCount: 10, seasons: [NOW, NOW - 1], teams: { [NOW]: { id: 7, name: 'Team 7' } }, teamAt: { [NOW]: 5000 }, infoAt: 4000, addedAt: 1000 }],
    removed: {},
  }, 'the account’s copy: the league, its seasons, "You are" and when — and not when it was last opened, which is this device’s business');
  ok('the device’s list is not rewritten', store.get('ff.leagues') === stored);
  const again = mergeAccount(m.list);
  eq([again.changed, again.local, again.list], [false, false, m.list], 'merged with what it just made: nothing to write anywhere (so no write per menu visit)');

  // A new phone: nothing saved, the account has two leagues.
  device();
  const two = acct([
    { leagueId: A, name: 'The Keeper League', seasons: [NOW, NOW - 1, NOW - 2], teams: { [NOW]: { id: 7, name: 'Team 7' } }, teamAt: { [NOW]: 5000 }, addedAt: 1000 },
    { leagueId: B, name: 'Work League', teamCount: 12, seasons: [NOW], addedAt: 2000 },
  ]);
  m = mergeAccount(two);
  eq([m.ok, m.local, m.changed], [true, true, false], 'a device with nothing, an account with two leagues: the device gains them and the account is not written');
  eq(ids(), [B, A].sort(), 'both are on this device’s list now');
  eq([of(A).name, of(A).seasons, of(A).teams, of(B).teamCount, of(A).lastOpened],
    ['The Keeper League', [NOW, NOW - 1, NOW - 2], { [NOW]: { id: 7, name: 'Team 7' } }, 12, null],
    'with their names, every season, the "You are" team — and not opened');
  eq([store.has('ff.connection'), leagues.current()], [false, null], 'nothing is opened by it: the connection slot is as it was');

  // Seasons: every one either side knows.
  device({ list: [entry(A, { seasons: [NOW, NOW - 3] })] });
  m = mergeAccount(acct([{ leagueId: A, seasons: [NOW, NOW - 1] }]));
  eq([of(A).seasons, (m.list.leagues[0] || {}).seasons, m.changed, m.local], [[NOW, NOW - 1, NOW - 3], [NOW, NOW - 1, NOW - 3], true, true],
    'seasons are the union: none either side knew is dropped');

  // "You are": whichever was chosen later.
  const conn = { leagueId: A, season: NOW, teamId: 7, league: { leagueId: A, season: NOW, name: 'The Keeper League', teamCount: 10, teams: [{ id: 3, name: 'Team 3' }, { id: 7, name: 'Team 7' }] } };
  const mine = (at) => entry(A, { teams: { [NOW]: { id: 7, name: 'Team 7' } }, ...(at ? { teamAt: { [NOW]: at } } : {}), lastOpened: { season: NOW, at: 1 } });
  const theirs = (at) => acct([{ leagueId: A, teams: { [NOW]: { id: 3, name: 'Team 3' } }, teamAt: at ? { [NOW]: at } : {} }]);

  device({ list: [mine(5000)], conn });
  m = mergeAccount(theirs(6000));
  eq([of(A).teams[NOW], (m.list.leagues[0] || { teams: {} }).teams[NOW], m.changed], [{ id: 3, name: 'Team 3' }, { id: 3, name: 'Team 3' }, false],
    'the account’s "You are" is newer: this device takes it');
  eq(json('ff.connection').teamId, 3, 'and the league that is open follows, so the pages agree with the menu');
  eq(json('ff.connection').league, conn.league, 'nothing else in the connection slot is touched');

  device({ list: [mine(7000)], conn });
  m = mergeAccount(theirs(6000));
  eq([tid(), m.list.leagues[0] && m.list.leagues[0].teams[NOW].id, m.list.leagues[0] && m.list.leagues[0].teamAt[NOW], m.changed, json('ff.connection').teamId], [7, 7, 7000, true, 7],
    'this device’s is newer: it stays, and goes up to the account');

  device({ list: [mine(0)], conn });
  m = mergeAccount(theirs(6000));
  eq(tid(), 3, 'a team chosen before times were kept loses to one with a time');
  device({ list: [mine(6000)], conn });
  m = mergeAccount(theirs(0));
  eq([tid(), m.changed], [7, true], 'and the other way about');
  device({ list: [entry(A, { teams: { [NOW - 1]: { id: 2, name: 'Team 2' } } })] });
  m = mergeAccount(theirs(6000));
  eq(Object.keys(of(A).teams).sort(), [String(NOW - 1), String(NOW)], 'a team is per season: one season’s never replaces another’s');

  // Name and size: whichever was read later; a placeholder never beats a name.
  device({ list: [entry(A, { name: 'Old Name', teamCount: 10, infoAt: 100 })] });
  m = mergeAccount(acct([{ leagueId: A, name: 'New Name', teamCount: 12, infoAt: 200 }]));
  eq([of(A).name, of(A).teamCount], ['New Name', 12], 'the name and size read later win');
  device({ list: [entry(A, { name: `League ${A}`, infoAt: 900 })] });
  m = mergeAccount(acct([{ leagueId: A, name: 'A Real Name', infoAt: 200 }]));
  eq(of(A).name, 'A Real Name', 'a league known only by its number takes the name the account has');
}

// ----------------------------------------------------- removed stays removed
{
  // Removed on this device with Remove; the account still lists it.
  device({ list: [entry(A), entry(B)] });
  store.set(`ff.weeks.1.${A}.${NOW}.4`, 'a saved week');
  eq(leagues.remove(A), true, '(a league is removed on this device)');
  let m = mergeAccount(acct([{ leagueId: A, seasons: [NOW, NOW - 1] }, { leagueId: B }]));
  eq(ids(), [B], 'A REMOVED LEAGUE IS NOT BROUGHT BACK BY THE ACCOUNT’S LIST');
  eq(leagues.isRemoved(A), true, 'it is still noted as removed here');
  eq([m.list.leagues.map((l) => l.leagueId), Object.keys(m.list.removed), m.changed], [[B], [A], true],
    'and the account is told: off its list, noted as removed');
  eq(store.get(`ff.weeks.1.${A}.${NOW}.4`), 'a saved week', 'nothing saved for it is deleted');
  const told = m.list;
  m = mergeAccount(told);
  eq([ids(), m.changed, m.local], [[B], false, false], 'merged again: still gone, and nothing more to write');

  // Removed here by a build that kept no time for it.
  device({ list: [entry(B)], removed: [A] });
  m = mergeAccount(acct([{ leagueId: A, addedAt: Date.now() - 60000 }, { leagueId: B }]), { now: Date.now() });
  eq([ids(), leagues.isRemoved(A), Object.keys(m.list.removed)], [[B], true, [A]], 'a removal with no time kept is not undone either');

  // Removed on ANOTHER device: it goes from this one when the menu is next opened.
  device({ list: [entry(A, { addedAt: 1000 }), entry(B)] });
  store.set(`ff.weeks.1.${A}.${NOW}.4`, 'a saved week');
  m = mergeAccount(acct([{ leagueId: B }], { [A]: 2000 }));
  eq([ids(), leagues.isRemoved(A), m.local, m.changed], [[B], true, true, false], 'a league removed on another device leaves this device’s list');
  eq(store.get(`ff.weeks.1.${A}.${NOW}.4`), 'a saved week', 'with everything saved for it still here');
  eq(json('ff.leagues').removedAt, { [A]: 2000 }, 'remembered as removed when it was, not now');

  // Added again after it was removed: it is back, everywhere.
  device({ list: [entry(A, { addedAt: 3000 })] });
  m = mergeAccount(acct([], { [A]: 2000 }));
  eq([ids(), m.list.leagues.map((l) => l.leagueId), m.list.removed, m.changed], [[A], [A], {}, true],
    'added again later than it was removed: it stays, and the account drops the note');
  device({ list: [entry(B)], removed: [A], removedAt: { [A]: 2000 } });
  eq(leagues.add({ leagueId: A, name: 'Back Again', seasons: [NOW] }) != null, true, '(added back by hand on the device that removed it)');
  m = mergeAccount(acct([{ leagueId: B }], { [A]: 2000 }));
  eq([ids(), Object.keys(m.list.removed)], [[A, B].sort(), []], 'adding it back by hand brings it back for the account too');

  // The league that is open here, removed elsewhere.
  const conn = { leagueId: A, season: NOW, teamId: 7, league: { leagueId: A, season: NOW, name: 'X', teamCount: 10, teams: [] } };
  device({ list: [entry(A, { addedAt: 1000, lastOpened: { season: NOW, at: 1500 } })], conn });
  m = mergeAccount(acct([], { [A]: 2000 }));
  eq([ids(), leagues.current()], [[], null], 'the open league, removed on another device: gone, and the site does not walk back into it');

  // Whatever comes down is cleaned; nothing throws.
  device({ list: [entry(B)] });
  const stored = store.get('ff.leagues');
  for (const junk of ['x', 7, [], { leagues: 'no' }, { leagues: [null, { leagueId: 'abc' }, { leagueId: '-1' }], removed: { abc: 5, [A]: 'soon' } }, { removed: [A] }]) {
    let threw = null;
    try { m = mergeAccount(junk); } catch (err) { threw = err; }
    ok(`a list that is not one (${JSON.stringify(junk).slice(0, 40)}) changes nothing here`, !threw && m.ok && store.get('ff.leagues') === stored && ids().join() === B,
      threw ? String(threw) : JSON.stringify(m));
  }
}

// =========================================================================
// 3. WHAT THIS BROWSER REMEMBERS HAVING SENT, per account
// =========================================================================
{
  store = new Map();
  const io = { storage: globalThis.localStorage };
  const as = (user) => cloud.configure({ transport: makeFake({ user }), ownerUid: OWNER.uid });

  as(OWNER);
  H.noteCloud(A, NOW, { sent: { 1: 'owner-mark-1', 2: 'owner-mark-2' }, seen: '2026-10-01T00:00:00.000Z' }, io);
  const ownersNote = store.get('ff.cloud.projhist');
  eq(Object.keys(JSON.parse(ownersNote)), [`${A}::${NOW}`], 'the owner’s note keeps the name it has always had: {league}::{season}');

  as(FRIEND);
  eq(H.cloudNote(A, NOW, io), { sent: null, seen: null }, 'ANOTHER ACCOUNT ON THE SAME BROWSER IS NOT TOLD THE OWNER’S WEEKS ARE UP');
  H.noteCloud(A, NOW, { sent: { 3: 'friend-mark-3' } }, io);
  eq(H.cloudNote(A, NOW, io).sent, { 3: 'friend-mark-3' }, 'it keeps a note of its own');
  eq(Object.keys(json('ff.cloud.projhist')).sort(), [`${A}::${NOW}`, `uid-friend/${A}::${NOW}`].sort(), 'under its own name');
  eq(JSON.stringify(json('ff.cloud.projhist')[`${A}::${NOW}`]), JSON.stringify(JSON.parse(ownersNote)[`${A}::${NOW}`]), 'and the owner’s is exactly as it was');

  as(OWNER);
  eq(H.cloudNote(A, NOW, io), { sent: { 1: 'owner-mark-1', 2: 'owner-mark-2' }, seen: '2026-10-01T00:00:00.000Z' },
    'the owner, back on this browser, finds its own note and nothing of the other account’s');

  cloud.configure({ transport: makeFake({ user: null }), ownerUid: OWNER.uid });
  eq(H.cloudNote(A, NOW, io).seen, '2026-10-01T00:00:00.000Z', 'signed out, the plain name is read, as before there were accounts');
}

console.log('');
if (fails.length) {
  console.log(`${pass} passed, ${fails.length} failed\n`);
  for (const f of fails) console.log('  FAIL  ' + f);
  process.exit(1);
}
console.log(`All ${pass} assertions passed`);
