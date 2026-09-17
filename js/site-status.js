// Site status: when this copy of the page was published, whether a newer one
// is live, and whether part of the page failed to load.
//
// A CLASSIC script, not a module, loaded in every page's <head> with
//   <script src="js/site-status.js" defer></script>
// placed BEFORE the page's module scripts. Deferred classic scripts and module
// scripts run in document order, so this one is listening before any module
// gets the chance to fail. As a classic script it also still runs when a
// module import is what broke.
//
// Three things, all self-contained (own styles, no imports, no console output):
//
//  1. A footer line, "Site updated 16 Sep 18:52", from document.lastModified.
//     GitHub Pages sends Last-Modified, and every file of a deploy shares it.
//     Tim has twice thought a change had not deployed when it had; this is the
//     line that settles it.
//
//  2. Once, about five seconds after load and only while the tab is visible,
//     ONE request: a HEAD of this same page, bypassing the cache. If what is
//     live is newer than what is on screen, a slim bar offers a reload. Pages
//     are cached for ten minutes, which is how the stale copy happens. Any
//     failure is silent. Never on file://.
//
//  3. A red strip when something breaks the page and nothing caught it: a
//     <script> that failed to load (a module whose import 404s fires this),
//     an uncaught error, an unhandled promise rejection. Errors thrown by
//     browser extensions, and the harmless ResizeObserver loop warning, are
//     ignored. Errors a page already handles never reach these listeners.

(function () {
  'use strict';

  var w = typeof window !== 'undefined' ? window : null;
  if (!w || !w.document || w.__ffSiteStatus) return;
  w.__ffSiteStatus = true;

  var d = w.document;
  var later = typeof w.setTimeout === 'function' ? w.setTimeout.bind(w) : null;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CHECK_AFTER_MS = 5000;
  var MAX_DETAILS = 5;

  // Colours come from css/app.css's tokens, with the same values as fallbacks
  // so a page that failed to load its stylesheet still gets a readable strip.
  var CSS =
    '.site-stamp{max-width:1180px;margin:36px auto 0;padding:0 20px;' +
      'color:var(--dim,#8b93a1);font-size:12px;}' +
    '.site-bar{position:sticky;top:0;z-index:50;display:flex;flex-wrap:wrap;' +
      'align-items:center;gap:6px 12px;padding:6px 20px;font-size:13px;' +
      'line-height:1.4;border-bottom:1px solid var(--line-2,#39414f);' +
      'background:var(--panel-3,#232833);color:var(--text,#e6e8ec);}' +
    '.site-bar button{font:inherit;font-size:12px;padding:2px 10px;cursor:pointer;' +
      'border-radius:var(--r-2,6px);border:1px solid var(--line-2,#39414f);' +
      'background:var(--panel,#171a21);color:var(--text,#e6e8ec);}' +
    '.site-bar button:hover{border-color:var(--text,#e6e8ec);}' +
    '.site-bar button:focus-visible{outline:2px solid var(--focus,#6ea8fe);outline-offset:1px;}' +
    '.site-bar.is-newer button{background:var(--accent,#3ba55d);' +
      'border-color:var(--accent,#3ba55d);color:var(--on-accent,#06210f);font-weight:600;}' +
    '.site-bar.is-broken{background:#3a1519;border-bottom-color:var(--err,#e0525f);}' +
    '.site-bar.is-broken button{border-color:var(--err,#e0525f);}' +
    '.site-bar details{flex-basis:100%;color:var(--dim,#8b93a1);font-size:12px;}' +
    '.site-bar summary{cursor:pointer;width:max-content;}' +
    '.site-bar ul{margin:4px 0 2px;padding-left:18px;}' +
    '.site-bar li{overflow-wrap:anywhere;}';

  function el(tag, cls, text) {
    var node = d.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  var styled = false;
  function addStyles() {
    if (styled || !d.head) return;
    styled = true;
    var style = el('style');
    style.setAttribute('data-site-status', '');
    style.textContent = CSS;
    d.head.appendChild(style);
  }

  function whenBody(fn) {
    if (d.body) fn();
    else d.addEventListener('DOMContentLoaded', fn);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** "16 Sep 18:52", in the reader's local time. */
  function formatStamp(date) {
    return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' +
      pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  /** A Date, or null. Whole seconds, since both sources only carry those. */
  function toDate(value) {
    if (!value) return null;
    var t = new Date(value).getTime();
    if (!isFinite(t)) return null;
    return new Date(Math.floor(t / 1000) * 1000);
  }

  var published = toDate(d.lastModified);

  function reload() {
    try { w.location.reload(); } catch (e) { /* nothing better to do */ }
  }

  function makeBar(kind, message) {
    addStyles();
    var bar = el('div', 'site-bar ' + kind);
    bar.setAttribute('role', kind === 'is-broken' ? 'alert' : 'status');
    bar.appendChild(el('span', null, message));
    var button = el('button', null, 'Reload');
    button.type = 'button';
    button.addEventListener('click', reload);
    bar.appendChild(button);
    return bar;
  }

  function prepend(node) {
    whenBody(function () { d.body.insertBefore(node, d.body.firstChild); });
  }

  // ---- 1. the stamp --------------------------------------------------------

  function addStamp() {
    if (!published || d.querySelector('footer.site-stamp')) return;
    addStyles();
    var footer = el('footer', 'site-stamp');
    var time = el('time', null, formatStamp(published));
    try { time.setAttribute('datetime', published.toISOString()); } catch (e) { /* invalid */ }
    footer.appendChild(d.createTextNode('Site updated '));
    footer.appendChild(time);
    d.body.appendChild(footer);
  }

  // ---- 2. is a newer copy live? --------------------------------------------

  var checked = false;
  var newerShown = false;

  function checkForNewer() {
    if (checked) return;
    checked = true;
    if (!published || typeof w.fetch !== 'function') return;
    var p;
    try {
      p = w.fetch(w.location.href, { method: 'HEAD', cache: 'no-store' });
    } catch (e) { return; }
    if (!p || typeof p.then !== 'function') return;
    p.then(function (res) {
      if (!res || !res.ok || !res.headers || newerShown) return;
      var live = toDate(res.headers.get('last-modified'));
      if (live && live.getTime() > published.getTime()) {
        newerShown = true;
        prepend(makeBar('is-newer', 'A newer version of the site is live.'));
      }
    }).catch(function () { /* silent by design */ });
  }

  function isVisible() {
    return !d.visibilityState || d.visibilityState === 'visible';
  }

  function scheduleCheck() {
    if (!later) return;
    later(function () {
      if (isVisible()) { checkForNewer(); return; }
      // Hidden: check the first time the reader comes back to the tab.
      var onShow = function () {
        if (!isVisible()) return;
        d.removeEventListener('visibilitychange', onShow);
        checkForNewer();
      };
      d.addEventListener('visibilitychange', onShow);
    }, CHECK_AFTER_MS);
  }

  var proto = w.location && w.location.protocol;
  var online = proto === 'http:' || proto === 'https:';

  // ---- 3. something broke --------------------------------------------------

  var EXTENSION_RE = /\b(?:chrome|moz|safari(?:-web)?|ms-browser)-extension:\/\//;
  var BENIGN_RE = /ResizeObserver loop/;

  var strip = null;
  var list = null;
  var count = 0;

  function report(message) {
    count++;
    if (!strip) {
      strip = makeBar('is-broken', 'Part of this page failed to load.');
      var details = el('details');
      details.appendChild(el('summary', null, 'What failed'));
      list = el('ul');
      details.appendChild(list);
      strip.appendChild(details);
      prepend(strip);
    }
    if (count <= MAX_DETAILS) {
      list.appendChild(el('li', null, message));
    } else if (count === MAX_DETAILS + 1) {
      list.appendChild(el('li', null, 'And more.'));
    }
  }

  function fromExtension(text) {
    return typeof text === 'string' && EXTENSION_RE.test(text);
  }

  function onError(event) {
    try {
      var target = event && event.target;
      // A resource that failed to load. Only scripts: an image that 404s (a
      // player headshot, say) does not break the page.
      if (target && target !== w && target.tagName) {
        if (String(target.tagName).toUpperCase() !== 'SCRIPT') return;
        var src = target.src || (target.getAttribute && target.getAttribute('src')) || '';
        if (fromExtension(src)) return;
        report('Could not load ' + (src ? src.replace(/^.*\//, '') : 'an inline script') + '.');
        return;
      }
      var message = (event && event.message) || '';
      var error = event && event.error;
      if (BENIGN_RE.test(message)) return;
      if (fromExtension(event && event.filename)) return;
      if (error && fromExtension(error.stack)) return;
      // "Script error." with no file is a cross-origin classic script the
      // browser will not describe — an extension's, in practice. Nothing to
      // show and nothing the page can do.
      if (/^Script error\.?$/.test(message) && !(event && event.filename)) return;
      var where = event && event.filename
        ? ' (' + String(event.filename).replace(/^.*\//, '') +
          (event.lineno ? ':' + event.lineno : '') + ')'
        : '';
      report((message || 'An error was thrown.') + where);
    } catch (e) { /* the reporter must never be the thing that breaks */ }
  }

  function onRejection(event) {
    try {
      var reason = event && event.reason;
      var stack = reason && reason.stack;
      if (fromExtension(stack)) return;
      if (reason && reason.name === 'AbortError') return;
      var message = reason && reason.message ? reason.message : String(reason);
      if (BENIGN_RE.test(message)) return;
      report(message || 'A promise was rejected.');
    } catch (e) { /* as above */ }
  }

  if (typeof w.addEventListener === 'function') {
    w.addEventListener('error', onError, true);
    w.addEventListener('unhandledrejection', onRejection);
  }

  // ---- wire up -------------------------------------------------------------

  whenBody(addStamp);

  if (online) {
    if (d.readyState === 'complete') scheduleCheck();
    else if (typeof w.addEventListener === 'function') w.addEventListener('load', scheduleCheck);
  }
})();
