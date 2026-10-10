// The main menu (leagues.html). Tim, 2026-10-10: "a main menu that is outside
// all of our current sections where the user can add different leagues to
// their account as well as look into past leagues".
//
// This file only DRAWS. What a league is, where the list is kept, what opening
// one does to this browser's storage and how ESPN is asked about an id all
// live in js/leagues.js; the page calls it and shows what comes back.
//
//   list      each league: its name, team count, "You are", and its seasons as
//             buttons (current first). A season button opens that league and
//             season and goes there — a full navigation, because every page
//             reads ONE league through module globals (docs/main-menu-plan.md).
//   add       an ESPN league id, or a pasted ESPN link with `leagueId=` in it.
//   remove    takes a league off the list after a confirm step drawn in the
//             row. The data layer keeps what was saved; the row says so.
//
// NOTHING MOVES ON A TAP. The confirm step shares its grid cell with the
// season buttons and both always take their room (one is `visibility: hidden`),
// so asking for it changes no size anywhere; the one-line message under the
// Add field keeps its height when it is empty. League and team names come from
// ESPN and are written with textContent only.

//
//   account   the connection bar's own "Sign in with Google", in the header's
//             corner. Signed in, the list is this device's leagues AND the
//             account's: ONE read of the account's list when the page loads,
//             and ONE write whenever the two together are not what the account
//             holds (js/leagues.js `mergeAccount` decides; js/cloud.js stores).
//             Signed out, the page is the device's list alone, as it always was.

import * as leagues from './leagues.js';
import * as cloud from './cloud.js';

const $ = (id) => document.getElementById(id);

const listEl = $('lgList');
const emptyEl = $('lgEmpty');
const form = $('lgAdd');
const input = $('lgId');
const addBtn = $('lgAddBtn');
const msgEl = $('lgMsg');

let busy = false;          // a lookup is in the air
let confirming = null;     // the league id whose Remove is being confirmed
let redraw = false;        // the account's list arrived while a choice was half made

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.setAttribute('class', cls);
  if (text != null) node.textContent = text;
  return node;
}

function say(text, bad = false) {
  msgEl.textContent = text || '';
  msgEl.setAttribute('class', bad ? 'lg-msg bad' : 'lg-msg');
}

/** A reason, whatever was thrown or handed back. */
const reasonOf = (r, fallback) => (r && typeof r.reason === 'string' && r.reason) || fallback;

function readList() {
  try { return leagues.list() || []; } catch { return []; }
}
function readCurrent() {
  try { return leagues.current(); } catch { return null; }
}

/**
 * The team to print after "You are": the one for the season this league is
 * open on, else the season it was last opened on, else the newest season a
 * team is known for. Null when none is known.
 */
function youAre(league, cur) {
  const teams = league.teams || {};
  const order = [
    cur && String(cur.leagueId) === String(league.leagueId) ? cur.season : null,
    league.lastOpened ? league.lastOpened.season : null,
    ...(league.seasons || []),
  ];
  for (const season of order) {
    const team = season == null ? null : teams[season];
    if (team && team.name) return team.name;
  }
  return null;
}

function row(league, cur) {
  const id = String(league.leagueId);
  const li = el('li', confirming === id ? 'lg-row confirming' : 'lg-row');
  li.setAttribute('data-league', id);

  const who = el('div', 'lg-who');
  who.appendChild(el('span', 'lg-name', league.name || `League ${id}`));
  const n = Number(league.teamCount);
  const bits = [];
  if (n > 0) bits.push(`${n} ${n === 1 ? 'team' : 'teams'}`);
  const team = youAre(league, cur);
  if (team) bits.push(`You are ${team}`);
  who.appendChild(el('span', 'lg-meta', bits.join(' · ')));
  li.appendChild(who);

  const seasons = el('div', 'lg-seasons');
  seasons.setAttribute('role', 'group');
  seasons.setAttribute('aria-label', `${league.name || 'League'} seasons`);
  for (const season of league.seasons || []) {
    const open = Boolean(cur) && String(cur.leagueId) === id && Number(cur.season) === Number(season);
    const b = el('button', open ? 'lg-season on' : 'lg-season', String(season));
    b.setAttribute('type', 'button');
    b.setAttribute('data-season', String(season));
    if (open) b.setAttribute('aria-current', 'true');
    seasons.appendChild(b);
  }
  li.appendChild(seasons);

  const remove = el('button', 'lg-remove', 'Remove');
  remove.setAttribute('type', 'button');
  remove.setAttribute('aria-label', `Remove ${league.name || `league ${id}`}`);
  li.appendChild(remove);

  const confirm = el('div', 'lg-confirm');
  if (confirming !== id) confirm.setAttribute('aria-hidden', 'true');
  confirm.appendChild(el('span', 'lg-keep', 'Saved data stays.'));
  const yes = el('button', 'lg-yes', 'Remove');
  yes.setAttribute('type', 'button');
  const no = el('button', 'lg-no', 'Cancel');
  no.setAttribute('type', 'button');
  confirm.appendChild(yes);
  confirm.appendChild(no);
  li.appendChild(confirm);

  return li;
}

function render() {
  const rows = readList();
  const cur = readCurrent();
  if (confirming && !rows.some((l) => String(l.leagueId) === confirming)) confirming = null;
  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
  for (const league of rows) listEl.appendChild(row(league, cur));
  listEl.hidden = rows.length === 0;
  emptyEl.hidden = rows.length > 0;
}

// ------------------------------------------------------------ the confirm step

function rowOf(id) {
  return [...listEl.children].find((li) => li.getAttribute('data-league') === id) || null;
}

/** Show one league's confirm step (or none): classes only, so nothing moves. */
function setConfirming(id, focus = true) {
  const was = confirming;
  confirming = id;
  for (const li of listEl.children) {
    const on = li.getAttribute('data-league') === id;
    li.setAttribute('class', on ? 'lg-row confirming' : 'lg-row');
    const box = li.querySelector('.lg-confirm');
    if (on) box.removeAttribute('aria-hidden'); else box.setAttribute('aria-hidden', 'true');
  }
  if (!focus) return;
  // The keyboard goes where the choice is: to Cancel when the step opens, and
  // back to the row's Remove when it shuts.
  const target = id ? rowOf(id) && rowOf(id).querySelector('.lg-no')
    : was && rowOf(was) && rowOf(was).querySelector('.lg-remove');
  if (target && typeof target.focus === 'function') target.focus();
}

// ------------------------------------------------------------------- the list

function openSeason(id, season) {
  let r;
  try { r = leagues.open(id, season); } catch (err) { r = { ok: false, reason: err && err.message }; }
  if (r && r.ok && r.href) { location.assign(r.href); return; }
  say(reasonOf(r, 'Could not open that season.'), true);
}

function removeLeague(id) {
  try {
    leagues.remove(id);
  } catch (err) {
    say((err && err.message) || 'Could not remove it.', true);
  }
  confirming = null;
  render();
  pushAccount();
}

listEl.addEventListener('click', (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
  const li = btn && btn.closest('li[data-league]');
  if (!li) return;
  const id = li.getAttribute('data-league');
  const cls = btn.getAttribute('class') || '';
  if (/\blg-season\b/.test(cls)) openSeason(id, Number(btn.getAttribute('data-season')));
  else if (/\blg-remove\b/.test(cls)) setConfirming(id);
  else if (/\blg-no\b/.test(cls)) { setConfirming(null); if (redraw) drawMerged(); }
  else if (/\blg-yes\b/.test(cls)) removeLeague(id);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && confirming) { setConfirming(null); if (redraw) drawMerged(); }
});

// -------------------------------------------------------------- add a league

/** '123456', or an ESPN address with `leagueId=123456` in it. Null otherwise. */
function parseLeagueId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const inLink = s.match(/[?&#]leagueId=(\d{1,12})(?!\d)/i);
  if (inLink) return inLink[1];
  return /^\d{1,12}$/.test(s) ? s : null;
}

async function addLeague() {
  if (busy) return;
  const id = parseLeagueId(input.value);
  if (!id) { say('Enter a league ID or ESPN link.', true); return; }
  if (readList().some((l) => String(l.leagueId) === id)) { say('Already in your list.'); return; }

  busy = true;
  addBtn.disabled = true;
  say('Looking it up…');
  let r;
  try { r = await leagues.lookup(id); } catch (err) { r = { ok: false, reason: err && err.message }; }
  busy = false;
  addBtn.disabled = false;
  if (redraw) drawMerged();

  if (!r || !r.ok) { say(reasonOf(r, 'Could not find that league.'), true); return; }
  try {
    const seasons = r.seasons || [];
    leagues.add({
      leagueId: String(r.leagueId || id),
      name: r.name,
      teamCount: r.teamCount,
      seasons,
      season: seasons[0],
      // Which team is yours is chosen inside the league ("You are", in its
      // connection bar), not here.
      team: undefined,
    });
  } catch (err) {
    say((err && err.message) || 'Could not save it.', true);
    return;
  }
  input.value = '';
  say('');
  render();
  pushAccount();
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  addLeague();
});

// Another tab (or the page come back to with the browser's Back button) may
// have opened a different league since this was drawn. Not while a choice is
// half made.
function refresh() {
  if (!busy && !confirming) render();
}
window.addEventListener('pageshow', refresh);
window.addEventListener('focus', refresh);

// A league that came in through the connection bar is known for one season
// only. Its earlier seasons are asked for once, here, quietly: a failure (or
// the phone's synced copy, which asks ESPN nothing) leaves the row as it is.
async function fillSeasons() {
  let filled = false;
  for (const l of readList()) {
    if ((l.seasons || []).length > 1) continue;
    let r = null;
    try { r = await leagues.lookup(String(l.leagueId)); } catch { r = null; }
    if (!r || !r.ok || !(r.seasons || []).length) continue;
    try {
      leagues.add({ leagueId: String(l.leagueId), name: r.name, teamCount: r.teamCount, seasons: r.seasons });
    } catch { continue; }
    filled = true;
    refresh();
  }
  if (filled) pushAccount();
}

// ---------------------------------------------------------------- the account
//
// `cloud.signIn` opens a pop-up, so it is wired to a real click and nothing
// else (js/connection.js `signIn` says why). Everything here is quiet: an
// account that cannot be read or written leaves the device's own list on
// screen, exactly as it is signed out.

const acctEl = $('lgAccount');
const cloudOn = () => {
  try { return typeof cloud.isConfigured === 'function' && cloud.isConfigured(); } catch { return false; }
};

let user = null;          // {uid, email, name} | null
let known = false;        // has sign-in answered at all yet?
let readFor = null;       // the uid whose list this page load has read
let held;                 // the account's list as last read or written; undefined until read
let turn = Promise.resolve();   // one read or write at a time, in order

function drawAccount() {
  if (!acctEl) return;
  while (acctEl.firstChild) acctEl.removeChild(acctEl.firstChild);
  // Nothing until sign-in has answered once: a control that flashed "Sign in"
  // and then became an address on every load would be worse than a beat of
  // nothing. The room is kept either way.
  if (!cloudOn() || !known) return;
  if (!user) {
    const b = el('button', null, 'Sign in with Google');
    b.setAttribute('type', 'button');
    b.setAttribute('id', 'lgSignIn');
    acctEl.appendChild(b);
    return;
  }
  const who = user.email || user.name || 'signed in';
  acctEl.appendChild(el('span', 'lg-signed', `Signed in as ${who}.`));
  const out = el('button', null, 'Sign out');
  out.setAttribute('type', 'button');
  out.setAttribute('id', 'lgSignOut');
  acctEl.appendChild(out);
}

/** The merge changed this device's list: draw it, unless a choice is half made. */
function drawMerged() {
  if (busy || confirming) { redraw = true; return; }
  redraw = false;
  render();
}

/**
 * Bring the device's list and the account's together, and save the account's
 * if it is not what the two make. No read: `held` is what the account holds.
 */
function pushAccount() {
  turn = turn.then(async () => {
    if (!user || held === undefined || typeof leagues.mergeAccount !== 'function') return;
    let m;
    try { m = leagues.mergeAccount(held); } catch { return; }
    if (!m || !m.ok) return;
    if (m.local) drawMerged();
    if (!m.changed) return;
    let res = null;
    try { res = await cloud.saveLeagueList(m.list); } catch { res = null; }
    if (res && res.ok) held = m.list;
  }).catch(() => {});
  return turn;
}

/** The one read of the account's list, once per account per page load. */
function readAccount() {
  if (!user || readFor === user.uid || typeof leagues.mergeAccount !== 'function') return turn;
  const uid = user.uid;
  readFor = uid;
  held = undefined;
  turn = turn.then(async () => {
    let res = null;
    try { res = await cloud.loadLeagueList(); } catch { res = null; }
    // Could not be read: nothing is merged and nothing is written over it.
    if (!res || !res.ok || !user || user.uid !== uid) return;
    held = res.found ? res.list : null;
  }).catch(() => {});
  return pushAccount();
}

function setUser(next) {
  user = next || null;
  known = true;
  if (!user) { readFor = null; held = undefined; }
  drawAccount();
  if (user) readAccount();
}

if (acctEl) {
  acctEl.addEventListener('click', async (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!btn) return;
    const id = btn.getAttribute('id');
    if (id === 'lgSignIn') {
      let res = null;
      try { res = await cloud.signIn(); } catch { res = null; }
      if (res && res.ok) { say(''); setUser(res.user); }
      else say(reasonOf(res, 'Sign-in did not complete.'), true);
    } else if (id === 'lgSignOut') {
      try { await cloud.signOut(); } catch { /* signed out as far as this page goes */ }
      setUser(null);
    }
  });
}

render();
drawAccount();
fillSeasons();
if (cloudOn() && typeof cloud.onAuth === 'function') {
  try { cloud.onAuth(setUser); } catch { /* no account: the device's list alone */ }
}
