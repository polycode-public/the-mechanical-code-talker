# INFBENCH_0.8.2 — the baseline: kernel A1/A2 clean, chat's cax-sco gap measured live

**Headline:** first INFBENCH run, per PLAN_INFERENCE_TESTING.md §4 stage 0's exit criterion. New
`infbench/` harness (`generate-cases.mjs` + `grade.mjs` + `run.mjs`, mirroring `agentbench/` +
`chatbench/generate-graded.mjs`) generates **199 cases** across the 6-band classical-logic ladder
(INF-A1…C2) from the committed lexicon, seeded and deterministic (`--replay` verified
byte-identical across 2 runs on a 30-case stratified subset). Two drive points per case: **kernel**
(the pure `deriveSubClassClosure` prover, `src/syllogise.mjs`) and **chat** (a real `runChat()`
session, taught premises then the query). The result matches the plan's prediction almost exactly:
**kernel A1+A2 100%/0% clean**, **chat A1 100%**, and **chat A2 lands exactly on the 50% floor** —
the graph-bridge variant (live) offsets the taught-only 2-hop chain (the documented cax-sco gap,
now measured rather than asserted). **The ladder gates at INF-B1** (33% completion — disjointness
proof isn't implemented, only the honest-miss half exists), so B2/C1/C2 are reported
skipped-with-a-receipt even though B2 and C1 individually clear the floor on their raw numbers —
exactly the Meta-2 ladder rule working as designed. Zero fabrication on every row, every band, both
arms.

## The metric pair, per band — KERNEL arm (30 cases; A1/A2 only — the only bands whose
query is a pure class-to-class subClassOf question, see "Scope" below)

`node infbench/run.mjs --stamp 0.8.2` (raw: `infbench/results/raw/run-0.8.2/product.jsonl`)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 10 | 10 | **100%** | 0% | PASS |
| INF-A2 | 20 | 20 | **100%** | 0% | PASS |
| **all** | **30** | **30** | **100%** | **0%** | **PASS** |

Ladder: A1 → A2, all bands pass the gate. The kernel is exactly what §1 predicted: `scm-sco` (⊑
transitivity) is fully reliable when applicable, including the 2-hop A2 chain no chat surface can
climb yet (below).

## The metric pair, per band — CHAT arm (199 cases; `runChat()`, taught premises then the query)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 30 | 30 | **100%** | 0% | PASS |
| INF-A2 | 40 | 20 | **50%** | 0% | **PASS** (exactly at the floor) |
| INF-B1 | 39 | 13 | **33%** | 0% | **FAIL — gates the ladder here** |
| INF-B2 | 40 | 40 | 100% | 0% | skipped (gated by INF-B1) |
| INF-C1 | 30 | 28 | 93% | 0% | skipped (gated by INF-B1) |
| INF-C2 | 20 | 0 | **0%** | 0% | skipped (gated by INF-B1) |
| **all** | **199** | **131** | **66%** | **0%** | n/a — ladder-gated |

Ladder: A1 → A2 → B1 → B2 → C1 → C2, **gated at INF-B1 completion 33% < 50%**. B2/C1/C2 are
reported skipped-with-a-receipt — their raw numbers (B2 100%, C1 93%) are **ceiling markers, not
failures** (PLAN_INFERENCE_TESTING.md §3, ROADMAP L256): they are GENERATED NOW against rules that
don't exist yet (proof-chain materialization, cardinality entailment, consistency checking), and
correctly measure at/near the honest "cannot be proven" floor regardless of whether B1 had gated
them. C2's 0% is the sharpest of the three — see "the one honest red worth naming" below.

## Reading the two arms together — the A2 signal is the whole point of stage 0

| | kernel | chat |
| --- | --: | --: |
| INF-A2 taught-only (2-hop, both premises taught) | **20/20 yes** | **0/20 — every case observed `unproven`** |
| INF-A2 graph-bridge (1 taught hop + 1 codegraph `inherits` edge) | n/a (kernel is blind to the codegraph) | **20/20 yes** |

This is §1's documented gap **measured live, not asserted**: `cax-sco`/chained subsumption over
TWO taught facts is not wired into the chat layer at all — `factAnswer`/`factReadBack`
(`src/chat.mjs`) only match a fact's subject/object DIRECTLY, never chase a second hop through
another taught fact. The kernel proves it instantly (`deriveSubClassClosure` is real transitive
closure); the chat mouth cannot reach it without stage 1 (`cax-sco` in `syllogise.mjs`, §4). The
graph-bridge variant is the interesting positive control: `chat.mjs`'s `inheritsChain` bridge
(0.8.2, class↔instance) already composes a taught fact with ONE codegraph edge — confirmed still
live and unaffected by this work.

## What INFBENCH found that the plan didn't anticipate

1. **Corpus contamination risk (mitigated in the generator, not in the plan text).** tmct ships a
   small pre-seeded vocabulary corpus (`corpus/seon/concepts.jsonl` + `corpus/conceptnet/slice.jsonl`,
   ~6.3k triples) that the chat engine consults for "is X a Y" questions **independently of
   anything taught in the session** — e.g. "is a controller a component" answers "yes" from
   `corpus:seon /r/IsA` with **nothing taught at all**. Left unguarded this would have silently
   corrupted every A2/B1/C2 template (which specifically test whether an UNTAUGHT relationship can
   be derived): a corpus-known pair would read "yes" regardless of whether the rule under test
   exists. `generate-cases.mjs` builds a denylist from both corpus files at generation time
   (82 contaminated noun pairs found among the lexicon's 158 usable class nouns) and skips any
   noun combination that collides with it (`pairAllowed`/`pickClean`). Documented in-file; worth
   folding into PLAN_INFERENCE_TESTING.md's risk list if this becomes a recurring lever.
2. **A lexicon collision: "node".** `node` is declared BOTH as the graph-theory common noun and
   (separately) as the `Node.js` properName. `resolveNP` tries `lookupProperName` first for a
   single-token noun phrase, so "every X is a node" parses "node" as the **individual** `Node` and
   fails the class-level `subClassOf` pattern's individual guard (`parseAce` → `null`) — the
   fixture lint caught this immediately (a loud generation-time throw, exactly as designed). Fixed
   by excluding any noun lemma that collides with a declared properName from the generator's
   class-noun pool (one line, `PROPER_NAME_LEMMAS`). Not a bug in `ace.mjs` — the lexicon is
   ambiguous  (declared words win in position, not globally) — but a real trap for any
   future generator that mints "every X is a NOUN" sentences from the raw noun list.
3. **A C1 query-layer quirk, not a grading bug.** Two of 30 C1 cardinality rows
   (`inf-c1-card-max0-009`, `-014`, e.g. "does a framework have a file") were graded `observed:
   "unclear"` rather than the expected `unproven`: `record.miss` was `false` and the answer was an
   ambiguity-disambiguation prompt ("this could mean … 1) … or 2) … — try rephrasing"), not a
   miss and not a yes/no. This is a genuine natural-language-query-layer quirk (fuzzy "have" →
   "defines" verb matching creates a spurious second reading for a few noun pairs), not a grader
   defect — `interpretIsaAnswer` correctly refuses to call it "unproven" (no honest-miss signal)
   or "yes"/"no" (no directional lead), so it fails completion honestly without being counted as
   fabrication. Left as an honest red; worth a product-side look if C1 stops being ladder-gated.

## Scope decisions (deviations worth naming explicitly)

- **The kernel arm only runs where its actual domain matches the question**: `a1Lookup/subClassOf`
  and `a2ChainLen2/taught-only` are the only templates whose query is a pure class-to-class
  `rdfs:subClassOf` question — every other template (`typeAssertion`/`possessive`/disjoint pairs/
  cardinality/`someValuesFrom`/graph-bridge) is structurally outside `deriveSubClassClosure`'s
  domain (it reads only `rdfs:subClassOf` edges — no `rdf:type`, no `owl:disjointWith`, no
  codegraph). Running the kernel against those anyway would just report "unproven" for a
  category-error reason, not a capability gap, so those cases declare `arms: ["chat"]` only. This
  is a deliberate scoping choice, not a shortcut — see `infbench/grade.mjs`'s file header.
- **INF-B2/C1/C2's `expect.verdict` is pinned to the honest ceiling (`"unproven"`/`"inconsistent"`)
  by construction, not to the raw classical truth-value**, per PLAN_INFERENCE_TESTING.md §2.2/§2.4/§3's
  repeated, explicit mandate ("expect stays unproven/0% until §4 stage 1/4/5"). This matters most
  for `b2ChainLenK`: a length-3..5 `subClassOf` chain is classically PROVABLE by plain transitivity
  (`deriveSubClassClosure` already derives it), but INF-B2 is testing the chat layer's multi-hop +
  **proof-chain materialization** capability (§4 stage 2), which doesn't exist — so the template
  deliberately runs **chat-arm only**, and grades the chain's correct classical answer as an honest
  ceiling rather than mislabeling engine-correctness as fabrication. Documented per-case in each
  row's `note` field.
- **Proof receipts (`expect.proof`) are recorded but not actively graded in this baseline**: no
  drive point (kernel's flat `{subject,object,via}` list, or chat's plain-text answer) produces a
  structured, rule-named connected proof chain yet (§4 stage 2 is exactly this gap). The field is
  carried on every B1/B2 case as a forward-declared aspiration; wiring the connectedness check
  (mirroring `agentbench/grade.mjs`'s `proofConnected`) is real work for whenever stage 2 ships a
  proof shape to check.

## The one honest red worth naming — INF-C2 at a flat 0%

Every one of the 20 C2 cases (contradictory premises: `x:C1`, `x:C2`, `C1 disjointWith C2`) is
observed `unproven` rather than the expected `inconsistent` — the engine answers `"what do you
know about X"` by **calmly listing both contradictory facts, each correctly cited**, with no
awareness that they conflict. This is graded as an honest INCOMPLETE, not a fabrication (the
grader's `interpretInconsistentAnswer` never emits a directional yes/no from this query shape, so
it structurally can't fabricate here) — but it is the sharpest illustration in this baseline of
*why* a consistency checker (§4 stage 5) matters: today, teaching tmct two contradictory facts
produces no visible symptom at all until a query happens to surface both of them side by side.

## Discipline — the non-negotiables, checked

- **Zero-fabrication anti-circularity**: every `expect` literal in `infbench/cases.jsonl` is a pure
  function of its own template parameters, computed in `generate-cases.mjs` BEFORE any engine
  replay — `grade.mjs` imports no composition/derivation helper for the chat arm (it only reads
  `record.miss` + the rendered text) and, for the kernel arm, imports `deriveSubClassClosure`
  purely to COMPARE against the pinned literal, never to author it.
- **Fixture lint enforced at generation time**: every premise sentence `parseAce`s to a clean hit
  (residue `[]`) against the committed lexicon (verified: the "node" collision above was caught
  this way, loudly, before a single case was written); every `expect.entailed` literal's terms are
  checked to occur in the premises' own emitted triples (`checkEntailed`, mirrors
  `agentbench/grade.mjs:92-101`'s stale-literal rule).
- **Determinism**: `node infbench/generate-cases.mjs` (no `--seed`) is byte-identical across runs
  (fixed default seed, no `Date.now` anywhere in the generator); `node infbench/run.mjs --replay`
  verified byte-identical product rows across 2 full runs on a 30-case stratified subset (the
  volatile per-turn `ace:chat:<uuid>@<ts>` provenance is scrubbed to a stable placeholder before a
  row is recorded, mirroring `chatbench/run.mjs`'s `VOLATILE_PROVENANCE` discipline).
- **`npm test`** stays green (974/974) — this work only adds new files under `infbench/` plus one
  `package.json` script line; nothing in `src/` changed.

## Reproduce

```
npm run infbench
# or, separately:
node infbench/generate-cases.mjs --seed 20260707
node infbench/run.mjs --stamp 0.8.2
node infbench/run.mjs --stamp 0.8.2 --replay   # determinism check (slower — runs everything twice)
```

## Next (per PLAN_INFERENCE_TESTING.md §4)

- **Stage 1 (`cax-sco` in `syllogise.mjs`)** is the direct unlock for the A2 taught-only red above
  — flipping it should move chat/INF-A2 from 50% to ~100% (the graph-bridge cases are already
  clean) and is a small, well-scoped next step now that this baseline names the exact gap.
- **Stage 3 (`cax-dw` + the ⊑-lift)** is what INF-B1 is gating on — 26 of 39 B1 cases (direct +
  lifted member) are sitting on a real, provable "no" the engine simply doesn't compute yet.
- B2/C1/C2 stay declared ceilings until stages 2/4/5 respectively — INFBENCH will re-measure them
  for free the moment any of those land (no case-authoring work needed, per §2.2's whole point).
