# CHATBENCH_0.7.1 — the concept-force / seed-all release, measured

**Headline:** mean **1.488 / 2** · tier-1 spine **331 / 333** · hard-fails **35** · voids **128** (of 999
samples) · judge **claude-haiku-4-5-20251001** @ **judge-prompt-v1**, 3 samples/case · 333 cases.
Product replay wall-time **6.9 s** (deterministic, free); per-CEFR product timings below.

> ## ⚠ This is a RE-BASELINE, not a mean-delta cycle
> 0.7.x changed the product substantially — **seed-all** (the whole ConceptNet band, not a 500 cap),
> the **concept force** for nouns *and* relations, **de-anthropomorphized** rendering, and the
> **relation-force trigger-scoping** fix — and the graded pool's concept-kind naming cases were
> updated to accept the concept-force answer. So **do not read 1.488 against CHATBENCH_006's mean**:
> the substrate moved. This cycle re-establishes the groundedness/quality baseline for the 0.7 line.
> The deterministic **tier-1 regression check already ran clean** (no pass→fail vs run-cycle-006 on
> the id intersection) before the judge pass — that is the load-bearing safety result, and it held.

## Per-tag means (sorted)

| Tag | Cases | Mean | Read |
| --- | ----: | ---: | --- |
| noise | 5 | **1.956** | noise-stripping is the strongest lane — junk in, clean answer out. |
| typo-fuzzy | 4 | **1.945** | misspellings resolve; the tolerant front-end earns its keep. |
| conversational | 6 | 1.833 | greetings / thanks / "why" — the small-talk + honest-empty lane is solid. |
| memory-recall | 3 | 1.833 | assert-then-recall round-trips well. |
| graph-query | 15 | 1.704 | the core code-navigation lane; counts, impact, definitions land. |
| bootstrap-empty | 2 | 1.667 | the graph-less orientation reads honestly. |
| ambiguity | 4 | 1.521 | "if you mean X" surround holds (incl. the restored `am-meta-imports`). |
| honesty-miss | 5 | 1.467 | honest empties, but the judge is strict on them. |
| graded | 285 | 1.444 | the CEFR ladder — dragged by the C-tier ceilings (below). |
| multi-turn-focus | 5 | 1.433 | anaphora across turns is the standing weak spot (pronoun binding). |

## Best examples (verbatim, mean 2.00)

- **`gq-count-classes`** — *"how many classes are there"* → **"3 classes."** Aggregate hook, exact.
- **`gq-impact-a`** — *"/impact app/lib/a.mjs"* → a full reverse-closure impact map (6 dependents
  across 2 depth levels, each with its covering tests or "tests: none recorded"). The kind of grounded,
  receipted answer that is the whole point.
- **`am-tests-cover`** — *"which tests cover b.mjs"* → **"'cover b.mjs' matches more than one module
  ambiguously — please narrow the term."** Honest ambiguity instead of a wrong pick.
- **`conv-why-empty`** — *"why"* (with no prior turn) → **"No previous answer to expand yet — ask me a
  question first, then say 'why' or 'say more'."** A guiding non-answer, not a wall.

## The 35 hard-fails + the 2 tier-1 misses

**Hard-fail clusters** (grade × construction) — they sit exactly where the ladder predicts, in the
C-tier ceilings and the pronoun/temporal frontier:

| Cluster | Count |
| --- | ---: |
| C1 temporal | 10 |
| B1 pronoun-binding | 7 |
| B2 count+temporal | 4 |
| B1 temporal | 3 |
| C1 negation | 3 |
| C1 coordination | 2 |
| B1 negation / B2 coord / B2 disc / C1 rel / other | 1 each (6) |

- **C1 temporal (10)** is the dominant ceiling: compositional temporal + relative queries like
  *"who touched the module that imports app/lib/f.mjs"* → **"nothing in the index matches that."** The
  fixture has thin history, and the two-hop temporal-over-relative composition isn't assembled.
- **B1 pronoun (7)** is a real, fixable bug, not just a ceiling: in `g-b1-pron-25`, after
  `/describe app/lib/e.mjs`, *"which modules import it"* answered *"…where object = **Commit**"* — the
  anaphor **"it" bound to the wrong antecedent** instead of the module in focus. This is the
  multi-turn-focus weak spot showing up as a wrong (if honestly-empty) answer.

**The 2 tier-1 misses** — `g-b1-disc-count-22` and `g-b1-disc-count-3`, both the **discourse-count
anaphora** gap. In `-22`: *"untested classes"* correctly lists 5 modules, then *"count them"* → the
grammar wall (*"I answer questions about THIS codebase's structure…"*) instead of **counting the prior
answer's set**. "count them / how many of those" over a just-produced listing is the standing B1 lever
— and exactly the kind of dead-end `SKILL_CHAT_PLAYTEST` is built to hunt.

## Voids

**128 / 999 samples (~12.8%)** were voided — a judge refusal, timeout, or format failure. Per the
integrity rule (§1), a void is retried once and, if still bad, **excluded from every mean — never
counted as a fail**. The rate is in the normal band for this judge/prompt; no single tag dominates.

## Per-CEFR product timings (deterministic replay, informational)

| Level | n | mean ms |
| --- | ---: | ---: |
| v1-spine | 48 | 126.0 |
| A1 | 30 | 0.5 |
| A2 | 60 | 0.03 |
| B1 | 250 | 0.25 |
| B2 | 70 | 2.26 |
| C1 | 140 | 1.83 |
| C2 | 20 | 0.85 |

Sub-millisecond per graded turn; the spine's 126 ms mean is the richer v1 operations (impact
closures, folded recall). Total product wall-time **6.9 s** for 618 rows — the whole run is free and
seconds-fast; the cost is only the (offline-optional) judge.

## Decision

**Re-baseline accepted.** The **tier-1 spine holds 331/333** with the two misses isolated to one
construction (discourse-count anaphora), the deterministic regression gate ran clean, and the strong
lanes (noise, typo, conversational, graph-query) are ≥1.7. The **C-tier ceilings** (C1 temporal, the
pronoun/temporal frontier) remain the standing work — unchanged in character from 006, now the clear
next levers. Recommended next: (1) **discourse-count anaphora** ("count them / how many of those" over
a prior listing — clears both tier-1 misses); (2) **pronoun antecedent binding** (the "it → Commit"
mis-bind); then (3) the **C1 temporal-over-relative composition** ceiling.

Artifacts: `chatbench/results/raw/run-0.7.1/` (product-a/b, judged, summary, agreement, timings);
transcripts appendix in `CHATBENCH_0.7.1_TRANSCRIPTS.md`.
