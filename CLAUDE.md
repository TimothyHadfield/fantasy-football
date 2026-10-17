# Fantasy Football — how to work here

Live: https://timothyhadfield.github.io/fantasy-football/ · Repo: https://github.com/TimothyHadfield/fantasy-football
Tim's global rules (`~/.claude/CLAUDE.md`) and `Code Projects/PROCEDURE.md` apply. This file wins on anything project-specific.

## Handoff files (read in this order)
1. [PROGRESS.md](PROGRESS.md): current state, standing instructions, rules not to re-litigate, Traps. Read it first.
2. [CHAT.md](CHAT.md): one entry per session; read the last few.
3. Plans in `docs/*-plan.md`; old detail in `docs/archive/`. `HANDOFF.md` only points to PROGRESS.md.

## Tests
- Node suites in `tests/` (own `package.json`; `npm ci` there once, and in every fresh worktree).
- Run one suite: `cd tests; node <suite>.mjs`. Trade stub scenarios: `node --import ./tr-register.mjs tr-test.mjs <name>`.
- Run only the suites a change touches. Never a long run before a push (Tim, 2026-10-06). `node run-all.mjs` (~30–40 min) and full `tr-test` (25–60 min) go in the background, after the push if at all.
- `tests/counts.json` counts may only rise. `tests/text-ceilings.json` caps on-screen words per page; growth needs a dated reason in its `measured` note (new prose sentences are Tim's call).
- CI: `.github/workflows/test.yml` (5 shards) runs on every push and deploys only when green. `gh run list -R TimothyHadfield/fantasy-football -w tests`.

## Deploy
- Push from this folder (`git rev-parse --show-toplevel` must end in `Fantasy Football`), explicit paths only. `git fetch` + merge `origin/main` first.
- Then publish at once: `gh workflow run deploy-now.yml -R TimothyHadfield/fantasy-football`.
- Confirm live by curling a changed file (strip CRs before comparing); tell Tim to hard-refresh. Pages caches js for 10 min.

## Builders
- Worktrees go in this repo: `git -C "<this folder>" worktree add .claude/worktrees/<name> -b <branch>`. Never the Agent `isolation: "worktree"` option (it lands in the Code Projects root repo).
- Headless checks: `node ~/.claude/tools/phone-view.mjs <url> [--desktop]`. Public test league 1241838; demo data otherwise. Never read Tim's private league 476225250.

## Fantasy exceptions to design-taste
- **Hover previews everywhere**: a hover/focus card for a mouse, a bottom sheet on tap; each minimal, never repeating what is on screen.
- **Options are switches inside each box**, synced across identical boxes, not in a Settings page.
- **No scrolling inside a box** (page scroll is fine). Sideways scroll of wide tables on the phone is accepted.
- House panel shape: title, one lede, controls, table, one-line key, `<details class="explain">`.

## Overrides of global rules
- **Push now, test after** (Tim, 2026-10-06: "forget the test. push now."; "make sure you don't ever do long test runs again"): only touched suites before a push; never push a suite seen failing.
- **Recommended option = just do it** (Tim, 2026-10-08: "if you ever have a recommended option for something, just go with it").
- **New formulas, metrics or models**: plan first and tell Tim before building.
- Test account: none needed; the public league 1241838 is the live fixture. `.claude/test/` stays gitignored.
