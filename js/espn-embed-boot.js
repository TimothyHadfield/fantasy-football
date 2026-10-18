// THE ESPN TABS' HALF ON THE SITE (Tim, 2026-10-17: "add a new tab at the top
// of the cite ... Name it Analysis"; then "another extension tab ... called
// Trade").
//
// The Fantasy Football Bridge extension adds two tabs to ESPN's own league
// navigation. Each shows a few panels of THIS site, framed inside ESPN's page,
// so the numbers come from the very same page modules and cannot drift:
//
//   Analysis  stats.html    Standings & season totals, Week by week, and
//                           Schedule luck / Roster strength / Future proj diff
//                           as one panel with a picker
//             analysis.html All teams, Weekly totals, Season by week
//   Trade     trade.html    Your team, Custom trades, Trades ranked by net
//                           increase
//
// A classic script in <head>, synchronous on purpose: everything here must be
// done before the page's own modules read localStorage.
//
// IT DOES NOTHING unless the page was opened as `?embed=espn` AND it is a frame
// whose every ancestor is fantasy.espn.com. Opened any other way — a link, a
// bookmark, a page somebody else framed — it is the normal page, untouched.
//
// THE SEED. A frame inside espn.com has its own, partitioned, localStorage: it
// cannot see the site's. The extension therefore hands this frame the site's
// own choices in the URL's #seed= (ff.prefs, the league slot, the kept Value
// lines), and they are written here, before any module runs, so every table
// opens with the same sort, view, switch and team as on the site. Choices made
// in the ESPN tab go back the other way through extension/content-site.js.
(function () {
  'use strict';
  var ESPN = 'https://fantasy.espn.com';
  var PARTS = { stats: 1, analysis: 1, trade: 1 };
  var SEED_KEY = /^ff\.(prefs|connection|config|value\.\d{1,12}-\d{4})$/;

  var q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.get('embed') !== 'espn') return;
  var part = q.get('part');
  if (!PARTS[part]) return;

  var framed;
  try { framed = window.top !== window; } catch (e) { framed = true; }
  var anc = location.ancestorOrigins;
  if (!framed || !anc || !anc.length) return;
  for (var i = 0; i < anc.length; i += 1) if (anc[i] !== ESPN) return;

  var root = document.documentElement;
  root.classList.add('espn-embed');
  root.setAttribute('data-embed', part);

  // Nothing is shown until the ESPN skin has loaded: the site is dark, and a
  // dark flash inside ESPN's white page is the first thing anyone would see.
  var hold = document.createElement('style');
  hold.id = 'espnEmbedHold';
  hold.textContent = 'html.espn-embed body{visibility:hidden}';
  document.head.appendChild(hold);

  var m = /(?:^#|&)seed=([^&]*)/.exec(location.hash || '');
  if (m) {
    try {
      var seed = JSON.parse(decodeURIComponent(m[1]));
      if (seed && typeof seed === 'object') {
        Object.keys(seed).forEach(function (k) {
          if (SEED_KEY.test(k) && typeof seed[k] === 'string') localStorage.setItem(k, seed[k]);
        });
      }
    } catch (e) { /* a bad seed is no seed: the frame's own choices stand */ }
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* cosmetic */ }
  }

  // The tab is for his league, so every page in it reads the league, never the
  // sample. Each page keeps its own source switch ("stats.source", ...).
  try {
    var prefs = JSON.parse(localStorage.getItem('ff.prefs') || '{}') || {};
    if (prefs[part + '.source'] !== 'live') {
      prefs[part + '.source'] = 'live';
      localStorage.setItem('ff.prefs', JSON.stringify(prefs));
    }
  } catch (e) { /* storage refused: the page's own fallback applies */ }

  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'css/espn-embed.css';
  document.head.appendChild(css);

  var mod = document.createElement('script');
  mod.type = 'module';
  mod.src = 'js/espn-embed.js';
  document.head.appendChild(mod);
})();
