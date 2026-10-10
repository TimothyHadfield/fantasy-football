// "WHO TO START, WEEK BY WEEK" — the one copy, drawn on two pages.
//
// Tim, 2026-10-09: "I want to start combining different aspects of the cite
// together so that usefull parts in one place will be shown in another place.
// The first thing I can think of that is like this is the who to start box
// above the available players section, specifically when a certain position is
// selected."
//
// So the box the Analysis page draws at its foot is drawn again on the Players
// page, above the free agents, narrowed to the position the wire is filtered
// to. It has to be the SAME box — same numbers, same colours, same marks — and
// the only way two pages keep agreeing about that is to share the code. This
// file is that code, MOVED out of js/analysis-page.js word for word: the week
// cells and their five ways of having no number, the played weeks ("Actual
// history"), the league-wide scales the colour is measured on, the player
// card on a name, and the depth chart itself.
//
// HOW A PAGE USES IT
//
//   configure({ state, valueOn, asValue, historyMode, sourceKey, glanceFor, nowSays,
//               currentOnly, historyBand, alignCols, lineBefore })
//                                             (the last four: the Players page only)
//       once, before the first paint. `state` is read LIVE on every call (the
//       page keeps mutating its own object, or hands over an object of getters):
//         seasonWeeks  Map week -> teams[] as js/season.js returns them
//         seasonFailed Set of weeks ESPN refused
//         weeks        the regular-season weeks laid out, in order
//         poWeeks      the playoff weeks laid out after them
//         playedWeeks  the weeks fully over
//         week         the week the page calls "now" (its column is bracketed)
//         data         { teams } — the squads as they stand in that week
//         isDemo, byes
//         startersPos  'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'DST' | 'K'
//       and the rest are the page's own answers: is it showing Value, what a
//       projection is worth, Actual or Proj for the played weeks, which league
//       the memos belong to, a man's glance line, and what a week heading's
//       card says of the "now" week.
//
//   const d = startersData(team);      the weeks, the rows, the best lineups
//   thead.innerHTML = startersHeadHtml(d);
//   tbody.innerHTML = startersBodyHtml(team, d);   (only when d.show)
//
// ONE PAGE PER DOCUMENT, so the configuration is this module's own and the
// functions below read it the way they read the page's `state` before they
// moved. That is what let them move unchanged — and unchanged is the point:
// the Analysis page's markup is byte for byte what it was.
//
// IT COSTS NOTHING. Nothing in here fetches; every number is one the page
// already holds.

import {
  weekRun, registerRun, tipAttr, clearRuns, zeroKind, byeWeekOf, outMark,
} from './player-card.js';
import { coarsePointer } from './connection.js';
import { optimalLineup } from './forecast.js';
import { heatScale, heatOf, heatMarkHtml, ordinal } from './heat.js';
import { statCard, clearPops, wirePops } from './pop.js';
import { weekHref } from './links.js';
import * as espn from './espn.js';
import { slotRows, fillSlots } from './lineup-slots.js';
import { bestFill, identified, slotsFromTeamLists } from './lineup-avg.js';
import { LIVE_TAG } from './actual-season-table.js';

// What the page handed over. See the block at the top of this file.
let state = null;
let valueOn = () => false;
let asValue = () => null;
let historyMode = () => 'actual';
let sourceKey = () => '';
let glanceFor = () => null;
let nowSays = '';
// THE PLAYERS PAGE'S DIFFERENCES (Tim, 2026-10-09 and -10), all off unless a
// page asks — the Analysis page passes none, so its box is what it was:
//   currentOnly        only the men on the roster NOW get a row. A man since
//                      dropped or traded has none, and the week he started in
//                      simply has no mark for it: the best lineups are still
//                      solved over each week's real squad, so nobody else's
//                      mark moves and no lineup is solved again without him.
//   historyBand false  no "Actual history" band row over the played weeks;
//                      the page draws that select itself, beside its heading.
//   alignCols          the box's columns are the Available table's, one over
//                      the other (Tim, 2026-10-10: "line up the appropriate
//                      collumns in the who to start chart with the actual
//                      available players chart"): Player · Pos · NFL · Avg ·
//                      Starts · the weeks. The depth tag moves INSIDE the
//                      Player cell, leading the name the way "Your WR7" does
//                      below it, and the Player column sorts by it; Starts
//                      sits over that table's Gain. Every header cell says
//                      which column it is (`data-col`), the same keys the
//                      Available table's header carries. Nothing is left out.
//   lineBefore         `(weeks, hist) => week | undefined`: the week the heavy
//                      line is drawn before. Without it the line follows the
//                      history — after a week in play. The Available table
//                      draws its own before the first week it prices, and the
//                      two are one line down the screen. Only the line moves:
//                      what a week's cells hold is decided as it always was.
let currentOnly = false;
let historyBand = true;
let alignCols = false;
let lineBefore = null;

/** Point the box at a page. Call it once, before anything here is drawn. */
export function configure(page) {
  state = page.state;
  valueOn = page.valueOn;
  asValue = page.asValue;
  historyMode = page.historyMode;
  sourceKey = page.sourceKey;
  glanceFor = page.glanceFor;
  nowSays = page.nowSays || '';
  currentOnly = page.currentOnly === true;
  historyBand = page.historyBand !== false;
  alignCols = page.alignCols === true;
  lineBefore = typeof page.lineBefore === 'function' ? page.lineBefore : null;
}

export const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export const round1 = (n) => Math.round(n * 10) / 10;

/** The words a heading's hover adds while the numbers under it are Value. */
export const valueWords = () => (valueOn() ? ' Shown as Value.' : '');

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Where a player reference goes, said the same way everywhere. */
export const OPENS = 'open his next 13 weeks on the Players page';

/**
 * Wrap `inner` in a link to this player's row on the Players page.
 *
 * `inner` is markup that is already escaped — the number, the name, the
 * position span beside a bench number — and the link never changes it, so
 * wrapping a cell cannot change what the cell reads.
 *
 * A player ESPN gave no id for is handed straight back unwrapped: a link to
 * `?player=undefined` is worse than no link at all, because it looks like it
 * would work.
 */
export function playerRef(p, inner, title, attr = 'title') {
  if (p.playerId === null || p.playerId === undefined) return inner;
  // `attr` is 'aria-label' wherever a tip card of our own is doing the talking:
  // a `title` there would have the browser draw a second tooltip on top of it.
  return (
    `<a class="pref" href="waivers.html?player=${esc(p.playerId)}" ${attr}="${esc(title)}">` +
    `${inner}</a>`
  );
}

export const GO_ATTR = 'data-go';

export const ROSTER_LINK = /^analysis\.html\?team=(\d+)(?:&week=(\d+))?#rosterDetail$/;

/**
 * A card as the attribute for a tag, '' when there is nothing to show.
 * `focusable` false for the dense week cells: 170 tab stops in one table is a
 * keyboard trap, and the same card is on the row's Avg and name.
 */
export function cardAttr(spec, prefix, focusable = true) {
  if (!spec) return '';
  const here = spec.href && ROSTER_LINK.test(spec.href) ? ` ${GO_ATTR}="${esc(spec.href)}"` : '';
  return statCard(spec, { prefix, focusable }) + here;
}

/** "2nd of 10" — where a number ranks in its group, counted from the top. */
export const placeOf = (h) => (h ? `${ordinal(h.rank)} of ${h.of}` : '');

/** An Avg cell's ONE plain line (Tim's plan: "Avg of N weeks · 2nd of 10"). */
export function avgLine(n, h) {
  const of = n > 0 ? `Avg of ${plural(n, 'week')}` : 'Avg of the weeks shown';
  return h ? `${of} · ${placeOf(h)}` : of;
}

/** How many regular-season numbers a row of week values holds. */
export const regularCount = (values, weeks) =>
  values.filter((v, i) => !isPlayoff(weeks[i]) && typeof v === 'number').length;

/**
 * A finished `<td …>` given a card: the attribute goes on, and the sentence its
 * `title` carried moves to an `aria-label` — a title beside a card is a second
 * tooltip on top of it, and the words are still what a screen reader reads.
 */
export function withCard(td, attr) {
  if (!attr) return td;
  // The attribute goes at the END of the opening tag: `withPo`, `withFut` and
  // `withHeat` all find a cell by its leading `<td class="`.
  return td
    .replace(/^(\s*<td[^>]*?) title="/, '$1 aria-label="')
    .replace(/^(\s*<td[^>]*)>/, (m, open) => `${open}${attr}>`);
}

/** "weeks 1–13" / "week 4" — an en dash, the way the rest of the site writes ranges. */
export function weekRange(weeks) {
  if (!weeks.length) return 'no weeks';
  if (weeks.length === 1) return `week ${weeks[0]}`;
  return `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;
}

/**
 * Three tiers, not two. His sheet colours IR darker than OUT because they mean
 * different things to a manager: OUT is one week to cover, IR is a roster spot
 * gone for a month. They used to share one red here.
 */
export function injuryTier(status) {
  if (status === 'INJURY_RESERVE') return 'ir';
  if (status === 'OUT' || status === 'SUSPENSION') return 'out';
  if (!status || status === 'ACTIVE' || status === 'NORMAL') return '';
  return 'q';
}

/** Every week a week-across view lays out: the regular season, then the playoffs. */
export function spanWeeks() {
  return [...state.weeks, ...state.poWeeks.filter((w) => !state.weeks.includes(w))];
}

export const isPlayoff = (w) => state.poWeeks.includes(w);

/** The mean of a row's REGULAR-SEASON numbers — playoff columns are shown, not averaged. */
export function regularAvg(values, weeks) {
  const real = values.filter((v, i) => !isPlayoff(weeks[i]) && typeof v === 'number');
  return real.length ? round1(real.reduce((a, b) => a + b, 0) / real.length) : null;
}

/** The first playoff week in a run of columns — the one the line goes before. */
export const firstPlayoffIn = (weeks) => weeks.find(isPlayoff);

/** `po-start` on a week cell, merged into the class it already carries. */
export function withPo(td, week, weeks) {
  if (week !== firstPlayoffIn(weeks)) return td;
  return td.replace(/^<td(?: class="([^"]*)")?/, (m, c) => `<td class="${c ? `${c} ` : ''}po-start"`);
}

/** A week's header cell; a playoff week says so in words, not by the line alone. */
export function weekHead(w, weeks, cls, title, tag = '') {
  const start = w === firstPlayoffIn(weeks);
  const classes = [cls, start ? 'po-start' : ''].filter(Boolean).join(' ');
  // `tag` rides beside the number: the LIVE badge on a week still being played.
  const label = isPlayoff(w)
    ? `${w}${tag}${start ? '<span class="po-tag" aria-hidden="true">PO</span>' : ''}` +
      '<span class="sr-only"> (playoffs)</span>'
    : `${w}${tag}`;
  const why = isPlayoff(w) ? `${title} A playoff week: shown, not counted in Avg.` : title;
  // THE WEEK'S HEADING IS A CARD, NOT A `title` (2026-10-08): it says the same
  // one line, and it is the connector to that week on Schedule. See
  // `weekHeadCard` for who clicks what.
  return `<th data-sort class="${classes}" ${WEEK_HEAD_ATTR}="${w}"${alignCols ? ` data-col="w${w}"` : ''} data-def="${esc(why)}">` +
    `${weekLink(w, label)}</th>`;
}

export const WEEK_HEAD_ATTR = 'data-wkh';

/** The week number as a link, with the rest of the heading's markup after it. */
export function weekLink(w, label) {
  const n = String(w);
  const rest = String(label).startsWith(n) ? String(label).slice(n.length) : null;
  const href = weekHref(w);
  if (rest === null || !href) return label;
  // NOT `a.pref`: that class means "a player's page" to js/player-card.js.
  return `<a class="wk-go" href="${esc(href)}" aria-label="Week ${n} on Schedule">${n}</a>${rest}`;
}

/** The card a week heading opens: built when asked for, from the heading itself. */
export function weekHeadCard(th) {
  const w = Number(th.getAttribute(WEEK_HEAD_ATTR));
  if (!Number.isFinite(w)) return null;
  return {
    title: `Week ${w}`,
    sub: isPlayoff(w) ? 'playoffs' : w === state.week ? nowSays : '',
    foot: th.getAttribute('data-def') || '',
    href: coarsePointer() ? weekHref(w) : null,
    hrefLabel: `Week ${w} matchups`,
  };
}

/** Week headings open their card on this table. Safe to call again. */
export function wireWeekHeads(table) {
  wirePops(table, { selector: `th[${WEEK_HEAD_ATTR}]`, card: weekHeadCard });
  // On a finger the number's link must not fire before the sheet opens; pop.js
  // prevents the tap's default, which is that link's navigation.
}

/**
 * One player's whole season, as the data the three-row chart is drawn from.
 *
 * It used to be lines of text in a native `title`, which was the right first
 * answer — no focus management, no z-index, no touch story — and Tim read it
 * and said it was hard to scan. He is right, and the fix is not a better
 * string: a native tooltip renders in the OS UI font, so "W1 12.5  W2 13.5"
 * cannot be padded into columns that line up. Week numbers over their own
 * projections needs real layout, so this returns structure and the card in
 * js/player-card.js draws it.
 */
export function seasonRunData(index, p, marks = null) {
  const weeks = spanWeeks();
  if (!index || !weeks.length) return null;

  return weekRun({
    // `marks` (optional): `{ starts, splitAfter, startsNote }` — the weeks he
    // makes the best lineup, bold on the card (rule 17: weeks to come only).
    ...(marks || {}),
    heading: state.isDemo
      ? `Sample projections for ${weekRange(weeks)}`
      : `ESPN’s projection for ${weekRange(weeks)}`,
    weeks,
    // The Proj row is the projection as it stood before kickoff: for a man who
    // has finished in a week still open, `pregame`, never his score twice.
    projections: weeks.map((w) => seasonField(index, w, p.playerId, 'pregame')),
    actuals: weeks.map((w) => seasonActual(index, w, p.playerId)),
    currentWeek: state.week,
    demo: state.isDemo,
    // Whether a 0.00 is his bye or a man ruled out — player-card.js decides.
    byeWeek: byeWeekOf(p, state.byes),
    injuryStatus: weeks.map((w) => seasonStatus(index, w, p)),
    playoffWeeks: state.poWeeks,
  });
}

/**
 * Register the card a man's NAME carries — the one the Roster detail table
 * builds: his identity line, his season week by week (Proj and Act rows) and
 * the glance line — and hand back the key for `tipAttr`. `prefix` is the
 * table's own (`clearRuns`).
 */
export function nameCard(p, index, teamId, prefix, marks = null) {
  const tier = injuryTier(p.injuryStatus);
  return registerRun({
    ident: `${p.name} · ${p.position} · ${p.proTeam}${tier ? ` · ${p.injuryStatus}` : ''}`,
    run: seasonRunData(index, p, marks),
    href: p.playerId === null || p.playerId === undefined
      ? null
      : `waivers.html?player=${encodeURIComponent(p.playerId)}`,
    id: `${prefix}:${teamId}:${p.playerId ?? `x:${p.name}`}`,
    glance: glanceFor(p),
    playerId: p.playerId,
  }, prefix);
}

/**
 * THE WEEKS HE STARTS, for the card his row's week cells open (Tim, 2026-10-08:
 * the classic player card "with start weeks marked"). `starters` is
 * `weeklyStarters` — the one solve "Who to start" marks its cells from — so the
 * bold week numbers on the card and the marked cells in that table are the
 * same answer. The card bolds weeks to come only (`splitAfter`, rule 17).
 */
export function startMarks(p, starters, hist, team) {
  const weeks = spanWeeks();
  const past = weeks.filter((w) => hist.has(w));
  return {
    starts: weeks.map((w) => (starters.has(w) ? starters.get(w).has(p.playerId) : null)),
    splitAfter: past.length ? past[past.length - 1] : null,
    startsNote: `weeks he makes ${team ? `${team.name}’s` : 'this team’s'} best lineup`,
  };
}

/** A week cell given its man's card: a click (or Enter) opens his Players row. */
export const withPlayerCard = (td, key) => withCard(td, tipAttr(key, { go: true }));

/** How a zero in this man's week reads: see `zeroKind` in js/player-card.js. */
export function zeroOf(v, week, p, status = p.injuryStatus) {
  return zeroKind(v, {
    week,
    byeWeek: byeWeekOf(p, state.byes),
    injuryStatus: status,
    demo: state.isDemo,
  });
}

/**
 * A man's week as the roster detail and the card print it: what he was
 * projected, and what he scored.
 *
 * In a week ESPN has not closed, js/season.js marks each man `done` or not. A
 * finished man's `projected` has been overwritten with his score, so his
 * projection is `pregame`; a man still to finish may carry a running score,
 * which is not a result and is left out. A week with no `done` on it (final,
 * demo, a stub) reads exactly as it always did.
 */
export function weekLine(p) {
  if (p.done === true) {
    return {
      proj: typeof p.pregame === 'number' ? p.pregame : null,
      actual: typeof p.actual === 'number' ? p.actual
        : typeof p.projected === 'number' ? p.projected : null,
    };
  }
  if (p.done === false) return { proj: p.projected, actual: null };
  return { proj: p.projected, actual: p.actual };
}

/**
 * week -> Map(playerId -> { projected, actual }) for one team.
 *
 * A week whose payload has no row for this team at all maps to null, so "the
 * league did not contain him that week" stays distinguishable from "the week
 * has not been read yet".
 *
 * BOTH numbers, from the one pass. `fetchWeekRosters` has always returned
 * `actual` beside `projected` and this page only ever read the projection; the
 * card's Act row is that second field, not a second fetch. Building one index
 * with both in it is also what keeps the two rows of the chart honest — they
 * cannot be about different weeks, or different men, because they came out of
 * the same entry.
 */
export function seasonIndex(teamId) {
  const byWeek = new Map();
  for (const [week, teams] of state.seasonWeeks) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) { byWeek.set(week, null); continue; }
    const byPlayer = new Map();
    for (const p of team.players) {
      const line = weekLine(p);
      byPlayer.set(p.playerId, {
        // What the grids price him at — for a man who has finished, his score.
        projected: typeof p.projected === 'number' ? p.projected : null,
        // The card's two rows: his pre-game projection, and a RESULT — never
        // the running score of a man still playing.
        pregame: typeof line.proj === 'number' ? line.proj : null,
        actual: typeof line.actual === 'number' ? line.actual : null,
        done: p.done === true,
        // That week's own status, so a zero is judged by who he was THEN.
        injuryStatus: p.injuryStatus || null,
      });
    }
    byWeek.set(week, byPlayer);
  }
  return byWeek;
}

/**
 * One field of one player's week, in five distinguishable states:
 *   'wait'    the week has not been read yet
 *   'failed'  ESPN refused that week for everybody
 *   'off'     he was not on this roster in that week
 *   null      ESPN carried no number for him that week
 *   number    the value itself
 *
 * The three string states are facts about the WEEK and the ROSTER rather than
 * about either number, so they are decided once here and both readers below
 * get the same answer. Splitting them would be two copies of the hardest part.
 */
export function seasonField(index, week, playerId, field) {
  const byPlayer = index.get(week);
  if (byPlayer === undefined) return state.seasonFailed.has(week) ? 'failed' : 'wait';
  if (byPlayer === null) return 'off';
  if (!byPlayer.has(playerId)) return 'off';
  return byPlayer.get(playerId)[field];
}

/** His projection for that week. 0 means his NFL team is on bye. */
export function seasonValue(index, week, playerId) {
  return seasonField(index, week, playerId, 'projected');
}

/**
 * What he ACTUALLY scored that week — null until the game has been played and
 * ESPN has a number for it, which is what makes the card's Act row blank for
 * every week still to come without this page having to consult a calendar.
 */
export function seasonActual(index, week, playerId) {
  return seasonField(index, week, playerId, 'actual');
}

/**
 * His injury status in that week's payload, falling back to the one on the
 * roster being shown. ESPN's is today's status in every week; the sample data
 * varies it week by week, and a ruled-out zero has to be read against its own.
 */
/** Has he finished that week's game while the week is still open? Then his number is a score. */
export function seasonDone(index, week, p) {
  const byPlayer = index ? index.get(week) : null;
  const e = byPlayer ? byPlayer.get(p.playerId) : null;
  return Boolean(e && e.done);
}

export function seasonStatus(index, week, p) {
  const byPlayer = index ? index.get(week) : null;
  const e = byPlayer ? byPlayer.get(p.playerId) : null;
  return (e && e.injuryStatus) || p.injuryStatus || null;
}

/**
 * The cell. No `data-v` at all — never data-v="" — for anything that is not a
 * number, so an unknown sinks to the bottom whichever way the column is sorted.
 *
 * `start` is the "Who to start" panel's marker and nothing else reads it: null
 * from the season grid above, which stays deliberately uncoloured, and
 * `{ slotId, flex }` from the panel at the foot when this man is in the best
 * legal lineup that week. It is threaded through here rather than given a cell
 * renderer of its own because the FIVE ways of having no number — not read yet,
 * ESPN refused the week, not on the roster, no number at all, and a bye — cost
 * real effort to tell apart and must not be reimplemented next door where the
 * two copies can drift.
 */
/** The "Who to start" mark's class and its sentence, for whichever cell carries it. */
export const startMark = (start) => (start ? ` st${start.flex ? ' fx' : ''}` : '');

export const startSays = (name, week, start) => (start
  ? ` ${name} is in the best legal lineup for week ${week}` +
    (start.flex ? ', in the FLEX.' : `, at ${espn.SLOT_LABELS[start.slotId] || ''}.`)
  : '');

export function seasonCell(v, week, p, isNow, start = null, status = p.injuryStatus, scored = false) {
  const name = p.name;
  const mark = startMark(start);
  const cls = (extra) => `wk${isNow ? ' now' : ''}${extra ? ` ${extra}` : ''}${mark}`;
  // A start is a fact about the lineup, so it is said on every cell that has
  // one — including a bye, which is exactly when a start is worth noticing.
  const says = esc(startSays(name, week, start));

  if (v === 'wait') {
    return `<td class="${cls('wait')}" title="Week ${week} has not been read from ESPN yet.">·</td>`;
  }
  if (v === 'failed') {
    return `<td class="${cls('muted')}" title="Week ${week} did not load — ESPN refused it, ` +
      `so this column is empty for everyone. Reload the page to try again.">—</td>`;
  }
  if (v === 'off') {
    return `<td class="${cls('off')}" title="${esc(name)} was not on this roster in week ${week}. ` +
      `ESPN returns each past week’s real roster, and today’s roster for weeks still to come.">—</td>`;
  }
  if (v === null) {
    return `<td class="${cls('muted')}" title="ESPN’s week ${week} roster carried no projection ` +
      `for ${esc(name)}.">—</td>`;
  }
  // ON VALUE a week to come draws what his projection is WORTH. A bye and a
  // zero keep their own cells below — a zero is worth 0.0 either way — and a
  // score is never converted.
  if (!scored && valueOn()) {
    const bye = v === 0 && zeroOf(v, week, p, status) === 'bye';
    const worth = bye ? 0 : asValue(p, round1(v));
    if (worth === null) {
      return `<td class="${cls('muted')}" title="ESPN projects ${fmt(v)} for ${esc(name)} in week ` +
        `${week}. ${esc(p.position)} has no waiver line, so he has no Value.${says}">—</td>`;
    }
    if (v !== 0) {
      return `<td class="${cls()}" data-v="${worth}" title="${esc(name)}’s Value in week ${week} is ` +
        `${fmt(worth)}: ESPN projects ${fmt(v)}.${says}">${fmt(worth)}</td>`;
    }
  }
  if (v === 0) {
    // A 0.00 is his bye only when the week IS his team's bye; otherwise it is a
    // real zero, and a ruled-out man's carries the word. Decided once, in
    // js/player-card.js. The sample data never means a bye by a zero.
    const zero = zeroOf(v, week, p, status);
    if (zero === 'bye') {
      return `<td class="${cls('bye')}" data-v="0" title="${esc(name)} is on bye in week ${week}. ` +
        `ESPN returns 0.00 for a bye, which is not the same as having no number at all.${says}">Bye</td>`;
    }
    const why = scored
      ? `${esc(name)} scored nothing in week ${week}.`
      : state.isDemo
      ? `The sample data has ${esc(name)} ruled out in week ${week}, so it projects nothing for him.`
      : `ESPN projects nothing for ${esc(name)} in week ${week}` +
        (byeWeekOf(p, state.byes) ? `, and it is not his bye (week ${byeWeekOf(p, state.byes)})` : '') +
        (zero === 'out' ? ` — he is listed ${esc(String(status).replace(/_/g, ' ').toLowerCase())}.` : '.');
    if (zero === 'out') {
      return `<td class="${cls('zero-out')}" data-v="0" title="${why}${says}">0.0 ` +
        `<span class="zmark">${esc(outMark(status))}</span></td>`;
    }
    return `<td class="${cls('zero')}" data-v="0" title="${why}${says}">0.0</td>`;
  }
  return `<td class="${cls()}" data-v="${v}" ` +
    `title="${scored
      ? `${esc(name)} scored ${fmt(v)} in week ${week}.`
      : `ESPN projects ${fmt(v)} for ${esc(name)} in week ${week}.`}${says}">${fmt(v)}</td>`;
}

/**
 * One team's best legal lineup in every week the cache holds.
 *
 * The single call site for `optimalLineup` over the season cache: the slot rows
 * here and the marks in "Who to start" below are the SAME answer read two ways,
 * and a second solve would be a second chance for them to disagree about who a
 * squad ought to be starting on the very same screen.
 *
 * @returns {Map<number, Array>} week -> the starters, each carrying its slotId
 */
export function weeklyLineups(teamId, slots) {
  const out = new Map();
  if (!slots || teamId === null || teamId === undefined) return out;
  for (const [week, teams] of state.seasonWeeks) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) continue;
    out.set(week, optimalLineup(identified(team.players), slots).starters);
  }
  return out;
}

export const avgOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Memoised against the league, the rows and how much of the season has landed. */
let seasonFills = { key: null, byWeek: new Map() };

/** The key every memo on this data shares. Floors are NOT in it — see below. */
export function fillsKey(rows, weeks) {
  return `${sourceKey()}|${rows.map((r) => r.key).join(',')}|` +
    `${[...state.seasonWeeks.keys()].sort((a, b) => a - b).join(',')}|${weeks.join(',')}`;
}

/** @returns {Map<number, Map<number, Map<string, {p:object, v:number}|null>>>} week -> team -> slots */
export function weeklyFills(rows, slots, weeks) {
  const key = fillsKey(rows, weeks);
  if (seasonFills.key === key) return seasonFills.byWeek;

  const byWeek = new Map();
  const shown = new Set(weeks);
  for (const [week, teams] of state.seasonWeeks) {
    if (!shown.has(week)) continue;
    const perTeam = new Map();
    for (const team of teams) {
      perTeam.set(team.id, bestFill(team.players, slots, rows));
    }
    byWeek.set(week, perTeam);
  }

  seasonFills = { key, byWeek };
  return byWeek;
}

/**
 * The weeks that have happened: every week the schedule has finished, and then
 * the one being played — the first week after them, once somebody in it has
 * finished (`done`, js/season.js). A run from the left, never a scattering.
 */
export function historyWeeks(weeks = spanWeeks()) {
  const played = new Set(state.playedWeeks);
  const out = new Set();
  for (const w of weeks) {
    if (played.has(w)) { out.add(w); continue; }
    const teams = state.seasonWeeks.get(w);
    if (teams && teams.some((t) => (t.players || []).some((p) => p.done === true))) out.add(w);
    break;
  }
  return out;
}

/** The first week still to come — the column the heavy line is drawn before. */
export function firstFuture(weeks, hist) {
  return hist.size ? weeks.find((w) => !hist.has(w)) : undefined;
}

/** Still being played: a starter somewhere in the league has not finished. */
export function weekLive(week) {
  const teams = state.seasonWeeks.get(week);
  return Boolean(teams && teams.some((t) =>
    (t.players || []).some((p) => p.started === true && p.done === false)));
}

/** Memoised like the fills: the league, the rows, what has landed, what is history. */
let realFills = { key: null, byWeek: new Map() };

/**
 * Every squad's REAL lineup in every history week, handed out to the slot rows.
 *
 * Each starter is a copy carrying the two numbers of `weekLine`: `projected`
 * his projection before kickoff, `actual` his RESULT (null while he is still
 * playing — a running score is not one). `fillSlots` ranks men sharing a slot
 * on that projection, so the row a man sits in is the same on Actual and Proj.
 *
 * @returns {Map<number, Map<number, {fill:Map, starters:Array}>>} week -> team
 */
export function realLineups(rows, weeks) {
  const hist = [...historyWeeks(weeks)];
  const key = `${fillsKey(rows, weeks)}|h${hist.join(',')}`;
  if (realFills.key === key) return realFills.byWeek;

  const byWeek = new Map();
  for (const w of hist) {
    const teams = state.seasonWeeks.get(w);
    if (!teams) continue;
    const perTeam = new Map();
    for (const team of teams) {
      const starters = (team.players || []).filter((p) => p.started === true).map((p) => {
        const line = weekLine(p);
        return {
          ...p,
          slotId: p.lineupSlotId,
          projected: typeof line.proj === 'number' ? line.proj : null,
          actual: typeof line.actual === 'number' ? line.actual : null,
        };
      });
      perTeam.set(team.id, { fill: fillSlots(starters, rows), starters });
    }
    byWeek.set(w, perTeam);
  }

  realFills = { key, byWeek };
  return byWeek;
}

/** A real starter's number on the chosen side, to the tenth; null when he has none. */
export function historyValue(p, mode) {
  const v = mode === 'proj' ? p.projected : p.actual;
  return typeof v === 'number' ? round1(v) : null;
}

/**
 * A week still being played, shown as scores, is a set of PART totals: not
 * coloured and not averaged, the same refusal the Stats week grid makes.
 */
export const partScores = (week, hist) => hist.has(week) && historyMode() === 'actual' && weekLive(week);

/**
 * The band above the history columns: "Actual history", with the word a select
 * (Actual | Proj). Null when nothing has happened yet. `tr.colgroup` is the
 * site's group band, and sortable.js reads only the LAST header row. `lead` is
 * how many columns come before the weeks (six in "Who to start").
 */
export function historyGroupRow(weeks, hist, says = null, lead = 2) {
  const n = weeks.filter((w) => hist.has(w)).length;
  if (!n) return '';
  const mode = historyMode();
  const opt = (v, text) => `<option value="${v}"${mode === v ? ' selected' : ''}>${text}</option>`;
  const why = says || (mode === 'proj'
    ? 'Weeks played or in play: what each team’s real starters were projected before kickoff.'
    : 'Weeks played or in play: what each team’s real starters scored.');
  return `<tr class="colgroup hist-row"><th colspan="${lead}"></th>` +
    `<th colspan="${n}" class="hist-group" title="${why}">` +
    `<select class="hist-pick" data-history aria-label="History shows">` +
    `${opt('actual', 'Actual')}${opt('proj', 'Proj')}</select> history</th>` +
    (weeks.length > n ? `<th colspan="${weeks.length - n}" class="fut-start"></th>` : '') +
    `</tr>`;
}

/** `fut-start` on the first future week's cell — the heavy line, as `withPo` does `po-start`. */
export function withFut(td, week, fut) {
  if (week !== fut) return td;
  return td.replace(/^<td(?: class="([^"]*)")?/, (m, c) => `<td class="${c ? `${c} ` : ''}fut-start"`);
}

/** Memoised against the league and how much of the season has landed. */
let leagueWeeks = { key: null, byWeek: new Map() };

/**
 * week -> playerId -> his week, WHICHEVER squad held him: `{ proj, actual,
 * done, teamId }`, the two numbers as `weekLine` reads them. A man's score is
 * his own, so a Player row finds it under any team in the league — and a week
 * nobody here held him has no entry, because the season read is rosters only.
 */
export function leagueIndex() {
  const key = `${sourceKey()}|${[...state.seasonWeeks.keys()].sort((a, b) => a - b).join(',')}`;
  if (leagueWeeks.key === key) return leagueWeeks.byWeek;
  const byWeek = new Map();
  for (const [week, teams] of state.seasonWeeks) {
    const byPlayer = new Map();
    for (const team of teams) {
      for (const p of team.players || []) {
        if (p.playerId === null || p.playerId === undefined) continue;
        const line = weekLine(p);
        byPlayer.set(p.playerId, {
          proj: typeof line.proj === 'number' ? line.proj : null,
          actual: typeof line.actual === 'number' ? line.actual : null,
          done: p.done,
          teamId: team.id,
        });
      }
    }
    byWeek.set(week, byPlayer);
  }
  leagueWeeks = { key, byWeek };
  return byWeek;
}

/** DEF, as "Who to start" prints a D/ST's position. */
export const posLabel = (p) => (p.position === 'DST' ? 'DEF' : p.position);

/**
 * THE PLAYER ROWS' SCALES (Tim, 2026-10-06: "colorize the boxes in the season
 * by week player version, just like the position version"). A man is measured
 * against the league's STARTERS AT HIS POSITION, never against another
 * position (js/heat.js §1):
 *
 *   week(w, pos)  a history week: that week's real starters at his position,
 *                 on the numbers shown. A week of part scores has none.
 *   ahead         a week to come: every best-lineup value at his position over
 *                 the weeks on screen — the Position rows' own pool
 *                 (`slotThresholds`), by position instead of by slot.
 *   avg           one number per squad: what its starters at that position
 *                 show on average over the regular season.
 */
export function playerScales(rows, slots, weeks, hist, real, mode) {
  const val = valueOn();
  const fills = weeklyFills(rows, slots, weeks);
  const add = (map, k, v) => {
    if (typeof v !== 'number') return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  };
  const ahead = new Map();
  const byWeek = new Map();
  const perTeam = new Map();
  const ofTeam = (id) => {
    if (!perTeam.has(id)) perTeam.set(id, new Map());
    return perTeam.get(id);
  };
  for (const w of weeks) {
    const regular = !isPlayoff(w);
    for (const [id, fill] of fills.get(w) || []) {
      for (const row of rows) {
        const e = fill.get(row.key);
        if (!e || !e.p || typeof e.v !== 'number') continue;
        // The number the cells draw: his Value while the page shows Value.
        const v = val ? asValue(e.p, e.v) : e.v;
        add(ahead, e.p.position, v);
        if (regular && !hist.has(w)) add(ofTeam(id), e.p.position, v);
      }
    }
    if (!hist.has(w) || partScores(w, hist)) continue;
    const here = new Map();
    for (const [id, got] of real.get(w) || []) {
      for (const s of got.starters) {
        const was = historyValue(s, mode);
        const v = val && mode === 'proj' ? asValue(s, was) : was;
        add(here, s.position, v);
        // On Value a score is in no Avg (`avgCounted`), so it is in no Avg scale.
        if (regular && !(val && mode === 'actual')) add(ofTeam(id), s.position, v);
      }
    }
    byWeek.set(w, here);
  }
  const scalesOf = (map) => new Map([...map].map(([pos, xs]) => [pos, heatScale(xs)]));
  const means = new Map();
  for (const byPos of perTeam.values()) {
    for (const [pos, xs] of byPos) add(means, pos, avgOf(xs));
  }
  const weekScales = new Map([...byWeek].map(([w, here]) => [w, scalesOf(here)]));
  return {
    ahead: scalesOf(ahead),
    avg: scalesOf(means),
    week: (w, pos) => (weekScales.has(w) ? weekScales.get(w).get(pos) || null : null),
  };
}

/** A finished cell with its place on a scale added: class, words, the mark. */
export function withHeat(td, heat) {
  if (!heat) return td;
  return td
    .replace(/^<td class="([^"]*)"/, (m, c) => `<td class="${c} ${heat.cls}"`)
    .replace(/ title="([^"]*)"/, (m, t) => ` title="${t} ${esc(heat.words)}"`)
    .replace(/<\/td>$/, `${heatMarkHtml(heat)}</td>`);
}

/**
 * What a man's week TO COME shows: his projection to the tenth — or, while the
 * page shows Value, what that projection is worth. A bye shows no number.
 * `plain` is the projection whatever the page shows.
 */
export function aheadShown(p, v, week, index, plain = false) {
  if (typeof v !== 'number') return null;
  if (v === 0 && zeroOf(v, week, p, seasonStatus(index, week, p)) === 'bye') return null;
  return valueOn() && !plain ? asValue(p, round1(v)) : round1(v);
}

/**
 * THE NUMBERS A MAN'S AVG COUNTS: the ones his row shows — except that on Value
 * a score under "Actual history" is not a Value, and a mean of the two would be
 * a number about nothing. There Avg is the mean of his Value cells.
 */
export function avgCounted(shown, weeks, hist) {
  return valueOn() && historyMode() === 'actual'
    ? shown.map((v, i) => (hist.has(weeks[i]) ? null : v))
    : shown;
}

/** The number a Player row's history cell shows, or null when it shows none. */
export function playerHistoryValue(p, week, mode, plain = false) {
  const byPlayer = state.seasonWeeks.has(week) ? leagueIndex().get(week) : null;
  const e = byPlayer ? byPlayer.get(p.playerId) : null;
  const v = e ? (mode === 'proj' ? e.proj : e.actual) : null;
  if (typeof v !== 'number') return null;
  const bye = byeWeekOf(p, state.byes);
  if (v === 0 && bye !== null && Number(bye) === Number(week)) return null;
  // On Value his projection before kickoff is shown as what it was worth; a
  // score stays the score. `plain` is the number whatever the page shows.
  return valueOn() && mode === 'proj' && !plain ? asValue(p, round1(v)) : round1(v);
}

export const PLAYER_AVG_HEAD = 'The mean of the regular-season numbers shown; a bye is left out.';

/**
 * The week headers of a table whose rows are MEN — the Player view here and
 * "Who to start" below: the heavy line, LIVE, and what a history week holds.
 * `ahead` words a week still to come.
 */
export function playerWeekHeads(weeks, hist, fut, proj, ahead = (w) => `Each player’s projection for week ${w}.`) {
  return weeks
    .map((w) => {
      const failed = state.seasonFailed.has(w);
      const cls = ['wk', w === state.week ? 'now' : '', failed ? 'muted' : '',
        w === fut ? 'fut-start' : '']
        .filter(Boolean).join(' ');
      const title = failed
        ? `Week ${w} did not load — ESPN refused it. Reload the page to try again.`
        : hist.has(w)
          ? `Week ${w}: ` + (proj ? `what each player was projected before kickoff.${valueWords()}` : 'what each player scored.')
          : ahead(w) + valueWords();
      return weekHead(w, weeks, cls, title, hist.has(w) && weekLive(w) ? LIVE_TAG : '');
    })
    .join('');
}

/** What the "Actual history" label says on a hover when the rows are men. */
export const playerHistorySays = (proj) => (proj
  ? 'Weeks played or in play: what each player was projected before kickoff.'
  : 'Weeks played or in play: what each player scored.');

/**
 * One man's week IN HISTORY: what he scored — started or not, on whichever
 * squad held him — or on Proj what he was projected before kickoff. A man
 * still playing has no score yet, as in `historyCell`. `start` is "Who to
 * start"'s mark, as in `seasonCell`; the Player rows pass none.
 */
export function playerHistoryCell(p, week, mode, teamId, start = null) {
  if (!state.seasonWeeks.has(week)) {
    return seasonCell(state.seasonFailed.has(week) ? 'failed' : 'wait', week, p, week === state.week, start);
  }
  const cls = (extra) => `wk hist${week === state.week ? ' now' : ''}${extra ? ` ${extra}` : ''}${startMark(start)}`;
  const says = startSays(p.name, week, start);
  const e = leagueIndex().get(week).get(p.playerId);
  if (!e) {
    return `<td class="${cls('off')}" title="${esc(p.name)} was on no roster in this league in ` +
      `week ${week}, so the season read has no number for him.">—</td>`;
  }
  const v = mode === 'proj' ? e.proj : e.actual;
  const bye = byeWeekOf(p, state.byes);
  const onBye = bye !== null && Number(bye) === Number(week);
  if (typeof v !== 'number' || (v === 0 && onBye)) {
    if (onBye) {
      return `<td class="${cls('bye')}"${v === 0 ? ' data-v="0"' : ''} ` +
        `title="${esc(`${p.name} was on bye in week ${week}.${says}`)}">Bye</td>`;
    }
    const why = mode === 'proj'
      ? `No projection was recorded for ${p.name} in week ${week}.`
      : e.done === false
        ? `${p.name} has not finished week ${week} yet.`
        : `No score was recorded for ${p.name} in week ${week}.`;
    return `<td class="${cls('muted')}" title="${esc(why + says)}">—</td>`;
  }
  const was = round1(v);
  // ON VALUE the Proj side shows what that projection was worth (`playerHistoryValue`).
  const val = valueOn() && mode === 'proj';
  const shown = val ? asValue(p, was) : was;
  if (shown === null) {
    return `<td class="${cls('muted')}" title="${esc(`${p.name} was projected ${fmt(was)} in week ` +
      `${week}. ${posLabel(p)} has no waiver line, so he has no Value.${says}`)}">—</td>`;
  }
  // BOTH NUMBERS IN THE WORDS (Tim, 2026-10-08): the cell draws one of them.
  const o = mode === 'proj' ? e.actual : e.proj;
  const other = typeof o === 'number' ? fmt(round1(o)) : null;
  const why = (mode === 'proj'
    ? `${p.name} was projected ${fmt(was)} before kickoff in week ${week}${val ? `, a Value of ${fmt(shown)}` : ''}` +
      `${other === null ? '' : `, and scored ${other}`}.`
    : `${p.name} scored ${fmt(shown)} in week ${week}${other === null ? '' : `, projected ${other}`}.`) +
    (e.teamId === teamId ? '' : ' He was on another team then.');
  return `<td class="${cls()}" data-v="${shown}" title="${esc(why + says)}">${fmt(shown)}</td>`;
}

/** QB, RB, WR, TE, DEF, K — and FLEX, which is a filter over three of them. */
export const STARTER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];

export const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];

/** ESPN's own slot ids that mean "the flex", as opposed to a position's own. */
export const FLEX_SLOTS = new Set([3, 5, 7, 23]);

/**
 * The league's starting slots, read off every lineup we hold.
 *
 * ESPN will not accept an illegal lineup, so the non-bench slots in use ARE the
 * configuration — no extra request, and no hand-written default that would
 * understate a three-receiver league by a whole starter if it guessed wrong.
 * Pooled across every week as well as every team, because a manager sitting one
 * slot empty in the week on screen must not shrink the league's shape.
 */
export function leagueSlots() {
  return slotsFromTeamLists([state.data && state.data.teams, ...state.seasonWeeks.values()]);
}

/**
 * Who this team should start in each week, and in which slot.
 *
 * `optimalLineup` is `js/forecast.js`'s, unchanged — the same function the
 * schedule page's forecast and the trade finder both use, so the three can
 * never disagree about who a squad ought to be starting. It fills the most
 * restrictive slots first, which is provably optimal because the eligibility
 * sets nest, and it reads `projected`, which in a week's payload IS that week's
 * projection.
 *
 * A man on bye comes back from ESPN at 0.00 and simply loses his place to
 * somebody better, which is what a manager would do — so byes need no handling
 * of their own here. That they need none is the entire feature: the mark moves
 * off him and onto whoever covers, and the panel shows you who.
 *
 * The reader's what-if swaps in the roster detail are deliberately NOT applied.
 * Those are one week's experiment; this answers what the numbers say across the
 * whole season, and folding an override into it would quietly make a hand-moved
 * lineup look like advice.
 *
 * @returns {Map<number, Map<number, number>>} week -> playerId -> slotId
 */
export function weeklyStarters(teamId, slots) {
  const out = new Map();
  // `weeklyLineups` is the single solve, shared with the "Season by week" panel
  // above: the slot rows there and the marks here are the same answer read two
  // ways, and a second call to optimalLineup would be a second chance for the
  // two panels on one screen to disagree about who ought to be starting.
  for (const [week, starters] of weeklyLineups(teamId, slots)) {
    out.set(week, new Map(starters.map((s) => [s.playerId, s.slotId])));
  }
  return out;
}

/** How many men at this position the panel had to leave out, in the shown weeks. */
export function unidentifiedCount(team, weeks) {
  const shown = new Set(weeks);
  let worst = 0;
  for (const [week, teams] of state.seasonWeeks) {
    if (!shown.has(week)) continue;
    const t = teams.find((x) => x.id === (team ? team.id : null));
    const n = ((t && t.players) || [])
      .filter((p) => (p.playerId === null || p.playerId === undefined) && inStarterPos(p)).length;
    worst = Math.max(worst, n);
  }
  const now = ((team && team.players) || [])
    .filter((p) => (p.playerId === null || p.playerId === undefined) && inStarterPos(p)).length;
  return Math.max(worst, now);
}

/** Does this man belong under the button currently pressed? */
export function inStarterPos(p) {
  return state.startersPos === 'FLEX'
    ? FLEX_ELIGIBLE.includes(p.position)
    : p.position === state.startersPos;
}

/**
 * Everyone who held this position for this team across the weeks on screen.
 *
 * THE UNION, and not the selected week's roster alone. That was the first
 * version and it was quietly wrong: rosters really do change week to week, so
 * a week whose lineup was filled by somebody since dropped had a starter with
 * no row — and the panel then showed a week where, apparently, nobody at the
 * position started at all. Autumn's week 7 in the sample data is exactly that
 * case: the second back is Kellan Wainwright, who is not on the week 4 roster
 * the page happened to be showing.
 *
 * A mark that cannot be seen is worse than no mark, because the reader counts
 * the shaded cells and concludes a lineup slot went empty. Same rule, and the
 * same reason, as the Taken table's membership on the Players page.
 *
 * The identity comes from the LATEST week he appears in, so a man who changed
 * NFL team mid-season reads as where he is now, and the selected week wins
 * outright when it has him.
 */
export function positionPool(team, weeks) {
  const byId = new Map();
  const shown = new Set(weeks);
  for (const [week, teams] of [...state.seasonWeeks].sort((a, b) => a[0] - b[0])) {
    if (!shown.has(week)) continue;
    const t = teams.find((x) => x.id === (team ? team.id : null));
    for (const p of (t && t.players) || []) {
      if (p.playerId === null || p.playerId === undefined) continue;
      byId.set(p.playerId, p);
    }
  }
  for (const p of (team && team.players) || []) {
    if (p.playerId === null || p.playerId === undefined) continue;
    byId.set(p.playerId, p);
  }
  return [...byId.values()].filter(inStarterPos);
}

/**
 * The rows: everyone who held the chosen position, deepest chart first.
 *
 * Ordered by their average over the weeks on screen, which is what "starter to
 * bench" means once you are looking at a whole season rather than one week —
 * ESPN's current slot only says where a manager has parked somebody today, and
 * this panel exists precisely to disagree with that when the numbers do.
 *
 * The rank is computed HERE, off the same averages the panel prints, so the
 * `RB2` beside a row always agrees with the Avg column next to it. Under FLEX
 * every man keeps his OWN position's rank — there is no such thing as a FLEX2,
 * because the rank says how deep this squad is at a position and the button
 * only decides which rows you can see.
 *
 * Only men on the roster in the SELECTED week are ranked. A depth chart is a
 * statement about the squad you have; someone dropped in week 3 is in the table
 * to explain week 3's lineup and is not this manager's RB2 today.
 *
 * AVG IS THE MEAN OF THE NUMBERS HIS ROW SHOWS (2026-10-06), as a Player row's
 * is on the sheet above (`playerRows`): what he scored — or on Proj was
 * projected — in a history week, his projection ahead, each to the tenth. A
 * cell with no number — "Bye", a dash — counts for nothing.
 */
export function starterRows(team, weeks, index, starters, hist = new Set()) {
  const onRosterNow = new Set(
    ((team && team.players) || []).map((p) => p.playerId)
  );
  const mode = historyMode();

  const rows = positionPool(team, weeks)
    .map((p) => {
      const values = weeks.map((w) => seasonValue(index, w, p.playerId));
      const shown = weeks.map((w, i) => (hist.has(w)
        ? playerHistoryValue(p, w, mode)
        : aheadShown(p, values[i], w, index)));
      // The same weeks in POINTS whatever the page shows: the Starts card's column.
      const points = weeks.map((w, i) => (hist.has(w)
        ? playerHistoryValue(p, w, mode, true)
        : aheadShown(p, values[i], w, index, true)));
      const counted = avgCounted(shown, weeks, hist);
      const startsIn = weeks.filter((w) => {
        const wk = starters.get(w);
        return wk && wk.has(p.playerId);
      });
      return {
        p,
        values,
        shown,
        points,
        counted,
        startsIn,
        held: onRosterNow.has(p.playerId),
        avg: regularAvg(counted, weeks),
        // Out of the weeks actually READ, never out of all of them: a squad
        // half-loaded would otherwise look like a squad half-benched. The
        // playoff weeks count here: Starts is the number of marked cells on
        // the row, and a playoff week is marked like any other. Only Avg is
        // kept to the regular season.
        starts: startsIn.length,
        decided: weeks.filter((w) => starters.has(w)).length,
      };
    })
    // A man off the roster earns his row by having FILLED a slot, and by
    // nothing else. That is the entire reason the pool is a union — to give
    // every shaded cell somewhere to sit — so a departed player who never
    // started has no mark to explain and is only clutter. Left in, the sample
    // league's running backs ran to fourteen rows, nine of them men Tim no
    // longer holds and seven of those never in a lineup at all.
    // `currentOnly` (the Players page): not even then — see `configure`.
    .filter((row) => row.held || (!currentOnly && row.starts > 0))
    .sort((a, b) => (b.avg ?? -Infinity) - (a.avg ?? -Infinity) || a.p.playerId - b.p.playerId);

  // Depth rank, per real position, over the men actually held right now.
  const seen = new Map();
  for (const row of rows) {
    const posIndex = STARTER_POSITIONS.indexOf(row.p.position);
    if (row.held) {
      const n = (seen.get(row.p.position) || 0) + 1;
      seen.set(row.p.position, n);
      row.depth = `${row.p.position === 'DST' ? 'DEF' : row.p.position}${n}`;
      row.depthValue = posIndex * 100 + n;
    } else {
      row.depth = '—';
      // Nulls-last INSIDE the position group, which is the only place it can
      // go: his position is known and only his rank is absent. Dropping the
      // data-v instead would let sortable.js fall back to the cell text, and
      // "—" would lead the column. Same trick, and the same trap, as the Taken
      // table's unranked players.
      row.depthValue = posIndex * 100 + 99;
    }
  }
  return rows;
}

// ------------------------------------------------------ the box, in three parts
//
// What `renderStarters` on the Analysis page did between its two DOM writes,
// cut where the writes were: the numbers, the header row, the body rows. The
// page still decides where they go, what the heading says and what is written
// underneath.

/**
 * Everything the box is drawn from, for one team at `state.startersPos`.
 * `show` is false when there is nothing to lay out (no team, no weeks, nobody
 * at the position) — the page then says why instead.
 */
export function startersData(team) {
  const weeks = spanWeeks();
  const label = state.startersPos === 'DST' ? 'DEF' : state.startersPos;
  const hist = historyWeeks(weeks);
  const fut = lineBefore ? lineBefore(weeks, hist) : firstFuture(weeks, hist);
  const mode = historyMode();
  const slots = leagueSlots();
  const index = team ? seasonIndex(team.id) : new Map();
  const starters = team ? weeklyStarters(team.id, slots) : new Map();
  const rows = starterRows(team, weeks, index, starters, hist);
  return {
    weeks, label, hist, fut, mode, slots, index, starters, rows,
    show: rows.length > 0 && weeks.length > 0,
  };
}

/**
 * HISTORY HERE TOO (2026-10-06): the played weeks sit under the sheet's own
 * "Actual history" label and select, before the same heavy line — one choice
 * for the three tables — and show what each man scored (`playerHistoryCell`).
 * The shading still answers the panel's question: the best legal lineup.
 */
export function startersHeadHtml({ weeks, hist, fut }) {
  const proj = historyMode() === 'proj';
  const cols = playerWeekHeads(weeks, hist, fut, proj,
    (w) => `ESPN’s projected points for week ${w}, and whether he starts.`);

  // The Players page's columns (`alignCols`): the Available table's, in its
  // order. Depth's sentence rides on Player, whose cell now leads with the tag.
  if (alignCols) {
    return `${historyBand ? historyGroupRow(weeks, hist, playerHistorySays(proj), 5) : ''}<tr>
       <th class="name" data-sort data-col="player" title="Everyone who held this position for this team in the weeks shown. How deep he is at his own position on this squad, by the Avg beside it.">Player</th>
       <th class="left" data-sort data-col="pos" title="His position.">Pos</th>
       <th class="left" data-sort data-col="team" title="His NFL team.">NFL</th>
       <th class="grouped" data-sort data-col="avg" title="${PLAYER_AVG_HEAD}">Avg</th>
       <th data-sort data-col="extra" title="How many of the weeks read he is in the best legal lineup for, playoff weeks included.">Starts</th>
       ${cols}
     </tr>`;
  }

  return `${historyBand ? historyGroupRow(weeks, hist, playerHistorySays(proj), 6) : ''}<tr>
       <th class="left" data-sort title="How deep he is at his own position on this squad, by the Avg beside it.">Depth</th>
       <th class="name" data-sort title="Everyone who held this position for this team in the weeks shown.">Player</th>
       <th class="left" data-sort title="His position.">Pos</th>
       <th class="left" data-sort title="His NFL team.">NFL</th>
       <th class="grouped" data-sort title="${PLAYER_AVG_HEAD}">Avg</th>
       <th data-sort title="How many of the weeks read he is in the best legal lineup for, playoff weeks included.">Starts</th>
       ${cols}
     </tr>`;
}

/** The rows. Registers this table's cards, so the old ones are dropped first. */
export function startersBodyHtml(team, { weeks, hist, fut, mode, slots, index, starters, rows }) {
  // Only this table's cards: the other tables register their own.
  clearRuns('w');
  clearPops('ws');
  // THE COLOUR (Tim, 2026-10-08): each number against the league's starters at
  // his position — the same week in a week played, the weeks to come pooled
  // ahead. It is `playerScales`, the scale the sheet's Player rows use, so one
  // man's week is one colour in both tables. The best-lineup mark sits on top.
  const slotRowsNow = slots ? slotRows(slots) : [];
  const scales = slotRowsNow.length
    ? playerScales(slotRowsNow, slots, weeks, hist, realLineups(slotRowsNow, weeks), mode)
    : null;
  return rows
    .map((row) => {
      const p = row.p;
      const pos = posLabel(p);
      const heatAt = (w, i) => (!scales ? null : hist.has(w)
        ? heatOf(row.shown[i], scales.week(w, p.position), { what: `a starting ${pos} around the league in week ${w}` })
        : heatOf(row.shown[i], scales.ahead.get(p.position), { what: `a starting ${pos} across the league` }));
      // THE SAME CARD AS THE ROSTER DETAIL (Tim, 2026-10-08): his projection
      // and his score, week by week, on the name AND on every week cell, with
      // the weeks he starts in bold. The card is the name's words now, so `who`
      // moves to the link's aria-label — no title beside a card.
      const card = nameCard(p, index, team.id, 'w', startMarks(p, starters, hist, team));
      const cells = row.values
        .map((v, i) => {
          const week = weeks[i];
          const slotId = starters.has(week) ? starters.get(week).get(p.playerId) : undefined;
          const start =
            slotId === undefined ? null : { slotId, flex: FLEX_SLOTS.has(slotId) };
          // A history week is what he scored, on whichever squad held him —
          // the very cell his Player row has on the sheet above.
          const td = withHeat(hist.has(week)
            ? playerHistoryCell(p, week, mode, team.id, start)
            : seasonCell(v, week, p, week === state.week, start, seasonStatus(index, week, p),
              seasonDone(index, week, p)), heatAt(week, i));
          return withFut(withPo(state.seasonWeeks.has(week) ? withPlayerCard(td, card) : td,
            week, weeks), week, fut);
        })
        .join('');
      const ah = scales
        ? heatOf(row.avg, scales.avg.get(p.position), { what: `a squad’s starting ${pos}, on average` })
        : null;
      // STARTS, as the weeks it counts: which, in what slot, at what number.
      const startsCard = row.starts > 0 ? cardAttr({
        title: p.name,
        sub: 'Starts',
        head: ['Wk', 'Slot', 'Pts'],
        rows: row.startsIn.map((w) => {
          const slotId = starters.get(w).get(p.playerId);
          return {
            lead: w,
            label: FLEX_SLOTS.has(slotId) ? 'FLEX' : (espn.SLOT_LABELS[slotId] || ''),
            value: row.points[weeks.indexOf(w)],
          };
        }),
        total: { label: 'In the best lineup', value: `${row.starts} of ${plural(row.decided, 'week')}` },
      }, 'ws') : '';

      const cls = [row.starts === 0 ? 'never' : '', row.held ? '' : 'gone']
        .filter(Boolean).join(' ');
      const who = row.held
        ? `${p.name} · ${p.position === 'DST' ? 'DEF' : p.position} · ${p.proTeam}`
        : `${p.name} · ${p.position === 'DST' ? 'DEF' : p.position} · ${p.proTeam} — not on this ` +
          `roster in week ${state.week}. He is here because he filled a lineup spot in one of the ` +
          `weeks shown, and a marked week with no row to put it on would read as an empty slot.`;
      // On the Players page (`alignCols`) depth and name are ONE cell: the tag
      // leads the name, and the cell sorts by the tag.
      if (alignCols) {
        return `
      <tr class="${cls}">
        <td class="name" data-v="${row.depthValue}"${tipAttr(card)}><span class="nm-line">` +
        `<span class="depth-tag${row.held ? '' : ' muted'}">${esc(row.depth)}</span>${
          playerRef(p, esc(p.name), `${who}${row.held ? '.' : ''} Click to ${OPENS}.`, 'aria-label')}</span></td>
        <td class="left">${esc(p.position === 'DST' ? 'DEF' : p.position)}</td>
        <td class="left">${esc(p.proTeam)}</td>
        <td class="avg grouped${ah ? ` ${ah.cls}` : ''}"${row.avg === null ? '' : ` data-v="${row.avg}"`} ` +
        `title="${esc(avgLine(regularCount(row.counted, weeks), ah))}">${fmt(row.avg)}${heatMarkHtml(ah)}</td>
        <td class="starts" data-v="${row.starts}"${startsCard}>${row.starts}</td>
        ${cells}
      </tr>`;
      }
      return `
      <tr class="${cls}">
        <td class="left" data-v="${row.depthValue}"><span class="depth-tag${row.held ? '' : ' muted'}">${esc(row.depth)}</span></td>
        <td class="name"${tipAttr(card)}>${
          playerRef(p, esc(p.name), `${who}${row.held ? '.' : ''} Click to ${OPENS}.`, 'aria-label')}</td>
        <td class="left">${esc(p.position === 'DST' ? 'DEF' : p.position)}</td>
        <td class="left">${esc(p.proTeam)}</td>
        <td class="avg grouped${ah ? ` ${ah.cls}` : ''}"${row.avg === null ? '' : ` data-v="${row.avg}"`} ` +
        `title="${esc(avgLine(regularCount(row.counted, weeks), ah))}">${fmt(row.avg)}${heatMarkHtml(ah)}</td>
        <td class="starts" data-v="${row.starts}"${startsCard}>${row.starts}</td>
        ${cells}
      </tr>`;
    })
    .join('');
}
