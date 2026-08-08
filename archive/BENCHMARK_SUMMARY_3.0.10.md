# BENCHMARK_SUMMARY_3.0.10 — a targeted refresh: CONVERSATION re-measured, the other eight axes carried from 3.0.3

This is not a full nine-axis sweep. Only **CONVERSATION** was re-measured this cycle (a fresh
persona sweep against the 3.0.3-era routed dead-ends, all four confirmed fixed). The other eight
axes — AGENT, INFERENCE, CEFR_ENGLISH, CODE_INDEX, CODE_SYNTHESIS, INGEST, RESEARCH, AGI_SCALES —
are carried forward from `reports/BENCHMARK_SUMMARY_3.0.3.md` unchanged: nothing in this cycle's
work touched the product paths those axes measure, so re-running them would reproduce the same
numbers (CEFR_ENGLISH's own product-path replay was in fact re-run this cycle as part of the
benchmark-mechanisation work below, and reproduced byte-identical tier-1 results and an identical
judged mean — see "What moved this cycle"). Read each `BENCHMARK_<AXIS>_3.0.3.md` for the full
tables, timing stamps and pins on the eight carried-over axes; this page is the cross-axis
reading, refreshed only where fresh work landed.

**The headline: zero fabrication holds, and CONVERSATION's four routed dead-ends from 3.0.3 are
now confirmed fixed in live conversation.** No harness, judge, or playtest this cycle found a
single invented fact.

## The nine, at a glance

| axis | result | vs baseline | gate / ceiling | source |
|---|---|---|---|---|
| AGENT | 68/68 at the goal ceiling (TOOL-8), 0% hallucination on all four drivers | byte-identical to 2.11.0 | resolver floor tops at TOOL-6 | `reports/BENCHMARK_AGENT_3.0.3.md` (carried over) |
| INFERENCE | kernel 100/100, chat 379/379, 0% fabrication, all bands pass | byte-identical to 2.11.0 across 577 commits | INF-7/INF-8 ceiling-graded (56/379) | `reports/BENCHMARK_INFERENCE_3.0.3.md` (carried over) |
| CEFR_ENGLISH | full 1,075-case pool judged: mean 1.773/2, 1068/1075 tier-1, 60 hard fails, 0 voids | byte-identical replay confirmed this cycle (see below) | C1/C2 carry 36 of 60 hard fails | `reports/BENCHMARK_CEFR_ENGLISH_3.0.3.md` (carried over; product path re-verified) |
| **CONVERSATION** | **45/50 turns FLOW; all 4 of 3.0.3's routed dead-ends confirmed fixed; 2 new dead-ends routed** | **ladder advances FLOW-3 → gates at FLOW-6** | **identity-phrasing gap, "what does X do" adverb-insertion gap** | **`reports/BENCHMARK_CONVERSATION_3.0.10.md` (fresh this cycle)** |
| CODE_INDEX (founding) | IDX-0..9 all pass; conformance 180/180; 0 fabrication on 21 check surfaces | — | IDX-10 has no cases yet; C# reads unmeasured | `reports/BENCHMARK_CODE_INDEX_3.0.3.md` (carried over) |
| CODE_SYNTHESIS (founding) | SYN-0 passes its gate: 4/4, 100% verified completion, 0 false-pass, byte-deterministic | — | SYN-1..8 named markers; SYN-3's rename operator is next | `reports/BENCHMARK_CODE_SYNTHESIS_3.0.3.md` (carried over) |
| INGEST (founding) | ING-0..5 at 100% recall/precision; precision 100% on every rung | — | gates at ING-6 (38% recall vs 50% floor); judged headroom: ING-8 2.0/2, ING-9 1.5/2 | `reports/BENCHMARK_INGEST_3.0.3.md` (carried over) |
| RESEARCH (founding) | RES-0/RES-1 pass; zero invented traversal | — | gates at RES-2 (ordering 67% vs 80% floor — no relevance ranking yet) | `reports/BENCHMARK_RESEARCH_3.0.3.md` (carried over) |
| AGI_SCALES | all eight entry rungs held; three scales moved (temporal-causal, stability×plasticity, loop closure) | 2.11.10 assessment | 2/8 scales scalar via the aggregator | `reports/BENCHMARK_AGI_3.0.3.md` (carried over) |

## What moved this cycle, and why

1. **CONVERSATION's four routed 3.0.3 dead-ends are fixed and confirmed live.** "give me an
   overview of this project" now routes to the architecture overview; "what are the packages
   here"/"list the packages" both enumerate correctly; "thanks bye" closes cleanly; "what is a
   cache" now carries the "General vocabulary, not from this codebase" cue. A fresh six-persona
   sweep replayed the exact previously-broken phrasings verbatim and found all four fixed, plus
   surfaced the plural temporal-comparison lane (`PLAN_DISCOURSE_AND_RECOGNITION.md`'s
   `tieRefuses` wiring, also landed this session) working correctly in a live conversation for
   the first time — not just as a unit test. Full write-up: `BENCHMARK_CONVERSATION_3.0.10.md`.
2. **`PLAN_BENCHMARK_MECHANISATION.md`'s three remaining levers landed.** Lever 2 (bulk matcher
   distillation): comparing the 3.0.3 and 3.0.10 judged cycles, 440 stable-pass CEFR cases (of
   563 candidates — 123 were rejected on review as too weak, a real finding recorded below) were
   promoted to deterministic matchers; a fresh judge run with promotion active reproduced the
   identical 1.773/2 mean at **zero paid judge calls** (440 promoted, 635 cache-inherited, 0
   fresh). Lever 3 (calibration grade): the 52-case calibration set graded at both frontier and
   small-model tier, gating which rubric families can safely down-tier off the frontier judge
   (see `downtier.json`). Lever 4 (ingestbench wiring): `test-benchmarks/ingestbench/`'s
   deterministic paraphrase-equivalence checker wired into chatbench's tier-1 gate for
   paraphrase-shaped cases. `PLAN_BENCHMARK_MECHANISATION.md` now records all seven levers
   landed.
3. **A real gap found reviewing lever 2's first bulk pass.** 123 of the 563 candidate matchers
   were a single bare digit (`["1"]`) as their entire requirement — syntactically an escaped
   literal from the real answer (so the existing `matcherTighterThanJudge` check passed them),
   but semantically too weak to trust as a permanent judge-bypass (almost any answer could
   contain that digit somewhere by coincidence). `distillMatcher` now rejects an all-bare-single-
   digit token set, deferring those cases to the judge instead of promoting a weak matcher —
   this hardens the mechanism for every future distillation pass, not just this one.

## The gates, ranked by leverage

1. **RES-2 ordering (67% vs 80%)** — one relevance-ordering pass in
   `src/services/research.mjs` un-gates RES-3..6, which already hold receipts. *(carried over,
   unmeasured this cycle)*
2. **ING-6 ordinal/temporal threading (38% vs 50%)** — the "First … Then …" slice; lifting it
   un-gates ING-7 and promotes the strong judged headroom. *(carried over, unmeasured this
   cycle)*
3. **CONVERSATION's two FLOW-6 gates** — closed-set additions (colloquial identity-question
   phrasing, "what does X do" adverb-insertion tolerance); both the same cheap shape as the four
   gates this cycle just confirmed fixed.
4. **SYN-3's rename operator** — the first real transformation for the synthesis ladder.
   *(carried over, unmeasured this cycle)*

All four are tracked as open items in `NEXT.md` with their owning plan docs (CONVERSATION's two
new gates included).

## Pins

Judge (CEFR, CONVERSATION where a judge ran): `claude-haiku-4-5-20251001`, prompt
`judge-prompt-v2`. CONVERSATION's fresh persona sweep was judged by the coordinator directly
(no separate pinned-model pass this cycle — see `BENCHMARK_CONVERSATION_3.0.10.md`'s own note).
Lever 3's calibration frontier pass: `claude-opus-5`. Product path: no model anywhere on any
axis; every deterministic axis replayed byte-identically. Versions: measured tree 3.0.10 for
CONVERSATION and the mechanisation work; the other eight axes' numbers are 3.0.3's own,
unrefreshed.
