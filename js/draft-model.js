// The draft engine: value, scarcity, and Tim's strategy.
//
// Pure functions only — no DOM, no fetching. Everything here is testable in
// node, which matters because the one thing you cannot do is rehearse a live
// draft.
//
// The strategy encoded here is Tim's, from DRAFT-STRATEGY.md. Where a rule is
// his, the comment says so. Where a number is a judgement call that he has not
// made yet, it lives in TUNING below so it is easy to find and change rather
// than buried in the logic.

// ------------------------------------------------------------ league settings
// Facts about Tim's league, from the 2026 settings he supplied.

export const LEAGUE = {
  teams: 10,
  rounds: 16,
  secondsPerPick: 90,
  ppr: 1,
  passTdPoints: 4,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 },
  flexEligible: ['RB', 'WR', 'TE'],
  // Position maximums the league enforces. Drafting past these is illegal.
  maxAt: { QB: 4, RB: 8, WR: 8, TE: 3, DST: 3, K: 3 },
};

export const TUNING = {
  // How much a position's starter demand spills into the FLEX slot. In full
  // PPR the flex is usually a RB or WR, occasionally a TE.
  flexShare: { RB: 0.45, WR: 0.45, TE: 0.10 },

  // Weight on the scarcity term relative to raw value above replacement.
  // 1.0 means "a point of expected loss from waiting is worth a point of
  // projection".
  urgencyWeight: 1.0,

  // How much the intervening teams' roster holes bend the survival curve.
  // At 1.5, a position every single team in front of you needs survives at
  // roughly its ADP odds raised to the power 2.5 — a big, deliberate haircut.
  pressureWeight: 1.5,

  // ADP uncertainty. Real ADP spread widens further down the board, so sigma
  // scales with ADP but never drops below a floor.
  adpSigmaFloor: 3,
  adpSigmaScale: 0.18,

  // A player is "falling" once he is this many picks past his ADP.
  fallerThreshold: 8,
  fallerMaxBonus: 22,

  // Tim wants a TE in rounds 3-6, but will take one of the top two earlier.
  teWindow: [3, 6],
  teElitePreWindow: [2, 3],

  // Tim waits on QB. Before this round a QB is actively discouraged, by this
  // many points per round early.
  //
  // This has to be a big number, and the reason is worth knowing. In a 10-team
  // league with one starting QB, replacement level sits at roughly the 11th
  // best quarterback — so an elite QB's value above replacement is genuinely
  // enormous, and raw value-based drafting will take one in round 3 or 4 every
  // time. That is the classic way VORP overvalues the position: it prices the
  // gap to the last starter, when what actually matters is that the gap
  // between QB4 and QB12 is small and you can wait for it. This penalty is a
  // deliberate strategy override of the value model, and it is Tim's rule,
  // not the model's opinion.
  qbEarliestRound: 9,
  qbEarlyPenalty: 18,
  qbSecondRound: 11,
  // A late QB who runs is worth more than one who does not — since 2019 every
  // overall QB1 has had 4+ rushing TDs and 350+ rushing yards.
  qbRushYards: 350,
  qbRushTds: 4,

  // Kickers and defenses are a last-two-rounds problem.
  kdstLatestRound: 15,

  // Starters sharing a bye week is survivable; a pile-up is not.
  byeCrowdLimit: 3,

  // Floor on how deep into the remaining pool replacement level can sit.
  //
  // Without this, replacement collapses. Once the league's starting slots at a
  // position are all filled, remaining demand hits zero, replacement becomes
  // "the best player still available", and every value above replacement at
  // that position flattens to nothing — exactly when the draft still has six
  // rounds to run. These floors say what you could realistically fall back to
  // instead: a few players deep, which is also roughly what waivers offer.
  minReplacementDepth: { QB: 4, RB: 6, WR: 6, TE: 3, K: 2, DST: 2 },

  // What the Nth player at a position is actually worth to *this* roster,
  // as a multiplier on his value above replacement. Index by how many you
  // already have; the last entry repeats.
  //
  // This exists because value above replacement answers "how good is he
  // compared to the league's last starter", not "how much does he add to my
  // team". Those diverge badly at one-slot positions: only about eleven tight
  // ends are startable across a 10-team league, so every good TE scores an
  // enormous VORP and nothing stops the engine drafting three of them. A
  // second TE is a bench player, and this is what says so.
  saturation: {
    QB: [1, 0.55, 0.3, 0.1],   // Tim deliberately wants two, sometimes three
    RB: [1, 1, 0.9, 0.72, 0.5, 0.34, 0.2, 0.12],
    WR: [1, 1, 0.9, 0.72, 0.5, 0.34, 0.2, 0.12],
    TE: [1, 0.22, 0.08],
    K: [1, 0.04],
    DST: [1, 0.04],
  },
};

/** How much the next player at this position is worth to a roster that already has `have`. */
export function saturationFactor(pos, have) {
  const curve = TUNING.saturation[pos];
  if (!curve) return 1;
  return curve[Math.min(have, curve.length - 1)];
}

// ---------------------------------------------------------------- snake maths

/**
 * Every overall pick number belonging to one draft slot.
 * Slot is 1-indexed. In a snake, odd rounds run 1..N and even rounds N..1.
 */
export function picksForSlot(slot, teams = LEAGUE.teams, rounds = LEAGUE.rounds) {
  const out = [];
  for (let r = 1; r <= rounds; r++) {
    const inRound = r % 2 === 1 ? slot : teams - slot + 1;
    out.push((r - 1) * teams + inRound);
  }
  return out;
}

/** The next pick at or after `overall` that belongs to this slot. */
export function nextPickForSlot(overall, slot, teams = LEAGUE.teams, rounds = LEAGUE.rounds) {
  return picksForSlot(slot, teams, rounds).find((p) => p >= overall) ?? null;
}

export function roundOf(overall, teams = LEAGUE.teams) {
  return Math.floor((overall - 1) / teams) + 1;
}

/**
 * Which draft slot owns a given overall pick.
 *
 * Worth having because it means opponent modelling needs no team ids at all —
 * the snake itself says who picked what. That keeps the feature working in
 * manual mode, where all we know is the order players came off the board.
 */
export function slotAtPick(overall, teams = LEAGUE.teams) {
  const r = roundOf(overall, teams);
  const inRound = overall - (r - 1) * teams;
  return r % 2 === 1 ? inRound : teams - inRound + 1;
}

// --------------------------------------------------------------- availability

/**
 * Probability a player is still on the board at `targetPick`, given he is
 * available right now at `currentPick`.
 *
 * The base curve is a logistic centred on his ADP. The conditioning matters:
 * a player who has already slid well past his ADP is *more* likely to keep
 * sliding than his raw ADP suggests, and dividing by the survival probability
 * at the current pick is what expresses that.
 */
export function survivalProbability(player, targetPick, currentPick) {
  if (player.adp == null) return 0.5; // unranked: genuinely unknown
  const sigma = Math.max(TUNING.adpSigmaFloor, player.adp * TUNING.adpSigmaScale);
  const s = (pick) => 1 / (1 + Math.exp((pick - player.adp) / sigma));

  const now = s(currentPick);
  if (now <= 1e-6) return 0;
  return Math.min(1, s(targetPick) / now);
}

/**
 * Expected best value-above-replacement still available at a position by
 * `targetPick`.
 *
 * Each candidate contributes his value weighted by the chance he is the best
 * one left — that is, he survives and everyone ranked above him does not.
 * Summed over the top few, this is the honest answer to "what do I get at this
 * position if I wait?", which is the number the whole wait-or-take decision
 * turns on.
 */
export function expectedBestLater(candidates, targetPick, currentPick, depth = 12, pressure = 0) {
  const ranked = [...candidates].sort((a, b) => b.vorp - a.vorp).slice(0, depth);
  let gone = 1; // probability every better player has been taken
  let expected = 0;
  for (const c of ranked) {
    const survives = Math.pow(
      survivalProbability(c, targetPick, currentPick),
      1 + TUNING.pressureWeight * pressure
    );
    expected += c.vorp * survives * gone;
    gone *= 1 - survives;
  }
  return expected;
}

// ------------------------------------------------------------ opponent needs

/**
 * How hard each position will be hit between now and your next pick.
 *
 * ADP alone treats every intervening pick as an average drafter. In practice
 * the teams picking in front of you have specific holes, and a position that
 * four of the next eight teams still need will empty out faster than its ADP
 * suggests. Returns a 0-1 share per position: the fraction of the intervening
 * picks likely to be spent there.
 */
export function positionPressure(drafted, players, currentPick, targetPick, teams = LEAGUE.teams) {
  const pressure = {};
  for (const pos of Object.keys(LEAGUE.maxAt)) pressure[pos] = 0;
  if (!targetPick || targetPick <= currentPick + 1) return pressure;

  const bySlot = new Map();
  for (const d of drafted) {
    const p = players.find((x) => x.id === d.playerId);
    if (!p) continue;
    const s = slotAtPick(d.overall, teams);
    if (!bySlot.has(s)) bySlot.set(s, []);
    bySlot.get(s).push(p);
  }

  const counts = {};
  let n = 0;
  for (let pk = currentPick + 1; pk < targetPick; pk++) {
    const st = rosterState(bySlot.get(slotAtPick(pk, teams)) || []);
    n++;
    // A team with holes fills a hole; a team without spreads across the flex
    // positions, which is where depth actually gets drafted.
    const needs = Object.entries(st.need)
      .filter(([pos, v]) => v > 0 && !st.full[pos])
      .map(([pos]) => pos);
    const candidates = needs.length ? needs : LEAGUE.flexEligible;
    for (const pos of candidates) counts[pos] = (counts[pos] || 0) + 1 / candidates.length;
  }

  for (const pos of Object.keys(pressure)) pressure[pos] = n ? (counts[pos] || 0) / n : 0;
  return pressure;
}

// ---------------------------------------------------------- replacement level

/**
 * How many players at each position the league still needs as STARTERS.
 *
 * This is what makes replacement level move during a draft. Early on, ten
 * teams still need two starting RBs each, so the bar is deep and an RB's edge
 * over it is small. Once those slots fill, the bar rises to whoever is left
 * and the remaining good players look correctly scarce.
 */
export function remainingStarterDemand(draftedByPos) {
  const demand = {};
  for (const [pos, perTeam] of Object.entries(LEAGUE.starters)) {
    if (pos === 'FLEX') continue;
    demand[pos] = perTeam * LEAGUE.teams;
  }
  for (const [pos, share] of Object.entries(TUNING.flexShare)) {
    demand[pos] += LEAGUE.starters.FLEX * LEAGUE.teams * share;
  }
  for (const [pos, taken] of Object.entries(draftedByPos)) {
    if (demand[pos] != null) demand[pos] = Math.max(0, demand[pos] - taken);
  }
  return demand;
}

/**
 * Replacement projection per position: what the last startable player at that
 * position is worth, among those still available.
 */
export function replacementLevels(available, draftedByPos) {
  const demand = remainingStarterDemand(draftedByPos);
  const levels = {};
  for (const pos of Object.keys(LEAGUE.maxAt)) {
    const atPos = available
      .filter((p) => p.pos === pos)
      .sort((a, b) => b.proj - a.proj);
    if (!atPos.length) { levels[pos] = 0; continue; }
    // Index of the last player who would still start somewhere in the league,
    // but never shallower than the fallback floor.
    const wanted = Math.max(
      Math.round(demand[pos] ?? 0),
      TUNING.minReplacementDepth[pos] ?? 0
    );
    levels[pos] = atPos[Math.min(atPos.length - 1, wanted)].proj;
  }
  return levels;
}

// ------------------------------------------------------------ tiers and runs

/**
 * Split a position's remaining players into tiers at the natural gaps.
 *
 * A tier break is the thing that actually forces a pick: it is not that a
 * player is good, it is that the next one is materially worse. Gaps are judged
 * against the position's own typical gap so that this works at QB and at K.
 */
export function tiersFor(available, pos, maxPlayers = 24) {
  const atPos = available
    .filter((p) => p.pos === pos)
    .sort((a, b) => b.proj - a.proj)
    .slice(0, maxPlayers);
  if (atPos.length < 3) return atPos.map((p) => ({ ...p, tier: 1 }));

  const gaps = [];
  for (let i = 1; i < atPos.length; i++) gaps.push(atPos[i - 1].proj - atPos[i].proj);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const threshold = Math.max(median * 2.5, 8);

  let tier = 1;
  const out = [{ ...atPos[0], tier }];
  for (let i = 1; i < atPos.length; i++) {
    if (atPos[i - 1].proj - atPos[i].proj >= threshold) tier++;
    out.push({ ...atPos[i], tier });
  }
  return out;
}

/** Positions being taken unusually fast in the recent past. */
export function detectRuns(recentPicks, window = 8, threshold = 4) {
  const recent = recentPicks.slice(-window);
  const counts = {};
  for (const p of recent) counts[p.pos] = (counts[p.pos] || 0) + 1;
  return Object.entries(counts)
    .filter(([, n]) => n >= threshold)
    .map(([pos, n]) => ({ pos, count: n, window: recent.length }));
}

// ------------------------------------------------------------- roster state

/** What the roster has, what it still needs, and what it may no longer take. */
export function rosterState(myPlayers) {
  const counts = {};
  for (const p of myPlayers) counts[p.pos] = (counts[p.pos] || 0) + 1;

  const need = {};
  let flexOpen = LEAGUE.starters.FLEX;
  for (const [pos, req] of Object.entries(LEAGUE.starters)) {
    if (pos === 'FLEX') continue;
    need[pos] = Math.max(0, req - (counts[pos] || 0));
  }
  // Anything past a position's own starting requirement can fill the flex.
  let spare = 0;
  for (const pos of LEAGUE.flexEligible) {
    spare += Math.max(0, (counts[pos] || 0) - LEAGUE.starters[pos]);
  }
  flexOpen = Math.max(0, flexOpen - spare);

  const full = {};
  for (const [pos, max] of Object.entries(LEAGUE.maxAt)) {
    full[pos] = (counts[pos] || 0) >= max;
  }

  return {
    counts,
    need,
    flexOpen,
    full,
    starterHolesLeft: Object.values(need).reduce((a, b) => a + b, 0) + flexOpen,
    size: myPlayers.length,
  };
}

/** How many of this roster's starters already share a bye week. */
function byeCrowding(myPlayers, bye) {
  if (!bye) return 0;
  return myPlayers.filter((p) => p.bye === bye).length;
}

// ---------------------------------------------------------- Tim's strategy

/**
 * How much the "he won't last" pressure should count for this position.
 *
 * Scarcity is only a reason to act if you were willing to act at all. Without
 * this, the urgency term quietly re-imports exactly what the strategy rules
 * just excluded: the best QB on the board is genuinely scarce in round 5 — he
 * is the only one of his kind and he will certainly be gone — and that
 * scarcity bonus is large enough to cancel the penalty for taking a QB early.
 * The right reading is that his scarcity is irrelevant while the plan is to
 * wait, so it is damped rather than allowed to argue with the plan.
 */
function urgencyDamping(pos, ctx) {
  const { round, roster } = ctx;
  if (pos === 'K' || pos === 'DST') return round < TUNING.kdstLatestRound ? 0 : 1;
  if (pos === 'QB' && round < TUNING.qbEarliestRound) return 0.15;
  if (pos === 'TE' && (roster.counts.TE || 0) >= 1) return 0.2;
  return 1;
}

/**
 * Strategy adjustments, in projected-points-equivalent.
 *
 * Everything here traces to a rule in DRAFT-STRATEGY.md Part 1. Each returns a
 * short reason string because a number nobody can explain is useless with 90
 * seconds on the clock.
 */
function strategyAdjust(player, ctx) {
  const { round, roster, myPlayers, elitePos, currentPick, roundsLeft } = ctx;
  const reasons = [];
  let bonus = 0;
  const add = (n, why) => { bonus += n; if (why) reasons.push(why); };

  const pos = player.pos;
  const have = roster.counts[pos] || 0;

  // --- Hard rule: never exceed a league position maximum.
  if (roster.full[pos]) return { bonus: -Infinity, reasons: [`at ${pos} limit`], blocked: true };

  // --- Hard rule: do not spend the last picks on luxuries.
  // Once the picks remaining equal the starting slots still unfilled, every
  // remaining pick is spoken for. A bonus is not enough here — an elite TE
  // falling to round 15 will out-score a kicker on raw value every time, and
  // taking him leaves you starting nobody at K.
  const fillsHole = (roster.need[pos] || 0) > 0 ||
    (roster.flexOpen > 0 && LEAGUE.flexEligible.includes(pos));
  if (!fillsHole && roundsLeft <= roster.starterHolesLeft) {
    return {
      bonus: -Infinity,
      reasons: [`no picks to spare — ${roster.starterHolesLeft} slots still empty`],
      blocked: true,
    };
  }

  // --- Tim: rounds 1-3 are RB/WR, in a specific shape.
  if (round === 1) {
    if (pos === 'RB' || pos === 'WR') add(18, 'R1 target: best RB/WR');
    else if (pos !== 'TE') add(-60, `no ${pos} in round 1`);
  }
  if (round === 2) {
    // Ideally the opposite of the round 1 pick — but Tim calls this soft.
    const first = myPlayers[0];
    if (first && (pos === 'RB' || pos === 'WR')) {
      if (first.pos !== pos) add(8, `pairs with your R1 ${first.pos}`);
      else add(-3, `doubles up at ${pos}`);
    }
  }
  if (round === 3) {
    // Whichever of RB/WR he is shorter on.
    const rb = roster.counts.RB || 0;
    const wr = roster.counts.WR || 0;
    if (pos === 'RB' && rb < wr) add(10, 'thinner at RB');
    if (pos === 'WR' && wr < rb) add(10, 'thinner at WR');
  }

  // --- Tim: TE. Two elite ones exist most years; otherwise rounds 3-6.
  if (pos === 'TE') {
    const [tw0, tw1] = TUNING.teWindow;
    const [ew0, ew1] = TUNING.teElitePreWindow;
    if (have >= 1) {
      add(round >= LEAGUE.rounds - 3 ? -5 : -30, 'already have a TE');
    } else if (elitePos.TE && round >= ew0 && round <= ew1) {
      add(20, 'elite TE tier — worth taking early');
    } else if (round >= tw0 && round <= tw1) {
      add(14, 'your TE window');
    } else if (round > tw1) {
      add(20, 'still no TE');
    } else {
      add(-25, 'too early for TE');
    }
  }

  // --- Tim: wait on QB, then carry two or three.
  if (pos === 'QB') {
    if (round < TUNING.qbEarliestRound) {
      add(-TUNING.qbEarlyPenalty * (TUNING.qbEarliestRound - round), 'too early for QB');
    } else if (have === 0) {
      add(16, 'need a QB');
    } else if (have === 1 && round >= TUNING.qbSecondRound) {
      add(11, 'second QB to rotate');
    } else if (have === 2) {
      // Tim carries 2-3 QBs in-season but says he picks the extras up off
      // waivers. A bench spot is worth more than a third quarterback here.
      add(-8, 'third QB — you usually stream these');
    } else {
      add(-20, 'have enough QBs');
    }
    // Rushing production is the separator among late QBs.
    if ((player.rushYards ?? 0) >= TUNING.qbRushYards ||
        (player.rushTds ?? 0) >= TUNING.qbRushTds) {
      add(9, 'runs the ball — the QB1 pattern');
    }
  }

  // --- K and DST are a last-two-rounds problem, then compulsory.
  if (pos === 'K' || pos === 'DST') {
    if (round < TUNING.kdstLatestRound) add(-120, `${pos} can wait`);
    else if (have === 0) add(45, `must fill ${pos}`);
    else add(-60, `already have ${pos}`);
  }

  // --- Tim's standing rule: take the faller.
  // Split by cause. A player sliding while his position is untouched is real
  // value; one sliding with an injury flag is the documented trap.
  if (player.adp != null && currentPick - player.adp >= TUNING.fallerThreshold) {
    const slide = currentPick - player.adp;
    const healthy = (player.injury || 'ACTIVE') === 'ACTIVE';
    if (healthy) {
      add(Math.min(TUNING.fallerMaxBonus, slide * 0.7),
          `fell ${Math.round(slide)} picks past ADP`);
    } else {
      add(-10, `sliding on injury news (${player.injury})`);
    }
  }

  // --- Tim's balance rule: fill the starting lineup, and do it gradually
  // rather than all at the end. The pressure to close a hole grows as the
  // rounds run out, so early on it is a nudge and late it is decisive.
  const stillNeeded = (roster.need[pos] || 0) > 0;
  if (stillNeeded) {
    const urgencyOfHole = 1 - Math.min(1, (roundsLeft - roster.starterHolesLeft) / 6);
    if (urgencyOfHole > 0) {
      add(Math.round(26 * urgencyOfHole), `still need a starting ${pos}`);
    }
  }

  // --- Never strand a starting slot with no rounds left to fill it.
  if (stillNeeded && roundsLeft <= roster.starterHolesLeft + 1) {
    add(25, `must still fill ${pos}`);
  }

  // --- Bye-week pile-ups.
  if (byeCrowding(myPlayers, player.bye) >= TUNING.byeCrowdLimit) {
    add(-6, `week ${player.bye} bye crowded`);
  }

  return { bonus, reasons, blocked: false };
}

// ------------------------------------------------------------------ the board

/**
 * Rank everything still available, for one specific pick.
 *
 * Returns candidates sorted best-first, each carrying the numbers behind the
 * ranking and a plain-language reason list.
 */
export function buildBoard({
  players,
  drafted = [],
  myPlayerIds = [],
  currentPick,
  slot,
  teams = LEAGUE.teams,
  rounds = LEAGUE.rounds,
}) {
  const takenIds = new Set(drafted.map((d) => d.playerId));
  const available = players.filter((p) => !takenIds.has(p.id));
  const mine = new Set(myPlayerIds);
  const myPlayers = players.filter((p) => mine.has(p.id));

  const round = roundOf(currentPick, teams);
  const roundsLeft = rounds - round + 1;

  const draftedByPos = {};
  for (const d of drafted) {
    const p = players.find((x) => x.id === d.playerId);
    if (p) draftedByPos[p.pos] = (draftedByPos[p.pos] || 0) + 1;
  }

  const levels = replacementLevels(available, draftedByPos);
  const withVorp = available.map((p) => ({ ...p, vorp: p.proj - (levels[p.pos] ?? 0) }));

  // Which positions currently have a genuinely elite top tier — used by the
  // TE rule, and worth surfacing generally.
  const elitePos = {};
  for (const pos of Object.keys(LEAGUE.maxAt)) {
    const t = tiersFor(withVorp, pos);
    const topTier = t.filter((p) => p.tier === 1);
    elitePos[pos] = topTier.length > 0 && topTier.length <= 3;
  }

  const roster = rosterState(myPlayers);
  const myNext = nextPickForSlot(currentPick + 1, slot, teams, rounds);

  // What the teams in front of you still need, which is what actually
  // determines who survives the gap.
  const pressure = positionPressure(drafted, players, currentPick, myNext, teams);
  const survivesFor = (p) => {
    if (!myNext) return 0;
    const base = survivalProbability(p, myNext, currentPick);
    return Math.pow(base, 1 + TUNING.pressureWeight * (pressure[p.pos] ?? 0));
  };

  // Expected best available per position if this pick is spent elsewhere.
  const laterByPos = {};
  for (const pos of Object.keys(LEAGUE.maxAt)) {
    laterByPos[pos] = myNext
      ? expectedBestLater(withVorp.filter((p) => p.pos === pos), myNext, currentPick,
                          12, pressure[pos] ?? 0)
      : 0;
  }

  const ctx = { round, roster, myPlayers, elitePos, currentPick, roundsLeft };

  const scored = withVorp.map((p) => {
    const survives = survivesFor(p);
    // Value above replacement, discounted by how many of this position the
    // roster already carries. `vorp` stays raw for display; `effVorp` is what
    // the decision actually turns on.
    const sat = saturationFactor(p.pos, roster.counts[p.pos] || 0);
    const effVorp = p.vorp * sat;
    const waitCost = Math.max(0, p.vorp - laterByPos[p.pos]) * sat;
    const urgency = (1 - survives) * waitCost * urgencyDamping(p.pos, ctx);

    const { bonus, reasons, blocked } = strategyAdjust(p, ctx);
    const score = blocked ? -Infinity : effVorp + bonus + TUNING.urgencyWeight * urgency;

    const notes = [...reasons];
    if (!blocked && myNext) {
      if (survives < 0.25) notes.unshift(`${Math.round(survives * 100)}% to last to ${pickLabel(myNext, teams)}`);
      else if (survives > 0.7) notes.push(`likely still there at ${pickLabel(myNext, teams)}`);
    }

    return { ...p, survives, waitCost, urgency, saturation: sat, effVorp,
             strategyBonus: bonus, score, notes, blocked };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    round,
    currentPick,
    myNextPick: myNext,
    picksUntilNext: myNext ? myNext - currentPick : null,
    available: scored,
    roster,
    replacement: levels,
    expectedLaterByPos: laterByPos,
    runs: detectRuns(recentPickPlayers(drafted, players)),
    pressure,
    elitePos,
  };
}

function recentPickPlayers(drafted, players) {
  return drafted
    .map((d) => players.find((p) => p.id === d.playerId))
    .filter(Boolean);
}

/** "3.04" style label for an overall pick number. */
export function pickLabel(overall, teams = LEAGUE.teams) {
  const r = roundOf(overall, teams);
  const inRound = overall - (r - 1) * teams;
  return `${r}.${String(inRound).padStart(2, '0')}`;
}

/**
 * The headline recommendation plus alternatives, already trimmed to what fits
 * on a screen someone is reading with a clock running.
 */
export function recommend(board, count = 5) {
  const live = board.available.filter((p) => !p.blocked);
  const top = live.slice(0, count);
  if (!top.length) return { pick: null, alternatives: [], alerts: [] };

  const alerts = [];
  for (const run of board.runs) {
    alerts.push({ kind: 'run', text: `${run.pos} run — ${run.count} of the last ${run.window} picks` });
  }
  const best = top[0];
  if (best.survives < 0.15) {
    alerts.push({ kind: 'now', text: `${best.name} will not last — ${Math.round(best.survives * 100)}% to reach your next pick` });
  }
  // Positions the teams in front of you are hunting for.
  const gap = board.picksUntilNext;
  for (const [pos, share] of Object.entries(board.pressure || {})) {
    if (share >= 0.4 && gap > 1 && (board.roster.need[pos] || 0) > 0) {
      alerts.push({
        kind: 'run',
        text: `${Math.round(share * (gap - 1))} of the next ${gap - 1} picks need ${pos} — it will thin out before you pick again`,
      });
    }
  }
  // Somebody good at a position you still need, about to be the last of a tier.
  for (const pos of Object.keys(LEAGUE.maxAt)) {
    if ((board.roster.need[pos] || 0) === 0) continue;
    const tiers = tiersFor(board.available.filter((p) => !p.blocked), pos);
    const topTier = tiers.filter((t) => t.tier === 1);
    if (topTier.length === 1 && board.myNextPick) {
      const p = topTier[0];
      const s = survivalProbability(p, board.myNextPick, board.currentPick);
      if (s < 0.5) alerts.push({ kind: 'tier', text: `${p.name} is the last ${pos} in his tier` });
    }
  }

  return { pick: best, alternatives: top.slice(1), alerts };
}
