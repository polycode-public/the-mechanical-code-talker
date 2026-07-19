# BENCHMARK_CEFR_ENGLISH_2.0.3 — mean 1.801/2, and a real regression the mean hides: the fronted-agent passive answers the inverse, bisected to 98df45a

**Result: mean 1.801 / 2 across 109 cases, 1 hard fail, tier-1 107/109, 0 voided samples.**

The mean is not the finding. **Two cases regressed from pass to fail on the deterministic tier**,
and both are the same shape: a passive question whose agent is fronted. `by which modules is
app/lib/b.mjs imported` answers `app/lib/a.mjs.` — which is what b.mjs *imports*, the exact inverse
of what was asked, stated with no hedge.

Tier-1 is deterministic, so this is not judge noise and does not depend on this cycle's N=1 choice.
A bisect over the 371 commits between 1.8.0 and 2.0.0 names the commit: **`98df45a fix(ask): the
passive keeps its agent, and a negated polar answers`** — the commit that set out to fix the passive
is the one that broke this reading. Its own message anticipated the risk and got the conclusion
backwards: *"The two passive readings that worked did so by accident: one operand in a one-slot bag.
They now hold by construction."* Those two readings are precisely the two that now fail.

**This cycle applied no lever.** It is a re-measurement at 2.0.3 on the operator's instruction. The
skill's comparative pass rule (mean up vs previous cycle) does not apply, because nothing was
changed to attribute movement to. The decision log below is **logged, not applied**.

## Profile — and the two limits chosen for it

```bash
node chatbench/run.mjs --stamp 2.0.3 --sample 1 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-2.0.3/product.jsonl \
  --samples 1 --concurrency 12 --out chatbench/results/raw/run-2.0.3
```

109 cases, **109 judge calls**, single draw. Judge model **`claude-haiku-4-5-20251001`** (the pinned
full id), prompt version **`judge-prompt-v1`**. Raw: `chatbench/results/raw/run-2.0.3/`.
**Voided samples: 0** — every judge call landed, so the mean is computed from real scores rather
than from nothing.

Two limits are the operator's deliberate choice, not the harness's reach. Both are stated here so
no later reader mistakes one for the other:

- **N=1, so there is no judge-noise averaging.** The judge is the noisy tier; the go-to is N=2 for
  that reason. At N=1 a single harsh or generous draw is not smoothed. Treat per-case judge scores
  as indicative and do not read a small mean delta as signal. The tier-1 findings below are
  unaffected — that tier is deterministic.
- **The default pool tests 9 of the 23 construction shapes** (12 of 36 grade×construction cells).
  Never exercised: conditional, coordination-compositional, discourse-deixis, ellipsis,
  garden-path, presupposition, quantifier-counting, relative-embedded, subordination, and five
  combination cells. Every prior CEFR report shares this blind spot, 1.8.0's 1.789/2 included.

**No delta against `BENCHMARK_CEFR_ENGLISH_1.8.0.md`'s 1.789/2 is computed here.** That run judged
at N=2; this one at N=1. Same pool, different instrument, so the two means are not the same
measurement and subtracting them would invent a trend. 2.0.3's mean stands as its own baseline.
Tier-1 is deterministic and *is* compared, which is how the regression below was found.

## The regression — fronted-agent passives, tier-1 PASS → FAIL

Both cases passed tier-1 at 1.8.0. Both fail at 2.0.3. No other case moved on tier-1 in either
direction: **2 movements out of 109, both regressions, both `reversible-passive` at B2.**

```txt
Q: by which modules is app/lib/b.mjs imported
A: app/lib/a.mjs.
   Canonical: what "app/lib/b.mjs" itself imports — forward(imports, entityType=Module, "app/lib/b.mjs")
   expected: app/functions/d/handler.mjs (mod-d)     [g-b2-passive-8 — judge mean 0/2, hard fail]

Q: by which modules is app/lib/a.mjs imported
A: app/lib/a.mjs has no imports edges in the index.
   Canonical: what "app/lib/a.mjs" itself imports — forward(imports, entityType=Module, "app/lib/a.mjs")
   expected: app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs (mod-b, mod-c, mod-e)   [g-b2-passive-10]
```

The `Canonical:` line is the whole diagnosis, and it says `forward` where the question asked for
`reverse`.

`g-b2-passive-8` is the worse of the two: it does not miss, it answers confidently and wrongly.
A reader who does not already know the graph cannot tell that answer from a correct one.
`g-b2-passive-10` degrades to an honest miss instead, which is survivable.

### Mechanism

`98df45a` rewrote the passive branch in
`src/domain/interpret/strategies/keywords.mjs`. The old code decided direction by reading the first
meaningful token after "by": a wh-word meant the agent was being *questioned*, so the shape was
`reverse` over the named patient. The new code instead partitions the sentence into "patient before
`by`, agent after `by`", and picks the shape from how many roles are named — *"agent alone reads
forward from the agent, patient alone reads reverse over the patient."*

That partition assumes the agent is **postposed**: `app/lib/b.mjs is imported by X`. The failing
form **fronts** the agent: `by which modules is app/lib/b.mjs imported`. Here "by" is the first
word, nothing precedes it, and the *patient* sits after it — so the patient is read as the agent,
"agent alone" fires, and the query compiles to `forward(imports, "app/lib/b.mjs")`. The answer is
then correct for a question nobody asked.

Both surface forms are ordinary English and mean the same thing. The rewrite handled one and lost
the other.

This is the same failure family as the audit skill's own worked example
(`SKILL_CAPABILITIES_AUDIT.md` §1: "was store.mjs touched" vs "has store.mjs been touched") and the
same family as the modal-negation inversion `playtests/PLAYTEST_LOG_002.md` fixed: a dropped or
mis-assigned role that yields a confident inverse rather than a miss.

**Not fixed here**, per this cycle's no-change rule. Logged below and mirrored to `HANDOVER.md`
with the reproducer, the bisect, and the mechanism.

## Scores

| | 2.0.3 (N=1) | 1.8.0 (N=2) |
| --- | --: | --: |
| overall mean | **1.801** | 1.789 |
| hard fails | **1** | 0 |
| tier-1 pass | **107/109** | 109/109 |
| voided samples | **0** | 0 |
| judge calls | 109 | 218 |

The mean row is two different instruments and is shown for the record, not as a delta. The tier-1
row is deterministic and is a real comparison: **109/109 → 107/109.**

### Per grade

| grade | n | mean |
| --- | --: | --: |
| A1 | 27 | 1.676 |
| A2 | 19 | 1.908 |
| B1 | 33 | 1.884 |
| **B2** | **10** | **1.600** |
| C1 | 10 | 1.917 |
| C2 | 10 | 1.750 |

B2 is the floor, and it is the grade the two passive regressions sit in. The ladder is not
monotonic — A1 (1.676) scores below C1 (1.917) — which says the grade bands measure construction
difficulty rather than a difficulty gradient tmct experiences.

### Per construction

| construction | n | mean |
| --- | --: | --: |
| **reversible-passive** | 10 | **1.600** |
| naming-vocabulary | 20 | 1.675 |
| svo-query | 25 | 1.800 |
| pronoun-binding | 20 | 1.800 |
| discourse-reference | 5 | 1.900 |
| temporal | 10 | 1.917 |
| noise+svo-query | 5 | 1.933 |
| assert-recall | 9 | 1.944 |
| negation | 5 | **2.000** |

`reversible-passive` is the worst construction in the pool, and the regression is inside it.
`negation` is perfect at 2.000 across its 5 cases — worth noting because the modal-negation
inversion fixed earlier today (`playtests/PLAYTEST_LOG_002.md`) is not represented in this pool at
all; these 5 cases are the tensed-auxiliary forms that always worked.

### Per tag

| tag | n | mean |
| --- | --: | --: |
| bootstrap-empty | 2 | 2.000 |
| conversational | 6 | 2.000 |
| honesty-miss | 5 | 2.000 |
| typo-fuzzy | 4 | 2.000 |
| noise | 5 | 1.933 |
| multi-turn-focus | 5 | 1.900 |
| memory-recall | 3 | 1.833 |
| graph-query | 16 | 1.781 |
| ambiguity | 4 | 1.625 |
| graded | 109 | 1.801 |

### Per rubric dimension (nulls excluded — a null is "not applicable", not a zero)

| dimension | n scored | 2.0.3 (N=1) | 1.8.0 (N=2) |
| --- | --: | --: | --: |
| groundedness | 98 | 1.857 | 1.898 |
| correctness | 85 | 1.694 | 1.782 |
| honesty | 60 | 1.883 | 1.783 |
| rephrase | 30 | 1.767 | 1.000 |

## Best examples — what good looks like at 2.0.3

**81 of 109 cases score a clean 2/2.** The perfect tags are all honesty tags, and these five are
verbatim:

```txt
Q: which modules import zebra.mjs                                    [hm-unknown-module, 2/2]
A: no symbol matching "zebra.mjs" found in the index. Try "who touched <a module that
   actually has commits>" or "/describe <module>" to see what's in the index.

Q: which modules import a.mjs                                        [be-honest-empty, 2/2]
A: the graph at <repo>/.tmct/graph.json is empty — no entities to answer from yet (this
   repo starts with no graph; the chat session folds the conversation into one).

Q: whcih modules imprt a.mjs                                         [tf-whcih-imprt, 2/2]
A: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
   Canonical: modules that imports "a.mjs" — reverse(imports, entityType=Module, "a.mjs")

Q: what does imports mean                                            [am-meta-imports, 2/2]
A: this could mean more than one thing:
   1) as meta "imports": imports is a predicate (relation) in the graph's schema:
      Module → Module. …External/unresolved imports are dropped, never guessed.
   2) as imports "mean": no module matching "mean" found in the index.

Q: hi                                                                [conv-hi, 2/2]
A: Hi. Ask me about this codebase — imports, calls, definitions, history — or /help.
```

These are the discriminating ones because each is a chance to guess and each declines it. The
unknown symbol is named as unknown rather than fuzzy-matched onto a real module; the empty graph
says it is empty; the double typo repairs to the right question rather than a nearby one; the
genuinely ambiguous "what does imports mean" offers both readings instead of picking; and small
talk stays out of the graph.

Set that against the regression above and the shape of 2.0.3 is clear: **tmct's honesty machinery
is in good order, and its role assignment is where the risk lives.** Every one of these five could
have produced a confident wrong answer and did not. `g-b2-passive-8` did.

## Predictions vs actuals

None to report. Predictions are a lever's forecast, and this cycle applied no lever. The nearest
thing to a prediction on record is `98df45a`'s own claim that the two accidental passive readings
"now hold by construction" — actual: both fail. Recorded here because it is exactly the
prediction-vs-actual the skill asks for, even though it was made two cycles ago rather than in this
one.

## Per-lever analysis

None. No lever was applied.

## Decision log — the re-ranked lever menu, LOGGED not applied

Ranked for the next CEFR cycle, whoever runs it. The pick is named, and per the operator's
no-change instruction it was **not implemented in this cycle**.

1. **PICK — restore the fronted-agent passive reading.** Highest value by a distance: it is the only
   known regression, it produces a confident inverse rather than a miss, it is bisected to a single
   commit with the mechanism understood, and it sits in the pool's worst construction (1.600). The
   shape of the fix is a role-assignment question — the partition needs to notice that a sentence
   opening with "by" fronts its agent — not a new capability. Expect `reversible-passive` 1.600 →
   ~1.900 and tier-1 back to 109/109.
2. **Grow the pool to the 14 untested shapes.** The instrument is blind to 61% of the construction
   space, and a blind spot is where the next `98df45a` lands unnoticed. `graded-pool-max.jsonl`
   already holds all 36 cells; the lightest full-coverage run is 315 cases (the per-cell floor,
   `MIN_PER_CELL = 5`).
3. **`naming-vocabulary` at 1.675 over 20 cases.** The second-worst construction and the largest
   sample of it, so the signal is real rather than a small-n artifact. Four A1 naming cases score
   1/2. Un-diagnosed; it needs a look before it needs a lever.
4. **`ambiguity` at 1.625 over 4 cases.** The worst tag, but n=4 at N=1 — the least trustworthy
   number in this report. Re-measure at N≥2 before spending a cycle on it.

## Discipline

- **Smoke gate passed before the run, and is recorded:** `npm test` 2450 pass / 0 fail; `printf
  'hi\n/exit\n' | node bin/tmct.mjs` greets and exits 0 in a graph-less temp dir and again in a
  fixture-graph dir. All three green, so the run stands.
- **Judge model and prompt version pinned** and stamped on every row:
  `claude-haiku-4-5-20251001`, `judge-prompt-v1`.
- **voidCount 0** — checked before any mean was written down.
- **No LLM in the product path.** The judge exists only in this harness.
- **Raw snapshotted** to `chatbench/results/raw/run-2.0.3/` before any later run can overwrite it.
- **Case set unchanged** — 109 cases, same ids as 1.8.0; the diff found no new or removed case.

## Open items mirrored to HANDOVER.md

- The fronted-agent passive answers the inverse. `by which modules is app/lib/b.mjs imported` →
  `app/lib/a.mjs.` (expected `app/functions/d/handler.mjs`), compiling to `forward(imports,
  "app/lib/b.mjs")` where the question asked for reverse. Tier-1 PASS → FAIL vs
  `BENCHMARK_CEFR_ENGLISH_1.8.0.md` on `g-b2-passive-8` and `g-b2-passive-10`; bisected to
  `98df45a`.
- CHATBENCH's default pool tests 9 of 23 construction shapes, so 14 are unmeasured on every CEFR
  report to date.
