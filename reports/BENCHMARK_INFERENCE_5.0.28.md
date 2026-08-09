# BENCHMARK_INFERENCE_5.0.28 — B1's automatic /prove fallback flips 12 of INF-8's ceiling rows to real yeses

## Timing

- **Date:** 2026-08-09.
- **Targeted before/after measurement (40 INF-7/INF-8 cases):** ~5 minutes.
- **Full regeneration (`generate-cases.mjs`, `run.mjs --replay`, `generate-envelope.mjs`):** ~35 minutes.

**Headline.** PLAN_DL_ENGLISH_SURFACE.md's B1 (the automatic `/prove` fallback on a missed isa
question) and B2 (naming a by-cases answer's own cases) lift two of INF-8's five ceiling markers
for real: `dlDisjunction` and `dlComplement` (12 rows) now answer `yes` through the plain chat
surface, gated on a genuine DL shape, citing the union/complement premise they reasoned over, with
zero fabrication. `dlCardinalityClash` (8 rows) and `dlNominalEnumeration` (6 rows) do not flip —
driven live, both still measure `unproven`, for two different, now-documented structural reasons.
INF-7 (14 rows) does not flip either — its own gap, EL saturation for the "does X have Y" lane, is
untouched by B1 — but its ceiling TEXT was stale in a different way, corrected in the same pass
along with two other stale note strings the plan named. Every band on both arms still passes the
gate; determinism holds (`--replay`, byte-identical across 2 runs).

## Run

`node test-benchmarks/infbench/generate-cases.mjs` (default seed) after editing the five affected
templates in `generate-cases.mjs`, then `node test-benchmarks/infbench/run.mjs --replay --stamp
5.0.28`, then `node test-benchmarks/infbench/generate-envelope.mjs`. 413 cases, two drive points:
the pure kernel prover (`src/domain/syllogise.mjs`) and the chat surface through the real turn
engine (`runChat()`). No LLM, no judge, no network.

`--replay`: **byte-identical across 2 runs — PASSED.**

Before editing the generator, every INF-7/INF-8 case (40 of the 413) was driven through the real
chat arm against the *committed* `cases.jsonl` first — PLAN_DL_ENGLISH_SURFACE.md section 10's own
"measure, then edit" discipline — using `run.mjs --only <the 40 ids>`. That run is what the
"before" table below reports; the edit to `generate-cases.mjs` came only after seeing it.

Regenerating `cases.jsonl` from the edited generator touches exactly 26 of the 413 rows — the 8
`elConstructedRestriction` + 6 `elExistentialChain` rows (note only) and the 6 `dlDisjunction` + 6
`dlComplement` rows (`expect`/`ceiling`/`note`) — confirmed by diffing against the pre-edit file.
The other ~387 rows, including `dlCardinalityClash`'s 8 and `dlNominalEnumeration`'s 6, are
byte-identical: the shared rng stream held.

Raw output: `test-benchmarks/infbench/results/raw/run-5.0.28/product.jsonl` (gitignored;
`test-benchmarks/infbench/results/.gitignore`), 513 rows (413 chat + 100 kernel) from the
`--replay` pair's first pass — the second pass matched it byte-for-byte and isn't separately
retained. This report carries the numbers.

## Before: the 40 INF-7/INF-8 cases against the committed (pre-edit) cases.jsonl

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-7 | 14 | 14 | 100% | 0% | PASS |
| INF-8 | 26 | 6 | 23% | 46% | ---- |
| all | 40 | 20 | 50% | 30% | gated at INF-8, fabrication 46% |

`dlDisjunction`'s 6 rows and `dlComplement`'s 6 rows all answered a confident `yes` against a
pinned `unproven` — the FABRIC rows the gate exists to catch. Not a wrong answer in the classical
sense (the engine's `yes` is correct), but a stale pin: the generator still expected the
honest-miss floor that shipped before B1 landed.

## After: the full 413-case run against the regenerated cases.jsonl

### Kernel arm (100 rows)

| band | n | pass | completion | fabrication | gate | ceiling/pass |
| --- | --: | --: | --: | --: | --- | --: |
| INF-1 | 10 | 10 | 100% | 0% | PASS | 0/10 |
| INF-2 | 30 | 30 | 100% | 0% | PASS | 0/30 |
| INF-3 | 10 | 10 | 100% | 0% | PASS | 0/10 |
| INF-4 | 10 | 10 | 100% | 0% | PASS | 0/10 |
| INF-5 | 40 | 40 | 100% | 0% | PASS | 0/40 |
| **all** | **100** | **100** | **100%** | **0%** | **PASS** | **0/100** |

Ladder: INF-1 → INF-2 → INF-3 → INF-4 → INF-5, unbroken.

### Chat arm (413 rows)

| band | n | pass | completion | fabrication | gate | ceiling/pass |
| --- | --: | --: | --: | --: | --- | --: |
| INF-1 | 40 | 40 | 100% | 0% | PASS | 0/40 |
| INF-2 | 72 | 72 | 100% | 0% | PASS | 0/72 |
| INF-3 | 103 | 103 | 100% | 0% | PASS | 0/103 |
| INF-4 | 70 | 60 | 86% | 0% | PASS | 30/60 |
| INF-5 | 40 | 40 | 100% | 0% | PASS | 0/40 |
| INF-6 | 40 | 40 | 100% | 0% | PASS | 0/40 |
| INF-7 | 14 | 14 | 100% | 0% | PASS | 14/14 |
| INF-8 | 34 | 26 | 76% | 0% | PASS | 6/26 |
| **all** | **413** | **395** | **96%** | **0%** | **PASS** | **50/395** |

Ladder: INF-1 → … → INF-8, unbroken — **every band passes the gate.** Zero fabrication across all
513 driven rows (413 chat + 100 kernel), confirmed byte-identical on the `--replay` pair's second
pass.

## What flipped, and why

**`dlDisjunction` (6 rows) and `dlComplement` (6 rows): `unproven` → `yes`, `ceiling` field
dropped.** Both templates' premises use ACE patterns 9 (`owl:unionOf`) and 11 (`owl:complementOf`),
both shipped before this plan started — the gap was never the grammar. What B1
(`autoProveFallback`, `src/services/chat.mjs`) closes is the ROUTE: a plain `is X a Y` question
never reached the tableau at all before this. The individual in both templates is directly typed
(`"${ind} is a ${n1}"` / `"${ind} is not a ${n1}"`), so it routes through `proveEntailment`, module
extraction finds the genuine union/complement shape (`moduleHasDlShape`, `src/domain/tableau.mjs`),
and the bounded tableau proof closes. B2 lets the rendered `dlDisjunction` answer name the case it
split on: `"in every case — a scribe or a valve — e130.mjs is a valve."`

## What did not flip, and why — measured, not assumed

**`dlCardinalityClash` (8 rows) stays `unproven`.** The template's own query is `is ${ind} a
${n1}` — the SAME class the individual was just directly asserted into (`"${ind} is a ${n1}"` is
one of the three premises). Chat answers a directly-asserted membership fact through its own
direct-fact lookup, which runs and returns BEFORE the isa ladder's own miss cascade — the one
place B1's `autoProveFallback` (and its ex-falso guard) is wired in. The query never becomes a
miss, so the guard never gets a turn, and the min/max cardinality clash goes unreported for this
specific query shape. This is not a regression: B1's own ex-falso guard is confirmed working live
(`test/adapters/chat-auto-prove-fallback.test.mjs`, the shipped
`inference.dl.auto-fallback-inconsistent` corpus row) for a query that DOES reach the miss cascade
— asking about a class other than the one directly asserted (e.g. "is beryl a wheel" after "beryl
is a bicycle" plus the clashing cardinality restrictions). Reaching this template's own query shape
needs the direct-fact lookup itself to consult consistency before answering — a change to an
earlier, different code path than this plan owns.

**`dlNominalEnumeration` (6 rows) stays `unproven`.** The queried `outsider` individual is never
type-declared anywhere in the premises — only the three enumeration members are, through pattern
13's `owl:oneOf`. With no `rdf:type` row of its own, `kb.namedIndividuals.has(outsider)` is false,
so B1 routes the question through `proveSubsumption`/`proveSubsumptionOfNegation` (class-level)
rather than `proveEntailment` (individual-level). An entirely unconstrained fresh individual has
nothing forcing it toward or away from the closed enumeration's three nominals, so both the
positive and negative subsumption checks find a satisfying model — a genuine counter-model, which
B1's own constitution renders as the unchanged honest miss, never a guess. This is correct
behaviour, not a gap in B1: the classical entailment here needs UNA-lite's nominal-merge machinery
reasoning about a NAMED individual, and this template's own individual is never named as one.

**INF-7 (14 rows) stays `unproven` — a stale ceiling TEXT, not a stale ceiling.** The committed
note blamed "ACE has no bare-existential teach frame" for the miss. Pattern 15 shipped that frame
before this plan started, and both `elConstructedRestriction`/`elExistentialChain` premises store
fine today. The actual gap is downstream: the "does a N1 have a N3" query (`DOES_HAVE_ASK_RE`)
reads a restriction's own direct filler, never composes two hops through an undeclared intermediate
class expression, and B1 doesn't reach this lane at all — it only fires from the isa ladder's own
miss. The ceiling marker (`EL_CEILING`, EL saturation) is still the honest, accurate one; only the
note's reasoning was out of date, corrected in the same commit as the flip above, along with
`dlDisjunction`'s "ACE declines 'or'" claim (pattern 9 fixed it) and `dlComplement`'s "complementOf
does not exist in the graph vocabulary" claim (pattern 11 fixed it) — the three stale note strings
the plan named.

## A finding outside this plan's scope: INF-4's b2PropertyInheritance

The full run surfaced 10 non-passing rows outside INF-7/INF-8: `b2PropertyInheritance`'s `member`
and `grandparent` variants (5 rows each, `expect.verdict: "yes"`, no `ceiling` field — a live,
already-shipped capability by the generator's own design). Example:
`"every argyle has a receptacle"`, `"e150.mjs is a argyle"`; query `"does e150.mjs have a
receptacle"` — the query is declined outright (`"I couldn't ground that in anything I know"` via
`runTurn`, a differently-worded honest miss via the CLI's own `runChat`), never reaching a verdict.
This is the `does X have Y` lane (`DOES_HAVE_ASK_RE`/`restrictionExistentialHit`), not the isa
ladder — a completely different code path from everything B1/B2 touch, so it is not a regression
this plan introduced. It is also not new: the previously-committed `envelope.json` (stamp 5.0.25)
already showed INF-4 at 55/70 passing chat rows before this cycle's work landed; this run measures
60/70 — five MORE passing than before, not fewer. The remaining 10-row gap is real, measured, and
outside PLAN_DL_ENGLISH_SURFACE.md's scope; it is recorded as its own open item in `NEXT.md` rather
than folded into this plan's own ceiling markers, since fixing it means a different query lane's
own restriction-membership composition, not the isa ladder or the tableau proof this plan builds.

## Discipline checklist

- **Zero fabrication** across every row this cycle: the 40-case targeted before/after pair (only
  `dlDisjunction`/`dlComplement`'s pre-edit rows fabricated, against the STALE pin, never
  against a wrong answer), and the full 413-case `--replay` run — 513 driven rows (413 chat + 100
  kernel), confirmed byte-identical on the second pass.
- **`cases.jsonl` regenerated from the generator**, diffed against the pre-edit committed file —
  exactly the 26 intended rows changed; the rng stream held for every other template.
- **Measured before editing**, per PLAN_DL_ENGLISH_SURFACE.md section 10's own discipline: every
  flip and every non-flip above is backed by a driven `runInfbench` row, not a prediction.
- **Determinism verified** with `--replay`.
- **The three explicitly-named stale note strings corrected**: `elConstructedRestriction`'s and
  `elExistentialChain`'s own "ACE declines the bare existential" claims (pattern 15 fixed this),
  `dlDisjunction`'s "ACE declines 'or'" claim (pattern 9), `dlComplement`'s "complementOf does not
  exist in the graph vocabulary" claim (pattern 11).
- **`envelope.json` regenerated** and committed alongside this report.
- **No overfit.** No file under `src/` was touched to make this run measure better; every engine
  change (B1, B2) was built and tested before this measurement pass began, and this pass only
  edited the generator's own `expect`/`ceiling`/`note` fields to match what the built engine
  actually does.

## Decision

**Ship the flip.** `dlDisjunction` and `dlComplement`'s 12 rows move from a stale-pinned
fabrication to a real, gated pass. `dlCardinalityClash` and `dlNominalEnumeration` keep their
ceiling markers, each for a specific, now-documented reason rather than an assumption — both are
candidate work for a future round, not bugs in this one. INF-7 keeps its ceiling too, with its note
text now describing the actual gap (EL saturation for a two-hop query) instead of a shipped one.
`b2PropertyInheritance`'s 10-row gap is real but outside this plan; it is `NEXT.md`'s, not this
report's, to carry forward.
