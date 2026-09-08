# Draft Strategy

The spec for the "smart drafter." **Tim designs this; Claude builds it.**

Part 1 is Tim's own approach, in his words, recorded 2026-09-08. It is the
starting point, not a finished algorithm — it says what he does, not yet what
the tool should do or how strictly it should follow him.

Part 2 is outside research into whether each piece holds up. It is there to
inform Tim's decisions, not to overrule them. Where the research disagrees with
him, that is a question for him, not a licence to change the strategy.

---

## Part 1 — Tim's approach, as stated

### The draft

| Pick | Rule |
|---|---|
| 1 | First WR **or** RB available — whichever is top of the board. |
| 2 | Ideally the opposite position to pick 1. Not a big deal if it doesn't fall that way. |
| 3 | Another WR or RB — whichever of the two he has fewer of. |
| TE | Wants a decent one somewhere in rounds **3-6**. There are usually only about two genuinely great TEs, so taking one in round **2-3** is acceptable if it fits. |
| QB | Wait a long time. Late. |
| Rest | Balance the roster fairly evenly, without straying too far from the top players still on the board. |

### Two standing rules that cut across all of it

- **Take the faller.** If a player has been skipped for a while and is still
  there when Tim is on the clock, he takes them. He treats the gap between a
  player's expected slot and where they actually sit as value.
- **Stay near the top of the board.** "Balance" never means reaching. He
  balances the roster *among* the best players available, rather than drafting
  for need down the list.

### In-season QB plan

This is why he can afford to wait on QB in the draft, so the two are one
strategy, not two.

- Carry **2-3 QBs**.
- Each week, start whichever has the **higher projection**.
- Acquire them mostly through **adds/waivers**, not the draft.
- The reasoning: when a starting QB gets injured, the backup can go from ~0 to
  **18+ points per week**. Rostering the right backup captures that jump for
  free.

### Open questions for Tim

Things the strategy does not yet say, which the tool will need decided:

- How strictly should it follow the position rules vs. pure best-available?
  ("Not a big deal if I don't" needs a number.)
- What counts as "skipped for a while"? How many picks past expectation before
  a player becomes a take?
- What is "too far away from the top players"? A rank gap, a points gap, a tier
  break?
- Does any of this change by draft slot? (Research says it should — see Part 2.)

Settled 2026-09-08: the league is **10-team full PPR with 4-point passing TDs**
(full settings in Part 2), so the format question is closed.

---

## Part 2 — Outside research

Researched 2026-09-08, i.e. mid-draft-season for 2026. Sources listed at the
bottom. Findings are evidence for Tim to weigh, not decisions.

**Important context that shapes all of it — the actual league settings, supplied
2026-09-08:**

- **10 teams**, snake, **90 seconds** per pick, order randomised an hour before.
- **Full PPR** (1.0 per reception) with **4-point passing TDs**.
- 16 roster spots: 9 starters (QB, RB, RB, WR, WR, TE, FLEX, D/ST, K), 7 bench
  including 1 IR. Position maximums QB 4, RB 8, WR 8, TE 3, D/ST 3, K 3.
- 13-week regular season, **only 4 of 10 teams make the playoffs.**

Three consequences worth holding onto while reading the research below:

1. **Only two required WR.** Nearly every published strategy piece assumes three,
   and analysts are explicit that this setting should change your approach more
   than any other. It shifts the early RB/WR tiebreak toward RB.
2. **10 teams, not 12.** Every published slot-by-slot guide is written for 12.
   The waiver pool is deeper here and replacement level is higher, which makes
   punting a position cheaper than the articles suggest.
3. **4-point passing TDs.** This suppresses QB value relative to the 6-point
   leagues much of the advice assumes — an independent reason Tim's wait-on-QB
   instinct is right for *this* league specifically.

### Where the consensus backs Tim

- **Waiting on QB is the single most-endorsed idea in 2026 coverage.**
  FantasyPros calls QB "the most comfortable position to punt" this year and
  notes top-12 potential available outside the top 90 picks. CBS, ESPN, NBC and
  Draft Sharks all say the same. This is not a contrarian edge in 2026 — it is
  the mainstream position, which slightly reduces how much edge it buys.
- **Carrying two QBs and picking weekly is a named, endorsed strategy.** ESPN
  ran a piece specifically arguing you should "wait to draft a QB ... and then
  take two of them," drafting both in Round 10+. This is Tim's plan almost
  exactly.
- **"Only about two great TEs" is precisely right for 2026.** The elite tier is
  **Trey McBride and Brock Bowers**, with what one analyst calls "a cavernous
  gulch" between McBride and the next name (Mark Andrews). Both are considered
  worth a **late Round 2** pick — which is exactly Tim's "round 2-3 is okay if
  it fits." His fallback window of rounds 3-6 also matches: analysts describe TE
  as solvable "in the back half" with mid-range options.
- **Best-available over forced positional balance.** Repeatedly endorsed, at
  multiple slots: "take the best elite player available and worry about roster
  construction afterward"; "avoid forced positional balance"; "take value
  wherever you find it." Tim's rule of balancing *among* top players rather than
  reaching down the board is the mainstream expert view.
- **Staying flexible rather than committing to a named strategy.** FantasyPros'
  tip 3 explicitly advises *against* rigid Hero/Zero/Robust RB commitments in
  favour of an opportunistic approach. Tim's approach is opportunistic.

### Where the research pushes back, or refines

- **WR has been the safer early bet than RB — but that is format-dependent.**
  One study cited: RBs taken in Rounds 1-2 returned top-10 positional value 49%
  of the time and top-5 26%; WRs returned top-10 56% and top-5 44%. That argues
  for WR when the two are close. **But** it is drawn from 3-WR PPR norms, and
  FantasyPros is explicit that a league requiring only two WR should "lean
  toward RBs over WRs in the early rounds." Tim's league requires two. So his
  "first WR or RB available" is sound, but the *tiebreaker* when they are close
  should probably favour RB in his format, not WR.
- **Zero RB is genuinely contested this year.** PlayerProfiler argues it
  "severely limits the odds of winning" in today's NFL. Draft Sharks' own
  optimisation says the best PPR build at pick 4 *is* Zero RB, because RB prices
  are inflated in 2026. Both can be true in different formats. Tim's approach is
  neither, which is defensible — but it means the tool should not hardcode a
  lean either way.
- **"Take the faller" is the weakest-supported of Tim's rules.** The consensus
  is that fallers usually fall *for a reason* — injury, off-field news, bad camp
  reports — and that taking them blindly is a known trap. The 2026 example
  analysts keep citing is Puka Nacua, whose ADP dropped on a psoas injury plus
  off-field headlines. **The useful distinction for the tool:** a player falling
  because the room just took three RBs in a row is real value; a player falling
  because news broke this morning is not. Same observation, opposite meaning.
  Detecting which is which is a genuine feature, not a footnote.
- **Draft slot matters more than Tim's strategy currently accounts for.** Draft
  Sharks quantifies a best slot *per format*: PPR pick 4 (347.9 "3D value"
  points), half-PPR pick 1 (345.9), non-PPR pick 1 (361.8, with picks 4-6 worst
  at 348.6). Separately, pick 12 is reported to capture 11.9% fewer value points
  than pick 1. They also claim optimal drafting beats ADP-drafting at *every*
  slot, by 1.1% to 20.5%. Slot-specific shape, from FanDuel's per-slot guide:
  picks 1-3 take elite talent and sort construction later; 4-6 buy the freedom
  to attack value; 7-9 prefer an elite WR over reaching for an RB; 10-12 should
  treat the two turn picks as one combined decision.

### 2026-specific, worth knowing now

- **QB depth is unusually good.** Names repeatedly cited as available late:
  Trevor Lawrence, Jaxson Dart, Brock Purdy, Matthew Stafford, Bo Nix, Dak
  Prescott. Several are called low-end QB1s available Round 7+.
- **Rushing is the differentiator among late QBs.** Since 2019 the overall QB1
  has run for **at least 4 rushing TDs and 350 rushing yards every single year**,
  and 9 of the past 15 top-3 QB seasons had 4+ rushing TDs. If Tim is punting QB
  and picking two, this is the filter that separates the two he should take.
  It is also a concrete, codeable rule.
- **Named 2026 values:** Brock Purdy, D'Andre Swift, Zay Flowers, Matthew
  Stafford late.
- **Named caution:** don't pay up for players whose ADP is inflated by hype
  rather than production.
- **TE is a buyer's market outside the top two** — let the room's behaviour
  decide. If the top TEs go early, wait and take the value falling elsewhere.

### What this implies for the tool

Not decisions — candidates for Tim to accept or reject.

1. **It needs to know the draft slot**, and probably the scoring format, before
   it can give slot-correct advice.
2. **Faller detection should be two-signal**, separating "fell because of a
   positional run" from "fell because of news." Without that, Tim's own rule
   turns into the documented trap.
3. **QB pairing should consider bye weeks and schedule**, not only weekly
   projection. ESPN's version pairs QBs whose tough matchups do not overlap —
   that is a draft-time decision Tim's weekly-projection rule cannot recover
   after the fact.
4. **Rushing volume should be a tiebreaker among late QBs.**
5. **The RB/WR tiebreak should be driven by the league's starting requirements**
   (2 WR here), not by generic 3-WR-league advice.
6. The backup-QB-jumps-to-18ppg claim is **plausible but unverified** — no
   source found that quantifies it. Tim's own ESPN data could test it directly:
   pull QBs who took over mid-season and compare their before/after per-game
   scoring. That is a real analysis the site could run.

---

## Part 3 — What was built

Built 2026-09-08. `draft.html` + `js/draft-model.js` + `js/draft-page.js`.

**The 90-second constraint drove the design.** One oversized recommendation card
readable at a glance, four alternatives, and an alerts strip. Number keys 1-5
draft the corresponding card, `/` jumps to search, `u` undoes. Nothing below the
fold is needed to make a pick. The board state survives a browser refresh,
because losing it mid-draft would be unrecoverable.

### What the engine computes

| Piece | What it does |
|---|---|
| **VORP with moving replacement** | Value above the last startable player at that position. The bar rises as starters get taken, so scarcity appears on its own rather than being asserted. |
| **Survival probability** | Chance a player reaches your next pick. Conditioned on him already being available, so a faller is correctly judged more likely to keep falling. |
| **Cost of waiting** | Expected best at that position at your next pick, subtracted from the best now. This is the number the take-or-wait decision actually turns on. |
| **Opponent needs** | Which positions the teams picking before you still have holes at. A position four of the next eight teams need empties faster than its ADP implies. Derived from the snake itself, so it works without team ids. |
| **Tier breaks** | Gaps judged against each position's own typical gap, so it works at QB and at K. |
| **Run detection** | Positions taken unusually fast recently. |
| **Faller split** | Healthy fallers get a bonus; fallers with an injury flag get a warning instead. This is the two-signal rule the research called for. |

### Tim's rules, as encoded

All in `strategyAdjust()`, all as points-equivalent adjustments so they can be
weighed against value rather than overriding it. Rounds 1-3 RB/WR with the
pairing and the thinner-position tiebreak; elite TE allowed in rounds 2-3,
otherwise the 3-6 window; QB suppressed before round 8 then wanted, twice, with
a rushing bonus; K and DST locked out until round 15.

Two hard blocks that are *not* negotiable, because a bonus is not enough:
league position maximums, and spending a pick on a luxury when the picks
remaining equal the starting slots still unfilled. The second one came out of a
test: an elite TE falling to round 15 out-scores a kicker on raw value every
time, and taking him leaves you starting nobody at K.

### Practice mode

**It needs nothing.** No league, no ESPN login, no setup — a green bar on every
page starts one, and `draft.html?practice=1` drops you straight into a live
board. Practice always uses the built-in 2026 pool, which is real players
already scored under Tim's own rules, so there is nothing to gain by requiring
a login and a lot to lose. The draft slot is randomised the way the league does
it an hour beforehand, and the room announces which one you drew along with
your first three picks.

`js/draft-sim.js`. A full mock draft against nine simulated managers, in the
same room, with the same assistant. Pick from the same card, keyboard and all;
the nine replies between your turns resolve instantly and are named in the
status bar, because practice that takes as long as a real draft would not get
used. Undo rewinds past the opponents' replies to your own last pick — undoing
one fake manager's pick would leave the board in a state that cannot occur.

**The opponents are deliberately not our own engine.** A room full of copies of
this model would teach Tim to beat himself, not to beat ten people drafting off
ESPN's list. They follow consensus with noise, chase their own roster holes, and
make ordinary mistakes. Three settings: casual reaches and panics, normal sits
near consensus, sharp is disciplined.

Afterwards it grades the draft: projected starting lineup with the flex
optimised, rank against the other nine, a letter grade scored relative to *that
room* rather than an absolute scale, a slot-by-slot comparison against the same
slot on every other team, value captured against ADP, and bye-week pile-ups
among starters. Results are kept in the browser so the record accumulates.

The most useful number on that screen is the last one: **what the assistant
itself would have scored from the same slot.** Grading against an abstract
scale says little; grading against the advice you were given says whether your
deviations helped.

Benchmarked over 60 simulated drafts per difficulty, the engine averages 1.77th
of 10 against normal opponents and 2.10th against sharp ones, finishing top
three in 56 and 50 of 60 respectively. That is a sanity check on the engine, not
a promise — the opponents are simulated and the projections are one snapshot.

### Knobs Tim can turn

Everything judgement-based is in `TUNING` at the top of `js/draft-model.js`,
deliberately not scattered through the logic. The ones most likely to want
changing: `urgencyWeight` (how much scarcity matters vs raw value),
`pressureWeight` (how much opponent needs bend the survival curve),
`fallerThreshold` / `fallerMaxBonus`, `qbEarliestRound`, and `teWindow`.

### Still open

- The **live ESPN draft feed is untested** against a real draft. Manual mode is
  the fallback and is fully functional; sync is an accelerator.
- **Rushing yards/TDs are not decoded from ESPN yet**, so the rushing-QB rule
  fires on demo data but not live. It degrades quietly rather than lying.
- The open questions in Part 1 are still open. The numbers currently in `TUNING`
  are placeholders standing in for Tim's answers, not his answers.

### Sources

- ESPN — [wait on QB, then take two](https://www.espn.com/fantasy/football/story/_/id/49366921/fantasy-football-draft-strategy-qb-pairings)
- FantasyPros — [10 tips to win your 2026 draft](https://www.fantasypros.com/2026/09/10-tips-to-win-your-2026-fantasy-football-draft/)
- FantasyPros — [how to draft tight ends 2026](https://www.fantasypros.com/2026/08/fantasy-football-strategy-how-to-draft-tight-ends-2026/)
- FantasyPros — [expert draft strategy: QBs 2026](https://www.fantasypros.com/2026/06/fantasy-football-draft-strategy-targets-avoids-quarterbacks/)
- FanDuel Research — [strategy for every draft slot, 12-team PPR](https://www.fanduel.com/research/fantasy-football-advice-draft-strategy-for-every-draft-slot-in-a-12-team-ppr-league)
- Draft Sharks — [best draft position 2026](https://www.draftsharks.com/article/best-draft-position-fantasy-football)
- Draft Sharks — [elite QB or late-round QB](https://www.draftsharks.com/article/fantasy-football-draft-preview-quarterbacks)
- PlayerProfiler — [bust rates: Zero RB vs Robust RB](https://www.playerprofiler.com/article/joe-mixon-fantasy-football-ranking-stats-profile-robust-rb-bust-rates/)
- CBS Sports — [veteran experts: rankings, tiers, best 150](https://www.cbssports.com/fantasy/football/news/2026-fantasy-football-draft-prep-veteran-experts-reveal-rankings-draft-strategy-tiers-best-150-picks/)
- CBS Sports — [end-of-August ADP review](https://www.cbssports.com/fantasy/football/news/fantasy-football-adp-average-draft-position-september-best-values/)
- Athlon — [when ADP matters and where it misleads](https://athlonsports.com/fantasy/fantasy-football-101-average-draft-position-explained-adp)
- NBC Sports — [2026 draft strategy mega guide](https://www.nbcsports.com/fantasy/football/news/2026-fantasy-football-draft-strategy-mega-guide)
