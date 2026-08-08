# BENCHMARK_RESEARCH_3.0.3 — the first RESEARCHBENCH cycle: RES-2 gates today, honestly

## Timing

- **Date:** 2026-07-24.
- **Benchmarking session:** 05:38:47–05:38:54 CEST (one arm, `--ladder`, 9 cases, no LLM, no
  network, no judge — the whole run is a frozen fixture and a real traversal driver).
- **Analysis + write-up:** 05:38:54–05:55 CEST, same session.

**Headline: the first-ever RESEARCHBENCH run measures exactly what `SKILL_BENCHMARK_RESEARCH.md`
and `test-benchmarks/researchbench/README.md` said it would — RES-0 and RES-1 pass clean, RES-2 gates on its
ordering floor (67% against an 80% floor), and RES-3 through RES-6 report skipped-with-a-receipt
because the ladder gates ascending.** This is not a broken harness or a missed target: today's
research lane queues its fan-out in plain document order with no relevance ranking, so a rung that
tests ordering legitimately fails its floor the first time anyone measures it. That is the founding
baseline this cycle exists to record.

## Run

`npm run researchbench:run -- --ladder --stamp 3.0.3` (`node test-benchmarks/researchbench/run.mjs --ladder --stamp
3.0.3`): 9 cases, one per rung RES-0…RES-8, against the committed volcano fixture
(`test-benchmarks/researchbench/fixture/graph.json`), no live wiki, no LLM, no judge. Exit 0. Raw output (untracked,
per `test-benchmarks/researchbench/results/.gitignore`):
`test-benchmarks/researchbench/results/raw/run-3.0.3/product.jsonl`.

## The rung table (metric trio + gate)

Gate: recall@budget ≥ 50% always; hub-avoidance ≥ 80% and ordering ≥ 80% only where the rung's own
"what it tests" column names them (`RUNG_CHECKS` in `test-benchmarks/researchbench/grade.mjs`); zero invented
traversal. The **PASS/---- column below is each rung graded in isolation** against its own
applicable floors; the **ladder line under the table is the ascending walk**, which gates every rung
above the first floor-miss regardless of that rung's own isolated number.

| rung | n | recall@budget | hub-avoidance | ordering | invented | isolated gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| RES-0 | 1 | 100% | 100% | n/a | 0 | PASS |
| RES-1 | 1 | 100% | 33% | 67% | 0 | PASS |
| RES-2 | 1 | 100% | 33% | 67% | 0 | ---- |
| RES-3 | 1 | 67% | 67% | 67% | 0 | ---- |
| RES-4 | 1 | 100% | 0% | 67% | 0 | PASS |
| RES-5 | 1 | 50% | 33% | 67% | 0 | PASS |
| RES-6 | 1 | 75% | 33% | 67% | 0 | PASS |
| RES-7 | 0 (1 ceiling) | 100% | 100% | n/a | 0 | n/a (ceiling) |
| RES-8 | 0 (1 ceiling) | 100% | 100% | n/a | 0 | n/a (ceiling) |

**Ladder (ascending, `--ladder`): RES-0 → RES-1 → RES-2 → RES-3 → RES-4 → RES-5 → RES-6 — gated at
RES-2, gap 13%** (ordering 67% against the 80% floor). Receipts:

- `RES-3 skipped: gated by RES-2 gap 13%`
- `RES-4 skipped: gated by RES-2 gap 13%`
- `RES-5 skipped: gated by RES-2 gap 13%`
- `RES-6 skipped: gated by RES-2 gap 13%`

RES-1 and RES-2 don't test hub-avoidance (`RUNG_CHECKS`: only RES-3 does), and RES-4/5/6 don't test
ordering or hub-avoidance in isolation (only recall applies to their own gate) — so their isolated
column reads PASS even though the ladder walk has already gated at RES-2. Both readings are
correct at once: a rung's own number and its place in the ascending walk are different questions,
exactly as `SKILL_BENCHMARK_RESEARCH.md` §1's rung-gate rule specifies.

RES-7 and RES-8 never reach the lane at all (`isCeilingRung` in `test-benchmarks/researchbench/run.mjs`) — they are
named research horizons, not floor-misses, and the ladder excludes them from the gate walk
entirely (`ladderGate`'s `tiers` filter drops them before `ladderGateBy` runs).

**Zero invented traversal across all 7 measured cases** — every grounded or skipped title in every
row sits inside the fixture's own reachability closure from `volcano` at that case's `k`. The
harness's automatic-fail line held clean on its first-ever run.

## Worked example — the canonical volcano case (RES-1/RES-2, `res-volcano-queue` / `res-volcano-order`)

Seed `Volcano`'s lead links, in document order (`test-benchmarks/researchbench/fixture/graph.json`):

```
Active volcano, Earth, East African Rift, Geology, Hawaii, ISBN 0-19-960146-4
```

Gold sets for this case: `goldFollow = [Active volcano, East African Rift, Hawaii]` (the useful
kin), `goldHubs = [Earth, Geology, ISBN 0-19-960146-4]` (the crowded generic hubs plus the
identifier link).

The lane queues the fan-out in the fixture's own document order — `linkedTitles` reads the lead
section top to bottom, no reordering — so the actual queue is exactly the link list above. That
queue interleaves kin and hub: `Active volcano` (kin) comes first, then `Earth` (hub) second,
`East African Rift` (kin) third, `Geology` (hub) fourth, `Hawaii` (kin) fifth. Of the 3×3 = 9
(useful, hub) pairs the grader checks (a useful term ranked ahead of a hub is correct; behind is an
inversion), 3 are inverted — `Earth` sits ahead of both `East African Rift` and `Hawaii`, and
`Geology` sits ahead of `Hawaii` — giving ordering `1 − 3/9 = 0.667`, the 67% in the table. Recall@
budget is 100% (the run's 5-step budget grounds all five real titles, `ISBN 0-19-960146-4` is a
dead title the fixture returns null for and is excluded from `goldFollow`). Hub-avoidance is 33%
(1 − 2/3: the run fetches 2 of the 3 gold hubs — `Earth` and `Geology` — within budget; only the
identifier link goes unfetched because it's a dead title skipped by the lane's own dead-link path,
not because anything demoted it).

This is precisely the shape `test-benchmarks/researchbench/README.md` predicted before this run ever executed:
"today's fan-out is plain document order with no relevance ranking or hub demotion, so RES-2's
ordering floor (0.8) legitimately fails against the canonical volcano case (order score ≈0.67)."
The measured 0.667 confirms that prediction to three decimal places.

## What's new this cycle

- **The harness itself, built from `SKILL_BENCHMARK_RESEARCH.md`'s spec** (commit `3803fe96`,
  landed same-day, ahead of this write-up): `test-benchmarks/researchbench/fixture/graph.json` (the volcano
  fixture), `test-benchmarks/researchbench/fixture/provider.mjs` (the provider seam adapter), `test-benchmarks/researchbench/grade.mjs`
  (the metric trio + ladder gate), `test-benchmarks/researchbench/run.mjs` (the runner driving the real
  `researchTurn`/`researchSnapshot` lane), `test-benchmarks/researchbench/cases.jsonl` (9 cases, one per rung),
  `test-benchmarks/researchbench/README.md` (the mechanics). This cycle is the harness's first measured run, not a
  re-measurement — there is no prior `BENCHMARK_RESEARCH_*.md` to diff against.
- `researchbench:run` added to `package.json` scripts (this cycle), so the loop can invoke it the
  same way `agentbench:run`/`infbench:run` are invoked.
- Case set: 9 cases, all against the single committed volcano fixture — no cases added this cycle
  beyond the founding set the harness landed with.

## Deliberately-kept honest red

**RES-2's ordering gate (67% against an 80% floor) is a measurement, not a defect to patch around.**
The research lane (`src/services/research.mjs`) has never had a relevance-ordering pass — it queues
`linkedTitles` in whatever order the lead section lists them, which is exactly what RES-0/RES-1
grade and exactly what RES-2 was designed to test past. This cycle does not add an ordering pass;
building one is real lane engineering (a next cycle's Step 5, per `SKILL_BENCHMARK_RESEARCH.md`
§2), not something to retrofit under a measurement-cycle write-up. RES-3 through RES-6 sit
skipped-with-a-receipt behind it for the same reason — their own isolated numbers (RES-4 at 100%
recall, RES-6 at 75%) are real, but the ladder correctly treats "the ordering floor already failed"
as gating everything downstream of it, per the skill's rung-gate rule. RES-7/RES-8 remain named
research horizons (need-directed research; self-assessed coverage), each naming its candidate
literature in `SKILL_BENCHMARK_RESEARCH.md` §3.

## Discipline checklist

- **No invented traversal**: `invented=0` on all 7 measured cases (`product.jsonl`); every
  attempted title sits in the fixture's own reachability closure from `Volcano`.
- **Byte-identity**: this is the harness's first run, so there is no prior stamp to diff against;
  a re-run of `--stamp 3.0.3` before any code changes reproduces the same table (the harness has no
  randomness — every metric is a pure function over the committed fixture and the recorded walk).
- **Fixture untouched**: `test-benchmarks/researchbench/fixture/graph.json` is read-only this cycle; no article,
  `leadLinks` order, or `deadTitles`/`genericTerms` entry changed.
- **One-way import held**: `grep -rn "researchbench" src/` returns nothing — the bench imports
  downward from `src/services/research.mjs` and `src/adapters/corpus/wikipedia-live.mjs`, never the
  reverse.
- **No live wiki reached**: the fixture provider is registered for the duration of every case
  (`registerResearchProvider`/`getResearchProvider` in `driveCase`) and unregistered after; nothing
  in `test-benchmarks/researchbench/` imports a live-network adapter.
- **Case set and fixture stay append-only from here**: this cycle adds none beyond the founding 9;
  the next cycle that wants deeper coverage records the addition in its own write-up, per
  `SKILL_BENCHMARK_RESEARCH.md` §1.

## Decision

**Ship the founding baseline as-is.** RES-2's ordering gate is the honest, expected first-cycle
result — the skill doc and `test-benchmarks/researchbench/README.md` both named it before this run executed, and
the measured numbers confirm the prediction. The next RESEARCHBENCH cycle's Step 5 target is a
relevance-ordering pass over the queued titles that pushes RES-2's ordering score past 0.8 without
regressing RES-0/RES-1's recall or inventing any traversal — that is real lane engineering
(`src/services/research.mjs`), scoped to its own cycle rather than folded into this measurement
write-up.
