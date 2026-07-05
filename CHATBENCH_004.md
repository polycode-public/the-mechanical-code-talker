# CHATBENCH_004 — the meta-fixes + B1 levers cycle (groundedness RE-BASELINE)

**Headline: mean 1.303 / 2 · 51 hard fails · 0 voided samples · 333 cases × 3 judge samples.**
Judge pinned: `claude-haiku-4-5-20251001` / `judge-prompt-v1`. Judge context: **`fixture-context-v2`**
(Meta-1 enrichment — confirmed live in the judged prompt). Dual-draw: product-a (v1 + draw A, 333
rows) + product-b (draw B). **No tier-1 regressions** vs cycle-003 (all 333 tier-1 pass).

> **This is a groundedness RE-BASELINE cycle.** Meta-1 enriched `FIXTURE_CONTEXT` from module-grain
> to full symbol-grain + memory vocabulary, so cycle-4-onward groundedness is NOT directly comparable
> to cycles 1–3 (their rich-answer groundedness was scored against the poorer context). The bridge
> datapoint below re-reads the exact same cases through the enriched judge. Correctness/honesty and
> the v1 byte-identical spine remain comparable across the break.

## Verdict: PASS

- **Mean up** vs cycle-003 (1.258 → 1.303) **and no product pass→fail regression.** The two v1 cases
  whose *judged mean* dipped (`hm-unknown-fn` 1.00→0.89, `ns-wondering` 1.17→0.83) have
  **byte-identical product answers** across c3→c4 — the movement is LLM-judge noise on an unchanged
  honest-miss, not a product regression. Tier-1 is clean (333/333).
- **Judge integrity clean:** 0 voided samples (no refusal/format failure leaked into the fail count).

> **Methodology note (cross-cycle identity):** `caseId` is a stable identity ONLY for the
> hand-authored v1/memory cases (e.g. `hm-unknown-fn`, `mr-asked-before`) — the byte-identical-dip
> rebuttal above is applied to those. It is NOT stable for `g-*` graded-pool cases: the pool
> re-seeds each cycle (c3 seed `2419986853` → c4 `2302543520`), so an identical `g-*` id is a
> DIFFERENT question across cycles (some c4 honesty "drops" are re-samples, not regressions). Graded
> comparisons are therefore made at the **cell-level mean** (grade × construction), never per-`g-*`-id,
> per `GRADED.md`.

## Meta-1 — the re-float (the whole point of this cycle)

The judge was systematically scoring TRUTHFUL symbol-grain output as fabrication because the old
context omitted it. Re-reading the target cases through the enriched judge:

| case | c3 groundedness | c4 groundedness | Δ |
|---|---|---|---|
| gq-describe-widget | 1.00 | 2.00 | **+1.00** |
| mr-asked-before | 0.67 | 2.00 | **+1.33** |
| mt-describe-then-callers | 2.00 | 2.00 | +0.00 |
| mr-graph-intact | 2.00 | 2.00 | +0.00 |
| mr-session-count | 2.00 | 2.00 | +0.00 |
| **subgroup mean** | **1.533** | **2.000** | **+0.467** |

The two cases that were being penalised for telling the truth (the `/describe` symbol detail and the
cross-session recall citing a session id the judge couldn't see) are now perfect. This is measurement
integrity restored, exactly as `PLAN_CYCLE_4.md` predicted — **not** a product change.

> Aggregate groundedness (1.593 over 965 samples) is grammar-lane-dominated ~64:1 and is NOT a valid
> re-float signal; the 5-case subgroup above is. (Advisor tick 5 flagged this; the write-up honours it.)

## Per-grade mean rubric (c4)

| grade | c4 mean | cycle-3 | note |
|---|---|---|---|
| v1 | 1.684 | 1.629 | the frozen spine, re-floated |
| A1 | 1.737 | 1.72 | shelf, stable |
| A2 | 1.948 | 1.70 | **+0.25** — Meta-1 re-float on A2 naming (was 0.60 at 5/5, a miscalibration) |
| **B1** | **1.272** | **0.766** | **+0.51 — the cliff, lifted** (negation + reversible-passive + re-float) |
| B2 | 1.144 | 0.97 | +0.17 (passive direction) |
| C1 | 0.922 | 1.07 | tier-1-only ceiling territory (Meta-2 — not the judged focus) |
| C2 | 0.503 | 0.69 | ceiling marker (Meta-2) |

Dimension means (c4): groundedness 1.593 · correctness 1.061 · honesty 0.991 · rephrase 0.486.

## Predictions vs actuals (PLAN_CYCLE_4)

| lever | predicted | actual |
|---|---|---|
| B1 negation | B1 0.77→~1.05; neg cell →~1.6 | B1 grade **1.272**; negation cells green (5/5) |
| reversible-passive | B1 +~0.18; B2 passive 0.0→~1.6 | passive cells 5/5; B2 0.97→1.14 |
| Meta-1 re-float | A2 naming 0.60→~1.8; un-cap mr-asked-before | A2 grade →1.95; mr-asked-before 0.67→2.00 |
| pool growth | 3 under-covered cells re-enter | B1 pron/temporal + C1 temporal now census cells, Δ green-rate = 0 |

B1 landed at **1.272**, short of the ~1.5 "B1 reliable" exit bar but a **+0.51 lift off the 0.766
cliff** — negation and reversible-passive both went from no-machinery to green, and the combo cells
(pron+neg, count+temp) remain the residual frontier (0/5), consistent with the plan's "pairing of
missing verbs" diagnosis.

## Per-lever analysis

- **B1 negation (set complement):** "classes that do not inherit from Base" → "Base and Button." —
  `via:composed`, bounded-universe complement, honest-empty preserved. Cleared the negation cells.
- **reversible-passive:** "which modules are imported by b.test.mjs" now traverses forward from the
  agent and returns the honest specific result with a traversal receipt (was reversed → wrong).
- **Meta-1:** the single biggest groundedness mover; re-floated `/describe`, recall, and A2 naming.
- **Meta-2 ladder:** C1/C2 judged as ceiling markers only; the load-bearing spend stayed on A/B/B1.
- **assert-recall read-back** (chat) works for "every X is a Y" → "what is a Y"; the graded
  `assert-recall` cells (0/5) target a different multi-turn shape and remain a tail lever.

## Decision log — next-cycle lever board (re-ranked)

1. **B1 combo cells (pron+neg, count+temp, disc+count)** — 0/5 each; the residual B1 frontier now that
   the single verbs are green. Compose negation/passive under pronoun + quantifier binding. Highest
   remaining B1 lift; needed to cross the ~1.5 exit bar.
2. **assert-recall multi-turn** — the graded cells (B2/C1 assert 0/5) test declare-then-recall across
   turns; extend the read-back to the graded shape.
3. **quantifier+temporal grain-aware counting** — the count-temp combo (0/5) counts at the wrong grain.
4. **C1 temporal** (31/50) — instrument + grain, once B1 combos land.
5. **Activate a parked grammar rule per cycle** (capitalisation / list punctuation) — each now a
   bench-measured lever behind its golden.
6. **C2 ceiling** — last, tier-1-only until B1 combos clear.

**Exit criterion tracker:** B1 grade mean **1.272 / ~1.5 target**; every B1 single-verb cell now
dual-draw-agreeing (census cells Δ=0). C-grade judged spend stays gated (Meta-2) until B1 ≥ ~1.5.
