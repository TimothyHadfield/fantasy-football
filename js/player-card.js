// The player card: one man's identity, and his whole season as a chart.
//
// ===========================================================================
// THE API, stated explicitly because more than one page codes against it.
// ===========================================================================
//
// Building a run (the data the chart is drawn from):
//
//   weekRun({ heading, weeks, projections, actuals, currentWeek, demo })
//       -> { heading, pending, cols, legend, notes, scale } | null
//     `weeks`       [1,2,3,…]   the week numbers, in order.
//     `projections` one entry per week, in the SAME order. Each is either a
//                   number, or one of the four no-number states this site
//                   tells apart by word AND by class:
//                     'wait'    that week has not been read from ESPN yet
//                     'failed'  ESPN refused that week for everybody
//                     'off'     he was not on this roster that week
//                     null      ESPN carried no number for him that week
//                   A number 0 is drawn "Bye" only when `week` is his NFL
//                   team's bye week (`byeWeek`); otherwise it is a real zero,
//                   and a ruled-out man's zero carries the word (OUT / IR).
//                   With `byeWeek` unknown a live 0 is a bye, as it always
//                   was; on demo data a zero is never a bye. See `zeroKind`.
//     `byeWeek`     his NFL team's bye week, or null — `byeWeekOf(p, byes)`.
//     `injuryStatus` ESPN's status, one string or one per week.
//     `actuals`     one entry per week, same order and same vocabulary. What
//                   he ACTUALLY scored. See "the Act row" below.
//     `currentWeek` the week the rest of the page is showing; it is bracketed.
//     `heading`     the sub-line under the identity, e.g. "ESPN's projection
//                   for weeks 1–13". Say whose numbers they are.
//     `playoffWeeks` the league's playoff weeks (`capture.playoffWeeks`), or [].
//                   The first of them that is in the run gets the heavy
//                   `po-start` line and a "PO" label, so the regular season and
//                   the bracket read apart on every wrapped line.
//     `starts`      null, or one entry per week PARALLEL TO `weeks`:
//                     true       he is in the best legal lineup that week
//                     false      he is not
//                     null/undef not known (that week is unread, or he was on
//                                nobody's roster)
//                   ABSENT ENTIRELY means the caller has no opinion and NOTHING
//                   is bolded — the card is then byte-for-byte what it was
//                   before this option existed, which is what keeps the
//                   Analysis page (which passes none of these) unmoved.
//     `splitAfter`  a week number, or null. A heavy divider is drawn BEFORE the
//                   first week AFTER this one, separating what has already
//                   happened from what is still to come.
//     `startsNote`  one short sentence for the key saying what bold means in
//                   THIS context, because it differs: "weeks he makes your best
//                   lineup" on a man you own, "weeks he would make your best
//                   lineup after this trade" on a man you are trading for.
//     `heat`        the red/green scale on the Proj row. DEFAULT ON — see "THE
//                   SCALE ON THE PROJ ROW" below for the argument, and pass
//                   `heat: false` to suppress it.
//   Returns null when there is nothing to draw, which the card handles.
//
//   Each entry of `cols` carries, besides the token it always did:
//     `start`       the caller's opinion for that week, unchanged (true/false/null)
//     `past`        the week is at or before `splitAfter`
//     `bold`        the RENDERED decision: `start === true` AND not `past`
//     `splitStart`  true on the first column after `splitAfter`
//     `heat`        `heatOf()` for that week's projection, or null
//   and the run carries `notes` (the plain-words lines about the chart) and
//   `scale` (the heat scale the Proj row was measured on, or null).
//
//   `notes` and `legend` ARE STILL RETURNED and are still what the card says —
//   but SINCE 2026-09-20 THE CARD DRAWS NONE OF THEM WHERE A SIGHTED READER CAN
//   SEE THEM. They go into one `sr-only` block instead. See "TIM TOOK THE WORDS
//   OFF THE CARD" below before restoring anything.
//
// Registering one, and getting the key that goes in the markup:
//
//   registerRun({ ident, run, href }, prefix) -> key       an opaque string
//   TIP_ATTR                                              'data-tip'
//   tipAttr(key)                                          ' data-tip="…"'
//   clearRuns()                       every registered run on the page is dead
//
//     `ident` is the identity line — name · position · NFL team · injury.
//     `href`  is the player click-through (waivers.html?player=<espnPlayerId>)
//             or null for a man ESPN gives no id for. It is only READ in the
//             sheet, where it becomes the button the tap preempted.
//
//     Put the key on the element the reader points at:
//         `<td class="…"${tipAttr(key)}>…</td>`
//     Any element carrying `data-tip` works; it does not have to be a <td>.
//
// Wiring a container, and the rest:
//
//   wireTips(element)     delegate hover / focus / tap on any container
//   hideTip()             close whatever is open (call before you rebuild)
//   clickIsPlayer(event)  did this click land on a player, or on the row
//                         around him? Ask this from any OTHER handler on the
//                         same element, so the two cannot disagree.
//
//   The page must also carry the `.tipcard` / `.tc-*` CSS. analysis.html has
//   it; a second page needs the same block.
//
// ===========================================================================
//
// WHY A CARD OF OUR OWN, and what each part of it pays for.
//
// Tim asked for the week run as a chart — week numbers along the top,
// projections underneath — and a native `title` cannot draw one. It renders in
// the OS UI font, where a space is narrower than a digit and "Bye" is nothing
// like either, so no amount of padding lines thirteen columns up. A real table
// does it exactly, and tabular figures keep every column the same width
// whatever is in it.
//
// What that costs, and how each part is paid:
//
//   - Clipping. The analysis grids live in `.table-scroll`, which is
//     `overflow:auto`, and a card inside one would be cut off at its edge. So
//     the card is a child of <body> and positioned `fixed`.
//   - Flicker. `pointer-events:none`, so the card can never be the thing the
//     mouse is over and cannot chase itself around the screen.
//   - Two tooltips. The cells that carry a key must carry NO `title` at all —
//     one beside the card would have the browser draw its own on top a moment
//     later. The link carries `aria-label` instead: same words, nothing drawn.
//   - Keyboard. Shown on focusin too, so tabbing the links reveals the same
//     thing hovering does. Escape closes it.
//
// The data is REGISTERED rather than written into the markup: thirteen weeks
// on 170 cells in each of two grids is tens of kilobytes of duplicated
// attribute for something that is read for two seconds.
//
// THE KEY IS A BARE COUNTER, NOT THE PLAYERID. It was the playerId once, and
// that quietly cost the hover to every man ESPN gives no id for. The card does
// not depend on the link and must not start to. A counter is unique by
// construction and needs nothing at all from the data.
//
// ON A PHONE THERE IS NO HOVER, and this is the one thing on the site that
// would simply cease to exist rather than merely look cramped: on the analysis
// grids every cell is a bare number, the card is the only place the man's NAME
// appears, and a tap on the cell followed the link straight off the page. So a
// touch screen gets the same card as a SHEET — the tap opens it instead of
// navigating, and the navigation it replaced becomes a button inside it, which
// is strictly more than the hover offers.
//
// The two modes differ in three ways and share everything else:
//
//   hover:  floats under the cell, `pointer-events: none`, closes on mouseout.
//   sheet:  pinned to the bottom of the window, interactive, closes on Escape,
//           on its own Close, or on a tap anywhere outside it.
//
// The mode is decided per event by `coarsePointer()` rather than once at load,
// so a tablet with a keyboard attached mid-session gets the right one, and a
// desktop window narrowed to a phone's width keeps its hover card — that is
// about width, and this is about whether there is a pointer at all.
//
// ===========================================================================
// THE WEEKS HE STARTS, AND THE LINE UNDER WHAT HAS ALREADY HAPPENED
// ===========================================================================
//
// Tim, 2026-09-19, in his words: "if you are hovering over a player you
// currently own, then bold all the week #s that that player is currently
// projected to start for you (and stop bolding the current week, however put a
// line after the last week and current week to seperate what's already
// happened). If you're hovering over another user's player (that you're trading
// for), then bold all the week #s that that player would start for you IF the
// trade would be made."
//
// WHO STARTS IS NOT DECIDED HERE. It cannot be: "would he start for you after
// this trade" is a question about two rosters and a lineup solver, and this
// module has neither. The caller computes it (`js/trade-page.js`, off the same
// `optimalLineup` "Who to start" runs) and hands it in as `starts`, parallel to
// `weeks`. What IS decided here is the one rule that must hold for EVERY
// caller:
//
//   BOLD IS FOR FUTURE WEEKS ONLY. A week at or before `splitAfter` is never
//   bold whatever `starts` says. Bolding a week already played would be a
//   forecast about the past — the lineup that week is a fact, not a projection,
//   and ESPN has already settled it. `start` keeps the caller's opinion
//   untouched so nothing is lost; `bold` is the rendered decision, and the two
//   being separate fields is what makes the rule falsifiable in a test.
//
// The divider uses the SAME mechanism `poStart` already does — a class on that
// column in all THREE rows, drawn as a heavy LEFT border — and that is not a
// stylistic echo. The run WRAPS onto balanced lines (`chartLines`), so a
// right-hand border on the last column of a line is invisible: it is drawn at
// the edge of a line that has nothing after it. A left border on the first
// column of the next group is visible wherever the wrap happens to fall. A
// column can be both `splitStart` and `poStart` — both set the same
// `border-left` to the same value, so it draws once, and the "PO" tag is what
// tells the two lines apart when they do not coincide.
//
// NEVER WEIGHT ALONE, EITHER. A bold week number also carries an accent
// underline (a cue that survives a reader who cannot see weight), an `sr-only`
// word so a screen reader hears "week 9, he starts" against "week 10, not in
// your lineup", and a plain-words line under the chart carrying `startsNote`.
//
// ===========================================================================
// THE SCALE ON THE PROJ ROW, AND THE WEIGHT CHANNEL IT COLLIDES WITH
// ===========================================================================
//
// Tim, same day: "the coloring is good right now but it needs to be added to
// all the other places a number is reffered to across the whole cite. For
// example trade views, 14 week previews, etc." This card IS the 14-week
// preview, so the Proj row takes `js/heat.js`.
//
// THE COMPARISON GROUP IS THIS MAN'S OWN WEEKS, and it has to be said out loud
// because it is a different group from every other use of the scale on the
// site. Everywhere else the group is one slot or one column ACROSS THE LEAGUE;
// here it is one man across his own season, which answers "is this a good week
// for him" rather than "is he a good WR2". It is still legitimate under HANDOFF
// rule 14 — it is never one position measured against another, which is the
// thing that rule forbids — but a reader who assumed the league-wide meaning
// would read a green week as "good in the league", so `heatOf(..., { what })`
// names the group and the key line under the chart says it in full.
//
// ONLY REAL NUMBERS ARE ON THE SCALE, and the test is `kind === 'num'` rather
// than `typeof v === 'number'`. That is deliberate: `projToken` is the one
// place this site decides what a value means, so the four no-number states
// ('wait', 'failed', 'off', null), a bye's 0.00 and a ruled-out man's 0.00 are
// excluded by construction and cannot drift apart from the rest of the site.
// Feeding a bye in would drag his mean down and paint the bye red for being a
// bye, which is a verdict on a week he was never going to play.
//
// A GENUINE PLAYED 0.0 IS A VALUE, and that is the one case worth arguing. It
// arrives here as `kind === 'num'` — `zeroKind` has already ruled out the bye
// and the OUT/IR zero — so it is ESPN projecting nothing for a man who is
// available. It is a real number about a real week, it is the worst week on the
// row, and it is exactly the cell a manager most needs to see. Dropping it
// would flatter him by hiding his worst week and would make the printed average
// disagree with the row it sits under.
//
// THE WEIGHT CHANNEL. `js/heat.js` steps the FONT WEIGHT with the step, and
// bold is also a font weight — two meanings on one channel is what HANDOFF
// forbids. The Week row and the Proj row are different rows, so they could have
// coexisted; they deliberately do not, for two reasons:
//
//   1. They sit one line apart in a table 34px wide. "This week number is
//      heavy" and "this projection is heavy" are two different claims a
//      centimetre apart, and a reader would have to remember which row meant
//      which. Weight on this card means ONE thing: he starts.
//   2. A heavier "18.2" is a WIDER "18.2". The card's line width is computed
//      from `CHART.col` (a constant) rather than measured, because a test
//      harness has no layout — so a cell that outgrew the constant would wrap
//      onto a line the arithmetic promised would fit, and the card has no
//      scroller left to hide it in. Week numbers cannot do this (one or two
//      digits at 10.5px are far inside the 34px floor, so the Week row never
//      drives a column's width), but a four-character projection can.
//
// So `css/app.css` turns the scale's weight ladder OFF inside `.tc-run`, and
// the scale keeps its other three channels: the background tint (which is what
// it is for), the ▲/▼ at the ends, and words. What it loses is a hue-free
// reading of MAGNITUDE in the middle steps; what it keeps is a hue-free reading
// of DIRECTION at the ends, which is the claim a reader of one man's season
// actually wants.
//
// AND THE ▲/▼ CANNOT BE A `<span>` HERE, for two reasons that both matter. It
// would add width to a column whose width is a constant (above), and it would
// put a glyph inside the cell's TEXT — and the cell's text is the projection,
// read back as such by three suites and by anyone checking a number against
// ESPN. `css/app.css` draws it as a `::after` block under the number, the same
// shape `.tc-mk` and `.tc-po` already use to say something extra without
// widening a column.
//
// A `title` IS NOT AVAILABLE, and that is not a preference: a `title` on these
// cells would have the browser draw its own tooltip on top of the card a moment
// later, which is why the cells carry none and why the link carries an
// `aria-label` instead. So the scale's words go to an `aria-label` on the cell
// (no second tooltip, and a screen reader gets the whole sentence) — and, until
// 2026-09-20, to a key line under the chart as well. That key line is gone; see
// the next section, which is the one to read before putting it back.
//
// ===========================================================================
// TIM TOOK THE WORDS OFF THE CARD (2026-09-20). READ THIS BEFORE RESTORING ANY
// OF THEM — INCLUDING AS AN ACCESSIBILITY FIX.
// ===========================================================================
//
// His ask, in his words: "Also in the preview, I want all the words beneath the
// chart to dissapear-they're not needed."
//
// "The preview" is this card, and "the words beneath the chart" were four
// blocks, in this order: the blank-Act note, the PO note, `run.notes` (what
// bold means, where the heavy line falls, and the colour key), and `run.legend`
// (the glossary of marks — Bye, off, the unread dot, the failed dash). At 1500px
// they were 164 of the hover card's 314 pixels; on a 390px phone they were 253
// of the sheet's 562. More than half the card was prose about the card.
//
// This is the same instinct he showed on 2026-09-18 when he took the card off
// "Season by week" — "Just put the name of that player somewhere outside of the
// chart, and their season proj, and current avg. That's it." He reads this card
// at a glance, in the two seconds a pointer rests on a cell, and every one of
// those sentences was in the way of the thing he opened it for.
//
// WHAT WENT IS THE VISIBLE PROSE. WHAT DID NOT GO IS THE MEANING. Every one of
// those sentences is still built — by the same pure, tested functions in
// `weekRun` — and still in the markup, inside ONE `sr-only` block that costs
// zero visible height (`.tc-key`, styled in css/app.css). A screen-reader user
// hears exactly what they heard yesterday, in the same order, after the chart
// rather than never. Deleting the sentences outright would have been cheaper to
// write and would have taken the explanation away from the one reader who has
// no colour, no weight and no underline to fall back on.
//
// A `title` IS STILL NOT THE ESCAPE HATCH. The rule above stands: a `title`
// anywhere in this card has the browser draw a second tooltip over it. Only
// `aria-label` and `sr-only` draw nothing, which is why they are what this uses.
//
// WHAT IT COSTS, SAID PLAINLY, BECAUSE IT IS A REAL COST:
//
//   A SIGHTED READER WHO CANNOT SEPARATE RED FROM GREEN HAS NO KEY ON THIS
//   CARD ANY MORE. For BOLD (rule 17, "he starts") nothing is lost that matters
//   — bold is also an accent underline, and both are hue-free. For the SCALE it
//   is narrower than that: the weight ladder is deliberately off inside this
//   card (see the section above), so the only hue-free cue left to a sighted
//   reader is the ▲ / ▼ drawn at the two ENDS of the scale. He can still see
//   which week is his best and which is his worst without telling the hues
//   apart; he can no longer read the middle four steps, and he can no longer
//   check a colour against a threshold in points, because the sentence that
//   printed those thresholds is now sr-only.
//
// So the claim still does not rest on colour ALONE — direction survives at the
// ends, and the numbers themselves are printed in every cell — but the fourth
// channel HANDOFF rule 14 names, words in a key, is gone from THIS surface.
// That is a deliberate, single-component exception at Tim's explicit request,
// not a change to rule 14: every other coloured table on the site keeps its one
// visible key sentence (rule 16), and nothing here licenses taking theirs away.
//
// THE THREE THINGS RULE 16 KEEPS VISIBLE HOWEVER SHORT A KEY GETS — that a
// column is inverted, that a scale was refused, and anything that warns or
// changes what a number means — are not at stake here and that is worth saying
// rather than leaving to be noticed. This card's scale is never inverted (a
// good week is a high number, always); a refused scale simply draws no colour
// at all here, and there is no uncoloured-looking column for a reader to
// mistake for broken, because every cell already prints its own number; and
// nothing among these four blocks warned about anything.
//
// IF SOMEBODY LATER WANTS THE KEY BACK FOR ACCESSIBILITY, the honest move is to
// ask Tim, not to re-add it. The words are still in the DOM and still in
// `run.notes` / `run.legend`; a page that wants them visible can render them
// itself from the run it already has. `tests/test-heat.mjs` asserts they are
// still returned and `tests/touch-check.mjs` asserts the card renders none of
// them visibly, in both modes, so re-adding a visible block fails a suite with
// this comment's name on it rather than passing quietly.

import { coarsePointer } from './connection.js';
import { heatScale, heatOf } from './heat.js';

// A local copy rather than an import: this module has to stand on its own for
// any page that wants the card, and a four-line escaper is a smaller price
// than a dependency on one page's helpers.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const fmt = (n) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(1);

// ------------------------------------------- a zero: a bye, or a man ruled out?
//
// THE ONE PLACE THIS IS DECIDED. Every page that draws a week's projection asks
// here, so the Players page, the analysis grids, the Trade page and this card
// cannot come to different answers about the same 0.00.
//
// "A 0.00 means a bye" was the rule for a long time, and it is WRONG. Verified
// against public league 1241838 on 2026-09-16: ESPN projects a player it has
// ruled out — OUT, on injured reserve, and sometimes a day-to-day man too — at
// exactly 0.00 in weeks that are NOT his team's bye. A.J. Brown (IR, bye week
// 11) is 0.00 in weeks 2 and 5. A real bye is also 0.00. So the number alone
// cannot say which, and the week has to be checked against his NFL team's bye
// week (`fetchByeWeeks()` in js/season.js, keyed by `proTeamId`).
//
// When the bye weeks are NOT known — that read failed, or this is a player with
// no NFL team — the old rule stands, so a failed lookup costs nothing that
// worked before. And on the sample data a zero is never a bye at all: the demo
// rosters pin a man they have ruled out at zero, which is the same rule
// `projToken(v, demo)` has always followed.

const OUT_MARKS = { OUT: 'OUT', INJURY_RESERVE: 'IR', SUSPENSION: 'SUSP' };

/** 'OUT' / 'IR' / 'SUSP' for a man ESPN has ruled out, '' for anyone else. */
export function outMark(status) {
  return OUT_MARKS[status] || '';
}

/**
 * His NFL team's bye week, or null when it is not known.
 *
 * A `byeWeek` carried on the player wins (the Players page's sample wire has
 * one); otherwise it is looked up by `proTeamId` in the `fetchByeWeeks()` map.
 */
export function byeWeekOf(p, byes) {
  if (!p) return null;
  if (Number.isFinite(p.byeWeek)) return p.byeWeek;
  if (!byes || p.proTeamId === null || p.proTeamId === undefined) return null;
  const b = Number(byes[p.proTeamId]);
  return Number.isFinite(b) && b > 0 ? b : null;
}

/**
 * What a projection of exactly 0 means.
 *
 *   'bye'   his NFL team is off that week (or the bye weeks are unknown, and
 *           the old rule is kept so nothing regresses)
 *   'out'   a real zero for a man ESPN has ruled out — drawn "0.0" plus the
 *           word (OUT / IR / SUSP), never as a bye
 *   'zero'  a real zero for anyone else — drawn as the number
 *   null    it is not a zero at all
 *
 * @param {*} v the week's value
 * @param {{week?:number, byeWeek?:number|null, injuryStatus?:string, demo?:boolean}} ctx
 */
export function zeroKind(v, { week = null, byeWeek = null, injuryStatus = null, demo = false } = {}) {
  // NO NUMBER AT ALL in his known bye week is a bye too: ESPN sends no D/ST
  // projection for a bye week already past (verified 2026-09-16). Only with
  // the bye week known — an unknown bye never turns a null into a claim.
  if (v === null || v === undefined) {
    return !demo && Number.isFinite(byeWeek) && week !== null && Number(week) === byeWeek ? 'bye' : null;
  }
  if (v !== 0) return null;
  if (!demo) {
    if (!Number.isFinite(byeWeek)) return 'bye';
    if (week === byeWeek) return 'bye';
  }
  return outMark(injuryStatus) ? 'out' : 'zero';
}

/** Is this value a bye week? The yes/no form of `zeroKind`. */
export const isByeZero = (v, ctx) => zeroKind(v, ctx) === 'bye';

// -------------------------------------------------------------- the run data

/**
 * How a week's PROJECTION reads, and which of the six states it is.
 *
 * The ways of having no number stay different things, exactly as they are in
 * the season grid — that table tells them apart by class, and so does this.
 *
 * `ctx` is `{ week, byeWeek, injuryStatus }` for the zero rule above. Without
 * it the bye week is unknown and a live zero is a bye, as it always was.
 */
export function projToken(v, demo = false, ctx = {}) {
  if (v === 'wait') return { text: '·', kind: 'wait' };
  if (v === 'failed') return { text: '—', kind: 'none' };
  if (v === 'off') return { text: 'off', kind: 'off' };
  const zero = zeroKind(v, { ...ctx, demo });
  if (v === null || v === undefined) {
    return zero === 'bye' ? { text: 'Bye', kind: 'bye' } : { text: '—', kind: 'none' };
  }
  if (zero === 'bye') return { text: 'Bye', kind: 'bye' };
  // A ruled-out zero is the number AND the word, and a class of its own: the
  // word is what says it is not a bye, so colour is never the only cue.
  if (zero === 'out') return { text: fmt(v), kind: 'out', mark: outMark(ctx.injuryStatus) };
  return { text: fmt(v), kind: 'num' };
}

/**
 * How a week's ACTUAL reads. Tim's ask, in his words: "add another row below
 * proj that is act. If it's week 5, all columns before week 5 should have a
 * filled in act. anything after leave blank."
 *
 * THE RULE IS THE DATA, NOT THE CALENDAR. A week he has actually played has a
 * number recorded against it; a week still to come has none. So the test is
 * "is there an actual?" rather than "is this week number below today's?" —
 * which is also the only test that stays right when a week is postponed, when
 * a league is read mid-game, or when the page is replaying an old snapshot.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 *   - It never draws one of the four no-number marks. `Bye`, `—`, `off` and
 *     `·` each mean something specific in the Proj row above, and repeating
 *     them here would be a second claim made from the same fact. A week with
 *     no actual is simply BLANK, which is the whole of what "we have no result
 *     for him that week" needs to say.
 *   - A ZERO IS A REAL ZERO. A man who played and scored nothing reads "0.0",
 *     not a blank and not a bye. That is the fact a manager most wants to see
 *     under a projection of fourteen points, and turning it into any kind of
 *     absence would be the single worst thing this row could do.
 *
 * The ONE exception is a week that has not been read from ESPN yet: a blank
 * there would claim a result we have simply not looked up, so it keeps the `·`
 * the Proj row uses, and the legend line that already explains it.
 */
export function actToken(v) {
  if (v === 'wait') return { text: '·', kind: 'wait' };
  if (typeof v === 'number' && !Number.isNaN(v)) return { text: fmt(v), kind: 'num' };
  return { text: '', kind: 'blank' };
}

/** Explained only when it actually turns up, so a clean run has no legend. */
export const RUN_KEYS = {
  bye: 'Bye = the 0.00 ESPN returns for a player whose NFL team is off that week',
  out: '0.0 over OUT / IR = ESPN projects nothing because he is ruled out, not on bye',
  none: '— = ESPN carried no number for him that week',
  off: 'off = he was not on this roster that week',
  wait: '· = that week has not been read from ESPN yet',
};

/**
 * One player's whole season, as the data the chart is drawn from.
 *
 * The weeks arrive in batches behind the page, so this has to read correctly
 * when they are not all in — which is why an unread week is its own state and
 * why a run with nothing in it yet says so in words rather than drawing
 * thirteen empty columns.
 */
export function weekRun({
  heading = '',
  weeks = [],
  projections = [],
  actuals = [],
  currentWeek = null,
  demo = false,
  byeWeek = null,
  injuryStatus = null,
  playoffWeeks = [],
  starts = null,
  splitAfter = null,
  startsNote = '',
  // DEFAULT ON, and it is a judgement call rather than an oversight.
  //
  // Tim asked for the scale "across the whole cite … trade views, 14 week
  // previews", and this card IS the 14-week preview — on the Trade page and on
  // the Analysis grids alike. A default of OFF would have meant the feature
  // shipped only where a caller happened to opt in, which on the day it landed
  // was one page of the two; a reader comparing the same man's card on the two
  // pages would have found one coloured and one not, for no reason he could
  // see, and that is worse than either answer applied everywhere.
  //
  // It is an option at all because the scale is a claim about a distribution,
  // and a caller that knows its run is not one — a stub, a single week, a
  // reading replayed out of the archive — has to be able to say so without
  // being argued with. `heatScale` already refuses a run with fewer than two
  // numbers or no visible spread, so OFF is for the cases arithmetic cannot
  // see.
  heat = true,
} = {}) {
  if (!weeks.length) return null;

  if (projections.every((v) => v === 'wait')) {
    return {
      heading, pending: 'Not read yet — they fill in behind the page.',
      cols: [], legend: [], notes: [], scale: null,
    };
  }

  // One status for the whole run, or one per week when the page has them.
  const statusAt = (i) => (Array.isArray(injuryStatus) ? injuryStatus[i] : injuryStatus);

  // THE PLAYOFFS START AT A LINE. Tim: "put a line between 14 and 15 so that
  // it's clear that it's separated from the full season." The first playoff
  // week in this run carries it — whichever line of the wrapped chart it lands
  // on — and every playoff week says so in words for a screen reader.
  const po = new Set((playoffWeeks || []).map(Number));
  const poFirst = weeks.find((w) => po.has(Number(w)));

  // THE LINE UNDER WHAT HAS ALREADY HAPPENED, drawn the same way for the same
  // reason (see the note at the top of this file): on the FIRST week after
  // `splitAfter`, as a left border, so it survives the wrap. `undefined` when
  // there is no such week — a run entirely in the past draws no line, because a
  // divider with nothing on the far side of it is a line about nothing.
  const splitW = Number.isFinite(Number(splitAfter)) && splitAfter !== null && splitAfter !== ''
    ? Number(splitAfter)
    : null;
  const splitFirst = splitW === null ? undefined : weeks.find((w) => Number(w) > splitW);

  // "The caller has an opinion about who starts" is the ARRAY being there, not
  // any particular entry in it: an array of nulls is a caller that looked and
  // could not say, which is a different thing from a caller that never looked.
  const told = Array.isArray(starts);
  const startAt = (i) => {
    if (!told) return null;
    const v = starts[i];
    return v === true ? true : v === false ? false : null;
  };

  // The tokens first, because the scale is built out of them: what counts as a
  // number is `projToken`'s answer and nobody else's.
  const tokens = weeks.map((week, i) =>
    projToken(projections[i], demo, { week, byeWeek, injuryStatus: statusAt(i) }));

  const scale = heat
    ? heatScale(tokens.map((t, i) => (t.kind === 'num' ? Number(projections[i]) : null)))
    : null;
  // The words on every cell name the group, because this group is not the one
  // the rest of the site's cells are measured against — see the long note above.
  const WHAT = 'his own weeks in this run';

  const cols = weeks.map((week, i) => {
    const start = startAt(i);
    const past = splitW !== null && Number(week) <= splitW;
    const proj = tokens[i];
    return {
      week,
      proj,
      act: actToken(actuals[i]),
      now: week === currentWeek,
      po: po.has(Number(week)),
      poStart: poFirst !== undefined && week === poFirst,
      // The caller's opinion, kept exactly as given …
      start,
      past,
      // … and the rendered decision, which is the rule this module enforces for
      // every caller: a week already played is never bold.
      bold: start === true && !past,
      splitStart: splitFirst !== undefined && week === splitFirst,
      heat: proj.kind === 'num' ? heatOf(Number(projections[i]), scale, { what: WHAT }) : null,
    };
  });

  // The legend names a mark only where it occurs, and BOTH rows can put one on
  // screen — the Act row's `·` is the same `·`, so it must be able to pull in
  // the same line rather than sitting there unexplained.
  const used = new Set();
  for (const c of cols) { used.add(c.proj.kind); used.add(c.act.kind); }
  const legend = Object.entries(RUN_KEYS).filter(([k]) => used.has(k)).map(([, s]) => s);

  // THE NOTES ARE NOT THE LEGEND, and they are kept apart on purpose. The
  // legend explains MARKS — "Bye =", "off =" — and names one only where it
  // actually occurs; these explain how to read the chart itself, and each turns
  // up only when the thing it explains is on screen.
  //
  // BOTH ARE STILL BUILT AND STILL RETURNED, and that was a decision rather
  // than an oversight when the card stopped DRAWING them on 2026-09-20. Three
  // reasons, in order of weight:
  //
  //   1. They are not dead. `cardHtml` renders the lot into an `sr-only` block,
  //      so these two arrays are what a screen reader is read. Deleting them
  //      would delete the meaning, which is not what Tim asked for — he asked
  //      not to SEE them.
  //   2. `weekRun` is an API more than one page codes against (the header at
  //      the top of this file says so), and `js/trade-page.js` reads the run it
  //      gets back. Dropping two documented fields to save building two arrays
  //      nobody pays for is a breaking change bought with nothing.
  //   3. They are pure, they are cheap, and they are the tested half: every
  //      sentence here is asserted word by word in tests/test-heat.mjs, which
  //      is how "what bold means is the caller's sentence" and "the key never
  //      promises a heavier type" stay true. A page that ever wants one of
  //      these visible again has it ready-made and correct.
  //
  // What is NOT defensible is a caller assuming these are on screen. They are
  // not, anywhere, and touch-check.mjs fails if they come back.
  const notes = [];
  if (told && cols.some((c) => c.start !== null)) notes.push(startsLine(startsNote, cols));
  if (splitFirst !== undefined) notes.push(splitLine(splitFirst));
  if (scale) notes.push(heatLine(scale));

  return { heading, pending: '', cols, legend, notes, scale };
}

/**
 * What BOLD means on this card — which is a different sentence depending on who
 * is being looked at, and that is why the caller supplies it.
 *
 * "Weeks he makes your best lineup" for a man you already own; "weeks he would
 * make your best lineup after this trade" for a man on somebody else's roster.
 * The card cannot know which, and guessing would put a claim about a trade on a
 * card that is not about one.
 */
function startsLine(note, cols) {
  const what = note || 'weeks he makes your best lineup';
  const n = cols.filter((c) => c.bold).length;
  const count = n === 0
    ? 'none of the weeks still to come, on these numbers'
    : `${n} of the weeks still to come`;
  return `Bold, underlined week numbers are ${what} — ${count}. ` +
    'A week that has already been played is never bold: who started it is a fact, not a forecast.';
}

/** The heavy divider, said in words, because a line on its own is not a sentence. */
function splitLine(week) {
  return `The heavy line before week ${week} separates what has already happened, on its left, ` +
    'from what is still to come.';
}

/**
 * The scale under the chart — the channel that makes a colour CHECKABLE.
 *
 * In points rather than adjectives, the same standard `describeHeat` holds
 * itself to. It is not `describeHeat` for one reason: that sentence promises
 * "the type gets heavier the further out a number is", and inside this card it
 * does not — the weight channel belongs to bold (see the note at the top of the
 * file). A key that described a cue the card does not draw would be worse than
 * no key at all.
 */
function heatLine(scale) {
  const edge = scale.edges[scale.edges.length - 1];
  const at = (v) => (Math.round(v * 10) / 10).toFixed(1);
  return 'Colour on the Proj row compares each week with HIS OWN other weeks — green is a good ' +
    'week for him, red a poor one. It is never a comparison with another player or another ' +
    `position. Full colour ${edge} standard deviation out: ${at(scale.mean + edge * scale.sd)} pts ` +
    `or better, ${at(scale.mean - edge * scale.sd)} pts or worse, against an average of ` +
    `${at(scale.mean)} over the ${scale.n} week${scale.n === 1 ? '' : 's'} with a number. His best ` +
    'and worst weeks also carry ▲ or ▼, so none of it depends on telling red from green.';
}

// --------------------------------------------------- registering and wiring

const RUNS = new Map();   // key -> { ident, run, href }
let seq = 0;              // just a counter: see the key note at the top

export const TIP_ATTR = 'data-tip';

/**
 * Register one man's card and get back the key that goes in the markup.
 *
 * `prefix` is only a debugging courtesy — it lets you see which container a key
 * came from — and nothing reads it back. Uniqueness comes from the counter.
 */
export function registerRun({ ident = '', run = null, href = null, id = null } = {}, prefix = 'p') {
  const key = `${prefix}:${seq++}`;
  // `id` is optional and is NOT the key: it is a stable name for "this man in
  // this place" (the analysis grids use grid + team + player), and it is only
  // read by `reopenTip`, to find the same card again after a repaint.
  RUNS.set(key, { ident, run, href, id });
  return key;
}

/** ` data-tip="…"`, ready to drop into a tag. Leading space included. */
export function tipAttr(key) {
  return ` ${TIP_ATTR}="${esc(key)}"`;
}

/**
 * Every registered run on the page is dead — call this when the markup
 * carrying the keys is about to be replaced.
 *
 * With a `prefix`, only that container's are: a page with more than one table
 * of cards repaints them separately, and clearing the lot from inside one
 * renderer would leave every OTHER table's `data-tip` pointing at nothing —
 * markup that looks perfectly correct and simply stops opening a card. The
 * analysis page hit exactly that when its season panel grew cards of its own.
 *
 * The counter is NOT wound back. It costs nothing to let it climb, and a key
 * that never repeats cannot collide with one still sitting in a container that
 * was not re-rendered.
 */
export function clearRuns(prefix = null) {
  if (prefix === null) { RUNS.clear(); return; }
  const head = `${prefix}:`;
  for (const key of [...RUNS.keys()]) if (key.startsWith(head)) RUNS.delete(key);
}

let cardEl = null;
let asSheet = false;      // is the card currently open as a tap-opened sheet?
let openId = null;        // the stable `id` of the run the open card shows, if it has one

// `coarsePointer` is imported from connection.js rather than written again
// here. Two things turn on it — whether this card opens as a tap-opened sheet,
// and whether the connection bar tells a reader to install an extension their
// browser cannot load — and two copies of one question is how two answers start.

/**
 * Did this click land on a PLAYER, or on the row around him?
 *
 * The analysis grids are one clickable row per team — clicking one drills into
 * it below — with a cell per player inside. Every click therefore belongs to
 * exactly one of the two, and something has to decide which.
 *
 * With a mouse the LINK decides: a number is an `<a class="pref">`, it is
 * followed, and the row lets it through. A finger has no link to decide with —
 * the tap opens the card instead of navigating — and a man ESPN gave no
 * playerId for has no `<a>` in his cell AT ALL, so on a touch screen the
 * question has to be asked of the CELL rather than of what happens to be
 * inside it. That gap was a real defect: a tap on such a cell opened his card
 * AND silently re-pointed the three panels below at a team nobody picked.
 *
 * Any other handler on the same element must ask this too, in these terms, so
 * the two cannot come to different answers about one click.
 */
export function clickIsPlayer(e) {
  if (!e.target || !e.target.closest) return false;
  if (e.target.closest('a.pref')) return true;
  return coarsePointer() && !!e.target.closest(`[${TIP_ATTR}]`);
}

function cardNode() {
  if (cardEl) return cardEl;
  cardEl = document.createElement('div');
  cardEl.id = 'tipCard';
  cardEl.className = 'tipcard';
  cardEl.setAttribute('role', 'tooltip');
  cardEl.hidden = true;
  document.body.appendChild(cardEl);
  return cardEl;
}

// ----------------------------------------------------------- drawing the card

/**
 * The footer a SHEET gets and a hover card does not.
 *
 * On a phone the tap that opened this card is the tap that used to follow the
 * link, so the link has to come back somewhere — here, as a real `<a href>` so
 * it is still the site's one player-link contract and still opens in a new tab
 * from a long-press. The Close button is beside it because a sheet that can
 * only be dismissed by guessing where "outside" is is a trap.
 */
function actionsHtml(href) {
  if (!asSheet) return '';
  const open = href
    ? `<a class="tc-open" href="${esc(href)}">His next 13 weeks &rarr;</a>`
    : '<span class="tc-open tc-open-off">ESPN gives this man no id to look up</span>';
  return `<div class="tc-actions">${open}<button type="button" class="tc-close">Close</button></div>`;
}

// THE RUN WRAPS; IT NEVER SCROLLS. Tim's ask, in his words: "For the preview,
// remove scrolling on the box, just show the whole thing, no matter how long it
// gets." So `.tc-scroll` and its `overflow-x: auto` are gone, and the run is cut
// into LINES that each fit the space the card has.
//
// Wrapping rather than shrinking the columns, and that was a choice between two
// honest answers:
//
//   - Narrower columns cannot be made to work at the sizes involved. A 390px
//     phone leaves about 300px once the card's padding and the row labels are
//     paid for; thirteen weeks in that is 23px a column, and "18.2" in tabular
//     figures does not fit in 23px at any font size a person would read. It
//     also fails the actual ask — "no matter how long it gets" means the layout
//     has to survive a seventeen-week run, where shrinking gets worse rather
//     than better.
//   - Wrapping scales with BOTH, and costs one thing: the reader's eye has to
//     travel down a line. Week numbers are on every line, so nothing has to be
//     counted to know where you are.
//
// The width is computed from `window.innerWidth` and the constants below rather
// than measured off the rendered card, for the same reason `placeTip` guards
// every measurement: a test harness has no layout, and this must not throw or
// go strange in one. With no window to ask, it assumes a desktop and puts the
// whole run on one line, which is what a desktop gets anyway.
const CHART = {
  col: 36,         // a run column: the 34px floor in the CSS, plus a little
  label: 56,       // the "Week"/"Proj"/"Act" column down the left
  cardPad: 24,     // .tipcard horizontal padding
  sheetPad: 28,    // .tipcard.sheet horizontal padding
  cardMax: 720,    // .tipcard max-width
  cardVw: 0.92,    // .tipcard max-width, the vw half of it
  safety: 8,       // never let the last column sit flush against the edge
  min: 3,          // a line of fewer than three weeks is not a chart
};

/** How many weeks fit on one line of the chart, in this mode, on this screen. */
function perLine(sheet) {
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
  const outer = sheet
    ? vw - CHART.sheetPad
    : Math.min(vw * CHART.cardVw, CHART.cardMax) - CHART.cardPad;
  const room = outer - CHART.label - CHART.safety;
  return Math.max(CHART.min, Math.floor(room / CHART.col));
}

/**
 * Cut the run into lines of at most `cap` weeks, balanced.
 *
 * Balanced rather than greedy: thirteen weeks with room for eight would give
 * 8 + 5 greedily and 7 + 6 balanced, and a line with one or two weeks on it
 * reads as a mistake rather than as the end of a run.
 */
function chartLines(cols, cap) {
  if (cols.length <= cap) return [cols];
  const lines = Math.ceil(cols.length / cap);
  const each = Math.ceil(cols.length / lines);
  const out = [];
  for (let i = 0; i < cols.length; i += each) out.push(cols.slice(i, i + each));
  return out;
}

/**
 * One line of the chart: week numbers, the projection under each, the actual
 * under that.
 *
 * A real table, so the three rows share ONE set of column widths and a number
 * sits under its own week whatever is in it. That is the entire reason this is
 * a table and not a string, and a third row makes it easier to get wrong, not
 * easier to get away with.
 *
 * The Act row is in a `<tfoot>` rather than beside the Proj row in the
 * `<tbody>`: they are one table for the column widths, but the projections are
 * the body of the thing and the actuals are the footnote to them.
 *
 * Lines are not padded out to equal length. Every token in the run is at most
 * four tabular characters — "18.2", "Bye", "off" — which is narrower than the
 * 34px floor on a column, so every column is exactly that floor and the lines
 * align under each other without filler. Filler would also be a SECOND kind of
 * empty cell in the Act row, which is the one row where empty already means
 * something.
 */
function lineHtml(cols) {
  // The heavy line before the first playoff week is a class on that column in
  // all three rows; its "PO" label stacks under the number like `.tc-mk`, so the
  // column keeps its width and `perLine` stays right.
  //
  // `split-start` is the SAME mechanism for the line between what has been
  // played and what has not, and it composes with `po-start` for free: both set
  // one `border-left` to the same value, so a column that is both draws one
  // line rather than two. See the note at the top of the file for why it has to
  // be a LEFT border on the first column after, rather than a right border on
  // the last column before.
  const extra = (c, base = '') => {
    const cls = [
      base,
      c.now ? 'now' : '',
      c.poStart ? 'po-start' : '',
      c.splitStart ? 'split-start' : '',
    ].filter(Boolean).join(' ');
    return cls ? ` class="${cls}"` : '';
  };
  // NEVER WEIGHT ALONE. A bold week number is also underlined in the accent
  // colour (`wk-start` in css/app.css) and says which it is to a screen reader.
  // The spoken word is only ever about a week STILL TO COME: for a week already
  // played the card makes no claim either way, so it says nothing rather than
  // announcing "not in your lineup" about a week whose lineup is history.
  const spoken = (c) => {
    if (c.bold) return '<span class="sr-only"> (he starts)</span>';
    if (c.start === false && !c.past) return '<span class="sr-only"> (not in your lineup)</span>';
    return '';
  };
  const weeks = cols
    .map((c) => `<th${extra(c, c.bold ? 'wk-start' : '')} scope="col">${c.week}` +
      (c.poStart ? '<span class="tc-po" aria-hidden="true">PO</span>' : '') +
      (c.po ? '<span class="sr-only"> (playoffs)</span>' : '') +
      (c.splitStart ? '<span class="sr-only"> (first week still to come)</span>' : '') +
      spoken(c) +
      '</th>').join('');
  // A ruled-out zero stacks its word UNDER the number (`.tc-mk` is a block), so
  // the column stays the 34px floor and `perLine` stays right.
  //
  // The scale's words go on an `aria-label`, NOT a `title`: a title here would
  // have the browser draw a second tooltip over the card, which is the whole
  // reason this card exists. An aria-label draws nothing and says everything,
  // and the key line under the chart is the sighted reader's half of it.
  const projs = cols
    .map((c) => {
      const h = c.heat;
      const label = h ? ` aria-label="${esc(`${c.proj.text} — ${h.words}`)}"` : '';
      return `<td${extra(c, `k-${c.proj.kind}${h ? ` ${h.cls}` : ''}`)}${label}>${esc(c.proj.text)}` +
        `${c.proj.mark ? `<span class="tc-mk">${esc(c.proj.mark)}</span>` : ''}</td>`;
    }).join('');
  const acts = cols
    .map((c) => `<td${extra(c, `a-${c.act.kind}`)}>${esc(c.act.text)}</td>`).join('');
  return (
    '<table class="tc-run">' +
    `<thead><tr><th class="tc-lbl" scope="row">Week</th>${weeks}</tr></thead>` +
    `<tbody><tr><th class="tc-lbl" scope="row">Proj</th>${projs}</tr></tbody>` +
    `<tfoot><tr><th class="tc-lbl" scope="row">Act</th>${acts}</tr></tfoot>` +
    '</table>'
  );
}

/**
 * The identity line, the chart, and the sheet's actions — and, for a screen
 * reader only, what the chart means.
 *
 * WHAT IS VISIBLE BELOW THE CHART IS THE SHEET'S ACTIONS AND NOTHING ELSE, and
 * on a hover card not even those. Tim, 2026-09-20: "Also in the preview, I want
 * all the words beneath the chart to dissapear-they're not needed." The long
 * section near the top of this file has the whole argument, including what it
 * costs a sighted reader who cannot separate the hues; do not restore a visible
 * block without reading it.
 *
 * WHAT STAYS, AND WHY EACH IS NOT "WORDS BENEATH THE CHART":
 *
 *   - the identity line and the heading above the chart. He asked for exactly
 *     those by name on 2026-09-18 ("Just put the name of that player somewhere
 *     outside of the chart, and their season proj, and current avg");
 *   - `actionsHtml`. Those are CONTROLS, not prose. On a phone the tap that
 *     opened this sheet is the tap that would have followed the link, so
 *     removing them would make the sheet a trap and would break HANDOFF's
 *     "nothing may be reachable only by hovering";
 *   - everything drawn INSIDE the chart: the state markers in the cells (Bye,
 *     off, `—`, `·`, the OUT/IR word), the bold-and-underlined week numbers,
 *     the heavy dividers and the ▲/▼ at the ends of the scale. Those are the
 *     chart, and several of them are the hue-free channels rule 14 is about.
 */
function cardHtml({ ident, run, href }, sheet) {
  const head = `<div class="tc-ident">${esc(ident)}</div>`;
  if (!run) return `${head}${actionsHtml(href)}`;

  const sub = `<div class="tc-head">${esc(run.heading)}</div>`;
  if (run.pending) {
    return `${head}${sub}<div class="tc-pending">${esc(run.pending)}</div>${actionsHtml(href)}`;
  }

  const lines = chartLines(run.cols, perLine(sheet))
    .map(lineHtml).join('');

  // A BLANK IN THE ACT ROW IS A CLAIM, so it is stated rather than left to be
  // guessed at. It is separate from the legend because the legend explains
  // MARKS, and the whole point of a blank is that it is not one.
  const note = run.cols.some((c) => c.act.kind === 'blank')
    ? '<div class="tc-note">Act is what he actually scored. It is blank for a week with no ' +
      'result recorded yet.</div>'
    : '';

  const legend = run.legend.length
    ? `<div class="tc-legend">${run.legend.map((l) => esc(l)).join('<br>')}</div>`
    : '';

  const poWeeks = run.cols.filter((c) => c.po).map((c) => c.week);
  const poNote = poWeeks.length
    ? `<div class="tc-note">PO = the playoffs (week${poWeeks.length === 1 ? '' : 's'} ` +
      `${poWeeks.length === 1 ? poWeeks[0] : `${poWeeks[0]}–${poWeeks[poWeeks.length - 1]}`}), ` +
      'after the heavy line.</div>'
    : '';

  // What bold means, where the heavy line falls, and how to read the colour —
  // each written by `weekRun` (so it is pure and testable) and each present only
  // when the thing it explains is actually on screen. They go BEFORE the legend
  // for the same reason the legend goes last: the legend is a glossary of marks
  // and these are instructions for reading the chart. That ORDER is the order a
  // screen reader now hears them in, which is why it is still worth keeping.
  const extras = (run.notes || [])
    .map((n) => `<div class="tc-note">${esc(n)}</div>`).join('');

  // ALL FOUR BLOCKS, IN ONE `sr-only` WRAPPER. This is the whole of Tim's ask of
  // 2026-09-20 and the whole of what was done about it.
  //
  // The wrapper is what hides them, not a class on each block, for two reasons
  // that both bit before this was written this way:
  //
  //   1. ONE PLACE OWNS THE HIDING. `.tc-key` is `position: absolute` and 1px
  //      square in css/app.css, so it is out of flow and no margin, padding or
  //      border on anything INSIDE it can add a pixel to the card. Hiding each
  //      block individually leaves four chances for a page-local `.tc-note`
  //      rule to win on document order and put a stray 7px margin back — and
  //      `.tc-note`'s rules live in analysis.html and trade.html, whose inline
  //      <style> comes AFTER css/app.css and beats it at equal specificity.
  //   2. THE BLOCKS KEEP THEIR OWN CLASSES, deliberately. `.tc-note` and
  //      `.tc-legend` are how tests/an-test.mjs and tests/tr-test.mjs read the
  //      card's explanation back, and those suites are asserting that the words
  //      EXIST and say the right thing — which is still true and still worth
  //      asserting. What changed is whether a sighted reader sees them, and
  //      that is asserted separately, in touch-check.mjs, against the visible
  //      text rather than against `textContent`.
  //
  // It is rendered only when there is something in it: an empty `sr-only` div
  // is an empty announcement, and a run with no marks, no bold, no line and no
  // scale genuinely has nothing to explain.
  const key = `${note}${poNote}${extras}${legend}`;
  const keyHtml = key ? `<div class="tc-key sr-only">${key}</div>` : '';

  return `${head}${sub}<div class="tc-chart">${lines}</div>${keyHtml}${actionsHtml(href)}`;
}

/**
 * @param {Element} cell  the element carrying the data-tip key
 * @param {boolean} sheet open it as a tap-opened sheet rather than a hover card
 */
function showTip(cell, sheet = false) {
  const data = RUNS.get(cell.dataset ? cell.dataset.tip : cell.getAttribute(TIP_ATTR));
  if (!data) return;
  const el = cardNode();
  asSheet = sheet;                        // read by cardHtml, so set it first
  openId = data.id ?? null;
  el.innerHTML = cardHtml(data, sheet);
  el.classList.toggle('sheet', sheet);
  // A hover card is a tooltip; a thing you opened, can read and must dismiss is
  // a dialog, and the difference is what a screen reader announces.
  el.setAttribute('role', sheet ? 'dialog' : 'tooltip');
  el.hidden = false;
  // A sheet is pinned to the foot of the window by CSS and needs no measuring —
  // which is also what makes it reliable on a screen where the cell it came
  // from may be most of the viewport wide. The inline top/left are cleared
  // rather than overridden: on a touchscreen laptop a hover can have placed the
  // card already, and an inline style beats any class rule that follows it.
  if (sheet) {
    el.style.top = '';
    el.style.left = '';
  } else {
    placeTip(cell);
  }
}

/** Close whatever is open. */
export function hideTip() {
  if (cardEl) cardEl.hidden = true;
  asSheet = false;
  openId = null;
}

/**
 * Keep an open card open across a repaint — call it AFTER the new markup is in.
 *
 * The analysis grids repaint once per batch of weeks while the season loads,
 * and they used to close the card on every one: a card opened in the first
 * seconds after load simply vanished under the reader, twice or three times.
 * So a repaint no longer closes it. Instead the card looks for the SAME run —
 * by the stable `id` it was registered with — among the cells now on the page,
 * and redraws itself from that cell's (newer) data, in the same mode.
 *
 * If that man is no longer on screen, or the run had no `id` to find it by, the
 * card closes: a card describing a cell that is gone is the thing to avoid.
 */
export function reopenTip() {
  if (!cardEl || cardEl.hidden) return;
  const id = openId;
  const sheet = asSheet;
  if (id === null) { hideTip(); return; }
  for (const [key, data] of RUNS) {
    if (data.id !== id) continue;
    const cell = typeof document.querySelector === 'function'
      ? document.querySelector(`[${TIP_ATTR}="${key.replace(/["\\]/g, '\\$&')}"]`)
      : null;
    if (cell) { showTip(cell, sheet); return; }
  }
  hideTip();
}

/**
 * Put it under the cell, and keep it on screen.
 *
 * This matters MORE now that the card has no inner scroller: its width is
 * whatever its widest line needs, so it is the one thing standing between a
 * thirteen-week run opened on the right-hand edge of a wide grid and a card
 * hanging off the side of the window. `perLine` keeps a line inside the card's
 * own max-width; this keeps the card inside the window.
 *
 * Every measurement is guarded: a test harness has no layout, and a tooltip is
 * never worth throwing an exception out of a render for. Without geometry it
 * simply sits where it was told, which is still correct markup.
 */
function placeTip(cell) {
  const el = cardEl;
  if (!el || typeof cell.getBoundingClientRect !== 'function') return;
  try {
    const c = cell.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const gap = 8;

    // Below by default; above when there is no room, which there often is not
    // for a row near the foot of a ten-team grid.
    let top = c.bottom + gap;
    if (top + t.height > vh - gap) top = Math.max(gap, c.top - t.height - gap);

    // Left-aligned to the cell, then pulled back inside the window rather than
    // allowed to run off the right of a wide table.
    let left = c.left;
    if (left + t.width > vw - gap) left = Math.max(gap, vw - t.width - gap);

    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  } catch { /* no layout: the card is still correct, just unplaced */ }
}

/**
 * One delegated set per container. `mouseover`/`mouseout` rather than
 * enter/leave because only these bubble, and the cell is found with closest()
 * so moving between the number and its link inside one cell is not a leave.
 *
 * The `click` handler is the touch half, and it does three things in order that
 * all matter:
 *
 *   1. It only acts on a coarse pointer. A mouse click on one of these cells
 *      must still follow the link, which is what every other page's click does
 *      and what `link-check.mjs` follows.
 *   2. It leaves every MODIFIED click alone — ctrl/cmd/shift/middle — so
 *      open-in-new-tab keeps working on a tablet with a keyboard.
 *   3. It stops the event before it reaches the document, where the handler
 *      that closes a sheet on an outside tap is waiting — the tap that OPENED
 *      it is not an outside tap, and without this the sheet would be dismissed
 *      by the gesture that asked for it.
 *
 * What it does NOT do is keep a clickable row underneath from acting: such a
 * handler is on the same element and is usually registered first, so it has
 * already run by the time anything here could stop it. `clickIsPlayer` is
 * where that is settled, by both sides asking the same question.
 */
export function wireTips(el) {
  if (!el) return;
  const cellOf = (e) => (e.target.closest ? e.target.closest(`[${TIP_ATTR}]`) : null);

  el.addEventListener('mouseover', (e) => {
    const cell = cellOf(e);
    if (cell && !asSheet) showTip(cell);
  });
  el.addEventListener('mouseout', (e) => {
    if (asSheet) return;   // a sheet is dismissed deliberately, never by drift
    const cell = cellOf(e);
    // Still inside the same cell — moving onto the link within it — is not a
    // leave, and treating it as one is what makes a card flicker.
    if (cell && e.relatedTarget && cell.contains(e.relatedTarget)) return;
    if (cell) hideTip();
  });
  el.addEventListener('focusin', (e) => {
    const cell = cellOf(e);
    if (cell && !asSheet) showTip(cell);
  });
  el.addEventListener('focusout', (e) => {
    if (cellOf(e) && !asSheet) hideTip();
  });

  el.addEventListener('click', (e) => {
    if (!coarsePointer()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    const cell = cellOf(e);
    if (!cell) return;
    e.preventDefault();
    e.stopPropagation();
    showTip(cell, true);
  });
}

/**
 * Dismissing a sheet. Three ways, because a sheet that can only be closed one
 * way is a sheet somebody gets stuck under: its own Close button, Escape, and
 * a tap anywhere outside it. The cell taps that OPEN one call stopPropagation,
 * so the outside-tap handler never sees the tap that arrived a moment ago.
 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTip();
});

document.addEventListener('click', (e) => {
  if (!asSheet || !cardEl || cardEl.hidden) return;
  const inside = typeof cardEl.contains === 'function' && cardEl.contains(e.target);
  // Inside, but on the Close button, or anywhere outside: gone. The link is the
  // one thing inside that is left to do its own job.
  if (!inside || (e.target.closest && e.target.closest('.tc-close'))) hideTip();
});
