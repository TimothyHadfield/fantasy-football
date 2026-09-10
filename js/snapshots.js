// The time machine: what the app knew, week by week, kept so it can be replayed.
//
// ---------------------------------------------------------------------------
// WHY THIS HAS TO EXIST AT ALL
//
// ESPN publishes a projection for every future week, and the site is built on
// that (see PROGRESS, "Forecasting"). What ESPN does NOT publish is what it
// USED to project. Ask it in week 9 what it thought week 13 would be back in
// week 2 and there is no endpoint, no parameter and no archive — the number was
// overwritten the moment it changed.
//
// So every forecast and every simulation on the schedule page is a reading
// taken at a moment, and the moment cannot be recovered afterwards. If it is
// not captured while it is on screen, it is gone permanently. That is the whole
// justification for storing anything client-side on a site that has, until now,
// deliberately stored nothing but four preferences.
//
// ---------------------------------------------------------------------------
// WHAT IS STORED, AND WHY IT IS SMALL
//
// The obvious approach — keep every week's rosters — is about a megabyte per
// snapshot and would fill browser storage inside a month. It is also
// unnecessary. The forecast and the simulation consume exactly three things:
//
//   1. the schedule, with whatever results existed at the time
//   2. one projected total per team per remaining week   (~180 numbers)
//   3. the strength figure derived from those            (~10 numbers)
//
// Everything else those panels show is derived from that. So a snapshot is a
// few kilobytes, a whole season of them is a few hundred, and the format is
// plain JSON that can be exported, committed to the repo, or read by hand.
//
// The rosters behind the numbers are deliberately NOT kept. That is a real
// limit and it is stated on the page: you can replay what the app concluded,
// not re-derive it from the players it concluded it from.
//
// ---------------------------------------------------------------------------
// WHERE IT LIVES
//
// One localStorage key per snapshot, never one key for all of them: a quota
// failure while saving week 9 must not take weeks 1 to 8 with it, and reading
// one week must not parse the whole season. `js/prefs.js` keeps its single
// small blob and is untouched by this — a few hundred kilobytes of history
// rewritten on every sort-order change would be absurd.
//
// Browser storage is not durable. It goes when site data is cleared, and it
// never existed in a private window. `exportAll` is the answer to that and the
// page nags about it; the file it produces is the same JSON, and dropping it
// into the repo is what makes a season's history permanent.

const PREFIX = 'ff.snap';

/** Bump only for a change old files cannot be read through. */
export const SCHEMA = 1;

/** Refuse to store something absurd rather than blowing the whole quota. */
const MAX_BYTES = 400 * 1024;

const round1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

/** Storage, or null when the browser will not give us any. */
function store() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    // Some browsers expose the object and throw on use. Prove it works.
    const probe = `${PREFIX}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function available() {
  return store() !== null;
}

/** `ff.snap.<league>.<season>.<week>` — one key, one snapshot. */
export function keyOf(leagueId, season, week) {
  return `${PREFIX}.${leagueId}.${season}.${week}`;
}

// ------------------------------------------------------------------ writing

/**
 * Freeze what the schedule page is currently showing.
 *
 * Only the fields the page actually reads are copied. A snapshot is a record,
 * not a backup, and carrying ESPN's whole payload into it would make the format
 * impossible to read by hand and impossible to keep stable.
 *
 * @param {Object} o
 * @param {string} o.leagueId  'demo' for sample data, so the two never mix
 * @param {number} o.week      the week this is a view "as of"
 * @param {Object} o.data      state.data — the normalised schedule
 * @param {Object|null} o.projection  state.projection, when one was built
 */
export function snapshotFrom({
  leagueId, season, week, data, projection, strengthNote, sigma, calibrated, sample,
}) {
  if (!data) return null;

  const proj = {};
  if (projection && projection.proj) {
    for (const [w, byTeam] of projection.proj) {
      const row = {};
      for (const [teamId, v] of byTeam) row[teamId] = round1(v);
      proj[w] = row;
    }
  }

  const strength = {};
  if (projection && projection.strength) {
    for (const [teamId, v] of projection.strength) strength[teamId] = round1(v);
  }

  return {
    v: SCHEMA,
    leagueId: String(leagueId),
    season: Number(season),
    week: Number(week),
    takenAt: new Date().toISOString(),
    isDemo: Boolean(data.isDemo),
    leagueName: data.leagueName,
    teams: data.teams.map((t) => ({ id: t.id, name: t.name })),
    // Every field gameState(), winnerOf() and projectedPoints() read, and no
    // others. `played` matters as much as the scores: it is what separates a
    // finished game from one still being played.
    games: data.games.map((g) => ({
      week: g.week,
      homeId: g.homeId ?? null,
      homeName: g.homeName ?? '',
      homeScore: g.homeScore ?? null,
      homeProjected: g.homeProjected ?? null,
      awayId: g.awayId ?? null,
      awayName: g.awayName ?? '',
      awayScore: g.awayScore ?? null,
      awayProjected: g.awayProjected ?? null,
      played: Boolean(g.played),
    })),
    proj,
    strength,
    slots: projection && projection.slots ? projection.slots.slice() : null,
    weeksCovered: projection && projection.weeksCovered ? projection.weeksCovered.slice() : [],
    projNote: (projection && projection.note) || '',
    strengthNote: strengthNote || '',
    // Kept because it is DERIVED FROM RESULTS and therefore moves as the season
    // goes on: replaying with today's sigma would quietly re-forecast the past
    // with knowledge it did not have.
    sigma: typeof sigma === 'number' ? sigma : null,
    sigmaCalibrated: Boolean(calibrated),
    sigmaSample: typeof sample === 'number' ? sample : 0,
  };
}

/**
 * Write one snapshot.
 *
 * @returns {{ok: boolean, reason?: string, bytes?: number}}
 */
export function save(snap) {
  if (!snap || !snap.leagueId || !Number.isFinite(snap.week)) {
    return { ok: false, reason: 'That is not a snapshot.' };
  }
  const s = store();
  if (!s) return { ok: false, reason: 'This browser is not letting the site store anything.' };

  const json = JSON.stringify(snap);
  if (json.length > MAX_BYTES) {
    return { ok: false, reason: `That snapshot is ${Math.round(json.length / 1024)}KB, which is too big to keep.` };
  }
  try {
    s.setItem(keyOf(snap.leagueId, snap.season, snap.week), json);
    return { ok: true, bytes: json.length };
  } catch {
    return {
      ok: false,
      reason: 'Browser storage is full. Export the archive, then delete a week or two.',
    };
  }
}

export function remove(leagueId, season, week) {
  const s = store();
  if (!s) return false;
  try {
    s.removeItem(keyOf(leagueId, season, week));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ reading

/** One snapshot, or null. Anything unreadable is treated as absent. */
export function get(leagueId, season, week) {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(keyOf(leagueId, season, week));
    if (!raw) return null;
    const snap = JSON.parse(raw);
    return snap && snap.v === SCHEMA ? snap : null;
  } catch {
    return null;
  }
}

/**
 * Every snapshot for one league, oldest week first.
 *
 * Scans the keys rather than keeping an index. An index is one more thing that
 * can disagree with the truth, and a browser holding twenty of these has
 * nothing to gain from avoiding a twenty-key scan.
 */
export function list(leagueId, season) {
  const s = store();
  if (!s) return [];
  const want = `${PREFIX}.${leagueId}.${season}.`;
  const out = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k || !k.startsWith(want)) continue;
      try {
        const snap = JSON.parse(s.getItem(k));
        if (snap && snap.v === SCHEMA) out.push(snap);
      } catch {
        /* one unreadable key must not hide the rest */
      }
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => a.week - b.week);
}

// ------------------------------------------------------------------ replaying

/**
 * Turn a snapshot back into the shapes the page renders from.
 *
 * The result is deliberately the SAME shape `normalizeSchedule` and
 * `buildProjection` produce, so replaying is a substitution rather than a
 * second rendering path. A second path is how the archive would start
 * disagreeing with the live page about what it is showing.
 */
export function hydrate(snap) {
  if (!snap || snap.v !== SCHEMA) return null;

  const games = snap.games.map((g) => ({ ...g }));
  const byWeek = new Map();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
  }

  const data = {
    leagueName: snap.leagueName,
    teams: snap.teams.map((t) => ({ id: t.id, name: t.name })),
    weeks: [...byWeek.keys()].sort((a, b) => a - b),
    byWeek,
    games,
    isDemo: Boolean(snap.isDemo),
  };

  const weeks = Object.keys(snap.proj || {});
  let projection = null;
  if (weeks.length) {
    const proj = new Map();
    for (const w of weeks) {
      const row = new Map();
      for (const [teamId, v] of Object.entries(snap.proj[w])) row.set(Number(teamId), v);
      proj.set(Number(w), row);
    }
    projection = {
      proj,
      slots: snap.slots || [],
      strength: new Map(
        Object.entries(snap.strength || {}).map(([id, v]) => [Number(id), v])
      ),
      weeksCovered: snap.weeksCovered || [],
      note: snap.projNote || '',
    };
  }

  return { data, projection, strengthNote: snap.strengthNote || '' };
}

// ------------------------------------------------------------ export / import

/** The file that makes a season's history outlive this browser. */
export function exportAll(leagueId, season) {
  const snapshots = list(leagueId, season);
  return {
    name: `fantasy-archive-${leagueId}-${season}.json`,
    json: JSON.stringify(
      { v: SCHEMA, exportedAt: new Date().toISOString(), leagueId: String(leagueId), season, snapshots },
      null,
      2
    ),
    count: snapshots.length,
  };
}

/**
 * Read an exported file back.
 *
 * Accepts the envelope `exportAll` writes and a bare snapshot alike, because
 * the difference is invisible to anyone looking at the file and being strict
 * about it would only ever cost somebody their archive.
 */
export function parseImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { snapshots: [], error: 'That file is not JSON.' };
  }

  const list_ = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed && parsed.snapshots)
      ? parsed.snapshots
      : [parsed];

  const snapshots = list_.filter(
    (s) => s && s.v === SCHEMA && s.leagueId && Number.isFinite(s.week) && Array.isArray(s.games)
  );
  if (!snapshots.length) {
    return {
      snapshots: [],
      error:
        parsed && parsed.v && parsed.v !== SCHEMA
          ? `That file is version ${parsed.v}; this build reads version ${SCHEMA}.`
          : 'No snapshots in that file.',
    };
  }
  return { snapshots, error: null };
}

/**
 * Store imported snapshots.
 *
 * A week already held is kept, not overwritten. An import is a restore, and the
 * copy already here was taken by this browser at the time — closer to the truth
 * than one that has been round a file. `replace` is for when the caller has
 * decided otherwise.
 */
export function importAll(snapshots, { replace = false } = {}) {
  let added = 0;
  let kept = 0;
  const failed = [];
  for (const snap of snapshots) {
    if (!replace && get(snap.leagueId, snap.season, snap.week)) { kept++; continue; }
    const res = save(snap);
    if (res.ok) added++;
    else failed.push(`week ${snap.week}: ${res.reason}`);
  }
  return { added, kept, failed };
}

// ------------------------------------------------------- the archive in the repo
//
// Browser storage is where readings are TAKEN and the repo is where they are
// KEPT. One export, committed under `data/snapshots/`, and the history stops
// depending on one browser on one machine: it is versioned, readable from a
// phone, and — the part that matters most — it restores itself. Open the page in
// a browser that has never seen this league and the committed archive is pulled
// back down before anything else happens.
//
// The route in is deliberately a person: a page cannot commit to a repo without
// a token, and a token in client-side JavaScript is a public token. So the
// export lands in a Downloads folder and gets committed by hand. That is one
// click every few weeks against a backend to run, and it buys version history
// for free.
//
// There is NO index file. `data/snapshots/<league>-<season>.json` either exists
// or it does not, which is one request and nothing to keep in step — an index
// is one more thing that can disagree with the directory beside it.

/** Where this league's committed archive would live, if it has one. */
export function remoteUrl(leagueId, season) {
  return `data/snapshots/${encodeURIComponent(leagueId)}-${encodeURIComponent(season)}.json`;
}

/**
 * Pull the committed archive into this browser.
 *
 * Imported rather than held separately, so everything downstream — the picker,
 * replaying, exporting — has one source to read and cannot start disagreeing
 * about which archive it is showing. A week this browser already holds is kept:
 * it was recorded here at the time, which is closer to the truth than a copy
 * that has been round a file.
 *
 * EVERY failure is silent and returns zero. A missing file is the normal case
 * for a league nobody has exported yet, and being offline, or on a fork of the
 * site with no `data/` directory, must not stop the page loading.
 */
export async function fetchRemote(leagueId, season, { fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return { added: 0, kept: 0, found: 0 };

  let text;
  try {
    const res = await f(remoteUrl(leagueId, season), { cache: 'no-cache' });
    if (!res || !res.ok) return { added: 0, kept: 0, found: 0 };
    text = await res.text();
  } catch {
    return { added: 0, kept: 0, found: 0 };
  }

  const { snapshots: found } = parseImport(text);
  if (!found.length) return { added: 0, kept: 0, found: 0 };

  // Only this league's, however the file was assembled by hand.
  const mine = found.filter(
    (s) => String(s.leagueId) === String(leagueId) && Number(s.season) === Number(season)
  );
  if (!mine.length) return { added: 0, kept: 0, found: found.length };

  const res = importAll(mine);
  // The WEEKS, not just how many. A caller needs to know which readings are
  // safely in the repo in order to say which ones are still only in this
  // browser — which is the difference between "export sometime" and "export
  // now", and the only thing about this feature the reader has to act on.
  return { ...res, found: mine.length, weeks: mine.map((s) => s.week).sort((a, b) => a - b) };
}

/** Roughly how much room the archive is taking, for the panel note. */
export function sizeOf(leagueId, season) {
  const s = store();
  if (!s) return 0;
  let bytes = 0;
  const want = `${PREFIX}.${leagueId}.${season}.`;
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(want)) bytes += (s.getItem(k) || '').length;
    }
  } catch {
    return 0;
  }
  return bytes;
}
