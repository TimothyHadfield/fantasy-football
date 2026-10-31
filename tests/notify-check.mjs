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
// How many links the site's nav carries, read off index.html's own nav (the
// count changes when a page is added, as Playoffs was on 2026-10-16).
const NAV_LINKS = ((readFileSync(path.join(REPO, 'index.html'), 'utf8')
  .match(/<header class="site">[\s\S]*?<nav>([\s\S]*?)<\/nav>/) || ['', ''])[1].match(/<a\s/g) || []).length;
const LEAGUE = '99';
const ME = 4;
const SCENARIOS = ['demo', 'live', 'farHoles', 'lineupOk', 'lineupStale', 'lineupRefused', 'synced', 'syncedHeld', 'past', 'noTeam', 'over', 'ended', 'autoOn', 'autoBlocked', 'autoSwitch'];

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
      level: ((el.getAttribute('class') || '').split(/\s+/).find((c) => /^nt-(now|pending|soon|idea)$/.test(c)) || '').slice(3),
      title: text(el.querySelector('.nt-title')), detail: text(el.querySelector('.nt-detail')),
      // The suggested action: '' when the line has none. `parts` is the order the line is drawn in.
      suggest: text(el.querySelector('.nt-suggest')), suggests: el.querySelectorAll('.nt-suggest').length,
      parts: [...el.children].map((c) => ((c.getAttribute('class') || '').match(/nt-(title|detail|suggest|go)/) || [])[1]),
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
      ok(heads.length >= 1 && heads.join() === ['[This week]', '[Pending]', '[Coming weeks]', '[Ideas]'].filter((h) => heads.includes(h)).join(), 'the headings are in order: This week, Pending, Coming weeks, Ideas', heads);
      const levels = r.map((x) => ['now', 'pending', 'soon', 'idea'].indexOf(x.level));
      ok(levels.every((v, i) => v >= 0 && (i === 0 || levels[i - 1] <= v)), 'the lines are most urgent first', levels);
      // PENDING TRADES on the sample league too (Tim, 2026-10-22: "also in the
      // notifications setting show pending trades aswell"): one sent to you, one sent by you.
      const offers = r.filter((x) => x.kind === 'offer');
      ok(heads.includes('[Pending]') && offers.length >= 2 && offers.every((x) => x.level === 'pending'), 'demo: pending trades under Pending', offers.map((x) => `${x.level} ${x.title}`));
      ok(offers.some((x) => /^Sent to you · Get .+ for .+ · expires /.test(x.detail)) && offers.some((x) => /^Sent by you · Get .+ for .+ · expires /.test(x.detail)),
        'demo: each says who sent it, what for what, and its deadline', offers.map((x) => x.detail));
      ok(offers.every((x) => x.label === 'Open it' && /^trade\.html\?with=\d+&get=\d+&send=\d+$/.test(x.href)), 'demo: each opens that deal on Trade', offers.map((x) => `${x.label} ${x.href}`));
      eq(p.document.querySelectorAll('[data-empty="pending"]').length, 0, 'demo: no empty line when there are pending trades');
      ok(r.every((x) => x.tag === 'A' && !x.lineup && !/^https?:/.test(x.href || '')), 'no lineup button and no ESPN link: the sample league is nobody’s', r.map((x) => `${x.tag} ${x.href}`));
      const pick = r.filter((x) => x.kind === 'pickup');
      ok(pick.length >= 1 && pick.length <= 3 && pick.every((x) => /^waivers\.html\?player=\d+$/.test(x.href)), 'up to three pick-ups, each opening that man on Players', pick.map((x) => x.href));
      ok(r.filter((x) => x.kind === 'trade').length === 1 && r.some((x) => x.id === 'trade-look' && x.href === 'trade.html'), 'one trade line, opening Trade');
      // THE SUGGESTED ACTION, under the title and detail.
      const said = r.filter((x) => x.suggest);
      ok(said.length >= 1 && pick.every((x) => /^Drop .+, add .+$/.test(x.suggest)), 'lines carry a suggested action; a pick-up says who to drop and who to add', r.map((x) => `${x.kind}: ${x.suggest}`));
      ok(r.every((x) => x.suggests <= 1 && x.suggest.split(/\s+/).length <= 10), 'one suggestion a line at most, ten words or fewer', r.map((x) => x.suggest));
      ok(said.every((x) => x.parts.join() === 'title,detail,suggest,go'), 'it is drawn after the detail and before the button', said.map((x) => x.parts.join()));
      ok(r.every((x) => !x.suggest || (x.suggest !== x.detail && !/drop/i.test(x.detail))), 'and the detail does not say it as well', r.map((x) => x.detail));
      eq(r.find((x) => x.id === 'trade-look').suggests, 0, '"Look for trades" has no suggestion, and no empty line for one');
      ok(![...p.map.keys()].some((k) => k.startsWith('ff.notes')), 'the sample league saves no count', [...p.map.keys()]);
      eq(p.calls().filter((c) => c[0] !== 'canSetLineup'), [], 'and reads no league');
      ok(p.fetchCalls.length === 0, 'the page asked the network nothing', p.fetchCalls);
      // Outside the nav row: reached by the bell.
      const nav = [...p.document.querySelectorAll('header.site nav a')];
      ok(NAV_LINKS > 0 && nav.length === NAV_LINKS && nav.every((a) => !(a.getAttribute('class') || '').includes('active') && !a.hasAttribute('aria-current')), 'the nav is the site’s, and none of its links is marked');
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
      eq(p.order(), ['[This week]', 'start', 'bad-start', '[Pending]', 'offer', '[Coming weeks]', 'hole', '[Ideas]', 'pickup', 'pickup', 'trade'],
        'one list: four headings, every kind of line, most urgent first, the offer sent to you under Pending');
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
        ['Trade offer from Team 3', 'Sent to you · Get T3 Man 03 for T4 Man 04, T4 Man 10', 'Open it', 'trade.html?with=3&get=303&send=404,410'],
        'offer: who, what for what, and the deal opened on Trade');
      // hole
      eq([by('hole-6-17').title, by('hole-6-17').detail, by('hole-6-17').label, by('hole-6-17').href],
        ['Week 6: no K', 'T4 Man 08 is on bye', 'Find one', 'waivers.html?pos=K'], 'hole: the week, the slot, why, and Players opened on kickers');
      eq(r.filter((x) => x.kind === 'hole').length, 1, 'hole: the other nine weeks are whole and say nothing');
      // pickup: the kicker is worth 4 + 12 + 4 over weeks 5-7, the tight end 13 + 2 + 2.
      eq(r.filter((x) => x.kind === 'pickup').map((x) => [x.title, x.detail, x.label, x.href]), [
        ['Pick up Free Kicker', '+6.7 pts a week', 'See him', 'waivers.html?player=901'],
        ['Pick up Free Tightend', '+5.7 pts a week', 'See him', 'waivers.html?player=902'],
      ], 'pickup: the free agents who beat your men, best first, and never the one who does not');
      eq(p.calls('wire').map((c) => c[1]).sort((a, b) => a - b), [5, 6, 7], 'pickup: priced over the next three weeks, one wire read each — and the hole in week 6 costs no read of its own');
      // trade
      eq([by('trade-0-2').title, by('trade-0-2').detail, by('trade-0-2').label, by('trade-0-2').href],
        ['Trade with Team 2', '+1.2 pts a week · found 3 hours ago', 'Open it', 'trade.html?with=2&get=203&send=406'], 'trade: the deal the Trade page saved, with its gain and its age');

      // THE SUGGESTED ACTION of every kind, under its line.
      const drops = r.filter((x) => x.kind === 'pickup').map((x) => (x.suggest.match(/^Drop (T4 Man \d\d), add /) || [])[1]);
      ok(drops.length === 2 && drops.every(Boolean), 'suggest, pickup: each names one of your men to drop', r.filter((x) => x.kind === 'pickup').map((x) => x.suggest));
      eq(r.map((x) => [x.id, x.suggest]), [
        ['start-409-402', 'Move T4 Man 09 into RB, bench T4 Man 02'],
        ['bad-405', 'Add a TE this week'],
        ['offer-abc', 'Check it on Trade before it expires'],
        ['hole-6-17', `Drop ${drops[0]}, add Free Kicker for 1 week`],
        ['pickup-901', `Drop ${drops[0]}, add Free Kicker`],
        ['pickup-902', `Drop ${drops[1]}, add Free Tightend`],
        ['trade-0-2', 'Offer T4 Man 06 for T2 Man 03'],
      ], 'suggest: the swap’s slots, a position to add, the offer, the bye week’s fill (the same drop as the pick-up, "for 1 week"), the pick-ups and the deal');
      ok(r.every((x) => x.suggests === 1 && x.parts.join() === 'title,detail,suggest,go'), 'suggest: one line each, after the detail and before the button', r.map((x) => x.parts.join()));
      ok(r.every((x) => x.suggest.split(/\s+/).length <= 10), 'suggest: ten words or fewer', r.map((x) => x.suggest));

      // What was read, and how often.
      eq(p.calls('schedule').length, 1, 'the schedule is read once');
      eq(p.calls('week'), [['week', 5, 'held']], 'this week’s rosters once, out of the store');
      eq(p.calls('weeks'), [['weeks', [6, 7, 8, 9, 10, 11, 12, 13, 14]]], 'the coming weeks in one read');
      ok(p.fetchCalls.length === 0, 'the page asked the network nothing itself', p.fetchCalls);

      // THE COUNT: this file is its only writer.
      const rec = p.saved(season);
      eq(rec && [rec.v, rec.team, rec.week, rec.now, rec.pending, rec.soon, rec.idea], [1, ME, 5, 2, 1, 1, 3], 'the count is saved under the league’s own key: 2 this week, 1 pending, 1 coming, 3 ideas');
      ok(rec && Math.abs(rec.at - Date.now()) < 60000 && rec.until === stubbed.KICKOFF, 'with when it was worked out and the next kickoff', rec);
      eq(mod.savedCount(), { now: 2, pending: 1, soon: 1, idea: 3, fresh: true }, 'savedCount: the bell’s numbers, fresh (the offer counted as pending)');
      eq(mod.savedCount(Date.now() + mod.FRESH_MS + 1000).fresh, false, 'savedCount: stale after three hours');
      // A kickoff an hour off: fresh until it, stale after — well inside the three hours.
      const key = `ff.notes.${LEAGUE}-${season}`;
      const soon = Date.now() + 60 * 60 * 1000;
      p.map.set(key, JSON.stringify({ ...rec, until: soon }));
      eq([mod.savedCount(soon - 1000).fresh, mod.savedCount(soon + 1000).fresh], [true, false], 'savedCount: stale once a game has kicked off');
      p.map.set(key, JSON.stringify(rec));
      p.map.set('ff.connection', JSON.stringify({ ...conn, teamId: 2 }));
      eq(mod.savedCount(), { now: 0, pending: 0, soon: 0, idea: 0, fresh: false }, 'savedCount: another team’s count is not yours');
      p.map.set('ff.connection', JSON.stringify(conn));
      const before = p.calls('schedule').length;
      const lines = await mod.refresh();
      ok(Array.isArray(lines) && lines.length === r.length && lines.every((n) => n.id && n.level), 'refresh() resolves with the lines', lines && lines.length);
      ok(p.calls('schedule').length === before + 1, 'and works them out again');
      // ANOTHER TEAM WHILE A RUN IS IN THE AIR (sweep 2026-10-16 #7): the second
      // ask must not join the first, which is working out team 4's lines.
      {
        const first = mod.load();
        p.map.set('ff.connection', JSON.stringify({ ...conn, teamId: 2 }));
        const second = mod.load();
        const [a, b] = await Promise.all([first, second]);
        eq([a && a.teamId, b && b.teamId].map(Number), [ME, 2], 'ROW 7: A RUN FOR ANOTHER TEAM IS NOT JOINED TO THE ONE IN THE AIR');
        p.map.set('ff.connection', JSON.stringify(conn));
        const c1 = mod.load();
        const c2 = mod.load();
        ok(c1 === c2, 'while the same team’s ask still joins it');
        await c1;
      }
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'farHoles') {
      // Holes beyond the three weeks the pick-ups read (your kicker projects 0
      // in weeks 9-12 as well): each wants its own week's wire for the man to
      // add, and that is capped.
      const p = await boot({ conn, stub: { zeroK: [9, 10, 11, 12] } });
      const mod = await import(moduleUrl('js/notify-load.js'));
      ok(p.settled(), 'the list finishes');
      const holes = p.rows().filter((x) => x.kind === 'hole');
      eq(holes.map((x) => x.id), ['hole-6-17', 'hole-9-17', 'hole-10-17', 'hole-11-17', 'hole-12-17'], 'five weeks with no kicker');
      eq(mod.HOLE_WIRE_MAX, 3, 'at most three extra wire reads');
      eq(p.calls('wire').map((c) => c[1]).sort((a, b) => a - b), [5, 6, 7, 9, 10, 11],
        'the wire is read for the pick-ups’ three weeks and the NEAREST three holes beyond them, once each — never week 12');
      ok(/^Drop T4 Man \d\d, add Free Kicker for 1 week$/.test(holes[0].suggest), 'the bye week: drop one of yours, add that week’s kicker, for 1 week', holes[0].suggest);
      ok(holes.slice(1, 4).every((x, i) => new RegExp(`^Drop T4 Man \\d\\d, add Free Kicker for week ${9 + i}$`).test(x.suggest)),
        'a later hole with no known bye names its week', holes.map((x) => x.suggest));
      eq([holes[4].detail, holes[4].suggest], ['T4 Man 08 projects 0', 'Add a K before week 12'], 'past the cap the position is named and no player is invented');
      ok(p.fetchCalls.length === 0, 'the page asked the network nothing itself', p.fetchCalls);
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

    // AUTO-SET BEST LINEUP (Tim, 2026-10-31: "fix all future ESPN lineups"):
    // the switch on and the extension allowed — the bar's per-load job sets
    // this week's lineup in ONE full request (to the stub; nothing real), and
    // "This week" opens with what it did.
    const prefsOn = (on) => ({ 'ff.prefs': { 'notify.autoLineup': on, '@league': `${LEAGUE}-${season}` } });
    const sw = (p) => p.document.getElementById('ntAutoLineup');
    const why = (p) => p.document.getElementById('ntAutoWhy');
    if (scenario === 'autoOn') {
      const p = await boot({ conn, stub: { lineup: { can: true, result: { ok: true }, applies: true } }, store: prefsOn(true) });
      await waitFor(() => p.calls('setLineup').length >= 1 && p.rows().some((x) => x.kind === 'auto-lineup') && p.settled(), 8000);
      await tick(60);
      const sent = p.calls('setLineup');
      eq(sent.length, 1, 'auto: ONE request');
      const req = sent[0] && sent[0][1];
      eq(req && [req.leagueId, req.season, req.week, req.teamId, req.full], [LEAGUE, season, 5, ME, true],
        'auto: this league, the current week (5), your team, marked full');
      ok(req && SWAP.every((m) => req.moves.some((x) => x.playerId === m.playerId && x.fromSlotId === m.fromSlotId && x.toSlotId === m.toSlotId)),
        'auto: it holds the swap the start line names', req && req.moves);
      ok(p.calls('week').some((c) => c[1] === 5 && c[2] === 'fresh'), 'auto: decided on a FRESH read of week 5', p.calls('week'));
      const order = p.order();
      eq(order.slice(0, 2), ['[This week]', 'auto-lineup'], 'auto: its line heads This week', order);
      const a = p.rows().find((x) => x.kind === 'auto-lineup');
      eq(a && [a.title, a.label, a.href, a.target], ['Lineup set for week 5', 'Open ESPN', ESPN(season), '_blank'],
        'auto: "Lineup set for week 5" and a link to ESPN’s lineup page');
      ok(a && /^Start T4 Man 09 \(RB\)/.test(a.detail) && /bench T4 Man 02/.test(a.detail), 'auto: the moves in short', a && a.detail);
      ok(!p.rows().some((x) => x.id === 'start-409-402'), 'auto: the swap line is gone once ESPN shows it', p.order());
      const mem = p.map.get(`ff.autolineup.${LEAGUE}-${season}-${ME}`);
      ok(mem && JSON.parse(mem).last.kind === 'set' && JSON.parse(mem).week === 5, 'auto: remembered as set for week 5', mem);
      eq([sw(p).checked, sw(p).disabled, why(p).hidden], [true, false, true], 'auto: the switch is on, working, with no excuse beside it');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'autoBlocked') {
      // The extension's own lineup switch is off: nothing is set, and the switch says why.
      const p = await boot({ conn, stub: { lineup: { can: false } }, store: prefsOn(true) });
      // The words wait for the extension's hello to settle (up to 0.8 s).
      await waitFor(() => !why(p).hidden, 4000);
      await tick(300);
      eq(p.calls('setLineup').length, 0, 'blocked: nothing is set');
      ok(!p.rows().some((x) => x.kind === 'auto-lineup'), 'blocked: no auto line');
      eq([sw(p).disabled, why(p).hidden, text(why(p))], [true, false, 'Turn on the lineup switch in the extension'],
        'blocked: the switch is disabled and says why in a few words');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'autoSwitch') {
      // Off by default; turning it on runs at once and is remembered per league.
      const p = await boot({ conn, stub: { lineup: { can: true, result: { ok: true }, applies: true } } });
      await waitFor(() => sw(p) && !sw(p).disabled, 4000);
      eq([sw(p).checked, sw(p).disabled], [false, false], 'switch: off by default, and usable here');
      await tick(200);
      eq(p.calls('setLineup').length, 0, 'switch off: nothing is set on load');
      sw(p).checked = true;
      p.fire(sw(p), 'change');
      await waitFor(() => p.calls('setLineup').length >= 1, 8000);
      eq(p.calls('setLineup')[0][1].full, true, 'switch turned on: the full request goes at once');
      const prefs = JSON.parse(p.map.get('ff.prefs') || '{}');
      eq([prefs['notify.autoLineup'], prefs['@league']], [true, `${LEAGUE}-${season}`], 'switch: remembered for this league');
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
      eq(row() && row().suggest, 'Move T4 Man 09 into RB, bench T4 Man 02', 'and the suggestion still says what to do there by hand');
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
      eq(offer.detail, 'Sent to you · Get T3 Man 03 for T4 Man 04, T4 Man 10 · as of 2 hours ago', 'an offer says how old the copy is');
      eq(r.find((x) => x.kind === 'start') && r.find((x) => x.kind === 'start').tag, 'A', 'the lineup button is the link');
      const rec = p.saved(season);
      ok(rec && rec.until === null, 'the count is saved, with no kickoff to end it', rec);
      // The copy holds this week's wire only: week 6's is NOT asked for (it
      // would fall through to ESPN), so the hole names a position and no man.
      eq(p.calls('wire').map((c) => c[1]), [5], 'only the wire week the copy holds is read: the hole’s week is not');
      eq(r.find((x) => x.id === 'hole-6-17').suggest, 'Add a K before week 6', 'so the hole says the position, and invents nobody');
      ok(p.fetchCalls.length === 0, 'the page asked the network nothing itself', p.fetchCalls);
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'syncedHeld') {
      // A copy that holds the wire of weeks 5, 6 and 9; holes in 6, 9 and 10.
      const p = await boot({ conn, stub: { cloud: true, cloudWire: [5, 6, 9], zeroK: [9, 10] } });
      ok(p.settled(), 'the list finishes');
      eq(p.calls('wire').map((c) => c[1]).sort((a, b) => a - b), [5, 6, 9], 'the wire is read for the weeks the copy holds, and no other');
      const holes = p.rows().filter((x) => x.kind === 'hole');
      ok(holes.length === 3 && /^Drop T4 Man \d\d, add Free Kicker for 1 week$/.test(holes[0].suggest) &&
        /^Drop T4 Man \d\d, add Free Kicker for week 9$/.test(holes[1].suggest), 'a held week names the man to add', holes.map((x) => x.suggest));
      eq(holes[2] && holes[2].suggest, 'Add a K before week 10', 'a week the copy lacks names the position only');
      eq(p.calls('byes').length + p.calls('kickoffs').length, 0, 'the NFL’s byes and kickoffs are still not asked for');
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
      eq(mod.savedCount(), { now: 0, pending: 0, soon: 0, idea: 0, fresh: true }, 'savedCount: nothing to count, and nothing to work out');
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'ended') {
      // Tim, 2026-10-22: "If a sent trade is either expired or denied, put it in
      // the notifications section where it asks the user if they want to follow
      // up or not, or dismiss it".
      const HOUR = 3600 * 1000;
      const ENDED = [
        { id: 'e-dec', withTeamId: 3, get: [303], send: [404], reason: 'declined', at: Date.now() - 2 * HOUR },
        { id: 'e-exp', withTeamId: 2, get: [203], send: [406, 407], reason: 'expired', at: Date.now() - HOUR },
      ];
      const p = await boot({ conn, stub: { ended: ENDED } });
      const mod = await import(moduleUrl('js/notify-load.js'));
      ok(p.settled(), 'the list finishes');
      const order = p.order();
      ok(order.indexOf('[Pending]') >= 0 && order[order.indexOf('[Pending]') + 1] === 'ended' && order[order.indexOf('[Pending]') + 2] === 'ended',
        'both ended offers sit under Pending, first there', order);
      const ended = () => p.rows().filter((x) => x.kind === 'ended');
      const r = ended();
      eq(r.map((x) => x.title), ['Team 3 declined your offer', 'Your offer to Team 2 expired'], 'who, and why it ended');
      ok(/^Get T3 Man 03 for T4 Man 04 · ended /.test(r[0].detail), 'what was offered for what, and when', r[0].detail);
      ok(/^Get T2 Man 03 for T4 Man 06, T4 Man 07 · ended /.test(r[1].detail), 'every man named', r[1].detail);
      ok(r.every((x) => x.controls === 2), 'two buttons each', r.map((x) => x.controls));
      const labels = (x) => [...x.el.querySelectorAll('a, button')].map((b) => text(b));
      eq(labels(r[0]), ['Follow up', 'Dismiss'], 'Follow up, then Dismiss');
      eq(r[0].href, 'trade.html?with=3&get=303&send=404', 'Follow up opens the same deal on Trade');
      ok(r.every((x) => x.suggest), 'with a line asking which', r.map((x) => x.suggest));
      eq(mod.savedCount().pending, 2, 'the bell counts both');

      // DISMISS: gone at once, remembered, and off the bell's count.
      const sentKey = `ff.trades.sent.${LEAGUE}-${season}`;
      p.fire(r[0].el.querySelector('[data-dismiss]'), 'click');
      await tick(120);
      eq(ended().map((x) => x.id), ['ended-e-exp'], 'Dismiss takes the line off the list');
      const rec = JSON.parse(p.map.get(sentKey) || 'null');
      ok(rec && rec.handled.includes('e-dec'), 'and remembers it for good', JSON.stringify(rec));
      eq(mod.savedCount().pending, 1, 'and the bell counts one less');

      // FOLLOW UP: kept as a saved trade (the entry Trade's Save writes), opened there.
      const went = [];
      p.window.location.assign = (h) => went.push(h);
      p.fire(ended()[0].el.querySelector('[data-follow]'), 'click');
      await tick(150);
      const prefs = JSON.parse(p.map.get('ff.prefs') || '{}');
      ok(JSON.stringify(prefs['trade.custom']) === JSON.stringify([{ a: ME, b: 2, sendA: ['406', '407'], sendB: ['203'] }]),
        'Follow up saves the deal as a custom trade: you, him, the men each side sends', JSON.stringify(prefs['trade.custom']));
      eq(went, ['trade.html?with=2&get=203&send=406,407'], 'and opens it in the Trade page\'s builder');
      const rec2 = JSON.parse(p.map.get(sentKey) || 'null');
      ok(rec2 && rec2.handled.includes('e-exp'), 'and the line is handled for good too', JSON.stringify(rec2));
      eq(mod.savedCount().pending, 0, 'nothing left on the bell');
      // Nothing pending now, but Pending still shows, with a plain line saying so.
      const none = [...p.document.querySelectorAll('[data-empty="pending"]')];
      ok(p.order().includes('[Pending]') && none.length === 1 && text(none[0]) === 'No pending trades or claims right now.',
        'Pending stays, with a plain line when nothing is pending', `${p.order()} | ${none.map(text)}`);
      ok(p.errors.length === 0, 'nothing thrown', p.errors.join(' | '));
    }

    if (scenario === 'noTeam') {
      const p = await boot({ conn: { leagueId: LEAGUE, season } });
      const mod = await import(moduleUrl('js/notify-load.js'));
      ok(p.settled(), 'the page settles');
      eq(p.rows().length, 0, 'nobody set as you: no list');
      ok(/You are/.test(p.sentence()) && p.sentence().split(/\s+/).length <= 12, 'one sentence pointing at "You are"', p.sentence());
      eq(p.badge(), 'Live', 'the league is still the real one');
      eq(p.document.querySelectorAll('[data-empty="pending"]').length, 0, 'no Pending line without a team');
      eq(p.calls('weeks').length + p.calls('wire').length, 0, 'no coming weeks and no wire are read for nobody');
      eq(mod.savedCount(), { now: 0, pending: 0, soon: 0, idea: 0, fresh: true }, 'savedCount: nothing to count');
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
