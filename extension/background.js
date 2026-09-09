// The bridge itself.
//
// Why this exists: the website is served from github.io, so when it asks
// espn.com for a private league the browser treats your ESPN login as a
// third-party cookie and refuses to send it. A page also cannot set the Cookie
// header itself. So a static site simply cannot read a private league.
//
// An extension can. Requests made from here are the extension's own, and
// because espn.com is in host_permissions the browser attaches your real ESPN
// cookies — extensions are treated as same-site for hosts they have permission
// for, so even SameSite=Strict cookies are sent, and no "cookies" permission is
// needed. Nothing is stored and nothing is forwarded: the data goes straight
// back to the tab that asked.
//
// SECURITY NOTE. A web page can ask this worker to make requests carrying the
// user's ESPN cookies, so every input from the page is hostile until proven
// otherwise. The URL is built with the URL API and then re-checked, because
// string interpolation here is exploitable: a leagueId of "1?view=x" rewrites
// the query string, and one containing "../.." walks to a different endpoint
// entirely. Do not "simplify" buildUrl back into a template literal.
//
// Reads only. Writes (lineups, add/drops, trades) will need the write host and
// must NOT be exposed through the page bridge unauthenticated — see the note at
// the message listener.

const READ_HOST = 'https://lm-api-reads.fantasy.espn.com';
const API_PREFIX = '/apis/v3/games/ffl/';

/** Pages allowed to drive the bridge. Kept in step with content-site.js. */
const ALLOWED_ORIGINS = new Set([
  'https://timothyhadfield.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

const ALLOWED_VIEWS = new Set([
  'mSettings', 'mTeam', 'mRoster', 'mMatchup', 'mMatchupScore',
  'mDraftDetail', 'mTransactions2', 'mNav', 'mStandings',
  'kona_player_info', 'mPositionalRatings', 'mPendingTransactions',
]);

const ALLOWED_SEASON_VIEWS = new Set(['proTeamSchedules_wl', 'kona_game_state']);

const SEASON_RE = /^\d{4}$/;
const LEAGUE_ID_RE = /^\d{1,12}$/;

function requireSeason(season) {
  const s = String(season);
  if (!SEASON_RE.test(s)) throw new Error('Season must be a four-digit year.');
  return s;
}

function requireLeagueId(leagueId) {
  const id = String(leagueId);
  if (!LEAGUE_ID_RE.test(id)) throw new Error('League ID must be digits only.');
  return id;
}

/**
 * Build a URL and then prove it is the one we meant.
 *
 * The assertion at the end is the real defence: even if a validator above is
 * ever loosened, a request that has escaped the ffl API path or the read host
 * cannot leave this function.
 */
function buildUrl(pathname, params) {
  const url = new URL(pathname, READ_HOST);
  for (const [k, v] of params || []) url.searchParams.append(k, v);
  if (url.origin !== READ_HOST || !url.pathname.startsWith(API_PREFIX)) {
    throw new Error('Refusing to build a request outside the ESPN read API.');
  }
  return url.toString();
}

function leagueUrl({ season, leagueId, views, scoringPeriodId }) {
  const s = requireSeason(season);
  const id = requireLeagueId(leagueId);
  const list = Array.isArray(views) ? views : [];
  const params = list
    .filter((v) => ALLOWED_VIEWS.has(v))
    .map((v) => ['view', v]);
  if (scoringPeriodId != null) {
    const wk = Number(scoringPeriodId);
    if (!Number.isInteger(wk) || wk < 1 || wk > 25) throw new Error('Bad scoring period.');
    params.push(['scoringPeriodId', String(wk)]);
  }
  return buildUrl(`${API_PREFIX}seasons/${s}/segments/0/leagues/${id}`, params);
}

function seasonUrl({ season, view }) {
  const s = requireSeason(season);
  if (!ALLOWED_SEASON_VIEWS.has(view)) throw new Error(`View "${view}" is not allowed.`);
  return buildUrl(`${API_PREFIX}seasons/${s}`, [['view', view]]);
}

const SIGN_IN_HELP =
  'ESPN would not answer. Check you are signed in to espn.com in this browser. ' +
  'If you block third-party cookies, or Edge tracking prevention is set to ' +
  'Strict, add espn.com to your allowed sites — that is the usual cause.';

async function espnFetch(url, filter) {
  const headers = { Accept: 'application/json' };
  // ESPN's player pool is filtered through this header rather than the query
  // string. A sort clause is mandatory: without one it returns an empty list
  // rather than an error.
  if (filter) headers['x-fantasy-filter'] = JSON.stringify(filter);

  let res;
  try {
    // The service worker is killed if a fetch takes more than 30 seconds, which
    // would strand the caller with no reply at all. Fail first, with a message.
    res = await fetch(url, {
      headers,
      credentials: 'include',
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: timedOut ? 'ESPN did not respond within 15 seconds.'
                      : `Could not reach ESPN: ${err.message}`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, error: SIGN_IN_HELP };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `ESPN returned HTTP ${res.status}.` };
  }
  // A signed-out session answers 200 with an HTML login page rather than a 401.
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) {
    return { ok: false, status: res.status, error: SIGN_IN_HELP };
  }

  try {
    return { ok: true, status: res.status, data: await res.json() };
  } catch (err) {
    return { ok: false, status: res.status, error: `ESPN sent something unreadable: ${err.message}` };
  }
}

/** Confirm we can see the league, and report its teams. */
async function probe({ season, leagueId }) {
  const res = await espnFetch(leagueUrl({ season, leagueId, views: ['mTeam', 'mSettings'] }));
  if (!res.ok) return res;

  const d = res.data || {};
  const teams = (d.teams || []).map((t) => ({
    id: t.id,
    name: [t.location, t.nickname].filter(Boolean).join(' ').trim() || t.name || `Team ${t.id}`,
    abbrev: t.abbrev,
  }));

  // Which team is yours is deliberately not detected. ESPN identifies owners by
  // the SWID in your cookie, and reading that needs the "cookies" permission —
  // a bigger ask than this is worth. The site asks you once and remembers.
  return {
    ok: true,
    status: res.status,
    data: {
      leagueId: String(leagueId),
      season: Number(season),
      name: d.settings?.name || `League ${leagueId}`,
      teamCount: d.settings?.size ?? teams.length,
      currentWeek: d.status?.currentMatchupPeriod ?? null,
      teams,
    },
  };
}

const HANDLERS = {
  PING: async () => ({ ok: true, data: { version: chrome.runtime.getManifest().version } }),

  /** Lets the site pick up the league ID entered in the popup. */
  GET_CONFIG: async () => {
    const { leagueId } = await chrome.storage.local.get(['leagueId']);
    return { ok: true, data: { leagueId: leagueId || null } };
  },

  PROBE: async (msg) => probe(msg),

  LEAGUE: async (msg) => espnFetch(
    leagueUrl({
      season: msg.season,
      leagueId: msg.leagueId,
      views: msg.views,
      scoringPeriodId: msg.scoringPeriodId,
    }),
    msg.filter
  ),

  SEASON: async (msg) => espnFetch(seasonUrl({ season: msg.season, view: msg.view })),
};

// Registered synchronously at the top level, which MV3 requires.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only our own popup, or a page we explicitly trust, may drive this.
  //
  // When writes are added they must NOT simply join this table: any page on an
  // allowed origin could then drop players or send trades. Route writes behind
  // a popup confirmation, or a nonce the popup issues.
  if (sender.id !== chrome.runtime.id) return false;
  const fromExtension = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!fromExtension && !ALLOWED_ORIGINS.has(sender.origin)) {
    sendResponse({ ok: false, error: 'This page is not allowed to use the bridge.' });
    return false;
  }

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
