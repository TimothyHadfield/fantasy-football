# Mid-season strategy: research notes

Written 2026-09-17, from Tim's own list of ideas plus a web search of what
published fantasy analysis says about each. Kept here so none of it is lost and
so a later session can build features on it rather than re-deriving it.

**How to read this.** Each of Tim's ideas gets a verdict, the evidence, and what
the site could do about it. Numbers marked *(derived)* are arithmetic done here,
not quoted from a source. Every claim that came from somewhere has a link.

**The standing constraint on all of it:** the site is an ADDITION to ESPN's app
and never a copy of it — see `HANDOFF.md`. A feature below is only worth
building if ESPN does not already answer it.

---

## The short version

- The ideas that rest on *"projections beat recent results"* are the
  best-supported: buy-low/sell-high on usage, and not paying for hot streaks.
- The ideas that rest on *luck, timing or insurance* are real but small: bye-week
  trades, opponent-timed trades, variance tactics, bench depth in a 10-team
  league.
- One idea is blocked by the platform: **ESPN allows only two-team trades**.
- The largest repeatable edges available to him are the dull ones: streaming
  D/ST by matchup (~1–2 pts/week), keeping the bench above replacement level,
  and being first to the right injury replacement.

---

## Tim's ideas, one by one

### 1. Trying to win vs trying not to lose (variance)

**Verdict: right direction, small effect. Use it only to break near-ties.**

The goal each week is the best chance of outscoring THIS opponent, not the most
points. An underdog should raise variance; a favourite should lower it.

- P(win) = Φ((μ_me − μ_opp) / √(σ²_me + σ²_opp)); team variance is the sum of
  starters' variances plus 2ρσᵢσⱼ for each correlated pair.
- With nine starters at σ ≈ 7 the margin's SD is ≈ 30. A 10-point underdog wins
  36.9%; swapping one starter of σ = 6 for one of σ = 10 at the same mean gives
  37.4% — **+0.4 percentage points** *(derived)*.
- Near a coin flip, one projected point ≈ 1.3 points of win probability
  *(derived)*, so that swap is worth ≈ 0.35 projected points.
- Simulation work agrees the effect is small and that **QB is the best slot for
  deliberate volatility**; in even or favoured matchups the best lineup had zero
  boom/bust starters ([Mike Reedy](https://x.com/MikeReedyFF/article/2095676964774597117),
  [Fantasy Math](https://nathanbraun.com/fantasymath/)).
- Best-ball research that values SD at 33–50% of points does **not** transfer to
  head-to-head ([Fantasy Footballers](https://www.thefantasyfootballers.com/articles/embracing-volatility-quantifying-the-value-of-variance-in-best-ball-fantasy-football/)).

**Site:** only ever surface this when two lineup options are within ~1 point, and
say which gives the better chance of winning the week.

### 1b. Gutting the bench to improve the starting lineup (Tim's clarification)

**Verdict: in a 10-team league, thinning the bench usually wins.**

Points lost to injury are not a different kind of loss, so "insurance" is just
expected value:

- A starter upgrade pays **every week**. A backup pays only in the weeks a
  starter is out, and only by his margin over the best free agent then.
- Worked example *(derived)*: bench RB projecting 11, best free agent 8, upgrade
  worth +4/week. P(one of two starting RBs out) ≈ 1 − 0.85² ≈ 28%. Backup worth
  0.28 × 3 ≈ **0.8 pts/week** against the upgrade's **4**.
- Depth only wins when the upgrade is under ~1 pt/week or the backup is far
  above waiver level.
- A 2-for-1 also frees a roster spot for an upside stash.

**Keep depth when:** the position is RB (the only pool that runs dry); several
starters share a bye; it is late season or the playoff weeks (weeks 15–17 cannot
be waited out and the wire is picked over); the backup would inherit a starting
job outright; or waiver priority is low, so the replacement may not be gettable.

**Season context decides the lean:** fighting for a place → maximise now;
comfortably in → protect weeks 15–17.

**Site:** the Trade page prices 2-for-1s week by week but assumes **nobody is
ever hurt**, which tilts slightly toward consolidation. An injury-aware price —
expected lineup with per-position miss probabilities and the best free agent as
fallback — would answer this per trade. Not built; Tim was asked.

### 2. Near-term vs far-term projections

**Verdict: weight weeks by what they are worth to YOU; discount later weeks a
little for availability.**

- Discount for availability: weight for week t+k ≈ (1 − h)^k, h ≈ 5–7%/week for
  RBs *(derived from the injury rates below)*.
- Tim's own example over six weeks: A = 101, B = 107 raw; ≈ 90 vs 94 discounted
  *(derived)* — the rising player still wins.
- Weight regular-season weeks by how much one extra win moves playoff odds, and
  playoff weeks by P(making the playoffs) × P(still alive that week) *(derived)*.
- Far-off matchup edges should shrink toward average: full-season strength of
  schedule is "nearly worthless" because defences change
  ([Blueprint](https://www.fantasyfootballblueprint.com/2026/08/07/strength-of-schedule/)).
- No published discount-rate research exists.

**Site:** a "lean" setting — value trades and players by weeks weighted for a
win-now team or a playoff-bound team.

### 3. Trading away players with an upcoming bye

**Verdict: real but small; do not pay for it.**

- A bye costs one week of (starter − replacement): ≈ 3–8 pts for a mid starter,
  10–12 for an elite one *(derived)*; ≈ 7% of a player's regular-season value
  above replacement, and nothing for playoff value.
- The opening is the manager facing a heavy bye week, who is under pressure
  ([Yahoo](https://sports.yahoo.com/articles/fantasy-football-strategy-tips-navigating-223108375.html)).

**Site:** already handled — the Trade page prices each week and a bye is 0 there.

### 4. "Sneak" trades — buying below-projection, selling above-projection

**Verdict: the best-supported idea on the list, IF judged on usage.**

- Preseason expectations out-predict this season's points until ≈ **week 4**
  ([Footballguys, FiT2](https://www.footballguys.com/article/HarstadFiT2)).
- A long-running column betting on overperformers regressing has gone
  **46–15 (75%)** over eight years
  ([Regression Alert](https://www.footballguys.com/article/2025-regression-alert-week-11)).
- **Sticky** (believe it): target share, targets/game (R ≈ 0.82 with WR output),
  air-yards share, WOPR ([Sharp](https://www.sharpfootballanalysis.com/fantasy/wide-receiver-stats-that-matter-fantasy-football-2023/)).
- **Not sticky** (sell it): receiving TDs (year-over-year r ≈ 0.40 WR, 0.28 TE),
  yards per carry (r < 0.30)
  ([Sharp RB](https://www.sharpfootballanalysis.com/fantasy/running-back-stats-that-matter-fantasy-football-2024/)).
- Believe a role change after **3–4 weeks** of changed usage (≈80% snaps, ≈20%
  target share) ([Fantasy Start/Sit](https://fantasystartsit.com/target-share-and-snap-counts)).
- No fantasy-specific "hot hand" study exists either way.
- Ethically fine: you are trying to improve your own team.

**Site:** a "luck gap" — actual points minus what usage predicts — to flag buys
and sells. **Open question: does ESPN's API expose targets/carries/snaps per
week to this league?** Not yet checked.

### 5. Three-way trades

**Verdict: ESPN does not support them. Chain two-team trades instead.**

- ESPN's help pages describe choosing ONE team to trade with
  ([ESPN](https://support.espn.com/hc/en-us/articles/360000959252-Proposing-and-Accepting-Trade-Offers)).
- Each leg is accepted and reviewed separately, so a leg can fall through or be
  vetoed on its own merits.
- Mitigation: do the leg you would keep on its own first, or announce the whole
  package to the league.
- A "circle" where one team takes a worse leg as a favour is collusion by ESPN's
  definition (below).

**Site:** the combo packer already finds sets of deals; it could look for chains
that only work together and say which leg must land first.

### 6. Streaming D/ST every 1–2 weeks (and K)

**Verdict: yes for D/ST, ~1–2 pts/week. Not worth it for K.**

- Hindsight ceiling 2023: a defence that always played the Jets would have
  scored 202; the best real D/ST scored 172; 1st to 11th spanned only 45 points,
  ≈ 2.6/week ([ESPN](https://africa.espn.com/ffl/story/_/id/40747409/2024-fantasy-football-draft-strategy-d-st-defense-streaming)).
- Active streaming usually lands around the season total of the 2nd–5th best
  defence ([RotoWire](https://www.rotowire.com/football/article/streaming-defenses-dst-picks-for-week-1-132259)).
- Best signal: opponent's implied team total (Vegas), not sacks/turnovers
  ([DraftSharks](https://www.draftsharks.com/article/streaming-defense)).
- Kicker projections are the least accurate of any position
  ([Subvertadown](https://subvertadown.com/article/accuracy-report-2025-weeks-5---8)).
- **Rolling waivers:** claim costs priority only on success; adding a player who
  has cleared waivers costs nothing
  ([ESPN](https://support.espn.com/hc/en-us/articles/4669787227668-Waiver-Order-Overview-and-Free-Agent-Budget-Tiebreakers)).

**Site:** "your D/ST this week vs the best free-agent D/ST, and the gain" — the
Players page already has the data.

### 7. Valuing a backup who only plays if a starter is hurt

**Verdict: usually overrated; price it, don't guess.**

- Weekly EV = P(starter out) × P(backup gets the role) × (his points −
  replacement). Example: 0.18 × 0.8 × (13 − 9) ≈ **0.6 pts/week** *(derived)*.
- Backups finished as a top-24 RB in only **34%** of the games their starter
  missed, 2011–17 ([PlayerProfiler](https://www.playerprofiler.com/article/the-definitive-case-against-handcuffs/)).
- Current consensus leans to ANOTHER team's high-leverage backup: your own only
  pays when you have already lost points.
- Value rises late in the season and in the playoff weeks, when the wire is thin.

### 8. Baseline: value over the best freely available player

**Verdict: this is standard theory (value over replacement), and Tim's version
is right with one nuance.**

- Replacement level = the best player actually gettable at that position, and it
  **moves every week** with byes and injuries
  ([FootballNationUSA](https://www.footballnationusa.com/post/replacement-level-fantasy-football)).
- A bench player at or below that line is worthless **as bye-week cover** — but
  not necessarily worthless: his value is the option
  E[max(0, future points − replacement)]. A 6-point stash with a 20% shot at a
  starting role beats a safe 8-point veteran with no path.
- Drop rule: drop if even his upside case would not beat replacement.
- In a 10-team league QB/TE/D/ST/K are deep on waivers, so the bench should be
  mostly RB/WR — about 4 RBs
  ([FantasyPros](https://www.fantasypros.com/2019/05/building-the-perfect-bench-fantasy-football/)).

**Site (highest-value build):** draw the replacement line per position on the
Players page and flag every bench player below it.

### 9. Trading with a manager based on when you play them

**Verdict: legitimate if you are genuinely improving, small edge, bad optics.**

- ESPN defines collusion as moves that help another team "without trying to
  improve its own position"; penalty is account cancellation
  ([ESPN Fair Play](https://support.espn.com/hc/en-us/articles/115003903111-Fair-Play-Conduct-Collusive-Transaction)).
- Vetoes: in Standard leagues 4 of the 8 uninvolved teams must vote no; LM
  leagues can set review differently
  ([ESPN](https://support.espn.com/hc/en-us/articles/115003850351-Veto-or-Protest-a-Trade)).
- ESPN's own advice: the veto is for collusion, "not deals that you simply wish
  you could have made yourself".
- Size: one player's bye or bad week swings a matchup 5–10 pts, a few points of
  win probability *(derived)*.
- Over the line: the other manager knowingly weakening himself for that week.

**Site:** show the week-of-matchup effect as a SECONDARY number, never the
headline, and warn when rest-of-season value is lopsided.

### 10. Stashing injured players; the IR slot

**Verdict: good for a playoff push. Watch the roster-invalid trap.**

- ESPN IR eligibility: only players listed **OUT** or **IR**; suspended players
  are not eligible ([ESPN](https://support.espn.com/hc/en-us/articles/115003849911-Players-on-Injured-Reserve-IR)).
- **Trap:** if a player in the IR slot loses his injury designation entirely the
  roster becomes **invalid** and ESPN blocks adds until it is fixed.
- After-effects: 2,523 time-loss injuries (2017–22) → **−0.50 PPG the following
  season** (QB −1.95, RB −0.70, WR −0.33); games missed did not predict the drop
  (R² = 0.005) ([PMC 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12804431/)).
  This is next-season data; the weeks right after a return are undocumented —
  practice is to discount the first 1–2 games back.
- Drop heuristic: if the expected return is after ~week 16, or the slot is needed
  for more playoff value.
- **Unchecked: how many IR slots his league has.**

### 11. Fast pickups of injury replacements

**Verdict: reliable at RB, much less at WR/TE.**

- RB: production often concentrates in one backup (e.g. Henderson 24.3 PPR PPG
  on 75–88% of snaps while Stevenson was out), though committees are commoner
  now ([Yahoo](https://sports.yahoo.com/fantasy/article/fantasy-football-justin-boones-backup-running-back-rankings-for-2026-171400772.html)).
- WR/TE: targets spread, so the backup inherits less.
- Rolling waivers: a failed claim costs nothing; save priority for a multi-week
  starter, use post-waiver free agency for streamers.

**Site:** rank claims by (weeks needed) × (replacement's projection − your
current starter), and flag high-snap RBs with a single clear backup.

### 12. ESPN's projection ranges / distributions

**Verdict: the data exists; the math only changes near-ties.**

- ESPN + IBM Watson publish a **Low and High projection plus Boom% and Bust%**
  per player-week (example: High 29.2, Low 11.3, boom 24%, bust 25%)
  ([ESPN](https://www.espn.com/espn/print?id=25419567),
  [IBM 2025](https://www.prnewswire.com/news-releases/new-ibm-watsonx-ai-powered-insights-help-elevate-espn-fantasy-football-for-2025-fantasy-football-season-302565889.html)).
  Watson fits the best of 24 distribution shapes per player; RMSE 6.78
  ([arXiv 2111.02874](https://arxiv.org/abs/2111.02874)). Which percentiles Low
  and High are is undocumented.
- **Found here, 2026-09-17, and not published anywhere:** the ordinary league API
  already carries uncertainty. Each projection entry
  (`statSourceId 1 / statSplitTypeId 1`) in the `kona_playercard` view has a
  **`variance` map keyed by stat id**, alongside its `stats` map. Summing
  `weight²·variance` over the league's scoring weights gives a points SD:
  Josh Allen week 2 2026 → proj 22.6, **SD ≈ 7.4** (P10 ≈ 13.1, P90 ≈ 32.2),
  which is a plausible QB spread. The same sum did NOT reproduce ESPN's own
  `appliedTotal` for non-QBs in a first pass, so the stat-id → weight mapping
  needs finishing before trusting it. Probe script:
  `scratchpad/range3.mjs` pattern — refetch with
  `view=kona_playercard&scoringPeriodId=N` and a `filterIds` filter.
- Use: back out σ from Low/High (if they are P10/P90, σ ≈ (High − Low)/2.56),
  then maximise P(team total > opponent total) rather than points.

---

## Things the research raised that Tim's list did not

1. **Stacking and anti-correlation.** A QB and his own WR score together
   (ρ ≈ 0.44 for one studied pair), which widens your range — good as an
   underdog, bad as a favourite. Starting your D/ST against your opponent's QB
   narrows it.
2. **Weekly projections are weak everywhere.** Across 11 seasons they explained
   only **3–23%** of weekly variance, and **averaging several sources beat any
   single one** ([FFA](https://fantasyfootballanalytics.net/2026/09/we-analyzed-11-seasons-of-dfs-projections-heres-what-we-found.html)).
   Weekly MAE ≈ QB 6.4, WR 5.2, TE 3.7.
3. **Volatility by position.** Weekly coefficient of variation (SD ÷ mean):
   QB 0.36–0.39, RB 0.54–0.63, WR 0.58–0.67, TE 0.63–0.70
   ([Underdog](https://underdognetwork.com/football/best-ball-research/weekly-variance-by-position-a-key-to-best-ball)).
   So QB is the most effective slot for deliberate variance, and player-level
   consistency persists year to year.
4. **Vegas implied team totals** are the most stable public signal for D/ST (and
   for game environment generally).
5. **The trade deadline is stricter than it looks:** a trade must be **accepted**
   — and any voting/LM review finished — before the deadline
   ([ESPN](https://support.espn.com/hc/en-us/articles/360000959192-How-does-the-Trade-Deadline-work)).
   Propose days early. **Unchecked: his league's 2026 deadline date.**
6. **Week 17 is the championship week and NFL teams rest starters** when they
   have nothing to play for. Not in any projection this far out.
7. **Schedule strength only matters for weeks 15–17**, and only as a tiebreaker,
   strongest for D/ST and K.
8. **Rolling waivers reward patience** — see 6 above.

## What nobody has published (and his site could measure)

- Whether a hot streak carries week to week in fantasy.
- How often waiver pickups actually work out.
- **How projection accuracy decays with horizon** — no source quantifies it.
  **The time machine can answer this**: every weekly reading stores what ESPN
  projected for every future week, so after a season the archive gives
  "how wrong was the week-12 projection made in week 3?" — which is exactly the
  discount rate idea 2 needs. One more reason the weekly reading matters.

## Numbers a feature could use

| Quantity | Value | Source |
|---|---|---|
| Weekly SD, typical starter | QB ~7–8, RB ~8, WR ~8, TE ~6 | derived from CV above |
| Weekly projection MAE | QB 6.1–6.4, RB 5.1–5.2, WR 4.8–5.2, TE 3.7–3.9 | FFA |
| Margin SD, two full lineups | ≈ 30 | derived |
| Value of one projected point near a coin flip | ≈ 1.3 pp of win probability | derived |
| RB availability | 13.7 of 17 games; only 27% play all | [Footballguys](https://www.footballguys.com/article/2025-running-back-milage-myth-what-numbers-say-about-workload-injuries) |
| Missed games, top-100 ADP | ≈ 3/season; RB ≈ 10% more than WR | [RotoBanter](https://rotobanter.beehiiv.com/p/are-running-backs-more-injury-prone-than-receivers) |
| P(a given starter misses this week) | RB ≈ 15–20%, WR ≈ 13–15% | derived |
| Handcuff hits when starter is out | ≈ 34% | PlayerProfiler |
| D/ST streaming gain | ≈ 1–2 pts/week | ESPN / RotoWire |
| Bye cost | 3–8 pts (elite 10–12), one week | derived |
| Watson projection RMSE | 6.78 | arXiv |

Measured in THIS project (public league 1241838, 2025, 70 games):

| Quantity | Value |
|---|---|
| Spread learned from real residuals | **21.8** (the site's 27 default is wide; 20.5 fit best) |
| Actual margin SD | 33.5 (model 30.9) |
| Favourites' actual win rate | **67.1%** — the model is slightly under-confident |
| Brier / log loss, site's method | 0.2199 / 0.633 (coin flip 0.25 / 0.693) |

## Candidate features, ranked by value per effort

1. **Replacement line + bench audit** on the Players page (ideas 6, 7, 8).
2. **Injury-aware trade pricing** (idea 1b) — the one Tim was asked about.
3. **Win-now vs playoff lean** weighting for trades and player value (idea 2).
4. **D/ST swap suggestion** for the coming week (idea 6).
5. **Buy-low / sell-high flags** from usage, if ESPN exposes usage per week
   (idea 4) — needs the API check.
6. **Near-tie helper** using the `variance` field above (ideas 1, 12) — needs the
   scoring-weight mapping finished.

## Open questions for Tim

- Does his league have **divisions**? (ESPN seeds division winners first; the
  simulation ignores divisions.)
- How many **IR slots**, and what is the **trade deadline** date?
- Should trade values count the **playoff weeks** (15–17)?
