# SKILL_INFERENCE_TESTING.md — the INFBENCH measure-then-build cycle (regenerate, run, gate, stage)

The repeatable loop that drives `PLAN_INFERENCE_TESTING.md`'s 6-band classical-logic ladder
(INF-A1…INF-C2) forward one engine capability at a time. The plan doc is a one-time design/staging
document (the band ladder, the generator design, the build-staging table, the risk ledger); this
skill is the loop a session actually RUNS every time it wants to advance the ladder — regenerate
cases, run the bench, read the rung table, decide ship-or-build, and if building, pick the next
`PLAN_INFERENCE_TESTING.md` §4 stage, implement it by hand, regression-test, and re-measure.

This shape is closer to **`SKILL_TUNING_CYCLE.md`'s** measure→apply-one-lever→re-measure loop than
to `SKILL_PLAYTEST_SPRINT.md`'s delegated chat-round sprint, and this doc follows `SKILL_TUNING_
CYCLE.md`'s structure most closely for that reason: INFBENCH is a deterministic benchmark replay
(`node infbench/run.mjs`), not a natural conversation, so there is no "curious user" to delegate to
a sub-agent round-by-round the way `SKILL_PLAYTEST_SPRINT.md` delegates chat turns — the loop's
unit is "one engine-build stage measured against a fixed ladder," the same unit `SKILL_TUNING_
CYCLE.md` calls "one lever." Where `SKILL_PLAYTEST_SPRINT.md`'s structure genuinely fits (a short,
invokable callout; a numbered discipline section; a closing TL;DR) this doc keeps it; where it
doesn't (delegated rounds, live chat transcripts, a round cap) it doesn't force the metaphor.

> **Invoke it by telling a session:** *"Follow `SKILL_INFERENCE_TESTING.md` and run an INFBENCH
> cycle"* (optionally: a seed for `generate-cases.mjs`, or a specific §4 stage to target).

---

## 1. The cycle (one pass through measure → decide → build)

**Step 1 — REGENERATE.** Run `node infbench/generate-cases.mjs --seed <n>` (default seed recorded
in the generator; omit `--seed` to reuse it). This is deterministic and generated-first, mirroring
`chatbench/generate-graded.mjs`'s discipline (`PLAN_INFERENCE_TESTING.md` §2.2): same seed →
byte-identical `infbench/cases.jsonl`. It prints per-template counts — treat that printed table as
the authoritative count, the same convention `GRADED.md` uses for chatbench's pool. Never hand-edit
`infbench/cases.jsonl`; it is a build artifact, not a fixture.

**Step 2 — RUN.** Run `node infbench/run.mjs`. This replays every case through the two drive points
(the pure kernel prover, `src/syllogise.mjs`; and the chat surface via `runChat()`), grades
deterministically (no LLM anywhere in this loop — INFBENCH has no judge tier that decides truth),
writes `infbench/results/raw/run-<version>/product.jsonl`, and prints the per-band rung table plus
ladder receipts to the console. **`npm run infbench` chains both steps** (`generate-cases.mjs` then
`run.mjs`) — confirmed present in `package.json` as of this doc's writing; the plan doc that
preceded this skill flagged it as a stage-0 prerequisite that did NOT yet exist at the time it was
written, so **do not assume it exists without checking** (`grep infbench package.json`) — if a
future session finds it missing again, that is a real regression to fix before continuing, not an
assumption to paper over.

**Step 3 — READ.** Read the console rung table (or write it up as `INFBENCH_<version>.md` if this
cycle is measuring a just-shipped version — same artifact-naming convention `SKILL_TUNING_CYCLE.md`
§1 uses for chatbench: `INFBENCH_<version>.md`, re-runs of the same version append `_00N`). For each
band, compare its measured completion/fabrication against `PLAN_INFERENCE_TESTING.md` §1's
"Reachable today?" column — is each band landing where the plan predicted, or did something drift?

**Step 4 — DECIDE (apply the ladder gate, §2 below).** Walk the bands INF-A1→INF-C2 in order.
Apply the honest gate to each: **0% fabrication at ≥50% completion (`COMPLETION_FLOOR`) = PASS**.
The FIRST band that fails this gate gates every band above it — report those higher bands as
**skipped-with-a-receipt**, not silently omitted, even when their raw numbers look fine (a
not-yet-implemented rule can coincidentally clear 50% on a small pool; the gate still holds because
the rule that would make that number MEAN something isn't there yet). A band sitting at a clean 0%
is a **ceiling marker**, not a failure — name it as exactly that.

**Step 5 — SHIP OR BUILD.** Two outcomes:
- **Every band gates exactly where the plan predicted, and the current top-of-ladder target is
  where it should be:** ship as-is — nothing to build this cycle. This is a legitimate, reportable
  outcome, not a null result.
- **The gating band is the one you're trying to move past (or you want to push the ladder
  further):** go to §3 — pick the next `PLAN_INFERENCE_TESTING.md` §4 build-staging row, implement
  it, regression-test, and re-run this cycle from Step 1 to confirm the target band's gate now
  passes before considering the next stage above it.

---

## 2. The ladder-gating rule (exact — do not soften)

Bands run **INF-A1 → INF-A2 → INF-B1 → INF-B2 → INF-C1 → INF-C2**, strictly in that order. Per
band: PASS requires **completion ≥ 50% at 0% fabrication**; fabrication = any answered
verdict/entailment not pinned by the case's own literal at generation time. **The first band that
fails this gate gates every band above it** — this is chatbench's Meta-2 rule
(`SKILL_CHAT_PLAYTEST.md`'s own house ethos, borrowed via `agentbench`'s `ladderGate`: "don't pay to
judge a ceiling while the floor leaks") applied mechanically. A band at a clean **0%** on a
capability that genuinely isn't implemented yet is a **ceiling marker** — legitimate, expected, and
should be reported as such, never silently patched around or forced to a fake pass. Dual-draw
agreement (the parallel-forms reliability check `SKILL_TUNING_CYCLE.md` §1 requires for chatbench's
judged tier) is **not** needed here — INFBENCH is deterministic-replay, one run per arm suffices,
exactly as `SKILL_TUNING_CYCLE.md`'s own deterministic-replay clause already allows.

---

## 3. Advancing a gated band — picking and executing the next build stage

When Step 5 says "build," consult `PLAN_INFERENCE_TESTING.md` §4's build-staging table (stages
0–5, each with an effort estimate and an exit criterion) and pick the **next unimplemented stage
that unlocks the currently-gating band** — do not skip ahead to a later stage while an earlier one
is still open; the ladder rule (§2) means a later stage's rules can't be honestly measured until the
earlier gate clears anyway. As of this doc's writing, stages 0–2 are shipped (the `infbench/`
harness itself; `cax-sco` type propagation in `src/syllogise.mjs`; a bounded live proof-chain chase
in `src/chat.mjs`) and the ladder gates at **INF-B1** (disjointness/`cax-dw` — stage 3) — but
**re-verify current stage status from the latest `INFBENCH_<version>.md` and the plan's own STATUS
banner before picking a stage; don't trust this snapshot as still-current.**

1. **Implement the stage's engine work by hand.** This is real Node.js rule-engine code — `cax-dw`,
   proof-chain receipts, the tier-5 forward-chainer, the consistency checker, whichever stage is
   next. §2.3 of the plan doc is explicit that case GENERATION is mechanized (Step 1 above) but the
   rule engine itself is not, and never will be by this loop — writing a sound inference rule is
   program synthesis, a door this repo has deliberately left shut (ROADMAP Item 11), not a
   templating problem.
2. **Regression-test.** `npm test` green — the same discipline every other skill in this repo
   holds every loop to, no exceptions for engine work.
3. **Re-run the cycle (§1, Steps 1–4)** against the new engine code.
4. **Confirm the target band's gate now PASSES** before treating the stage as done, and before
   considering whether to move further up the ladder to the next stage.

---

## 4. Discipline

- **Never fabricate a pass.** The entire ladder-gating mechanism (§2) exists to prevent exactly
  this — a band's grader compares against a literal pinned at generation time, never re-derives, so
  there is no honest way to make a failing band look like it passed except by actually implementing
  the rule.
- **A 0% band is honest, not a bug.** A not-yet-implemented capability sitting at a clean ceiling is
  the loop working correctly. Do not "fix" it by loosening the grader, relaxing the gate, or
  quietly re-labeling an `unproven` case as passing.
- **Never judge a band while a lower one's gate is failing.** This is the Meta-2 rule this plan
  explicitly borrows from chatbench (ROADMAP-referenced) — report higher bands as
  skipped-with-a-receipt, and resist the temptation to read anything into their raw numbers until
  the actual gating band clears.
- **`infbench/cases.jsonl` is a build artifact, never hand-edited.** If a case looks wrong, fix the
  generator template and regenerate — the same discipline `chatbench/graded-pool.jsonl` already
  holds.
- **Don't assume `npm run infbench` exists.** The plan doc that preceded this skill was written
  before that convenience script landed; verify it's still there (`grep infbench package.json`)
  each time this skill is invoked rather than assuming a prior cycle's state persists.
- **Regression is still sacred.** `npm test` green after every stage's engine change, same contract
  `SKILL_CHAT_PLAYTEST.md` §4 and `SKILL_TUNING_CYCLE.md` §1 hold every other loop in this repo to.

---

## 5. One-paragraph TL;DR

Run `node infbench/generate-cases.mjs --seed <n>` (or `npm run infbench` if present, verified not
assumed) to deterministically regenerate `infbench/cases.jsonl`, then `node infbench/run.mjs` to
replay it through the kernel+chat drive points and grade it deterministically — no judge, no LLM,
anywhere in this loop. Read the printed per-band rung table (or write it up as
`INFBENCH_<version>.md`) and apply the ladder gate strictly in order INF-A1→INF-C2: 0% fabrication
at ≥50% completion passes a band, the first band that fails gates every band above it
skipped-with-a-receipt, and a clean 0% on a not-yet-built capability is a ceiling marker, not a
failure — never force a fake pass. If every band lands where predicted, ship as-is; if you want to
push the ladder further, pick the next unimplemented `PLAN_INFERENCE_TESTING.md` §4 build stage that
unlocks the currently-gating band, hand-write that engine rule code (never mechanized — only case
generation is), keep `npm test` green, and re-run this whole cycle to confirm the target band's gate
now passes before moving to the next stage.
