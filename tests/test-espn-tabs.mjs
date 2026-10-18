// extension/content-espn-tabs.js against ESPN's own league page markup.
//
// Tim, 2026-10-17: "Let's build the custom tab on ESPN through extension. Name
// it Analysis and make everything in it the same style as what is on the other
// tabs of ESPN", then "another extension tab to the ESPN Cite that is called
// Trade".
//
// The page is tests/fixtures/espn-league-1241838.html: fantasy.espn.com's
// league page as ESPN served it on 2026-10-17 (signed out), scripts removed.
// A signed-in league adds My Team / League / Players items to the same list,
// built the same way (the "loggedIn" variant below adds them).
//
// What this suite holds the script to:
//   1. Two tabs, Analysis then Trade, in ESPN's own nav list and ESPN's own
//      markup (NavSecondary__Item > AnchorLink NavSecondary__Link > ...
//      NavMain__Text), before the right-hand group, and only on a league page.
//   2. A tab is a URL (#ffx-analysis / #ffx-trade): opening one pushes a
//      history entry carrying ESPN's own state, so back/forward and reload work.
//   3. The tab's frames are the site's own pages, framed as ?embed=espn, seeded
//      with the site's choices for THAT league and nobody else's.
//   4. ESPN re-rendering its nav or page puts the tabs and the view back.
//   5. Only the site may say its frame is drawn; nothing else is believed.
//   6. (2026-10-18) One window-high frame per tab, scrolling inside itself, in
//      a box outside ESPN's React tree — tall frames scrolled by ESPN's page
//      were drawn late (blank while scrolling).

import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { repoFile } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const SOURCE = fs.readFileSync(repoFile('extension/content-espn-tabs.js'), 'utf8');
const FIXTURE = fs.readFileSync(repoFile('tests/fixtures/espn-league-1241838.html'), 'utf8');
const SITE_ORIGIN = 'https://timothyhadfield.github.io';

const LOGGED_IN_ITEMS = ['My Team', 'League', 'Players', 'Scoreboard', 'Standings']
  .map((t) => `<li class="NavSecondary__Item"><a class="AnchorLink NavSecondary__Link" tabindex="0" href="/football/x"><span class="NavSecondary__TextContainer"><span class="NavMain__Text">${t}</span></span></a></li>`)
  .join('');

/** A realistic mirror: what content-site.js keeps after the site was opened. */
function mirrorFor(leagueId, season = 2026) {
  const prefs = { 'stats.source': 'live', 'stats.view.weekly': 'luck', 'analysis.measure': 'avg', '@league': `${leagueId}-${season}` };
  return {
    at: 1760000000000,
    from: 'site',
    keys: {
      'ff.prefs': JSON.stringify(prefs),
      'ff.connection': JSON.stringify({ leagueId: String(leagueId), season, teamId: 4, league: { name: 'Test', teams: [] }, source: 'espn' }),
      'ff.config': JSON.stringify({ leagueId: String(leagueId), season }),
      [`ff.value.${leagueId}-${season}`]: JSON.stringify({ lines: { RB: 9.1 } }),
      'ff.value.999-2026': JSON.stringify({ lines: { RB: 1 } }),
    },
  };
}

/**
 * Boot the content script on `href`. Returns handles to drive it. Timers and
 * the observer are collected rather than run, and fired by hand.
 */
function boot(href, { loggedIn = false, mirror = mirrorFor(1241838) } = {}) {
  let html = FIXTURE;
  if (loggedIn) html = html.replace('<li class="jsx-1130011762 right-subnav">', `${LOGGED_IN_ITEMS}<li class="jsx-1130011762 right-subnav">`);
  const { window, document } = parseHTML(html);

  let url = new URL(href);
  const entries = [{ url: url.href, state: { url: url.pathname + url.search, as: url.pathname + url.search, options: {} } }];
  let index = 0;
  const listeners = {};
  const intervals = [];
  const observers = [];
  const posted = [];
  const location = {
    get href() { return url.href; }, get origin() { return url.origin; },
    get pathname() { return url.pathname; }, get search() { return url.search; },
    get hash() { return url.hash; },
  };
  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state, _t, u) { url = new URL(u, url); entries.splice(index + 1); entries.push({ url: url.href, state }); index += 1; },
    replaceState(state, _t, u) { url = new URL(u, url); entries[index] = { url: url.href, state }; },
  };
  const fire = (type, ev = {}) => (listeners[type] || []).forEach((fn) => fn(ev));
  // ESPN runs Next.js's page router. On Back/Forward it rewrites the address to
  // the entry's state.as (measured on the real page, 2026-10-17), so an entry
  // whose state still says the old address loses its hash.
  const nextRouter = () => { const st = entries[index].state; if (st && st.as) history.replaceState(st, '', st.as); };
  const back = () => { index -= 1; url = new URL(entries[index].url); nextRouter(); fire('popstate', { state: entries[index].state }); };
  const forward = () => { index += 1; url = new URL(entries[index].url); nextRouter(); fire('popstate', { state: entries[index].state }); };

  class FakeObserver {
    constructor(fn) { this.fn = fn; observers.push(this); }
    observe() {}
    disconnect() {}
  }

  const win = {
    document, location, history, URL, URLSearchParams, JSON, Date, Math, Number, String, Object, Array, Promise,
    innerHeight: 900,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: () => {},
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => { fn(); return 0; },
    getComputedStyle: () => ({ position: 'sticky' }),
    MutationObserver: FakeObserver,
    console,
  };
  win.window = win;
  win.top = win;

  const chrome = {
    storage: { local: { get: (keys, cb) => { const out = mirror ? { siteMirror: mirror } : {}; if (cb) cb(out); return Promise.resolve(out); } } },
    runtime: { lastError: undefined },
  };
  const context = { window: win, document, chrome, URL, URLSearchParams, console };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'content-espn-tabs.js' });

  const api = win.__ffxTabs;
  const tabs = () => [...document.querySelectorAll('nav.NavSecondary ul.NavSecondary__List > li')];
  const ours = () => tabs().filter((li) => li.hasAttribute('data-ffx'));
  const frames = () => [...document.querySelectorAll('#ffx-view iframe')];
  const tick = () => { intervals.forEach((t) => t.fn()); observers.forEach((o) => o.fn([])); };
  return { window: win, document, api, tabs, ours, frames, tick, fire, back, forward, posted, entries: () => entries, url: () => url };
}

const LEAGUE_URL = 'https://fantasy.espn.com/football/league?leagueId=1241838';

// ---- 1. the tabs, in ESPN's markup and place --------------------------------
{
  const b = boot(LEAGUE_URL);
  ok(b.api && typeof b.api.sync === 'function', 'the script exposes its sync for the suite');
  const names = b.ours().map((li) => li.textContent.trim());
  eq(JSON.stringify(names), JSON.stringify(['Analysis', 'Trade']), 'two tabs: Analysis, then Trade');
  const li = b.ours()[0];
  ok(li.classList.contains('NavSecondary__Item'), 'a tab is an ESPN NavSecondary__Item');
  const a = li.querySelector('a');
  ok(a && a.classList.contains('AnchorLink') && a.classList.contains('NavSecondary__Link'), 'its link is ESPN’s AnchorLink NavSecondary__Link');
  ok(li.querySelector('.NavSecondary__TextContainer > .NavMain__Text'), 'and its text sits in ESPN’s own two spans');
  eq(a.getAttribute('href'), '#ffx-analysis', 'the link is the tab’s URL');
  const all = b.tabs();
  const right = all.findIndex((x) => x.classList.contains('right-subnav'));
  ok(right > all.indexOf(b.ours()[1]), 'both sit before ESPN’s right-hand group');
  ok(!li.classList.contains('active'), 'and neither is active on ESPN’s own page');
  ok(!b.document.documentElement.classList.contains('ffx-on'), 'ESPN’s page is left showing');
  eq(b.frames().length, 0, 'and nothing is framed until a tab is opened');
}
{
  const b = boot(LEAGUE_URL, { loggedIn: true });
  const texts = b.tabs().map((li) => li.textContent.trim()).filter(Boolean);
  const iStand = texts.indexOf('Standings');
  eq(texts[iStand + 1], 'Analysis', 'signed in: Analysis follows ESPN’s last tab');
  eq(texts[iStand + 2], 'Trade', 'and Trade follows Analysis');
}
{
  const b = boot('https://fantasy.espn.com/football/welcome');
  eq(b.ours().length, 0, 'no league in the URL: no tabs');
}

// ---- 2. opening a tab --------------------------------------------------------
{
  const b = boot(LEAGUE_URL);
  b.ours()[0].querySelector('a').dispatchEvent(new b.document.defaultView.Event('click', { bubbles: true, cancelable: true }));
  await b.api.ready();
  eq(b.url().hash, '#ffx-analysis', 'a click opens #ffx-analysis');
  eq(b.entries().length, 2, 'as a new history entry, so Back returns to ESPN’s page');
  ok(b.entries()[1].state && b.entries()[1].state.url === '/football/league?leagueId=1241838', 'carrying ESPN’s own history state');
  eq(b.entries()[1].state && b.entries()[1].state.as, '/football/league?leagueId=1241838#ffx-analysis', 'with its address set to the tab, so ESPN’s router keeps the hash');
  ok(b.ours()[0].classList.contains('active'), 'the Analysis tab is underlined');
  ok(b.document.documentElement.classList.contains('ffx-on'), 'the page is in tab mode');
  const host = b.document.querySelector('[data-ffx-host]');
  ok(host && host.classList.contains('page-container'), 'ESPN’s page container is the one hidden under the view');
  const view = b.document.getElementById('ffx-view');
  // Tim, 2026-10-18: "they only load the parts of the page that you can
  // currently see so if you scroll up and down it's blank for a bit". A frame
  // as tall as its page, scrolled by ESPN's page, is drawn only where it is on
  // screen (measured: tools/espn-tab-check.mjs). The frame is window-high and
  // scrolls inside itself, in a box outside ESPN's React tree (a frame moved
  // to a new parent reloads; ESPN's React threw its tree away 3 times).
  eq(view && view.parentNode, b.document.body, 'the view is a child of <body>, outside ESPN’s React tree');
  ok(/\n#ffx-view \{[^}]*position: fixed/.test(b.document.getElementById('ffx-style').textContent), 'fixed from under ESPN’s nav to the window’s bottom');
  ok(/html\.ffx-on, html\.ffx-on body \{ overflow: hidden/.test(b.document.getElementById('ffx-style').textContent), 'and ESPN’s page does not scroll under it');
  ok(/^\d+px$/.test(view.style.top || ''), 'its top is set below ESPN’s nav', view.style.top);

  const fr = b.frames();
  eq(fr.length, 1, 'Analysis is ONE frame, so one scroll runs through it');
  ok(!fr[0].hasAttribute('scrolling'), 'and the frame scrolls inside itself (no scrolling="no")');
  const u0 = new URL(fr[0].getAttribute('src'));
  eq(u0.origin + u0.pathname, `${SITE_ORIGIN}/fantasy-football/stats.html`, 'the Stats page');
  eq(u0.searchParams.get('next'), 'analysis', 'with the Analysis page’s panels brought in below');
  eq(u0.searchParams.get('embed'), 'espn', 'framed as ?embed=espn');
  eq(u0.searchParams.get('part'), 'stats', 'with its part');
  const seed = JSON.parse(decodeURIComponent(u0.hash.replace(/^#seed=/, '')));
  eq(seed['ff.prefs'], mirrorFor(1241838).keys['ff.prefs'], 'seeded with the site’s own choices');
  eq(JSON.parse(seed['ff.connection']).leagueId, '1241838', 'for the league ESPN is showing');
  eq(JSON.parse(seed['ff.connection']).teamId, 4, 'with the team the site knows is his');
  ok(seed['ff.value.1241838-2026'], 'and that league’s Value lines');
  ok(!('ff.value.999-2026' in seed), 'and no other league’s');

  // Trade
  b.ours()[1].querySelector('a').dispatchEvent(new b.document.defaultView.Event('click', { bubbles: true, cancelable: true }));
  await b.api.ready();
  eq(b.url().hash, '#ffx-trade', 'Trade opens #ffx-trade');
  ok(b.ours()[1].classList.contains('active') && !b.ours()[0].classList.contains('active'), 'and only Trade is underlined');
  const visible = b.frames().filter((f) => !f.closest('[hidden]'));
  eq(visible.length, 1, 'Trade shows one frame');
  eq(new URL(visible[0].getAttribute('src')).pathname, '/fantasy-football/trade.html', 'the Trade page');
  eq(b.frames().length, 2, 'and Analysis stays loaded behind it');

  // back, back
  b.back();
  eq(b.url().hash, '#ffx-analysis', 'Back returns to Analysis');
  ok(b.ours()[0].classList.contains('active'), 'and underlines it again');
  b.back();
  ok(!b.document.documentElement.classList.contains('ffx-on'), 'Back again is ESPN’s page');
  ok(!b.ours()[0].classList.contains('active'), 'with no tab of ours underlined');
  b.forward();
  ok(b.document.documentElement.classList.contains('ffx-on'), 'Forward opens the tab again');
}
{
  // A reload on the tab's URL opens it straight away.
  const b = boot(`${LEAGUE_URL}#ffx-trade`);
  await b.api.ready();
  ok(b.document.documentElement.classList.contains('ffx-on'), 'a reload on #ffx-trade opens Trade');
  eq(b.frames().length, 1, 'with its one frame');
}
{
  // ESPN's own tab, clicked while ours is open, gets ESPN's page back.
  const b = boot(`${LEAGUE_URL}#ffx-analysis`, { loggedIn: true });
  await b.api.ready();
  const espnLink = b.tabs().find((li) => li.textContent.trim() === 'Players').querySelector('a');
  espnLink.dispatchEvent(new b.document.defaultView.Event('click', { bubbles: true, cancelable: true }));
  ok(!b.document.documentElement.classList.contains('ffx-on'), 'ESPN’s own tab closes ours');
  eq(b.url().hash, '', 'and leaves ESPN’s URL as it was');
}

// ---- 3. another league ESPN is showing --------------------------------------
{
  const b = boot('https://fantasy.espn.com/football/team?leagueId=555&teamId=2&seasonId=2026#ffx-analysis');
  await b.api.ready();
  const u = new URL(b.frames()[0].getAttribute('src'));
  const seed = JSON.parse(decodeURIComponent(u.hash.replace(/^#seed=/, '')));
  eq(JSON.parse(seed['ff.connection']).leagueId, '555', 'another league: the frame reads that league');
  eq(JSON.parse(seed['ff.connection']).teamId, null, 'without claiming the site’s team for it');
  ok(!('ff.prefs' in seed), 'and without the site’s league’s choices');
  ok(!Object.keys(seed).some((k) => k.startsWith('ff.value.')), 'or its Value lines');
}
{
  const b = boot(`${LEAGUE_URL}#ffx-analysis`, { mirror: null });
  await b.api.ready();
  eq(b.frames().length, 1, 'never opened the site yet: the frame still loads');
  const seed = JSON.parse(decodeURIComponent(new URL(b.frames()[0].getAttribute('src')).hash.replace(/^#seed=/, '')));
  eq(JSON.parse(seed['ff.connection']).leagueId, '1241838', 'on the league in ESPN’s URL');
}

// ---- 4. ESPN re-rendering ---------------------------------------------------
{
  const b = boot(`${LEAGUE_URL}#ffx-analysis`);
  await b.api.ready();
  // React replaces the nav list and the page container.
  const list = b.document.querySelector('ul.NavSecondary__List');
  list.querySelectorAll('[data-ffx]').forEach((li) => li.remove());
  const pc = b.document.querySelector('.page-container');
  const fresh = b.document.createElement('div');
  fresh.className = 'page-container cf';
  fresh.innerHTML = '<div class="layout">ESPN</div>';
  pc.replaceWith(fresh);
  b.tick();
  eq(b.ours().length, 2, 'tabs put back after ESPN re-renders its nav');
  ok(b.document.querySelector('.page-container').hasAttribute('data-ffx-host'), 'the new container is hidden under the view');
  eq(b.document.getElementById('ffx-view').parentNode, b.document.body, 'and the view never moved');
  eq(b.frames().length, 1, 'with the same frame, not a reloaded copy');
  b.tick();
  eq(b.ours().length, 2, 'and never doubled');
}

// ---- 5. who may size a frame -------------------------------------------------
{
  const b = boot(`${LEAGUE_URL}#ffx-analysis`);
  await b.api.ready();
  const [f0] = b.frames();
  const fakeSource = {};
  f0.contentWindow = fakeSource;   // linkedom has no frame windows; the script compares identity
  const spin = () => b.document.querySelector('#ffx-view .ffx-loading');
  b.fire('message', { origin: 'https://evil.example', source: fakeSource, data: { type: 'ffx-height', height: 3000 } });
  ok(!f0.hasAttribute('data-sized') && spin(), 'a message from anywhere but the site is ignored');
  b.fire('message', { origin: SITE_ORIGIN, source: {}, data: { type: 'ffx-height', height: 3000 } });
  ok(!f0.hasAttribute('data-sized') && spin(), 'and so is the site’s message for a frame that is not ours');
  b.fire('message', { origin: SITE_ORIGIN, source: fakeSource, data: { type: 'ffx-height', height: 1e9 } });
  ok(!f0.hasAttribute('data-sized'), 'or one with an absurd height');
  b.fire('message', { origin: SITE_ORIGIN, source: fakeSource, data: { type: 'ffx-height', height: 2468.4 } });
  ok(f0.hasAttribute('data-sized') && !spin(), 'the site’s own "drawn" shows its frame and ends the spinner');
  eq(f0.style.height, '', 'and does not size it: the frame is the box’s height and scrolls inside');
}

// ---- the script's own hygiene -----------------------------------------------
{
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(code), 'it builds no HTML from strings');
  ok(!/\bfetch\s*\(|XMLHttpRequest|sendMessage/.test(code), 'it makes no request and asks the worker nothing');
  ok(!/\.click\s*\(|dispatchEvent/.test(code), 'it clicks nothing of ESPN’s');
}

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
