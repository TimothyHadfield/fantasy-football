// The phone bridge: desktop writes the league up, the phone reads it down.
//
// ===========================================================================
// WHY THIS EXISTS
// ===========================================================================
//
// Tim's league (476225250) is PRIVATE. A static page cannot read a private
// ESPN league — ESPN's cookies are third-party from github.io and JavaScript
// cannot set the `Cookie` header — so `extension/` makes the calls instead,
// carrying the cookie because espn.com is in its host_permissions.
//
// No phone browser can install that extension. Not iOS Safari, not Chrome on
// Android, not with any amount of cleverness. So on his iPhone the site has
// always fallen back to demo data, and that is also the likeliest reason the
// time machine's archive is still empty: a reading is only taken when the
// schedule page loads on LIVE data.
//
// His fix, which he proposed and approved:
//
//   > the information connected to the league can be updated every time they
//   > log onto their computer (which has the extension), and then the
//   > information is saved to the user's account, and then when the user uses
//   > the site on their iphone, it will connect to the information on firebase,
//   > not the site... It wouldn't be perfectly live, but if they logged on
//   > weekly or so, it would be good enough.
//
// That is exactly right, and it is the ONLY route that works: the desktop is
// the only machine that can see the league, so the desktop has to be the one
// that publishes. The phone never talks to ESPN at all.
//
// PROGRESS.md records Firebase being set aside once before. That was for a
// DIFFERENT job (holding the snapshot archive) and for a cost-of-setup reason
// — the committed file was cheaper for him. It was never "Firebase does not
// work here". For this job there is no committed-file equivalent: nobody is
// going to hand-commit thirteen weeks of rosters every Sunday.
//
// ===========================================================================
// THE CONTRACT (this comment is the spec; the page wiring is done elsewhere)
// ===========================================================================
//
//   configure({ apiKey, authDomain, projectId, appId, ownerUid })
//       Point the module at a Firebase project. Safe to commit — see "THE KEY
//       IS PUBLIC" below. Until this is called with a real apiKey and
//       projectId, EVERY function below returns a not-configured result and
//       touches the network never.
//
//   isConfigured()            -> boolean
//   signIn()                  -> {ok, user|null, reason}
//   signOut()                 -> {ok, reason}
//   currentUser()             -> {uid, email, name} | null   (sync, cached)
//   onAuth(cb)                -> unsubscribe();  cb(user|null)
//
//   syncUp(leagueId, season, payload, {onProgress})
//       Desktop -> cloud. Writes the whole 13-week span, not one week.
//       -> {ok, wrote, bytes, syncedAt, largestDoc, reason}
//
//   readDown(leagueId, season, {weeks, shapes})
//       Cloud -> phone. Returns the SAME shapes the live fetchers produce, so
//       a page can substitute rather than grow a second rendering path.
//       -> {ok, found, leagueName, teams, byes, schedule,
//           rosters: Map<week, teams[]>, wire: Map<week, players[]>,
//           syncedAt: {rosters, wire, schedule}, ages: {...}, reason}
//
//   cloudStatus(leagueId, season)
//       ONE document read. What is up there and how old each shape is.
//       -> {ok, found, weeks, syncedAt, ages, stale, reason}
//
//   ageOf(iso) / MAX_AGE / isStale(shape, iso)
//       The staleness policy, exported so no page can invent its own.
//
// EVERY function returns. None of them throw. Offline, not signed in, no
// project configured, quota exceeded, a document that will not parse — all of
// them come back as `{ok: false, reason}` and the page renders exactly as it
// does today. That is the established rule for `snapshots.fetchRemote` and it
// applies doubly here, because the cloud is absent on every page load until
// the day Tim finishes the console setup.
//
// ===========================================================================
// THE DOCUMENT SCHEMA, AND WHY IT IS SHAPED THIS WAY
// ===========================================================================
//
//   leagues/{leagueId}/seasons/{season}                     index     1.5 KB
//   leagues/{leagueId}/seasons/{season}/parts/schedule      schedule   13 KB
//   leagues/{leagueId}/seasons/{season}/rosters/{week}      x13        53 KB each
//   leagues/{leagueId}/seasons/{season}/wire/{week}         x13        36 KB each
//   leagues/{leagueId}/seasons/{season}/decisions/{week}    per decided week
//       (added 2026-10-05, optional, not in the index — see `readDecisions`)
//   leagues/{leagueId}/seasons/{season}/projhist/{week}     per saved week  21 KB
//       (added 2026-10-06, optional, with a list of its own at projhist/index
//       — see "the projection history's weeks")
//
// WHOSE COPY (2026-10-10, "Anyone can sign up"). The paths above are the
// OWNER's (`ownerUid` below) and are exactly what they have always been. Any
// other Google account keeps a private copy of its own, the same documents one
// level down:
//
//   users/{uid}                                              the profile (four fields)
//   users/{uid}/menu/leagues                                 the main menu's list
//   users/{uid}/leagues/{leagueId}/seasons/{season}/...      as above
//
// ONE function decides which (`rootOf`), every read and write goes through
// it, and it is asked only AFTER sign-in has answered (`authSettled`): a read
// sent while the session was still being restored would go to the wrong copy.
// Nothing is ever moved between the two.
//
// A Firestore document is capped at 1 MiB, and PROGRESS.md warns that a week
// of rosters is "about a megabyte". THAT FIGURE IS ABOUT ESPN'S RAW PAYLOAD,
// which is what `snapshots.js` refuses to store. What goes up here is the
// DECODED shape the pages actually render from — `season.js`'s
// `fetchWeekRosters` and `espn.js`'s `parseFreeAgent` — and that is an order of
// magnitude smaller. These are MEASURED, by `tests/test-cloud.mjs`, against a
// fixture built at genuinely realistic size (ten squads of sixteen,
// real-length names, ESPN's own full-precision floats, a hundred and fifty men
// on the wire); the suite fails if any of them moves:
//
//   one week of rosters, as season.js returns it ....  91 KB
//                        as stored, views stripped ...  53 KB   19x under the cap
//   one week of the wire, 150 men ...................  36 KB   28x under the cap
//   the whole season schedule, 65 games .............  13 KB
//   everything, all 13 weeks ........................ 1.15 MB over 28 documents
//
// So the cap is not the binding constraint it looked like, and this module
// deliberately grows NO sharding machinery. One document per week per shape is
// enough, and the roster count that drives the size is fixed by the league
// settings (ten squads, sixteen men) — it cannot grow nineteen-fold.
// `syncUp` refuses any document over 700 KiB, which is the alarm that would go
// off at Tim's desk long before a write ever failed on his phone.
//
// WHAT WAS STRIPPED. `fetchWeekRosters` returns each squad's `players` array
// AND `starters` / `bench`, which are the same objects filtered two ways —
// stringifying all three writes every player twice, which is the difference
// between a 91 KB week and a 47 KB one. Only `players` goes up, plus two short
// arrays of indexes saying which of them made up each view, so what comes down
// is deep-equal to what went in without paying for the copy and without
// re-deriving anything. The four team totals (`projectedTotal` and friends) DO
// go up verbatim rather
// than being re-added here: re-deriving them would mean a second copy of
// `season.js`'s null-vs-zero rule ("before kickoff every actual is null, and
// summing those as 0 reports a real-looking 0.0"), and a second copy is how
// two files start disagreeing. Nothing else is dropped, and nothing is
// rounded: `syncUp` must round-trip unchanged, and a rounded projection is a
// different number from the one the desktop was looking at.
//
// ROSTERS AND WIRE ARE SEPARATE DOCUMENTS on purpose. Four of the six pages
// need rosters and never touch the wire, so splitting halves what the phone
// pays on most loads.
//
// ===========================================================================
// WHAT A PAGE LOAD COSTS
// ===========================================================================
//
// Firestore bills per DOCUMENT read, not per byte. Free tier: 50,000 reads a
// day. Under this schema, a cold load of the most expensive page there is —
// Players, wanting the wire plus every squad for a full 13-week span — reads:
//
//   1 meta + 1 schedule + 13 rosters + 13 wire  =  28 documents
//
// The analysis, trade and schedule pages skip the wire: 15 documents. So Tim
// could open every page on the site, cold, sixty times a day and still be
// inside the free tier. A per-team-per-week schema would have made the same
// load 145 documents for no benefit whatsoever; that is why it is not used.
//
// A sync writes the same 28 documents. Free tier is 20,000 writes a day.
//
// ===========================================================================
// THE KEY IS PUBLIC, AND THAT IS FINE
// ===========================================================================
//
// A Firebase `apiKey` identifies the project. It is not a credential and it is
// not a secret — it ships in the HTML of every Firebase web app in the world,
// and Google documents it as safe to expose. PROGRESS.md already says this.
// Security lives entirely in the Firestore rules, which pin the data to one
// signed-in Google account; see `docs/firebase-setup.md` for the rules to
// paste. Do NOT invent a scheme to hide the key — an obfuscated key in
// client-side JavaScript is still a public key, and the effort would buy
// nothing but the illusion of having done something.
//
// ===========================================================================
// WHY THE BODY IS STORED AS A CHUNKED JSON STRING
// ===========================================================================
//
// Each document carries its payload as `json`, an ARRAY OF STRING PIECES, not
// as native Firestore fields. Three reasons, in order of how badly they bite:
//
// 1. Firestore will not store an array inside an array. A week's rosters are
//    teams-containing-players — arrays two deep — so the native encoding would
//    have to be flattened into something that no longer resembles what the
//    pages read, and flattening is where a round trip stops being exact.
// 2. Firestore auto-indexes every field it can see, and an index entry has a
//    size limit an unbroken 41 KB string can exceed. Splitting into pieces
//    under 4,000 characters keeps every entry comfortably legal, so Tim never
//    has to remember a single-field index exemption in the console.
// 3. `undefined`, which ESPN's decoders can produce for a missing id, is a
//    Firestore write error and is simply absent from JSON.
//
// The cost is that the data cannot be queried inside Firestore. Nothing here
// ever wants to: every document is addressed by its path.
//
// ===========================================================================
// STALENESS IS NOT ONE NUMBER
// ===========================================================================
//
// A phone showing week-old numbers as though they were live is the same class
// of error the schedule page's archive banner exists to prevent — "the banner
// is loud on purpose", and a reader who skims past it has been actively
// misled. So every shape carries its own `syncedAt` and the API reports each
// one separately, because they do NOT decay at the same rate:
//
//   wire     — decays BADLY. Its whole question is "who can I add", and a
//              week-old wire lists men claimed on Tuesday. Confidently wrong
//              is the one failure this site's house style exists to prevent,
//              so MAX_AGE.wire is a single day and the caller is expected to
//              refuse to draw it rather than draw it with a caveat.
//   rosters  — decays gently. Lineups and trades move, but the season-shaped
//              questions the analysis and trade pages ask survive a few days.
//   schedule — decays gently. Results arrive weekly; fixtures never move.
//
// This module reports; it does not draw. The banner is the page's job.
//
// ===========================================================================
// DEMO IS NEVER SYNCED
// ===========================================================================
//
// Same rule as the snapshot archive, for the same reasons: demo data is
// generated rather than observed, it would fill the cloud with weeks that
// never happened, and a phone reading it back would be looking at a league
// that does not exist while the badge said "live". Enforced by requiring the
// league id to be all digits — which is what a real ESPN league id is, and
// which 'demo' is not — as well as honouring an explicit `isDemo`.

// ------------------------------------------------------------------ constants

/** Bump only for a change old documents cannot be read through. */
export const SCHEMA = 1;

/**
 * Pinned exactly, never a range and never "latest".
 *
 * The site has no build step and no lockfile, so this string is the only thing
 * standing between us and Google shipping a breaking change into a page that
 * has not been touched in six months. Changing it is a deliberate act with a
 * test run behind it.
 *
 * Checked against the CDN on 2026-09-16: all three modules return 200, and
 * every name used below is in their export lists. `firebase-firestore.js` is
 * 685 KB on its own, which is the other reason the imports are lazy — nobody
 * on a phone should download that to look at a page that never syncs.
 */
export const SDK_VERSION = '12.19.0';

const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

/**
 * How old each shape may be before a page should stop presenting it as current.
 *
 * Exported so that no page invents its own threshold. See "STALENESS IS NOT
 * ONE NUMBER" above for why the wire's is an order of magnitude tighter.
 */
export const MAX_AGE = {
  wire: 24 * 60 * 60 * 1000,          // one day
  rosters: 7 * 24 * 60 * 60 * 1000,   // one week
  schedule: 7 * 24 * 60 * 60 * 1000,  // one week
};

/**
 * Pieces of at most this many characters.
 *
 * Under Firestore's index-entry limit with room to spare even if every
 * character turned out to be multi-byte, which for ESPN player names it does
 * not. See "WHY THE BODY IS STORED AS A CHUNKED JSON STRING".
 */
const CHUNK_CHARS = 4000;

/**
 * Refuse to write anything approaching the 1 MiB document cap.
 *
 * Nothing measured comes within twenty-five times this, so if it ever fires
 * something has changed shape underneath us — a new field carrying ESPN's raw
 * payload, most likely — and failing loudly at the desk beats failing silently
 * on the phone in October.
 */
const MAX_DOC_BYTES = 700 * 1024;

/**
 * Where the config gets pasted.
 *
 * Deliberately blank and deliberately in the repo. `docs/firebase-setup.md`
 * walks Tim through producing these five strings in the Google console; until
 * they are filled in, `isConfigured()` is false and this module is inert — no
 * network, no error, no change to any page.
 *
 * `ownerUid` is filled in on a SECOND sitting, because it does not exist until
 * he has signed in once. It is not a secret either. It says whose copy lives
 * at `leagues/...` (see `rootOf`); every other account keeps its own under
 * `users/{uid}/`. What enforces both is firebase/firestore.rules.
 */
export const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyDLatA-0XyFDeeqVbrglvKcxk3k6B5zlGw',
  authDomain: 'fantasy-football-th.firebaseapp.com',
  projectId: 'fantasy-football-th',
  appId: '1:1008636616586:web:3932f2d5a69cd6f9177273',
  ownerUid: 'rYpbExZGM0fCeuuYakAxR6OzG452',   // timhadfield7@gmail.com
};

// --------------------------------------------------------------------- state

const config = { ...DEFAULT_CONFIG };

/**
 * An injected transport, or null to build one from the Firebase CDN on demand.
 *
 * This is the seam the tests use. The Firebase SDK cannot be reached from the
 * test environment — and should not be, since a suite that needed the network
 * would be a suite that fails on a train — so `tests/test-cloud.mjs` hands in
 * a fake that JSON-round-trips every document exactly as Firestore would.
 * Keeping all Firebase knowledge behind six small methods is also what stops
 * the rest of this file from being untestable.
 *
 * @typedef {Object} Transport
 * @property {() => Promise<{uid:string,email:string,name:string}>} signIn
 * @property {() => Promise<void>} signOut
 * @property {() => ({uid:string,email:string,name:string}|null)} currentUser
 * @property {(cb: Function) => Function} onAuth
 * @property {(path: string) => Promise<Object|null>} getDoc
 * @property {(path: string, data: Object) => Promise<void>} setDoc
 */
let injected = null;

/** Built once, lazily, and only if somebody actually asks for the cloud. */
let transportPromise = null;

/** Last known signed-in user, so `currentUser()` can answer synchronously. */
let cachedUser = null;

/** Callbacks registered before the SDK finished loading. */
const authListeners = new Set();

/** Resolves once the transport has said who is signed in (or that nobody is). */
let authAnswered = null;

/** How long a read waits to be told who is signed in before going on as nobody. */
const AUTH_WAIT_MS = 8000;

// ----------------------------------------------------------------- configure

/**
 * Point the module at a Firebase project.
 *
 * Merges rather than replaces, so a page can set `ownerUid` alone. Passing a
 * `transport` is the test seam and has no use in a browser.
 */
export function configure(opts = {}) {
  for (const k of ['apiKey', 'authDomain', 'projectId', 'appId', 'ownerUid']) {
    if (typeof opts[k] === 'string') config[k] = opts[k].trim();
  }
  // `undefined` means "leave it alone"; an explicit null CLEARS it, which is
  // how a test gets back to the real (unreachable) CDN loader after injecting
  // a fake. Anything else is the fake.
  if (opts.transport !== undefined) {
    injected = opts.transport || null;
    transportPromise = injected ? Promise.resolve(injected) : null;
    cachedUser = null;
    authAnswered = null;
  }
  return { ...config };
}

/** The current config, for a page that wants to show what it is pointed at. */
export function currentConfig() {
  return { ...config };
}

/**
 * Is there a project to talk to at all?
 *
 * An injected transport counts: the tests have no apiKey and should not need
 * to invent one to exercise the round trip.
 */
export function isConfigured() {
  if (injected) return true;
  return Boolean(config.apiKey && config.projectId);
}

/** The one place that says "there is no cloud here", so it says it once. */
function notConfigured() {
  return {
    ok: false,
    found: false,
    reason: 'No Firebase project is configured. See docs/firebase-setup.md.',
  };
}

/** Nothing synced, so everything is as stale as it gets. Never absent. */
function noAges(now = Date.now()) {
  return ageReport({ rosters: null, wire: null, schedule: null }, now);
}

// ------------------------------------------------------------ the CDN loader

/**
 * Build a transport out of the real Firebase SDK, loaded from the CDN.
 *
 * Imported LAZILY, inside the function that needs it, for two reasons that
 * both matter on this site: a page that never syncs should pay nothing for
 * this module existing, and the site has to keep loading with no network at
 * all. A top-level `import` of a gstatic URL would break both.
 *
 * Every failure here — offline, a blocked CDN, a project that does not exist —
 * comes back as a rejected promise which the callers turn into `{ok: false}`.
 */
async function buildTransport() {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${SDK_BASE}/firebase-app.js`),
    import(`${SDK_BASE}/firebase-auth.js`),
    import(`${SDK_BASE}/firebase-firestore.js`),
  ]);

  const app = appMod.getApps().length
    ? appMod.getApp()
    : appMod.initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain || `${config.projectId}.firebaseapp.com`,
      projectId: config.projectId,
      appId: config.appId || undefined,
    });

  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);

  const shape = (u) => (u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null);

  return {
    async signIn() {
      // A POPUP, not a redirect, and that is not a style choice. The redirect
      // flow bounces through `<project>.firebaseapp.com` and then needs to
      // read a cookie back on github.io — which is third-party, and which iOS
      // Safari blocks outright. It is the same wall that stops the site
      // reading ESPN directly. A popup opened from a real tap works on iOS.
      const provider = new authMod.GoogleAuthProvider();
      const res = await authMod.signInWithPopup(auth, provider);
      return shape(res.user);
    },
    async signOut() {
      await authMod.signOut(auth);
    },
    currentUser() {
      return shape(auth.currentUser);
    },
    onAuth(cb) {
      return authMod.onAuthStateChanged(auth, (u) => cb(shape(u)));
    },
    async getDoc(path) {
      const snap = await fsMod.getDoc(fsMod.doc(db, path));
      return snap.exists() ? snap.data() : null;
    },
    async setDoc(path, data) {
      await fsMod.setDoc(fsMod.doc(db, path), data);
    },
  };
}

/** The transport, or null if it cannot be had. Never throws. */
async function getTransport() {
  if (injected) return injected;
  if (!isConfigured()) return null;
  if (!transportPromise) {
    transportPromise = buildTransport().catch(() => {
      // Let the next attempt try again — the usual cause is being offline for
      // a moment, and one failed load must not poison the module for the life
      // of the page.
      transportPromise = null;
      return null;
    });
  }
  try {
    return await transportPromise;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ identity

/**
 * Sign in with Google.
 *
 * MUST be called from a real user gesture (a click or a tap). Browsers block
 * a popup that was not asked for, and iOS Safari is the strictest of them.
 */
export async function signIn() {
  if (!isConfigured()) return notConfigured();
  const t = await getTransport();
  if (!t) return { ok: false, user: null, reason: 'Could not load Firebase. Check the connection.' };
  try {
    const user = await t.signIn();
    cachedUser = user || null;
    fanOut(cachedUser);
    return { ok: Boolean(user), user: cachedUser, reason: user ? '' : 'Sign-in was cancelled.' };
  } catch (err) {
    return { ok: false, user: null, reason: readable(err, 'Sign-in did not complete.') };
  }
}

export async function signOut() {
  const t = await getTransport();
  if (!t) return { ok: true, reason: '' };
  try {
    await t.signOut();
  } catch {
    /* already gone, or never there; either way the caller is signed out */
  }
  cachedUser = null;
  fanOut(null);
  return { ok: true, reason: '' };
}

/**
 * Who is signed in, as far as this module knows. Synchronous on purpose so a
 * render pass can ask without awaiting; `onAuth` is how you learn about a
 * change.
 */
export function currentUser() {
  if (injected && typeof injected.currentUser === 'function') {
    try { return injected.currentUser() || cachedUser; } catch { return cachedUser; }
  }
  return cachedUser;
}

function fanOut(user) {
  for (const cb of authListeners) {
    try { cb(user); } catch { /* one bad listener must not stop the others */ }
  }
}

/**
 * Watch the signed-in user.
 *
 * Returns the unsubscribe immediately — it does not wait for the SDK — because
 * a page wiring this up during render cannot await. If the SDK never loads the
 * callback simply fires once with null, which is the truth.
 */
export function onAuth(cb) {
  if (typeof cb !== 'function') return () => {};
  authListeners.add(cb);

  let sdkUnsub = null;
  let dropped = false;

  (async () => {
    const t = await getTransport();
    if (dropped) return;
    if (!t) { try { cb(null); } catch { /* ignore */ } return; }
    try {
      sdkUnsub = t.onAuth((user) => {
        cachedUser = user || null;
        try { cb(cachedUser); } catch { /* ignore */ }
      });
    } catch {
      try { cb(null); } catch { /* ignore */ }
    }
  })();

  return () => {
    dropped = true;
    authListeners.delete(cb);
    if (typeof sdkUnsub === 'function') { try { sdkUnsub(); } catch { /* ignore */ } }
  };
}

/** Firebase errors are objects with codes; a page needs a sentence. */
function readable(err, fallback) {
  const code = (err && (err.code || err.message)) || '';
  if (/popup-blocked/.test(code)) return 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (/popup-closed|cancelled-popup/.test(code)) return 'Sign-in was closed before it finished.';
  if (/unauthorized-domain/.test(code)) return 'This domain is not on the project\'s Authorised domains list. See docs/firebase-setup.md.';
  if (/permission-denied/.test(code)) return 'That Google account is not the one this league belongs to.';
  if (/resource-exhausted|quota/.test(code)) return 'The Firebase project is over its daily quota. It resets at midnight Pacific.';
  if (/unavailable|network/.test(code)) return 'Could not reach Firebase. The connection may be down.';
  return code ? `${fallback} (${code})` : fallback;
}

// --------------------------------------------------------------------- paths

const enc = (s) => encodeURIComponent(String(s)).replace(/%2F/gi, '_');

/**
 * Has sign-in answered yet? Resolves once the transport has said who is signed
 * in, or that nobody is — a session restored from an earlier visit arrives a
 * moment after the page does, and until then "nobody" is only "not yet".
 *
 * Asked once per transport; the listener stays on, so `cachedUser` follows a
 * later sign-in or sign-out too. Never rejects, and never waits for ever.
 */
function authSettled(t) {
  if (cachedUser) return Promise.resolve();
  if (!authAnswered) {
    authAnswered = new Promise((resolve) => {
      let timer = null;
      const done = () => { if (timer) clearTimeout(timer); resolve(); };
      try {
        t.onAuth((user) => { cachedUser = user || null; done(); });
      } catch {
        done();
      }
      timer = setTimeout(resolve, AUTH_WAIT_MS);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
  }
  return authAnswered;
}

/**
 * Which account's copy is this, as a short string: '' for the owner — and for
 * a project with no owner set, and for nobody signed in — else the uid.
 *
 * Exported for the notes a browser keeps about what it has sent
 * (js/connection.js, js/proj-history.js): '' keeps the keys they have always
 * had, and another account on the same browser gets keys of its own.
 */
export function accountScope(user = currentUser()) {
  if (!user || !user.uid) return '';
  if (!config.ownerUid || user.uid === config.ownerUid) return '';
  return String(user.uid);
}

/**
 * THE ONE PLACE THAT DECIDES WHERE AN ACCOUNT'S LEAGUES LIVE.
 *
 *   the owner            leagues/...                 (never moved, never changed)
 *   any other account    users/{uid}/leagues/...     (private to that account)
 */
function rootOf(user) {
  const uid = accountScope(user);
  return uid ? `users/${enc(uid)}/` : '';
}

function seasonPath(leagueId, season, user) {
  return `${rootOf(user)}leagues/${enc(leagueId)}/seasons/${enc(season)}`;
}

/** The season's path for whoever is signed in — asked only once sign-in has answered. */
async function seasonBase(t, leagueId, season) {
  await authSettled(t);
  return seasonPath(leagueId, season, currentUser());
}

// ------------------------------------------------------------------ profile
//
// Which league this Google account uses, so it is typed ONCE. Sign in on the
// laptop and connect, and every other device that signs in with the same
// account (his iPhone, and the home-screen app, which has storage of its own)
// is connected to the same league and team without asking. One tiny document
// per account, at `users/<uid>`, readable and writable only by that account —
// see firebase/firestore.rules.

function profilePath(uid) {
  return `users/${enc(uid)}`;
}

/**
 * The signed-in account's saved league, or `found: false`. Never throws.
 *
 * @returns {Promise<{ok:boolean, found:boolean, profile:({leagueId:string, season:number|null, teamId:number|null}|null), reason:string}>}
 */
export async function loadProfile() {
  const none = (reason) => ({ ok: false, found: false, profile: null, reason });
  if (!isConfigured()) return none(notConfigured().reason);
  const t = await getTransport();
  if (!t) return none('Could not load Firebase.');
  const user = currentUser() || (typeof t.currentUser === 'function' ? t.currentUser() : null);
  if (!user) return none('Not signed in.');
  try {
    const doc = await t.getDoc(profilePath(user.uid));
    const id = doc && String(doc.leagueId ?? '').trim();
    if (!id || !/^\d+$/.test(id)) return { ok: true, found: false, profile: null, reason: '' };
    return {
      ok: true,
      found: true,
      profile: {
        leagueId: id,
        season: Number.isFinite(Number(doc.season)) && doc.season ? Number(doc.season) : null,
        teamId: doc.teamId == null || doc.teamId === '' ? null : Number(doc.teamId),
      },
      reason: '',
    };
  } catch (err) {
    return none(readable(err, 'Could not read your saved league.'));
  }
}

/**
 * Remember this account's league and team. Demo is refused, like every write.
 *
 * @returns {Promise<{ok:boolean, reason:string}>}
 */
export async function saveProfile({ leagueId, season = null, teamId = null } = {}) {
  if (!isConfigured()) return { ok: false, reason: notConfigured().reason };
  const id = String(leagueId ?? '').trim();
  if (!/^\d+$/.test(id)) return { ok: false, reason: 'Only a real ESPN league is remembered.' };
  const t = await getTransport();
  if (!t) return { ok: false, reason: 'Could not load Firebase.' };
  const user = currentUser() || (typeof t.currentUser === 'function' ? t.currentUser() : null);
  if (!user) return { ok: false, reason: 'Not signed in.' };
  try {
    await t.setDoc(profilePath(user.uid), {
      leagueId: id,
      season: Number(season) || null,
      teamId: teamId == null || teamId === '' ? null : Number(teamId),
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, reason: '' };
  } catch (err) {
    return { ok: false, reason: readable(err, 'Could not save your league.') };
  }
}

// ------------------------------------------------------- the main menu's list
//
//   users/{uid}/menu/leagues
//
// The leagues an account has on its main menu (js/leagues.js `mergeAccount`),
// so a second device shows them without being told. A DOCUMENT OF ITS OWN, and
// that matters: the profile above is written whole, four fields, by every
// build of this site there has ever been — a list kept inside it would be
// erased by the next cached copy of an old page that connected. Packed like
// every other document here; tests/test-accounts.mjs measures one.

function menuPath(uid) {
  return `users/${enc(uid)}/menu/leagues`;
}

/**
 * The signed-in account's list, as it was saved. One read. Never throws.
 *
 * @returns {Promise<{ok:boolean, found:boolean, list:(Object|null), reason:string}>}
 */
export async function loadLeagueList() {
  const none = (reason) => ({ ok: false, found: false, list: null, reason });
  if (!isConfigured()) return none(notConfigured().reason);
  const t = await getTransport();
  if (!t) return none('Could not load Firebase.');
  await authSettled(t);
  const user = currentUser();
  if (!user) return none('Not signed in.');
  try {
    const body = unpack(await t.getDoc(menuPath(user.uid)));
    const found = Boolean(body) && typeof body === 'object' && !Array.isArray(body);
    return { ok: true, found, list: found ? body : null, reason: '' };
  } catch (err) {
    return none(readable(err, 'Could not read your leagues.'));
  }
}

/**
 * Save the signed-in account's list. One write. Never throws.
 *
 * @param {Object} list what js/leagues.js `mergeAccount` made
 * @returns {Promise<{ok:boolean, bytes:number, reason:string}>}
 */
export async function saveLeagueList(list) {
  const no = (reason) => ({ ok: false, bytes: 0, reason });
  if (!isConfigured()) return no(notConfigured().reason);
  if (!list || typeof list !== 'object' || Array.isArray(list)) return no('That is not a list of leagues.');
  const t = await getTransport();
  if (!t) return no('Could not load Firebase.');
  await authSettled(t);
  const user = currentUser();
  if (!user) return no('Not signed in.');
  try {
    const job = pack('menu', 'leagues', list, new Date().toISOString());
    if (job.bytes > MAX_DOC_BYTES) return no('That list is too big to save.');
    await t.setDoc(menuPath(user.uid), job.doc);
    return { ok: true, bytes: job.bytes, reason: '' };
  } catch (err) {
    return no(readable(err, 'Could not save your leagues.'));
  }
}

// ---------------------------------------------------------------- demo guard

/**
 * A real ESPN league id is a number. 'demo' is not, and neither is anything
 * else a page might invent. Checking the SHAPE rather than the literal string
 * 'demo' means a future sample league cannot slip through by being called
 * something else.
 */
function refuseDemo(leagueId, payload) {
  const id = String(leagueId ?? '').trim();
  if (!/^\d+$/.test(id)) {
    return `"${id || '(none)'}" is not a real ESPN league id. Demo data is never synced.`;
  }
  if (payload && payload.isDemo) {
    return 'That is demo data, which is generated rather than observed. It is never synced.';
  }
  return null;
}

// --------------------------------------------------------- chunking the body

/**
 * Split a JSON string into pieces Firestore is happy to index.
 *
 * Splits on a code-point boundary: cutting a surrogate pair in half would put
 * a lone half-character in each piece and rejoining them is only lossless
 * because we never do that. ESPN names are ASCII today; that is not a reason
 * to write something that breaks the day one is not.
 */
function toChunks(str) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    let end = Math.min(i + CHUNK_CHARS, str.length);
    if (end < str.length) {
      const c = str.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) end -= 1; // don't split a surrogate pair
    }
    out.push(str.slice(i, end));
    i = end;
  }
  return out.length ? out : [''];
}

/** Bytes a document will actually occupy, near enough to judge the cap by. */
function byteLength(s) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length; // ancient fallback; never hit
}

/**
 * Wrap a payload as a document body.
 *
 * `kind`, `week` and `syncedAt` stay as plain fields so that a document is
 * self-describing when Tim looks at it in the Firebase console — he will, the
 * first time this does not work — and so `readDown` can date a document it
 * read without unpacking it.
 */
function pack(kind, id, body, syncedAt) {
  const json = JSON.stringify(body);
  const doc = {
    v: SCHEMA,
    kind,
    id: String(id),
    syncedAt,
    chars: json.length,
    json: toChunks(json),
  };
  // Measured on the WHOLE document, not just the body: Firestore's 1 MiB cap
  // is on the document, and the chunk array's own quotes and commas are real
  // bytes. About 12% here, which is not nothing when you are deciding whether
  // you have headroom.
  return { doc, bytes: byteLength(JSON.stringify(doc)) };
}

/** Unpack a document body. Anything unreadable is treated as ABSENT, not as an error. */
function unpack(doc) {
  if (!doc || doc.v !== SCHEMA || !Array.isArray(doc.json)) return null;
  try {
    return JSON.parse(doc.json.join(''));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ shaping a week
//
// `season.js`'s `fetchWeekRosters` hands back each squad three times over:
// `players`, plus `starters` and `bench`, which are THE SAME OBJECTS filtered
// two ways. In memory that costs nothing; stringified it writes every man
// twice, and a week of rosters measures 91 KB that way against 47 KB with the
// duplication removed.
//
// So only `players` goes up, in the order it arrived, with two small arrays of
// INDEXES beside it saying which of them made up each view. That is what makes
// the round trip exact without copying anything out of `season.js` that could
// later drift from it:
//
//   - `starters` is roster order, so an index list reproduces it exactly.
//   - `bench` is sorted best-projection-first — and re-deriving THAT would
//     mean a second copy of season.js's comparator, living in a different
//     file, free to disagree the day either one is touched. Seven integers a
//     squad is a much better price than that.
//   - `players`' own order is preserved too, which a concatenate-and-slice
//     scheme would have quietly changed.
//
// A view member that is somehow not in `players` is appended rather than
// dropped. That cannot happen with what `season.js` produces; losing a player
// silently, if it ever did, would be much worse than a slightly longer array.

function shrinkTeam(team) {
  const players = Array.isArray(team.players) ? [...team.players] : [];
  const at = new Map();
  players.forEach((p, i) => at.set(p, i));

  const indexOf = (p) => {
    if (at.has(p)) return at.get(p);
    players.push(p);
    at.set(p, players.length - 1);
    return players.length - 1;
  };

  const out = {
    ...team,
    players,
    starterIdx: (Array.isArray(team.starters) ? team.starters : []).map(indexOf),
    benchIdx: (Array.isArray(team.bench) ? team.bench : []).map(indexOf),
  };
  delete out.starters;
  delete out.bench;
  return out;
}

function growTeam(team) {
  const players = Array.isArray(team.players) ? team.players : [];
  const view = (idx) => (Array.isArray(idx) ? idx.map((i) => players[i]).filter(Boolean) : []);
  const out = { ...team, players, starters: view(team.starterIdx), bench: view(team.benchIdx) };
  delete out.starterIdx;
  delete out.benchIdx;
  return out;
}

/** Accept a Map or a plain object keyed by week; always work in entries. */
function weekEntries(source) {
  if (!source) return [];
  if (source instanceof Map) return [...source.entries()];
  return Object.entries(source).map(([w, v]) => [Number(w), v]);
}

// ------------------------------------------------------------------- sync up

/**
 * Publish a league to the cloud. Desktop only — this is the machine with the
 * extension, and therefore the only one that can see a private league at all.
 *
 * The WHOLE span goes up, never just the current week. On live data the week
 * controls on the Players, analysis and trade pages buy new weeks with new
 * ESPN requests; on synced data there is nothing to buy, so a sync that pushed
 * only this week would leave those controls silently showing gaps — which is
 * the same "confidently wrong" failure the wire's staleness rule exists to
 * prevent. At about 1.15 MB for thirteen weeks it is entirely affordable.
 *
 * Order is deliberate: every data document first, the meta document LAST. Meta
 * is what `cloudStatus` and `readDown` trust, so it must never promise a week
 * whose document was not written. A sync that dies halfway leaves the previous
 * meta standing over a mix of old and new weeks, which is a gap the reader can
 * see rather than a lie it cannot.
 *
 * @param {string|number} leagueId  a real ESPN league id; demo is refused
 * @param {number} season
 * @param {Object} payload
 * @param {string} payload.leagueName
 * @param {Array}  payload.teams     [{id, name, teamName, abbrev}]
 * @param {Object} [payload.byes]    {proTeamId: week}
 * @param {Object} [payload.schedule] what `season.fetchSchedule` returned
 * @param {Map|Object} [payload.rosters] week -> the teams array for that week
 * @param {Map|Object} [payload.wire]    week -> parseFreeAgent results
 * @param {Map|Object} [payload.decisions] week -> `{ moves, players, draft,
 *   kick, league }` — see "the Decisions review's weeks" below. Sent just
 *   before the index, never failing the sync; the result then carries
 *   `decisions: { wrote, skipped, bytes, largestDoc, marks, reason }`.
 * @param {Object} [opts]
 * @param {(done:number,total:number,label:string)=>void} [opts.onProgress]
 * @param {Object} [opts.decisionsSent] `{ [week]: mark }` from the last sync's
 *   `decisions.marks`; a week whose mark is unchanged is not written again
 * @param {Object} [opts.projhistSent] the last sync's `projhist.marks`; a
 *   copy it names is neither read nor written again
 */
export async function syncUp(leagueId, season, payload = {}, { onProgress, decisionsSent = null, projhistSent = null } = {}) {
  if (!isConfigured()) return notConfigured();

  const refusal = refuseDemo(leagueId, payload);
  if (refusal) return { ok: false, wrote: 0, reason: refusal };

  if (!Number.isFinite(Number(season))) {
    return { ok: false, wrote: 0, reason: 'That is not a season.' };
  }

  const t = await getTransport();
  if (!t) return { ok: false, wrote: 0, reason: 'Could not load Firebase. Check the connection.' };

  await authSettled(t);
  const user = currentUser();
  if (!user) return { ok: false, wrote: 0, reason: 'Sign in with Google before syncing.' };

  const syncedAt = new Date().toISOString();
  // The owner's copy or this account's own (`rootOf`). First copy wins — the
  // frozen Value lines, the saved projections — is settled per copy, because
  // every look-before-write is made under this same path.
  const base = seasonPath(leagueId, season, user);

  // Everything that will be written, built before anything is sent, so a
  // payload that cannot be encoded fails before it has half-replaced what is
  // already up there.
  const jobs = [];

  const rosterWeeks = weekEntries(payload.rosters)
    .filter(([w, teams]) => Number.isFinite(w) && Array.isArray(teams) && teams.length)
    .sort((a, b) => a[0] - b[0]);

  for (const [week, teams] of rosterWeeks) {
    jobs.push({
      path: `${base}/rosters/${enc(week)}`,
      label: `Week ${week} rosters`,
      ...pack('rosters', week, { week, teams: teams.map(shrinkTeam) }, syncedAt),
    });
  }

  const wireWeeks = weekEntries(payload.wire)
    .filter(([w, players]) => Number.isFinite(w) && Array.isArray(players) && players.length)
    .sort((a, b) => a[0] - b[0]);

  for (const [week, players] of wireWeeks) {
    jobs.push({
      path: `${base}/wire/${enc(week)}`,
      label: `Week ${week} wire`,
      ...pack('wire', week, { week, players }, syncedAt),
    });
  }

  const hasSchedule = payload.schedule && Array.isArray(payload.schedule.games);
  if (hasSchedule) {
    // `byWeek` is a Map derived from `games` and is rebuilt on the way down —
    // the same thing `snapshots.hydrate` does with the same data, so this is
    // an established pattern here rather than a new one.
    const { byWeek, ...rest } = payload.schedule;
    jobs.push({
      path: `${base}/parts/schedule`,
      label: 'Schedule',
      ...pack('schedule', 'schedule', rest, syncedAt),
    });
  }

  const oversize = jobs.filter((j) => j.bytes > MAX_DOC_BYTES);
  if (oversize.length) {
    // Should be impossible: the biggest measured document is twenty-five times
    // under this. If it happens, something upstream started carrying ESPN's
    // raw payload, and stopping here is the whole point of measuring.
    return {
      ok: false,
      wrote: 0,
      reason: `${oversize[0].label} is ${Math.round(oversize[0].bytes / 1024)}KB, too close to Firestore's 1MB document limit. Something upstream has changed shape.`,
    };
  }

  const total = jobs.length + 1;
  let wrote = 0;
  let bytes = 0;

  for (const job of jobs) {
    try {
      await t.setDoc(job.path, job.doc);
      wrote++;
      bytes += job.bytes;
    } catch (err) {
      return {
        ok: false,
        wrote,
        bytes,
        reason: readable(err, `Could not write ${job.label}.`),
      };
    }
    if (onProgress) {
      try { onProgress(wrote, total, job.label); } catch { /* ignore */ }
    }
  }

  // The Decisions review's weeks, on their own account: written before the
  // index so the index is still the last thing a sync writes, but nothing they
  // do can fail the sync and they are not counted in `wrote` or `bytes`.
  const decisionWeeks = decisionEntries(payload.decisions);
  const decisions = decisionWeeks.length
    ? await writeDecisions(t, base, decisionWeeks, syncedAt, decisionsSent)
    : null;

  // The projection history's weeks, the same way and for the same reason:
  // before the index, never able to fail the sync, counted nowhere above.
  let projhist = null;
  if (Array.isArray(payload.projhist) && payload.projhist.length) {
    try {
      projhist = await writeProjhist(t, base, payload.projhist.filter(usableCopy), syncedAt, projhistSent);
    } catch {
      projhist = null;
    }
  }

  const meta = {
    v: SCHEMA,
    kind: 'meta',
    id: String(season),
    leagueId: String(leagueId),
    season: Number(season),
    leagueName: payload.leagueName || '',
    teamCount: Array.isArray(payload.teams) ? payload.teams.length : 0,
    syncedAt,
    // Per SHAPE, because they do not decay at the same rate. A page needs to
    // be able to say "these rosters are four days old" while refusing to draw
    // a wire of the same age at all.
    syncedShapes: {
      rosters: rosterWeeks.length ? syncedAt : null,
      wire: wireWeeks.length ? syncedAt : null,
      schedule: hasSchedule ? syncedAt : null,
    },
    weeks: {
      rosters: rosterWeeks.map(([w]) => w),
      wire: wireWeeks.map(([w]) => w),
    },
    json: toChunks(JSON.stringify({
      leagueName: payload.leagueName || '',
      teams: payload.teams || [],
      byes: payload.byes || {},
    })),
  };

  try {
    await t.setDoc(base, meta);
    wrote++;
  } catch (err) {
    return { ok: false, wrote, bytes, reason: readable(err, 'Could not write the league index.') };
  }
  if (onProgress) {
    try { onProgress(wrote, total, 'League index'); } catch { /* ignore */ }
  }

  const result = {
    ok: true,
    wrote,
    bytes,
    syncedAt,
    weeks: { rosters: meta.weeks.rosters, wire: meta.weeks.wire },
    largestDoc: jobs.reduce((m, j) => Math.max(m, j.bytes), 0),
    reason: '',
  };

  // A payload without them leaves this result without the key.
  if (decisions) result.decisions = decisions;
  // Likewise: a browser holding no copy sends none, and has no key here.
  if (projhist) result.projhist = projhist;
  return result;
}

// ------------------------------------------------- the Decisions review's weeks
//
//   leagues/{leagueId}/seasons/{season}/decisions/{week}     ~1–40 KB each
//
// What `season.fetchDecisionWorld` needs beyond the rosters and the schedule,
// one document per DECIDED week: who added, dropped and traded whom, what a man
// on nobody's roster scored, the NFL kickoffs and the league's lineup. Packed
// exactly as a week of rosters is. MEASURED on the public league (1241838),
// read live on 2026-10-05, three decided weeks: 7.4, 6.1 and 6.5 KB — 20.0 KB
// in all, the largest 138 times under the cap, on top of a 1.8 MB sync.
// tests/test-decision-cloud.mjs (`size`) holds an upper bound on it.
//
// ADDITIVE, AND APART. They are addressed by week and are NOT listed in the
// index document, so the index, and every document a copy made before this
// existed holds, is byte for byte what it was. A phone asks for the weeks its
// schedule says are decided; one that is not there is simply absent.
//
// ONLY WHAT CHANGED IS WRITTEN. A decided week's moves never change, so each
// document carries a `mark` (its length and a hash of its text) and a caller
// that hands back the marks of its last sync has only the new weeks sent.
//
// THE WEEK IN PLAY RIDES TOO (Tim, 2026-10-05), as the same document with
// `open: true` in its body, at the path the week will keep. Nothing here treats
// it differently: its mark moves as the week is played, so it is rewritten, and
// the decided week's document replaces it. The READER is what tells them apart
// (js/season.js): an open document is never taken for a decided week's.
//
// A REFUSED WRITE IS SILENT. If the project's rules ever stopped covering this
// path, the sync carries on to its index and reports exactly what it always
// did; the refusal is a `reason` on `result.decisions` and nothing else.
// (firebase/firestore.rules covers it: everything under /leagues for the
// owner, `decisions/{week}` under each other account's own seasons.)

/** A short fingerprint of a document's text: its length and an FNV-1a hash. */
function markOf(json) {
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${json.length}:${(h >>> 0).toString(16)}`;
}

function decisionEntries(source) {
  return weekEntries(source)
    .filter(([w, body]) => Number.isFinite(w) && body && Array.isArray(body.moves) &&
      body.players && typeof body.players === 'object')
    .sort((a, b) => a[0] - b[0]);
}

async function writeDecisions(t, base, entries, syncedAt, sent) {
  const out = { wrote: 0, skipped: 0, bytes: 0, largestDoc: 0, marks: {}, reason: '' };
  const before = sent && typeof sent === 'object' ? sent : {};
  for (const [week, body] of entries) {
    let job;
    try {
      job = pack('decisions', week, { ...body, week }, syncedAt);
    } catch {
      out.reason = out.reason || `Week ${week} decisions could not be encoded.`;
      continue;
    }
    const mark = markOf(job.doc.json.join(''));
    if (before[week] === mark) {
      out.marks[week] = mark;
      out.skipped++;
      continue;
    }
    if (job.bytes > MAX_DOC_BYTES) {
      out.reason = out.reason || `Week ${week} decisions is ${Math.round(job.bytes / 1024)}KB, too big to send.`;
      continue;
    }
    try {
      await t.setDoc(`${base}/decisions/${enc(week)}`, { ...job.doc, mark });
    } catch (err) {
      // Stop at the first refusal: the rest would be refused the same way.
      out.reason = readable(err, `Could not write week ${week} decisions.`);
      break;
    }
    out.marks[week] = mark;
    out.wrote++;
    out.bytes += job.bytes;
    out.largestDoc = Math.max(out.largestDoc, job.bytes);
  }
  return out;
}

/**
 * The Decisions review's weeks, down. One read per week asked for.
 *
 * Never throws. A week that is not up there — every week, on a copy made before
 * this existed — is absent from the Map, and that is the whole report.
 *
 * @param {number[]} weeks the decided weeks
 * @returns {Promise<{ok:boolean, decisions:Map<number,Object>, reads:number, reason:string}>}
 *   each value is `{ week, moves, players, draft, kick, league }`
 */
export async function readDecisions(leagueId, season, weeks = []) {
  const none = (reason) => ({ ok: false, decisions: new Map(), reads: 0, reason });
  if (!isConfigured()) return none(notConfigured().reason);
  if (refuseDemo(leagueId, null)) return none('Demo data is never synced.');
  const t = await getTransport();
  if (!t) return none('Could not reach Firebase.');

  const base = await seasonBase(t, leagueId, season);
  const decisions = new Map();
  let reads = 0;
  const list = [...new Set((weeks || []).map(Number))].filter((w) => Number.isFinite(w));
  for (let i = 0; i < list.length; i += 3) {
    await Promise.all(list.slice(i, i + 3).map(async (week) => {
      let got = null;
      try {
        got = unpack(await t.getDoc(`${base}/decisions/${enc(week)}`));
      } catch {
        got = null; // unreadable is a gap, never an exception
      }
      reads++;
      if (got && Array.isArray(got.moves) && got.players && typeof got.players === 'object') {
        decisions.set(week, got);
      }
    }));
  }
  return { ok: true, decisions, reads, reason: '' };
}

// --------------------------------------------- the projection history's weeks
//
//   leagues/{leagueId}/seasons/{season}/projhist/{week}        a whole copy
//   leagues/{leagueId}/seasons/{season}/projhist/{week}-part   one team's
//   leagues/{leagueId}/seasons/{season}/projhist/index         which are up
//
// Tim, 2026-10-06: "can we make sure that we save it so that we don't lose it
// after every week and it changes?" ESPN overwrites a future week's projection
// in place, so the copy js/proj-history.js keeps each week is the only record
// there is — and it was in one browser's storage. Each copy goes up once,
// packed as a week of rosters is; a real one (1241838, week 5, ten squads,
// weeks 5–17) measures 21 KB.
//
// NO COPY IS EVER REWRITTEN. FIRST COPY WINS in the cloud as it does in the
// browser: a document that is already up is left alone, whoever asks. The
// copy's body is the stored record itself.
//
// A ONE-TEAM COPY (`partial: true` in its body: a week only a schema-2
// reading remembers, which kept the reader's own roster and nobody else's) has
// a document id OF ITS OWN, `<week>-part`. So a whole copy of that week,
// should one turn up later, is written BESIDE it rather than over it, and no
// number is ever replaced or dropped; the reader takes the whole copy first
// (js/proj-history.js). A one-team copy is not sent for a week whose whole copy
// is already up.
//
// THE LIST. The transport has no listing, and a phone must not ask for
// seventeen weeks to learn which three exist. So `projhist/index` names every
// copy that is up, and is the one document here that IS written again, each
// time a copy is added, after the copy itself. If that write fails the copies
// it would have named are left unmarked, and the next sync finds them already
// up and lists them.
//
// WHAT A SYNC COSTS. A copy this browser has marked as up costs nothing. With
// anything unmarked: one read of the list, then per unlisted copy one read (is
// it there?) and at most one write, then one write of the list. In the steady
// state that is one copy a week.
//
// A REFUSAL IS SILENT, as for the Decisions weeks: a `reason` on
// `result.projhist`, and the sync is otherwise what it always was.
// (firebase/firestore.rules covers this path, for the owner and for each
// other account's own copy.)

const PROJHIST_SCHEMA = 1;

const projhistId = (rec) => `${Number(rec.week)}${rec.partial === true ? '-part' : ''}`;

/** A copy in js/proj-history.js's stored shape. Anything else is not sent. */
function usableCopy(rec) {
  return Boolean(rec) && rec.v === PROJHIST_SCHEMA && Number.isFinite(Number(rec.week)) &&
    Array.isArray(rec.weeks) && rec.weeks.length > 0 &&
    Boolean(rec.teams) && typeof rec.teams === 'object' && !Array.isArray(rec.teams);
}

/** What the list says about one copy. */
function listingOf(rec) {
  const out = { week: Number(rec.week), partial: rec.partial === true, takenAt: rec.takenAt || null };
  if (out.partial) out.teams = Object.keys(rec.teams).map(Number);
  return out;
}

/** The list as `{ [id]: listing }`; no list yet is `{}`. Throws what the transport throws. */
async function projhistListed(t, base) {
  const body = unpack(await t.getDoc(`${base}/projhist/index`));
  return body && body.docs && typeof body.docs === 'object' ? body.docs : {};
}

/** Copies the list names that `lacks(week, partial, id)` wants, read three at a time. */
async function projhistFetch(t, base, listed, lacks) {
  const out = { copies: [], reads: 0, missing: 0 };
  const want = Object.entries(listed).filter(([id, e]) => {
    if (!e || !Number.isFinite(Number(e.week))) return false;
    // A one-team copy adds nothing beside the whole copy of its week.
    if (e.partial && listed[String(Number(e.week))]) return false;
    try { return Boolean(lacks(Number(e.week), e.partial === true, id)); } catch { return false; }
  });
  for (let i = 0; i < want.length; i += 3) {
    await Promise.all(want.slice(i, i + 3).map(async ([id]) => {
      let got = null;
      try {
        got = unpack(await t.getDoc(`${base}/projhist/${enc(id)}`));
      } catch {
        got = null; // unreadable is a gap, never an exception
      }
      out.reads++;
      if (usableCopy(got)) out.copies.push(got);
      else out.missing++;
    }));
  }
  out.copies.sort((a, b) => a.week - b.week);
  return out;
}

async function writeProjhist(t, base, copies, syncedAt, sent) {
  const out = { wrote: 0, skipped: 0, reads: 0, bytes: 0, largestDoc: 0, marks: {}, down: [], reason: '' };
  const before = sent && typeof sent === 'object' ? sent : {};

  const pending = [];
  for (const rec of copies) {
    const id = projhistId(rec);
    if (before[id]) {
      out.marks[id] = before[id];
      out.skipped++;
    } else {
      pending.push([id, rec]);
    }
  }
  // Everything marked, and the list read once before: nothing to ask.
  if (before.index) out.marks.index = before.index;
  if (!pending.length && before.index) return out;

  let docs;
  try {
    docs = { ...(await projhistListed(t, base)) };
    out.reads++;
  } catch (err) {
    out.reason = readable(err, 'Could not read the saved projections list.');
    return out;
  }
  out.marks.index = syncedAt;

  const added = [];
  for (const [id, rec] of pending) {
    const mark = rec.takenAt || syncedAt;
    if (docs[id] || (rec.partial === true && docs[String(Number(rec.week))])) {
      // Up already, or (a one-team copy) the whole week is.
      out.marks[id] = (docs[id] && docs[id].takenAt) || mark;
      out.skipped++;
      continue;
    }
    const path = `${base}/projhist/${enc(id)}`;

    // Not in the list is not proof it is not there (a list write can fail):
    // look before writing, because what is there is never written over.
    let there;
    try {
      there = await t.getDoc(path);
      out.reads++;
    } catch (err) {
      out.reason = readable(err, `Could not check week ${rec.week} saved projections.`);
      break;
    }
    if (there) {
      const body = unpack(there);
      if (usableCopy(body)) {
        docs[id] = listingOf(body);
        added.push(id);
        out.marks[id] = body.takenAt || mark;
      } else {
        out.reason = out.reason || `Week ${rec.week} saved projections are up in a form this cannot read; left alone.`;
      }
      out.skipped++;
      continue;
    }

    let job;
    try {
      job = pack('projhist', id, rec, syncedAt);
    } catch {
      out.reason = out.reason || `Week ${rec.week} saved projections could not be encoded.`;
      continue;
    }
    if (job.bytes > MAX_DOC_BYTES) {
      out.reason = out.reason || `Week ${rec.week} saved projections are ${Math.round(job.bytes / 1024)}KB, too big to send.`;
      continue;
    }
    try {
      await t.setDoc(path, job.doc);
    } catch (err) {
      // Stop at the first refusal: the rest would be refused the same way.
      out.reason = readable(err, `Could not write week ${rec.week} saved projections.`);
      break;
    }
    docs[id] = listingOf(rec);
    added.push(id);
    out.marks[id] = mark;
    out.wrote++;
    out.bytes += job.bytes;
    out.largestDoc = Math.max(out.largestDoc, job.bytes);
  }

  if (added.length) {
    try {
      await t.setDoc(`${base}/projhist/index`, pack('projhist-index', 'index', { docs }, syncedAt).doc);
    } catch (err) {
      // Unlisted is unfindable from a phone, so those copies are not marked as
      // done: the next sync finds them up, and lists them.
      for (const id of added) delete out.marks[id];
      out.reason = out.reason || readable(err, 'Could not write the saved projections list.');
    }
  }

  // The list is in hand, so a week it names that this browser does not hold
  // comes down now rather than costing a second look later.
  const held = new Set(copies.map(projhistId));
  const down = await projhistFetch(t, base, docs, (week, partial, id) =>
    !held.has(id) && !(partial && held.has(String(week))));
  out.reads += down.reads;
  out.down = down.copies;
  return out;
}

/**
 * The projection history's copies, down: the list, then each copy it names
 * that the caller lacks.
 *
 * Never throws. A league synced before this existed has no list, and that is
 * `ok: true` with nothing in it, for one read.
 *
 * @param {Object} [opts]
 * @param {(week:number, partial:boolean) => boolean} [opts.lacks] would this
 *   copy add anything here? Default: every copy is wanted.
 * @returns {Promise<{ok:boolean, listed:Object, copies:Object[], reads:number, complete:boolean, reason:string}>}
 *   `complete` is false when a copy the list names could not be read
 */
export async function readProjhist(leagueId, season, { lacks = () => true } = {}) {
  const none = (reason, reads = 0) => ({ ok: false, listed: {}, copies: [], reads, complete: false, reason });
  if (!isConfigured()) return none(notConfigured().reason);
  if (refuseDemo(leagueId, null)) return none('Demo data is never synced.');
  const t = await getTransport();
  if (!t) return none('Could not reach Firebase.');

  const base = await seasonBase(t, leagueId, season);
  let listed;
  try {
    listed = await projhistListed(t, base);
  } catch (err) {
    return none(readable(err, 'Could not read the saved projections list.'), 1);
  }
  const got = await projhistFetch(t, base, listed, lacks);
  return { ok: true, listed, copies: got.copies, reads: 1 + got.reads, complete: got.missing === 0, reason: '' };
}

// ----------------------------------------------------------------- staleness

/** Milliseconds since an ISO timestamp, or null if there is not one. */
export function ageOf(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

/**
 * Is this shape too old to present as current?
 *
 * Null (never synced) counts as stale: "we have no idea how old this is" and
 * "this is old" must not be told apart by accident at the call site.
 */
export function isStale(shape, iso, now = Date.now()) {
  const limit = MAX_AGE[shape];
  if (!limit) return false;
  const age = ageOf(iso, now);
  return age === null || age > limit;
}

/** "4 days ago", for a banner. Plain words; the page decides how loud. */
export function describeAge(iso, now = Date.now()) {
  const age = ageOf(iso, now);
  if (age === null) return 'never';
  const mins = Math.round(age / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * The per-shape report both `cloudStatus` and `readDown` hand back.
 *
 * It is present on EVERY result, including the failures — offline, not signed
 * in, nothing synced. A page that reaches for `ages.wire.stale` must get an
 * answer rather than an exception, because the answer it gets in that case
 * ("stale, never synced") is exactly the one that keeps it from drawing
 * something it should not.
 */
function ageReport(shapes, now) {
  const out = {};
  for (const [shape, iso] of Object.entries(shapes)) {
    out[shape] = {
      syncedAt: iso || null,
      ageMs: ageOf(iso, now),
      described: describeAge(iso, now),
      stale: isStale(shape, iso, now),
    };
  }
  return out;
}

// --------------------------------------------------------------- cloudStatus

/**
 * What is up there, and how old.
 *
 * ONE document read. This is what a page calls on load to decide whether the
 * cloud is worth reading at all, so it must not cost what reading it costs.
 */
export async function cloudStatus(leagueId, season, { now = Date.now() } = {}) {
  const blank = { weeks: { rosters: [], wire: [] }, syncedAt: null, ages: noAges(now) };

  if (!isConfigured()) return { ...blank, ...notConfigured() };
  if (refuseDemo(leagueId, null)) {
    return { ...blank, ok: false, found: false, reason: 'Demo data is never synced.' };
  }

  const t = await getTransport();
  if (!t) return { ...blank, ok: false, found: false, reason: 'Could not reach Firebase.' };

  let meta;
  try {
    meta = await t.getDoc(await seasonBase(t, leagueId, season));
  } catch (err) {
    return { ...blank, ok: false, found: false, reason: readable(err, 'Could not read the league index.') };
  }
  if (!meta || meta.v !== SCHEMA) {
    return {
      ...blank,
      ok: true,
      found: false,
      reason: meta ? `That league was synced by a different version (${meta.v}).` : 'Nothing has been synced for this league yet.',
    };
  }

  const shapes = meta.syncedShapes || { rosters: meta.syncedAt, wire: null, schedule: null };
  const body = unpack(meta) || {};

  return {
    ok: true,
    found: true,
    leagueId: String(leagueId),
    season: Number(season),
    leagueName: meta.leagueName || body.leagueName || '',
    teamCount: meta.teamCount || (body.teams || []).length,
    weeks: meta.weeks || { rosters: [], wire: [] },
    syncedAt: meta.syncedAt || null,
    ages: ageReport(
      { rosters: shapes.rosters, wire: shapes.wire, schedule: shapes.schedule },
      now
    ),
    reason: '',
  };
}

// ------------------------------------------------------------------ read down

/**
 * Pull a league down. Phone, or any browser with no extension.
 *
 * Returns the SAME shapes the live fetchers produce — `rosters` is a
 * `Map<week, teams[]>` exactly as `season.fetchWeeksRosters` returns, and
 * `schedule` carries the `byWeek` Map `fetchSchedule` builds — so a page
 * substitutes rather than growing a second rendering path. A second path is
 * how the cloud would start quietly disagreeing with live about what it is
 * showing, which is precisely the failure the time machine's `hydrate()` was
 * shaped to avoid.
 *
 * A week that is missing is simply absent from the Map. That is the same
 * contract `fetchWeeksRosters` already has for a week ESPN refuses, so callers
 * already handle it.
 *
 * @param {Object} [opts]
 * @param {number[]} [opts.weeks]   only these weeks; default every week synced
 * @param {string[]} [opts.shapes]  any of 'rosters', 'wire', 'schedule'
 */
export async function readDown(leagueId, season, { weeks, shapes, now = Date.now() } = {}) {
  // Every shape a caller might reach for, present on EVERY return including
  // the failures. A page that has to guard each field before drawing is a page
  // that will one day forget to, and the whole rule here is that the absence
  // of the cloud changes nothing about whether a page renders.
  const empty = {
    rosters: new Map(),
    wire: new Map(),
    schedule: null,
    teams: [],
    byes: {},
    leagueName: '',
    missing: [],
    reads: 0,
    syncedAt: null,
    ages: noAges(now),
  };

  if (!isConfigured()) return { ...empty, ...notConfigured() };
  if (refuseDemo(leagueId, null)) {
    return { ...empty, ok: false, found: false, reason: 'Demo data is never synced.' };
  }

  const t = await getTransport();
  if (!t) return { ...empty, ok: false, found: false, reason: 'Could not reach Firebase.' };

  const base = await seasonBase(t, leagueId, season);
  let reads = 0;

  let meta;
  try {
    meta = await t.getDoc(base);
    reads++;
  } catch (err) {
    return { ...empty, ok: false, found: false, reads, reason: readable(err, 'Could not read the league index.') };
  }
  if (!meta || meta.v !== SCHEMA) {
    return {
      ...empty,
      ok: true,
      found: false,
      reads,
      reason: meta ? `That league was synced by a different version (${meta.v}).` : 'Nothing has been synced for this league yet.',
    };
  }

  const want = new Set(
    Array.isArray(shapes) && shapes.length ? shapes : ['rosters', 'wire', 'schedule']
  );
  const only = Array.isArray(weeks) && weeks.length ? new Set(weeks.map(Number)) : null;
  const pick = (list) => (list || []).filter((w) => !only || only.has(Number(w)));

  const body = unpack(meta) || {};
  const out = {
    ok: true,
    found: true,
    leagueId: String(leagueId),
    season: Number(season),
    leagueName: meta.leagueName || body.leagueName || '',
    teams: body.teams || [],
    byes: body.byes || {},
    schedule: null,
    rosters: new Map(),
    wire: new Map(),
    missing: [],
    reason: '',
  };

  // One read per document, run a few at a time. Three is the same width
  // `season.js` uses against ESPN, and it keeps a thirteen-week span from
  // opening thirteen sockets at once on a phone radio.
  const fetchOne = async (path) => {
    try {
      const doc = await t.getDoc(path);
      reads++;
      return unpack(doc);
    } catch {
      reads++;
      return null; // a document we cannot read is a GAP, never an exception
    }
  };

  const runBatched = async (items, fn) => {
    for (let i = 0; i < items.length; i += 3) {
      await Promise.all(items.slice(i, i + 3).map(fn));
    }
  };

  if (want.has('rosters')) {
    await runBatched(pick(meta.weeks && meta.weeks.rosters), async (week) => {
      const got = await fetchOne(`${base}/rosters/${enc(week)}`);
      if (got && Array.isArray(got.teams)) out.rosters.set(Number(week), got.teams.map(growTeam));
      else out.missing.push(`week ${week} rosters`);
    });
  }

  if (want.has('wire')) {
    await runBatched(pick(meta.weeks && meta.weeks.wire), async (week) => {
      const got = await fetchOne(`${base}/wire/${enc(week)}`);
      if (got && Array.isArray(got.players)) out.wire.set(Number(week), got.players);
      else out.missing.push(`week ${week} wire`);
    });
  }

  if (want.has('schedule')) {
    const got = await fetchOne(`${base}/parts/schedule`);
    if (got && Array.isArray(got.games)) {
      // Rebuild `byWeek` rather than storing it: it is a pure regrouping of
      // `games`, and a stored copy is a copy that can disagree.
      const byWeek = new Map();
      for (const g of got.games) {
        if (!byWeek.has(g.week)) byWeek.set(g.week, []);
        byWeek.get(g.week).push(g);
      }
      out.schedule = { ...got, byWeek };
    } else {
      out.missing.push('schedule');
    }
  }

  const s = meta.syncedShapes || {};
  out.reads = reads;
  out.syncedAt = meta.syncedAt || null;
  out.ages = ageReport({ rosters: s.rosters, wire: s.wire, schedule: s.schedule }, now);
  return out;
}
