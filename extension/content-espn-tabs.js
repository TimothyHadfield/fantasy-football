// Two tabs of our own in ESPN's league navigation: Analysis and Trade.
//
// Tim, 2026-10-17: "Let's build the custom tab on ESPN through extension. Name
// it Analysis and make everything in it the same style as what is on the other
// tabs of ESPN." Then: "I want to add another extension tab to the ESPN Cite
// that is called Trade".
//
// HOW. Each tab shows pages of the Fantasy Football site itself, framed inside
// ESPN's page as `?embed=espn&part=...` (js/espn-embed-boot.js on the site
// picks the panels and puts on ESPN's look). Nothing is re-implemented here: the
// numbers are the site's own modules', so they cannot drift from the site.
//
//   Analysis  stats.html then analysis.html, one frame each, stacked
//   Trade     trade.html
//
// THE SITE'S CHOICES. A frame inside espn.com cannot read the site's storage,
// so content-site.js keeps a mirror of the site's small keys in this
// extension's storage, and each frame is handed them in its URL (#seed=) for
// the league ESPN is showing — and only when that is the league the site has
// open, so another league never gets this one's choices or team.
//
// WHAT THIS SCRIPT MAY DO ON ESPN'S PAGE: add two list items to the Fantasy
// nav, add one view to the page container, hide ESPN's page while a tab of
// ours is open, and change the URL's hash. It clicks nothing of ESPN's, makes
// no request, asks the worker nothing, and builds no HTML out of strings.
//
// ESPN IS A REACT APP. It can re-render the nav or the page at any moment, and
// it moves between its own pages without a reload. So everything is idempotent
// and re-run: on a DOM change (MutationObserver), on Back/Forward (popstate),
// on a hash change, and on a slow poll of the URL (ESPN's own pushState cannot
// be heard from a content script). The frames themselves are made once per tab
// and league and moved back if ESPN throws the container away.

(() => {
  'use strict';

  const win = window;
  const doc = win.document;

  const SITE_ORIGIN = 'https://timothyhadfield.github.io';
  const SITE = `${SITE_ORIGIN}/fantasy-football/`;
  const HASH = '#ffx-';
  const TABS = [
    { key: 'analysis', label: 'Analysis', frames: [{ page: 'stats.html', part: 'stats' }, { page: 'analysis.html', part: 'analysis' }] },
    { key: 'trade', label: 'Trade', frames: [{ page: 'trade.html', part: 'trade' }] },
  ];
  const MAX_FRAME_PX = 100000;
  const POLL_MS = 400;

  // ------------------------------------------------------------ the URL

  function leagueFromUrl() {
    let q;
    try { q = new win.URLSearchParams(win.location.search); } catch { return null; }
    const leagueId = q.get('leagueId') || '';
    if (!/^\d{1,12}$/.test(leagueId)) return null;
    const s = q.get('seasonId') || '';
    return { leagueId, season: /^\d{4}$/.test(s) ? Number(s) : null };
  }

  function activeKey() {
    const h = win.location.hash || '';
    const tab = TABS.find((t) => h === HASH + t.key);
    return tab ? tab.key : null;
  }

  /** js/bridge.js `currentSeason`: the NFL season that began this calendar year from July. */
  function thisSeason() {
    const now = new Date();
    return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
  }

  // ESPN's own history state goes with each entry, so its router (Next.js) sees
  // "the same page, only the hash moved". That router rewrites the address to
  // the entry's state.as on Back and Forward, so `as` must name the tab too.
  function stateFor(url) {
    const st = win.history.state;
    return st && typeof st === 'object' && typeof st.as === 'string' ? { ...st, as: url } : st;
  }

  function go(key) {
    if (activeKey() === key) return;
    const url = win.location.pathname + win.location.search + HASH + key;
    win.history.pushState(stateFor(url), '', url);
    sync();
  }

  function leaveTab() {
    if (!activeKey()) return;
    const url = win.location.pathname + win.location.search;
    win.history.replaceState(stateFor(url), '', url);
    sync();
  }

  // ------------------------------------------------------------ the mirror

  let mirror;          // undefined until read; null when there is none
  let mirrorRead = null;

  function readMirror() {
    if (!mirrorRead) {
      mirrorRead = new Promise((resolve) => {
        try {
          const area = chrome.storage && chrome.storage.local;
          if (!area) { resolve(null); return; }
          area.get(['siteMirror'], (got) => {
            const m = got && got.siteMirror;
            resolve(m && m.keys && typeof m.keys === 'object' ? m : null);
          });
        } catch { resolve(null); }
      }).then((m) => { mirror = m; return m; });
    }
    return mirrorRead;
  }

  const parse = (raw) => { try { return JSON.parse(raw || 'null'); } catch { return null; } };

  /** What one frame is handed, for the league ESPN is showing. */
  function seedFor(league) {
    const keys = (mirror && mirror.keys) || {};
    const conn = parse(keys['ff.connection']);
    const season = league.season || (conn && Number(conn.season)) || thisSeason();
    const same = Boolean(conn && String(conn.leagueId) === league.leagueId
      && (!league.season || Number(conn.season) === league.season));
    const seed = {};
    seed['ff.connection'] = JSON.stringify(same
      ? { ...conn, season, source: 'espn' }
      : { leagueId: league.leagueId, season, teamId: null, source: 'espn' });
    seed['ff.config'] = JSON.stringify({ leagueId: league.leagueId, season });
    if (same) {
      if (typeof keys['ff.prefs'] === 'string') seed['ff.prefs'] = keys['ff.prefs'];
      const vk = `ff.value.${league.leagueId}-${season}`;
      if (typeof keys[vk] === 'string') seed[vk] = keys[vk];
    }
    return seed;
  }

  function frameSrc(f, league, seed) {
    const u = new win.URL(f.page, SITE);
    u.searchParams.set('embed', 'espn');
    u.searchParams.set('part', f.part);
    u.searchParams.set('league', league.leagueId);
    return `${u.toString()}#seed=${encodeURIComponent(JSON.stringify(seed))}`;
  }

  // ------------------------------------------------------------ the look

  // ESPN's own nav rules draw the underline, but only under `.bp-desktopPlus`
  // and only for `.active`; ours copy that so the tab reads as one of theirs
  // at every width, and take ESPN's underline off its own item while ours is
  // open (React set that class; it is not ours to remove).
  const STYLE = `
html.ffx-on [data-ffx-host] > :not(#ffx-view) { display: none !important; }
html:not(.ffx-on) #ffx-view { display: none !important; }
html.ffx-on .NavSecondary__Item.active:not([data-ffx]) { box-shadow: none !important; }
.NavSecondary__Item[data-ffx].active { box-shadow: inset 0 -3px 0 #2DCC30 !important; }
#ffx-view { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.24); padding: 12px 16px 16px; margin: 0 0 16px; min-height: 240px; }
#ffx-view iframe { display: block; width: 100%; height: 0; border: 0; overflow: hidden; }
#ffx-view .ffx-loading { height: 200px; display: flex; align-items: center; justify-content: center; }
`;

  function ensureStyle() {
    if (doc.getElementById('ffx-style')) return;
    const s = doc.createElement('style');
    s.id = 'ffx-style';
    s.textContent = STYLE;
    (doc.head || doc.documentElement).appendChild(s);
  }

  // ------------------------------------------------------------ the tabs

  function navList() {
    return doc.querySelector('nav.NavSecondary ul.NavSecondary__List');
  }

  function makeTab(tab) {
    const li = doc.createElement('li');
    li.className = 'NavSecondary__Item';
    li.setAttribute('data-ffx', tab.key);
    const a = doc.createElement('a');
    a.className = 'AnchorLink NavSecondary__Link';
    a.setAttribute('tabindex', '0');
    a.setAttribute('href', HASH + tab.key);
    const box = doc.createElement('span');
    box.className = 'NavSecondary__TextContainer';
    const text = doc.createElement('span');
    text.className = 'NavMain__Text';
    text.textContent = tab.label;
    box.appendChild(text);
    a.appendChild(box);
    li.appendChild(a);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      go(tab.key);
    });
    return li;
  }

  const wiredLists = new WeakSet();

  function ensureTabs(league, active) {
    const list = navList();
    if (!list) return;
    if (!league) {
      list.querySelectorAll('li[data-ffx]').forEach((li) => li.remove());
      return;
    }
    const right = Array.from(list.children).find((c) => c.classList.contains('right-subnav')) || null;
    for (const tab of TABS) {
      let li = list.querySelector(`li[data-ffx="${tab.key}"]`);
      if (!li) {
        li = makeTab(tab);
        list.insertBefore(li, right);
      }
      li.classList.toggle('active', tab.key === active);
      if (tab.key === active) li.querySelector('a').setAttribute('aria-current', 'page');
      else li.querySelector('a').removeAttribute('aria-current');
    }
    // One of ESPN's own tabs, pressed while ours is open: give ESPN its page
    // back before its router acts, or a click on the tab of the page already
    // under ours would change nothing.
    if (!wiredLists.has(list)) {
      wiredLists.add(list);
      list.addEventListener('click', (e) => {
        const a = e.target && e.target.closest && e.target.closest('a');
        if (!a || a.closest('li[data-ffx]')) return;
        leaveTab();
      }, true);
    }
  }

  // ------------------------------------------------------------ the view

  const panes = new Map();   // tab key -> { el, league, frames: [iframe] }
  let view = null;

  function host() {
    return doc.querySelector('.page-container') || doc.querySelector('.shell-container') || doc.querySelector('main') || doc.body;
  }

  function ensureView() {
    const h = host();
    if (!h) return null;
    if (!view) {
      view = doc.createElement('div');
      view.id = 'ffx-view';
    }
    doc.querySelectorAll('[data-ffx-host]').forEach((el) => { if (el !== h) el.removeAttribute('data-ffx-host'); });
    h.setAttribute('data-ffx-host', '');
    if (view.parentNode !== h || h.firstElementChild !== view) h.insertBefore(view, h.firstChild);
    return view;
  }

  function loader() {
    // ESPN's own spinner (LoadAnimation in espn-ui.css), until the first frame
    // says how tall it is.
    const box = doc.createElement('div');
    box.className = 'ffx-loading';
    const anim = doc.createElement('div');
    anim.className = 'LoadAnimation LoadAnimation--lightBG LoadAnimation--md';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'LoadAnimation__Spinner');
    svg.setAttribute('width', '30');
    svg.setAttribute('height', '30');
    svg.setAttribute('viewBox', '0 0 30 30');
    const c = doc.createElementNS(NS, 'circle');
    c.setAttribute('class', 'LoadAnimation__Path');
    c.setAttribute('fill', 'none');
    c.setAttribute('cx', '15');
    c.setAttribute('cy', '15');
    c.setAttribute('r', '12');
    c.setAttribute('stroke-width', '3');
    svg.appendChild(c);
    anim.appendChild(svg);
    box.appendChild(anim);
    return box;
  }

  function buildPane(tab, league) {
    const el = doc.createElement('div');
    el.className = 'ffx-pane';
    el.setAttribute('data-ffx-pane', tab.key);
    el.appendChild(loader());
    const seed = seedFor(league);
    const frames = tab.frames.map((f) => {
      const fr = doc.createElement('iframe');
      fr.setAttribute('title', `${tab.label}: ${f.part}`);
      fr.setAttribute('data-part', f.part);
      fr.setAttribute('scrolling', 'no');
      fr.setAttribute('src', frameSrc(f, league, seed));
      el.appendChild(fr);
      return fr;
    });
    return { el, league: league.leagueId + '-' + (league.season || ''), frames };
  }

  async function showPane(key, league) {
    await readMirror();
    // The URL may have moved on while the mirror was read.
    if (activeKey() !== key) return;
    const v = ensureView();
    if (!v) return;
    const tab = TABS.find((t) => t.key === key);
    const id = league.leagueId + '-' + (league.season || '');
    let pane = panes.get(key);
    if (pane && pane.league !== id) {
      pane.el.remove();
      pane = null;
    }
    if (!pane) {
      pane = buildPane(tab, league);
      panes.set(key, pane);
    }
    if (pane.el.parentNode !== v) v.appendChild(pane.el);
    for (const [k, p] of panes) {
      if (k === key) p.el.removeAttribute('hidden');
      else p.el.setAttribute('hidden', '');
    }
    postVis();
  }

  // ------------------------------------------------------------ sync

  let lastHref = '';
  let pending = Promise.resolve();

  function sync() {
    lastHref = win.location.href;
    ensureStyle();
    const league = leagueFromUrl();
    const active = league ? activeKey() : null;
    ensureTabs(league, active);
    const root = doc.documentElement;
    if (active) {
      root.classList.add('ffx-on');
      ensureView();
      pending = showPane(active, league);
    } else {
      root.classList.remove('ffx-on');
      pending = Promise.resolve();
    }
    return pending;
  }

  // ------------------------------------------------------------ the frames' messages

  function frameOf(source) {
    for (const p of panes.values()) {
      for (const fr of p.frames) if (fr.contentWindow === source) return { fr, pane: p };
    }
    return null;
  }

  win.addEventListener('message', (e) => {
    if (e.origin !== SITE_ORIGIN) return;
    const d = e.data;
    if (!d || d.type !== 'ffx-height') return;
    const hit = frameOf(e.source);
    if (!hit) return;
    const h = Number(d.height);
    if (!(h > 0 && h < MAX_FRAME_PX)) return;
    hit.fr.style.height = `${Math.ceil(h)}px`;
    hit.fr.setAttribute('data-sized', '');
    const spin = hit.pane.el.querySelector('.ffx-loading');
    if (spin) spin.remove();
    postVis();
  });

  /** ESPN's sticky header covers the top of the window; below it is "on screen". */
  function headerBottom() {
    const el = doc.querySelector('.Site__Header');
    if (!el || !el.getBoundingClientRect) return 0;
    try {
      const pos = win.getComputedStyle(el).position;
      if (pos !== 'sticky' && pos !== 'fixed') return 0;
    } catch { return 0; }
    return Math.max(0, el.getBoundingClientRect().bottom || 0);
  }

  /** True while the frame is still a blank page we can read (not yet the site). */
  function readableFrame(fr) {
    try { return typeof fr.contentWindow.location.href === 'string'; } catch { return false; }
  }

  function postVis() {
    const key = activeKey();
    const pane = key && panes.get(key);
    if (!pane) return;
    const top = headerBottom();
    const winH = win.innerHeight || 0;
    for (const fr of pane.frames) {
      // Only once the frame has spoken: before that it may still be a blank page of ESPN's origin.
      if (!fr.getBoundingClientRect || !fr.contentWindow || !fr.hasAttribute('data-sized')) continue;
      // A frame moved back into a re-rendered page reloads, and is blank (ESPN's origin) for a moment.
      if (readableFrame(fr)) continue;
      const r = fr.getBoundingClientRect();
      const visTop = Math.max(0, top - r.top);
      const height = Math.max(0, Math.min(winH, r.bottom) - Math.max(r.top, top));
      try {
        fr.contentWindow.postMessage({ type: 'ffx-vis', top: visTop, height: height || winH - top }, SITE_ORIGIN);
      } catch { /* a frame between pages */ }
    }
  }

  let visQueued = false;
  const queueVis = () => {
    if (visQueued) return;
    visQueued = true;
    win.requestAnimationFrame(() => { visQueued = false; postVis(); });
  };
  win.addEventListener('scroll', queueVis, { passive: true });
  win.addEventListener('resize', queueVis);

  // ------------------------------------------------------------ watching ESPN

  win.addEventListener('popstate', () => sync());
  win.addEventListener('hashchange', () => sync());
  win.setInterval(() => { if (win.location.href !== lastHref) sync(); }, POLL_MS);

  let queued = false;
  const onMutate = () => {
    if (queued) return;
    queued = true;
    win.setTimeout(() => {
      queued = false;
      const league = leagueFromUrl();
      const list = navList();
      const tabsGone = league && list && list.querySelectorAll('li[data-ffx]').length !== TABS.length;
      const viewGone = activeKey() && (!view || !view.isConnected || host().firstElementChild !== view);
      if (tabsGone || viewGone || win.location.href !== lastHref) sync();
    }, 50);
  };
  if (typeof win.MutationObserver === 'function') {
    const mo = new win.MutationObserver(onMutate);
    try { mo.observe(doc.documentElement, { childList: true, subtree: true }); } catch { /* the poll still runs */ }
  }

  sync();

  // For tests/test-espn-tabs.mjs and the console. This is the content
  // script's own world; ESPN's scripts cannot see it.
  win.__ffxTabs = { sync, ready: () => pending, seedFor };
})();
