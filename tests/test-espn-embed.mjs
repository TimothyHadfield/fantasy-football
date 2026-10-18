// The site's half of the ESPN tabs: js/espn-embed-boot.js and js/espn-embed.js,
// run against the real stats.html, analysis.html and trade.html.
//
// Tim, 2026-10-17. Analysis: "Standings and Season Totals / Week by week /
// Schedule luck, Roster Strength, and Future Proj Diff all in one with
// selections of which one at the top / All teams, Proj Avg 2026 / Weekly
// totals / Season by week". Trade: "Put the selected user at the top, then the
// custome trades box, and then the trades ranked by net increase below that."
//
// Held here:
//   1. The boot script does NOTHING unless the page is ?embed=espn AND framed
//      by fantasy.espn.com only. A link or another site's frame gets the
//      normal page, and its storage is never written.
//   2. Framed by ESPN, it writes the seed (only the allowed keys) before any
//      module runs, and every page reads the league, not the sample.
//   3. Exactly Tim's panels are kept, in his order; the three ranked-bar boxes
//      become one panel with a picker whose choice is remembered.
//   4. The frame tells ESPN's page its height, to ESPN's origin only.

import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { repoFile, moduleUrl } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const BOOT = fs.readFileSync(repoFile('js/espn-embed-boot.js'), 'utf8');
const ESPN = 'https://fantasy.espn.com';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    dump: () => Object.fromEntries(m),
  };
}

/** Load `page` as if at `href`, framed by `ancestors`, and run the boot script. */
function bootPage(page, href, ancestors, storage = memoryStorage()) {
  const { window, document } = parseHTML(fs.readFileSync(repoFile(page), 'utf8'));
  let url = new URL(href);
  const location = {
    get href() { return url.href; }, get search() { return url.search; }, get hash() { return url.hash; },
    get pathname() { return url.pathname; }, get origin() { return url.origin; },
    ancestorOrigins: ancestors,
  };
  const history = { state: null, replaceState: (_s, _t, u) => { url = new URL(u, url); } };
  const parent = { posted: [], postMessage(data, target) { this.posted.push({ data, target }); } };
  const win = { document, location, history, localStorage: storage, parent, URLSearchParams, JSON };
  win.top = ancestors.length ? parent : win;
  win.window = win;
  const context = { window: win, document, location, history, localStorage: storage, URLSearchParams, JSON, console };
  vm.createContext(context);
  vm.runInContext(BOOT, context, { filename: 'espn-embed-boot.js' });
  return { window, document, storage, parent, url: () => url };
}

const SEED = {
  'ff.prefs': JSON.stringify({ 'stats.view.weekly': 'luck', 'trade.sugPlayoffs': true, '@league': '1241838-2026' }),
  'ff.connection': JSON.stringify({ leagueId: '1241838', season: 2026, teamId: 4, source: 'espn' }),
  'ff.config': JSON.stringify({ leagueId: '1241838', season: 2026 }),
  'ff.value.1241838-2026': JSON.stringify({ lines: { RB: 9 } }),
  'ff.weeks.v3.1241838-2026-1': 'not a seed key',
  'evil': 'x',
};
const seeded = (page, part) => `https://timothyhadfield.github.io/fantasy-football/${page}?embed=espn&part=${part}#seed=${encodeURIComponent(JSON.stringify(SEED))}`;

// ---- 1. the boot script does nothing outside an ESPN frame ------------------
for (const [why, href, anc] of [
  ['opened as a normal page', 'https://timothyhadfield.github.io/fantasy-football/stats.html', []],
  ['opened by a link with ?embed=espn', seeded('stats.html', 'stats'), []],
  ['framed by another site', seeded('stats.html', 'stats'), ['https://evil.example']],
  ['framed by ESPN inside another site', seeded('stats.html', 'stats'), [ESPN, 'https://evil.example']],
  ['framed by ESPN with no part', 'https://timothyhadfield.github.io/fantasy-football/stats.html?embed=espn#seed=%7B%7D', [ESPN]],
  ['framed by ESPN with an unknown part', seeded('stats.html', 'draft'), [ESPN]],
]) {
  const b = bootPage('stats.html', href, anc);
  ok(!b.document.documentElement.classList.contains('espn-embed'), `${why}: the page is the normal page`);
  eq(Object.keys(b.storage.dump()).length, 0, `${why}: nothing is written to storage`);
  ok(!b.document.querySelector('link[href="css/espn-embed.css"]'), `${why}: no ESPN skin`);
}

// ---- 2. framed by ESPN -------------------------------------------------------
{
  const b = bootPage('stats.html', seeded('stats.html', 'stats'), [ESPN]);
  const root = b.document.documentElement;
  ok(root.classList.contains('espn-embed'), 'framed by ESPN: the page is in embed mode');
  eq(root.getAttribute('data-embed'), 'stats', 'with its part');
  const s = b.storage.dump();
  eq(s['ff.connection'], SEED['ff.connection'], 'the league slot is seeded');
  eq(s['ff.config'], SEED['ff.config'], 'and the older key');
  eq(s['ff.value.1241838-2026'], SEED['ff.value.1241838-2026'], 'and the Value lines');
  ok(!('ff.weeks.v3.1241838-2026-1' in s) && !('evil' in s), 'nothing outside the allowed keys is written');
  const prefs = JSON.parse(s['ff.prefs']);
  eq(prefs['stats.view.weekly'], 'luck', 'the site’s choices are kept');
  eq(prefs['trade.sugPlayoffs'], true, 'all of them');
  eq(prefs['stats.source'], 'live', 'and the page reads the league, not the sample');
  eq(b.url().hash, '', 'the seed is taken out of the URL');
  ok(b.document.querySelector('link[href="css/espn-embed.css"]'), 'the ESPN skin is loaded');
  ok(b.document.querySelector('script[src="js/espn-embed.js"][type="module"]'), 'and the layout module');
  ok(b.document.getElementById('espnEmbedHold'), 'and the page is held hidden until the skin is in');
}
{
  // Choices the frame already holds are not touched when there is no seed.
  const store = memoryStorage({ 'ff.prefs': JSON.stringify({ 'analysis.measure': 'avg', 'analysis.source': 'live' }) });
  bootPage('analysis.html', 'https://timothyhadfield.github.io/fantasy-football/analysis.html?embed=espn&part=analysis', [ESPN], store);
  eq(JSON.parse(store.getItem('ff.prefs'))['analysis.measure'], 'avg', 'no seed: the frame’s own choices stand');
}
for (const page of ['stats.html', 'analysis.html', 'trade.html']) {
  const src = fs.readFileSync(repoFile(page), 'utf8');
  const head = src.slice(0, src.indexOf('</head>'));
  const at = head.indexOf('src="js/espn-embed-boot.js"');
  ok(at > 0, `${page} loads the boot script in its head`);
  ok(at > head.lastIndexOf('</style>'), `${page}: after its own styles, so the skin's link lands after them`);
  ok(!/<script[^>]+espn-embed-boot\.js[^>]+(defer|async|type="module")/.test(head), `${page}: as a plain script, before any module runs`);
}

// ---- 3 + 4. the layout module on each page ----------------------------------
// The page's own .wrap (a child of <body>), not the hidden site header's .wrap,
// which comes first in the document (a real-browser run caught the mix-up).
const kept = (doc) => {
  ok(!doc.querySelector('header .ffx-keep'), 'nothing is placed in the hidden site header');
  return [...doc.querySelectorAll('body > .wrap > .ffx-keep')];
};

let n = 0;
async function runLayout(page, part, storage) {
  const b = bootPage(page, seeded(page, part), [ESPN], storage);
  const g = globalThis;
  g.window = b.document.defaultView;
  g.window.parent = b.parent;
  g.window.scrollY = 0;
  g.document = b.document;
  g.localStorage = b.storage;
  g.ResizeObserver = class { constructor(fn) { this.fn = fn; } observe() {} };
  Object.defineProperty(b.document, 'readyState', { value: 'complete', configurable: true });
  for (const w of b.document.querySelectorAll('.wrap')) {
    const main = w.parentNode === b.document.body;
    w.getBoundingClientRect = () => ({ top: 0, bottom: main ? 500 : 0, height: main ? 500 : 0 });
  }
  n += 1;
  await import(`${moduleUrl('js/espn-embed.js')}?run=${n}`);
  return b;
}

{
  const b = await runLayout('stats.html', 'stats');
  const doc = b.document;
  const k = kept(doc);
  ok(k[0] && k[0].classList.contains('ffx-status') && k[0].querySelector('#sourceStatus'), 'Stats: the loading line comes first');
  ok(k[1] && k[1].querySelector('#mainTable'), 'then Standings & season totals');
  eq(k[2] && k[2].id, 'panelWeekGrid', 'then Week by week');
  ok(k[3] && k[3].classList.contains('ffx-tabs'), 'then the picker');
  ok(k[4] && k[4].querySelector('#panelOppProj') && k[4].querySelector('#panelStrength') && k[4].querySelector('#panelProjDiff'), 'then the three boxes, as one panel');
  eq(k.length, 5, 'and nothing else');
  ok(!doc.getElementById('panelWeekly').closest('.ffx-keep'), 'Weekly scores is not in the tab');
  const tabs = [...doc.querySelectorAll('.ffx-tabs button')].map((x) => x.textContent);
  eq(JSON.stringify(tabs), JSON.stringify(['Schedule luck', 'Roster strength', 'Future proj diff']), 'the picker names the three');
  const shown = () => ['panelOppProj', 'panelStrength', 'panelProjDiff'].filter((id) => !doc.getElementById(id).classList.contains('ffx-off'));
  eq(JSON.stringify(shown()), '["panelOppProj"]', 'Schedule luck shows first');
  doc.querySelector('.ffx-tabs [data-view="diff"]').dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
  eq(JSON.stringify(shown()), '["panelProjDiff"]', 'a pick shows that one box only');
  ok(doc.querySelector('.ffx-tabs [data-view="diff"]').classList.contains('on'), 'and marks it');
  eq(JSON.parse(b.storage.getItem('ff.prefs'))['espn.luckView'], 'diff', 'and is remembered like any other choice');
  const h = b.parent.posted.find((p) => p.data.type === 'ffx-height');
  ok(h, 'the frame tells ESPN’s page its height');
  eq(h && h.target, ESPN, 'to ESPN’s origin only');
  ok(h && h.data.height > 8, 'measured from the page’s content, not the hidden header');
}
{
  const store = memoryStorage();
  const b = await runLayout('analysis.html', 'analysis', store);
  const k = kept(b.document);
  ok(k[0] && k[0].classList.contains('ffx-status'), 'Analysis: the loading line first');
  ok(k[1] && k[1].querySelector('#overviewTable'), 'then All teams');
  ok(k[2] && k[2].querySelector('#totalsTable'), 'then Weekly totals');
  ok(k[3] && k[3].querySelector('#seasonTable'), 'then Season by week');
  eq(k.length, 4, 'and nothing else');
  ok(k[1] && k[1].querySelector('#measureToggle [data-measure="avg"]'), 'All teams keeps its Proj avg switch');
  ok(!b.document.getElementById('projChanges').classList.contains('ffx-keep'), 'Proj changes is not in the tab');
}
{
  const b = await runLayout('trade.html', 'trade');
  const doc = b.document;
  const k = kept(doc);
  ok(k[0] && k[0].querySelector('#teamSelect') && k[0].classList.contains('ffx-picker'), 'Trade: the team picker first');
  eq(k[1] && k[1].id, 'customPanel', 'then Custom trades');
  ok(k[2] && k[2].querySelector('#tradeTable'), 'then Trades ranked by net increase');
  eq(k.length, 3, 'and nothing else');
  ok(doc.getElementById('teamSelect').closest('.select-md').classList.contains('ffx-pick'), 'only the team control is marked to show in its panel');
  ok(!doc.getElementById('comboPanel'), 'Best combo is not in the tab (nor on the page, since 2026-10-18)');
  ok(doc.getElementById('dealModal') && !doc.getElementById('dealModal').closest('.wrap'), 'the week-by-week pop-up is still there, outside the page');
}

// ---- the skin is scoped -------------------------------------------------------
{
  const css = fs.readFileSync(repoFile('css/espn-embed.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
  const loose = selectors.flatMap((s) => s.split(',').map((x) => x.trim())).filter((s) => !s.startsWith('html.espn-embed'));
  eq(loose.length, 0, 'every rule in the ESPN skin is scoped to html.espn-embed', loose.join(' | '));
}

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
