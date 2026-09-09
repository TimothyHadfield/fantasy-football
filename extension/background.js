// The bridge itself.
//
// Why this exists: the website is served from github.io, so when it asks
// espn.com for a private league the browser treats your ESPN login as a
// third-party cookie and refuses to send it. A page also cannot set the Cookie
// header itself. So a static site simply cannot read a private league.
//
// An extension can. Requests made from here are the extension's own, and
// because espn.com is listed in host_permissions the browser attaches your
// real ESPN cookies. Nothing is stored, nothing is forwarded anywhere: the
// data goes straight back to the tab that asked for it.
//
// Reads only for now. Writes (lineups, add/drops, trades) will need
// lm-api-writes.fantasy.espn.com added to host_permissions, and are
// deliberately not wired up yet.

const READ_HOST = 'https://lm-api-reads.fantasy.espn.com';

/** Views the site asks for, kept here so the page cannot request anything odd. */
const ALLOWED_VIEWS = new Set([
  'mSettings', 'mTeam', 'mRoster', 'mMatchup', 'mMatchupScore',
  'mDraftDetail', 'mTransactions2', 'mNav', 'mStandings',
  'kona_player_info', 'mPositionalRatings', 'mPendingTransactions',
]);

function leagueUrl({ season, leagueId, views = [], scoringPeriodId }) {
  const safe = views.filter((v) => ALLOWED_VIEWS.has(v));
  const params = new URLSearchParams();
  for (const v of safe) params.append('view', v);
  if (scoringPeriodId != null) params.set('scoringPeriodId', String(scoringPeriodId));
  const qs = params.toString();
  return `${READ_HOST}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}${qs ? '?' + qs : ''}`;
}

function seasonUrl({ season, view }) {
  return `${READ_HOST}/apis/v3/games/ffl/seasons/${season}?view=${encodeURIComponent(view)}`;
}

async function espnFetch(url, filter) {
  const headers = { Accept: 'application/json' };
  // ESPN's player pool is filtered through this header rather than the query
  // string. Note a sort clause is mandatory — without one it returns an empty
  // list rather than an error.
  if (filter) headers['x-fantasy-filter'] = JSON.stringify(filter);

  let res;
  try {
    res = await fetch(url, { headers, credentials: 'include' });
  } catch (err) {
    return { ok: false, status: 0, error: `Could not reach ESPN: ${err.message}` };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: res.status,
      error: 'ESPN refused the request. Open espn.com and sign in, then try again.',
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `ESPN returned HTTP ${res.status}.` };
  }

  try {
    return { ok: true, status: res.status, data: await res.json() };
  } catch (err) {
    return { ok: false, status: res.status, error: `ESPN sent something unreadable: ${err.message}` };
  }
}

/** Confirm we can actually see the league, and report who you are in it. */
async function probe({ season, leagueId }) {
  const res = await espnFetch(leagueUrl({ season, leagueId, views: ['mTeam', 'mSettings'] }));
  if (!res.ok) return res;

  const d = res.data || {};
  const teams = (d.teams || []).map((t) => ({
    id: t.id,
    name: [t.location, t.nickname].filter(Boolean).join(' ').trim() || t.name || `Team ${t.id}`,
    abbrev: t.abbrev,
    owners: t.owners || [],
    primaryOwner: t.primaryOwner || null,
  }));

  // Which team is yours is deliberately not detected here. ESPN identifies
  // owners by the SWID in your cookie, and reading that would need the
  // "cookies" permission — a bigger ask than this is worth. The site asks you
  // to pick your team once and remembers it.
  return {
    ok: true,
    status: res.status,
    data: {
      leagueId,
      season,
      name: d.settings?.name || `League ${leagueId}`,
      teamCount: d.settings?.size ?? teams.length,
      scoringPeriodId: d.scoringPeriodId ?? null,
      currentWeek: d.status?.currentMatchupPeriod ?? null,
      teams,
    },
  };
}

const HANDLERS = {
  PING: async () => ({ ok: true, data: { version: chrome.runtime.getManifest().version } }),

  PROBE: async (msg) => probe(msg),

  LEAGUE: async (msg) => espnFetch(
    leagueUrl({
      season: msg.season,
      leagueId: msg.leagueId,
      views: msg.views || [],
      scoringPeriodId: msg.scoringPeriodId,
    }),
    msg.filter
  ),

  SEASON: async (msg) => espnFetch(seasonUrl({ season: msg.season, view: msg.view })),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown request "${msg?.type}".` });
    return false;
  }
  handler(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // keep the channel open for the async reply
});
