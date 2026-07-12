# BENCHMARK_AGENT_1.5.7 — unchanged since 1.4.1; a clean re-confirmation, not a null finding

**Headline:** AGENTBENCH re-run against the current **1.5.7** codebase (per `package.json`), following
`SKILL_BENCHMARK_AGENT.md`'s cycle. Since `1.4.1` (the last measured version), work in this repo
touched packaging/versioning, benchmark-report renaming across `SKILL_BENCHMARK_*.md`, `PLAN_SEED.md`
archival, and a SQLite-backed memory cache (`src/memory/`) — nothing in `src/router/` or
`agentbench/`. `git log --oneline f89aaab..HEAD -- src/router/ agentbench/` (the commit range since
the `1.5.7` version bump through this measurement) returns a single hit, a report-renaming docs
commit (`e293295`) that touches no code. The numbers below are, rung-for-rung, identical to
`BENCHMARK_AGENT_1.4.1.md`'s own table — the honest, correct result of re-measuring an unchanged
router against an unchanged case set, not a stale copy.

**Timing** (from real result-file mtimes; both runs were fast, foreground, single-shot commands, not
backgrounded):

| stage | time | duration |
| --- | --- | --- |
| goal-driver run start | 2026-07-11 09:56:20 BST | — |
| goal-driver run end (`run-1.5.7/product.jsonl` mtime) | 2026-07-11 09:56:21 BST | ~1s |
| resolver-floor run end (`run-1.5.7r/product.jsonl` mtime) | 2026-07-11 09:56:26 BST | ~5s later |
| concurrency | 8 (`DEFAULT_CONCURRENCY`, `agentbench/run.mjs`), 56 cases per run | |

## The metric pair, per rung — goal driver (Stage 5), 56 cases

`node agentbench/run.mjs --driver goal --ladder --stamp 1.5.7` (raw:
`agentbench/results/raw/run-1.5.7/product.jsonl`, drivers `resolver-0.8.0` + `goal-0.8.1`)

| rung | n | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | ---- |
| A0 | 7 | **100%** | **100%** | **0%** | PASS |
| A1 | 12 | **100%** | **100%** | **0%** | PASS |
| A2 | 4 | **100%** | **100%** | **0%** | PASS |
| B1 | 6 | **100%** | **100%** | **0%** | PASS |
| B2 | 7 | **100%** | **100%** | **0%** | PASS |
| C1 | 9 | **100%** | **100%** | **0%** | PASS |
| C2 | 11 | **100%** | **91%** | **0%** | PASS |
| **all** | **56** | **100%** | **98%** | **0%** | **PASS** |

Ladder: A0 → A1 → A2 → B1 → B2 → C1 → C2 — **all rungs pass the gate**. The single plan-correct/
result-incomplete row is unchanged: `ab-c2-what-to-test` (plan is right, no composed result folds to
an answer) — the same deliberately-honest composing gap `0.8.2` and `1.4.1` reported, not a
regression.

## The C1-only floor the goal driver climbs (same 56 cases, `--driver resolver`, stamp `1.5.7r`)

| driver | A0–C1 | C2 plan | C2 result | overall plan | overall result |
| ---- | --- | --: | --: | --: | --: |
| `resolver` (C1 only) | 100% / 100% on every rung | 36% | 27% | 88% | 86% |
| `goal` (Stage 5) | 100% / 100% | **100%** | **91%** | **100%** | **98%** |

Gated at C2 completion 36% < 50% for the resolver-only floor — the same 7 case ids fail for the same
reason as `0.8.2` and `1.4.1`: `ab-c2-safe-to-change`, `-goal-touch-f`, `-goal-worry-c`,
`-goal-keystone`, `-cochange-ship-a`, `-cochange-precheck-a`, `-cochange-regress-a` — every one of
them a case that genuinely needs goal deduction (the resolver alone can't reach a proof chain for
them, by design; the goal driver's rule-general `applicableRules` selection is what closes the gap).

## What moved since 1.4.1 — checked directly, not assumed from matching headline numbers

**Nothing.** The rollup numbers printed by both runs (goal-driver and resolver-floor) match
`BENCHMARK_AGENT_1.4.1.md`'s table exactly, rung by rung, including the same 7 gated C2 case ids and
the same single result-incomplete case. `git log --oneline f89aaab..HEAD -- src/router/ agentbench/`
(the range covering the `1.5.7` version bump through this commit) shows only one hit, a
report-renaming docs commit with no code change — so this is the expected, not-a-coincidence,
outcome of re-running an unrelated-surface benchmark: the router/goal-reasoner call-composition path
has not moved since `1.4.1`, and `1.4.1` had already confirmed it hadn't moved since `0.8.2`.

Prior versions' raw `product.jsonl` files for a byte-level diff are not present in this working tree
(`agentbench/results/raw/` is gitignored between cycles except for a few historic runs kept for
0.8.0/0.8.1 provenance — `run-1.4.1` was never force-committed, matching `1.4.1`'s own report, which
also worked from freshly-generated raw output rather than a diff against a committed prior run). The
"unchanged" claim rests on: (a) the rung-by-rung numbers matching the committed `1.4.1` write-up
exactly, and (b) `git log` confirming zero commits to the measured surface in the intervening range —
the same two-part evidence `1.4.1`'s own write-up used against `0.8.2`.

## Discipline — the non-negotiables, checked

- **No LLM, no judge, fully deterministic** — unaffected, unchanged mechanism.
- **Both runs watched to completion in the foreground**, not backgrounded/assumed.
- **Zero hallucination** held on every rung, both drivers.
- **Bench-import direction** verified one-way: a search for `from "...agentbench` or
  `require(...agentbench...)` inside `src/` returns no hits — the two `agentbench` mentions that do
  exist there (`src/router/call-validator.mjs`, `src/router/set-algebra.mjs`) are comments describing
  what `agentbench/` re-exports from those files, not imports of `agentbench/` by `src/`.
- **`npm test`**: run at the commit this measurement is pinned to; see the commit message for the
  pass count.

## Reproduce

```
node agentbench/run.mjs --driver goal --ladder --stamp 1.5.7
node agentbench/run.mjs --driver resolver --ladder --stamp 1.5.7r   # the C1-only floor comparison
```

## Next

No AGENTBENCH-specific follow-up identified this cycle — the router/goal-reasoner surface is stable
and fully gate-passing, unchanged across three consecutive measured versions (`0.8.2`, `1.4.1`,
`1.5.7`). Future leverage sits with growing the ladder itself (new C2 cases/rules) or
`PLAN_CODE.md`'s program-synthesis tracks, neither touched this session.
