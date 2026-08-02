# BENCHMARK_INFERENCE_5.0.5 — 499/499 rows pass, zero wrong answers, and the cheapest remaining ceiling turns out to be a chat-layer wire, not a missing rule

## Timing

- **Date:** 2026-08-02.
- **Benchmarking session (regenerate + `--replay` double run + grade):** 21:56:04 → 22:21:26 BST.
- **Analysis (this write-up, including the envelope re-run):** 22:21 → 22:48 BST.

**Headline.** Every band on both arms passes the gate at 100% completion and 0% fabrication, the
same place `BENCHMARK_INFERENCE_3.0.3.md` left the ladder. The case pool grew by 20 (a new
`c2SiblingResolution` template under INF-6), so this cycle measures 399 cases where 3.0.3 measured
379. The new finding is not in the rung table. A direct kernel probe shows the prover already
proves all 30 of INF-4's chain cases at lengths 3, 4 and 5, so that band's 30 ceiling rows are
waiting on a chat-layer bound, not on a rule anyone still has to write.

## Run

`node test-benchmarks/infbench/generate-cases.mjs` (the generator's own default seed, 20260707)
then `node test-benchmarks/infbench/run.mjs --replay --stamp 5.0.5`. 399 cases, two drive points:
the pure kernel prover (`src/domain/syllogise.mjs`) and the chat surface through the real turn
engine (`runChat()`). No LLM, no judge, no network.

`--replay`: **byte-identical across 2 runs — PASSED.**

Raw output: `test-benchmarks/infbench/results/raw/run-5.0.5/product.jsonl`, 499 rows (399 chat +
100 kernel). Every case gets a chat row; the kernel row exists only where the case declares a
`kernel` arm. That directory is gitignored by `test-benchmarks/infbench/results/.gitignore`, so the
snapshot lives on the run machine and this report carries the numbers.

`npm run infbench` is present in `package.json`, checked with `grep infbench package.json` per the
skill's own warning. The two steps ran separately here to pass `--stamp` and `--replay`.

Per-template counts, as the generator printed them:

| template | n | | template | n |
| --- | --: | --- | --- | --: |
| a1Lookup | 30 | | elConstructedRestriction | 8 |
| a2ChainLen2 | 40 | | elExistentialChain | 6 |
| b1Disjoint | 39 | | dlDisjunction | 6 |
| b1Existential | 40 | | dlComplement | 6 |
| b2ChainLenK | 30 | | dlDisjointProofSoundness | 8 |
| b2Svf1 | 10 | | a1UniversalConditional | 10 |
| b2Svf1Apply | 10 | | a2Reflexive | 10 |
| c1Cardinality | 30 | | a2Converse | 10 |
| c1ScmSvfApply | 10 | | a2EntailedRetraction | 12 |
| c2Inconsistent | 20 | | b1DisjointVeto | 24 |
| **c2SiblingResolution** | **20** | | b2PropertyInheritance | 20 |

## The metric pair, per band — kernel arm (100 rows)

| band | n | pass | completion | fabrication | gate | ceiling-graded |
| --- | --: | --: | --: | --: | --- | --: |
| INF-1 | 10 | 10 | **100%** | **0%** | PASS | 0 |
| INF-2 | 30 | 30 | **100%** | **0%** | PASS | 0 |
| INF-3 | 10 | 10 | **100%** | **0%** | PASS | 0 |
| INF-4 | 10 | 10 | **100%** | **0%** | PASS | 0 |
| INF-5 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| **all** | **100** | **100** | **100%** | **0%** | **PASS** | **0** |

Ladder: INF-1 → INF-2 → INF-3 → INF-4 → INF-5, unbroken. The kernel arm has no cases above INF-5,
so INF-5 is where its reading stops. Byte-identical to 3.0.3's kernel table.

## The metric pair, per band — chat arm (399 rows)

| band | n | pass | completion | fabrication | gate | live-graded | ceiling-graded |
| --- | --: | --: | --: | --: | --- | --: | --: |
| INF-1 | 40 | 40 | **100%** | **0%** | PASS | 40 | 0 |
| INF-2 | 72 | 72 | **100%** | **0%** | PASS | 72 | 0 |
| INF-3 | 103 | 103 | **100%** | **0%** | PASS | 103 | 0 |
| INF-4 | 70 | 70 | **100%** | **0%** | PASS | 40 | **30** |
| INF-5 | 40 | 40 | **100%** | **0%** | PASS | 40 | 0 |
| INF-6 | 40 | 40 | **100%** | **0%** | PASS | 40 | 0 |
| INF-7 | 14 | 14 | **100%** | **0%** | PASS | 0 | **14** |
| INF-8 | 20 | 20 | **100%** | **0%** | PASS | 8 | **12** |
| **all** | **399** | **399** | **100%** | **0%** | **PASS** | **343** | **56** |

Ladder: INF-1 → … → INF-8, unbroken. **No band failed the gate, so no band is
skipped-with-a-receipt this cycle.** Every number above was earned by a run, none inherited.
Kernel-vs-chat verdict agreement stays 100/100 on the cases both arms drive.

Versus 3.0.3: INF-6's `n` moved 20 → 40 and the overall `n` moved 379 → 399. Every other band's
`n`, completion, fabrication and ceiling split is identical, including the 30/70, 14/14 and 12/20
ceiling splits and the 56-row total.

## Honest misses versus wrong answers

These are different things for this product, so they are counted apart.

**Wrong answers: 0.** The grader calls a row `fabricated` when the engine returns a confident
`yes` or `no` that is not the literal pinned at generation time. Across all 499 rows, zero rows
are fabricated and zero rows fail. The run printed no non-passing rows section at all.

**Declines: 136.** The engine answered "cannot be proven" on 126 chat rows and 10 kernel rows.
Every one of them is correct behaviour, and they split into two kinds.

**Kind 1 — designed abstentions (70 chat rows, 10 kernel rows).** The pinned answer *is*
"unproven", because nothing entails a verdict. These are the control cells that stop a band from
scoring by luck. A confident answer here would be the fabrication.

| band | template / variant | rows | why declining is right |
| --- | --- | --: | --- |
| INF-2 | a2Converse / converse | 10 (+10 kernel) | "every X is a Y" does not entail "every Y is an X" |
| INF-2 | a2EntailedRetraction / stale-justification-falls | 6 | the premise that justified the conclusion was retracted |
| INF-3 | b1Disjoint / control | 13 | no disjointness axiom covers the pair |
| INF-3 | b1Existential / class-probe | 10 | an existential premise does not license a universal claim |
| INF-3 | b1Existential / individual-probe | 10 | same, at the individual level |
| INF-3 | b1DisjointVeto / class-control | 6 | the veto's negative control |
| INF-4 | b2Svf1 / svf1 | 10 | `(N1 ⊓ ∃verb.N2) ⊑ N3` does not entail the plain `N1 ⊑ N3` |
| INF-4 | b2PropertyInheritance / control | 5 | no inheritance path reaches the queried property |

**Kind 2 — ceiling markers (56 chat rows).** The classical answer exists, and the engine declines
because the capability that would derive it has not been built. Each row passes by holding the
honest-miss floor. These are the rows that mark where the ladder is, and the run names the
capability behind each.

| band | template / variant | rows | capability that would lift it |
| --- | --- | --: | --- |
| INF-4 | b2ChainLenK / chain-3, chain-4, chain-5 | 30 | chat-layer multi-hop proof-chain materialization |
| INF-7 | elConstructedRestriction / nested-existential | 8 | OWL 2 EL saturation (Stage EL) |
| INF-7 | elExistentialChain / existential-chain | 6 | OWL 2 EL saturation (Stage EL) |
| INF-8 | dlDisjunction / disjunction-elimination | 6 | OWL 2 DL reasoning by cases + phase-0 `unionOf` / negative assertions |
| INF-8 | dlComplement / complement | 6 | OWL 2 DL complement classes + phase-0 `complementOf` |

The reading in one line: **nothing this cycle answered incorrectly, and every gap is a decline.**

## The INF-4 ceiling is a chat-layer bound, and the kernel already clears it

This is the cycle's new evidence, and it changes which rung is cheapest to reach next.

The 30 `b2ChainLenK` rows teach a chain of 3, 4 or 5 subclass steps and ask whether the first
class is a kind of the last. The chat layer declines all 30. We ran the bench's own
`kernelVerdict()` over the same 30 cases with the kernel arm forced on, which drives
`src/domain/syllogise.mjs` directly and touches no source:

```
kernel probe over the 30 INF-4 chain cases:
  chain-3 -> yes 10
  chain-4 -> yes 10
  chain-5 -> yes 10
```

Example case: premises "every newborn is a rosette", "every rosette is a gouge", "every gouge is
a eelpout"; query "is a newborn a eelpout". The prover derives it. The mouth declines it.

The reason sits at two call sites. `src/services/chat.mjs:9618` and `:9639` both call
`findIsaChain(..., { maxHops: 2 })`. `findIsaChain` itself is declared at
`src/domain/syllogise.mjs:1715` with `{ maxHops = 6 }` as its own default, and its loop is
check-then-extend, cycle-safe, and never runs one hop past its budget. So the chat layer passes a
deliberately narrower bound than the function it calls already supports. The comment above the
first call site says so plainly and points at this benchmark as the thing pinning it.

That makes the boundary exact: 2 taught hops answer, 3 taught hops decline, and the reasoning to
close the gap already exists and is already tested.

## What the next rung needs, concretely

**Recommended next capability: INF-4's multi-hop proof-chain materialization.** It is the lowest
band still carrying ceiling rows, it is the largest single block of them (30 of 56), and it is the
only one whose inference already works.

A build track can be briefed from this without re-deriving anything:

1. **Raise the bound at the two call sites.** `src/services/chat.mjs:9618` (taught-only chase) and
   `:9639` (mixed-source chase) pass `{ maxHops: 2 }`. `findIsaChain` defaults to 6 and enforces
   its own budget, so the change is the bound plus everything below.
2. **Keep the two disciplines the current comment protects.** Corpus-only chains still never
   answer, because a bulk-corpus band can chain two unrelated classes into a coincidental yes. The
   mixed chase still needs at least one operator-taught premise. Both rules already live at those
   call sites and get longer, not different.
3. **Keep the disjoint veto in front of the answer.** `disjointRefusalFor(subj)` runs before each
   chain returns. A longer chain has more chances to cross a disjointness axiom, so this ordering
   matters more after the change, not less.
4. **Check the proof rendering at length.** `renderIsaChain(premises)` cites every premise with
   its source. A 5-step chain renders 5 premises. Read one before shipping, because the answer
   text is the product surface here.
5. **Update the generator in the same change.** This is the part that is easy to miss.
   `test-benchmarks/infbench/generate-cases.mjs` pins all 30 `b2ChainLenK` cases as
   `expect: { verdict: "unproven" }` with a `ceiling` field. Once the chat layer answers them, the
   grader scores 30 confident `yes` verdicts against a pinned `unproven` and calls all 30
   **fabrications**, taking INF-4's gate from PASS to FAIL and gating every band above it. The
   template must drop its `ceiling` field and flip `expect.verdict` to `yes` in the same commit
   that raises the bound. Regenerate `cases.jsonl`, then regenerate `envelope.json`.
6. **Re-run the cycle and confirm INF-4 clears at 0% fabrication** before treating it as done.

**Above that: INF-7, then INF-8.** Both need real new machinery and `PLAN_SYLLOGIST_EL_DL.md`
owns the design. INF-7's 14 rows need Stage EL, a saturation classifier that normalizes the TBox
to EL canonical forms and runs the completion rules to a fixpoint, so the engine can classify
through class expressions the graph never declared as nodes. INF-8's 12 rows need Stage DL's
bounded tableau prover and, before it, the phase-0 representation work: `unionOf`, `complementOf`,
negative type assertions and `oneOf` have no teach frame today, so those cases cannot be stated
yet, let alone reasoned over. INF-8's other 8 rows (`dlDisjointProofSoundness`) already grade live
and already pass.

INF-9 (abduction) and INF-10 (causal and counterfactual) have no generator template yet. They sit
at the honest-miss floor by construction and stay there until the engine behind each exists.

## What's new this cycle

- **`c2SiblingResolution`, 20 new INF-6 cases**, added by `3aff5884` alongside the dated-teach
  frame. Four variants of five: a repeated identical teach corroborates onto one fact; a second
  object under a multi-valued predicate merges; a second object under a single-valued possessive
  keeps both rows and surfaces both; and an "as of `<year>`" dated teach reaches the same
  both-kept result. All 20 pass live, none ceiling-graded.
- **`1caf60f1`, the dated teach frame** (`as of <date>` → `mgx:observedAt`), which is what let the
  `observed-at-conflict` variant be pinned to a live answer rather than a ceiling.
- **No engine lever was applied to `src/domain/syllogise.mjs` this cycle.** 850 commits landed
  between `dfa5585a` (the 3.0.3 report) and this run. One touched `syllogise.mjs`: `9532a056`,
  scoping `/retract` to the invoking session's own record. 50 touched `src/services/chat.mjs`.
  None moved a row on this case set.

## Drift check

**No drift, and one explained move.**

- Regenerating `cases.jsonl` from the default seed left `git status` clean, so the committed case
  set is byte-identical to what the generator produces today.
- INF-6's `n` moved 20 → 40 and overall `n` moved 379 → 399. Explained: the `c2SiblingResolution`
  template landed in `3aff5884`, and `envelope.json` was already regenerated for it in `b6a17c32`.
  The committed envelope's own band counts match this run exactly.
- `--replay` confirms determinism held, byte-identical across 2 runs.
- **`envelope.json` re-ran clean.** We regenerated it as a third check. It drives its own full
  bench pass, independent of the run above, and the diff against the committed file is one line:
  `generatedFrom.stamp` moved `4.1.4` → `5.0.5`. Every band metric, ceiling split and
  `bandReached` came back identical. That stamp bump is committed with this report, so the
  artifact names the version it was last measured against.
- Every other band matches 3.0.3 exactly.

No open regression.

## Discipline checklist

- **Zero fabrication held** at every band on both arms, 499 rows.
- **Determinism verified** with `--replay`.
- **`cases.jsonl` not hand-edited.** It was regenerated from the generator and matched what was
  committed.
- **Raw output snapshotted** to `test-benchmarks/infbench/results/raw/run-5.0.5/` before this
  write-up.
- **No overfit.** This was a measurement pass. No file under `src/` was touched, and the kernel
  probe in this report runs the bench's own read-only grading helper.

## Decision

**Ship as-is. Do not build this cycle.** Every band gates where 3.0.3 left it, at 100% completion
and 0% fabrication, with zero wrong answers anywhere in 499 rows. This run was scoped as
measure-and-report while four other tracks work the tree, so the next capability was identified
and left unbuilt on purpose.

**The next capability to build, when a quieter tree allows it: INF-4's multi-hop proof-chain
materialization**, per the six steps above. The evidence that makes it the right pick is the
kernel probe: the reasoning is already correct at chain lengths 3, 4 and 5, so this rung buys 30
of the 56 remaining ceiling rows by widening a bound and moving the pins to match. Stage EL and
Stage DL stay the path above it.
