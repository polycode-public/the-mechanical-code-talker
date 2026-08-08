# BENCHMARK_AGENT_5.0.6 — 68/68 on the goal driver, zero wrong answers anywhere, and the member-filter ceiling turns out to be a step budget rather than a missing capability

## Timing

- **Date:** 2026-08-02.
- **Benchmarking session (four driver ladders, the frontier probe, the bound probe):** 22:44 → 23:00 CEST.
- **Analysis (this write-up):** 23:00 → 23:22 CEST.

**Headline.** The goal driver passes every rung from TOOL-0 to TOOL-8 at 100% plan-completion,
100% result-completion and 0% hallucination, the same place `BENCHMARK_AGENT_3.0.3.md` left it. No
rung moved and no number regressed. Across all four drivers and all 272 graded rows, the router
never named a tool outside the declared set. The new evidence sits in three places the rung table
does not reach. The member-filter refusal is a plan-length budget standing in front of an answer the
same function already computes, and it fires on 4 of 7 classes in the real-repo fixture already in
the tree. TOOL-9 and TOOL-10 have measurements for the first time. TOOL-7 and TOOL-8 hold up on
held-out cases, with one path that skips the ambiguity check.

## Run

Four ladders over the frozen 68-case set at `test-benchmarks/agentbench/cases.jsonl`:

```
node test-benchmarks/agentbench/run.mjs --driver goal     --ladder --stamp 5.0.6
node test-benchmarks/agentbench/run.mjs --driver resolver --ladder --stamp 5.0.6_001
node test-benchmarks/agentbench/run.mjs --driver stub     --ladder --stamp 5.0.6_002
node test-benchmarks/agentbench/run.mjs --driver shim     --ladder --stamp 5.0.6_003
```

No LLM, no judge, no network. Raw rows land in
`test-benchmarks/agentbench/results/raw/run-5.0.6[_00N]/product.jsonl`, 68 rows each.

The case set did not change this cycle. Rung counts stay at TOOL-0: 8, TOOL-1: 14, TOOL-2: 7,
TOOL-3: 6, TOOL-4: 7, TOOL-5: 9, TOOL-6: 11, TOOL-7: 3, TOOL-8: 3.

**Determinism check.** A second goal-driver run at the same stamp, written to a separate output
directory, produced a byte-identical `product.jsonl` (`shasum` a05c5a22 on both). Passed.

## The metric pair, per rung — goal driver (Stage 5), 68 cases

| rung | n | pass | plan-completion | result-completion | hallucination | gate |
| --- | --: | --: | --: | --: | --: | --- |
| TOOL-0 | 8 | 8 | **100%** | **100%** | **0%** | PASS |
| TOOL-1 | 14 | 14 | **100%** | **100%** | **0%** | PASS |
| TOOL-2 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-3 | 6 | 6 | **100%** | **100%** | **0%** | PASS |
| TOOL-4 | 7 | 7 | **100%** | **100%** | **0%** | PASS |
| TOOL-5 | 9 | 9 | **100%** | **100%** | **0%** | PASS |
| TOOL-6 | 11 | 11 | **100%** | **100%** | **0%** | PASS |
| TOOL-7 | 3 | 3 | **100%** | **100%** | **0%** | PASS |
| TOOL-8 | 3 | 3 | **100%** | **100%** | **0%** | PASS |
| **all** | **68** | **68** | **100%** | **100%** | **0%** | **PASS** |

Ladder: TOOL-0 → TOOL-1 → TOOL-2 → TOOL-3 → TOOL-4 → TOOL-5 → TOOL-6 → TOOL-7 → TOOL-8, unbroken.
**Rung reached: TOOL-8**, which is where the graded case set ends.

The driver stamp shows which layer answered. 61 rows resolved at C1 (`resolver-0.8.0`) and 7 rows
escalated to the C2 goal reasoner (`goal-0.8.1`).

## The metric pair, per rung — resolver baseline (Stage 1+3), 68 cases

| rung | n | pass | plan-completion | result-completion | hallucination | gate |
| --- | --: | --: | --: | --: | --: | --- |
| TOOL-0 | 8 | 8 | 100% | 100% | 0% | PASS |
| TOOL-1 | 14 | 14 | 100% | 100% | 0% | PASS |
| TOOL-2 | 7 | 7 | 100% | 100% | 0% | PASS |
| TOOL-3 | 6 | 6 | 100% | 100% | 0% | PASS |
| TOOL-4 | 7 | 7 | 100% | 100% | 0% | PASS |
| TOOL-5 | 9 | 9 | 100% | 100% | 0% | PASS |
| TOOL-6 | 11 | 4 | **36%** | 36% | 0% | gated |
| TOOL-7 | 3 | 3 | 100% | 100% | 0% | skipped |
| TOOL-8 | 3 | 3 | 100% | 100% | 0% | skipped |
| **all** | **68** | **61** | **90%** | **90%** | **0%** | — |

Gated at TOOL-6, completion 36% below the 50% floor. TOOL-7 and TOOL-8 are reported
skipped-with-a-receipt even though their raw numbers read 100%, exactly as the gate rule requires.
This is the documented shape: goal deduction is the C2 layer, so the C1 resolver alone cannot
deduce a goal from a phrasing that carries no filter syntax.

## The metric pair, per rung — shim transport floor, 68 cases

| rung | n | pass | plan-completion | result-completion | hallucination | gate |
| --- | --: | --: | --: | --: | --: | --- |
| TOOL-0 | 8 | 5 | 63% | 63% | 0% | PASS |
| TOOL-1 | 14 | 7 | 50% | 43% | 0% | PASS |
| TOOL-2 | 7 | 7 | 100% | 100% | 0% | PASS |
| TOOL-3 | 6 | 0 | **0%** | 0% | 0% | gated |
| TOOL-4 | 7 | 0 | 0% | 0% | 0% | skipped |
| TOOL-5 | 9 | 0 | 0% | 0% | 0% | skipped |
| TOOL-6 | 11 | 3 | 27% | 27% | 0% | skipped |
| TOOL-7 | 3 | 0 | 0% | 0% | 0% | skipped |
| TOOL-8 | 3 | 2 | 67% | 67% | 0% | skipped |
| **all** | **68** | **24** | **35%** | **34%** | **0%** | — |

## The metric pair, per rung — stub driver floor, 68 cases

| rung | n | pass | plan-completion | result-completion | hallucination | gate |
| --- | --: | --: | --: | --: | --: | --- |
| TOOL-0 | 8 | 7 | 88% | 88% | 0% | PASS |
| TOOL-1 | 14 | 11 | 79% | 64% | 0% | PASS |
| TOOL-2 | 7 | 7 | 100% | 100% | 0% | PASS |
| TOOL-3 | 6 | 0 | **0%** | 0% | 0% | gated |
| TOOL-4 | 7 | 0 | 0% | 0% | 0% | skipped |
| TOOL-5 | 9 | 0 | 0% | 0% | 0% | skipped |
| TOOL-6 | 11 | 3 | 27% | 27% | 0% | skipped |
| TOOL-7 | 3 | 0 | 0% | 0% | 0% | skipped |
| TOOL-8 | 3 | 2 | 67% | 67% | 0% | skipped |
| **all** | **68** | **30** | **44%** | **41%** | **0%** | — |

## Per-driver comparison

| driver | rung reached | gated at | pass | plan-completion | hallucination |
| --- | --- | --- | --: | --: | --: |
| goal (Stage 5) | **TOOL-8** | none | 68/68 | 100% | 0% |
| resolver (Stage 1+3) | TOOL-5 | TOOL-6 | 61/68 | 90% | 0% |
| stub floor | TOOL-2 | TOOL-3 | 30/68 | 44% | 0% |
| shim transport floor | TOOL-2 | TOOL-3 | 24/68 | 35% | 0% |

The two floors gate at the same rung for the same reason. Neither composes a multi-step plan, so
TOOL-3 sequential composition is where each one stops. The 7-row gap between the resolver and the
goal driver is exactly the C2 goal-deduction layer.

## Honest misses versus wrong answers

These are different things for this product, so they are counted apart. A row counts as an **honest
miss** when the driver produced no call at all. It counts as a **wrong answer** when it produced
calls that do not match what the case expects. It counts as a **hallucination** when any produced
call names a tool outside the declared set or the registry.

| driver | rows | pass | honest misses | wrong answers | hallucinations |
| --- | --: | --: | --: | --: | --: |
| goal | 68 | 68 | **0** | **0** | **0** |
| resolver | 68 | 61 | **7** | **0** | **0** |
| shim | 68 | 24 | **44** | **0** | **0** |
| stub | 68 | 30 | **21** | **17** | **0** |
| **total** | **272** | **183** | **72** | **17** | **0** |

**Zero hallucinated calls across all 272 rows.** Every produced call in every run named a declared,
registered tool with a bindable argument. The closed-world default-deny in
`src/domain/router/call-validator.mjs` held at every driver tier, including the two floors that get
most other things wrong.

**The goal driver has no misses and no wrong answers.** It answered all 68.

**The resolver's 7 failures are all honest misses.** Every one produced `«none»`. They are the seven
TOOL-6 cases that need goal deduction: `ab-c2-safe-to-change`, `ab-c2-goal-touch-f`,
`ab-c2-goal-worry-c`, `ab-c2-goal-keystone`, `ab-c2-cochange-ship-a`, `ab-c2-cochange-precheck-a`,
`ab-c2-cochange-regress-a`. The C1 layer declines them and the C2 layer answers them. That is the
escalation seam working.

**The shim's 44 failures are all honest misses.** Every failing shim row produced no call. The
transport layer declines what it cannot route rather than guessing at it.

**Only the stub driver produces wrong answers, and all 17 are partial plans.** The stub is a
keyword matcher included as a floor. Each of its 17 wrong answers emitted one call where the case
expects two or more, for example `ab-c1-untested-in-impact-e` producing `tmct_untested({})` where
the case expects `tmct_impact({module:"app/lib/e.mjs"}) → tmct_untested({})`. None named an
undeclared tool. Even the deliberately dumb floor cannot get past the call validator.

The reading in one line: **nothing the real router answered this cycle was wrong, and every gap
below the goal driver is a decline.**

## The member-filter ceiling is a step budget, and the fold already clears it

**Since corrected.** `drive.mjs` was changed after this run to do what the recommendation below
names as its second option: cap the emitted per-member hops but keep folding over every member
regardless. The router no longer refuses any of the cases measured in this section — all seven
classes below now answer, the four over-budget ones with a single `graph-fold` proof step in
place of the hop chain. `frontier-probe.mjs` section 3 carries the current numbers; the quoted
code, the "REFUSES" column and the table below are what 5.0.6 measured before that change landed.

This is the cycle's new evidence and it changes what the cheapest next build is.

`src/domain/router/drive.mjs:91` refuses a member-filter request when the plan would need more
steps than the planner's budget allows:

```js
if (1 + members.length > MAX_STEPS) {
  return refuse(`member-filter needs ${1 + members.length} steps (> budget ${MAX_STEPS}) — escalate`, ROUTER_DRIVER);
}
```

`MAX_STEPS` is 8, declared at `src/domain/router/planner.mjs:11`. So a class with 8 or more callable
members declines the whole request.

The answer does not depend on that plan length. Twelve lines further down,
`src/domain/router/drive.mjs:103` computes the composed result with one call:

```js
const composed = membersReaching(ctx.graph, classInd, target.label);
```

`membersReaching` is declared at `src/domain/router/results.mjs:105`. It runs a bounded transitive
closure over the graph's `callsSymbol` edge index. It never reads `members`, never reads the
per-member `tmct_callees` results, and never consults the loop at `drive.mjs:94-101`. Those hops
exist only to fill the emitted `calls` array and the proof chain. The fold is a single graph pass
at any member count.

The benchmark fixture hides this. Its largest class, `Widget`, has one callable member, so the
check sees 2 against a budget of 8 and never fires. The real-repo fixture already committed at
`test/fixtures/large-scale/.tmct/graph.json` (js-commander, 298 individuals) tells a different
story:

```
Command:      99 callable members => a 100-step plan vs budget 8 => REFUSES
Help:         41 callable members => a  42-step plan vs budget 8 => REFUSES
Option:       16 callable members => a  17-step plan vs budget 8 => REFUSES
Argument:      8 callable members => a   9-step plan vs budget 8 => REFUSES
DualOptions:   2 callable members => a   3-step plan vs budget 8 => answers
CommanderError: 1 callable member => a   2-step plan vs budget 8 => answers
InvalidArgumentError: 1 callable member => a 2-step plan vs budget 8 => answers
```

4 of 7 classes decline. And the fold computes the correct answer for them right now:

```
membersReaching(Command, "createCommand") => 23 members: Command._callParseArg, Command._conflictingOption, …
membersReaching(Help,    "createOption")  =>  6 members: Help.formatHelp, Help.longestOptionTermLength, …
membersReaching(Option,  "camelcase")     =>  1 member:  Option.attributeName
```

So "which methods of Command end up calling createCommand" refuses on a real parsed repo while the
function that answers it sits in the same file and returns 23 correct members. That is a bound, and
it is the same shape the inference cycle found at `findIsaChain`.

Reproduce with `node test-benchmarks/agentbench/frontier-probe.mjs`, section 3.

**Two other bounds worth recording, neither of them the same shape.**
`MAX_TICKS = 16` at `src/domain/router/goal-reasoner.mjs:27` caps the meta-loop. Global keystone
mode spends one tick on `untested` plus one per violating module, so a repo with 16 or more
untested modules declines. The fixture has 5. `src/domain/router/planner.mjs:153`
(`steps >= MAX_STEPS`) cannot fire, because line 141 already caps `segments.length` at 8 and `steps`
maxes at 7.

## Past the graded ladder: TOOL-9 and TOOL-10 now have numbers

`grade.mjs`'s `RUNGS` stops at TOOL-8 (`test-benchmarks/agentbench/grade.mjs:42`), and neither
TOOL-9 nor TOOL-10 carries a case or an expect-shape. So this cycle measured them by driving the
goal driver over 12 requests shaped like those two rungs and reading what came back. The instrument
is `test-benchmarks/agentbench/frontier-probe.mjs`, section 1. These numbers are observations, not
graded rows, and no rung claim rests on them.

**TOOL-10 (open-world relevance): 4 refusals, 2 silent narrowings, 0 fabrications.**

The four refusals are clean. Ownership, production speed, a ship date and a security vulnerability
all land on the miss wall with no call emitted. The refusal reason names the goal-rule seam rather
than the missing facts, for example "no declared goal-rule is applicable in scoped mode". A reader
learns the router declined; they do not learn that ownership is a thing the graph never recorded.

The two that answered are the finding. "is app/lib/a.mjs safe to change given the flaky tests"
composed the coverage-gap footprint and dropped "given the flaky tests" without a word. "what will
it cost to test everything app/lib/a.mjs touches" returned the same untested set, with no mention
that effort and cost are undeclared. Both answers are true of the graph. Both answer a narrower
question than the one asked, and neither says so.

The distinction that matters: the honest miss holds at the fact level and does not yet hold at the
request level. The router never states a fact it cannot ground. It will silently drop the part of a
request it cannot ground.

**TOOL-9 (goal recognition): 2 refusals, 4 re-executions, 0 fabrications.**

Two probes refused honestly, including the reject-class probe ("I described Widget and then listed
its subclasses"), which is the correct answer for a trace no declared goal covers.

The other four did something more specific than a miss. They re-ran the narrated trace instead of
naming the goal behind it. "I ran the impact of app/lib/a.mjs and then listed the untested modules.
what am I trying to do" dispatched `tmct_impact` then `tmct_untested` and returned the data again.

The driver stamp locates the cause exactly. All four mishandled probes are stamped
`resolver-0.8.0`, so C1 claimed them and the goal reasoner never saw them. The reason is in
`src/domain/router/resolver.mjs:93-128`. The `FRAMES` table matches on topic words with no tense or
speech-act test, so `/\bimpacts?\b/` fires on "I ran the impact of" and `/\buntested\b/` fires on
"listed the untested modules". A past-tense narration binds as an imperative.

Every one of those calls was grounded and every composed result is true of the graph. What is
missing is a way to tell a report of an action from an instruction to perform one.

## TOOL-7 and TOOL-8 hold up on held-out cases, with one path that skips the check

TOOL-7 and TOOL-8 carry 3 cases each, the thinnest pools on the ladder, and the gate passes a rung
at 50%. So this cycle checked whether those two capabilities are wider than their cases.
Ten held-out probes, `frontier-probe.mjs` section 2.

**TOOL-7 recovery generalizes.** Three held-out phrasings over three held-out tool pairs all
recovered correctly and signalled `recovered: true`: members → describe on `Base`, subclasses →
members on `Button`, exports → impact on `app/lib/c.mjs`. The proof trace reads
`[guard] observed tmct_members => empty — recovering with the fallback`.

Two negative controls confirm the branch is not reckless. When the primary returns something, the
fallback stays unfired, and the trace says so: `observed tmct_tests_for => non-empty — the primary
already answers this; no fallback dispatched`.

**TOOL-8 tied candidates generalize over tools.** Three held-out tools over the fixture's one tied
stem all refused and enumerated both readings: `tmct_tests_for`, `tmct_exports` and
`tmct_cochanges` each produced the `app/lib/b.mjs` / `app/unit-tests/b.test.mjs` pair. The
committed case only exercises `tmct_impact`, so the composer is not tied to one tool.

**One held-out probe found a hole.** `describe b` dispatched `tmct_describe({symbol:"b"})` and
returned `app/lib/b.mjs`, picking one of two tied readings with no candidate enumeration. The same
ambiguous stem refuses through the other paths. The cause is the pick order at
`src/domain/router/resolver.mjs:363-391`: the command register runs first and a command pick already
carries a bound input, so the `if (!pick.input && !pick.noArg)` guard at line 391 skips binding and
skips the tie check with it. The NL and frame paths both go through that guard, so they catch the
tie.

This is not a hallucination. `tmct_describe` is declared and registered, and the entity exists. It
is one path answering a tied term where the other paths decline it.

**The fixture bounds how far this can be tested.** The graph holds exactly one ambiguous stem, `b`.
A wider ambiguity check needs more tied labels in the fixture.

## What the next rung needs, concretely

**Recommended next build: raise the member-filter bound.** Shipped since this run (see the update
note above). It is the cheapest of the three, the
capability behind it already works, and it is the only one that changes answers on a real repo
today.

A build track can work from this without re-deriving anything:

1. **Decide what the budget is protecting.** `MAX_STEPS` bounds a *plan*. `drive.mjs:91` applies it
   to a *member count*. The per-member `tmct_callees` hops at `drive.mjs:94-101` feed the emitted
   `calls` array and the proof chain only. `membersReaching` at `drive.mjs:103` computes the answer
   from the graph either way. So the options are to raise the bound, to cap the emitted hops while
   still folding over every member, or to drop the hops and prove the fold from the graph directly.
2. **Check the proof chain at length.** Each hop pushes a `causal-link` step. At 99 members the
   proof is 100 entries. Read one before shipping, because the proof is a product surface.
3. **Watch for a pinned expectation.** `cases.jsonl` has no member-filter case above 2 members, so
   nothing in the graded set pins the current bound as the expected answer. A new case added for
   this must be fixture-linted against a real run rather than hand-authored.
4. **`MAX_TICKS` is the sibling.** `goal-reasoner.mjs:27` caps the global keystone lane at 16 ticks,
   which is one per violating module. A repo with 16 or more untested modules declines the same
   way. Worth deciding in the same pass.

**Next capability after that: TOOL-10's relevance boundary.** The measurement says the work splits
in two, and the first half is small.

- **Name the missing world in the refusal.** The four TOOL-10 refusals already fire. Their reason
  text names the goal-rule seam. Changing it to name what the graph does not hold turns a decline
  into a useful one. This is refusal-text work in `goal-reasoner.mjs`, no new reasoning.
- **Stop the silent narrowing.** The two probes that answered dropped an ungroundable qualifier
  without saying so. Something has to notice that part of a request went unconsumed and report it.
  That is the `expect.relevanceBound` shape the skill sketches: the plan lists the facts it needs
  and could not ground. It needs a representation of what a request asked for, which the router
  does not build today.
- **The harness needs an expect-shape first.** `grade.mjs:42`'s `RUNGS` has no TOOL-10, and
  `parseCases` at `grade.mjs:62` rejects an unknown rung. Cases cannot be added before the rung and
  its grader exist.

**TOOL-9 needs a request-type test, and its target set already exists.** The bounded (N+1) scheme
TOOL-9 grades against is declared data today: `GOAL_RULES` at
`src/domain/router/goal-reasoner.mjs:37` holds `coverage-invariant` (scoped and global) and
`cochange-risk-invariant` (scoped), and `applicableRules()` at `goal-reasoner.mjs:86` is already the
confirm step. What is missing is the inverse direction, from an observed trace to a rule, plus a
way to tell a narrated trace from an imperative. The precedent for the second part is in the file
already: `resolver.mjs:96` carries `skipIfSuperlative`, and `resolver.mjs:223` skips that frame when
`SUPERLATIVE_RE` matches, because a ranking request belongs to C2. A narration cue would sit at the
same seam.

**The one thing worth fixing regardless of rung: the command-register tie check.** `describe b`
answers a tied term that every other path declines. The guard at `resolver.mjs:391` is the place.

## What's new this cycle

- **`test-benchmarks/agentbench/frontier-probe.mjs`**, the measurement instrument behind the TOOL-9,
  TOOL-10, held-out and bound sections. Nothing imports it and it is in no test tier. Run it by hand.
- **No change to `cases.jsonl`, `grade.mjs`, or anything under `src/`.** This was a measure-and-report
  pass. Several tracks are working the tree and an engine change from a benchmark cycle would collide
  with them, so the next-rung work stops at the brief above.

## Two things a future cycle should tidy

Neither affects a number. Both are edits to existing cases, which the append-only rule keeps out of
this cycle.

- **The TOOL-7 and TOOL-8 case notes describe a ceiling that has since been built.**
  `ab-tool7-callers-recover-button`, `ab-tool7-tests-recover-impact-c`,
  `ab-tool7-callees-recover-callers-fnalpha` and `ab-tool8-ambiguous-depends-b` all carry a note
  saying the current goal driver "never signals recovered" or "refuses (or picks) without emitting
  candidateResults". All four pass now. The expectations were authored at the true answer and the
  capability arrived, which is the right way round. The prose is what went stale.
- **`ab-c2-what-to-test`'s note cites `TOO_HARD_AUDIT.md`, which is not in the tree.** That is the
  stale doc reference `CLAUDE.md`'s comment-hygiene rule warns about, sitting in a case note.

## Discipline checklist

- **Zero hallucination held.** 0 out-of-set or unregistered calls across all 272 graded rows and all
  22 probe requests.
- **Byte-identity verified.** Two goal-driver runs at stamp 5.0.6 produced identical
  `product.jsonl` (`shasum` a05c5a22d5c91c6e4b394d7d7a0ed12cf7b5f718).
- **Gate rule applied in order.** Every driver's first sub-floor rung gates everything above it, and
  the skipped rungs are reported with a receipt even where their raw numbers read 100% (the
  resolver's TOOL-7 and TOOL-8).
- **Refusals counted as passes where the case expects one**, and separated from wrong answers in the
  table above.
- **No overfit or leakage.** The held-out probes in section 2 use phrasings and tool pairs that
  appear in no case. The router answered them from the same rules.
- **Bench-import direction unchanged.** `grep -r 'agentbench' src/` returns four comment lines and
  no import.
- **Case set untouched.** 68 cases, same ids, same rung counts as 3.0.3.
- **Snapshot discipline.** Each driver stamped its own raw directory (`run-5.0.6`, `_001`, `_002`,
  `_003`). Nothing was overwritten.

## Tests

| command | result |
| --- | --- |
| `npm run test:smoke` | 8 pass, 0 fail |
| `npm run test:fast` | 210 pass, 0 fail |
| `node --test test/bench/agentbench.test.mjs` | 40 pass, 0 fail |
| `node --test test/adapters/router-drive.test.mjs` | 8 pass, 0 fail |
| `node --test test/adapters/router-resolver.test.mjs` | 23 pass, 0 fail |
| `node --test test/adapters/goal-reasoner.test.mjs` | 26 pass, 0 fail |

The full suite and the e2e tier are the coordinator's job after merge.

## Decision

**Ship the re-measurement.** The goal driver holds TOOL-8 at 100% on both metrics with zero
hallucination, nothing regressed against 3.0.3, and the two capabilities on the thinnest pools hold
up on held-out cases.

**Recommended next build, in order:** the member-filter step budget (a bound with a working fold
behind it, biting on a real repo fixture — shipped since this run, see the update note above),
then the command-register tie check (a one-guard fix), then TOOL-10's refusal text (useful on its
own before any new rung machinery). TOOL-9 and TOOL-10 as graded rungs need `RUNGS` and their
expect-shapes in `grade.mjs` before cases can exist.
