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
import { compactScoring } from './proj-trend.js';
import * as capture from './capture.js';
// The positional floor's RULES are pure and live here; `fetchFloors` below is
// the one read that feeds them. See js/floor.js.
import * as floor from './floor.js';
// The weeks this browser has already read, kept across a navigation. See
// js/store.js for the freshness rule and THE LOCAL STORE below for the seam.
import * as store from './store.js';
// The saved projections, which ride the cloud sync both ways. Storage only.
import * as projHistory from './proj-history.js';
// The league's starting slots, for the Decisions review's `world` (the last
// section of this file). Both are pure.
import { slotsFromCounts } from './forecast.js';
import { slotCountsFromLineups } from './projection.js';
// A player's Value: the arithmetic is pure and lives there; this file reads what
// it needs and keeps the frozen lines. See "PLAYER VALUE" below.
import * as value from './value.js';

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
const weeksSeen = new Map();  // `${leagueId}::${season}` -> Set<week>, every week the schedule lists

function markPlayed(games) {
  const { leagueId, season } = espn.getConfig();
  if (!realLeague(leagueId)) return;
  const key = `${leagueId}::${season}`;
  const set = playedSeen.get(key) || new Set();
  const all = weeksSeen.get(key) || new Set();
  for (const g of games || []) {
    if (!g || !Number.isFinite(Number(g.week))) continue;
    all.add(Number(g.week));
    if (g.played) set.add(Number(g.week));
  }
  playedSeen.set(key, set);
  weeksSeen.set(key, all);
}

/**
 * THE CURRENT WEEK: the first week on the schedule ESPN has not decided, or
 * null when the schedule has not been read (or every week is decided).
 *
 * It is the week a roster move shows in first, so it is the one week kept on
 * the five-minute clock whether or not its games have begun — see "A ROSTER
 * MOVE REACHES EVERY WEEK" below. Off the schedule, never off the date.
 */
function currentWeek() {
  const { leagueId, season } = espn.getConfig();
  const key = `${leagueId}::${season}`;
  const all = weeksSeen.get(key);
  if (!all || !all.size) return null;
  const played = playedSeen.get(key) || new Set();
  let first = null;
  for (const w of all) if (!played.has(w) && (first === null || w < first)) first = w;
  return first;
}

function weekIsFinal(week) {
  const { leagueId, season } = espn.getConfig();
  const set = playedSeen.get(`${leagueId}::${season}`);
  return !!(set && set.has(Number(week)));
}

/**
 * WHEN EACH WEEK'S ROSTERS WERE READ FROM ESPN, for the week in progress.
 *
 * Tim, 2026-10-04: "if it's halfway through week 4, the simulation would
 * simulate the rest of week 4". Half a week's points mean nothing without the
 * moment they were read at: `capture.liveWeek` sets them against the NFL
 * kickoffs AS OF THAT MOMENT, so a copy read at 2 pm is never treated as a 5 pm
 * score. A stored week keeps the store's own `at`; a synced week the sync's.
 */
const readAt = new Map(); // `${leagueId}::${season}::${week}` -> epoch ms

function noteRead(week, at) {
  const { leagueId, season } = espn.getConfig();
  if (Number.isFinite(at)) readAt.set(`${leagueId}::${season}::${Number(week)}`, at);
}

/** When `week`'s rosters were read from ESPN (epoch ms), or null when unknown. */
export function weekReadAt(week) {
  const { leagueId, season } = espn.getConfig();
  return readAt.get(`${leagueId}::${season}::${Number(week)}`) ?? null;
}

/** When the synced copy was taken, as epoch ms, or null. */
function cloudAt(down) {
  const s = down && down.syncedAt;
  const ms = Date.parse(typeof s === 'string' ? s : (s && s.rosters) || '');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * How long a stored week is good for WHILE ITS GAMES ARE BEING PLAYED.
 *
 * The six-hour clock is for a forecast; a week under way carries live points,
 * and a copy from the early games is two-thirds of a different Sunday.
 */
const LIVE_FRESH_MS = 5 * 60 * 1000;

/**
 * A played week is read ONCE more, this long after it was first stored final.
 *
 * ESPN corrects statistics for a few days after a week closes, and a week kept
 * "for the season" from the moment it closed never saw them — so a man's
 * stored points could disagree with the matchup score beside them. Three days
 * covers the corrections; js/store.js stamps the entry so it is not asked for
 * a third time. Never on the phone's synced copy, which asks ESPN for nothing.
 */
const RECHECK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Has any NFL game of `week` kicked off? Answered only from a pro-schedule read
 * this page has ALREADY made (the bye read) — it never costs a request, and
 * "not known" is false, which leaves the six-hour rule exactly as it was.
 */
function weekInPlay(week) {
  const games = typeof espn.heldProGames === 'function' ? espn.heldProGames() : null;
  if (!games) return false;
  const now = Date.now();
  return Object.values(games).some((byWeek) => {
    const g = byWeek && byWeek[week];
    return g && Number.isFinite(g.at) && g.at <= now;
  });
}

// ===========================================================================
// WHAT HAS FINISHED COUNTS NOW
// ===========================================================================
//
// Tim, 2026-10-04: "any games that are comepletely finished are counted in
// whatever data across the cite ... for singular player's that have finished
// their game, their numbers are individually updated ... nothing is waiting on
// something else that it doesn't depend on."
//
// ESPN closes a fantasy week on Tuesday. By Sunday night most of it is already
// fact, and until now every page treated all of it as a forecast. So, in a week
// ESPN has NOT yet decided:
//
//   A FINISHED PLAYER (`capture.playerDone`) leaves `fetchWeekRosters`,
//   `fetchWeeksRosters` and `fetchWireWeek` with `done: true`, his projection
//   moved to `pregame`, and `projected` OVERWRITTEN with what he scored — so
//   every page that prices a week by `p.projected` uses the fact without
//   knowing. Everybody else in that week carries `done: false`.
//
//   A FINISHED MATCHUP — both sides have a starter and every starter on both is
//   done — leaves `fetchSchedule` as `played`, with its winner and margin and
//   `early: true` (`settleEarly`).
//
// ON THE WAY OUT, ON COPIES. Done-ness changes by the minute, so nothing here
// is ever written to js/store.js or uploaded: the stored and the synced reading
// stay exactly what ESPN sent, and each device settles from its own evidence.
// `markPlayed` / `weekIsFinal` and the store's `final` flag keep following
// ESPN's OWN decision — an early game must never freeze a week's rosters while
// another matchup in it is still scoring.
//
// UNTOUCHED: a week ESPN has decided, and demo — no `done`, no `pregame`.
// Team totals (`projectedTotal` …) stay the PRE-GAME lineup's: they are the
// "what was projected" side of every accuracy and luck figure.

/** A pro-games reading that says something. `{}` is "unknown". */
const proKnown = (g) => !!g && typeof g === 'object' && Object.keys(g).length > 0;

/** "Leave these objects exactly as they are" — a decided week, or demo. */
const AS_IS = Symbol('as is');

/** After the NFL schedule could not be read, do not ask again for this long. */
const PRO_RETRY_MS = 60 * 1000;
let proMissAt = 0;

/**
 * The NFL's games, sought — for a caller that already has reason to think a
 * week is in play. Free when a pro-schedule read has landed on this page (the
 * bye read is one, and js/espn.js keeps the payload whichever of the two asks
 * first, so a desktop pays for it once either way). A device whose byes came
 * from the synced copy pays for one read of its own: the NFL schedule is
 * public, so a phone can make it. Null when it cannot be had; a failed read —
 * this one or the bye read, the same endpoint — is not retried for a minute.
 */
async function seekProGames() {
  const held = typeof espn.heldProGames === 'function' ? espn.heldProGames() : null;
  // Held — or asked for on this page and ESPN listed no games: either way the
  // answer is already here and asking again would buy the same one.
  if (held) return proKnown(held) ? held : null;
  if (Date.now() - proMissAt < PRO_RETRY_MS) return null;
  // ONE read however many weeks ask at once (a span is read three at a time).
  if (!proSeek) {
    proSeek = fetchProGames()
      .then((games) => {
        if (proKnown(games)) return games;
        proMissAt = Date.now();
        return null;
      })
      .finally(() => { proSeek = null; });
  }
  return proSeek;
}
let proSeek = null;

/** Has the schedule been read for this league, so `weekIsFinal` means something? */
async function decidedKnown() {
  const key = () => { const c = espn.getConfig(); return `${c.leagueId}::${c.season}`; };
  if (playedSeen.has(key())) return true;
  try { await fetchSchedule({ settle: false }); } catch { return false; }
  return playedSeen.has(key());
}

/**
 * The rule for one week's players: `AS_IS` (do not touch them), null (the week
 * is open but nobody can be called finished), or `(player) => boolean`.
 *
 * WHAT IT COSTS. Nothing, when the NFL schedule is already held and the league
 * schedule already read — every page's normal state. It ASKS for the NFL
 * schedule only when somebody in the reading already has points that week (so
 * the week is plausibly in play), and for the league schedule only when a week
 * that has kicked off is read before any page asked for the schedule — because
 * marking a man done in a week ESPN has in fact decided would overwrite
 * history's projections, and only the schedule can say.
 *
 * `done` IS ONLY EVER TRUE IN A WEEK THAT HAS KICKED OFF. A man on bye in week
 * 9 is not "finished" in October, and a late-season week whose kickoffs ESPN
 * has not dated yet must not read as a league-wide bye.
 */
async function doneRule(week, players, asOf, { final = false } = {}) {
  if (!storable() || final || weekIsFinal(week)) return AS_IS;
  let pro = typeof espn.heldProGames === 'function' ? espn.heldProGames() : null;
  if (!proKnown(pro)) {
    if (!(players || []).some((p) => p && typeof p.actual === 'number')) return null;
    pro = await seekProGames();
    if (!proKnown(pro)) return null;
  }
  const w = Number(week);
  const now = Date.now();
  const begun = Object.values(pro).some((byWeek) => {
    const g = byWeek && byWeek[w];
    return g && Number.isFinite(g.at) && g.at <= now;
  });
  if (!begun) return null;
  if (!(await decidedKnown())) return null;
  if (weekIsFinal(week)) return AS_IS;
  return (p) => capture.playerDone(
    p.proTeamId === null || p.proTeamId === undefined ? null : pro[p.proTeamId]?.[w], asOf, now);
}

/** One player on the way out: a copy, marked. */
function markDone(p, rule) {
  if (!p || typeof p !== 'object') return p;
  if (!rule || !rule(p)) return { ...p, done: false };
  return {
    ...p,
    done: true,
    pregame: p.projected ?? null,
    projected: typeof p.actual === 'number' ? p.actual : 0,
  };
}

/** One team on the way out; `starters` / `bench` stay the same objects as `players`. */
function teamWithDone(team, rule) {
  const seen = new Map();
  const conv = (p) => {
    if (!seen.has(p)) seen.set(p, markDone(p, rule));
    return seen.get(p);
  };
  const out = { ...team, players: (team.players || []).map(conv) };
  if (Array.isArray(team.starters)) out.starters = team.starters.map(conv);
  if (Array.isArray(team.bench)) out.bench = team.bench.map(conv);
  return out;
}

/** A week's teams, annotated. Never throws; any failure is the teams as read. */
async function annotateTeams(week, teams, opts) {
  if (!Array.isArray(teams) || !teams.length) return teams;
  try {
    const rule = await doneRule(week, teams.flatMap((t) => (t && t.players) || []), weekReadAt(week), opts);
    return rule === AS_IS ? teams : teams.map((t) => teamWithDone(t, rule));
  } catch {
    return teams;
  }
}

/** A week's wire, annotated the same way. `asOf` is when it was read from ESPN. */
async function annotateWire(week, players, asOf) {
  if (!Array.isArray(players) || !players.length) return players;
  try {
    const rule = await doneRule(week, players, asOf);
    return rule === AS_IS ? players : players.map((p) => markDone(p, rule));
  } catch {
    return players;
  }
}

/**
 * SETTLE THE MATCHUPS THAT ARE ALREADY OVER, in place, on normalised games.
 *
 * Only the first week with an undecided game, and only once somebody in it has
 * a point (free to see: the scores ride on the schedule) — otherwise nothing is
 * asked and nothing changes. Then it needs the NFL's games and that week's
 * rosters (the store or the synced copy first; at worst the one roster read the
 * page was about to make). If either cannot be had, nothing is settled.
 *
 * The scores stay ESPN's own running totals. A side with nobody starting is
 * never "finished": "every starter is done" would be true of an empty lineup.
 */
async function settleEarly(regular, playoff = []) {
  try {
    if (!storable()) return;
    const open = (list) => (list || []).filter(
      (g) => g && !g.played && g.homeId != null && g.awayId != null);
    let pending = open(regular);
    if (!pending.length) pending = open(playoff);
    if (!pending.length) return;
    const week = Math.min(...pending.map((g) => Number(g.week)));
    const inWeek = [...open(regular), ...open(playoff)].filter((g) => Number(g.week) === week);
    const scored = (v) => typeof v === 'number' && v > 0;
    if (!inWeek.some((g) => scored(g.homeScore) || scored(g.awayScore))) return;

    if (!proKnown(await seekProGames())) return;
    const { teams } = await fetchWeekRosters(week);
    const byId = new Map((teams || []).map((t) => [t.id, t]));
    const finished = (id) => {
      const starters = ((byId.get(id) || {}).players || []).filter((p) => p.started);
      return starters.length > 0 && starters.every((p) => p.done === true);
    };
    for (const g of inWeek) {
      if (typeof g.homeScore !== 'number' || typeof g.awayScore !== 'number') continue;
      if (!finished(g.homeId) || !finished(g.awayId)) continue;
      g.played = true;
      g.margin = Math.round((g.homeScore - g.awayScore) * 10) / 10;
      g.winner = g.homeScore > g.awayScore ? 'home' : g.awayScore > g.homeScore ? 'away' : 'tie';
      g.early = true;
    }
  } catch {
    /* settle nothing: the schedule is then exactly what ESPN said */
  }
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

// ===========================================================================
// A ROSTER MOVE REACHES EVERY WEEK
// ===========================================================================
//
// Tim, 2026-10-08: "I recently made a trade and the players officially
// switched, however, there are some parts of the cite that are clearly not
// caught up, even though the top bar says it's synced. For example my list of
// players in the trade menu is caught up, but in the analysis section and the
// players section you can tell parts of it aren't caught up like the which team
// the players belong to."
//
// WHY. Who is on which team is read per week and kept per week (js/store.js),
// each week good for six hours on its own clock. A trade therefore showed in
// whichever weeks happened to be read after it and not in the rest — the Trade
// page's one selected week caught up while a grid across every remaining week
// was a patchwork. And **Sync now** only checked that the league still
// answered; it read no week again.
//
// THE RULE NOW, in three parts:
//
//   1. THE CURRENT WEEK IS ALWAYS ON THE FIVE-MINUTE CLOCK (`currentWeek`).
//      Before any later open week is served from the store, the current week is
//      looked at first (`checkCurrent`): free when it was read in the last five
//      minutes, otherwise one request.
//
//   2. A WEEK JUST READ FROM ESPN IS COMPARED WITH THE COPY IT REPLACES — who
//      owns whom (`store.signatureOf`), nothing else. A difference is a roster
//      move, and every other open week is dropped so it is read again
//      (`rosterMoved`). So a normal page load costs at most one extra request,
//      and the load after a real move costs one per remaining week, once.
//
//   3. **Sync now** drops every open week and every memo below, and the pages
//      load again (`forgetOpen`; js/connection.js sends `ff:refresh`).
//
// A PLAYED WEEK IS NEVER DROPPED BY ANY OF THIS: a move cannot reach history.
// NOTHING HERE RUNS ON THE PHONE'S SYNCED COPY — that device asks ESPN for
// nothing (rule 20); it catches up when the computer syncs again.

/** How many roster moves this page has noticed — `recheck` reads it. */
let ownershipMoves = 0;

/** After the wire and the rosters disagreed, do not act on it again for this long. */
const WIRE_MOVE_EVERY_MS = 10 * 60 * 1000;
let wireMoveAt = 0;

/**
 * A ROSTER MOVE HAS BEEN SEEN: drop the open weeks so they are read again.
 *
 * `except` / `olderThan` leave alone the week that carried the news and any
 * week read since that read began. The minute-long shared reads in js/espn.js
 * and the floors go too — both were made before the move.
 *
 * A page that was already HANDED one of the dropped weeks is showing the old
 * teams, so it is told (`ff:rosters`; js/connection.js turns that into the
 * same reload Sync now asks for). A page still loading was handed nothing and
 * simply reads the weeks fresh.
 */
function rosterMoved(cfg, { except = null, olderThan = null } = {}) {
  const gone = store.forgetOpen(cfg.leagueId, cfg.season, { except, olderThan });
  espn.clearReadCache();
  floorCache.clear();
  ownershipMoves++;
  let handed = false;
  for (const week of gone) {
    if (readAt.delete(`${cfg.leagueId}::${cfg.season}::${week}`)) handed = true;
  }
  if (handed && typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    try { document.dispatchEvent(new CustomEvent('ff:rosters')); } catch { /* nobody to tell */ }
  }
}

let currentCheck = null; // { key, promise } — one look at the current week at a time
let currentMissAt = 0;

/**
 * Look at the current week before a later one is served from the store.
 *
 * Nothing at all when it was read in the last five minutes; otherwise its
 * ordinary read (`readWeekRosters`), which compares and drops. Shared while in
 * flight, so a span read three weeks at a time asks once. Never throws: a week
 * that cannot be read leaves the store as it was, and is not asked for again
 * for a minute.
 */
function checkCurrent(byes) {
  const cfg = storable();
  const cur = currentWeek();
  if (!cfg || cur === null) return Promise.resolve();
  const held = store.readWeek(cfg.leagueId, cfg.season, cur);
  if (held && (held.final || held.ageMs <= LIVE_FRESH_MS)) return Promise.resolve();
  if (Date.now() - currentMissAt < PRO_RETRY_MS) return Promise.resolve();
  const key = `${cfg.leagueId}::${cfg.season}::${cur}`;
  if (!currentCheck || currentCheck.key !== key) {
    const entry = { key, promise: null };
    entry.promise = readWeekRosters(cur, byes ? { byes } : {})
      .then(() => {}, () => { currentMissAt = Date.now(); })
      .finally(() => { if (currentCheck === entry) currentCheck = null; });
    currentCheck = entry;
  }
  return currentCheck.promise;
}

/**
 * THE WIRE AND THE STORED ROSTERS DISAGREE: a man ESPN has just listed as a
 * free agent is on a team in this browser's copy of the same week. The wire is
 * always read live and the rosters may be hours old, so the Players page could
 * show one man as free AND taken. That is a roster move like any other.
 *
 * Only for a week the schedule says is still open, against a copy read before
 * the wire was asked for, and at most once in ten minutes — if ESPN's two
 * answers ever disagree with each other, the pages must not reload in a loop.
 * (The other direction — a man claimed since — cannot be seen from a list of
 * the hundred most-owned free agents; the five-minute clock catches that.)
 */
function wireAgainstStore(week, players, startedAt) {
  const cfg = storable();
  if (!cfg || !Array.isArray(players) || !players.length) return;
  if (!playedSeen.has(`${cfg.leagueId}::${cfg.season}`) || weekIsFinal(week)) return;
  if (Date.now() - wireMoveAt < WIRE_MOVE_EVERY_MS) return;
  const held = store.peekWeek(cfg.leagueId, cfg.season, week);
  if (!held || held.final || !(held.at <= startedAt)) return;
  const owned = new Set();
  for (const t of held.teams) for (const p of (t && t.players) || []) owned.add(p.playerId);
  if (!players.some((p) => owned.has(p.playerId))) return;
  wireMoveAt = Date.now();
  rosterMoved(cfg);
}

/** Every memo in this file that holds something read from ESPN or the cloud. */
function clearMemos() {
  espn.clearReadCache();
  floorCache.clear();
  downCache = null;
  decisionsDownCache = null;
  byesCache = null;
  currentCheck = null;
  currentMissAt = 0;
  proMissAt = 0;
  forgetValueMemos();
}

/**
 * **SYNC NOW**: forget everything that can still change, so the next read of
 * it is ESPN's. The open weeks' stored copies, the minute-long shared reads,
 * the NFL schedule, the floors, the byes and the synced copy held for the page.
 *
 * Played weeks, a week's moves, the readings and the saved projections are not
 * touched — see `store.forgetOpen`. js/connection.js calls this and then asks
 * every open page to load again.
 *
 * @returns {number[]} the weeks whose stored copy went
 */
export function forgetOpen() {
  const cfg = storable();
  const gone = cfg ? store.forgetOpen(cfg.leagueId, cfg.season) : [];
  clearMemos();
  if (typeof espn.clearProSchedule === 'function') espn.clearProSchedule();
  return gone;
}

/**
 * The synced copy has been replaced by a newer sync (js/connection.js saw the
 * date move): let go of the one this page was holding, so the next read takes
 * the new one. No ESPN request follows from this.
 */
export function forgetCloud() {
  downCache = null;
  decisionsDownCache = null;
  byesCache = null;
  floorCache.clear();
  forgetValueMemos();
}

/**
 * A PAGE LEFT OPEN — a tab come back to, the home-screen app reopened — never
 * reloads, so nothing above ever runs for it. js/connection.js asks this when
 * the page becomes visible again: has anything this page was handed gone out of
 * date? True means "load again".
 *
 * The same clocks as a page load, and nothing more: the current week is looked
 * at (free inside five minutes, one request after), a roster move found there
 * counts, a week in play that was re-read counts, and so does any open week
 * this page was handed more than six hours ago. For a live league only — the
 * caller never asks on the synced copy.
 */
export async function recheck() {
  const cfg = storable();
  if (!cfg) return false;
  try {
    if (await cloudDown()) return false;
    const key = `${cfg.leagueId}::${cfg.season}`;
    const moves = ownershipMoves;
    const now = Date.now();
    let changed = false;
    for (const [k, at] of readAt) {
      if (!k.startsWith(`${key}::`)) continue;
      if (!weekIsFinal(Number(k.slice(key.length + 2))) && now - at > store.FRESH_MS) changed = true;
    }
    const cur = currentWeek();
    if (cur !== null) {
      const held = store.readWeek(cfg.leagueId, cfg.season, cur);
      const due = !held || (!held.final && held.ageMs > LIVE_FRESH_MS);
      await checkCurrent();
      if (due && weekInPlay(cur)) changed = true;
    }
    if (changed) {
      espn.clearReadCache();
      floorCache.clear();
    }
    return changed || ownershipMoves !== moves;
  } catch {
    return false;
  }
}

let reading = 0;          // roster reads in flight
let quietWaiters = [];

/**
 * Resolves once no week of rosters has been in flight for a moment (or after
 * `capMs`). What lets the connection bar keep saying "Syncing…" until the
 * pages' re-reads have actually landed, rather than until they were asked for.
 */
export function readsSettled(capMs = 60000) {
  return new Promise((resolve) => {
    let quiet = null;
    let cap = null;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      quietWaiters = quietWaiters.filter((w) => w !== poke);
      resolve();
    };
    const poke = () => {
      clearTimeout(quiet);
      if (reading === 0) quiet = setTimeout(() => (reading === 0 ? done() : null), 700);
    };
    quietWaiters.push(poke);
    cap = setTimeout(done, capMs);
    poke();
  });
}

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
      .then(async (res) => {
        const found = res && res.ok && res.found ? res : null;
        if (!found && downCache === entry) downCache = null;
        if (found) await pullProjHistory(leagueId, season, found.syncedAt);
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
 * THE SAVED PROJECTIONS, DOWN (js/proj-history.js, "THE CLOUD COPY"): any week
 * the synced copy holds that this browser does not is kept here, so the
 * Analysis page's "Proj changes" reads it from storage like any other.
 *
 * Asked ONCE PER SYNC, not once per page: the copies only change when the
 * laptop syncs, so the sync's own time is remembered and a page load against
 * the same sync reads nothing. A new sync costs one read of the list and one
 * per new week (one a week, in season). A browser with nowhere to keep a copy
 * is not asked at all. Awaited, so the first page drawn already has them;
 * silent, and never the page's problem.
 */
async function pullProjHistory(leagueId, season, syncedAt) {
  try {
    if (!projHistory.canKeep()) return;
    if (syncedAt && projHistory.cloudNote(leagueId, season).seen === syncedAt) return;
    const res = await cloud.readProjhist(leagueId, season, {
      lacks: (week, partial) => projHistory.lacks(leagueId, season, week, partial),
    });
    if (!res || !res.ok) return;
    const kept = projHistory.keepCloud(leagueId, season, res.copies);
    // Remembered only when everything the list names is now here.
    if (syncedAt && res.complete && !kept.failed) projHistory.noteCloud(leagueId, season, { seen: syncedAt });
  } catch { /* the page carries on without them */ }
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
 *
 * THE BYE RULE applies here as it does in `readWeekRosters`: a starter whose
 * NFL team is on bye that week counts 0 (`espn.byeAdjustedProjection`), so the
 * Stats path and the roster path put the same total on the same lineup. It
 * bites on a D/ST started on its bye in a week ESPN has not closed, which ESPN
 * is still projecting at a few points. `byes` empty or missing changes nothing.
 */
function projectedTotalForWeek(teamEntry, week, byes) {
  let total = 0;
  for (const e of teamEntry.roster?.entries || []) {
    if (e.lineupSlotId === BENCH_SLOT || e.lineupSlotId === IR_SLOT) continue;

    const player = e.playerPoolEntry?.player;
    const stats = player?.stats || [];
    const projected = stats.find(
      (s) => s.scoringPeriodId === week && s.statSourceId === 1
    );
    if (projected && typeof projected.appliedTotal === 'number') {
      total += espn.byeAdjustedProjection(projected.appliedTotal, player.proTeamId ?? null, week, byes);
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
 *
 * IN A WEEK ESPN HAS NOT DECIDED every player also carries `done`, and a done
 * player `pregame` and his score as `projected` — see "WHAT HAS FINISHED COUNTS
 * NOW" above. `opts.raw` skips that and hands back the reading as ESPN sent it;
 * `buildCloudPayload` is its one caller, because what is uploaded must be raw.
 */
export async function fetchWeekRosters(week, { byes, fresh = false, raw = false } = {}) {
  const { final, ...got } = await readWeekRosters(week, { byes, fresh });
  if (raw) return got;
  return { ...got, teams: await annotateTeams(week, got.teams, { final: final === true }) };
}

/** The read itself: store, cloud, ESPN. `final` only on a stored week that is frozen. */
async function counted(job) {
  reading++;
  try {
    return await job();
  } finally {
    reading--;
    for (const poke of quietWaiters.slice()) poke();
  }
}

const readWeekRosters = (week, opts) => counted(() => readWeekRostersNow(week, opts));

async function readWeekRostersNow(week, { byes, fresh = false } = {}) {
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
  //
  // AND THREE MORE, each for something the held week cannot know about itself:
  //
  //   THE SYNCED COPY IS NEWER. The store used to answer a single week before
  //   the cloud was even asked, while a span of weeks took the cloud first —
  //   so after a new sync one page showed the new teams and the next the old.
  //   Both now take whichever of the two was read from ESPN LATER
  //   (`syncedWeek`), in either direction.
  //
  //   A LATER OPEN WEEK, before the current week has been looked at
  //   (`checkCurrent`) — and the current week itself after five minutes. See
  //   "A ROSTER MOVE REACHES EVERY WEEK".
  //
  //   A PLAYED WEEK THREE DAYS AFTER IT WAS STORED, once (`RECHECK_MS`).
  //
  // None of the last two runs on the synced copy: that device asks ESPN for
  // nothing, and its weeks are replaced whole by the next sync.
  const cfg = storable();
  let byeMap = byes && typeof byes === 'object' ? byes : null;
  let fallback = null;
  let fallbackAt = null;
  let recheck = false;
  const down = await cloudDown();
  const synced = syncedWeek(down, week);
  if (cfg && !fresh) {
    let held = store.readWeek(cfg.leagueId, cfg.season, week);
    if (held && synced && Number.isFinite(synced.at) && synced.at > held.at) held = null;
    if (held && held.teams.length) {
      const decidedSince = !held.final && weekIsFinal(week);
      let byesArrived = false;
      if (!decidedSince && !held.byesKnown) {
        if (!byeMap) byeMap = await fetchByeWeeks();
        byesArrived = byesAreKnown(byeMap);
      }
      const open = !held.final && !decidedSince;
      const cur = down ? null : currentWeek();
      // The current week first. If it shows a roster move, this week's copy has
      // just been dropped and is read again below.
      let moved = false;
      if (open && cur !== null && Number(week) !== cur) {
        await checkCurrent(byeMap);
        moved = !store.readWeek(cfg.leagueId, cfg.season, week);
      }
      // THE CURRENT WEEK, or A WEEK UNDER WAY, held for more than a few
      // minutes: its teams or its points may have moved since. Re-read, and on
      // a failed re-read the held copy still serves.
      let stalePlay = false;
      if (open && held.ageMs > LIVE_FRESH_MS) {
        stalePlay = Number(week) === cur || weekInPlay(week);
        // The roster read can beat the NFL schedule to the page, and then
        // nothing says the week is under way. Somebody already having points is
        // reason enough to wait for it (one request, public, shared).
        const games = typeof espn.heldProGames === 'function' ? espn.heldProGames() : null;
        if (!stalePlay && !down && games === null &&
            held.teams.some((t) => ((t && t.players) || []).some((p) => p && typeof p.actual === 'number'))) {
          await seekProGames();
          stalePlay = weekInPlay(week);
        }
      }
      recheck = held.final && !held.rechecked && !down &&
        Number.isFinite(held.finalAt) && Date.now() - held.finalAt >= RECHECK_MS;
      const served = { week: Number(week), teams: held.teams, from: 'store', final: held.final === true };
      if (!decidedSince && !byesArrived && !stalePlay && !moved && !recheck) {
        noteRead(week, held.at);
        return served;
      }
      if (byesArrived || stalePlay || moved || recheck) { fallback = served; fallbackAt = held.at; }
    }
  }

  // The synced copy next when there is no bridge — see "THE CLOUD
  // SUBSTITUTION" at the top. A week the cloud does not hold falls through to
  // ESPN rather than being reported as empty: on a public league that still
  // works, and on a private one the page gets the same error it gets today.
  // A synced week was decoded — bye rule included — on the desktop.
  if (synced) {
    const got = keepSynced(cfg, down, week, synced);
    noteRead(week, got.at);
    return { week: Number(week), teams: got.teams, from: got.from };
  }

  const startedAt = Date.now();
  let raw;
  try {
    [raw, byeMap] = await Promise.all([
      espn.fetchRosters(week),
      byeMap || fetchByeWeeks(),
    ]);
  } catch (err) {
    if (fallback) { noteRead(week, fallbackAt); return fallback; }
    throw err;
  }
  noteRead(week, Date.now());
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
        // ESPN's season average and position rank (the player card's glance
        // line). A week cached before these existed simply lacks them, and every
        // reader treats a missing one as null.
        seasonAvg: espn.seasonAverageOf(stats, season),
        posRank: espn.positionRankOf(e.playerPoolEntry),
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
  //
  // WHO OWNS WHOM is compared with the copy this replaces, for a week still
  // open: a difference is a roster move, and every other open week read before
  // this one was asked for is dropped (`rosterMoved`).
  if (cfg && teams.length) {
    const final = weekIsFinal(week);
    const was = final || recheck ? null : store.peekWeek(cfg.leagueId, cfg.season, week);
    store.writeWeek(cfg.leagueId, cfg.season, week, teams,
      { final: final || recheck, byesKnown: byesAreKnown(byeMap), rechecked: recheck });
    if (was && !was.final && was.sig !== store.signatureOf(teams)) {
      rosterMoved(cfg, { except: week, olderThan: startedAt });
    }
  }

  return { week, teams, from: 'espn' };
}

/** The synced copy's week, with when the sync was taken — or null. */
function syncedWeek(down, week) {
  const teams = down && down.rosters instanceof Map ? down.rosters.get(Number(week)) : null;
  return teams && teams.length ? { teams, at: cloudAt(down) } : null;
}

/**
 * A synced week, on its way to a page: kept in the store for the next page, and
 * handed out — UNLESS this browser holds a copy of the week read from ESPN
 * LATER than the sync, which then is the one handed out and the one kept.
 *
 * That happens on the computer, when the extension is slow to say hello and one
 * page load reads the synced copy instead: the weeks it read through the
 * extension an hour ago are newer than the last sync, and writing the sync over
 * them put the clock back. js/store.js refuses the older write as well.
 *
 * Kept, because the phone that reads the cloud is the device most likely to
 * walk between four pages on one connection — and a synced week is already a
 * copy, so storing it costs nothing but the bytes. The desktop decoded it with
 * the byes it published alongside, so those say whether the bye rule was
 * applied. Stamped with the SYNC's time, not this minute: the points on it are
 * as old as the sync, and the next page must not take them for a reading just
 * made.
 */
function keepSynced(cfg, down, week, synced) {
  if (cfg) {
    const kept = store.peekWeek(cfg.leagueId, cfg.season, week);
    if (kept && kept.teams.length && Number.isFinite(synced.at) && kept.at > synced.at) {
      return { teams: kept.teams, at: kept.at, from: 'store' };
    }
    store.writeWeek(cfg.leagueId, cfg.season, week, synced.teams,
      { final: weekIsFinal(week), byesKnown: byesAreKnown(down.byes), at: synced.at });
  }
  return { teams: synced.teams, at: synced.at, from: 'cloud' };
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
export function fetchWeeksRosters(weeks, opts) {
  // Counted from the moment it is asked for, not from its first request, so
  // the bar's "Syncing…" does not end in the gap before one (`readsSettled`).
  return counted(() => weeksRostersNow(weeks, opts));
}

async function weeksRostersNow(weeks, { onProgress, fresh = false } = {}) {
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
      const synced = syncedWeek(down, week);
      // The same choice a single week makes (`keepSynced`): the sync's copy,
      // unless this browser read the week from ESPN after the sync was taken.
      const got = synced ? keepSynced(cfg, down, week, synced) : null;
      if (got) {
        noteRead(week, got.at);
        // Stored raw, handed out annotated — the same as `fetchWeekRosters`.
        out.set(Number(week), await annotateTeams(week, got.teams));
      }
      done++;
      if (onProgress) onProgress(done, weeks.length, week, got ? got.from : 'gap');
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
export function fetchWireWeek(week, limit = WIRE_LIMIT) {
  return counted(() => wireWeekNow(week, limit));
}

async function wireWeekNow(week, limit = WIRE_LIMIT) {
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
        // Annotated against the SYNC's time: its points are as old as the sync.
        if (players && players.length) {
          const s = res.syncedAt;
          const at = Date.parse(typeof s === 'string' ? s : (s && (s.wire || s.rosters)) || '');
          return annotateWire(w, players.slice(0, n), Number.isFinite(at) ? at : null);
        }
      } catch {
        /* no cloud: fall through to ESPN, exactly as if it were not configured */
      }
    }
  }

  // The synced list above was decoded with the bye rule already applied.
  const startedAt = Date.now();
  const [raw, byes] = await Promise.all([espn.fetchFreeAgents(w, limit), fetchByeWeeks()]);
  const parsed = (raw?.players || [])
    .map((entry) => espn.parseFreeAgent(entry, w, byes))
    .filter((p) => p.playerId !== null && p.playerId !== undefined);
  // A man on this list who is on a team in the stored rosters has moved.
  try { wireAgainstStore(w, parsed, startedAt); } catch { /* never the wire's problem */ }
  // In a week ESPN has not decided, a free agent whose game is over carries
  // `done`, `pregame` and his score as `projected` — the same rule as a roster.
  return annotateWire(w, parsed, Date.now());
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
      // A FLOOR IS WHAT YOU COULD STILL STREAM, so it is read off what each man
      // was PROJECTED — never off the points of free agents who have already
      // played, which would be hindsight nobody could have claimed.
      const preGame = (p) => (p && p.done === true ? { ...p, projected: p.pregame } : p);
      return floor.positionFloors(wire.map(preGame), { week: w });
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

/**
 * A side's score as it stands.
 *
 * MEASURED on ESPN, 2026-10-05, a week in play: `totalPoints` is 0 until ESPN
 * closes the matchup, and the running score sits beside it in `totalPointsLive`
 * (a decided side has `totalPoints` and no `totalPointsLive`; a week not begun
 * has neither). Reading `totalPoints` alone made every game in the week being
 * played 0–0 from Thursday to Tuesday. So: `totalPoints` when it is anything,
 * else the running score when ESPN gives one, else what `totalPoints` said.
 */
function sidePoints(side) {
  if (!side) return null;
  const total = side.totalPoints;
  if (typeof total === 'number' && total !== 0) return total;
  const live = side.totalPointsLive;
  if (typeof live === 'number' && Number.isFinite(live)) return exactPoints(live);
  return total ?? null;
}

/** One `schedule[]` entry in the shape every page reads. */
function normaliseGame(m, nameById) {
  const week = m.matchupPeriodId;
  const played = isDecidedEntry(m);
  // A decided game is `totalPoints` and nothing else, as it always was.
  const homePts = played ? m.home.totalPoints : sidePoints(m.home);
  const awayPts = played ? m.away.totalPoints : sidePoints(m.away);
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

/** ESPN's `schedule[]`, normalised and split: regular season, and the bracket with its `tier`. */
function splitSchedule(raw, nameById) {
  const regular = [];
  const playoffGames = [];
  for (const m of raw.schedule || []) {
    if (!m.home) continue;
    if (isRegularSeasonEntry(m)) regular.push(normaliseGame(m, nameById));
    else playoffGames.push({ ...normaliseGame(m, nameById), tier: m.playoffTierType });
  }
  return { regular, playoffGames };
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
 *
 * A MATCHUP THAT IS ALREADY OVER IS FINAL HERE BEFORE ESPN SAYS SO (Tim,
 * 2026-10-04; `settleEarly`): in the first undecided week, a game whose every
 * starter on both sides has finished comes back `played: true` with its
 * `winner` and `margin`, and `early: true`. A game ESPN decided carries no
 * `early` key at all. `{ settle: false }` hands back the schedule exactly as
 * ESPN has it — what `buildCloudPayload` uploads, so the phone settles from its
 * own evidence rather than from a verdict that was true at sync time.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.settle=true]
 */
export async function fetchSchedule(opts) {
  const settle = !(opts && opts.settle === false);
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
    // Marked BEFORE anything is settled early, so the store only ever freezes a
    // week ESPN itself has decided.
    markPlayed(games);
    markPlayed(down.schedule.playoffGames || []);
    const synced = (down.schedule.playoffGames || []).map((g) => ({ ...g }));
    if (settle) await settleEarly(games, synced);
    return {
      ...down.schedule,
      teams: (down.schedule.teams || []).map((t) => ({ ...t })),
      weeks,
      byWeek,
      games,
      playoffGames: synced,
    };
  }

  const raw = await espn.fetchMatchups();
  const parsed = espn.parseLeague(raw);
  const nameById = new Map(parsed.teams.map((t) => [t.id, t.name]));

  const { regular, playoffGames } = splitSchedule(raw, nameById);
  const [byWeek, weeks] = groupByWeek(regular);

  // THE ONE PLACE THE LOCAL STORE LEARNS WHAT IS BANKED. A week with a result
  // against it can never change again, so it is kept for the season; everything
  // else is a forecast on a six-hour clock. See "THE LOCAL STORE" at the top,
  // and note that this is read off the SCHEDULE and never off the date.
  //
  // ESPN'S OWN DECISION, and so run before `settleEarly`: a matchup that is
  // over early must not freeze its week's rosters while another is still
  // scoring.
  markPlayed(regular);
  markPlayed(playoffGames);
  if (settle) await settleEarly(regular, playoffGames);

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
    // The league's scoring rules, cut to {statId, points, pointsOverrides}, for
    // the preseason arrows (js/proj-trend.js re-scores ESPN's preseason stats
    // with them). Riding the schedule means the phone's synced copy carries them
    // too, with no request of its own. Null on a payload without mSettings.
    scoringItems: compactScoring(raw.settings?.scoringSettings?.scoringItems),
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
  const without = games.filter((g) => !(g.homeProjected > 0 && g.awayProjected > 0));

  // EVERY DECIDED GAME IS HANDED ON, projection or not: a result counts for the
  // record, the points and the week count whatever became of that week's
  // lineups. This used to hand on only the games WITH a projection whenever
  // they were more than half and still covered every team — so one played
  // week whose roster read failed took its games out of the standings, a week
  // short of ESPN, under a status line that said "Loaded N games".
  //
  // `projectionsAvailable` is therefore "every game has one", and anything
  // less is what the pages already warn about in their status line. A game
  // without one carries 0, which the readers that skip a missing projection
  // already test for (`> 0`); `weeksWithoutProjections` names the weeks.
  const projectionsAvailable = games.length > 0 && !without.length;

  return {
    season,
    isDemo: false,
    name,
    weeks: [...new Set(games.map((g) => g.week))].length,
    teams,
    games,
    injuries: [], // entered by hand in the sheet; no ESPN equivalent
    projectionsAvailable,
    gamesFound: games.length,
    gamesWithProjections: withProjections.length,
    weeksWithoutProjections: [...new Set(without.map((g) => g.week))].sort((a, b) => a - b),
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
function seasonFromCloud(down, settled = null) {
  const schedule = down.schedule;
  if (!schedule || !Array.isArray(schedule.games)) return null;
  // `settled` is `fetchSchedule().games` — the synced games with any matchup
  // that is already over marked played — so the stats count what the schedule
  // counts. Its projected side below is the synced `projectedTotal`, which is
  // the PRE-GAME started lineup's: the upload is always the raw reading.
  const source = Array.isArray(settled) ? settled : schedule.games;

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
  for (const g of source) {
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
export function fetchSeasonData(opts) {
  return counted(() => seasonDataNow(opts)); // see `readsSettled`
}

async function seasonDataNow({ onProgress } = {}) {
  const report = (done, total, label) => onProgress && onProgress(done, total, label);

  report(0, 1, 'Loading league…');

  // The synced copy, when there is no bridge. Without this the stats page is
  // the one page that would still fall over on the phone — it is the only
  // caller of this function, and it would ask ESPN for a private league and be
  // refused while every other page rendered fine.
  const down = await cloudDown();
  if (down) {
    // The schedule with its finished matchups settled, so an early final is in
    // the stats here exactly as it is on the Schedule page. No request beyond
    // what settling costs; a failure is the synced games as they are.
    let settled = null;
    try { settled = (await fetchSchedule()).games; } catch { settled = null; }
    const built = seasonFromCloud(down, settled);
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
  //
  // AND THE MATCHUPS THAT ARE ALREADY OVER (Tim, 2026-10-04) — settled by the
  // same `settleEarly` the schedule uses, on the same payload, so the two agree
  // here too. Their projected side is rebuilt below exactly as a decided week's
  // is: the started lineup's projection, which ESPN stops moving at kickoff.
  const split = splitSchedule(raw, new Map(parsed.teams.map((t) => [t.id, t.name])));
  markPlayed(split.regular);
  markPlayed(split.playoffGames);
  await settleEarly(split.regular, split.playoffGames);
  const early = new Set(split.regular
    .filter((g) => g.early === true)
    .map((g) => `${g.week}|${g.homeId}|${g.awayId}`));

  const played = (raw.schedule || []).filter(
    (m) =>
      isRegularSeasonEntry(m) && m.home && m.away &&
      (isDecidedEntry(m) || early.has(`${m.matchupPeriodId}|${m.home.teamId}|${m.away.teamId}`)) &&
      teamIds.has(m.home.teamId) && teamIds.has(m.away.teamId)
  );

  const weeks = [...new Set(played.map((m) => m.matchupPeriodId))].sort((a, b) => a - b);

  // Re-derive each week's projected totals from that week's starting lineups.
  const projByWeek = new Map(); // week -> Map(teamId -> projected)
  let done = 0;
  // The byes, for the bye rule — the read every roster path makes (cached for
  // the page, so the pages that call this pay for it once either way). Never
  // throws; `{}` leaves every projection as ESPN sent it.
  const byes = weeks.length ? await fetchByeWeeks() : {};

  await inBatches(weeks, 3, async (week) => {
    try {
      const weekRaw = await espn.fetchRosters(week);
      const map = new Map();
      for (const t of weekRaw.teams || []) {
        map.set(t.id, projectedTotalForWeek(t, week, byes));
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
    // A decided game is `totalPoints`; one settled early is the running score.
    const decided = isDecidedEntry(m);
    games.push({
      week,
      homeId: m.home.teamId,
      awayId: m.away.teamId,
      homeActual: exactPoints(decided ? m.home.totalPoints : sidePoints(m.home)),
      awayActual: exactPoints(decided ? m.away.totalPoints : sidePoints(m.away)),
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
      // The NFL schedule would not answer; `seekProGames` reads the same
      // endpoint and need not be refused by it again straight away.
      proMissAt = Date.now();
      return {};
    }
  })().then((byes) => {
    if (!Object.keys(byes).length && byesCache === entry) byesCache = null;
    return byes;
  });
  byesCache = entry;
  return entry.promise.then((b) => ({ ...b }));
}

/**
 * Every NFL team's kickoff per week, `{ [proTeamId]: { [week]: epochMs } }`
 * (`espn.parseProKickoffs`), for the Trade page's "accept by" line.
 *
 * NEVER THROWS: `{}` is "unknown" and the line is then not drawn. Demo is `{}`.
 * The pro schedule is season-level and public (no league, no login), so this
 * reads ESPN even when the byes came from the cloud copy; on the desktop it
 * reuses the bye read's payload (espn.js keeps it), so it costs no request.
 */
export async function fetchProKickoffs() {
  const { leagueId } = espn.getConfig();
  if (!realLeague(leagueId)) return {};
  try {
    const k = await espn.fetchProKickoffs();
    return k && typeof k === 'object' ? k : {};
  } catch {
    return {};
  }
}

/**
 * Every NFL team's game per week, `{ [proTeamId]: { [week]: { at, done } } }`
 * (`espn.parseProGames`), for the week in progress (`capture.liveWeek`).
 *
 * The same read and the same rules as `fetchProKickoffs` above: never throws,
 * `{}` is "unknown" (and then no week is treated as in progress), demo is `{}`.
 */
export async function fetchProGames() {
  const { leagueId } = espn.getConfig();
  if (!realLeague(leagueId) || typeof espn.fetchProGames !== 'function') return {};
  try {
    const g = await espn.fetchProGames();
    return g && typeof g === 'object' ? g : {};
  } catch {
    return {};
  }
}

// ===========================================================================
// PLAYER VALUE: THE FROZEN LINES, AND EVERY ROSTERED MAN'S NUMBER
// ===========================================================================
//
// Tim, 2026-10-09: "I only want a player's value to change if their actual
// future projections have changed for some reason, not because we're moving the
// baselines or whatnot. This means you'll have to pick specific baselines and
// stick to them throughout the season."
//
// js/value.js is the arithmetic. THIS is where the two lines at each position
// (`value.buildBase`) are made ONCE for a league's season and kept:
//
//   the phone's synced copy   `schedule.valueBase`, riding the schedule object
//                             exactly as `scoringItems` does. Read, never made:
//                             a page on the synced copy asks ESPN for nothing
//                             (rule 20), so with none up there it is null.
//   this browser              `localStorage['ff.value.<leagueId>-<season>']`.
//   neither                   made now, from every week left (`valueWeeks`):
//                             the squads (`fetchWeeksRosters`, usually already
//                             in the store) and the wire of each of those weeks
//                             (`fetchWireWeek`, about one request a week) —
//                             once a league-season — then kept.
//   the sample league         made in memory from the demo generators every
//                             time (the same answer every time), never kept.
//
// FIRST COPY WINS. When the computer syncs and the cloud's schedule already
// carries lines, the computer ADOPTS those and sends them back — it never
// replaces them (`valueBaseForSync`). A cleared browser must not mint a second
// baseline once one is up.
//
// IT IS MADE ONLY FROM A WHOLE READING: every week left has its squads, every
// week's wire answered, the byes are known, and every position somebody holds
// has a free agent to measure from. Anything less is null and nothing is kept,
// so it is tried again on the next load — lines frozen for a season are not
// made from half a read.
//
// A MAN'S AVERAGE is ESPN's projection over the weeks left with his bye left
// out (`value.restAvg`). In the week in play a man who has finished counts at
// his `pregame` projection, not his score, so nobody's Value jumps at kickoff.
//
// THE SLOTS are the league's lineup counted off the lineups in use
// (`slotCountsFromLineups` + `slotsFromCounts`, pooled over every week left —
// what js/lineup-avg.js `slotsFromTeamLists` does, and what the Decisions world
// below already uses).

// AN EARLIER SEASON HAS NO VALUE AT ALL (main menu, 2026-10-10: a league's
// earlier seasons can be opened). Value is an average over the weeks LEFT, and
// a finished season has none — but "none left" is read off the bracket, and a
// league whose feed carries no bracket games keeps its playoff weeks "left" for
// ever, with ESPN still answering their squads and wire. Lines made from that
// would be kept, and sent up, for good. So a season before the one being played
// (`bridge.currentSeason`) is never asked: no lines made, kept, adopted or
// sent, no weeks, nobody's Value — the switches stay hidden and the cards carry
// none. The sample league is not a season and is untouched.
const pastSeason = () => Number(espn.getConfig().season) < bridge.currentSeason();

const usableBase = (b) => value.isBase(b) && Object.keys(b.lines).length > 0;
const valueKey = (cfg) => `ff.value.${cfg.leagueId}-${cfg.season}`;

/** The lines this browser is keeping for the league, or null. */
function keptValueBase(cfg) {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const got = JSON.parse(s.getItem(valueKey(cfg)) || 'null');
    return usableBase(got) ? got : null;
  } catch {
    return null;
  }
}

/** Keep them. False when this browser has nowhere to. */
function keepValueBase(cfg, base) {
  try {
    globalThis.localStorage.setItem(valueKey(cfg), JSON.stringify(base));
    return true;
  } catch {
    return false;
  }
}

/**
 * THE WEEKS LEFT: every week of the season that is not finished — the regular
 * season's open weeks and the league's playoff weeks not yet decided. The rule
 * of js/draft-page.js `weeksOf`, off the same three functions of js/capture.js.
 * Every Value on the site is an average over exactly these.
 *
 * @param {Object} schedule what `fetchSchedule` returned (or the demo's)
 * @returns {number[]} ascending; empty when the season is over or unreadable
 */
export function valueWeeks(schedule) {
  try {
    if (!schedule) return [];
    const data = capture.normalizeSchedule(schedule, { isDemo: false });
    return [...new Set([...capture.openWeeks(data), ...capture.playoffWeeksLeft(data)])]
      .map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** What ESPN projected a man for in a week: never the score of one who has finished. */
function pregameOf(p) {
  const v = p && p.done === true ? p.pregame : p && p.projected;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** week -> player rows (a squad's or the wire's)  =>  playerId -> his weeks. */
function menOf(weekLists, weeks) {
  const men = new Map();
  for (const w of weeks) {
    for (const p of weekLists.get(w) || []) {
      if (!p || p.playerId === null || p.playerId === undefined) continue;
      let m = men.get(p.playerId);
      if (!m) {
        m = { playerId: p.playerId, position: null, proTeamId: null, byWeek: {} };
        men.set(p.playerId, m);
      }
      if (!m.position && p.position && p.position !== 'UNK') m.position = p.position;
      if (m.proTeamId === null && p.proTeamId !== null && p.proTeamId !== undefined) m.proTeamId = p.proTeamId;
      m.byWeek[w] = pregameOf(p);
    }
  }
  return men;
}

/** Everybody on a squad in any of `weeks`. */
function squadMen(weekTeams, weeks) {
  return menOf(new Map(weeks.map((w) => [
    w, (weekTeams.get(w) || []).flatMap((t) => (t && t.players) || []),
  ])), weeks);
}

/** Each man with his average over `weeks`, his bye left out. */
function withRestAvg(men, weeks, byes) {
  return [...men.values()].map((m) => {
    const bye = byes && m.proTeamId !== null ? Number(byes[m.proTeamId]) : NaN;
    return {
      playerId: m.playerId,
      position: m.position,
      avg: value.restAvg(m.byWeek, weeks, Number.isFinite(bye) ? bye : null),
    };
  });
}

/**
 * The lines, from one whole reading — or null (see "IT IS MADE ONLY FROM A
 * WHOLE READING"). Pure: the same reading gives the same lines.
 *
 * @param {Object} o
 * @param {number[]} o.weeks the weeks left
 * @param {Map<number, Array>} o.weekTeams week -> squads
 * @param {Map<number, Array>} o.weekWire week -> free agents
 * @param {Object} o.byes `{proTeamId: byeWeek}`
 */
function valueBaseFrom({ weeks, weekTeams, weekWire, byes, now = Date.now() }) {
  if (!weeks || !weeks.length) return null;
  const whole = weeks.every((w) =>
    Array.isArray(weekTeams.get(w)) && weekTeams.get(w).length > 0 && Array.isArray(weekWire.get(w)));
  if (!whole) return null;
  const counts = slotCountsFromLineups(weeks.flatMap((w) => weekTeams.get(w)));
  if (!counts) return null;

  const owned = squadMen(weekTeams, weeks);
  const free = menOf(weekWire, weeks);
  // A man on a squad is not a free agent, whatever a wire read a minute apart says.
  for (const id of owned.keys()) free.delete(id);
  const rostered = withRestAvg(owned, weeks, byes);

  const base = value.buildBase({
    rostered,
    freeAgents: withRestAvg(free, weeks, byes),
    slots: slotsFromCounts(counts),
    teams: weekTeams.get(weeks[0]).length,
    week: weeks[0],
    now,
  });
  if (!usableBase(base)) return null;
  const held = (pos) => rostered.some((p) => p.position === pos && p.avg !== null);
  if (value.VALUE_POSITIONS.some((pos) => held(pos) && !base.lines[pos])) return null;
  return base;
}

let valueBaseMemo = null;     // { key, promise }
let playerValuesMemo = null;  // { key, promise }
let demoValueMemo = null;     // the sample league's weeks, squads and lines

function forgetValueMemos() {
  valueBaseMemo = null;
  playerValuesMemo = null;
}

const valueMemoKey = (demo) => {
  const { leagueId, season } = espn.getConfig();
  return `${demo ? 'demo' : 'live'}|${leagueId}::${season}`;
};

/** The sample league: made in memory, the same every time, never kept. */
function demoValueWorld() {
  if (!demoValueMemo) {
    demoValueMemo = (async () => {
      const demo = await import('./demo-rosters.js');
      const weeks = valueWeeks(demo.generateDemoSchedule());
      const weekTeams = new Map(weeks.map((w) => [w, demo.generateDemoWeekRosters(w).teams]));
      const weekWire = new Map(weeks.map((w) => [w, demo.generateDemoFreeAgents(w)]));
      return { weeks, weekTeams, base: valueBaseFrom({ weeks, weekTeams, weekWire, byes: {}, now: 0 }) };
    })();
    demoValueMemo.catch(() => { demoValueMemo = null; });
  }
  return demoValueMemo;
}

/**
 * THE FROZEN LINES for this league's season, or null when there are none (yet).
 *
 * One answer per page load. NEVER THROWS, and on the phone's synced copy it
 * makes no ESPN request at all — see the top of this section for the order.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.demo] the sample league's, whatever league is connected
 *   (a page showing demo data beside a saved league). With no real league
 *   connected it is the sample league's either way.
 * @returns {Promise<Object|null>} `value.buildBase`'s shape
 */
export function fetchValueBase({ demo = false } = {}) {
  const key = valueMemoKey(demo);
  if (!valueBaseMemo || valueBaseMemo.key !== key) {
    valueBaseMemo = { key, promise: valueBaseNow(demo).catch(() => null) };
  }
  return valueBaseMemo.promise;
}

async function valueBaseNow(demo) {
  const cfg = demo ? null : storable();
  if (!cfg) return (await demoValueWorld()).base;
  if (pastSeason()) return null;

  // THE SYNCED COPY: what the computer sent, or nothing. Never made here.
  const down = await cloudDown();
  if (down) {
    const up = down.schedule ? down.schedule.valueBase : null;
    return usableBase(up) ? up : null;
  }

  const kept = keptValueBase(cfg);
  if (kept) return kept;

  const weeks = valueWeeks(await fetchSchedule());
  if (!weeks.length) return null;
  const byes = await fetchByeWeeks();
  if (!byesAreKnown(byes)) return null;
  const weekTeams = await fetchWeeksRosters(weeks);
  const weekWire = new Map();
  // A week the wire refuses throws, and then nothing is made this time.
  await inBatches(weeks, 3, async (w) => { weekWire.set(w, await fetchWireWeek(w)); });

  const base = valueBaseFrom({ weeks, weekTeams, weekWire, byes });
  if (!base) return null;
  // Another tab may have kept one while this read ran: the first one stands.
  // And lines that cannot be kept are not handed out — they would be different
  // lines on the next load, which is the one thing they may not be.
  return keptValueBase(cfg) || (keepValueBase(cfg, base) ? base : null);
}

/**
 * EVERY ROSTERED MAN'S VALUE, off the frozen lines.
 *
 * `weeks` is the weeks left (`valueWeeks`) — the list every Value on a page is
 * averaged over. `byId` has a man for everybody on a squad in any of them:
 * `position`, `avg` (his `restAvg`, null when no week counts) and `value`
 * (`value.valueOf`; null with no lines, no line at his position, or no
 * average). `lookup(playerId)` is his value or null — what the player card's
 * `setValueSource` takes.
 *
 * One answer per page load; dropped with the other memos when the squads are
 * re-read (Sync now, a newer sync). NEVER THROWS: a failure is an empty answer.
 * On the phone's synced copy it asks ESPN for nothing beyond what
 * `fetchSchedule` and `fetchWeeksRosters` already do there.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.demo] see `fetchValueBase`
 * @returns {Promise<{ base:Object|null, weeks:number[],
 *   byId:Map<number, {position:string|null, avg:number|null, value:number|null}>,
 *   lookup:function(number|string):number|null }>}
 */
export function fetchPlayerValues({ demo = false } = {}) {
  const key = valueMemoKey(demo);
  if (!playerValuesMemo || playerValuesMemo.key !== key) {
    playerValuesMemo = { key, promise: playerValuesNow(demo).catch(() => playerValuesOf(null, [], new Map(), {})) };
  }
  return playerValuesMemo.promise;
}

function playerValuesOf(base, weeks, weekTeams, byes) {
  const byId = new Map();
  for (const m of withRestAvg(squadMen(weekTeams, weeks), weeks, byes)) {
    byId.set(m.playerId, { position: m.position, avg: m.avg, value: value.valueOf(base, m.position, m.avg) });
  }
  const lookup = (id) => {
    const hit = byId.get(id) ?? byId.get(Number(id));
    return hit && typeof hit.value === 'number' ? hit.value : null;
  };
  return { base, weeks, byId, lookup };
}

async function playerValuesNow(demo) {
  if (demo || !storable()) {
    const world = await demoValueWorld();
    return playerValuesOf(world.base, world.weeks, world.weekTeams, {});
  }
  if (pastSeason()) return playerValuesOf(null, [], new Map(), {});
  const base = await fetchValueBase();
  const weeks = valueWeeks(await fetchSchedule());
  if (!weeks.length) return playerValuesOf(base, [], new Map(), {});
  const weekTeams = await fetchWeeksRosters(weeks);
  // On the synced copy the byes are the synced ones or none: `fetchByeWeeks`
  // would go on to ask ESPN when the sync carried none, and this may not.
  const down = await cloudDown();
  const byes = down ? (down.byes || {}) : await fetchByeWeeks();
  return playerValuesOf(base, weeks, weekTeams, byes);
}

/**
 * The lines a sync sends — FIRST COPY WINS.
 *
 * The cloud's schedule is looked at before it is written over (two document
 * reads a sync; the check-before-write of js/cloud.js `writeProjhist`): lines
 * already up there are adopted — kept in this browser in place of its own — and
 * sent back unchanged. Only when the cloud has answered and holds none are this
 * browser's sent, made here from the sync's own reading if it has none either
 * (no request: every squad and wire week was just read). When the cloud could
 * not be asked, nothing new is minted.
 */
async function valueBaseForSync({ schedule, rosters, wire, byes }) {
  const cfg = storable();
  if (!cfg || pastSeason()) return null;

  let asked = false;
  let up = null;
  try {
    const res = await cloud.readDown(cfg.leagueId, cfg.season, { shapes: ['schedule'] });
    asked = Boolean(res && res.ok);
    up = res && res.ok && res.found && res.schedule ? res.schedule.valueBase : null;
  } catch {
    asked = false;
  }
  if (usableBase(up)) {
    keepValueBase(cfg, up);
    forgetValueMemos();
    return up;
  }

  const kept = keptValueBase(cfg);
  if (kept) return kept;
  if (!asked || !byesAreKnown(byes)) return null;

  const base = valueBaseFrom({ weeks: valueWeeks(schedule), weekTeams: rosters, weekWire: wire, byes });
  if (!base) return null;
  keepValueBase(cfg, base);
  forgetValueMemos();
  return base;
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

  // UNSETTLED, and the rosters below RAW: what goes up is ESPN's own reading.
  // "This matchup is over" is true of a moment; the phone works it out again
  // from the synced rosters, aged by the sync's own time, and the NFL schedule.
  const schedule = await fetchSchedule({ settle: false });

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
      const { teams } = await fetchWeekRosters(week, { byes, fresh: true, raw: true });
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

  // THE DECISIONS REVIEW'S WEEKS, so the page works on the phone (see "THE
  // WORLD, IN THE SYNCED COPY" below). Built here rather than only when the
  // Decisions page happens to have been opened on this machine. Last, when the
  // decided weeks' rosters are already held: a week costs two requests the
  // first time it is decided and none after. Any failure sends none, and the
  // sync is still a sync.
  let decisions = null;
  try {
    decisions = (await gatherDecisions()).copy;
  } catch { /* ESPN refused a week: nothing of it goes up this time */ }

  const payload = {
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
  // Absent, not empty, for a league with none: the payload is then exactly
  // what it was before this existed.
  if (decisions && decisions.size) payload.decisions = decisions;

  // THE SAVED PROJECTIONS (js/proj-history.js): every week this browser holds a
  // copy of, out of storage — no request. js/cloud.js sends the ones that are
  // not up yet, once each. Absent, not empty, in a browser that holds none. A
  // failure sends none, and the sync is still a sync.
  try {
    const cfg = storable();
    const held = cfg ? projHistory.uploads(cfg.leagueId, cfg.season) : [];
    if (held.length) payload.projhist = held;
  } catch { /* nothing of it goes up this time */ }

  // PLAYER VALUE'S FROZEN LINES ride the schedule as `valueBase`, the way
  // `scoringItems` does, so the phone has them with no read of its own. The
  // first copy up wins (`valueBaseForSync`). On a copy of the schedule: the
  // one above is what the rest of this function was handed. A failure sends
  // none, and the sync is still a sync.
  try {
    const base = await valueBaseForSync({ schedule, rosters, wire, byes });
    if (base) payload.schedule = { ...schedule, valueBase: base };
  } catch { /* nothing of it goes up this time */ }
  return payload;
}

// ===========================================================================
// THE DECISIONS REVIEW: WHAT HAPPENED, AS ONE OBJECT
// ===========================================================================
//
// Tim, 2026-10-05: "select any user and have a list of all the decisions
// they've made, and what would have happened if they hadn't made that that
// decision ... Because we know what every single player scored every single
// week, we can accurately create these 'mirror universes' as if they were real."
//
// js/decisions.js replays the season with one decision undone; it is pure, and
// THIS is what it replays — the `world` of docs/decisions-review-plan.md ("The
// contract"), gathered once:
//
//   weeks     every week ESPN has decided EVERY game of, from week 1, no gaps
//   games     those weeks' results, with the started lineups' projections
//   rosters   `fetchWeeksRosters` for them, untouched
//   moves     every add, drop and trade made in them, oldest first
//   players   every man who was on a roster or is named in a move, with his
//             score, projection and kickoff in EVERY one of those weeks —
//             including the weeks he was on nobody's team, which is what makes
//             "what if I had kept him" answerable
//
// WHAT IT COSTS. The schedule and the NFL schedule, one read each, every load.
// Then, per decided week, ONCE: its rosters (js/store.js already keeps those),
// its transactions, and the week of every named man who was not on a roster in
// it — three requests. The last two are frozen in js/store.js beside the
// rosters, so the next load costs that week nothing. A man first named by a
// LATER week's move is bought for the earlier weeks then — one more request for
// each earlier week, once.
//
// THE WEEK IN PLAY (Tim, 2026-10-05: "Could you just display everything you're
// able to, like we do across the rest of the cite?"). Once the first undecided
// week has a matchup that is over (`fetchSchedule` settles it early), that week
// is the LAST of `weeks` and `partialWeek` names it:
//
//   games     its finished matchups with their scores; the others with
//             `homeActual` / `awayActual` null
//   rosters   every man carries `done`, and `projected` is his PRE-GAME
//             projection (not the score `fetchWeeksRosters` overwrites it with)
//   players   `byWeek[week].done` — true for everybody in a decided week
//
// Nothing of it is frozen. Its transactions and loose player-weeks are kept for
// `LIVE_FRESH_MS` only (js/store.js, `writeOpenDecisionWeek`), so a reload
// inside five minutes asks ESPN for nothing and one after it for two requests
// (three with the rosters, which follow the same clock).
//
// A FAILURE IS AN ERROR HERE, not a gap. Every other fetcher in this file lets
// a week ESPN refuses simply be absent; a season replayed with one week's moves
// missing would be a different season printed as fact.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The weeks ESPN has decided every game of, in order, stopping at the first that is not. */
function decidedWeeks(schedule) {
  const out = [];
  for (const w of schedule.weeks || []) {
    const games = (schedule.byWeek.get(w) || []).filter((g) => g.awayId !== null && g.awayId !== undefined);
    if (!games.length || !games.every((g) => g.played && g.early !== true)) break;
    out.push(Number(w));
  }
  return out;
}

/** Every player id a move names. */
function moveIds(m) {
  return [...(m.adds || []), ...(m.drops || []), ...(m.trade ? [...m.trade.gives, ...m.trade.gets] : [])];
}

/** Moves in time order; the order they were handed in settles a tie. */
function byTime(moves) {
  return moves
    .map((m, i) => [m, i])
    .sort((a, b) => a[0].at - b[0].at || a[1] - b[1])
    .map(([m]) => m);
}

/**
 * TRADES THE TRANSACTION FEED DID NOT LIST, found from the rosters themselves.
 *
 * ESPN's trade record is the one shape here nobody has measured (the public
 * test league has never made a trade — see `espn.parseTransactions`), so this
 * is the net under it: two teams that EXCHANGED players between one week's
 * rosters and the next, where no add and no listed trade explains it, traded.
 *
 * A man counts as having gone from A to B when he ended last week on A and this
 * week on B — or B dropped him this week without ever adding him — and B did
 * not add him off the wire and no listed trade already moved him. It takes
 * movement BOTH ways to be a trade; a man who simply turns up on another team
 * (a commissioner's edit) is not one.
 *
 * NEVER THE SAME TRADE TWICE: a man a listed trade moved is taken out before
 * anything is paired, so what is left over is only what ESPN did not record.
 *
 * `at` is unknown, so it is put a moment before the week's first NFL kickoff:
 * the players were on their new teams when the week was scored, which is all
 * the rosters can say.
 *
 * @param {Object} o
 * @param {number[]} o.weeks ascending
 * @param {Map<number, Array>} o.rosters week -> teams
 * @param {Array} o.moves what the feed listed, any order
 * @param {Object|null} [o.draft] `espn.parseDraftRosters` — the rosters before
 *   week 1's moves; without it week 1 has nothing to be compared with
 * @param {Object} [o.firstKickoff] `{ [week]: epochMs }`
 * @returns {Array} trade moves in the contract's shape, each `inferred: true`
 */
export function inferTrades({ weeks, rosters, moves, draft = null, firstKickoff = {} }) {
  const out = [];
  let prev = null;
  let prevWeek = 0;
  if (draft && Object.keys(draft).length) {
    prev = new Map();
    for (const [teamId, ids] of Object.entries(draft)) for (const id of ids) prev.set(id, Number(teamId));
  }

  for (const week of weeks || []) {
    const cur = new Map();
    for (const t of rosters.get(week) || []) for (const p of t.players || []) cur.set(p.playerId, t.id);
    if (prev && cur.size) {
      const inWindow = (m) => Number(m.week) > prevWeek && Number(m.week) <= week;
      const added = (teamId, id) => (moves || []).some(
        (m) => m.kind !== 'trade' && m.teamId === teamId && inWindow(m) && (m.adds || []).includes(id));
      // A listed trade may sit in the week before the rosters show it (accepted
      // then, upheld after the review).
      const listed = (from, to, id) => (moves || []).some((m) => m.kind === 'trade' &&
        Number(m.week) >= prevWeek && Number(m.week) <= week && (
        (m.teamId === from && m.trade.withTeamId === to && m.trade.gives.includes(id)) ||
        (m.teamId === to && m.trade.withTeamId === from && m.trade.gets.includes(id))));

      const sent = new Map(); // `${from}>${to}` -> [playerId]
      const note = (from, to, id) => {
        if (from === undefined || from === to || added(to, id) || listed(from, to, id)) return;
        const key = `${from}>${to}`;
        if (!sent.has(key)) sent.set(key, []);
        if (!sent.get(key).includes(id)) sent.get(key).push(id);
      };
      for (const [id, to] of cur) note(prev.get(id), to, id);
      // Received and cut inside the same week: he is on no roster to be seen.
      for (const m of moves || []) {
        if (m.kind === 'trade' || !inWindow(m)) continue;
        for (const id of m.drops || []) note(prev.get(id), m.teamId, id);
      }

      for (const [key, gives] of sent) {
        const [a, b] = key.split('>').map(Number);
        const gets = sent.get(`${b}>${a}`);
        if (a > b || !gets || !gets.length) continue;
        const kick = Number(firstKickoff && firstKickoff[week]);
        const inWeek = (moves || []).filter((m) => Number(m.week) === week).map((m) => m.at);
        out.push({
          id: `inferred:${week}:${a}:${b}`,
          kind: 'trade',
          week,
          at: Number.isFinite(kick) && kick > 0 ? kick - 1 : (inWeek.length ? Math.min(...inWeek) - 1 : 0),
          teamId: a,
          adds: [],
          drops: [],
          trade: { withTeamId: b, gives: gives.slice().sort((x, y) => x - y), gets: gets.slice().sort((x, y) => x - y) },
          inferred: true,
        });
      }
    }
    if (cur.size) { prev = cur; prevWeek = week; }
  }
  return out;
}

/** What `fetchDecisionWorld` hands back, both for a league and for the sample. */
function assembleWorld({ isDemo, name, slots, teams, weeks, games, rosters, moves, players, roster, requests, partialWeek = null }) {
  return {
    slots, teams, weeks, games, rosters, moves, players,
    limits: { roster },
    // The week in play when it is the last of `weeks`, else null.
    partialWeek,
    // Beyond the contract, for the page's badge and its cost line.
    isDemo, name, requests,
  };
}

/**
 * THE `world` js/decisions.js REPLAYS — see the note above and "The contract"
 * in docs/decisions-review-plan.md, which this returns to the letter:
 *
 *   { slots, teams: [{ id, name, teamName }], weeks, games, rosters: Map,
 *     moves, players: Map<playerId, { name, position, byWeek }>, limits: { roster } }
 *
 * plus `isDemo`, `name` (the league's) and `requests` — how many ESPN reads
 * this call made beyond the schedule and the NFL schedule: rosters it had to
 * buy, transactions, player-weeks. Zero once every decided week is held.
 * And `partialWeek`: the week in play when it is included (always the last of
 * `weeks`), else null — see "THE WEEK IN PLAY" above.
 *
 * `byWeek[week]` is `{ actual, projected, kickoff, done }` for EVERY week in
 * `weeks`; `done` is true throughout a decided week.
 * `actual` and `projected` are always numbers: a man with no line in a decided
 * week scored 0, and one ESPN had no projection for is 0 too (the roster
 * objects in `rosters` keep their nulls, as everywhere else on the site). The
 * projection has the bye rule applied. `kickoff` is his NFL team's kickoff that
 * week in epoch ms — null on his bye, and null for everybody when the NFL
 * schedule could not be read.
 *
 * A move may carry `inferred: true`: a trade found from the rosters rather than
 * listed by ESPN (`inferTrades`).
 *
 * DEMO returns the sample league's world, with no request at all.
 *
 * THROWS when ESPN will not hand over a decided week's rosters, transactions or
 * player-weeks.
 *
 * ON THE SYNCED COPY (a phone, a private league) nothing is asked of ESPN at
 * all: the rosters and schedule are the copy's, and the rest is the copy's
 * `decisions/<week>` documents — see "THE WORLD, IN THE SYNCED COPY" below. A
 * copy that does not hold every decided week of it yet THROWS an Error with
 * `code: 'decisions-not-synced'` and a one-sentence message. The week in play
 * is included when the copy carries its document and left out when it does not.
 *
 * @param {Object} [opts]
 * @param {(done:number,total:number,label:string)=>void} [opts.onProgress]
 * @param {boolean} [opts.demo] the sample league's world even though a league
 *   is connected — for a page parked on Demo
 */
export async function fetchDecisionWorld(opts = {}) {
  return (await counted(() => gatherDecisions(opts))).world; // see `readsSettled`
}

// ---------------------------------------------- the world, in the synced copy
//
// THE WORLD, IN THE SYNCED COPY. The phone cannot ask ESPN for a private
// league's transactions, so the desktop's sync carries what it read: one
// document per decided week, `{ moves, players, draft, kick, league }` —
//
//   moves, players, draft   the week's record exactly as js/store.js freezes it
//   kick                    `{ [proTeamId]: kickoff ms }` for that week, because
//                           the copy holds the byes but not the NFL schedule
//   league                  `{ starterSlots, rosterSize }` as ESPN's settings
//                           say, or null when they could not be read
//
// THE WEEK IN PLAY rides the same way, in a document marked `open: true`: what
// was read of it at sync time, rewritten by each sync whose reading differs and
// replaced by the decided week's document once ESPN closes it. A reader never
// takes an `open` document for a decided week's.
//
// `buildCloudPayload` builds the world itself (it is the one reader of `copy`),
// so the phone does not depend on the Decisions page having been opened on the
// desktop. That costs the sync two requests for a week the first time it is
// decided and nothing after, since the week is frozen here.

/** The one error a page shows as a sentence: the copy has no decisions yet. */
function decisionsNotSynced() {
  const err = new Error('Decisions need a fresh sync from your laptop.');
  err.code = 'decisions-not-synced';
  return err;
}

/** One read of the copy's decision weeks per page, like `cloudDown`; a miss is not kept. */
let decisionsDownCache = null; // { key, promise }

/** `must` are the decided weeks; `open` is the week in play, which may be absent. */
function decisionsDown(leagueId, season, must, open = null) {
  const weeks = open === null ? must : [...must, open];
  const key = `${leagueId}::${season}::${weeks.join(',')}`;
  if (!decisionsDownCache || decisionsDownCache.key !== key) {
    const entry = { key, promise: null };
    entry.promise = Promise.resolve()
      .then(() => cloud.readDecisions(leagueId, season, weeks))
      .then((res) => {
        const got = res && res.decisions instanceof Map ? res.decisions : new Map();
        if (!must.every((w) => got.has(w)) && decisionsDownCache === entry) decisionsDownCache = null;
        return got;
      })
      .catch(() => {
        if (decisionsDownCache === entry) decisionsDownCache = null;
        return new Map();
      });
    decisionsDownCache = entry;
  }
  return decisionsDownCache.promise;
}

/** `{ world, copy }` — `copy` is what the sync uploads; null on demo and on the synced copy. */
async function gatherDecisions({ onProgress, demo = false } = {}) {
  const report = (done, total, label) => {
    if (!onProgress) return;
    try { onProgress(done, total, label); } catch { /* a bad listener must not stop the read */ }
  };

  const cfg = storable();
  if (demo || !cfg) return { world: demoDecisionWorld(), copy: null };

  report(0, 1, 'Loading league…');
  // ESPN's OWN verdict decides which weeks are history (`decidedWeeks` leaves
  // out a game settled early). The settled schedule is read all the same: its
  // early finals are what make the next week THE WEEK IN PLAY.
  const began = Date.now();
  const schedule = await fetchSchedule();
  const decided = decidedWeeks(schedule);
  const teams = (schedule.teams || []).map((t) => ({ id: t.id, name: t.name, teamName: t.teamName || '' }));
  const nextWeek = (schedule.weeks || []).map(Number)[decided.length];
  let partial = nextWeek !== undefined && (schedule.byWeek.get(nextWeek) || schedule.byWeek.get(String(nextWeek)) || [])
    .some((g) => g.awayId !== null && g.awayId !== undefined && g.played)
    ? nextWeek
    : null;
  let weeks = partial === null ? decided : [...decided, partial];
  const dropPartial = () => {
    rosters.delete(partial);
    records.delete(partial);
    weeks = decided;
    partial = null;
  };

  // The league's lineup and roster size. The schedule's own read carries them
  // (mSettings) and js/espn.js shares that read for a minute, so this is free —
  // except on the synced copy, where there is no ESPN to ask and the lineups in
  // use say it instead.
  let settings = null;
  const down = await cloudDown();
  if (!down) {
    try { settings = espn.parseLeague(await espn.fetchMatchups()); } catch { settings = null; }
  }

  let requests = 0;
  const bought = new Set(); // the weeks whose rosters the read below paid for
  const total = weeks.length * 3;
  let done = 0;

  const rosters = weeks.length
    ? await fetchWeeksRosters(weeks, {
      onProgress: (d, t, week, from) => {
        if (from === 'espn') { requests++; bought.add(Number(week)); }
        report(++done, total, `Week ${week} squads`);
      },
    })
    : new Map();
  const gap = decided.find((w) => !rosters.has(w));
  if (gap !== undefined) {
    if (down) throw decisionsNotSynced();
    throw new Error(`ESPN would not return week ${gap}’s rosters.`);
  }

  const records = new Map(); // week -> { moves, players, draft, closed, dirty, at }

  // THE WEEK IN PLAY, as the engine wants it: every man says whether he has
  // finished, and `projected` is what was projected BEFORE he played. Without
  // its rosters, or with nobody in them finished, there is nothing to add.
  if (partial !== null) {
    const read = rosters.get(partial) || [];
    if (!read.some((t) => (t.players || []).some((p) => p.done === true))) {
      dropPartial();
    } else {
      // Settling the schedule is what bought these rosters, when they were
      // bought during this call: one request, counted here because the squads'
      // own count saw only the store answer.
      if (!down && !bought.has(partial) && weekReadAt(partial) >= began) requests++;
      rosters.set(partial, read.map((t) => {
        const seen = new Map(); // by id: a stored week's `starters` are copies
        const conv = (p) => {
          if (!seen.has(p.playerId)) {
            const { pregame, ...rest } = p;
            seen.set(p.playerId, { ...rest, projected: p.done === true ? (pregame ?? null) : p.projected, done: p.done === true });
          }
          return seen.get(p.playerId);
        };
        const out = { ...t, players: (t.players || []).map(conv) };
        if (Array.isArray(t.starters)) out.starters = t.starters.map(conv);
        if (Array.isArray(t.bench)) out.bench = t.bench.map(conv);
        return out;
      }));
    }
  }

  // ---- the moves: this browser's frozen copy, else ESPN ----
  // ---- or, on the synced copy, the copy's: every decided week or nothing ----
  let syncedKick = null; // { [proTeamId]: { [week]: { at } } }, as `fetchProGames` has it
  if (down && weeks.length) {
    const got = await decisionsDown(cfg.leagueId, cfg.season, decided, partial);
    // An `open` document is a week in play as some sync saw it — never history.
    if (!decided.every((w) => got.has(w) && got.get(w).open !== true)) throw decisionsNotSynced();
    if (partial !== null && !got.has(partial)) dropPartial();
    syncedKick = {};
    for (const week of weeks) {
      const doc = got.get(week);
      records.set(week, {
        moves: doc.moves, players: doc.players, draft: doc.draft || null,
        closed: week !== partial, dirty: false, at: cloudAt(down),
      });
      for (const [proTeamId, at] of Object.entries(doc.kick || {})) {
        if (!syncedKick[proTeamId]) syncedKick[proTeamId] = {};
        syncedKick[proTeamId][week] = { at };
      }
      report(++done, total, `Week ${week} moves`);
    }
    const league = got.get(weeks[weeks.length - 1]).league;
    if (league && typeof league === 'object') settings = league;
  }
  // The week in play first, and on its own terms: held for a few minutes, never
  // frozen, and a refusal costs only that week — the decided ones are history
  // and still load.
  if (!down && partial !== null) {
    const held = store.readOpenDecisionWeek(cfg.leagueId, cfg.season, partial);
    if (held && held.ageMs <= LIVE_FRESH_MS) {
      records.set(partial, { moves: held.moves, players: held.players, draft: held.draft, closed: false, dirty: false, at: held.at });
    } else {
      try {
        const raw = await espn.fetchTransactions(partial);
        requests++;
        records.set(partial, {
          moves: espn.parseTransactions(raw), players: {}, draft: espn.parseDraftRosters(raw),
          closed: false, dirty: true, at: Date.now(),
        });
      } catch {
        if (held) records.set(partial, { moves: held.moves, players: held.players, draft: held.draft, closed: false, dirty: false, at: held.at });
        else dropPartial();
      }
    }
    if (partial !== null) report(++done, total, `Week ${partial} moves`);
  }
  await inBatches(down ? [] : decided, 3, async (week) => {
    const held = store.readDecisionWeek(cfg.leagueId, cfg.season, week);
    if (held) {
      records.set(week, { ...held, closed: true, dirty: false });
    } else {
      const raw = await espn.fetchTransactions(week);
      requests++;
      // FROZEN ONLY ONCE ESPN HAS MOVED ON FROM THE WEEK. A transaction is
      // filed under the scoring period it was made in, so a week's list is
      // complete when the league's period has passed it; "every game decided"
      // and "the period has rolled" were the same moment whenever measured, but
      // nothing promises it. Unknown is not frozen.
      const now = Math.max(Number(raw?.status?.latestScoringPeriod) || 0, Number(raw?.status?.currentMatchupPeriod) || 0);
      records.set(week, {
        moves: espn.parseTransactions(raw),
        players: {},
        draft: espn.parseDraftRosters(raw),
        closed: now > week,
        dirty: true,
      });
    }
    report(++done, total, `Week ${week} moves`);
  });

  // The NFL's games, for the kickoffs, and the byes for the bye rule. One
  // payload for both, and `fetchWeeksRosters` has usually bought it already.
  // The synced copy carries both, so a phone asks ESPN for neither.
  const [pro, byes] = down
    ? [syncedKick || {}, down.byes || {}]
    : await Promise.all([fetchProGames(), fetchByeWeeks()]);
  const firstKickoff = {};
  for (const byWeek of Object.values(pro || {})) {
    for (const w of weeks) {
      const at = byWeek && byWeek[w] && byWeek[w].at;
      if (Number.isFinite(at) && (!firstKickoff[w] || at < firstKickoff[w])) firstKickoff[w] = at;
    }
  }

  const seen = new Set();
  const listed = espn.dropRepeatTrades(byTime(
    weeks.flatMap((w) => records.get(w).moves).filter((m) => !seen.has(m.id) && seen.add(m.id))
  ));
  const draft = weeks.map((w) => records.get(w).draft).find((d) => d && Object.keys(d).length) || null;
  const moves = byTime([...listed, ...inferTrades({ weeks, rosters, moves: listed, draft, firstKickoff })]);

  // ---- every man's every week ----
  const onRoster = new Map(); // week -> Map<playerId, roster player>
  const who = new Map();      // playerId -> { name, position }
  for (const week of weeks) {
    const map = new Map();
    for (const t of rosters.get(week)) {
      for (const p of t.players || []) {
        map.set(p.playerId, p);
        if (!who.has(p.playerId)) who.set(p.playerId, { name: p.name, position: p.position });
      }
    }
    onRoster.set(week, map);
  }
  const ids = new Set(who.keys());
  for (const m of moves) for (const id of moveIds(m)) ids.add(id);

  await inBatches(weeks, 3, async (week) => {
    const rec = records.get(week);
    const need = [...ids].filter((id) => !onRoster.get(week).has(id) && !rec.players[id]);
    // A copy half-written by a sync that died names a man an older week's
    // document has no line for; scoring him 0 there would be an invention.
    // (In the week in play he is simply not finished yet: see `done` below.)
    if (need.length && down && week !== partial) {
      decisionsDownCache = null; // not remembered: the next sync mends it
      throw decisionsNotSynced();
    }
    if (need.length && !down) {
      let got;
      try {
        got = await espn.fetchPlayersWeek(need, week);
      } catch (err) {
        if (week !== partial) throw err;
        // The week in play: these men stay unknown, which reads as not finished.
        report(++done, total, `Week ${week} players`);
        return;
      }
      requests += Math.ceil(need.length / 100);
      for (const entry of got) {
        const p = espn.parsePlayerWeek(entry, week);
        if (p.playerId === null || p.playerId === undefined) continue;
        rec.players[p.playerId] = {
          name: p.name, position: p.position, proTeamId: p.proTeamId,
          projected: p.projected, actual: p.actual,
        };
      }
      // An id ESPN knows nobody by is written down as nobody, so it is asked
      // for once rather than on every load.
      for (const id of need) {
        if (!rec.players[id]) rec.players[id] = { name: '', position: 'UNK', proTeamId: null, projected: null, actual: null };
      }
      rec.dirty = true;
    }
    if (week === partial) {
      if (rec.dirty) {
        store.writeOpenDecisionWeek(cfg.leagueId, cfg.season, week,
          { moves: rec.moves, players: rec.players, draft: rec.draft, at: rec.at });
      }
    } else if (rec.dirty && rec.closed && weekIsFinal(week)) {
      store.writeDecisionWeek(cfg.leagueId, cfg.season, week,
        { moves: rec.moves, players: rec.players, draft: rec.draft }, { final: true });
    }
    report(++done, total, `Week ${week} players`);
  });

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const kickoff = (proTeamId, week) => {
    const g = proTeamId === null || proTeamId === undefined ? null : pro?.[proTeamId]?.[week];
    return g && Number.isFinite(g.at) ? g.at : null;
  };
  // Has a man on nobody's roster finished, in the week in play? The same rule
  // as a rostered one (`doneRule`), from the NFL's games as of when HIS line was
  // read. The synced copy carries kickoffs but not finals, so a phone asks.
  const proLive = partial === null ? null : (down ? await seekProGames() : pro);
  const now = Date.now();
  const looseDone = (loose, week, asOf) => {
    if (!proKnown(proLive) || !loose || loose.name === undefined) return false;
    const g = loose.proTeamId === null || loose.proTeamId === undefined ? null : proLive[loose.proTeamId]?.[week];
    return capture.playerDone(g, asOf, now);
  };
  const players = new Map();
  for (const id of ids) {
    const byWeek = {};
    let named = who.get(id) || null;
    for (const week of weeks) {
      const held = onRoster.get(week).get(id);
      if (held) {
        // On a roster: the numbers that week was scored with.
        byWeek[week] = {
          actual: num(held.actual), projected: num(held.projected), kickoff: kickoff(held.proTeamId, week),
          done: week === partial ? held.done === true : true,
        };
        continue;
      }
      const rec = records.get(week);
      const loose = rec.players[id] || {};
      if (!named && loose.name) named = { name: loose.name, position: loose.position };
      byWeek[week] = {
        actual: num(loose.actual),
        projected: num(espn.byeAdjustedProjection(loose.projected, loose.proTeamId, week, byes)),
        kickoff: kickoff(loose.proTeamId, week),
        done: week === partial ? looseDone(rec.players[id], week, rec.at) : true,
      };
    }
    players.set(id, { name: named ? named.name : '', position: named ? named.position : 'UNK', byWeek });
  }

  // ---- the results, in `computeLeagueStats`' shape ----
  const teamIds = new Set(teams.map((t) => t.id));
  const wanted = new Set(weeks);
  const games = [];
  for (const g of schedule.games) {
    if (!wanted.has(Number(g.week)) || !teamIds.has(g.homeId) || !teamIds.has(g.awayId)) continue;
    // A matchup of the week in play that is not over has no score yet.
    const inPlay = Number(g.week) === partial && !g.played;
    if (!g.played && !inPlay) continue;
    // The started lineup's projection, as `fetchWeekRosters` totalled it — the
    // same figure the synced copy's season is built from (`seasonFromCloud`).
    const proj = new Map(rosters.get(Number(g.week)).map((t) => [t.id, t.projectedTotal]));
    games.push({
      week: g.week,
      homeId: g.homeId,
      awayId: g.awayId,
      homeActual: inPlay ? null : exactPoints(g.homeScore),
      awayActual: inPlay ? null : exactPoints(g.awayScore),
      homeProjected: Math.round(num(proj.get(g.homeId)) * 10) / 10,
      awayProjected: Math.round(num(proj.get(g.awayId)) * 10) / 10,
    });
  }

  // Leagues differ, so the league is asked; the lineups in use are the
  // fallback, and say the same thing unless every manager left a slot empty.
  const everyTeam = weeks.flatMap((w) => rosters.get(w));
  const counts = settings && Object.keys(settings.starterSlots || {}).length
    ? settings.starterSlots
    : slotCountsFromLineups(everyTeam);
  const biggest = Math.max(0, ...everyTeam.map(
    (t) => (t.players || []).filter((p) => p.lineupSlotId !== IR_SLOT).length));

  const world = assembleWorld({
    isDemo: false,
    name: schedule.leagueName || '',
    slots: slotsFromCounts(counts),
    teams, weeks, games, rosters, moves, players,
    roster: settings && settings.rosterSize ? settings.rosterSize : biggest,
    requests,
    partialWeek: partial,
  });
  if (down) return { world, copy: null };

  // What the sync sends so a phone can build this same world: see "THE WORLD,
  // IN THE SYNCED COPY" above.
  const copy = new Map();
  const league = settings
    ? { starterSlots: settings.starterSlots || {}, rosterSize: settings.rosterSize || null }
    : null;
  for (const week of weeks) {
    const rec = records.get(week);
    const kick = {};
    for (const [proTeamId, byWeek] of Object.entries(pro || {})) {
      const at = byWeek && byWeek[week] && byWeek[week].at;
      if (Number.isFinite(at)) kick[proTeamId] = at;
    }
    copy.set(week, {
      week, moves: rec.moves, players: rec.players, draft: rec.draft || null, kick, league,
      ...(week === partial ? { open: true } : {}),
    });
  }
  return { world, copy };
}

// ------------------------------------------------- the sample league's world
//
// EVERYTHING HERE IS FAKE, and all of it follows from js/demo-rosters.js, so
// the Decisions page tells the same story as every other page on Demo:
//
//   THE ADDS AND DROPS ARE THE ONES THE SAMPLE LEAGUE ALREADY MAKES. Its
//   rosters turn over a man or three per team per week; a move here is that
//   week-to-week difference, read off the rosters — so the moves explain the
//   rosters exactly, which a hand-written list could not promise.
//
//   ONE TRADE IS INVENTED (the sample league makes none): in week
//   `DEMO_TRADE_WEEK` two teams swap a running back each has held all season,
//   each taking the other's place in the lineup. THIS IS THE ONE PLACE THE
//   WORLD DEPARTS FROM THE OTHER DEMO PAGES: from that week on those two teams'
//   scores here are their demo scores moved by the difference between the two
//   men, because a trade that changed nobody's score would have nothing to show.
//
//   A man on nobody's roster in a week is given a score from his own rostered
//   weeks' average, seeded by his id and the week — deterministic, and not the
//   number js/demo-rosters.js would have drawn (its generator is private).

const DEMO_TRADE_WEEK = 5;
/** Tuesday of the sample season's week 1, 15:00 UTC. */
const DEMO_EPOCH = Date.UTC(2025, 8, 2, 15);

/** A number in [0, 1) that depends only on the two integers. */
function demoDraw(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

async function demoDecisionWorld() {
  const [{ generateDemoLeague }, demo] = await Promise.all([
    import('./demo.js'),
    import('./demo-rosters.js'),
  ]);
  const league = generateDemoLeague();
  const weeks = [...new Set(league.games.map((g) => g.week))].sort((a, b) => a - b);
  const r1 = (v) => Math.round(v * 10) / 10;

  // Copies: the generator caches what it returns, and other pages read it.
  const squads = new Map(); // week -> Map<teamId, players[]>
  for (const w of weeks) {
    squads.set(w, new Map(demo.generateDemoWeekRosters(w).teams.map(
      (t) => [t.id, t.players.map((p) => ({ ...p }))])));
  }
  const teamIds = league.teams.map((t) => t.id);

  // ---- the one trade ----
  const always = (teamId, id) => weeks.every((w) => squads.get(w).get(teamId).some((p) => p.playerId === id));
  let trade = null;
  for (let i = 0; i < teamIds.length && !trade; i++) {
    for (let j = i + 1; j < teamIds.length && !trade; j++) {
      const pick = (teamId) => squads.get(DEMO_TRADE_WEEK).get(teamId)
        .filter((p) => p.position === 'RB' && p.started && always(teamId, p.playerId))
        .sort((a, b) => a.playerId - b.playerId)[0];
      const mine = weeks.includes(DEMO_TRADE_WEEK) ? pick(teamIds[i]) : null;
      const his = mine ? pick(teamIds[j]) : null;
      if (mine && his) trade = { a: teamIds[i], b: teamIds[j], gives: mine.playerId, gets: his.playerId };
    }
  }
  const shift = new Map(); // `${week}|${teamId}` -> { actual, projected } moved by the trade
  if (trade) {
    for (const w of weeks.filter((x) => x >= DEMO_TRADE_WEEK)) {
      const A = squads.get(w).get(trade.a);
      const B = squads.get(w).get(trade.b);
      const ia = A.findIndex((p) => p.playerId === trade.gives);
      const ib = B.findIndex((p) => p.playerId === trade.gets);
      const [x, y] = [A[ia], B[ib]];
      // Each takes the other's place in the lineup, and keeps his own numbers.
      const seat = (p, was) => ({ ...p, lineupSlotId: was.lineupSlotId, slot: was.slot, started: was.started });
      A[ia] = seat(y, x);
      B[ib] = seat(x, y);
      const moved = (was, now, key) => (was.started ? (now[key] || 0) - (was[key] || 0) : 0);
      shift.set(`${w}|${trade.a}`, { actual: moved(x, y, 'actual'), projected: moved(x, y, 'projected') });
      shift.set(`${w}|${trade.b}`, { actual: moved(y, x, 'actual'), projected: moved(y, x, 'projected') });
    }
  }

  // ---- the rosters, in `fetchWeekRosters`' shape ----
  const nameOf = new Map(league.teams.map((t) => [t.id, t.name]));
  const sum = (arr, key) => r1(arr.reduce((a, p) => a + (p[key] || 0), 0));
  const rosters = new Map();
  for (const w of weeks) {
    rosters.set(w, teamIds.map((id) => {
      const players = squads.get(w).get(id);
      const starters = players.filter((p) => p.started);
      const bench = players.filter((p) => !p.started);
      return {
        id, name: nameOf.get(id), teamName: nameOf.get(id), abbrev: '',
        players, starters, bench,
        projectedTotal: sum(starters, 'projected'),
        actualTotal: sum(starters, 'actual'),
        benchActualTotal: sum(bench, 'actual'),
        seasonProjectedTotal: sum(starters, 'seasonProjected'),
      };
    }));
  }

  // ---- the moves: each week's rosters against the week before ----
  const position = new Map();
  for (const w of weeks) for (const list of squads.get(w).values()) for (const p of list) position.set(p.playerId, p.position);
  const moves = [];
  for (let k = 1; k < weeks.length; k++) {
    const w = weeks[k];
    const tuesday = DEMO_EPOCH + (w - 1) * WEEK_MS;
    if (trade && w === DEMO_TRADE_WEEK) {
      moves.push({
        id: `demo-trade-${w}`, kind: 'trade', week: w, at: tuesday, teamId: trade.a,
        adds: [], drops: [],
        trade: { withTeamId: trade.b, gives: [trade.gives], gets: [trade.gets] },
      });
    }
    const traded = trade && w === DEMO_TRADE_WEEK ? new Set([trade.gives, trade.gets]) : new Set();
    for (const id of teamIds) {
      const was = new Set(squads.get(weeks[k - 1]).get(id).map((p) => p.playerId));
      const now = new Set(squads.get(w).get(id).map((p) => p.playerId));
      const added = [...now].filter((p) => !was.has(p) && !traded.has(p)).sort((a, b) => a - b);
      const dropped = [...was].filter((p) => !now.has(p) && !traded.has(p)).sort((a, b) => a - b);
      // The sample league only ever swaps like for like, so a pair is one action.
      let n = 0;
      const push = (adds, drops) => moves.push({
        id: `demo-${w}-${id}-${++n}`,
        kind: adds.length && drops.length ? 'adddrop' : adds.length ? 'add' : 'drop',
        week: w,
        at: tuesday + id * 60 * 60 * 1000 + n * 60 * 1000,
        teamId: id, adds, drops, trade: null,
      });
      for (const add of added) {
        const at = dropped.findIndex((d) => position.get(d) === position.get(add));
        push([add], at === -1 ? [] : dropped.splice(at, 1));
      }
      for (const drop of dropped) push([], [drop]);
    }
  }

  // ---- every man's every week ----
  const onRoster = new Map();
  const who = new Map();
  for (const w of weeks) {
    const map = new Map();
    for (const list of squads.get(w).values()) {
      for (const p of list) {
        map.set(p.playerId, p);
        if (!who.has(p.playerId)) who.set(p.playerId, { name: p.name, position: p.position });
      }
    }
    onRoster.set(w, map);
  }
  const players = new Map();
  for (const [id, me] of who) {
    const held = weeks.map((w) => onRoster.get(w).get(id)).filter(Boolean);
    const scored = held.map((p) => p.projected).filter((v) => typeof v === 'number' && v > 0);
    const usual = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;
    const byWeek = {};
    for (const w of weeks) {
      const p = onRoster.get(w).get(id);
      byWeek[w] = {
        actual: p ? (p.actual || 0) : r1(usual * (0.3 + 1.4 * demoDraw(id, w * 2 + 1))),
        projected: p ? (p.projected || 0) : r1(usual * (0.85 + 0.3 * demoDraw(id, w * 2))),
        // Sunday of that week. The sample league has no byes.
        kickoff: DEMO_EPOCH + (w - 1) * WEEK_MS + 5 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000,
      };
    }
    players.set(id, { name: me.name, position: me.position, byWeek });
  }

  const games = league.games.map((g) => {
    const h = shift.get(`${g.week}|${g.homeId}`) || { actual: 0, projected: 0 };
    const a = shift.get(`${g.week}|${g.awayId}`) || { actual: 0, projected: 0 };
    return {
      week: g.week, homeId: g.homeId, awayId: g.awayId,
      homeActual: r1(g.homeActual + h.actual), awayActual: r1(g.awayActual + a.actual),
      homeProjected: r1(g.homeProjected + h.projected), awayProjected: r1(g.awayProjected + a.projected),
    };
  });

  const everyTeam = weeks.flatMap((w) => rosters.get(w));
  return assembleWorld({
    isDemo: true,
    name: league.name,
    slots: slotsFromCounts(slotCountsFromLineups(everyTeam)),
    teams: league.teams.map((t) => ({ id: t.id, name: t.name, teamName: t.name })),
    weeks, games, rosters, moves: byTime(moves), players,
    roster: Math.max(0, ...everyTeam.map((t) => t.players.length)),
    requests: 0,
  });
}
