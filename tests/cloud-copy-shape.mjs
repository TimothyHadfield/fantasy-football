// The phone's synced copy, as test stubs hand it out from `cloudSource()`.
//
// `season.cloudSource()` returns js/cloud.js `readDown`'s result unchanged, so
// a stub must return that SAME shape: every key, no invented ones. Stubs used
// to make up a `weeks` field the real one never had (sweep 2026-10-16 row 1),
// which is how the phone's empty Notifications went unnoticed. test-cloud.mjs
// holds this builder's keys against a real `readDown` against a strict fake
// Firestore, so the two cannot drift apart again.
//
//   syncedCopy({ weeks: { rosters, wire }, byes, rosters: Map, wire: Map, schedule, ageMs })

function age(shape, iso, now) {
  const limit = { rosters: 7 * 24 * 3600e3, wire: 24 * 3600e3 }[shape];
  const ageMs = iso ? Math.max(0, now - Date.parse(iso)) : null;
  const hours = ageMs === null ? null : Math.round(ageMs / 3600e3);
  return {
    syncedAt: iso,
    ageMs,
    described: ageMs === null ? 'never' : `${hours} hour${hours === 1 ? '' : 's'} ago`,
    stale: ageMs === null ? true : Boolean(limit && ageMs > limit),
  };
}

export function syncedCopy({
  leagueId = '1241838',
  season = 2026,
  leagueName = 'Stub League',
  teams = [],
  byes = {},
  schedule = null,
  rosters = new Map(),
  wire = new Map(),
  weeks = { rosters: [], wire: [] },
  ageMs = 2 * 60 * 60 * 1000,
  now = Date.now(),
} = {}) {
  const syncedAt = new Date(now - ageMs).toISOString();
  return {
    ok: true,
    found: true,
    leagueId: String(leagueId),
    season: Number(season),
    leagueName,
    teams,
    byes,
    schedule,
    rosters,
    wire,
    missing: [],
    weeks: { rosters: [...(weeks.rosters || [])], wire: [...(weeks.wire || [])] },
    reason: '',
    reads: 1,
    syncedAt,
    ages: {
      rosters: age('rosters', syncedAt, now),
      wire: age('wire', syncedAt, now),
      schedule: age('schedule', syncedAt, now),
    },
  };
}
