// A man's weeks OFF every roster, for the player card — wired on import.
//
// Tim, 2026-10-14: "right now the player preview doesn't show any previous
// weeks if that player wasn't on your team, instead jsut shows "off". Make is
// so that never happens and it always has all the weeks filled that can be
// filled."
//
// js/player-card.js fills a card's `off` weeks as it opens (`filledRun`) from
// whatever source it was given; js/season.js reads those weeks from ESPN
// (`looseLine` / `fetchLooseWeeks`). This file only joins the two, so every
// page that opens a card does it with one line: `import './loose-weeks.js';`.
//
// Against a stand-in season module without the read (the test harnesses), a
// week off every roster draws "—": nothing to be had, never "off".

// Namespace imports, both: for ten minutes after a deploy a browser can hold
// an older season.js or player-card.js without these names (the stale-module
// trap), and a missing named import would take the whole page down with it.
import * as season from './season.js';
import * as card from './player-card.js';

if (typeof card.setLooseSource === 'function') card.setLooseSource({
  lookup(playerId, week) {
    if (typeof season.looseLine !== 'function') return null;
    return season.looseLine(playerId, week);
  },
  request(playerId, weeks) {
    if (typeof season.fetchLooseWeeks !== 'function') return Promise.resolve();
    return season.fetchLooseWeeks([playerId], weeks);
  },
});
