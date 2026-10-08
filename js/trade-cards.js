// THE TRADE PAGE'S PREVIEWS — what each number on it is made of.
//
// Tim, 2026-10-08: "If the user is curious about a number or it's breakdown or
// a detail about a stat or column or anything they should be able to hover over
// it and show a preview. … a bad preview is … the numbers in the week by week
// chart that talk about SD and info we don't want or need."
//
// Every function here turns numbers the Trade page ALREADY HOLDS into a card
// spec for js/pop.js (`statCard` / `wirePops`). Nothing in this file prices a
// deal, reads the DOM or looks at page state: js/trade-page.js hands the
// figures in and draws what comes back, so each card can be checked in a test
// without a browser (tests/test-trade-cards.mjs).
//
// THE RULE EVERY CARD FOLLOWS: its last line is the number in the cell it
// hangs off, AS THE CELL PRINTS IT. The page passes the printed figure in
// (`shown`, `total`), so a card can never disagree with its own cell.
//
// Also here: `zeroScale`, the red/green scale for a GAIN — anchored at zero, so
// a plus is never red (docs/colour-plan.md, Trade).

import { HEAT_EDGES } from './heat.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/** What a cell prints: `toFixed`, as the page's own `fmt` does. */
const round1 = (n) => Number(Number(n).toFixed(1));
const f1 = (n) => (finite(n) ? n.toFixed(1).replace(/^-(0(\.0+)?)$/, '$1') : '—');
/** "+3.6" / "−0.4", a real minus sign; a rounded zero prints plain. */
export function signed(n, digits = 1) {
  if (!finite(n)) return '—';
  const s = Math.abs(n).toFixed(digits);
  return (Number(s) === 0 ? '' : n > 0 ? '+' : '−') + s;
}
const signCls = (n) => (!finite(n) || Math.abs(n) < 0.05 ? '' : n > 0 ? 'pos' : 'neg');
const signedHtml = (n) => {
  const c = signCls(n);
  return c ? `<span class="${c}">${signed(n)}</span>` : signed(n);
};
const pct = (v) => (finite(v) ? `${(v * 100).toFixed(1)}%` : '—');

// ------------------------------------------------------------ the gain scale
//
// "You gain" was coloured against the OTHER OFFERS in the column, so the worst
// of forty good offers (+2.3 a week) was drawn deep red. A gain has a real
// zero, and the colour has to respect it: above zero is green, below is red,
// and how strong depends on how big the column's gains run. So the scale's
// centre is 0 and its unit is the column's root-mean-square — the typical size
// of a figure in it. Same shape as a `heatScale`, so `heatOf` reads it.

/** A zero-anchored scale over a column of gains, or null when it is all ~0. */
export function zeroScale(values) {
  const xs = (values || []).filter(finite);
  if (!xs.length) return null;
  const rms = Math.sqrt(xs.reduce((a, v) => a + v * v, 0) / xs.length);
  if (!finite(rms) || rms < 0.05) return null;
  return {
    n: xs.length, mean: 0, sd: rms, invert: false, edges: HEAT_EDGES.slice(),
    sorted: xs.slice().sort((a, b) => b - a), fmt: null, zero: true,
  };
}

// ------------------------------------------------------- a gain, week by week

/**
 * The week table behind "You gain", "He gains" and "Your lineup": the squad's
 * best lineup each week as it is now, with the trade, and the change.
 *
 * @param {Object} o
 * @param {string} o.title   'You gain' / 'Luke gains' / 'Your lineup'
 * @param {string} [o.sub]   'with Luke Gaeth'
 * @param {Array<{week, before, after, delta}>|null} o.byWeek  null on a
 *        one-number measure: the card is then now / with / change.
 * @param {Map<number, number>|null} [o.vs] week -> the OTHER squad's change in
 *        a week the two meet; it comes off this squad's change that week.
 * @param {string} [o.vsName]
 * @param {number} [o.before] [o.after]  the lineup totals, for the no-weeks card
 * @param {string} o.shown   the cell's own headline figure, as printed
 * @param {string} [o.shownLabel]  what that figure is ('Per week')
 * @param {string} [o.totalShown]  the cell's sub-figure ('+53.9'), if any
 * @param {string} [o.foot]
 */
export function gainWeeksSpec({
  title, sub = '', byWeek = null, vs = null, vsName = '', before = null, after = null,
  shown = '', shownLabel = 'Per week', totalShown = null, foot = '', href = null, hrefLabel = null,
  reach = null,
} = {}) {
  // `reach`: week -> the chance this squad is still playing that week (a
  // playoff week). His change counts that much, so the row prints it weighted
  // and the rows still add up to the cell.
  const reachAt = (w) => (reach && finite(reach.get(w.week)) ? reach.get(w.week) : 1);
  const part = (w) => reachAt(w) < 0.995;
  const anyPart = Array.isArray(byWeek) && byWeek.some(part);
  if (!Array.isArray(byWeek) || !byWeek.length) {
    return {
      title, sub,
      rows: [
        { label: 'Lineup now', value: finite(before) ? before : null },
        { label: 'With the trade', value: finite(after) ? after : null },
      ],
      total: { label: 'Change', html: esc(shown) },
      foot, href, hrefLabel,
    };
  }
  const own = (w) => (finite(w.before) && finite(w.after)
    ? round1(round1(w.after) - round1(w.before)) : w.delta);
  const netAt = (w) => !!vs && vs.has(w.week) && finite(vs.get(w.week)) && Math.abs(vs.get(w.week)) >= 0.05;
  const diff = (w) => (netAt(w) ? round1(own(w) - round1(vs.get(w.week)))
    : part(w) ? round1(own(w) * reachAt(w)) : own(w));
  const body = byWeek.map((w) =>
    `<tr><td class="num sc-lead">${esc(w.week)}${netAt(w) ? '<span class="sc-note">↑</span>' : ''}` +
    `${part(w) ? `<span class="sc-note"> ${Math.round(reachAt(w) * 100)}%</span>` : ''}</td>` +
    `<td class="num">${f1(w.before)}</td><td class="num">${f1(w.after)}</td>` +
    `<td class="num">${signedHtml(diff(w))}</td></tr>`).join('');
  const sumB = byWeek.reduce((a, w) => a + (finite(w.before) ? w.before : 0), 0);
  const sumA = byWeek.reduce((a, w) => a + (finite(w.after) ? w.after : 0), 0);
  const n = byWeek.length;
  const tableHtml =
    `<table class="sc-rows"><thead><tr><th class="num">Wk</th><th class="num">Now</th>` +
    `<th class="num">With trade</th><th class="num">+/−</th></tr></thead><tbody>${body}</tbody>` +
    `<tfoot><tr class="sc-total"><td class="name">${esc(anyPart ? 'Per week he plays' : shownLabel)}</td>` +
    `<td class="num">${anyPart ? '' : f1(sumB / n)}</td><td class="num">${anyPart ? '' : f1(sumA / n)}</td>` +
    `<td class="num">${esc(shown)}</td></tr>` +
    (totalShown === null ? '' :
      `<tr><td class="name">All ${n}</td><td class="num">${f1(sumB)}</td>` +
      `<td class="num">${f1(sumA)}</td><td class="num">${esc(totalShown)}</td></tr>`) +
    `</tfoot></table>`;
  const meet = byWeek.filter(netAt).map((w) => w.week);
  const meetFoot = meet.length
    ? `↑ week ${meet.join(', ')}: you play ${vsName || 'him'}, so his change comes off yours.`
    : '';
  const partFoot = anyPart ? '%: the chance he is still playing that week. His change counts that much.' : '';
  return { title, sub, rows: [], tableHtml, foot: [meetFoot, partFoot, foot].filter(Boolean).join(' '), href, hrefLabel };
}

// --------------------------------------------- one week, the slots that moved

/**
 * The slot lines a deal changes in one week: who was in the slot, who is in it
 * with the trade, and what that is worth.
 *
 * @param {Object} o
 * @param {string} o.title            'Week 7'
 * @param {string} [o.sub]            'Your lineup'
 * @param {Array<{slot, before:{name, v}|null, after:{name, v}|null}>} o.slots
 *        EVERY slot of the lineup; the unchanged ones are left out here.
 * @param {number} o.before o.after   the week's lineup totals
 * @param {number|null} [o.vs]        the other squad's change, when they meet
 * @param {string} [o.vsName]
 * @param {string} o.shown            the Difference cell, as printed
 */
export function slotChangeSpec({
  title, sub = '', slots = [], before = null, after = null, vs = null, vsName = '', shown = '',
  foot = '', href = null, hrefLabel = null,
} = {}) {
  // `floor`: the figure is the slot's waiver floor, not the man's own (he is on
  // a bye, or nobody fills the slot) — the lineup total counts it that way.
  // Marked with a star, and the foot says what the star is: the line has to
  // fit a phone's width with two names on it.
  const who = (e) => (e && e.name ? `${e.name} ${f1(e.v)}${e.floor ? '*' : ''}` : 'nobody');
  const rows = [];
  let sum = 0;
  let floored = false;
  for (const s of slots) {
    const b = s.before || null;
    const a = s.after || null;
    const bv = b && finite(b.v) ? round1(b.v) : null;
    const av = a && finite(a.v) ? round1(a.v) : null;
    const same = (b ? b.name : '') === (a ? a.name : '') && bv === av;
    if (same) continue;
    const d = round1((av ?? 0) - (bv ?? 0));
    sum = round1(sum + d);
    if ((b && b.floor) || (a && a.floor)) floored = true;
    rows.push({ lead: s.slot, label: `${who(b)} → ${who(a)}`, html: signedHtml(d) });
  }
  const floorFoot = floored ? '* the waiver floor: what a free agent would score in that slot.' : '';
  const totals = [];
  const own = finite(before) && finite(after) ? round1(round1(after) - round1(before)) : null;
  if (!rows.length) rows.push({ lead: '', label: 'No slot changes this week', value: '' });
  else if (own !== null && Math.abs(round1(own - sum)) >= 0.05) {
    // The slots are rounded one by one; the lineup total is not.
    // A tenth a slot at most is rounding; more than that is not, and is not called it.
    const miss = round1(own - sum);
    const small = Math.abs(miss) <= 0.1 * rows.length + 0.05;
    rows.push({ lead: '', label: small ? 'Rounding' : 'Rest of the lineup', html: signed(miss) });
  }
  if (own !== null) totals.push({ label: `Lineup ${f1(before)} → ${f1(after)}`, html: signedHtml(own) });
  if (finite(vs) && Math.abs(vs) >= 0.05) {
    totals.push({ label: `${vsName || 'His'} change (you play him)`, html: signed(vs) });
  }
  return {
    title, sub, rows, totals,
    total: { label: 'Difference', html: esc(shown) },
    foot: [floorFoot, foot].filter(Boolean).join(' '), href, hrefLabel,
  };
}

// ----------------------------------------------------------------- the goal

/**
 * The goal cell in three lines: you now → with, him now → with, and the chance
 * he says yes.
 */
export function goalSpec({ chance = 'title chance', partner = '', mine = null, theirs = null, accept = null, href = null, hrefLabel = null } = {}) {
  const line = (s) => (s && finite(s.before) && finite(s.after) ? `${pct(s.before)} → ${pct(s.after)}` : '—');
  const rows = [{ label: 'You', note: 'now → with', value: line(mine) }];
  if (theirs && finite(theirs.before)) rows.push({ label: partner || 'Him', note: 'now → with', value: line(theirs) });
  if (finite(accept)) rows.push({ label: 'Chance he says yes', value: `${Math.round(accept * 100)}%` });
  return { title: chance.charAt(0).toUpperCase() + chance.slice(1), sub: partner ? `with ${partner}` : '', rows, href, hrefLabel };
}

/** The preview column's goal: yours only, and it ranks nothing. */
export function altGoalSpec({ chance = 'chance of finishing last', partner = '', before = null, after = null, weeks = '', href = null, hrefLabel = null } = {}) {
  return {
    title: chance.charAt(0).toUpperCase() + chance.slice(1),
    sub: partner ? `with ${partner}` : '',
    rows: [{ label: 'You', note: 'now → with', value: `${pct(before)} → ${pct(after)}` }],
    foot: `The goal you are not on${weeks ? `, over ${weeks}` : ''}. It does not rank the list.`,
    href, hrefLabel,
  };
}

// ---------------------------------------------------- his lineup against you

/** "His proj vs you": his lineup in each week he plays you, now → with. */
export function oppSpec({ partner = 'He', per = [], shown = '', why = '', href = null, hrefLabel = null } = {}) {
  if (!per.length) {
    return { title: `${partner} vs you`, rows: [], foot: why, href, hrefLabel };
  }
  return {
    title: `${partner} vs you`,
    sub: 'his lineup',
    rows: per.map((p) => ({
      lead: `Wk ${p.week}`,
      label: finite(p.before) && finite(p.after) ? `${f1(p.before)} → ${f1(p.after)}` : 'now → with',
      html: signed(p.delta),
    })),
    total: per.length > 1 ? { label: 'In all', html: esc(shown) } : null,
    foot: 'Plus means he is stronger against you.',
    href, hrefLabel,
  };
}

// ------------------------------------------------------------ the depth map

/**
 * One depth-map cell: the starters with their points over the bar, the spare
 * men, and the bar itself.
 *
 * @param {Object} o
 * @param {string} o.team o.position
 * @param {number} o.bar                     the replacement level
 * @param {Array<{name, v}>} o.starters      this squad's starters at the position
 * @param {Array<{name, v}>} o.spare         startable men who are not starting
 * @param {number} [o.missing]               lineup spots nobody fills
 * @param {string} o.shown                   the cell's own figure, as printed
 */
export function depthSpec({ team = '', position = '', bar = null, barName = '', starters = [], spare = [], missing = 0, edge = null, shown = '', href = null, hrefLabel = null } = {}) {
  const gap = (v) => (finite(v) && finite(bar) ? round1(v - bar) : null);
  const over = (v) => (gap(v) === null ? '—' : signed(gap(v)));
  const rows = starters.map((s) => ({ lead: 'Starts', label: s.name, note: f1(s.v), html: over(s.v) }));
  for (let i = 0; i < missing; i += 1) rows.push({ lead: 'Starts', label: 'nobody', html: finite(bar) ? signed(-bar) : '—' });
  // The men are rounded one by one; the cell's figure is rounded once.
  if (finite(edge) && finite(bar)) {
    const sum = round1(starters.reduce((a, s) => a + (gap(s.v) ?? 0), 0) - missing * round1(bar));
    const miss = round1(edge - sum);
    if (Math.abs(miss) >= 0.05 && Math.abs(miss) <= 0.1 * (starters.length + missing) + 0.05) {
      rows.push({ lead: '', label: 'Rounding', html: signed(miss) });
    }
  }
  const totals = spare.map((s) => ({ label: `Spare: ${s.name} ${f1(s.v)}`, html: over(s.v) }));
  return {
    title: team,
    sub: `${position} over the bar`,
    rows,
    totals,
    total: { label: 'Starters over the bar', html: esc(shown) },
    foot: finite(bar) ? `Bar ${f1(bar)}${barName ? ` — ${barName}, the best ${position} not starting anywhere` : ''}.` : '',
    href, hrefLabel,
  };
}

// --------------------------------------------------------------- a manager

/** A team card: record, scoring average, this week's projection. */
export function teamSpec({ name = '', record = '', avg = null, games = 0, week = null, proj = null, href = null } = {}) {
  const rows = [];
  if (record) rows.push({ label: 'Record', value: record });
  if (finite(avg) && games > 0) rows.push({ label: 'Avg score', note: `${games} game${games === 1 ? '' : 's'}`, value: avg });
  if (finite(proj)) rows.push({ label: week === null ? 'Projected' : `Week ${week} projected`, value: proj });
  return { title: name, rows, href, hrefLabel: href ? 'Open roster' : null };
}

/** A squad's record and scoring average from the league's decided games. */
export function recordOf(games, teamId, isDecided = (g) => g.played !== false) {
  const id = String(teamId);
  let w = 0; let l = 0; let t = 0; let pts = 0; let n = 0;
  for (const g of games || []) {
    if (!isDecided(g)) continue;
    const home = String(g.homeId) === id;
    const away = String(g.awayId) === id;
    if (!home && !away) continue;
    const mine = home ? g.homeScore : g.awayScore;
    const theirs = home ? g.awayScore : g.homeScore;
    if (!finite(mine) || !finite(theirs)) continue;
    n += 1; pts += mine;
    if (mine > theirs) w += 1; else if (mine < theirs) l += 1; else t += 1;
  }
  return { w, l, t, games: n, avg: n ? pts / n : null, text: n ? `${w}–${l}${t ? `–${t}` : ''}` : '' };
}

// ---------------------------------------------------- the weeks two squads meet

/**
 * "You play him": each meeting, with the score when it has been played and
 * both projections when it has not.
 *
 * @param {Array<{week, played, mine, theirs}>} o.meetings
 */
export function meetSpec({ partner = '', meetings = [], href = null, hrefLabel = null } = {}) {
  return {
    title: `You play ${partner || 'him'}`,
    head: meetings.length ? ['Wk', 'You – him', ''] : null,
    rows: meetings.map((m) => ({
      lead: m.week,
      label: finite(m.mine) && finite(m.theirs) ? `${f1(m.mine)} – ${f1(m.theirs)}` : '—',
      value: m.played
        ? (finite(m.mine) && finite(m.theirs) ? (m.mine > m.theirs ? 'Won' : m.mine < m.theirs ? 'Lost' : 'Tied') : 'Played')
        : 'Projected',
    })),
    foot: meetings.length ? '' : 'Not in the regular season.',
    href, hrefLabel,
  };
}
