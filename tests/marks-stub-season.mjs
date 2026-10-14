// Stands in for js/season.js when the PLAYERS page is booted to check its
// "Show my players" switch and its diamond / coin marks (wv-marks-check.mjs).
//
// The league is start-stub-season.mjs's (real lineups, seven weeks played,
// week 8 the one a claim made now would be for), with ESPN's SEASON AVERAGE
// set on every man by a rule a test can check without the page:
//
//   playerId % 3 === 0   average 1.0  -> projected well above it: a DIAMOND
//   playerId % 3 === 1   average 99   -> projected well below it: a COIN
//   playerId % 3 === 2   no average   -> never played: NEITHER
//
// Invented men only (public repo): "T4 Player 03", "Player 12 WR".
export * from './start-stub-season.mjs';

import * as base from './start-stub-season.mjs';

export const avgFor = (id) => {
  const k = Number(id) % 3;
  return k === 0 ? 1 : k === 1 ? 99 : null;
};
export const kindFor = (id) => ({ 0: 'diamond', 1: 'coin', 2: null })[Number(id) % 3];

const withAvg = (p) => ({ ...p, seasonAvg: avgFor(p.playerId) });
const teamsWithAvg = (teams) => teams.map((t) => ({
  ...t,
  players: (t.players || []).map(withAvg),
  starters: (t.starters || []).map(withAvg),
  bench: (t.bench || []).map(withAvg),
}));

export async function fetchWeekRosters(week) {
  const got = await base.fetchWeekRosters(week);
  return { ...got, teams: teamsWithAvg(got.teams) };
}

export async function fetchWeeksRosters(weeks, opts) {
  const got = await base.fetchWeeksRosters(weeks, opts);
  for (const [week, teams] of got) got.set(week, teamsWithAvg(teams));
  return got;
}

// NFL BYE WEEKS, `{proTeamId: week}` as js/season.js gives them. "Now" is week
// 8: team 1's bye (week 5) and team 2's (week 3) are behind them, team 3's
// (week 10) is still to come, and the rest are unknown. Every rostered man in
// the stub plays for team 1; free agent i plays for team 1 + (i % 30).
export const BYES = { 1: 5, 2: 3, 3: 10 };
export const byePastFor = (proTeamId) => proTeamId === 1 || proTeamId === 2;
export async function fetchByeWeeks() {
  return { ...BYES };
}

export async function fetchWireWeek(week, limit = 150) {
  return (await base.fetchWireWeek(week, limit)).map(withAvg);
}
