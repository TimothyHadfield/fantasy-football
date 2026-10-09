// Stands in for js/season.js. Only fetchSchedule matters to the waivers page.
export const calls = { schedule: 0, rosterWeeks: [] };

import { pathToFileURL as toUrl } from 'node:url';
import nodePath from 'node:path';
import { REPO as ROOT } from './repo.mjs';
// The same module the page imports, so the same instance (and cached copy).
const { DEFAULT_PPR } = await import(toUrl(nodePath.join(ROOT, 'js/proj-trend.js')).href);
const HALF_PPR = DEFAULT_PPR.map((i) => (i.statId === 53
  ? { statId: 53, points: 0, pointsOverrides: { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5 } }
  : i));

const WEEKS = 13;
// 3, so the "current week" is 4 — or, with WV_PLAYED_THROUGH=13, December:
// the regular season is over and only the playoff weeks are left.
const PLAYED_THROUGH = Number(process.env.WV_PLAYED_THROUGH || 3);

export async function fetchSchedule() {
  calls.schedule++;
  if (process.env.WV_SCHEDULE_FAIL === '1') throw new Error('ESPN returned HTTP 500.');

  const byWeek = new Map();
  for (let w = 1; w <= WEEKS; w++) {
    const games = [];
    for (let t = 1; t <= 10; t += 2) {
      const played = w <= PLAYED_THROUGH;
      games.push({
        week: w,
        homeId: t, homeName: `Team ${t}`, homeScore: played ? 100 + t : null,
        awayId: t + 1, awayName: `Team ${t + 1}`, awayScore: played ? 95 + t : null,
        played,
      });
    }
    byWeek.set(w, games);
  }

  return {
    // WV_TREND: the league's own rules, the way js/season.js keeps them —
    // ESPN's default PPR with a catch cut to half a point (the real league's
    // shape: points 0 and a per-position override).
    ...(process.env.WV_TREND === '1' ? { scoringItems: HALF_PPR } : {}),
    leagueName: 'Stub League',
    teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` })),
    weeks: [...byWeek.keys()],
    byWeek,
    games: [...byWeek.values()].flat(),
  };
}

// WV_TREND: two squads, so the Taken table and your own "Your …" rows carry
// real men from the preseason copy too (half PPR, per week, by hand):
//   team 2  Texans D/ST  (-16034)  7.6 → flat 10.0 = +2.4  green ▲
//           Tyler Warren (4431459) 9.9 → flat 7.8  = −2.1  red ▼
//           Stub Man     (7399)    not in the copy       no arrow
//   team 4 (yours)  Wil Lutz (2985659) K 8.0 → flat 11.0 = +3.0  green ▲
export const TREND_SQUADS = [
  { id: 2, name: 'Team 2', players: [
    { playerId: -16034, name: 'Texans D/ST', position: 'DST', proTeam: 'HOU', flat: 10.0, want: 'up' },
    { playerId: 4431459, name: 'Tyler Warren', position: 'TE', proTeam: 'IND', flat: 7.8, want: 'down' },
    { playerId: 7399, name: 'Stub Man', position: 'WR', proTeam: 'TB', flat: 9.0, want: null },
  ] },
  { id: 4, name: 'Team 4', players: [
    { playerId: 2985659, name: 'Wil Lutz', position: 'K', proTeam: 'DEN', flat: 11.0, want: 'up' },
  ] },
];
function trendTeams() {
  return TREND_SQUADS.map((t) => {
    const players = t.players.map((p) => ({
      playerId: p.playerId, name: p.name, position: p.position, proTeam: p.proTeam,
      lineupSlotId: 20, slot: 'BE', started: false, projected: p.flat, actual: null,
      seasonProjected: 120, injuryStatus: 'ACTIVE', percentOwned: 50,
    }));
    return {
      id: t.id, name: t.name, abbrev: `T${t.id}`, players, starters: [], bench: players,
      projectedTotal: null, actualTotal: null, benchActualTotal: null, seasonProjectedTotal: null,
    };
  });
}
const TREND_ON = () => process.env.WV_TREND === '1';

export async function fetchWeekRosters(week = 1) {
  return { week, teams: TREND_ON() ? trendTeams(week) : [] };
}
export async function fetchWeeksRosters(weeks = [], { onProgress } = {}) {
  const out = new Map();
  if (!TREND_ON()) return out;
  let done = 0;
  for (const week of weeks) {
    calls.rosterWeeks.push(Number(week));
    out.set(Number(week), trendTeams(Number(week)));
    done++;
    if (onProgress) onProgress(done, weeks.length, week);
  }
  return out;
}
export async function fetchSeasonData() { throw new Error('not used by the waivers page'); }

// ------------------------------------------------------------ the wire
//
// `js/season.js` parses the free-agent payload now, rather than the Players
// page doing it — that move is what let a phone read the synced wire, since
// the page used to be the one thing talking to ESPN directly. The stub has to
// carry the same export or the page cannot import it, and it has to go through
// the STUBBED espn so this suite's own fixture still drives what comes back.
//
// Deliberately the real `parseFreeAgent` (the espn stub re-exports it), not a
// reimplementation: a stub that parsed differently from the site would make
// every projection assertion below a statement about the stub.
import * as espn from './espn.js';

export async function fetchWireWeek(week, limit = 150) {
  const raw = await espn.fetchFreeAgents(week, limit);
  return (raw?.players || [])
    .map((entry) => espn.parseFreeAgent(entry, week))
    .filter((p) => p.playerId !== null && p.playerId !== undefined);
}

// ------------------------------------------------------------ player Value
//
// js/season.js `fetchValueBase` / `fetchPlayerValues` (docs/value-plan.md).
// NONE by default — no lines, nobody with a Value — so a page booted on this
// stub draws what it drew before Value existed. A test that wants some sets
//   globalThis.__ffValue = { base, weeks, players: { [playerId]: { position, avg, value } } }
// before the page boots, or passes the same thing as JSON in the FF_VALUE
// environment variable (for a harness that runs the page in a child process).
function valueStub() {
  let v = globalThis.__ffValue;
  if (!v && typeof process !== 'undefined' && process.env && process.env.FF_VALUE) {
    try { v = JSON.parse(process.env.FF_VALUE); } catch { v = null; }
  }
  return v || null;
}

export async function fetchValueBase() {
  const v = valueStub();
  return (v && v.base) || null;
}

export async function fetchPlayerValues() {
  const v = valueStub();
  const byId = new Map();
  for (const [id, row] of Object.entries((v && v.players) || {})) {
    byId.set(Number(id), { position: row.position ?? null, avg: row.avg ?? null, value: row.value ?? null });
  }
  const lookup = (id) => {
    const hit = byId.get(Number(id));
    return hit && typeof hit.value === 'number' ? hit.value : null;
  };
  return { base: (v && v.base) || null, weeks: (v && v.weeks) || [], byId, lookup };
}
