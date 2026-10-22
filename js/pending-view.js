// THE PENDING MOVES IN WORDS — one set of words for every page that shows them
// (Home, Notifications, Trade, Players), so a claim or an offer reads the same
// wherever it is.
//
// Tim, 2026-10-22: "If someone sent a trade or I sent a trade, then That should
// be an automatically saved trade on the cite with a label of some sort saying
// it's a pending move and showing the deadline. If I have a player being pulled
// from the waivers that should show up somewhere. All of these types of things
// should be shown."
//
// Pure: no DOM, no request, no storage. The moves are js/season.js
// `fetchPendingMoves()`'s (shapes in js/pending.js). Every time is the
// browser's own clock zone.

const SIX_DAYS = 6 * 24 * 60 * 60 * 1000;

/**
 * "Wed 3:00 AM" for a time in the coming six days (a day's name then means one
 * day), "Oct 30, 3:00 AM" otherwise; '' for no time.
 */
export function whenText(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  const ahead = ms - now;
  if (Number.isFinite(ahead) && ahead > -SIX_DAYS && ahead < SIX_DAYS) {
    return `${d.toLocaleString('en-US', { weekday: 'short' })} ${time}`;
  }
  return `${d.toLocaleString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

/** An offer's clock in words: "expires Sat 3:00 PM", "processes Wed 8:05 AM", or ''. */
export function offerDeadline(o, now = Date.now()) {
  if (!o) return '';
  const at = o.review === true ? o.processAt : o.expiresAt;
  // A time already gone says nothing useful (the line is about to go too).
  if (!Number.isFinite(at) || (Number.isFinite(now) && at <= now)) return '';
  const w = whenText(at, now);
  return w ? `${o.review === true ? 'processes' : 'expires'} ${w}` : '';
}

/** Who it is waiting on: "Sent by you", "From Bob", "Accepted". */
export function offerWho(o, partnerName) {
  if (!o) return '';
  if (o.review === true) return 'Accepted';
  if (o.fromMe === true) return 'Sent by you';
  return `From ${partnerName || 'another team'}`;
}

/** "Add Jaxon Smith, drop Kyle Pitts" — the men of one claim, or what kind of move it is. */
export function claimWhat(c) {
  if (!c) return '';
  const add = c.add !== null && c.add !== undefined ? (c.addName || 'a player') : null;
  const drop = c.drop !== null && c.drop !== undefined ? (c.dropName || 'a player') : null;
  if (add && drop) return `Add ${add}, drop ${drop}`;
  if (add) return `Add ${add}`;
  if (drop) return `Drop ${drop}`;
  if (c.moves > 0) return `${c.moves} lineup move${c.moves === 1 ? '' : 's'}`;
  return 'A move';
}

/** The short title a move goes under. */
export function claimTitle(c) {
  if (!c) return '';
  if (c.kind === 'waiver') return 'Waiver claim';
  if (c.kind === 'free-agent') return 'Free-agent add';
  if (c.kind === 'drop') return 'Drop';
  if (c.kind === 'lineup') return 'Lineup change';
  return 'Pending move';
}

/** "$7 bid · claim 1 · processes Wed 3:00 AM": what is known of its clock and price. */
export function claimDetail(c, now = Date.now()) {
  if (!c) return '';
  const parts = [];
  // A bid of 0 is a priority league's (or a $0 bid): not worth a word.
  if (Number.isFinite(c.bid) && c.bid > 0) parts.push(`$${c.bid} bid`);
  if (c.kind === 'waiver' && Number.isInteger(c.order) && c.order > 0) parts.push(`claim ${c.order}`);
  const w = whenText(c.processAt, now);
  if (w) parts.push(`processes ${w}`);
  return parts.join(' · ');
}
