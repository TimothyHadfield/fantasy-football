// The rules a lineup change must pass before this extension will send it.
//
// WHAT THIS IS FOR. Tim, 2026-10-11: "for the easy ones like the weekly lineup,
// make it so you just have to click a button to automatically change it for
// your team". Asked whether the site may change his ESPN lineup through the
// extension with his ESPN login, he answered "Yes, lineup only". This file is
// the "only".
//
// It is pure: no chrome, no fetch, no storage. background.js hands it the
// page's request, a league read it has JUST made itself, and the member id from
// the owner's own ESPN cookie, and gets back either a refusal or the exact body
// to POST. Keeping it pure is what lets tests/test-lineup-guard.mjs run every
// refusal without a browser and without ESPN — which matters, because this
// write cannot be tested against ESPN at all (never Tim's account).
//
// A plain script, not a module: background.js is a classic service worker
// (the manifest names no "type": "module") and pulls this in with
// importScripts. It hangs one object on globalThis and nothing else.
//
// THE REQUEST ESPN EXPECTS, and where each part was confirmed:
//
//   POST https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/
//        {season}/segments/0/leagues/{leagueId}/transactions/
//   Content-Type: application/json      (cookies: espn_s2, and SWID)
//   {
//     "isLeagueManager": false,
//     "teamId": 1,
//     "type": "ROSTER",
//     "memberId": "{SWID}",
//     "scoringPeriodId": 1,
//     "executionType": "EXECUTE",
//     "items": [
//       {"playerId": 9000013, "type": "LINEUP", "fromLineupSlotId": 4,  "toLineupSlotId": 20},
//       {"playerId": 9000012, "type": "LINEUP", "fromLineupSlotId": 20, "toLineupSlotId": 4}
//     ]
//   }
//
//   Sources (read 2026-10-11), four independent ones that agree field for field:
//   [1] github.com/jwulff/fantasy-sports  docs/research/05-espn-write-surface.md
//       — the only one MEASURED against a real league, request and response
//       captured. Everything marked "measured" below is from here.
//   [2] github.com/mcolen5050/FantasyFootballAutomation_public  main.py
//   [3] github.com/tedfoley/fantasy-football  ff.py
//   [4] github.com/gagandaroach/fantasy-yolo  src/fantasy_yolo/write/payloads.py
//
//   Confirmed by all four: the host, the path with its trailing slash, POST,
//   type ROSTER, executionType EXECUTE, isLeagueManager false, teamId, memberId
//   (the SWID, braces and all), scoringPeriodId, and the four item fields.
//   Measured by [1]: success is HTTP 200 with body `status: "EXECUTED"`; a
//   swap is BOTH men in one request and it is applied whole or not at all; an
//   item whose from and to are the same slot refuses the whole request (409
//   TRAN_ROSTER_SAME_SLOT); a man whose game has started is 409
//   TRAN_LINEUP_LOCKED, and is visible beforehand as
//   `playerPoolEntry.lineupLocked`; any week but the current scoring period is
//   409 TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT; no cookie is 401.
//
//   NOT confirmed by anyone, so NOT relied on here:
//   - What `isLeagueManager: true` does. Nobody sent it. It is hard-coded false
//     below and there is no way for a caller to change that.
//   - How ESPN treats a request from a BROWSER EXTENSION. Every source is a
//     Python script, which sends no Origin header; the service worker's fetch
//     will send `Origin: chrome-extension://…`. If ESPN minds, the answer is a
//     4xx and the button says it could not — nothing is half-done.
//   - Rate limits on the write host. One request at a time and no retries is
//     the answer to not knowing.
//
// ONE FINDING FROM [1] THAT SHAPES THIS FILE. ESPN does NOT reliably refuse a
// lineup change to somebody else's team: a league's commissioner changed
// another manager's lineup with `isLeagueManager: false` and got 200. So "is
// this his own team" cannot be left to ESPN. It is decided here, from his
// member id against the league's own list of owners, before a request exists.

globalThis.LineupGuard = (() => {
  /** A swap is two; two swaps is four. Nothing one click does needs more. */
  const MAX_MOVES = 4;

  /**
   * THE WHOLE LINEUP AT ONCE (Tim, 2026-10-31: "fix all future ESPN lineups …
   * automatically sets all my lineups on espn so that the players with the
   * highest proj that week are in and playing"). The site's "Auto-set best
   * lineup" re-sorts starters and bench in ONE request, marked `full: true`.
   * Every man on a roster moves at most once (a repeated man is refused), and
   * the rosters measured run 17–19 entries (public league 1241838, 2026-10-11),
   * so 20 covers a full re-sort. Only a request marked `full` gets it;
   * every other request keeps MAX_MOVES. Everything else is checked exactly
   * as for a swap, and on top of that the lineup the moves leave must fit the
   * league's slot counts (`check`).
   */
  const MAX_FULL_MOVES = 20;

  /**
   * The one page that may ask for a write. Narrower than the read bridge on
   * purpose: localhost and 127.0.0.1 may READ, and may never write.
   */
  const LIVE_ORIGIN = 'https://timothyhadfield.github.io';
  const LIVE_PATH = '/fantasy-football/';

  const SEASON_RE = /^\d{4}$/;
  const LEAGUE_ID_RE = /^\d{1,12}$/;
  const SWID_RE = /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/;

  const REQUEST_FIELDS = new Set(['type', 'leagueId', 'season', 'week', 'teamId', 'moves', 'full']);
  const MOVE_FIELDS = new Set(['type', 'playerId', 'fromSlotId', 'toSlotId']);

  const no = (reason) => ({ ok: false, reason });
  const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

  /**
   * Is this sender the live site, in a top-level tab?
   *
   * `sender` is the object CHROME fills in for chrome.runtime.onMessage — the
   * page does not write it and content-site.js does not forward one, so a page
   * cannot claim an origin it does not have. The origin Chrome vouches for and
   * the frame's URL must agree, and the URL must sit under the site's own path,
   * because every project Tim publishes shares this origin.
   */
  function senderIsLiveSite(sender) {
    if (!sender || typeof sender.url !== 'string' || typeof sender.origin !== 'string') return false;
    if (sender.origin !== LIVE_ORIGIN) return false;
    let url;
    try { url = new URL(sender.url); } catch { return false; }
    if (url.origin !== LIVE_ORIGIN) return false;
    if (!url.pathname.startsWith(LIVE_PATH)) return false;
    // A real tab, and its top frame — not the popup, not an embedded frame.
    if (!sender.tab) return false;
    if (sender.frameId != null && sender.frameId !== 0) return false;
    return true;
  }

  /** "{GUID}" in capitals, or null. ESPN writes it both ways round in places. */
  function normalizeSwid(value) {
    if (typeof value !== 'string') return null;
    let s = value.trim();
    // A cookie value may arrive percent-encoded (%7B…%7D).
    if (/%7B/i.test(s)) { try { s = decodeURIComponent(s); } catch { return null; } }
    s = s.toUpperCase();
    return SWID_RE.test(s) ? s : null;
  }

  function playerIdOk(v) {
    if (!isInt(v)) return false;
    // A D/ST is the one negative id ESPN uses: -16001 … -16034.
    if (v <= -16001 && v >= -16034) return true;
    return v > 0 && v <= 1e9;
  }

  /**
   * The shape of what the page sent. Nothing here knows about ESPN yet.
   * Strings that look like numbers are refused, not coerced: js/bridge.js sends
   * numbers, so anything else means something upstream is confused.
   */
  function parseRequest(msg) {
    if (!msg || typeof msg !== 'object') return no('bad-request');
    for (const key of Object.keys(msg)) if (!REQUEST_FIELDS.has(key)) return no('bad-request');

    const leagueId = String(msg.leagueId);
    if (!LEAGUE_ID_RE.test(leagueId)) return no('bad-request');
    const seasonText = String(msg.season);
    if (!SEASON_RE.test(seasonText)) return no('bad-request');
    if (!isInt(msg.week) || msg.week < 1 || msg.week > 25) return no('bad-request');
    if (!isInt(msg.teamId) || msg.teamId < 1 || msg.teamId > 9999) return no('bad-request');

    // `full` is a plain true or absent; anything else means something upstream is confused.
    if ('full' in msg && msg.full !== true) return no('bad-request');
    const full = msg.full === true;

    if (!Array.isArray(msg.moves) || msg.moves.length < 1) return no('bad-request');
    if (msg.moves.length > (full ? MAX_FULL_MOVES : MAX_MOVES)) return no('too-many');

    const seen = new Set();
    const moves = [];
    for (const m of msg.moves) {
      if (!m || typeof m !== 'object') return no('bad-request');
      // The type is checked BEFORE the fields, so an add, a drop or a trade
      // dressed up with extra fields is named for what it is.
      if (m.type !== 'LINEUP') return no('not-lineup');
      for (const key of Object.keys(m)) if (!MOVE_FIELDS.has(key)) return no('bad-request');
      if (!playerIdOk(m.playerId)) return no('bad-request');
      if (!isInt(m.fromSlotId) || m.fromSlotId < 0 || m.fromSlotId > 30) return no('bad-request');
      if (!isInt(m.toSlotId) || m.toSlotId < 0 || m.toSlotId > 30) return no('bad-request');
      // ESPN refuses the WHOLE request for one of these, so do not send it.
      if (m.fromSlotId === m.toSlotId) return no('same-slot');
      if (seen.has(m.playerId)) return no('bad-request');
      seen.add(m.playerId);
      moves.push({ playerId: m.playerId, fromSlotId: m.fromSlotId, toSlotId: m.toSlotId });
    }

    return {
      ok: true,
      request: { leagueId, season: Number(seasonText), week: msg.week, teamId: msg.teamId, moves, full },
    };
  }

  /**
   * The request against what ESPN says RIGHT NOW.
   *
   * @param request a parseRequest() result's `request`
   * @param league  the league read background.js just made (mTeam, mRoster, mSettings)
   * @param swid    the owner's member id, from his own ESPN cookie
   * @returns {ok:false, reason} or {ok:true, body} — the body is the whole POST
   */
  function check({ request, league, swid }) {
    const me = normalizeSwid(swid);
    if (!me) return no('signed-out');
    if (!league || typeof league !== 'object' || !Array.isArray(league.teams)) return no('read-failed');

    // The week. ESPN's own current scoring period, never the page's word for it.
    const current = league.scoringPeriodId;
    if (!isInt(current)) return no('read-failed');
    if (league.seasonId !== request.season) return no('stale');
    if (request.week !== current) return no('stale');

    // Whose team. His member id against the league's own owners — see the note
    // at the top: ESPN does not reliably refuse somebody else's team.
    let memberId = null;
    const mine = league.teams.filter((t) => {
      const owner = (Array.isArray(t && t.owners) ? t.owners : []).find((o) => normalizeSwid(o) === me);
      if (owner && memberId == null) memberId = owner;
      return Boolean(owner);
    });
    const team = mine.find((t) => t.id === request.teamId);
    if (!team) return no('not-your-team');

    const entries = (team.roster && Array.isArray(team.roster.entries)) ? team.roster.entries : null;
    if (!entries) return no('read-failed');
    const counts = (league.settings && league.settings.rosterSettings
      && league.settings.rosterSettings.lineupSlotCounts) || null;
    if (!counts || typeof counts !== 'object') return no('read-failed');

    const items = [];
    for (const m of request.moves) {
      const entry = entries.find((e) => e && e.playerId === m.playerId);
      if (!entry) return no('not-on-roster');
      // Where ESPN says he is now. If the page thinks otherwise it is looking
      // at an old roster, and the move it worked out no longer means anything.
      if (entry.lineupSlotId !== m.fromSlotId) return no('stale');
      // His game has started. Anything but a plain `false` counts as locked:
      // if ESPN ever stops sending the flag, this stops, rather than guessing.
      const pool = entry.playerPoolEntry || {};
      if (pool.lineupLocked !== false) return no('locked');
      // A slot this league has, and one he may play.
      if (!(Number(counts[String(m.toSlotId)]) > 0)) return no('bad-slot');
      const eligible = pool.player && pool.player.eligibleSlots;
      if (!Array.isArray(eligible) || !eligible.includes(m.toSlotId)) return no('bad-slot');
      items.push({
        playerId: m.playerId,
        type: 'LINEUP',
        fromLineupSlotId: m.fromSlotId,
        toLineupSlotId: m.toSlotId,
      });
    }

    // A WHOLE-LINEUP REQUEST must leave a lineup the league allows: no starting
    // slot holding more men than the league has of it. ESPN would refuse such a
    // request whole anyway; this keeps it from being sent at all.
    if (request.full) {
      const at = new Map(entries.map((e) => [e.playerId, e.lineupSlotId]));
      for (const m of request.moves) at.set(m.playerId, m.toSlotId);
      const used = {};
      for (const slot of at.values()) used[slot] = (used[slot] || 0) + 1;
      for (const [slot, n] of Object.entries(used)) {
        if (slot === '20' || slot === '21') continue;   // bench and IR: ESPN's own rules
        if (n > Number(counts[slot] || 0)) return no('bad-slot');
      }
    }

    return {
      ok: true,
      body: {
        // Never true, and not a parameter. See "NOT confirmed" at the top.
        isLeagueManager: false,
        teamId: team.id,
        type: 'ROSTER',
        memberId,
        scoringPeriodId: current,
        executionType: 'EXECUTE',
        items,
      },
    };
  }

  /** ESPN's answer to the POST, as {ok:true} or a short reason. */
  function outcome(status, body) {
    if (status >= 200 && status < 300) {
      // "EXECUTED" is the success mark. A 2xx that says something else did not
      // happen; a 2xx we could not read is left to the page's own re-read.
      if (body && typeof body.status === 'string' && body.status !== 'EXECUTED') return no('not-executed');
      return { ok: true };
    }
    const details = (body && Array.isArray(body.details)) ? body.details : [];
    const types = details.map((d) => (d && d.type) || '');
    if (types.includes('TRAN_LINEUP_LOCKED')) return no('locked');
    if (types.includes('TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT')) return no('stale');
    return no(`espn-${status}`);
  }

  return {
    MAX_MOVES, MAX_FULL_MOVES, LIVE_ORIGIN, LIVE_PATH,
    senderIsLiveSite, normalizeSwid, parseRequest, check, outcome,
  };
})();
