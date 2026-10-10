// The site nav is hand-copied into every page. This is what notices when one
// copy drifts: a page added to the nav but not to the others, two links
// swapped, a label renamed in one place.
//
// HARD checks (fail the suite):
//   - every page with a site nav has exactly one, in header.site (other,
//     in-page navs such as the schedule page's jump list are ignored);
//   - every such nav has the SAME links, in the SAME order, with the same
//     labels (index.html's nav is the reference, and the diff is printed);
//   - every page the nav links to exists and carries that nav itself;
//   - every page in the nav marks its OWN link current with class="active",
//     and no other.
//
// REPORT-ONLY (printed as WARN, never fails):
//   - aria-current="page" on the page's own link. The pages use class="active"
//     today, which a screen reader cannot see; this line lists the pages still
//     missing it until they all have it.
//
// THE MAIN MENU (leagues.html, 2026-10-10) is the one page with no site nav: it
// is outside the sections. That is checked rather than noted — exactly that
// page has none, so a section page that loses its nav fails here — and so is
// the way into it: on every other page the brand is a link to the menu, sitting
// in the header OUTSIDE the nav (the nav's links are compared page against
// page, and the brand is not one of them); on the menu it is plain text.

import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { REPO } from './repo.mjs';

let pass = 0, fail = 0;
const warnings = [];
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const warn = (msg) => warnings.push(msg);

const pages = fs.readdirSync(REPO).filter((f) => f.endsWith('.html')).sort();
ok(pages.length > 0, 'there are pages to check');

/** @returns {{ page, links: {href, label, active, current}[] } | null} */
function readNav(page) {
  const html = fs.readFileSync(path.join(REPO, page), 'utf8');
  const { document } = parseHTML(html);
  // The SITE nav is the one in the page header (css/app.css styles it as
  // `header.site nav`). A page may have other navs of its own — the schedule
  // page's "Jump to a panel" — and those are not this test's business.
  const navs = [...document.querySelectorAll('header nav')];
  if (!navs.length) return null;
  ok(navs.length === 1, `${page} has one site <nav> in its header`, `found ${navs.length}`);
  const nav = navs[0];
  ok(Boolean(nav.closest('header.site')), `${page}: the nav sits in header.site`);
  const links = [...nav.querySelectorAll('a')].map((a) => ({
    href: a.getAttribute('href'),
    label: a.textContent.trim().replace(/\s+/g, ' '),
    active: (a.getAttribute('class') || '').split(/\s+/).includes('active'),
    current: a.getAttribute('aria-current'),
  }));
  return { page, links };
}

const navs = [];
const without = [];
for (const page of pages) {
  const n = readNav(page);
  if (n) navs.push(n); else without.push(page);
}
ok(navs.length > 0, 'at least one page has a nav');

// ---- the main menu, and the brand that leads to it ---------------------------
const MENU = 'leagues.html';
const BRAND = 'Fantasy Football';
ok(without.length === 1 && without[0] === MENU, `the main menu (${MENU}) is the only page with no site nav`, `without a nav: ${without.join(', ') || 'none'}`);
for (const page of pages) {
  const { document } = parseHTML(fs.readFileSync(path.join(REPO, page), 'utf8'));
  const brands = [...document.querySelectorAll('header.site .brand')];
  ok(brands.length === 1, `${page} has one brand in its header`, `found ${brands.length}`);
  const brand = brands[0];
  if (!brand) continue;
  ok(brand.textContent.trim() === BRAND, `${page}: the brand reads "${BRAND}"`, brand.textContent.trim());
  ok(!brand.closest('nav'), `${page}: the brand is outside the nav`);
  if (page === MENU) {
    ok(brand.tagName !== 'A' && !brand.querySelector('a') && document.querySelectorAll('header.site a').length === 0,
      `${page}: on the menu itself the brand is plain text, and the header links nowhere`, brand.outerHTML);
  } else {
    ok(brand.tagName === 'A' && brand.getAttribute('href') === MENU, `${page}: the brand is a link to the main menu`, brand.outerHTML);
    // A `title` draws nothing under a finger, and the words are the link's own.
    ok(!brand.hasAttribute('title'), `${page}: the brand carries no title`);
  }
}

// ---- the same links, in the same order, everywhere --------------------------
const sig = (n) => n.links.map((l) => `${l.label} -> ${l.href}`);
const reference = navs.find((n) => n.page === 'index.html') || navs[0];
const refSig = sig(reference);

for (const n of navs) {
  const s = sig(n);
  const same = s.length === refSig.length && s.every((x, i) => x === refSig[i]);
  ok(same, `${n.page}: nav matches ${reference.page}`, same ? '' :
    `\n    ${reference.page}: ${refSig.join(' | ')}\n    ${n.page}: ${s.join(' | ')}`);
}

const hrefs = reference.links.map((l) => l.href);
ok(new Set(hrefs).size === hrefs.length, 'no page is linked twice in the nav', hrefs.join(', '));
for (const l of reference.links) {
  ok(l.label.length > 0, `the nav link to ${l.href} has a label`);
  ok(/^[\w-]+\.html$/.test(l.href || ''), `the nav link "${l.label}" is a plain relative page`, l.href);
}

// ---- every page in the nav exists, has the nav, and marks itself -------------
const navPages = new Set(navs.map((n) => n.page));
for (const href of hrefs) {
  ok(fs.existsSync(path.join(REPO, href)), `${href} (in the nav) exists`);
  ok(navPages.has(href), `${href} (in the nav) carries the nav itself`);
}

for (const n of navs) {
  const own = n.links.filter((l) => l.href === n.page);
  const inNav = hrefs.includes(n.page);
  const activeHrefs = n.links.filter((l) => l.active).map((l) => l.href);
  const currentHrefs = n.links.filter((l) => l.current != null).map((l) => l.href);

  if (inNav) {
    ok(own.length === 1 && own[0].active, `${n.page} marks its own link active`, `active: ${activeHrefs.join(', ') || 'none'}`);
    ok(activeHrefs.length === 1, `${n.page} marks exactly one link active`, `active: ${activeHrefs.join(', ') || 'none'}`);
    if (!(own.length === 1 && own[0].current === 'page')) {
      warn(`${n.page}: its own nav link lacks aria-current="page"`);
    }
  } else {
    // A page outside the nav (debug.html) must not pretend to be one of them.
    ok(activeHrefs.length === 0, `${n.page} is not in the nav, so no link is active`, activeHrefs.join(', '));
  }
  // aria-current anywhere but the page's own link is wrong wherever it is.
  const stray = currentHrefs.filter((h) => h !== n.page);
  ok(stray.length === 0, `${n.page}: aria-current only on its own link`, stray.join(', '));
  for (const l of n.links) {
    if (l.current != null) ok(l.current === 'page', `${n.page}: aria-current on ${l.href} is "page"`, String(l.current));
  }
}

// The home-screen app. Every page must name the same manifest, and its scope
// must cover every page: on iOS a link to a page outside the scope drops out of
// the app into a browser view, which is exactly what "Home → Stats turns back
// into a website" was.
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'manifest.webmanifest'), 'utf8'));
ok(manifest.scope === './', 'the manifest scope is the whole site folder', manifest.scope);
ok(manifest.display === 'standalone', 'the manifest opens as an app', manifest.display);
ok(fs.existsSync(path.join(REPO, manifest.start_url)), 'the manifest start page exists', manifest.start_url);
for (const icon of manifest.icons || []) {
  ok(fs.existsSync(path.join(REPO, icon.src)), `manifest icon ${icon.src} exists`);
}
for (const page of pages) {
  const html = fs.readFileSync(path.join(REPO, page), 'utf8');
  ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(html), `${page} links the manifest`);
  ok(/<link rel="apple-touch-icon" href="apple-touch-icon\.png">/.test(html), `${page} has the home-screen icon`);
  ok(/<meta name="apple-mobile-web-app-capable" content="yes">/.test(html), `${page} stays in the app on iOS`);
}

// ---- the connection bar under the nav (js/connection.js), connected -----------
//
// docs/previews-plan.md, "Top bar": the quiet "Week 5 saved" chip is a LINK to
// the Schedule page's time panel, and the league's name opens a small card —
// the season, the week, and when it was last read. Booted for real, with the
// bridge extension answering at its own seam (cap-harness.mjs); `fetch` throws,
// so anything the bar asks of the network beyond that would show.
{
  const { bootDom, waitFor } = await import('./cap-harness.mjs');
  const { moduleUrl } = await import('./repo.mjs');
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const errors = [];
  process.on('unhandledRejection', (r) => errors.push(String((r && r.stack) || r)));
  const { window, document } = bootDom({
    html: '<!DOCTYPE html><html><body><div id="connBar"></div></body></html>',
    store: { 'ff.connection': { leagueId: '99', season: 2026, teamId: 1 } },
    bridge: true,
    teams: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }],
  });
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  await import(moduleUrl('js/connection.js'));
  const name = await waitFor(() => document.getElementById('connName'), 10000);
  await new Promise((r) => setTimeout(r, 150));
  const fire = (el, type, init = {}) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, init);
    el.dispatchEvent(ev);
  };
  const card = () => {
    const c = document.getElementById('statCard');
    return c && !c.hidden ? {
      head: text(c.querySelector('.tc-ident')), sheet: c.classList.contains('sheet'),
      rows: [...c.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text)),
      link: Boolean(c.querySelector('.tc-open')), close: Boolean(c.querySelector('.tc-close')),
    } : null;
  };

  const chip = document.getElementById('connSaved');
  ok(chip && chip.tagName === 'A' && chip.getAttribute('href') === 'schedule.html#timePanel',
    'top bar: the saved chip is a link to the Schedule page’s time panel', chip ? `${chip.tagName} ${chip.getAttribute('href')}` : 'no chip');
  ok(chip && /conn-chip/.test(chip.getAttribute('class') || '') && /conn-saved/.test(chip.getAttribute('class') || ''), 'top bar: and still the same chip');

  ok(Boolean(name), 'top bar: the league’s name is an element of its own');
  if (name) {
    ok(text(name) === 'Capture Stub League' && name.tagName === 'STRONG', 'top bar: it reads as it did, in bold', `${name.tagName} ${text(name)}`);
    ok(!name.hasAttribute('title') && name.getAttribute('tabindex') === '0', 'top bar: no `title` beside its card, and the keyboard reaches it');
    ok(/^Connected to Capture Stub League · 2 teams · checked /.test(text(document.querySelector('#connBar .conn-main'))),
      'top bar: the sentence around it is unchanged', text(document.querySelector('#connBar .conn-main')));
    fire(name, 'mouseover');
    const c = card();
    ok(c && c.head === 'Capture Stub League' && !c.sheet && !c.close, 'top bar: pointing at the name opens the league’s card', JSON.stringify(c));
    ok(c && c.rows[0][0] === 'Season' && c.rows[0][1] === '2026', 'top bar: the season', JSON.stringify(c && c.rows));
    const last = c && c.rows[c.rows.length - 1];
    ok(last && /^Last read/.test(last[0]) && /\d{1,2}:\d{2}/.test(last[1]), 'top bar: and when it was last read, as a time', JSON.stringify(last));
    ok(c && !/\bSD\b|z-score|step \d of/i.test(JSON.stringify(c)), 'top bar: in plain words');
    fire(name, 'mouseout');
    ok(card() === null, 'top bar: moving off shuts it');
    // A finger: the same card as a sheet with a Close.
    const mouse = window.matchMedia;
    const touch = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.matchMedia = touch; globalThis.matchMedia = touch;
    fire(name, 'click');
    const s = card();
    window.matchMedia = mouse; globalThis.matchMedia = mouse;
    ok(s && s.sheet && s.close && s.rows.length === c.rows.length, 'top bar: a tap opens the same card as a sheet with a Close', JSON.stringify(s));
    fire(document.body, 'keydown', { key: 'Escape' });
  }
  ok(errors.length === 0, 'top bar: nothing thrown', errors.join(' | ').slice(0, 300));
}

for (const w of warnings) console.log(`WARN ${w}`);
console.log(fail
  ? `${pass} passed, ${fail} failed`
  : `All ${pass} assertions passed (${navs.length} pages, ${hrefs.length} nav links${warnings.length ? `, ${warnings.length} warnings` : ''})`);
process.exit(fail ? 1 : 0);
