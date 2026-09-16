// The Trade page: a depth map, a search for swaps that help both squads, and —
// when you ask for it — the same question priced across every remaining week.
//
// Four panels, and they are four halves of one question. The depth map says WHO
// to talk to — read down a column and find the manager whose sign is the
// opposite of yours. The finder says WHAT to offer him. Clicking an offer opens
// the deal week by week, which is the only place the real shape of it shows. And
// the combo section says which of those offers can all be made at once, because
// a player can only be traded once and their gains do not add up.
//
// ---------------------------------------------------------------------------
// WHAT THIS PAGE COSTS, which is the one thing it must never understate
//
// On the two cheap measures it is ONE request: a single week of rosters, read
// several ways, and every control is a repaint. That has always been true here
// and still is.
//
// The weekly measure is different and cannot be made cheap. Valuing a squad at
// what it can field in EVERY remaining week needs every remaining week's
// projections, and there is no bulk form — rule 3 in HANDOFF.md, established by
// trying four shapes of the request. So it is one request per week: nine to
// thirteen of them, plus a search that re-fills nine to thirteen lineups per
// offer instead of one and takes a few seconds rather than a quarter of one.
//
// Both costs are on the button's face and in the note under it BEFORE anything
// is spent, and nothing on this page fetches those weeks until that button is
// pressed. Not on load, not when a remembered preference says "weekly", not
// when the connection bar flips the page live. A control that quietly spent
// twelve requests would be the most expensive kind of convenience.
//
// ---------------------------------------------------------------------------
// TWO SCALES, AND THEY DIFFER BY A FACTOR OF NINE OR MORE
//
// `typicalWeek` and `weekProjection` produce points PER WEEK. The weekly path
// produces REST-OF-SEASON TOTALS — a +29 there is +29 spread over thirteen
// weeks, about +2.2 a week. Mixing them would make every figure on the page
// wrong by an order of magnitude while looking perfectly plausible, so:
//
//   - the gain columns' headings are rewritten to say which scale they are in;
//   - every season total is printed with its per-week twin beside it;
//   - `send`/`receive` entries carry `projected` (the season total) AND
//     `perWeek` (the mean), and this file never prints the first as the second.
//
// `js/trade.js` holds every decision worth arguing about and is pure. This file
// is wiring and markup.

import { fetchWeekRosters, fetchWeeksRosters, fetchSchedule } from './season.js';
import { slotCountsFromLineups } from './projection.js';
import { enableSort, resort } from './sortable.js';
import { savedConfig, onConnection } from './connection.js';
import { scope } from './prefs.js';
import * as espn from './espn.js';
import { stageTrade, isAvailable as bridgeAvailable, extensionVersion } from './bridge.js';
import {
  depthTable, findTrades, slotsForLeague, typicalWeek, weekProjection, PACKAGE_KINDS,
  priceTradeAcrossWeeks, bestCombo, mergeComboByPartner,
} from './trade.js';
import {
  weekRun, registerRun, tipAttr, clearRuns, wireTips, hideTip, clickIsPlayer,
} from './player-card.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('trade');

const DEMO_WEEKS = 13;
const NFL_WEEKS = 18; // only used when ESPN won't tell us its own schedule

// THE WEEKLY SPAN IS THE REST OF THE SCHEDULE, AND THERE IS NO WEEK CEILING.
//
// This used to stop at 13, on the authority of a rule in HANDOFF.md that said
// ESPN published nothing beyond that week. **That rule was wrong** — it was
// simply the furthest week anybody had asked for, and re-probing found real
// per-week projections through week 18. It is corrected there now.
//
// Leaving the cap in was not harmless. Tim's regular season is FOURTEEN
// matchups, so a 13-week ceiling silently dropped the last week of it from
// every trade he priced — the week before his playoffs, and the one most likely
// to decide whether he is in them.
//
// The span is bounded by the schedule instead, which is the honest bound: ESPN's
// matchup feed stops at the end of the regular season, so `state.weeks` is
// exactly the weeks there are. A week ESPN refuses is already absent rather
// than fatal, so a genuine gap costs a column and not a wrong answer.
//
// What this deliberately does NOT do is price the playoff weeks. They are not
// in the schedule feed at all, so reaching them means fetching by week number
// the way the schedule page's bracket does — worth doing, and noted as open in
// PROGRESS.md, but it is a different question: a trade for weeks 15-17 is only
// worth anything if you get there.

// How many weekly requests to have in the air at once, and it is the same three
// the analysis page uses. Written here rather than imported from that page: it
// is that page's private wiring, and two pages sharing a private helper is how
// one of them ends up repainting the other's state.
const WEEK_BATCH = 3;

const MEASURES = {
  typical: {
    label: 'a typical week',
    scale: 'week',
    basis:
      'ESPN’s full-season projection divided by 17 games, which is the closest ' +
      'thing ESPN publishes to a rest-of-season value',
  },
  week: {
    label: 'the selected week',
    scale: 'week',
    basis: 'ESPN’s own projection for the week selected at the top of the page',
  },
  weeks: {
    label: 'every remaining week',
    scale: 'season',
    basis:
      'ESPN’s own projection for each remaining week, with the best legal lineup ' +
      'picked separately in every one of them — so a squad is worth what it can ' +
      'actually field week by week, not what its averages suggest',
  },
};

const state = {
  source: 'demo',
  week: 1,
  weeks: [],
  playedWeeks: [],
  data: null,          // {week, teams:[...]} for the selected week
  slots: null,         // the league's starting slots, read off the lineups
  myTeamId: null,      // the squad the finder trades FROM
  espnTeamId: null,    // the reader's own team, when a live league says so
  isDemo: true,
  measure: 'typical',  // what the reader ASKED for; see basis() for what is drawn
  kind: 'all',         // which package shapes the finder searches
  partner: 'all',      // limit the results to one manager
  search: null,        // the last finder result
  searching: false,
  rows: [],            // the offers currently in the finder's table, in order
  deal: null,          // the offer the modal is showing; null = the modal is shut
  dealKey: null,       // which row opened it, so focus can go back there
  combo: null,         // the last bestCombo result
  comboRows: [],       // the combo's offers, MERGED per manager, in row order
  comboRunning: false,
};

const cache = new Map(); // `${source}:${week}` -> {week, teams}

/**
 * Every remaining week's numbers, and what they cost to get.
 *
 * `byWeek` is week -> Map(playerId -> {projected, actual}) across the WHOLE
 * league, not one team: a man's projection does not depend on whose bench he is
 * on, and indexing the league means a player who changed hands mid-season is
 * still found. `failed` is a week ESPN refused — absent rather than fatal, the
 * same rule `fetchWeeksRosters` follows.
 */
const weekly = {
  key: null,
  byWeek: new Map(),
  failed: new Set(),
  loading: false,
  progress: null,
  error: null,
  requests: 0,
  token: 0,
  means: new Map(), // playerId -> his mean over the span; see weeklyMean()
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

/** "+3.6" / "−0.4" — a real minus sign, and the sign is always printed. */
function signedText(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "weeks 2–13", or "week 13" when there is only one of them. */
function weekRange(weeks) {
  if (!weeks.length) return 'no weeks';
  if (weeks.length === 1) return `week ${weeks[0]}`;
  return `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;
}

// Child traversal rather than tBodies, matching sortable.js: it copes with a
// table that omits <tbody> and keeps this module testable off-browser.
function bodyOf(table) {
  return Array.from(table.children).find((c) => c.tagName === 'TBODY') || null;
}

// ===========================================================================
// The weekly span: which weeks, whether we have them, and what they cost
// ===========================================================================

/** Which league these cached weeks belong to. Team ids collide across leagues. */
function sourceKey() {
  const cfg = espn.getConfig();
  return state.source === 'demo' ? 'demo' : `live:${cfg.leagueId}:${cfg.season}`;
}

/**
 * Which weeks have already been played.
 *
 * READ OFF THE SCHEDULE, NEVER OFF THE CALENDAR. A week is played when there is
 * a RESULT against it — the same rule the player card's Act row follows, and
 * for the same reason: a date test looks perfectly correct in demo, where every
 * game is hardcoded as played, and is wrong everywhere else. `state.playedWeeks`
 * is filled in `useLive` from `schedule.games.filter((g) => g.played)` and from
 * nothing else.
 *
 * DEMO IS HANDLED DELIBERATELY RATHER THAN LEFT TO FALL OUT, because the honest
 * reading of the demo schedule is that the sample season is OVER — all thirteen
 * games are marked played — and a page that priced zero weeks would leave the
 * weekly measure, the drill-down and the combo empty in the only mode a reader
 * can try without a league connected. So demo uses the WEEK PICKER as its
 * stand-in for "now": the sample season is replayed as it stood after the
 * selected week, and everything later is the rest of it. It is written here in
 * one place, and the panel notes say which of the two rules they are on.
 */
function playedWeeks() {
  if (state.isDemo) return state.weeks.filter((w) => w <= state.week);
  return state.playedWeeks;
}

/**
 * The weeks the weekly measure prices: every week STILL TO BE PLAYED that ESPN
 * still projects.
 *
 * Tim's ask, in his words: "For the trade analysis, don't let any data on weeks
 * that have already been played be able to affect the trade." He is right, and
 * the reason is not an opinion — a trade changes the REST of the season and
 * nothing else. The points from week 3 are banked. No deal can move them, so
 * week 3 is not evidence about any deal, and a valuation that includes it is
 * answering a question nobody can act on.
 *
 * It used to be "the selected week → week 13", anchored on the week picker so a
 * reader could ask what the rest of the season looked like from there. That is
 * gone: it let a played week into every number on the page whenever the picker
 * sat in the past, which — since `useLive` OPENS on the last played week — was
 * the normal case rather than an edge one.
 *
 * So the span is now a DERIVED FACT rather than the reader's pick, and every
 * note that names it says which weeks they are.
 */
function weeklySpan() {
  const played = new Set(playedWeeks());
  return state.weeks.filter((w) => !played.has(w));
}

/**
 * Is a 0.00 a bye, on this data?
 *
 * On ESPN it is: rule 2 in HANDOFF.md. On the sample data it is NOT — a 0 out
 * of `js/demo-rosters.js` means "we have ruled this man OUT this week", which
 * is a real projection of zero. `projToken(v, demo)` in js/player-card.js makes
 * exactly the same distinction in exactly the same direction, and this is the
 * second place that fact is needed rather than a second way of deciding it.
 */
const zeroIsBye = () => !state.isDemo;

const haveWeek = (w) => weekly.byWeek.has(w) || weekly.failed.has(w);

/** The weeks of the span still to buy. On demo, still to generate. */
function missingWeeks() {
  if (weekly.key !== sourceKey()) return weeklySpan();
  return weeklySpan().filter((w) => !haveWeek(w));
}

/** Are all the span's weeks in hand, and did at least one of them answer? */
function weeklyReady() {
  if (weekly.key !== sourceKey()) return false;
  const span = weeklySpan();
  if (!span.length) return false;
  return span.every(haveWeek) && span.some((w) => weekly.byWeek.has(w));
}

/**
 * What is actually being drawn, as opposed to what the reader picked.
 *
 * Asking for the weekly measure does not fetch it — that costs requests and has
 * to be pressed for — so between the ask and the press the page draws the
 * typical week and says so in every note. One function decides that for the
 * whole page, because two panels disagreeing about which basis they are on is
 * exactly the failure this page cannot have.
 */
function basis() {
  if (state.measure !== 'weeks') return state.measure;
  return weeklyReady() ? 'weeks' : 'typical';
}

const meta = () => MEASURES[basis()];

/** week -> Map(playerId -> {projected, actual}) for one week's payload. */
function indexTeams(teams) {
  const byPlayer = new Map();
  for (const t of teams || []) {
    for (const p of t.players || []) {
      byPlayer.set(p.playerId, {
        projected: typeof p.projected === 'number' ? p.projected : null,
        actual: typeof p.actual === 'number' ? p.actual : null,
      });
    }
  }
  return byPlayer;
}

function resetWeekly() {
  weekly.key = sourceKey();
  weekly.byWeek = new Map();
  weekly.failed = new Set();
  weekly.error = null;
  weekly.requests = 0;
  weekly.means = new Map();
  // The token invalidates anything still in the air, and the two flags are
  // cleared here as well as in loadWeekly's `finally`: that clause deliberately
  // leaves a STALE load's flags alone, so without this a source switch during a
  // fetch would strand the button disabled and "reading…" on screen forever.
  weekly.loading = false;
  weekly.progress = null;
  weekly.token++;
}

/**
 * The selected week is already bought — it is what the depth map is drawn from
 * — so it goes straight into the weekly cache rather than being fetched twice.
 * That is one request saved out of every span, and the cost note says so rather
 * than quietly counting it.
 */
function rememberSelectedWeek() {
  if (!state.data) return;
  if (weekly.key !== sourceKey()) resetWeekly();
  weekly.byWeek.set(state.data.week, indexTeams(state.data.teams));
  weekly.failed.delete(state.data.week);
  weekly.means = new Map();
}

/**
 * `(player, week) -> number|null`, which is half of what the weekly engine
 * needs. A week we do not hold, and a man nobody in the league rostered that
 * week, are both null — `optimalLineup` drops a null from the pool entirely,
 * which is a different fact from ESPN's 0.00 for a bye, and keeping them apart
 * is what rule 2 in HANDOFF.md exists to protect.
 */
function projFor(p, week) {
  const idx = weekly.byWeek.get(week);
  if (!idx) return null;
  const e = idx.get(p.playerId);
  return e && typeof e.projected === 'number' ? e.projected : null;
}

/**
 * A man's mean projection over the span — the depth map's number under the
 * weekly basis.
 *
 * The depth map is a per-position table and has to stay on a per-WEEK scale, or
 * its cells would be nine times the size of everything a manager thinks in. But
 * it must be made of the same projections the deals are priced from, or the two
 * panels could contradict each other. So it is the same weeks, averaged — with
 * the SAME arithmetic `scoreAcrossWeeks` uses for `perWeek`, byes and all.
 *
 * WHICH NOW MEANS BYES ARE LEFT OUT OF THE DIVISOR. Tim asked for that of the
 * per-week figure beside a player's name, and this table is the other place one
 * man gets a per-week number on this page. Two panels printing two different
 * per-week values for one player — because one of them counted his bye and the
 * other did not — is precisely the contradiction this function's whole reason
 * for existing is to prevent. `zeroIsBye()` decides which zeros count, so the
 * sample data (where a 0 means "ruled out", not "no game") is unaffected.
 *
 * A man with no PLAYABLE week left comes back `null`, which `optimalLineup`
 * drops from the pool entirely — correct, and the same treatment as a man ESPN
 * carries no number for: he cannot be in a lineup in a week that is left.
 *
 * Memoised because `depthTable` asks for the same player several times per
 * paint and the answer cannot change without the cache being rebuilt.
 */
function weeklyMean(p) {
  if (!p || p.playerId === null || p.playerId === undefined) return null;
  const held = weekly.means.get(p.playerId);
  if (held !== undefined) return held;

  const bye = zeroIsBye();
  const span = weeklySpan();
  let sum = 0;
  let counted = 0;
  let byes = 0;
  for (const w of span) {
    const v = projFor(p, w);
    if (v === null) continue;   // still in the divisor, exactly as it always was
    sum += v;
    counted++;
    if (bye && v === 0) byes++;
  }
  // The span less his byes, matching `scoreAcrossWeeks` line for line — that is
  // what stops the two panels disagreeing about one man.
  const playable = span.length - byes;
  const out = counted && playable > 0 ? Math.round((sum / playable) * 10) / 10 : null;
  weekly.means.set(p.playerId, out);
  return out;
}

/** The scalar the depth map is drawn with, whichever basis is in force. */
function measureFn() {
  if (basis() === 'weeks') return weeklyMean;
  return basis() === 'week' ? weekProjection : typicalWeek;
}

// ------------------------------------------------------------ buying the weeks

/**
 * Fetch (or generate) every week of the span that is not in hand.
 *
 * The live half is the same shape as the analysis page's season panel — one
 * request per week, three at a time, repainting between batches, and a week
 * ESPN refuses simply comes back absent — but written here rather than imported
 * from that page, which owns its own state and must not be reached into.
 *
 * Nothing in this function runs without a press. That is the whole point of it.
 */
async function loadWeekly() {
  const key = sourceKey();
  if (weekly.key !== key) resetWeekly();
  rememberSelectedWeek();

  const span = weeklySpan();
  if (!span.length || weekly.loading) { paint(); return; }

  state.measure = 'weeks';
  prefs.set('measure', 'weeks');
  $('measureSelect').value = 'weeks';

  // Already bought — switching to them is free, but the finder still has to be
  // re-run: its offers were priced on the OTHER measure, and repainting alone
  // would relabel them rather than recompute them.
  if (!missingWeeks().length) { repaint(); return; }

  if (!(await buyMissingWeeks())) return;
  // A deal opened while these were reading is now priceable and stays open.
  runSearch({ keepDeal: true });
}

/**
 * Fetch (or generate) the span's missing weeks into the cache, and nothing
 * else: no change of measure, no repaint, no search. Resolves true when it
 * finished for the source it started on, false when something newer took over.
 *
 * Split out of `loadWeekly` for the week-by-week pop-up, which needs the weeks
 * but must NOT re-run the search — `runSearch` shuts the pop-up, so buying the
 * weeks through the page button would close the very thing that asked for them.
 */
async function buyMissingWeeks() {
  const key = sourceKey();
  const missing = missingWeeks();
  if (!missing.length) return true;

  const token = ++weekly.token;
  const stale = () => token !== weekly.token || sourceKey() !== key;

  weekly.loading = true;
  weekly.error = null;
  weekly.progress = { done: 0, total: missing.length };
  // The cost line is repainted BEFORE the first request goes out, so the number
  // being spent is on screen while it is being spent and not after.
  renderCost();

  try {
    if (state.source === 'demo') {
      const generate = await getDemoGenerator();
      if (stale()) return false;
      // A missing generator is a message, not an early exit: returning here
      // would skip the caller's repaint and leave the failure written into
      // state where nobody can read it.
      if (!generate) {
        weekly.error = 'Demo roster data isn’t available yet (js/demo-rosters.js is missing).';
      } else {
        for (const w of missing) {
          const built = generate(w);
          if (built && built.teams && built.teams.length) weekly.byWeek.set(w, indexTeams(built.teams));
          else weekly.failed.add(w);
          weekly.progress.done++;
        }
        weekly.means = new Map();
      }
    } else {
      for (let i = 0; i < missing.length; i += WEEK_BATCH) {
        const batch = missing.slice(i, i + WEEK_BATCH);
        const got = await fetchWeeksRosters(batch, {
          onProgress: () => {
            if (stale() || !weekly.progress) return;
            weekly.progress.done++;
            renderCost();
          },
        });
        if (stale()) return false;
        for (const w of batch) {
          // One request was spent on that week whether or not it answered, and
          // the count has to say so — understating a cost is the one dishonesty
          // this project avoids.
          weekly.requests++;
          if (got.has(w)) weekly.byWeek.set(w, indexTeams(got.get(w)));
          else weekly.failed.add(w);
        }
        weekly.means = new Map();
        renderCost();
      }
    }
  } catch (err) {
    if (stale()) return false;
    weekly.error = err && err.message ? err.message : String(err);
  } finally {
    if (!stale()) {
      weekly.loading = false;
      weekly.progress = null;
    }
  }

  return !stale();
}

// --------------------------------------------------------------- the cost line

function renderCost() {
  const span = weeklySpan();
  const missing = missingWeeks();
  const btn = $('loadWeeks');
  const ready = weeklyReady();
  const showing = basis() === 'weeks';

  // ------------------------------------------------------------- the button
  if (!span.length) {
    btn.disabled = true;
    btn.textContent = 'No remaining weeks to price';
  } else if (weekly.loading) {
    btn.disabled = true;
    btn.textContent = `Reading ${weekRange(span)}…`;
  } else if (ready && showing) {
    btn.disabled = true;
    btn.textContent = `${weekRange(span)} priced`;
  } else if (ready) {
    btn.disabled = false;
    btn.textContent = `Show ${weekRange(span)} — already loaded, no requests`;
  } else {
    btn.disabled = false;
    btn.textContent = state.isDemo
      ? `Price ${weekRange(span)} — generated, no requests`
      : `Price ${weekRange(span)} — ${plural(missing.length, 'request')}`;
  }

  // -------------------------------------------------- what has been spent
  const failed = [...weekly.failed].sort((a, b) => a - b);
  $('costSpent').innerHTML = weekly.loading
    ? `<span class="working">${esc(
        weekly.progress
          ? `week ${Math.min(weekly.progress.done + 1, weekly.progress.total)} of ` +
            `${weekly.progress.total}…`
          : 'reading…'
      )}</span>`
    : weekly.requests
      ? `${plural(weekly.requests, 'request')} spent on this page so far` +
        (failed.length ? ` · ESPN gave nothing for ${failed.map((w) => `week ${w}`).join(', ')}` : '')
      : '';

  // ------------------------------------------------------------- the words
  //
  // The number is named before it is spent, every time, and the sentence says
  // WHY it cannot be one request: there is no bulk form, and four shapes of
  // that request were tried before this was settled.
  const spanWords = span.length
    ? `${weekRange(span)} — ${plural(span.length, 'week')}`
    : 'no weeks: every week ESPN projects has already been played';

  // Weeks belonging to ANOTHER league are not weeks in hand, so a mismatched
  // cache counts for nothing rather than making the price look smaller.
  const already =
    weekly.key === sourceKey() ? span.filter((w) => weekly.byWeek.has(w)).length : 0;
  const owed = Math.max(0, span.length - already);
  const costLine = state.isDemo
    ? `it is <strong>one request per week</strong> on a real league. Sample rosters are ` +
      `generated inside the page, so on demo data this costs ` +
      `<strong>no requests at all</strong>; on your ESPN league the same span would be ` +
      `<strong>${plural(owed, 'request')}</strong> — one per week.`
    : `this is <strong>${plural(owed, 'request')}</strong> ` +
      `still to spend — <strong>one request per week</strong>, less the ${already} ` +
      `already in hand. This page costs ONE request on the other two measures; ` +
      `on this one it costs ${plural(span.length, 'request')} in total.`;

  // WHICH WEEKS, AND WHY THOSE. The span used to be the reader's pick — the
  // week picker and everything after it — and it is now derived from the
  // schedule, so it has to be stated rather than assumed. Tim can no longer
  // work it out from the control he set.
  const playedNow = playedWeeks();
  const spanReason = state.isDemo
    ? `The sample season is marked as fully played, so demo treats the week you have ` +
      `selected as “now”: <strong>week ${state.week} and everything before it is ` +
      `banked</strong> and the rest of that sample season is what gets priced. On your ` +
      `real league the same sentence is read off the schedule instead.`
    : playedNow.length
      ? `<strong>${weekRange(playedNow)} ${playedNow.length === 1 ? 'has' : 'have'} been ` +
        `played</strong> and ${playedNow.length === 1 ? 'is' : 'are'} left out of every number ` +
        `on this page — a trade changes the rest of the season and cannot move points that are ` +
        `already banked. Which weeks those are is read off the league SCHEDULE (a game with a ` +
        `result), never off today’s date.`
      : `Nothing has been played yet according to the league schedule, so the whole season ` +
        `ahead is priced.`;

  $('costNote').innerHTML =
    `<strong>Every remaining week</strong> prices ${spanWords}. ${spanReason} ` +
    `There is no bulk form at ESPN — asking for thirteen weeks in one call returns ` +
    `only the current one, and four shapes of that request were tried — so ${costLine} ` +
    `The search is also slower on this basis: every offer is priced by re-filling ` +
    `${plural(span.length, 'lineup')} instead of one, which takes a few seconds rather ` +
    `than a fraction of one. ` +
    (weekly.error ? `<br><strong>${esc(weekly.error)}</strong> ` : '') +
    (failed.length
      ? `<br>ESPN returned nothing for ${failed.map((w) => `week ${w}`).join(', ')}; ` +
        `those weeks are simply absent from every number below rather than counted as zero. `
      : '') +
    (state.measure === 'weeks' && !weeklyReady()
      ? `<br><strong>Every remaining week is selected but not loaded</strong>, so the page is ` +
        `drawing <strong>a typical week</strong> until the button above is pressed.`
      : '');
}

// -------------------------------------------------------- player references
//
// The site's one contract, unchanged here: every name is a real <a href> to
// that man's row on the Players page, carrying ESPN's own playerId and the
// class `pref`. Never a click handler, never a name, never a row index. A
// second way of naming a player is exactly how the two halves drift apart, and
// `tests/link-check.mjs` follows the ids this page emits to prove they land.
//
// THE LINK SAYS WHERE IT GOES WITH `aria-label`, NOT `title`. It used to carry
// a `title`, and it cannot any more: the element around it now draws a card of
// its own, and a `title` beside a card has the browser paint its own tooltip on
// top a moment later. Same rule, and the same reason, as the analysis grids.

function playerRef(p, inner) {
  if (p.playerId === null || p.playerId === undefined) return inner;
  return (
    `<a class="pref" href="waivers.html?player=${esc(p.playerId)}" ` +
    `aria-label="${esc(p.name)} — open his next 13 weeks on the Players page">${inner}</a>`
  );
}

/**
 * The card for one man: who he is, and his week run.
 *
 * Tim asked for this in one line — "whenever a player is named, show the 13
 * week preview just like the analysis section" — and it is the same card,
 * literally: `js/player-card.js` is the analysis page's, extracted. The run
 * covers the weeks THIS page holds numbers for, which is one week on the cheap
 * measures and the whole remaining span once the weekly measure is loaded. The
 * heading says which, so a short run is never mistaken for a short season.
 */
function cardFor(p) {
  const weeks = cardWeeks();
  const injured = p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? ` · ${p.injuryStatus}` : '';
  // Same rule as `posTag`, and it has to hold here too: the card's identity line
  // is another place a player is rendered on this page, and "Chargers D/ST · DST"
  // says it twice there as much as in a table cell.
  const pos = p.position === 'DST' ? '' : ` · ${p.position}`;
  const ident = `${p.name}${pos}${p.proTeam ? ` · ${p.proTeam}` : ''}${injured}`;
  const href =
    p.playerId === null || p.playerId === undefined
      ? null
      : `waivers.html?player=${encodeURIComponent(p.playerId)}`;

  const heading = state.isDemo
    ? `Sample projections for ${weekRange(weeks)}`
    : `ESPN’s projection for ${weekRange(weeks)}`;
  const tail =
    weeks.length > 1
      ? ''
      : ' — pick “Every remaining week” above to fill the rest of the run in';

  return {
    ident,
    href,
    run: weekRun({
      heading: heading + tail,
      weeks,
      projections: weeks.map((w) => tokenAt(p, w, 'projected')),
      actuals: weeks.map((w) => tokenAt(p, w, 'actual')),
      currentWeek: state.week,
      demo: state.isDemo,
    }),
  };
}

/** The weeks this page has actually read, in order. Never empty on live data. */
function cardWeeks() {
  const held = [...new Set([...weekly.byWeek.keys(), ...weekly.failed])]
    .filter((w) => Number.isFinite(w))
    .sort((a, b) => a - b);
  return held.length ? held : [state.week];
}

/**
 * One cell of a man's run, in the card's own vocabulary.
 *
 * `failed` and a missing week are different things and stay different: ESPN
 * refusing a week is a fact about ESPN, and a week nobody asked for is a fact
 * about this page. A man absent from a week the league answered for is `off` —
 * he was on nobody's roster then.
 */
function tokenAt(p, week, field) {
  if (weekly.failed.has(week)) return 'failed';
  const idx = weekly.byWeek.get(week);
  if (!idx) return 'wait';
  const e = idx.get(p.playerId);
  if (!e) return 'off';
  return e[field];
}

/**
 * A player's position, as a tag — EXCEPT on a defence.
 *
 * Tim's words: "Don't put the defences position label next to the name, because
 * the position is in the name (chargers def)." He is right and it is worth
 * checking rather than assuming: ESPN names every D/ST `"<Franchise> D/ST"`
 * (`docs/espn-draft-api.md`, position id 16, exactly 32 of them) and
 * `js/demo-rosters.js` builds the same string, so "Chargers D/ST · DST" says it
 * twice.
 *
 * THE TEST IS THE POSITION, NOT THE NAME. Matching /D\/ST/ on the name would be
 * a second way of knowing one fact — and the name is the half that varies,
 * between ESPN, the sample data, and whatever a future payload does. The
 * position is `'DST'` in both, because `js/espn.js` maps it there and nothing
 * else on the site is allowed to decide it.
 *
 * It returns a bare space where the tag is suppressed, so the number does not
 * run into the name — the tag's own margin is what usually separates them.
 */
const posTag = (position) =>
  position === 'DST' ? ' ' : `<span class="pp">${esc(position)}</span>`;

/**
 * One man in a package: his name, his position, what he is worth A WEEK, and a
 * card.
 *
 * ONE NUMBER, AND IT IS THE PER-WEEK ONE. Tim's words: "Right now it shows a
 * big number (I think season proj) next to the position and then the per/week
 * after that. Just put per week." The engine still computes the rest-of-season
 * total — `candidates()` ranks by it and the forced cut is decided on it — this
 * is purely about what reaches the screen.
 *
 * WHICH FIELD IS THE PER-WEEK ONE DEPENDS ON THE BASIS, and getting that
 * backwards is the factor-of-nine error this file's header is about. On the two
 * scalar measures `projected` is ALREADY per week (`typicalWeek` is the season
 * projection over 17 games; `weekProjection` is one week's own number). On the
 * weekly measure `projected` is a rest-of-season total and `perWeek` is the
 * mean. So the basis picks the field, and nothing here can print a total.
 *
 * A man with no number at all prints "—" and NOT "—/wk", which would read as a
 * unit on a quantity that is not there.
 */
function perWeekValue(p) {
  return basis() === 'weeks' ? p.perWeek : p.projected;
}

function manLine(p) {
  const key = registerRun(cardFor(p), 'pkg');
  const v = perWeekValue(p);
  const val = Number.isFinite(v)
    ? `<span class="val">${fmt(v)}/wk</span>`
    : `<span class="val">—</span>`;
  const inner = `${esc(p.name)}${posTag(p.position)}${val}`;
  return `<span class="man"${tipAttr(key)}>${playerRef(p, inner)}</span>`;
}

// ------------------------------------------------------------- the depth map

/**
 * Which cells get a tint, decided per COLUMN rather than per cell.
 *
 * The number in a cell is points above replacement, and how big a number counts
 * as "deep" is not the same at quarterback as at kicker — so an absolute
 * threshold would tint whole columns and mean nothing. Ranking inside the
 * column asks the only question the table is for: of these ten managers, who is
 * strongest here and who is weakest. The top and bottom three are marked and
 * the middle is left alone, which is also an answer.
 *
 * Ties get the same treatment as each other rather than being split by roster
 * order: three managers level at the bottom are all three of them the bottom.
 */
function tintsFor(rows, position) {
  const values = rows
    .map((r) => r.cells.get(position))
    .map((c) => (c && Number.isFinite(c.startersEdge) ? c.startersEdge : null))
    .filter((v) => v !== null);

  if (values.length < 6) return { deep: null, thin: null }; // too few to rank
  const sorted = [...values].sort((a, b) => b - a);
  const deep = sorted[2];                      // 3rd best
  const thin = sorted[sorted.length - 3];      // 3rd worst
  // A column where everyone is level is a column with nothing to say.
  return deep <= thin ? { deep: null, thin: null } : { deep, thin };
}

function renderDepthHead(positions) {
  $('depthTable').querySelector('thead').innerHTML =
    `<tr>
       <th class="name" data-sort>Manager</th>
       ${positions
         .map(
           (p) =>
             `<th data-sort title="Points above replacement that this manager’s ` +
             `starters at ${esc(p)} are worth.">${esc(p)}</th>`
         )
         .join('')}
       <th class="grouped" data-sort title="The best legal lineup this squad could field, added up.">Lineup</th>
     </tr>`;
}

function depthCellHtml(cell, tints) {
  if (!cell || !Number.isFinite(cell.startersEdge)) {
    return '<td class="cell muted" data-v="">—</td>';
  }

  const cls = ['cell'];
  if (tints.deep !== null && cell.startersEdge >= tints.deep) cls.push('deep');
  else if (tints.thin !== null && cell.startersEdge <= tints.thin) cls.push('thin');

  const spare =
    cell.surplusEdge > 0
      ? `<span class="spare">spare ${signedText(cell.surplusEdge)}</span>`
      : '';

  const tip =
    `${cell.startable} startable ${cell.position}${cell.startable === 1 ? '' : 's'}, ` +
    `${cell.needed} needed in the lineup. ` +
    (cell.surplusEdge > 0
      ? `The spare figure is what he could send without weakening his own lineup.`
      : cell.net < 0
        ? `He is a man short here.`
        : `Nothing spare here.`);

  return (
    `<td class="${cls.join(' ')}" data-v="${cell.startersEdge}" title="${esc(tip)}">` +
    `${signedText(cell.startersEdge)}${spare}</td>`
  );
}

function renderDepth() {
  const teams = state.data ? state.data.teams : [];
  const table = $('depthTable');

  $('depthWrap').classList.toggle('hidden', teams.length === 0);
  $('depthEmpty').classList.toggle('hidden', teams.length > 0);
  if (!teams.length) {
    $('depthBars').innerHTML = '';
    $('spareStrip').innerHTML = '';
    $('depthNote').innerHTML = '';
    return;
  }

  const map = depthTable(teams, state.slots, measureFn());
  renderDepthHead(map.positions);

  const tints = new Map(map.positions.map((p) => [p, tintsFor(map.rows, p)]));

  bodyOf(table).innerHTML = map.rows
    .map((row) => {
      const mine = row.team.id === state.myTeamId;
      return (
        `<tr${mine ? ' class="me"' : ''} data-team="${esc(row.team.id)}">` +
        `<td class="name">${esc(row.team.name)}</td>` +
        map.positions.map((p) => depthCellHtml(row.cells.get(p), tints.get(p))).join('') +
        `<td class="grouped" data-v="${row.total ?? ''}">${fmt(row.total)}</td>` +
        `</tr>`
      );
    })
    .join('');

  renderBars(map);
  renderSpares(map);
  renderDepthNote(map);
  resort(table);
}

/** The bar every column is measured against, stated rather than implied. */
function renderBars(map) {
  $('depthBars').innerHTML = map.positions
    .map((p) => {
      const r = map.replacement.get(p);
      if (!r || !Number.isFinite(r.value)) return '';
      const tip = r.exhausted
        ? `Every ${p} in the league is in somebody’s lineup, so there is no spare ` +
          `man to set a bar with — the worst starter is used instead.`
        : `${r.startedInLeague} of the ${r.pooled} ${p}s in the league are starting. ` +
          `The bar is the best one who is not.`;
      return (
        `<span class="bar-chip" title="${esc(tip)}">${esc(p)} ` +
        `<strong>${fmt(r.value)}</strong>${r.exhausted ? ' *' : ''}</span>`
      );
    })
    .join('');
}

/**
 * Your own spare men, named.
 *
 * The depth map's cells are numbers, and "spare +4.2" at running back does not
 * tell you WHO. This is the one place on that panel a player is named, and it
 * is the part of a squad a trade can actually reach — so it is also the part
 * most worth putting a week run on. Same card as everywhere else.
 */
function renderSpares(map) {
  const row = map.rows.find((r) => r.team.id === state.myTeamId);
  if (!row) { $('spareStrip').innerHTML = ''; return; }

  const chips = map.positions
    .map((position) => {
      const cell = row.cells.get(position);
      if (!cell || !cell.spare) return '';
      const p = cell.spare.p;
      const key = registerRun(cardFor(p), 'spare');
      const inner =
        `<strong>${esc(p.name)}</strong>${posTag(position)}${fmt(cell.spare.v)}`;
      return `<span class="spare-chip"${tipAttr(key)}>${playerRef(p, inner)}</span>`;
    })
    .filter(Boolean);

  $('spareStrip').innerHTML = chips.length
    ? `<span class="spare-chip">Your spare men →</span>${chips.join('')}`
    : '';
}

function renderDepthNote(map) {
  const m = meta();
  const anyExhausted = map.positions.some((p) => {
    const r = map.replacement.get(p);
    return r && r.exhausted;
  });
  const span = weeklySpan();

  $('depthNote').innerHTML =
    `Every number is <strong>points above replacement</strong> — how much better this ` +
    `manager’s starters at that position are than the man anybody could have instead. ` +
    `<strong>Replacement</strong> is not a constant somebody typed in: it is the best player ` +
    `at that position who is <strong>not starting anywhere in the league</strong>, and the chips ` +
    `above show what that came out at, valued on ${esc(m.label)} ` +
    `(${m.basis}). ` +
    (basis() === 'weeks'
      ? `Every figure in this table is <strong>per week</strong>, over ${weekRange(span)} — ` +
        `<strong>the weeks still to be played</strong>, read off the league schedule rather than ` +
        `off the calendar, because a week with a result against it is banked and no trade can ` +
        `reach it. A man’s average leaves his <strong>byes</strong> out: a 0.00 is a fact about ` +
        `the fixture list, not about him, and counting it would price him as the weeks he is off ` +
        `rather than the weeks he plays. ` +
        `The panels below are per week too, but a deal’s gain is spread over every week in the ` +
        `span, byes and all, so a man’s figure here is deliberately not the same arithmetic. ` +
        `<strong>Lineup</strong> is what those averages would field. Picking each week separately ` +
        `always beats it, and the gap between the two is precisely what depth is worth: a squad ` +
        `whose men swing about has a higher week-by-week total than its averages suggest, and a ` +
        `squad of metronomes has none. That is why the deals below are priced week by week and ` +
        `this table is not. `
      : '') +
    `<br>` +
    `A high number means depth worth trading from; a low one means a lineup spot going to ` +
    `waste. <strong>Read down a column</strong>, not across a row — the manager worth talking to ` +
    `is the one whose number is low where yours is high. ` +
    `<strong>spare</strong> beside a number is what that manager could send ` +
    `<em>without weakening his own lineup</em>, which is the part of his squad a trade can ` +
    `actually reach; your own spare men are named under the table. ` +
    `The three deepest and three thinnest squads at each position are tinted; every cell ` +
    `prints its sign either way. ` +
    (anyExhausted
      ? `A <strong>*</strong> means every player at that position is already in somebody’s ` +
        `lineup, so there is no spare man in the league to set a bar with and the worst ` +
        `starter stands in for one. `
      : '') +
    `<br>` +
    // Tim's question, answered where it is asked: "if we trade an RB for a QB,
    // we might get +1.3, however if we have 3RBs, and 3QBs, then that trade
    // might not be too good." It needs no second rule — the weekly measure
    // already answers it — so this says so rather than inventing one.
    `<strong>A surplus is not the same as a gain.</strong> Being deep at a position says you ` +
    `have men to send; it does not say that acquiring one more there is worth anything. ` +
    (basis() === 'weeks'
      // THE ONE PLACE A PLAYED WEEK CAN STILL REACH A NUMBER on this page, and
      // it is said out loud rather than quietly allowed. "The selected week" is
      // a measure the reader asked for BY NAME, so it is not overridden — but
      // when that week has a result against it, it is history, and pricing a
      // trade on history is the thing the weekly measure exists to stop.
      ? `On this basis it is priced properly: a manager starts whichever of his men is highest ` +
        `<em>that week</em>, so a fourth good quarterback adds nothing once three of them already ` +
        `put an 18 in the lineup most weeks — which is why an offer below can be worth little ` +
        `even where this table says the other manager is thin. Click any offer to see it week by ` +
        `week; those rows and this table are the same projections, so they cannot disagree.`
      : `On a single scalar per man it cannot be priced at all — only one quarterback can ever ` +
        `count, so a fourth good one looks like a straight upgrade. <strong>Every remaining week</strong> ` +
        `is the measure that answers it, because it picks each week’s lineup separately.`) +
    (basis() === 'week' && playedWeeks().includes(state.week)
      ? ` <br><strong>Week ${state.week} has already been played.</strong> You asked for that ` +
        `week by name, so it is what this table is drawn from — but those points are banked and ` +
        `no trade can move them. <strong>Every remaining week</strong> prices only the weeks a ` +
        `trade can actually reach.`
      : '') +
    ` ` +
    `Nobody here can be claimed off the wire, so nothing on this page is a waiver ` +
    `suggestion — the <a href="waivers.html">Players</a> page answers that.`;
}

// ----------------------------------------------------------- the trade finder

/**
 * What the deal does to your starting lineup, in names.
 *
 * The two bases mean genuinely different things by this list and it must not
 * pretend otherwise. On a scalar measure there is ONE lineup before and one
 * after, so an entry is a man and his projection. Across weeks there are nine
 * to thirteen of each, so an entry is the CHANGE in a man's season contribution
 * with the number of weeks he starts beside it — a man already in the lineup
 * who merely picks up two more weeks appears with what those two weeks are
 * worth, not with his whole season.
 *
 * What survives both readings is the property worth having: in minus out is
 * exactly the gain.
 */
function churnHtml(churn) {
  if (!churn) return '';
  const weeks = basis() === 'weeks';

  // The D/ST rule again: his position is already in his name. Written as plain
  // text rather than through `posTag` because this line is a sentence, not a
  // row of tagged cells.
  const pos = (s) => (s.position === 'DST' ? '' : ` ${esc(s.position)}`);

  const one = (s) => {
    if (!weeks) return `<b>${esc(s.name)}</b>${pos(s)} ${fmt(s.value)}`;
    const when = Number.isFinite(s.weeks) ? ` over ${plural(s.weeks, 'week')}` : '';
    const how = s.wasStarting && s.nowStarting ? ' (already starting)' : '';
    return `<b>${esc(s.name)}</b>${pos(s)} ${fmt(s.value)}${when}${how}`;
  };

  const line = (list, cls, word) =>
    list.length ? `<span class="${cls}">${word} ${list.map(one).join(', ')}</span>` : '';

  const parts = [
    line(churn.in, 'in', weeks ? 'starts more:' : 'starts:'),
    line(churn.out, 'out', weeks ? 'starts less:' : 'drops out:'),
  ].filter(Boolean);
  return parts.length ? `<div class="churn">${parts.join('<br>')}</div>` : '';
}

const SHAPE_LABEL = {
  even: 'Straight swap',
  consolidate: 'You consolidate',
  depth: 'You add depth',
};

/**
 * ESPN's own trade screen, opened with his side already ticked.
 *
 * The URL was established by reading ESPN's production bundle, and the one
 * thing about it that must be said out loud is what it does NOT do:
 * `players=` pre-ticks ONLY the counterparty's players — the ones you would
 * RECEIVE. There is no parameter for your own side. So the button says "his
 * players only" on its face, and the note beside it says the rest; without
 * that, the first click reads as broken.
 *
 * Only ids from that manager's roster THIS WEEK are sent. ESPN ignores an id
 * that is not on the team silently, which is the worst kind of wrong — a screen
 * that opens with one man ticked instead of two and no explanation.
 *
 * Nothing is ever sent from this site. This is a deep link and the page opens
 * it in a new tab; the deal is still proposed by hand, by him, in ESPN.
 */
/**
 * OPENING AN OFFER IN ESPN WITH BOTH SIDES TICKED.
 *
 * ESPN's own URL can only ever pre-tick the counterparty's players. That is not
 * a choice we made: their trade page matches `players=` against the other
 * team's roster alone, there is no parameter for your own side, and swapping
 * `teamId`/`fromTeamId` fails because ESPN overrides `fromTeamId` to a team you
 * own and then refuses with "You are trying to propose trade to yourself."
 * Their own Decline & Counter button ships a trade link with no players at all,
 * which is the clearest evidence that no both-sides encoding exists.
 *
 * So the extension does the other half, on the page, with a content script that
 * ticks the owner's own men. `stageTrade` leaves it a note; the link is opened;
 * the script reads the note and ticks. **Nothing is sent to ESPN by any of
 * this** — the one write is still his own click on ESPN's own Propose button,
 * and the extension keeps only its read permission.
 *
 * The offers are registered by a bare counter rather than serialised into the
 * markup, the same way `js/player-card.js` registers a week run, and for the
 * same reason: a whole package on every row is a lot of duplicated attribute
 * for something read once.
 */
const ESPN_OFFERS = new Map();
let espnSeq = 0;

function offerKey(offer) {
  const key = `o${espnSeq++}`;
  ESPN_OFFERS.set(key, offer);
  return key;
}

/**
 * Stage the owner's side, then send the tab to ESPN.
 *
 * THE TAB IS OPENED BEFORE THE AWAIT, not after. `window.open` called once a
 * promise has resolved has lost the user gesture that authorised it, and every
 * popup blocker treats that as a popup — so the tab is claimed synchronously
 * inside the click and navigated a moment later. If staging fails for any
 * reason, including the extension simply not being installed, the same tab goes
 * to the plain link and the page behaves exactly as it did before: their side
 * ticked, his side to tick by hand.
 *
 * NO `noopener` IN THE FEATURES. It was here, and it broke the button: with
 * `noopener` the browser opens the tab but `window.open` returns `null` — by
 * spec, always — so the page lost its handle on the blank tab it had just
 * opened, then called `window.open` a second time after the await, with the
 * click's permission spent. Tim got a blank tab, and the real one was blocked.
 * The handle is kept instead and the tab's `opener` cut by hand, which is the
 * same protection `noopener` gives ESPN's page.
 *
 * And the extension is only asked when it has said hello. Absent, nothing ever
 * answers and the ask sits out its full timeout while the tab stays blank.
 */
const STAGE_TIMEOUT_MS = 4000;

/**
 * The oldest extension that ticks your side properly: 0.3.0 added the ticking,
 * 0.3.1 stopped it refusing every trade with a D/ST in it, and 0.3.2 says on
 * ESPN's page when a staged deal does not fit the screen. The extension is
 * unpacked, so it runs whatever version was last RELOADED in Edge rather than
 * what is in the repo — which is exactly the failure this check names.
 */
const MIN_TICK_VERSION = '0.3.2';

function versionAtLeast(have, want) {
  if (!have) return false;
  const a = String(have).split('.').map(Number);
  const b = String(want).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * One line, fixed at the foot of the window, saying what became of your side.
 * It stays until dismissed or replaced: it is what he reads when he comes back
 * from ESPN wondering why nothing of his was ticked.
 */
function showEspnOutcome(outcome) {
  const el = $('espnOutcome');
  if (!el || !outcome) return;
  el.classList.toggle('bad', !!outcome.bad);
  $('espnOutcomeText').textContent = outcome.text;
  el.hidden = false;
}

async function openInEspn(offer, href) {
  let tab = null;
  try {
    tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
  } catch {
    tab = null;
  }

  let url = href;
  const names = offer.send.map((p) => p.name).join(' and ');
  // What happened to YOUR side, said on this page once the tab has gone. Every
  // branch below used to fall back to the plain link in silence, so "my side
  // isn't ticked" had four possible causes and no way to tell them apart.
  let outcome = null;
  const version = extensionVersion();
  if (!bridgeAvailable()) {
    outcome = {
      bad: true,
      text: `ESPN will open with his players ticked, but not yours: the Fantasy Football Bridge ` +
        `extension isn’t running on this page. Tick ${names} yourself.`,
    };
  } else if (!versionAtLeast(version, MIN_TICK_VERSION)) {
    outcome = {
      bad: true,
      text: `Your extension is version ${version || 'unknown'}, and ticking your side needs ` +
        `${MIN_TICK_VERSION} or later. Paste edge://extensions into the address bar and press ` +
        `Reload on Fantasy Football Bridge, then reload this page. For now, tick ${names} yourself.`,
    };
  }
  if (bridgeAvailable()) try {
    const cfg = espn.getConfig();
    // The plain link's own filter, applied to the staged link too: an id not on
    // his roster this week is dropped rather than sent, or the two links would
    // disagree about who is ticked.
    const onLink = new Set(
      (new URL(href).searchParams.get('players') || '').split(',').filter(Boolean).map(Number)
    );
    const res = await stageTrade({
      timeoutMs: STAGE_TIMEOUT_MS,
      leagueId: cfg.leagueId,
      season: cfg.season,
      myTeamId: state.myTeamId,
      theirTeamId: offer.partner.id,
      // ESPN's own `fullName` where we have it — the content script matches on
      // the name when it cannot recover an id from the page, which is the only
      // way a D/ST can be found at all (its row carries a team logo, not a
      // headshot with an id in the URL).
      myPlayers: offer.send.map((p) => ({ id: p.playerId, name: p.name })),
      theirPlayerIds: offer.receive.map((p) => p.playerId).filter((id) => onLink.has(id)),
    });
    if (res && res.ok && res.data && res.data.url) {
      url = res.data.url;
      outcome = outcome || {
        bad: false,
        text: `Handed ${names} to the extension. On ESPN’s page a badge in the bottom-left ` +
          `corner says what it ticked — if no badge appears within half a minute, the ticking ` +
          `didn’t run and ${names} need ticking by hand.`,
      };
    } else {
      outcome = outcome || {
        bad: true,
        text: `The extension didn’t take your side (${(res && res.error) || 'no answer'}). ` +
          `ESPN will open with his players ticked; tick ${names} yourself.`,
      };
    }
  } catch (err) {
    // The plain deep link still works; say why yours is not ticked.
    outcome = outcome || {
      bad: true,
      text: `Couldn’t hand your side to the extension (${(err && err.message) || err}). ` +
        `Tick ${names} yourself on ESPN.`,
    };
  }

  showEspnOutcome(outcome);

  if (tab) {
    // Closed while staging ran is his choice, and is left alone.
    if (!tab.closed) tab.location.href = url;
    return;
  }
  // No tab at all — a blocker refused the open. Opening again here has no click
  // behind it and would be refused too, so this tab goes instead: the Trade
  // page is one Back away.
  window.location.href = url;
}

/**
 * Is the finder searching from someone else's squad? ESPN only lets you
 * propose from your own, and overrides the link to say so — so a deal found
 * from another manager's roster has no screen to open. Unknown (the connection
 * bar was never told your team) is not "someone else".
 */
const tradingForSomeoneElse = () =>
  !state.isDemo && state.espnTeamId != null && state.myTeamId !== state.espnTeamId;

function espnTradeUrl(offer) {
  const cfg = espn.getConfig();
  if (state.isDemo || !state.data || !cfg.leagueId || !offer.partner) return null;
  if (state.myTeamId === null || state.myTeamId === undefined) return null;
  if (tradingForSomeoneElse()) return null;

  const onHisRoster = new Set(
    ((state.data.teams.find((t) => t.id === offer.partner.id) || {}).players || [])
      .map((p) => p.playerId)
      .filter((id) => id !== null && id !== undefined)
  );
  const ids = offer.receive
    .map((p) => p.playerId)
    .filter((id) => onHisRoster.has(id));
  if (!ids.length) return null;

  return (
    'https://fantasy.espn.com/football/team/trade' +
    `?leagueId=${encodeURIComponent(cfg.leagueId)}` +
    `&seasonId=${encodeURIComponent(cfg.season)}` +
    `&teamId=${encodeURIComponent(offer.partner.id)}` +
    `&fromTeamId=${encodeURIComponent(state.myTeamId)}` +
    '&step=1' +
    `&players=${ids.map((id) => encodeURIComponent(id)).join(',')}`
  );
}

/**
 * The button, or the reason there isn't one.
 *
 * NO `title` ON IT, deliberately: `js/touch-titles.js` leaves controls alone —
 * a tap on a control has to work the control — so a `title` here would be
 * invisible on Tim's phone. What it needs to say goes in the panel note and on
 * its own face instead.
 */
function espnCell(offer) {
  const href = espnTradeUrl(offer);
  if (href) {
    // The label changes with what the browser can actually do. ESPN's URL can
    // only ever tick HIS side — verified against their own shipped code, which
    // matches `players=` against the counterparty's roster alone — so without
    // the extension the honest label says so. With it, the content script ticks
    // ours on the page and both sides arrive selected.
    const both = bridgeAvailable();
    return (
      `<a class="espn-open" href="${esc(href)}" target="_blank" rel="noopener"` +
      ` data-offer="${esc(offerKey(offer))}">` +
      `Open in ESPN${both ? '' : ' · his players only'}</a>`
    );
  }
  return (
    `<span class="espn-off">${
      state.isDemo
        ? 'No ESPN league in demo'
        : tradingForSomeoneElse()
          ? 'Only from your own team'
          : 'ESPN can’t be deep-linked for this offer'
    }</span>`
  );
}

/**
 * One offer, as a row. The finder's rows and the combo's rows are THE SAME
 * markup — Tim asked for the combo to "display the trades as a list just like
 * the regular trade box", and two builders producing nearly the same row is how
 * two tables that claim to be the same thing quietly stop being it.
 *
 * `key` is what identifies the row to the click handler and to focus
 * restoration: `f:3` is the finder's fourth row, `c:0` the combo's first. It is
 * a string rather than an index because the two tables share one modal.
 */
/**
 * PER WEEK FIRST, THE TOTAL UNDERNEATH. Tim, 2026-09-16: "measure everything by
 * per/week with the total as a sub-number, not the other way around."
 *
 * The engine still prices a deal as a rest-of-season total — that is what the
 * weekly measure IS, and rule 10 in HANDOFF.md — so these take the total and
 * print it divided by the span, with the total in small type. A gain divides
 * exactly: it is a sum over exactly these weeks. That is NOT true of the figure
 * beside a player, which skips his byes — see `manLine`.
 *
 * Sort keys (`data-v`) stay the totals. Every row shares one span, so dividing
 * would not change a single comparison, and the re-derivations in tr-test check
 * the engine's own totals against them.
 */
const perWeekOf = (total) => total / (weeklySpan().length || 1);

function weeklyGainHtml(total) {
  return (
    `${signedText(perWeekOf(total))}<span class="unit">/wk</span>` +
    `<span class="sub">${signedText(total)} total</span>`
  );
}

function weeklyLineupHtml(before, after) {
  return (
    `${fmt(perWeekOf(before))} → ${fmt(perWeekOf(after))}<span class="unit">/wk</span>` +
    `<span class="sub">${fmt(before)} → ${fmt(after)} total</span>`
  );
}

/** For prose: "+4.5 a week (+53.7 over weeks 2–13)". */
function weeklyPhrase(total) {
  return (
    `<strong>${signedText(perWeekOf(total))} a week</strong> ` +
    `(${signedText(total)} over ${weekRange(weeklySpan())})`
  );
}

/** "You gain a week (wk 2–13)" — per week either way; the span says which weeks. */
const GAIN_HEAD = (who, weeks, span) =>
  weeks && span.length ? `${who} a week (${weekRange(span)})` : `${who}, a week`;

function offerRow(offer, i, key) {
  const send = offer.send.map(manLine).join('');
  const receive = offer.receive.map(manLine).join('');
  const weeks = basis() === 'weeks' && weeklySpan().length > 0;
  const gain = (v) => (weeks && Number.isFinite(v) ? weeklyGainHtml(v) : signedText(v));
  const picked = state.deal && state.deal === offer ? ' picked' : '';

  const merged = offer.merged
    ? `<span class="merged-tag">${plural(offer.mergedFrom, 'deal')} as one</span>`
    : '';

  // A REAL BUTTON, not just a clickable row. The row still opens the modal on a
  // click, because a manager reading with a mouse should not have to find a
  // target — but a <tr> is not in the tab order and answers no key, so on its
  // own it would make the whole breakdown unreachable without a pointer. The
  // button is the keyboard route in AND the element focus returns to when the
  // modal closes. No `title` on it: js/touch-titles.js leaves controls alone.
  const open =
    `<button type="button" class="wk-open" data-open="${esc(key)}">Week by week</button>`;

  return (
    `<tr class="row${picked}" data-i="${i}" data-key="${esc(key)}">` +
    // The manager's name gets its own element so the merged badge beside it is
    // never read as part of it — by a test, by a sort, or by anyone.
    `<td class="name"><span class="mgr">${esc(offer.partner.name)}</span>${merged}</td>` +
    `<td class="left" data-v="${esc(offer.kind)}">` +
      `<span class="shape" title="${esc(offer.shape)} — you send ${plural(offer.send.length, 'player')}, ` +
      `you receive ${plural(offer.receive.length, 'player')}.">` +
      `${esc(SHAPE_LABEL[offer.kind])}</span>${open}</td>` +
    `<td class="left pkg">${send}</td>` +
    `<td class="left pkg">${receive}${churnHtml(offer.yourChurn)}</td>` +
    `<td class="before-after" data-v="${offer.myAfter}">` +
      (weeks && Number.isFinite(offer.myBefore) && Number.isFinite(offer.myAfter)
        ? weeklyLineupHtml(offer.myBefore, offer.myAfter)
        : `${fmt(offer.myBefore)} → ${fmt(offer.myAfter)}`) +
      `</td>` +
    `<td class="gain pos" data-v="${offer.myGain}">${gain(offer.myGain)}</td>` +
    `<td class="their-gain pos" data-v="${offer.theirGain}">${gain(offer.theirGain)}</td>` +
    `<td class="left">${espnCell(offer)}</td>` +
    `</tr>`
  );
}

const tradeRow = (offer, i) => offerRow(offer, i, `f:${i}`);

/** The offers currently on screen: the search, narrowed to the chosen manager. */
function visibleOffers() {
  if (!state.search) return [];
  if (state.partner === 'all') return state.search.offers;
  return state.search.offers.filter((o) => String(o.partner.id) === String(state.partner));
}

function renderFinder() {
  const table = $('tradeTable');
  const teams = state.data ? state.data.teams : [];
  const me = teams.find((t) => t.id === state.myTeamId);

  $('finderTitle').textContent = me
    ? `Trades that help both squads · ${me.name}`
    : 'Trades that help both squads';

  // The two gain columns are the page's most dangerous numbers, because the
  // two bases differ by a factor of nine or more and both look plausible. The
  // heading says which, every time, rather than the note alone.
  const weeks = basis() === 'weeks';
  const span = weeklySpan();
  $('thMyGain').textContent = GAIN_HEAD('You gain', weeks, span);
  $('thTheirGain').textContent = GAIN_HEAD('He gains', weeks, span);
  $('thLineup').textContent = 'Your lineup, a week';

  // Both halves are written on EVERY path, and that is not tidiness. Hiding
  // the table without emptying it left the previous search's rows sitting in
  // the document — invisible, but still the answer to a question nobody had
  // asked any more — and the same omission left "Trying every swap…" parked in
  // the hidden empty panel long after the search had finished. Neither showed
  // on screen, which is exactly why both survived until a test read the DOM
  // rather than looking at it.
  const body = bodyOf(table);
  const empty = $('tradeEmpty');

  if (state.searching) {
    state.rows = [];
    body.innerHTML = '';
    $('tradeWrap').classList.add('hidden');
    empty.classList.remove('hidden');
    empty.innerHTML = `<span class="searching">Trying every swap in the league${
      weeks ? `, in each of ${plural(span.length, 'week')} — this one takes a few seconds` : ''
    }…</span>`;
    renderFinderNote();
    return;
  }

  const offers = visibleOffers();
  state.rows = offers;
  $('tradeWrap').classList.toggle('hidden', offers.length === 0);
  empty.classList.toggle('hidden', offers.length > 0);
  body.innerHTML = offers.map(tradeRow).join('');
  empty.innerHTML = offers.length ? '' : emptyMessage();

  renderFinderNote();
  if (offers.length) resort(table);
}

/**
 * Nothing found is a real answer here, and it gets a real sentence.
 *
 * A win-win trade needs two managers whose weaknesses are opposite, and in a
 * league where everybody is roughly as deep as everybody else there may
 * genuinely not be one. That is worth saying plainly: the alternative is a page
 * that looks broken, or worse, one that relaxes its own rule until it can print
 * something.
 */
function emptyMessage() {
  const teams = state.data ? state.data.teams : [];
  if (!teams.length) return 'No roster data for this week.';
  if (!state.search) return 'Pick a team to search from.';

  const narrowed = state.kind !== 'all' || state.partner !== 'all';
  return (
    `<strong>No trade here makes both squads better.</strong> ` +
    (narrowed
      ? 'Try <em>Any shape</em> and every manager before reading much into that. '
      : 'That is a real answer rather than a gap: it needs two managers who are weak ' +
        'in opposite places, and this league may simply not have a pair. ') +
    `The depth map above shows where the league is level and where it is not.`
  );
}

function renderFinderNote() {
  const m = meta();
  const weeks = basis() === 'weeks';
  const span = weeklySpan();
  const shown = state.rows.length;
  const kindNote =
    state.kind === 'all'
      ? 'straight swaps, two-for-ones and one-for-twos'
      : state.kind === 'even'
        ? 'straight one-for-one swaps only'
        : state.kind === 'consolidate'
          ? 'packages where you send two and receive one'
          : 'packages where you send one and receive two';

  $('tradeNote').innerHTML =
    `Every offer here was found by <strong>re-filling both starting lineups</strong> — before ` +
    `the trade and after it — and keeping only the ones where <strong>both totals go up</strong>. ` +
    `There is no trade-value chart anywhere in this: a bench player is worth nothing to the ` +
    `manager holding him and can be worth a starter to somebody else, which is exactly why a ` +
    `deal can help both sides at once. Valued on ${esc(m.label)} (${m.basis}). ` +
    `<br>` +
    (weeks
      ? `<strong>Every figure is per week</strong>, averaged over ${weekRange(span)}, with the ` +
        `rest-of-season total in small type underneath — the per-week number is exactly that total ` +
        `divided by ${plural(span.length, 'week')}. Each lineup is filled separately ` +
        `in each week, on that week’s own projections, so a man on bye is simply replaced that week ` +
        `rather than dragging an average down. ` +
        `<strong>Only weeks still to be played are priced</strong> — ${weekRange(span)} — because a ` +
        `trade changes the rest of the season and cannot move points already banked. ` +
        `<strong>The number beside each player is what he is worth in a week he PLAYS</strong>, his ` +
        `byes left out of the average — whereas a gain is spread over every week in the span, byes ` +
        `and all — so the two are deliberately <em>not</em> the same arithmetic. `
      : `<strong>You gain</strong> and <strong>He gains</strong> are points per week added to each ` +
        `best lineup, and so is the figure beside each player. `) +
    `Currently searching ${kindNote}` +
    (state.partner === 'all' ? '' : ', with one manager') +
    `${shown ? ` · <strong>${plural(shown, 'offer')}</strong>` : ''}. ` +
    `<strong>Click any row</strong> — or its <strong>Week by week</strong> button — to open that ` +
    `deal week by week in a pop-up. ` +
    `A <strong>two-for-one</strong> forces the side receiving two to drop somebody, and that cut ` +
    `is modelled — his worst man goes — because it is what makes lopsided packages worse than ` +
    `they look. The side left a man short is <em>not</em> credited with a waiver claim to fill ` +
    `the gap, so those offers are understated rather than flattered. ` +
    `<br>` +
    `This is analysis, not a transaction. <strong>Nothing is sent to ESPN</strong> — ` +
    (state.isDemo
      ? `and there is no ESPN league to open in demo, so the <em>Open in ESPN</em> links are off ` +
        `here; switch to <strong>My ESPN league</strong> for them. `
      : `<strong>Open in ESPN</strong> is a deep link and nothing more: it opens ESPN’s own trade ` +
        `screen with <strong>HIS players ticked only</strong>. There is no parameter for your own ` +
        `side, so the men you are sending have to be ticked by hand once you are there — that is ` +
        `ESPN’s screen, not a fault here. `) +
    `Send the deal with a line saying what it fixes for him, which is the part that gets offers ` +
    `accepted. Both managers are reading the same ESPN projections, so he can check every number ` +
    `here himself.`;
}

/**
 * Run the search, off the paint.
 *
 * On a scalar measure a ten-team league is a few hundred thousand lineup fills
 * and lands around a quarter of a second. On the weekly measure it is that
 * again for every week in the span and takes a few seconds — which is exactly
 * why the "searching" state has to paint before it starts, and why the message
 * says which of the two is running. Same rAF-then-timeout shape as the season
 * simulation on the schedule page.
 */
function runSearch({ keepDeal = false } = {}) {
  const teams = state.data ? state.data.teams : [];
  // A new search invalidates the drill-down: it is holding an offer object out
  // of the PREVIOUS search, and leaving a pop-up open over a fresh table would
  // put two different answers on one page.
  //
  // `keepDeal` is the one exception: the remaining weeks have just landed, the
  // search is re-ranking on them, and the open pop-up is ALREADY priced on
  // those same weeks — so the two agree, and shutting it would throw away the
  // thing the reader clicked to see. Its row may move, so the key is dropped
  // rather than left pointing at whatever now sits in that position.
  if (keepDeal && state.deal) state.dealKey = null;
  else {
    state.deal = null;
    state.dealKey = null;
  }
  state.combo = null;
  state.comboMerged = null;
  state.comboRows = [];

  if (!teams.length || state.myTeamId === null) {
    state.deal = null;
    state.search = null;
    state.searching = false;
    paint();
    return;
  }

  state.searching = true;
  state.search = null;
  paint();

  const token = ++runSearch.token;
  const kinds = state.kind === 'all' ? PACKAGE_KINDS : [state.kind];
  const weeks = basis() === 'weeks' ? weeklySpan() : null;

  const go = () => {
    if (token !== runSearch.token) return; // a newer search has started
    const result = findTrades({
      teams,
      myTeamId: state.myTeamId,
      slots: state.slots,
      measure: measureFn(),
      kinds,
      weeks,
      projFor: weeks ? projFor : null,
      zeroIsBye: zeroIsBye(),
    });
    if (token !== runSearch.token) return;
    state.search = result;
    state.searching = false;
    paint();
    runCombo();
  };

  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
  else setTimeout(go, 0);
}
runSearch.token = 0;

// ======================================================================
// The drill-down: one deal, week by week
// ======================================================================
//
// Tim's ask, in his words: "allow each trade to be clicked on, which pulls up
// an analysis of the trade, and shows your current and changed proj across all
// future weeks, and the difference. Make sure both the current and changed proj
// is assuming you're playing the players with the highest proj THAT WEEK."
//
// That last sentence is the whole of it, and `priceTradeAcrossWeeks` does
// exactly that: it fills the best legal lineup separately in every week, on
// that week's own projections, both before the trade and after it.
//
// A TABLE RATHER THAN A CHART, and `js/charts.js` was available. Nine to
// thirteen rows of three numbers is a small table and a cramped chart, and
// every number here is meant to be checked against ESPN by eye — a chart shows
// the shape of a season while hiding the values it is made of, which is the
// wrong trade for a panel whose job is to be verifiable. The shape is not lost:
// the difference column is signed and coloured, so a deal that is +5 on average
// and −12 in the weeks that decide the season is one glance.

function weekTableHtml(byWeek, total, { label = 'With the trade' } = {}) {
  const rows = byWeek
    .map(
      (w) =>
        `<tr>` +
        `<td class="name">Week ${w.week}</td>` +
        `<td>${fmt(w.before)}</td>` +
        `<td>${fmt(w.after)}</td>` +
        `<td class="delta ${w.delta > 0 ? 'up' : w.delta < 0 ? 'down' : ''}">` +
        `${signedText(w.delta)}</td>` +
        `</tr>`
    )
    .join('');

  const beforeTotal = byWeek.reduce((a, w) => a + w.before, 0);
  const afterTotal = byWeek.reduce((a, w) => a + w.after, 0);
  const n = byWeek.length || 1;

  return (
    `<table class="weeks">` +
    `<thead><tr><th class="name">Week</th><th>As you are now</th>` +
    `<th>${esc(label)}</th><th>Difference</th></tr></thead>` +
    `<tbody>${rows}` +
    // Per week FIRST, the total under it — Tim's order for every figure here.
    `<tr class="total"><td class="name">Per week</td>` +
    `<td>${fmt(beforeTotal / n)}</td><td>${fmt(afterTotal / n)}</td>` +
    `<td class="delta ${total > 0 ? 'up' : total < 0 ? 'down' : ''}">${signedText(total / n)}</td></tr>` +
    `<tr class="total sub-row"><td class="name">All ${plural(byWeek.length, 'week')}</td>` +
    `<td>${fmt(beforeTotal)}</td><td>${fmt(afterTotal)}</td>` +
    `<td class="delta ${total > 0 ? 'up' : total < 0 ? 'down' : ''}">${signedText(total)}</td></tr>` +
    `</tbody></table>`
  );
}

function sideHtml(title, players) {
  return (
    `<div class="deal-side"><h3>${esc(title)}</h3>` +
    (players.length ? players.map(manLine).join('') : '<span class="muted">nobody</span>') +
    `</div>`
  );
}

function renderDeal() {
  const modal = $('dealModal');
  const offer = state.deal;
  if (!offer) {
    // EMPTIED, not merely hidden. Two panels on this page have already been
    // caught leaving a previous answer sitting invisibly in the document, and a
    // closed dialog with a week table still inside it is the same defect: it is
    // the answer to a question nobody is asking, findable by search, readable
    // by a screen reader, and impossible to see.
    modal.hidden = true;
    $('dealBody').innerHTML = '';
    $('dealNote').innerHTML = '';
    return;
  }
  modal.hidden = false;

  const me = state.data.teams.find((t) => t.id === state.myTeamId);
  $('dealTitle').textContent = offer.combined
    ? `${offer.label} · ${offer.shape}`
    : `${SHAPE_LABEL[offer.kind]} with ${offer.partner.name} · ${offer.shape}` +
      (offer.merged ? ` · ${plural(offer.mergedFrom, 'deal')} sent as one` : '');

  const head =
    `<div class="deal-head">` +
    sideHtml('You send', offer.send) +
    sideHtml('You get', offer.receive) +
    `</div>` +
    churnHtml(offer.yourChurn);

  // The table needs every remaining week's projections, and it no longer waits
  // for the page-wide button: opening a deal buys them (see `openDeal`). Until
  // they land the pop-up says what it is reading — never a table spread from
  // one scalar across identical rows, which would be an assumption dressed as a
  // season.
  if (!weeklyReady()) {
    const span = weeklySpan();
    const why = !span.length
      ? 'Every week of the regular season has been played, so there is nothing left for a trade to change.'
      : weekly.error && !weekly.loading
        ? `Couldn’t read the remaining weeks: ${esc(weekly.error)}`
        : state.isDemo
          ? `Generating ${weekRange(span)}…`
          : `Reading ${weekRange(span)} from ESPN — one request per week not already loaded…`;
    $('dealBody').innerHTML = head + `<p class="empty">${why}</p>`;
    $('dealNote').innerHTML = '';
    return;
  }

  const span = weeklySpan();
  const priced = priceTradeAcrossWeeks({
    players: me.players,
    send: offer.send,
    receive: offer.receive,
    slots: state.slots,
    weeks: span,
    projFor,
    zeroIsBye: zeroIsBye(),
  });

  const cut = priced.cut.length
    ? `<p class="deal-cut">The roster limit forces you to drop ` +
      `${priced.cut
        .map((p) => `<b>${esc(p.name)}</b>${p.position === 'DST' ? '' : ` ${esc(p.position)}`}`)
        .join(', ')}` +
      ` — a two-for-one leaves you a man over, and this is his cost.</p>`
    : '';

  const href = espnTradeUrl(offer);
  const espnBlock = href
    // `data-offer` too, or the capture handler finds nothing registered and the
    // pop-up's link never asks the extension to tick your side.
    ? `<p><a class="espn-open" href="${esc(href)}" target="_blank" rel="noopener"` +
      ` data-offer="${esc(offerKey(offer))}">` +
      `Open this trade in ESPN${bridgeAvailable() ? '' : ' · his players only'}</a><br>` +
      `<span class="espn-off">ESPN’s screen opens with <strong>${offer.receive
        .map((p) => esc(p.name))
        .join(' and ')}</strong> already ticked on his side. ` +
      (bridgeAvailable()
        ? `The extension ticks ${offer.send.map((p) => esc(p.name)).join(' and ')} on yours; ` +
          `check both sides before you press Propose. `
        : `There is no parameter for your own side, so you tick ` +
          `${offer.send.map((p) => esc(p.name)).join(' and ')} by hand once you are there. `) +
      `Nothing is sent from this site.</span></p>`
    // A whole packing has no single manager on the other side of it, so there
    // is no one screen to open — which is a fact about the combination rather
    // than a failure, and it is said as one. Each manager's own row carries his
    // own link.
    : `<p><span class="espn-off">${
        offer.combined
          ? 'A combination is several trades with several managers, so there is no one ESPN ' +
            'screen for it. Each manager’s own row above opens his.'
          : state.isDemo
            ? 'There is no ESPN league to open in demo — switch to <strong>My ESPN league</strong> ' +
              'for the deep link.'
            : tradingForSomeoneElse()
              ? 'This deal is from another manager’s squad, and ESPN only lets you propose from ' +
                'your own. Pick your team under <strong>Your team</strong> to get links.'
              : 'This offer cannot be deep-linked: none of the men you would receive is on that ' +
              'manager’s roster in the week being shown.'
      }</span></p>`;

  $('dealBody').innerHTML =
    head +
    weekTableHtml(priced.byWeek, priced.delta, {
      label: offer.combined ? 'With the combination' : 'With the trade',
    }) +
    cut +
    espnBlock;

  const sumOfRows = priced.byWeek.reduce((a, w) => a + w.delta, 0);
  $('dealNote').innerHTML =
    (basis() !== 'weeks'
      ? `<strong>The list behind this is ranked on ${esc(meta().label)}</strong>, not week by week, ` +
        `so its figure for this deal will not match the total here. Choose ` +
        `<strong>Every remaining week</strong> at the top to rank the whole list this way. `
      : '') +
    `<strong>As you are now</strong> and <strong>With the trade</strong> are both your best legal ` +
    `lineup <em>in that week</em>, filled from that week’s own projections — so both sides of the ` +
    `comparison assume you start whoever is highest that week, which is what you would actually ` +
    `do. <strong>Per week</strong> is the average of the rows, ` +
    `${signedText(priced.delta / (span.length || 1))}; the rows add up to the total underneath, ` +
    `${signedText(sumOfRows)} across ${plural(span.length, 'week')}, printed as ` +
    `${signedText(priced.delta)} (they differ by at most a rounding tenth a row) — and the point of ` +
    `the table is that the average is not the story: the weeks where the difference collapses are ` +
    `byes and soft matchups you already cover, and the weeks where it opens up are the ones the ` +
    `trade is really buying. ` +
    `<strong>Only ${weekRange(span)} appear here</strong>, because those are the weeks still to be ` +
    `played; a week with a result against it is banked and no trade can reach it. ` +
    `The per-week number beside each player above is a different arithmetic again — it is what he ` +
    `is worth in a week he PLAYS, with his byes left out — so it does not multiply up to these ` +
    `totals, and is not meant to. ` +
    (priced.cut.length
      ? `The forced cut above is applied <strong>once</strong>, for the whole season, rather than ` +
        `re-decided every week — a manager does not get his dropped man back in week 10. `
      : '') +
    `These are the <strong>same projections</strong> the depth map is drawn from, over the same ` +
    `weeks — that table averages them and this one picks each week separately, and the gap ` +
    `between those two readings is exactly what depth is worth. So the two panels cannot ` +
    `contradict each other about a player; where they differ, it is the arithmetic differing, ` +
    `and that difference is the answer rather than a discrepancy.`;
}

/**
 * Open one deal in the modal, remembering what opened it.
 *
 * `key` identifies the ROW rather than the element, and that is deliberate:
 * `paint()` rebuilds both tables' markup, so the button that was clicked is a
 * different object by the time the modal is on screen and by the time it
 * closes. Looking the key up again afterwards is what makes focus come back to
 * where it left — a dialog that dumps you at the top of the document is a
 * dialog a keyboard user has to re-navigate the whole page out of.
 */
function openDeal(offer, key) {
  if (!offer) return;
  state.deal = offer;
  state.dealKey = key || null;
  paint();
  // The close button, because it is the one control a reader has to be able to
  // reach and the natural first stop in a dialog. Everything inside is after it
  // in the tab order, so nothing is skipped by starting here.
  focusEl($('dealClose'));
  loadWeeksForDeal(offer);
}

/**
 * Buy the remaining weeks for the pop-up, if they are not already in hand.
 *
 * Tim's ask: the pop-up should show the week-by-week numbers, not a sentence
 * telling him to press a button first. Clicking a deal IS the ask for them, so
 * the click pays. It deliberately leaves the page's measure alone and runs no
 * search — the list behind stays exactly as it was ranked, and `runSearch`
 * would shut this pop-up besides.
 */
async function loadWeeksForDeal(offer) {
  if (weekly.key !== sourceKey()) resetWeekly();
  rememberSelectedWeek();
  if (weeklyReady() || weekly.loading || !weeklySpan().length) { paint(); return; }
  const done = await buyMissingWeeks();
  if (!done) return;
  // The page button may have been pressed while this was reading, switching
  // the whole page to the weekly measure; its own load bailed out on seeing
  // ours in flight, so the re-rank it owes is paid here.
  if (state.measure === 'weeks') { runSearch({ keepDeal: true }); return; }
  // Otherwise repaint only if the reader is still looking at the same deal —
  // the cache is filled either way, so the next deal they open is free.
  if (state.deal === offer) paint();
  else renderCost();
}

/** Close it, and put the keyboard back where it came from. */
function closeDeal() {
  if (!state.deal) return;
  const key = state.dealKey;
  state.deal = null;
  state.dealKey = null;
  paint();
  if (key) focusEl(document.querySelector(`[data-open="${cssKey(key)}"]`));
}

/** Focus, when there is anything to focus and a layout to do it in. */
function focusEl(el) {
  if (!el || typeof el.focus !== 'function') return;
  try { el.focus(); } catch { /* no layout, e.g. under a test harness */ }
}

/** Our keys are `f:3` / `c:0`; the colon is legal in an attribute selector. */
const cssKey = (k) => String(k).replace(/["\\]/g, '');

// ======================================================================
// The best combo
// ======================================================================
//
// Tim's ask: "a best combo section that allows the most trades possible for that
// user, knowing that they can't trade a player twice".
//
// Two things in that sentence pull apart, and the engine returns both rather
// than picking one: `best` is the packing worth the most points, `most` is the
// packing with the most trades in it. Three trades worth +2 between them is a
// worse season than two worth +15, so the headline is the first — but he asked
// literally for the most trades possible, so when they differ the other one is
// offered underneath, in words rather than only in numbers.
//
// THE TRAP, and it is why nothing here adds anything up: a combo's gain is NOT
// the sum of its trades' gains. Every offer's gain was measured against your
// current roster, and after one trade that roster no longer exists. The engine
// prices the whole packing in one go; `naiveDelta` is what you would have
// believed if you had added them, and it is printed precisely so the gap is
// visible rather than hidden.

/**
 * The combo's offers, as a table in the finder's own shape.
 *
 * Tim's ask: "In the best combo box, it should display the trades as a list
 * just like the regular trade box, and you should be able to click on the link
 * to fantasy in the same way as well."
 *
 * So it is literally the same row builder and the same head, which is also what
 * gets the ESPN deep link and the week-by-week pop-up for nothing. `rows` are
 * the MERGED offers — one per manager — and `from` is where their keys start,
 * because the best packing and the "most trades" alternative are two tables
 * sharing one `state.comboRows` array and one modal.
 */
function comboTableHtml(rows, from, id) {
  const weeks = basis() === 'weeks';
  const span = weeklySpan();
  return (
    `<div class="table-scroll"><table id="${esc(id)}" class="offers">` +
    `<thead><tr>` +
    `<th class="name">Manager</th>` +
    `<th class="left">Deal</th>` +
    `<th class="left">You send</th>` +
    `<th class="left">You get</th>` +
    `<th>Your lineup, a week</th>` +
    `<th>${esc(GAIN_HEAD('You gain', weeks, span))}</th>` +
    `<th>${esc(GAIN_HEAD('He gains', weeks, span))}</th>` +
    `<th class="left">ESPN</th>` +
    `</tr></thead><tbody>` +
    rows.map((o, k) => offerRow(o, from + k, `c:${from + k}`)).join('') +
    `</tbody></table></div>`
  );
}

/**
 * One packing: the headline, its offers, and the way into its own breakdown.
 *
 * THE COMBINED WEEK TABLE IS BEHIND A CLICK TOO, and that is the rest of Tim's
 * fifth ask — "including the best combo". It used to be printed inline under
 * the list, which is exactly the "separate box below everything" he asked to be
 * rid of. `allIndex` is where the whole-packing pseudo-offer sits in
 * `state.comboRows`, so the button opens the same pop-up the rows do.
 */
function comboBlockHtml(entry, rows, from, id, allIndex, { heading = '', lead = '' } = {}) {
  const span = weeklySpan();
  return (
    (heading ? `<h3>${esc(heading)}</h3>` : '') +
    (lead ? `<p>${lead}</p>` : '') +
    `<div class="combo-head"><span class="big">${signedText(perWeekOf(entry.delta))}</span> a week ` +
    `<span class="sub-inline">(${signedText(entry.delta)} total over ${weekRange(span)})</span> from ` +
    `<strong>${plural(entry.count, 'trade')}</strong>` +
    (rows.length && rows.length < entry.count
      ? ` — sent as ${plural(rows.length, 'offer')}, because two of them are with one manager`
      : '') +
    (entry.count
      ? ` <button type="button" class="wk-open" data-i="${allIndex}" data-key="c:${allIndex}">` +
        `All ${plural(entry.count, 'trade')} week by week</button>`
      : '') +
    `</div>` +
    (entry.count
      ? comboTableHtml(rows, from, id)
      : `<p class="empty">Making none of them is the best answer here — every offer is worth ` +
        `less once the others are made.</p>`)
  );
}

/**
 * The whole packing as one openable "offer".
 *
 * Not a real trade and it does not pretend to be: there is no partner, because
 * there is no one manager on the other side of it, and `espnTradeUrl` returns
 * nothing for it rather than inventing a screen. Each manager's own row carries
 * his own link, which is where a deal actually gets proposed. What this is for
 * is the one number the rows deliberately do NOT add up to — the whole slate,
 * priced once, week by week.
 */
function wholeComboOffer(entry, label) {
  return {
    combined: true,
    label,
    partner: null,
    send: entry.combo.flatMap((o) => o.send),
    receive: entry.combo.flatMap((o) => o.receive),
    kind: 'even',
    shape: `${entry.count}-trade combination`,
    basis: 'weeks',
    myGain: entry.delta,
    myBefore: entry.pricing ? entry.pricing.before.total : null,
    myAfter: entry.pricing ? entry.pricing.after.total : null,
    yourChurn: entry.pricing ? entry.pricing.churn : null,
  };
}

function renderCombo() {
  const body = $('comboBody');
  const note = $('comboNote');
  const span = weeklySpan();

  // Cleared on every path that draws no table, so a click on nothing can never
  // reach a row object left over from the last answer.
  state.comboRows = [];

  if (basis() !== 'weeks') {
    body.innerHTML =
      `<p class="empty">The best combo is only priced on <strong>every remaining week</strong>. ` +
      `Press <strong>${esc($('loadWeeks').textContent)}</strong> at the top.</p>`;
    note.innerHTML =
      `Two trades cannot be added up honestly on a single number per man: both of them re-fill ` +
      `the same one lineup, so their gains overlap and adding them promises twice what arrives. ` +
      `Pricing a combination means applying every send and every receive together and filling ` +
      `every remaining week again — which is why this section waits for those weeks rather than ` +
      `estimating without them.`;
    return;
  }

  if (state.comboRunning) {
    body.innerHTML = '<p class="empty"><span class="searching">Trying every set of trades that ' +
      'can all be made at once…</span></p>';
    note.innerHTML = '';
    return;
  }

  const combo = state.combo;
  if (!combo || !combo.best) {
    body.innerHTML =
      `<p class="empty">Nothing to combine: the finder has no offers for this squad.</p>`;
    note.innerHTML = '';
    return;
  }

  const best = combo.best;
  const most = combo.most;

  // The merged rows, and the index space the two tables share. Computed in
  // `runCombo` rather than here so a repaint — a partner filter, a card
  // clearing — does not re-price every manager's combined side.
  //
  // The two whole-packing pseudo-offers go on the END, so adding one never
  // renumbers a row above it.
  const merged = state.comboMerged || { best: [], most: [] };
  const showAlt = !combo.mostIsBest && !!most;
  const allBestIndex = merged.best.length + merged.most.length;
  const allMostIndex = allBestIndex + 1;
  state.comboRows = merged.best.concat(
    merged.most,
    [wholeComboOffer(best, 'The best combination')],
    showAlt ? [wholeComboOffer(most, 'The most trades possible')] : []
  );

  const naive =
    `Adding the offers’ own gains would have given ${weeklyPhrase(best.naiveDelta)}. ` +
    `Together they are actually worth ${weeklyPhrase(best.delta)}` +
    (best.delta < best.naiveDelta
      ? ` — <em>less</em>, because two upgrades compete for the same lineup places and only the ` +
        `better of them can start.`
      : best.delta > best.naiveDelta
        ? ` — <em>more</em>, because the men one deal sends away are the ones another deal makes ` +
          `surplus, so the roster carries fewer passengers.`
        : `, which is a coincidence rather than a rule.`);

  body.innerHTML =
    `<div class="combo-best">${comboBlockHtml(
      best, merged.best, 0, 'comboTable', allBestIndex, { lead: naive }
    )}</div>` +
    (!showAlt
      ? ''
      : `<div class="combo-alt">` +
        comboBlockHtml(most, merged.most, merged.best.length, 'comboAltTable', allMostIndex, {
          heading: `The most trades possible: ${plural(most.count, 'trade')}`,
          lead:
            `You asked for the most trades that can all be made at once, and that is a different ` +
            `question from the most points. This packing makes ` +
            `<strong>${plural(most.count, 'trade')}</strong> instead of ` +
            `<strong>${plural(best.count, 'trade')}</strong> and is worth ` +
            `${weeklyPhrase(most.delta)} rather than ${weeklyPhrase(best.delta)}. More deals, ` +
            (most.delta < best.delta ? 'fewer points' : 'the same points or better') +
            ` — the one above is the one to make.`,
        }) +
        `</div>`);

  const partners = best.partners || [];
  note.innerHTML =
    `A player can only be traded once, so these ${plural(best.count, 'trade')} share no player ` +
    `between them — not one you send, not one you receive. ` +
    `<strong>Never add the gains up.</strong> Each offer’s gain was measured against your roster as ` +
    `it is today; after one trade that roster no longer exists, so the combination is priced by ` +
    `applying every send and every receive <em>together</em> and re-filling every week once. ` +
    `The forced cut is applied to the combined result too — two one-for-twos leave you two men ` +
    `over the limit and cost you two players, which pricing them separately would miss. ` +
    (partners.length
      ? `Every manager involved was re-priced on his combined side as well, and a packing any of ` +
        `them would refuse is thrown out: ` +
        partners
          .map((p) => `${esc(p.partner.name)} ${signedText(perWeekOf(p.delta))}/wk`)
          .join(', ') + '. '
      : '') +
    (best.repeatPartners
      ? `<strong>Two of these are with the same manager, and they are shown as ONE offer.</strong> ` +
        `That is not tidying up: he would be sent one trade, he accepts or refuses it once, and the ` +
        `engine has already priced both halves as a single roster change — so splitting them into ` +
        `two rows with two gains would be showing you exactly the arithmetic this section exists to ` +
        `refuse. The merged row is <em>re-priced from scratch</em> as one move; its gain is not the ` +
        `two gains added up. Read it before you send it: a four-player trade is a different ` +
        `conversation from two two-player ones. `
      : '') +
    `The gains in the table are each measured against your roster <em>as it is today</em>, so they ` +
    `do not add up to the headline either — only the figure at the top prices the whole slate. ` +
    (combo.exhaustive
      ? `Every combination of the ${plural(combo.offers.length, 'offer')} was tried — ` +
        `${combo.considered} of them survive the no-player-twice rule. `
      : `The search was capped at ${combo.considered} combinations, so this is the best of what ` +
        `was tried rather than provably the best of all. `) +
    `Every figure is per week over ${weekRange(span)}, with the rest-of-season total beside it; ` +
    `nothing here is sent to ESPN.`;
}

/**
 * Work out the combos, off the paint.
 *
 * Only ever the whole-league offer list, never the partner-narrowed one: the
 * question is what YOU can do this week, and a filter on the table above is
 * about reading, not about what is possible.
 */
function runCombo() {
  state.combo = null;
  state.comboMerged = null;
  state.comboRows = [];
  const me = state.data ? state.data.teams.find((t) => t.id === state.myTeamId) : null;
  if (basis() !== 'weeks' || !state.search || !state.search.offers.length || !me) {
    state.comboRunning = false;
    renderCombo();
    return;
  }

  state.comboRunning = true;
  renderCombo();

  const token = ++runCombo.token;
  const go = () => {
    if (token !== runCombo.token) return;
    state.combo = bestCombo(state.search.offers, {
      players: me.players,
      slots: state.slots,
      weeks: weeklySpan(),
      projFor,
      // With the squads in hand every partner's COMBINED side is priced too, so
      // a packing that leaves one of them worse off — two deals that were each
      // a win-win for him but cancel each other out — is dropped rather than
      // proposed.
      teams: state.data.teams,
      requirePartnersGain: true,
      // Two disjoint deals with ONE manager are allowed. They are legal, and
      // they are genuinely one bigger deal he might take — which is now how the
      // page SHOWS them, merged into a single offer with a single re-priced
      // gain, rather than as two rows a reader would be tempted to add up.
      onePerPartner: false,
      zeroIsBye: zeroIsBye(),
    });

    // Merged here, once per search, and not in the renderer: each merged offer
    // costs a fresh `priceTradeAcrossWeeks` — two fills of every remaining week
    // — and a repaint happens on every card, every filter and every sort.
    const opts = {
      players: me.players,
      slots: state.slots,
      weeks: weeklySpan(),
      projFor,
      zeroIsBye: zeroIsBye(),
    };
    state.comboMerged = {
      best: mergeComboByPartner(state.combo.best, opts),
      most:
        state.combo.mostIsBest || !state.combo.most
          ? []
          : mergeComboByPartner(state.combo.most, opts),
    };

    state.comboRunning = false;
    paint();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
  else setTimeout(go, 0);
}
runCombo.token = 0;

// -------------------------------------------------------------------- pickers

function renderTeamPicker() {
  const teams = state.data ? state.data.teams : [];
  const sel = $('teamSelect');
  const want = String(state.myTeamId ?? '');
  sel.innerHTML = teams
    .map(
      (t) =>
        `<option value="${esc(t.id)}"${String(t.id) === want ? ' selected' : ''}>` +
        `${esc(t.name)}</option>`
    )
    .join('');
  if (sel.value !== want) sel.value = want;
}

function renderPartnerPicker() {
  const teams = state.data ? state.data.teams : [];
  const sel = $('partnerSelect');
  const want = String(state.partner);
  sel.innerHTML =
    `<option value="all"${want === 'all' ? ' selected' : ''}>Any manager</option>` +
    teams
      .filter((t) => t.id !== state.myTeamId)
      .map(
        (t) =>
          `<option value="${esc(t.id)}"${String(t.id) === want ? ' selected' : ''}>` +
          `${esc(t.name)}</option>`
      )
      .join('');
  if (sel.value !== want) sel.value = want;
}

function renderWeekPicker() {
  const sel = $('weekSelect');
  sel.innerHTML = state.weeks
    .map(
      (w) =>
        `<option value="${w}"${w === state.week ? ' selected' : ''}>Week ${w}</option>`
    )
    .join('');
  if (sel.value !== String(state.week)) sel.value = String(state.week);
}

/**
 * Hold the selection across weeks when that manager is still in the league,
 * then prefer the reader's own team over whoever happens to be first.
 */
function resolveTeam() {
  const teams = state.data ? state.data.teams : [];
  // No teams is a week still LOADING, not a league without your pick in it.
  // Deciding here used to null the selection on every uncached week change —
  // the empty-state render runs before the fetch — so a squad picked by hand
  // was silently swapped back to your own the moment the week moved.
  if (!teams.length) return;
  if (teams.some((t) => t.id === state.myTeamId)) return;
  const mine = teams.find((t) => t.id === state.espnTeamId);
  state.myTeamId = mine ? mine.id : teams.length ? teams[0].id : null;
  // A partner who is no longer a partner — because he is now you — is dropped
  // rather than left selected on a filter that can match nothing.
  if (String(state.partner) === String(state.myTeamId)) state.partner = 'all';
}

// -------------------------------------------------------------------- sources

// demo-rosters.js is written by a separate pass. Load it lazily so a missing or
// broken file degrades into a clear message instead of a blank page.
let demoGenerator;
async function getDemoGenerator() {
  if (demoGenerator !== undefined) return demoGenerator;
  try {
    const mod = await import('./demo-rosters.js');
    demoGenerator =
      typeof mod.generateDemoWeekRosters === 'function' ? mod.generateDemoWeekRosters : null;
  } catch {
    demoGenerator = null;
  }
  return demoGenerator;
}

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

function describeSource() {
  const teams = state.data ? state.data.teams.length : 0;
  const shape = state.slots ? `${state.slots.length} starters` : 'lineup shape unknown';
  if (state.isDemo) {
    return `Generated sample rosters for week ${state.week} — not your real league · ${shape}.`;
  }
  const played = state.playedWeeks.includes(state.week);
  return (
    `Week ${state.week} · ${plural(teams, 'team')} from ESPN · ${shape}` +
    (played ? '.' : ' · <strong>not played yet</strong> — projections only.')
  );
}

async function loadWeek() {
  const key = `${state.source}:${state.week}`;
  if (cache.has(key)) {
    state.data = cache.get(key);
    rememberSelectedWeek();
    render();
    setStatus(describeSource());
    return;
  }

  state.data = null;
  render(); // show the empty state while the fetch is in flight

  // The connection bar can flip the page to live mid-fetch. A reply that no
  // longer matches what is selected is dropped rather than painted over a
  // newer one.
  const stale = () => `${state.source}:${state.week}` !== key;

  if (state.source === 'demo') {
    const generate = await getDemoGenerator();
    if (stale()) return;
    if (!generate) {
      setStatus(
        'Demo roster data isn’t available yet (js/demo-rosters.js is missing). ' +
        'Switch to <strong>My ESPN league</strong> to see real rosters.',
        true
      );
      return;
    }
    state.data = generate(state.week);
  } else {
    setStatus(`Loading week ${state.week} rosters from ESPN…`);
    let loaded;
    try {
      loaded = await fetchWeekRosters(state.week);
    } catch (err) {
      if (stale()) return;
      await fallBackToDemo(err.message);
      return;
    }
    if (stale()) return;
    state.data = loaded;
  }

  cache.set(key, state.data);
  rememberSelectedWeek();
  render();
  setStatus(describeSource());
}

function setToggle(id, attr, value) {
  $(id)
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset[attr] === value));
}

async function useDemo() {
  state.source = 'demo';
  state.isDemo = true;
  state.weeks = Array.from({ length: DEMO_WEEKS }, (_, i) => i + 1);
  // The demo season really is over: `js/demo-rosters.js` hardcodes a result
  // against every one of its thirteen games. Kept honest here, and handled
  // deliberately in `playedWeeks()` — which is the ONE place that decides the
  // sample season should be replayed from the week picker instead.
  state.playedWeeks = state.weeks.slice();
  // WEEK 1, not the last week. This page prices the REST of the season, and the
  // rest of a sample season seen from week 13 is one week — which would make
  // the weekly measure, the drill-down and the combo section look broken in the
  // only mode a reader can try without a league connected.
  if (!state.weeks.includes(state.week)) state.week = 1;
  setToggle('sourceToggle', 'src', 'demo');
  renderWeekPicker();
  await loadWeek();
}

/** Every failed route into live mode ends here, so none of them can lie. */
async function fallBackToDemo(message) {
  await useDemo();
  setStatus(message, true);
}

async function useLive() {
  const saved = savedConfig();
  if (!saved) {
    await fallBackToDemo('No league connected yet. Set one up on the Connection page first.');
    return;
  }
  if (saved.teamId != null) state.espnTeamId = Number(saved.teamId);
  // Your real league opens on YOUR team. The remembered pick may be a demo
  // squad — demo ids count from 1 just as ESPN's do, so it survives the switch
  // looking valid — and every ESPN link built from it would then stage another
  // manager's players against a trade screen that shows your own roster.
  if (state.espnTeamId != null) state.myTeamId = state.espnTeamId;

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.source = 'live';
  state.isDemo = false;
  setToggle('sourceToggle', 'src', 'live');
  cache.clear();
  resetWeekly(); // another league's weeks are another league's weeks

  setStatus('Reading the league schedule…');
  let scheduleWeeks = [];
  try {
    const schedule = await fetchSchedule();
    scheduleWeeks = schedule.weeks || [];
    state.playedWeeks = [...new Set(schedule.games.filter((g) => g.played).map((g) => g.week))]
      .sort((a, b) => a - b);
  } catch {
    state.playedWeeks = [];
  }
  state.weeks = scheduleWeeks.length
    ? scheduleWeeks
    : Array.from({ length: NFL_WEEKS }, (_, i) => i + 1);

  // Not the last week offered: before the first kickoff nothing has been played
  // and "last" would be a week of a season that has not happened.
  const remembered = prefs.get('week', null);
  state.week = state.weeks.includes(remembered)
    ? remembered
    : state.playedWeeks.length
      ? state.playedWeeks[state.playedWeeks.length - 1]
      : state.weeks[0];

  renderWeekPicker();
  await loadWeek();
}

// --------------------------------------------------------------------- render

/**
 * Every panel, in one pass.
 *
 * ONE `clearRuns()` for the whole page, and everything that registers a card is
 * re-rendered after it. The Map behind those keys has no other way of shrinking
 * — the module cannot clear one container's worth — so a panel that repainted
 * on its own would leak a run per player per repaint, and a panel that did not
 * repaint after a clear would lose its cards silently.
 */
function paint() {
  clearRuns();
  // Same reason as clearRuns(): the offers behind the ESPN links are registered
  // by counter and the Map has no other way of shrinking, so a repaint that did
  // not clear them would grow one entry per offer for the life of the page.
  ESPN_OFFERS.clear();
  hideTip(); // it may be pointing at an element that is about to be replaced
  renderCost();
  renderDepth();
  renderFinder();
  renderDeal();
  renderCombo();
}

function render() {
  $('modeBadge').className = 'badge ' + (state.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = state.isDemo ? 'Demo' : 'Live';
  $('pageSub').textContent = state.isDemo
    ? 'Generated sample rosters so you can see the layout with a full league in it.'
    : `Your ESPN league · ${espn.getConfig().season} season`;

  // ESPN will not accept an illegal lineup, so the non-bench slots in use ARE
  // the league's configuration — no extra request, and no hand-written default
  // that would understate every squad by a starter if it guessed wrong.
  const teams = state.data ? state.data.teams : [];
  state.slots = slotsForLeague(teams.length ? slotCountsFromLineups(teams) : null);

  resolveTeam();
  renderTeamPicker();
  renderPartnerPicker();
  paint();
  runSearch();
}

/** Both panels are the same payload read two ways, so a control is a repaint. */
function repaint() {
  paint();
  runSearch();
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  // Only a deliberate click is remembered. If the code picked the source, the
  // reader has expressed no preference and shouldn't be pinned to the result.
  prefs.set('source', btn.dataset.src);
  setToggle('sourceToggle', 'src', btn.dataset.src);
  btn.dataset.src === 'demo' ? useDemo() : useLive();
});

$('kindToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-kind]');
  if (!btn || btn.dataset.kind === state.kind) return;
  state.kind = btn.dataset.kind;
  prefs.set('kind', state.kind);
  setToggle('kindToggle', 'kind', state.kind);
  // The shape is a SEARCH option, not a filter over the results: the finder
  // keeps one offer per man you could acquire, so a straight swap and a
  // two-for-one bringing in the same player compete for the same row and the
  // package with a spare body attached usually wins it. Filtering afterwards
  // would hand back the leftovers of a search that preferred something else.
  runSearch();
});

$('weekSelect').addEventListener('change', (e) => {
  state.week = Number(e.target.value);
  prefs.set('week', state.week);
  // The span moves with the week, so the memoised means are about a span that
  // no longer exists. The WEEKS themselves are kept — they cost requests, and a
  // week already bought is still that week's projections.
  weekly.means = new Map();
  loadWeek();
});

$('teamSelect').addEventListener('change', (e) => {
  state.myTeamId = Number(e.target.value);
  prefs.set('team', state.myTeamId);
  if (String(state.partner) === String(state.myTeamId)) state.partner = 'all';
  renderPartnerPicker();
  repaint(); // the depth map highlights your row; the finder searches from it
});

$('partnerSelect').addEventListener('change', (e) => {
  state.partner = e.target.value;
  // The only control on the page that is a true filter: narrowing to one
  // manager can never surface an offer the whole-league search did not find,
  // because every offer already belongs to exactly one partner. The combo
  // section deliberately ignores it — that question is about your whole slate.
  // The pop-up shuts: the row it was opened from may not be in the table any
  // more, and a dialog about a deal that is no longer listed is a loose end.
  state.deal = null;
  state.dealKey = null;
  paint();
});

$('measureSelect').addEventListener('change', (e) => {
  const want = MEASURES[e.target.value] ? e.target.value : 'typical';
  state.measure = want;
  prefs.set('measure', state.measure);
  weekly.means = new Map();
  // Choosing the weekly measure does NOT buy the weeks — the button above is
  // the only thing that spends. Until it is pressed the page falls back to the
  // typical week and the cost note says so; either way the finder is re-run,
  // because a repaint alone would relabel offers priced on the old measure
  // rather than recompute them.
  repaint();
});

$('loadWeeks').addEventListener('click', () => { loadWeekly(); });

/**
 * A click on an offer row — in either table — opens that deal in the modal.
 *
 * Registered BEFORE wireTips, so it has already run by the time the card's own
 * handler could stop anything — and it asks `clickIsPlayer` the same question
 * the card asks, so the two can never come to different answers about one
 * click. A link is left alone entirely: the player link has to navigate and the
 * ESPN link has to open.
 *
 * `stopPropagation` is NOT optional here. The document-level handler below
 * closes the modal on a click outside it, and without this the very click that
 * opened it would reach that handler a moment later and shut it again — the
 * same trap `js/player-card.js` documents for its sheet.
 */
function wireOfferClicks(el, rowsFor) {
  if (!el) return;
  el.addEventListener('click', (e) => {
    if (clickIsPlayer(e)) return;
    if (e.target.closest && e.target.closest('a')) return;
    // A row carries both attributes, and so does the combo's headline button —
    // which is not in a row at all, because the whole packing is not one of the
    // offers. One selector covers both rather than two handlers that could come
    // to different answers about one click.
    const host = e.target.closest ? e.target.closest('[data-i][data-key]') : null;
    if (!host) return;
    const offer = rowsFor()[Number(host.getAttribute('data-i'))];
    if (!offer) return;
    e.stopPropagation();
    openDeal(offer, host.getAttribute('data-key'));
  });
}

wireOfferClicks($('tradeTable'), () => state.rows);
// Delegated on the PANEL, not the table: the combo's tables are rebuilt from
// scratch on every repaint and there are two of them.
wireOfferClicks($('comboPanel'), () => state.comboRows);

// -------------------------------------------------- dismissing the modal
//
// Three ways, because a pop-up that can only be closed one way is a pop-up
// somebody gets stuck under — the same rule the player card's sheet follows,
// and the same three: its own button, Escape, and a click outside it.

$('dealClose').addEventListener('click', () => { closeDeal(); });

$('espnOutcomeClose').addEventListener('click', (e) => {
  // Not an outside click as far as the pop-up is concerned.
  e.stopPropagation();
  $('espnOutcome').hidden = true;
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !state.deal) return;
  // The player card is drawn OVER this modal and has an Escape handler of its
  // own. When it is open that press belongs to it — closing the thing behind
  // the thing you are reading is not what anybody meant by Escape. The card is
  // a <body> child with a known id, which is why this can be asked at all.
  const card = document.getElementById('tipCard');
  if (card && !card.hidden) return;
  closeDeal();
});

document.addEventListener('click', (e) => {
  if (!state.deal) return;
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;
  // Inside the card itself is not "outside": the modal is the frame, the card
  // is the thing. And the player card sits outside the modal in the DOM while
  // being visually on top of it, so a click on one of its buttons would
  // otherwise read as a click on the page behind.
  if (t.closest('.modal-card') || t.closest('#tipCard')) return;
  closeDeal();
});

/**
 * A plain left-click on an ESPN link stages the owner's side first.
 *
 * Every MODIFIED click is left entirely alone — ctrl/cmd/shift/alt/middle — so
 * open-in-new-tab and copy-link keep working and land on the plain deep link,
 * which is still a perfectly good link. It is a real `<a href>` for exactly
 * that reason, and this only intercepts the one gesture it can improve.
 *
 * Registered in the capture phase so it runs before the outside-click handler
 * above closes the modal out from under a link that lives inside it.
 */
document.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
  const link = e.target && e.target.closest ? e.target.closest('a.espn-open') : null;
  if (!link) return;

  const offer = ESPN_OFFERS.get(link.dataset.offer || '');
  const href = link.getAttribute('href');
  if (!offer || !href) return;   // nothing registered: let the plain link go

  e.preventDefault();
  openInEspn(offer, href);
}, true);

enableSort($('depthTable'));
enableSort($('tradeTable'));

// Every container that names a player gets the card. One call each, delegated,
// so rebuilding the markup inside them costs nothing.
wireTips($('depthTable'));
wireTips($('spareStrip'));
wireTips($('tradeTable'));
wireTips($('dealPanel'));
wireTips($('comboPanel'));

// ------------------------------------------------------------------- start up

const boot = savedConfig();
if (boot && boot.teamId != null) state.espnTeamId = Number(boot.teamId);

const rememberedTeam = prefs.get('team', null);
if (rememberedTeam !== null) state.myTeamId = rememberedTeam;

const rememberedWeek = prefs.get('week', null);
if (rememberedWeek !== null) state.week = rememberedWeek;

const rememberedMeasure = prefs.get('measure', null);
if (MEASURES[rememberedMeasure]) {
  state.measure = rememberedMeasure;
  $('measureSelect').value = state.measure;
}

const rememberedKind = prefs.get('kind', null);
if (rememberedKind === 'all' || PACKAGE_KINDS.includes(rememberedKind)) {
  state.kind = rememberedKind;
}
setToggle('kindToggle', 'kind', state.kind);

if (prefs.get('source') === 'live' && boot) useLive();
else useDemo();

// Go live on its own once the bar finishes its round trip. Only someone who has
// clicked "Demo data" on purpose is left where they are.
onConnection((conn) => {
  if (!conn) return;
  if (conn.teamId != null) state.espnTeamId = Number(conn.teamId);
  if (state.source !== 'live' && prefs.get('source') !== 'demo') useLive();
});
