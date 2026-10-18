// tools/espn-tab-check.mjs — the extension's ESPN tabs, in a real Chromium,
// on ESPN's real league page. Not in `npm test`: it needs a browser, the
// network and Playwright.
//
//   node tools/espn-tab-check.mjs                 # this checkout
//   node tools/espn-tab-check.mjs --site <dir>    # another checkout (e.g. the code before a fix)
//   node tools/espn-tab-check.mjs --tab trade     # one tab (default: analysis and trade)
//   node tools/espn-tab-check.mjs --out <dir>     # where the screenshots go (default: a temp folder)
//
// It loads <site>/extension unpacked, serves <site> in place of the live site
// (so it checks the checkout, not what is deployed), opens public league
// 1241838 at #ffx-<tab>, and checks two things Tim saw (2026-10-18):
//
//  1. NO BLANK WHILE SCROLLING. "they only load the parts of the page that you
//     can currently see so if you scroll up and down it's blank for a bit".
//     A real scroll gesture (Input.synthesizeScrollGesture, 4000 px/s, down
//     then up) is filmed with Page.startScreencast — the frames Chrome actually
//     drew. In each, the tallest band of rows that is plain white across the
//     whole tab is measured. Settled pages have bands up to ~100 px (the gaps
//     between panels; 97 px under Trade's team picker); a band over LIMIT_PX
//     is a part of the tab Chrome had not drawn. Measured on the code before
//     the fix: up to 606–710 px, in 26 of 43 frames (Trade) and 14–25 of
//     37–99 (Analysis). After: 0.
//
//  2. A CLICK NEVER TURNS THE TAB INTO THE PLAIN SITE (Analysis only). "the
//     bottom half turns into another darker version and then displays week 7
//     matchups". A click on a number in Week by week or All teams used to load
//     analysis.html / waivers.html, the normal dark page, INTO the frame.
//
// Playwright: from tests' node_modules if there, else PLAYWRIGHT_DIR, else
// ~/.claude/tools (Claude's own copy on Tim's laptop). Chromium must be
// installed for it (`npx playwright install chromium`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const SITE = path.resolve(opt('--site', path.join(HERE, '..')));
const TABS = (opt('--tab', 'analysis,trade')).split(',');
const OUT = opt('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'espn-tab-check-')));
const LIMIT_PX = 120;
const W = 1280, H = 800;
const LEAGUE = 'https://fantasy.espn.com/football/league?leagueId=1241838';

function loadPlaywright() {
  const roots = [path.join(HERE, '..', 'tests', 'package.json'), process.env.PLAYWRIGHT_DIR && path.join(process.env.PLAYWRIGHT_DIR, 'package.json'), path.join(os.homedir(), '.claude', 'tools', 'package.json')].filter(Boolean);
  for (const r of roots) {
    try { const req = createRequire(r); return { pw: req('playwright'), PNG: req('playwright-core/lib/utilsBundle').PNG }; } catch { /* next */ }
  }
  console.error('Playwright not found (see the header of this file).');
  process.exit(2);
}
const { pw, PNG } = loadPlaywright();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

async function launch() {
  const ext = path.join(SITE, 'extension');
  const ctx = await pw.chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ffx-profile-')), {
    channel: 'chromium', headless: true, viewport: { width: W, height: H },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('https://timothyhadfield.github.io/fantasy-football/**', async (route) => {
    const u = new URL(route.request().url());
    const f = path.join(SITE, decodeURIComponent(u.pathname.replace(/^\/fantasy-football\//, '')) || 'index.html');
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' } });
  });
  return ctx;
}

async function openTab(ctx, tab) {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`${LEAGUE}#ffx-${tab}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('#ffx-view');
    return v && v.querySelector('.ffx-pane:not([hidden]) iframe') && !v.querySelector('.ffx-pane:not([hidden]) .ffx-loading');
  }, null, { timeout: 90000 });
  await page.waitForTimeout(15000);   // the league read and the tables
  return page;
}

/** The tallest band of rows below ESPN's nav that is plain white across the tab's box. */
function whiteBand(png, box) {
  const sx = png.width / W;
  let best = 0, run = 0;
  for (let r = Math.ceil(box.top) + 2; r < Math.min(H, box.bottom); r++) {
    let white = true;
    for (let x = Math.ceil(box.left) + 20; x < box.right - 20; x += 3) {
      const i = (Math.floor(r * sx) * png.width + Math.floor(x * sx)) * 4;
      if (png.data[i] < 250 || png.data[i + 1] < 250 || png.data[i + 2] < 250) { white = false; break; }
    }
    run = white ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

async function scrollCheck(page, tab) {
  const box = await page.evaluate(() => {
    const v = document.getElementById('ffx-view').getBoundingClientRect();
    const nav = document.querySelector('nav.NavSecondary');
    const top = Math.max(v.top, nav ? nav.getBoundingClientRect().bottom : 0);
    return { top, bottom: innerHeight, left: v.left, right: v.right };
  });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push(f.data);
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* closing */ }
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await page.waitForTimeout(400);
  const at = { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + H) / 2) };
  await cdp.send('Input.synthesizeScrollGesture', { ...at, yDistance: -3000, speed: 4000, gestureSourceType: 'mouse', preventFling: true });
  await page.waitForTimeout(300);
  await cdp.send('Input.synthesizeScrollGesture', { ...at, yDistance: 3000, speed: 4000, gestureSourceType: 'mouse', preventFling: true });
  await page.waitForTimeout(600);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const bands = frames.map((d) => whiteBand(PNG.sync.read(Buffer.from(d, 'base64')), box));
  const bad = bands.map((b, i) => [b, i]).filter(([b]) => b > LIMIT_PX);
  if (bad.length) {
    const [b, i] = bad.slice().sort((x, y) => y[0] - x[0])[0];
    fs.writeFileSync(path.join(OUT, `${tab}-blank-${b}px.png`), Buffer.from(frames[i], 'base64'));
  }
  if (frames.length) fs.writeFileSync(path.join(OUT, `${tab}-mid-scroll.png`), Buffer.from(frames[Math.floor(frames.length / 4)], 'base64'));
  return { frames: frames.length, blankFrames: bad.length, worstBandPx: Math.max(0, ...bands) };
}

async function clickCheck(ctx, page) {
  const cells = ['#panelWeekGrid tbody td:nth-child(3)', '#overviewTable tbody td:nth-child(3)'];
  const out = [];
  for (const sel of cells) {
    let fr = null;
    for (const f of page.frames().filter((x) => x.url().includes('embed=espn'))) {
      if (await f.locator(sel).count().catch(() => 0)) { fr = f; break; }
    }
    if (!fr) { out.push({ sel, error: 'not found' }); continue; }
    try { await fr.locator(sel).first().click({ timeout: 8000 }); } catch (e) { out.push({ sel, error: String(e.message).slice(0, 80) }); continue; }
    await page.waitForTimeout(3000);
    const plain = page.frames().filter((f) => f.parentFrame() === page.mainFrame() && f.url().includes('/fantasy-football/') && !f.url().includes('embed=espn'));
    out.push({ sel, plainPageInTab: plain.map((f) => f.url().replace(/^.*\/fantasy-football\//, '')) });
    if (plain.length) {
      const el = await page.$('#ffx-view iframe');
      if (el) await el.screenshot({ path: path.join(OUT, `analysis-after-click-${out.length}.png`) }).catch(() => {});
      return { clicks: out, left: true };
    }
  }
  return { clicks: out, left: false, newTabs: ctx.pages().slice(1).map((p) => p.url()) };
}

let failed = 0;
const ctx = await launch();
for (const tab of TABS) {
  const page = await openTab(ctx, tab);
  const s = await scrollCheck(page, tab);
  const blankOk = s.blankFrames === 0 && s.frames > 10;
  if (!blankOk) failed++;
  console.log(`${blankOk ? 'PASS' : 'FAIL'} ${tab}: ${s.blankFrames} of ${s.frames} frames drawn while scrolling had a blank band over ${LIMIT_PX} px (worst ${s.worstBandPx} px)`);
  if (tab === 'analysis') {
    const c = await clickCheck(ctx, page);
    const clicked = c.clicks.filter((x) => !x.error).length;
    const okClick = !c.left && clicked > 0;
    if (!okClick) failed++;
    console.log(`${okClick ? 'PASS' : 'FAIL'} analysis: ${c.left ? 'a click loaded the plain site page into the tab' : `${clicked} click(s), the tab kept its panels`} ${JSON.stringify(c)}`);
  }
}
await ctx.close();
console.log(`screenshots: ${OUT}`);
console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);
