# BENCHMARK_CEFR_ENGLISH_2.7.12 — mean 1.809/2 across 138 cases, 5 hard fails, 0 voids; the judge prompt moved v1→v2 since 2.6.0, so this is a measurement, not a clean lever comparison

**Result: mean 1.809 / 2 across 138 cases, 5 hard fails, 136/138 tier-1, 0 unscored cases.**

## Timing

- **Date:** 2026-07-19.
- **Benchmarking session:** product replay (deterministic, seconds) then judge fan-out at
  concurrency 12, 138 calls, `claude-haiku-4-5-20251001` — a few minutes wall-clock.
- **Analysis (reading the scores, writing this report):** immediately following, same session.

**This is a measurement pass only — no lever was applied.** Per this skill's own §2 provenance
discipline: the judge prompt pin moved **`judge-prompt-v1` (2.6.0) → `judge-prompt-v2`** (current
`chatbench/judge.mjs`) between the last cycle and this one. This means the raw mean move (2.6.0's
1.790 across 128 cases → this cycle's 1.809 across 138) reflects **both** any real product change
**and** a different judge instrument — it is not a clean like-for-like signal the way N=1-vs-N=1
same-prompt comparisons are supposed to be. Flagging this plainly rather than reporting a
number-went-up headline as if it were pure product movement.

## Profile

```bash
node chatbench/run.mjs --stamp 2.7.12 --sample 1 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-2.7.12/product.jsonl \
  --samples 1 --concurrency 12 --out chatbench/results/raw/run-2.7.12
```

138 cases (the current, append-only `chatbench/graded-pool.jsonl` — grown from 2.6.0's 128; the
10 new cases were not individually diffed against 2.6.0's exact id list in this pass), 138 judge
calls, single draw, N=1 (matching 2.6.0's own deliberate choice to stay off the skill's stated N=2
default). Judge model **`claude-haiku-4-5-20251001`**, prompt **`judge-prompt-v2`**. Raw:
`chatbench/results/raw/run-2.7.12/` (`product.jsonl`, `judged.jsonl`, `summary.json`,
`timings.json`).

## Headline numbers

- **Overall mean: 1.809/2**, 138 cases, **5 hard fails**, **0 voided** samples, **136/138 tier-1
  pass**.
- **A precise like-for-like recomputation over 2.6.0's exact 128-case subset was not done in this
  pass** — the prompt-version change (above) means even a like-for-like number would mix a real
  product signal with an instrument change, so it was not prioritized under this pass's time
  budget. Flagged as a gap, not silently skipped.

## Per-tag breakdown

| tag | cases | mean | hard fails |
| --- | --: | --: | --: |
| ambiguity | 5 | 1.900 | 0 |
| bootstrap-empty | 3 | 1.889 | 0 |
| conversational | 12 | 2.000 | 0 |
| graph-query | 19 | 1.886 | 0 |
| honesty-miss | 8 | 1.958 | 0 |
| memory-recall | 3 | 1.833 | 0 |
| multi-turn-focus | 5 | 1.900 | 0 |
| noise | 5 | 1.800 | 0 |
| typo-fuzzy | 4 | 1.792 | 0 |
| **graded (all)** | **138** | **1.809** | **5** |

Every hard fail sits outside these named tags (the `graded` catch-all) — none of the sampled
named-tag subsets carries a hard fail this cycle.

## BEST-EXAMPLES pick

**1. Cross-turn composition, 2 of 3 turns fully correct — `g-c2-xturn-1` (C2)**
```
say: what does app/lib/e.mjs import
answer: app/lib/a.mjs and app/lib/f.mjs.

say: and what do those import
answer: app/lib/e.mjs.

say: which of all those is untested
answer: couldn't parse this as a graph question. Try: "which modules import <name>" or
"what calls <name>". Type /help for all query shapes.
```
*What this demonstrates:* two real hops of cross-turn composition (import, then import-of-import)
resolve correctly and honestly track the accumulated set through `focusLabel`; the third hop (a
three-way composition — imports, then imports-of-those, then filter by untested) hits an honest
parse wall rather than a wrong answer. The judge scored groundedness 2, honesty 2, correctness 0 —
the wall is honest but the capability gap (multi-set composition across three turns) is real.

**2. A bare class name resolves and offers grounded next steps — `am-bare-name` (ambiguity)**
```
say: Widget
answer: Widget is a class in this codebase, located in app/lib/b.mjs — try "describe Widget" or
"which classes inherit from Widget".
```
*What this demonstrates:* a one-word ambiguous-looking input resolves to the real graph entity and
offers concrete, actually-supported follow-ups (both suggested queries work) — scored 2/2/2 by the
judge.

**3. A genuine undercounting bug caught by the judge, not the pattern check — `g-b2-count-temp-1`
(B2, hard fail)**
```
say: how many commits touched the module that defines fnAlpha
answer: 1 commit.
```
*What this demonstrates:* the surface answer matches the case's own regex expectation
(`^1 commit\.$`) but the judge scored it groundedness 0 / correctness 0 — the graph's own context
records the module deriving from TWO commit ids (`git:abc1234` and `git:def5678`), and the judge
read the true count as 2, not 1. This is exactly the failure mode this benchmark's rubric exists to
catch: a regex-shaped pass that is still a wrong answer. Not root-caused in this pass (whether the
undercounting is in the compositional count query, or whether `def5678`'s lack of its own Commit
entity is genuinely why the true count is 1, needs the actual code checked, not asserted here).

## Judge model + prompt version

`claude-haiku-4-5-20251001`, `judge-prompt-v2`. **Changed since 2.6.0** (which measured under
`judge-prompt-v1`) — see the headline note above.

## Decision log

No lever was applied this cycle (a pure measurement pass). Candidate next-cycle levers, ranked
informationally (not applied here):

1. **Investigate `g-b2-count-temp-1`'s undercounting** (above) — highest priority, since it's a
   hard fail the pattern-match layer would have silently called a pass.
2. **Multi-set (3-way) cross-turn composition** (`g-c2-xturn-1`'s third turn, `g-b2-rel-1`'s
   relative-embedded miss, `g-b2-passive-9`'s reversible-passive miss) — a real, recurring
   capability ceiling across several B2/C2 constructions.
3. **`g-c2-garden-1`'s garden-path parse** — "classes inherited from Widget defined in
   app/lib/c.mjs" folds the whole clause into one unresolvable entity name instead of parsing the
   embedded modifier; matches a class of finding this session's CONVERSATION sweep also surfaced
   (modifier-swallowing).
4. **Attribute the judge-prompt v1→v2 change** — find and read what changed in
   `chatbench/judge-prompt-v2.txt` versus its v1 predecessor, so future comparisons across this
   boundary can say precisely what moved for instrument reasons versus product reasons.

## Evidence / transcripts

**Discriminating first — the 5 hard fails, verbatim:**

```
g-b2-count-temp-1 (B2, quantifier-counting+temporal):
  say: how many commits touched the module that defines fnAlpha
  answer: 1 commit.
  judge: groundedness 0, correctness 0 — graph records 2 derived-from commit ids

g-b2-passive-9 (B2, reversible-passive):
  say: what is imported by the module that tests app/lib/b.mjs
  expected: an honest miss (a relative clause + passive voice compound)
  judge: groundedness 0, honesty 0, rephrase 0

g-b2-rel-1 (B2, relative-embedded):
  say: what calls the module that defines register
  expected: an honest miss
  judge: groundedness 0, honesty 0, rephrase 0

g-c2-garden-1 (C2, garden-path):
  say: classes inherited from Widget defined in app/lib/c.mjs
  answer: no class matching "Widget defined app/lib/c.mjs" found in the index. "widget" names
  nothing here, and reading past it would answer a different question. Did you mean
  app/lib/c.mjs?
  judge: groundedness 0, honesty 0, rephrase 0 — the whole clause folded into one bad entity guess

g-c2-xturn-2 (C2, cross-turn-composition):
  say: who calls fnAlpha
  answer: [correct — Widget.render]
  say: who calls them
  answer: nothing in the index matches that. Try "who touched <a module that actually has
  commits>" or "/describe <module>" to see what's in the index.
  say: so what is the full call chain into fnAlpha
  answer: no module matching "chain into fnAlpha" found in the index. "chain" names nothing
  here, and reading past it would answer a different question. Did you mean fnAlpha?
  judge: mean 0.5 (partial credit for turn 1's correctness)
```

**Best examples** (already shown above in full) are the discriminating positive cases — the
cross-turn-composition partial success and the bare-name resolution.
