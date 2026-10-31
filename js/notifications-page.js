// NOTIFICATIONS — the page (notifications.html).
//
// Tim, 2026-10-11: "a notifications section which basically helps the user with
// basic instrucitons or important issues or upcoming decisions … for the easy
// ones like the weekly lineup, make it so you just have to click a button to
// automatically change it for your team, or bring you to the specific player on
// the waivers, or the trade notification on the cite."
//
// ONE LIST, most urgent first, under three short headings; each line is a few
// words and ONE button, with the SUGGESTED ACTION on its own line underneath
// (Tim, 2026-10-11: "could you also show a suggested action underneath it. For
// example, "drop ____, add ___ for 1 week" or whatever") — `note.suggest`,
// absent when the engine has nothing to name.
// What the lines are is js/notify.js (pure) and where
// their numbers come from is js/notify-load.js; this file only draws them and
// works the lineup button.
//
// THE LINEUP BUTTON. With the bridge extension allowed to set a lineup
// (`bridge.canSetLineup()`, off by default in the extension's popup) the button
// changes it on ESPN in one click, then THE ROSTER IS READ AGAIN and the line
// goes only when ESPN shows the change. Everywhere else — a phone, the switch
// off, any failure — the button is a plain link to ESPN's own lineup screen.
//
// AUTO-SET BEST LINEUP (Tim, 2026-10-31: "fix all future ESPN lineups"). A
// switch in the panel (`ff.prefs` → `notify.autoLineup`, per league), off by
// default, working only where `bridge.canSetLineup()` says yes; elsewhere it is
// drawn disabled with a few words why. The setting itself happens on every page
// load (js/connection.js → js/auto-lineup.js); this page draws the switch and,
// at the top of "This week", what the auto-set last did this week.
//
// A line disappears when its cause does: no read mark. An offer of yours that
// ended (2026-10-22) has two buttons instead of one: Follow up (saved as a
// trade, opened in the Trade page's builder) and Dismiss; either is remembered.

import * as bridge from './bridge.js';
import { onConnection, savedConfig, autoLineupNow } from './connection.js';
import { load, forgetEnded } from './notify-load.js';
import { LEVELS } from './notify.js';
import { scope } from './prefs.js';
import { memoryKey, noteFor } from './auto-lineup.js';
import { espnLineupHref } from './links.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The headings, in the list's order. */
const HEADINGS = { now: 'This week', pending: 'Pending', soon: 'Coming weeks', idea: 'Ideas' };

/** The one sentence of a state with no list. (The sample league says so in its badge.) */
const SENTENCES = {
  past: 'An earlier season: it is finished, so there is nothing to do.',
  over: 'This season is over, so there is nothing to do.',
  noteam: 'Choose your team under “You are” in the bar above.',
};

const view = {
  /** What js/notify-load.js last handed over. */
  state: null,
  /** May the extension set a lineup? Asked once; false until it says yes. */
  canWrite: false,
  /** The line whose lineup is being changed right now (its id), or null. */
  working: null,
  /** Lines whose change did not go through: they fall back to the link. */
  failed: new Set(),
  /** `leagueId|season|teamId` of the run on screen, so the bar's hello does not start a second one. */
  key: null,
  /** Lines dismissed or followed up on this visit (their ids). */
  gone: new Set(),
};

const outside = (href) => /^https?:/i.test(String(href || ''));

function buttonHtml(note) {
  const a = note.action || {};
  // An offer of yours that ended (2026-10-22): Follow up and Dismiss, one above the other.
  if (note.dismiss) {
    return `<span class="nt-acts">` +
      `<a class="nt-go" href="${esc(a.href || 'trade.html')}" data-follow="${esc(note.id)}">${esc(a.label || 'Follow up')}</a>` +
      `<button type="button" class="nt-go nt-dismiss" data-dismiss="${esc(note.id)}">Dismiss</button></span>`;
  }
  const lineup = a.lineup && view.canWrite && !view.failed.has(note.id) ? a.lineup : null;
  if (lineup) {
    const busy = view.working === note.id;
    return `<button type="button" class="nt-go primary" data-lineup="${esc(note.id)}"` +
      `${view.working ? ' disabled' : ''}>${busy ? 'Changing…' : esc(lineup.label || 'Change it')}</button>`;
  }
  if (!a.href) return '';
  const out = outside(a.href) ? ' target="_blank" rel="noopener"' : '';
  return `<a class="nt-go" href="${esc(a.href)}"${out}>${esc(a.label)}</a>`;
}

function rowHtml(note) {
  const failed = view.failed.has(note.id);
  return `<div class="nt-row nt-${esc(note.level)}" data-note="${esc(note.id)}" data-kind="${esc(note.kind)}">
    <span class="nt-title">${esc(note.title)}</span>
    <span class="nt-detail${failed ? ' nt-bad' : ''}">${esc(failed ? 'Could not change it' : note.detail)}</span>
    ${note.suggest ? `<span class="nt-suggest">${esc(note.suggest)}</span>` : ''}
    ${buttonHtml(note)}
  </div>`;
}

function draw() {
  const s = view.state;
  const badge = $('modeBadge');
  const say = $('ntSay');
  const list = $('ntList');
  if (!s) return;

  const live = !s.isDemo;
  badge.className = 'badge ' + (live ? 'live' : 'demo');
  badge.textContent = live ? 'Live' : 'Demo';

  const sentence = s.status === 'error'
    ? `${s.error || 'The league could not be read.'}`
    : SENTENCES[s.status] || '';
  say.textContent = sentence;
  say.hidden = !sentence;
  say.classList.toggle('nt-bad', s.status === 'error');

  const notes = s.notes || [];
  let html = '';
  // A list of your team's (live or the sample league) always shows Pending,
  // even empty, so it can be seen that it was checked (Tim, 2026-10-22: "also
  // in the notifications setting show pending trades aswell").
  const listed = s.status === 'live' || s.status === 'demo';
  const auto = autoNote(s);
  for (const level of LEVELS) {
    const mine = notes.filter((n) => n.level === level);
    // What the auto-set did this week heads "This week".
    if (level === 'now' && auto) mine.unshift(auto);
    if (!mine.length && level === 'pending' && listed) {
      html += `<div class="nt-group" data-level="pending">${HEADINGS.pending}</div>` +
        '<div class="nt-row nt-wait nt-none" data-empty="pending">No pending trades or claims right now.</div>';
      continue;
    }
    if (!mine.length) continue;
    html += `<div class="nt-group" data-level="${level}">${HEADINGS[level]}</div>` + mine.map(rowHtml).join('');
  }
  // The coming weeks and the wire arrive after the first lines.
  if (s.pending) html += '<div class="nt-row nt-wait">Still checking…</div>';
  list.innerHTML = html;
  list.hidden = !html;
  list.setAttribute('data-state', s.pending ? 'pending' : 'done');
}

const keyOf = (c) => (c ? `${c.leagueId}|${c.season}|${c.teamId ?? ''}` : 'demo');

// ------------------------------------------------------- auto-set best lineup

const notifyPrefs = scope('notify');
const autoOn = () => notifyPrefs.get('autoLineup', false) === true;

/** The auto-set's line for the week on screen (your league only, switch on), or null. */
function autoNote(s) {
  if (!s || s.status !== 'live' || !s.league || s.week === null || s.week === undefined) return null;
  if (!autoOn() || s.teamId === null || s.teamId === undefined) return null;
  let memory = null;
  try {
    memory = JSON.parse(localStorage.getItem(memoryKey(s.league.leagueId, s.league.season, s.teamId)) || 'null');
  } catch { memory = null; }
  const href = espnLineupHref({ ...s.league, teamId: s.teamId, week: s.week });
  return noteFor(memory, { week: s.week, href });
}

/**
 * The switch: what is saved, and whether it can work here. The few words say
 * why not — a phone (no extension), the extension's own lineup switch off, or
 * no league connected.
 */
function drawSwitch(can, present = true) {
  const input = $('ntAutoLineup');
  const why = $('ntAutoWhy');
  if (!input || !why) return;
  input.checked = autoOn();
  const reason = can === null ? ''
    : can === true ? (!savedConfig() ? 'Connect your league first' : '')
      : !present ? 'Laptop with the extension only'
        : 'Turn on the lineup switch in the extension';
  input.disabled = can !== true || Boolean(reason);
  why.textContent = reason;
  why.hidden = !reason;
}

$('ntAutoLineup')?.addEventListener('change', (e) => {
  const on = e.target.checked === true;
  notifyPrefs.set('autoLineup', on);
  draw();
  if (on) autoLineupNow().catch(() => {});
});

// The auto-set ran (this page load, or the switch just turned on): draw its line.
document.addEventListener('ff:autolineup', () => draw());

function show(state) {
  // A line dismissed or followed up while a run was still in the air stays gone.
  view.state = state && view.gone.size
    ? { ...state, notes: (state.notes || []).filter((n) => !view.gone.has(n.id)) }
    : state;
  draw();
}

function run({ fresh = false } = {}) {
  return load({ onUpdate: show, fresh }).then((state) => {
    show(state);
    return state;
  });
}

/** One click: change it on ESPN, read the roster again, and believe only that. */
async function changeLineup(id) {
  const s = view.state;
  const note = s && (s.notes || []).find((n) => n.id === id);
  const lineup = note && note.action && note.action.lineup;
  if (!lineup || !s.league || view.working) return;
  view.working = id;
  draw();
  let ok = false;
  try {
    const res = await bridge.setLineup({
      leagueId: s.league.leagueId, season: s.league.season,
      week: lineup.week, teamId: lineup.teamId, moves: lineup.moves,
    });
    ok = Boolean(res && res.ok);
  } catch {
    ok = false;
  }
  let after = null;
  if (ok) {
    try { after = await run({ fresh: true }); } catch { after = null; }
  }
  view.working = null;
  // Still listed after the re-read (or never sent): ESPN does not show the
  // change, so the line stays and its button becomes the link.
  const gone = after && after.status === 'live' && !(after.notes || []).some((n) => n.id === id);
  if (!gone) view.failed.add(id);
  draw();
}

/**
 * FOLLOW UP an offer of yours that ended: keep the deal as a saved trade on the
 * Trade page (`ff.prefs` → `trade.custom`, the entry its Save button writes),
 * then open it there in the builder (the link's with/get/send), and the line
 * goes for good. The same deal already saved is not saved twice.
 */
export function saveFollowUp(f) {
  if (!f || !Number.isFinite(f.a) || !Number.isFinite(f.b) || f.a === f.b) return false;
  const sendA = (f.sendA || []).map(String);
  const sendB = (f.sendB || []).map(String);
  if (!sendA.length && !sendB.length) return false;
  const p = scope('trade');
  const list = Array.isArray(p.get('custom', [])) ? p.get('custom', []).slice() : [];
  const key = (e) => `${e.a}|${e.b}|${[...(e.sendA || [])].map(String).sort()}|${[...(e.sendB || [])].map(String).sort()}`;
  const entry = { a: f.a, b: f.b, sendA, sendB };
  if (!list.some((e) => e && key(e) === key(entry))) {
    list.push(entry);
    p.set('custom', list);
  }
  return true;
}

function noteById(id) {
  const s = view.state;
  return s ? (s.notes || []).find((n) => n.id === id) || null : null;
}

/** Off the list on screen at once (it is remembered by `forgetEnded`). */
function dropNote(id) {
  view.gone.add(id);
  if (!view.state) return;
  view.state = { ...view.state, notes: (view.state.notes || []).filter((n) => n.id !== id) };
  draw();
}

$('ntList').addEventListener('click', (e) => {
  const at = (sel) => (e.target && e.target.closest ? e.target.closest(sel) : null);
  const btn = at('[data-lineup]');
  if (btn) { changeLineup(btn.getAttribute('data-lineup')); return; }
  const dismiss = at('[data-dismiss]');
  if (dismiss) {
    const note = noteById(dismiss.getAttribute('data-dismiss'));
    if (!note) return;
    dropNote(note.id);
    forgetEnded(note.dismiss).catch(() => {});
    return;
  }
  const follow = at('[data-follow]');
  if (follow) {
    const note = noteById(follow.getAttribute('data-follow'));
    if (!note) return;
    e.preventDefault();
    const href = follow.getAttribute('href') || 'trade.html';
    try { saveFollowUp(note.action && note.action.followUp); } catch { /* the link still opens it */ }
    dropNote(note.id);
    forgetEnded(note.dismiss).catch(() => false).then(() => { window.location.assign(href); });
  }
});

// The bar's league, your team, or the season changed: work it out again. What
// is saved is what the bar is about to announce, so its first hello repeats
// what the page already read, and starts nothing.
view.key = keyOf(savedConfig());
onConnection((conn) => {
  const key = keyOf(conn);
  if (key === view.key) return;
  view.key = key;
  view.failed.clear();
  run();
});

// Sync now, or a roster move js/season.js noticed.
document.addEventListener('ff:refresh', (e) => {
  const job = run({ fresh: false });
  if (e.detail && typeof e.detail.waitUntil === 'function') e.detail.waitUntil(job);
});

// May the extension set a lineup? Until it answers yes, every lineup button is
// the link to ESPN — which is also what a phone always shows.
drawSwitch(null);
if (typeof bridge.canSetLineup === 'function' && typeof bridge.setLineup === 'function') {
  Promise.resolve()
    .then(() => bridge.canSetLineup())
    .then(async (yes) => {
      if (yes !== true) {
        // Why not: no extension at all (a phone), or its lineup switch is off.
        let present = false;
        try { present = (await bridge.settled()) === true || bridge.isAvailable() === true; } catch { present = false; }
        drawSwitch(false, present);
        return;
      }
      drawSwitch(true);
      view.canWrite = true;
      draw();
    })
    .catch(() => { drawSwitch(false, false); /* no: the links stay */ });
} else {
  drawSwitch(false, false);
}

run();
