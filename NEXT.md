# NEXT — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded in
`CLAUDES_LAST_RESORT_IS_TO_HIDE_THINGS_HERE_IDEALLY_YOU_COMPLETE_A_TASK_OR_NOT_BUT_DO_NOT_DEFER.md`.
Prefer deleting a sentence to negating it.

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log` and the
`reports/BENCHMARK_*.md` reports hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## In-flight right now — mud.html/adventure.html/chat.html P2P + design session (2026-07-29)

All six agents this session dispatched are done and merged: the NPC slider, mud.html's EDIT mode +
hardcoded-logic audit, chat.html's full P2P integration, adventure.html's direction-UI +
sprite-fallback + cast-sprite pass, and the project-wide sprite detail/pop + design-consistency +
copy audit (sprites raised to the badger detail bar across every family; spider-fly.html gothic
theme + corner cobweb; sprites.html Illustrator chrome + ancestor grouping; code-explorer/ingest
restyled; ledger/research restyled dark New-Relic-style; plan.html toward its DAW theme). Nothing
left running.

Both pages now also offer an alternate-scenario dropdown next to RESET (mud.html: mud-garden,
mud-hollow, mud-warren; adventure.html: ashcombe-hall, lantern-cottage, greyvale-museum), with EDIT
mode, the cast, the map, and P2P all following whichever scenario is currently loaded.

**Known gap:** a mud room is bound to the store it was opened over, so recasting (RESET, either
slider, or the scenario dropdown) drops the link and says so. Carrying a live room across a recast
needs the room to re-bind to the new store, which is a real piece of work in `p2p-room.mjs` rather
than page wiring.

**sprites.html variant cycles — next slice** (v1 shipped: `mgx:faces` left/right profile pairs for
bear/cat/dog/king as `[match]` variants, plus the catalog's auto-cycling variant swatch, which
already animates every `-with-emotion` class): extend the facing pairs across the rest of the
animal and person catalog, and design a profile-face anchor so a facing variant can carry the six
`mgx:feels` expressions at the same time.

**MUD3D — a rendered 3D town square, evaluated against `world-of-claudecraft`** (operator ask,
2026-07-29): full assessment written into `PLAN_MUD.md`'s new "MUD3D" section. Not yet scoped as a
build phase; the planning half (walk to market, buy leather, make armour) maps onto
`src/domain/planning.mjs`'s existing `findActionPath`, the render half would be a small tmct-native
Three.js layer rather than adopting claudecraft's `Sim`/`IWorld`.

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline):
bucket `tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`
(operator already ran `aws sso login --profile tmct-prod` this session). Full clean path is a push to
`main` with a remote — GitLab CI's `deploy:website` job. **Version is already rolled to 4.0.0**
(`42bf8129`) for this whole line of work — don't roll again for it.

## Open items

- [ ] **demo-page JS that belongs in tmct itself, audited toward lib > tool > ask (operator,
  2026-07-29).** Survey every `src/services/*-viz.mjs`/`src/surfaces/web/*-browser-entry.mjs` for logic
  that's genuinely reusable across pages (especially anything already duplicated between two or more
  demos) rather than specific to the one page that happens to host it today, and is not opinionated
  about which page imports it. For both that to-be-moved code AND whatever already calls into tmct from
  a demo page, work out which of it should become a real tool call rather than staying bespoke page JS
  — and where something could become a tool call, prefer whichever option keeps the most of the
  original natural-language request intact: move it into the plain library first if it doesn't need to
  be agent-invocable at all, promote it to a real tool if it represents an action a user's own words
  should be able to trigger, and prefer routing it through the existing `ask` tool specifically over a
  new bespoke tool wherever the request is really a question the graph can already answer. The reason
  this matters: the whole point of running many different demos (mud, adventure, spider-fly, chat, plan,
  ...) is to exercise tmct's own engine from as many directions as possible — so page-specific game/UI
  code that could instead be a generic library call or a real tool is exactly the gap between "a demo
  that happens to use tmct" and the actual target: a consumer surface where chat calls tools, backed by
  classical planning over the graph, with as little bespoke per-page logic in the way as we can manage.
  Concrete shape the operator gave for what "done" looks like: a page should be able to call a single
  generic function against a natural-language request and get back clean, render-ready data — e.g.
  spider-fly.html calling `fn("list the locations of flies and spiders")` for the grid, or
  `fn("get me the large sprite for a happy spider")` for one asset — routed through tmct's real
  NL-understanding/tool-calling pipeline rather than each page hand-rolling its own fact-store/sprite-
  resolver glue. Related operator principle to hold this work to: **if anyone views a demo page's
  source, it should read as a showcase of what tmct is capable of at the highest level** — the page's
  own JS should look like a thin, legible caller of real tmct capability, not obscured bespoke game
  logic with tmct calls buried inside it. Not yet started — a survey-and-plan task, not something to
  dispatch as a quick pass.
- [ ] a new AWS-hosted backend for the memory store — **needed for marginalia** (which is migrating
  onto tmct and needs a durable store that survives a Lambda's scale-to-zero, not a local file).
  tmct ships only `memory` (process-only) and `sqlite` (local file) today; the backend seam
  (`src/adapters/memory/core.mjs`) has no formal plugin interface — `sqlite`/`memory` are inline
  `isMemoryHandle`/`isSqliteHandle` branches, not a registered shape, so formalizing an explicit
  `{load, persist, close}` interface is worth doing as groundwork before or alongside this. marginalia
  already runs a working AWS-hosted graph store with the same underlying shape as tmct's sqlite
  backend — full materialization, mutate in JS, write-behind — against S3+DynamoDB instead of a local
  file: one JSON object per graph version in S3, with DynamoDB holding only a lightweight
  manifest/version-pointer row to the latest version. Build tmct's new backend the same way — an
  `s3`/`s3+dynamo` backend behind the existing `--memory-backend` precedence — so marginalia
  consumes tmct's backend the moment it lands here instead of maintaining its own AWS persistence
  layer. Full design writeup: `PLAN_MEMORY_BACKEND_AWS.md` (relocated from seonix's `PLAN_TMCT.md`
  2026-07-26; this is a tmct/marginalia concern, not a consumer-repo one)
- [ ] marginalia wants bedrock-meter-proxy's embedded over-cap fallback session grounded in
  marginalia's own memory graph, not tmct's default seeded persona — explicitly no timeline
  pressure, planning ahead. Ruled out the Repository Interface themselves (memory is documented as
  "tmct's alone", and the type vocabulary is code-graph-shaped, not conversational-fact-shaped —
  correct call, not something to revisit). Points at `openMemoryBackend`/`openConfiguredMemoryBackend`'s
  backend registry in `src/adapters/memory/core.mjs` as the real seam, same one the AWS-hosted
  backend item above would extend — these two are related, possibly worth designing together.
  Two candidate shapes, both genuinely undecided on their side: (1) periodic sync — marginalia
  exports flat fact triples in the same shape `export-jsonl.mjs` already emits, a scheduled job
  imports via the existing `tmct import --file` path into a store the proxy's Lambda reads at cold
  start; possibly zero new backend code needed, just confirming the import path tolerates
  marginalia's scale and refresh cadence. (2) live read-through — a genuine new backend querying an
  AWS-hosted store on every read/write, either speaking marginalia's DynamoDB schema directly (real
  cross-project coupling) or a thin client against a neutral flat-triple read API marginalia would
  expose. Full write-up: `PLAN_TMCT.md` §7 in the marginalia repo (§6 for the related bedrock-meter
  sidecar-routing ask). `~/.claude/inboxes/tmct.md` 2026-07-27T23:49.
- [ ] the ACE grammar's `resolveNP` has no N-of-N noun-phrase support (`"a unit of work"` parses
  with `residue: ["of"]` rather than as one noun phrase) — surfaced while widening multi-word
  class-name teach (2026-07-27), deliberately not fixed there: it's real grammar work outside that
  fix's region, not a routing gap. `src/domain/grammar/ace.mjs`'s `parseCopula`/`resolveNP`.
- [ ] `PLAN_AWS.md`'s two burn-in follow-ups, now that live execution (Phases 1-8) is complete
  and the CI pipeline is green end to end (`deploy:website`/`e2e:deployed`/`smoke:post-deploy`
  all passed on a real push, `https://tmct.polycode.co.uk/` confirmed serving HTTP 200): flip
  `e2e:deployed`'s `allow_failure: true` off once it has a longer green history, and run
  `SKILL_PAGE_WEIGHTS` post-cutover for `reports/PAGE_WEIGHTS.md` revision 2. Full status in
  `AWS_ACCOUNTS.md`'s provisioning-status section.
- [ ] `test-e2e/pages-ledger-teach.test.mjs` (bundle-load and refocus assertions) flakes under real
  multi-file e2e contention — investigated once more without a confirmed root cause. A solo run
  passes cleanly with wide timing margin (each `turn()` resolves in 1-2s against a 20s deadline).
  An attempt to reproduce under real contention (the full `test:e2e` directory, uncapped
  concurrency) produced only environment-artifact failures (`ENOENT`/cwd-removed errors across
  unrelated files), not a genuine per-test race — not usable signal. Best next attempt: a bounded
  run of `pages-ledger-teach.test.mjs` alongside 3-5 other heavy `pages-*` files via an explicit
  file list, in a worktree that already has a commit (so it can't be reclaimed mid-run), rather
  than the whole uncapped directory at once.


## Discipline

`CLAUDE.md` is the standing working model: the coordinator/background-sub-agent split, the test
blast radius, the versioning and push rules, and the repo-local identity. Read it there. This
section holds only what `CLAUDE.md` doesn't.

Three hard-won lessons, carried forward:

1. Background sub-agents sharing one working tree (no worktree isolation) can and did run
   destructive/shared git operations (`git stash`) meant only for the coordinator — recovered
   without loss, but now explicitly called out in every dispatch brief: sub-agents may only
   `git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`.
   Also: the harness's permission system blocks `git commit` for *background* sub-agents entirely
   in some configurations (no live user to approve a permission-gated action) — the coordinator does
   the committing itself in the foreground when this happens, verifying `git status` immediately
   before every stage to avoid sweeping in another track's pre-staged files. (Re-proven 2026-07-15:
   a `git add -A` swept another session's untracked design doc into a commit — caught and amended
   out. List paths explicitly, or review `git status` line by line first.)

2. A background sub-agent's own final "completed" notification is not reliable proof it actually
   finished — an agent reporting a vague "I'll wait for the Monitor notification" as its terminal
   output is a sign of unfinished work, not a status update, even when its worktree in fact holds
   complete, real, committed work. Always verify via `git log`/`git status` on the agent's own
   worktree directly before deciding whether to resume it or treat it as done — trust the commits,
   not the prose. An agent stuck repeating the same "still waiting" message across multiple
   notifications is a sign to `TaskStop` it explicitly rather than keep resuming, once its worktree
   confirms the real work is already complete.

3. Never resume (`SendMessage`) a round whose worktree has already been auto-removed — relaunch
   fresh instead. This was observed twice: once an agent fell back to operating directly in the
   coordinator's own shared working tree; on a later occasion this went as far as checking out a
   brand-new branch on the shared worktree itself (caught immediately via `git branch
   --show-current` returning something other than `main`, no work lost). The rule: before resuming
   any stalled round, check `git worktree list` for its path
   — if it's gone, `TaskStop` that round and dispatch a fresh one instead, never `SendMessage` it
   back to life.

4. Concurrent chat.mjs agents work when each brief pins its region (learn-on-miss block /
   logLines + slash commands / factReadBackReaders) and forbids refactors — but the merge gate
   must still rebuild the ask bundle (it inlines chat readers, so it drifts on every reader
   change), re-run the pack-manifest check (three separate agents forgot new `src/` files in one
   day), and watch for same-name declarations across branches (two batches both coined
   `spiderFlyContextAnswer`; esbuild's duplicate-symbol error at bundle time was the catch).
   Seed-content-dependent e2e pins are the other recurring merge hazard: raising the seed caps
   silently grounded the learn-on-miss demo's lookup term, and the sense-split chain rendering
   broke a source-adjacency pin — the fix each time is a probe against the real store, then the
   pin follows the behavior.

5. (2026-07-23) Lesson 2's pattern recurred three separate times in one session, across three
   different background sub-agents, each ending its turn on a variant of "I'll wait for the
   background monitor" while its own `npm test`/judge fan-out was still genuinely running as an
   untracked OS process. The fix each time was the same: verify via `ps aux` in the agent's
   worktree, then `SendMessage` an explicit correction telling it to stop backgrounding entirely
   and block synchronously in the foreground. Brief this into every dispatch up front next time
   ("run test commands in the foreground and let them block; do not end your turn on a command
   still running") rather than catching it after the fact three times running.
   Separately: `npm run roll` bumps the version and regenerates artifacts, but this session pushed
   the resulting commit without re-running `npm test` locally first, trusting CI to catch a
   problem — CI did (the screenshot-manifest gap above), but that's a real gap in this session's
   own discipline, not a success story. `npm test` green at every commit (`CLAUDE.md`'s own rule)
   applies to a roll commit too, even though `roll.mjs`'s own artifact regeneration feels like it
   should be self-verifying.

6. (2026-07-24) Lesson 5's brief line is necessary but not sufficient: with the up-front
   "foreground only, never end your turn on a running command" instruction in EVERY dispatch,
   four of eight background sub-agents in one session still ended turns on "I'll wait for the
   notification" — twice for runs that were genuinely live (those resume correctly on the real
   notification; leave them alone once `ps` confirms the process), twice for phantom waits
   (nothing running; `SendMessage` the correction, pointing at the teed log if the run already
   finished green). The triage that works: `ps aux | grep <worktree-id>` FIRST, then
   `git log`/`status` on the worktree — a live process means wait, a dead one means correct or
   take over. A second identical stall on the same agent means stop it and let the coordinator
   commit its (real, verified) work directly — that recovery took minutes and lost nothing.

7. (2026-07-24) The merge gate's blast-radius run is not a substitute for the full suite on a
   push to `main`. A merge whose own lane and estate guard were green went out without
   `npm test`; CI's `unit` job then failed on `test/adapters/memory-seed-perf.test.mjs`'s
   scaling ratio (12.72x against its 12x bar) — a contention flake, not a regression (the
   local full suite ran 4093/4093 straight after). Two corrections: run the full suite before
   every push that reaches the remote, and when a timing test flakes, harden it rather than
   re-running it. That test had already been hardened once (min-of-5 after flakes at 6.30x and
   10.49x); the remaining weakness is that a RATIO amplifies leftover noise asymmetrically —
   the long batch's every trial can catch contention while the short batch catches a quiet
   moment. Its bar is now 20x, which still leaves the whole quadratic band (64x up) outside.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `reports/BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
