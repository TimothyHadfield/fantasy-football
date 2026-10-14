// ESPN's injury designations, read ONE way across the site.
//
// Moved out of js/home-page.js (2026-09-29) so the Trade page's underline —
// Tim: "underline a player's name if they are on the injury report in the home
// section" — uses the very rule Home's injury report uses, not a copy of it.

// ESPN's status strings, worst first. Anything unrecognised is kept rather than
// hidden — a status we don't know the name of is still news.
export const INJURY_RANK = {
  OUT: 3, INJURY_RESERVE: 3, SUSPENSION: 3, NOT_ACTIVE: 3,
  DOUBTFUL: 2,
  QUESTIONABLE: 1, DAY_TO_DAY: 1, PROBABLE: 1,
};

export const INJURY_LABEL = {
  INJURY_RESERVE: 'IR', DAY_TO_DAY: 'Day to day', NOT_ACTIVE: 'Not active',
};

export const healthy = (s) => !s || s === 'ACTIVE' || s === 'NORMAL';

export function injuryLabel(status) {
  if (INJURY_LABEL[status]) return INJURY_LABEL[status];
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function injuryClass(status) {
  const rank = INJURY_RANK[status] ?? 1;
  return rank === 3 ? 'out' : rank === 2 ? 'doubt' : 'quest';
}

/**
 * OUT FOR THE REST OF THE SEASON? The rule js/trade-page.js `outForSeason` bars
 * a man from suggested trades by.
 *
 * `weekValues`: what the page holds of him for each week left, his bye left out
 * (a number, or null for a week with no number).
 *
 * ESPN'S WORD FIRST: when `p.injuryDetails.outForSeason` is known (js/season.js
 * puts it on every out man ESPN spoke for), it is the answer and nothing else
 * is — a man ESPN expects back is not barred however it projects him, and a man
 * it lists as out for the season is barred whatever a week says.
 *
 * NOT KNOWN (the read failed, an older synced copy): the 2026-10-12 rule — a
 * man listed as out (OUT, IR, suspended, not active) and projected at nothing
 * in every week left that the page holds. No week held: not barred.
 */
export function outForSeasonRule(p, weekValues) {
  if (!p || p.playerId === null || p.playerId === undefined) return false;
  const said = p.injuryDetails;
  if (said && typeof said.outForSeason === 'boolean') return said.outForSeason === true;
  if (healthy(p.injuryStatus) || injuryClass(String(p.injuryStatus)) !== 'out') return false;
  const held = (weekValues || []).length;
  for (const v of weekValues || []) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return false;
  }
  return held > 0;
}
