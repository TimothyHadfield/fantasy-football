// Checks js/accept-by.js — when a trade must be ACCEPTED for the men you get to
// be on your squad in time for a week — and espn.parseProKickoffs, which reads
// the kickoffs it works from.
//
//   node test-accept-by.mjs
//
// Tim, 2026-09-30: "calculate when that official date and time is for when the
// trade needs to be ACCEPTED (not just sent) in order for you to actually
// recieve those players by that time" / "our trade review period is 1 day".
//
// Every expected time below is written out by hand from the rule:
//   accept by = earliest kickoff among the men received that week − review.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const { acceptBy } = await import(pathToFileURL(path.join(REPO, 'js/accept-by.js')).href);
const espn = await import(pathToFileURL(path.join(REPO, 'js/espn.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const H = 3600000;
const D = 24 * H;
// Real 2026 kickoffs, from ESPN's proTeamSchedules_wl (read 2026-09-30):
//   BUF (2) week 4: Sun Oct 4 17:00 UTC; week 5: Mon Oct 12 00:15 UTC; week 7 bye
const BUF4 = 1791133200000;
const BUF5 = 1791850500000;
// A Thursday team the same week: three days earlier.
const THU4 = BUF4 - 3 * D;
const THU5 = BUF5 - 4 * D;
const kickoffs = {
  2: { 4: BUF4, 5: BUF5, 6: BUF5 + 7 * D, 8: BUF5 + 21 * D },   // no week 7: bye
  9: { 4: THU4, 5: THU5, 6: THU5 + 7 * D, 7: THU5 + 14 * D },
};
const weeks = [4, 5, 6, 7, 8];
const NOW = BUF4 - 5 * D;   // Tuesday of week 4, before either cut-off

// 1. A 24-hour review: kickoff − 24 h.
eq(acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 24, deadline: null, now: NOW }),
  { kind: 'by', week: 4, at: BUF4 - D, kickoff: BUF4, capped: false, late: [] },
  'one man, 24 h review: accept 24 h before his kickoff, for the coming week');
// The review is READ, not assumed: 48 h moves it a day earlier.
eq(acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 48, deadline: null, now: NOW }).at, BUF4 - 2 * D,
  'a 48 h review is 48 h before kickoff (the number is read, not hard-coded)');
eq(acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 0, deadline: null, now: NOW }).at, BUF4,
  'no review: accept by kickoff itself');

// 2. The earliest kickoff among the men received wins.
const both = acceptBy({ teams: [2, 9], kickoffs, weeks, reviewHours: 24, deadline: null, now: NOW });
eq([both.week, both.at, both.kickoff], [4, THU4 - D, THU4], 'two men: the Thursday kickoff decides it');
eq(acceptBy({ teams: [9, 2], kickoffs, weeks, reviewHours: 24, deadline: null, now: NOW }).at, THU4 - D,
  'whatever order they are listed in');
eq(acceptBy({ teams: [null, 2], kickoffs, weeks, reviewHours: 24, deadline: null, now: NOW }).at, BUF4 - D,
  'a man with no NFL team (free agent id null) is skipped, not fatal');

// 3. A man on bye that week does not count.
const w7 = acceptBy({ teams: [2, 9], kickoffs, weeks: [7, 8], reviewHours: 24, deadline: null, now: NOW });
eq([w7.week, w7.at], [7, THU5 + 14 * D - D], 'BUF on bye in week 7: only the other man\'s kickoff counts');
const onlyBye = acceptBy({ teams: [2], kickoffs, weeks: [7, 8], reviewHours: 24, deadline: null, now: NOW });
eq([onlyBye.week, onlyBye.at, onlyBye.late], [8, BUF5 + 21 * D - D, []],
  'the only man received is on bye in week 7: the answer is week 8, and 7 is not "too late"');

// 4. Passed: the next week it is still in time for.
const sat = acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 24, deadline: null, now: BUF4 - D + 60000 });
eq([sat.week, sat.at, sat.late], [5, BUF5 - D, [4]], 'a minute past the week-4 cut-off: week 5, and week 4 is too late');
const sun = acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 24, deadline: null, now: BUF4 + H });
eq([sun.week, sun.late], [5, [4]], 'after kickoff too');
eq(acceptBy({ teams: [2], kickoffs, weeks: [4], reviewHours: 24, deadline: null, now: BUF4 }), null,
  'no week left in time: nothing to say');

// 5. The trade deadline comes first.
const dl = BUF4 - 2 * D;   // two days before kickoff, a day before the review cut-off
eq(acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 24, deadline: dl, now: NOW }),
  { kind: 'by', week: 4, at: dl, kickoff: BUF4, capped: true, late: [] },
  'deadline before the review cut-off: accept by the deadline');
eq(acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 24, deadline: BUF4, now: NOW }).capped, false,
  'deadline after the cut-off: the cut-off stands');
eq(acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 24, deadline: NOW - 1, now: NOW }), { kind: 'closed' },
  'deadline passed: closed');
const capLate = acceptBy({ teams: [2], kickoffs, weeks, reviewHours: 24, deadline: BUF5 - 3 * D, now: BUF4 });
eq([capLate.week, capLate.at, capLate.capped, capLate.late], [5, BUF5 - 3 * D, true, [4]],
  'too late for week 4, and the deadline falls before week 5\'s cut-off');

// 6. Review period unknown: no time is invented, the rule is stated instead.
eq(acceptBy({ teams: [2], kickoffs, weeks, reviewHours: null, deadline: null, now: NOW }),
  { kind: 'rule', week: 4, kickoff: BUF4, late: [] }, 'null review: the kickoff and the rule, no accept-by time');
eq(acceptBy({ teams: [2], kickoffs, weeks, reviewHours: undefined, deadline: null, now: BUF4 + H }).week, 5,
  'and once that kickoff has passed, the next week');

// 7. Nothing known, nothing said.
eq(acceptBy({ teams: [], kickoffs, weeks, reviewHours: 24, deadline: null, now: NOW }), null, 'nobody received');
eq(acceptBy({ teams: [2], kickoffs: {}, weeks, reviewHours: 24, deadline: null, now: NOW }), null, 'no kickoffs (demo, a failed read)');
eq(acceptBy({ teams: [2], kickoffs: null, weeks, reviewHours: 24, deadline: null, now: NOW }), null, 'kickoffs null');
eq(acceptBy({ teams: [5], kickoffs, weeks, reviewHours: 24, deadline: null, now: NOW }), null, 'a team with no schedule');

// ---- espn.parseProKickoffs, on the payload's real shape --------------------
// One team as ESPN returns it (trimmed): two games one week (a made-up double,
// to prove the earliest is kept), a bye, the FA entry id 0.
const payload = {
  settings: {
    proTeams: [
      { id: 0, abbrev: 'FA', byeWeek: 0 },
      {
        id: 2, abbrev: 'BUF', byeWeek: 7,
        proGamesByScoringPeriod: {
          3: [{ awayProTeamId: 24, date: 1790528400000, homeProTeamId: 2, scoringPeriodId: 3 }],
          4: [{ awayProTeamId: 17, date: BUF4, homeProTeamId: 2, scoringPeriodId: 4 },
            { awayProTeamId: 17, date: BUF4 + D, homeProTeamId: 2, scoringPeriodId: 4 }],
          5: [{ awayProTeamId: 2, date: BUF5, homeProTeamId: 14, scoringPeriodId: 5 }],
          6: [{ awayProTeamId: 2, date: null, homeProTeamId: 14, scoringPeriodId: 6 }],
        },
      },
      { id: 9, abbrev: 'GB', byeWeek: 11 },
    ],
  },
};
eq(espn.parseProKickoffs(payload), { 2: { 3: 1790528400000, 4: BUF4, 5: BUF5 } },
  'parseProKickoffs: earliest game per week, no entry for a bye or a dateless game, no FA, no team without games');
eq(espn.parseProKickoffs(null), {}, 'a missing payload is {} (unknown)');
eq(espn.parseProKickoffs({ settings: {} }), {}, 'no proTeams is {}');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
