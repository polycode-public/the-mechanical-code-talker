# SKILL_TUNING_CYCLE.md — the autonomous chat tuning cycle (continuous iterations, no hard pause)

The orchestration skill that runs the tmct **chat tuning cycle**: read the last result, pick +
apply the next lever, smoke, run the chatbench, analyse, write it up — and **continue to the next
cycle**. It is the conductor; the worker skill it drives is **`SKILL_STRATEGY_ADVISOR.md`** (the
second pair of eyes). The measurement rules live in **§1 of this document** — this skill both
defines and enforces them (there is no separate benchmarking skill in this repo).

The product under test is deterministic, pure-JS, and $0 per run; the only paid component is the
LLM-as-judge in the eval harness. Cycles are therefore cheap enough to run **autonomously**: no
hard pause between iterations. Each cycle ends by re-ranking the lever board, recording the ranked
menu as a **decision log** in the write-up, picking the top lever, and starting the next cycle.
**The operator can interrupt at any time**; the decision logs are the audit trail of what the loop
chose and why.

> **Invoke it by telling a session:** *"Follow `SKILL_TUNING_CYCLE.md` and run the chat tuning
> cycle"* (optionally naming a lever to start from, or a cycle budget). The session then executes
> the loop below repeatedly until interrupted or the budget is spent.

---

## 0. When to use (and when not)

- **Use it** to drive the CHATBENCH_001→002→0NN arc: one lever applied per cycle, measured against
  the contract in §1, written up, decision-logged, and iterated.
- **Do NOT use it** for a one-off smoke, a docs-only change, or to apply several levers at once —
  one cycle = one lever, so movement in the mean is attributable.
- **Autonomous, interruptible.** There is no step-7 pause: the ranked menu that used to gate the
  next cycle is now a *logged decision record*. The operator steers by interrupting, by editing
  the ROADMAP phase priorities, or by naming a lever at invocation.

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Fixed, versioned case set:** `chatbench/cases.jsonl` — one JSON object per line:
  `{ id, turns[], expectations, tags }`. The set is **append-only per cycle**: new cases may be
  added between runs (record the addition in the write-up), but existing cases are never edited
  or removed mid-arc — editing a case invalidates every prior cycle's comparison against it.
- **Deterministic replay:** each case's `turns` are replayed through `runTurn`. The product is
  deterministic, so **ONE product run per arm** is sufficient — repetition adds nothing.
- **The judge is the noisy part:** each case's transcript is scored by an **LLM-as-judge** with
  **N ≥ 3 judge samples per case** (the judge lives in the eval harness only; the product stays
  no-LLM). **Judge model + prompt version are pinned and recorded** in every `CHATBENCH_0NN.md`.
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
  sample — it is re-sampled or excluded, **never counted as a fail**.

## 2. The loop (one cycle; repeats without pausing)

**Step 1 — READ (pick the next lever).** Read, in order: the latest `CHATBENCH_0NN.md` (including
its decision log — the previous cycle's ranked menu is this cycle's starting recommendation);
`STRATEGY_ADVISOR.log` (the `OPEN` items the advisor flagged); and the **ROADMAP phase items**
(the lever board — Phase 1–3 items are the levers). Pick **one lever** and write the prediction:
which cases/tags it should move, and by how much.

**Step 2 — APPLY the lever.** Implement it. Keep `npm test` green at each step; keep the ROADMAP
status and any handover doc current.

> **Build concurrently (workstream fan-out).** A cycle's changes usually decompose into
> mostly-independent **workstreams** — e.g. the *interpretation pipeline* (`src/interpret/`),
> *memory* (`src/memory/`), the *bench harness* (`chatbench/`), and *docs* — that can be built
> **in parallel by separate subagents**. Two rules make this safe: (a) **serialize on shared
> files** — `chat.mjs` and `runTurn`'s orchestration are touched by several workstreams, so land
> the foundational change there first, then layer the others on; (b) **give each agent a precise
> file-ownership boundary + acceptance test** (its suite must stay green) and verify its diff
> summary.

**Step 3 — SMOKE (mandatory; a failed smoke VOIDS the run).** Run:
1. `npm test` — the full suite, green;
2. `printf 'hi\n/exit\n' | node bin/tmct.mjs` in a **graph-less temp dir** — must greet with the
   bootstrap message and exit 0;
3. the same pipe in a **fixture-graph dir** — must greet and exit 0.
Do not proceed to step 4 unless all three pass; record that they passed.

**Step 4 — RUN the chatbench.** One deterministic product run per arm (replay every case's turns
through `runTurn`), then fan out the judge: N ≥ 3 samples per case against the pinned judge
model + prompt. Product runs are free; the judge calls are the only spend. Tee to a log and
compute the mean + per-tag table as results land.

**Step 5 — STRATEGY ADVISOR runs ALONGSIDE the whole time.** Per `SKILL_STRATEGY_ADVISOR.md`,
spawn the background advisor and let it ride the check-in cadence with the chat-eval watch-list
(its §6): judge integrity, overfit-to-judge, regressions, interpretation telemetry, process
slips. Because the loop no longer pauses for the operator, **the advisor is also the drift alarm
between operator check-ins** — surface anything non-obvious; it appends `OPEN` items to
`STRATEGY_ADVISOR.log` (append-only).

**Step 6 — WRITE the cycle up.** On completion: **snapshot the raw judge outputs to
`chatbench/results/raw-<NNN>/` BEFORE the next run overwrites them**, then write:
- **`CHATBENCH_0NN.md`** — the headline mean (+ hard-fail count) at the top; a **BEST-EXAMPLES
  pick in the summary** — 3-5 verbatim transcript excerpts showing the most complex sequences the
  chat handled THIS cycle (multi-turn focus/pronoun chains, cross-session memory, declarative
  asserts, repaired noise/typo queries, ambiguity surrounds), each with a one-line "what this
  demonstrates"; the operator reads these first — they are the product's demo reel and the
  fastest smell test for whether the mean is measuring something real; the per-tag
  breakdown; the **predictions-vs-actuals** table (step 1's prediction against what moved); the
  **per-lever analysis** tying the applied lever to the cases it moved; the judge model + prompt
  version pin; **and the decision log** — the re-ranked menu of next-cycle levers with a one-line
  justification each and the pick named.
- **`CHATBENCH_0NN_TRANSCRIPTS.md`** — the transcript appendix, **discriminating transcripts
  first** (the cases where arms/cycles differ), so the behaviour change is visible at a glance.

**Step 7 — CONTINUE.** Apply the decision rule (§1). Re-rank the lever board from this cycle's
evidence, record it (that's the step-6 decision log), pick the top lever, and go to step 1 of the
next cycle. No pause — the operator interrupts when they want the wheel.

## 3. Cadence

- Cycles run back-to-back; within a run, a ~5-minute check-in is the heartbeat and doubles as the
  advisor's tick (`SKILL_STRATEGY_ADVISOR.md` §3 Step D).
- The advisor is the only thing that runs *continuously*; everything else is sequential
  (read → apply → smoke → run → write → continue).

## 4. Guardrails (delivery discipline + session constraints)

- **The case set is sacred.** Append-only between cycles; never edit or delete existing cases
  mid-arc; record every addition in the write-up.
- **Snapshot before overwrite.** `chatbench/results/raw-<NNN>/` is written before the next run
  starts — a skipped snapshot is a process slip the advisor flags.
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

Run the chat tuning cycle **autonomously**: each cycle **reads** the last `CHATBENCH_0NN.md`
decision log, `STRATEGY_ADVISOR.log`, and the ROADMAP lever board to pick ONE lever + a
prediction; **applies** it (fanning independent workstreams to parallel subagents, serialized on
shared files); **smokes** (`npm test` + `printf 'hi\n/exit\n' | node bin/tmct.mjs` in graph-less
and fixture-graph dirs — a failed smoke voids the run); **runs** the chatbench (one deterministic
product run per arm over the append-only `chatbench/cases.jsonl`, then N≥3 pinned-judge samples
per case on the 0–2 groundedness/correctness/honesty-on-miss/rephrase-hint rubric — wrong-confident
scores below honest-miss; judge refusals void, never fail), with the **strategy advisor riding
alongside as the drift alarm**; **writes** `CHATBENCH_0NN.md` (headline mean + hard-fails + the best-examples pick,
per-tag, predictions-vs-actuals, per-lever analysis, ranked next-cycle decision log) +
`CHATBENCH_0NN_TRANSCRIPTS.md` (discriminating transcripts first), snapshotting raw judge output
to `chatbench/results/raw-<NNN>/` first; then applies the decision rule (**PASS = mean up AND no
pass→fail regression**) and **continues to the next cycle** — no hard pause; the operator
interrupts at will.
