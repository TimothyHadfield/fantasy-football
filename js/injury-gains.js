// WHEN HE IS BACK, AND WHO GAINS WHILE HE IS GONE. Pure: no DOM, no requests.
//
// Tim, 2026-10-19: "for the new injury report in the home section, instead of
// showing the user last name, slot, proj, status, and act, show the est return
// week, and on the right side any players that have their proj increase while
// they're gone and by how much it's increasing."
//
// EST. RETURN is ESPN's own word only (`injuryDetails` from `kona_playercard`,
// which js/season.js puts on every out man's roster entry, the synced copy
// included): out for the season, or the expected return DATE turned into the
// first week his NFL team plays on or after it (the NFL kickoffs). Nothing is
// guessed: no word from ESPN is "—".
//
// UP WHILE OUT compares two of ESPN's own projections for each TEAMMATE AT HIS
// POSITION (same NFL team, same position; anybody this page can see, rostered
// or on the wire):
//   before   the teammate's projection in the last week the hurt man played
//            (`baseWeek`), as ESPN filed it for that week;
//   while    the average of the teammate's projections over the weeks the hurt
//            man is out (`outWeeks`, at most AVG_WEEKS of them).
// "+x a week" is while − before. Both numbers are exact ESPN figures; that the
// rise is BECAUSE of the injury is the reading, not a measurement.

/** At most this many out weeks are averaged: the near ones are the ones ESPN has firmed up. */
export const AVG_WEEKS = 3;
/** A rise smaller than this is projection noise between horizons, not a role. */
export const MIN_GAIN = 0.5;
/** Teammates listed per injured man. */
export const MAX_GAINERS = 3;
/** No backup at these positions moves with an injury. */
const NO_BACKUPS = new Set(['K', 'DST', 'D/ST']);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * The week he is expected back: `'season'`, a week number, or null.
 *
 * @param {{outForSeason:boolean, returnDate:string|null}|null} details ESPN's word
 * @param {Object|null} kickoffs `{ [proTeamId]: { [week]: epochMs } }` (js/espn.js `parseProKickoffs`)
 * @param {number|string} proTeamId his NFL team
 * @returns {'season'|number|null}
 */
export function returnWeek(details, kickoffs, proTeamId) {
  if (!details) return null;
  if (details.outForSeason === true) return 'season';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(details.returnDate || ''));
  if (!m) return null;
  // The start of that day, local time: a Sunday return is that Sunday's game.
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const games = kickoffs && kickoffs[proTeamId];
  if (!games || typeof games !== 'object') return null;
  const weeks = Object.keys(games).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  for (const w of weeks) if (num(games[w]) && games[w] >= at) return w;
  return null;
}

/**
 * The weeks he is out, from `from` on: until his return week, every week left
 * when he is out for the season, or (ESPN silent) the run of weeks ESPN
 * projects him at zero outside his bye. At most AVG_WEEKS.
 *
 * @param {Object} o
 * @param {'season'|number|null} o.back `returnWeek`
 * @param {number} o.from the first week that can be missed
 * @param {number} o.last the last week to look at (end of the regular season)
 * @param {(week:number) => number|null} o.projOf his own projection that week, null = not known
 * @param {number|null} [o.bye] his NFL team's bye week
 */
export function outWeeks({ back, from, last, projOf, bye = null }) {
  const out = [];
  for (let w = from; w <= last && out.length < AVG_WEEKS; w++) {
    if (w === bye) continue;
    if (back === 'season') { out.push(w); continue; }
    if (num(back)) { if (w < back) { out.push(w); continue; } break; }
    const p = projOf(w);
    if (num(p) && p === 0) { out.push(w); continue; }
    break;
  }
  return out;
}

/**
 * The last week before `from` in which he played: projected above zero and
 * given a score. null when none of the weeks held shows it.
 *
 * @param {number} from
 * @param {(week:number) => {projected:number|null, actual:number|null}|null} lineOf
 * @param {number} [lookBack]
 */
export function baseWeekOf(from, lineOf, lookBack = 4) {
  for (let w = from - 1; w >= Math.max(1, from - lookBack); w--) {
    const q = lineOf(w);
    if (q && num(q.projected) && q.projected > 0 && num(q.actual)) return w;
  }
  return null;
}

/**
 * Teammates at his position whose projection rose for the weeks he is out.
 *
 * @param {Object} o
 * @param {{playerId, position, proTeamId}} o.hurt
 * @param {number|null} o.baseWeek `baseWeekOf`
 * @param {number[]} o.outWeeks `outWeeks`
 * @param {(week:number) => Array} o.poolOf every man this page can see that week,
 *   `{playerId, name, position, proTeamId, projected}`
 * @returns {Array<{playerId, name, position, before, during, gain, weeks}>} biggest gain first
 */
export function gainsWhileOut({ hurt, baseWeek, outWeeks: weeks, poolOf }) {
  if (!hurt || baseWeek === null || baseWeek === undefined || !weeks || !weeks.length) return [];
  if (NO_BACKUPS.has(String(hurt.position))) return [];
  // His NFL team: ESPN's id, or the sample league's team code.
  const team = (p) => String(p.proTeamId ?? p.proTeam ?? '');
  if (!team(hurt)) return [];
  const same = (p) => p && String(p.playerId) !== String(hurt.playerId) &&
    team(p) === team(hurt) && p.position === hurt.position;
  const lineIn = (w) => {
    const m = new Map();
    for (const p of poolOf(w) || []) if (same(p) && !m.has(String(p.playerId))) m.set(String(p.playerId), p);
    return m;
  };
  const before = lineIn(baseWeek);
  const during = weeks.map(lineIn);
  const out = [];
  for (const [id, b] of before) {
    // Projected 0 then was out himself (or idle): his rise is his own return.
    if (!num(b.projected) || b.projected <= 0) continue;
    const vals = during.map((m) => m.get(id)).filter((q) => q && num(q.projected)).map((q) => q.projected);
    if (!vals.length) continue;
    const avg = vals.reduce((a, v) => a + v, 0) / vals.length;
    const gain = round1(avg) - round1(b.projected);
    if (round1(gain) < MIN_GAIN) continue;
    out.push({
      playerId: b.playerId, name: b.name, position: b.position,
      before: round1(b.projected), during: round1(avg), gain: round1(gain), weeks: vals.length,
    });
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, MAX_GAINERS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The Est. return cell, as text: "Season", "Wk 8", ESPN's date when it cannot
 * be placed in a week (no kickoffs held), or "—".
 */
export function returnLabel({ back = null, returnDate = null } = {}) {
  if (back === 'season') return 'Season';
  if (num(back)) return `Wk ${back}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(returnDate || ''));
  if (m) return `~${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return '—';
}

/** One gainer as text: "+6.0/wk". */
export const gainLabel = (g) => `+${g.gain.toFixed(1)}/wk`;

/** The two headings' explanations (one line each). */
export const RETURN_TITLE = 'ESPN’s expected return, as the week his NFL team next plays. Season = out for the season';
export const GAINS_TITLE = 'Teammates at his position projected higher while he is out, in points a week';

/**
 * Everything one row of an injury table shows, for a man hurt as of `from`.
 *
 * @param {Object} o
 * @param {Object} o.hurt his roster entry (`playerId, name, position, proTeamId, injuryDetails?`)
 * @param {number} o.from the first week he can miss
 * @param {number} o.last the last regular-season week
 * @param {Object|null} o.kickoffs
 * @param {Object|null} o.byes `{ [proTeamId]: week }`
 * @param {(week:number) => Array} o.poolOf see `gainsWhileOut`
 * @param {Object|null} [o.details] ESPN's word, when not on the entry
 * @param {'season'|number|null} [o.back] a known return week (overrides ESPN's date)
 */
export function injuryRow({ hurt, from, last, kickoffs, byes, poolOf, details = null, back = undefined }) {
  const d = details || hurt.injuryDetails || null;
  const ret = back !== undefined ? back : returnWeek(d, kickoffs, hurt.proTeamId);
  const lineOf = (w) => (poolOf(w) || []).find((p) => p && String(p.playerId) === String(hurt.playerId)) || null;
  const bye = byes && num(Number(byes[hurt.proTeamId])) ? Number(byes[hurt.proTeamId]) : null;
  const weeks = outWeeks({ back: ret, from, last, bye, projOf: (w) => { const q = lineOf(w); return q ? q.projected : null; } });
  const base = baseWeekOf(from, lineOf);
  return {
    back: ret,
    returnDate: d && d.returnDate ? d.returnDate : null,
    outWeeks: weeks,
    baseWeek: base,
    gains: gainsWhileOut({ hurt, baseWeek: base, outWeeks: weeks, poolOf }),
  };
}
