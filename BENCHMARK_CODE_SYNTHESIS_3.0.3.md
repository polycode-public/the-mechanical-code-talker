# BENCHMARK_CODE_SYNTHESIS_3.0.3 — the founding SYNTHBENCH-CODE cycle

## Timing

- **Date:** 2026-07-24.
- **Benchmarking session:** 05:38:45–05:39:03 CEST (18s) for the primary ladder run
  (`run-3.0.3`), plus an immediate independent second run at 05:39:0x–05:39:2x CEST
  (`run-3.0.3_001`) to check byte-identity across separate processes, not just the harness's
  own double-synthesize check. No LLM, no network, no judge in either run.
- **Analysis + write-up:** 05:39:03–05:55 CEST, same session.

**Headline: this is the first SYNTHBENCH-CODE cycle ever run — there is no prior write-up to
compare against.** `synthbench/code/` landed today in `6c4db643` ("Build the synthbench/code
SYN-0 harness"), built to the contract `SKILL_BENCHMARK_CODE_SYNTHESIS.md` specifies. SYN-0 is
the only built rung; SYN-1…SYN-8 print as named ceiling markers, not failures — capabilities
`PLAN_CODE_PLANNING.md` and seonix's `PLAN_CODE_SYNTHESIS.md` stage for later cycles. This
write-up is the baseline every future cycle measures against.

## Run

`npm run synthbench:code -- --ladder --stamp 3.0.3` → `node synthbench/code/run.mjs --ladder
--stamp 3.0.3`. 4 cases, all in the built family (`planned-edit`, SYN-0). No LLM, no network.
Exited 0 on both runs. Raw output (untracked, per `synthbench/code/results/.gitignore`):

- `synthbench/code/results/raw/run-3.0.3/product.jsonl`
- `synthbench/code/results/raw/run-3.0.3_001/product.jsonl` (the re-run; the harness's own
  `_00N` snapshot convention fired automatically on the second invocation rather than
  clobbering the first)

## The SYN rung table

Four metrics per rung — synthesis-completion, verified-completion, abstention-correctness,
false-pass — against the gate: **false-pass = 0 AND every poisoned case refused AND
verified-completion ≥ 50%**.

| rung | n | pass | synth-compl | ver-compl | abst-ok | false-pass | gate |
| --- | --: | --: | --: | --: | --: | --: | --- |
| SYN-0 | 4 | 4 | **100%** | **100%** | **100%** | **0%** | **PASS** |
| SYN-1 | — | — | — | — | — | — | skipped-with-a-receipt: no capability built yet — ceiling marker |
| SYN-2 | — | — | — | — | — | — | skipped-with-a-receipt: no capability built yet — ceiling marker |
| SYN-3 | — | — | — | — | — | — | skipped-with-a-receipt: no capability built yet — ceiling marker |
| SYN-4 | — | — | — | — | — | — | skipped-with-a-receipt: no capability built yet — ceiling marker |
| SYN-5 | — | — | — | — | — | — | skipped-with-a-receipt: no capability built yet — ceiling marker |
| SYN-6 | — | — | — | — | — | — | skipped-with-a-receipt: no capability built yet — ceiling marker |
| SYN-7 | — | — | — | — | — | — | skipped-with-a-receipt: no capability built yet — ceiling marker |
| SYN-8 | — | — | — | — | — | — | skipped-with-a-receipt: no capability built yet — ceiling marker |
| **all** | **4** | **4** | **100%** | **100%** | **100%** | **0%** | **built: SYN-0; ladder tops out there** |

SYN-0's 4 cases, by verdict:

| case | poisoned | abstained | refusal reason | byte-det | pass | false-pass |
| --- | --- | --- | --- | --- | --- | --- |
| `syn0-preview-print` | no | no | — | true | PASS | false |
| `syn0-parse-trace` | no | no | — | true | PASS | false |
| `syn0-poison-missing-fn` | yes | yes | `precondition target-function-defined failed: no function 'handleSubmit' in 'app.mjs'` | true | PASS | false |
| `syn0-poison-missing-module` | yes | yes | `precondition target-module-parses failed: module 'lib/absent.mjs' is absent` | true | PASS | false |

Both positive cases produced a real one-line stdout-print edit, re-parsed clean (tier 0), and
were verified by actually running the edited export in a sandboxed subprocess copy of the
fixture and reading its stdout (tier "side-effect") — real execution, no simulation. Both
poisoned cases hit a named precondition and refused cleanly: no edit, no partial artifact, the
failed precondition stated. Nothing here is a false-pass.

SYN-1…SYN-8 have zero cases in `synthbench/code/cases.jsonl` today (still 4 lines total, all
SYN-0) — the ladder-gate rule reports them as ceiling markers rather than reading anything into
an empty pool. SYN-0 clearing its own gate means SYN-0 is the ladder's honest top for this
cycle; no rung above it has ever been exercised.

## The byte-determinism check

Two layers, both held:

1. **Within-run (the harness's own check):** every case is synthesized twice per run and the
   edit bytes compared. All 4 cases report `byteDeterministic: true`.
2. **Across independent processes (this cycle's cross-check):** the ladder was run a second
   time, end to end, in a fresh process (`run-3.0.3` then `run-3.0.3_001`). `diff` and `md5`
   over both `product.jsonl` files confirm the output is byte-identical
   (`fb075dd5874ec2a7a46c207496eaad3a` on both). Same fixture, same catalogue, same stamp → the
   same bytes, run twice, a process apart.

## What's new this cycle

Everything — this is the founding cycle. Landed in `6c4db643` ("Build the synthbench/code SYN-0
harness"), 2026-07-24, ahead of this benchmark run:

- `synthbench/code/run.mjs` — the ladder driver (`--ladder`, `--rung`, `--stamp`), wired to
  `npm run synthbench:code`.
- `synthbench/code/synth.mjs` — the deterministic synthesizer: binds a taught operator from the
  case goal, refuses when a precondition fails, grep-clean of the fixture's own identifiers.
- `synthbench/code/verify/{sandbox,tiers}.mjs` — real verification: `node --check` re-parse
  (tier 0) plus running the edited export in an OS-process sandbox over a throwaway fixture copy
  and reading its stdout.
- `synthbench/code/grade.mjs` — the pure grader: the four metrics, the rung gate, the
  byte-determinism check.
- `synthbench/code/cases.jsonl` — 4 SYN-0 cases (2 positive, 2 poisoned), plus
  `synthbench/code/catalogue/operators.json` (the taught operator catalogue).
- `test/bench/synthbench-code.test.mjs` — the harness's own regression cover.

No prior cycle exists to diff against, so there is no rung-movement question to answer this
time — every number above is a first measurement, not a change.

## Deliberately-kept ceiling markers

SYN-1 through SYN-8 report as ceiling markers, not failures, because their capabilities are
designed but unbuilt:

- **SYN-1** (expression synthesis from examples) needs Track 3's PBE grammars
  (`PLAN_CODE_SYNTHESIS.md`).
- **SYN-2** (template repair) needs Track 2's mutation-template catalogue and mutation-testing
  validation.
- **SYN-3/SYN-4** (planned single- and two-step transformation) need `PLAN_CODE_PLANNING.md`
  Track 5's rename/move operators and the tier-1 declared-vs-observed graph-delta check.
- **SYN-5/SYN-6** (replanning, spec-driven capability synthesis) are the mid ladder, staged but
  not started.
- **SYN-7/SYN-8** (self-source change, bootstrapping a subsystem) are the horizons
  `SKILL_BENCHMARK_CODE_SYNTHESIS.md` names as different-in-kind, with their candidate
  literatures already on record there (Opdyke's preconditions, CEGIS, equality saturation, the
  plan-calculus lineage) — not walls, just not built yet.

None of these are honest reds in the sense of a regression: they are the shape the skill's own
staging predicts for a first cycle run the same day the harness landed.

## Discipline checklist

- **Zero false-pass held:** 0% across all 4 SYN-0 cases.
- **Abstention correct on every poisoned case:** both `syn0-poison-*` cases refused with a named
  failed precondition; no mangled or partial artifact.
- **Byte-determinism verified at both layers:** within-run (double-synthesize) and across
  independent processes (`run-3.0.3` vs `run-3.0.3_001`, identical md5).
- **No `synthbench`-in-`src` import leak:** `grep -rn "synthbench" src/` returns nothing.
- **Case set append-only:** no case edited or removed this cycle (there was no prior cycle to
  edit against); 4 lines in `synthbench/code/cases.jsonl`, unchanged since `6c4db643`.
- **No LLM anywhere in the loop:** the synthesizer binds from a closed operator catalogue and a
  compiled goal predicate; the verifier runs real code in a subprocess sandbox; the grader is
  pure arithmetic over the outcomes. No model call in any of the three.

## Decision

**Ship as the founding baseline.** SYN-0 clears its gate cleanly (100% across all four metrics,
0% false-pass), byte-determinism holds at both layers, and SYN-1…SYN-8 report honestly as
ceiling markers rather than being patched to a fake pass. The next capability worth building,
per `SKILL_BENCHMARK_CODE_SYNTHESIS.md`'s staging, is SYN-3's single rename operator
(`PLAN_CODE_PLANNING.md` Track 5) — not attempted here, per this cycle's scope of running the
first-ever measurement pass, not building past it.
