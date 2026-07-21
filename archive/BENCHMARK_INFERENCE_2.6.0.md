# BENCHMARK_INFERENCE_2.6.0 — the reformed eight-rung ladder measures, the soundness pin goes live, and this round's inference work is pinned; 379/379 chat, 100/100 kernel, 0 fabrication

## Timing

- **Date:** 2026-07-18 (CEST).
- **Benchmarking session:** 04:52:28 → 04:55:19 — regenerate + run with the replay determinism
  check (first pass, 377/379); then 04:56 → 05:00:21 — the generator's noun-pool fix and the
  clean re-run (`run-2.6.0_001`, 379/379).
- **Analysis:** 09:42 → 10:05 — this write-up. The gap between measurement and analysis is a
  session interruption (an account spend limit), not analysis time.

This is the first INFBENCH report on the reformed ladder: the bands now read INF-1…INF-8, named
by logic fragment (`archive/PLAN_BENCHMARK_LADDERS.md`), with `BAND_ALIASES`-style comparability
to 2.5.0's INF-A1…INF-C2 given by the reform's bijection (A1→1, A2→2, B1→3, B2→4, C1→5, C2→6).
INF-7 (OWL 2 EL) and INF-8 (OWL 2 DL) are the reform's two new rungs, measured here for the
first time.

The honest delta versus `BENCHMARK_INFERENCE_2.5.0.md` is three things:

**First, the 2.5.0 round's worst confident-wrong is fixed and pinned.** The CONVERSATION sweep
found a subclass proof that certified one side of a stored contradiction (`dog ⊑ cat` with
`dog ⊓ cat = ⊥` still proved "rex is a cat"). The reform authored `dlDisjointProofSoundness` at
INF-8 to pin it, expecting it to sit at a ceiling until the proof-path fix landed. The fix
landed this round: the is-a ladder computes the cax-dw gate ahead of the direct-fact verdict and
both proof chases, so the template's first measurement is already **live — 8/8 `inconsistent`**,
each refusal naming both stored facts. The rung was born a ceiling and measures as a capability.

**Second, this round's inference work is now benchmark content.** Six new templates (86 chat
rows, 10 of them also kernel rows) cover the disjointness veto in its class-level forms,
reflexive self-subsumption, the converse direction discriminator, the universal-conditional
teach, class-level property inheritance with its citation of both premises, and the ATMS
retraction pair — survivor re-grounding and the stale-justification fall — driven end to end
through real `/syllogise` and `forget` chat turns. All green, all at pinned literals.

**Third, the ladder got deeper and stayed clean.** The chat arm grew 259 → **379** and the
kernel arm 90 → **100**; every band passes the gate on both arms at 0% fabrication, the ladder
gates nowhere, and kernel and chat agree on the observed verdict for all **100/100** cases that
run on both arms. `--replay` confirms the whole pipeline is byte-identical across two runs.

## Run

`node infbench/generate-cases.mjs` then `node infbench/run.mjs --replay --stamp 2.6.0[_001]`
(the same pair `npm run infbench` chains, plus the replay determinism check), exit 0. 379 cases,
two drive points per case: the pure kernel provers (`src/domain/syllogise.mjs`) and the chat
surface via `runChat()`. No LLM, no judge, no network anywhere in this loop. Raw:
`infbench/results/raw/run-2.6.0/product.jsonl` (first pass) and
`infbench/results/raw/run-2.6.0_001/product.jsonl` (the shipping measurement; the `_001` stamp
follows `SKILL_BENCHMARK_INFERENCE.md`'s snapshot-before-overwrite rule). The console header
prints "version 2.5.4": this worktree measures the 2.6.0 round ahead of the version roll, so the
run is stamped with the round label.

**This cycle applied levers to the generator, twice, and says so.** Unlike 2.5.0's no-op
regeneration, the case set changed: the six new templates append 86 rows,
`dlDisjointProofSoundness` drops its ceiling marker, and the property template's noun pool
gained a load-bearing filter after the first pass exposed a wrong-question draw (see Drift). All
pre-existing rows are byte-stable — the new templates append to the shared rng stream, so
nothing earlier redraws. `test/estate/generated-artifacts.test.mjs` confirms the committed
`infbench/cases.jsonl` is what the generator produces today.

The harness itself took one fix: the determinism scrub folded only `ace:chat:<uuid>@<ts>`
provenance, and the property-inheritance answers cite `teach:chat:<uuid>@<ts>` (the natural
teach frames stamp the same volatile shape). `infbench/run.mjs`'s `VOLATILE_PROVENANCE` now
covers both, and `--replay` passes.

Per-template counts, as printed by the generator — the authoritative count:

| template | n | | template | n |
| --- | --: | --- | --- | --: |
| a1Lookup | 30 | | elConstructedRestriction | 8 |
| a2ChainLen2 | 40 | | elExistentialChain | 6 |
| b1Disjoint | 39 | | dlDisjunction | 6 |
| b1Existential | 40 | | dlComplement | 6 |
| b2ChainLenK | 30 | | dlDisjointProofSoundness | 8 |
| b2Svf1 | 10 | | **a1UniversalConditional** | **10** |
| b2Svf1Apply | 10 | | **a2Reflexive** | **10** |
| c1Cardinality | 30 | | **a2Converse** | **10** |
| c1ScmSvfApply | 10 | | **a2EntailedRetraction** | **12** |
| c2Inconsistent | 20 | | **b1DisjointVeto** | **24** |
| | | | **b2PropertyInheritance** | **20** |

The five EL/DL templates (34 rows) were authored by the ladder reform and measure here for the
first time; the six bold templates (86 rows) are this cycle's additions. The ten carried-over
templates keep 2.5.0's counts exactly.

## The metric pair, per band — kernel arm (100 cases; the pure-prover subset)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-1 | 10 | 10 | **100%** | **0%** | PASS |
| INF-2 | 30 | 30 | **100%** | **0%** | PASS |
| INF-3 | 10 | 10 | **100%** | **0%** | PASS |
| INF-4 | 10 | 10 | **100%** | **0%** | PASS |
| INF-5 | 40 | 40 | **100%** | **0%** | PASS |
| **all** | **100** | **100** | **100%** | **0%** | **PASS** |

Ladder: INF-1 → INF-2 → INF-3 → INF-4 → INF-5 — all bands pass the gate. The INF-2 row grew
20 → 30: the 10 new `a2Converse` cases run on both arms, and the kernel's closure is
directional, so it reads the converse as `unproven` exactly as the pinned literal expects. The
other 90 rows are the same population 2.5.0 measured (under the A→numeral alias).

## The metric pair, per band — chat arm (379 cases; the full `runChat()` surface)

| band | n | pass | completion | fabrication | gate | of which ceiling-graded |
| --- | --: | --: | --: | --: | --- | --: |
| INF-1 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| INF-2 | 72 | 72 | **100%** | **0%** | PASS | 0 |
| INF-3 | 103 | 103 | **100%** | **0%** | PASS | 0 |
| INF-4 | 70 | 70 | **100%** | **0%** | PASS | **35** |
| INF-5 | 40 | 40 | **100%** | **0%** | PASS | 0 |
| INF-6 | 20 | 20 | **100%** | **0%** | PASS | 0 |
| INF-7 | 14 | 14 | **100%** | **0%** | PASS | **14** |
| INF-8 | 20 | 20 | **100%** | **0%** | PASS | **12** |
| **all** | **379** | **379** | **100%** | **0%** | **PASS** | **61** |

Ladder: INF-1 → … → INF-8 — every band passes the gate. Versus 2.5.0 (via the alias): INF-1
30→40 (`a1UniversalConditional`), INF-2 40→72 (`a2Reflexive`, `a2Converse`,
`a2EntailedRetraction`), INF-3 79→103 (`b1DisjointVeto`), INF-4 50→70 (`b2PropertyInheritance`),
INF-5/INF-6 unchanged, INF-7/INF-8 new. Kernel-vs-chat verdict agreement is 100/100 on the
both-arm cases.

## What the new templates catch, and 2.6.0's answers

**The disjointness veto, class-level (`b1DisjointVeto`, 24 at INF-3).** The engine work this
pins: a stored `owl:disjointWith` vetoes every is-a yes, in every form. Asked directly
("no C1 is a C2" → "is a C1 a C2") it answers the provable **no** citing the stored fact; asked
through the symmetric orientation it answers the same no (disjointness has no direction); lifted
through a taught subclass edge ("every C3 is a C1") it composes the no from both stored facts —
`no — you told me: poacher is a kind of skirl; you told me: skirl is not an intoxication`. The
`class-control` cell keeps the veto honest: a disjointness between other terms licenses nothing,
and the engine refuses rather than over-firing the no. 24/24, alongside `b1Disjoint`'s 39
individual-level rows, which carry over green.

**The soundness pin (`dlDisjointProofSoundness`, 8 at INF-8, live).** ind:C1, C1 ⊑ C2, C1 ⊥ C2,
asked "is ind a C2". A would-be chain proof crosses a stored contradiction, and the engine now
refuses: `you've told me both float is a kind of organiser and float is not an organiser —
together those contradict, and I won't derive an answer from an inconsistency`. Graded
`inconsistent` on all 8. This is the cross-benchmark loop closing: a persona-sweep defect became
a pinned case and the fix's first measurement is its witness.

**The ATMS retraction pair (`a2EntailedRetraction`, 12 at INF-2).** Each case teaches two
independent 3-hop routes to the same conclusion, materializes it with a real `/syllogise` turn,
then forgets one route's first edge. Both routes are longer than the live chase walks, so after
the first forget the only yes left is the materialized entailed fact — `survivor-regrounds`
(6/6 yes, answering `i learned: cinnamon is a kind of demoralization (source:
entailed:subClassOf)`) witnesses multi-derivation justifications surviving a retraction on the
survivor's re-grounded environment, with no cascade. `stale-justification-falls` (6/6 unproven)
then forgets the second route too: the entailed fact must fall with its last justification, and
a confident yes here would be the stale-citation symptom the fabrication gate exists to flag.
This is the benchmark-side twin of the corpus row `inference.retract.stale-justification`.

**Property inheritance (`b2PropertyInheritance`, 20 at INF-4).** "every N1 has a N2" (the
quantified-has teach) read straight back (`class-direct`, 5/5 yes), and inherited by a member
through one taught ⊑ hop citing both premises (`member`, 5/5 — `yes — you told me: e150.mjs is
a fuji; you told me: fuji has passage`). The `grandparent` cell pins today's reach: the lookup
lifts exactly one hop, so a 2-hop inheritance is classically sound but expects the honest floor
(5/5 unproven, ceiling-graded, capability named: a deeper property-inheritance lift). The
`control` cell (membership of an unrelated class, 5/5 unproven) keeps the member yes honest.

**Direction, reflexivity, and the conditional coat (`a2Converse`, `a2Reflexive`,
`a1UniversalConditional`, 30 rows).** The converse probe is a real discriminator: "every N1 is a
N2" asked backwards must refuse, and an engine that drops ⊑'s direction answers a yes the gate
flags as fabrication — 10/10 refuse on both arms, the chat side naming the stored direction
(`what I know runs the other way … A kind doesn't reverse`). Reflexive self-subsumption answers
trivially for taught and untaught terms alike (10/10). The universal conditional ("if something
is a N1 then it is a N2") rewrites to the subclass teach and the follow-up lookup answers from
the taught fact (10/10).

## The declared ceilings — 30 → 61, and what each green floor asserts

61 chat rows are green because they match an expectation deliberately set to the honest floor:

- **`b2ChainLenK`, 30 at INF-4** (carried from 2.5.0). Chains of length 3–5 are classically
  provable and the kernel derives them; the chat layer holds the honest "cannot be proven"
  floor, now with a recovery that names `/syllogise` when the facts to settle it are stored.
  Lifts with chat-layer multi-hop proof-chain materialization.
- **`b2PropertyInheritance`/`grandparent`, 5 at INF-4** (new). The one-hop property lift's
  measured edge, as above.
- **INF-7, 14 rows** and **INF-8's `dlDisjunction` + `dlComplement`, 12 rows** — the horizon
  rungs, next section.

The 8 `dlDisjointProofSoundness` rows the reform authored as ceilings are not in this list:
their capability shipped before their first measurement, so they grade live.

## INF-7 and INF-8 — the horizon rungs, measured

The two rungs the reform added name the two stages `PLAN_SYLLOGIST_EL_DL.md` designs, and that
tier is a separate plan, not delivered this round. Both rungs therefore **measure as the honest
miss wall, and that is the correct reading — floors holding, not failures**:

- **INF-7 (Constructed restriction, OWL 2 EL): 14/14 at the pinned floor.** Nested existentials
  (E1: "every heart has a valve", "every valve is a flap" → "does a heart have a flap") and
  existential chains (E2) classify through class expressions the graph never declared as nodes,
  which needs EL saturation. The queries all land on the miss wall, at 0% fabrication. One
  reading changed underneath these cases this round: the quantified-has teach now half-stores
  the E1 premise as a class-level possession fact where ACE used to decline the whole sentence.
  The object-side generalization is still absent, so the probe's floor holds — verified by this
  run — but the cases' "the premise is a no-op" framing is no longer the mechanism; the miss
  now comes from the read side.
- **INF-8 (Reasoning by cases, OWL 2 DL): 12 of 20 at the pinned floor, 8 live.** Disjunction
  elimination and complement classes need branching — a tableau — and their premises are shapes
  ACE declines today ("or", "not", complement frames), so the knowledge cannot yet be stated,
  let alone used. 12/12 at the miss wall, 0% fabrication. The other 8 are the live soundness
  rows above.

Until Stage EL and Stage DL land these rungs stay measured floors with the build path named;
candidate literatures and the staged design live in `PLAN_SYLLOGIST_EL_DL.md`.

## Coverage this harness shape does not reach

Two pieces of this round's syllogise work sit outside both drive points by construction, and
this report says where their evidence lives rather than pretending the ladder measures them:

- **Semi-naive delta evaluation** (watermark sidecar, `mode delta` vs full, retraction
  invalidating the watermark, `--full`) runs on the CLI verb's default path; chat's
  `/syllogise` keeps its explicit-focus full path and never touches the watermark, and the
  kernel arm calls the pure kernels directly. Evidence: the differential tests in
  `test/adapters/syllogise.test.mjs` pin delta ≡ full per rule (facts, provenance,
  environments), and the backend tests cover the watermark sidecar.
- **The `maxEnvironments` knob and `--max-environments`** bound the environment sets the ATMS
  work persists. The bound itself is a unit-test concern; what INFBENCH now measures is the
  behavior the environments exist for — survivor re-grounding and the stale-justification fall,
  via `a2EntailedRetraction`.

A third drive point that scripts the CLI verb across turns would bring delta mode under the
ladder; that is a harness growth option for a future cycle, not a gap in this one's claims.

## Drift

**No carried-over band moved.** All ten 2.5.0 templates re-measure at 100%/0% with identical
counts; the b1Disjoint, c2Inconsistent, c1ScmSvfApply and b2Svf1Apply rows sit on the same
verdicts after the is-a ladder reorder (the veto now computes before the yes-chases), which is
exactly what the reorder promised — the provable no and the clash refusal got earlier, and
nothing that was green went elsewhere.

**The first pass found a wrong-question draw, and the fix is in the generator, not the engine.**
`run-2.6.0` read 377/379: two `b2PropertyInheritance` rows drew "overbid" as a teach subject,
wink-nlp tags it VERB, and the teach lane's own subject gate declined the store — so the case
graded whether the teach was accepted, not whether possession is inherited. Both rows read
`unproven` against a pinned yes: a fail, not a fabrication, and the gate still passed. The
template's noun pool now runs through the same single-token NOUN/PROPN check the teach lane
applies (load-bearing, exactly like the persona and regular-plural filters), and `run-2.6.0_001`
is 379/379. The underlying product observation is routed below.

The standing caution carries over: a cross-version INFBENCH comparison is like-for-like on the
verdict, never on the sentence — the sentences draw against the day's lexicon.

## Decision

**Ship as-is.** Both arms clear every rung at 0% fabrication, the reformed ladder's first
measurement is clean, the soundness pin grades a live capability on its first outing, and this
round's inference work — the veto, the ATMS retraction behavior, property inheritance, the
direction/reflexivity/conditional lanes — is pinned green. The informative next moves are the
named lifts: chat-layer multi-hop proof materialization (30 rows), the deeper property lift
(5 rows), and the EL/DL stages (26 rows), all of which flip existing floors to capabilities the
day they land.

## Findings routed as backlog (worst first)

Mirroring into `NEXT.md` is left to the integration session; this worktree's dispatch owns
`infbench/**` and this report only.

1. **The quantified-has teach silently declines verb-tagged subjects.** "every overbid has a
   gouger" stores nothing — the POS gate tags "overbid" VERB and the teach declines without a
   nudge, though the "every … has …" lead is already a strong declarative signal. A user
   teaching a noun that doubles as a verb gets a silent no-op and a later miss. Chat-track
   candidate: let the quantifier lead override the single-token POS gate, or decline loudly.
2. **The quantified-has teach clips an s-final subject.** "every lens has a handle" stores the
   subject as "len" (the surface singularizer strips the s from an already-singular lemma).
   Read-back succeeds through variant folding, but every citation prints the clipped term
   ("len has handle"). Cosmetic, wrong on the record. The bench sidesteps it via its
   regular-plural pool; the store shouldn't need the sidestep.
3. **Property inheritance stops at one taught ⊑ hop** — now pinned by the 5 `grandparent`
   ceiling rows. The lift is a deeper (or closure-backed) property-inheritance walk in the
   does-have reader.
4. **INF-7's case notes lag the teach surface.** The E1 premise is no longer a full no-op (the
   quantified-has lane half-stores it); the floor holds via the read side. The generator
   comments should say so next time the file is touched — the measured expectation is already
   correct.
5. **Harness, closed this cycle:** `teach:chat` provenance was invisible to the determinism
   scrub (fixed in `infbench/run.mjs`); the property template's noun pool now mirrors the teach
   lane's POS gate (fixed in `infbench/generate-cases.mjs`).
6. **Worktree note for integration:** the ask-bundle estate guard is red at this worktree's
   HEAD (pre-existing drift from the chat-track commits, unrelated to infbench) — the bundle
   needs its rebuild at integration.
