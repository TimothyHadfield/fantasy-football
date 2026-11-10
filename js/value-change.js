// CHANGE IN VALUE: how far a man's Value has moved since he last played.
//
// Tim, 2026-11-10: "Right now throughout the cite you can select "proj or
// value", but I want to add "change in value" to that list, which shows the
// change in value since the last time they played (based on adjusted proj
// changes)."
//
// THE NUMBER
//
//   last played   the last NFL week his team played: this week when his game
//                 is already over, else the week before; his bye is skipped.
//                 A man whose team has not played yet has none (null).
//   value then    js/value.js `playerValue` — the site's one Value function, a
//                 0 and his bye counted as his position's waiver line — fed the
//                 projections SAVED AS OF that week (js/proj-history.js: the
//                 first copy kept in a week is the one taken before its games),
//                 over that copy's weeks from then on. The waiver lines are the
//                 season's frozen ones, so they are the lines he had then too.
//   value now     the same function over today's projections and weeks left.
//   change        now − then, each to the tenth first, then subtracted.
//
// No copy for that week, a copy that holds him only on the wire (a free
// agent's row there has one week, not his season), or no Value either side:
// null, printed "—" (rule 5).
//
// Pure: no DOM, no storage. Pages hand in the copies and today's weeks.

import { playerValue } from './value.js';
import { manIn } from './player-history.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r1 = (v) => Math.round(v * 10) / 10;
const get = (byWeek, w) => (byWeek instanceof Map ? byWeek.get(w) : byWeek ? byWeek[w] : null);

/**
 * The last NFL week his team played, or null when it has not played yet.
 *
 * @param {Object} o
 * @param {number} o.currentWeek the week in play (or next to be played)
 * @param {number|null} [o.byeWeek] his team's bye
 * @param {boolean} [o.playedThisWeek] his game this week is already over
 * @param {number} [o.firstWeek] the season's first week
 */
export function lastPlayedWeek({ currentWeek, byeWeek = null, playedThisWeek = false, firstWeek = 1 }) {
  const now = num(Number(currentWeek));
  if (now === null) return null;
  const bye = byeWeek === null || byeWeek === undefined ? null : Number(byeWeek);
  for (let w = playedThisWeek ? now : now - 1; w >= firstWeek; w--) {
    if (w !== bye) return w;
  }
  return null;
}

/** The copy saved as of `week` from a list (the first one listed wins), or null. */
export function copyFor(copies, week) {
  for (const rec of copies || []) if (rec && Number(rec.week) === Number(week)) return rec;
  return null;
}

/**
 * HIS CHANGE IN VALUE.
 *
 * @param {Object} o
 * @param {Object} o.base         the frozen lines (`value.buildBase`)
 * @param {string} o.position
 * @param {*}      o.playerId
 * @param {Object|Map} o.nowByWeek today's projection per week (pregame for a finished game)
 * @param {number[]} o.nowWeeks   the weeks left (`season.valueWeeks`)
 * @param {number|null} [o.byeWeek]
 * @param {number} o.currentWeek
 * @param {boolean} [o.playedThisWeek]
 * @param {Array}  o.copies       the saved copies (js/proj-history.js shape)
 * @param {number} [o.firstWeek]
 * @returns {{change:number|null, then:number|null, now:number|null, asOf:number|null,
 *   why:'ok'|'notYet'|'noCopy'|'notHeld'|'noValue',
 *   rows:Array<{week:number, then:number|null, now:number|null|'played'}>}}
 *   `rows` are the weeks whose projection moved (then → now; 'played' for a
 *   week counted then and played since)
 */
export function valueChange({
  base, position, playerId, nowByWeek, nowWeeks, byeWeek = null, currentWeek,
  playedThisWeek = false, copies = [], firstWeek = 1,
}) {
  const weeksNow = (nowWeeks || []).map(Number);
  const now = weeksNow.length ? num(playerValue(base, position, nowByWeek, weeksNow, byeWeek)) : null;
  const out = { change: null, then: null, now, asOf: null, why: 'noValue', rows: [] };
  const asOf = lastPlayedWeek({ currentWeek, byeWeek, playedThisWeek, firstWeek });
  out.asOf = asOf;
  if (asOf === null) return { ...out, why: 'notYet' };
  const rec = copyFor(copies, asOf);
  if (!rec) return { ...out, why: 'noCopy' };
  const man = manIn(rec, playerId);
  if (!man || man.onWire) return { ...out, why: 'notHeld' };
  const weeksThen = rec.weeks.map(Number).filter((w) => w >= asOf);
  const then = num(playerValue(base, position, man.byWeek, weeksThen, byeWeek));
  out.then = then;
  // The weeks behind it: every week counted then or now whose number moved.
  const nowSet = new Set(weeksNow);
  const all = [...new Set([...weeksThen, ...weeksNow])].sort((a, b) => a - b);
  for (const w of all) {
    const a = weeksThen.includes(w) ? num(get(man.byWeek, w)) : null;
    const b = nowSet.has(w) ? num(get(nowByWeek, w)) : 'played';
    if (b === 'played') { if (a !== null) out.rows.push({ week: w, then: a, now: 'played' }); continue; }
    if (a === null && b === null) continue;
    if (a !== null && b !== null && r1(a) === r1(b)) continue;
    out.rows.push({ week: w, then: a, now: b });
  }
  if (then === null || now === null) return { ...out, why: 'noValue' };
  return { ...out, change: r1(r1(now) - r1(then)) + 0, why: 'ok' };
}

/** A change as printed: rounded first, then signed ("+1.2", "−0.4", "0.0"); "—" for none. */
export function changeText(v) {
  const x = num(v);
  if (x === null) return '—';
  const r = r1(x) + 0;
  return r > 0 ? `+${r.toFixed(1)}` : r < 0 ? `−${Math.abs(r).toFixed(1)}` : '0.0';
}

/** Rule 7, one sentence for each panel's explain: what Change is made from. */
export const CHANGE_NOTE =
  'His Value now minus his Value off the projections saved just before his last game (byes skipped), ' +
  'on the same frozen waiver lines; a dash when no copy was saved that week.';

/** Why there is no number, in a few words for a preview. */
export function whyText(res) {
  if (!res) return 'Not known yet.';
  switch (res.why) {
    case 'notYet': return 'His team has not played yet.';
    case 'noCopy': return `No projections were saved as of week ${res.asOf}.`;
    case 'notHeld': return `Week ${res.asOf}’s saved copy does not hold his season.`;
    case 'noValue': return 'No Value then or now.';
    default: return '';
  }
}

/**
 * THE PREVIEW (house rule: minimal): Value then → Value now, and the weeks
 * whose projection moved. `{title, sub, rows, total}` in the shape the pages'
 * cards take; rows' values are strings or numbers.
 */
export function changeCard(name, res) {
  if (!res || res.change === null) {
    return { title: name, sub: 'Change in value', rows: [], total: { label: 'Change', value: null }, foot: whyText(res) };
  }
  const f = (v) => (v === null ? '—' : v === 'played' ? 'played' : Number(v).toFixed(1));
  return {
    title: name,
    sub: `Since week ${res.asOf}: Value ${f(res.then)} → ${f(res.now)}`,
    rows: res.rows.map((r) => ({ label: `Week ${r.week}`, value: `${f(r.then)} → ${f(r.now)}` })),
    total: { label: 'Change', value: changeText(res.change) },
    foot: res.rows.length ? '' : 'No week’s projection moved.',
  };
}
