// Stands in for js/season.js when the PLAYERS page is booted to check its "Who
// to start" box (wv-start-check.mjs).
//
// The squads are the Analysis harness's (an-stub-season.mjs), re-exported
// whole: ten teams of fifteen with a real lineup each — a QB, two RBs, two WRs,
// a TE, a FLEX, a D/ST, a K and six on the bench — scores for the weeks played,
// a bye, a week ESPN carried nothing for, and a man who joins in week 5. The
// other Players-page stubs park every man on the bench, and a box that marks
// who makes the best lineup has nothing to mark in a league with no lineup.
//
// What the Players page imports that the Analysis page does not is added here:
// the wire, and `cloudSource`.
export * from './an-stub-season.mjs';

import * as base from './an-stub-season.mjs';

// START_DEPARTED=1: A MAN WHO STARTED FOR YOU AND HAS SINCE LEFT (Tim,
// 2026-10-09: "remove any players on the who to start list that aren't
// currently on your team. Just don't mark the past weeks with a green line if
// a player who isn't currently on the team started"). ESPN returns each played
// week's REAL roster, so a man traded away after week 3 is in weeks 1–3 of
// the season read and in none after — that shape, on every squad:
//
//   weeks 1–3  one more receiver, "T<n> Player 15" (id n·100 + 15), IN the
//              lineup at WR, projected 30 and scoring 22; the receiver whose
//              slot he had (Player 04) sits on the bench those weeks
//   week 4 on  he is gone and Player 04 is back in his slot
//
// With him the best lineup of weeks 1–3 is WR 15 and 03, FLEX 04 — and
// Player 06, the FLEX of every other week, is out of it. That last part is
// what tells "his mark is simply not drawn" from "the lineup was solved again
// without him": solved again, 06 would be marked in weeks 1–3.
export const DEPARTED = process.env.START_DEPARTED === '1';
export const DEPARTED_INDEX = 15;
export const DEPARTED_WEEKS = [1, 2, 3];
export const DEPARTED_PROJ = 30;
export const DEPARTED_SCORE = 22;

function withDeparted(week, teams) {
  if (!DEPARTED || !DEPARTED_WEEKS.includes(week)) return teams;
  const total = (arr, key) => {
    const vals = arr.map((p) => p[key]).filter((v) => typeof v === 'number');
    return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10 : null;
  };
  return teams.map((t) => {
    const players = t.players.map((p) => (p.playerId === t.id * 100 + 4
      ? { ...p, lineupSlotId: 20, slot: 'BE', started: false }
      : p));
    players.push({
      playerId: t.id * 100 + DEPARTED_INDEX,
      name: base.playerName(t.id, DEPARTED_INDEX),
      position: 'WR', proTeam: 'BUF', proTeamId: 1,
      lineupSlotId: 4, slot: 'WR', started: true,
      projected: DEPARTED_PROJ, actual: DEPARTED_SCORE,
      seasonProjected: 340, injuryStatus: 'ACTIVE', percentOwned: null,
    });
    const starters = players.filter((p) => p.started);
    const bench = players.filter((p) => !p.started);
    return {
      ...t,
      players,
      starters,
      bench,
      projectedTotal: total(starters, 'projected'),
      actualTotal: total(starters, 'actual'),
      benchActualTotal: total(bench, 'actual'),
      seasonProjectedTotal: total(starters, 'seasonProjected'),
    };
  });
}

export async function fetchWeekRosters(week) {
  const got = await base.fetchWeekRosters(week);
  return { ...got, teams: withDeparted(week, got.teams) };
}

export async function fetchWeeksRosters(weeks, opts) {
  const got = await base.fetchWeeksRosters(weeks, opts);
  for (const [week, teams] of got) got.set(week, withDeparted(week, teams));
  return got;
}

// Through the STUBBED espn and the real `parseFreeAgent`, as cmp-stub-season.mjs
// and taken-stub-season.mjs do — see the note there.
import * as espn from './espn.js';

export async function fetchWireWeek(week, limit = 150) {
  const raw = await espn.fetchFreeAgents(week, limit);
  return (raw?.players || [])
    .map((entry) => espn.parseFreeAgent(entry, week))
    .filter((p) => p.playerId !== null && p.playerId !== undefined);
}

// START_CLOUD=1 makes this the phone's synced copy (js/season.js `cloudSource`).
export async function cloudSource() {
  return process.env.START_CLOUD === '1' ? { uid: 'stub-phone', leagueId: '99', season: 2026 } : null;
}
