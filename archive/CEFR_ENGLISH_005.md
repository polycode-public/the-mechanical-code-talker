# CHATBENCH_005 — B1 combos, grain-aware count, multi-turn assert, safe grammar rules

**Headline: mean 1.373 / 2 (↑ from 1.303) · 40 hard fails (↓ from 51) · 0 voided · 333 cases × 3.**
Judge pinned `claude-haiku-4-5-20251001` / `judge-prompt-v1` / `fixture-context-v2`. Dual-draw.
**No tier-1 regressions** vs cycle-004 (333/333 tier-1 pass).

## Verdict: PASS

Mean up (1.303 → 1.373) AND no product pass→fail regression. The one promoted-case judged dip
(`am-bare-name`) has **byte-identical product output** c4→c5 — LLM-judge noise on an unchanged
answer, not a regression. 0 voided samples (judge integrity clean).

## Per-CEFR ladder (0–2 mean rubric)

| band | c4 | c5 | Δ | read |
|---|---|---|---|---|
| v1 spine | 1.684 | 1.688 | +0.00 | frozen line, stable |
| A1 | 1.737 | 1.733 | −0.00 | noise |
| A2 | 1.948 | 1.970 | +0.02 | shelf |
| **B1** | 1.272 | **1.349** | **+0.077** | combos + grain move it up, still short of ~1.5 |
| **B2** | 1.144 | **1.360** | **+0.216** | composition spillover (coord, neg+rel) + assert-recall |
| C1 | 0.922 | 0.923 | +0.00 | tier-1-only ceiling (Meta-2) |
| **C2** | 0.503 | **1.028** | **+0.525** | lever-3 grain reached C2 relative-embedded (0→3/5) |

Overall dimension means (c5): the 5-case Meta-1 groundedness subgroup holds at **2.000** (already
maxed by the cycle-4 re-baseline). Timings below.

## Timings (per operator request)

Product replay wall-time **9.4 s** (deterministic replay of 618 rows). Mean ms/row per CEFR band:

| scope | mean ms/row |
|---|---|
| v1 spine | 172.4 (multi-turn + memory/session cases dominate) |
| A1 | 0.4 · A2 0.1 · B1 0.6 · B2 3.1 · C1 2.5 · C2 1.1 |

(Wall-clock, informational — excluded from determinism/row-equality checks. Full breakdown in
`chatbench/results/raw/run-cycle-005/timings.json`.)

## Per-lever analysis (product-side deltas confirmed pre-judge, advisor tick 8)

- **Lever 1 — B1 combo composition:** B1 pron+neg **0/5 → 5/5** (the headline: forward-negation now
  composes with the "it" anaphora). Spillover: B2 coord 4→5, C1 coord 3→4, C1 neg+rel 3→4. **Did
  not reach B1 disc+count (0/5)** — a 006 candidate.
- **Lever 2 — assert-recall multi-turn:** B2 assert-recall **0/5 → 2/5**. **C1 assert-recall unmoved
  (0/5)** — a 006 candidate.
- **Lever 3 — grain-aware counting:** symbol-grain touches; spillover lifted C2 relative-embedded
  0→3/5 and temporal +1.
- **Lever 5 — safe grammar rules (terminal-punctuation + subject-verb-agreement):** confirmed
  **byte-safe no-ops** on the corpus (0 doubled-stops, 0 bad-agreement across 451 answers) — they
  fix defects the product doesn't currently emit, so they cost nothing and stand ready. Capitalise +
  list stay parked.
- **Voice nit — REVERTED:** it regressed 3 frozen v1 cases (`cases.jsonl` pins "whose module directly
  calls X"); the case set is sacred mid-arc, so the phrasing stays.

## Predictions vs actuals

| lever | predicted | actual |
|---|---|---|
| B1 combos | clear the residual B1 cliff toward ~1.5 | B1 +0.077 → 1.349 (partial; disc+count unmoved) |
| assert-recall multi-turn | B2/C1 assert 0/5 → pass | B2 0→2/5; C1 unmoved |
| safe grammar rules | byte-stable, no mean change | confirmed no-op |

## Decision log — cycle-006 lever board (re-ranked)

**Meta-2 gate: B1 = 1.349, NOT yet ≥ ~1.5 — so C-grade judged spend stays gated; lever 6 (C2)
is deferred** even though C2 rose to 1.028 (a free tier-1 gain, not a judged focus).

1. **B1 disc+count combo (0/5)** — the residual B1 laggard lever 1 didn't reach; discourse-reference
   composed with quantifier-counting. Highest remaining B1 lift toward the ~1.5 exit bar.
2. **B1 discourse-reference (2/5)** — the other B1 drag; multi-turn referent resolution.
3. **C1 assert-recall (0/5)** — lever 2 moved B2 assert but not C1; the C1 phrasings are harder.
4. **Capitalise + list grammar rules — the judged A/B** (deferred from 005 per the advisor):
   activate, measure the voice-vs-mean tradeoff on the v1 spine, keep only if the mean holds.
5. **C2 / lever 6 — still gated** until B1 clears ~1.5.

**Exit-criterion tracker:** B1 grade mean **1.349 / ~1.5**; B1 single-verb + pron+neg cells green,
the two combo/discourse cells (disc+count 0/5, discourse 2/5) are the remaining drag.
