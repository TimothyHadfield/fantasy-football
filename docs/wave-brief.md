# Wave brief (2026-10-08) — common rules for the per-page builders

You are one of eight builders, one per page, working at the same time in separate worktrees. Read, in this order: `~/.claude/skills/design-taste/SKILL.md`, this file, `docs/previews-plan.md`, `docs/colour-plan.md`, and (Stats and Schedule only) `docs/charts-plan.md`. Tim's words are quoted verbatim at the top of each plan.

## What every builder does on its page

1. **Previews** — everything listed for your page in `docs/previews-plan.md` (class A = none today, class B = bad today), following its "Rules for every builder". Re-measure your page first; build what is there now, not what the audit saw.
2. **Connectors** — a click on a preview goes where the plan says.
3. **Colour** — everything listed for your page in `docs/colour-plan.md` "Build"; nothing from its "Leave uncoloured" list.

## The shared base you build on (already merged — read the source headers)

- `js/pop.js`: `statCard(spec, {prefix})` → attribute string; `wirePops(container, {selector, card})`; `clearPops(prefix)`; `teamWeekCard({team, week, total, starters:[{slot,name,pts,proj?}], href})`. Spec: `{title, sub?, head?[], rows:[{label, value, note?, lead?, html?}], totals?[], total?, foot?, href?, hrefLabel?, tableHtml?}` (`tableHtml` = a trusted table of more than three columns). Hover/focus shows; click or Enter follows `href`; a finger tap opens a sheet with an Open button. The element's `title` is removed.
- `js/player-card.js`: `playerCardFromWeeks(weekTeams, player, {weeks, currentWeek, byes, href})` → pass to `registerRun(card, prefix)`, then `tipAttr(key, {go: true})` and `wireTips(container)`. Unheld weeks draw as waiting. `clearRuns(prefix)` on each redraw.
- `js/links.js`: `teamHref(id, week?)`, `playerHref(id, week?)`, `weekHref(week)`, `statsHref(teamId?)`, `readParam`, `readIntParam`. Working targets: `analysis.html?team=&week=#rosterDetail`, `waivers.html?player=[&week=]`, `schedule.html?week=`, `stats.html?team=`.
- `js/heat.js`: `heatOf` words are now plain ("3rd lowest of 10 · avg 123.5 for week 1") and it also returns `{rank, lowRank, of, mean, standing, avgText}`; `heatStanding(value, scale)`; `ordinal(n)`.
- `js/charts.js`: `createTooltip(container, {navigate})`, `lineChart`/`histogram` `opts.hrefFor(index,label)`, `boxPlot` rows `.href`, `scatterChart` `opts.card = {show, hide}` + `card` key per point.
- Example of a page already on the shared card: `js/stats-page.js` (`oppPopSpec`, `futurePopSpec`).

## Hard rules

- **Files:** only your page's files (named in your prompt). `css/app.css`: append ONE clearly commented block at the end, touch nothing else in it. `tests/counts.json`: change only the lines of suites you changed. Never the handoff .md files, never another page's JS, never the data layer (`season.js`, `store.js`, `espn.js`, `connection.js`, `cloud.js`) unless your prompt says so. If you need a change in a shared module (`pop.js`, `player-card.js`, `links.js`, `heat.js`, `charts.js`), make it additive and backwards compatible, keep it small, and list it in your report (others are doing the same).
- **No SD / "step n of 4" / z-score wording anywhere a reader can see it**, including `aria-label`s.
- **No new always-visible words.** `node text-audit.mjs` (in tests/) enforces per-page ceilings; it can report "trade.html never settled" on this busy machine — that one line is a known false alarm, any other failure is yours.
- Nothing moves or resizes on hover or tap. No page overflow at 393px. Two real layouts.
- No new ESPN requests unless your prompt allows them; the phone's synced copy never forces a network read.
- Never Tim's account or private league; the public test league is 1241838 (weeks 1–4 final, week 5 current).
- **Tests:** add checks for what you build; a new test is vacuous until you have seen it fail on the unfixed code — show that. Run the suites you touch, your page's suites, `pop-check`, `touch-check`, `test-pages-render`, `text-audit`. Not the full suite.
- **Verify headless only** (never open a window): start `python -m http.server <free port> --bind 127.0.0.1` in the background from YOUR worktree, and curl a file you changed to confirm it is your worktree being served (ports collide between agents). `node ~/.claude/tools/phone-view.mjs http://127.0.0.1:<port>/<page>.html [--desktop] [--full] --do 'fill:#connLeague=1241838' --do 'click:#connSync' --do 'wait:#modeBadge.live' [--do click:SEL ...] --eval "<js returning a promise>" --out shot.png`. Check 393px (default) and `--desktop`; open at least three of your new previews at each width and LOOK at the screenshots. `tests/node_modules` may be missing in a worktree: link it to the main checkout's with a junction.
- **Commit** on your worktree branch with explicit paths (never `git add -A` or `.`). Do NOT push or merge. Commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Report (short, exact)

Branch + commit · what each listed item got (built / skipped and why) · shared-module changes · tests with counts and the fail-first proof · what you measured and saw at each width · every visual/wording/naming choice Tim didn't specify, one line each · NOT verified.
