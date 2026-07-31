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

## In-flight right now (2026-07-30)

**`PLAN_TOOL_SURFACE.md` is fully landed, this session — all 11 phases, including phase 11's
mechanical splice conversion and the coordinator's own read-through of every page's chat/dock
surface against the operator's "thin caller of real tmct capability" test (no violations found).
Archivable.** Phases 1-10 landed as follows: Coordinator + background
sub-agents pushed phases 1-5 and 7 to done: the pure-library sweep and `phraseForRelation` (all ten
demo pages now share `turn-session.mjs`/`viz-boot.mjs`/`viz-room-graph.mjs`/`viz-theme.mjs`/
`viz-ticker.mjs`/`memory-stats.mjs`/`ask-vocab.mjs`/`game-config.mjs` instead of duplicating them),
Gap B (`dispatchToolStructured`, tool answers now carry `{ content, data }`), the code-explorer
proof (its sidebar asks `tmct_ask` for real instead of filtering rows by hand — and found the doc's
own `tmct_related` premise was wrong along the way, corrected in place), Gap A (memory-graph binding
is a first-class `KINDS.MemoryTerm` capability-planner kind — router half only; the eight
browser-entry callers still pass an empty graph, tracked below), and mood-becomes-a-fact
(`spider-fly.mjs` writes a real `mgx:feels` fact per agent per turn; `emotionFor`'s prose-parsing is
deleted). See the doc's own Phasing section for exact detail per phase.

Phase 6 landed too, by the `ask` route Theme 2 recommended. `ask-vocab.mjs` now carries a
`WORLD_RELATIONS` table (`mgx:currently-in`, `mgx:feels`, `mgx:mass`, each with its listing nouns),
`ask.mjs` compiles "list the locations of flies and spiders" — and its where/position/mood/mass
paraphrases — into a `worldRelation` AST over one predicate with a multi-class subject filter, and
`worldRelationGraphPayload` projects a world's fact rows into a graph `ask` can traverse, folding
`@turnN`/`@stepN` rows onto their base subject so the answer is this turn's board. The spider-fly
page builds that graph before every chat turn; `session.snapshot()` is untouched and still the
render fast path.

Two NEXT.md items from before this session are also done: **the mud room rebind** (`p2p-room.mjs`'s
`rebind()` swaps a live room's store while keeping peers connected; `adventure.mjs`'s
`foldWorldState` is epoch-aware so a stale pre-recast snapshot can't outrank a fresh one — real
remainder tracked below) and **the two test-coverage gaps** (a new
`test-e2e/pages-service-worker-cache-bust.test.mjs` proves the redeploy repro end to end; the four
existing chat/ingest/code/research e2e files now assert their fact-count pill's live DOM value, not
just its generated markup).

**Sprites.html's turntable + move-pose catalog landed, this session.** An operator-requested
expansion of what was "extend facing pairs, next slice": a 5-point turntable (left/half-left/
centre/half-right/right, up from left/centre/right) crossed with a new `mgx:pose = "moving"` axis,
both crossed with the existing six `mgx:feels` moods. The resolver supports combining several
`[[match]]` constraints in one template (`src/domain/sprite-templates.mjs`'s header carries the
exact shape and anchor arithmetic), proven on bear/cat/dog/king first, then rolled out across every
remaining animal and person class in the `*-with-emotion.toml` catalog — 987 sprite-tier TOML files
total, ~9 per class (facing-left/right, facing-half-left/half-right, the four combined
facing+moving frames, one centre-facing moving-only file), verified with zero gradient-id
collisions and zero unresolved placeholder tokens across the whole set. Ten parallel content
sub-agents landed this in eleven merges, most needing a hand-reconciled conflict in the shared
`test/adapters/sprite-large-template-files.test.mjs` (several independently discovered and
worked around the same "does this class have its own centre-moving file" question under different
names — `CLASSES_WITH_CENTRE_MOVING` is the name that survived reconciliation). The sprite content
wave is done, and so is the demo UI for it: `sprites.html` now animates three axes per card at a
shared 800ms frame delay — the pre-existing mood cycle (top-left, unchanged), a new 5-angle turning
sweep in the plain swatch's slot, and a new idle/moving toggle in the happy swatch's slot, using the
`mgx:pose = "moving"` templates live rather than deferred as originally scoped. `tmct_sprite`
(phase 8) is landed too — the tool, its capability record, `FRAMES` entry, and `class` slot binding
through the existing tier-2 memory-fact-term oracle rather than a new one; "large" resolved to the
scale tier `data/sprites-large/` ships, re-confirmed against the real 987-file catalog.
`spider-fly-viz.mjs`'s five-argument sprite call collapsed into `src/domain/sprite-request.mjs`.
Phase 9 landed too: `sprite-catalog-viz.mjs`'s two hand-rolled parsers are gone —
`answerSpriteQuestion` deleted in favour of two generic `chat.mjs` lanes (a noun-phrase-aware class
match shared by the membership/count lanes, and a new object-fronted property lane that reads a
folded predicate straight off the question, so `mgx:accept-emotion`/`mgx:take-parameter`/
`mgx:offer-variant` all answer with no hand-kept property-word table), and `extractSceneItems`
moved into `src/domain/scene-compose.mjs`, resolving each span through `resolveObject`'s exact
tier only (the fuzzy tier's "wood"→food/"glass"→grass matches are fine for a cited sentence, wrong
for a sprite drawn silently). The cold-session `ask` condition Phase 6 flagged is fixed too —
`chat.mjs` now prefers a passed-in graph whenever it holds individuals, so a fresh browser session
answers a world question on its first turn, not its second.

Gap C (phase 10) landed too: one `globalThis.tmct` — `open`/`session`/`turn`/`ask`/`plan`/`page` —
replaces all eleven per-page global bags across 51 files. `ask`/`plan` are supplied per page
(`engine-surface.mjs` carries the two standard ones: `graphAsk` via
`dispatchToolStructured("tmct_ask")`, `enginePlan` via `buildCapabilityPlanCtx`'s memory-only
mode); a page wiring neither refuses honestly rather than failing on a method it never had.
`open` is a fifth name beyond the plan's original four, needed because page-specific open options
(a payload, a world, a roster) can only come from the page itself. Each page's residual bag shrunk
to whatever still has no natural-language form — canvas geometry, sprite templates/resolution,
digest and affordance readers, vendor/provider registration seams; `code-explorer-viz.mjs` keeps
its factory in a bag too, because the page's own session slot is created lazily on the first turn
rather than the one `tmct.open` would install eagerly. Two real bugs surfaced and were fixed
mid-migration: a rename sweep had silently eaten the
page-lifecycle globals that share the `tmct*` prefix (restored), and three e2e probes were still
checking a member (`window.tmct?.createLedgerSession`) that can no longer exist under the new
shape (fixed).

**This session's work is now reaching CI.** The push restriction lifted; `v4.1.0` (phases 1-9 of
this plan, the mud rebind, the sprite catalog + its animations, the two test-coverage gaps,
`PLAN_FACT.md`'s supersession design) shipped and pushed first, full suite green (5268/5268)
before the push. `v4.1.1` plus Gap C follow behind it as a second push once Gap C's own merge is
verified — see `git log` for the exact commit sequence and CI status.

**MUD3D renamed MUDIII, design only — not yet a build phase.** Full assessment (asset licensing
against `world-of-claudecraft`, planning-domain mechanics, naming/lineage research re: Richard
Bartle/mudii.co.uk) is in `PLAN_MUD.md`. Operator's chosen sequencing: ship `mudiii.html` with
credit to `world-of-claudecraft` and MUD1/MUD2 first, email Bartle once it's live. Still waiting on
the operator's call on timing for that email — noted directly in `PLAN_MUD.md`.

**`PLAN_FACT.md`** (multi-record-per-assertion fact model) is a complete, reviewed design doc, not
yet implemented. See the doc for the worked example, the Sybil/Riak-sibling-resolution research, the
"as of &lt;date&gt;" grammar design, and the migration/schema.

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## In-flight: PLAN_FACT.md landing order (2026-07-30, coordinator + worktree sub-agents)

Batch A (NEXT items 1/3/4/5 plus PLAN_FACT steps 1-2) landed in full, merged to `main`, full suite
green (5352/5352), pushed. Plan: `~/.claude/plans/please-use-the-coordinator-witty-riddle.md`. Now
driving PLAN_FACT's remaining landing-order steps 3-8 in dependency order (steps 3→4 solo, then
5/6/7 concurrent, then 8 solo — each step's own file-ownership rationale is in the plan doc).

- [x] Batch B — PLAN_FACT step 3, the re-key — merged, 4936/4936 non-e2e tests passed on the
  worktree. One Fact record per assertion (`fact:<hash>@<sourceId>`, `#v<n>` once superseded),
  `readFactRows` folds one row per group reading live heads only, `computeAssertionGroupTrust`
  aggregates at read time with per-record recency. Two real defects fixed along the way
  (supersession reading the wrong timestamp source; a provenance-less write silently swallowing
  syllogise), not just expectation drift. Known, correctly-deferred gap: peer-teach records score
  0.95 in the group aggregate, not the plan's worked-example 0.97375, until step 6's
  `src:teach-node:` reliability-tracking join lands.
- [x] Batch C — PLAN_FACT step 4, resolver table — merged. Closed predicate-keyed strategy table
  (`src/domain/memory/resolution.mjs`, new) — `merge`/`latest-observation-wins`/`first-claim-wins`/
  contradiction default. `MULTI_VALUED_PREDICATES` is now derived from the merge row, one authority
  instead of two. `effectiveObservedAt`/`resolveSiblingGroups` implement the read-time fallback
  chain and the full tie ladder. All three named consumers (`recomputeSourceReliability`,
  `inspect.mjs`, `ledger-viz.mjs`) needed expectation updates only, no code changes.
- [x] Batch D — PLAN_FACT steps 5/6/7, all three merged (dated teach frame; Sybil tiers 1+2; two-pool
  compaction). Peer-teach trust verified at the plan's own worked example: 0.97375 for a fresh
  node's first fact. Compaction's CRDT convergence/drop-on-absorbed properties mutation-tested.
- [ ] Batch E — PLAN_FACT step 8, `fact_heads` materialization (the final landing-order step):
  worktree dispatched, Opus. Status: started.
- [x] WebRTC connect-UX redesign (chat.html + mud.html) — merged. A shared `share-overlay-viz.mjs`
  full-page "lights down" component replaces chat's netPanel/joinCard and mud's independently-
  duplicated net-panel/join-card: a two-browser wire diagram doubling as connection status, a
  5-step ladder shared between sponsor/joiner roles, copy-link + copy-code-only + navigator.share +
  wa.me affordances, a node roster with last-shared-fact and directional wave-to-one/wave-to-all,
  WebRTC reference links. mud.html gained header chrome; sharing controls moved out of the
  game-controls deck. Verified live in real browsers (49 scripted checks) by the building agent,
  then 17/17 e2e p2p/mesh tests by the coordinator post-merge.
- [x] **WebRTC now defaults to a public STUN server** (`DEFAULT_ICE_SERVERS`, `webrtc-transport.mjs`)
  instead of `iceServers: []` — real-browser cross-engine testing (Chromium + Firefox, default
  flags) found the old empty-list setting depends on OS-level local-network/mDNS behavior that
  varies by machine, invisible to the e2e suite's own Chromium-only, mDNS-patched harness. STUN only
  discovers each peer's own address; the connection still prefers a direct host-to-host path when
  one exists, and no application data ever passes through the STUN server. Purged "not a bug to fix
  later"/"stated boundary" framing for the no-STUN setting from `PLAN_MUD.md` and code comments —
  described a decision as permanent that wasn't.

**Bugs found and fixed this session:**
- PLAN_FACT step 2's `teach:peer:<name>#node:<id>@<ts>` tag grammar landed clean in isolation, but
  broke chat.mjs's citation text — `renderFactLine` and ~9 sibling call sites interpolated the raw
  provenance tag verbatim into `(source: ...)`. Caught by CI's `e2e:deployed:mesh` post-deploy job,
  not by any local blast-radius run beforehand — none of A1-A6's own test scopes crossed into
  chat.mjs's citation rendering, since the change that broke it (A6's tag grammar) landed in a
  different worktree than the code it broke. Fixed with a `citationProvenance()` display helper.
- `whenIceGatheringCompletes()` had no timeout of its own — a STUN request that never gets a reply
  (rate-limited public server, two peer connections in one tab racing for it) hung the offer/answer
  blob forever. Caught by a real, reproducible e2e failure (a page minting a second invite while its
  first connection was already open), not by inspection. Now bounded at 5s.
- `e2e:deployed:pages`/`e2e:deployed:shell` failed deterministically (all 3 retries, twice) with
  "starter memory unavailable — starting empty." The deployed seed data was never actually broken
  (fetched directly: 72,109 individuals, valid JSON, boots in ~3s once warm) — a CDN cold-cache
  timing issue for the 89MB `chat-seed.json`, wider margin needed than `retry: 2` covers. Fixed with
  `scripts/warm-deployed-cache.mjs`, run at the end of `deploy:website` before the `e2e:deployed:*`
  jobs start.
- The re-key grew every corpus record's own byte cost (`mgx:sourceId`, restructured `trustInputs`)
  even though corpus bands stay one record per triple — the full `init:xl` band set measures
  106,413,353 bytes, over `SEED_BYTE_CEILING`, breaking `demo:build` and cascading into
  `e2e-web-index`/`e2e-web-local-origin`. Capped ConceptNet at 28,000 facts (was 36,328), buying back
  ~10.8 MB headroom, seeding definitional-predicates-first so the cut favors the IsA/subClassOf
  backbone over trivia.
- Four bugs specific to the ask-bundle path (`test-e2e/`, not `test/adapters/` — outside every
  PLAN_FACT worktree's own blast radius, only found by running the real CI job sets locally):
  `recountClasses` threw on a payload with no `classes` array (a real, documented `tmct.open({payload})`
  usage), silently swallowed into an honest miss with zero diagnostic trace; the ask-bundle test's
  `vm.createContext` lacked `TextEncoder`, which the re-key's fact-id hashing now needs (a real
  global in every environment the bundle ships to, already present in `chat-browser-bundle.test.mjs`'s
  own context); `ledger-viz.mjs` joined `createdAt` by looking up a row's GROUP id directly in
  individuals now keyed by per-source ASSERTION id, always missing; two independent test fixtures
  (`ledger-viz.test.mjs`, and step 6's own new `memory-source-reliability.test.mjs` test) used
  `mgx:hasProperty` as a "single-valued" contradiction fixture, not knowing step 4's widened merge
  table reclassified it — the SAME mistake step 4's own agent had already made and fixed six times
  in `test/adapters/`. **Any future fixture needing a genuinely single-valued/contradiction-default
  predicate should use `mgx:father` or `mgx:mass` — `mgx:hasProperty` is `merge` now.**

## Open items

- [ ] **NEXT #2's remainder** (chat/ledger/ingest/research/plan) — the sprites slice shipped this
  session (`tmct.ask` now answers from a real projected graph on the sprites page). chat/ledger
  need a materially different open-vocabulary projector (not a `worldRelationGraphPayload`
  drop-in), ingest has no `ask`/`turn` route wired at all yet, research already has a working
  narrower `ask` route so isn't hitting the empty-graph miss, and plan's Hanoi-puzzle state has no
  board-shaped rows to project. Each is a separate future scoping pass, not folded into this one.
- [ ] `tmctChatReady`/`tmctIngestReady`/`tmctAdventureLastSave` (plus the same-shaped
  `tmctChatLastSave`) remain their own page globals with no `tmct.*` equivalent — confirmed by this
  session's fold-away of the one that WAS redundant (`tmctChatSession` → `tmct.session`, done).
  These four are genuine page-lifecycle/persistence-timestamp state the engine surface contract
  doesn't model; a `tmct.ready`-style member would need to be added to `tmct-surface.mjs`'s
  contract, not just renamed. Not a bug, just undecided whether it's worth doing.


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

8. (2026-07-30) Two new ones from this session's large parallel-sprite-content wave. First: the
   coordinator's own shell can silently carry a stale working directory across Bash calls even with
   an explicit `cd` earlier in the same turn — a `git merge` once ran inside a sub-agent's worktree
   instead of the main checkout because of this, caught immediately by `pwd`/`git branch
   --show-current` returning the wrong path before anything was touched. Always `cd
   <repo-root>; pwd` as the very first line of any merge-sequence Bash call, never trust the prior
   call's `cd` to have stuck. Second: sibling content-authoring agents that each append a test
   section to the SAME shared file (here, `test/adapters/sprite-large-template-files.test.mjs`)
   reliably collide on top-level `const`/`function` names even when their actual test content
   doesn't overlap — `git merge` cannot auto-resolve a same-name redeclaration, and the fix is a
   manual reconciliation renaming one side's identifiers, not a blind pick of one branch. Worth
   briefing distinct naming into any future dispatch batch that has multiple agents extending one
   test file, rather than discovering it at every merge.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `reports/BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
