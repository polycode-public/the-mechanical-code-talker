# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Current capability surface" and "What's next" sections for the full feature-level picture. This
file holds ONLY what to do next — no completed-work narrative (that lives in `ROADMAP.md`), per
this project's own standing discipline.

Session handles (inboxes): `tmct` (the edge-hunt/playtest session) and `tmct-hanoi` (the
PLAN_HANOI/PLAN_VIZ_LEDGER session). See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-15, v1.11.0)

v1.11.0 ships PLAN_HANOI.md (all phases: taught game domains, the plan lane, `tmct import
--file` with the `.tmct/imports/` scaffold, `chat --prompt --render blocks`, the crates second
domain, the router registration seam) and PLAN_VIZ_LEDGER.md (all phases: `tmct viz --ledger`,
the in-page chat dock, the Pages ledger hero, the README pass). Both plan docs carry dated
implementation addenda; `ROADMAP.md` holds the feature narrative. Historical notes follow.

`PLAN_VIZ_MEMORY.md` fully implemented (see that doc's own "IMPLEMENTED" status line + Phasing
checklist for specifics): that node-link page was retired on 2026-07-15 — the ledger explorer is
now THE `tmct viz` surface (PLAN_VIZ_LEDGER.md's addendum records the decision).

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

- **Playtest sweep: instance names through the code-graph ask lanes.** The Phase-1R
  boundary menu is otherwise closed: seeds 1-2 shipped pre-batch (1.10.13/1.10.14), and the
  rule-teach frames and goal sentences shipped as real features in 1.11.0 (probe them as
  features now, not boundaries). What never got its sweep: hyphenated/numbered instance
  names (disk-1, peg-a) through the code-graph ask/resolve lanes. Kickoff: "Follow
  SKILL_PLAYTEST_EDGE_HUNT.md, sweep instance-name shapes through the ask lanes."

- **1.11.0 follow-ups (named in `ROADMAP.md`)**: river-crossing's two missing frames plus the
  multi-effect interpreter extension; planner-side consumption of `taught:` capability
  records; the factAnswer goal-field question (ledger dock, needs operator sign-off); the
  findContradictions cardinality question; ledger bundle weight (~533 KB measured).

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
