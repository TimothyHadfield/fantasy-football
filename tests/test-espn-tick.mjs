// extension/content-espn-trade.js against a fake ESPN trade page.
//
// The script's whole job is to tick the owner's own side of a trade, on ESPN's
// page, and then stop. The three things that could go badly wrong, and what
// this suite does about each:
//
//   IT UNTICKS THEIR SIDE. A checkbox is a toggle and the URL has already
//   ticked the counterparty's men, so a script that clicked blindly would take
//   them back off — and the screen would look entirely reasonable. Every
//   scenario below asserts the click COUNT on each box, not just the end state.
//
//   IT SUBMITS. The one write to ESPN must stay the owner's own click on their
//   own button. The fake page carries a Propose Trade button and a confirmation
//   modal, both wired to record any event of any kind that reaches them, and
//   every scenario asserts that total is zero.
//
//   IT LOOKS RIGHT AND PROPOSES NOTHING. ESPN's checkbox is a controlled React
//   input: the store is updated from the CLICK, so writing aria-checked would
//   repaint the box and select nobody. So the fake page is built the same way
//   round — a `store` that only a real dispatched click can change, and
//   aria-checked rendered FROM it. Every assertion about who is in the trade
//   reads the store, never the attribute. A script that faked the attribute
//   would pass an attribute check and fail every one of these.
//
// The DOM shape is not invented. It is ESPN's, read out of their shipped
// trade.page.js and main.js bundles on 2026-09-16 — see the comments in
// extension/content-espn-trade.js, which quote the source that produces it.

import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { repoFile } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sameSet = (got, want, msg) => {
  const g = [...got].map(Number).sort((a, b) => a - b).join(',');
  const w = [...want].map(Number).sort((a, b) => a - b).join(',');
  ok(g === w, msg, `got [${g}], want [${w}]`);
};

const SOURCE = fs.readFileSync(repoFile('extension/content-espn-trade.js'), 'utf8');

const LEAGUE = '476225250';
const MY_TEAM = '4';
const THEIR_TEAM = '7';

// ---------------------------------------------------------------------------
// The fake ESPN trade page
// ---------------------------------------------------------------------------

/** One roster row, in ESPN's own markup. `logo: true` is a D/ST — no id in the DOM. */
function rowHtml(p, divRows) {
  const img = p.logo
    ? `<img class="player-headshot team-logo" alt="${p.name} Headshot" src="https://a.espncdn.com/i/teamlogos/nfl/500/bal.png">`
    : `<img class="player-headshot" alt="${p.name} Headshot" src="https://a.espncdn.com/i/headshots/nfl/players/full/${p.id}.png">`;
  const cells = `
    <${divRows ? 'div' : 'td'} class="Table__TD roster-action tc">
      <div class="jsx-1818739329 roster-action-col">
        <span tabindex="0" role="checkbox" aria-label="Select ${p.name}" aria-checked="false">
          <label class="control control--checkbox inline__control roster-action-checkbox">
            <input class="form__control form__control--checkbox" type="checkbox">
            <div class="control__indicator"></div>
          </label>
        </span>
      </div>
    </${divRows ? 'div' : 'td'}>
    <${divRows ? 'div' : 'td'} class="Table__TD">
      <div class="player-column-table2 justify-start">
        ${img}
        <div class="player-column_info">
          <span class="player-column__athlete"><a class="link">${p.name}</a></span>
          <span class="player-column__position">${p.pos || 'RB'}</span>
        </div>
      </div>
    </${divRows ? 'div' : 'td'}>`;
  // `divRows` models a rebuilt ESPN table with no <tr> and no Table__TR at all
  // — the layout change that would otherwise make every man unfindable.
  return divRows
    ? `<div class="roster-row">${cells}</div>`
    : `<tr class="Table__TR Table__TR--lg">${cells}</tr>`;
}

function panelHtml(teamName, players, divRows) {
  const rows = players.map((p) => rowHtml(p, divRows)).join('');
  const table = divRows
    ? `<div class="roster-list">${rows}</div>`
    : `<table class="Table"><tbody class="Table__TBODY">${rows}</tbody></table>`;
  return `
  <div class="trade-container-wrapper">
    <div class="trade-container-teamRoster" role="region" aria-label="Team Roster ${teamName}">
      <div class="jsx-3008435015 trade-container-teamRoster-content">
        <div class="trade-team trade-container-team"><span class="trade-team-teamName">${teamName}</span></div>
        ${table}
      </div>
    </div>
  </div>`;
}

/**
 * Build the page and wire the React stand-in.
 *
 * ESPN's real component is
 *   const g = playerTransactionStore.hasPlayerInAction(action, player.id);
 *   onChange = () => g ? store.removePlayer(p) : store.addPlayer(p, TRADE)
 *   <span role="checkbox" aria-checked={g}><Checkbox checked={g} onChange={…}/></span>
 * — so the store leads and the attributes follow. That is exactly what this
 * builds, which is why an attribute the script wrote itself would fool nobody.
 *
 * `deadReact: true` leaves the click listener off, modelling an ESPN build
 * whose handler has moved: the box is clicked and nothing happens.
 */
function buildPage({ theirs, mine, preTicked = [], deadReact = false, divRows = false, search }) {
  const html = `<!doctype html><html><body>
    <div class="page-container">
      ${panelHtml('Their Team', theirs, divRows)}
      ${panelHtml('My Team', mine, divRows)}
      <div class="trade-submission-bar-content">
        <div class="trade-submission-bar-actions">
          <button id="propose" class="Button Button--alt">Propose Trade</button>
          <button id="cancel" class="Button Button--alt Button--sm">Cancel</button>
        </div>
      </div>
      <div id="confirm" class="continue-trade-confirmation-thickbox">
        <button id="confirm-send" class="Button">Send</button>
      </div>
    </div>
  </body></html>`;

  const { window, document } = parseHTML(html);
  window.location = {
    href: 'https://fantasy.espn.com/football/team/trade' + search,
    origin: 'https://fantasy.espn.com',
    pathname: '/football/team/trade',
    search,
  };

  // Who is in the trade. Only a real, dispatched click can change this.
  const store = new Set();
  const events = [];            // every event that reached anything, with its target

  document.addEventListener('click', (e) => events.push({ type: 'click', target: e.target }), true);
  for (const type of ['mousedown', 'mouseup', 'keydown', 'keyup', 'change', 'submit', 'input']) {
    document.addEventListener(type, (e) => events.push({ type, target: e.target }), true);
  }

  const boxes = [];
  const all = [...theirs.map((p) => ({ ...p, side: 'theirs' })), ...mine.map((p) => ({ ...p, side: 'mine' }))];
  document.querySelectorAll('.roster-action-checkbox').forEach((label, i) => {
    const player = all[i];
    const span = label.closest('[role="checkbox"]');
    const input = label.querySelector('input');
    const render = () => {
      const on = store.has(player.id);
      span.setAttribute('aria-checked', String(on));
      if (on) input.setAttribute('checked', 'checked'); else input.removeAttribute('checked');
    };
    if (preTicked.includes(player.id)) store.add(player.id);
    render();
    if (!deadReact) {
      input.addEventListener('click', () => {
        if (store.has(player.id)) store.delete(player.id); else store.add(player.id);
        render();
      });
    }
    boxes.push({ player, span, input });
  });

  const submitIds = ['propose', 'cancel', 'confirm', 'confirm-send'];
  const submitNodes = submitIds.map((id) => document.getElementById(id));
  const touchedSubmit = () => events.filter(({ target }) =>
    submitNodes.some((n) => n === target || (n.contains && n.contains(target)))).length;

  const clicksOn = (id) => {
    const box = boxes.find((b) => b.player.id === id);
    if (!box) return -1;
    return events.filter((e) => e.type === 'click'
      && (e.target === box.input || e.target === box.span || box.span.contains(e.target))).length;
  };

  return { window, document, store, events, boxes, touchedSubmit, clicksOn };
}

/** A worker that answers one staged trade, and records what it was asked. */
function fakeWorker(reply) {
  const asked = [];
  return {
    asked,
    runtime: {
      lastError: undefined,
      sendMessage: (msg, cb) => {
        asked.push(msg);
        // Asynchronous, as the real one is — a script that assumed otherwise
        // would pass here and fail in Edge.
        setTimeout(() => cb(typeof reply === 'function' ? reply(msg) : reply), 0);
      },
    },
  };
}

/** Run the shipped content script against a page, and wait for it to finish. */
async function runScript(page, chrome) {
  const ctx = {
    window: page.window,
    document: page.document,
    chrome,
    console: { log() {}, warn() {}, error() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'content-espn-trade.js' });
  return page.window.__ffTradeTick;
}

const badgeText = (page) => {
  const b = page.document.getElementById('ff-bridge-trade-badge');
  return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
};

const SEARCH = `?leagueId=${LEAGUE}&seasonId=2026&teamId=${THEIR_TEAM}&fromTeamId=${MY_TEAM}&step=1&players=15847,4241457`;

const THEIRS = [
  { id: 15847, name: 'Davante Adams', pos: 'WR' },
  { id: 4241457, name: 'Bijan Robinson', pos: 'RB' },
  { id: 3116385, name: 'Josh Allen', pos: 'QB' },
];
const MINE = [
  { id: 4362628, name: 'Jahmyr Gibbs', pos: 'RB' },
  { id: 4430807, name: 'Puka Nacua', pos: 'WR' },
  { id: 3139477, name: 'Ravens D/ST', pos: 'DST', logo: true },
  { id: 4035687, name: 'Amon-Ra St. Brown', pos: 'WR' },
];

const staged = (myPlayers, theirPlayerIds = [15847, 4241457]) => ({
  ok: true,
  data: {
    leagueId: LEAGUE, season: 2026, myTeamId: MY_TEAM, theirTeamId: THEIR_TEAM,
    myPlayers, theirPlayerIds,
  },
});

// ===========================================================================
// 1. The ordinary case, with one man who is no longer on the roster
// ===========================================================================
{
  const page = buildPage({
    theirs: THEIRS, mine: MINE.slice(0, 2), preTicked: [15847, 4241457], search: SEARCH,
  });
  const chrome = fakeWorker(staged([
    { id: 4362628, name: 'Jahmyr Gibbs' },
    { id: 4430807, name: 'Puka Nacua' },
    { id: 9999999, name: 'Sold Lastweek' },       // dropped since the site last looked
  ]));
  const out = await runScript(page, chrome);

  eq(chrome.asked.length, 1, 'the worker is asked exactly once');
  eq(chrome.asked[0].type, 'TAKE_STAGED_TRADE', 'and asked to TAKE, which is the single-use door');
  eq(chrome.asked[0].leagueId, LEAGUE, 'the claim carries the league off the page URL');
  eq(chrome.asked[0].myTeamId, MY_TEAM, 'and fromTeamId as YOUR team');
  eq(chrome.asked[0].theirTeamId, THEIR_TEAM, 'and teamId as theirs');

  sameSet(page.store, [15847, 4241457, 4362628, 4430807], 'both sides are now in the trade');
  eq(page.clicksOn(4362628), 1, 'my first man was clicked once');
  eq(page.clicksOn(4430807), 1, 'my second man was clicked once');
  eq(page.clicksOn(15847), 0, 'THEIR already-ticked man was not touched');
  eq(page.clicksOn(4241457), 0, 'nor the other');
  eq(page.clicksOn(3116385), 0, 'nor a man of theirs who is not in the deal at all');
  eq(page.touchedSubmit(), 0, 'nothing reached Propose Trade, Cancel or the confirmation modal');

  eq(out.ran, true, 'the script reports it ran');
  eq(out.ticked.length, 2, 'two ticked');
  const t = badgeText(page);
  ok(/ticked 2 of your players/.test(t), 'the badge says how many', t);
  ok(/Jahmyr Gibbs/.test(t) && /Puka Nacua/.test(t), 'and names them', t);
  ok(/Sold Lastweek/.test(t), 'and NAMES THE MAN IT COULD NOT FIND — the failure with consequences', t);
  ok(/NOT in this trade/.test(t), 'and says plainly that he is not in the deal', t);
  ok(!/did not record the selection/.test(t), 'without muddling him up with a click ESPN refused', t);
  ok(/Propose Trade yourself/.test(t), 'and that the owner still has to send it', t);
}

// ===========================================================================
// 2. A box of mine that is already ticked is left alone
// ===========================================================================
{
  const page = buildPage({
    theirs: THEIRS.slice(0, 1), mine: MINE.slice(0, 2),
    preTicked: [15847, 4362628], search: SEARCH,
  });
  const chrome = fakeWorker(staged([
    { id: 4362628, name: 'Jahmyr Gibbs' },
    { id: 4430807, name: 'Puka Nacua' },
  ], [15847]));
  await runScript(page, chrome);

  eq(page.clicksOn(4362628), 0, 'a man of mine already ticked is NOT clicked — that would untick him');
  sameSet(page.store, [15847, 4362628, 4430807], 'so he is still in the trade');
  eq(page.clicksOn(4430807), 1, 'and the one that needed ticking was ticked');
  eq(page.touchedSubmit(), 0, 'still nothing near the submit controls');
  ok(/Already selected: Jahmyr Gibbs/.test(badgeText(page)), 'the badge accounts for him rather than ignoring him');
}

// ===========================================================================
// 3. A D/ST, whose row carries a team logo and therefore no player id
// ===========================================================================
{
  const page = buildPage({
    theirs: THEIRS.slice(0, 2), mine: MINE, preTicked: [15847, 4241457], search: SEARCH,
  });
  const chrome = fakeWorker(staged([{ id: 3139477, name: 'Ravens D/ST' }]));
  await runScript(page, chrome);

  ok(page.store.has(3139477), 'a D/ST is found by name, since the page holds no id for him');
  eq(page.clicksOn(3139477), 1, 'and clicked once');
  eq(page.touchedSubmit(), 0, 'and nothing else was touched');
}
{
  // The name match has to survive ESPN's punctuation.
  const page = buildPage({
    theirs: THEIRS.slice(0, 1), mine: MINE, preTicked: [], search: SEARCH,
  });
  const chrome = fakeWorker(staged([{ id: 4035687, name: 'Amon-Ra St Brown' }]));
  await runScript(page, chrome);
  ok(page.store.has(4035687), 'a full stop in a name does not lose the man');
}
{
  // Id beats name: staged with a name that matches somebody else entirely.
  const page = buildPage({
    theirs: THEIRS.slice(0, 1), mine: MINE, preTicked: [], search: SEARCH,
  });
  const chrome = fakeWorker(staged([{ id: 4362628, name: 'Puka Nacua' }]));
  await runScript(page, chrome);
  ok(page.store.has(4362628), 'the ESPN id wins over a stale name');
  ok(!page.store.has(4430807), 'so the wrong man is not dragged in');
}

// ===========================================================================
// 4. Two men with the same name: refuse rather than guess
// ===========================================================================
{
  const twins = [
    { id: 111, name: 'Mike Williams', pos: 'WR', logo: true },
    { id: 222, name: 'Mike Williams', pos: 'WR', logo: true },
  ];
  const page = buildPage({ theirs: THEIRS.slice(0, 1), mine: twins, preTicked: [], search: SEARCH });
  const chrome = fakeWorker(staged([{ id: 333, name: 'Mike Williams' }]));
  await runScript(page, chrome);

  eq(page.store.size, 0, 'two men of one name, neither is ticked — a guess here ships the wrong trade');
  eq(page.touchedSubmit(), 0, 'and nothing was submitted');
  ok(/did not look as expected/.test(badgeText(page)), 'and the badge says so');
}

// ===========================================================================
// 5. The safety stop: a staged man who turns up on THEIR roster
// ===========================================================================
{
  // Modelling a hand-edited link, or a changed ESPN layout: the man the site
  // staged as ours is rendered in the counterparty's panel. Ticking him there
  // would add one of THEIR players to what we receive.
  const page = buildPage({
    theirs: [...THEIRS, { id: 4362628, name: 'Jahmyr Gibbs', pos: 'RB' }],
    mine: MINE.slice(1, 2),
    preTicked: [15847, 4241457],
    search: SEARCH,
  });
  const chrome = fakeWorker(staged([{ id: 4362628, name: 'Jahmyr Gibbs' }]));
  await runScript(page, chrome);

  ok(!page.store.has(4362628), 'a man of mine found in their panel is NOT ticked');
  eq(page.clicksOn(4362628), 0, 'not clicked at all');
  sameSet(page.store, [15847, 4241457], 'the trade is exactly what the URL made it');
  eq(page.touchedSubmit(), 0, 'and nothing was submitted');
  ok(/did not look as expected/.test(badgeText(page)), 'and the badge refuses out loud');
}

// ===========================================================================
// 6. Nothing staged — the commonest case by far
// ===========================================================================
{
  const page = buildPage({
    theirs: THEIRS, mine: MINE, preTicked: [15847], search: SEARCH,
  });
  const chrome = fakeWorker({ ok: true, data: null });
  const out = await runScript(page, chrome);

  eq(out.ran, false, 'the script stands down');
  eq(page.events.length, 0, 'NOT ONE EVENT was dispatched anywhere on the page');
  sameSet(page.store, [15847], 'the page is exactly as the URL left it');
  eq(badgeText(page), null, 'and no badge clutters a page nobody staged a trade for');
}

// ===========================================================================
// 7. The extension is not there / the worker is dead
// ===========================================================================
{
  const page = buildPage({ theirs: THEIRS, mine: MINE, preTicked: [15847], search: SEARCH });
  const chrome = {
    runtime: {
      lastError: { message: 'Could not establish connection.' },
      sendMessage: (msg, cb) => setTimeout(() => cb(undefined), 0),
    },
  };
  const out = await runScript(page, chrome);
  eq(out.ran, false, 'a dead worker is not fatal');
  eq(page.events.length, 0, 'and nothing on ESPN’s page was touched');
  eq(badgeText(page), null, 'and nothing was drawn');
}
{
  const page = buildPage({ theirs: THEIRS, mine: MINE, preTicked: [15847], search: SEARCH });
  const chrome = { runtime: { sendMessage: () => { throw new Error('Extension context invalidated.'); } } };
  const out = await runScript(page, chrome);
  eq(out.ran, false, 'sendMessage throwing outright is not fatal either');
  eq(page.events.length, 0, 'and still nothing was touched');
}

// ===========================================================================
// 8. Not the trade page
// ===========================================================================
{
  const page = buildPage({ theirs: THEIRS, mine: MINE, preTicked: [], search: SEARCH });
  page.window.location.pathname = '/football/team';       // the SPA routed away
  const chrome = fakeWorker(staged([{ id: 4362628, name: 'Jahmyr Gibbs' }]));
  const out = await runScript(page, chrome);

  eq(out.ran, false, 'off the trade page the script does nothing');
  eq(chrome.asked.length, 0, 'and does not even claim the staged trade — it is still there for the right tab');
  eq(page.events.length, 0, 'and touches nothing');
}

// ===========================================================================
// 9. React does not register the click
// ===========================================================================
//
// The scenario that decides whether this feature is honest. With the handler
// gone, a click reaches the input and the store does not change. The script
// must NOT paper over that by writing aria-checked itself — a box that looks
// ticked and is not would send a trade missing half of it.
{
  const page = buildPage({
    theirs: THEIRS.slice(0, 1), mine: MINE.slice(0, 2),
    preTicked: [15847], deadReact: true, search: SEARCH,
  });
  const chrome = fakeWorker(staged([
    { id: 4362628, name: 'Jahmyr Gibbs' },
    { id: 4430807, name: 'Puka Nacua' },
  ], [15847]));
  await runScript(page, chrome);

  sameSet(page.store, [15847], 'the store is untouched, because only ESPN can change it');
  const spans = [...page.document.querySelectorAll('[role="checkbox"]')];
  const faked = spans.filter((s) => s.getAttribute('aria-checked') === 'true').length;
  eq(faked, 1, 'and exactly one box reads ticked — THEIRS. The script wrote no attribute of its own');
  eq(page.clicksOn(4362628), 1, 'it did click, once, through the real event path');
  eq(page.clicksOn(4430807), 1, 'and once for the other');
  eq(page.touchedSubmit(), 0, 'and submitted nothing');

  const t = badgeText(page);
  ok(/ticked 0/.test(t) || /ticked nothing/.test(t), 'the badge admits it ticked nothing', t);
  ok(/Jahmyr Gibbs/.test(t) && /Puka Nacua/.test(t), 'and names both men so the trade is checked by hand', t);
  ok(/did not record the selection/.test(t), 'and says ESPN refused the selection, not that the men are missing', t);
  ok(!/NOT on the roster shown/.test(t), 'which is a different failure and must not be confused with this one', t);
  ok(/Tick them yourself/.test(t), 'and says what to do about it', t);
}

// ===========================================================================
// 10. The click lands on the node React put onChange on
// ===========================================================================
//
// ESPN's Checkbox puts `checked` and `onChange` on the INPUT
// (main.js: i.className = "form__control form__control--checkbox"; i.type = "checkbox")
// while aria-checked sits on the wrapping span. React derives onChange for a
// checkbox from the click event, so the input is the node that has to be
// clicked. Anything else repaints and proposes nothing.
{
  const page = buildPage({
    theirs: THEIRS.slice(0, 1), mine: MINE.slice(0, 1), preTicked: [15847], search: SEARCH,
  });
  const chrome = fakeWorker(staged([{ id: 4362628, name: 'Jahmyr Gibbs' }], [15847]));
  await runScript(page, chrome);

  const clicks = page.events.filter((e) => e.type === 'click');
  eq(clicks.length, 1, 'exactly one click in the whole run');
  const hit = clicks[0] ? clicks[0].target : null;
  eq(hit && hit.tagName, 'INPUT', 'and it landed on the input, not the span or the label');
  ok(hit && String(hit.className).includes('form__control--checkbox'), 'the ESPN checkbox input specifically');
  const others = page.events.filter((e) => e.type !== 'click');
  eq(others.length, 0, 'and no other kind of event was dispatched anywhere');
}

// ===========================================================================
// 11. Nothing of mine staged / an empty side
// ===========================================================================
{
  const page = buildPage({ theirs: THEIRS, mine: MINE, preTicked: [15847], search: SEARCH });
  const chrome = fakeWorker(staged([]));
  const out = await runScript(page, chrome);
  eq(out.ran, false, 'an empty side of my own is a no-op');
  eq(page.events.length, 0, 'and touches nothing');
}

// ===========================================================================
// 12. ESPN rebuilds the table out of divs
// ===========================================================================
//
// Not hypothetical: ESPN's fantasy tables have been a <table> and have been a
// stack of divs, and the class names have changed under both. Without a row we
// cannot tell who a checkbox belongs to, and an unidentified checkbox is one
// that must never be clicked — so the fallback matters, and so does the fact
// that it stops at the panel rather than swallowing the whole roster.
{
  const page = buildPage({
    theirs: THEIRS.slice(0, 2), mine: MINE.slice(0, 2),
    preTicked: [15847, 4241457], divRows: true, search: SEARCH,
  });
  const chrome = fakeWorker(staged([{ id: 4362628, name: 'Jahmyr Gibbs' }]));
  await runScript(page, chrome);

  sameSet(page.store, [15847, 4241457, 4362628], 'a div-built roster is still read correctly');
  eq(page.clicksOn(4362628), 1, 'the right man, once');
  eq(page.clicksOn(4430807), 0, 'and nobody else on my side');
  eq(page.clicksOn(15847), 0, 'and nothing of theirs was disturbed');
  eq(page.touchedSubmit(), 0, 'and nothing was submitted');
}

// ===========================================================================
// 13. The rosters arrive late
// ===========================================================================
//
// The real case, every time. ESPN's trade page is server-rendered as a shell
// and the two rosters land after a fetch, so at document_idle there is nothing
// to tick. A script that looked once and gave up would work in this suite and
// do nothing at all in Edge.
{
  const page = buildPage({
    theirs: THEIRS.slice(0, 2), mine: MINE.slice(0, 2),
    preTicked: [15847, 4241457], search: SEARCH,
  });

  // Take the rosters away, exactly as an unrendered page has them, and put
  // them back after the script has already started looking.
  const panels = [...page.document.querySelectorAll('.trade-container-wrapper')];
  const parent = panels[0].parentNode;
  const after = panels[0].nextSibling;
  panels.forEach((p) => p.remove());
  eq(page.document.querySelectorAll('.roster-action-checkbox').length, 0, 'the page starts with no rosters at all');

  const chrome = fakeWorker(staged([{ id: 4362628, name: 'Jahmyr Gibbs' }]));
  const running = runScript(page, chrome);
  setTimeout(() => panels.forEach((p) => parent.insertBefore(p, after)), 350);
  const out = await running;

  eq(out.ran, true, 'the script waited for the rosters instead of giving up');
  sameSet(page.store, [15847, 4241457, 4362628], 'and ticked once they arrived');
  eq(page.clicksOn(4362628), 1, 'once');
  eq(page.touchedSubmit(), 0, 'and submitted nothing');
}

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
