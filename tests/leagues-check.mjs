// The main menu (Tim, 2026-10-10: "a main menu that is outside all of our
// current sections where the user can add different leagues to their account
// as well as look into past leagues"). End to end against the real
// leagues.html + js/leagues-page.js.
//
//   node leagues-check.mjs
//
// The page is booted in a child per scenario (a page module boots once per
// process), with `./leagues.js` redirected at leagues-stub.mjs by
// leagues-register.mjs — so what is tested is the PAGE: what it draws from a
// list, and what it asks the data layer to do. The data layer itself
// (js/leagues.js: storage, parking, the ESPN probe) has its own suite.
//
// The stub records every call, `location.assign` is caught, `fetch` and
// `window.confirm` throw: the page may ask the network nothing itself, and its
// Remove step is drawn in the page.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { emit } from './emit.mjs';

const PAGE = 'leagues.html';
const SCENARIOS = ['list', 'add', 'remove', 'empty'];

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const words = (s) => (String(s || '').trim().match(/\S+/g) || []).length;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function boot(stub) {
  const html = readFileSync(path.join(REPO, PAGE), 'utf8');
  const { window, document } = parseHTML(html);
  const assigned = [];
  const confirms = [];
  const fetches = [];
  window.location = {
    href: `http://localhost/${PAGE}`, origin: 'http://localhost', protocol: 'http:',
    host: 'localhost', hostname: 'localhost', pathname: `/${PAGE}`, search: '', hash: '',
    assign: (href) => assigned.push(String(href)),
  };
  window.postMessage = () => {};
  const map = new Map();
  const localStorage = {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  const noConfirm = (msg) => { confirms.push(String(msg)); throw new Error('window.confirm is not the confirm step'); };
  window.confirm = noConfirm;
  Object.assign(globalThis, {
    window, document, localStorage, location: window.location, confirm: noConfirm,
    fetch: async (u) => { fetches.push(String(u)); throw new Error(`unexpected network call: ${u}`); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  if (stub) globalThis.__leaguesStub = stub;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  process.on('unhandledRejection', (r) => errors.push(String((r && r.stack) || r)));

  const srcs = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of srcs) await import(moduleUrl(src));
  await tick(20);
  console.error = origError;

  const fire = (el, type, init = {}) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, init);
    el.dispatchEvent(ev);
    return ev;
  };
  /** The page as a reader sees it: one object per league row, top to bottom. */
  const rows = () => [...document.querySelectorAll('#lgList > li')].map((li) => ({
    li,
    id: li.getAttribute('data-league'),
    name: text(li.querySelector('.lg-name')),
    meta: text(li.querySelector('.lg-meta')),
    seasons: [...li.querySelectorAll('.lg-seasons button')].map((b) => text(b)),
    open: [...li.querySelectorAll('.lg-seasons button')].filter((b) => b.getAttribute('aria-current') === 'true').map((b) => text(b)),
    confirming: (li.getAttribute('class') || '').split(/\s+/).includes('confirming'),
  }));
  const season = (id, yr) => document.querySelector(`#lgList > li[data-league="${id}"] .lg-seasons button[data-season="${yr}"]`);
  const submit = async (value) => {
    document.getElementById('lgId').value = value;
    fire(document.getElementById('lgAdd'), 'submit');
    await tick(20);
  };
  return {
    window, document, srcs, assigned, confirms, fetches, errors, fire, rows, season, submit,
    calls: () => globalThis.__leaguesCalls || [],
    msg: () => text(document.getElementById('lgMsg')),
    shown: (id) => { const e = document.getElementById(id); return Boolean(e) && !e.hasAttribute('hidden'); },
  };
}

// ---------------------------------------------------------------- child mode
if (process.argv[2]) {
  const scenario = process.argv[2];
  const results = [];
  const ok = (pass, msg, extra = '') => results.push({ pass: Boolean(pass), msg, extra: pass ? '' : String(extra).slice(0, 400) });
  try {
    if (scenario === 'list') {
      // The stub reads its settings when it is first imported, so: boot first.
      const p = await boot({ openFail: { '476225-2024': 'This browser is full.' } });
      const stub = await import('./leagues-stub.mjs');
      const r = p.rows();
      ok(r.length === 2, 'both leagues are listed', r.length);
      ok(r[0] && r[0].id === '1241838' && r[1] && r[1].id === '476225', 'in the order the data layer gave (most recently opened first)', r.map((x) => x.id));
      ok(r[0] && r[0].name === stub.SAMPLE[0].name, 'a league is named', r[0] && r[0].name);
      ok(r[0] && /^10 teams\b/.test(r[0].meta), 'with its team count', r[0] && r[0].meta);
      ok(r[0] && r[0].meta.includes(`You are ${stub.SAMPLE[0].teams[2026].name}`), 'and "You are" with the team of the season it is open on', r[0] && r[0].meta);
      ok(r[1] && r[1].meta === '12 teams', 'a league with no team known says nothing about one', r[1] && r[1].meta);
      ok(r[0] && r[0].seasons.join() === '2026,2025,2024,2023,2022,2021,2020,2019,2018', 'its seasons are buttons, the current one first', r[0] && r[0].seasons);
      ok(r[1] && r[1].seasons.join() === '2026,2025,2024', 'each league has its own', r[1] && r[1].seasons);
      const marked = r.flatMap((x) => x.open.map((s) => `${x.id}-${s}`));
      ok(marked.length === 1 && marked[0] === '1241838-2026', 'exactly one league-season is marked open: the one that is', marked);
      const on = [...p.document.querySelectorAll('.lg-seasons button.on')];
      ok(on.length === 1 && on[0].getAttribute('aria-current') === 'true', 'and the mark a reader sees is the same button');
      ok(p.shown('lgList') && !p.shown('lgEmpty'), 'the empty line is not shown beside a list');

      // Outside the sections.
      ok(p.document.querySelectorAll('nav').length === 0, 'no nav on the menu');
      ok(!p.document.getElementById('connBar') && !p.srcs.some((s) => /connection\.js/.test(s)), 'no connection bar');
      const brand = p.document.querySelector('header.site .brand');
      ok(brand && brand.tagName === 'SPAN' && text(brand) === 'Fantasy Football' && !brand.querySelector('a'), 'the brand is plain text here', brand && brand.outerHTML);
      ok(p.document.querySelectorAll('[title]').length === 0, 'nothing carries a `title` (it draws nothing under a finger)',
        [...p.document.querySelectorAll('[title]')].map((e) => e.outerHTML.slice(0, 80)));
      const unnamed = [...p.document.querySelectorAll('button, a, input')].filter((e) => !text(e) && !e.getAttribute('aria-label') && !(e.id && p.document.querySelector(`label[for="${e.id}"]`)));
      ok(unnamed.length === 0, 'every control has a name', unnamed.map((e) => e.outerHTML.slice(0, 80)));
      const removes = [...p.document.querySelectorAll('.lg-remove')];
      ok(removes.length === 2 && removes.every((b) => /^Remove .+/.test(b.getAttribute('aria-label') || '')), 'each Remove says which league it removes', removes.map((b) => b.getAttribute('aria-label')));

      // A season click opens that league-season and goes there.
      ok(p.calls().length === 0 && p.assigned.length === 0, 'nothing is opened until a season is clicked', JSON.stringify(p.calls()));
      p.fire(p.season('1241838', 2025), 'click');
      const opens = p.calls().filter((c) => c[0] === 'open');
      ok(opens.length === 1 && opens[0][1] === '1241838' && opens[0][2] === 2025, 'a season click opens that league and season (a number)', JSON.stringify(opens));
      ok(p.assigned.length === 1 && p.assigned[0] === 'index.html', 'and navigates to the address the data layer returned', p.assigned);

      // A refused open says why and goes nowhere.
      p.fire(p.season('476225', 2024), 'click');
      ok(p.assigned.length === 1, 'a refused open does not navigate', p.assigned);
      ok(p.msg() === 'This browser is full.', 'and its reason is on screen', p.msg());
      ok(p.fetches.length === 0, 'the page itself asked the network nothing', p.fetches);
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'add') {
      let release;
      const wait = new Promise((r) => { release = r; });
      const p = await boot({ lookupWait: wait });
      const btn = p.document.getElementById('lgAddBtn');
      ok(text(p.document.querySelector('label[for="lgId"]')) === 'Add a league', 'the field is labelled "Add a league"');

      // Not an id: nothing is looked up.
      await p.submit('my league');
      ok(p.calls().length === 0 && p.msg().length > 0 && words(p.msg()) <= 12, 'words that are not an id look nothing up and say so in a short line', `${JSON.stringify(p.calls())} "${p.msg()}"`);
      await p.submit('   ');
      ok(p.calls().length === 0, 'neither does an empty field');

      // Already listed: nothing is looked up.
      await p.submit('1241838');
      ok(p.calls().length === 0 && p.rows().length === 2 && p.msg().length > 0, 'a league already in the list is not looked up again', `${JSON.stringify(p.calls())} "${p.msg()}"`);

      // A good id, while ESPN is still answering …
      await p.submit(' 555666 ');
      ok(JSON.stringify(p.calls()) === JSON.stringify([['lookup', '555666']]), 'a good id is looked up (trimmed, as a string)', JSON.stringify(p.calls()));
      ok(btn.hasAttribute('disabled') && p.msg().length > 0, 'while it is looked up the button is off and a line says so', p.msg());
      p.fire(p.document.getElementById('lgAdd'), 'submit');
      await tick(10);
      ok(p.calls().length === 1, 'a second press meanwhile asks nothing more', JSON.stringify(p.calls()));
      // … and when it has.
      release();
      await tick(30);
      const adds = p.calls().filter((c) => c[0] === 'add');
      ok(adds.length === 1, 'it is added once', JSON.stringify(p.calls()));
      const a = adds[0] && adds[0][1];
      ok(a && a.leagueId === '555666' && a.name === 'College Friends' && a.teamCount === 8 && JSON.stringify(a.seasons) === '[2026,2025]' && a.season === 2026,
        'with the name, team count and seasons ESPN gave, on its current season', JSON.stringify(a));
      const r = p.rows();
      ok(r.length === 3 && r.some((x) => x.id === '555666' && x.name === 'College Friends' && x.meta === '8 teams' && x.seasons.join() === '2026,2025'),
        'the list redraws with it', JSON.stringify(r.map((x) => [x.id, x.name, x.meta, x.seasons])));
      ok(!btn.hasAttribute('disabled') && p.msg() === '' && p.document.getElementById('lgId').value === '', 'the field is empty and ready again', `"${p.msg()}" "${p.document.getElementById('lgId').value}"`);
      ok(p.assigned.length === 0, 'adding does not navigate');

      // A pasted ESPN address.
      p.calls().length = 0;
      await p.submit('https://fantasy.espn.com/football/league?leagueId=777888&seasonId=2026');
      ok(p.calls()[0] && p.calls()[0][0] === 'lookup' && p.calls()[0][1] === '777888', 'a pasted ESPN link gives up its leagueId', JSON.stringify(p.calls()));
      // … which ESPN does not know.
      ok(p.calls().every((c) => c[0] !== 'add') && p.rows().length === 3, 'a failed lookup adds nothing', JSON.stringify(p.calls()));
      ok(p.msg() === 'ESPN has no league with that ID.', 'and its reason is on screen, in one line', p.msg());
      ok(!btn.hasAttribute('disabled'), 'and the button works again');
      p.calls().length = 0;
      await p.submit('https://fantasy.espn.com/football/team?seasonId=2026&teamId=3&leagueId=555666');
      ok(p.calls().length === 0 && p.rows().length === 3, 'leagueId is found wherever it sits in the link (here: one already listed)', JSON.stringify(p.calls()));
      ok(p.fetches.length === 0, 'the page itself asked the network nothing', p.fetches);
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'remove') {
      const p = await boot();
      const row = (id) => p.rows().find((x) => x.id === id);
      const q = (id, sel) => p.document.querySelector(`#lgList > li[data-league="${id}"] ${sel}`);
      ok(p.rows().every((x) => !x.confirming), 'no row starts in its confirm step');
      ok(p.document.querySelectorAll('.lg-confirm[aria-hidden="true"]').length === 2, 'and the confirm step is hidden from a screen reader until asked for');

      p.fire(q('1241838', '.lg-remove'), 'click');
      ok(p.calls().length === 0, 'Remove alone removes nothing', JSON.stringify(p.calls()));
      ok(row('1241838').confirming && !row('476225').confirming, 'it opens that league’s confirm step, in the page');
      const said = text(q('1241838', '.lg-confirm .lg-keep'));
      ok(/saved data stays/i.test(said) && words(said) <= 12, 'which says the saved data stays, in 12 words or fewer', said);
      ok(q('1241838', '.lg-confirm').getAttribute('aria-hidden') !== 'true', 'and is no longer hidden');
      ok(p.rows().length === 2 && row('1241838').seasons.length === 9, 'the row keeps everything it had (nothing is taken out of the page)');

      p.fire(q('1241838', '.lg-no'), 'click');
      ok(!row('1241838').confirming && p.calls().length === 0 && p.rows().length === 2, 'Cancel puts it back and removes nothing', JSON.stringify(p.calls()));

      p.fire(q('1241838', '.lg-remove'), 'click');
      p.fire(q('476225', '.lg-remove'), 'click');
      ok(!row('1241838').confirming && row('476225').confirming, 'one confirm step at a time');
      p.fire(p.document.body, 'keydown', { key: 'Escape' });
      ok(p.rows().every((x) => !x.confirming) && p.calls().length === 0, 'Escape backs out of it');

      p.fire(q('476225', '.lg-remove'), 'click');
      p.fire(q('476225', '.lg-yes'), 'click');
      ok(JSON.stringify(p.calls()) === JSON.stringify([['remove', '476225']]), 'confirming removes that league, by its id', JSON.stringify(p.calls()));
      ok(p.rows().length === 1 && p.rows()[0].id === '1241838', 'and the list redraws without it', p.rows().map((x) => x.id));
      ok(p.rows()[0].open.join() === '2026', 'the open mark is still where it was');

      // The league that is open, too — and then there is nothing left.
      p.fire(q('1241838', '.lg-remove'), 'click');
      p.fire(q('1241838', '.lg-yes'), 'click');
      ok(p.calls().length === 2 && p.calls()[1][1] === '1241838', 'the open league can be removed as well', JSON.stringify(p.calls()));
      ok(p.rows().length === 0 && p.shown('lgEmpty') && !p.shown('lgList'), 'with none left the page is its empty state');
      ok(p.confirms.length === 0, 'window.confirm was never used', p.confirms);
      ok(p.assigned.length === 0, 'removing does not navigate');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'empty') {
      const p = await boot({ list: [], current: null });
      ok(p.rows().length === 0 && !p.shown('lgList'), 'no leagues: no list');
      const line = text(p.document.getElementById('lgEmpty'));
      ok(p.shown('lgEmpty') && line.length > 0 && words(line) <= 8, 'one short line instead', line);
      ok(p.document.getElementById('lgId') && p.document.getElementById('lgAddBtn'), 'and the Add field');
      const shown = [...p.document.querySelectorAll('main p, main li, main span')].filter((e) => !e.hasAttribute('hidden') && !e.closest('[hidden]')).map(text).filter(Boolean);
      ok(shown.length === 1, 'and no other sentence on the page', shown);
      await p.submit('555666');
      ok(p.rows().length === 1 && p.shown('lgList') && !p.shown('lgEmpty'), 'the first league added replaces the line with the list', p.rows().map((x) => x.id));
      ok(p.rows()[0] && p.rows()[0].open.length === 0, 'nothing is marked open when nothing is');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }
  } catch (err) {
    ok(false, `${scenario}: the scenario ran to its end`, (err && err.stack) || err);
  }
  emit({ scenario, results }, results.every((r) => r.pass) ? 0 : 1);
}

// --------------------------------------------------------------- parent mode
const self = fileURLToPath(import.meta.url);
let pass = 0, fail = 0;
for (const scenario of SCENARIOS) {
  const res = spawnSync(process.execPath, ['--import', './leagues-register.mjs', self, scenario],
    { encoding: 'utf8', cwd: path.dirname(self), timeout: 60000 });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    fail++;
    console.log(`FAIL ${scenario}: no result\n${(res.stderr || '').slice(0, 1200)}`);
    continue;
  }
  const { results } = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  pass += results.length - bad.length;
  fail += bad.length;
  if (!results.length) { fail++; console.log(`FAIL ${scenario}: asserted nothing`); continue; }
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario} (${results.length - bad.length}/${results.length})`);
  for (const b of bad) console.log(`  - ${b.msg}${b.extra ? ' — ' + b.extra : ''}`);
}
console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
