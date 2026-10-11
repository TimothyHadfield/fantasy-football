// WHERE A PREVIEW GOES WHEN YOU CLICK IT — the site's deep links, in one place.
//
// Tim, 2026-10-08: "connectors to other places in the cite using previews is a
// huge advantage as well so check that out and build any connectors by clicking
// on the preview."
//
// Every card on the site (js/player-card.js for a man, js/pop.js for a number)
// takes an `href`, and the functions here are the only place those hrefs are
// spelled. A page that builds one by hand will drift from the page that reads
// it; a page that calls these cannot.
//
//   teamHref(teamId, week?)     analysis.html?team=7[&week=3]#rosterDetail
//                               that team's roster detail (and that week of it)
//   playerHref(playerId, week?) waivers.html?player=4262921[&week=3]
//                               his row on the Players page (and that week)
//   weekHref(week)              schedule.html?week=3
//                               Week matchups, on that week
//   statsHref(teamId?)          stats.html[?team=7]
//                               the standings, with that team's row marked
//   positionHref(pos)           waivers.html?pos=TE
//                               the Players page, filtered to that position
//   dealHref({with, get, send}) trade.html?with=7&get=11,12&send=13
//                               the Trade page's custom builder on that deal
//   espnLineupHref({...})       ESPN's own lineup screen for a team and week
//                               (the one link here that leaves the site)
//
// Each returns null when the thing it needs is missing — a man ESPN gives no id
// for has no page to land on — so a caller can hand the result straight to a
// card, which draws no link for null rather than a link to nowhere.
//
// Pure and DOM-free on purpose: `readParam` is the one function that looks at
// the address bar, and it is guarded so a test harness with no `location` gets
// null instead of an exception.
//
// See tests/pop-check.mjs.

const has = (v) => v !== null && v !== undefined && v !== '';
const enc = (v) => encodeURIComponent(String(v));

/** A team's roster detail on Analysis, optionally on one week. */
export function teamHref(teamId, week = null) {
  if (!has(teamId)) return null;
  return `analysis.html?team=${enc(teamId)}${has(week) ? `&week=${enc(week)}` : ''}#rosterDetail`;
}

/** A player's row on the Players page, optionally on one week. */
export function playerHref(playerId, week = null) {
  if (!has(playerId)) return null;
  return `waivers.html?player=${enc(playerId)}${has(week) ? `&week=${enc(week)}` : ''}`;
}

/** Week matchups on the Schedule page, on that week. */
export function weekHref(week) {
  if (!has(week)) return null;
  return `schedule.html?week=${enc(week)}`;
}

/** The standings on the Stats page, with one team's row marked when given. */
export function statsHref(teamId = null) {
  return has(teamId) ? `stats.html?team=${enc(teamId)}` : 'stats.html';
}

/** The Players page with its position filter set (QB, RB, WR, TE, FLEX, K, DST). */
export function positionHref(pos) {
  if (!has(pos)) return null;
  return `waivers.html?pos=${enc(pos)}`;
}

/**
 * A deal on the Trade page's custom builder: `with` is the other manager's
 * team id, `get` the player ids you would receive, `send` the ones you would
 * give up (js/trade-page.js `dealLink` reads exactly these three names).
 */
export function dealHref({ with: partner, get = [], send = [] } = {}) {
  if (!has(partner)) return null;
  const ids = (list) => (list || []).filter(has).map(enc).join(',');
  const g = ids(get);
  const s = ids(send);
  return `trade.html?with=${enc(partner)}${g ? `&get=${g}` : ''}${s ? `&send=${s}` : ''}`;
}

/**
 * ESPN's lineup screen for one team, on one week when given. null without a
 * league, a season or a team: the sample league has no ESPN page to open.
 */
export function espnLineupHref({ leagueId, season, teamId, week = null } = {}) {
  if (!has(leagueId) || !has(season) || !has(teamId)) return null;
  return 'https://fantasy.espn.com/football/team' +
    `?leagueId=${enc(leagueId)}&seasonId=${enc(season)}&teamId=${enc(teamId)}` +
    (has(week) ? `&scoringPeriodId=${enc(week)}` : '');
}

/**
 * One query parameter off the address bar (or off `search`, for a test), as a
 * string, or null when it is absent or empty.
 */
export function readParam(name, search = null) {
  try {
    const s = search !== null ? search
      : (typeof window !== 'undefined' && window.location && window.location.search) || '';
    const v = new URLSearchParams(s).get(name);
    return v === null || v === '' ? null : v;
  } catch {
    return null;
  }
}

/** The same, as a whole number — null for anything that is not one. */
export function readIntParam(name, search = null) {
  const v = readParam(name, search);
  return v !== null && /^\d+$/.test(v) ? Number(v) : null;
}
