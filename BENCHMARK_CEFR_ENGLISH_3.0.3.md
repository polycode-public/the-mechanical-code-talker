# BENCHMARK_CEFR_ENGLISH_3.0.3 — mean 1.773/2 across the FULL 1,075-case graded pool, 60 hard fails, 0 voids; the cycle that seeds the delta-judging cache

**Result: mean 1.773 / 2 across 1,075 cases (the full `graded-pool-max.jsonl`, not a stratified
sample), 60 hard fails, 1068/1075 tier-1 pass, 0 voided samples in the final judged set.**

This cycle is a **measurement pass plus the founding cache-seed**: it is the first run of the
mechanised harness (`PLAN_BENCHMARK_MECHANISATION.md` levers 1 and 6) against the whole pool, and
its committed artifact of record is `test-benchmarks/chatbench/verdict-cache.json` — 1,075 verdict entries keyed
by (case id, answer hash, judge model, prompt version, context version). No lever was applied to
`src/`; this write-up measures 3.0.3 as shipped.

## Timing (2026-07-24, local CEST)

- **Product replay:** ~06:15, full pool, deterministic, **4.3s wall** for 1,075 rows
  (per-band means 10–32ms/row; `test-benchmarks/chatbench/results/raw/run-3.0.3/timings.json`).
- **Judge fan-out (seed pass):** 06:15 → 08:44 in three passes at concurrency 24,
  model `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 single draw.
  The first pass voided 189 samples and the second 89 when the account hit a spend
  limit mid-run; the affected cache entries were purged and re-judged after the limit
  reset. **Final pass: 47 judged, 1,028 inherited from cache, 0 voids** — the
  delta-judging cache working exactly as designed, on its first day.
- **Analysis + write-up:** immediately following the final pass.

## Headline numbers

| band | cases | tier-1 pass | judge mean | hard fails |
|---|--:|--:|--:|--:|
| A1 | 100 | 100 | 1.863 | 0 |
| A2 | 175 | 175 | 1.798 | 12 |
| B1 | 225 | 225 | 1.886 | 3 |
| B2 | 225 | 218 | 1.814 | 9 |
| C1 | 275 | 275 | 1.662 | 25 |
| C2 | 75 | 75 | 1.546 | 11 |
| **all** | **1,075** | **1,068** | **1.773** | **60** |

- The 7 tier-1 fails are all `g-b2-count-temp-*` — the known B2 counting-with-temporal-qualifier
  undercount, carried verbatim from 2.11.0's decision log (item 2). No new tier-1 regression.
- The gradient (A/B bands ≥1.79, C1 1.66, C2 1.55) matches the pool's design: the C bands hold
  the discourse/presupposition/cross-turn constructions where the judged dimensions are
  strictest. Hard fails concentrate there (36 of 60 in C1+C2).
- The runner flagged baseline improvements at `g-c2-garden-2,9,18,19,21` (garden-path family,
  previously failing tier-1, now passing).

## Comparison to 2.11.0

Not like-for-like on the mean: 2.11.0 judged a 92-case stratified draw (mean 1.787, 1 hard
fail); this cycle judged the **full 1,075-case pool** — 12× the coverage, including every case
the stratified draw skips. On the shared basis that exists (tier-1 replay), 3.0.3 holds the same
profile: the only tier-1 fails are the same `g-b2-count-temp-*` family. The judged mean over the
full pool (1.773) sits within 0.015 of 2.11.0's sampled mean, with the C-band difficulty now
actually represented in the number.

## What this cycle changes for every future cycle

The committed `test-benchmarks/chatbench/verdict-cache.json` means an ordinary future cycle judges only cases
whose ANSWER TEXT changed: the projected judge-call drop is from 2,150 calls to the dozens a
typical change actually touches (this cycle's own final pass demonstrated 47/1,075). The cache
keys on answer content plus the judge identity (model, prompt, context version), so a pin bump
re-judges everything by construction — a fabricated pass by stale inheritance is impossible.

## Pins and reproduction

- Judge model `claude-haiku-4-5-20251001` (pinned full id), prompt `judge-prompt-v2`,
  context `fixture-context-v3`, N=2 samples, single product draw.
- Reproduce: `node test-benchmarks/chatbench/run.mjs --pool test-benchmarks/chatbench/graded-pool-max.jsonl --sample 1 --single
  --concurrency 12 --stamp 3.0.3` then `node test-benchmarks/chatbench/judge.mjs --product
  test-benchmarks/chatbench/results/raw/run-3.0.3/product.jsonl --samples 2 --concurrency 24 --cache
  test-benchmarks/chatbench/verdict-cache.json`.
- Raw (gitignored): `test-benchmarks/chatbench/results/raw/run-3.0.3/` (`product.jsonl`, `judged.jsonl`,
  `summary.json`, `timings.json`).

## Operational note for future judge passes

A spend-limit (or any mid-run `claude` CLI failure) voids samples rather than failing the run,
and a voided verdict WAS written to the cache before this cycle purged it. When a judged pass
reports `voided samples > 0`, purge the tainted entries (any cache entry whose `judged[]` holds
`void: true`) and re-run — the cache turns that into a cheap top-up, not a full re-judge.
