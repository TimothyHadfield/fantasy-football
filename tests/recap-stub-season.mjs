// js/season.js as THE PHONE'S SYNCED COPY serves it, for recap-cloud-check.mjs.
//
// `cloudSource()` answers with the copy (cloud-copy-shape.mjs, the shape
// js/cloud.js `readDown` returns), and every read is served from it. A call
// that would go to ESPN on the phone is RECORDED in `globalThis.__espnAsks`
// rather than answered, so the check can hold the page to rule 20: a page on
// the synced copy asks ESPN for nothing.
//
// Real sizes: ten squads of sixteen (the sample league's generators, which
// produce js/season.js's roster shape), weeks 1-5 played and 6-13 to come,
// and 150 free agents a week on the wire (the sync's WIRE_LIMIT).

import { generateDemoWeekRosters, generateDemoFreeAgents } from '../js/demo-rosters.js';
import { generateDemoLeague } from '../js/demo.js';
import { syncedCopy } from './cloud-copy-shape.mjs';

export const PLAYED = 5;
export const WEEKS = 13;
/** A free agent who had the week of his life in week 5: the pool must reach the wire. */
export const WIRE_STAR = { playerId: 990001, name: 'Wire Star', position: 'WR', proTeam: 'DET', proTeamId: 8, projected: 5.1, actual: 41.7, injuryStatus: 'ACTIVE', percentOwned: 3 };
/** The hurt man's NFL team's kickoffs, riding the synced schedule (`proKickoffs`). */
const at = (m, d) => new Date(2026, m - 1, d, 13).getTime();
export const KICKOFFS = { HURT_TEAM: { 5: at(10, 4), 6: at(10, 11), 7: at(10, 18), 8: at(10, 25), 9: at(11, 1), 10: at(11, 8) } };
/** An out starter ESPN gave a return date for: back Oct 25, so week 8. */
export const HURT_ID = 'hurt';

const asks = (globalThis.__espnAsks = globalThis.__espnAsks || []);
const ask = (what) => { asks.push(what); return Promise.reject(new Error(`asked ESPN for ${what} on the synced copy`)); };

const r1 = (n) => Math.round(n * 10) / 10;
// Each NFL team code gets a stable id, as ESPN's proTeamId would be.
const codes = new Map();
const teamId = (code) => { if (!codes.has(code)) codes.set(code, codes.size + 1); return codes.get(code); };
const mode = process.env.RECAP_COPY || 'full';   // 'full' | 'bare' (an older copy: no wire, no kickoffs)

function build() {
  const L = generateDemoLeague();
  const teams = L.teams.map((t) => ({ id: t.id, name: t.name }));
  const games = L.games.map((g) => {
    const played = g.week <= PLAYED;
    return {
      week: g.week, homeId: g.homeId, awayId: g.awayId,
      homeScore: played ? g.homeActual : null, awayScore: played ? g.awayActual : null,
      played, homeName: teams.find((t) => t.id === g.homeId)?.name, awayName: teams.find((t) => t.id === g.awayId)?.name,
    };
  });
  const rosters = new Map();
  for (let w = 1; w <= WEEKS; w++) {
    const r = generateDemoWeekRosters(w).teams.map((t) => ({
      ...t,
      players: t.players.map((p) => ({ ...p, proTeamId: teamId(p.proTeam), actual: w <= PLAYED ? p.actual : null })),
    }));
    rosters.set(w, r);
  }
  // Team 1's first starter: hurt after week 5, out (projected 0) weeks 6-7, ESPN says back Oct 25.
  const hurtId = rosters.get(5)[0].players[0].playerId;
  for (let w = 6; w <= WEEKS; w++) {
    for (const t of rosters.get(w)) {
      t.players = t.players.map((p) => (p.playerId === hurtId
        ? { ...p, projected: w < 8 ? 0 : p.projected, injuryStatus: 'OUT', injuryDetails: { outForSeason: false, returnDate: '2026-10-25', type: 'Ankle' } }
        : p));
    }
  }
  // Starters and bench are the same entries as `players`, as js/season.js hands them out.
  for (const teams of rosters.values()) {
    for (const t of teams) {
      t.starters = t.players.filter((p) => p.started);
      t.bench = t.players.filter((p) => !p.started);
    }
  }
  globalThis.__hurtId = hurtId;
  const hurtTeam = rosters.get(5)[0].players[0].proTeamId;
  const wire = new Map();
  if (mode === 'full') {
    for (let w = 1; w <= WEEKS; w++) {
      const base = generateDemoFreeAgents(w);
      const list = [];
      for (let i = 0; list.length < 150; i++) {
        const p = base[i % base.length];
        const lap = Math.floor(i / base.length);
        const projected = r1(p.projected * (1 - lap * 0.1));
        list.push({ ...p, playerId: p.playerId + lap * 100000, name: lap ? `${p.name} ${lap + 1}` : p.name, proTeamId: teamId(p.proTeam), projected,
          actual: w <= PLAYED ? r1(projected * (0.6 + ((p.playerId + w) % 9) / 10)) : null });
      }
      if (w === PLAYED) list[0] = { ...WIRE_STAR };
      wire.set(w, list);
    }
  }
  const schedule = {
    leagueName: 'Synced Stub League', teams, games,
    weeks: Array.from({ length: WEEKS }, (_, i) => i + 1),
    byWeek: new Map(Array.from({ length: WEEKS }, (_, i) => [i + 1, games.filter((g) => g.week === i + 1)])),
    ...(mode === 'full' ? { proKickoffs: { [hurtTeam]: KICKOFFS.HURT_TEAM } } : {}),
  };
  return syncedCopy({
    leagueId: '1241838', season: 2026, leagueName: schedule.leagueName, teams,
    schedule, rosters, wire, byes: { [hurtTeam]: 12 },
    weeks: { rosters: [...rosters.keys()], wire: [...wire.keys()] },
  });
}

const COPY = build();
globalThis.__copy = COPY;

export async function cloudSource() { return COPY; }
export async function fetchSchedule() { return COPY.schedule; }
export async function fetchWeekRosters(week) {
  const teams = COPY.rosters.get(Number(week));
  if (!teams) return ask(`rosters ${week}`);
  return { week: Number(week), teams, from: 'cloud' };
}
export async function fetchWeeksRosters(weeks) {
  const out = new Map();
  for (const w of weeks) {
    const teams = COPY.rosters.get(Number(w));
    if (teams) out.set(Number(w), teams);
    else asks.push(`rosters ${w}`);
  }
  return out;
}
export async function fetchWireWeek(week) {
  const list = COPY.wire.get(Number(week));
  if (!list) return ask(`wire ${week}`);
  return list;
}
export async function fetchByeWeeks() { return Object.keys(COPY.byes).length ? { ...COPY.byes } : ask('byes'); }
// The real two never throw ({} is "unknown"), so these record and answer {}.
export async function fetchProGames() { asks.push('NFL games'); return {}; }
export async function fetchProKickoffs() { asks.push('NFL kickoffs'); return {}; }
export function weekReadAt() { return null; }
