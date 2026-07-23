# BENCHMARK_CEFR_ENGLISH_2.11.0 — mean 1.787/2 across 92 cases, 1 hard fail, 0 voids; pure re-measurement, no lever applied

**Result: mean 1.787 / 2 across 92 cases, 1 hard fail, 90/92 tier-1 pass, 0 unscored samples.**

This cycle is a **measurement pass only**, scoped explicitly as such: Steps 3-6 of the tuning loop
(smoke, run, judge, write-up) with Step 1's lever pick and Step 2's apply skipped. `src/` was not
touched. Where the loop's usual write-up wants a predictions-vs-actuals table and a per-lever
analysis, this report says **N/A — no lever applied** instead.

## Timing

- **Date:** 2026-07-23.
- **Benchmarking session:** product replay (deterministic, ~8s) then judge fan-out at concurrency
  12, 184 calls (92 cases × 2 samples), `claude-haiku-4-5-20251001`. Session ran
  **05:11:22Z → 05:23:56Z** (~12.5 minutes wall-clock, almost entirely the judge fan-out).
- **Analysis (reading the scores, writing this report):** **05:25Z → 06:10Z**, same session,
  immediately following.

**A methodology note, in the same spirit as 2.7.12's own flagged caveat.** `chatbench/run.mjs`'s
CLI defaults have moved since this skill's §1 was last written: a bare invocation now defaults to
**dual-draw** (`dual = args.only ? false : (args.dual ?? pool.length > 0)`), not the single-draw
default §1 describes, and the append-only pool has grown to 138 cases while the default stratified
sample (`fraction 0.1`, per-cell floors) now draws **92** cases, not the "109" §1's prose still
names. Both are drift between the skill's prose and the current `chatbench/graded.mjs`/`run.mjs`
code, not a decision made in this pass. To land on a single deterministic product run per the
measurement contract, this cycle ran `--single` explicitly (killing the now-default dual draw) and
left `--sample` at its default fraction (matching this cycle's brief: "no `--sample` override
needed"). The result is the **92-case stratified go-to sample**, not 2.7.12's 138-case full-pool
take (which used `--sample 1 --single` to grab every case). **The two cycles' case counts differ,
so the headline mean is not a clean like-for-like number** — see "Headline numbers" below for the
sharper, matched comparison this cycle can actually support.

## Profile

```bash
node chatbench/run.mjs --stamp 2.11.0 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-2.11.0/product.jsonl \
  --samples 2 --concurrency 12
```

92 cases (the default stratified draw over the current, append-only `chatbench/graded-pool.jsonl`,
138 cases total — no cases added this cycle), 184 judge calls, N=2 single draw (the skill's stated
go-to default). Judge model **`claude-haiku-4-5-20251001`**, prompt **`judge-prompt-v2`**
(unchanged since 2.7.12 — this cycle's number is not confounded by an instrument change the way
2.7.12's was). Raw: `chatbench/results/raw/run-2.11.0/` (`product.jsonl`, `judged.jsonl`,
`summary.json`, `timings.json`).

## Headline numbers

- **Overall mean: 1.787/2**, 92 cases, **1 hard fail**, **0 voided** samples, **90/92 tier-1 pass**.
- **Raw comparison to 2.7.12 (1.809/2, 138 cases, 5 hard fails):** the mean is **down 0.022** and
  the hard-fail count is down from 5 to 1 — but the case counts differ (92 vs 138), so neither
  number is a clean apples-to-apples read. The hard-fail **rate** dropped more clearly: 5/138
  (3.6%) → 1/92 (1.1%).
- **The sharper signal — six cases identifiable in both cycles' reports** (2.7.12's evidence
  section named these by id): `g-b2-count-temp-1`, `g-b2-passive-9`, `g-b2-rel-1`,
  `g-c2-garden-1`, `g-c2-xturn-1`, `g-c2-xturn-2`. Direct per-case comparison:

  | case | grade/construction | 2.7.12 | 2.11.0 | change |
  | --- | --- | --: | --: | --- |
  | `g-b2-rel-1` | B2 relative-embedded | hard fail (g0/h0/r0) | **1.834** | now an honest miss with a working rephrase hint |
  | `g-b2-passive-9` | B2 reversible-passive | hard fail (g0/h0/r0) | **0.667** | still weak but no longer a hard fail |
  | `g-c2-xturn-2` | C2 cross-turn-composition | 0.5 | **0.625** | small gain |
  | `g-c2-xturn-1` | C2 cross-turn-composition | 1.333 (g2/h2/c0, 3 dims) | **1.125** (g2/c1/h1/r0.5, 4 dims) | small dip, but on a case now judged across a 4th dimension it wasn't before |
  | `g-c2-garden-1` | C2 garden-path | hard fail (g0/h0/r0) | **0.333, still a hard fail** (g0/h0/r1) | unchanged core bug; rephrase hint alone improved |
  | `g-b2-count-temp-1` | B2 quantifier-counting+temporal | hard fail (g0/c0) | **0.25** (g0.5/c0) | essentially unchanged; same wrong answer verbatim |

  Four of six moved up, one is flat-to-slightly-down on a case now scored with an extra rubric
  dimension, one is unchanged. This reads as real, if uneven, movement across the 369 commits that
  landed between the two cycles — not something this pass root-causes to a single change, since no
  lever was applied and no bisection was run.

## Per-tag breakdown

| tag | cases | mean | hard fails |
| --- | --: | --: | --: |
| ambiguity | 3 | 2.000 | 0 |
| bootstrap-empty | 3 | 1.778 | 0 |
| conversational | 11 | 1.977 | 0 |
| graph-query | 5 | 1.900 | 0 |
| honesty-miss | 5 | 1.867 | 0 |
| multi-turn-focus | 5 | 1.900 | 0 |
| noise | 5 | 1.934 | 0 |
| typo-fuzzy | 2 | 1.750 | 0 |
| **graded (all)** | **92** | **1.787** | **1** |

`memory-recall` (3 cases in the full pool) drew zero cases into this cycle's 92-case stratified
sample — absent from this table because the sample didn't reach it, not because the tag was
dropped. Every hard fail sits in the untagged `graded` catch-all, same as 2.7.12.

## BEST-EXAMPLES pick

**1. A documented hard fail becomes a clean honest miss with a working hint — `g-b2-rel-1` (B2, relative-embedded)**
```
say: what calls the module that defines register
answer: nothing in the index matches that. Try "who touched <a module that actually has commits>"
or "/describe <module>" to see what's in the index.
```
*What this demonstrates:* 2.7.12 scored this exact case a hard fail (groundedness 0, honesty 0,
rephrase 0). 2.11.0 scores it 1.834 — the relative clause no longer misparses into a false answer,
and the miss carries a genuinely usable rephrase hint. This is the single clearest improvement this
cycle's evidence can point to.

**2. Three-hop focus tracking survives a `/describe`, a pronoun, and a plural pronoun in a row — `mt-focus-drift` (B1, discourse-reference)**
```
say: /describe app/lib/a.mjs
answer: [full entity digest — attestation, attribute, edges, provenance]

say: what calls it
answer: scripts/g.mjs.

say: which modules import it
answer: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```
*What this demonstrates:* `it` resolves correctly across two further turns after a structured
`/describe` reply, each hop grounded against a different edge type (calls, then imports) off the
same focus entity. Scored 2/2 by the judge; this is a case flagged in the pool as a documented
baseline weakness, and it now passes clean.

**3. Filler-wrapped and typo'd queries both reach the same grounded answer as the clean form — `ns-hey-tmct` / `tf-wat-calls` (B1, noise / typo-fuzzy)**
```
say: hey tmct, what calls fnAlpha thanks
answer: in app/lib/b.mjs there is function Widget.render().

say: wat calls fnAlpha
answer: in app/lib/b.mjs there is function Widget.render().
```
*What this demonstrates:* a vocative-plus-filler wrapper and a single-letter typo on the same
underlying query both resolve to the identical, correct, grounded answer — noise and typo-fuzzy
robustness holding on a case each once carried a documented baseline weakness.

**4. Two of three cross-turn composition hops resolve; the third hits an honest wall, not a wrong answer — `g-c2-xturn-1` (C2, cross-turn-composition)**
```
say: what does app/lib/e.mjs import
answer: app/lib/a.mjs and app/lib/f.mjs.

say: and what do those import
answer: app/lib/e.mjs.

say: which of all those is untested
answer: couldn't parse this as a graph question. Try: "which modules import <name>" or "what calls
<name>". Type /help for all query shapes.
```
*What this demonstrates:* the same case 2.7.12 used as its own best example — two real hops of
composition resolve correctly, and the third (filtering an accumulated set by an untested
predicate) still declines rather than guessing. The capability gap is unchanged from 2.7.12; the
honest-miss discipline around it is what's being verified again here.

**5. A genuine undercounting bug persists, and the judge still catches it where the pattern check doesn't — `g-b2-count-temp-1` (B2, hard-scoring but not hard-fail-flagged)**
```
say: how many commits touched the module that defines fnAlpha
answer: 1 commit.
```
*What this demonstrates:* verbatim the same wrong answer 2.7.12 reported (the fixture's module
derives from two commit ids, not one), and the fixed-string tier-1 check still passes it. The judge
score moved from an effective 0 to 0.25 (groundedness partially recovered to 0.5) but correctness
is still 0 — this is the same regex-shaped-pass-but-wrong-answer failure mode the rubric exists to
catch, unresolved across both cycles.

## Judge model + prompt version

`claude-haiku-4-5-20251001`, `judge-prompt-v2`. **Unchanged since 2.7.12** — this cycle's number is
a same-instrument comparison on that axis, even though the case count differs (see "Headline
numbers").

## Decision log

No lever was applied this cycle (a pure measurement pass). Candidate next-cycle levers, ranked
informationally (not applied here):

1. **Root-cause `g-c2-garden-1`'s garden-path parse** — the sole hard fail this cycle, and the same
   one 2.7.12 flagged: "classes inherited from Widget defined in app/lib/c.mjs" still folds the
   whole clause into one bad entity guess ("Widget defined app/lib/c.mjs") instead of parsing the
   embedded modifier. The rephrase hint improved (0→1) but groundedness and honesty are still 0.
   Highest priority — it's the only remaining hard fail.
2. **Investigate `g-b2-count-temp-1`'s undercounting** — unchanged verbatim answer across both
   cycles, still a regex-shaped pass hiding a wrong count. 2.7.12 flagged this as needing the actual
   commit-derivation code checked, not asserted from the judge score alone; that check still hasn't
   happened.
3. **Multi-set (3-way) cross-turn composition** — `g-c2-xturn-1`'s third turn (filter an
   accumulated set by an untested predicate) and `g-c2-xturn-2`'s second/third turns (a plural
   pronoun re-resolution, then a full call-chain composition) still land on the honest-miss wall
   rather than composing. A real, recurring capability gap across the C2 cross-turn-composition
   cell, not something this pass's non-lever cycle moved.
4. **`PLAN_FILLER_AND_COUNTERFACTUALS.md`'s filler-clause-prefix widening** — an open design item
   (2026-07-22, not yet built) whose target constructs overlap this benchmark's `noise` tag family.
   A natural next lever once the design pass in that document lands.
5. **Refresh two tier-1 `answerMatch` patterns whose expected copy has drifted from current product
   wording** — `be-honest-empty` (expects "is empty — no entities to answer from yet"; current copy
   reads "no code graph is loaded in this session") and `conv-hello-there` (expects a "hollow voice"
   phrase the current greeting dropped). Both score well under the judge rubric (1.334 and 2.0), so
   this is case-hygiene, not a product regression — flagged, not fixed, since the case set is
   append-only this cycle.
6. **Attribute what moved `g-b2-rel-1` and `g-b2-passive-9` from hard fail to honest-miss-with-hint**
   — 369 commits landed between 2.7.12 and 2.11.0 (`git log --oneline f0910a4..HEAD`); no single
   commit was isolated as the cause in this pass. A future cycle could bisect the two cases'
   `runTurn` behavior across that range before crediting any specific fix.

**2026-07-24 (hand-revision completion — item 5 above)** — two tier-1 `answerMatch` patterns
updated via case-hygiene append: `be-honest-empty-v2` (supersedes `be-honest-empty` whose
expectation matched outdated empty-graph copy) and `conv-hello-there-v2` (supersedes
`conv-hello-there` which expected a Zork-nod phrase dropped from the current greeting). Both
original cases stay per the append-only rule; the v2 rows are now the live expectations.
`chatbench/graded-pool.jsonl` grew from 138 to 139 cases.

## Evidence / transcripts

**Discriminating first — the six cases both cycles' reports name, verbatim (2.11.0 answers):**

```
g-b2-rel-1 (B2, relative-embedded) — 2.7.12: hard fail → 2.11.0: 1.834
  say: what calls the module that defines register
  answer: nothing in the index matches that. Try "who touched <a module that actually has
  commits>" or "/describe <module>" to see what's in the index.

g-b2-passive-9 (B2, reversible-passive) — 2.7.12: hard fail → 2.11.0: 0.667
  say: what is imported by the module that tests app/lib/b.mjs
  answer: no module matching "imported by the module that tests app/lib/b.mjs" found in the
  index. "imported" and "by" and "the" and "module" and "that" and "tests" name nothing here,
  and reading past them would answer a different question. Did you mean app/lib/b.mjs?

g-c2-garden-1 (C2, garden-path) — 2.7.12: hard fail → 2.11.0: 0.333, STILL a hard fail
  say: classes inherited from Widget defined in app/lib/c.mjs
  answer: no class matching "Widget defined app/lib/c.mjs" found in the index. "widget" names
  nothing here, and reading past it would answer a different question. Did you mean
  app/lib/c.mjs?
  judge: groundedness 0, honesty 0, rephrase 1 — the clause still folds into one bad entity
  guess; only the rephrase hint improved

g-b2-count-temp-1 (B2, quantifier-counting+temporal) — 2.7.12: hard fail → 2.11.0: 0.25, unchanged bug
  say: how many commits touched the module that defines fnAlpha
  answer: 1 commit.
  judge: groundedness 0.5, correctness 0 — the graph's own context still records the module
  deriving from two commit ids; the answer is verbatim identical to 2.7.12's

g-c2-xturn-2 (C2, cross-turn-composition) — 2.7.12: 0.5 → 2.11.0: 0.625
  say: who calls fnAlpha
  answer: in app/lib/b.mjs there is function Widget.render().
  say: who calls them
  answer: nothing in the index matches that. Try "who touched <a module that actually has
  commits>" or "/describe <module>" to see what's in the index.
  say: so what is the full call chain into fnAlpha
  answer: no module matching "chain into fnAlpha" found in the index. "chain" names nothing
  here, and reading past it would answer a different question. Did you mean fnAlpha?

g-c2-xturn-1 (C2, cross-turn-composition) — 2.7.12: 1.333 (3 dims) → 2.11.0: 1.125 (4 dims)
  say: what does app/lib/e.mjs import
  answer: app/lib/a.mjs and app/lib/f.mjs.
  say: and what do those import
  answer: app/lib/e.mjs.
  say: which of all those is untested
  answer: couldn't parse this as a graph question. Try: "which modules import <name>" or "what
  calls <name>". Type /help for all query shapes.
```

**The one hard fail this cycle, in full — `g-c2-garden-1`** (shown above): the sole case where
`groundedness === 0` this cycle, same root cause 2.7.12 named.

**The two tier-1 (pattern-match) misses, neither a judge failure — copy drift, not a regression:**

```
be-honest-empty (bootstrap-empty): tier-1 expects "is empty — no entities to answer from yet";
  current answer reads "I can't answer that as a code question — no code graph is loaded in this
  session. Try 'what is a dog' for general vocabulary." Judge mean: 1.334.

conv-hello-there (conversational): tier-1 expects a "hollow voice" phrase; current greeting reads
  "Hello there. Ask me about this codebase, or /help." Judge mean: 2.000 (perfect).
```

**Best examples** (shown above in full) are the discriminating positive cases: the relative-embedded
recovery, the three-hop focus chain, the noise/typo-fuzzy pair, and the cross-turn partial success.
