# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Current capability surface" and "What's next" sections for the full feature-level picture. This
file holds ONLY what to do next — no completed-work narrative (that lives in `ROADMAP.md`), per
this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Version state (2026-07-13, v1.9.0)

`PLAN_VIZ_MEMORY.md` fully implemented (see that doc's own "IMPLEMENTED" status line + Phasing
checklist for specifics): `tmct viz`'s walk now follows real concept-relation edges (not just
provenance), a second bundled ask-engine answers Fact/definition questions in the embedded panel,
the legend auto-picks its split dimension by entropy, and the page ships hub-hide/beam-prune/
label-mode/search/edge-kind controls plus `--hub-degree`/`--term` CLI flags.

`npm run init:xl`/`init:xxl` (`package.json`): real measured fact counts, `rm -rf tmct.toml
.tmct && npm run init:<size>` — `init:large` 37,797; `init:xl` (`init:large`'s chain + `--persona-size
large` + `wordnet-xl`) 72,075 facts. `init:xxl` (same base, `wordnet-full` swapped in for
`wordnet-xl`, plus `namenet`): real total is still a FOLLOW-UP measurement — next session should run
`npm run init:xxl` and record the real count here. `init:xxxl` stays undocumented-as-code per
`TOO_HARD_AUDIT.md` (bulk ConceptNet download, not reachable from data in hand).

**Seed/query perf fix, landed (`PLAN_GRAPH_SCAN.md`, both phases merged)**: the prior session's
~8m25s `init:xl` seed and ~13-minute single query were real O(n²) bugs, now fixed. Seed side:
`syncFactSources`'s six per-fact linear scans over `payload.individuals`/the `statedBy` edge list
(`src/memory/core.mjs`) replaced with a `mutateMemory`-scoped index (`individualsById`/`sourcesById`/
`statedByBySubject`, Symbol-keyed, never serialized). Query side: `runTurn` now threads one
turn-scoped cache through every `factRows` reader (14+ call sites in `src/chat.mjs`) instead of
reloading the whole graph on each one. Re-measured for real on this same machine: `init:xl`'s
72,075-fact seed is now **16.6s wall-clock** (was ~8m25s), same exact fact count as before (fix
changes speed, not content); the original "what is a horse" query against that same real store now
answers within a full CLI session's **~7.1s total** (startup + prompt + query + exit) — nowhere near
the reported 13 minutes. Regression tests: `test/memory-seed-perf.test.mjs` (min-of-5-trials wall-
clock ratio, noise-resistant), `test/chat-factrows-cache.test.mjs` (deterministic call-count assert).

All of `BENCHMARK_CONVERSATION_1.8.14.md`'s routed backlog is fixed and pushed: pronoun-subject
misparse, the README's "all men are mortal" syllogism demo, taught-fact retraction, teach-vs-graph
precedence, `calls` up-refinement, and the five smaller routed gaps. CI was red for 16 straight
pipelines (#139-154) on a platform-dependent symlink bug in `bin/tmct.mjs` — fixed; `publish:npm`
unblocked and confirmed live through 1.8.5 on npm.

**Operator-found, fixed same-day**: `npm run init:large` + `npm run chat` — "what is used for
riding" / "what can be used for riding" / "what is for riding" all fell through to a misleading
code-graph-flavored miss ("try 'which modules import <name>'") even though `corpus:human`'s own
"horse UsedFor riding" fact was right there (surfaced correctly by "what is a horse"). Root cause:
BUG 1 (`test/wiring-facts.test.mjs`) only ever fixed the FORWARD direction (subject known, "what is
a horse used for") — nothing answered the REVERSE direction (object known, subject unknown), and
the phrasing's leading "what is …" also matched the meta lane's `BARE_WHATIS_RE`, which greedily
treated "used for riding" as one literal (unmatchable) term to define and returned early before any
later reader got a turn. Fixed with `WHAT_USED_FOR_RE`, checked before the meta lane, mirroring the
existing `WHAT_HAS_RE` reverse-by-object reader (`src/chat.mjs`).

## Open items

- **Unprobed Phase-1R playtest seeds (`SKILL_PLAYTEST_EDGE_HUNT.md` dispatch, stopped by
  operator 2026-07-15 after seed 2 of 5)**: the edge-hunt loop mapped seeds 1-2 of the
  `PLAN_HANOI.md` Phase-1R boundary menu (prepositional-verb facts, comparatives — see
  `playtests/PLAYTEST_LOG_008.md`/`009` for the fixes and the stated remainders). Three seeds
  are still unprobed and are the next dispatch's starting point:
  1. **Rule-teach frames** — "you can move a disk onto a peg", "to move a disk onto a target,
     nothing may rest on the disk". Expect declines; what matters is WHERE each lane declines
     and that nothing mis-teaches silently (silent garble is the poison case, honest decline
     is fine).
  2. **Goal sentences** — "the goal is that every disk rests on peg-c", plus the universal
     read-back "does every disk rest on peg-c".
  3. **Hyphenated/numbered instance names through the ASK lanes** — disk-1/peg-a round-trip
     the teach and fact lanes cleanly since 1.10.13, but the code-graph ask/resolve lanes
     haven't had their own sweep.
  Kickoff: "Follow SKILL_PLAYTEST_EDGE_HUNT.md, continue the Phase-1R dispatch, rounds 3-5."

- **`PLAN_SYLLOGIST.md`'s remaining ATMS generalization**: the scm-sco (subClassOf) retraction slice
  from §3 is now real and shipped (`retractSubClassOf`, `src/syllogise.mjs`) — a bounded, re-verified
  local check, not full alternate-justification-set tracking. The other four entailment rules
  (cax-sco/cax-dw/cls-svf1/scm-svf1) don't carry justification yet — mechanical extension, not done.
  The full ATMS generalization (de Kleer 1986) is the one piece still genuinely open, cited in
  `ROADMAP.md`'s research horizon, not attempted here.

- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch (imperative command grammar,
  mutable turn-by-turn world/player state as graph nodes, an NPC turn scheduler). Design-only,
  nothing implemented yet.

- **Cross-repo playtest backlog (from seonix, `~/.claude/inboxes/mechanic.md`)**: (1) a paraphrase-
  coverage gap for describe-style queries — "what is X for" and "what does X do in Y" aren't
  recognized shapes even when the underlying data resolves correctly via other phrasings (3 confirmed
  instances); (2) a cross-language disambiguation-ranking false positive — "where is the main entry
  point defined" sprays across unrelated Java/test-fixture `main` matches with no relevance ranking;
  (3) a cosmetic label-spacing bug — a rendered type like `GlobalVariable` loses its word break. None
  implemented yet; not in this session's scope.

- **Standing cross-repo note, can never close from this repo**: if seonix's own chat surface goes
  through `runChat`/`createSession`, its `tmct.toml` needs to explicitly re-activate SEON/ConceptNet
  now that tmct's own default persona has flipped to opt-in for those sources. See `ROADMAP.md`
  around the persona-batch entry for the full context.

## Discipline (unchanged)

**Working model: coordinator + background sub-agents** (copied verbatim from this repo's own
`CLAUDE.md`, so it's visible directly in this file too): run big tasks in concurrent background
sub-agents and keep the main chat free — the main session is the COORDINATOR (plans, launches,
integrates, answers the operator), not the worker. Decompose into workstreams with clear
file-ownership boundaries; serialize on shared files (one agent owns `package.json`, `src/`, `bin/`,
`test/` sequences; docs/site tracks run in parallel). Keep the chat for chat: anything long-running
(benchmarks, judge passes, builds, test sweeps) executes as a BACKGROUND task at maximum safe
concurrency; the main session launches it, keeps coordinating and conversing, and collects results
on the completion notification — never block the conversation on a run. Push/publish is gated on
the operator (CI publishes on version bump on `main`); versioning/commit/push cadence follows the
operator's explicit prompt instructions (see `CLAUDE.md`'s first section).

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`). `npm test` green at every
commit. Coordinator plus background sub-agents, disjoint file-ownership where possible, serialized
on shared files — this repo's heaviest-touched files (`src/chat.mjs`, `src/ask.mjs`) get edited by
one dispatch at a time, never in parallel, to avoid collisions.

Three hard-won lessons, carried forward:

1. Background sub-agents sharing one working tree (no worktree isolation) can and did run
   destructive/shared git operations (`git stash`) meant only for the coordinator — recovered
   without loss, but now explicitly called out in every dispatch brief: sub-agents may only
   `git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`.
   Also: the harness's permission system blocks `git commit` for *background* sub-agents entirely
   in some configurations (no live user to approve a permission-gated action) — the coordinator does
   the committing itself in the foreground when this happens, verifying `git status` immediately
   before every stage to avoid sweeping in another track's pre-staged files.

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
   --show-current` returning something other than `main`, no work lost). Full detail and the
   verification recipe live in `SKILL_AGENT_FAST_LOOP.md` §4 — this entry is a cross-reference, not
   a duplicate. The rule: before resuming any stalled round, check `git worktree list` for its path
   — if it's gone, `TaskStop` that round and dispatch a fresh one instead, never `SendMessage` it
   back to life.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history plus the `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`CONVERSATIONBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped.*
