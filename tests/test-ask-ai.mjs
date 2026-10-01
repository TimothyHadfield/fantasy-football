// Checks js/ask-ai.js — the text a Trade row's "Ask AI" button copies.
//
//   node test-ask-ai.mjs
//
// Tim, 2026-09-30: "a "ask AI" button on each trade which just allows the user
// to copy a script or text … The text will give the information the AI won't
// necessarily know about the situation like the overll +/- that the cite
// predicts for both users".
//
// The fixture is a real-shaped 2-for-2 from the demo league's own fields: every
// figure arrives already printed by the page (with its real minus sign), so this
// checks the layout, that BOTH sides' +/- are in it, that a missing fact leaves
// its line out rather than printing "undefined", and the word budget.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const { askAiText, ASK_AI_INSTRUCTION } = await import(pathToFileURL(path.join(REPO, 'js/ask-ai.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};

const full = {
  date: 'Wed, Sep 30, 2026',
  week: 5,
  season: 2026,
  league: {
    teams: 10, scoring: 'PPR', starters: 'QB, 2 RB, 2 WR, TE, FLEX, D/ST, K',
    rosterSize: 16, review: '24 hours', deadline: 'Wed, Nov 18, 9:00 AM',
  },
  me: 'Hadfield Heroes',
  partner: 'Nolan’s Nightmares',
  send: [
    { name: 'Jahmyr Gibbs', pos: 'RB', team: 'DET', perWeek: '18.4', ros: '239.2', bye: 8, status: null },
    { name: 'Tee Higgins', pos: 'WR', team: 'CIN', perWeek: '12.1', ros: '157.3', bye: 10, status: 'Questionable' },
  ],
  receive: [
    { name: 'Puka Nacua', pos: 'WR', team: 'LAR', perWeek: '17.9', ros: '232.7', bye: 8, status: null },
    { name: 'Kyren Williams', pos: 'RB', team: 'LAR', perWeek: '14.6', ros: '189.8', bye: 8, status: 'Out' },
  ],
  span: 'weeks 5–17',
  myGain: '+1.4/wk (+18.2 total)',
  myLineup: 'starting lineup 121.6 → 123.0/wk',
  hisGain: '−0.6/wk (−6.1 total)',
  hisNote: 'playoff weeks weighted by his chance of playing them',
  meet: 'week 9; this trade changes his lineup +2.3 that week',
  goal: 'Title chance (my goal, 10,000 simulated seasons): 12.0% → 14.1% (+2.1% ±0.4); his 8.0% → 7.2%; app estimates 64% he accepts',
  altGoal: 'Last chance: 9.0% → 8.1%',
  cuts: [],
  acceptBy: 'Accept by Sat, Oct 3, 10:00 AM to have them for week 5',
  roster: [
    ['QB', 'Jalen Hurts 21.3, Bo Nix 15.2'],
    ['RB', 'Chase Brown 13.0, Tyjae Spears 7.4, Jaylen Wright 5.1'],
    ['WR', 'Garrett Wilson 14.8, Jameson Williams 11.0, Rashod Bateman 7.7, Jalen McMillan 6.0'],
    ['TE', 'Sam LaPorta 10.9, Cade Otton 6.2'],
    ['K', 'Jake Bates 8.6'],
    ['D/ST', 'Broncos D/ST 7.9'],
  ],
};

const text = askAiText(full);
const words = text.split(/\s+/).filter(Boolean).length;

ok(text.startsWith(ASK_AI_INSTRUCTION), 'it opens with the instruction to the AI', text.slice(0, 120));
for (const want of ['injury reports', 'usage', 'depth charts', 'beat-writer', 'expert', 'recent stats',
  'schedule', 'accept, counter, or wait', 'short']) {
  ok(text.includes(want), `the instruction asks about "${want}"`);
}
ok(text.includes('Date: Wed, Sep 30, 2026') && text.includes('fantasy week 5') && text.includes('2026 NFL season'),
  'it carries the date, the week and the season', text.split('\n')[2]);
ok(/League: 10 teams · PPR · starters: QB, 2 RB, 2 WR, TE, FLEX, D\/ST, K · 16-man rosters · trade review 24 hours/.test(text),
  'it carries the league: size, scoring, starting slots, rosters, review period', text.split('\n')[3]);
ok(text.includes('Me: Hadfield Heroes · Trading with: Nolan’s Nightmares'), 'it names both squads');
for (const p of [...full.send, ...full.receive]) {
  ok(text.includes(`${p.name} (${p.pos}, ${p.team}): ${p.perWeek} pts/wk projected, ${p.ros} rest of season`),
    `${p.name} with position, NFL team, per-week and rest-of-season projections`);
}
ok(text.indexOf('I send:') < text.indexOf('Jahmyr Gibbs') && text.indexOf('Jahmyr Gibbs') < text.indexOf('I get:') &&
  text.indexOf('I get:') < text.indexOf('Puka Nacua'), 'the men are under the right heading');
ok(text.includes('ESPN status: Questionable') && text.includes('ESPN status: Out'), 'the injury status is passed on');
ok(text.includes('My lineup gain: +1.4/wk (+18.2 total)'), 'MY +/- exactly as the row prints it');
ok(text.includes('His lineup gain: −0.6/wk (−6.1 total)'), 'HIS +/- exactly as the row prints it');
ok(text.includes('I play him in week 9; this trade changes his lineup +2.3'), 'the week I play him');
ok(text.includes('My lineup gain: +1.4/wk (+18.2 total); starting lineup 121.6 → 123.0/wk'), 'my lineup before and after');
ok(text.includes('His lineup gain: −0.6/wk (−6.1 total); playoff weeks weighted'), 'and why his figure is weighted');
ok(text.includes('Title chance (my goal') && text.includes('64% he accepts'), 'the goal change and the yes chance');
ok(text.includes('Last chance: 9.0% → 8.1%'), 'the other goal');
ok(text.includes('Accept by Sat, Oct 3'), 'the accept-by deadline');
ok(text.includes("App's prediction (weeks 5–17, best lineup each week):"), 'the priced weeks are named');
ok(text.includes('Rest of my roster (pts/wk):') && text.includes('WR: Garrett Wilson 14.8'), 'my remaining roster by position');
ok(!/undefined|NaN|\bnull\b|\[object/.test(text), 'no undefined, NaN, null or [object] anywhere', text);
ok(words <= 350, `a 2-for-2 with a full roster stays under ~350 words (${words})`, words);

// MISSING FACTS ARE LEFT OUT, never printed as "undefined".
const bare = askAiText({
  partner: 'Sam',
  send: [{ name: 'A Man', pos: 'QB', team: null, perWeek: null, ros: undefined, bye: null, status: null }],
  receive: [{ name: 'B Man', pos: 'K', team: 'KC', perWeek: '8.0' }],
  league: { teams: 10, scoring: '', starters: undefined, review: null },
  myGain: '+0.4 in a typical week',
  hisGain: undefined,
  goal: null,
  cuts: [null, "Roster limit: I'd have to drop C Man (WR)"],
  roster: [['QB', ''], ['RB', 'D Man 9.0']],
});
ok(!/undefined|NaN|\bnull\b|\[object/.test(bare), 'a deal with half its facts missing prints none of them as "undefined"', bare);
ok(!bare.includes('Date:') && !bare.includes('His lineup gain'), 'a missing date and a missing gain leave their lines out', bare);
ok(bare.includes('- A Man (QB)') && !bare.includes('A Man (QB):'), 'a man with no numbers is just his name and position', bare);
ok(bare.includes('League: 10 teams') && !bare.includes('starters'), 'the league line keeps only what is known', bare);
ok(bare.includes("Roster limit: I'd have to drop C Man (WR)"), 'a forced cut is stated', bare);
ok(bare.includes('RB: D Man 9.0') && !/^QB:/m.test(bare), 'an empty roster position is left out', bare);
ok(bare.includes("App's prediction:"), 'with no weeks priced the heading names none', bare);
// A figure that came out as NaN upstream is dropped rather than quoted.
const nan = askAiText({ partner: 'Sam', send: [], receive: [], myGain: 'NaN/wk (NaN total)' });
ok(!/NaN/.test(nan) && nan.includes('- nobody'), 'a NaN figure is dropped, and an empty side says nobody', nan);

console.log(`${pass} passed, ${fail} failed`);
if (!fail) console.log(`All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
