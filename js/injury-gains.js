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

// ---------------------------------------------------------------------------
// THE WEEKS AFTER HE IS DUE BACK (Tim, 2026-11-04)
//
// "for devante adams on the app it says Est. Return 11/25/26, which is before
// week 12 … but our cite shows the 17 week preview being out for the season" →
// "mark those weeks as back wk 12. Is there any way we could reasonably fill in
// those weeks 12+ with numbers that aren't 0 (and still reasonably accurate),
// and also make sure to not label those weeks as IR".
//
// ESPN projects an IR man at 0 in EVERY week left until he is activated, return
// date or not (measured on 1241838, 2026-11-04: Adams, back 11/25, 0.0 in weeks
// 9–17). So in a week on or after his return week (`returnWeek`) that is still
// to come, ESPN's 0 is replaced by an ESTIMATE: his last projection before the
// zeros, as ESPN filed it (`lastHealthy`). ESPN's own number wins the moment it
// is above 0. Out for the season, or no return date: nothing changes.
//
// WHY THE LAST ONE, NOT AN AVERAGE (backtest, 2026-11-04, the 500 most-owned
// men of 2026 weeks 1–9 on 1241838): 31 men projected ≥ 5 a week who sat at 0
// for two weeks or more and were then projected again; against ESPN's own
// projections in their first three weeks back (67 weeks), the last healthy
// projection was off by 1.33 a week on average, the average of the last four by
// 1.64, of the last two by 1.61, his actual scores by 3.55. A 10% first-week-
// back discount made it worse (1.69). Every subset tried ranked them the same.

/** How far back to look for his last projection above 0. */
export const EST_LOOKBACK = 8;

/**
 * His last projection above 0 before `before`, walking back, his bye skipped.
 *
 * @param {Object} o
 * @param {number} o.before the first week not to look at (the current week)
 * @param {(week:number) => number|null|undefined} o.projOf his projection that
 *   week as filed: null = no line, undefined = not held yet
 * @param {number|null} [o.bye]
 * @returns {{est:number, week:number}|{need:number}|null} `need` = that week is
 *   not held and has to be read before anything can be said; null = none found
 */
export function lastHealthy({ before, projOf, bye = null, lookBack = EST_LOOKBACK }) {
  for (let w = Number(before) - 1; w >= Math.max(1, Number(before) - lookBack); w--) {
    if (w === bye) continue;
    const v = projOf(w);
    if (v === undefined) return { need: w };
    if (num(v) && v > 0) return { est: Math.round(v * 100) / 100, week: w };
  }
  return null;
}

/**
 * One week's teams, with each returning man's weeks marked. Pure: copies only.
 *
 * Every man with a return week (`backOf`) gets `backWeek` in a week that is
 * the current one or later. In a week AFTER the current one, on or after his
 * return week, not his bye, where ESPN says exactly 0, he also gets his
 * estimate as `projected`, with `projEst: true` and ESPN's `espnProjected: 0`.
 * The current week is never filled: it is the week lineups are set for, and
 * there ESPN's own number is the one that counts.
 *
 * @param {number} week
 * @param {Array} teams the week's teams (`{ players, starters?, bench? }`)
 * @param {Object} o
 * @param {number|null} o.currentWeek null = not known: nothing is touched
 * @param {(p) => number|null} o.backOf his return week, or null
 * @param {(p) => {est:number}|null} o.estOf his estimate, or null
 * @param {(p) => number|null} [o.byeOf] his NFL team's bye week
 */
export function fillReturnWeeks(week, teams, { currentWeek, backOf, estOf, byeOf = () => null }) {
  const w = Number(week);
  if (!Array.isArray(teams) || !num(Number(currentWeek)) || currentWeek === null || w < Number(currentWeek)) return teams;
  const conv = (p) => {
    if (!p || typeof p !== 'object') return p;
    const back = backOf(p);
    if (!num(back)) return p;
    const out = { ...p, backWeek: back };
    if (w > Number(currentWeek) && w >= back && p.projected === 0 && w !== byeOf(p)) {
      const e = estOf(p);
      if (e && num(e.est) && e.est > 0) {
        out.projected = e.est;
        out.projEst = true;
        out.espnProjected = 0;
      }
    }
    return out;
  };
  return teams.map((t) => {
    if (!t || !Array.isArray(t.players) || !t.players.some((p) => p && num(backOf(p)))) return t;
    const seen = new Map();
    const one = (p) => { if (!seen.has(p)) seen.set(p, conv(p)); return seen.get(p); };
    const out = { ...t, players: t.players.map(one) };
    if (Array.isArray(t.starters)) out.starters = t.starters.map(one);
    if (Array.isArray(t.bench)) out.bench = t.bench.map(one);
    return out;
  });
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
