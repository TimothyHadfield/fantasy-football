// THE NUMBERS SURVIVE NAVIGATING BETWEEN PAGES.
//
// Tim, 2026-09-19: "Accross the cite, when you load something, it loads but
// then goes away and you have to re-load it every time you switch between
// sectoins or whatever. ... I would prefer if it does all the loading and
// checking data with espn as soon as you open up the page or choose to sync it
// with espn, and then it's saved there until you re-load it or something."
//
// He is describing a real property of this site rather than a bug in one page.
// Every page here is a SEPARATE HTML DOCUMENT — there is no router and no
// build step — so every in-memory cache in `js/season.js` is born and dies with
// the document. Walk from Analysis to Trade and the second page re-buys, one
// request per week, exactly the weeks the first one had just finished reading.
// A rest-of-season trade is thirteen of those. Nothing was wrong with any page;
// the cache was simply in the wrong place.
//
// So this is that cache, in `localStorage`, which is the one place on a static
// site that outlives a navigation.
//
// ---------------------------------------------------------------------------
// WHERE IT IS WIRED IN, AND WHY IT IS NOT WIRED IN HERE
//
// `js/season.js` calls it, from inside the same three fetchers the cloud
// substitution already lives in — read the long "THE CLOUD SUBSTITUTION"
// comment at the top of that file, because this obeys the same rule and for the
// same reason: **no page module knows where its numbers came from.** A store
// that pages had to ask for would be six page modules each with its own idea of
// what counts as fresh, each free to drift. The order of preference is
// therefore unchanged except for one step in front of it:
//
//   0. THIS STORE, when it holds the week and the week is still fresh.
//   1. the bridge, 2. the cloud, 3. ESPN directly — exactly as before.
//
// It sits in FRONT of the bridge deliberately. The bridge is live, but a week
// that was read four minutes ago on the page you just came from is the same
// answer, and asking ESPN again for it is the whole of what Tim is complaining
// about.
//
// ---------------------------------------------------------------------------
// THE FRESHNESS RULE, AND WHY IT CANNOT BE ONE TTL
//
// A week has two lives and they decay at completely different rates:
//
//   A PLAYED WEEK NEVER CHANGES AGAIN. Once ESPN has decided the matchup, the
//   rosters as they stood and the points they actually scored are history.
//   There is nothing left in that week for a re-read to discover. It is stored
//   `final: true` and served back at ANY age, for the rest of the season. That
//   is not a cache policy so much as a statement about the data: a cache that
//   expired week 3 in November would be spending a request to be told the same
//   number it already had.
//
//   A WEEK STILL TO BE PLAYED IS A FORECAST, AND FORECASTS MOVE. ESPN revises
//   a future week's per-player projection as injury news lands. So it is stored
//   `final: false` and good for SIX HOURS — `FRESH_MS` — and that number is
//   pinned to something rather than picked: `js/connection.js` syncs to the
//   cloud at most once every six hours, so a desktop reading its own store can
//   never be looking at numbers older than the copy the phone would be handed.
//   It is also short enough that a Sunday-morning reader never sees Thursday's
//   projections, and long enough that an afternoon of clicking between four
//   pages costs nothing at all.
//
//   NEVER READ COUNTS AS STALE. The same rule `js/cloud.js` follows for "never
//   synced": there is no state in which an absent answer reads as a fresh one.
//
// WHICH OF THE TWO A WEEK IS, THIS FILE DOES NOT DECIDE. `js/season.js` tells
// it, from the league SCHEDULE — a week is played when there is a result
// against it, never because of today's date (the same rule the player card's
// Act row follows, and for the same reason: the demo season hardcodes every
// game as played, so a calendar test looks perfectly correct there and is wrong
// everywhere else). **When played-ness is not known, a week is not final.**
// Unknown falls to the six-hour clock, which is the safe direction: the worst
// case is one request nobody needed, against a played week frozen forever on
// numbers that were still moving.
//
// EVERY ENTRY CARRIES `at`, so a page can SAY how old its numbers are. That is
// rule 7 in HANDOFF.md — state the basis of every derived number — and it is
// the whole reason a cache is allowed on this site at all. A stale number that
// cannot be told from a fresh one is worse than no cache.
//
// ---------------------------------------------------------------------------
// KEYED BY LEAGUE, SEASON AND WEEK — ALL THREE
//
// Team ids collide across leagues (HANDOFF rule 9 is the same fact one level
// down), and a player id means a different roster in a different season. Two
// leagues in one browser sharing a week-4 key would serve one league's squads
// to the other, and every number computed from them would look entirely
// plausible. `sourceKey()` patterns already exist in three files for exactly
// this reason.
//
// DEMO IS NEVER STORED. `realLeague()` in season.js is the gate: the sample
// season is generated inside the page, costs nothing, and writing it to disk
// would put a fake league's squads a key away from a real one's.
//
// ---------------------------------------------------------------------------
// SIZE, AND WHAT HAPPENS WHEN IT RUNS OUT
//
// A DECODED week of rosters is about 53 KB — measured by `tests/test-cloud.mjs`
// against a realistic fixture, and it is the shape the pages actually render
// from, not ESPN's raw payload (the megabyte figure in PROGRESS.md is that).
// Seventeen of them is about 900 KB against a budget of roughly 5 MB, so a
// whole season of one league fits comfortably and two do not embarrass it.
//
// WHEN IT DOES RUN OUT, IT EVICTS — IT NEVER THROWS. A `QuotaExceededError`
// means somebody else's data is in the way (an archived reading, another
// season, another league), so the oldest and least valuable entries go and the
// write is tried again. If it still will not fit, the write is abandoned in
// silence and the page behaves exactly as it did before this file existed.
// That is the same rule the cloud follows and the same rule `js/prefs.js`
// follows: **no failure here may stop a page rendering.**

/** Bumped when the stored shape changes; an entry of another schema is absent. */
const SCHEMA = 1;

const PREFIX = `ff.weeks.${SCHEMA}`;

/**
 * How long a week that is still to be PLAYED is good for.
 *
 * Six hours, pinned to `js/connection.js`'s sync interval rather than chosen —
 * see the freshness note above. A played week ignores this entirely.
 */
export const FRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Storage, or null.
 *
 * Some browsers expose the object and throw on use (private windows, blocked
 * site data), so this proves it works rather than trusting it to exist. The
 * test harnesses hand the page a hand-written stub with only four methods on
 * it, which is enough to pass this probe and is deliberately still enough to
 * work: `keys()` below is what copes with a stub that has no `length`.
 */
function store() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = `${PREFIX}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function available() {
  return store() !== null;
}

const keyOf = (leagueId, season, week) => `${PREFIX}.${leagueId}.${season}.${week}`;

/**
 * Every key this module owns, in whatever order the browser lists them.
 *
 * A HARNESS STUB WITHOUT `length`/`key(i)` COMES BACK EMPTY RATHER THAN
 * THROWING, and that is not a courtesy — `tests/README.md` records an hour lost
 * to exactly this: the suites' `localStorage` implements only
 * `getItem`/`setItem`/`removeItem`, real `Storage` also has `length` and
 * `key(i)`, and a module that assumed the second silently did nothing. Here it
 * means eviction and `forget()` find nothing to work on, which is correct in a
 * harness that has nothing to evict, while reading and writing still work.
 */
function keys() {
  const s = store();
  if (!s) return [];
  if (typeof s.length !== 'number' || typeof s.key !== 'function') return [];
  const out = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(`${PREFIX}.`)) out.push(k);
    }
  } catch {
    return [];
  }
  return out;
}

/** One entry, parsed, or null. Anything unreadable is treated as absent. */
function entryAt(s, key) {
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const e = JSON.parse(raw);
    if (!e || e.v !== SCHEMA || !Array.isArray(e.teams)) return null;
    return e;
  } catch {
    return null;
  }
}

/** Is this entry still worth serving? See the freshness rule at the top. */
function fresh(e, now) {
  if (!e) return false;
  if (e.final) return true;                    // a played week cannot change
  if (!Number.isFinite(e.at)) return false;    // no timestamp is not a fresh one
  return now - e.at < FRESH_MS;
}

/**
 * One week's decoded teams, or null when there is nothing fresh to serve.
 *
 * Returns the AGE alongside, always, because the caller has to be able to say
 * how old the numbers are. A caller that wanted the teams and ignored the
 * timestamp would be exactly the stale-number-looking-fresh failure the whole
 * file is arranged to prevent.
 *
 * @returns {{teams:Array, at:number, final:boolean, ageMs:number}|null}
 */
export function readWeek(leagueId, season, week) {
  const s = store();
  if (!s) return null;
  const now = Date.now();
  const e = entryAt(s, keyOf(leagueId, season, week));
  if (!fresh(e, now)) return null;
  return { teams: e.teams, at: e.at, final: !!e.final, ageMs: Math.max(0, now - e.at) };
}

/**
 * Keep one week's decoded teams.
 *
 * `final` is the caller's answer to "has this week been played", and it is a
 * fact about the SCHEDULE, never about the date — see the note at the top.
 * Unknown must be passed as false.
 *
 * @returns {boolean} whether it actually landed. Nothing depends on the answer;
 *   it exists so a test can tell "stored" from "silently dropped".
 */
export function writeWeek(leagueId, season, week, teams, { final = false } = {}) {
  const s = store();
  if (!s || !Array.isArray(teams) || !teams.length) return false;

  const key = keyOf(leagueId, season, week);
  let json;
  try {
    json = JSON.stringify({ v: SCHEMA, at: Date.now(), final: !!final, teams });
  } catch {
    return false; // a shape that will not serialise is not a shape to keep
  }

  try {
    s.setItem(key, json);
    return true;
  } catch {
    // FULL. Evict and try once more; never throw, and never let this reach the
    // page. See the size note at the top.
    if (!evictFor(json.length, `${PREFIX}.${leagueId}.${season}.`)) return false;
    try {
      s.setItem(key, json);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Make room, cheapest entries first.
 *
 * THE ORDER IS A JUDGEMENT AND IT IS WRITTEN DOWN RATHER THAN LEFT IN THE SORT:
 *
 *   1. weeks belonging to ANOTHER league or season go first. They are the least
 *      likely to be wanted next — a browser that has changed league has changed
 *      it — and dropping one costs a request only if he changes back.
 *   2. then this league's NON-FINAL weeks, oldest first. They were going to
 *      expire anyway; this only brings the expiry forward.
 *   3. PLAYED WEEKS ARE EVICTED LAST, and that is the whole point of the
 *      ordering. A played week is the only thing in here that can never be
 *      re-derived cheaply for a second time later in the season, and it is also
 *      the only thing that is never wrong.
 *
 * It stops as soon as it has freed more than the write needs, with a little
 * slack, rather than clearing the lot: a full browser is usually full because
 * of something else.
 */
function evictFor(needBytes, mineKeyPrefix) {
  const s = store();
  if (!s) return false;
  const all = keys();
  if (!all.length) return false;

  const rows = [];
  for (const k of all) {
    const e = entryAt(s, k);
    const raw = (() => { try { return s.getItem(k) || ''; } catch { return ''; } })();
    rows.push({
      k,
      bytes: raw.length,
      at: e && Number.isFinite(e.at) ? e.at : 0,
      // A key we cannot parse is rank 0: it is bytes doing nothing for anybody.
      rank: !e ? 0 : (!k.startsWith(mineKeyPrefix) ? 1 : (e.final ? 3 : 2)),
    });
  }
  rows.sort((a, b) => a.rank - b.rank || a.at - b.at);

  let freed = 0;
  const want = needBytes * 2 + 4096; // slack: UTF-16, plus the browser's own overhead
  for (const r of rows) {
    try { s.removeItem(r.k); } catch { /* one stubborn key must not stop the rest */ }
    freed += r.bytes;
    if (freed >= want) break;
  }
  return freed > 0;
}

/**
 * What this browser is holding for one league and season, week first.
 *
 * The one honest answer to "how old are these numbers", and it is a list rather
 * than a single timestamp for the same reason `js/cloud.js` tracks staleness
 * per shape and never flattens it: a season where weeks 1–4 are frozen history
 * and week 9 was read two minutes ago has no single age, and inventing one
 * would be a number nobody could check.
 *
 * @returns {Array<{week:number, at:number, final:boolean, ageMs:number, fresh:boolean}>}
 */
export function list(leagueId, season) {
  const s = store();
  if (!s) return [];
  const now = Date.now();
  const want = `${PREFIX}.${leagueId}.${season}.`;
  const out = [];
  for (const k of keys()) {
    if (!k.startsWith(want)) continue;
    const week = Number(k.slice(want.length));
    if (!Number.isFinite(week)) continue;
    const e = entryAt(s, k);
    if (!e) continue;
    out.push({
      week,
      at: e.at,
      final: !!e.final,
      ageMs: Math.max(0, now - (Number.isFinite(e.at) ? e.at : now)),
      fresh: fresh(e, now),
    });
  }
  return out.sort((a, b) => a.week - b.week);
}

/**
 * Throw one league-season's weeks away — the FORCE A FRESH READ half of Tim's
 * ask ("until you re-load it or something").
 *
 * It takes the played weeks with it, unfinal or not. That is deliberate: this
 * is what somebody presses when they think the numbers are wrong, and a
 * "refresh" that quietly kept two thirds of what it was refreshing is the kind
 * of half-answer that makes a reader stop trusting the button.
 *
 * @returns {number} how many weeks went
 */
export function forget(leagueId, season) {
  const s = store();
  if (!s) return 0;
  const want = season === undefined || season === null
    ? `${PREFIX}.${leagueId}.`
    : `${PREFIX}.${leagueId}.${season}.`;
  let gone = 0;
  for (const k of keys()) {
    if (!k.startsWith(want)) continue;
    try { s.removeItem(k); gone++; } catch { /* leave it and carry on */ }
  }
  return gone;
}

/**
 * "4 minutes ago" / "just now" — the one spelling of an age on this site's
 * stored weeks, so three panels cannot describe the same timestamp three ways.
 *
 * Deliberately coarse above an hour. "3 hours ago" is the answer to the
 * question somebody is actually asking ("is this from before the injury news");
 * "3 hours 12 minutes ago" is a precision the number does not have, since the
 * weeks were read a few seconds apart and the reader is told one age for all of
 * them.
 */
export function describeAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return 'a minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return 'an hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
