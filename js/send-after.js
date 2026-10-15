// SEND NOW, OR AFTER WEEK N (Tim, 2026-10-15): "make a button at the top of the
// custom trade menu that says "send ___" that says now, but can be changed so
// that it says "after week ___" so that it only considers the difference in
// proj if the trade is sent after that time ... Adjust all data so it behaves
// as if the trade is actually sent after that date."
//
// Pure arithmetic on a list of weeks, so the page and its tests share it. `span`
// is the weeks still to price, in order. `n` is the week the trade is sent
// AFTER: weeks up to and including it are played on the old rosters, weeks
// after it on the new ones. null = now.

/** The weeks "after week N" can name: every week left that still leaves one after it. */
export function sendAfterChoices(span) {
  return (span || []).slice(0, -1);
}

/**
 * The send week that still means something, or null for "now". A week that has
 * since been played (nothing left at or before it) counts as now.
 */
export function liveSendAfter(n, span) {
  if (n === null || n === undefined || n === '') return null;
  const w = Number(n);
  if (!Number.isFinite(w)) return null;
  return (span || []).some((x) => x <= w) ? w : null;
}

/** The weeks the trade is in force: after week N (all of them for now). */
export function weeksAfter(span, n) {
  const w = liveSendAfter(n, span);
  return w === null ? (span || []).slice() : span.filter((x) => x > w);
}

/** The weeks still to play before it is sent: none for now. */
export function weeksBefore(span, n) {
  const w = liveSendAfter(n, span);
  return w === null ? [] : span.filter((x) => x <= w);
}
