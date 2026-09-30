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

// WV_TREND: three rows become real men from the committed preseason copy
// (data/baselines/2026-preseason.json), each projected flat so his Avg is
// exact. The league is half PPR (wv-stub-season), so their preseason per week
// is Gibbs 19.7, Nacua 17.2, Allen 21.8 (tests/test-proj-trend.mjs, by hand).
// "Now" is REST OF SEASON — the regular weeks 4–13 — whatever span is shown:
//   Gibbs  21.0 in weeks 4–6, 26.0 from week 7: rest of season 24.5 → +4.8
//          green ▲ — while over the Next 3 alone (21.0, +1.3) he would get none.
//          The case that tells a rest-of-season arrow from a span-based one.
//   Nacua  12.0 → −5.2   red ▼
//   Allen  23.8 → +2.0   NO arrow: "more than 2" is strict
// Everyone else keeps a stub id the copy has never heard of: no arrow.
const TREND = process.env.WV_TREND === '1';
export const TREND_MEN = {
  6: { id: 3918298, name: 'Josh Allen', proj: () => 23.8, want: null },
  10: { id: 4429795, name: 'Jahmyr Gibbs', proj: (w) => (w <= 6 ? 21.0 : 26.0), want: 'up' },
  23: { id: 4426515, name: 'Puka Nacua', proj: () => 12.0, want: 'down' },
};
if (TREND) {
  for (const [idx, m] of Object.entries(TREND_MEN)) {
    Object.assign(ROSTER[Number(idx)], { id: m.id, name: m.name });
  }
}

/** Deterministic, and different enough week to week that sorting can be seen. */
function projectionFor(p, week) {
  if (TREND && TREND_MEN[p.idx]) return TREND_MEN[p.idx].proj(week);
  const wobble = ((p.idx * 37 + week * 11) % 17) / 20;   // 0 .. 0.8
  return Math.round(BASE[p.pos] * (0.7 + wobble) * 100) / 100;
}

const FAIL = new Set((process.env.WV_FAIL_WEEKS || '').split(',').filter(Boolean).map(Number));
const EMPTY = process.env.WV_EMPTY === '1';
const WAIVERS = process.env.WV_WAIVERS === '1';
// Player 03 is listed OUT; with this set ESPN projects him at 0.00 in week 4,
// which is NOT his team's bye — the case "0.00 means bye" got wrong.
const OUT_ZERO = process.env.WV_OUT_ZERO === '1';

// WV_PAST: the weeks already played (1-3) carry what ESPN really sends for a
// played week (measured on public league 1241838, 2026-09-29, week 1 read in
// week 4): the week's projection (statSourceId 1, split 1) AND the actual
// (statSourceId 0, split 1). Two special shapes, both in week 1-2:
//   Player 07 is on bye in week 2 -- projected 0.00, no actual line.
//   Player 02 has no projection line in week 1, but did score 3.1.
const PAST = process.env.WV_PAST === '1';
const PLAYED_THROUGH = 3;
/** What he scored in a played week, to the tenth like ESPN keeps it. */
export function actualFor(p, week) {
  if (!PAST || week > PLAYED_THROUGH) return null;
  if (p.idx === 7 && week === 2) return null;
  if (p.idx === 2 && week === 1) return 3.1;
  return Math.round((projectionFor(p, week) * 1.2 - 1) * 10) / 10;
}

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
    const skipWeekly = (p.idx === 2 && week === 4) || (PAST && p.idx === 2 && week === 1);
    if (!skipWeekly) {
      stats.push({
        statSourceId: 1,
        statSplitTypeId: 1,
        scoringPeriodId: week,
        appliedTotal: (p.idx === 0 && week === 5) || (OUT_ZERO && p.idx === 3 && week === 4) ||
          (PAST && p.idx === 7 && week === 2)
          ? 0
          : projectionFor(p, week),
      });
    }
    const act = actualFor(p, week);
    if (act !== null) {
      stats.push({ statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: week, appliedTotal: act });
    }

    // WV_WAIVERS: Players 05 and 06 are still on waivers (clearing Friday 18
    // September 2026, midday UTC); everyone else is a free agent. ESPN puts
    // both fields on the ENTRY, not on `player`.
    const onWaivers = WAIVERS && (p.idx === 5 || p.idx === 6);
    const status = WAIVERS ? { status: onWaivers ? 'WAIVERS' : 'FREEAGENT' } : {};
    if (onWaivers) status.waiverProcessDate = Date.UTC(2026, 8, 18, 12);

    players.push({
      ...status,
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
  if (PAST && p.idx === 2 && week === 1) return null;
  if (PAST && p.idx === 7 && week === 2) return 0;
  if (p.idx === 0 && week === 5) return 0;
  if (OUT_ZERO && p.idx === 3 && week === 4) return 0;
  return projectionFor(p, week);
}

export const roster = ROSTER;
