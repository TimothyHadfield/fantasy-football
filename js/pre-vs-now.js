// PRESEASON VS NOW, ONE ROW A PLAYER. The rows and filters behind the Stats
// page's "Preseason vs now" panel. Pure: no DOM, no network, no maths of its own.
//
// Tim, 2026-10-11: "could you add a chart in the stats section that has to do
// with the proj vs actual that is the proj season avg (before the season
// started) vs the current season avg for every player? Allow the user to
// sort/filter them by position, rostered, or user."
//
// THE TWO NUMBERS ARE BOTH SOMEBODY ELSE'S:
//
//   PRE  = js/proj-trend.js `baselineOf(playerId, scoring).perWeek`: ESPN's
//          9 Sep projection, re-scored with this league's rules, per game. The
//          page hands the lookup in as `preOf`.
//   AVG  = ESPN's own season average (`seasonAvg` on a roster or wire row), the
//          "Avg" on the player card's glance line, found the way the card finds
//          it (js/player-card.js `playerCardFromWeeks`): off his entry in the
//          current week, else the latest week that carries one.
//
// A MAN WITHOUT BOTH IS NOT A ROW. No preseason line (a rookie ESPN had nothing
// for), no season average (he has not played): there is nothing to compare, and
// a 0 would be an invented number.
//
// DIFF IS ITS TWO PRINTED ENDS SUBTRACTED (the site's rule): both sides are
// rounded to the tenth first. `diffRaw` is the unrounded gap, for sorting.

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
export const ROSTERED = ['all', 'rostered', 'free'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10 + 0;
const known = (id) => id !== null && id !== undefined;

/** A defence is 'D/ST' on a roster row and 'DST' as a key. */
export const positionKey = (pos) => (pos === 'D/ST' ? 'DST' : pos || '');

const playersOf = (t) => (t && Array.isArray(t.players)
  ? t.players
  : [...((t && t.starters) || []), ...((t && t.bench) || [])]);

/**
 * His season average off the weeks read: the current week's entry, else the
 * latest week that carries one. Null when no week has it.
 *
 * @param {Map<number, Array>} weekTeams week -> teams[]
 */
export function seasonAvgOf(playerId, weekTeams, currentWeek = null) {
  if (!weekTeams || typeof weekTeams.keys !== 'function' || !known(playerId)) return null;
  const find = (w) => {
    for (const t of weekTeams.get(w) || []) {
      const hit = playersOf(t).find((p) => p && String(p.playerId) === String(playerId));
      if (hit) return hit;
    }
    return null;
  };
  const here = known(currentWeek) ? find(Number(currentWeek)) : null;
  if (here && num(here.seasonAvg) !== null) return here.seasonAvg;
  const weeks = [...weekTeams.keys()].map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  for (const w of weeks) {
    const hit = find(w);
    if (hit && num(hit.seasonAvg) !== null) return hit.seasonAvg;
  }
  return null;
}

function rowOf(p, pre, avg, team) {
  const from = num(pre);
  const to = num(avg);
  if (!p || !known(p.playerId) || from === null || to === null) return null;
  return {
    playerId: p.playerId,
    name: p.name || '',
    position: positionKey(p.position),
    proTeam: p.proTeam || '',
    teamId: team ? team.id : null,
    teamName: team ? team.name || '' : '',
    rostered: Boolean(team),
    pre: round1(from),
    avg: to,
    diff: round1(round1(to) - round1(from)),
    diffRaw: to - from,
  };
}

/**
 * Every man with both numbers: the squads' players, then the free agents.
 *
 * @param {Object}   o
 * @param {Array}    o.teams  the CURRENT week's rosters, `[{ id, name, players }]`
 * @param {Array}    [o.wire] free agents (`season.fetchWireWeek`), each with his
 *                            own `seasonAvg`; a man also on a roster is left to
 *                            his squad
 * @param {Function} o.preOf  playerId -> preseason average per game, or null
 * @param {Function} [o.avgOf] playerId -> season average for a rostered man;
 *                            default: the `seasonAvg` on his row
 */
export function buildRows({ teams = [], wire = [], preOf, avgOf = null } = {}) {
  if (typeof preOf !== 'function') return [];
  const rows = [];
  const seen = new Set();
  const add = (p, avg, team) => {
    if (!p || !known(p.playerId) || seen.has(String(p.playerId))) return;
    const row = rowOf(p, preOf(p.playerId), avg, team);
    if (!row) return;
    seen.add(String(p.playerId));
    rows.push(row);
  };
  const held = new Set();
  for (const t of teams || []) {
    for (const p of playersOf(t)) {
      if (!p || !known(p.playerId)) continue;
      held.add(String(p.playerId));
      add(p, avgOf ? avgOf(p.playerId, p) : p.seasonAvg, t);
    }
  }
  for (const p of wire || []) {
    if (p && known(p.playerId) && !held.has(String(p.playerId))) add(p, p.seasonAvg, null);
  }
  return rows;
}

/** The three filters at rest. */
export const defaultFilters = () => ({ position: 'all', rostered: 'all', team: 'all' });

/**
 * One filter changed: the other two are made to agree with it.
 *
 * A team's players are rostered, so choosing a team sets Rostered; choosing
 * "All" or "Free agents" lets go of the team.
 */
export function setFilter(filters, name, value) {
  const f = { ...defaultFilters(), ...(filters || {}) };
  if (name === 'position') f.position = value === 'all' || POSITIONS.includes(value) ? value : 'all';
  if (name === 'rostered') {
    f.rostered = ROSTERED.includes(value) ? value : 'all';
    if (f.rostered !== 'rostered') f.team = 'all';
  }
  if (name === 'team') {
    f.team = value === 'all' || !known(value) || value === '' ? 'all' : value;
    if (f.team !== 'all') f.rostered = 'rostered';
  }
  return f;
}

/** Do these filters show any free agent? (Only then is the wire read.) */
export const needsWire = (filters) => !filters || filters.rostered !== 'rostered';

export function filterRows(rows, filters) {
  const f = { ...defaultFilters(), ...(filters || {}) };
  return (rows || []).filter((r) => {
    if (f.position !== 'all' && r.position !== f.position) return false;
    if (f.rostered === 'rostered' && !r.rostered) return false;
    if (f.rostered === 'free' && r.rostered) return false;
    if (f.team !== 'all' && String(r.teamId) !== String(f.team)) return false;
    return true;
  });
}

/** `{ all, rostered, free }` for the note. */
export function countRows(rows) {
  const rostered = (rows || []).filter((r) => r.rostered).length;
  return { all: (rows || []).length, rostered, free: (rows || []).length - rostered };
}
