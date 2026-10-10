// Stands in for js/leagues.js when the MENU page (leagues.html) is booted
// without the real data layer: tests/leagues-check.mjs, and a headless
// screenshot of the page. It keeps the list in memory, touches no storage and
// makes no request, and it records every call so a test can say what the page
// asked for. It runs in a browser as well as in node (no node-only API).
//
// The written API it follows (docs/main-menu-plan.md, "After review"):
//   SEASON_MIN, keyOf(leagueId, season)
//   list()    -> [{ leagueId, name, teamCount, seasons (descending),
//                   teams: { '2026': { id, name } | undefined },
//                   lastOpened: { season, at } | null }], most recent first
//   current() -> { leagueId, season, teamId } | null
//   add({ leagueId, name, teamCount, seasons, season, team })
//   remove(leagueId)
//   open(leagueId, season) -> { ok: true, href } | { ok: false, reason }
//   async lookup(leagueId) -> { ok: true, leagueId, name, teamCount, seasons,
//                               teams: [{ id, name }] } | { ok: false, reason }
//
// A test sets `globalThis.__leaguesStub` BEFORE the page module is imported:
//   { list, current, lookups: { id: result }, openFail: { 'id-season': reason },
//     lookupWait: Promise }      (every field optional)
// With none set it is the sample below: two leagues at real sizes — a league
// with every season the site offers (2018 on, nine of them), ESPN's longest
// league and team names (32 characters), and a league never opened, with no
// "You are" team known.

const cfg = globalThis.__leaguesStub || {};
const env = (globalThis.process && globalThis.process.env) || {};
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export const SEASON_MIN = 2018;
export const keyOf = (leagueId, season) => `${leagueId}-${season}`;

export const SAMPLE = [
  {
    leagueId: '1241838',
    name: 'Sample Keeper League',
    teamCount: 10,
    seasons: [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018],
    teams: {
      2026: { id: 4, name: 'Sample Team Four' },
      2025: { id: 4, name: 'Last Year’s Name' },
    },
    lastOpened: { season: 2026, at: Date.UTC(2026, 9, 10, 15) },
  },
  {
    leagueId: '476225',
    name: 'Office League',
    teamCount: 12,
    seasons: [2026, 2025, 2024],
    teams: {},
    lastOpened: null,
  },
];
export const SAMPLE_CURRENT = { leagueId: '1241838', season: 2026, teamId: 4 };
export const SAMPLE_LOOKUPS = {
  555666: {
    ok: true, leagueId: '555666', name: 'College Friends', teamCount: 8,
    seasons: [2026, 2025],
    teams: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }],
  },
};

const emptyStart = env.LEAGUES_STUB === 'empty';
let rows = clone(cfg.list || (emptyStart ? [] : SAMPLE));
let cur = clone('current' in cfg ? cfg.current : (emptyStart ? null : SAMPLE_CURRENT));
const lookups = cfg.lookups || SAMPLE_LOOKUPS;

/** Every call the page made, in order: ['open', '1241838', 2025], … */
export const calls = [];
globalThis.__leaguesCalls = calls;

export function list() {
  return clone(rows);
}

export function current() {
  return clone(cur);
}

export function add(entry) {
  calls.push(['add', clone(entry)]);
  const { leagueId, name, teamCount, seasons, season, team } = entry;
  rows = rows.filter((l) => l.leagueId !== String(leagueId));
  rows.push({
    leagueId: String(leagueId), name, teamCount, seasons: [...seasons],
    teams: team ? { [season]: team } : {},
    lastOpened: null,
  });
}

export function remove(leagueId) {
  calls.push(['remove', leagueId]);
  rows = rows.filter((l) => l.leagueId !== String(leagueId));
  if (cur && cur.leagueId === String(leagueId)) cur = null;
}

export function open(leagueId, season) {
  calls.push(['open', leagueId, season]);
  const reason = cfg.openFail && cfg.openFail[keyOf(leagueId, season)];
  if (reason) return { ok: false, reason };
  cur = { leagueId: String(leagueId), season, teamId: null };
  return { ok: true, href: 'index.html' };
}

export async function lookup(leagueId) {
  calls.push(['lookup', leagueId]);
  if (cfg.lookupWait) await cfg.lookupWait;
  const hit = lookups[leagueId];
  return hit ? clone(hit) : { ok: false, reason: 'ESPN has no league with that ID.' };
}
