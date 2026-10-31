// Runs on the Fantasy Football site and is the only thing the page can talk to.
//
// The page and the extension live in different worlds and cannot call each
// other directly, so everything crosses through window.postMessage here. The
// page never gets the extension's privileges — it can only ask for the request
// types background.js is willing to answer, and background.js re-validates
// every one of them.

// Match patterns cannot pin a port reliably — Chromium ignores ports in
// host_permissions — so the origin check that actually matters happens here.
// Without it, any local dev server on any port could drive the bridge.
//
// The ORIGIN is not enough on github.io. Every project Tim publishes shares
// https://timothyhadfield.github.io, and the root of it is a different site
// altogether — any of them could otherwise read his private league through his
// ESPN cookie or stage a trade. So the live site is pinned to its PATH as well.
// The manifest says the same thing; this is the belt to its braces, and
// background.js checks the sender's path a third time. Keep all three in step.
const ALLOWED_SCOPES = [
  { origin: 'https://timothyhadfield.github.io', path: '/fantasy-football/' },
  // Local dev serves the repo at the root, on one port only.
  { origin: 'http://localhost:8000', path: '/' },
  { origin: 'http://127.0.0.1:8000', path: '/' },
];

// THE TOP FRAME, OR A FRAME ESPN'S PAGE HOLDS. Since 0.5.0 this script is
// registered for every frame, because the ESPN tabs (content-espn-tabs.js) show
// the site's own pages in a frame on fantasy.espn.com and those pages need the
// bridge to read a private league. A frame anywhere else — the site framed by
// some other page — still gets nothing: every ancestor must be ESPN's page.
const ESPN_ORIGIN = 'https://fantasy.espn.com';

const isTop = (() => { try { return window.top === window; } catch { return false; } })();

function framedByEspn() {
  if (isTop) return false;
  const anc = window.location.ancestorOrigins;
  if (!anc || !anc.length) return false;
  for (let i = 0; i < anc.length; i += 1) if (anc[i] !== ESPN_ORIGIN) return false;
  return true;
}

const inScope = ALLOWED_SCOPES.some((s) =>
  window.location.origin === s.origin && window.location.pathname.startsWith(s.path))
  && (isTop || framedByEspn());

// ---------------------------------------------------------------------------
// The site's choices, carried to the ESPN tabs and back (0.5.0)
// ---------------------------------------------------------------------------
//
// A frame inside espn.com cannot read the site's localStorage (the browser
// partitions it by the top page), so the site's own small keys are mirrored
// into this extension's storage:
//
//   ff.prefs                 every switch, sort, view, team and saved trade
//   ff.connection, ff.config which league, which season, which team is his
//   ff.value.<league>-<yr>   the frozen Value lines, so Value matches exactly
//
// From the site's own tab: copied up whenever they change. From an ESPN tab:
// only ff.prefs comes back, and only for the league the site has open, so a
// choice made on ESPN is there on the site next time and never another
// league's. content-espn-tabs.js reads the mirror to seed each frame.
//
// Nothing here is sent anywhere: chrome.storage.local is this browser's.
const MIRROR = 'siteMirror';
const MIRROR_KEY = /^ff\.(prefs|connection|config|value\.\d{1,12}-\d{4})$/;
const RELAY_AT = 'ff.relayAt';
const POLL_MS = 1500;

function readKeys(test) {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && test(k)) out[k] = localStorage.getItem(k);
    }
  } catch { /* storage refused */ }
  return out;
}

const leagueOf = (raw) => {
  try { const c = JSON.parse(raw || 'null'); return c && c.leagueId ? String(c.leagueId) : ''; } catch { return ''; }
};

function relayFromSite() {
  const area = chrome.storage && chrome.storage.local;
  if (!area) return;
  const startPrefs = localStorage.getItem('ff.prefs');
  let last = '';

  let timer = null;
  const push = () => {
    // A tab left open across an extension reload keeps this script running
    // with its link to the extension cut ("Extension context invalidated",
    // Tim 2026-10-31 on chrome://extensions). Stop quietly; a refresh of the
    // tab brings a live copy.
    const keys = readKeys((k) => MIRROR_KEY.test(k));
    const text = JSON.stringify(keys);
    if (text === last) return;
    last = text;
    const at = Date.now();
    try { localStorage.setItem(RELAY_AT, String(at)); } catch { /* fine */ }
    try {
      area.set({ [MIRROR]: { at, from: 'site', keys } });
    } catch {
      if (timer !== null) clearInterval(timer);
      timer = null;
    }
  };

  // A choice made in an ESPN tab since this browser last showed the site:
  // take it, unless the page has already written its own in the meantime.
  area.get([MIRROR], (got) => {
    const m = got && got[MIRROR];
    const seen = Number(localStorage.getItem(RELAY_AT)) || 0;
    if (m && m.from === 'espn' && m.at > seen && m.keys && typeof m.keys['ff.prefs'] === 'string'
        && localStorage.getItem('ff.prefs') === startPrefs
        && leagueOf(m.keys['ff.connection']) === leagueOf(localStorage.getItem('ff.connection'))) {
      try {
        localStorage.setItem('ff.prefs', m.keys['ff.prefs']);
        localStorage.setItem(RELAY_AT, String(m.at));
      } catch { /* fine */ }
    }
    push();
    timer = setInterval(push, POLL_MS);
    window.addEventListener('pagehide', push);
  });
}

// The frame forces each page's data source to live (js/espn-embed-boot.js).
// That is not a choice made on ESPN, so the site's own sources go back as they were.
function withSiteSources(framePrefs, sitePrefs) {
  try {
    const out = JSON.parse(framePrefs);
    let site = {};
    try { site = JSON.parse(sitePrefs) || {}; } catch { site = {}; }
    for (const k of Object.keys(out)) if (/\.source$/.test(k)) delete out[k];
    for (const k of Object.keys(site)) if (/\.source$/.test(k)) out[k] = site[k];
    return JSON.stringify(out);
  } catch { return framePrefs; }
}

function relayFromEspnFrame() {
  const area = chrome.storage && chrome.storage.local;
  if (!area) return;
  let last = null;
  const push = () => {
    const now = localStorage.getItem('ff.prefs');
    if (last === null) { last = now; return; }   // the seeded value is the baseline
    if (now === last || typeof now !== 'string') return;
    last = now;
    area.get([MIRROR], (got) => {
      const m = got && got[MIRROR];
      if (!m || !m.keys) return;
      // Only the league the site has open; another league's choices stay here.
      if (leagueOf(m.keys['ff.connection']) !== leagueOf(localStorage.getItem('ff.connection'))) return;
      area.set({ [MIRROR]: { at: Date.now(), from: 'espn', keys: { ...m.keys, 'ff.prefs': withSiteSources(now, m.keys['ff.prefs']) } } });
    });
  };
  window.addEventListener('DOMContentLoaded', push);
  setInterval(push, POLL_MS);
  window.addEventListener('pagehide', push);
}

if (inScope) {
  try {
    if (isTop) relayFromSite();
    else relayFromEspnFrame();
  } catch { /* the mirror is a convenience; the bridge below is the job */ }
}

if (inScope) {
  const SITE = 'ff-site';   // messages from the page
  const EXT = 'ff-ext';     // messages from us

  const reply = (id, payload) => {
    // Spread payload first so a response can never overwrite the envelope.
    window.postMessage({ ...payload, source: EXT, id }, window.location.origin);
  };

  window.addEventListener('message', (event) => {
    // Only accept messages this page sent to itself. Without this any embedded
    // frame could drive the bridge.
    if (event.source !== window) return;
    if (event.origin && event.origin !== window.location.origin) return;

    const msg = event.data;
    if (!msg || msg.source !== SITE || typeof msg.id !== 'string') return;

    // sendMessage has an overload where a string first argument is read as an
    // extension id, so the shape is checked before it gets that far.
    const request = msg.request;
    if (!request || typeof request !== 'object' || typeof request.type !== 'string') {
      reply(msg.id, { ok: false, error: 'Malformed request.' });
      return;
    }

    try {
      chrome.runtime.sendMessage(request, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reply(msg.id, { ok: false, error: `Extension unavailable: ${err.message}` });
          return;
        }
        reply(msg.id, res || { ok: false, error: 'No response from the extension.' });
      });
    } catch (err) {
      reply(msg.id, { ok: false, error: err.message });
    }
  });

  // Announce ourselves so the site can show "connected" without asking. This
  // runs at document_start, before the page's own scripts, so repeat once after
  // load in case nothing was listening yet.
  const hello = () => {
    window.postMessage({
      source: EXT,
      type: 'HELLO',
      version: chrome.runtime.getManifest().version,
    }, window.location.origin);
  };

  hello();
  window.addEventListener('DOMContentLoaded', hello);
}
