# BENCHMARK_RESEARCH_5.0.18 — the ordering fix clears RES-2 through RES-6; RES-7/RES-8 stay named horizons

## Timing

- **Date:** 2026-08-07.
- **Benchmarking session:** 19:44–19:47 CEST (one arm, `--ladder`, 9 cases, no LLM, no network, no
  judge — the whole run is a frozen fixture and a real traversal driver). Wall time 0.28s.
- **Analysis + write-up:** 19:47–20:05 CEST, same session.

**Headline: the ladder now clears RES-0 through RES-6 clean, seven rungs up from the RES-2 gate
`BENCHMARK_RESEARCH_3.0.3.md` recorded.** The research lane picked up a relevance-ordering pass
since that baseline (`18ab7f79`), so the queue now puts kin ahead of hubs instead of replaying plain
document order, and RES-2's ordering score moves from 67% to 100% on the same canonical case. RES-7
and RES-8 remain named research horizons — need-directed research and self-assessed coverage — and
are not measured this cycle, same as every prior cycle.

## Run

`node test-benchmarks/researchbench/run.mjs --ladder --stamp 5.0.18` (matching the committed
`researchbench:run` script): 9 cases, one per rung RES-0…RES-8, against the committed volcano
fixture (`test-benchmarks/researchbench/fixture/graph.json`), no live wiki, no LLM, no judge. Exit 0.
Raw output written to the scratch path used for this cycle's measurement (not committed, per
`test-benchmarks/researchbench/results/.gitignore`).

**Determinism check.** A second run at a different stamp reproduced a byte-identical
`product.jsonl`. The harness has no randomness — every metric is a pure function over the committed
fixture and the recorded walk.

## The rung table (metric trio + gate)

Gate: recall@budget ≥ 50% always; hub-avoidance ≥ 80% and ordering ≥ 80% only where the rung's own
"what it tests" column names them (`RUNG_CHECKS` in `test-benchmarks/researchbench/grade.mjs`); zero
invented traversal.

| rung | n | recall@budget | hub-avoidance | ordering | invented | isolated gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| RES-0 | 1 | 100% | 100% | n/a | 0 | PASS |
| RES-1 | 1 | 100% | 33% | **100%** | 0 | PASS |
| RES-2 | 1 | 100% | 33% | **100%** | 0 | **PASS** |
| RES-3 | 1 | 100% | 100% | 100% | 0 | PASS |
| RES-4 | 1 | 100% | 0% | 100% | 0 | PASS |
| RES-5 | 1 | 75% | 67% | 100% | 0 | PASS |
| RES-6 | 1 | 75% | 33% | 100% | 0 | PASS |
| RES-7 | 0 (1 ceiling) | 100% | 100% | n/a | 0 | n/a (ceiling) |
| RES-8 | 0 (1 ceiling) | 100% | 100% | n/a | 0 | n/a (ceiling) |

**Ladder (ascending, `--ladder`): RES-0 → RES-1 → RES-2 → RES-3 → RES-4 → RES-5 → RES-6 — every
measured rung passes the gate.** No receipts to print; nothing gates below RES-7.

RES-1 and RES-2 don't test hub-avoidance in isolation (`RUNG_CHECKS`: only RES-3 does), and
RES-4/5/6 don't test ordering or hub-avoidance in isolation (only recall applies to their own gate)
— RES-4's 0% hub-avoidance is exactly this: the rung's own gate never looks at it, so a low number
there doesn't fail anything. Each rung's own number and its place in the ascending walk stay
separate questions, as `.claude/skills/benchmark-research/SKILL.md` §1's rung-gate rule sets out.

RES-7 and RES-8 never reach the lane at all (`isCeilingRung` in
`test-benchmarks/researchbench/run.mjs`) — named research horizons, not floor-misses, excluded from
the gate walk entirely.

**Zero invented traversal across all 7 measured cases** — every grounded or skipped title in every
row sits inside the fixture's own reachability closure from `volcano` at that case's `k`.

## Worked example — RES-1/RES-2, the ordering fix in one case

Seed `Volcano`'s lead links, in document order
(`test-benchmarks/researchbench/fixture/graph.json`):

```
Active volcano, Earth, East African Rift, Geology, Hawaii, ISBN 0-19-960146-4
```

Gold sets: `goldFollow = [Active volcano, East African Rift, Hawaii]` (the useful kin),
`goldHubs = [Earth, Geology, ISBN 0-19-960146-4]` (the crowded generic hubs plus the identifier
link). The fixture and gold sets are unchanged since 3.0.3 — only the queue order changed.

**3.0.3 measured:** the lane queued the fan-out in plain document order, so `Earth` (a hub) sat
ahead of both `East African Rift` and `Hawaii`, and `Geology` sat ahead of `Hawaii`. Of the 9
(useful, hub) pairs the grader checks, 3 were inverted, giving ordering `1 − 3/9 = 0.667`.

**5.0.18 measures:** the queue now reads `Active volcano, East African Rift, Hawaii, Earth,
Geology, ISBN 0-19-960146-4` — all three kin ahead of all three hubs. Zero of the 9 pairs invert,
so ordering is `1 − 0/9 = 1.0`. Recall@budget stays 100% (the run's 5-step budget still grounds all
five real titles; `ISBN 0-19-960146-4` is a dead title excluded from `goldFollow`). Hub-avoidance
stays 33% (the run still fetches `Earth` and `Geology` within budget; reordering moves them later
in the queue, it doesn't stop the lane from eventually reaching them at this budget).

This is the shape `test-benchmarks/researchbench/README.md` and
`.claude/skills/benchmark-research/SKILL.md` named as the next lane capability after the 3.0.3
baseline: a relevance-ordering pass over the queued titles. `18ab7f79` built it.

## What's new since 3.0.3

- **`18ab7f79` — relevance-order fan-out candidates to clear RESEARCHBENCH RES-2.** The research
  lane (`src/services/research.mjs`) now tiers its queue by a relevance signal instead of replaying
  `leadLinks`' raw document order. This is the change that moves RES-2's ordering score from 67% to
  100% and un-gates RES-3 through RES-6.
- **`24b026c1` — a depth knob and a total node budget for the research queue.** Gives RES-4 (`k=2`
  completeness), RES-5 (budget discipline), and RES-6 (adaptive depth) cases the depth/budget
  controls their gold sets assume.
- **`f67346f6` — the harness moved to `test-benchmarks/researchbench/`** (from a former root-level
  `researchbench/`); paths in this write-up reflect the current location.
- **`afcd1d14` — a config-selected research provider (Wikipedia/Wikidata)**, unrelated to grading:
  the fixture provider this bench registers through the same seam is untouched.
- **Case set: still the founding 9 cases**, one per rung, unchanged since 3.0.3.

## Deliberately-kept honest gaps

**RES-7 and RES-8 are not measured this cycle, same as every cycle before it.** Need-directed
research (RES-7: stop once a specific question is answered, not just once the budget runs out) and
self-assessed coverage (RES-8: the lane judging its own completeness) are real capabilities nothing
in `src/services/research.mjs` implements yet. They stay named research horizons, each naming its
candidate literature in `.claude/skills/benchmark-research/SKILL.md` §3, and the ladder gate excludes
them from the walk rather than silently passing or failing them.

**RES-4's isolated hub-avoidance (0%) is not a regression to chase.** RES-4 tests completeness at
depth 2, not hub-avoidance — its own `RUNG_CHECKS` entry never looks at that number, so it carries
no weight in the gate. It is reported here for the same reason every number in this table is
reported: so a reader sees the whole picture, not just the ones that pass a floor.

## Discipline checklist

- **No invented traversal**: `invented=0` on all 7 measured cases; every attempted title sits in
  the fixture's own reachability closure from `Volcano`.
- **Byte-identity**: a second run at a different stamp reproduces the same rows; the harness has no
  randomness.
- **Fixture untouched**: `test-benchmarks/researchbench/fixture/graph.json` is read-only this
  cycle; no article, `leadLinks` order, or `deadTitles`/`genericTerms` entry changed.
- **One-way import held**: `grep -rn "researchbench" src/` returns nothing.
- **No live wiki reached**: the fixture provider is registered for the duration of every case and
  unregistered after; nothing in `test-benchmarks/researchbench/` imports a live-network adapter.
- **Case set unchanged**: the founding 9 cases, no additions this cycle.

## Decision

**Ship the re-measurement as-is.** The ordering fix landed as its own commit, ahead of and
independent of this write-up; this cycle records what it moved. RES-7's need-directed stop and
RES-8's self-assessed coverage are the lane capabilities that would extend the ladder further, each
already named as a research horizon in `.claude/skills/benchmark-research/SKILL.md` §3 rather than a
target for this cycle.
