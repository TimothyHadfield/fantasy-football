// ESPN Fantasy Football API connection layer.
//
// This module ONLY fetches and decodes data. It makes no decisions about
// draft strategy, rankings, or scoring — that belongs elsewhere.
//
// Requests go straight from the browser to ESPN. That works because ESPN
// reflects our Origin and sets Access-Control-Allow-Credentials: true, so
// `credentials: 'include'` carries your existing espn.com login cookies.
// Public leagues need no login at all.

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
    throw new AuthError(
      'ESPN refused the request. For a private league you must be logged in to ' +
      'espn.com in this same browser, and your browser must allow cookies to be ' +
      'sent to espn.com.'
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

// --------------------------------------------------------------------- reads

/** Raw league payload. Pass whichever views you need. */
export function fetchLeague(views = ['mSettings', 'mTeam']) {
  return request(leaguePath(views));
}

/** Draft picks and draft status. This is what you'd poll during a live draft. */
export function fetchDraft() {
  return request(leaguePath(['mDraftDetail']));
}

/** Every team's current roster. */
export function fetchRosters(scoringPeriodId) {
  const base = leaguePath(['mRoster', 'mTeam']);
  return request(scoringPeriodId ? `${base}&scoringPeriodId=${scoringPeriodId}` : base);
}

/** Matchups and scores for the season. */
export function fetchMatchups() {
  return request(leaguePath(['mMatchupScore', 'mTeam']));
}

/** Adds, drops, trades, waiver claims. */
export function fetchTransactions() {
  return request(leaguePath(['mTransactions2']));
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
  const data = await request(leaguePath(['kona_player_info']), { filter });
  return (data.players || []).map((e) => normalizePlayer(e, s));
}

/** Bye weeks by pro team id. */
export async function fetchByeWeeks() {
  const data = await request(
    `/apis/v3/games/ffl/seasons/${config.season}?view=proTeamSchedules_wl`
  );
  const byes = {};
  for (const t of data.settings?.proTeams || []) {
    if (t.byeWeek) byes[t.id] = t.byeWeek;
  }
  return byes;
}

// ------------------------------------------------------------------ decoding

function statTotal(stats, seasonId, sourceId) {
  const hit = (stats || []).find(
    (s) => s.seasonId === seasonId && s.statSourceId === sourceId && s.statSplitTypeId === 0
  );
  return hit ? hit.appliedTotal : null;
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
function detectScoringFormat(scoringSettings) {
  const rec = (scoringSettings?.scoringItems || []).find((i) => i.statId === 53);
  const pts = rec?.points ?? 0;
  if (pts >= 0.9) return 'PPR';
  if (pts >= 0.4) return 'Half PPR';
  if (pts > 0) return `${pts} PPR`;
  return 'Standard';
}

/**
 * Confirm we can actually read the league. Returns a short summary on success.
 */
export async function testConnection() {
  const raw = await fetchLeague(['mSettings', 'mTeam', 'mDraftDetail']);
  return parseLeague(raw);
}
