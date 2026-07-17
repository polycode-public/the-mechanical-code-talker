# SKILL_BENCHMARK_CEFR_ENGLISH.md — the autonomous chat tuning cycle (continuous iterations, no hard pause)

The orchestration skill that runs the tmct **chat tuning cycle**: read the last result, pick +
apply the next lever, smoke, run the chatbench, analyse, write it up, and **continue to the next
cycle**. It is the conductor; the worker skill it drives is **`SKILL_AGENT_STRATEGY_ADVISOR.md`** (the
second pair of eyes). The measurement rules live in **§1 of this document**. This skill both
defines and enforces them (there is no separate benchmarking skill in this repo).

The product under test is deterministic, pure-JS, and $0 per run; the only paid component is the
LLM-as-judge in the eval harness. Cycles are therefore cheap enough to run **autonomously**: no
hard pause between iterations. Each cycle ends by re-ranking the lever board, recording the ranked
menu as a **decision log** in the write-up, picking the top lever, and starting the next cycle.
**The operator can interrupt at any time**; the decision logs are the audit trail of what the loop
chose and why.

> **Invoke it by telling a session:** *"Follow `SKILL_BENCHMARK_CEFR_ENGLISH.md` and run the chat tuning
> cycle"* (optionally naming a lever to start from, or a cycle budget). The session then executes
> the loop below repeatedly until interrupted or the budget is spent.

---

## 0. When to use (and when not)

- **Use it** to drive the CEFR_ENGLISH_001→002→0NN arc: one lever applied per cycle, measured against
  the contract in §1, written up, decision-logged, and iterated.
- **Do NOT use it** for a one-off smoke, a docs-only change, or to apply several levers at once.
  One cycle = one lever, so movement in the mean is attributable.
- **Autonomous, interruptible.** There is no step-7 pause: the ranked menu that used to gate the
  next cycle is now a *logged decision record*. The operator steers by interrupting, by editing
  the ROADMAP phase priorities, or by naming a lever at invocation.

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Artifact naming — match the `package.json` version.** A benchmark's write-up is named after the
  tmct version it measures: `BENCHMARK_CEFR_ENGLISH_<version>.md`, raw under
  `chatbench/results/raw/run-<version>/`. A RE-RUN of the SAME version (re-measure without a version
  bump — a harness fix, a re-judge, a second draw) appends `_00N`: `BENCHMARK_CEFR_ENGLISH_0.7.0_001.md`, `_002`,
  …, `run-0.7.0_001/`. So the artifact name always says which shipped version it scores, and the
  `_00N` suffix orders re-runs of that version. (The historical `CEFR_ENGLISH_001…006` cycle-numbered
  artifacts stay as-is; version-matched naming applies from 0.7.0 onward.)
- **Record the timing.** The write-up carries four wall-clock stamps: the start and end of the
  **benchmarking session** (the product run plus the judge fan-out) and the start and end of the
  **analysis** (reading the scores and writing the report). State the date and both intervals — a
  reader comparing two versions needs the measurement time and the write-up time as separate figures.
- **One combined file per run — no separate `_TRANSCRIPTS.md`.** `BENCHMARK_CEFR_ENGLISH_<version>.md` now
  carries the transcript evidence itself, as an "Evidence / transcripts" section near the end
  (discriminating examples first — the cases where arms/cycles differ, so the behaviour change is
  visible at a glance). Earlier cycles wrote the report and its transcripts as two files
  (`BENCHMARK_CEFR_ENGLISH_<version>.md` + `BENCHMARK_CEFR_ENGLISH_<version>_TRANSCRIPTS.md`); that split ends here. The
  already-archived `_TRANSCRIPTS.md` files under `archive/` stay exactly as they are — historical
  artifacts, not something to merge or backfill.
- **Case set (case-set v3, 2026-07-10): `chatbench/graded-pool.jsonl` is the sole, GO-TO profile.**
  One JSON object per line: `{ id, grade, construction, turns[], expectations, tags }`. The frozen
  v1 core (formerly the separate `chatbench/cases.jsonl`, 49 hand-authored capability cases) was
  folded IN as fully-graded cells (each assigned a real CEFR grade + construction, not left as a
  separate ungraded tier) rather than kept as its own file — every case in `graded-pool.jsonl` is
  now a first-class graded-pool citizen. The default profile is capped at **10 cases per CEFR
  grade** (60 pool-native + the 49 folded-in core cases = **109 cases total**), small enough to run
  routinely without the old file split. The set is **append-only per cycle**: new cases may be
  added between runs (record the addition in the write-up), but existing cases are never edited or
  removed mid-arc. Editing a case invalidates every prior cycle's comparison against it.
  > **Footnote — extending to the full pool.** The complete, ungapped CEFR pool (1,075 cases across
  > all grade×construction cells, the historical default before 2026-07-10) is preserved at
  > `chatbench/graded-pool-max.jsonl`. Point `--pool` at it (`node chatbench/run.mjs --pool
  > chatbench/graded-pool-max.jsonl ...`) for a full-coverage run — this is the exception, not the
  > go-to; reach for it when the 10-per-grade default's frontier coverage genuinely isn't enough
  > (e.g. validating a lever against every construction cell, not just a sample of each).
- **Deterministic replay:** each case's `turns` are replayed through `runTurn`. The product is
  deterministic, so **ONE product run per arm** is sufficient; repetition adds nothing.
- **The judge is the noisy part — default N=2, single draw.** Each case's transcript is scored by
  an **LLM-as-judge**. The go-to profile judges at **N=2 samples per case, single draw** (`node
  chatbench/judge.mjs --samples 2`, no `--dual`) — cheap enough (109 cases × 2 = 218 judge calls) to
  run routinely against the 10-per-grade default. **N ≥ 3 samples, and/or the dual-draw
  parallel-forms check (§ below), stay available** for a higher-confidence pass (e.g. before a
  release, or against the full `graded-pool-max.jsonl`) but are no longer the default — see the
  "Dual-draw agreement" bullet below for when to reach for it. **Judge model + prompt version are
  pinned and recorded** in every `BENCHMARK_CEFR_ENGLISH_<version>.md`.
- **Rubric (0–2 each):**
  - **groundedness** — is the answer supported by the graph/memory tmct actually holds?
  - **correctness** — is it right?
  - **honesty-on-miss** — a wrong confident answer scores **below** an honest miss;
  - **rephrase-hint helpfulness** — when tmct misses, does its nudge get the user closer?
- **Primary statistic:** **mean rubric score over the case set** + the **hard-fail count**.
  Report per-tag breakdowns as secondaries.
- **Decision rule:** a cycle **PASSES** only if the mean is **up vs the previous cycle** AND **no
  previously-passing case regresses to fail**. Any pass→fail regression is **FAIL outright**, no
  matter what the mean does.
- **Judge integrity:** a judge refusal or format failure **VOIDS that case's score** for that
  sample. It is re-sampled or excluded, **never counted as a fail**.
- **Graded-pool sampling (case-set v3, 2026-07-10 — supersedes v2's ~10×-pool/10%-sample scheme):**
  the go-to `graded-pool.jsonl` is already capped at 10 cases/grade (§1's opening bullet), so a
  routine run takes the **whole file** (`--sample 1`), not a further stratified sub-sample — the
  10-per-grade cap IS the anti-overfitting/cost control now, not a runtime sampling step over a
  bigger pool. The regression rule is correspondingly simpler: cross-cycle pass→fail regression is
  checked directly against the prior cycle's row for the same case id; **cell-level means** (grade
  × construction, single-area vs combination cells reported separately) stay the comparable
  cross-cycle statistic. **When running against the full `graded-pool-max.jsonl` footnote profile**
  (above), v2's stratified-sampling behavior still applies as documented in `chatbench/GRADED.md` — that file
  is large enough to need it; the go-to 109-case profile is not.
- **Dual-draw agreement (parallel-forms reliability) — optional, off by default in the go-to
  profile.** The go-to profile runs **single-draw** (`--single`, no `--dual`) since its whole point
  is a cheap, routine pass; dual-draw's parallel-forms reliability check remains available and
  recommended before a release or when running against the full pool — every graded measurement
  runs as TWO
  independent draws (distinct recorded seeds, sampled without replacement across the pair).
  Per-cell disagreement beyond tolerance (default |Δ pass-rate| > 0.2) marks the cell
  **UNDER-COVERED — an instrument failure, not product signal**: the cell is excluded from the
  cycle's PASS/FAIL statistics (unmeasured, not failed) and the prescription is to grow its pool
  or per-run sample. The overall agreement rate is the benchmark's own reliability score and is
  reported in every `BENCHMARK_CEFR_ENGLISH_<version>.md` beside the product mean.

## 2. The loop (one cycle; repeats without pausing)

**Step 1 — READ (pick the next lever).** Read, in order: the latest `BENCHMARK_CEFR_ENGLISH_<version>.md` (including
its decision log — the previous cycle's ranked menu is this cycle's starting recommendation);
`STRATEGY_ADVISOR.log` (the `OPEN` items the advisor flagged); and the **ROADMAP phase items**
(the lever board — Phase 1–3 items are the levers). Pick **one lever** and write the prediction:
which cases/tags it should move, and by how much.

**Step 2 — APPLY the lever.** Implement it. Keep `npm test` green at each step; keep
`HANDOVER.md`'s open items current.

> **Build concurrently (workstream fan-out) — the coordinator model.** This is `CLAUDE.md`'s
> standing working model in practice: the main session is the COORDINATOR, not the worker. A
> cycle's changes usually decompose into mostly-independent **workstreams** — e.g. the
> *interpretation pipeline* (`src/domain/interpret/`), *memory* (`src/memory/`), the *bench harness*
> (`chatbench/`), and *docs* — that can be built **in parallel by background subagents** while the
> coordinator keeps the main chat free for the operator. Two rules make this safe: (a)
> **serialize on shared files** — `chat.mjs` and `runTurn`'s orchestration are touched by several
> workstreams, so land the foundational change there first, then layer the others on; (b) **give
> each agent a precise file-ownership boundary + acceptance test** (its suite must stay green) and
> verify its diff summary. Any other long-running, parallelizable step in this cycle (not just
> Step 2) should default to a background sub-agent under this same model — see Step 4's bench run
> and Step 5's advisor.

**Step 3 — SMOKE (mandatory; a failed smoke VOIDS the run).** Run:
1. `npm test` — the full suite, green;
2. `printf 'hi\n/exit\n' | node bin/tmct.mjs` in a **graph-less temp dir** — must greet with the
   bootstrap message and exit 0;
3. the same pipe in a **fixture-graph dir** — must greet and exit 0.
Do not proceed to step 4 unless all three pass; record that they passed.

**Step 4 — RUN the chatbench — concurrently, in the background.** One deterministic product run
per arm (replay every case's turns through `runTurn` — seconds, free), then fan out the judge at
**maximum safe concurrency** (`--concurrency 12` is the default; the judge is embarrassingly
parallel — independent subprocess calls with per-sample retry — so wall-time divides by the lane
count until the API rate limit pushes back; if throttling appears, halve it). The run ALWAYS
executes as a background task: **the chat stays for chat** — the coordinator launches the run,
keeps coordinating (merges, advisor ticks, operator questions), and picks the results up on the
completion notification. Never block the conversation on a benchmark.

**Step 5 — STRATEGY ADVISOR runs ALONGSIDE the whole time.** Per `SKILL_AGENT_STRATEGY_ADVISOR.md`,
spawn the background advisor and let it ride the check-in cadence with the chat-eval watch-list
(its §6): judge integrity, overfit-to-judge, regressions, interpretation telemetry, process
slips. Because the loop no longer pauses for the operator, **the advisor is also the drift alarm
between operator check-ins** — surface anything non-obvious; it appends `OPEN` items to
`STRATEGY_ADVISOR.log` (append-only).

**Step 6 — WRITE the cycle up.** The artifact name **matches `package.json`'s version** (see
"Artifact naming" in §1): `BENCHMARK_CEFR_ENGLISH_<version>.md` for the release under test (e.g.
`BENCHMARK_CEFR_ENGLISH_0.7.0.md`), and a same-version RE-RUN appends `_00N` (`BENCHMARK_CEFR_ENGLISH_0.7.0_001.md`, `_002`,
…). On completion: **snapshot the raw judge outputs to `chatbench/results/raw/run-<version>[_00N]/`
BEFORE the next run overwrites them**, then write **one file**, `BENCHMARK_CEFR_ENGLISH_<version>.md`:
- the headline mean (+ hard-fail count) at the top;
- a **BEST-EXAMPLES pick in the summary** — 3-5 verbatim transcript excerpts showing the most
  complex sequences the chat handled THIS cycle (multi-turn focus/pronoun chains, cross-session
  memory, declarative asserts, repaired noise/typo queries, ambiguity surrounds), each with a
  one-line "what this demonstrates"; the operator reads these first — they are the product's demo
  reel and the fastest smell test for whether the mean is measuring something real;
- the per-tag breakdown;
- the **predictions-vs-actuals** table (step 1's prediction against what moved);
- the **per-lever analysis** tying the applied lever to the cases it moved;
- the judge model + prompt version pin;
- **the decision log** — the re-ranked menu of next-cycle levers with a one-line justification each
  and the pick named;
- an **"Evidence / transcripts" section near the end** — the transcript appendix folded into this
  same file, **discriminating transcripts first** (the cases where arms/cycles differ), so the
  behaviour change is visible at a glance. This replaces the earlier two-file convention: a cycle's
  report and its transcript evidence are now one document, not a companion `_TRANSCRIPTS.md`.

**Mirror every issue the cycle leaves open** (a pass→fail regression, an advisor `OPEN` item that
outlives the cycle, an UNDER-COVERED cell) **into `HANDOVER.md`** as a one-line open item pointing
at this write-up — `HANDOVER.md` is the next-session pickup list; `ROADMAP.md` is not (it doesn't
track tuning).

**Step 7 — CONTINUE.** Apply the decision rule (§1). Re-rank the lever board from this cycle's
evidence, record it (that's the step-6 decision log), pick the top lever, and go to step 1 of the
next cycle. No pause — the operator interrupts when they want the wheel.

## 3. Cadence

- Cycles run back-to-back; within a run, a ~5-minute check-in is the heartbeat and doubles as the
  advisor's tick (`SKILL_AGENT_STRATEGY_ADVISOR.md` §3 Step D).
- The advisor is the only thing that runs *continuously*; everything else is sequential
  (read → apply → smoke → run → write → continue).

## 4. Guardrails (delivery discipline + session constraints)

- **The case set is sacred.** Append-only between cycles; never edit or delete existing cases
  mid-arc; record every addition in the write-up.
- **Snapshot before overwrite.** `chatbench/results/raw/run-<version>[_00N]/` is written before
  the next run starts — a skipped snapshot is a process slip the advisor flags.
- **`STRATEGY_ADVISOR.log` is append-only.** Never edit or reorder prior entries. When you act on
  an `OPEN` item, append a short `✅ DONE` note. Commit the log alongside the related change.
- **Push state is SESSION-SCOPED — never treat a past "no push" as a standing rule.** Commit
  locally with the **repo-local identity** (`git config user.email 'antony@polycode.co.uk'`,
  `user.name 'Antony at Polycode'`); whether to push depends on the *current* session's operator
  authorization. CI publishes on a version bump on `main`, so pushing is a real action.
- **Honest-risk rule.** A lever that does not move the mean is **cut**, not kept for
  completeness. Its decision-log entry says so.
- **No LLM leaks into the product.** The judge exists only in the eval harness; any lever that
  would put a model call in the product path is rejected by definition.

## 5. One-paragraph TL;DR

Run the chat tuning cycle **autonomously**: each cycle **reads** the last `BENCHMARK_CEFR_ENGLISH_<version>.md`
decision log, `STRATEGY_ADVISOR.log`, and the ROADMAP lever board to pick ONE lever + a
prediction; **applies** it (fanning independent workstreams to parallel subagents, serialized on
shared files); **smokes** (`npm test` + `printf 'hi\n/exit\n' | node bin/tmct.mjs` in graph-less
and fixture-graph dirs — a failed smoke voids the run); **runs** the chatbench (one deterministic
product run per arm over the append-only `chatbench/graded-pool.jsonl` go-to profile — 109 cases,
10/CEFR-grade, the folded-in frozen v1 core included — then N=2 single-draw pinned-judge samples
per case by default (N≥3 + dual-draw remain available against the full `graded-pool-max.jsonl`
footnote profile for a higher-confidence pass) on the 0–2
groundedness/correctness/honesty-on-miss/rephrase-hint rubric — wrong-confident
scores below honest-miss; judge refusals void, never fail), with the **strategy advisor riding
alongside as the drift alarm**; **writes one file**, `BENCHMARK_CEFR_ENGLISH_<version>.md` (headline mean + hard-fails
+ the best-examples pick, per-tag, predictions-vs-actuals, per-lever analysis, ranked next-cycle
decision log, and an "Evidence / transcripts" section near the end with discriminating transcripts
first — no separate `_TRANSCRIPTS.md` file), snapshotting raw judge output
to `chatbench/results/raw/run-<version>[_00N]/` first and mirroring anything left open into
`HANDOVER.md` as one-line pickup items; then applies the decision rule (**PASS = mean up AND no
pass→fail regression**) and **continues to the next cycle** — no hard pause; the operator
interrupts at will.
