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
 * One league read, through the bridge extension when it is installed and by
 * direct fetch when it is not.
 *
 * Routing here rather than at each call site means every page that already
 * uses this module gets private-league access for free the moment the
 * extension appears, with no changes of their own.
 */
async function leagueRead(views, { filter, scoringPeriodId } = {}) {
  if (!config.leagueId) throw new Error('No league ID configured.');

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

/** Matchups and scores for the season. */
export function fetchMatchups() {
  return leagueRead(['mMatchupScore', 'mTeam']);
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

/** Bye weeks by pro team id. */
export async function fetchByeWeeks() {
  const view = 'proTeamSchedules_wl';
  let data;
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

  const teams = (raw.teams || []).map((t) => ({
    id: t.id,
    name: (t.name || `${t.location || ''} ${t.nickname || ''}`).trim() || `Team ${t.id}`,
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
