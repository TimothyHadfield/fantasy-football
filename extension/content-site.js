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

const inScope = ALLOWED_SCOPES.some((s) =>
  window.location.origin === s.origin && window.location.pathname.startsWith(s.path));

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
