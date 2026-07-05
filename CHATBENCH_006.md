# CHATBENCH_006 — multi-turn discourse + ACE lexicon nouns

**Headline: mean 1.451 / 2 (up from 1.373) · 34 hard fails (down from 40) · 0 voided · 333 cases × 3.**
Judge pinned `claude-haiku-4-5-20251001` / `judge-prompt-v1` / `fixture-context-v2`. Dual-draw.
No tier-1 regressions vs cycle-005 (333/333 tier-1 pass).

## Verdict: PASS

Mean up (1.373 → 1.451) and no product pass→fail regression. Zero promoted-case judged drops.
0 voided samples (judge integrity clean).

## Per-CEFR ladder (0–2 mean rubric)

| band | c5 | c6 | Δ | read |
|---|---|---|---|---|
| v1 spine | 1.688 | 1.674 | −0.01 | noise |
| A1 | 1.733 | 1.852 | +0.12 | recall/count wording gains |
| A2 | 1.970 | 1.933 | −0.04 | noise |
| **B1** | 1.349 | **1.438** | **+0.088** | disc+count cleared, discourse closed to 23/25 |
| **B2** | 1.360 | **1.498** | **+0.138** | discourse + assert spillover |
| **C1** | 0.923 | **1.085** | **+0.162** | assert-recall closed by the lexicon nouns |
| C2 | 1.028 | 0.883 | −0.14 | sample variance (tier-1-only, gated) |

The arc so far: combined **1.258 → 1.303 → 1.373 → 1.451**; B1 **0.766 → 1.272 → 1.349 → 1.438**.

## Timings

Product replay wall-time **6.4 s** (618 rows). Mean ms/row: v1 spine 115.0 (multi-turn/memory
cases); A1 0.3 · A2 0.0 · B1 0.3 · B2 3.2 · C1 1.7 · C2 0.8. Full data:
`chatbench/results/raw/run-cycle-006/timings.json`.

## Per-lever analysis (product-side, tier-1 greens)

- **Multi-turn discourse seam (chat.mjs):** B1 disc+count **0/25 → 25/25** and B1 discourse
  **11/25 → 23/25**. `runAsk` now threads the prior answer's ids into `ask()`, so a referent
  ("count them", "which of those are tested", "what about c.mjs") resolves against the previous
  turn's set. Spillover: B2 discourse +16, B2 assert +5.
- **ACE lexicon nouns:** admitting the common isa-object nouns `parseAce` rejected (category, kind,
  artifact, routine, part, helper, operation, change) took **C1 assert-recall 2/25 → 25/25**. The
  recall surfaces from cycle 005 worked the moment the assert parsed, so this was the whole gap.
- **Grammar A/B (capitalise + list): dropped, not run.** `capitalise` rewrites sentence-initial
  characters, which regresses ~10 frozen v1 cases whose case-sensitive `answerMatch` pins lowercase
  openers ("can't count", "no symbol matching", "assuming you meant"); `list` has no 3-item target
  in the judged set. The case set is append-only mid-arc, so a post-arc case-set refresh can revisit
  it. Recorded in `grammar-rules.toml` and `STRATEGY_ADVISOR.log`.

## Predictions vs actuals

| lever | predicted | actual |
|---|---|---|
| B1 disc+count | close the 0/5 combo | 0/25 → 25/25 |
| B1 discourse | lift the 2/5 laggard | 11/25 → 23/25 |
| C1 assert-recall | move off 2/5 | 2/25 → 25/25 (lexicon nouns) |
| grammar A/B | judged A/B | dropped (would regress the sacred spine) |

## Decision log — next-cycle board

**Meta-2 gate: B1 = 1.438, still under ~1.5 — C-grade judged spend stays gated; lever 6 (C2)
deferred.** B1 has climbed every cycle and is one lever from the bar.

1. **B1 discourse residual (2/25)** — the last B1 drag: empty-class `/members` reports `miss:false`
   where the case wants `miss:true` (a `server.mjs` tool-output semantics fix, not discourse).
   Clearing it likely crosses B1 ≥ 1.5 and ungates C-grades.
2. **B2 combo cells** (count+temp, remaining) — the next band up once B1 clears.
3. **C1 temporal date-scrubbing** ("changed on <date>", "since <sha>") — a `temporal.mjs` surface
   the ask engine deliberately does not own; a scoped addition.
4. **Post-arc: the grammar voice A/B + C2 ceiling** — after a case-set refresh re-pins the openers,
   and once B1 clears the exit bar.

**Exit-criterion tracker:** B1 grade mean **1.438 / ~1.5** — the single residual `/members`
`miss:true` cell is the likely crossing point.
