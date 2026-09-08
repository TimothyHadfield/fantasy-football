// Demo-mode DRAFT player pool for the 2026 season.
//
// FALLBACK DATA ONLY. This file exists so the draft assistant has a board to
// work with when no live source is connected. It is a frozen snapshot, not a
// feed: it does not update, it does not know who has already been drafted, and
// it goes stale the moment real news breaks.
//
//     NEVER present anything in this file to the user as live data.
//
// Any screen fed by demoPlayerPool() has to say it is running on demo data, the
// same way demo.js's league does.
//
// Compiled 2026-09-08, one day before the 2026 regular season opens.
//
// Unlike demo.js and demo-rosters.js, the players here are REAL. The pool was
// assembled from three public preseason sources, current as of the compile date:
//
//   - ADP, NFL team and bye week: Fantasy Football Calculator's 12-team PPR
//     average draft position, drawn from 5,144 mock drafts run Sep 1-8 2026.
//   - Projections: ESPN's and Rotowire's (via Sleeper) 2026 season projections,
//     recomputed from their raw stat lines under THIS league's scoring and then
//     averaged, so no single house's optimism carries the board.
//   - Percent rostered and injury designation: ESPN, read the morning of Sep 8.
//
// ---------------------------------------------------------------- scoring
//
// `proj` is TOTAL points for the full season under full PPR with 4-point
// passing touchdowns:
//
//     passing    0.04/yd, 4/TD, -2/INT
//     rushing    0.1/yd, 6/TD
//     receiving  0.1/yd, 1.0/reception, 6/TD
//     fumble lost -2
//     kicking    1/PAT, 3/4/5/6 per FG by distance, -1 per miss
//
// The reception point is already in every receiver's and back's number — a
// 100-catch WR carries 100 points before a yard of it. The 4-point passing TD
// is what keeps the quarterbacks here from running away with the board: the
// QB1 projects around 356 against a 349 RB1, a gap worth far less than a
// six-point-TD league would show.
//
// D/ST is the one position this league's rules do not spell out, so it keeps the
// standard ladder: sack 1, takeaway 2, blocked kick 2, safety 2, defensive or
// return TD 6, plus the usual points-allowed tiers. Those tiers are integrated
// against a normal spread of weekly results rather than read off the season
// average, so a good defense still banks its occasional shutout.
//
// ------------------------------------------------------------------ fields
//
// bye         1-14. Consistent within an NFL team by construction.
// owned       percent of ESPN leagues rostering the player, 0-100.
// injury      ACTIVE | QUESTIONABLE | DOUBTFUL | OUT | IR.
// rushYards   season rushing projection, filled in for QBs only, and only for
// rushTds     the ones who actually run (100+ projected yards). Pocket passers
//             and every non-QB sit at 0. The draft tool leans on these two to
//             separate late-round quarterbacks, where rushing floor is most of
//             what distinguishes them, so they are not decorative.
//
// Ordered by ADP, which is the order a draft board wants to read them in.
// 214 players — 32 QB, 60 RB, 70 WR, 24 TE, 14 K, 14 DST.
// Deep enough to draft a 12-team league dry and still leave a waiver wire.

export const DEMO_PLAYERS = [
  { id: 1001, name: 'Jahmyr Gibbs',           pos: 'RB',  team: 'DET', bye:  6, proj: 348.9, adp:   1.4, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1002, name: 'Bijan Robinson',         pos: 'RB',  team: 'ATL', bye: 11, proj:   337, adp:   2.3, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1003, name: 'Puka Nacua',             pos: 'WR',  team: 'LAR', bye: 11, proj: 331.9, adp:   2.8, owned: 99.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1004, name: "Ja'Marr Chase",          pos: 'WR',  team: 'CIN', bye:  6, proj: 322.5, adp:   3.8, owned: 99.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1005, name: 'Christian McCaffrey',    pos: 'RB',  team: 'SF',  bye:  8, proj: 315.5, adp:   5.5, owned: 99.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1006, name: 'Jaxon Smith-Njigba',     pos: 'WR',  team: 'SEA', bye: 11, proj: 304.3, adp:   5.7, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1007, name: 'Amon-Ra St. Brown',      pos: 'WR',  team: 'DET', bye:  6, proj:   301, adp:     7, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1008, name: 'Jonathan Taylor',        pos: 'RB',  team: 'IND', bye: 13, proj: 292.4, adp:   7.4, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1009, name: "De'Von Achane",          pos: 'RB',  team: 'MIA', bye:  6, proj: 274.9, adp:   9.6, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1010, name: 'CeeDee Lamb',            pos: 'WR',  team: 'DAL', bye: 14, proj: 280.7, adp:  10.5, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1011, name: 'James Cook III',         pos: 'RB',  team: 'BUF', bye:  7, proj: 268.7, adp:  11.3, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1012, name: 'Justin Jefferson',       pos: 'WR',  team: 'MIN', bye:  6, proj: 271.7, adp:  11.7, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1013, name: 'Chase Brown',            pos: 'RB',  team: 'CIN', bye:  6, proj: 262.7, adp:  13.1, owned: 99.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1014, name: 'Drake London',           pos: 'WR',  team: 'ATL', bye: 11, proj: 258.4, adp:  13.8, owned: 99.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1015, name: 'Derrick Henry',          pos: 'RB',  team: 'BAL', bye: 13, proj: 260.9, adp:  15.5, owned: 99.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1016, name: 'A.J. Brown',             pos: 'WR',  team: 'NE',  bye: 11, proj:   247, adp:  16.5, owned: 99.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1017, name: 'Rashee Rice',            pos: 'WR',  team: 'KC',  bye:  5, proj: 242.8, adp:  17.3, owned: 99.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1018, name: 'Saquon Barkley',         pos: 'RB',  team: 'PHI', bye: 10, proj: 258.6, adp:  18.3, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1019, name: 'George Pickens',         pos: 'WR',  team: 'DAL', bye: 14, proj: 241.2, adp:  19.9, owned: 99.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1020, name: 'Chris Olave',            pos: 'WR',  team: 'NO',  bye:  8, proj: 241.4, adp:    20, owned: 99.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1021, name: 'Nico Collins',           pos: 'WR',  team: 'HOU', bye:  8, proj: 253.6, adp:  20.1, owned: 99.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1022, name: 'Kenneth Walker',         pos: 'RB',  team: 'KC',  bye:  5, proj: 258.1, adp:    21, owned: 99.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1023, name: 'Ashton Jeanty',          pos: 'RB',  team: 'LV',  bye: 13, proj: 255.8, adp:  21.2, owned: 99.7, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1024, name: 'Omarion Hampton',        pos: 'RB',  team: 'LAC', bye:  7, proj:   252, adp:  22.3, owned: 99.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1025, name: 'Zay Flowers',            pos: 'WR',  team: 'BAL', bye: 13, proj: 233.1, adp:  24.6, owned: 98.6, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1026, name: 'Malik Nabers',           pos: 'WR',  team: 'NYG', bye:  8, proj: 238.9, adp:  26.8, owned: 99.1, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1027, name: 'Garrett Wilson',         pos: 'WR',  team: 'NYJ', bye: 13, proj: 236.8, adp:  26.9, owned:   99, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1028, name: 'Jeremiyah Love',         pos: 'RB',  team: 'ARI', bye: 14, proj: 243.7, adp:  28.2, owned: 99.4, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1029, name: 'DeVonta Smith',          pos: 'WR',  team: 'PHI', bye: 10, proj: 233.9, adp:  29.1, owned: 99.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1030, name: 'Breece Hall',            pos: 'RB',  team: 'NYJ', bye: 13, proj: 241.3, adp:  30.6, owned: 98.8, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1031, name: 'Trey McBride',           pos: 'TE',  team: 'ARI', bye: 14, proj:   237, adp:  31.2, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1032, name: 'Tetairoa McMillan',      pos: 'WR',  team: 'CAR', bye:  5, proj: 228.1, adp:  31.6, owned: 98.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1033, name: 'Javonte Williams',       pos: 'RB',  team: 'DAL', bye: 14, proj: 235.2, adp:  31.7, owned: 99.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1034, name: 'Kyren Williams',         pos: 'RB',  team: 'LAR', bye: 11, proj: 219.8, adp:  31.8, owned: 98.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1035, name: 'Josh Allen',             pos: 'QB',  team: 'BUF', bye:  7, proj:   356, adp:  32.4, owned: 99.9, injury: 'ACTIVE',       rushYards: 558, rushTds: 11.7 },
  { id: 1036, name: 'Brock Bowers',           pos: 'TE',  team: 'LV',  bye: 13, proj: 245.8, adp:  34.5, owned: 99.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1037, name: 'Emeka Egbuka',           pos: 'WR',  team: 'TB',  bye: 10, proj: 225.7, adp:  35.5, owned: 98.1, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1038, name: 'Travis Etienne Jr.',     pos: 'RB',  team: 'NO',  bye:  8, proj: 225.6, adp:  36.3, owned: 98.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1039, name: 'Tee Higgins',            pos: 'WR',  team: 'CIN', bye:  6, proj: 220.3, adp:  36.6, owned: 97.3, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1040, name: 'Cam Skattebo',           pos: 'RB',  team: 'NYG', bye:  8, proj: 213.9, adp:  37.5, owned: 98.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1041, name: 'Ladd McConkey',          pos: 'WR',  team: 'LAC', bye:  7, proj: 224.2, adp:  38.8, owned: 97.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1042, name: 'Davante Adams',          pos: 'WR',  team: 'LAR', bye: 11, proj: 211.2, adp:  41.8, owned: 98.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1043, name: "D'Andre Swift",          pos: 'RB',  team: 'CHI', bye: 10, proj: 208.4, adp:  42.5, owned: 95.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1044, name: 'Jaylen Waddle',          pos: 'WR',  team: 'DEN', bye: 10, proj: 216.6, adp:  44.2, owned:   97, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1045, name: 'Jameson Williams',       pos: 'WR',  team: 'DET', bye:  6, proj: 207.1, adp:  45.6, owned: 95.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1046, name: 'Bucky Irving',           pos: 'RB',  team: 'TB',  bye: 10, proj: 201.4, adp:  45.7, owned: 96.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1047, name: 'DJ Moore',               pos: 'WR',  team: 'BUF', bye:  7, proj: 193.7, adp:  47.4, owned: 95.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1048, name: 'Terry McLaurin',         pos: 'WR',  team: 'WSH', bye:  7, proj: 215.4, adp:  48.3, owned: 96.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1049, name: 'Quinshon Judkins',       pos: 'RB',  team: 'CLE', bye: 11, proj: 210.9, adp:  49.2, owned:   97, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1050, name: 'Luther Burden III',      pos: 'WR',  team: 'CHI', bye: 10, proj: 207.4, adp:  50.7, owned: 92.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1051, name: 'Drake Maye',             pos: 'QB',  team: 'NE',  bye: 11, proj: 312.4, adp:  51.1, owned: 99.4, injury: 'ACTIVE',       rushYards: 474, rushTds:    4 },
  { id: 1052, name: 'David Montgomery',       pos: 'RB',  team: 'HOU', bye:  8, proj: 202.3, adp:  51.9, owned: 94.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1053, name: 'Bhayshul Tuten',         pos: 'RB',  team: 'JAX', bye:  7, proj: 189.9, adp:  53.6, owned: 93.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1054, name: 'Colston Loveland',       pos: 'TE',  team: 'CHI', bye: 10, proj: 210.6, adp:  53.8, owned: 99.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1055, name: 'Joe Burrow',             pos: 'QB',  team: 'CIN', bye:  6, proj: 296.5, adp:  54.5, owned: 98.2, injury: 'ACTIVE',       rushYards: 163, rushTds:    2 },
  { id: 1056, name: 'Rome Odunze',            pos: 'WR',  team: 'CHI', bye: 10, proj:   210, adp:  54.9, owned: 94.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1057, name: 'Lamar Jackson',          pos: 'QB',  team: 'BAL', bye: 13, proj: 318.2, adp:    55, owned: 99.8, injury: 'ACTIVE',       rushYards: 669, rushTds:  4.3 },
  { id: 1058, name: 'Christian Watson',       pos: 'WR',  team: 'GB',  bye: 11, proj: 197.8, adp:  56.5, owned: 89.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1059, name: 'Mike Evans',             pos: 'WR',  team: 'SF',  bye:  8, proj: 199.8, adp:  57.4, owned: 90.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1060, name: 'Rhamondre Stevenson',    pos: 'RB',  team: 'NE',  bye: 11, proj: 187.5, adp:  61.2, owned: 91.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1061, name: 'Courtland Sutton',       pos: 'WR',  team: 'DEN', bye: 10, proj: 188.7, adp:  61.4, owned: 92.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1062, name: 'Parker Washington',      pos: 'WR',  team: 'JAX', bye:  7, proj: 197.1, adp:  61.6, owned: 89.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1063, name: 'Jaylen Warren',          pos: 'RB',  team: 'PIT', bye:  9, proj:   182, adp:  62.8, owned: 90.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1064, name: 'TreVeyon Henderson',     pos: 'RB',  team: 'NE',  bye: 11, proj: 178.9, adp:  63.7, owned: 92.5, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1065, name: 'DK Metcalf',             pos: 'WR',  team: 'PIT', bye:  9, proj: 189.3, adp:  64.2, owned: 92.1, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1066, name: 'Dak Prescott',           pos: 'QB',  team: 'DAL', bye: 14, proj: 285.3, adp:  65.4, owned: 94.1, injury: 'ACTIVE',       rushYards: 169, rushTds:  1.6 },
  { id: 1067, name: 'Marvin Harrison Jr.',    pos: 'WR',  team: 'ARI', bye: 14, proj: 189.6, adp:  65.6, owned: 92.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1068, name: 'Tyler Warren',           pos: 'TE',  team: 'IND', bye: 13, proj: 205.3, adp:    66, owned: 99.1, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1069, name: 'Jadarian Price',         pos: 'RB',  team: 'SEA', bye: 11, proj: 181.7, adp:  66.1, owned: 94.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1070, name: 'Tony Pollard',           pos: 'RB',  team: 'TEN', bye:  9, proj: 172.7, adp:  68.8, owned: 90.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1071, name: 'Alec Pierce',            pos: 'WR',  team: 'IND', bye: 13, proj: 181.2, adp:  69.3, owned: 86.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1072, name: 'Brian Thomas Jr.',       pos: 'WR',  team: 'JAX', bye:  7, proj: 185.8, adp:  73.6, owned: 84.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1073, name: 'Harold Fannin Jr.',      pos: 'TE',  team: 'CLE', bye: 11, proj: 184.4, adp:  73.8, owned: 95.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1074, name: 'Jayden Daniels',         pos: 'QB',  team: 'WSH', bye:  7, proj: 305.2, adp:  74.3, owned:   99, injury: 'ACTIVE',       rushYards: 677, rushTds:  5.5 },
  { id: 1075, name: 'Matthew Stafford',       pos: 'QB',  team: 'LAR', bye: 11, proj: 278.5, adp:  74.8, owned: 92.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1076, name: 'Rico Dowdle',            pos: 'RB',  team: 'PIT', bye:  9, proj: 174.5, adp:  75.4, owned: 89.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1077, name: 'Michael Wilson',         pos: 'WR',  team: 'ARI', bye: 14, proj:   171, adp:  75.7, owned: 86.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1078, name: 'Jalen Hurts',            pos: 'QB',  team: 'PHI', bye: 10, proj: 308.7, adp:  76.3, owned: 98.5, injury: 'ACTIVE',       rushYards: 476, rushTds:  9.1 },
  { id: 1079, name: 'Michael Pittman Jr.',    pos: 'WR',  team: 'PIT', bye:  9, proj: 183.9, adp:    77, owned: 90.3, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1080, name: 'Chris Godwin Jr.',       pos: 'WR',  team: 'TB',  bye: 10, proj:   165, adp:  77.8, owned: 76.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1081, name: 'Chuba Hubbard',          pos: 'RB',  team: 'CAR', bye:  5, proj: 163.4, adp:  78.5, owned: 84.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1082, name: 'Carnell Tate',           pos: 'WR',  team: 'TEN', bye:  9, proj: 189.7, adp:  80.2, owned: 92.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1083, name: 'Seahawks D/ST',          pos: 'DST', team: 'SEA', bye: 11, proj: 114.9, adp:  80.5, owned: 98.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1084, name: 'Kyle Pitts Sr.',         pos: 'TE',  team: 'ATL', bye: 11, proj: 178.1, adp:  81.3, owned: 96.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1085, name: 'Brock Purdy',            pos: 'QB',  team: 'SF',  bye:  8, proj: 287.2, adp:  83.4, owned: 85.3, injury: 'ACTIVE',       rushYards: 259, rushTds:  3.2 },
  { id: 1086, name: 'Caleb Williams',         pos: 'QB',  team: 'CHI', bye: 10, proj: 282.3, adp:  85.4, owned: 91.7, injury: 'ACTIVE',       rushYards: 377, rushTds:  2.6 },
  { id: 1087, name: 'Broncos D/ST',           pos: 'DST', team: 'DEN', bye: 10, proj: 109.5, adp:  86.5, owned: 98.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1088, name: 'J.K. Dobbins',           pos: 'RB',  team: 'DEN', bye: 10, proj:   167, adp:  86.7, owned: 84.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1089, name: "Wan'Dale Robinson",      pos: 'WR',  team: 'TEN', bye:  9, proj: 172.7, adp:  87.1, owned: 82.4, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1090, name: 'Jayden Reed',            pos: 'WR',  team: 'GB',  bye: 11, proj: 185.2, adp:  88.9, owned: 71.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1091, name: 'Jonathon Brooks',        pos: 'RB',  team: 'CAR', bye:  5, proj: 166.9, adp:    89, owned: 84.6, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1092, name: 'Jakobi Meyers',          pos: 'WR',  team: 'JAX', bye:  7, proj: 175.4, adp:  89.5, owned: 80.4, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1093, name: 'George Kittle',          pos: 'TE',  team: 'SF',  bye:  8, proj:   181, adp:    90, owned: 94.5, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1094, name: 'Trevor Lawrence',        pos: 'QB',  team: 'JAX', bye:  7, proj: 288.2, adp:  91.2, owned: 88.6, injury: 'ACTIVE',       rushYards: 337, rushTds:  4.9 },
  { id: 1095, name: 'Kenny Gainwell',         pos: 'RB',  team: 'TB',  bye: 10, proj: 164.4, adp:  91.3, owned: 86.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1096, name: 'Quentin Johnston',       pos: 'WR',  team: 'LAC', bye:  7, proj: 164.5, adp:  91.6, owned:   75, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1097, name: 'Josh Jacobs',            pos: 'RB',  team: 'GB',  bye: 11, proj: 124.3, adp:  92.6, owned: 91.3, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1098, name: 'Josh Downs',             pos: 'WR',  team: 'IND', bye: 13, proj: 164.3, adp:    94, owned: 70.8, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1099, name: 'RJ Harvey',              pos: 'RB',  team: 'DEN', bye: 10, proj: 146.3, adp:  94.8, owned: 76.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1100, name: 'Stefon Diggs',           pos: 'WR',  team: 'WSH', bye:  7, proj: 164.8, adp:  96.4, owned: 83.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1101, name: 'Jordan Addison',         pos: 'WR',  team: 'MIN', bye:  6, proj: 170.9, adp:    97, owned: 80.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1102, name: 'Texans D/ST',            pos: 'DST', team: 'HOU', bye:  8, proj: 120.4, adp:  97.3, owned:   99, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1103, name: 'Khalil Shakir',          pos: 'WR',  team: 'BUF', bye:  7, proj: 170.1, adp:  99.6, owned: 70.5, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1104, name: 'Rams D/ST',              pos: 'DST', team: 'LAR', bye: 11, proj: 130.3, adp: 101.3, owned: 97.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1105, name: 'Sam LaPorta',            pos: 'TE',  team: 'DET', bye:  6, proj: 192.5, adp: 101.7, owned: 95.8, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1106, name: 'Matthew Golden',         pos: 'WR',  team: 'GB',  bye: 11, proj: 178.7, adp: 102.4, owned:   85, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1107, name: 'Jared Goff',             pos: 'QB',  team: 'DET', bye:  6, proj: 268.1, adp: 102.7, owned: 69.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1108, name: 'Justin Herbert',         pos: 'QB',  team: 'LAC', bye:  7, proj: 282.7, adp: 103.4, owned: 92.5, injury: 'ACTIVE',       rushYards: 372, rushTds:  2.7 },
  { id: 1109, name: 'Patrick Mahomes',        pos: 'QB',  team: 'KC',  bye:  5, proj: 280.4, adp: 104.3, owned: 86.6, injury: 'QUESTIONABLE', rushYards: 264, rushTds:  2.1 },
  { id: 1110, name: 'Tucker Kraft',           pos: 'TE',  team: 'GB',  bye: 11, proj: 173.1, adp: 104.4, owned: 91.1, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1111, name: 'Aaron Jones Sr.',        pos: 'RB',  team: 'MIN', bye:  6, proj: 157.3, adp: 104.7, owned: 81.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1112, name: 'Xavier Worthy',          pos: 'WR',  team: 'KC',  bye:  5, proj:   167, adp: 106.9, owned: 76.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1113, name: 'Travis Kelce',           pos: 'TE',  team: 'KC',  bye:  5, proj: 174.1, adp: 107.5, owned: 91.2, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1114, name: 'Romeo Doubs',            pos: 'WR',  team: 'NE',  bye: 11, proj: 155.6, adp: 109.1, owned: 61.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1115, name: 'Kyle Monangai',          pos: 'RB',  team: 'CHI', bye: 10, proj: 164.2, adp: 109.6, owned: 78.8, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1116, name: 'Jordan Mason',           pos: 'RB',  team: 'MIN', bye:  6, proj: 152.6, adp: 110.8, owned: 68.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1117, name: 'Bo Nix',                 pos: 'QB',  team: 'DEN', bye: 10, proj: 286.8, adp: 111.4, owned: 88.8, injury: 'ACTIVE',       rushYards: 343, rushTds:    4 },
  { id: 1118, name: 'MarShawn Lloyd',         pos: 'RB',  team: 'GB',  bye: 11, proj: 141.5, adp: 112.9, owned: 80.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1119, name: 'Jacory Croskey-Merritt', pos: 'RB',  team: 'WSH', bye:  7, proj: 142.8, adp: 114.5, owned: 71.6, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1120, name: 'Deebo Samuel Sr.',       pos: 'WR',  team: 'SF',  bye:  8, proj: 152.1, adp: 114.8, owned: 68.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1121, name: 'Vikings D/ST',           pos: 'DST', team: 'MIN', bye:  6, proj:   107, adp: 117.2, owned: 13.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1122, name: 'KC Concepcion',          pos: 'WR',  team: 'CLE', bye: 11, proj: 155.5, adp: 118.3, owned:   65, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1123, name: 'Jaxson Dart',            pos: 'QB',  team: 'NYG', bye:  8, proj: 289.5, adp: 118.8, owned: 94.2, injury: 'ACTIVE',       rushYards: 546, rushTds:  6.2 },
  { id: 1124, name: 'Jalen Coker',            pos: 'WR',  team: 'CAR', bye:  5, proj: 156.2, adp: 119.1, owned:   51, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1125, name: 'Dallas Goedert',         pos: 'TE',  team: 'PHI', bye: 10, proj: 156.2, adp: 120.5, owned: 90.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1126, name: 'Blake Corum',            pos: 'RB',  team: 'LAR', bye: 11, proj: 147.1, adp: 122.6, owned: 77.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1127, name: "De'Zhaun Stribling",     pos: 'WR',  team: 'SF',  bye:  8, proj:   144, adp:   124, owned: 65.1, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1128, name: 'Patriots D/ST',          pos: 'DST', team: 'NE',  bye: 11, proj: 109.2, adp: 124.9, owned: 69.2, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1129, name: 'Brandon Aubrey',         pos: 'K',   team: 'DAL', bye: 14, proj: 144.1, adp: 126.4, owned: 99.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1130, name: 'Eagles D/ST',            pos: 'DST', team: 'PHI', bye: 10, proj: 103.3, adp: 127.1, owned: 88.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1131, name: 'Rashid Shaheed',         pos: 'WR',  team: 'SEA', bye: 11, proj: 138.5, adp: 128.1, owned: 44.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1132, name: 'Tyjae Spears',           pos: 'RB',  team: 'TEN', bye:  9, proj: 134.4, adp: 128.5, owned: 55.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1133, name: 'Kyler Murray',           pos: 'QB',  team: 'MIN', bye:  6, proj: 275.5, adp: 128.7, owned:   68, injury: 'ACTIVE',       rushYards: 503, rushTds:  3.2 },
  { id: 1134, name: 'Rachaad White',          pos: 'RB',  team: 'WSH', bye:  7, proj: 145.6, adp: 129.6, owned: 74.7, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1135, name: 'Baker Mayfield',         pos: 'QB',  team: 'TB',  bye: 10, proj: 259.7, adp: 130.1, owned:   58, injury: 'ACTIVE',       rushYards: 315, rushTds:  1.7 },
  { id: 1136, name: 'Lions D/ST',             pos: 'DST', team: 'DET', bye:  6, proj: 108.3, adp: 130.2, owned: 71.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1137, name: 'Jerry Jeudy',            pos: 'WR',  team: 'CLE', bye: 11, proj: 129.5, adp: 130.5, owned:   28, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1138, name: 'Makai Lemon',            pos: 'WR',  team: 'PHI', bye: 10, proj: 160.5, adp: 132.1, owned: 74.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1139, name: 'Mark Andrews',           pos: 'TE',  team: 'BAL', bye: 13, proj: 165.5, adp: 132.5, owned: 81.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1140, name: 'Tre Tucker',             pos: 'WR',  team: 'LV',  bye: 13, proj: 131.1, adp: 132.9, owned: 26.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1141, name: 'Jake Ferguson',          pos: 'TE',  team: 'DAL', bye: 14, proj:   163, adp: 135.8, owned:   86, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1142, name: 'Isaiah Likely',          pos: 'TE',  team: 'NYG', bye:  8, proj:   156, adp: 135.9, owned: 81.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1143, name: 'Keenan Allen',           pos: 'WR',  team: 'IND', bye: 13, proj: 115.2, adp: 136.7, owned: 29.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1144, name: "Ka'imi Fairbairn",       pos: 'K',   team: 'HOU', bye:  8, proj: 135.7, adp: 137.7, owned: 95.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1145, name: 'Tyler Shough',           pos: 'QB',  team: 'NO',  bye:  8, proj: 259.6, adp: 137.7, owned: 48.8, injury: 'ACTIVE',       rushYards: 314, rushTds:  3.6 },
  { id: 1146, name: 'Denzel Boston',          pos: 'WR',  team: 'CLE', bye: 11, proj:   138, adp: 139.1, owned: 26.2, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1147, name: 'Steelers D/ST',          pos: 'DST', team: 'PIT', bye:  9, proj: 105.6, adp: 139.1, owned: 96.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1148, name: 'Jordan Love',            pos: 'QB',  team: 'GB',  bye: 11, proj: 263.6, adp: 139.5, owned: 42.6, injury: 'ACTIVE',       rushYards: 207, rushTds:  1.5 },
  { id: 1149, name: 'Jason Myers',            pos: 'K',   team: 'SEA', bye: 11, proj: 135.1, adp: 139.9, owned: 98.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1150, name: 'Jalen McMillan',         pos: 'WR',  team: 'TB',  bye: 10, proj: 129.7, adp: 140.4, owned:   33, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1151, name: 'Najee Harris',           pos: 'RB',  team: 'NYG', bye:  8, proj:  52.2, adp: 141.6, owned: 12.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1152, name: 'Woody Marks',            pos: 'RB',  team: 'HOU', bye:  8, proj: 107.3, adp: 141.6, owned: 59.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1153, name: 'Chargers D/ST',          pos: 'DST', team: 'LAC', bye:  7, proj:  92.4, adp: 143.3, owned: 54.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1154, name: 'Jauan Jennings',         pos: 'WR',  team: 'MIN', bye:  6, proj:   110, adp: 143.3, owned:  8.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1155, name: 'Sam Darnold',            pos: 'QB',  team: 'SEA', bye: 11, proj: 244.6, adp: 144.3, owned: 26.9, injury: 'ACTIVE',       rushYards: 141, rushTds:  1.4 },
  { id: 1156, name: 'Zach Charbonnet',        pos: 'RB',  team: 'SEA', bye: 11, proj: 100.4, adp: 145.5, owned: 55.1, injury: 'OUT',          rushYards:   0, rushTds:    0 },
  { id: 1157, name: 'Cameron Dicker',         pos: 'K',   team: 'LAC', bye:  7, proj: 134.3, adp: 145.8, owned: 98.7, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1158, name: 'Dalton Kincaid',         pos: 'TE',  team: 'BUF', bye:  7, proj: 159.2, adp: 145.8, owned: 75.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1159, name: 'Emmett Johnson',         pos: 'RB',  team: 'KC',  bye:  5, proj:  59.4, adp: 147.2, owned:  6.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1160, name: 'Jordyn Tyson',           pos: 'WR',  team: 'NO',  bye:  8, proj: 105.3, adp: 149.1, owned: 37.2, injury: 'IR',           rushYards:   0, rushTds:    0 },
  { id: 1161, name: 'Harrison Mevis',         pos: 'K',   team: 'LAR', bye: 11, proj:   133, adp: 149.3, owned: 93.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1162, name: 'AJ Barner',              pos: 'TE',  team: 'SEA', bye: 11, proj: 127.9, adp: 149.8, owned:  6.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1163, name: 'Fernando Mendoza',       pos: 'QB',  team: 'LV',  bye: 13, proj: 192.2, adp: 149.8, owned:  8.8, injury: 'ACTIVE',       rushYards: 230, rushTds:    2 },
  { id: 1164, name: 'Chris Boswell',          pos: 'K',   team: 'PIT', bye:  9, proj: 125.2, adp: 150.3, owned:   38, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1165, name: 'Jake Bates',             pos: 'K',   team: 'DET', bye:  6, proj: 125.7, adp: 151.5, owned: 72.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1166, name: 'Zachariah Branch',       pos: 'WR',  team: 'ATL', bye: 11, proj:  79.3, adp: 151.5, owned:  4.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1167, name: 'Alvin Kamara',           pos: 'RB',  team: 'NO',  bye:  8, proj:    88, adp: 151.6, owned: 38.7, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1168, name: 'Harrison Butker',        pos: 'K',   team: 'KC',  bye:  5, proj: 124.7, adp: 151.6, owned: 81.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1169, name: 'Mike Washington Jr.',    pos: 'RB',  team: 'LV',  bye: 13, proj:  82.1, adp: 151.9, owned: 40.2, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1170, name: 'Malik Washington',       pos: 'WR',  team: 'MIA', bye:  6, proj:   121, adp:   152, owned:  8.2, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1171, name: 'Jordan James',           pos: 'RB',  team: 'SF',  bye:  8, proj:  44.3, adp: 152.3, owned:  2.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1172, name: 'Jaguars D/ST',           pos: 'DST', team: 'JAX', bye:  7, proj: 102.2, adp: 152.6, owned: 55.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1173, name: 'Calvin Ridley',          pos: 'WR',  team: 'TEN', bye:  9, proj: 106.2, adp: 152.7, owned: 24.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1174, name: 'Juwan Johnson',          pos: 'TE',  team: 'NO',  bye:  8, proj: 143.7, adp: 154.1, owned:   46, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1175, name: 'Cam Little',             pos: 'K',   team: 'JAX', bye:  7, proj: 129.8, adp: 154.4, owned: 88.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1176, name: 'Cyrus Allen',            pos: 'WR',  team: 'KC',  bye:  5, proj:  73.6, adp: 154.8, owned:  4.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1177, name: 'Rashod Bateman',         pos: 'WR',  team: 'BAL', bye: 13, proj: 112.2, adp: 155.2, owned:  9.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1178, name: 'Will Reichard',          pos: 'K',   team: 'MIN', bye:  6, proj:   126, adp: 155.4, owned: 32.8, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1179, name: 'Tyler Allgeier',         pos: 'RB',  team: 'ARI', bye: 14, proj:  84.7, adp: 155.7, owned: 36.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1180, name: 'Nicholas Singleton',     pos: 'RB',  team: 'TEN', bye:  9, proj:  41.7, adp: 156.4, owned:  1.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1181, name: 'Jonah Coleman',          pos: 'RB',  team: 'DEN', bye: 10, proj:    69, adp: 156.6, owned: 29.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1182, name: 'Hunter Henry',           pos: 'TE',  team: 'NE',  bye: 11, proj: 151.6, adp: 156.8, owned: 55.9, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1183, name: 'C.J. Stroud',            pos: 'QB',  team: 'HOU', bye:  8, proj: 238.3, adp: 156.9, owned: 24.5, injury: 'ACTIVE',       rushYards: 225, rushTds:  1.5 },
  { id: 1184, name: 'George Holani',          pos: 'RB',  team: 'SEA', bye: 11, proj:  33.2, adp: 157.2, owned:  3.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1185, name: 'Jalen Nailor',           pos: 'WR',  team: 'LV',  bye: 13, proj: 127.2, adp: 157.2, owned: 13.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1186, name: 'Chris Rodriguez Jr.',    pos: 'RB',  team: 'JAX', bye:  7, proj: 102.1, adp: 157.3, owned: 31.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1187, name: 'Chase McLaughlin',       pos: 'K',   team: 'TB',  bye: 10, proj: 123.9, adp: 157.4, owned: 16.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1188, name: 'Packers D/ST',           pos: 'DST', team: 'GB',  bye: 11, proj:  91.4, adp: 158.1, owned:   17, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1189, name: 'Daniel Jones',           pos: 'QB',  team: 'IND', bye: 13, proj: 236.4, adp: 158.8, owned: 36.9, injury: 'ACTIVE',       rushYards: 249, rushTds:  3.9 },
  { id: 1190, name: 'Cowboys D/ST',           pos: 'DST', team: 'DAL', bye: 14, proj:  91.9, adp: 159.2, owned: 12.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1191, name: 'Kayshon Boutte',         pos: 'WR',  team: 'HOU', bye:  8, proj: 131.9, adp: 159.2, owned: 14.6, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1192, name: 'Dylan Sampson',          pos: 'RB',  team: 'CLE', bye: 11, proj:    88, adp: 159.9, owned: 19.7, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1193, name: 'Justice Hill',           pos: 'RB',  team: 'BAL', bye: 13, proj:  93.8, adp:   160, owned: 18.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1194, name: 'Keaton Mitchell',        pos: 'RB',  team: 'LAC', bye:  7, proj:  95.1, adp: 160.2, owned: 21.9, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1195, name: 'Falcons D/ST',           pos: 'DST', team: 'ATL', bye: 11, proj:  79.1, adp: 160.5, owned:  1.2, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1196, name: 'Brenton Strange',        pos: 'TE',  team: 'JAX', bye:  7, proj: 151.6, adp: 160.7, owned: 23.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1197, name: 'Isiah Pacheco',          pos: 'RB',  team: 'DET', bye:  6, proj:  62.2, adp: 160.7, owned: 36.2, injury: 'IR',           rushYards:   0, rushTds:    0 },
  { id: 1198, name: 'Braelon Allen',          pos: 'RB',  team: 'NYJ', bye: 13, proj:    64, adp: 161.1, owned: 13.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1199, name: 'Tyler Bass',             pos: 'K',   team: 'BUF', bye:  7, proj: 120.2, adp: 161.1, owned:  5.2, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1200, name: 'Wil Lutz',               pos: 'K',   team: 'DEN', bye: 10, proj: 118.2, adp: 161.6, owned:  6.1, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1201, name: 'Malik Willis',           pos: 'QB',  team: 'MIA', bye:  6, proj: 249.2, adp:   162, owned: 21.4, injury: 'ACTIVE',       rushYards: 629, rushTds:  4.2 },
  { id: 1202, name: 'Cairo Santos',           pos: 'K',   team: 'CHI', bye: 10, proj: 122.4, adp: 163.4, owned: 34.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1203, name: 'Terrance Ferguson',      pos: 'TE',  team: 'LAR', bye: 11, proj: 117.9, adp: 165.8, owned: 26.4, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1204, name: 'Bryce Young',            pos: 'QB',  team: 'CAR', bye:  5, proj: 228.6, adp: 166.1, owned: 10.7, injury: 'ACTIVE',       rushYards: 259, rushTds:  2.6 },
  { id: 1205, name: 'T.J. Hockenson',         pos: 'TE',  team: 'MIN', bye:  6, proj: 156.5, adp: 167.5, owned: 60.5, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1206, name: 'Kenyon Sadiq',           pos: 'TE',  team: 'NYJ', bye: 13, proj: 122.6, adp: 169.6, owned: 39.5, injury: 'QUESTIONABLE', rushYards:   0, rushTds:    0 },
  { id: 1207, name: 'Greg Dulcich',           pos: 'TE',  team: 'MIA', bye:  6, proj: 114.8, adp: 169.9, owned:  3.3, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1208, name: 'Cam Ward',               pos: 'QB',  team: 'TEN', bye:  9, proj: 215.8, adp: 171.6, owned:  9.4, injury: 'ACTIVE',       rushYards: 191, rushTds:    2 },
  { id: 1209, name: 'Jacoby Brissett',        pos: 'QB',  team: 'ARI', bye: 14, proj: 174.8, adp: 174.4, owned:  5.2, injury: 'ACTIVE',       rushYards: 160, rushTds:  1.1 },
  { id: 1210, name: 'Chig Okonkwo',           pos: 'TE',  team: 'WSH', bye:  7, proj: 132.3, adp: 177.6, owned:  8.4, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1211, name: 'Aaron Rodgers',          pos: 'QB',  team: 'PIT', bye:  9, proj: 192.7, adp:   181, owned:  7.2, injury: 'ACTIVE',       rushYards:   0, rushTds:    0 },
  { id: 1212, name: 'Geno Smith',             pos: 'QB',  team: 'NYJ', bye: 13, proj: 217.9, adp: 193.8, owned:  3.9, injury: 'ACTIVE',       rushYards: 188, rushTds:    1 },
  { id: 1213, name: 'Michael Penix Jr.',      pos: 'QB',  team: 'ATL', bye: 11, proj: 121.8, adp: 195.4, owned:    1, injury: 'OUT',          rushYards:   0, rushTds:    0 },
  { id: 1214, name: 'Shedeur Sanders',        pos: 'QB',  team: 'CLE', bye: 11, proj: 116.5, adp:   197, owned:  2.3, injury: 'ACTIVE',       rushYards: 135, rushTds:  1.5 },
];

/**
 * A private copy of the pool.
 *
 * Draft tools mutate as they go — marking players taken, re-sorting, stapling
 * tier labels on. DEMO_PLAYERS is module state shared by every caller, so it is
 * never handed out directly; callers get their own objects to scribble on.
 *
 * @returns {Array<object>} a fresh deep copy of DEMO_PLAYERS
 */
export function demoPlayerPool() {
  return DEMO_PLAYERS.map((player) => ({ ...player }));
}
