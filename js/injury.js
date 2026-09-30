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
