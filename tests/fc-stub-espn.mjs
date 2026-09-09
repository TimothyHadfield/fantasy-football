// The real espn.js, with only the one network call the forecast makes stubbed.
// Everything else (SLOT_ELIGIBILITY, configure, getConfig, POSITIONS) is the
// genuine article, so a rename in the repo breaks this rather than passing.
//
// An explicit local export wins over a `export *` re-export in ESM, so
// fetchByeWeeks below shadows the real one.

// fc-loader.mjs deliberately does not rewrite this one (see the note there).
export * from '../js/espn.js';

import { BYES } from './fc-stub-season.mjs';

export const calls = { byes: 0 };

export async function fetchByeWeeks() {
  calls.byes++;
  if (process.env.FC_BYES_FAIL) throw new Error('no bye weeks');
  return { ...BYES };
}
