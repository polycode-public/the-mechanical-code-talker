# CHATBENCH_002 — chat tuning cycle 2

## Headline

- **Mean rubric score: 1.585 / 2** over 48 cases (**hard fails: 2**, voided judge samples: 0).
- Tier-1 (deterministic): 48/48 pass; 0 failing; 9 cases carry documented baselineFail turns; **5 baseline weakness(es) IMPROVED this cycle: tf-modles, tf-wat-calls, ns-wondering, ns-hey-tmct, mr-session-count**.
- Judge pin: **claude-haiku-4-5-20251001**, prompt **judge-prompt-v1**, 3 sample(s)/case. Run stamp: `cycle-002`.
- Decision rule (SKILL §1): PASS = mean up vs previous cycle AND no pass→fail regression. **VERDICT: PASS.**
  - **Mean up:** 1.485 → 1.585 (+0.100). ✅
  - **No pass→fail regression, verified both ways:** (a) **tier-1**: 48/48 in both cycles, 0
    flips; (b) **judge-level**: the hard-fail set shrank strictly, {6 cases} → {2 cases}, and
    both cycle-2 hard fails (gq-functions-call-fnalpha, mt-focus-drift) were already hard fails
    in cycle 1 — **no case entered the fail set**. Every previously-passing case was checked
    individually against the per-case tables of both runs' `summary.json`; the largest drops on
    previously-passing cases (gq-when-changed-a 2.0→1.0, mt-ask-then-touched 2.0→1.5,
    mr-graph-intact 1.833→1.5) stay well clear of hard-fail territory and are diagnosed below as
    measurement-ruler changes, not product regressions. ✅
  - The 4 regression-watch cases named in CHATBENCH_001 all held: **tf-whcih-imprt 2.0 (=)**,
    **ns-um-hey / ns-could-you / ns-so-uh-count 2.0 (=)** (L1/L3 touched their code path without
    disturbing them), **mr-graph-intact** survived H1a with session-2 answers byte-identical (its
    −0.333 is judge-context re-scoring, see below), **be-honest-empty 1.667 (=)**.

**What 1.585 means.** The cycle-1 pick did what it was picked to do: all five targeted flips
landed (two at a perfect 2.0), hard fails fell 6 → 2 exactly as predicted, and the engine again
produced **zero hallucinated entities in graph-derived answers** — every remaining sub-2 score
is an omission or a badly-handled miss. (Amended after adversarial review: two cases,
conv-what-can-you-do and am-bare-name, emit STATIC HELP-TEXT examples naming walk.mjs /
buildContextBundle, which are not in the fixture — judges scored that as fabrication in both
cycles. The engine never invents graph facts; the hardcoded help examples are a real honesty
leak already on the lever board.) The mean landed 0.015 below the
predicted band (1.60–1.66) for a reason worth being precise about: the H1b judge-context
correction is double-edged — it stopped the judge punishing truthful `/describe` output (+1.333
on mt-describe-then-callers) but the same added truth (def5678 provenance) now makes the judge
ding four unchanged who/when-touched answers as incomplete (−2.0 case-points). Cycle 2 is scored
on a stricter, *more truthful* ruler than cycle 1; on a constant ruler the levers delivered
≈ +0.13 of mean.

## Lever applied this cycle

The CHATBENCH_001 pick, applied as one bounded pass (product levers L1+L3, harness corrections
H1a+H1b landing alongside — the harness items are measurement fixes, not levers):

- **L1 — noise-strip robustness** (`src/interpret/strategies/noise-strip.mjs` + the trigger-typo
  restore): strip aux-verb residue ("was") and the product's own name ("tmct"); restore
  "wat"→"what". Target cases: ns-wondering, ns-hey-tmct, tf-wat-calls.
- **L3 — tf-modles schema-trap guard** (`src/ask.mjs` resolution tiers): never pivot to a
  schema-class individual on a fuzzy-only match when a kind-noun reading of the typo exists;
  emit a repair receipt (`read as "which modules import a.mjs"`). Target case: tf-modles.
- **H1a — harness `clearCache()` between session-mode sessions** (`chatbench/run.mjs`): makes the
  bench match the real one-process-per-session world. Target case: mr-session-count.
- **H1b — truthful FIXTURE_CONTEXT** (`chatbench/run.mjs`): the judge context now states the
  def5678 provenance, cochange edge weights, the `register` global, and the handler re-export —
  the committed fixture as it is. Target case: mt-describe-then-callers. **Note: this changed
  the judge input for all 46 fixture-graph cases** (verified by diffing the `judge` block of the
  two `product.jsonl` files); affected deltas are measurement-correction, not lever effect, and
  are separated out below.

Answer-level ground truth for attribution: **diffing
`chatbench/results/raw/run-cycle-001/product.jsonl` against `run-cycle-002/product.jsonl` shows
exactly 5 changed turns across exactly 5 cases** (tf-modles, tf-wat-calls, ns-wondering,
ns-hey-tmct turn 0; mr-session-count turn 1). Every other answer in the run is byte-identical.
**By construction, any judged movement on the other 43 cases is judge-side** — either the H1b
context change or sampling noise — and is classified case-by-case below.

## Predictions vs actuals

Every on-record CHATBENCH_001 prediction, scored:

| prediction (CHATBENCH_001 decision log) | predicted | actual | verdict |
| --- | --- | --- | --- |
| mean | 1.60–1.66 (point 1.63) | **1.585** | **MISS, short by 0.015 below the band floor** — diagnosis below; the five flips themselves over-delivered |
| hard fails | 6 → 2 (gq-functions-call-fnalpha, mt-focus-drift remain by choice) | **2, exactly those two** | **HIT, exact** |
| tier-1 | 48/48; 5 of 9 baselineFail flagged improved | 48/48; exactly those 5 improved | **HIT, exact** |
| tf-modles | ~1.8 | **2.00** (+1.5) | **OVER** — repair receipt + full answer; 3/3 unanimous perfect |
| tf-wat-calls | ~1.2 (+0.37) | **1.667** (+0.834) | **OVER** — "wat" restore cashes the full honest-empty score |
| ns-wondering | ~1.2 | **0.75** (+0.75) | **UNDER** — parse repaired, but the honest module-grain empty is now graded against the recorded symbol-level caller (the L4 grain cap); 1 of 3 samples zeroed it wrong-confident |
| ns-hey-tmct | ~1.2 | **0.917** (+0.917) | **UNDER** — same L4 grain cap; all 3 samples cite the omitted Widget.render |
| mr-session-count | ~1.9 | **2.00** (+2.0) | **HIT/OVER** — "1 session.", 3/3 perfect |
| mt-describe-then-callers (H1b) | ~1.7 | **2.00** (+1.333) | **OVER — H1b diagnosis confirmed**: answer byte-identical to cycle 1; the corrected context alone took it 0.667→2.0, 3/3 unanimous |
| tag: noise | 1.200→~1.68 | **1.533** | UNDER (grain cap on ns-wondering/ns-hey-tmct) |
| tag: typo-fuzzy | 1.111→~1.53 | **1.695** | OVER |
| tag: memory-recall | 0.861→~1.49 | **1.389** | UNDER (mr-graph-intact −0.333 on the def5678 ruler; mr-asked-before −0.083 noise) |
| tag: multi-turn-focus | 1.233→~1.44 | **1.367** | UNDER (mt-ask-then-touched −0.5 on the def5678 ruler) |
| regression watch (4 cases) | all hold | all held (details in Headline) | **HIT** |

### Why the mean fell short of 1.60–1.66 — the decomposition

Total movement: +4.805 case-points = +0.1001 mean. Decomposed against the 5-changed-turns proof:

1. **The 5 product flips: +6.001 case-points** (mr-session-count +2.0, tf-modles +1.5,
   ns-hey-tmct +0.917, tf-wat-calls +0.834, ns-wondering +0.75) — vs ~+6.0 predicted for these
   five. On target in aggregate (tf-modles/tf-wat over-delivered, ns-* under-delivered on the
   grain cap).
2. **Judge-side gains on unchanged answers: +1.888** (mt-describe-then-callers +1.333 — the H1b
   target, pure measurement correction; hm-empty-result-calls +0.333 and hm-unknown-fn +0.222 —
   small unpredicted upticks, sample-level).
3. **The unpredicted downside: −3.084 case-points on unchanged answers**, in two distinct parts:
   - **−2.0 systematic — the def5678-completeness side effect of H1b (NOT sampling noise).**
     Four cases, every relevant sample carrying the *same new rationale*: now that the context
     truthfully says "app/lib/a.mjs derives from git:abc1234 AND git:def5678", answers that name
     only abc1234 are graded incomplete. **gq-when-changed-a 2.0→1.0 (3/3 unanimous:
     "'last touched' is unsupported … def5678 also modified a.mjs")**, **mt-ask-then-touched
     2.0→1.5 (3/3 unanimous correctness 2→1)**, **mr-graph-intact 1.833→1.5 (2 samples flipped
     to the def5678 rationale; the third was already at 1 in cycle 1 for "who = person")**,
     **gq-who-touched-a 1.667→1.5 (cycle 1: 2/3 dinged "who asks for a person"; cycle 2: 3/3
     ding the def5678 omission)**. These answers are byte-identical across cycles — this is the
     ruler changing, not the product. But note it exposes a *real* product completeness gap
     (provenance commits invisible in who/when answers) — promoted to a cycle-3 lever below.
   - **−1.084 sampling noise.** Seven cases with single-sample, single-dimension flips on
     complaints that already appeared in cycle-1 samples: gq-impact-a −0.167 (the depth-2
     "(imports it)" rendering complaint hit 1/3 samples in cycle 1, 2/3 in cycle 2),
     gq-inherit-from-base −0.167 (one sample wants transitive Button included),
     gq-members-widget −0.167 and mt-focus-members −0.167 (the @property / name-line-number
     complaints, present both cycles), conv-what-can-you-do −0.167 (cycle 1's known
     highest-spread case; spread 2.0 again this cycle), am-bare-name −0.166, mr-asked-before
     −0.083. Jointly −0.023 of mean — **inside the noise floor CHATBENCH_001 measured**
     (per-case sample spread 0.194; the two worst cases alone worth ~±0.03). None is unanimous;
     none introduces a new failure mode.

**Bottom line:** predicted +0.146; delivered +0.164 of lever-and-correction gains, minus 0.042
of systematic ruler-tightening (def5678), minus 0.023 of sampling noise = +0.100. Re-based on a
constant ruler (re-scoring cycle 1 with the corrected context would have cost it the same ~2.0
def5678 points and returned the ~1.333 describe points: cycle-1 ≈ 1.471), the like-for-like
lever gain is ≈ +0.114 and the prediction's real error was (a) not modelling that H1b applies
the new truth to *every* case mentioning commits, and (b) the ns-* ceiling sitting at the L4
grain cap (~0.8–0.9) rather than ~1.2.

## Per-tag breakdown

| tag | cases | cycle-1 mean | cycle-2 mean | Δ | hard fails |
| --- | ---: | ---: | ---: | ---: | ---: |
| ambiguity | 4 | 1.646 | 1.604 | −0.042 | 0 |
| bootstrap-empty | 2 | 1.834 | 1.834 | = | 0 |
| conversational | 6 | 1.861 | 1.833 | −0.028 | 0 |
| graph-query | 15 | 1.652 | 1.563 | −0.089 | 1 |
| honesty-miss | 5 | 1.400 | 1.511 | +0.111 | 0 |
| memory-recall | 3 | 0.861 | 1.389 | +0.528 | 0 |
| multi-turn-focus | 5 | 1.233 | 1.367 | +0.134 | 1 |
| noise | 5 | 1.200 | 1.533 | +0.333 | 0 |
| typo-fuzzy | 4 | 1.111 | 1.695 | +0.584 | 0 |

The three dipping tags (graph-query, ambiguity, conversational) contain **zero changed answers**;
their dips are fully accounted for by the def5678 ruler effect (graph-query: gq-when-changed-a,
gq-who-touched-a) plus the sampling-noise cluster itemized above.

## Every case that moved ≥ 0.3 (cycle 1 → cycle 2)

| case | tag | c1 | c2 | Δ | classification |
| --- | --- | ---: | ---: | ---: | --- |
| mr-session-count | memory-recall | 0.00 | 2.00 | **+2.00** | H1a — product flip (hard fail cleared) |
| tf-modles | typo-fuzzy | 0.50 | 2.00 | **+1.50** | L3 — product flip (hard fail cleared) |
| mt-describe-then-callers | multi-turn-focus | 0.667 | 2.00 | **+1.333** | H1b — measurement correction (answer unchanged) |
| gq-when-changed-a | graph-query | 2.00 | 1.00 | **−1.00** | def5678 ruler effect (answer unchanged, 3/3 unanimous) |
| ns-hey-tmct | noise | 0.00 | 0.917 | **+0.917** | L1 — product flip (hard fail cleared; capped by L4 grain) |
| tf-wat-calls | typo-fuzzy | 0.833 | 1.667 | **+0.834** | L1 — product flip |
| ns-wondering | noise | 0.00 | 0.75 | **+0.75** | L1 — product flip (hard fail cleared; capped by L4 grain) |
| mt-ask-then-touched | multi-turn-focus | 2.00 | 1.50 | **−0.50** | def5678 ruler effect (answer unchanged, 3/3 unanimous) |
| hm-empty-result-calls | honesty-miss | 1.111 | 1.444 | **+0.333** | judge-side uptick (answer unchanged) |
| mr-graph-intact | memory-recall | 1.833 | 1.50 | **−0.333** | def5678 ruler effect (answer unchanged) |

No other case moved more than 0.222; the full sub-0.3 tail is the noise cluster diagnosed above.

## Hard fails (2)

- **gq-functions-call-fnalpha** (graph-query): mean 0 — unchanged from cycle 1, **remaining by
  explicit choice** (L4 was cut to cycle 3 in the CHATBENCH_001 decision log). "which functions
  call fnAlpha" still answers "No functions found whose module directly calls fnAlpha" while the
  fixture records the symbol-level `callsSymbol` edge Widget.render → fnAlpha — a recorded fact
  denied with confidence. 3/3 samples zero it on the wrong-confident anchor.
- **mt-focus-drift** (multi-turn-focus): mean 0 — unchanged from cycle 1, **remaining by explicit
  choice** (L5 cut to cycle 3). Turn 3's "which modules import it" still binds "it" to a Commit
  (`traversal: imports edges where object = Commit`) instead of the focused a.mjs, contradicting
  the answer turn 1 itself displayed. 3/3 samples zero it. Note H1b removed the cycle-1
  contamination of this case's turn 1 — the zero is now entirely the turn-3 pronoun bug.

Both are 3/3-sample unanimous on every scored dimension — neither owes anything to judge noise.

## Tier-1 failures (0)

None. 48/48 as authored; 5 of the 9 documented baselineFail cases now carry
`improvedBaselineTurns` (the `improvedIn:"002"` markers in `chatbench/cases.jsonl`:
tf-modles, tf-wat-calls, ns-wondering, ns-hey-tmct, mr-session-count). The case set was not
edited or extended this cycle (append-only rule: 0 additions).

## Per-lever analysis

- **L1 noise-strip robustness — 3/3 target cases flipped, +2.501 case-points.**
  ns-wondering 0→0.75, ns-hey-tmct 0→0.917, tf-wat-calls 0.833→1.667. The mechanism worked
  exactly as designed: all three now parse through to the honest module-grain empty with its
  traversal receipt (the cycle-1 "couldn't resolve one of the terms" fabricated-limitation zeros
  are gone), and the passing noise cases (ns-um-hey, ns-could-you, ns-so-uh-count) stayed at
  2.0. **Why the ns-* pair stopped at ~0.8–0.9 instead of the predicted ~1.2:** the judge now
  grades the empty against the recorded symbol-level caller — every sample's rationale names the
  omitted Widget.render, and one ns-wondering sample zeroed the answer outright as
  wrong-confident. L1 lifted these cases *onto* the L4 answer-grain ceiling; only L4 lifts them
  off it. (tf-wat-calls escapes the worst of it because its case context frames the honest empty
  as the target answer — 2/3 samples gave it 2s.)
- **L3 schema-trap guard — target case flipped to perfect, +1.5 case-points.** tf-modles
  0.5→2.00, 3/3 unanimous: the fuzzy pivot onto the schema individual `Module` is gone, the
  repair receipt (`read as "which modules import a.mjs"`) is present, and the answer is complete.
  The regression-watch case on the same code path (tf-whcih-imprt) held at 2.0.
- **H1a clearCache between sessions — target case flipped to perfect, +2.0 case-points.**
  mr-session-count 0→2.00 ("1 session.", 3/3 unanimous), confirming CHATBENCH_001's reproduction:
  the failure was the bench's process-level read cache, not the product's append path.
  mr-graph-intact's session-2 answers remained byte-identical — H1a disturbed nothing.
- **H1b truthful FIXTURE_CONTEXT — target case +1.333, but net −0.667 case-points across the
  set.** mt-describe-then-callers 0.667→2.00 on an unchanged answer, 3/3 unanimous — the
  CHATBENCH_001 diagnosis (judge scored faithfully against an unfaithful summary) is confirmed
  live. The unmodelled cost: the same truthful provenance line makes 4 unchanged who/when-touched
  answers score as incomplete (−2.0; itemized under the shortfall decomposition). **Lesson
  recorded for future harness changes: enriching the judge context monotonically raises what
  "complete" demands — every fact added to the context is a new thing an unchanged answer can
  omit.** The correction stands (the ruler must state the fixture as it is), and it surfaced a
  real product gap now on the lever board (provenance disclosure, cycle-3 rank 3).

## Judge integrity

- **Voids: 0 / 144 samples** (second consecutive clean run at N=3 per case).
- **Hard-fail robustness:** both hard fails 3/3 unanimous zeros on every scored dimension.
- **The 5 novel flipped answers vs the set at large:** mean per-case sample spread on the five
  flips = **0.350** vs **0.231** for the other 43 — but the flip figure is entirely ns-wondering
  (spread 1.25: samples split 1.25/1.5/0 on whether the grain-capped empty is "incomplete" or
  "wrong-confident"). The other four flips are *tighter* than the set at large (tf-modles 0,
  mr-session-count 0, tf-wat-calls 0.25, ns-hey-tmct 0.25) — the judge is not confabulating on
  novel text; it is genuinely torn on one borderline answer that straddles the rubric's
  honest-miss/wrong-confident boundary.
- **Overall spread:** mean per-case spread 0.243 (cycle 1: 0.194). Worst: conv-what-can-you-do
  2.0 (same case as cycle 1, same disagreement about the hardcoded example questions),
  ns-wondering 1.25, gq-describe-widget / gq-impact-a / gq-public-methods-widget 1.0. The noise
  floor remains ~±0.02–0.03 of mean — the +0.100 headline delta is ~4× it, comfortably real; the
  −0.045 prediction shortfall is ~1.5–2× it and required (and got) the unanimity analysis above
  before being attributed.
- **Masking verified live** (advisor tick 9): dimension-masked cases return nulls on unscored
  dims; no mask violations in judged rows.
- **Harness telemetry gap (carried to cycle 3):** `judged.jsonl` is written atomically on
  completion, so mid-run integrity checks are impossible (advisor tick 9). Streaming per-case
  appends is on the lever board.

## RECOMMENDATIONS (the two-cycle arc, summarized with recommendations)

**What the arc proved about mechanical-chat viability ("how far can mechanical chat get"):**
a deterministic, no-LLM chat surface over a code graph reached **1.585/2 (79%) with 2/48 hard
fails and zero hallucinated entities in graph-derived answers across 96 case-runs** (caveat:
two cases emit static help-text placeholders naming entities absent from the fixture — a
templating honesty leak on the lever board, not an engine fabrication). The failure texture is
the headline finding: the engine never invents a graph fact — points lost are omissions and
mishandled misses, which is precisely the failure class LLM chat cannot structurally
guarantee against. The floor is honest; the ceiling is a coverage problem. The arc also proved
the tuning loop itself: single-seam levers move exactly their predicted cases (5/5 flips, hard
fails 6→2 on the nose), regressions are catchable by construction (byte-level answer diffs), and
the judge is stable enough (±0.02–0.03) to resolve per-cycle deltas of +0.10.

**Where the mean plateaus without new capability wiring:** the remaining 0.415 gap to 2.0
decomposes into: the two chosen-not-fixed hard fails (0.083 of mean), the answer-grain cluster
(~0.13), provenance-completeness (~0.04), the missing recall surface + honesty-polish tail
(~0.08), and ~0.08–0.10 of judge-taste residue (nudge quality on misses, completeness judgment
calls, the noise floor). **Realistic plateau for the current capability set: ~1.85–1.90** after
cycles 3–5 execute the board below. Beyond that, movement requires new wiring
(retrieveBlocks/templates, richer recall) *and new cases to measure it* — the current 48 cases
cannot see those subsystems at all.

**The one investment that moves it most: L4 answer-grain (callsSymbol) surfacing.** Cycle 2's
rationales make it unambiguous — six cases now cite the same omitted fact (Widget.render →
fnAlpha): the remaining graph-query hard fail (0.0), ns-wondering (0.75), ns-hey-tmct (0.917),
tf-fnalpah (1.111), hm-empty-result-calls (1.444), tf-wat-calls (1.667). (Amended after
adversarial review: summing this board's own per-case endpoints gives ≈ +4.5 case-points
≈ **+0.094 of mean** — comparable to, not more than, cycle 2's +4.8; the earlier "+6" was
headroom-to-2.0, not a prediction.) Tier-1 scoping trap already documented (below).

**Evidence-ranked plan for cycles 3–5:**
1. **Cycle 3 — L4 answer-grain surfacing** (the pick; scoping trap documented in the decision
   log). Prediction on record there.
2. **Cycle 4 — L5 pronoun/focus fix** (clears the last hard fail; H1b has made its judge context
   fair, so the score is now cashable) **+ provenance-commit disclosure** (recovers the 4
   def5678-capped cases) if the two prove separable seams; otherwise provenance slips to 5.
3. **Cycle 5 — honesty-polish batch** (hm-unknown-fn kind-correct phrasing, rephrase-nudges on
   unknown-entity misses — both hm-unknown-* cases have rephrase 0.0; am-bare-name entity
   acknowledgement; conv-what-can-you-do graph-derived examples — its hardcoded walk.mjs /
   buildContextBundle examples were flagged by judges in both cycles) **+ mr-asked-before recall
   surface** if budget allows (real product gap, needs a memory read-path design).
4. **Harness alongside (any cycle):** judged.jsonl streaming appends; keep FIXTURE_CONTEXT
   changes under the new rule — state facts *and* state what the product is expected to
   disclose, because context enrichment provably tightens the ruler.

**What needs OPERATOR input vs what stays autonomous:**
- **Autonomous (covered by the standing skill):** cycles 3–5 as ranked above; harness telemetry;
  the noise/polish tail. All are measurable against the existing frozen case set.
- **Operator decision 1 — case-set v2.** retrieveBlocks/templates/phrasebook wiring, seedMemory
  bootstrap, and batch appendFacts are *unmeasurable* today (no case exercises them — their
  absence costs 0.000 on this bench). Appending cases changes the arc's denominator; per the
  measurement contract that is legal but is exactly the kind of scope call the operator should
  bless: which user behaviours should the bench represent next?
- **Operator decision 2 — judge budget/pin.** N=3 with haiku resolves +0.10 deltas; if cycles
  4–5 chase +0.03–0.05 deltas, either raise N or accept coarser verdicts. Cost scales linearly.
- **Operator decision 3 — push/publish.** All cycle work is local commits per the guardrails;
  publishing (CI releases on version bump on main) remains a session-scoped operator call.

## Top discriminating transcripts

(Full appendix with before/after contrasts: `CHATBENCH_002_TRANSCRIPTS.md`.)

### mr-session-count (memory-recall) — 0 → 2.0

```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> how many sessions are there
1 session.
```

### tf-modles (typo-fuzzy) — 0.5 → 2.0

```
> which modles import a.mjs
read as "which modules import a.mjs" — app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

### ns-hey-tmct (noise) — 0 → 0.917

```
> hey tmct, what calls fnAlpha thanks
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

### ns-wondering (noise) — 0 → 0.75

```
> i was wondering what calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

### tf-wat-calls (typo-fuzzy) — 0.833 → 1.667

```
> wat calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

## RANKED LEVER BOARD (decision log)

The re-ranked next-cycle menu, re-scored with cycle-2 evidence; recorded per the no-hard-pause
rule (SKILL §2 step 6 / §0), not asked. Carried forward from CHATBENCH_001's cuts.

| rank | lever | expected movement (cases/tags) | justification |
| ---: | --- | --- | --- |
| 1 | **L4 answer-grain (callsSymbol) surfacing — THE PICK**, WITH the documented scoping trap: surface symbol-grain callers for "which functions call X" and add a one-line disclosure ("a symbol-level caller exists: Widget.render") to module-grain empties. **Do NOT flip bare "what calls X" to returning symbol callers** — hm-empty-result-calls' tier-1 expectation is `miss:true` + the module-grain empty; flipping it is a pass→fail regression = automatic cycle FAIL under SKILL §1 | gq-functions-call-fnalpha 0→~1.8 (clears a hard fail); ns-wondering 0.75→~1.6, ns-hey-tmct 0.917→~1.6, tf-fnalpah 1.111→~1.7, hm-empty-result-calls 1.444→~1.8 (disclosure line only), tf-wat-calls 1.667→~1.9; noise →~1.85, typo-fuzzy →~1.87; mean +0.11–0.13 | Promoted by cycle-2 evidence from "highest single-case value" to **the dominant seam on the board**: six cases' rationales now unanimously cite the same omitted fact; L1's under-delivery on ns-* is *this* ceiling |
| 2 | **L5 pronoun/focus fix** (mt-focus-drift: literal "it" binds to a Commit) | mt-focus-drift 0→~1.8 (clears the last hard fail); multi-turn-focus →~1.73; mean +0.04 | Unblocked: H1b landed and mt-describe-then-callers at 2.0 proves the judge context is now fair to /describe-anchored cases; regression guard: mt-ask-then-touched / mt-describe-then-callers must hold |
| 3 | **Provenance-commit disclosure** (NEW — surfaced by cycle 2): who/when-touched answers should disclose provenance-recorded commits ("touched by abc1234; provenance also records def5678") | gq-when-changed-a 1.0→~1.8, mt-ask-then-touched 1.5→~1.9, mr-graph-intact 1.5→~1.8, gq-who-touched-a 1.5→~1.8; mean +0.04 | The def5678 ruler effect is a *real* completeness gap the fairer context exposed; cheap answer-path addition, and it converts this cycle's −2.0 into next cycle's +2.0 |
| 4 | **Honesty-polish batch**: hm-unknown-fn kind-correct miss phrasing, rephrase-nudges on hm-unknown-* (both at rephrase 0.0), am-bare-name recognized-entity acknowledgement, conv-what-can-you-do graph-derived examples, + L8 Utterance/Fact CLASS_DOCS folded in | +2–3 case-points spread over 4–5 cases; mean +0.05 | Same scattered-but-cheap profile as cycle 1; judges flagged the hardcoded examples in both cycles — it is now a repeat offender, not a one-sample quibble |
| 5 | **mr-asked-before recall surface** (read the memory store for "what did i ask before"; honest "I can't recall" floor) | mr-asked-before 0.667→~1.5; memory-recall →~1.7 | Real product gap; needs memory read-path design — a full-cycle lever, not a patch |
| 6 | **Harness: judged.jsonl streaming appends** (advisor tick 9) + FIXTURE_CONTEXT disclosure-expectation notes for the @property / member-line-number / impact-depth-2 quibble cluster | no direct mean movement; enables mid-run integrity telemetry and shrinks the ~±0.02 quibble noise | Zero product risk; apply the new rule — context changes must state expected disclosure, since enrichment provably tightens the ruler (this cycle's −2.0 lesson) |
| 7 | **retrieveBlocks + templates/phrasebook runtime wiring** — GATED on operator case-set v2 | 0.000 on the current case set (verified: no case exercises them) | High latent value, cross-cutting risk, unmeasurable until cases exist; needs the operator's case-set blessing (RECOMMENDATIONS, operator decision 1) |
| 8 | **batch appendFacts + seedMemory bootstrap wiring** — GATED on case-set v2 | 0.000 on the current case set | Same gate as rank 7; O(N²) seeding cost is real but only matters once seeding is on a measured path |

**Pick: L4 answer-grain surfacing** (rank 1), scoped exactly as documented — carried into
cycle 3's step 1. On-record cycle-3 prediction (amended after adversarial review — grounded in
the per-case endpoint arithmetic): mean **1.585 → ~1.68 (band 1.66–1.71)**, hard fails **2 → 1**
(mt-focus-drift remains, by choice), tier-1 stays 48/48 with hm-empty-result-calls' `miss:true`
expectation intact; regression watch: hm-empty-result-calls (the trap case), gq-imports-of-a /
gq-tests-for-b (answer-path neighbors), and the three passing ns-* cases.
