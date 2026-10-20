// THE WEEK RECAP ON HOME, AS TIM'S PHONE SEES IT: the synced copy.
//
// Tim, 2026-10-19: "I don't see pretty much anything in the home weekly recap
// section except injured players and missed points when I thought we talked
// about having a lot more in there. Why didn't any of the other features go
// throught? Fix it."
//
// The real index.html and the real js/week-summary-page.js, booted in linkedom
// on js/season.js as the synced copy serves it (recap-stub-season.mjs: ten
// squads of sixteen, 150 free agents a week, weeks 1-5 played). Checked:
//
//   - the recap is ON HOME, with every block drawn and none empty without a
//     line saying why;
//   - the pool reaches the synced wire (a free agent's 41.7 is a boom), and the
//     best pickup is rebuilt from the rosters (the copy has no transactions);
//   - the injury table is Player | Est. return | Up while out, and the return
//     week comes off the kickoffs that ride the synced schedule;
//   - NOTHING is asked of ESPN (rule 20): no fetch, and none of the season
//     reads that would go to ESPN on the phone.
//
//   node recap-cloud-check.mjs                  parent
//   node recap-cloud-check.mjs child <copy>     child (copy: full | bare)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const PAGE = process.env.RECAP_PAGE || 'index.html';

if (process.argv[2] === 'child') {
  const hook = `
    const TESTS = ${JSON.stringify(new URL('./', import.meta.url).href)};
    const SEASON = ${JSON.stringify(new URL('./recap-stub-season.mjs', import.meta.url).href)};
    export async function resolve(spec, ctx, next) {
      const fromTests = ctx.parentURL && ctx.parentURL.startsWith(TESTS);
      if (spec.startsWith('.') && !fromTests && /\\/season\\.js$/.test(spec)) return next(SEASON, ctx);
      return next(spec, ctx);
    }`;
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));

  const { document, fetchCalls } = bootDom({
    html: readFileSync(path.join(REPO, PAGE), 'utf8'),
    store: { 'ff.connection': { leagueId: '1241838', season: 2026, teamId: 1 } },
  });
  // The page's own source switch says "My ESPN league" (its module is not
  // booted here: the recap follows the buttons, so this is all it reads).
  for (const b of document.querySelectorAll('#sourceToggle button')) b.classList.toggle('on', b.dataset.src === 'live');
  const out = { hasPanel: !!document.getElementById('recapPanel') };
  if (process.argv[4] === 'home') {
    // HOME'S OWN INJURY REPORT on the copy: js/home-page.js as the page boots it.
    await import(moduleUrl('js/home-page.js'));
    const hurtName = () => {
      const id = globalThis.__hurtId;
      for (const t of globalThis.__copy.rosters.get(6) || []) for (const p of t.players) if (p.playerId === id) return p.name;
      return null;
    };
    await waitFor(() => [...document.querySelectorAll('#injuries tbody tr')]
      .some((tr) => text(tr.children[0]).startsWith(hurtName()) && text(tr.children[1]) !== '—'), 15000).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    out.homeHeads = [...document.querySelectorAll('#injuryTable thead th')].map(text);
    out.homeRows = [...document.querySelectorAll('#injuries tbody tr')].map((tr) => [...tr.children].map(text));
    out.hurtName = hurtName();
  } else if (out.hasPanel) {
    await import(moduleUrl('js/week-summary-page.js'));
    await waitFor(() => document.querySelectorAll('#recapBody .recap-block').length >= 8 ||
      /neg/.test(document.getElementById('recapStatus')?.className || ''), 15000);
    await new Promise((r) => setTimeout(r, 50));
    const blocks = {};
    for (const b of document.querySelectorAll('#recapBody .recap-block')) {
      blocks[b.id] = {
        heads: [...b.querySelectorAll('thead th')].map(text),
        rows: [...b.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text)),
      };
    }
    out.blocks = blocks;
    out.weeks = [...document.querySelectorAll('#recapWeek option')].map((o) => o.getAttribute('value'));
    out.status = text(document.getElementById('recapStatus'));
  }
  out.fetches = fetchCalls;
  out.asks = globalThis.__espnAsks || [];
  out.hurt = globalThis.__hurtId ?? null;
  out.errors = errors.filter((e) => !/unexpected network call/.test(e));
  emit(out);
} else {
  let pass = 0;
  let fail = 0;
  const ok = (c, msg, extra = '') => {
    if (c) pass++;
    else { fail++; console.log(`FAIL ${msg}${extra ? ` — ${String(extra).slice(0, 400)}` : ''}`); }
  };
  const run = (copy) => {
    const [kind, page] = copy.split(':');
    const r = spawnSync(process.execPath, [self, 'child', kind, page || ''], {
      cwd: path.dirname(self), encoding: 'utf8', env: { ...process.env, RECAP_COPY: kind }, timeout: 60000,
    });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
    if (!line) { console.log(r.stdout, r.stderr); return null; }
    return JSON.parse(line.slice(2));
  };

  // HOME'S OWN INJURY REPORT, on the full copy: Tim's three columns, filled
  // off the copy alone, and nothing asked of ESPN.
  {
    const r = run('full:home');
    ok(!!r, 'home: the child reported');
    if (r) {
      ok(r.errors.length === 0, 'home: no errors', r.errors.join(' | '));
      ok(r.fetches.length === 0, 'home: no request left the page (rule 20)', r.fetches.join(', '));
      ok(r.asks.length === 0, 'home: nothing the phone would ask ESPN for', r.asks.join(', '));
      ok(JSON.stringify(r.homeHeads) === JSON.stringify(['Player', 'Est. return', 'Up while out']), 'home: the injury report is Player | Est. return | Up while out', JSON.stringify(r.homeHeads));
      const row = (r.homeRows || []).find((x) => x[0].startsWith(r.hurtName || '?'));
      ok(!!row && row[1] === 'Wk 8', 'home: the OUT starter is back week 8, off the synced kickoffs', JSON.stringify(r.homeRows));
      ok((r.homeRows || []).every((x) => x.length === 3), 'home: every row has the three cells');
    }
  }

  for (const copy of ['full', 'bare']) {
    const r = run(copy);
    ok(!!r, `${copy}: the child reported`);
    if (!r) continue;
    ok(r.hasPanel, `${copy}: the Week recap panel is on ${PAGE}`);
    if (!r.hasPanel) continue;
    ok(r.errors.length === 0, `${copy}: no errors`, r.errors.join(' | '));
    ok(r.fetches.length === 0, `${copy}: no request left the page (rule 20)`, r.fetches.join(', '));
    ok(r.asks.length === 0, `${copy}: nothing the phone would ask ESPN for`, r.asks.join(', '));
    ok(JSON.stringify(r.weeks) === JSON.stringify(['5', '4', '3', '2', '1']), `${copy}: weeks 1-5 offered, latest first`, JSON.stringify(r.weeks));

    const B = r.blocks || {};
    const want = ['recapFacts', 'recapGames', 'recapStandings', 'recapMissed', 'recapBooms', 'recapBusts', 'recapPositions', 'recapInjuries'];
    for (const id of want) {
      const b = B[id];
      ok(!!b, `${copy}: block ${id} drawn`);
      if (!b) continue;
      ok(b.rows.length > 0 && b.rows.every((row) => row.some((c) => c && c !== '—')), `${copy}: ${id} has rows with something in them`, JSON.stringify(b.rows.slice(0, 3)));
    }
    const facts = Object.fromEntries((B.recapFacts?.rows || []).map((row) => [row[0], row[1]]));
    ok(facts['High score'] && facts['High score'] !== '—', `${copy}: high score filled`, JSON.stringify(facts));
    ok((B.recapGames?.rows || []).length === 5, `${copy}: five results`, (B.recapGames?.rows || []).length);
    ok((B.recapStandings?.rows || []).length === 10, `${copy}: ten standings rows`);
    ok((B.recapMissed?.rows || []).length === 10, `${copy}: ten missed-points rows`);
    ok(facts['Best pickup'] && facts['Best pickup'] !== '—', `${copy}: best pickup named (rebuilt from the rosters)`, facts['Best pickup']);

    const inj = B.recapInjuries || { heads: [], rows: [] };
    ok(JSON.stringify(inj.heads) === JSON.stringify(['Player', 'Est. return', 'Up while out']), `${copy}: injury columns are Player | Est. return | Up while out`, JSON.stringify(inj.heads));
    if (copy === 'full') {
      ok((B.recapBooms?.rows || []).some((row) => row[0] === 'Wire Star'), 'full: a free agent off the synced wire is a boom', JSON.stringify((B.recapBooms?.rows || []).map((x) => x[0])));
      ok((B.recapPositions?.rows || []).some((row) => /Wire Star/.test(row[1])), 'full: and the top WR league-wide', JSON.stringify(B.recapPositions?.rows));
      const hurtRow = inj.rows.find((row) => row[1] === 'Wk 8');
      ok(!!hurtRow, 'full: ESPN\'s Oct 25 return is week 8, off the synced kickoffs', JSON.stringify(inj.rows));
    } else {
      // An older copy: no wire, no kickoffs. Rostered men only, said in one line,
      // and a return date that cannot be turned into a week is shown as the date.
      ok(/rostered/i.test(r.status), 'bare: one line says the pool is rostered men only', r.status);
      ok(inj.rows.some((row) => /Oct 25/.test(row[1])), 'bare: no kickoffs, so the return shows as ESPN\'s date', JSON.stringify(inj.rows));
    }
  }
  console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
  process.exit(fail ? 1 : 0);
}
