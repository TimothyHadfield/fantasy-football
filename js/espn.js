// ESPN Fantasy Football API connection layer.
//
// This module ONLY fetches and decodes data. It makes no decisions about
// draft strategy, rankings, or scoring — that belongs elsewhere.
//
// Requests go straight from the browser to ESPN. That works because ESPN
// reflects our Origin and sets Access-Control-Allow-Credentials: true, so
// `credentials: 'include'` carries your existing espn.com login cookies.
// Public leagues need no login at all.

import * as bridge from './bridge.js';

const HOST = 'https://lm-api-reads.fantasy.espn.com';

// ---------------------------------------------------------------- ID decoding
// These maps are facts about ESPN's schema, not opinions.

export const POSITIONS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };

export const SLOT_LABELS = {
  0: 'QB', 1: 'TQB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE',
  7: 'OP', 16: 'D/ST', 17: 'K', 18: 'P', 19: 'HC', 20: 'BE', 21: 'IR',
  23: 'FLEX',
};

// Which positions may legally occupy each lineup slot.
export const SLOT_ELIGIBILITY = {
  0: ['QB'], 2: ['RB'], 4: ['WR'], 6: ['TE'], 16: ['DST'], 17: ['K'],
  3: ['RB', 'WR'], 5: ['WR', 'TE'], 23: ['RB', 'WR', 'TE'],
  7: ['QB', 'RB', 'WR', 'TE'],
};

export const PRO_TEAMS = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
  15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI',
  22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

// ------------------------------------------------------------------- settings

let config = { leagueId: '', season: 2026 };

export function configure({ leagueId, season }) {
  if (leagueId !== undefined) config.leagueId = String(leagueId).trim();
  if (season !== undefined) config.season = Number(season);
  return { ...config };
}

export function getConfig() {
  return { ...config };
}

/** Raised when ESPN says we aren't allowed to see this league. */
export class AuthError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'AuthError';
  }
}

// ------------------------------------------------------------------ transport

async function request(path, { filter } = {}) {
  const headers = { Accept: 'application/json' };
  if (filter) headers['x-fantasy-filter'] = JSON.stringify(filter);

  let res;
  try {
    res = await fetch(HOST + path, { headers, credentials: 'include' });
  } catch (err) {
    // A network-level failure here is usually the browser blocking the
    // cross-site cookie, not ESPN being down.
    throw new Error(
      'Could not reach ESPN. If this is a private league, your browser may be ' +
      'blocking cross-site cookies for espn.com. Details: ' + err.message
    );
  }

  if (res.status === 401 || res.status === 403) {
    // This is the expected answer for a private league, and being logged in to
    // espn.com is usually NOT enough to fix it. The page is served from a
    // different site than ESPN, so sending your ESPN cookies is a third-party
    // cookie — which Safari and Firefox block outright and Chrome increasingly
    // does too. A browser page also cannot set the Cookie header itself, so
    // the espn_s2/SWID trick that server-side tools use is not available here.
    //
    // The reliable fix is on ESPN's side: a league marked viewable to the
    // public needs no cookies at all.
    throw new AuthError(
      `ESPN will not show league ${config.leagueId} to this site. The fix is one ` +
      'setting: on espn.com open your league, then LM Tools → League Settings ' +
      '→ Basic Settings, and set "Make League Viewable to Public" to Yes. ' +
      'That makes the league readable without any login, which is what a site ' +
      'like this one needs. It is read-only visibility — nobody can join, ' +
      'edit or transact. Being logged in to espn.com does not help on its own, ' +
      'because your browser will not send ESPN cookies to a different site.'
    );
  }
  if (res.status === 404) {
    throw new Error(`League ${config.leagueId} not found for season ${config.season}.`);
  }
  if (!res.ok) {
    throw new Error(`ESPN returned HTTP ${res.status}.`);
  }
  return res.json();
}

function leaguePath(views = []) {
  if (!config.leagueId) throw new Error('No league ID configured.');
  const qs = views.length ? '?' + views.map((v) => `view=${v}`).join('&') : '';
  return `/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}${qs}`;
}

/**
 * How long a finished league read is shared with later identical reads.
 *
 * Several parts of one page ask ESPN the same question within seconds — the
 * stats page reads the matchups for its table and again for schedule luck, and
 * the background cloud sync re-reads every week's rosters a page has just
 * fetched. Sixty seconds covers those without letting anything go meaningfully
 * stale; the wire, the shape that decays fastest, is fine at a minute.
 */
const SHARE_MS = 60 * 1000;

/** key -> { promise, settledAt } — in flight when settledAt is null. */
const shared = new Map();

/** Views whose whole point is to change between two reads a few seconds apart. */
const UNSHARED_VIEWS = new Set(['mDraftDetail', 'mTransactions2']);

/**
 * One league read, through the bridge extension when it is installed and by
 * direct fetch when it is not.
 *
 * Routing here rather than at each call site means every page that already
 * uses this module gets private-league access for free the moment the
 * extension appears, with no changes of their own.
 *
 * IDENTICAL READS SHARE ONE PROMISE — same league, season, route, views, week
 * and filter — while one is in flight and for SHARE_MS after it lands. A
 * FAILURE IS NEVER SHARED: the entry is dropped the moment the read rejects,
 * so a retry really does ask again. Callers must treat the payload as
 * read-only, which every decoder in this file and in season.js already does.
 */
async function leagueRead(views, opts = {}) {
  if (!config.leagueId) throw new Error('No league ID configured.');

  // Wait for the extension's hello before choosing a route — see
  // `bridge.settled`. Asking too early sent a private league's first read
  // straight to ESPN, which refused it.
  await bridge.settled();

  // Reads that exist to be POLLED are never shared: the draft page asks for
  // the draft every four seconds, and a minute-old answer would freeze it.
  if (views.some((v) => UNSHARED_VIEWS.has(v))) return leagueReadNow(views, opts);

  const key = JSON.stringify([
    config.leagueId, config.season, bridge.isAvailable() ? 'bridge' : 'direct',
    views, opts.scoringPeriodId ?? null, opts.filter ?? null,
  ]);
  const now = Date.now();
  for (const [k, e] of shared) {
    if (e.settledAt !== null && now - e.settledAt > SHARE_MS) shared.delete(k);
  }
  const hit = shared.get(key);
  if (hit) return hit.promise;

  const entry = { promise: null, settledAt: null };
  entry.promise = leagueReadNow(views, opts).then(
    (data) => { entry.settledAt = Date.now(); return data; },
    (err) => { if (shared.get(key) === entry) shared.delete(key); throw err; }
  );
  shared.set(key, entry);
  return entry.promise;
}

/** Forget every shared read. For tests, and for anything that must re-ask. */
export function clearReadCache() {
  shared.clear();
}

async function leagueReadNow(views, { filter, scoringPeriodId } = {}) {
  if (bridge.isAvailable()) {
    const res = await bridge.league({
      leagueId: config.leagueId,
      season: config.season,
      views,
      scoringPeriodId,
      filter,
    });
    if (res.ok) return res.data;
    if (res.status === 401 || res.status === 403) throw new AuthError(res.error);
    throw new Error(res.error || 'The bridge extension could not read the league.');
  }

  let path = leaguePath(views);
  if (scoringPeriodId) path += `&scoringPeriodId=${scoringPeriodId}`;
  return request(path, { filter });
}

// --------------------------------------------------------------------- reads

/** Raw league payload. Pass whichever views you need. */
export function fetchLeague(views = ['mSettings', 'mTeam']) {
  return leagueRead(views);
}

/** Draft picks and draft status. This is what you'd poll during a live draft. */
export function fetchDraft() {
  return leagueRead(['mDraftDetail']);
}

/** Every team's current roster. */
export function fetchRosters(scoringPeriodId) {
  return leagueRead(['mRoster', 'mTeam'], { scoringPeriodId });
}

/**
 * Matchups and scores for the season.
 *
 * `mSettings` rides along because nothing else on this read carries
 * `settings`: without it (checked against league 1241838, 2026-09-16) the
 * league's name decoded as "League" and every playoff setting — field size,
 * regular-season length — as null, so the pages fell back to guesses. It adds
 * about 8 KB to a 276 KB answer.
 */
export function fetchMatchups() {
  return leagueRead(['mMatchupScore', 'mTeam', 'mSettings']);
}

/** Adds, drops, trades, waiver claims. */
export function fetchTransactions() {
  return leagueRead(['mTransactions2']);
}

/**
 * The player pool. Projections come back scored under THIS league's rules
 * because we query through the league path rather than ESPN's defaults.
 *
 * @param {number} limit how many players to pull, ordered by draft rank
 */
export async function fetchPlayers(limit = 500) {
  const s = config.season;
  const filter = {
    players: {
      limit,
      // Ask for: this season's projection, this season's actuals,
      // and last season's actuals.
      filterStatsForTopScoringPeriodIds: {
        value: 2,
        additionalValue: [`00${s}`, `10${s}`, `00${s - 1}`],
      },
      sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' },
    },
  };
  const data = await leagueRead(['kona_player_info'], { filter });
  return (data.players || []).map((e) => normalizePlayer(e, s));
}

/**
 * Everyone who is not on a roster, with their projection for ONE week.
 *
 * Two traps here, both established by testing against a real league rather
 * than reasoned about:
 *
 * 1. The week comes from `scoringPeriodId` on the URL, and it only works when
 *    `filterStatsForTopScoringPeriodIds` is ABSENT. Sending both — which is
 *    what `fetchPlayers` does for the season totals it wants — silently
 *    suppresses the weekly stat line entirely and you get no projection at all.
 * 2. There is no bulk form. Asking for thirteen weekly stat-set ids in
 *    `additionalValue` returns only the current week. A season of weeks costs a
 *    request per week, exactly like rosters do.
 *
 * @param {number} scoringPeriodId the week to price
 * @param {number} [limit] how many players, ordered by how widely owned
 * @returns {Promise<Array>} raw player entries; decode with parseFreeAgent
 */
export function fetchFreeAgents(scoringPeriodId, limit = 150) {
  const filter = {
    players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
      limit,
      // Most-owned first: that is the order in which a waiver wire is worth
      // reading, and it is what ESPN's own list does.
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  return leagueRead(['kona_player_info'], { filter, scoringPeriodId });
}

/**
 * One free-agent entry, reduced to what the add-players table shows.
 *
 * @param {Object} entry a `players[]` element from fetchFreeAgents
 * @param {number} week the scoringPeriodId that entry was fetched for
 */
export function parseFreeAgent(entry, week) {
  const p = entry?.player || {};
  const weekly = (p.stats || []).find(
    (s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === week
  );
  const seasonProj = (p.stats || []).find(
    (s) => s.statSourceId === 1 && s.statSplitTypeId === 0 && s.seasonId === config.season
  );

  return {
    playerId: p.id,
    name: p.fullName || '',
    position: POSITIONS[p.defaultPositionId] || 'UNK',
    proTeam: PRO_TEAMS[p.proTeamId] ?? 'FA',
    proTeamId: p.proTeamId ?? null,
    injuryStatus: p.injuryStatus || 'ACTIVE',
    percentOwned: p.ownership?.percentOwned ?? null,
    seasonProjected: seasonProj?.appliedTotal ?? null,
    // The projection for the week this was fetched for. Null means ESPN had
    // nothing, which is NOT the same as a bye — a bye comes back as 0.
    projected: typeof weekly?.appliedTotal === 'number' ? weekly.appliedTotal : null,
    // Whether he can be added straight away or has to clear waivers first.
    // Both ride on the ENTRY, not on `player` (verified against league 1241838,
    // 2026-09-16): `status` is 'FREEAGENT' or 'WAIVERS', and a WAIVERS entry
    // carries `waiverProcessDate`, epoch milliseconds. Anything else is null —
    // "ESPN did not say", never "free agent".
    status: entry?.status === 'WAIVERS' || entry?.status === 'FREEAGENT' ? entry.status : null,
    waiverClears:
      entry?.status === 'WAIVERS' && Number.isFinite(entry?.waiverProcessDate) && entry.waiverProcessDate > 0
        ? entry.waiverProcessDate
        : null,
  };
}

/** Bye weeks by pro team id. */
export async function fetchByeWeeks() {
  const view = 'proTeamSchedules_wl';
  let data;
  await bridge.settled();
  if (bridge.isAvailable()) {
    const res = await bridge.seasonView({ season: config.season, view });
    if (!res.ok) throw new Error(res.error || 'Could not read the season schedule.');
    data = res.data;
  } else {
    data = await request(`/apis/v3/games/ffl/seasons/${config.season}?view=${view}`);
  }
  const byes = {};
  for (const t of data.settings?.proTeams || []) {
    if (t.byeWeek) byes[t.id] = t.byeWeek;
  }
  return byes;
}

// ------------------------------------------------- people, not team names
//
// A squad's ESPN `name` is a joke name people change mid-season. The PERSON
// behind it is in a separate league-level array, `raw.members`, and the join is
// `teams[i].owners[]` / `teams[i].primaryOwner` -> `members[j].id` (both are
// SWID strings like `{XXXXXXXX-....}`).
//
// Two traps, both established by probing live leagues — see
// `docs/espn-draft-api.md` §7:
//
// 1. **`members[].firstName` / `.lastName` are only populated when the request
//    asks for `view=mTeam`.** Every other shape — no view at all, or the
//    plausible-looking `view=mMembers` — returns the same `members` array with
//    `displayName` present and the name fields MISSING. So "no real names" can
//    mean "wrong view", not "ESPN withholds them".
// 2. **`members` can be longer than `teams`** (a league member who owns no
//    squad), and a team can carry two owners, whose `primaryOwner` is not
//    necessarily `owners[0]`.
//
// Everything here degrades to the team name, so a payload with no members (a
// bridge read without mTeam, a stub, an old snapshot) behaves exactly as it did
// before names existed.

/** The person behind one `members[]` entry, or null if ESPN named nobody. */
function personName(member) {
  const full = [member?.firstName, member?.lastName]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(' ');
  // displayName is the ESPN handle ("justlikepudge"). It is a poor label but a
  // far better one than a SWID, so it is the last resort before giving up.
  return full || (member?.displayName || '').trim() || null;
}

/**
 * SWID -> person's name, from a league payload's `members` array.
 *
 * Keys are upper-cased: ESPN returned matching casing on both sides of the join
 * in every league observed, but a lookup that silently misses would show a joke
 * name with no error, so the normalisation is cheap insurance.
 *
 * @param {Object} raw a league payload fetched with `view=mTeam`
 * @returns {Map<string, string>} empty when the payload carries no members
 */
export function memberNames(raw) {
  const out = new Map();
  for (const m of raw?.members || []) {
    const name = personName(m);
    if (m?.id && name) out.set(String(m.id).toUpperCase(), name);
  }
  return out;
}

/** Two co-owners are shown; beyond that the rest are counted, not listed. */
function joinOwners(names) {
  if (names.length <= 2) return names.join(' & ');
  return `${names[0]} & ${names[1]} +${names.length - 2}`;
}

/**
 * How a squad should be labelled on every page.
 *
 * The person's name is the primary label, because that is what the league calls
 * each other; the ESPN team name is kept alongside it as `teamName` so a page
 * can still show the thing he sees inside ESPN.
 *
 * @param {Object} t one `raw.teams[]` entry
 * @param {Map<string,string>} names from `memberNames(raw)`
 * @returns {{name: string, teamName: string, owner: ?string, ownerNames: string[]}}
 */
export function teamIdentity(t, names) {
  const teamName =
    (t?.name || `${t?.location || ''} ${t?.nickname || ''}`).trim() || `Team ${t?.id}`;

  // primaryOwner first: in a two-owner squad it was NOT owners[0] (league
  // 643894, team 9), and the primary owner is the one the league thinks of as
  // holding the team.
  const ids = [];
  for (const id of [t?.primaryOwner, ...(t?.owners || [])]) {
    const key = id ? String(id).toUpperCase() : '';
    if (key && !ids.includes(key)) ids.push(key);
  }

  const ownerNames = ids.map((id) => names.get(id)).filter(Boolean);

  return {
    // No owner, or an owner ESPN names nobody for, falls back to the team name
    // — which is exactly what every page showed before this existed.
    name: ownerNames.length ? joinOwners(ownerNames) : teamName,
    teamName,
    owner: ownerNames.length ? joinOwners(ownerNames) : null,
    ownerNames,
  };
}

// ------------------------------------------------------------------ decoding

function statEntry(stats, seasonId, sourceId) {
  return (stats || []).find(
    (s) => s.seasonId === seasonId && s.statSourceId === sourceId && s.statSplitTypeId === 0
  );
}

function statTotal(stats, seasonId, sourceId) {
  const hit = statEntry(stats, seasonId, sourceId);
  return hit ? hit.appliedTotal : null;
}

// Raw (unscored) stat lines, keyed by ESPN's numeric stat ids. Only the
// well-established ids are used here — ESPN publishes no schema for these, and
// the community maps disagree past the common ones.
const STAT_RUSH_YARDS = '24';
const STAT_RUSH_TDS = '25';

function rushingLine(stats, season) {
  const proj = statEntry(stats, season, 1);
  const raw = proj?.stats || {};
  return {
    rushYards: Number(raw[STAT_RUSH_YARDS]) || 0,
    rushTds: Number(raw[STAT_RUSH_TDS]) || 0,
  };
}

function normalizePlayer(entry, season) {
  const p = entry.player || {};
  const own = p.ownership || {};
  const adp = own.averageDraftPosition;

  return {
    id: p.id,
    name: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim(),
    position: POSITIONS[p.defaultPositionId] || 'UNK',
    proTeam: PRO_TEAMS[p.proTeamId] ?? 'FA',
    proTeamId: p.proTeamId,
    eligibleSlots: p.eligibleSlots || [],
    projected: statTotal(p.stats, season, 1),        // ESPN's projection
    actualThisSeason: statTotal(p.stats, season, 0),
    actualLastSeason: statTotal(p.stats, season - 1, 0),
    // ESPN uses 0 to mean "unranked", which is not the same as first overall.
    adp: adp && adp > 0 ? adp : null,
    auctionValue: own.auctionValueAverage ?? null,
    percentOwned: own.percentOwned ?? null,
    percentStarted: own.percentStarted ?? null,
    draftRank: p.draftRanksByRankType?.PPR?.rank ?? null,
    injuryStatus: p.injuryStatus || 'ACTIVE',
    injured: Boolean(p.injured),
    // Projected rushing production. The draft engine uses this to separate
    // late-round QBs: since 2019 every overall QB1 has run for 350+ yards and
    // 4+ touchdowns.
    ...rushingLine(p.stats, season),
  };
}

/** Flatten ESPN's league payload into something readable. */
/**
 * THE BRACKET, READ FROM THE LEAGUE RATHER THAN GUESSED.
 *
 * `settings.scheduleSettings` carries the whole playoff shape and nothing here
 * decoded it, so the season simulation had to carry a hardcoded fallback for
 * the one number that decides who is even in the bracket. It is a real
 * per-league answer, not a constant that happens to be right: probing two
 * public leagues on 2026-09-16 returned `playoffTeamCount` 6 and 4, and
 * `matchupPeriodCount` 14 and 15.
 *
 * This is also what settles a contradiction in Tim's own account of his league
 * — he said four teams make his playoffs and his pasted settings said six. The
 * league is asked rather than either being believed.
 *
 * `matchupPeriodCount` is the length of the REGULAR season, and the matchup
 * feed stops there, so the playoff weeks are the numbers straight after it.
 * `playoffSeedingRule` differs between leagues too (`H2H_RECORD` vs
 * `TOTAL_POINTS_SCORED`) and is passed through rather than interpreted here.
 *
 * Every field is optional. A payload without `scheduleSettings` — an older
 * archived reading, a stub, anything fetched without `mSettings` — yields
 * nulls, and a caller must treat a null as "ESPN did not say" rather than as a
 * number. That is the same rule the rest of this file follows for a missing
 * projection.
 */
function parsePlayoffs(settings) {
  const s = settings.scheduleSettings || {};
  const num = (v) => (Number.isFinite(v) && v > 0 ? Number(v) : null);
  return {
    regularSeasonWeeks: num(s.matchupPeriodCount),
    playoffTeams: num(s.playoffTeamCount),
    weeksPerPlayoffRound: num(s.playoffMatchupPeriodLength),
    // Deliberately `=== true`: absent must not read as "reseeding is on".
    reseed: s.playoffReseed === true,
    seedingRule: typeof s.playoffSeedingRule === 'string' ? s.playoffSeedingRule : null,
    divisions: Array.isArray(s.divisions) ? s.divisions.length : null,
  };
}

export function parseLeague(raw) {
  const settings = raw.settings || {};
  const roster = settings.rosterSettings || {};
  const draft = settings.draftSettings || {};
  const lineupSlotCounts = roster.lineupSlotCounts || {};

  const starterSlots = {};
  let bench = 0;
  let ir = 0;
  for (const [slotId, count] of Object.entries(lineupSlotCounts)) {
    if (!count) continue;
    const id = Number(slotId);
    if (id === 20) bench = count;
    else if (id === 21) ir = count;
    else starterSlots[id] = count;
  }

  const names = memberNames(raw);

  const teams = (raw.teams || []).map((t) => ({
    id: t.id,
    // `name` is the PERSON — see teamIdentity(). The ESPN team name is still
    // here as `teamName`, and `owners` is still the raw SWID array.
    ...teamIdentity(t, names),
    abbrev: t.abbrev || '',
    owners: t.owners || [],
    roster: (t.roster?.entries || []).map((e) => ({
      playerId: e.playerId,
      lineupSlotId: e.lineupSlotId,
      name: e.playerPoolEntry?.player?.fullName || '',
    })),
  }));

  const detail = raw.draftDetail || {};

  return {
    id: settings.name ? config.leagueId : config.leagueId,
    name: settings.name || 'League',
    season: config.season,
    size: raw.teams?.length || settings.size || 0,
    scoringFormat: detectScoringFormat(settings.scoringSettings),
    starterSlots,
    benchSlots: bench,
    irSlots: ir,
    rosterSize: Object.values(starterSlots).reduce((a, b) => a + b, 0) + bench,
    playoffs: parsePlayoffs(settings),
    teams,
    draft: {
      type: draft.type || 'SNAKE',
      pickOrder: draft.pickOrder || [],
      inProgress: Boolean(detail.inProgress),
      complete: Boolean(detail.drafted),
      picks: (detail.picks || []).map((p) => ({
        playerId: p.playerId,
        teamId: p.teamId,
        round: p.roundId,
        roundPick: p.roundPickNumber,
        overall: p.overallPickNumber,
        keeper: Boolean(p.keeper),
        autodrafted: Boolean(p.autoDraftTypeId),
      })),
    },
  };
}

// Receptions are scoring stat id 53.
/**
 * Name the scoring format from the reception rule (stat id 53).
 *
 * A league may score receptions per position rather than flat, in which case
 * `points` is 0 and the real values live in `pointsOverrides`, keyed by
 * defaultPositionId. Reading `points` alone reports such a league as
 * "Standard", which is badly wrong — it is how a TE-premium half-PPR league
 * gets mistaken for one that does not count catches at all.
 */
function detectScoringFormat(scoringSettings) {
  const rec = (scoringSettings?.scoringItems || []).find((i) => i.statId === 53);
  if (!rec) return 'Standard';

  const overrides = rec.pointsOverrides || {};
  const perPos = Object.entries(overrides).map(([id, v]) => [Number(id), Number(v)]);

  // Wide receiver is the reference point for naming the format.
  const wr = perPos.find(([id]) => id === 3)?.[1];
  const te = perPos.find(([id]) => id === 4)?.[1];
  const base = wr ?? (perPos.length ? Math.max(...perPos.map(([, v]) => v)) : null)
    ?? rec.points ?? 0;

  const name = base >= 0.9 ? 'PPR'
    : base >= 0.4 ? 'Half PPR'
    : base > 0 ? `${base} PPR`
    : 'Standard';

  return te != null && wr != null && te > wr ? `${name} (TE premium)` : name;
}

/**
 * Confirm we can actually read the league. Returns a short summary on success.
 */
export async function testConnection() {
  const raw = await fetchLeague(['mSettings', 'mTeam', 'mDraftDetail']);
  return parseLeague(raw);
}
