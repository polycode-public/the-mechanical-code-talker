# STATUS — tmct's latest measured capability, one page

What tmct's benchmark suite last proved, and against what version of the tree. This page is
generated from the reports already committed in this directory — see
`SKILL_REFRESH_STATUS.md` for the refresh recipe. It does not re-run anything itself.

**Measured tree: 3.0.3. Repo now at 3.0.6.** The numbers below are the last full sweep's
numbers, not a live reading. Real work has landed since 3.0.3 was measured — discourse Part A
slices 3–5 and the plural temporal-comparison lane (`PLAN_DISCOURSE_AND_RECOGNITION.md`), this
repo-layout restructuring — none of it re-benchmarked yet. Treat every number here as "true as
of 3.0.3", not "true today", until the next sweep lands.

## The nine axes, at a glance

Source: `reports/BENCHMARK_SUMMARY_3.0.3.md`, itself drawn from the nine per-axis reports below.

| axis | result | vs baseline | gate / ceiling | source |
|---|---|---|---|---|
| AGENT | 68/68 at the goal ceiling (TOOL-8), 0% hallucination on all four drivers | byte-identical to 2.11.0 | resolver floor tops at TOOL-6 | `reports/BENCHMARK_AGENT_3.0.3.md` |
| INFERENCE | kernel 100/100, chat 379/379, 0% fabrication, all bands pass | byte-identical to 2.11.0 across 577 commits | INF-7/INF-8 ceiling-graded (56/379) | `reports/BENCHMARK_INFERENCE_3.0.3.md` |
| CEFR_ENGLISH | full 1,075-case pool judged: mean 1.773/2, 1068/1075 tier-1, 60 hard fails, 0 voids | 2.11.0 judged a 92-case sample (1.787); same tier-1 fail family (`g-b2-count-temp-*`), 12× the coverage | C1/C2 carry 36 of 60 hard fails | `reports/BENCHMARK_CEFR_ENGLISH_3.0.3.md` |
| CONVERSATION | 37/40 judged turns FLOW; dead-end density ~43% → ~8% of turns; 12 new frozen regressions | ladder advances FLOW-0 → gates at FLOW-3 | two routing edges (overview-of-project, packages) | `reports/BENCHMARK_CONVERSATION_3.0.3.md` |
| CODE_INDEX (founding) | IDX-0..9 all pass; conformance 180/180; 0 fabrication on 21 check surfaces | — | IDX-10 has no cases yet; C# reads unmeasured | `reports/BENCHMARK_CODE_INDEX_3.0.3.md` |
| CODE_SYNTHESIS (founding) | SYN-0 passes its gate: 4/4, 100% verified completion, 0 false-pass, byte-deterministic | — | SYN-1..8 named markers; SYN-3's rename operator is next | `reports/BENCHMARK_CODE_SYNTHESIS_3.0.3.md` |
| INGEST (founding) | ING-0..5 at 100% recall/precision; precision 100% on every rung | — | gates at ING-6 (38% recall vs 50% floor — the ordinal/temporal horizon); judged headroom: ING-8 2.0/2, ING-9 1.5/2 | `reports/BENCHMARK_INGEST_3.0.3.md` |
| RESEARCH (founding) | RES-0/RES-1 pass; zero invented traversal | — | gates at RES-2 (ordering 67% vs 80% floor — no relevance ranking yet) | `reports/BENCHMARK_RESEARCH_3.0.3.md` |
| AGI_SCALES | all eight entry rungs held; three scales moved (temporal-causal, stability×plasticity, loop closure) | 2.11.10 assessment | 2/8 scales scalar via the aggregator | `reports/BENCHMARK_AGI_3.0.3.md` |

**Headline (3.0.3): zero fabrication on every axis.** No harness, judge, or playtest found a
single invented fact in the sweep.

## The gates, ranked by leverage

From `reports/BENCHMARK_SUMMARY_3.0.3.md`'s own ranking — the fixes with the widest downstream
unlock, most leveraged first:

1. **RES-2 ordering (67% vs 80%)** — one relevance-ordering pass in `src/services/research.mjs`
   un-gates RES-3..6, which already hold receipts.
2. **ING-6 ordinal/temporal threading (38% vs 50%)** — the "First … Then …" slice; lifting it
   un-gates ING-7 and promotes the strong judged headroom.
3. **FLOW-3's two routing edges** — closed-set additions (overview-of-project phrasing, packages
   as a listable kind).
4. **SYN-3's rename operator** — the first real transformation for the synthesis ladder.

All four are tracked as open items in `NEXT.md` with their owning plan docs.

## Site weight

Source: `reports/PAGE_WEIGHTS.md` — see that file for its own version stamp and per-page
breakdown. Not duplicated here; refresh it via `SKILL_PAGE_WEIGHTS.md` when the deployed site
changes materially.

## Methodology pins

Judge model (CEFR, CONVERSATION, INGEST ING-8/9): `claude-haiku-4-5-20251001`, prompts
`judge-prompt-v2` / `ingest-judge-v1`, N=2. Product path: no model call anywhere; every
deterministic axis replayed byte-identically. The judge is offline-eval tooling only, never in
the shipped product — see `CLAUDE.md`'s project section.

## Refreshing this page

Run `SKILL_REFRESH_STATUS.md` after a new benchmark sweep lands (a new or updated
`reports/BENCHMARK_*.md`), or when this page's "measured tree" version falls materially behind
`package.json`'s current version. The skill does not run benchmarks itself — it reads whatever
reports already exist and resynthesizes this page from them.
