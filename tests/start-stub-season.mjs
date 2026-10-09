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
