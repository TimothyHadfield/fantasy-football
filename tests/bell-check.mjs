// The bell in the top bar (Tim, 2026-10-11: "Bell in the top bar" — a bell with
// a count on every page; clicking it opens the notifications page).
//
//   node bell-check.mjs
//
// js/connection.js mounts the bell into the page's own header and asks
// js/notify-load.js for the count. Booted for real here: index.html's own
// `header.site`, the real connection.js, the bridge extension answering at its
// own seam (cap-harness.mjs), and `./notify-load.js` redirected at
// bell-stub.mjs by bell-register.mjs — the loader is another builder's file,
// and what is tested is the BELL: where it sits, what it is called, when it
// asks, and that it stays a plain bell whenever there is nothing to count or
// the loader is missing or broken.
//
// One child per scenario: connection.js boots once per process.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { emit } from './emit.mjs';

const LEAGUE = '99';
const HOUR = 60 * 60 * 1000;
// name -> [what the child is told, the environment it runs in]
const SCENARIOS = {
  fresh: {}, stale: {}, zero: {}, unknown: {}, big: {},
  noteam: {}, past: {}, off: {},
  missing: { BELL_MISSING: '1' }, throws: {}, rejects: {},
};

const note = (counts, ageMs = 0) => ({ v: 1, team: 1, week: 5, at: Date.now() - ageMs, idea: 4, ...counts });

// ---------------------------------------------------------------- child mode
const scenario = process.argv[2];
if (scenario) {
  const results = [];
  const ok = (cond, msg, extra = '') => results.push({ pass: Boolean(cond), msg, extra: cond ? '' : String(extra) });
  try {
    const { bootDom, waitFor } = await import('./cap-harness.mjs');
    // The season the bar calls current (js/bridge.js `currentSeason`), worked out
    // here because bridge.js must not be imported before there is a window.
    const today = new Date();
    const season = today.getMonth() < 6 ? today.getFullYear() - 1 : today.getFullYear();
    const key = (s = season) => `ff.notes.${LEAGUE}-${s}`;
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));

    // The real header, as index.html carries it, above an empty bar.
    const index = readFileSync(path.join(REPO, 'index.html'), 'utf8');
    const header = (index.match(/<header class="site">[\s\S]*?<\/header>/) || [''])[0];
    const html = `<!DOCTYPE html><html><body>${header}<div class="wrap wide"><div id="connBar"></div></div></body></html>`;

    const conn = (extra = {}) => ({ leagueId: LEAGUE, season, teamId: 1, ...extra });
    const setup = {
      fresh:   { store: { 'ff.connection': conn(), [key()]: note({ now: 2, soon: 1 }) } },
      stale:   { store: { 'ff.connection': conn(), [key()]: note({ now: 5, soon: 4 }, 4 * HOUR) }, stub: { refreshWrites: { now: 1, soon: 0, idea: 2 } } },
      zero:    { store: { 'ff.connection': conn(), [key()]: note({ now: 0, soon: 0 }) } },
      unknown: { store: { 'ff.connection': conn() } },
      big:     { store: { 'ff.connection': conn(), [key()]: note({ now: 120, soon: 30 }) } },
      noteam:  { store: { 'ff.connection': conn({ teamId: null }), [key()]: note({ now: 2, soon: 1 }) } },
      past:    { store: { 'ff.connection': conn({ season: season - 1 }), [key(season - 1)]: note({ now: 2, soon: 1 }) } },
      off:     { store: { [key()]: note({ now: 2, soon: 1 }) }, bridge: false },
      missing: { store: { 'ff.connection': conn(), [key()]: note({ now: 2, soon: 1 }) } },
      throws:  { store: { 'ff.connection': conn(), [key()]: note({ now: 2, soon: 1 }) }, stub: { savedThrows: true } },
      rejects: { store: { 'ff.connection': conn(), [key()]: note({ now: 2, soon: 1 }, 4 * HOUR) }, stub: { refreshRejects: true } },
    }[scenario];
    if (!setup) throw new Error(`no such scenario: ${scenario}`);

    const errors = [];
    const origError = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    process.on('unhandledRejection', (r) => errors.push(String((r && r.stack) || r)));

    const { document, map } = bootDom({
      html, store: setup.store, bridge: setup.bridge !== false,
      teams: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }],
    });
    globalThis.__bell = { saved: 0, refresh: 0 };
    if (setup.stub) globalThis.__bellStub = setup.stub;
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
    await import(moduleUrl('js/connection.js'));
    const bridge = await import(moduleUrl('js/bridge.js'));
    ok(bridge.currentSeason() === season, 'the test and the bar agree on the current season', String(bridge.currentSeason()));

    const bell = () => document.getElementById('siteBell');
    const count = () => document.getElementById('siteBellCount');
    const shown = () => {
      const c = count();
      return c && !c.hasAttribute('hidden') ? c.textContent.trim() : '';
    };
    const label = () => (bell() ? bell().getAttribute('aria-label') : null);
    const calls = () => globalThis.__bell;

    if (setup.bridge !== false) await waitFor(() => document.getElementById('connName'), 10000);
    else await tick(600);
    const connected = Boolean(document.getElementById('connName'));
    ok(connected === (setup.bridge !== false), `${scenario}: the bar is ${setup.bridge !== false ? 'connected' : 'not connected'}`);

    // ---- the bell itself: every scenario has one, in the same place --------
    const b = bell();
    ok(document.querySelectorAll('#siteBell').length === 1 && document.querySelectorAll('header.site .site-bell').length === 1,
      'one bell, in the page header', String(document.querySelectorAll('.site-bell').length));
    if (b) {
      ok(b.tagName === 'A' && b.getAttribute('href') === 'notifications.html', 'the bell is a link to the notifications page', b.getAttribute('href'));
      const kids = [...b.parentNode.children];
      const brand = b.parentNode.querySelector('.brand');
      const nav = b.parentNode.querySelector('nav');
      ok(brand && nav && kids.indexOf(b) === kids.indexOf(brand) + 1 && kids.indexOf(nav) === kids.indexOf(b) + 1,
        'it sits between the brand and the page links', kids.map((k) => k.tagName).join(' '));
      ok(!b.closest('nav') && nav.querySelectorAll('a').length === 9, 'outside the nav, whose nine links are untouched', String(nav && nav.querySelectorAll('a').length));
      const svg = b.querySelector('svg');
      ok(svg && svg.getAttribute('aria-hidden') === 'true' && svg.querySelectorAll('path').length > 0, 'the icon is an inline SVG, hidden from a screen reader');
      ok(!b.hasAttribute('title'), 'no title (it draws nothing under a finger)');
      ok(b.getAttribute('aria-current') == null, 'not marked current on a page that is not the notifications page');
    }

    // ---- the count ---------------------------------------------------------
    const plain = async (why) => {
      await tick(2400);   // past the bar's own wait for a quiet page (1500 ms)
      ok(shown() === '' && count() && count().textContent === '', `${scenario}: no number (${why})`, shown());
      ok(label() === 'Notifications', `${scenario}: the bell is named "Notifications" and nothing more`, label());
    };

    if (scenario === 'fresh') {
      ok(shown() === '' && label() === 'Notifications', 'before the page is quiet: a plain bell', `${shown()} / ${label()}`);
      ok(calls().saved === 0, 'and the loader has not been asked yet', JSON.stringify(calls()));
      await waitFor(() => shown(), 6000);
      ok(shown() === '3', 'a fresh saved count shows now + soon (2 + 1), not idea', shown());
      ok(label() === 'Notifications, 3', 'and the name carries the count', label());
      ok(calls().refresh === 0, 'a fresh count is not recomputed', JSON.stringify(calls()));
      // The league or the "You are" team changes: asked again.
      map.set(key(), JSON.stringify(note({ now: 4, soon: 2 })));
      document.dispatchEvent(new globalThis.CustomEvent('ff:connection', { detail: null }));
      await waitFor(() => shown() === '6', 6000);
      ok(shown() === '6' && label() === 'Notifications, 6', 'a change of connection reads the count again', `${shown()} / ${label()}`);
      ok(calls().refresh === 0, 'still without a recompute', JSON.stringify(calls()));
    } else if (scenario === 'stale') {
      await waitFor(() => shown(), 6000);
      ok(calls().refresh === 1, 'a stale count asks the loader to recompute, once', JSON.stringify(calls()));
      ok(shown() === '1' && label() === 'Notifications, 1', 'and shows what the recompute saved (1), never the stale 9', `${shown()} / ${label()}`);
    } else if (scenario === 'zero') {
      await plain('nothing to do: now 0, soon 0, ideas do not count');
      ok(calls().saved > 0 && calls().refresh === 0, 'the count was read, and was fresh', JSON.stringify(calls()));
    } else if (scenario === 'unknown') {
      await plain('nothing saved and the recompute saved nothing');
      ok(calls().refresh === 1, 'the recompute was asked for once', JSON.stringify(calls()));
    } else if (scenario === 'big') {
      await waitFor(() => shown(), 6000);
      ok(shown() === '99+', 'above 99 the pill reads 99+', shown());
      ok(label() === 'Notifications, 150', 'and the name still says the real count', label());
    } else if (scenario === 'noteam') {
      await plain('no "You are" team');
      ok(calls().saved === 0 && calls().refresh === 0, 'the loader is never asked', JSON.stringify(calls()));
    } else if (scenario === 'past') {
      await plain('an earlier season');
      ok(calls().saved === 0 && calls().refresh === 0, 'the loader is never asked', JSON.stringify(calls()));
    } else if (scenario === 'off') {
      await plain('not connected');
      ok(calls().saved === 0 && calls().refresh === 0, 'the loader is never asked', JSON.stringify(calls()));
    } else if (scenario === 'missing') {
      await plain('the loader module is not there');
      ok(calls().saved === 0, 'the stub was indeed not loaded', JSON.stringify(calls()));
    } else if (scenario === 'throws') {
      await plain('savedCount threw');
      ok(calls().saved > 0, 'it was asked', JSON.stringify(calls()));
    } else if (scenario === 'rejects') {
      await plain('refresh rejected');
      ok(calls().refresh === 1, 'it was asked', JSON.stringify(calls()));
    }

    console.error = origError;
    ok(errors.length === 0, `${scenario}: nothing thrown, nothing logged as an error`, errors.join(' | ').slice(0, 400));
  } catch (err) {
    ok(false, `${scenario}: the scenario ran to its end`, (err && err.stack) || err);
  }
  emit({ scenario, results }, results.every((r) => r.pass) ? 0 : 1);
}

// --------------------------------------------------------------- parent mode
const self = fileURLToPath(import.meta.url);
let pass = 0, fail = 0;
for (const [name, env] of Object.entries(SCENARIOS)) {
  const res = spawnSync(process.execPath, ['--import', './bell-register.mjs', self, name],
    { encoding: 'utf8', cwd: path.dirname(self), timeout: 60000, env: { ...process.env, ...env } });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    fail++;
    console.log(`FAIL ${name}: no result\n${(res.stderr || '').slice(0, 1200)}`);
    continue;
  }
  const { results } = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  pass += results.length - bad.length;
  fail += bad.length;
  if (!results.length) { fail++; console.log(`FAIL ${name}: asserted nothing`); continue; }
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${name} (${results.length - bad.length}/${results.length})`);
  for (const b of bad) console.log(`  - ${b.msg}${b.extra ? ' — ' + b.extra : ''}`);
}
console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
