# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Current capability surface" and "What's next" sections for the full feature-level picture. This
file holds ONLY what to do next — no completed-work narrative (that lives in `ROADMAP.md`), per
this project's own standing discipline.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-16)

v2.0.3 in the working tree. CI publishes on a version bump on main; npm's latest is 2.0.1.

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code (bulk ConceptNet
download, not reachable from data in hand).

## Open items

Logged by the 2.0.3 benchmark cycle, which measured all four axes and applied no lever. Each
line names its reproducer and points at the write-up that found it.

The first five are one family: **input silently discarded before the parser runs**, each producing a
confident answer to a question nobody asked. They are listed first because tmct's honesty machinery
never engages on them — by the time the parser sees the sentence, the evidence that it was a
different sentence is gone.

- **A "shortest" plan whose first move is illegal** — teach the README's own Hanoi board on its own
  line (`disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a.`), then the goal,
  then `solve it`: answers `plan found — 3 moves (shortest)` starting `move disk-3 onto peg-c`,
  which is illegal (disk-2 rests on disk-3), and never reaches the goal. The same sentences with the
  goal on the SAME line give the correct 7. A teach-only line is not sentence-split, so all three
  become one fact — `disk-1 mgx:rest-on "disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a"` —
  and the planner plans faultlessly over a phantom board. The tell is the bullets: the working form
  prints three `•`, the broken one prints one blob. See `BENCHMARK_CONVERSATION_2.0.3.md`.
- **An existential is stored as a universal, then proved** — `some men are fathers` stores as
  `men is a kind of father`; with `john is a men`, `is john a father` answers `yes` **with a proof
  citing both premises**. The teach frame strips the quantifier without distinguishing ∃ from ∀, so
  an I-proposition lands as `rdfs:subClassOf` and the reasoner certifies a non-sequitur. The property
  form (`some men are wise`) and the singular are both refused correctly — only the plural class form
  leaks. See `BENCHMARK_CONVERSATION_2.0.3.md`.
- **`what would break if I change X` answers with people** — `what would break if I change
  src/core/store.mjs` → `read as "what would change src/core/store.mjs" — a1b2c3d4e5f6 (Grace
  Hopper) and …`. "break if I" is stripped, the residue matches the `touches` history pattern, and
  blast-radius becomes git blame. It announces the misreading and answers confidently anyway; the
  impact closure it should return is already computed by `/impact`. See
  `BENCHMARK_CONVERSATION_2.0.3.md`.
- **Unknown modifiers are dropped, so it answers about a different entity** — `what imports the
  deprecated legacy model.mjs` returns exactly what `what imports model.mjs` returns; the fiction is
  discarded silently and the `Canonical:` line prints the garbage term back, having resolved past it.
  The ambiguity guard fires only on multi-candidate collisions, not on unknown-token residue. The
  realistic trigger is a user saying "the old model.mjs". See `BENCHMARK_CONVERSATION_2.0.3.md`.
- **`tell me about a dog` reports that it knows nothing, one turn before proving it does** — answers
  "the graph … is empty — no entities to answer from yet", while `tell me about dog` (no article)
  returns the corpus facts. The article routes to the code-graph lookup and the corpus is never
  consulted. A Tier 0 dead-end, so the conversation ladder does not ratchet. See
  `BENCHMARK_CONVERSATION_2.0.3.md`.
- **`show me the untested modules` (9) contradicts `/untested` (7)** — the natural-language
  compositional route lacks the source-module filter the tool applies, so `test/tasks.test.mjs` and
  `test/store.test.mjs` count themselves as untested. Same question, two surfaces, two answers. See
  `BENCHMARK_CONVERSATION_2.0.3.md`.
- **A negative assertion is executed as a retraction** — `john is a man` then `john is not a man`
  answers `noted — forgotten: "john is a kind of man" is no longer stored`, and `is john a man` then
  says "I don't know 'john' at all yet". A claim destroys information instead of recording a
  disagreement. Sits oddly beside `0f8fb61` (capability negatives DO store: `penguin cannot fly` →
  `penguin mgxneg:capableOf fly`) — same word "not", two behaviours. On an unknown subject
  (`zeus is not mortal`) it is a silent no-op reported as a question about an empty graph. See
  `BENCHMARK_CONVERSATION_2.0.3.md`.
- **`what talks to the payment module?` — a README headline example — does not parse** (`README.md`
  ~line 108). It fails at every arity, including with a real module path. `what uses store.mjs` works,
  so the capability exists and only the phrasing is unrouted; one lexicon entry (`talks to` → `uses`)
  is the fix. `/help` doesn't list the shape either, so the docs and the product disagree with the
  README. See `BENCHMARK_CONVERSATION_2.0.3.md`.
- **Quantifiers parse when teaching but not when asking** — `every man is mortal` stores, then
  `is every man mortal` → "I don't know anything about 'every man' yet", while `is a man mortal`
  answers yes. Same for `are all men mortal` / `is any man mortal`. `are men mortal` fails the same
  way on the plural, and its suggestion text is ungrammatical ("remember that men is mortal"). See
  `BENCHMARK_CONVERSATION_2.0.3.md`.
- **An unparsed turn wipes the anaphora referent** — `what is a dog` / `go back to dogs` (a miss) /
  `can it bark` → "not sure what 'it' refers to yet". Binding otherwise works well and even rebinds
  correctly across a topic switch, so leaving the prior binding intact across a miss is the whole fix.
  A casual user's misses come in clusters, so one stray turn strands every pronoun after it. See
  `BENCHMARK_CONVERSATION_2.0.3.md`.
- **`next` advances the plan but the fact read-back serves the stale board** — after `next`,
  `what rests on disk-2` answers "disk-1 rests on disk-2" while the same turn's `board@step1` says
  disk-1 is on peg-c. `what moves are legal now` sees the new board, so only the read-back path is
  stale. `README.md:352` claims `next` writes each board state into memory as facts. See
  `BENCHMARK_CONVERSATION_2.0.3.md`.
- **Smaller items from the sweep** — a bare module path (`src/core/store.mjs`) dead-ends where a bare
  class or function orients; vocabulary-session miss hints are hard-wired to the code-graph frame
  (`what about cats` → "Try: which modules import <name>"); `what else` / `why` fall through to the
  identity blurb though `tell me more` expands; `do all men die` hits the code-graph parse error;
  `do all modules import model.mjs` produces a duplicated ambiguous parse where both readings fail;
  `i was wondering what a dog is` doesn't parse; `hanoi-3.txt`'s own 4-disk recipe yields `no plan
  found within 300 moves` because `smaller than` isn't transitive; plan follow-ups (`what is the next
  move`, `how many moves`, `why that move`) fall through to code-graph replies; `is disk-1 clear?` —
  a phrasing `hanoi-3.txt` advertises — misses at step 0 when it is clear. All in
  `BENCHMARK_CONVERSATION_2.0.3.md`'s routed backlog.
- **Capability gap, honest miss (not a defect)** — `no man is a stone` stores cleanly as
  `man owl:disjointWith stone`, but `is john a stone` answers "I can't confirm that" rather than "no".
  Disjointness is stored and never consulted when answering. See `BENCHMARK_CONVERSATION_2.0.3.md`.
- **The fronted-agent passive answers the inverse, confidently** — `by which modules is
  app/lib/b.mjs imported` answers `app/lib/a.mjs.` (expected `app/functions/d/handler.mjs`), because
  it compiles to `forward(imports, "app/lib/b.mjs")` where the question asked for reverse. Tier-1
  (deterministic) PASS → FAIL vs `BENCHMARK_CEFR_ENGLISH_1.8.0.md` on `g-b2-passive-8` and
  `g-b2-passive-10`. Bisected to `98df45a fix(ask): the passive keeps its agent…`, which replaced a
  "wh-word after *by* means the agent is questioned → reverse" test with a "patient before *by*,
  agent after *by*" partition. That partition assumes a postposed agent (`X is imported by Y`); when
  the agent is fronted, the patient sits after "by", is read as the agent, and "agent alone → forward"
  fires. `g-b2-passive-10` degrades to a miss; `g-b2-passive-8` gives a confident wrong answer, which
  is the worse half. See `BENCHMARK_CEFR_ENGLISH_2.0.3.md`.
- **CHATBENCH is blind to 14 of the 23 construction shapes** — the default `graded-pool.jsonl` covers
  9 shapes / 12 of 36 grade×construction cells, so conditional, coordination-compositional,
  discourse-deixis, ellipsis, garden-path, presupposition, quantifier-counting, relative-embedded,
  subordination and five combination cells are unmeasured on every CEFR report to date.
  `chatbench/graded-pool-max.jsonl` holds all 36; the per-cell floor (`MIN_PER_CELL = 5`) makes the
  lightest full-coverage run 315 cases. A blind spot is where the next `98df45a` lands unnoticed.
  See `BENCHMARK_CEFR_ENGLISH_2.0.3.md`.
- **The resolver floor stopped planning `ab-c2-what-to-test`** — `node agentbench/run.mjs
  --driver resolver --ladder`: the case's verdict went `completed: true` → `false` since
  `BENCHMARK_AGENT_1.7.0.md`, taking C2 plan-completion 36% → 27%. Probably correct (its plan now
  comes from the goal reasoner, which the floor arm lacks), but unconfirmed. Decide whether the
  floor's expectation moves or the resolver lost a plan it should still build. See
  `BENCHMARK_AGENT_2.0.3.md`.
- **INFBENCH has stopped discriminating** — `npm run infbench`: 219/219 chat, 80/80 kernel, every
  band PASS, and 0 verdict changes across all 299 rows vs `BENCHMARK_INFERENCE_1.7.0.md`. The
  ladder now measures the generator's reach, not the prover's. Deciding what a deeper band should
  assert is the open question. See `BENCHMARK_INFERENCE_2.0.3.md`.
- **50 of INFBENCH's 219 greens are floors, not proofs** — they grade against a declared ceiling,
  so two bands read as capable when they are not. `b2ChainLenK` (30 at INF-B2,
  `infbench/generate-cases.mjs:419`) expects "cannot be proven" for chains the kernel already
  derives, pending chat-layer proof materialization. `c2Inconsistent` (20 at INF-C2, `:647`)
  expects the engine to answer from contradictory memory without noticing, pending a consistency
  checker — which is what `PLAN_CONSISTENCY_CHECK.md` designs. See `BENCHMARK_INFERENCE_2.0.3.md`.
- **`npm run infbench` silently rewrites the committed `infbench/cases.jsonl`, and the rewrite is
  not a no-op** — the generator draws case vocabulary from the lexicon
  (`infbench/generate-cases.mjs:96`), so adding a word re-draws all 219 cases at the same
  `DEFAULT_SEED`. `inf-a1-lookup-subClassOf-001` is "every cuticle is a pusher" as committed and
  "every uneasiness is a museum" as regenerated. The committed file cannot be reproduced by today's
  generator, and no estate test guards it the way
  `test/estate/generated-artifacts.test.mjs` guards the other generated artifacts. Decide whether
  the case set is a derivable artifact or a pinned snapshot. See `BENCHMARK_INFERENCE_2.0.3.md`.

Logged by the `CAPABILITIES_2.0.3.md` audit:

- **`how many facts about horses are there` returns the unrestricted total** (`664 facts.`) —
  `answerMemoryCount` (`src/services/chat.mjs:692-701`) matches `how many …` with no tail check, so
  the restriction is dropped. Verified live. The smallest diff of the dropped-input family, and the
  same shape as the five above. See `CAPABILITIES_2.0.3.md` §4.3 (`PLAN_CLASS_QUERY.md` Finding 2).
- **Unpinned surfaces are where the silent regressions land** — the fronted-agent passive regressed
  because all four `grammar.passive.*` rows pin the postposed form and none pins the fronted one.
  Also unpinned: the `/untested` 7-vs-9 divergence (both sides), row 75's shipped coordination-
  refusal fix (`7f90b03`), and `agentbench/envelope.json` (whose version stamp has read `1.4.1`
  through three audits with nothing to catch it). `node scripts/corpus-matrix.mjs --gaps` names 12
  thin keys and 44 key groups with no negative row — that list is the map. See
  `CAPABILITIES_2.0.3.md` §6.
- **`PLAN_AGENTS.md` §3's open-bug count is wrong** — it claims six frozen-wrong rows; four are
  real. `98df45a` flipped `games/yesno-call-check-reads-callssymbol-edge` and
  `games/bare-passive-reads-the-patient`, both renamed to record the new behaviour. Its §3
  root-cause diagnosis is half-stale with them. Logged rather than applied, per this cycle's
  no-change rule. See `CAPABILITIES_2.0.3.md` §5.
- **`PLAN_GRAPH_SCAN.md`'s banner is false** — it reads "not yet implemented. Nothing in this
  document is live code", but all three phases shipped (`6ee6610`, `426e9dc`) and Phase 3's exit
  criterion is beaten (`init:xl` ~8m25s → 16.6s). Two other plans understate their own delivery the
  same way: `PLAN_PARAPHRASE_VERIFICATION.md` (its slice is already chat-wired at
  `chat.mjs:10411-10429`) and `PLAN_SYLLOGIST_EL_DL.md` (defaults-and-exceptions shipped and are
  archived). See `CAPABILITIES_2.0.3.md` §4.3.
- **Two plans argue from a premise the tree overtook** — `PLAN_CODE.md` §5 and `PLAN_REPO_INDEX.md`
  Parts 3/7 both rest on "tmct carries no Playwright"; `package.json:74` has playwright 1.61.1 for
  the browser e2e tier. That specifically weakens the "move `PLAN_CODE.md` to seonix" argument,
  which needs re-making on other grounds. `PLAN_REPO_INDEX.md` also says 17 RI services against the
  verified 16. See `CAPABILITIES_2.0.3.md` §4.3.
- **`PLAN_CHILD_CORPUS.md`'s baseline is miscounted** — it says "1 kind of bird (`owl`), zero
  capabilities on it"; `human.jsonl` seeds `owl` **and** `swift`, and `owl` carries
  `CapableOf hunt_at_night`. The argument survives; the acceptance test does not, and the plan
  designates those numbers as its own step-5 re-measure target. See `CAPABILITIES_2.0.3.md` §4.3.
- **Citation rot across the estate's docs** — roughly half the audit's rows cite a line that no
  longer points at its symbol, and a dozen cite files that no longer exist. One comment
  (`src/domain/ask.mjs:17`) cites a `temporal.mjs` that **never existed in git history**. Six plans
  carry pre-layer-refactor line numbers. See `CAPABILITIES_2.0.3.md` §6.

### Next-cycle recommendations the benchmarks made

Not defects — the four reports' own decision lines, mirrored here so they are picked up rather than
left in a document nobody re-reads.

- **`naming-vocabulary` scores 1.675/2 over 20 cases** — the second-worst construction in CHATBENCH
  and the largest sample of it, so the signal is real rather than a small-n artifact. Four A1 naming
  cases score 1/2. Un-diagnosed: it needs a look before it needs a lever. See
  `BENCHMARK_CEFR_ENGLISH_2.0.3.md`'s decision log.
- **`ambiguity` scores 1.625/2 — the worst tag, and the least trustworthy number in the report**
  (n=4 at N=1). Re-measure at N≥2 before spending a cycle on it. More generally, 2.0.3 ran at N=1 by
  operator choice, so no per-case judge score in it is noise-averaged; the next cycle should return
  to the go-to N=2. See `BENCHMARK_CEFR_ENGLISH_2.0.3.md`.
- **AGENTBENCH's case set no longer tests the ladder** — all 11 C2 cases are green on the goal
  driver, so the next AGENT cycle's work is deepening the corpus, not the engine. There is no gated
  rung left to build past. See `BENCHMARK_AGENT_2.0.3.md`'s decision line.
- **Re-sweep CONVERSATION once the dropped-input family lands, and add a sixth persona frame** — the
  returning user with a stale mental model ("the old X", "didn't you say Y"). That frame is where
  the unknown-modifier bug's realistic trigger lives, and no frame in the 2.0.3 sweep covered it.
  See `BENCHMARK_CONVERSATION_2.0.3.md`'s Next.

Two designs are waiting on a decision rather than a session: `PLAN_CONSISTENCY_CHECK.md` (tmct as
a consistency service for an LLM tool loop — INFBENCH's 20 INF-C2 cases are a ceiling already built
to grade it) and `PLAN_CHILD_CORPUS.md` (a wider default seed, so the base rate counts more than
one bird).

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
commit.

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

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history plus the `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`CONVERSATIONBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped.*
