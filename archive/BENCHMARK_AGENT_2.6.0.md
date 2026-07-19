# BENCHMARK_AGENT_2.6.0 — first measurement on the nine-rung TOOL ladder: the goal driver holds 100% through TOOL-6 and now gates at TOOL-7, exactly where the reform said it would

## Timing

- **Date:** 2026-07-18 (CEST).
- **Benchmarking session:** 04:46:40 → 04:49:28 — the four deterministic driver arms, the
  byte-identity re-run, and the discipline checks. (Case verification probes ran 04:41–04:44,
  before the case-set commit.)
- **Analysis + write-up:** 04:49:28 → 04:52:30.

The honest delta versus `BENCHMARK_AGENT_2.5.0.md`: **no capability moved on any arm.** On the
2.5.0-comparable scope (TOOL-0…TOOL-6, the old `A0…C2` under the reform's alias map) the goal
driver reads 60/60 where 2.5.0 read 56/56, the resolver floor gates at TOOL-6 where it gated at C2,
and the stub floor gates at TOOL-3 where it gated at B1. What changed is the ruler, twice over:

1. **The ladder grew two rungs** (`archive/PLAN_BENCHMARK_LADDERS.md`, landed as the TOOL-0…TOOL-8
   reform). TOOL-7 (recovery and replanning) and TOOL-8 (composition under ambiguity) are measured
   for the first time here, on all four arms. The goal ladder now reads "gated at TOOL-7" instead of
   2.5.0's "clears C2" — that is the taxonomy growing over the same engine, not a regression. The
   engine's reach is identical.
2. **The resolver floor's C2 number changed meaning.** `ab-c2-what-to-test` now declares
   `floorExpect: { refuse: true }`, so the plannerless arm's refusal grades as the declared correct
   outcome rather than a bare miss. TOOL-6 plan-completion on the floor arm reads **36% (4/11)
   against 2.5.0's 27% (3/11) purely because of this reclassification** — the arm's behavior is
   byte-for-byte the same refusal with zero calls, and the row records `floorExpectApplied: true`.
   Read the +9 points as measurement semantics, not capability.

This cycle applied no router lever. No code in `src/domain/router/` changed for this benchmark.
The case set grew 62 → 66 by four appended cases (below), all verified by running before pinning.

## Run

`node agentbench/run.mjs --driver <stub|shim|resolver|goal> --ladder --stamp 2.6.0-<driver>`
— 66 cases per arm, no LLM, no network, no judge. All four exited 0. Raw (untracked, per
`agentbench/results/.gitignore`): `agentbench/results/raw/run-2.6.0-{stub,shim,resolver,goal}/product.jsonl`.

## The metric pair, per rung — goal driver (Stage 5), 66 cases

Drivers `resolver-0.8.0` + `goal-0.8.1`.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| TOOL-0 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-1 | 14 | 14 | **100%** | **100%** | **0%** | PASS |
| TOOL-2 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-4 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-5 | 9 | 9 | **100%** | **100%** | **0%** | PASS |
| TOOL-6 | 11 | 11 | **100%** | **100%** | **0%** | PASS |
| TOOL-7 | 3 | 0 | 0% | 0% | **0%** | ---- |
| TOOL-8 | 3 | 2 | 67% | 67% | **0%** | skipped (gated by TOOL-7) |
| **all** | **66** | **62** | **94%** | **94%** | **0%** | gated at TOOL-7 |

Ladder: TOOL-0 → … → TOOL-8 — **gated at TOOL-7** (completion 0% < 50%), TOOL-8
skipped-with-a-receipt. Everything the 2.5.0 ladder measured is still 100% across the board,
including the four new TOOL-1/TOOL-2 cases. The gate sits exactly where the reform predicted:
the current drivers have no replanning branch, so the recovery rung is a named horizon with its
build path (a replanning branch in `src/domain/router/planner.mjs`; a tied-candidate composer in the
goal reasoner), measured at its floor.

What the goal driver actually does on the new rungs, case by case:

- `ab-tool7-callers-recover-button`, `ab-tool7-tests-recover-impact-c`: clean refusals at the
  open-world seam (no declared goal-rule covers the conditional-fallback shape). Honest misses,
  zero calls.
- `ab-tool7-callees-recover-callers-fnalpha`: C1's HTN sequence method takes the request and emits
  **three unconditional calls with a duplicated primary** (`tmct_callees`, `tmct_callees`,
  `tmct_callers`) — no recovery signal, both branches executed regardless of the observation. All
  three calls are declared and well-formed (no hallucination), but the plan shape is wrong. See
  backlog item 2.
- `ab-tool8-ambiguous-depends-b`: the resolver **silently picks one reading** — bare "b" resolves to
  `app/lib/b.mjs` at match tier 3 and `tmct_impact` fires, with `app/unit-tests/b.test.mjs` never
  surfaced. No candidateResults, no refusal. Backlog item 1, the worst finding on the board.
- `ab-tool8-refuse-clean-dead-code`, `ab-tool8-refuse-compare-handlers`: clean refusals — the
  refuse-with-a-nudge half of TOOL-8 already holds.

## The metric pair, per rung — resolver floor (Stage 1), 66 cases

Driver `resolver-0.8.0` only — no goal reasoner.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| TOOL-0 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-1 | 14 | 14 | **100%** | **100%** | **0%** | PASS |
| TOOL-2 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-4 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-5 | 9 | 9 | **100%** | **100%** | **0%** | PASS |
| TOOL-6 | 11 | 4 | 36% | 36% | 0% | ---- |
| TOOL-7 | 3 | 0 | 0% | 0% | 0% | skipped (gated by TOOL-6) |
| TOOL-8 | 3 | 2 | 67% | 67% | 0% | skipped (gated by TOOL-6) |
| **all** | **66** | **55** | **83%** | **83%** | **0%** | gated at TOOL-6 |

Gates at TOOL-6, as it gated at C2 in 2.5.0 and 2.0.3. **The 27% → 36% move is the `floorExpect`
reclassification and nothing else**: the four TOOL-6 passes are the three refuse-shaped cases plus
`ab-c2-what-to-test`, whose refusal this arm now grades as declared-correct
(`floorExpectApplied: true` on the row). The seven remaining misses are the same composed proofs
the floor has no planner to build — the coverage-gap and cochange goal-rules and the keystone
expansion. The floor doing its job, not reds.

## The metric pair, per rung — stub floor, 66 cases

Driver `stub-floor` — `agentbench/run.mjs`'s default, a keyword matcher.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| TOOL-0 | 7 | 6 | 86% | 86% | **0%** | PASS |
| TOOL-1 | 14 | 11 | 79% | 79% | **0%** | PASS |
| TOOL-2 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 0 | 0% | 0% | **0%** | ---- |
| TOOL-4 | 7 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-5 | 9 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-6 | 11 | 3 | 27% | 27% | **0%** | skipped (gated by TOOL-3) |
| TOOL-7 | 3 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-8 | 3 | 2 | 67% | 67% | **0%** | skipped (gated by TOOL-3) |
| **all** | **66** | **28** | **42%** | **42%** | **0%** | gated at TOOL-3 |

Same gate as 2.5.0 (B1 = TOOL-3 under the alias map), same low-rung miss set (`ab-a0-cmd-arch`,
the two `tmct_calls` phrasings, `explain Widget`). Both new symbol-grain impact cases and both new
refusal cases pass — the keyword matcher finds "impact" + an entity, and refuses the synonym asks
as unrecognized intent.

## The metric pair, per rung — shim transport, 66 cases

Driver `shim-transport` — the `server-http.mjs` selectTool routing, reused in-process. First time
on record for this arm (neither 2.0.3 nor 2.5.0 ran it), so no delta is claimed; it is here so all
four arms sit on one page.

| rung | n | pass | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | --: | ---- |
| TOOL-0 | 7 | 5 | 71% | 71% | **0%** | PASS |
| TOOL-1 | 14 | 7 | 50% | 50% | **0%** | PASS |
| TOOL-2 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 0 | 0% | 0% | **0%** | ---- |
| TOOL-4 | 7 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-5 | 9 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-6 | 11 | 3 | 27% | 27% | **0%** | skipped (gated by TOOL-3) |
| TOOL-7 | 3 | 0 | 0% | 0% | **0%** | skipped (gated by TOOL-3) |
| TOOL-8 | 3 | 2 | 67% | 67% | **0%** | skipped (gated by TOOL-3) |
| **all** | **66** | **23** | **35%** | **35%** | **0%** | gated at TOOL-3 |

The shim clears only the command register plus refusals, by design — it is the transport floor, not
a routing brain. One margin note: TOOL-1 sits at exactly the 50% completion floor (7/14, the seven
command-register rows). One more NL-only TOOL-1 case would move this arm's gate down to TOOL-1.
That is a case-mix property of the arm, not a defect, but worth knowing when the set grows.

## Per-driver comparison

| | stub floor | shim transport | resolver floor | goal ceiling |
| --- | --: | --: | --: | --: |
| pass | 28/66 | 23/66 | 55/66 | **62/66** |
| plan completion | 42% | 35% | 83% | **94%** |
| result completion | 42% | 35% | 83% | **94%** |
| hallucination | **0%** | **0%** | **0%** | **0%** |
| ladder tops out | TOOL-3 | TOOL-3 | TOOL-6 | **TOOL-7** |

The four arms separate cleanly and each earns its rung. **0% hallucination holds at every rung on
all four drivers — 264 rows**, the property that has never moved and did not move here. Byte-identity
verified on the goal arm (same stamp, scratch out-dir, `cmp` clean).

## What's new this cycle

- **The reformed ladder is measured, not just declared.** `RUNGS` is `TOOL-0…TOOL-8`; the six
  TOOL-7/TOOL-8 cases from the reform get their first four-arm reading. Both rungs behave as the
  reform stated: TOOL-7 at 0% everywhere (no replanning branch exists), TOOL-8 at 67% everywhere
  except the shim's identical 67% — its two refusal cases pass on every arm and its
  candidateResults case fails on every arm that routes at all.
- **The `floorExpect` per-arm seam is live** and `ab-c2-what-to-test` uses it. The resolver-floor
  arm grades a declared refusal; every other arm keeps the shared six-call expectation. The C2/TOOL-6
  floor number now means "refuses correctly" where it used to mean "misses" — called out above so
  the 27% → 36% delta is not read as capability.
- **Four appended cases (62 → 66),** all run-verified before pinning:
  - `ab-a1-impact-fnalpha` (TOOL-1, NL) and `ab-a1-cmd-impact-fnalpha` (TOOL-1, command register,
    proof-carrying): the impact-closure symbol-grain fix, measured. A Function-seeded `tmct_impact`
    now finds the cross-module caller's module (`fnAlpha` → Widget.render's module) instead of
    reporting no dependents. Passes on stub, resolver, and goal; the NL phrasing refuses on the shim
    like every other NL row. Plan-graded only — see backlog item 4 for why the composed set cannot
    be pinned referentially over this fixture.
  - `ab-a2-refuse-synonyms-widget` and `ab-a2-refuse-related-unknown` (TOOL-2): the SKOS grain.
    `tmct_related` shipped as a dispatch tool, but it is **not a registry capability**, so no
    declared toolset can carry it and the honest router behavior on a synonym/related-word ask is a
    refusal. Both cases pass on all four arms. The positive case the round brief asked for is not
    measurable in this harness yet — two gaps, not one: the registry has no `tmct_related` operator
    (the case lint rightly rejects an undeclared tool), and the bench context materializes only the
    code-map fixture, with no memory-store seam to seed the `mgx:synonym` facts the tool reads.
    Named horizon: register the capability (or list it in `EXCLUDED_FROM_REGISTRY` with its
    precondition work), add a memory fixture seam to `createRunCtx`, then author the positive rung
    case.
- **The depth-2 impact label change is measured as text-only.** Over the fixture,
  `impact app/lib/a.mjs` renders depth-2 dependents as "reaches it through an intermediary" instead
  of claiming a direct edge. AGENTBENCH grades the structured label sets, which are unchanged, so
  no number moved — confirmed by the byte-identical TOOL-5/TOOL-6 composed results.

## Deliberately-kept honest red

**None on the goal driver within its reach (TOOL-0…TOOL-6).** The TOOL-7 and TOOL-8 misses are not
kept reds either — they are unbuilt capabilities measured at their floor, with build paths named in
the reform plan. The one behavior that deserves the red label is the TOOL-8 silent pick (backlog
item 1): it is not a hallucination (the call is declared, well-formed, and grounded), but it is an
arbitrary choice between two tied readings, which is the exact behavior the rung exists to catch.

## Discipline checklist

- **Zero hallucination held** — 0% at every rung on all four drivers, 264 rows total.
- **Determinism / byte-identity verified** — the goal arm re-run to a scratch dir with the same
  stamp is byte-identical (`cmp` clean).
- **No overfit / leakage** — no router code changed this cycle. The new symbol-grain cases reuse an
  existing case's phrasing shape with the entity swapped, and the router path they exercise
  (resolver imperative frame → `impactClosure`) carries no request-string literals; the codegraph
  fix they measure is entity-level, not phrasing-level.
- **Bench-import direction one-way** — `grep -rn agentbench src/` finds four comments, no imports.
- **Boundary refusals still sharp** — all six TOOL-2 cases pass on all four arms, including the two
  new SKOS-grain refusals.
- **`test:fast` green** — 181 pass, 0 fail. Blast radius: `test/bench/agentbench.test.mjs` 40/40
  after the case append; the generated-artifacts estate guard confirms the regenerated
  `agentbench/envelope.json` (66 cases, rungReached TOOL-6) matches its generator.
- **Case set append-only** — the 62 reform-era cases are byte-unchanged; four cases appended.
- **Pre-existing, not this axis:** the ask-bundle estate guard fails on the current tree (committed
  bundle ≠ built-today) before and after this cycle's changes. Flagged to the coordinator; nothing
  in `agentbench/**` feeds that generator.

## Decision

**Ship as-is.** Every arm gates where the reform said it would, the goal driver holds 100% through
TOOL-6 on a deeper case set, and hallucination stays at zero across 264 rows. The next capability
worth building is the one both new rungs point at: the tied-candidate composer (TOOL-8's silent
pick is the worst live behavior on the board), then the planner's replanning branch (TOOL-7).

## Backlog (worst first; confident-wrong before honest-miss)

1. **Silent arbitrary pick on an ambiguous entity (TOOL-8, confident-wrong family).** On
   `what depends on b`, the resolver binds bare "b" to `app/lib/b.mjs` at match tier 3 and fires
   `tmct_impact`, never surfacing the tied `app/unit-tests/b.test.mjs` reading — on the stub, the
   goal arm, and the resolver alike (the shim refuses only because NL is out of its register). The
   user gets a confident impact answer for a module they may not have meant. Build path: the
   tied-candidate composer the reform names — an ambiguity check at the resolveObject seam that
   returns `candidateResults` (one dispatched read per tied candidate) instead of the tier-3 pick.
2. **The conditional-fallback phrasing plans both branches unconditionally, with a duplicated
   primary (TOOL-7, confident-wrong-adjacent).** `list what fnAlpha calls, and if it calls nothing,
   list what calls it instead` decomposes via the HTN sequence method into
   `tmct_callees → tmct_callees → tmct_callers`: the guard clause is never observed, the fallback
   always fires, and the primary is emitted twice. The answer happens to be right on this fixture
   (callees is empty), which is exactly why the plan shape needs fixing before it meets a case where
   the guard holds. Build path: the planner's observe-and-replan branch; the conditional method
   should own the "instead" clause the way TOOL-4's fold already does.
3. **Recovery is otherwise an honest miss (TOOL-7).** The other two recovery phrasings refuse
   cleanly at the open-world seam. Correct behavior today; the rung stays at its floor until the
   replanning branch ships.
4. **Symbol-seeded impact composes the raw module key over the bench fixture.** From a Function
   seed, the closure's dependent carries the site-derived key `mod:app/lib/b.mjs` instead of the
   module label, because `test/fixtures/entities.fixture.json` ids its modules `mod-a`-style while
   `moduleIdOf` derives `mod:<path>` keys. Two effects: the new TOOL-1 cases cannot pin an
   `expect.result` literal (the key is not a fixture entity label, and the referential lint rightly
   rejects it), and the symbol-seeded walk cannot continue past depth 1 into module-coarse
   dependents in this fixture. Fix at the fixture: align its module ids with the `mod:<path>`
   convention, then pin the result literals.
5. **`tmct_related` sits outside both the registry and its documented-exclusion list.** It is
   dispatched but neither a capability nor an `EXCLUDED_FROM_REGISTRY` entry, so the closed-world
   story for it lives nowhere. Either register it (params: `term`; precondition: memory facts
   present) or add the exclusion line naming the precondition work, then build the bench's positive
   case per the horizon above.
6. **The registry still declares `tmct_impact`'s param as Module-kinded** while the resolver and
   the chat surface now bind a Function seed (tier-1 resolution, measured green in the new TOOL-1
   cases). Declaration/behavior drift; widen the declared kind or note the coarsening rule on the
   operator.
7. **Coordinator FYI, outside this axis:** the ask-bundle estate guard
   (`test/estate/generated-artifacts.test.mjs`, "the committed ask bundle is what its source builds
   today") fails on the current 2.6.0 tree, before and after this cycle's changes.
