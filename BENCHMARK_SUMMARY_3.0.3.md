# BENCHMARK_SUMMARY_3.0.3 — the first full nine-axis sweep, one page

The 3.0.3 cycle (2026-07-24) is the first time all nine benchmark axes ran in one sweep: four
founding baselines on harnesses built the same day (CODE_INDEX, CODE_SYNTHESIS, INGEST,
RESEARCH), three re-measurements against 2.11.0 (AGENT, INFERENCE, CEFR_ENGLISH), the judged
CONVERSATION cycle, and the AGI-scales assessment. Each axis has its own
`BENCHMARK_<AXIS>_3.0.3.md` with the full tables, timing stamps and pins; this page is the
cross-axis reading.

**The headline: zero fabrication on every axis, and every gate that closed is a measurement,
not a defect.** No harness, judge or playtest found a single invented fact this cycle.

## The nine, at a glance

| axis | result | vs baseline | gate / ceiling |
|---|---|---|---|
| AGENT | 68/68 at the goal ceiling (TOOL-8), 0% hallucination on all four drivers | byte-identical to 2.11.0 | resolver floor tops at TOOL-6 |
| INFERENCE | kernel 100/100, chat 379/379, 0% fabrication, all bands pass | byte-identical to 2.11.0 across 577 commits | INF-7/INF-8 ceiling-graded (56/379) |
| CEFR_ENGLISH | **full 1,075-case pool** judged: mean 1.773/2, 1068/1075 tier-1, 60 hard fails, 0 voids | 2.11.0 judged a 92-case sample (1.787); same tier-1 fail family (`g-b2-count-temp-*`), 12× the coverage | C1/C2 carry 36 of 60 hard fails |
| CONVERSATION | 37/40 judged turns FLOW; dead-end density ~43% → ~8% of turns; 12 new frozen regressions | ladder advances FLOW-0 → gates at FLOW-3 | two routing edges (overview-of-project, packages) |
| CODE_INDEX (founding) | IDX-0..9 all pass; conformance 180/180; 0 fabrication on 21 check surfaces | — | IDX-10 has no cases yet; C# reads unmeasured |
| CODE_SYNTHESIS (founding) | SYN-0 passes its gate: 4/4, 100% verified completion, 0 false-pass, byte-deterministic | — | SYN-1..8 named markers; SYN-3's rename operator is next |
| INGEST (founding) | ING-0..5 at 100% recall/precision; **precision 100% on every rung** | — | gates at ING-6 (38% recall vs 50% floor — the ordinal/temporal horizon); judged headroom: ING-8 2.0/2, ING-9 1.5/2 |
| RESEARCH (founding) | RES-0/RES-1 pass; zero invented traversal | — | gates at RES-2 (ordering 67% vs 80% floor — no relevance ranking yet) |
| AGI_SCALES | all eight entry rungs held; **three scales moved** (temporal-causal: row 19 composes; stability×plasticity: cross-version byte-identity now measured; loop closure: init-to-indexed-chat) | 2.11.10 assessment | 2/8 scales scalar via the new aggregator |

## What moved this cycle, and why

Three things the 3.0.x work changed showed up directly in the numbers:

1. **The discourse record** (slices 1–2) flipped the frozen row
   `games/cross-turn-temporal-composition-composes` and put a live temporal composition into
   CONVERSATION's git-historian frame — the AGI temporal-causal scale records half its
   next rung on record.
2. **Code indexing** (the 3.0.0 major) produced both founding code baselines and the
   CONVERSATION sweep's biggest quality jump: the new-surface flows (architecture, code
   drill-downs with anaphora, digest read-backs) judged clean after the same-day fix passes.
3. **The mechanised judge harness** cut its own cost on day one: the CEFR seed pass ended
   with a final top-up that judged 47 cases and inherited 1,028 from the committed
   verdict cache. An ordinary future cycle judges only what changed.

## The gates, ranked by leverage

1. **RES-2 ordering (67% vs 80%)** — one relevance-ordering pass in
   `src/services/research.mjs` un-gates RES-3..6, which already hold receipts.
2. **ING-6 ordinal/temporal threading (38% vs 50%)** — the "First … Then …" slice; lifting it
   un-gates ING-7 (already passing on value-compare) and promotes the strong judged headroom.
3. **FLOW-3's two routing edges** — closed-set additions (overview-of-project phrasing,
   packages as a listable kind); the fix round is queued in NEXT.md.
4. **SYN-3's rename operator** — the first real transformation for the synthesis ladder;
   `PLAN_CODE_PLANNING.md` Track 5's planner already plans it against the fixture graph.

All four are named as open items in `NEXT.md` with their owning plan docs.

## Pins

Judge (CEFR, CONVERSATION, INGEST ING-8/9): `claude-haiku-4-5-20251001`, prompts
`judge-prompt-v2` / `ingest-judge-v1`, N=2. Product path: no model anywhere; every
deterministic axis replayed byte-identically. Versions: measured tree 3.0.3; the write-ups and
this summary ship in 3.0.5.
