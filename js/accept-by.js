// WHEN A TRADE MUST BE ACCEPTED to have the men you get in time for a week.
//
// Tim, 2026-09-30: "calculate when that official date and time is for when the
// trade needs to be ACCEPTED (not just sent) in order for you to actually
// recieve those players by that time" — and "it says our trade review period is
// 1 day in our league rules."
//
// ESPN holds an accepted trade for the league's review period (`revisionHours`,
// read by `espn.parseTrades`) before the men change squads. So the men you get
// are yours for a week only if the trade is accepted at least that long before
// the first of them kicks off that week:
//
//   accept by = earliest kickoff, among the men you RECEIVE, in that week
//               − the league's review period
//
// A man on bye that week has no kickoff and does not count. If that moment has
// passed, the answer is the first later week it has not. The league's trade
// deadline caps it: a trade cannot be accepted after it, whatever the review.
//
// Pure: no DOM, no clock of its own (`now` is passed), so the node test can
// pin every branch.

/**
 * @param {Object} o
 * @param {Array<number|null>} o.teams   pro team ids of the men you receive
 * @param {Object} o.kickoffs            `{ [proTeamId]: { [week]: epochMs } }`
 *                                       (`espn.parseProKickoffs`); empty = unknown
 * @param {number[]} o.weeks             fantasy weeks still to come, ascending
 * @param {number|null} o.reviewHours    the league's review period; null = ESPN did not say
 * @param {number|null} o.deadline       the league's trade deadline (epoch ms), or null
 * @param {number} o.now                 epoch ms
 * @returns {null | {kind:'closed'} | {kind:'rule', week:number, kickoff:number, late:number[]}
 *   | {kind:'by', week:number, at:number, kickoff:number, capped:boolean, late:number[]}}
 *   null when there is nothing to say (nobody received, or no kickoff known).
 *   `late` lists the weeks with a known kickoff that it is already too late for.
 *   `capped` means the trade deadline comes first, and `at` is the deadline.
 */
export function acceptBy({ teams, kickoffs, weeks, reviewHours, deadline, now }) {
  const hasDeadline = Number.isFinite(deadline) && deadline > 0;
  if (hasDeadline && now >= deadline) return { kind: 'closed' };
  const ids = (teams || []).filter((t) => t !== null && t !== undefined);
  if (!ids.length || !kickoffs || !Object.keys(kickoffs).length) return null;
  const review = Number.isFinite(reviewHours) && reviewHours >= 0 ? reviewHours * 3600000 : null;

  const late = [];
  for (const week of weeks || []) {
    let kickoff = Infinity;
    for (const id of ids) {
      const ms = kickoffs[id] && kickoffs[id][week];
      if (Number.isFinite(ms) && ms < kickoff) kickoff = ms;
    }
    if (kickoff === Infinity) continue;          // every man you get is on bye (or unknown)
    if (review === null) {
      if (kickoff <= now) { late.push(week); continue; }
      return { kind: 'rule', week, kickoff, late };
    }
    const at = kickoff - review;
    if (at <= now) { late.push(week); continue; }
    if (hasDeadline && deadline < at) return { kind: 'by', week, at: deadline, kickoff, capped: true, late };
    return { kind: 'by', week, at, kickoff, capped: false, late };
  }
  return null;
}

/**
 * THE WEEK THE TRADE DEADLINE FALLS IN, for the red line on the Trade page's
 * player cards (Tim, 2026-10-22: "my league settings have it at Dec 2nd, which
 * is during week 13, so put the red line between weeks 12 and 13").
 *
 * An NFL week runs from the day after the previous week's last game to its own
 * last game, so the deadline's week is the FIRST week whose LAST kickoff is at
 * or after the deadline. Dec 2 2026 (a Wednesday): week 12's last game is
 * Monday Nov 30, week 13's is Monday Dec 7, so week 13 — line before it.
 *
 * @param {Object} o
 * @param {number|null} o.deadline   epoch ms (`espn.parseTrades`), null/0 = none
 * @param {Object} o.kickoffs        `{ [proTeamId]: { [week]: epochMs } }`
 * @returns {number|null} the week, or null (no deadline, no kickoffs, or the
 *   deadline is after every known game)
 */
export function deadlineWeekOf({ deadline, kickoffs } = {}) {
  if (!Number.isFinite(deadline) || deadline <= 0 || !kickoffs) return null;
  const last = new Map();
  for (const byWeek of Object.values(kickoffs)) {
    for (const [w, ms] of Object.entries(byWeek || {})) {
      const week = Number(w);
      if (!Number.isFinite(week) || !Number.isFinite(ms)) continue;
      if (!last.has(week) || ms > last.get(week)) last.set(week, ms);
    }
  }
  const weeks = [...last.keys()].sort((a, b) => a - b);
  for (const week of weeks) if (last.get(week) >= deadline) return week;
  return null;
}
