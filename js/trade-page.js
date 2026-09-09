// The Trade page: a depth map, and a search for swaps that help both squads.
//
// Two panels, and they are the two halves of one question. The depth map says
// WHO to talk to — read down a column and find the manager whose sign is the
// opposite of yours. The finder says WHAT to offer him. Neither is much use
// without the other, which is why they share a page, a team picker and a
// measure rather than living on two.
//
// Everything here is a repaint. The page buys one week of rosters, exactly as
// the analysis page does, and both panels are that one payload read two ways —
// changing the measure, the package shape, the manager or your own team never
// costs a request. That matters because the site's whole cost model is one
// request per week with no bulk form, and a control that quietly spent one
// would be the most expensive kind of convenience.
//
// `js/trade.js` holds every decision worth arguing about and is pure. This file
// is wiring and markup.

import { fetchWeekRosters, fetchSchedule } from './season.js';
import { slotCountsFromLineups } from './projection.js';
import { enableSort, resort } from './sortable.js';
import { savedConfig, onConnection } from './connection.js';
import { scope } from './prefs.js';
import * as espn from './espn.js';
import {
  depthTable, findTrades, slotsForLeague, typicalWeek, weekProjection, PACKAGE_KINDS,
} from './trade.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('trade');

const DEMO_WEEKS = 13;
const NFL_WEEKS = 18; // only used when ESPN won't tell us its own schedule

const MEASURES = {
  typical: {
    fn: typicalWeek,
    label: 'a typical week',
    basis:
      'ESPN’s full-season projection divided by 17 games, which is the closest ' +
      'thing ESPN publishes to a rest-of-season value',
  },
  week: {
    fn: weekProjection,
    label: 'the selected week',
    basis: 'ESPN’s own projection for the week selected at the top of the page',
  },
};

const state = {
  source: 'demo',
  week: DEMO_WEEKS,
  weeks: [],
  playedWeeks: [],
  data: null,          // {week, teams:[...]} for the selected week
  slots: null,         // the league's starting slots, read off the lineups
  myTeamId: null,      // the squad the finder trades FROM
  espnTeamId: null,    // the reader's own team, when a live league says so
  isDemo: true,
  measure: 'typical',
  kind: 'all',         // which package shapes the finder searches
  partner: 'all',      // limit the results to one manager
  search: null,        // the last finder result
  searching: false,
};

const cache = new Map(); // `${source}:${week}` -> {week, teams}

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

// Child traversal rather than tBodies, matching sortable.js: it copes with a
// table that omits <tbody> and keeps this module testable off-browser.
function bodyOf(table) {
  return Array.from(table.children).find((c) => c.tagName === 'TBODY') || null;
}

// -------------------------------------------------------- player references
//
// The site's one contract, unchanged here: every name is a real <a href> to
// that man's row on the Players page, carrying ESPN's own playerId and the
// class `pref`. Never a click handler, never a name, never a row index. A
// second way of naming a player is exactly how the two halves drift apart, and
// `tests/link-check.mjs` follows the ids this page emits to prove they land.

function playerRef(p, inner) {
  if (p.playerId === null || p.playerId === undefined) return inner;
  return (
    `<a class="pref" href="waivers.html?player=${esc(p.playerId)}" ` +
    `title="${esc(p.name)} — open his next 13 weeks on the Players page">${inner}</a>`
  );
}

/** One man in a package: his name, his position, and what he is worth. */
function manLine(p, value) {
  const inner =
    `${esc(p.name)}<span class="pp">${esc(p.position)}</span>` +
    `<span class="val">${fmt(value)}</span>`;
  return `<span class="man">${playerRef(p, inner)}</span>`;
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
    $('depthNote').innerHTML = '';
    return;
  }

  const map = depthTable(teams, state.slots, MEASURES[state.measure].fn);
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

function renderDepthNote(map) {
  const measure = MEASURES[state.measure];
  const anyExhausted = map.positions.some((p) => {
    const r = map.replacement.get(p);
    return r && r.exhausted;
  });

  $('depthNote').innerHTML =
    `Every number is <strong>points above replacement</strong> — how much better this ` +
    `manager’s starters at that position are than the man anybody could have instead. ` +
    `<strong>Replacement</strong> is not a constant somebody typed in: it is the best player ` +
    `at that position who is <strong>not starting anywhere in the league</strong>, and the chips ` +
    `above show what that came out at, valued on ${esc(measure.label)} ` +
    `(${measure.basis}). ` +
    `<br>` +
    `A high number means depth worth trading from; a low one means a lineup spot going to ` +
    `waste. <strong>Read down a column</strong>, not across a row — the manager worth talking to ` +
    `is the one whose number is low where yours is high. ` +
    `<strong>spare</strong> beside a number is what that manager could send ` +
    `<em>without weakening his own lineup</em>, which is the part of his squad a trade can ` +
    `actually reach. ` +
    `The three deepest and three thinnest squads at each position are tinted; every cell ` +
    `prints its sign either way. ` +
    (anyExhausted
      ? `A <strong>*</strong> means every player at that position is already in somebody’s ` +
        `lineup, so there is no spare man in the league to set a bar with and the worst ` +
        `starter stands in for one. `
      : '') +
    `Nobody here can be claimed off the wire, so nothing on this page is a waiver ` +
    `suggestion — the <a href="waivers.html">Players</a> page answers that.`;
}

// ----------------------------------------------------------- the trade finder

function churnHtml(churn) {
  const line = (list, cls, word) =>
    list.length
      ? `<span class="${cls}">${word} ${list
          .map((s) => `<b>${esc(s.name)}</b> ${esc(s.position)} ${fmt(s.value)}`)
          .join(', ')}</span>`
      : '';

  const parts = [line(churn.in, 'in', 'starts:'), line(churn.out, 'out', 'drops out:')]
    .filter(Boolean);
  return parts.length ? `<div class="churn">${parts.join('<br>')}</div>` : '';
}

const SHAPE_LABEL = {
  even: 'Straight swap',
  consolidate: 'You consolidate',
  depth: 'You add depth',
};

function tradeRow(offer) {
  const send = offer.send.map((p) => manLine(p, p.projected)).join('');
  const receive = offer.receive.map((p) => manLine(p, p.projected)).join('');

  return (
    `<tr>` +
    `<td class="name">${esc(offer.partner.name)}</td>` +
    `<td class="left" data-v="${esc(offer.kind)}">` +
      `<span class="shape" title="${esc(offer.shape)} — you send ${plural(offer.send.length, 'player')}, ` +
      `you receive ${plural(offer.receive.length, 'player')}.">${esc(SHAPE_LABEL[offer.kind])}</span></td>` +
    `<td class="left pkg">${send}</td>` +
    `<td class="left pkg">${receive}${churnHtml(offer.yourChurn)}</td>` +
    `<td class="before-after" data-v="${offer.myAfter}">` +
      `${fmt(offer.myBefore)} → ${fmt(offer.myAfter)}</td>` +
    `<td class="gain pos" data-v="${offer.myGain}">${signedText(offer.myGain)}</td>` +
    `<td class="their-gain pos" data-v="${offer.theirGain}">${signedText(offer.theirGain)}</td>` +
    `</tr>`
  );
}

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
    body.innerHTML = '';
    $('tradeWrap').classList.add('hidden');
    empty.classList.remove('hidden');
    empty.innerHTML = '<span class="searching">Trying every swap in the league…</span>';
    renderFinderNote();
    return;
  }

  const offers = visibleOffers();
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
  const measure = MEASURES[state.measure];
  const offers = visibleOffers();
  const shown = offers.length;
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
    `deal can help both sides at once. Valued on ${esc(measure.label)} (${measure.basis}). ` +
    `<br>` +
    `<strong>You gain</strong> and <strong>He gains</strong> are points per week added to each ` +
    `best lineup. Currently searching ${kindNote}` +
    (state.partner === 'all' ? '' : ', with one manager') +
    `${shown ? ` · <strong>${plural(shown, 'offer')}</strong>` : ''}. ` +
    `A <strong>two-for-one</strong> forces the side receiving two to drop somebody, and that cut ` +
    `is modelled — his worst man goes — because it is what makes lopsided packages worse than ` +
    `they look. The side left a man short is <em>not</em> credited with a waiver claim to fill ` +
    `the gap, so those offers are understated rather than flattered. ` +
    `<br>` +
    `This is analysis, not a transaction. <strong>Nothing is sent to ESPN</strong> — propose the ` +
    `deal yourself, and send it with a line saying what it fixes for him, which is the part ` +
    `that gets offers accepted. Both managers are reading the same ESPN projections, so he can ` +
    `check every number here himself.`;
}

/**
 * Run the search, off the paint.
 *
 * A ten-team league is a few hundred thousand lineup fills and lands around a
 * quarter of a second — fast enough to feel instant if it does not block the
 * frame that says it is running, and a visible freeze if it does. Same
 * reasoning, and the same rAF-then-timeout shape, as the season simulation on
 * the schedule page.
 */
function runSearch() {
  const teams = state.data ? state.data.teams : [];
  if (!teams.length || state.myTeamId === null) {
    state.search = null;
    state.searching = false;
    renderFinder();
    return;
  }

  state.searching = true;
  state.search = null;
  renderFinder();

  const token = ++runSearch.token;
  const kinds = state.kind === 'all' ? PACKAGE_KINDS : [state.kind];

  const go = () => {
    if (token !== runSearch.token) return; // a newer search has started
    const result = findTrades({
      teams,
      myTeamId: state.myTeamId,
      slots: state.slots,
      measure: MEASURES[state.measure].fn,
      kinds,
    });
    if (token !== runSearch.token) return;
    state.search = result;
    state.searching = false;
    renderFinder();
  };

  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
  else setTimeout(go, 0);
}
runSearch.token = 0;

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
  state.playedWeeks = state.weeks.slice(); // the demo season is over by definition
  if (!state.weeks.includes(state.week)) state.week = DEMO_WEEKS;
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

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.source = 'live';
  state.isDemo = false;
  setToggle('sourceToggle', 'src', 'live');
  cache.clear();

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
  renderDepth();
  runSearch();
}

/** Both panels are the same payload read two ways, so a control is a repaint. */
function repaint() {
  renderDepth();
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
  // because every offer already belongs to exactly one partner.
  renderFinder();
});

$('measureSelect').addEventListener('change', (e) => {
  state.measure = MEASURES[e.target.value] ? e.target.value : 'typical';
  prefs.set('measure', state.measure);
  repaint();
});

enableSort($('depthTable'));
enableSort($('tradeTable'));

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
