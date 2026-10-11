// Stands in for js/notify-load.js when bell-check.mjs boots the top bar: the
// two exports the bell is written against (docs/notifications-plan.md, "After
// review" 2 and 3), reading the same key the real loader writes —
//
//   ff.notes.<leagueId>-<season> = { v: 1, team, week, at, now, soon, idea }
//
// — and fresh for the same three hours. It records every call on
// `globalThis.__bell`, and a test steers it with `globalThis.__bellStub`:
//   { refreshWrites: {now, soon, idea} }   what a recompute saves (default: nothing)
//   { savedThrows: true }                  savedCount() throws
//   { refreshRejects: true }               refresh() rejects

const FRESH_MS = 3 * 60 * 60 * 1000;
const calls = (globalThis.__bell = globalThis.__bell || { saved: 0, refresh: 0 });
const cfg = () => globalThis.__bellStub || {};

function key() {
  const c = JSON.parse(globalThis.localStorage.getItem('ff.connection') || '{}');
  return `ff.notes.${c.leagueId}-${c.season}`;
}

export function savedCount() {
  calls.saved++;
  if (cfg().savedThrows) throw new Error('savedCount blew up');
  const s = JSON.parse(globalThis.localStorage.getItem(key()) || 'null');
  if (!s || s.v !== 1) return { now: 0, soon: 0, idea: 0, fresh: false };
  return { now: s.now, soon: s.soon, idea: s.idea, fresh: Date.now() - s.at < FRESH_MS };
}

export async function refresh() {
  calls.refresh++;
  if (cfg().refreshRejects) throw new Error('refresh blew up');
  const w = cfg().refreshWrites;
  if (w) globalThis.localStorage.setItem(key(), JSON.stringify({ v: 1, team: 1, week: 5, at: Date.now(), ...w }));
}
