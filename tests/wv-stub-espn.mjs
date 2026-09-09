// Stands in for js/espn.js. Everything except fetchFreeAgents is the REAL
// module -- including parseFreeAgent, so the decoding under test is the one
// that ships. Only the transport is faked.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO } from './repo.mjs';
const real = await import(pathToFileURL(path.join(REPO, 'js/espn.js')).href);

export const POSITIONS = real.POSITIONS;
export const SLOT_LABELS = real.SLOT_LABELS;
export const SLOT_ELIGIBILITY = real.SLOT_ELIGIBILITY;
export const PRO_TEAMS = real.PRO_TEAMS;
export const AuthError = real.AuthError;
export const configure = real.configure;
export const getConfig = real.getConfig;
export const parseFreeAgent = real.parseFreeAgent;
export const parseLeague = real.parseLeague;
export const fetchLeague = real.fetchLeague;
export const fetchDraft = real.fetchDraft;
export const fetchMatchups = real.fetchMatchups;
export const fetchTransactions = real.fetchTransactions;
export const fetchPlayers = real.fetchPlayers;
export const fetchRosters = real.fetchRosters;
export const fetchByeWeeks = real.fetchByeWeeks;
export const testConnection = real.testConnection;

export const calls = { weeks: [], limits: [] };

const SEASON = 2026;

// The real ownership spread at the top of a waiver wire: QB 10 / RB 13 /
// WR 17 / TE 5 / K 7 / DST 8 per sixty.
const PLAN = [[1, 'QB', 10], [2, 'RB', 13], [3, 'WR', 17], [4, 'TE', 5], [5, 'K', 7], [16, 'DST', 8]];
const BASE = { QB: 16, RB: 9, WR: 9, TE: 6, K: 8, DST: 7 };

const ROSTER = [];
{
  let i = 0;
  for (const [posId, pos, count] of PLAN) {
    for (let k = 0; k < count; k++, i++) {
      ROSTER.push({
        id: 5000 + i,
        idx: i,
        name: `Player ${String(i).padStart(2, '0')} ${pos}`,
        posId,
        pos,
        proTeamId: 1 + (i % 30),
        injury: i === 3 ? 'OUT' : i === 4 ? 'INJURY_RESERVE' : i === 5 ? 'QUESTIONABLE' : 'ACTIVE',
        owned: Math.round((92 - i * 1.4) * 10) / 10,
      });
    }
  }
}

/** Deterministic, and different enough week to week that sorting can be seen. */
function projectionFor(p, week) {
  const wobble = ((p.idx * 37 + week * 11) % 17) / 20;   // 0 .. 0.8
  return Math.round(BASE[p.pos] * (0.7 + wobble) * 100) / 100;
}

const FAIL = new Set((process.env.WV_FAIL_WEEKS || '').split(',').filter(Boolean).map(Number));
const EMPTY = process.env.WV_EMPTY === '1';

export async function fetchFreeAgents(scoringPeriodId, limit = 150) {
  const week = Number(scoringPeriodId);
  calls.weeks.push(week);
  calls.limits.push(limit);

  await new Promise((r) => setTimeout(r, Number(process.env.WV_DELAY || 5)));

  if (FAIL.has(week)) throw new Error(`ESPN returned HTTP 500 for week ${week}.`);
  if (EMPTY) return { players: [] };

  const players = [];
  for (const p of ROSTER.slice(0, limit)) {
    // Player 01 simply is not on week 6's list. The page must render that as a
    // blank, distinct from a bye.
    if (p.idx === 1 && week === 6) continue;

    const stats = [
      { statSourceId: 1, statSplitTypeId: 0, seasonId: SEASON, appliedTotal: 120 + p.idx },
    ];

    // Player 00 is on bye in week 5: ESPN's own answer is 0.00.
    // Player 02 has no weekly line at all in week 4.
    const skipWeekly = p.idx === 2 && week === 4;
    if (!skipWeekly) {
      stats.push({
        statSourceId: 1,
        statSplitTypeId: 1,
        scoringPeriodId: week,
        appliedTotal: p.idx === 0 && week === 5 ? 0 : projectionFor(p, week),
      });
    }

    players.push({
      player: {
        id: p.id,
        fullName: p.name,
        defaultPositionId: p.posId,
        proTeamId: p.proTeamId,
        injuryStatus: p.injury,
        ownership: { percentOwned: p.owned },
        stats,
      },
    });
  }
  return { players };
}

/** What the page SHOULD show for a player in a week, for the assertions. */
export function expected(playerId, week) {
  const p = ROSTER.find((x) => x.id === playerId);
  if (!p) return null;
  if (p.idx === 1 && week === 6) return null;
  if (p.idx === 2 && week === 4) return null;
  if (p.idx === 0 && week === 5) return 0;
  return projectionFor(p, week);
}

export const roster = ROSTER;
