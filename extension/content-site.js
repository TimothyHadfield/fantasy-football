// Runs on the Fantasy Football site and is the only thing the page can talk to.
//
// The page and the extension live in different worlds and cannot call each
// other directly, so everything crosses through window.postMessage here. The
// page never gets access to the extension's privileges — it can only ask for
// the specific request types background.js is willing to answer.

const SITE = 'ff-site';   // messages from the page
const EXT = 'ff-ext';     // messages from us

function reply(id, payload) {
  window.postMessage({ source: EXT, id, ...payload }, window.location.origin);
}

window.addEventListener('message', (event) => {
  // Only accept messages this page sent to itself. Without this check any
  // embedded frame could drive the bridge.
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== SITE || typeof msg.id !== 'string') return;

  try {
    chrome.runtime.sendMessage(msg.request, (res) => {
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

// Announce ourselves so the site can show "connected" without having to ask.
// document_start means this runs before the page's own scripts, but the page
// may not be listening yet, so repeat once after load.
function hello() {
  window.postMessage({
    source: EXT,
    type: 'HELLO',
    version: chrome.runtime.getManifest().version,
  }, window.location.origin);
}

hello();
window.addEventListener('DOMContentLoaded', hello);
