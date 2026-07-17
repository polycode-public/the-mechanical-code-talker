# BENCHMARK_CEFR_ENGLISH_2.5.0 — the fronted-agent passive is fixed: tier-1 recovers on both passive cases, reversible-passive 1.600 → 2.000

**Result: mean 1.817 / 2 across 109 cases, 1 hard fail, tier-1 108/109, 0 voided samples.**

## Timing

- **Date:** 2026-07-17 (CEST).
- **Benchmarking session (product run + judge fan-out):** ~21:36:34 → ~21:49 — the 109-case product
  run is near-instant and deterministic; the 109 judge calls (`claude-haiku-4-5-20251001`,
  concurrency 12) dominate the wall-clock.
- **Analysis (reading the scores, writing this report):** ~21:49 → 21:50:51.
- **Note:** the session/analysis boundary is reconstructed from the run's wall-clock (~14m17s total);
  from 2.5.0 onward the four stamps are captured directly, per `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1.

The headline is a deterministic recovery, not the mean. The two fronted-agent passives that
regressed pass→fail at 2.0.3 — `by which modules is app/lib/b.mjs imported` answering the exact
inverse — **both pass tier-1 at 2.5.0**, and the worst construction in the pool,
`reversible-passive`, moves from 1.600 (with a hard fail inside it) to a clean **2.000, tier-1
10/10, zero hard fails**. This is the fix committed this cycle (`7c05ffd fix(ask): a passive that
fronts its agent keeps its direction`) landing exactly where 2.0.3's decision log said it would.

Two things moved the other way and are reported in full below, because neither is hidden by the
mean:

- **A new tier-1 pass→fail on `be-honest-empty`.** The bootstrap-empty message was reworded this
  cycle; the case's frozen `answerMatch` still expects the old wording, so tier-1 fails on the
  string check even though the answer is still an honest miss (judge scored it 2/2). Net tier-1:
  the two passives recover (+2), `be-honest-empty` breaks (−1), so 107/109 → 108/109, not the
  109/109 a passive-only fix would predict.
- **A new hard fail on `gq-impact-a`, which is N=1 judge noise on unchanged output.** The `/impact`
  answer is byte-identical to 2.0.3; the single judge draw scored its groundedness 1 at 2.0.3 and 0
  at 2.5.0, tipping it over the hard-fail line. It is a stable behaviour the judge flags, not a
  regression this cycle introduced.

**This cycle re-measures committed fixes.** Unlike 2.0.3 (a pure re-measurement with no lever), the
`grammar.passive.fronted-agent` fix was committed this cycle, so the skill's comparative pass rule
does attribute the tier-1 passive recovery and the `reversible-passive` cell 1.600 → 2.000 to that
fix. The overall mean delta (+0.016) is inside N=1 judge noise and is not itself the signal — the
deterministic tier-1 movement is.

## Profile — and the two limits chosen for it

```bash
node chatbench/run.mjs --stamp 2.5.0 --sample 1 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-2.5.0/product.jsonl \
  --samples 1 --concurrency 12 --out chatbench/results/raw/run-2.5.0
```

109 cases, **109 judge calls**, single draw. Judge model **`claude-haiku-4-5-20251001`** (the pinned
full id), prompt version **`judge-prompt-v1`**. Raw: `chatbench/results/raw/run-2.5.0/`.
**Voided samples: 0** — every judge call landed, so the mean is computed from real scores.

Two limits are the operator's deliberate choice, matching 2.0.3 exactly, not the harness's reach:

- **N=1, so there is no judge-noise averaging.** The judge is the noisy tier; the go-to is N=2 for
  that reason. At N=1 a single harsh or generous draw is not smoothed — the `gq-impact-a` hard fail
  below is exactly that. Treat per-case judge scores as indicative and do not read a small mean
  delta as signal. The tier-1 findings are unaffected — that tier is deterministic.
- **The default pool tests 9 of the 23 construction shapes** (12 of 36 grade×construction cells).
  Never exercised: conditional, coordination-compositional, discourse-deixis, ellipsis,
  garden-path, presupposition, quantifier-counting, relative-embedded, subordination, and five
  combination cells. Every prior CEFR report shares this blind spot.

Same pool, same instrument, same N as `BENCHMARK_CEFR_ENGLISH_2.0.3.md`, so the two runs **are** a
like-for-like comparison — including the deterministic tier-1 row, which is how the recovery below
is confirmed.

## The recovery — fronted-agent passives, tier-1 FAIL → PASS

Both cases failed tier-1 at 2.0.3. Both pass at 2.5.0. `g-b2-passive-8` was 2.0.3's single hard
fail (mean 0/2); it is now a clean 2/2.

```txt
Q: by which modules is app/lib/b.mjs imported
A: app/functions/d/handler.mjs.
   Canonical: modules that imports "app/lib/b.mjs" — reverse(imports, entityType=Module, "app/lib/b.mjs")
   [g-b2-passive-8 — judge 2/2 (groundedness 2, correctness 2); was 0/2 hard fail at 2.0.3]

Q: by which modules is app/lib/a.mjs imported
A: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
   Canonical: modules that imports "app/lib/a.mjs" — reverse(imports, entityType=Module, "app/lib/a.mjs")
   [g-b2-passive-10 — judge 2/2; tier-1 PASS, was FAIL at 2.0.3]
```

The `Canonical:` line is the whole diagnosis, and it now reads `reverse` where 2.0.3 read `forward`.
At 2.0.3 `g-b2-passive-8` answered `app/lib/a.mjs.` — what b.mjs *imports*, the exact inverse of the
question. At 2.5.0 it answers `app/functions/d/handler.mjs`, the module that imports b.mjs, which is
what was asked. The fronted "by" no longer reads the patient as the agent.

## The two movements against the recovery

### `be-honest-empty` — tier-1 PASS → FAIL on a reworded bootstrap message

```txt
Q: which modules import a.mjs                                    [be-honest-empty, tier-1 FAIL, judge 2/2]
A: I can't answer that as a code question — no code graph is loaded in this session. I can
   still remember and answer taught facts (try "every disk is a game piece"), or run
   `tmct init` in a repo to index one.
```

The case is frozen and expects the old wording:
`answerMatch: ["is empty — no entities to answer from yet", "folds the conversation"]`. The product's
bootstrap-empty reply was reworded this cycle to lead with the general-vocabulary / taught-facts path,
so neither string appears and tier-1 fails both `answerMatch` checks. The answer is still an honest
miss — it invents no entity, matches the `answerNotMatch: ["app/lib/"]` guard, and the judge scored
it 2/2 (groundedness 2, honesty 2, rephrase 2). So this is a deterministic tier-1 regression driven
by a frozen expectation drifting out of sync with a reworded product string, **not** a semantic
regression in behaviour. The case set is append-only mid-arc, so the case itself cannot be edited
here; the reconciliation (restore the wording, or record a deliberate expectation revision next
cycle) is a HANDOVER item.

### `gq-impact-a` — a hard fail that is N=1 judge noise on unchanged output

```txt
Q: /impact app/lib/a.mjs                                         [gq-impact-a, tier-1 PASS, judge 0.5/2]
A: … depth 1 (4 direct dependents): app/lib/b.mjs (imports it) … depth 2 (2):
   app/functions/d/handler.mjs (imports it) …
```

The `/impact` output is **byte-identical to 2.0.3**. The single judge draw scored groundedness 1 at
2.0.3 and groundedness 0 at 2.5.0 (correctness held at 1 both times), which flipped it across the
hard-fail line (groundedness 0). The judge's stated reason is that a depth-2 transitive dependent is
labelled `(imports it)` when it reaches a.mjs through an intermediary rather than directly. That is a
real observation about the impact report's depth labelling, but it is a stable behaviour, unchanged
this cycle, surfaced by a harsher draw. This is precisely the N=1 caveat: a single draw is not
smoothed. Logged as a candidate lever below, not counted as a cycle regression.

## Scores

| | 2.5.0 (N=1) | 2.0.3 (N=1) |
| --- | --: | --: |
| overall mean | **1.817** | 1.801 |
| hard fails | 1 | 1 |
| tier-1 pass | **108/109** | 107/109 |
| voided samples | 0 | 0 |
| judge calls | 109 | 109 |

Same pool, same instrument, same N — this is a real comparison on every row. The tier-1 row moves
107 → 108: **+2 from the passive recovery, −1 from `be-honest-empty`.** The +0.016 mean is inside
N=1 judge noise; do not read it as a trend on its own. The hard-fail count is 1 at both versions but
on different cases: 2.0.3's was a genuine confident-inverse product bug (`g-b2-passive-8`, now
fixed); 2.5.0's is a judge-draw flip on unchanged output (`gq-impact-a`).

### Per grade

| grade | n | 2.5.0 mean | 2.0.3 mean |
| --- | --: | --: | --: |
| A1 | 27 | 1.636 | 1.676 |
| A2 | 19 | 1.921 | 1.908 |
| B1 | 33 | 1.818 | 1.884 |
| **B2** | 10 | **2.000** | 1.600 |
| C1 | 10 | 1.867 | 1.917 |
| C2 | 10 | 1.875 | 1.750 |

B2 was the floor at 2.0.3 and is now perfect — the passive fix lands entirely in this grade. The
ladder is still not monotonic (A1 at 1.636 sits below C1 at 1.867), which says the grade bands
measure construction difficulty rather than a difficulty gradient tmct experiences.

### Per construction

| construction | n | 2.5.0 mean | 2.0.3 mean |
| --- | --: | --: | --: |
| **naming-vocabulary** | 20 | **1.633** | 1.675 |
| negation | 5 | 1.733 | 2.000 |
| svo-query | 25 | 1.780 | 1.800 |
| discourse-reference | 5 | 1.800 | 1.900 |
| temporal | 10 | 1.867 | 1.917 |
| pronoun-binding | 20 | 1.871 | 1.800 |
| noise+svo-query | 5 | 1.933 | 1.933 |
| assert-recall | 9 | 1.944 | 1.944 |
| **reversible-passive** | 10 | **2.000** | 1.600 |

`reversible-passive` goes from the worst construction to a perfect one. `naming-vocabulary` is now
the worst construction (1.633), and `negation` dropped 2.000 → 1.733 — but negation is n=5 at N=1
with tier-1 5/5, so that drop is judge wobble on a small cell, not a behaviour change.

### Per cell (grade × construction) — the marginals hide the real floor

The per-grade and per-construction marginals both average `naming-vocabulary` across A1 and A2. The
cell table shows the true floor sits in one of them:

| grade / construction | n | 2.5.0 mean | tier-1 | 2.0.3 mean |
| --- | --: | --: | :--: | --: |
| **A1 / naming-vocabulary** | 10 | **1.367** | 10/10 | 1.475 |
| B1 / negation | 5 | 1.733 | 5/5 | 2.000 |
| B1 / svo-query | 8 | 1.750 | 8/8 | 1.813 |
| A1 / svo-query | 17 | 1.794 | 16/17 | 1.794 |
| B1 / discourse-reference | 5 | 1.800 | 5/5 | 1.900 |
| B1 / pronoun-binding | 10 | 1.867 | 10/10 | 1.850 |
| C1 / temporal | 10 | 1.867 | 10/10 | 1.917 |
| C2 / pronoun-binding | 10 | 1.875 | 10/10 | 1.750 |
| A2 / naming-vocabulary | 10 | 1.900 | 10/10 | 1.875 |
| B1 / noise+svo-query | 5 | 1.933 | 5/5 | 1.933 |
| A2 / assert-recall | 9 | 1.944 | 9/9 | 1.944 |
| **B2 / reversible-passive** | 10 | **2.000** | 10/10 | 1.600 |

**The true floor is `A1 / naming-vocabulary` at 1.367** — below every other cell and below the B2
grade the recovery just cleared. It is the same floor 2.0.3 found (1.475), a touch lower here, and
the drop is inside N=1 noise: the cell's tier-1 is 10/10, and the product's per-turn output on
several of these cases actually improved this cycle (three A1 naming baselineFail turns —
`g-a1-naming-1/8/9` — now pass tier-1). The judge simply scored the definitional answers a shade
harder on this draw. The floor is the definition answers themselves: several ("what is a Function",
"what does tests mean") mix a correct generic definition with fixture examples and draw a
groundedness or correctness 1 rather than 2.

The `A1 / svo-query` cell holds both this cycle's oddities: its tier-1 is 16/17 (the `be-honest-empty`
regression) and it carries the `gq-impact-a` hard fail, yet its mean is flat at 1.794 because both
cases still score well on the dimensions that apply to them.

### Per tag

| tag | n | 2.5.0 mean | 2.0.3 mean |
| --- | --: | --: | --: |
| bootstrap-empty | 2 | 2.000 | 2.000 |
| conversational | 6 | 2.000 | 2.000 |
| noise | 5 | 1.933 | 1.933 |
| memory-recall | 3 | 1.833 | 1.833 |
| multi-turn-focus | 5 | 1.800 | 1.900 |
| ambiguity | 4 | 1.750 | 1.625 |
| typo-fuzzy | 4 | 1.750 | 2.000 |
| graph-query | 16 | 1.740 | 1.781 |
| honesty-miss | 5 | 1.733 | 2.000 |
| graded | 109 | 1.817 | 1.801 |

`bootstrap-empty` stays at 2.000 as a tag mean even though `be-honest-empty` failed tier-1 — the
judge scored the reworded miss 2/2, so the semantic tag is unmoved; only the deterministic string
check caught the drift. The small drops in `honesty-miss`, `typo-fuzzy` and `graph-query` are n≤16 at
N=1 and track the same judge-draw variance as `negation`.

### Per rubric dimension (nulls excluded — a null is "not applicable", not a zero)

| dimension | n scored | 2.5.0 (N=1) | 2.0.3 (N=1) |
| --- | --: | --: | --: |
| groundedness | 98 | 1.847 | 1.857 |
| correctness | 84 | 1.738 | 1.694 |
| honesty | 60 | 1.883 | 1.883 |
| rephrase | 30 | 1.833 | 1.767 |

Correctness rises 1.694 → 1.738, consistent with the passive fix turning a confident-inverse answer
into a correct one on the dimension that penalised it hardest.

## Best examples — what good looks like at 2.5.0

**82 of 109 cases score a clean 2/2.** The passive recovery is the demo reel this cycle — the same
two questions that produced a confident inverse at 2.0.3 now resolve correctly and cite the reverse
direction in the canonical line. Beyond it, the honesty machinery holds:

```txt
Q: by which modules is app/lib/b.mjs imported                       [g-b2-passive-8, 2/2]
A: app/functions/d/handler.mjs.
   Canonical: modules that imports "app/lib/b.mjs" — reverse(imports, entityType=Module, "app/lib/b.mjs")

Q: what does imports mean                                            [g-a1-naming-9, 2/2]
A: this could mean more than one thing:
   1) as meta "imports": imports is a predicate (relation) in the graph's schema: Module → Module. …

Q: which modules import a.mjs                                        [be-honest-empty, honest miss]
A: I can't answer that as a code question — no code graph is loaded in this session. I can still
   remember and answer taught facts (try "every disk is a game piece"), or run `tmct init` …

Q: what is a Module                                                  [g-a1-naming-4, 2/2]
A: A module is a source file. In this codebase, for example: app/lib/a.mjs, app/lib/b.mjs, …

Q: hi                                                                [conv-hi, 2/2]
A: Hi. Ask me about this codebase — imports, calls, definitions, history — or /help.
```

Each is a chance to guess and declines it: the passive resolves the role correctly rather than
answering the inverse; the ambiguous "what does imports mean" offers both readings; the empty graph
says it cannot answer as a code question and points at the paths that would work. `be-honest-empty`
is shown here as an honest miss on purpose — its tier-1 failure is a frozen string check, not a
behaviour the reader should mistrust.

## Predictions vs actuals

The prediction on record is 2.0.3's decision-log PICK: "restore the fronted-agent passive reading …
Expect `reversible-passive` 1.600 → ~1.900 and tier-1 back to 109/109."

| predicted | actual |
| --- | --- |
| `reversible-passive` 1.600 → ~1.900 | **2.000** (beat the forecast) |
| tier-1 back to 109/109 | **108/109** — the two passives recovered as predicted; a separate, unforeseen `be-honest-empty` regression (reworded bootstrap message) held it one short |

The passive half of the prediction landed and then some. The 109/109 target missed by one for a
reason unrelated to the passive fix — the bootstrap-message rewording is orthogonal to the grammar
lever and was not in the forecast.

## Per-lever analysis

**Lever applied (committed this cycle): the fronted-agent passive fix, `7c05ffd fix(ask): a passive
that fronts its agent keeps its direction`, with `grammar.passive.fronted-agent` pins.** It moved
exactly the two cases 2.0.3 bisected to `98df45a`:

- `g-b2-passive-8`: tier-1 FAIL → PASS, judge 0/2 (hard fail) → 2/2.
- `g-b2-passive-10`: tier-1 FAIL → PASS, judge 1/2 → 2/2.

Cell effect: `B2 / reversible-passive` 1.600 → 2.000, tier-1 8/10 → 10/10, hard fails 1 → 0. No other
case moved on tier-1 because of this lever. The fix is attributable and clean — the partition that
previously assumed a postposed agent now recognises that a sentence opening with "by" fronts its
agent, so `by which modules is X imported` compiles to `reverse` over X instead of `forward`.

## Decision log — the re-ranked lever menu, LOGGED not applied

Ranked for the next CEFR cycle, whoever runs it.

1. **PICK — reconcile the `be-honest-empty` frozen expectation with the reworded bootstrap message.**
   Highest value: it is the only new tier-1 pass→fail, it is understood exactly (the product's
   bootstrap-empty reply was reworded and the frozen `answerMatch` still expects the old strings),
   and the answer is already an honest miss the judge scores 2/2. The fix is either restoring the
   old wording in the product path or recording a deliberate case-expectation revision next cycle
   (the append-only rule forbids editing the case mid-arc). Expect tier-1 108/109 → 109/109.
2. **`A1 / naming-vocabulary` at 1.367 — the true floor, and the marginals hide it.** Below every
   other cell and below the B2 grade the passive fix just cleared. Tier-1 is 10/10, so this is a
   judge-scored quality gap in the definitional answers (generic definition + fixture examples
   drawing groundedness/correctness 1 rather than 2), not a miss. Un-diagnosed; it needs a look
   before it needs a lever, and it wants an N≥2 read to separate signal from the draw.
3. **`gq-impact-a`'s depth labelling — `(imports it)` on a depth-2 transitive dependent.** The judge
   flagged it as ungrounded on this draw. The output is unchanged and correct on the closure itself;
   the wording overstates directness at depth ≥ 2. A small, well-scoped rephrase (say "reaches it via
   …" past depth 1). Low urgency — it is stable behaviour, and its hard-fail status this cycle is an
   N=1 artifact.
4. **Grow the pool to the 14 untested shapes.** The instrument is still blind to 61% of the
   construction space, and a blind spot is where the next confident-inverse lands unnoticed —
   exactly how `98df45a` slipped through. `graded-pool-max.jsonl` already holds all 36 cells; the
   lightest full-coverage run is 315 cases (`MIN_PER_CELL = 5`).
5. **Re-measure at N≥2 before spending a cycle on any small-cell drop.** `negation` (2.000 → 1.733,
   n=5), `honesty-miss` (2.000 → 1.733, n=5) and `typo-fuzzy` (2.000 → 1.750, n=4) all fell this
   cycle on N=1 draws with clean tier-1 — most likely judge variance, not behaviour. N=2 tells them
   apart cheaply.

## Discipline

- **Smoke gate passed before the run, and is recorded:** `npm test` 2794 pass / 0 fail; `printf
  'hi\n/exit\n' | node bin/tmct.mjs` greets and exits 0 in a graph-less temp dir and again in a
  fixture-graph dir. All three green, so the run stands.
- **Judge model and prompt version pinned** and stamped on every row:
  `claude-haiku-4-5-20251001`, `judge-prompt-v1`, samples 1.
- **voidCount 0** — checked before any mean was written down.
- **No LLM in the product path.** The judge exists only in this harness.
- **Raw snapshotted** to `chatbench/results/raw/run-2.5.0/` before any later run can overwrite it.
- **Case set unchanged** — 109 cases, same ids as 2.0.3; no case added, edited, or removed. The
  `be-honest-empty` regression is a product-side wording change against a frozen expectation, not a
  case edit.
- **This is a measure-only run** — no `src/`, `test/`, or pool edits were made while measuring, per
  `SKILL_BENCHMARK_CEFR_ENGLISH.md`.

## Open items mirrored to HANDOVER.md

- `be-honest-empty` tier-1 PASS → FAIL: the bootstrap-empty reply was reworded (now "I can't answer
  that as a code question — no code graph is loaded …") and the case's frozen `answerMatch` still
  expects "is empty — no entities to answer from yet" / "folds the conversation". The answer is an
  honest miss (judge 2/2); reconcile by restoring the wording or recording a deliberate expectation
  revision next cycle. Holds tier-1 at 108/109 instead of 109/109.
- `gq-impact-a` `/impact` output labels a depth-2 transitive dependent as `(imports it)`; the judge
  scored groundedness 0 on this N=1 draw (a hard fail) against a groundedness 1 at 2.0.3 on
  byte-identical output. Stable behaviour, N=1 artifact — a rephrase past depth 1 removes the
  overstatement.
- CHATBENCH's default pool tests 9 of 23 construction shapes, so 14 are unmeasured on every CEFR
  report to date.
