// Turns a real ESPN league into the same shape demo.js produces, so the stats
// page doesn't care where its numbers came from.
//
// Actual scores are easy — ESPN hands them to us per matchup.
//
// Weekly PROJECTED totals are not. ESPN never stores "what was this team
// projected to score in week 4"; it only stores per-player projections. So we
// refetch each week's rosters and re-add the projections of whoever was in the
// starting lineup that week. That is what the ESPN site itself displays, but it
// costs one request per week.
//
// It is also the file that decides where a page's numbers come from at all —
// live ESPN, the copy the desktop synced for the phone, or the weeks this
// browser already read on the page you just came from. See THE CLOUD
// SUBSTITUTION and THE LOCAL STORE below; no page module knows the difference,
// which is the point.

import * as espn from './espn.js';
import * as bridge from './bridge.js';
import * as cloud from './cloud.js';
import * as capture from './capture.js';
// The positional floor's RULES are pure and live here; `fetchFloors` below is
// the one read that feeds them. See js/floor.js.
import * as floor from './floor.js';
// The weeks this browser has already read, kept across a navigation. See
// js/store.js for the freshness rule and THE LOCAL STORE below for the seam.
import * as store from './store.js';

const BENCH_SLOT = 20;
const IR_SLOT = 21;

// ===========================================================================
// THE CLOUD SUBSTITUTION
// ===========================================================================
//
// WHY IT IS IN THIS FILE AND NOT IN THE PAGES.
//
// Tim's league is private, so it can only be read through the bridge
// extension, and no phone browser can install one. `js/cloud.js` is the answer
// — the desktop publishes the league, the phone reads it back — but a cloud
// that pages had to ASK for would mean six page modules each learning when to
// prefer it, each with its own idea of what "no extension" means, and each
// free to drift. That is the defect the house style keeps naming: two ways of
// getting the same thing is how the two halves start disagreeing.
//
// So the seam is here, in the three functions every page already calls.
// `readDown` was built to return EXACTLY the shapes below produce — `rosters`
// as a `Map<week, teams[]>`, `schedule` carrying the `byWeek` Map — precisely
// so this could be a SUBSTITUTION rather than a second rendering path. It is
// the same decision `snapshots.hydrate()` made for the time machine, for the
// same reason: the whole page travels together, and a synced week cannot drift
// into looking different from a live one.
//
// The upshot is that NO PAGE MODULE CHANGED. Every page works on the phone
// because every page already goes through here.
//
// THE ORDER OF PREFERENCE, and why it is this way round:
//
//   1. The bridge, whenever it is there. It is live, and it is the only one of
//      the two that can read a private league at all. When it is present the
//      cloud is not read — not even checked — so a desktop pays nothing.
//   2. The cloud, when the bridge is absent AND a sync exists for this exact
//      league and season. ESPN is not tried first: on the device this is for,
//      ESPN cannot answer, so trying would buy a guaranteed failed request and
//      a visible stall on every single week.
//   3. ESPN directly, exactly as before. A public league nobody has synced is
//      untouched by all of this, and so is demo.
//
// EVERY FAILURE IS SILENT. Not configured (which is the normal case until Tim
// finishes `docs/firebase-setup.md`), not signed in, offline, over quota, a
// document that will not parse — all of them come back as "no cloud" and the
// page behaves exactly as it does today. Same rule as `snapshots.fetchRemote`.

// ===========================================================================
// THE LOCAL STORE
// ===========================================================================
//
// Tim, 2026-09-19: "when you load something, it loads but then goes away and
// you have to re-load it every time you switch between sectoins".
//
// Every page of this site is a separate HTML document, so every cache above
// dies on every navigation and the next page re-buys the same weeks from ESPN,
// one request each. `js/store.js` is that cache moved into `localStorage`,
// where it outlives a navigation, and it is wired in HERE for the same reason
// the cloud is: **no page module may know where its numbers came from.**
//
// It goes in FRONT of everything, the bridge included. A week read four minutes
// ago on the page you just came from is the same answer, and buying it again is
// the whole of what he is complaining about.
//
//   0. the local store, for a week it holds that is still fresh
//   1. the bridge  2. the cloud  3. ESPN directly — all exactly as before
//
// THE FRESHNESS RULE IS NOT ONE TTL, and js/store.js carries the argument: a
// PLAYED week never changes again and is kept for the season; a week still to
// come is a forecast that ESPN revises, and is good for six hours. Which of the
// two a week is, is decided HERE, off the league SCHEDULE — see `markPlayed`
// below — because this is the file that reads the schedule and the store is
// pure. Unknown is never "final".
//
// EVERY FAILURE IS SILENT, exactly as above: no store, a full store, an entry
// that will not parse — all of them mean the fetchers do what they have always
// done. A page must never fail to render because a cache was unhappy.

/**
 * Which weeks have a result against them, learned from the schedule.
 *
 * `week -> true` once `fetchSchedule` has been through, keyed by league and
 * season so another league's answer cannot be read as this one's. It is the
 * ONE thing that decides whether a stored week is frozen history or a forecast
 * with six hours on it, and it is a fact about the SCHEDULE rather than about
 * today's date — the same rule `isDecidedEntry` applies and the player card's
 * Act row follows, because the demo season hardcodes every game as played and a
 * calendar test looks perfectly correct there while being wrong everywhere
 * else.
 *
 * UNKNOWN IS NOT FINAL. A page that fetches a week before it has read the
 * schedule stores it on the six-hour clock, which costs at worst one request
 * nobody needed — against a played week frozen for the season on numbers that
 * were still moving, which is the failure worth avoiding.
 */
const playedSeen = new Map(); // `${leagueId}::${season}` -> Set<week>

function markPlayed(games) {
  const { leagueId, season } = espn.getConfig();
  if (!realLeague(leagueId)) return;
  const key = `${leagueId}::${season}`;
  const set = playedSeen.get(key) || new Set();
  for (const g of games || []) if (g && g.played) set.add(Number(g.week));
  playedSeen.set(key, set);
}

function weekIsFinal(week) {
  const { leagueId, season } = espn.getConfig();
  const set = playedSeen.get(`${leagueId}::${season}`);
  return !!(set && set.has(Number(week)));
}

/**
 * Is this league allowed on disk at all?
 *
 * Demo is not, and never will be: the sample season is generated inside the
 * page, costs nothing to make, and writing it to storage would put a fake
 * league's squads one key away from a real one's.
 */
function storable() {
  const { leagueId, season } = espn.getConfig();
  return realLeague(leagueId) ? { leagueId, season } : null;
}

/**
 * What this browser is holding, and how old it is.
 *
 * Exported so a page can SAY it — rule 7 in HANDOFF.md, and the entire reason a
 * cache is allowed on this site: a stale number that cannot be told from a
 * fresh one is worse than no cache at all. It is a LIST rather than one
 * timestamp, because a season where weeks 1–4 are frozen history and week 9 was
 * read two minutes ago has no single age.
 *
 * Reading this does not change what any fetcher returns, so a page that ignores
 * it is byte-for-byte the page it was — which is what keeps "no page module
 * knows where its numbers came from" true while still letting one say so.
 */
export function storedWeeks() {
  const cfg = storable();
  return cfg ? store.list(cfg.leagueId, cfg.season) : [];
}

/**
 * THROW THE STORED WEEKS AWAY — the "force a fresh read" half of his ask.
 *
 * "or choose to sync it with espn" / "until you re-load it". Pressing **Sync**
 * in the connection bar already does this by another route: `buildCloudPayload`
 * below re-reads every week from ESPN with `fresh: true` and writes what it
 * gets back over the top, so the store cannot be older than the last sync. This
 * is the same thing without the upload, for a page that wants to re-read
 * without publishing.
 */
export function forgetStored() {
  const cfg = storable();
  if (cfg) store.forget(cfg.leagueId, cfg.season);
}

/** Re-exported so a page can print an age without importing the store itself. */
export const describeAge = store.describeAge;

/**
 * How many free agents a wire document holds, and the default a caller of
 * `fetchWireWeek` gets.
 *
 * It is deliberately NOT the Players page's own number: that page asks for 100,
 * and the sync stores 150 so a page asking for any number up to that can be
 * served from the cloud. `fetchWireWeek` slices the synced list to whatever
 * limit it was asked for, which is what keeps a phone and a desktop listing the
 * same men — a phone showing 150 where the desktop showed 100 would be a quiet
 * disagreement about what the wire is.
 */
const WIRE_LIMIT = 150;

/**
 * ONE `readDown` per league per page load, shared by all three fetchers.
 *
 * A page calls `fetchSchedule` and then `fetchWeeksRosters`; asking the cloud
 * twice would double the document reads for nothing. Keyed by league+season so
 * that connecting to a different league cannot be served the old one's cache.
 */
let downCache = null; // { key, promise }

/** A real ESPN league id is a number. 'demo' is not, and neither is ''. */
function realLeague(leagueId) {
  return /^\d+$/.test(String(leagueId ?? '').trim());
}

/**
 * The synced league, or null when there is no cloud to speak of.
 *
 * Never throws and never rejects: every caller below treats null as "carry on
 * exactly as before", which is what makes the cloud's absence a non-event.
 */
function cloudDown() {
  // Decided only once the extension has had its chance to say hello: asked any
  // earlier, "no bridge" is merely "not yet", and the page would read the cloud
  // (or ESPN directly) on a desktop that has the extension. See bridge.settled.
  return bridge.settled().then(cloudDownNow);
}

function cloudDownNow() {
  // The bridge is live data and it is the only thing that reads a private
  // league. If it is here, the cloud is not even asked — this is what makes
  // "with the extension, zero cloud reads" true rather than merely likely.
  if (bridge.isAvailable()) return Promise.resolve(null);
  if (!cloud.isConfigured()) return Promise.resolve(null);

  const { leagueId, season } = espn.getConfig();
  if (!realLeague(leagueId)) return Promise.resolve(null);

  const key = `${leagueId}::${season}`;
  if (!downCache || downCache.key !== key) {
    const entry = { key, promise: null };
    // A HIT is cached for the life of the page — a page calls `fetchSchedule`
    // and then `fetchWeeksRosters`, and asking the cloud twice would double
    // the document reads to be told the same thing.
    //
    // A MISS IS NOT CACHED, and that asymmetry matters. Signing in is what
    // turns a miss into a hit, and on a phone it happens after the first page
    // load as often as before it — a remembered "no" would leave every page on
    // demo data until a reload, with a bar above them saying the league was
    // connected. The cost of not remembering is one index read per call on a
    // device with nothing synced, against a daily allowance of fifty thousand.
    //
    // 'wire' is deliberately not asked for here. Most pages never touch it, and
    // the one that does (Players) goes through `fetchWireWeek` below, which
    // makes its own read for exactly the week it wants. Asking here would be
    // thirteen document reads a page load that nothing renders.
    entry.promise = Promise.resolve()
      .then(() => cloud.readDown(leagueId, season, { shapes: ['rosters', 'schedule'] }))
      .then((res) => {
        const found = res && res.ok && res.found ? res : null;
        if (!found && downCache === entry) downCache = null;
        return found;
      })
      .catch(() => {
        if (downCache === entry) downCache = null;
        return null;
      });
    downCache = entry;
  }
  return downCache.promise;
}

/**
 * What the cloud is serving this page, or null — with `ages` on it.
 *
 * The one honest answer to "where did these numbers come from", shared with the
 * fetchers rather than worked out again, so nothing can say one thing while the
 * page draws another. `js/connection.js` does its own single-document probe
 * instead of calling this: the bar needs the league's identity before any page
 * has fetched anything, and it needs one read rather than fifteen to get it.
 */
export function cloudSource() {
  return cloudDown();
}

/**
 * Sum the projected points of every starter on a roster for one week.
 */
function projectedTotalForWeek(teamEntry, week) {
  let total = 0;
  for (const e of teamEntry.roster?.entries || []) {
    if (e.lineupSlotId === BENCH_SLOT || e.lineupSlotId === IR_SLOT) continue;

    const stats = e.playerPoolEntry?.player?.stats || [];
    const projected = stats.find(
      (s) => s.scoringPeriodId === week && s.statSourceId === 1
    );
    if (projected && typeof projected.appliedTotal === 'number') {
      total += projected.appliedTotal;
    }
  }
  return total;
}

/**
 * Run promises a few at a time so we don't fire 18 requests at ESPN at once.
 */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

/**
 * One week's rosters for every team, with each player's slot and points.
 *
 * Rosters genuinely change week to week — trades, waivers, injuries — so this
 * has to be fetched per week rather than derived from a season snapshot.
 *
 * THE BYE RULE is applied here, once, for the roster shape: a player whose NFL
 * team is on bye this week is projected at exactly 0 (see
 * `espn.byeAdjustedProjection` for why ESPN's own number cannot be trusted for
 * a D/ST). The byes come from `fetchByeWeeks()`, cached for the page; a caller
 * fetching many weeks passes them in so they are read once. A failed or empty
 * bye read leaves every projection exactly as ESPN sent it.
 *
 * @param {number} week scoring period
 * @param {Object} [opts]
 * @param {Object} [opts.byes] `{proTeamId: byeWeek}`, already read
 * @param {boolean} [opts.fresh] skip the local store and re-read from source.
 *   This is what makes **Sync** in the connection bar a force-refresh: see
 *   `buildCloudPayload`, which is the only caller that passes it.
 * @returns {{week, teams, from}} `from` is 'store' | 'cloud' | 'espn' — which
 *   source answered, so a page can count REQUESTS rather than weeks and state a
 *   cost that is true. Nothing else reads it, and a caller that ignores it gets
 *   exactly what it always got.
 */
export async function fetchWeekRosters(week, { byes, fresh = false } = {}) {
  // THE LOCAL STORE FIRST, ahead of the bridge — see "THE LOCAL STORE" above.
  // A week this browser read on the page you just came from is the same answer,
  // and it is the re-buying of it that Tim asked to be rid of. A week that is
  // absent, stale or unreadable simply falls through to everything below,
  // exactly as if this block were not here.
  //
  // TWO KINDS OF HELD WEEK ARE REFUSED, and each for a fact learned since it
  // was written (AUDIT §2.4, §2.5):
  //
  //   A FORECAST FOR A WEEK THAT HAS SINCE BEEN DECIDED. Read before kickoff,
  //   stored on the six-hour clock, then ESPN put a result against it: serving
  //   it would present pre-kickoff lineups as the week's history. It is re-read,
  //   and the re-read is stored final.
  //
  //   A WEEK DECODED WITHOUT THE BYES, once the byes ARE known. A failed bye
  //   read leaves projections as ESPN sent them (rule 2), which for a D/ST in
  //   its own bye week is a few invented-looking points. Re-reading while the
  //   byes are still unknown would buy the same answer, so it is served until
  //   they are known — and then bought once, with the bye rule applied. If that
  //   re-read fails, the held week is still better than a gap: it is exactly
  //   what a bye-less read would have produced anyway.
  const cfg = storable();
  let byeMap = byes && typeof byes === 'object' ? byes : null;
  let fallback = null;
  if (cfg && !fresh) {
    const held = store.readWeek(cfg.leagueId, cfg.season, week);
    if (held && held.teams.length) {
      const decidedSince = !held.final && weekIsFinal(week);
      let byesArrived = false;
      if (!decidedSince && !held.byesKnown) {
        if (!byeMap) byeMap = await fetchByeWeeks();
        byesArrived = byesAreKnown(byeMap);
      }
      const served = { week: Number(week), teams: held.teams, from: 'store' };
      if (!decidedSince && !byesArrived) return served;
      if (byesArrived) fallback = served;
    }
  }

  // The synced copy next when there is no bridge — see "THE CLOUD
  // SUBSTITUTION" at the top. A week the cloud does not hold falls through to
  // ESPN rather than being reported as empty: on a public league that still
  // works, and on a private one the page gets the same error it gets today.
  // A synced week was decoded — bye rule included — on the desktop.
  const down = await cloudDown();
  const synced = down && down.rosters instanceof Map ? down.rosters.get(Number(week)) : null;
  if (synced && synced.length) {
    // Kept, because the phone that reads the cloud is the device most likely to
    // walk between four pages on one connection — and a synced week is already
    // a copy, so storing it costs nothing but the bytes.
    // The desktop decoded it with the byes it published alongside, so those say
    // whether the bye rule was applied.
    if (cfg) {
      store.writeWeek(cfg.leagueId, cfg.season, week, synced,
        { final: weekIsFinal(week), byesKnown: byesAreKnown(down.byes) });
    }
    return { week: Number(week), teams: synced, from: 'cloud' };
  }

  let raw;
  try {
    [raw, byeMap] = await Promise.all([
      espn.fetchRosters(week),
      byeMap || fetchByeWeeks(),
    ]);
  } catch (err) {
    if (fallback) return fallback;
    throw err;
  }
  const season = espn.getConfig().season;
  // Who each squad actually belongs to. `fetchRosters` asks for mRoster+mTeam,
  // and mTeam is what makes ESPN populate the member name fields — see
  // `teamIdentity()` in espn.js. A payload without members degrades to the
  // ESPN team name, which is what this returned before.
  const names = espn.memberNames(raw);

  const teams = (raw.teams || []).map((t) => {
    const players = (t.roster?.entries || []).map((e) => {
      const p = e.playerPoolEntry?.player || {};
      const stats = p.stats || [];

      const find = (sourceId, weekly) =>
        stats.find((s) =>
          weekly
            ? s.scoringPeriodId === week && s.statSourceId === sourceId
            : s.seasonId === season && s.statSourceId === sourceId && s.statSplitTypeId === 0
        );

      const weekProj = find(1, true);
      const weekActual = find(0, true);
      const seasonProj = find(1, false);

      return {
        playerId: e.playerId,
        name: p.fullName || '',
        position: espn.POSITIONS[p.defaultPositionId] || 'UNK',
        proTeam: espn.PRO_TEAMS[p.proTeamId] ?? 'FA',
        // Kept as well as the abbreviation because bye weeks come back keyed by
        // this id, and re-deriving it from the abbreviation would break on the
        // seasons where ESPN changes its own casing.
        proTeamId: p.proTeamId ?? null,
        lineupSlotId: e.lineupSlotId,
        slot: espn.SLOT_LABELS[e.lineupSlotId] ?? String(e.lineupSlotId),
        started: e.lineupSlotId !== BENCH_SLOT && e.lineupSlotId !== IR_SLOT,
        // ESPN's number, except in his team's bye week, which is exactly 0.
        projected: espn.byeAdjustedProjection(weekProj?.appliedTotal ?? null, p.proTeamId ?? null, week, byeMap),
        actual: weekActual?.appliedTotal ?? null,
        seasonProjected: seasonProj?.appliedTotal ?? null,
        injuryStatus: p.injuryStatus || 'ACTIVE',
        percentOwned: p.ownership?.percentOwned ?? null,
      };
    });

    const starters = players.filter((p) => p.started);
    // ESPN returns bench entries in roster order, which looks random on screen.
    // Best projection first matches what the demo data already does.
    const bench = players
      .filter((p) => !p.started)
      .sort((a, b) => (b.projected ?? -Infinity) - (a.projected ?? -Infinity));

    // Before kickoff every actual is null. Summing those as 0 would report a
    // real-looking 0.0 for the team and a Diff of minus the whole projection,
    // so a team row would claim data the player rows correctly show as "—".
    const total = (arr, key) => {
      const vals = arr.map((p) => p[key]).filter((v) => typeof v === 'number');
      if (!vals.length) return null;
      return Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10;
    };

    return {
      id: t.id,
      ...espn.teamIdentity(t, names),
      abbrev: t.abbrev || '',
      players,
      starters,
      bench,
      projectedTotal: total(starters, 'projected'),
      actualTotal: total(starters, 'actual'),
      benchActualTotal: total(bench, 'actual'),
      seasonProjectedTotal: total(starters, 'seasonProjected'),
    };
  });

  // Kept for the next page. `final` is read off the SCHEDULE, never off the
  // date — see `weekIsFinal` — and a week whose played-ness nobody has
  // established yet is stored as a forecast, which is the safe direction.
  // `byesKnown` records whether the bye rule could be applied (AUDIT §2.4).
  if (cfg && teams.length) {
    store.writeWeek(cfg.leagueId, cfg.season, week, teams,
      { final: weekIsFinal(week), byesKnown: byesAreKnown(byeMap) });
  }

  return { week, teams, from: 'espn' };
}

/**
 * Rosters for several weeks at once, keyed by week.
 *
 * ESPN really does publish a per-player projection for every future week — a
 * week-13 number is available in week 1, and a player on bye that week comes
 * back as 0.00 — except a D/ST, which ESPN projects at a few points in its bye,
 * so the byes ARE read (once, here) and `fetchWeekRosters` zeroes that week.
 * Otherwise it is what the ESPN site shows when you page a lineup forward.
 *
 * It costs one request per week; there is no bulk form. Runs a few at a time so
 * a 13-week season does not open thirteen sockets at once, and a week ESPN
 * refuses is simply absent from the result rather than failing the whole set.
 *
 * Since 2026-09-19 a week may also come out of `js/store.js` — this browser's
 * own copy, kept across a navigation — in which case it costs nothing either.
 * `onProgress` says WHICH source answered, so a page can state a cost that is
 * true rather than counting a cache hit as a request.
 *
 * @param {number[]} weeks
 * @param {function} [onProgress] (done, total, week, from) — `from` is
 *   'store' | 'cloud' | 'espn' | 'gap'. Existing callers take three arguments
 *   and are untouched.
 * @param {boolean} [fresh] re-read from source, ignoring the local store
 * @returns {Promise<Map<number, Array>>} week -> the teams array for that week
 */
export async function fetchWeeksRosters(weeks, { onProgress, fresh = false } = {}) {
  const out = new Map();
  let done = 0;

  // The whole span comes down in ONE read of the cloud, so this costs no
  // requests at all. `onProgress` is still called for every week: the pages
  // clear their "reading week n of m" line when it reaches the end, and a
  // progress line that never finishes is worse than no progress line.
  //
  // Only taken when the cloud actually holds one of the weeks asked for — a
  // sync that carried nothing but a schedule must not turn every roster week
  // into a silent gap.
  const down = await cloudDown();
  if (down && down.rosters instanceof Map && weeks.some((w) => down.rosters.has(Number(w)))) {
    const cfg = storable();
    for (const week of weeks) {
      const teams = down.rosters.get(Number(week));
      if (teams && teams.length) {
        out.set(Number(week), teams);
        if (cfg) {
          store.writeWeek(cfg.leagueId, cfg.season, week, teams,
            { final: weekIsFinal(week), byesKnown: byesAreKnown(down.byes) });
        }
      }
      done++;
      if (onProgress) onProgress(done, weeks.length, week, teams && teams.length ? 'cloud' : 'gap');
    }
    return out;
  }

  // THE STORE IS ASKED PER WEEK, not in one pass up here, because it is
  // `fetchWeekRosters` that owns the decision — one place decides what is fresh
  // and what is final, or this file grows a second copy of the rule that is
  // free to disagree with the first. What this loop does own is the honest
  // REPORT of which source answered, which is how the Trade page's cost line
  // can say "four requests" when it read thirteen weeks.
  //
  // The byes once for the whole span — a failed read is `{}` and is not cached,
  // so asking per week would re-ask a failing endpoint once per batch. They are
  // read even when every week turns out to be in the store; that is one request
  // against the risk of reading a whole span with the bye rule switched off.
  const byes = await fetchByeWeeks();
  await inBatches(weeks, 3, async (week) => {
    let from = 'gap';
    try {
      const got = await fetchWeekRosters(week, { byes, fresh });
      if (got.teams && got.teams.length) {
        out.set(week, got.teams);
        from = got.from || 'espn';
      }
    } catch {
      /* that week is unavailable; the caller sees a gap, not an exception */
    }
    done++;
    if (onProgress) onProgress(done, weeks.length, week, from);
  });
  return out;
}

/**
 * ONE WEEK OF THE WAIVER WIRE, ALREADY PARSED.
 *
 * The Players page used to call `espn.fetchFreeAgents` directly and parse the
 * raw payload itself, which made it the one page the cloud substitution could
 * not reach — on a phone its Taken half worked from the synced rosters while
 * the wire above it, the half the page is named for, had nothing at all.
 *
 * So the parse moved here, and this returns parsed players from either source.
 * `espn.parseFreeAgent` is pure, so moving WHERE it is called changes no
 * number; the cloud stores what it returns, which is why a synced week needs
 * no parsing on the way back.
 *
 * ITS OWN READ, not `cloudDown()`'s. That one deliberately asks for rosters and
 * schedule only, because four of the six pages never touch the wire and
 * thirteen wire documents on every page load would be reads nothing renders.
 * This asks for exactly the week wanted — one index document plus one wire
 * document — so the cost lands on the page that actually wants it.
 *
 * Throws on a week neither source can answer, because the caller distinguishes
 * "ESPN refused this week" from "this week is empty" and draws them
 * differently. A cloud miss falls through to ESPN rather than reporting an
 * empty wire: a public league nobody has synced still works.
 *
 * @param {number} week
 * @param {number} [limit] how many free agents to ask ESPN for
 * @returns {Promise<Array>} `espn.parseFreeAgent` results for that week
 */
export async function fetchWireWeek(week, limit = WIRE_LIMIT) {
  const w = Number(week);

  await bridge.settled();
  if (!bridge.isAvailable() && cloud.isConfigured()) {
    const { leagueId, season } = espn.getConfig();
    if (realLeague(leagueId)) {
      try {
        const res = await cloud.readDown(leagueId, season, { shapes: ['wire'], weeks: [w] });
        const players = res && res.ok && res.wire instanceof Map ? res.wire.get(w) : null;
        // Sliced to the limit asked for: the sync stores WIRE_LIMIT men, and a
        // page asking for fewer must list the same ones it would list live.
        // The stored list is most-owned first, the order ESPN returned it in,
        // so the first `limit` are the ones ESPN would have sent.
        const n = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : WIRE_LIMIT;
        if (players && players.length) return players.slice(0, n);
      } catch {
        /* no cloud: fall through to ESPN, exactly as if it were not configured */
      }
    }
  }

  // The synced list above was decoded with the bye rule already applied.
  const [raw, byes] = await Promise.all([espn.fetchFreeAgents(w, limit), fetchByeWeeks()]);
  return (raw?.players || [])
    .map((entry) => espn.parseFreeAgent(entry, w, byes))
    .filter((p) => p.playerId !== null && p.playerId !== undefined);
}

// ------------------------------------------------------------ the floor read
//
// THE POSITIONAL FLOOR, fetched once. Tim, 2026-09-18: no slot should be
// assessed below what the waiver wire would give you at that position, because
// a manager whose kicker is on bye streams one rather than fielding nobody.
// The rule itself lives in js/floor.js, which is pure; this is the one read
// that feeds it.
//
// ONE READ, NOT ONE PER WEEK, and that was Tim's choice between two offered:
// a read per week is exact but doubles the request count on Analysis and
// Trade — a rest-of-season trade goes from about 12 requests to about 24 —
// while one read used flat costs a single request per page. A floor stands for
// "whoever I would stream", and the man you stream is by definition playing,
// so a flat floor is closer to right than it first looks. Every panel that
// uses it says so, in `floor.describeFloors`.
//
// It goes through `fetchWireWeek`, so it is the cloud-aware path: a phone with
// no extension gets the synced wire and therefore the same floors as the
// desktop, rather than silently falling back to no floor at all and quietly
// showing different totals from the machine beside it.
//
// A FAILED READ IS NOT AN ERROR HERE. It returns an empty map, which every
// reader treats as "no floor known" and leaves every number exactly as ESPN
// sent it — the same rule the bye handling follows. A page must never fail to
// render because the wire was busy.
const floorCache = new Map();

export async function fetchFloors(week) {
  const w = Number(week);
  if (!Number.isFinite(w) || w <= 0) return new Map();

  const { leagueId, season } = espn.getConfig();
  const key = `${leagueId}|${season}|${w}`;
  if (floorCache.has(key)) return floorCache.get(key);

  const job = (async () => {
    try {
      const wire = await fetchWireWeek(w);
      return floor.positionFloors(wire, { week: w });
    } catch {
      // Cached as empty on purpose: a league that refuses the wire would
      // otherwise be asked again by every panel on the page.
      return new Map();
    }
  })();

  floorCache.set(key, job);
  return job;
}

/** Forget the floors — a league or season change makes them somebody else's. */
export function clearFloors() {
  floorCache.clear();
}

// ===========================================================================
// WHAT COUNTS AS A RESULT
// ===========================================================================

/**
 * Is this ESPN `schedule[]` entry a regular-season game?
 *
 * ESPN's matchup feed carries the playoff and consolation weeks in the same
 * array (`playoffTierType` 'WINNERS_BRACKET', 'WINNERS_CONSOLATION_LADDER',
 * 'LOSERS_CONSOLATION_LADDER'; 'NONE' for the regular season — verified
 * against league 1241838). Left in, a December consolation game counts toward
 * the standings and luck, and the "last week of the regular season" moves into
 * the bracket. An entry with no tier at all (an old synced copy, a hand
 * fixture) is taken as regular season, which is what it was always treated as.
 */
export function isRegularSeasonEntry(m) {
  const tier = m?.playoffTierType;
  return tier === undefined || tier === null || tier === 'NONE';
}

/**
 * Has ESPN DECIDED this game?
 *
 * ESPN says so itself: `winner` is 'HOME', 'AWAY' or 'TIE' once the matchup is
 * final and 'UNDECIDED' until then — including from Thursday night to Monday,
 * when both sides already have points. Counting "somebody has points" as
 * played, which is what this used to do, put half-played weeks into the
 * standings, the luck columns and every "weeks played" count for four days a
 * week.
 *
 * An entry with no `winner` at all — an old synced copy, a hand-written
 * fixture — falls back to the old points rule, so nothing that worked before
 * stops working. Both sides must exist either way: a bye is never a result.
 */
export function isDecidedEntry(m) {
  if (!m?.home || !m?.away) return false;
  const h = m.home.totalPoints;
  const a = m.away.totalPoints;
  if (typeof h !== 'number' || typeof a !== 'number') return false;
  if (typeof m.winner === 'string') return m.winner !== 'UNDECIDED';
  return h > 0 || a > 0;
}

/**
 * A final score as ESPN keeps it — to the hundredth, float noise removed.
 *
 * NOT to the tenth. This used to round to one decimal, which made 128.66 and
 * 128.70 a tie on the stats page and summed a season of rounded scores into a
 * points-for ESPN does not show. Display rounding is the page's job.
 */
const exactPoints = (v) => Math.round(v * 100) / 100;

/** ESPN's winner in this file's spelling; falls back to the points. */
function winnerOf(m) {
  if (m.winner === 'HOME') return 'home';
  if (m.winner === 'AWAY') return 'away';
  if (m.winner === 'TIE') return 'tie';
  const h = m.home.totalPoints;
  const a = m.away.totalPoints;
  return h > a ? 'home' : a > h ? 'away' : 'tie';
}

/** One `schedule[]` entry in the shape every page reads. */
function normaliseGame(m, nameById) {
  const week = m.matchupPeriodId;
  const homePts = m.home.totalPoints ?? null;
  const awayPts = m.away ? m.away.totalPoints ?? null : null;
  const played = isDecidedEntry(m);
  return {
    week,
    homeId: m.home.teamId,
    homeName: nameById.get(m.home.teamId) || `Team ${m.home.teamId}`,
    homeScore: homePts,
    awayId: m.away ? m.away.teamId : null,
    awayName: m.away ? nameById.get(m.away.teamId) || `Team ${m.away.teamId}` : 'BYE',
    awayScore: awayPts,
    played,
    margin: played ? Math.round((homePts - awayPts) * 10) / 10 : null,
    winner: played ? winnerOf(m) : null,
  };
}

/** Group games by week; returns [byWeek, sorted weeks]. */
function groupByWeek(games) {
  const byWeek = new Map();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
  }
  return [byWeek, [...byWeek.keys()].sort((a, b) => a - b)];
}

/**
 * The full REGULAR season schedule, week by week, with results where they
 * exist.
 *
 * `games`, `byWeek` and `weeks` hold the regular season only — see
 * `isRegularSeasonEntry`. The playoff and consolation games ESPN sends in the
 * same feed are kept apart on `playoffGames` (same shape, plus `tier`, ESPN's
 * `playoffTierType`) for any caller that wants them; nothing draws them yet.
 */
export async function fetchSchedule() {
  // Rebuilt rather than handed straight out, even though `readDown` already
  // returns this exact shape. The cached document is shared by every caller on
  // the page, and the live path has always given each caller its own objects —
  // so a page that edits a game in place (the schedule page normalises into
  // its own state, but nothing promises the next one will) cannot poison what
  // the next caller sees. Sixty-five games; the copy is free.
  const down = await cloudDown();
  if (down && down.schedule && Array.isArray(down.schedule.games)) {
    // A synced game carrying a `tier` is a playoff game that reached `games`
    // somehow; the copies this build writes never put one there, but the rule
    // is cheap to hold at both ends.
    const games = down.schedule.games
      .filter((g) => g.tier === undefined || g.tier === null || g.tier === 'NONE')
      .map((g) => ({ ...g }));
    const [byWeek, weeks] = groupByWeek(games);
    // Which weeks are banked, for the local store's freshness rule. A synced
    // schedule carries `played` exactly as the live one does, so the phone
    // freezes the same weeks the desktop does.
    markPlayed(games);
    markPlayed(down.schedule.playoffGames || []);
    return {
      ...down.schedule,
      teams: (down.schedule.teams || []).map((t) => ({ ...t })),
      weeks,
      byWeek,
      games,
      playoffGames: (down.schedule.playoffGames || []).map((g) => ({ ...g })),
    };
  }

  const raw = await espn.fetchMatchups();
  const parsed = espn.parseLeague(raw);
  const nameById = new Map(parsed.teams.map((t) => [t.id, t.name]));

  const regular = [];
  const playoffGames = [];
  for (const m of raw.schedule || []) {
    if (!m.home) continue;
    if (isRegularSeasonEntry(m)) regular.push(normaliseGame(m, nameById));
    else playoffGames.push({ ...normaliseGame(m, nameById), tier: m.playoffTierType });
  }
  const [byWeek, weeks] = groupByWeek(regular);

  // THE ONE PLACE THE LOCAL STORE LEARNS WHAT IS BANKED. A week with a result
  // against it can never change again, so it is kept for the season; everything
  // else is a forecast on a six-hour clock. See "THE LOCAL STORE" at the top,
  // and note that this is read off the SCHEDULE and never off the date.
  markPlayed(regular);
  markPlayed(playoffGames);

  return {
    leagueName: parsed.name,
    teams: parsed.teams,
    // THE BRACKET, CARRIED THROUGH. `parseLeague` decodes ESPN's own
    // `scheduleSettings` — how many teams make the playoffs, how long the
    // regular season is, whether the bracket reseeds — and without this line
    // none of it could reach the schedule page, which was left assuming a
    // six-team field and saying on screen that it had assumed it.
    //
    // It is a real per-league answer: two public leagues probed on 2026-09-16
    // returned playoff fields of 6 and 4. It is also what settles a
    // contradiction in Tim's own account of his league — he said four teams
    // make his playoffs and the settings he pasted said six — because now
    // neither is believed and the league is asked.
    //
    // Every field is null on a payload that carried no `scheduleSettings`, so a
    // caller must read a null as "ESPN did not say" and fall back, never as a
    // number. An archived reading taken before this existed is exactly that
    // case, and so is every test stub.
    playoffs: parsed.playoffs || null,
    // The trade deadline and review window (`espn.parseTrades`), for the
    // Trade page's deadline line. Null on anything that did not carry them.
    trades: parsed.trades || null,
    weeks,
    byWeek,
    games: weeks.flatMap((w) => byWeek.get(w)),
    playoffGames,
  };
}

/**
 * The last third of `fetchSeasonData`, given a season's completed games.
 *
 * Pulled out so the cloud path below can reach the same answer through the
 * same rule. The "do the projections cover everybody" test is subtle enough
 * that a second copy of it would be a second thing to get wrong, and getting
 * it wrong once already put teams that had never played at the top of the luck
 * standings.
 */
function assembleSeason({ season, name, teams, games }) {
  // If ESPN gave us nothing usable for projections, say so rather than
  // silently rendering a season of zeroes.
  const withProjections = games.filter((g) => g.homeProjected > 0 && g.awayProjected > 0);

  // "More than half the games" was tuned against a 65-game season. In week 1
  // there are five, so 3-of-5 passes the ratio while dropping two games
  // entirely — and the four teams in them survive into `teams` with no rows at
  // all. Those ghosts then compute skill = 0 - leagueAvgProjected (about -122)
  // and luck = leagueAvgActual (about +117), which puts teams that never
  // played at the TOP of the luck standings, with no warning shown. So the
  // filtered set is only safe to use when it still covers every team.
  const coveredTeams = new Set();
  for (const g of withProjections) { coveredTeams.add(g.homeId); coveredTeams.add(g.awayId); }
  const playedTeams = new Set();
  for (const g of games) { playedTeams.add(g.homeId); playedTeams.add(g.awayId); }
  const coversEveryone = [...playedTeams].every((id) => coveredTeams.has(id));

  const projectionsAvailable =
    withProjections.length > games.length * 0.5 && coversEveryone;

  return {
    season,
    isDemo: false,
    name,
    weeks: [...new Set(games.map((g) => g.week))].length,
    teams,
    games: projectionsAvailable ? withProjections : games,
    injuries: [], // entered by hand in the sheet; no ESPN equivalent
    projectionsAvailable,
    gamesFound: games.length,
    gamesWithProjections: withProjections.length,
  };
}

/**
 * The same season, assembled out of what the desktop synced.
 *
 * Every number here was DECODED BY THIS FILE before it went up —
 * `projectedTotal` is what `fetchWeekRosters` worked out from that week's
 * starting lineup, with its null-vs-zero rule intact. Re-deriving it from the
 * synced players would be a second copy of that rule, free to disagree with
 * the first the day either is touched. It is the same reason `cloud.js` stores
 * the team totals verbatim rather than re-adding them on the way down.
 */
function seasonFromCloud(down) {
  const schedule = down.schedule;
  if (!schedule || !Array.isArray(schedule.games)) return null;

  const teamList = (down.teams && down.teams.length ? down.teams : schedule.teams || [])
    .map((t) => ({ id: t.id, name: t.name, teamName: t.teamName }));
  const teamIds = new Set(teamList.map((t) => t.id));

  // week -> teamId -> what that squad's starters were projected to score.
  const projByWeek = new Map();
  for (const [week, teams] of down.rosters || new Map()) {
    const row = new Map();
    for (const t of teams) row.set(t.id, typeof t.projectedTotal === 'number' ? t.projectedTotal : 0);
    projByWeek.set(Number(week), row);
  }

  const games = [];
  for (const g of schedule.games) {
    // Only completed matchups, and only real head-to-heads — the same two
    // conditions the live path applies, a BYE having no second side to score.
    if (!g.played || g.awayId === null || g.awayId === undefined) continue;
    if (!teamIds.has(g.homeId) || !teamIds.has(g.awayId)) continue;
    if (typeof g.homeScore !== 'number' || typeof g.awayScore !== 'number') continue;

    const proj = projByWeek.get(Number(g.week)) || new Map();
    games.push({
      week: g.week,
      homeId: g.homeId,
      awayId: g.awayId,
      homeActual: exactPoints(g.homeScore),
      awayActual: exactPoints(g.awayScore),
      homeProjected: Math.round((proj.get(g.homeId) || 0) * 10) / 10,
      awayProjected: Math.round((proj.get(g.awayId) || 0) * 10) / 10,
    });
  }

  return assembleSeason({
    season: Number(down.season) || espn.getConfig().season,
    name: down.leagueName || schedule.leagueName || '',
    teams: teamList,
    games,
  });
}

/**
 * Build a full season of league data from ESPN.
 *
 * @param {function} onProgress optional (done, total, label) callback
 * @returns the canonical league-data shape, plus `projectionsAvailable`
 */
export async function fetchSeasonData({ onProgress } = {}) {
  const report = (done, total, label) => onProgress && onProgress(done, total, label);

  report(0, 1, 'Loading league…');

  // The synced copy, when there is no bridge. Without this the stats page is
  // the one page that would still fall over on the phone — it is the only
  // caller of this function, and it would ask ESPN for a private league and be
  // refused while every other page rendered fine.
  const down = await cloudDown();
  if (down) {
    const built = seasonFromCloud(down);
    if (built && built.games.length) {
      report(1, 1, 'Reading the copy synced from your computer…');
      return built;
    }
  }

  const raw = await espn.fetchMatchups();
  const parsed = espn.parseLeague(raw);

  // `name` is the person; `teamName` is the joke name he sees inside ESPN, kept
  // alongside so a page can show both without another request.
  const teams = parsed.teams.map((t) => ({ id: t.id, name: t.name, teamName: t.teamName }));
  const teamIds = new Set(teams.map((t) => t.id));

  // Only DECIDED regular-season matchups — the same two rules `fetchSchedule`
  // applies, from the same two functions, so the stats page and the standings
  // cannot disagree about what has been played.
  const played = (raw.schedule || []).filter(
    (m) =>
      isRegularSeasonEntry(m) && isDecidedEntry(m) &&
      teamIds.has(m.home.teamId) && teamIds.has(m.away.teamId)
  );

  const weeks = [...new Set(played.map((m) => m.matchupPeriodId))].sort((a, b) => a - b);

  // Re-derive each week's projected totals from that week's starting lineups.
  const projByWeek = new Map(); // week -> Map(teamId -> projected)
  let done = 0;

  await inBatches(weeks, 3, async (week) => {
    try {
      const weekRaw = await espn.fetchRosters(week);
      const map = new Map();
      for (const t of weekRaw.teams || []) {
        map.set(t.id, projectedTotalForWeek(t, week));
      }
      projByWeek.set(week, map);
    } catch {
      projByWeek.set(week, new Map()); // week unavailable; handled below
    }
    done++;
    report(done, weeks.length, `Rebuilding week ${week} projections…`);
  });

  const games = [];
  for (const m of played) {
    const week = m.matchupPeriodId;
    const proj = projByWeek.get(week) || new Map();
    games.push({
      week,
      homeId: m.home.teamId,
      awayId: m.away.teamId,
      homeActual: exactPoints(m.home.totalPoints),
      awayActual: exactPoints(m.away.totalPoints),
      homeProjected: Math.round((proj.get(m.home.teamId) || 0) * 10) / 10,
      awayProjected: Math.round((proj.get(m.away.teamId) || 0) * 10) / 10,
    });
  }

  return assembleSeason({
    season: espn.getConfig().season,
    name: parsed.name,
    teams,
    games,
  });
}

// ===========================================================================
// BYE WEEKS
// ===========================================================================

let byesCache = null; // { key, promise }

/** A bye map that actually says something. `{}` is "unknown", never "no byes". */
function byesAreKnown(byes) {
  return !!byes && typeof byes === 'object' && Object.keys(byes).length > 0;
}

/**
 * Every NFL team's bye week, `{ [proTeamId]: byeWeek }`.
 *
 * What tells a real bye (the week IS his team's bye) from a player ESPN
 * projects at 0.00 because he is OUT or on IR — the two look identical in the
 * projection alone.
 *
 * NEVER THROWS: `{}` on any failure, and `{}` is "unknown", so a caller must
 * not read a missing team as "no bye". Demo (no real league configured) is
 * always `{}` — the demo never claims a bye.
 *
 * Source follows the same order as everything else here: the synced copy when
 * the cloud substitution is active (the desktop publishes the byes with every
 * sync), otherwise ESPN. Cached for the page's lifetime per season; a failure
 * or an empty answer is not cached, so a later call can still succeed.
 */
export async function fetchByeWeeks() {
  const { leagueId, season } = espn.getConfig();
  if (!realLeague(leagueId)) return {};

  const key = `${leagueId}::${season}`;
  // Each caller gets its own copy, so one page editing the map cannot change
  // what the next caller is told.
  if (byesCache && byesCache.key === key) return byesCache.promise.then((b) => ({ ...b }));

  const entry = { key, promise: null };
  entry.promise = (async () => {
    try {
      const down = await cloudDown();
      if (down && down.byes && Object.keys(down.byes).length) return { ...down.byes };
      const byes = await espn.fetchByeWeeks();
      return byes && typeof byes === 'object' ? byes : {};
    } catch {
      return {};
    }
  })().then((byes) => {
    if (!Object.keys(byes).length && byesCache === entry) byesCache = null;
    return byes;
  });
  byesCache = entry;
  return entry.promise.then((b) => ({ ...b }));
}

// ===========================================================================
// GATHERING WHAT GETS PUBLISHED
// ===========================================================================

/**
 * Everything `cloud.syncUp` needs, read from ESPN in one pass.
 *
 * Only ever run on the machine with the bridge — it is the only one that can
 * see a private league — and `js/connection.js` decides when. It lives here
 * rather than there because this is the file that knows how to ask ESPN for a
 * week, and a second place that knew would be a second place to get the
 * one-request-per-week rule wrong.
 *
 * THE WHOLE SPAN GOES, not just this week. On live data the week controls buy
 * new weeks with new ESPN requests; on synced data there is nothing to buy, so
 * a sync that carried only the current week would leave the phone's week
 * pickers silently showing gaps. `cloud.js` says the same thing from its end.
 *
 * A week ESPN refuses is simply absent — the same contract every fetcher above
 * already has, and the reason a half-answered sync is a visible gap rather
 * than a failure.
 *
 * IT ALWAYS READS FRESH, AND THAT IS WHAT MAKES **SYNC** A FORCE-REFRESH.
 * Tim's ask had two halves — "does all the loading ... as soon as you open up
 * the page OR CHOOSE TO SYNC IT WITH ESPN, and then it's saved there UNTIL YOU
 * RE-LOAD IT". This is the second half, and it needed no new control: pressing
 * Sync in the connection bar already comes through here, so it now re-reads
 * every week from ESPN rather than being served this browser's own copies, and
 * `fetchWeekRosters` writes what comes back over the top. A sync that published
 * the cache it was meant to refresh would be the worst of both.
 *
 * @param {Object} [opts]
 * @param {(done:number,total:number,label:string)=>void} [opts.onProgress]
 */
export async function buildCloudPayload({ onProgress } = {}) {
  const report = (done, total, label) => {
    if (!onProgress) return;
    try { onProgress(done, total, label); } catch { /* a bad listener must not stop a sync */ }
  };

  const schedule = await fetchSchedule();

  // EVERY WEEK THE SCHEDULE KNOWS ABOUT, and there is no week ceiling.
  //
  // This used to stop at week 13, on the authority of a rule saying ESPN
  // published no projection beyond it. **That rule was wrong** — 13 was simply
  // the furthest week anybody had asked for, and re-probing found real per-week
  // projections through week 18. The cap was therefore refusing to sync the
  // last week of a fourteen-week regular season, so a phone reading the synced
  // copy had a hole in it exactly where the season is decided.
  //
  // The schedule is the honest bound. `schedule.weeks` is the regular season
  // only; ESPN's feed also carries the playoff and consolation weeks once the
  // bracket exists (it did for every week of 2025), and those are kept apart
  // on `playoffGames`. Their squads are synced too — that is what keeps a
  // phone's December bracket and results — so the span is the union.
  //
  // THE PLAYOFF WEEKS ARE ADDED BY NUMBER TOO. Bracket games do not exist in
  // ESPN's feed until the regular season is over and the field is seeded, so
  // until December the union above stops at the last regular-season week —
  // and the phone's simulation, finding no squads for weeks 15–17, fell back
  // to a modelled bracket while the desktop's was projected. The weeks are the
  // ones the desktop's reading asks for (`capture.playoffWeeks`, derived from
  // the league's own field size), so the two cannot disagree about which.
  // Three more weeks is about 160 KB of rosters plus their wire — well inside
  // what the cloud stores.
  const weeks = [...new Set([
    ...schedule.weeks,
    ...(schedule.playoffGames || []).map((g) => g.week),
    ...capture.playoffWeeks(schedule),
  ])].filter((w) => Number.isFinite(w)).sort((a, b) => a - b);

  // Schedule, the byes, then a roster request and a wire request per week.
  const total = weeks.length * 2 + 2;
  let done = 1;
  report(done, total, 'Schedule');

  // The byes first, because both decoders below apply the bye rule with them.
  // A failure is `{}`: projections go up as ESPN sent them, and the sync is
  // still a sync.
  let byes = {};
  try {
    byes = (await fetchByeWeeks()) || {};
  } catch { /* byes are a nicety; a sync without them is still a sync */ }
  report(++done, total, 'Bye weeks');

  const rosters = new Map();
  await inBatches(weeks, 3, async (week) => {
    try {
      // `fresh` — the store is skipped on the way in and refreshed on the way
      // out. See the note above: this is the press that means "re-read".
      const { teams } = await fetchWeekRosters(week, { byes, fresh: true });
      if (teams && teams.length) rosters.set(week, teams);
    } catch { /* that week is unavailable; it is a gap, not a failed sync */ }
    report(++done, total, `Week ${week} squads`);
  });

  // The wire is decoded here rather than stored raw, for the same reason the
  // rosters are: what goes up is what the pages render from, which is an order
  // of magnitude smaller than ESPN's payload and cannot rot into an ESPN
  // schema change nobody is watching for.
  const wire = new Map();
  await inBatches(weeks, 3, async (week) => {
    try {
      const raw = await espn.fetchFreeAgents(week, WIRE_LIMIT);
      const players = (raw?.players || [])
        .map((entry) => espn.parseFreeAgent(entry, week, byes))
        // A man ESPN gives no id for cannot be linked to and cannot be matched
        // week to week, which is exactly what the Players page keys on.
        .filter((p) => p.playerId !== null && p.playerId !== undefined);
      if (players.length) wire.set(week, players);
    } catch { /* same: a gap */ }
    report(++done, total, `Week ${week} wire`);
  });

  return {
    leagueName: schedule.leagueName || '',
    // `name` is the person and `teamName` is the joke name inside ESPN. Both
    // go up: re-joining the members list on a phone would mean another ESPN
    // request, which is the one thing a phone cannot make.
    teams: (schedule.teams || []).map((t) => ({
      id: t.id,
      name: t.name,
      teamName: t.teamName || '',
      abbrev: t.abbrev || '',
    })),
    byes,
    schedule,
    rosters,
    wire,
    weeks,
  };
}
