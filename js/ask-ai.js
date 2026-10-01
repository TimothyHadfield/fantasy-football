// "ASK AI" — the text a trade row copies for pasting into an AI chat.
//
// Tim, 2026-09-30: "a "ask AI" button on each trade which just allows the user
// to copy a script or text essentially and then paste it into a AI chat so that
// … the AI will also give it's evaluation on some of the things the cite might
// not know, like Injury reports, usage, professional comments, stats, etc. The
// text will give the information the AI won't necessarily know about the
// situation like the overll +/- that the cite predicts for both users".
//
// Pure: no DOM, no clock, no page state. The Trade page gathers the facts —
// every figure already FORMATTED by the same helpers the row prints with, so the
// copied text cannot quote a different number from the one on screen — and this
// only lays them out. A fact the page does not have is left out (null, '' or an
// empty list), never guessed, so no line ever says "undefined".
//
// Nothing is sent anywhere: the page copies the result to the clipboard and the
// reader pastes it into whichever chat he likes.

/** The opening instruction to the AI. */
export const ASK_AI_INSTRUCTION =
  'Evaluate this fantasy football trade for me. My app\'s numbers are below, but it can\'t see ' +
  'the news. Please check current info: injury reports, snap/target/carry usage trends, depth ' +
  'charts, coach, beat-writer and expert comments, recent stats, and upcoming schedule and ' +
  'matchups. Tell me if I\'m missing anything, and whether to accept, counter, or wait (e.g. for ' +
  'an injury update). Keep the answer short.';

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '' &&
  !/\b(undefined|NaN|null)\b/.test(String(v));

/** "Name (RB, DAL): 14.2 pts/wk, 170.4 rest of season; bye wk 9; ESPN: Questionable". */
function manText(p) {
  const tags = [p.pos, p.team].filter(has).join(', ');
  let s = `${p.name}${tags ? ` (${tags})` : ''}`;
  const nums = [];
  if (has(p.perWeek)) nums.push(`${p.perWeek} pts/wk projected`);
  if (has(p.ros)) nums.push(`${p.ros} rest of season`);
  const extra = [];
  if (has(p.bye)) extra.push(`bye wk ${p.bye}`);
  if (has(p.status)) extra.push(`ESPN status: ${p.status}`);
  if (nums.length) s += `: ${nums.join(', ')}`;
  if (extra.length) s += `; ${extra.join('; ')}`;
  return s;
}

/**
 * @param {Object} f the facts, every figure a ready-printed string
 * @param {string} [f.date]       "Wed, Sep 30, 2026"
 * @param {number|string} [f.week]   the fantasy week the page is on
 * @param {number|string} [f.season]
 * @param {Object} [f.league]     `{teams, scoring, starters, rosterSize, review, deadline}`
 * @param {string} [f.me]         your squad's name
 * @param {string} f.partner      his squad's name
 * @param {Array} f.send          men you send: `{name, pos, team, perWeek, ros, bye, status}`
 * @param {Array} f.receive       men you get, the same shape
 * @param {string} [f.span]       "weeks 5–17"
 * @param {string} [f.myGain]     "+1.2/wk (+15.6 total)"
 * @param {string} [f.myLineup]   "120.1 → 121.3/wk"
 * @param {string} [f.hisGain]
 * @param {string} [f.hisNote]    why his figure is on a different footing, if it is
 * @param {string} [f.meet]       "week 7: his lineup +2.3"
 * @param {string} [f.goal]       "Title chance (my goal): 12.0% → 14.1% (+2.1% ±0.4)…"
 * @param {string} [f.altGoal]
 * @param {Array<string>} [f.cuts] "I'd have to drop X (WR)"
 * @param {string} [f.acceptBy]
 * @param {Array<[string,string]>} [f.roster] `[position, "A 12.1, B 8.0"]` — what you keep
 * @returns {string}
 */
export function askAiText(f) {
  const out = [ASK_AI_INSTRUCTION, ''];
  const lg = f.league || {};

  const when = [];
  if (has(f.date)) when.push(`Date: ${f.date}`);
  if (has(f.week)) when.push(`fantasy week ${f.week} is next`);
  if (has(f.season)) when.push(`${f.season} NFL season`);
  if (when.length) out.push(when.join(' · '));

  const league = [];
  if (has(lg.teams)) league.push(`${lg.teams} teams`);
  if (has(lg.scoring)) league.push(lg.scoring);
  if (has(lg.starters)) league.push(`starters: ${lg.starters}`);
  if (has(lg.rosterSize)) league.push(`${lg.rosterSize}-man rosters`);
  if (has(lg.review)) league.push(`trade review ${lg.review}`);
  if (has(lg.deadline)) league.push(`trade deadline ${lg.deadline}`);
  if (league.length) out.push(`League: ${league.join(' · ')}`);

  out.push(`${has(f.me) ? `Me: ${f.me} · ` : ''}Trading with: ${f.partner}`);
  if (has(f.assumed)) out.push(f.assumed);   // an assumed trade the rosters include
  out.push('');

  const side = (title, men) => {
    out.push(title);
    if (!men || !men.length) out.push('- nobody');
    else for (const p of men) out.push(`- ${manText(p)}`);
  };
  side('I send:', f.send);
  side('I get:', f.receive);
  out.push('');

  const facts = [];
  if (has(f.myGain)) facts.push(`My lineup gain: ${f.myGain}${has(f.myLineup) ? `; ${f.myLineup}` : ''}`);
  if (has(f.hisGain)) facts.push(`His lineup gain: ${f.hisGain}${has(f.hisNote) ? `; ${f.hisNote}` : ''}`);
  if (has(f.meet)) facts.push(`I play him in ${f.meet}`);
  if (has(f.goal)) facts.push(f.goal);
  if (has(f.altGoal)) facts.push(f.altGoal);
  for (const c of f.cuts || []) if (has(c)) facts.push(c);
  if (has(f.acceptBy)) facts.push(f.acceptBy);
  if (facts.length) {
    out.push(`App's prediction${has(f.span) ? ` (${f.span}, best lineup each week)` : ''}:`);
    for (const x of facts) out.push(`- ${x}`);
  }

  const roster = (f.roster || []).filter(([pos, men]) => has(pos) && has(men));
  if (roster.length) {
    out.push('');
    out.push('Rest of my roster (pts/wk):');
    for (const [pos, men] of roster) out.push(`${pos}: ${men}`);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
