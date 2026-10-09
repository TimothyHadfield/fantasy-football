// js/season.js as draft-review-check.mjs hands it to draft.html: the REAL
// league the fixtures were captured from (1241838, 2026-10-08), with nothing
// on the wire.
//
//   - 14 regular-season weeks, 1-4 played, six playoff teams (so weeks 15-17);
//   - every week's squads are who holds each drafted man NOW (`onTeamId` in
//     fixtures/draft-players-1241838-2026.json), with that week's projection
//     and score. The 19 drafted men nobody holds are on no squad in any week —
//     those are the page's "dropped players", which it must ask the espn stub
//     for (draft-stub-espn.mjs);
//   - DR_CLOUD=1 makes this the phone's synced copy: `cloudSource()` answers.
//
// What the page asked for is counted on `globalThis.__dr`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(path.join(HERE, 'fixtures/draft-players-1241838-2026.json'), 'utf8'));

const calls = (globalThis.__dr = globalThis.__dr || { draft: 0, players: 0, playerIds: 0, schedule: 0, squads: 0, byes: 0 });
const CLOUD = process.env.DR_CLOUD === '1';
const FINISHED = new Set(FX.finished);

export async function cloudSource() {
  return CLOUD ? { syncedAt: Date.now(), rosters: new Map() } : null;
}

export async function fetchSchedule() {
  calls.schedule++;
  const ids = FX.teams.map((t) => t.id);
  const games = [];
  for (let week = 1; week <= FX.regularSeasonWeeks; week++) {
    // A round robin by rotation: every team plays once a week.
    const turn = [ids[0], ...ids.slice(1).map((_, i) => ids[1 + ((i + week) % (ids.length - 1))])];
    for (let i = 0; i < ids.length / 2; i++) {
      const played = FINISHED.has(week);
      games.push({
        week, homeId: turn[i], awayId: turn[ids.length - 1 - i],
        homeScore: played ? 100 + i + week : 0, awayScore: played ? 90 + i : 0, played,
      });
    }
  }
  return {
    leagueName: 'The Keeper League', teams: FX.teams.map((t) => ({ id: t.id, name: t.name })),
    games, playoffs: { playoffTeams: 6 }, playoffGames: [],
  };
}

/** One team's lineup, filled best first by the season's projections: QB, 2 RB, 3 WR, TE, FLEX, D/ST, K. */
const LINEUP = [['QB', 0, 1], ['RB', 2, 2], ['WR', 4, 3], ['TE', 6, 1], ['DST', 16, 1], ['K', 17, 1]];
const season = (p) => Object.values(p.weeks).reduce((a, [proj]) => a + (proj || 0), 0);

function squads(week) {
  return FX.teams.map((t) => {
    const mine = Object.entries(FX.players).filter(([, p]) => p.onTeamId === t.id)
      .map(([id, p]) => ({ id: Number(id), p })).sort((a, b) => season(b.p) - season(a.p));
    const slotOf = new Map();
    for (const [pos, slot, n] of LINEUP) mine.filter((m) => m.p.position === pos).slice(0, n).forEach((m) => slotOf.set(m.id, slot));
    const flex = mine.find((m) => !slotOf.has(m.id) && ['RB', 'WR', 'TE'].includes(m.p.position));
    if (flex) slotOf.set(flex.id, 23);
    return {
      id: t.id, name: t.name,
      players: mine.map(({ id, p }) => {
        const [projected, actual] = p.weeks[week] || [null, null];
        const lineupSlotId = slotOf.has(id) ? slotOf.get(id) : 20;
        return {
          playerId: id, name: p.name, position: p.position, proTeamId: p.proTeamId, proTeam: '',
          lineupSlotId, started: lineupSlotId !== 20, projected,
          actual: FINISHED.has(week) ? actual : null,
          injuryStatus: p.injuryStatus, seasonAvg: null, posRank: null,
        };
      }),
    };
  });
}

export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  const out = new Map();
  let done = 0;
  for (const week of weeks) {
    calls.squads++;
    out.set(week, squads(week));
    if (onProgress) onProgress(++done, weeks.length, week, 'store');
  }
  return out;
}

export async function fetchByeWeeks() {
  calls.byes++;
  return {};
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
