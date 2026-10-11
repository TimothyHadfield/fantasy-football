// The Notifications page (Tim, 2026-10-11: "a notifications section which
// basically helps the user with basic instrucitons or important issues or
// upcoming decisions … for the easy ones like the weekly lineup, make it so you
// just have to click a button to automatically change it for your team, or
// bring you to the specific player on the waivers, or the trade notification on
// the cite"). End to end against the real notifications.html,
// js/notifications-page.js, js/notify-load.js and js/notify.js.
//
//   node notify-check.mjs            all scenarios
//   node notify-check.mjs lineupOk   just that one (as a child)
//
// The page is booted in a child per scenario (a page module boots once per
// process). `./season.js` is redirected at notify-stub-season.mjs — a league
// whose team 4 has one of every kind of line — and `./bridge.js` at
// notify-stub-bridge.mjs, the real module plus the extension's lineup switch,
// which the scenario sets. The window answers `postMessage` the way the
// extension does, so the connection bar is the real code and connects.
//
// `fetch` records and throws: the page may ask the network nothing itself.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { emit } from './emit.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';

const PAGE = 'notifications.html';
const LEAGUE = '99';
const ME = 4;
const SCENARIOS = ['demo', 'live', 'lineupOk', 'lineupStale', 'lineupRefused', 'synced', 'past', 'noTeam', 'over'];

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** The season the fantasy year is in today — never a literal year. */
const thisSeason = () => { const d = new Date(); return d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear(); };

async function boot({ conn = null, stub = {}, store = {} } = {}) {
  const html = readFileSync(path.join(REPO, PAGE), 'utf8');
  const all = { ...store };
  if (conn) all['ff.connection'] = conn;
  const dom = bootDom({ html, store: all, bridge: false });
  const { window, document } = dom;
  window.location.pathname = `/${PAGE}`;
  window.location.href = `http://localhost/${PAGE}`;

  // The bridge extension, at its own seam: it knows the league the bar asks for.
  const teams = [1, 2, 3, 4].map((id) => ({ id, name: `Team ${id}`, abbrev: `T${id}` }));
  window.postMessage = (msg) => {
    if (!msg || msg.source !== 'ff-site') return;
    const req = msg.request || {};
    let data = null;
    if (req.type === 'PING') data = { version: 'test' };
    else if (req.type === 'GET_CONFIG') data = { leagueId: LEAGUE };
    else if (req.type === 'PROBE') {
      data = { leagueId: String(req.leagueId), season: Number(req.season), name: 'Stub League', teamCount: teams.length, teams };
    }
    queueMicrotask(() => {
      const ev = new window.Event('message');
      ev.data = { source: 'ff-ext', id: msg.id, ok: true, data };
      ev.source = window;
      window.dispatchEvent(ev);
    });
  };

  stub.calls = [];
  globalThis.__notifyStub = stub;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  process.on('unhandledRejection', (r) => errors.push(String((r && r.stack) || r)));

  const srcs = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of srcs) await import(moduleUrl(src));
  const list = document.getElementById('ntList');
  const say = document.getElementById('ntSay');
  const settled = () => list.getAttribute('data-state') === 'done';
  await waitFor(settled, 8000);
  await tick(60);
  console.error = origError;

  const rows = () => [...document.querySelectorAll('#ntList .nt-row[data-note]')].map((el) => {
    const go = [...el.querySelectorAll('a, button')];
    return {
      el, id: el.getAttribute('data-note'), kind: el.getAttribute('data-kind'),
      level: ((el.getAttribute('class') || '').split(/\s+/).find((c) => /^nt-(now|soon|idea)$/.test(c)) || '').slice(3),
      title: text(el.querySelector('.nt-title')), detail: text(el.querySelector('.nt-detail')),
      controls: go.length, tag: go[0] ? go[0].tagName : '', label: text(go[0]),
      href: go[0] ? go[0].getAttribute('href') : null, target: go[0] ? go[0].getAttribute('target') : null,
      lineup: go[0] ? go[0].hasAttribute('data-lineup') : false, go: go[0] || null,
    };
  });
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  return {
    ...dom, stub, errors, rows, fire, settled, list, say,
    /** The list's children in order, as "heading" or the row's kind. */
    order: () => [...list.children].map((c) => ((c.getAttribute('class') || '').includes('nt-group') ? `[${text(c)}]` : c.getAttribute('data-kind') || text(c))),
    badge: () => text(document.getElementById('modeBadge')),
    sentence: () => (say.hasAttribute('hidden') ? '' : text(say)),
    calls: (name) => (stub.calls || []).filter((c) => !name || c[0] === name),
    saved: (season) => { const v = dom.map.get(`ff.notes.${LEAGUE}-${season}`); return v ? JSON.parse(v) : null; },
  };
}

const OFFER = { id: 'abc', withTeamId: 3, get: [303], send: [404, 410], proposedAt: 1, expiresAt: 2, fromMe: false };
const DEALS = (season) => ({
  [`ff.notes.trades.${LEAGUE}-${season}`]: {
    v: 1, team: ME, at: Date.now() - 3 * 60 * 60 * 1000,
    deals: [{ withTeamId: 2, withName: 'Team 2', get: [{ id: 203, name: 'T2 Man 03' }], send: [{ id: 406, name: 'T4 Man 06' }], gain: 1.2, theirGain: -0.3 }],
  },
});
const ESPN = (season) => `https://fantasy.espn.com/football/team?leagueId=${LEAGUE}&seasonId=${season}&teamId=${ME}&scoringPeriodId=5`;
const SWAP = [{ playerId: 402, fromSlotId: 2, toSlotId: 20 }, { playerId: 409, fromSlotId: 20, toSlotId: 2 }];

// ---------------------------------------------------------------- child mode
if (process.argv[2]) {
  const scenario = process.argv[2];
  const results = [];
  const ok = (pass, msg, extra = '') => results.push({ pass: Boolean(pass), msg, extra: pass ? '' : String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 500) });
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  const season = thisSeason();
  const conn = { leagueId: LEAGUE, season, teamId: ME };
  try {
    if (scenario === 'demo') {
      const p = await boot();
      ok(p.settled(), 'the list finishes');
      eq(p.badge(), 'Demo', 'the badge says Demo');
      eq(p.sentence(), '', 'no sentence beside the list');
      const r = p.rows();
      ok(r.length >= 3, 'the sample league has lines', r.length);
      ok(r.every((x) => x.controls === 1), 'every line has exactly ONE button', r.map((x) => x.controls));
      ok(r.every((x) => x.title && x.title.split(' ').length <= 8), 'every line is a few words', r.map((x) => x.title));
      const heads = p.order().filter((s) => s.startsWith('['));
      ok(heads.length >= 1 && heads.join() === ['[This week]', '[Coming weeks]', '[Ideas]'].filter((h) => heads.includes(h)).join(), 'the headings are in order: This week, Coming weeks, Ideas', heads);
      const levels = r.map((x) => ['now', 'soon', 'idea'].indexOf(x.level));
      ok(levels.every((v, i) => v >= 0 && (i === 0 || levels[i - 1] <= v)), 'the lines are most urgent first', levels);
      ok(r.every((x) => x.tag === 'A' && !x.lineup && !/^https?:/.test(x.href || '')), 'no lineup button and no ESPN link: the sample league is nobody’s', r.map((x) => `${x.tag} ${x.href}`));
      const pick = r.filter((x) => x.kind === 'pickup');
      ok(pick.length >= 1 && pick.length <= 3 && pick.every((x) => /^waivers\.html\?player=\d+$/.test(x.href)), 'up to three pick-ups, each opening that man on Players', pick.map((x) => x.href));
      ok(r.filter((x) => x.kind === 'trade').length === 1 && r.some((x) => x.id === 'trade-look' && x.href === 'trade.html'), 'one trade line, opening Trade');
      ok(![...p.map.keys()].some((k) => k.startsWith('ff.notes')), 'the sample league saves no count', [...p.map.keys()]);
      eq(p.calls().filter((c) => c[0] !== 'canSetLineup'), [], 'and reads no league');
      ok(p.fetchCalls.length === 0, 'the page asked the network nothing', p.fetchCalls);
      // Outside the nav row: reached by the bell.
      const nav = [...p.document.querySelectorAll('header.site nav a')];
      ok(nav.length === 9 && nav.every((a) => !(a.getAttribute('class') || '').includes('active') && !a.hasAttribute('aria-current')), 'the nav is the site’s, and none of its links is marked');
      ok(!nav.some((a) => /notifications/.test(a.getAttribute('href'))), 'the page is not one of the nav’s links');
      ok(p.document.querySelectorAll('[title]').length === 0, 'nothing carries a `title`');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'live') {
      const p = await boot({ conn, stub: { offers: [OFFER] }, store: DEALS(season) });
      const mod = await import(moduleUrl('js/notify-load.js'));
      const stubbed = await import('./notify-stub-season.mjs');
      ok(p.settled(), 'the list finishes');
      eq(p.badge(), 'Live', 'the badge says Live');
      eq(p.order(), ['[This week]', 'start', 'bad-start', 'offer', '[Coming weeks]', 'hole', '[Ideas]', 'pickup', 'pickup', 'trade'],
        'one list: three headings, every kind of line, most urgent first');
      const r = p.rows();
      const by = (id) => r.find((x) => x.id === id) || {};
      ok(r.every((x) => x.controls === 1), 'every line has exactly ONE button', r.map((x) => x.controls));

      // start: without the extension's switch, a plain link to ESPN's lineup screen.
      eq([by('start-409-402').title, by('start-409-402').detail], ['Start T4 Man 09 over T4 Man 02', '+1.6 pts this week'], 'start: the swap and its points');
      eq([by('start-409-402').tag, by('start-409-402').label, by('start-409-402').href, by('start-409-402').target],
        ['A', 'Open ESPN', ESPN(season), '_blank'], 'start: the switch is off, so the button is a link to ESPN’s lineup screen, in a new tab');
      ok(p.calls('setLineup').length === 0 && p.calls('canSetLineup').length === 1, 'start: the extension was asked once whether it may, and nothing was set');
      // bad-start
      eq([by('bad-405').title, by('bad-405').detail, by('bad-405').label, by('bad-405').href],
        ['T4 Man 05 is out', 'In your lineup at TE', 'See him', 'waivers.html?player=405'], 'bad-start: the starter ruled out, and a link to him');
      // offer
      eq([by('offer-abc').title, by('offer-abc').detail, by('offer-abc').label, by('offer-abc').href],
        ['Trade offer from Team 3', 'Get T3 Man 03 for T4 Man 04, T4 Man 10', 'Open it', 'trade.html?with=3&get=303&send=404,410'],
        'offer: who, what for what, and the deal opened on Trade');
      // hole
      eq([by('hole-6-17').title, by('hole-6-17').detail, by('hole-6-17').label, by('hole-6-17').href],
        ['Week 6: no K', 'T4 Man 08 is on bye', 'Find one', 'waivers.html?pos=K'], 'hole: the week, the slot, why, and Players opened on kickers');
      eq(r.filter((x) => x.kind === 'hole').length, 1, 'hole: the other nine weeks are whole and say nothing');
      // pickup: the kicker is worth 4 + 12 + 4 over weeks 5-7, the tight end 13 + 2 + 2.
      eq(r.filter((x) => x.kind === 'pickup').map((x) => [x.title, x.detail.split(' · ')[0], x.label, x.href]), [
        ['Pick up Free Kicker', '+6.7 pts a week', 'See him', 'waivers.html?player=901'],
        ['Pick up Free Tightend', '+5.7 pts a week', 'See him', 'waivers.html?player=902'],
      ], 'pickup: the free agents who beat your men, best first, and never the one who does not');
      eq(p.calls('wire').map((c) => c[1]).sort((a, b) => a - b), [5, 6, 7], 'pickup: priced over the next three weeks, one wire read each');
      // trade
      eq([by('trade-0-2').title, by('trade-0-2').detail, by('trade-0-2').label, by('trade-0-2').href],
        ['Trade with Team 2', 'Get T2 Man 03 for T4 Man 06 · found 3 hours ago', 'Open it', 'trade.html?with=2&get=203&send=406'], 'trade: the deal the Trade page saved, with its age');

      // What was read, and how often.
      eq(p.calls('schedule').length, 1, 'the schedule is read once');
      eq(p.calls('week'), [['week', 5, 'held']], 'this week’s rosters once, out of the store');
      eq(p.calls('weeks'), [['weeks', [6, 7, 8, 9, 10, 11, 12, 13, 14]]], 'the coming weeks in one read');
      ok(p.fetchCalls.length === 0, 'the page asked the network nothing itself', p.fetchCalls);

      // THE COUNT: this file is its only writer.
      const rec = p.saved(season);
      eq(rec && [rec.v, rec.team, rec.week, rec.now, rec.soon, rec.idea], [1, ME, 5, 3, 1, 3], 'the count is saved under the league’s own key: 3 this week, 1 coming, 3 ideas');
      ok(rec && Math.abs(rec.at - Date.now()) < 60000 && rec.until === stubbed.KICKOFF, 'with when it was worked out and the next kickoff', rec);
      eq(mod.savedCount(), { now: 3, soon: 1, idea: 3, fresh: true }, 'savedCount: the bell’s numbers, fresh');
      eq(mod.savedCount(Date.now() + mod.FRESH_MS + 1000).fresh, false, 'savedCount: stale after three hours');
      // A kickoff an hour off: fresh until it, stale after — well inside the three hours.
      const key = `ff.notes.${LEAGUE}-${season}`;
      const soon = Date.now() + 60 * 60 * 1000;
      p.map.set(key, JSON.stringify({ ...rec, until: soon }));
      eq([mod.savedCount(soon - 1000).fresh, mod.savedCount(soon + 1000).fresh], [true, false], 'savedCount: stale once a game has kicked off');
      p.map.set(key, JSON.stringify(rec));
      p.map.set('ff.connection', JSON.stringify({ ...conn, teamId: 2 }));
      eq(mod.savedCount(), { now: 0, soon: 0, idea: 0, fresh: false }, 'savedCount: another team’s count is not yours');
      p.map.set('ff.connection', JSON.stringify(conn));
      const before = p.calls('schedule').length;
      const lines = await mod.refresh();
      ok(Array.isArray(lines) && lines.length === r.length && lines.every((n) => n.id && n.level), 'refresh() resolves with the lines', lines && lines.length);
      ok(p.calls('schedule').length === before + 1, 'and works them out again');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'lineupOk') {
      const p = await boot({ conn, stub: { lineup: { can: true, result: { ok: true }, applies: true } } });
      const row = () => p.rows().find((x) => x.id === 'start-409-402');
      eq(row() && [row().tag, row().label, row().lineup, row().href], ['BUTTON', 'Change it', true, null], 'allowed by the extension: the swap’s button changes the lineup');
      ok(p.rows().filter((x) => x.lineup).length === 1, 'and only a lineup line gets one', p.rows().map((x) => `${x.kind}:${x.tag}`));
      p.fire(row().go, 'click');
      ok(row() && row().label === 'Changing…' && row().go.hasAttribute('disabled'), 'while it is being changed the button says so and is off', row() && row().label);
      if (row()) p.fire(row().go, 'click');   // a second press meanwhile
      await waitFor(() => !row() && p.settled(), 8000);
      await tick(40);
      eq(p.calls('setLineup'), [['setLineup', { leagueId: LEAGUE, season, week: 5, teamId: ME, moves: SWAP }]],
        'one click sends the league, the week, the team and the two moves, once');
      eq(p.calls('week').map((c) => c[2]), ['held', 'fresh'], 'then the roster is read AGAIN, fresh from ESPN');
      ok(!row(), 'and the line goes because ESPN now shows the change');
      ok(!p.rows().some((x) => x.detail === 'Could not change it'), 'nothing says it failed');
      eq(p.rows().find((x) => x.kind === 'bad-start') && p.rows().find((x) => x.kind === 'bad-start').id, 'bad-405', 'the other lines are still there');
      const rec = p.saved(season);
      eq(rec && [rec.now, rec.soon], [1, 1], 'and the saved count is one line shorter');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'lineupStale') {
      // The extension says ok, but ESPN's roster still shows the old lineup.
      const p = await boot({ conn, stub: { lineup: { can: true, result: { ok: true }, applies: false } } });
      const row = () => p.rows().find((x) => x.id === 'start-409-402');
      p.fire(row().go, 'click');
      await waitFor(() => p.calls('week').length === 2 && p.settled() && row() && row().tag === 'A', 8000);
      await tick(40);
      eq(p.calls('week').map((c) => c[2]), ['held', 'fresh'], 'the roster is read again');
      ok(row(), 'ESPN does not show the change, so the line STAYS');
      eq(row() && [row().tag, row().label, row().href, row().detail], ['A', 'Open ESPN', ESPN(season), 'Could not change it'],
        'it says so and its button is the link to ESPN’s lineup screen');
      ok(p.rows().every((x) => x.controls === 1), 'still one button a line');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'lineupRefused') {
      const p = await boot({ conn, stub: { lineup: { can: true, result: { ok: false, reason: 'locked' } } } });
      const row = () => p.rows().find((x) => x.id === 'start-409-402');
      eq(row() && row().tag, 'BUTTON', 'the button starts as the one-click change');
      p.fire(row().go, 'click');
      await waitFor(() => row() && row().tag === 'A', 8000);
      eq(p.calls('setLineup').length, 1, 'it was asked for once');
      eq(p.calls('week').map((c) => c[2]), ['held'], 'a refusal reads nothing again');
      eq(row() && [row().tag, row().label, row().href, row().detail], ['A', 'Open ESPN', ESPN(season), 'Could not change it'],
        'the line stays, says so, and falls back to the link');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'synced') {
      // The phone's synced copy: its byes ride the copy, nothing is asked of ESPN.
      const p = await boot({ conn, stub: { cloud: true, offers: [OFFER] } });
      ok(p.settled(), 'the list finishes');
      eq(p.calls('byes').length + p.calls('kickoffs').length, 0, 'the NFL’s byes and kickoffs are not asked for');
      const r = p.rows();
      ok(r.some((x) => x.id === 'hole-6-17' && x.detail === 'T4 Man 08 is on bye'), 'the bye is still known, off the copy', r.map((x) => x.detail));
      const offer = r.find((x) => x.kind === 'offer') || {};
      eq(offer.detail, 'Get T3 Man 03 for T4 Man 04, T4 Man 10 · as of 2 hours ago', 'an offer says how old the copy is');
      eq(r.find((x) => x.kind === 'start') && r.find((x) => x.kind === 'start').tag, 'A', 'the lineup button is the link');
      const rec = p.saved(season);
      ok(rec && rec.until === null, 'the count is saved, with no kickoff to end it', rec);
      ok(p.fetchCalls.length === 0, 'the page asked the network nothing itself', p.fetchCalls);
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'past') {
      const p = await boot({ conn: { ...conn, season: season - 1 }, stub: { lineup: { can: true } } });
      const mod = await import(moduleUrl('js/notify-load.js'));
      ok(p.settled(), 'the page settles');
      eq(p.rows().length, 0, 'an earlier season: no list');
      const s = p.sentence();
      ok(/earlier season/i.test(s) && s.split(/\s+/).length <= 14 && (s.match(/[.!?](\s|$)/g) || []).length === 1, 'one sentence instead', s);
      ok(p.list.hasAttribute('hidden') || p.list.children.length === 0, 'and nothing else in the panel');
      eq(p.calls().filter((c) => c[0] !== 'canSetLineup'), [], 'nothing is read for it: no schedule, no rosters, no wire');
      eq(p.saved(season - 1), null, 'and no count is saved');
      eq(mod.savedCount(), { now: 0, soon: 0, idea: 0, fresh: true }, 'savedCount: nothing to count, and nothing to work out');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'noTeam') {
      const p = await boot({ conn: { leagueId: LEAGUE, season } });
      const mod = await import(moduleUrl('js/notify-load.js'));
      ok(p.settled(), 'the page settles');
      eq(p.rows().length, 0, 'nobody set as you: no list');
      ok(/You are/.test(p.sentence()) && p.sentence().split(/\s+/).length <= 12, 'one sentence pointing at "You are"', p.sentence());
      eq(p.badge(), 'Live', 'the league is still the real one');
      eq(p.calls('weeks').length + p.calls('wire').length, 0, 'no coming weeks and no wire are read for nobody');
      eq(mod.savedCount(), { now: 0, soon: 0, idea: 0, fresh: true }, 'savedCount: nothing to count');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'over') {
      const p = await boot({ conn, stub: { playedThrough: 14 } });
      ok(p.settled(), 'the page settles');
      eq(p.rows().length, 0, 'every game played: no list');
      ok(/season is over/i.test(p.sentence()), 'one sentence instead', p.sentence());
      eq(p.calls('week').length + p.calls('weeks').length + p.calls('wire').length, 0, 'and no roster or wire is read');
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
  const res = spawnSync(process.execPath, ['--import', './notify-register.mjs', self, scenario],
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
