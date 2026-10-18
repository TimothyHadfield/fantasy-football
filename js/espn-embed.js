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
//   4. Tells ESPN's page how tall it is, so the frame never scrolls inside
//      itself, and takes from it which slice of the frame is on screen, so a
//      pop-up opens where it can be seen.

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

function setupAnalysis() {
  liftStatus();
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

// ------------------------------------------------- talking to ESPN's page

function postHeight() {
  const wrap = mainWrap();
  const bottom = wrap ? wrap.getBoundingClientRect().bottom + window.scrollY : document.body.scrollHeight;
  const h = Math.ceil(bottom + 8);
  if (h === postHeight.last) return;
  postHeight.last = h;
  window.parent.postMessage({ type: 'ffx-height', part, height: h }, ESPN);
}

function listen() {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== ESPN) return;
    const d = e.data;
    if (!d || d.type !== 'ffx-vis') return;
    const top = Math.max(0, Number(d.top) || 0);
    const height = Math.max(120, Number(d.height) || 0);
    const root = document.documentElement.style;
    root.setProperty('--ffx-vt', `${Math.round(top)}px`);
    root.setProperty('--ffx-vh', `${Math.round(height)}px`);
  });
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
  // The page is shown by css/espn-embed.css itself, once it has loaded.
  listen();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
else run();
