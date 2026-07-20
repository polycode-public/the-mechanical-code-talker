# PLAN_TOOL_LADDER_UPLIFT.md — the TOOL-7 replan branch and the TOOL-8 tied-candidate composer

Status: DELIVERED. Both rungs are live code; all 67 `agentbench/cases.jsonl` rows pass under both
the pure C1 resolver driver and the full goal driver, `agentbench/envelope.json` now reads
`rungReached: TOOL-8` with every rung gate-PASS. Candidate for `archive/`.

- **TOOL-8 (tied-candidate composer)**: `src/domain/router/resolver.mjs`'s `resolveOne` — a new
  `testModuleTie()` check recognizes a source module and its own test module as a genuine tie via
  the graph's own `tests` edge (never a raw tier-3 score tie: "b.mjs" scores far above
  "b.test.mjs" on string similarity alone). A tie reuses the resolver's existing ambiguous-refusal
  path (`dispatchEachCandidate`) unchanged, and additionally returns `candidateCalls` — the
  `{name,input}` call shape `agentbench/grade.mjs`'s `candidateResults` check expects, distinct
  from the pre-existing `{candidate,result}` `candidateResults` shape kept for its own callers.
  `src/domain/router/drive.mjs`/`agentbench/driver-resolver.mjs` surface it as the loopResult's own
  `candidateResults`; `runCapabilityPlan`/`goalDriver` treat a refusal carrying it as terminal
  (never escalated to the taught/goal-reasoner lanes, which would otherwise silently drop the
  enumerated answer for a plainer refuse).
- **TOOL-7 (observe-and-replan branch)**: built in the planner's own method table
  (`src/domain/router/planner.mjs`), not the goal-reasoner — these requests are direct conditional
  read queries (the planner's existing domain), never a novel world-goal the goal-reasoner deduces.
  `decompose()` gained a `recover` method ("`<primary>`, and if `<empty-cue>`, `<fallback>`
  instead", gated on the check clause naming an emptiness cue so an ordinary "X, and if Y, Z
  instead" without one keeps falling through to plain sequencing). `plan()` dispatches the primary,
  re-dispatches it once to OBSERVE its own structured result (the same re-dispatch idiom
  `composeResult` already uses to fold a threaded plan), and only then decides: a non-empty primary
  stops the loop after one call (no `recovered` key), an empty one dispatches the fallback and
  marks `recovered: true`. The old bug (the primary emitted twice, guard never observed) is gone by
  construction — the primary is emitted exactly once, as the observation step.
- Tests: `test/adapters/router-drive.test.mjs` (both rungs' recovery/tied-composer + guard-fails/
  clear-match control cases), `test/adapters/router-resolver.test.mjs` (the `recover` method's
  decompose shape and its emptiness-cue gate).

## What the round measured

- **TOOL-7 (recovery/replanning): 0% on every arm.** The conditional-fallback phrasing
  (`list what fnAlpha calls, and if it calls nothing, list what calls it instead`) decomposes via
  the HTN sequence method into `tmct_callees → tmct_callees → tmct_callers`: the guard clause is
  never observed, the fallback always fires, and the primary is emitted twice. The answer happens
  to be right on the bench fixture (the callees set IS empty), which is exactly why the plan
  shape must be fixed before it meets a case where the guard holds. The other two recovery
  phrasings refuse cleanly at the open-world seam — correct behaviour, and the rung's floor.
- **TOOL-8 (composition-under-ambiguity): 67% on every arm that routes.** Both plain-refusal
  cases pass; the `candidateResults` case fails everywhere. On `what depends on b`, the resolver
  binds bare "b" to `app/lib/b.mjs` at match tier 3 and fires `tmct_impact`, never surfacing the
  tied `app/unit-tests/b.test.mjs` reading — a confident impact answer for a module the user may
  not have meant.

## 1. The observe-and-replan branch (TOOL-7)

The drivers plan open-loop: a decomposition is computed once and every step dispatches. A
conditional request needs one genuinely new move — **observe the primary's result before deciding
the next step**. The design direction, sized to this codebase:

- The plan representation grows a guarded step: `{call, guard: {onEmpty: [fallback…]}}` (or the
  equivalent in the goal reasoner's method table) instead of a flat sequence. The "instead"
  clause compiles to the guard's branch the way TOOL-4's fold already owns its conditional — the
  precedent is in the composed-answer recipes (`ab-b2-cond-*`), which already observe a guard set
  and choose; the lift is moving that observe-choose shape from the fold layer into the
  step-emission layer so the CALL SEQUENCE itself branches.
- Execution: dispatch the primary, observe the result, emit either nothing more (guard fails,
  primary answered) or the fallback (guard holds). The duplicated-primary bug disappears by
  construction because the primary is emitted exactly once, as the observation step.
- Grading already knows the shape: `expect.recover` names `{after, fallback}` and the harness
  checks the fallback fired after the primary returned empty. The bench is ahead of the product
  here; no grading change is needed.

## 2. The tied-candidate composer (TOOL-8)

The resolver's binding oracle (`resolveObject` through the bench ctx's `resolve()`) returns its
best match; ties die silently at tier 3. The design direction:

- At the resolveObject seam, when the top candidates tie within a grain (module vs test-module
  here), the driver composes **one dispatched read per tied candidate** and returns them as
  `candidateResults` alongside the refusal-to-pick — the enumerate-or-refuse shape the chat
  surface already uses for ambiguous entities (`ask.mjs`'s "matches more than one … ambiguously"
  path). The chat surface enumerates; the driver arbitrarily picks. The lift is porting the chat
  surface's own discipline into the driver loop.
- The grading side exists (`sameCandidates`, `expect.candidateResults`); the bench case
  (`ab-c2-what-depends-on-b`-shaped) fails today on every arm and flips when the composer lands.
- Scope guard: the composer fires only on real ties at the same match tier — a clear best match
  keeps today's single-call plan. The control cases pin that nothing narrows.

## Sequencing

1. TOOL-8 first — smaller, and the chat surface already carries the pattern to port.
2. TOOL-7's guarded step second — it touches the plan representation, so its design pass decides
   whether the guard lives in the HTN method table or the emission loop, and that decision wants
   the TOOL-8 seam work already in place.
3. Re-run the AGENT axis after each; the rungs' cases are already authored and graded, so the
   measurement is free.

## Pins

Each rung's cases exist in `agentbench/cases.jsonl` and fail honestly today. The delivery pins
are: the TOOL-7 case's call sequence emits the primary once and the fallback only on an observed
empty; the TOOL-8 case returns the tied pair as `candidateResults` with no arbitrary pick; the
control cases (clear best match, guard-fails path) unchanged. Chat-surface parity rows where the
same phrasings reach chat lanes.

## Risks

- The guarded step must not regress the fully-observed plans Hanoi and river-crossing pin — the
  guard is additive, and the existing `planning.jsonl` rows are the regression fence.
- Tie detection needs the same residue discipline the chat ambiguity path learned: a tie is two
  candidates the query genuinely fails to separate, not any two fuzzy neighbours — the
  `overfitProne` tag on the driving cases is the warning label.
