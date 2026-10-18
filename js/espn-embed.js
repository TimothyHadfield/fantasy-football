// The page inside one of the extension's ESPN tabs. Loaded only by
// js/espn-embed-boot.js, and only when the page is framed by fantasy.espn.com
// as `?embed=espn&part=<stats|analysis|trade>`; read that file first.
//
// What it does, and nothing else:
//   1. Marks the panels Tim chose for the tab (`ffx-keep`); css/espn-embed.css
//      hides every other child of the page. Nothing is removed and nothing is
//      re-drawn: each panel is the page module's own, with its own switches,
//      sorts, colours and saved choices.
//   2. On Stats, puts Schedule luck, Roster strength and Future proj diff into
//      ONE panel with a picker at the top (Tim: "all in one with selections of
//      which one at the top"). The choice is a preference like any other.
//   3. On Trade, puts the team picker at the top and Custom trades above the
//      list (Tim: "Put the selected user at the top, then the custome trades
//      box, and then the trades ranked by net increase below that").
//   4. Tells ESPN's page it is drawn (the frame is window-high and scrolls
//      inside itself). On Analysis (`?next=analysis`), brings analysis.html's
//      panels into this page below its own and runs that page's module, so one
//      page, one scroll, holds both.
//   5. Sends any page change (a click on a number or name) to a new tab of the
//      site, so the frame never turns into the plain, dark site page.

import { scope } from './prefs.js';

const ESPN = 'https://fantasy.espn.com';
const part = document.documentElement.getAttribute('data-embed') || '';
const prefs = scope('espn');
const $ = (id) => document.getElementById(id);
/** The page's own .wrap (a child of <body>); the site header has a .wrap too, earlier in the page. */
const mainWrap = () => document.querySelector('body > .wrap');

/** The section (or panel row) a known element lives in, marked to stay. */
function keep(el) {
  if (!el) return null;
  const box = el.closest('.wrap > *');
  if (box) box.classList.add('ffx-keep');
  return box;
}

/** The status line ("Loading your league…"), lifted to the top of the frame. */
function liftStatus() {
  const status = $('sourceStatus');
  const wrap = mainWrap();
  if (!status || !wrap) return;
  const line = document.createElement('div');
  line.className = 'ffx-keep ffx-status';
  wrap.insertBefore(line, wrap.firstChild);
  line.appendChild(status);
}

// --------------------------------------------------------------- the parts

export const LUCK_VIEWS = [
  { key: 'opp', panel: 'panelOppProj', label: 'Schedule luck' },
  { key: 'strength', panel: 'panelStrength', label: 'Roster strength' },
  { key: 'diff', panel: 'panelProjDiff', label: 'Future proj diff' },
];

function setupStats() {
  liftStatus();
  keep($('mainTable'));
  keep($('panelWeekGrid'));
  const row = keep($('panelOppProj'));
  if (!row) return;
  row.classList.add('ffx-one');

  const bar = document.createElement('div');
  bar.className = 'ffx-tabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Show');
  for (const v of LUCK_VIEWS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.view = v.key;
    b.setAttribute('role', 'tab');
    b.textContent = v.label;
    bar.appendChild(b);
  }
  row.parentNode.insertBefore(bar, row);
  bar.classList.add('ffx-keep');

  const show = (key) => {
    const pick = LUCK_VIEWS.find((v) => v.key === key) || LUCK_VIEWS[0];
    for (const v of LUCK_VIEWS) {
      const on = v === pick;
      const panel = $(v.panel);
      if (panel) panel.classList.toggle('ffx-off', !on);
      const b = bar.querySelector(`[data-view="${v.key}"]`);
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    return pick.key;
  };
  show(prefs.get('luckView', LUCK_VIEWS[0].key));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    const key = show(b.dataset.view);
    prefs.set('luckView', key === LUCK_VIEWS[0].key ? null : key);
  });
}

function setupAnalysis({ lift = true } = {}) {
  if (lift) liftStatus();
  keep($('overviewTable'));
  keep($('totalsTable'));
  const season = keep($('seasonTable'));
  // "Drives Who to start and the roster detail below too": neither is in the tab.
  if (season) season.querySelectorAll('.toolbar > .ctl-hint').forEach((h) => h.classList.add('ffx-off'));
}

function setupTrade() {
  const source = keep($('teamSelect'));
  if (source) {
    source.classList.add('ffx-picker');
    const pick = $('teamSelect').closest('.select-md');
    if (pick) pick.classList.add('ffx-pick');
  }
  const custom = keep($('customPanel'));
  const finder = keep($('tradeTable'));
  if (custom && finder && finder.parentNode === custom.parentNode) {
    finder.parentNode.insertBefore(custom, finder);
  }
}

// ------------------------------------------------- the second page

// The Analysis tab is ONE frame, window-high, that scrolls its own page (see
// extension/content-espn-tabs.js for why: Chrome draws a frame late wherever
// it was off screen). So its second page's panels are brought into THIS page,
// below the Stats panels, and run by that page's own module: analysis.html's
// styles and panels are copied in, then js/analysis-page.js is imported. The
// two pages share five ids (the hidden header bits and the Data source box);
// those come from this page, and the second page's status line is its own
// (#ffxNextStatus, read first by analysis-page.js `setStatus`).
const NEXT = { stats: { part: 'analysis', page: 'analysis.html' } };
const SHARED_IDS = ['connBar', 'modeBadge', 'pageSub', 'sourceToggle', 'sourceStatus'];

async function setupNext() {
  let want = null;
  try { want = new URLSearchParams(location.search).get('next'); } catch { /* none */ }
  const next = NEXT[part];
  const wrap = mainWrap();
  if (!next || want !== next.part || !wrap) return;
  let src;
  try {
    const res = await fetch(next.page, { cache: 'no-cache' });
    if (!res.ok) return;
    src = new DOMParser().parseFromString(await res.text(), 'text/html');
  } catch { return; }
  const skin = document.head.querySelector('link[href="css/espn-embed.css"]');
  for (const st of src.head.querySelectorAll('style')) {
    document.head.insertBefore(document.importNode(st, true), skin);
  }
  const theirs = src.querySelector('body > .wrap');
  if (!theirs) return;
  const status = document.createElement('div');
  status.className = 'ffx-status';
  const line = document.createElement('div');
  line.id = 'ffxNextStatus';
  line.className = 'panel-note';
  status.appendChild(line);
  wrap.appendChild(status);
  const shared = (el) => SHARED_IDS.some((id) => el.id === id || el.querySelector(`#${id}`));
  for (const el of [...theirs.children]) {
    if (el.matches('h1, p.sub') || shared(el)) continue;
    wrap.appendChild(document.importNode(el, true));
  }
  // Its pop-ups and cards live outside its .wrap.
  for (const el of [...src.body.children]) {
    if (el === theirs || el.matches('header, script')) continue;
    if (el.id && document.getElementById(el.id)) continue;
    document.body.appendChild(document.importNode(el, true));
  }
  setupAnalysis({ lift: false });
  status.classList.add('ffx-keep');
  for (const s of src.querySelectorAll('script[type="module"][src]')) {
    const rel = s.getAttribute('src');
    if (document.querySelector(`script[src="${rel}"]`)) continue;
    try { await import(new URL(rel, location.href).href); } catch (e) { console.error(e); }
  }
}

// ------------------------------------------------- links

// A click on a number or a name follows its link (a team's week, a player's
// row). Inside the tab that loaded the plain site page INTO the frame: the
// site's dark theme, its header and the whole page, under ESPN's nav (Tim:
// "the bottom half turns into another darker version and then displays week 7
// matchups"). Every page change a frame would make goes to a new browser tab
// of the site instead; the tab itself never leaves its panels. A reload (the
// site's own "new version" refresh) and in-page anchors stay.
function guardLinks() {
  const out = (url) => {
    try { window.open(url, '_blank', 'noopener'); } catch { /* blocked: stay */ }
  };
  const nav = window.navigation;
  if (nav && typeof nav.addEventListener === 'function') {
    nav.addEventListener('navigate', (e) => {
      if (e.navigationType === 'reload' || e.hashChange || (e.destination && e.destination.sameDocument)) return;
      if (!e.cancelable) return;
      e.preventDefault();
      out(e.destination.url);
    });
    return;
  }
  // No Navigation API: links at least (scripted moves are the rarer path).
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || /^#/.test(a.getAttribute('href') || '')) return;
    e.preventDefault();
    out(a.href);
  }, true);
}

// ------------------------------------------------- talking to ESPN's page

function postHeight() {
  const wrap = mainWrap();
  const bottom = wrap ? wrap.getBoundingClientRect().bottom + window.scrollY : document.body.scrollHeight;
  const h = Math.ceil(bottom + 8);
  if (h === postHeight.last) return;
  postHeight.last = h;
  // ESPN's page uses this as "drawn" (and checks it).
  window.parent.postMessage({ type: 'ffx-height', part, height: h }, ESPN);
}

function listen() {
  const ro = new ResizeObserver(() => postHeight());
  ro.observe(document.body);
  const wrap = mainWrap();
  if (wrap) ro.observe(wrap);
  postHeight();
}

function run() {
  if (part === 'stats') setupStats();
  else if (part === 'analysis') setupAnalysis();
  else if (part === 'trade') setupTrade();
  setupNext();
  guardLinks();
  // The page is shown by css/espn-embed.css itself, once it has loaded.
  listen();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
else run();
