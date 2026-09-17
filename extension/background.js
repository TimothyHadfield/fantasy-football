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
//
// STAGING A TRADE IS NOT A WRITE. The block near the foot of this file lets the
// site hand over a trade for content-espn-trade.js to TICK CHECKBOXES with, on
// ESPN's own trade page, in a tab the owner opened himself. No request is made
// to ESPN by this extension as a result, and host_permissions below holds the
// read host and nothing else. If you ever find yourself adding
// lm-api-writes.fantasy.espn.com here, stop: that is a different feature with a
// different safety model, and this one does not need it.

const READ_HOST = 'https://lm-api-reads.fantasy.espn.com';
const API_PREFIX = '/apis/v3/games/ffl/';

/**
 * Pages allowed to drive the bridge: an origin AND a path under it. Kept in
 * step with content-site.js and the manifest's content_scripts matches.
 *
 * The path is not decoration. Every project Tim publishes shares the
 * timothyhadfield.github.io origin, and its root is a different site of his,
 * so an origin-only check would let any of them read the private league or
 * stage a trade.
 */
const ALLOWED_SCOPES = [
  { origin: 'https://timothyhadfield.github.io', path: '/fantasy-football/' },
  { origin: 'http://localhost:8000', path: '/' },
  { origin: 'http://127.0.0.1:8000', path: '/' },
];

/**
 * Is this sender a page of the site? Both the origin Chrome vouches for and
 * the URL of the frame must agree, and the URL — parsed, so "/x/../" and
 * "%2e%2e" are already resolved — must sit under the allowed path.
 */
function senderIsSite(sender) {
  if (typeof sender.url !== 'string' || typeof sender.origin !== 'string') return false;
  let url;
  try { url = new URL(sender.url); } catch { return false; }
  if (url.origin !== sender.origin) return false;
  return ALLOWED_SCOPES.some((s) => url.origin === s.origin && url.pathname.startsWith(s.path));
}

// Where ESPN's trade builder lives. This is NOT an API host and NOT in
// host_permissions — it is where content-espn-trade.js runs, and the only
// reason the worker knows the string is to check who is asking for the staged
// trade and to build the deep link.
const TRADE_ORIGIN = 'https://fantasy.espn.com';
const TRADE_PATH = '/football/team/trade';

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

// ---------------------------------------------------------------------------
// Staging a trade for ESPN's own trade page
// ---------------------------------------------------------------------------
//
// The site stages {my players, their players, the two team ids}; the owner
// follows the deep link; content-espn-trade.js takes the staged trade ONCE and
// ticks his own side's checkboxes. ESPN's `players=` parameter has already
// ticked the other side. He then presses Propose Trade himself.
//
// Nothing here talks to ESPN. The whole feature is a note passed between two
// of our own scripts.
//
// TWO PROPERTIES DO THE SAFETY WORK, and both live here rather than in the
// content script, because the content script runs on espn.com and is the
// untrusted half:
//
//   EXPIRY. A staged trade a week old, silently ticking boxes on an unrelated
//   visit to the trade page, is exactly the surprise this must not spring. A
//   few minutes is long enough to follow a link and no longer.
//
//   SINGLE USE. It is deleted as it is handed over. Opening the trade page a
//   second time gets nothing, so a reload cannot re-tick a deal he has changed
//   his mind about.
//
// And the input is validated to the same standard as the URL builders above —
// the site is trusted only as far as the allowed-scope check, and a page in
// that scope can still be wrong.

const STAGE_KEY = 'stagedTrade';
const STAGE_TTL_MS = 5 * 60 * 1000;
// ESPN allows a big trade; nothing sane needs more than this, and an unbounded
// list is a way to make the content script chew through the page forever.
const MAX_PLAYERS_PER_SIDE = 12;
const MAX_NAME_LEN = 64;
const TEAM_ID_RE = /^\d{1,4}$/;

/** Fields a STAGE_TRADE message may carry. Anything else is a bug or an attack. */
const STAGE_FIELDS = new Set([
  'type', 'leagueId', 'season', 'myTeamId', 'theirTeamId',
  'myPlayers', 'theirPlayerIds',
]);

/**
 * session storage where it exists, local where it does not.
 *
 * session is the right home — it is wiped when the browser closes and is not
 * readable by content scripts directly — but it arrived later than MV3 itself,
 * so fall back rather than throwing on an older Edge.
 */
function stagingArea() {
  return (chrome.storage && chrome.storage.session) || chrome.storage.local;
}

function requireTeamId(value, what) {
  const id = String(value);
  if (!TEAM_ID_RE.test(id)) throw new Error(`${what} must be digits only.`);
  return id;
}

function requirePlayerId(value, what) {
  // Integers, and integers only. A string that happens to look numeric is
  // refused rather than coerced: the site knows these come from ESPN's API as
  // numbers, so anything else means something upstream is confused.
  //
  // A D/ST is the one NEGATIVE id ESPN uses: -16000 minus the NFL team id, so
  // -16001 to -16034 (docs/espn-draft-api.md). Refusing it refused every trade
  // with a defence in it, on either side. Only that band is let through — any
  // other negative is still nonsense.
  const dst = value <= -16001 && value >= -16034;
  if (typeof value !== 'number' || !Number.isInteger(value) || (!dst && (value <= 0 || value > 1e9))) {
    throw new Error(`${what} must be whole ESPN player ids.`);
  }
  return value;
}

function requireName(value, what) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${what}: a name must be text.`);
  // Control characters out: the name is drawn on espn.com, and while the badge
  // only ever uses textContent, a name carrying newlines would still wreck it.
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (name.length > MAX_NAME_LEN) throw new Error(`${what}: that name is too long.`);
  return name;
}

/** [{ id, name }] — accepts a bare id too, so a caller with no names still works. */
function requirePlayers(list, what) {
  if (!Array.isArray(list)) throw new Error(`${what} must be a list.`);
  if (!list.length) throw new Error(`${what} is empty.`);
  if (list.length > MAX_PLAYERS_PER_SIDE) {
    throw new Error(`${what} has more than ${MAX_PLAYERS_PER_SIDE} players.`);
  }
  const seen = new Set();
  return list.map((entry) => {
    const p = (entry && typeof entry === 'object') ? entry : { id: entry };
    for (const key of Object.keys(p)) {
      if (key !== 'id' && key !== 'name') throw new Error(`${what}: unexpected field "${key}".`);
    }
    const id = requirePlayerId(p.id, what);
    if (seen.has(id)) throw new Error(`${what} names player ${id} twice.`);
    seen.add(id);
    return { id, name: requireName(p.name, what) };
  });
}

function requirePlayerIds(list, what) {
  if (!Array.isArray(list)) throw new Error(`${what} must be a list.`);
  if (list.length > MAX_PLAYERS_PER_SIDE) {
    throw new Error(`${what} has more than ${MAX_PLAYERS_PER_SIDE} players.`);
  }
  return list.map((v) => requirePlayerId(v, what));
}

/**
 * The deep link, built with the URL API and then proved to be the one we meant.
 *
 * Same reasoning as buildUrl above, and the same refusal to interpolate: a
 * leagueId of "1&fromTeamId=9" would otherwise rewrite the rest of the query,
 * and that is a trade proposed to a team nobody chose.
 */
function tradeUrl({ leagueId, season, myTeamId, theirTeamId, theirPlayerIds }) {
  const url = new URL(TRADE_PATH, TRADE_ORIGIN);
  url.searchParams.set('leagueId', leagueId);
  url.searchParams.set('seasonId', season);
  url.searchParams.set('teamId', theirTeamId);      // whose roster you want from
  url.searchParams.set('fromTeamId', myTeamId);     // your own team
  url.searchParams.set('step', '1');
  if (theirPlayerIds.length) url.searchParams.set('players', theirPlayerIds.join(','));
  if (url.origin !== TRADE_ORIGIN || url.pathname !== TRADE_PATH) {
    throw new Error('Refusing to build a link outside ESPN’s trade page.');
  }
  return url.toString();
}

async function stageTrade(msg) {
  for (const key of Object.keys(msg || {})) {
    if (!STAGE_FIELDS.has(key)) throw new Error(`Unexpected field "${key}" in a staged trade.`);
  }

  const season = requireSeason(msg.season);
  const leagueId = requireLeagueId(msg.leagueId);
  const myTeamId = requireTeamId(msg.myTeamId, 'Your team id');
  const theirTeamId = requireTeamId(msg.theirTeamId, 'Their team id');
  if (myTeamId === theirTeamId) throw new Error('A trade needs two different teams.');

  const myPlayers = requirePlayers(msg.myPlayers, 'Your side');
  const theirPlayerIds = requirePlayerIds(msg.theirPlayerIds || [], 'Their side');

  const overlap = myPlayers.find((p) => theirPlayerIds.includes(p.id));
  if (overlap) throw new Error(`Player ${overlap.id} is on both sides of the trade.`);

  const now = Date.now();
  const record = {
    leagueId, season, myTeamId, theirTeamId, myPlayers, theirPlayerIds,
    stagedAt: now,
    expiresAt: now + STAGE_TTL_MS,
  };
  const url = tradeUrl(record);

  await stagingArea().set({ [STAGE_KEY]: record });
  return { ok: true, data: { url, expiresAt: record.expiresAt, count: myPlayers.length } };
}

/**
 * Hand the staged trade to the ESPN content script, and delete it.
 *
 * Serialised behind one promise so two trade tabs opening together cannot both
 * read the record before either has removed it. The delete happens BEFORE the
 * reply, so a caller that never comes back still consumed it.
 */
let takeQueue = Promise.resolve();

function takeStagedTrade(msg) {
  const run = async () => {
    const area = stagingArea();
    const stored = await area.get([STAGE_KEY]);
    const record = stored && stored[STAGE_KEY];
    if (!record) return { ok: true, data: null };

    if (!(typeof record.expiresAt === 'number') || Date.now() > record.expiresAt) {
      await area.remove([STAGE_KEY]);
      return { ok: true, data: null };
    }

    // The page says which league and teams it is showing. A record staged for a
    // different deal is left where it is rather than consumed — the owner may
    // be one tab away from the link it was meant for — and expiry clears it up
    // either way.
    const sameLeague = String(msg.leagueId || '') === record.leagueId;
    const sameMine = String(msg.myTeamId || '') === record.myTeamId;
    const sameTheirs = String(msg.theirTeamId || '') === record.theirTeamId;
    //
    // But it is SAID, not swallowed: a staged deal that does not fit the page he
    // just opened is almost always the deal he meant, on a screen ESPN pointed
    // somewhere else — and silence there is "my side isn't ticked" with no way to
    // tell why. Team ids only; no player is named to espn.com unless it matches.
    if (!sameLeague || !sameMine || !sameTheirs) {
      return {
        ok: true,
        data: null,
        mismatch: {
          staged: { leagueId: record.leagueId, myTeamId: record.myTeamId, theirTeamId: record.theirTeamId },
          page: {
            leagueId: String(msg.leagueId || ''),
            myTeamId: String(msg.myTeamId || ''),
            theirTeamId: String(msg.theirTeamId || ''),
          },
        },
      };
    }

    await area.remove([STAGE_KEY]);
    return {
      ok: true,
      data: {
        leagueId: record.leagueId,
        season: record.season,
        myTeamId: record.myTeamId,
        theirTeamId: record.theirTeamId,
        myPlayers: record.myPlayers,
        theirPlayerIds: record.theirPlayerIds,
      },
    };
  };

  const next = takeQueue.then(run, run);
  // Keep the chain alive whatever happens, or one rejection stops every later
  // take from ever running.
  takeQueue = next.then(() => undefined, () => undefined);
  return next;
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

  STAGE_TRADE: async (msg) => stageTrade(msg),

  TAKE_STAGED_TRADE: async (msg) => takeStagedTrade(msg),
};

/**
 * Who may ask for what.
 *
 * Everything defaults to the site's allowed scopes. TAKE_STAGED_TRADE is the
 * one exception: it is asked for by our content script on ESPN's trade page,
 * which is NOT an allowed site origin and must never become one — a page on
 * espn.com can reach the bridge only for this, and this returns a note we put
 * there ourselves minutes ago.
 *
 * The reverse matters just as much: STAGE_TRADE is deliberately absent from
 * this table, so espn.com cannot stage anything.
 */
const ESPN_ONLY = new Set(['TAKE_STAGED_TRADE']);

function senderMayAsk(type, sender) {
  if (ESPN_ONLY.has(type)) {
    // Must be a real tab on ESPN's own origin — not the popup, not the site.
    //
    // Worth being clear about what this does and does not admit. ESPN's own
    // page scripts cannot reach here at all: a web page can only call
    // chrome.runtime.sendMessage if the manifest lists it under
    // externally_connectable, and this manifest has no such key. So the only
    // thing that can arrive with sender.id === our id and this origin is OUR
    // content script, which the manifest runs on the trade path alone.
    return Boolean(sender.tab) && sender.origin === TRADE_ORIGIN;
  }
  const fromExtension = sender.url?.startsWith(chrome.runtime.getURL(''));
  return Boolean(fromExtension) || senderIsSite(sender);
}

// Registered synchronously at the top level, which MV3 requires.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only our own popup, or a page we explicitly trust, may drive this.
  //
  // When writes are added they must NOT simply join this table: any page on an
  // allowed page could then drop players or send trades. Route writes behind
  // a popup confirmation, or a nonce the popup issues. Staging a trade is not
  // a write — see the block above HANDLERS — and is the only thing here that
  // any espn.com page may touch at all.
  if (sender.id !== chrome.runtime.id) return false;
  if (!senderMayAsk(msg?.type, sender)) {
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
