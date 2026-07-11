# BENCHMARK_CEFR_ENGLISH_1.4.1 — first judged run under case-set v3 (the 109-case go-to default), a new baseline

**Headline:** first judged CHATBENCH run since `0.8.2` (which shipped judge-free, deliberately —
see that report's deferral section), and the **first run ever against case-set v3**
(`SKILL_BENCHMARK_CEFR_ENGLISH.md` §1, this session): the go-to profile is now `chatbench/graded-pool.jsonl`
alone (109 cases — 10/CEFR-grade plus the former `chatbench/cases.jsonl`'s 49 hand-authored
capability cases, each assigned a real grade+construction cell), judged at **N=2 samples, single
draw** (218 judge calls total), a deliberate cost reduction from the historical default (N≥3,
dual-draw, over a much larger case-set v2 pool). **This report is a new baseline for the new
profile, not a like-for-like regression comparison against `0.8.2`'s 619-case dual-draw run** — the
case sets differ in composition and size, so a raw mean-to-mean comparison would be misleading; use
this report's own numbers going forward for future re-runs of the same 109-case profile.

**Result: mean 1.624 / 2, 6 hard fails out of 109 cases (5.5%), 0 voided samples.**

**Timing** (from real result-file mtimes, `timings.json`'s own recorded wall-time for the product
run, and the write-up commit timestamp):

| stage | time | duration |
| --- | --- | --- |
| product-run start (approx.) | 2026-07-10 ~12:17:42 BST | — |
| product-run end (`product.jsonl` mtime; `timings.json` records 6103ms wall-time) | 2026-07-10 12:17:48 BST | ~6s |
| judge-run start (approx., launched immediately after product run) | 2026-07-10 ~12:17:50 BST | — |
| judge-run end (`judged.jsonl` mtime) | 2026-07-10 12:32:20 BST | **~14m30s** (judge duration) |
| write-up committed (`94f18a5`) | 2026-07-10 12:34:13 BST | **~16m31s** (product-run start→write-up-end) |
| concurrency | product run: sequential (single draw, no fan-out); judge run: 12 (`--concurrency 12`), 218 total judge calls | |

The judge run's wall-time (~14.5 min for 218 calls) ran notably longer than a naive
concurrency-divided latency estimate would predict — consistent with real per-call LLM latency
plus this session's heavy concurrent background load at the time, not a harness issue (0 voided
samples, no retries logged).

## Deterministic tier-1 (free, run first)

`node chatbench/run.mjs --stamp 1.4.1 --sample 1 --single` (raw:
`chatbench/results/raw/run-1.4.1/product.jsonl`), 109 cases, single draw, wall-time **6.1s**.

| band | n | tier-1 green | frontier |
| --- | --: | --: | --: |
| A1 | 27 | 24 | 3 |
| A2 | 19 | 14 | 5 |
| B1 | 33 | 31 | 1 |
| B2 | 10 | 10 | 0 |
| C1 | 10 | 10 | 0 |
| C2 | 10 | 0 | 10 |
| **all** | **109** | **89** | **21** |

C2's 0/10 is entirely the `pronoun-binding` construction cell — a known, long-standing ceiling
(garden-path/complex-anaphora resolution at the hardest CEFR tier), not a regression; every other
band/cell is at or near its performance ceiling.

## Judged tier (the paid step — N=2, single draw, `claude-haiku-4-5-20251001` @ `judge-prompt-v1`)

`node chatbench/judge.mjs --product chatbench/results/raw/run-1.4.1/product.jsonl --samples 2
--concurrency 12` (raw: `chatbench/results/raw/run-1.4.1/judged.jsonl` + `summary.json`)

| metric | value |
| --- | --- |
| cases judged | 109 |
| samples/case | 2 (218 total judge calls) |
| overall mean | **1.624 / 2** |
| hard fails | **6** (5.5%) |
| voided samples | **0** |
| tier-1 pass count | 108 / 109 |

### Per-tag breakdown

| tag | cases | mean | hard fails |
| --- | --: | --: | --: |
| conversational | 6 | **2.000** | 0 |
| bootstrap-empty | 2 | **2.000** | 0 |
| multi-turn-focus | 5 | 1.950 | 0 |
| typo-fuzzy | 4 | 1.917 | 0 |
| memory-recall | 3 | 1.833 | 0 |
| noise | 5 | 1.800 | 0 |
| graph-query | 16 | 1.807 | 0 |
| honesty-miss | 5 | 1.467 | 0 |
| ambiguity | 4 | 1.188 | 0 |
| graded (all 109) | 109 | 1.624 | 6 |

Every non-"graded" tag here is the folded-in former `cases.jsonl` core — all clean, zero hard
fails, the weakest cell (`ambiguity`, 1.188) still comfortably above the judge's own honest-miss
floor. The six hard fails are concentrated in two graded cells:

### The 6 hard fails

| case | tags | mean | groundedness | correctness | honesty | rephrase |
| --- | --- | --: | --: | --: | --: | --: |
| `g-a2-naming-2` | A2 naming-vocabulary | 0.75 | 2 | 0 | 0 | 1 |
| `g-a2-naming-6` | A2 naming-vocabulary | 0.25 | 1 | 0 | 0 | 0 |
| `g-c2-pron-3` | C2 pronoun-binding | 0.50 | 1.5 | 0 | 0 | 0.5 |
| `g-c2-pron-7` | C2 pronoun-binding | 0.125 | 0 | 0 | 0 | 0.5 |
| `g-c2-pron-8` | C2 pronoun-binding | 0.625 | 1.5 | 0 | 0 | 1 |
| `g-c2-pron-10` | C2 pronoun-binding | 0.625 | 2 | 0 | 0 | 0.5 |

Every hard fail scores 0 on **correctness** and **honesty** specifically — the pattern is a
confidently-wrong answer, not an honest miss (the deterministic tier-1 pass rate above already
flagged all 10 C2 `pronoun-binding` cases as red; the judge confirms 4 of those 10 are not just
tier-1-red but actively *wrong-confident*, the worse failure mode). The 2 `A2 naming-vocabulary`
hard fails are worth a closer look next cycle — that cell wasn't flagged as a known ceiling the way
C2 pronoun-binding is.

## Cross-check against the playtest sprint run alongside this benchmark

A 3-round playtest sprint (`SKILL_BENCHMARK_PLAYTEST.md` §3, this session, `examples/mini-webapp`)
ran concurrently and found one real, fixed dead-end (bare "what does this do" hit the grammar wall
— fixed, committed, verified live) plus two documented-but-unfixed gaps (a "who **last** touched X"
superlative not respected — lists full history instead of the single most-recent toucher; an
"every X has a Y method" teach-shape failing with an unhelpful, non-specific error). Neither playtest
finding overlaps with CHATBENCH's own hard fails above — different surfaces, complementary signal,
exactly the intended relationship between the two benchmarks.

## Discipline — the non-negotiables, checked

- **No LLM in the product** — the judge lives only in the eval harness; `chat.mjs`/`runTurn` stayed
  no-LLM throughout, per `CLAUDE.md`'s standing rule.
- **Judge model + prompt version pinned**: `claude-haiku-4-5-20251001` @ `judge-prompt-v1`, recorded
  in `summary.json`.
- **Judge integrity**: 0 voided samples — no refusal/format failure this run.
- **Determinism (tier-1)**: single product run, single draw (`--sample 1 --single`) — deliberate,
  documented departure from the historical dual-draw default, per `SKILL_BENCHMARK_CEFR_ENGLISH.md`'s
  case-set v3 update (the 10/grade cap is itself the anti-overfitting control now, not a further
  runtime sample).
- **`npm test`**: 1665/1665 green at the commit this measurement is pinned to.

## Reproduce

```
node chatbench/run.mjs --stamp 1.4.1 --sample 1 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-1.4.1/product.jsonl --samples 2 --concurrency 12
```

For a full-pool, higher-confidence pass instead: `--pool chatbench/graded-pool-max.jsonl` on the
`run.mjs` step (1,075 cases), then judge at the historical N≥3/dual-draw defaults.

## Next

- **C2 `pronoun-binding`** is the clear, concentrated priority — 0/10 tier-1, 4/10 judged hard
  fails, all confidently-wrong not honest-miss. This is `PLAN_CHAT_FEEL.md`'s own long-standing
  hardest-tier ceiling; no work landed on it this session (item 6's temporal-composition remainder
  was closed instead — see `HANDOVER.md`'s ranked list for the full picture).
- **`A2 naming-vocabulary`**'s 2 hard fails are new signal, not a known ceiling — worth a closer
  read of the actual transcripts before the next cycle picks a lever.
- **A full-pool run** (`graded-pool-max.jsonl`) would give broader construction-cell coverage before
  a release; the 109-case go-to profile is deliberately narrower, for routine/frequent cycles.
