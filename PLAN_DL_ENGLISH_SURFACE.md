# PLAN_DL_ENGLISH_SURFACE.md — let plain English reach the tableau: the role-axiom teach frames, and `/prove` on a miss

Status: Phases A1 through A4 have landed. A1's grammar, tableau reader and ontology/docs (section
4, sub-tracks A1-g/A1-k/A1-d) — pattern 18, `allE`, the `owl:allValuesFrom` KB reader and
module-extraction follow, and the EL normalizer skip. A2's grammar and ontology/docs (section 5) —
pattern 19, `rdfs:subPropertyOf`, one row, one direction; both engines' own reader confirmed by
test rather than re-implemented. A3's ABox role route into the tableau (section 6) — the
role-assertion KB reader, the widened `individuals`/`roles`, edge seeding in `buildInitialBranch`,
and module-extraction's own reseeding through an asserted edge. A1's `renderUniversalRestrictionLine`
and A2's `isRoleScaffoldingDeclaration` read-backs (4.3, 5.3) have landed too, plus a restriction
node's onProperty/someValuesFrom/allValuesFrom scaffolding gained the same describe-lane suppression.
Landing A4's three corpus rows against the live chat surface surfaced a real bug in A3's own role
route — role-hierarchy/transitivity matching compared an asserted edge's literal predicate spelling
against a role axiom's namespace-stripped term spelling, so a role reaching the tableau only through
a real taught relation never matched its own declaration; section 6's own text below still describes
the reader as originally landed; the fix and the corpus rows are section 12's read-back round and A4.
Phase B1 has landed: the automatic `/prove` fallback (`autoProveFallback`, `src/services/chat.mjs`),
gated on `moduleHasDlShape` (`src/domain/tableau.mjs`), two-sided and proved-only, with its ex-falso
guard and its own `[reasoning]` knobs (`ask_prove_fallback`/`ask_prove_steps`/`ask_prove_branches`/
`ask_prove_nodes`, `src/domain/reasoning-config.mjs`). Building it surfaced the same asserted-edge
role-matching gap A4 did, this time in `extractTableauModule`'s own structural walk: an individual
reached only through its own `rdf:type` edge (rather than through the asked class itself) never
pulled in that class's union/restriction rows, now fixed by seeding the module with the subject's
own types too, the same discipline `findWiderConsistencyClash` already used. B2 has landed too:
`applyOrRule` (`src/domain/tableau.mjs`) records each genuine case-analysis choice it makes,
told apart from the ⊑-rule's own routine TBox-internalization disjunction by two structural
conditions together (tracing to a real union/oneOf fact id, and every disjunct a bare atom or
nominal — neither alone is reliable), and `proveByRefutation` surfaces the distinct disjuncts as
a new `cases` field (capped at `MAX_PROVEN_CASES`, with the real count on `casesTotal`). Both
`/prove` and the automatic fallback render it through one shared `renderProvedConclusion`. B3 has
landed: driving every INF-7/INF-8 case through the real chat arm before editing anything (section
10's own discipline) found that `dlDisjunction` and `dlComplement` (12 rows) now answer for real —
`unproven` → `yes`, ceiling field dropped — while `dlCardinalityClash` (8 rows) and
`dlNominalEnumeration` (6 rows) measure unchanged, each for a specific, now-recorded reason rather
than an assumption: `dlCardinalityClash`'s own query asks about the individual's own
directly-asserted class, which chat answers through its direct-fact lookup before the isa ladder's
miss cascade ever runs — the one place B1's ex-falso guard is wired in — so this query shape never
reaches it; `dlNominalEnumeration`'s queried individual is never type-declared, so it routes
through `proveSubsumption` rather than `proveEntailment`, and an unconstrained fresh individual
satisfies both the positive and negative subsumption check — a genuine counter-model B1's own
constitution renders as the unchanged miss, never a guess. INF-7 (14 rows) stays a ceiling too — its
own gap (EL saturation for the "does X have Y" lane) is untouched by B1 — but its note text was
stale in a different way (blaming ACE for declining a premise pattern 15 now teaches), corrected in
the same pass, along with the two other stale note strings the plan named.
`reports/BENCHMARK_INFERENCE_5.0.28.md` carries the full measurement. Every phase in this plan
(A1 through B3) has now landed.

`PLAN_SYLLOGIST_EL_DL.md` shipped a SHOIQ tableau. It proves transitive-role propagation, role
hierarchies, nominals, qualified cardinality and inverse roles, with a test file per increment. Two
things stop a user reaching any of it from a sentence they would actually type:

1. **Three of the role axioms it reasons over have no English.** `owl:allValuesFrom` appears nowhere
   in the repo. `rdfs:subPropertyOf` is read by two engines and written by nothing. An asserted
   relation between two named individuals stores fine and then falls off the KB reader.
2. **The prover only answers when you type `/prove`.** An ordinary question that misses never reaches
   it, so the capability is invisible to the ask lane and to infbench.

Both are English-surface problems, which is why they are one plan. Track A is the vocabulary for
*stating* the axioms. Track B is the route for *asking* the questions. The name says surface rather
than grammar because Track B adds no grammar at all — it reuses `ISA_ASK_RE`, the shape the ask lane
already parses.

This plan is written to be built by a Sonnet-tier implementer with no further design work. Every
phase names its module paths, its function signatures, its test files, its corpus rows and its
acceptance commands. Where a phase is mechanical enough for Haiku, it says so.

---

## 1. What ships today

### 1.1 The tableau's role axioms, and what English can state

`src/domain/tableau.mjs` reads three role-axiom shapes and reasons over all three.

| shape | KB reader | what reasons over it | can English state it? |
|---|---|---|---|
| `p rdf:type owl:TransitiveProperty` | `tableau.mjs:948` → `transitiveRoles` (`:1077`) | the ∀-rule copies its own label onto a transitive successor, `tableau.mjs:507` | **yes** — ACE pattern 16, `ace.mjs:618-624` |
| `p rdfs:subPropertyOf q` | `tableau.mjs:953` → `roleClosure` (`:1061-1065`) | `roleCountsAs` (`:181-185`) through `roleEdgeTargets` (`:194-205`), read by ∀ `:502`, ∃ `:583`, ≤ `:611`, ≥ `:655` | **no** |
| `p owl:inverseOf q` | `tableau.mjs:956` → `inverseOf` (`:1052-1056`) | `roleEdgeTargets` reads an incoming edge backwards, `:199-202`; blocking upgrades to pairwise, `:412` | **yes** — ACE pattern 17, `ace.mjs:631-639` |

The gap that makes the first row unusable sits one level down. The ∀-rule at `tableau.mjs:496-513`
is the only consumer of transitivity, and a `{t:"all"}` concept can only enter a branch by negating
an existential — `pushNegation`, `tableau.mjs:91-96`. **`owl:allValuesFrom` has zero occurrences in
`src/`, `ontology/`, `docs/` and `test/`.** There is no ACE pattern, no teach frame, no KB reader and
no ontology declaration. So a user can declare a role transitive and never give the ∀-rule anything
to propagate.

`rdfs:subPropertyOf` is the mirror case: both engines already read it and nothing writes it.
`src/domain/el-classify.mjs:116` folds it into `roleAxioms` and CR6 fires on it at
`el-classify.mjs:349-359`; `buildTableauKb` builds the role closure from it at `tableau.mjs:1061-1065`.
`src/services/chat.mjs:11222-11224` says in a comment that the ACE grammar cannot teach it.

The seventeen shipped ACE patterns live in `src/domain/grammar/ace.mjs`, named at `:41-57`, listed in
the frozen `PATTERNS` array at `:60-66`, dispatched by `parseAce` at `:728-763`, and tabled in
`docs/references/schemas/ace-owl-fragment.md:31-49`. Every anonymous node gets a readable,
content-derived CURIE rather than a blank node — `some-<pred>-<filler>` at `ace.mjs:471`,
`min-<n>-<class>` at `:398`, `not-<class>` at `:541`, members sorted before the name is built so
re-teaching re-emits byte-identical triples (`:408-410`, `:573-578`). The helper that strips the
`tmct:` prefix out of a synthesized name is `local`, `ace.mjs:86-90`.

Patterns 16 and 17 fold their surface verb through `verbPredicateFromSurface` (`ace.mjs:607-614`),
which accepts a 3sg or a gerund and mints through `predicateOf` (`src/domain/grammar/lexicon.mjs:90-94`).
Pattern 3 mints through the same `predicateOf`. So an ACE-taught relation and an ACE-taught role
axiom already agree on the predicate spelling — `tmct:contains` in both. That agreement is what makes
phase A3 a reader problem rather than a vocabulary problem.

### 1.2 The ABox role gap, located exactly

`PLAN_SYLLOGIST_EL_DL.md:1424-1430` records that `buildTableauKb` has no reader for an asserted role
fact between two named individuals. The gap is three code sites, and the grammar is not one of them.

**The grammar already stores the fact.** `parseRelation` (`ace.mjs:250-274`) emits
`{ subject, predicate: predicateOf(verb, ns), object, kind: "owl:ObjectProperty" }` at `:263-265`
whenever both noun phrases resolve. A side resolves as an individual when it is one of the 22 declared
proper names or matches `CODE_REF_SHAPE` (`ace.mjs:120-122`). `"chat.mjs depends on sessions.mjs"` →
`chat.mjs tmct:dependsOn sessions.mjs`, pinned by `test/adapters/grammar-ace.test.mjs:44-51`.

**The KB reader drops it.** `buildTableauKb`'s predicate dispatch (`tableau.mjs:936-957`) is a closed
`else if` chain over the OWL and RDFS vocabulary with no trailing `else`. A `tmct:dependsOn` row
matches nothing and is discarded. The returned KB (`:1076-1079`) has ten fields and none of them
holds an edge.

**The branch would have nowhere to put it.** `buildInitialBranch` ends at `tableau.mjs:841` with
`return { nodes, edges: [], closed: false, clash: null, inequalityFrom }`. Every edge in every proof
is minted by the ∃-rule (`:589`) or the ≥-rule (`:663`). Nothing seeds an asserted one.

Three consequences follow, and each is measurable today. The inverse machinery at
`tableau.mjs:199-202` is fully implemented and can only ever read edges the tableau generated itself.
`roles` is built solely from `owl:onProperty` objects (`:1058-1059`), so an asserted role never enters
the role closure. `individuals` is derived solely from `assertions` (`:1073`), so an individual
mentioned only in a relation fact is not a named individual at all.

There is a second surface with a different spelling. The teach lane's `generalVerbTeach`
(`chat.mjs:4546-4655`, predicate minted at `:4641` by `generalVerbPredicate`, `:4515-4530`) stores an
undeclared-vocabulary relation as `mgx:<lemma>` — `"alice knows bob"` becomes `alice mgx:know bob`.
Patterns 16 and 17 never mint an `mgx:<lemma>` spelling, so a role axiom cannot name that predicate.
Phase A3 scopes itself to the ACE spelling the three patterns already share and names the fold that
would reconcile the second surface.

### 1.3 The isa miss ladder, and where `/prove` is not

`runAsk` (`chat.mjs:14256-15935`, module-private, called only from `dispatchTurn` at `:18278`) runs
about twenty miss stages. The honest-miss wall is composed at `chat.mjs:15708-15711` from
`shortMissHint` (`:2733-2736`).

Two recovery offers already name a command. Neither names `/prove`.

- The isa-ladder offer, `chat.mjs:11351-11355`, rendered at `:11357`. It offers `/classify <subject>`
  when one of the subject's remembered isa objects is a genuine someValuesFrom restriction node
  (`involvesRestriction`, `:11350`), else `/syllogise <subject>` when a deeper chain exists
  (`deeperChainExists`, `:11328-11330`, a read-only re-probe at `DEEP_CHAIN_PROBE_HOPS = 6`,
  `:8401`), else a teach hint.
- The class-level existential offer, `chat.mjs:8953-8959`, inside `restrictionExistentialHit`
  (`:8924`), reached from the `does X have Y` lanes at `:9638` and `:9650`.

`/prove` is a hand-written `if (name === "prove")` branch in `runCommand`, `chat.mjs:16376-16442`. It
is slash-required, takes a proposition rather than a term, parses it with the ask lane's own
`ISA_ASK_RE` (`:8392`, matched at `:16382`), writes nothing, and answers three ways: `yes — …`
(`:16413`), `no — I can build a consistent picture where …` (`:16424`), and the budget wall
(`:16432-16436`) which stamps `res.record.budgetExhausted = true` (`:16437`). Nothing in `runAsk`
calls it. The only automatic tableau use on the hot path is the consistency check
`findWiderConsistencyClash` (`chat.mjs:8974`, called at `:10025-10026`), which hunts clashes and never
an entailment.

**The proved render does not name its case split.** `chat.mjs:16407-16412` sets `caseSplit` from a
cited premise's predicate being `owl:unionOf` or `owl:oneOf`, and the conclusion then reads
`in every case, X is a Y.` It never says which cases. It cannot: `proveByRefutation`
(`tableau.mjs:868-876`) flattens `premises` into one sorted union across every closed branch at
`:872`, and per-branch structure is discarded by `search` at `:756` and `:762`.

### 1.4 The infbench ceiling markers

A generated case may carry a free-text `ceiling` field naming the capability that would lift it. It is
lint-checked at `test-benchmarks/infbench/grade.mjs:97-99`, carried onto both graded arms at
`run.mjs:110` and `:118`, counted apart at `grade.mjs:335-336`, legended by `ceilingCapabilities`
(`:346-355`) and rendered as the `ceiling/pass` column at `:378-393`. Six distinct strings cover 70 of
the 413 committed cases.

| band | marker constant | line | rows | template | expect |
|---|---|---|--:|---|---|
| INF-7 | `EL_CEILING` | `generate-cases.mjs:806` | 14 | `elConstructedRestriction`, `elExistentialChain` | `unproven` |
| INF-8 | `DL_DISJUNCTION_CEILING` | `:865` | 6 | `dlDisjunction` | `unproven` |
| INF-8 | `DL_COMPLEMENT_CEILING` | `:866` | 6 | `dlComplement` | `unproven` |
| INF-8 | `DL_CARDINALITY_CLASH_CEILING` | `:923` | 8 | `dlCardinalityClash` | `inconsistent` |
| INF-8 | `DL_NOMINAL_ENUMERATION_CEILING` | `:924` | 6 | `dlNominalEnumeration` | `unproven` |

Every one of those templates sets `arms: ["chat"]`, and `driveChat` sends the premises then
`caseDef.query` as a plain turn with no `/prove` prefix — `run.mjs:81`. That single line is why the
four INF-8 markers survived `/prove` landing, exactly as `PLAN_SYLLOGIST_EL_DL.md:1469-1483` recorded
after checking it directly.

INF-7 is a different case and this plan does not claim it. Its marker text still says EL saturation
has not shipped, which stopped being true when phase 2 wired `restrictionExistentialHit` and the
auto-fold hook into the ask lane. Its rows drive `does a N1 have a N3`, the `DOES_HAVE_ASK_RE` lane,
which no isa-shaped fallback touches. Phase B3 re-measures it in the same round because the run is the
same run, and reports what it finds rather than assuming a flip.

---

## 2. The two gaps

**Track A.** The tableau proves things about roles that no English sentence can set up. Three phases
add the two missing teach frames and the one missing reader, and a fourth lands the three
`inference.dl.*` corpus rows that have been open since phase 4 as the proof that they work.

**Track B.** The prover answers only when named. Three phases make a missed yes/no question fall
through to a bounded proof, make a by-cases answer name its cases, and re-measure infbench.

---

## 3. The constitution

These hold for every phase below. They restate `PLAN_SYLLOGIST_EL_DL.md` section 4 where it binds,
and add what is specific to a prover on the hot path.

- **Pure JS, no LLM in the product path.** Every rendered verdict goes through the same template
  machinery as every other answer.
- **Deterministic.** Fixed rule order, fixed branch order, no wall clock, no arrival-order dependence.
  A new reader sorts its output before returning it, the way every reader in `buildTableauKb` already
  does (`tableau.mjs:1067-1073`). Feed one fact set in two orders and demand the same bytes back.
- **$0 per query.** No network, no model, no service.
- **A timeout is a miss, never a guess.** An exhausted proof on the hot path changes nothing about the
  answer. It never renders a partial result and never downgrades to a hedge.
- **The fallback is answer-monotone.** It may replace a miss with a proved verdict. It may not make
  any answer worse, longer, or slower to arrive at than it is today. Anything short of a proof leaves
  the existing text byte-identical.
- **Open-world.** Failing to prove `C` is not proving `¬C`. On a plain question the fallback renders a
  "no" only when the store entails the negation, never from a counter-model. `/prove` keeps its
  counter-model "no" because the user asked a decision procedure a direct question.
- **Never certify out of an inconsistency.** A proof that goes through because the subject's own
  premises clash is not an answer. The clash is the answer. This is the same discipline the shipped
  cax-dw gate already applies ahead of both proof chases.
- **Domain purity.** New engine code lives in `src/domain/` and imports nothing non-relative.
  `test/estate/import-layers.test.mjs` fails on the first violation and its allowlist may only shrink.

---

## 4. Phase A1 — the universal-restriction frame

Goal: `owl:allValuesFrom` becomes stateable, storable, readable back, and readable by the tableau. This
is what gives the ∀-rule (`tableau.mjs:496-513`) something a user taught to propagate.

### 4.1 ACE pattern 18

Surface: *"every heart contains only valves"*. Also *"every heart contains only a valve"* and the
`has` case *"every heart has only valves"*.

```
r = `${ns}all-${local(pred)}-${local(filler)}`      e.g. tmct:all-contains-valve
r     rdf:type          owl:Restriction   kind owl:allValuesFrom
r     owl:onProperty    tmct:contains     kind owl:allValuesFrom
r     owl:allValuesFrom valve             kind owl:allValuesFrom
heart rdfs:subClassOf   r                 kind owl:allValuesFrom
```

The node name mirrors pattern 15's `some-<pred>-<filler>` (`ace.mjs:471`) through the same `local`
helper (`:86-90`), so the two restriction families read as siblings and the same sentence always
re-emits the same triples.

New `PATTERN_UNIVERSAL = "universal"` constant beside `ace.mjs:41-57`, appended to the frozen
`PATTERNS` array at `:60-66`, and a `parseUniversal(lexicon, toks, lower)` function modelled on
`parseBareExistential` (`:449-480`).

**Parse and arm order.** This is a new arm inside `parseEvery`, and it must be tried **before** the
bare-existential arm at `ace.mjs:490-491`. The arm fires only when the token immediately after the
verb is exactly `only`; the filler is the remaining token run, resolved with `resolveNP` and folded to
its singular lemma through `lookupNoun` the way pattern 13's subject already is (`:590-599`). The verb
resolves through `lookupVerb` and the predicate through `predicateOf`, so `tmct:has` is just the case
where the verb is `has`. Any arm that fails to resolve declines through `missOrNull` (`:235-238`), as
every other pattern does.

Decline paths, each with its own test: an undeclared verb declines; an undeclared filler noun
declines; `only` with nothing resolvable after it declines; and `"every heart contains a valve"` still
routes to pattern 15 unchanged.

### 4.2 Reading it into the tableau

Three edits in `src/domain/tableau.mjs`.

1. **A constructor.** `const allE = (r, c) => ({ t: "all", r, c });` beside `someE` at `tableau.mjs:49`.
2. **A dispatch arm.** `else if (p === "owl:allvaluesfrom") allValuesFromOf.set(r.subject, { object: r.object, id: r.id });`
   directly after the `owl:somevaluesfrom` arm at `:939`, with the map declared beside
   `someValuesFromOf`.
3. **A subClassOf reader arm.** In the loop at `:971-998`, after the someValuesFrom arm at `:978-982`:

```js
const avfRow = allValuesFromOf.get(restriction);
if (avfRow) {
  axioms.push(mkAxiom(atom(r.subject), allE(propRow.object, atom(avfRow.object)),
    [r.id, propRow.id, avfRow.id]));
  continue;
}
```

`toNNF` already handles `{t:"all"}` in both polarities (`tableau.mjs:91-96`, `:111`), so nothing in
the search engine changes.

**Module extraction.** `extractTableauModule` must follow `owl:allValuesFrom` from a restriction node
to its filler and back, and keep the row, exactly as it does for `owl:someValuesFrom` — the walk at
`tableau.mjs:1154-1158` and the keep filter at `:1218-1224`. A universal restriction that is not
followed silently shrinks the module and turns a provable question into a miss, which is the most
likely way this phase fails quietly.

**The EL classifier must ignore it.** `normalizeElTBox`'s first reader treats `A rdfs:subClassOf B`
as NF1 when `B` is not a restriction node. EL has no universal restriction, so an `all-…` node must be
skipped rather than folded in as an atomic concept — reading it as a concept name would let the
classifier derive a subsumption the semantics do not license. One test in `el-normalize.test.mjs`
pins that an `owl:allValuesFrom` restriction produces no axiom.

### 4.3 Read-back

`owl:allValuesFrom` is restriction scaffolding and never renders as a plain fact line, the same
treatment the someValuesFrom scaffolding already gets. Add `renderUniversalRestrictionLine(node, rows)`
beside the existing restriction renderers in `src/services/chat.mjs`, pure, producing
*"every heart contains only valves (source: …)"* from the node's `rdfs:subClassOf` parent, its
`owl:onProperty` role and its filler. It takes the fact rows and returns one line, and it composes the
same sentence regardless of row order.

### 4.4 Ontology and docs

- `ontology/tmct-core.ttl` section 2: declare `owl:allValuesFrom` beside `owl:someValuesFrom`, with a
  real Turtle documentation example, matching the file's convention for every other `owl:` term.
  `test/adapters/grammar-ontology.test.mjs` pins the core vocabulary against this file.
- `docs/references/schemas/ace-owl-fragment.md`: one new row, pattern 18, in the table at `:31-49`.
- `docs/references/schemas/owl2-vocabulary.md`: add the term to the emitted-vocabulary list.
- `ontology/README.md`: one new row in the pattern → kind table.

### 4.5 Phase A1 tests

| file | what it holds |
|---|---|
| `test/adapters/grammar-ace-class-expressions.test.mjs` (extend) | pattern 18's exact triple list; node-name determinism across two teaches; the plural and singular filler forms; each decline path; `"every heart contains a valve"` still parses as pattern 15 |
| `test/adapters/tableau-kb.test.mjs` (extend) | an `owl:allValuesFrom` restriction reads as `A ⊑ ∀r.C` with all three fact ids cited; a restriction with neither someValuesFrom nor allValuesFrom nor a qualified cardinality is still skipped rather than guessed at |
| `test/adapters/tableau-module.test.mjs` (extend) | a universal restriction's filler is inside the extracted module, and a chain of universal restrictions longer than `hops` still extracts because each re-seeds its own walk |
| `test/adapters/el-normalize.test.mjs` (extend) | an `owl:allValuesFrom` restriction yields no EL axiom and does not become an atomic concept |
| `test/adapters/teach-negative-and-enumeration.test.mjs` (extend) | `owl:allValuesFrom` stays out of the plain fact-line describe lane; `renderUniversalRestrictionLine` is row-order independent |
| `test/adapters/grammar-ontology.test.mjs` (extend) | `owl:allValuesFrom` is declared in `tmct-core.ttl` |

### 4.6 Phase A1 acceptance

```
npm run test:fast
node --test test/adapters/grammar-ace-class-expressions.test.mjs
node --test test/adapters/grammar-ace.test.mjs test/adapters/grammar-assert.test.mjs test/adapters/grammar-ontology.test.mjs
node --test "test/adapters/tableau-*.test.mjs"
node --test "test/adapters/el-*.test.mjs"
node --test test/adapters/teach-negative-and-enumeration.test.mjs
node --test "test/estate/*.test.mjs"
npm run build:ask-bundle
```

---

## 5. Phase A2 — the subproperty frame

The smallest phase in the plan. Both engines already read `rdfs:subPropertyOf`; only the sentence is
missing.

### 5.1 ACE pattern 19

Surface: *"containing implies touching"*, and the 3sg form *"contains implies touches"*.

```
tmct:contains rdfs:subPropertyOf tmct:touches    kind rdfs:subPropertyOf
```

One row, one direction. A subproperty is directional, so unlike pattern 17's `owl:inverseOf` the
reverse row is not minted.

New `PATTERN_SUB_PROPERTY_OF = "subPropertyOf"` constant beside `ace.mjs:41-57`, appended to
`PATTERNS` at `:60-66`, parsed by `parseSubProperty` modelled line for line on `parseInverseRole`
(`:631-639`), dispatched beside patterns 16 and 17 at `:732-739`. Both sides fold through
`verbPredicateFromSurface` (`:607-614`), the helper patterns 16 and 17 already share, so a gerund and
a 3sg reach the same predicate and a declared override still wins. An undeclared verb on either side
returns null.

The frame reads as metalinguistic, which is the family patterns 16 and 17 established: it talks about
verbs rather than about things. That is deliberate. A conditional surface (*"if X contains Y then X
touches Y"*) states the same axiom in object language and needs a clause parser the grammar does not
have.

### 5.2 Reader work: none

Verified at HEAD, and this is the phase's whole point.

- `buildTableauKb` collects the row at `tableau.mjs:953`, builds `subPropertyEdges` at `:1061-1063`
  and the closure at `:1065`; `roleCountsAs` (`:181-185`) then makes an `r`-edge count as an `s`-edge
  inside `roleEdgeTargets` (`:194-205`), which the ∀, ∃, ≥ and ≤ rules all read through.
- `normalizeElTBox` collects it at `el-classify.mjs:116`, emits `{ kind: "sub", sub, sup, from }` at
  `:203-205`, and CR6 fires on it at `:349-359`.

`src/services/chat.mjs:11222-11224` carries a comment saying the ACE grammar cannot teach
`rdfs:subPropertyOf`. It stops being true in this phase and the phase updates it. The replacement
states the current behaviour and cites no plan, ticket or date.

### 5.3 Read-back

A `rdfs:subPropertyOf` row relates two predicates, not two things, so `renderFactLine` would compose
nonsense from it. Suppress it from the plain fact-line describe lane the way a
`rdf:type owl:TransitiveProperty` declaration already is — `isTransitivePropertyDeclaration`
(`chat.mjs:7667-7672`), filtered at `:9349` and `:9972`. Extend that predicate to a
`isRoleScaffoldingDeclaration` covering both, rename its two call sites, and add
*"containing implies touching (source: …)"* as its dedicated line.

### 5.4 Ontology and docs

Same four surfaces as A1: `ontology/tmct-core.ttl` section 2, `ace-owl-fragment.md`'s pattern table
(pattern 19), `owl2-vocabulary.md`, `ontology/README.md`. `rdfs:subPropertyOf` already appears in
`tmct-core.ttl` at `:60`, `:170`, `:202` and `:304-318` as part of tmct's own meta-model alignment —
that is a different use and stays untouched. The new declaration goes in section 2 beside the class
expression vocabulary, and `test/adapters/grammar-ontology.test.mjs:247-260` pins the existing
alignments, so a careless edit there fails loudly.

### 5.5 Phase A2 tests

| file | what it holds |
|---|---|
| `test/adapters/grammar-ace-class-expressions.test.mjs` (extend) | pattern 19's single triple; gerund and 3sg reach the same predicate; a declared override wins on either side; one direction only; an undeclared verb declines |
| `test/adapters/tableau-role-hierarchy.test.mjs` (extend) | a taught pattern-19 row, run through `buildTableauKb`, produces the same `roleClosure` as the hand-built fixture rows the file already uses |
| `test/adapters/el-normalize.test.mjs` (extend) | a taught pattern-19 row yields `{ kind: "sub", … }` in `roleAxioms` |
| `test/adapters/teach-negative-and-enumeration.test.mjs` (extend) | a `rdfs:subPropertyOf` row stays out of the plain fact-line describe lane and renders through its own line |

### 5.6 Phase A2 acceptance

```
npm run test:fast
node --test test/adapters/grammar-ace-class-expressions.test.mjs
node --test test/adapters/tableau-role-hierarchy.test.mjs
node --test "test/adapters/el-*.test.mjs"
node --test test/adapters/teach-negative-and-enumeration.test.mjs
node --test "test/estate/*.test.mjs"
npm run build:ask-bundle
```

---

## 6. Phase A3 — the ABox role route into the tableau

Section 1.2 located the gap. The grammar stores the fact; the KB reader drops it; the branch has no
edges. This phase is a reader change in `src/domain/tableau.mjs` and touches no grammar.

### 6.1 Reading role assertions

`buildTableauKb`'s dispatch (`tableau.mjs:936-957`) gains a trailing `else` that collects the row as a
role-assertion candidate. Classification cannot happen in that loop, because
`individualNamesFromType` is only built afterwards at `:959-963`. So candidates are collected in pass
one and filtered in pass two, after `isIndividualTerm` (`:964`) exists:

```js
/** An asserted role edge between two named individuals: any predicate outside
 *  the recognised OWL/RDFS vocabulary, both of whose terms resolve as
 *  individuals. Sorted, capped, and cited by fact id. */
const roleAssertions = [];   // [{ a, r, b, from }]
```

The gate is deliberately narrow, and each clause earns its place:

- the predicate matched no earlier arm, so it is not OWL or RDFS vocabulary;
- both `r.subject` and `r.object` pass `isIndividualTerm` (`:964`), so a class-level relation such as
  `human mgx:capableOf think` is not read as an ABox edge;
- the count is capped by `maxRoleAssertions` (section 11), and the cap is applied after sorting so
  which edges survive a cap is deterministic rather than arrival-ordered.

Emission is sorted by `a`, then `r`, then `b`, matching the determinism tail the other readers already
run at `:1067-1073`.

### 6.2 The four downstream edits

1. **The KB shape.** `roleAssertions` joins the return at `tableau.mjs:1076-1079` and the field copy in
   `restrictKbToIndividual` at `:1082-1095`.
2. **Named individuals.** `individuals` is derived from `assertions` alone at `:1073`. Widen it to the
   union of assertion subjects and role-assertion endpoints, still sorted, so an individual that only
   ever appears in a relation fact is a real named individual and `namedIndividuals` (`:1074`) covers
   it. This is what makes `/prove`'s own `kb.namedIndividuals.has(subjectTerm)` test
   (`chat.mjs:16396`) route such a subject to `proveEntailment` rather than `proveSubsumption`.
3. **Roles.** `roles` is built from `owl:onProperty` objects at `:1058-1059` and `roleNames` at
   `:1064`. Both take the asserted roles too, so `buildRoleClosure` (`:1065`) and the inverse map cover
   a role that only ever appears in an assertion.
4. **The initial branch.** `buildInitialBranch` (`:814-841`) seeds the edges. For each role assertion,
   `ensureNode` both endpoints (the helper at `:816-819`), then push
   `{ from: a, r, to: b, fromFacts: from }` onto the edge list that `:841` currently hard-codes empty.
   Edges are pushed in the KB's sorted order, so the branch is byte-identical whatever order the rows
   arrived in.

### 6.3 Module extraction

`extractTableauModule` (`tableau.mjs:1135`) must keep a role-assertion row when either endpoint is in
the signature closure, and re-seed its own hop-bounded walk from the other endpoint — the same
re-seeding discipline a restriction chain already gets. Without this, a question about one end of an
asserted edge extracts a module that does not contain the edge, and the proof fails for a reason that
looks like the engine rather than the module.

### 6.4 What this phase deliberately leaves

Two shapes stay out, both with a named route rather than a shrug.

- **A negated role assertion.** `mgxneg:<verb>` rows exist (`src/domain/memory/capability.mjs`). A
  faithful encoding is `¬∃r.{b}` on `a`, which needs the nominal machinery 4c shipped plus a decision
  about whether the absence of an edge is assertable at all under the open-world rule. The candidate
  design is the nominal encoding; it lands when a corpus row needs it.
- **The `mgx:<lemma>` teach-lane spelling.** Section 1.2 names the mismatch: `generalVerbTeach` mints
  `mgx:know` where `predicateOf` would mint `tmct:knows`, and no role axiom can name the first. The
  candidate mechanism already exists — `CANONICAL_FACT_PREDICATE` in `src/domain/hash.mjs:138-146` is
  a closed taught→corpus fold table whose own doc comment gives the rule for when a row is legitimate
  (same relation, same direction, never an argument inversion). Reconciling the two spellings means
  either extending that table or teaching `verbPredicateFromSurface` the `mgx:` spelling. It is its
  own round because the blast radius is every stored `mgx:` fact and the read-back table, and this
  plan's corpus rows do not need it: pattern 3 and patterns 16 to 19 all mint through `predicateOf`
  and already agree.

### 6.5 Phase A3 tests

| file | what it holds |
|---|---|
| `test/adapters/tableau-kb.test.mjs` (extend) | an asserted relation between two individuals reads as a role assertion citing its fact id; a class-level `mgx:` relation does not; a relation naming one individual and one class does not; the `roleAssertions` cap truncates deterministically; two input orders give byte-identical KBs |
| `test/adapters/tableau-core.test.mjs` (extend) | `buildInitialBranch` seeds an asserted edge and both endpoints as nodes; the ∀-rule fires across a seeded edge; the ∃-rule reuses a seeded edge as a witness instead of minting a fresh successor |
| `test/adapters/tableau-inverse.test.mjs` (extend) | the 4e motivating example proved from a directly asserted relation rather than through nominals: teach one `contains` edge, declare the inverse, and the `belongs` direction reads off it |
| `test/adapters/tableau-module.test.mjs` (extend) | a role-assertion row is kept when either endpoint is in the closure, and the far endpoint re-seeds its own walk |
| `test/adapters/tableau-transitive.test.mjs` (extend) | a chain of two asserted edges over a declared-transitive role composes for the ∀-rule, and equality blocking still terminates |

### 6.6 Phase A3 acceptance

```
npm run test:fast
node --test "test/adapters/tableau-*.test.mjs"
node --test test/adapters/chat-prove-command.test.mjs
node --test test/corpus/inference.test.mjs
node --test "test/estate/*.test.mjs"
```

---

## 7. Phase A4 — the three corpus rows

`PLAN_SYLLOGIST_EL_DL.md:1441-1447` lists five `inference.dl.*` rows for phase 4's increments. Two
landed. These are the other three, and together they are the acceptance proof that A1, A2 and A3
work through the chat surface rather than only through the module tests.

Rows go in `test/corpus/inference.jsonl`, one JSON object per line, under the schema `validateRow`
enforces in `test/corpus/run-lane.mjs:58-165` and `test/estate/corpus-schema.test.mjs` guards. Each
drives `/prove <question>` against the chat surface, the shape the six shipped `inference.dl.*` rows
already establish.

**Vocabulary discipline.** Every content word must be declared in
`src/domain/grammar/lexicon-core.json`, and both ends of a relation must resolve as individuals — a
declared proper name or a `CODE_REF_SHAPE` token (`ace.mjs:120-122`). The 22 declared proper names are
`tmct, Node, npm, JavaScript, TypeScript, Python, Java, Git, GitHub, GitLab, ESLint, Linux, macOS,
Windows, Polycode` plus the weekdays. `contain` and `touch` are declared verbs minting `tmct:contains`
and `tmct:touches`; `belong` carries the declared override `mgx:partOf`, so it mints that instead —
pick verbs whose minted predicate you have checked rather than assuming the 3sg form. The phase-0
`.different-from` row's own substitution is the precedent: a plan's flavour text is not a promise that
the words are in the lexicon.

| key | id | turns |
|---|---|---|
| `inference.dl.transitive-role` | `inference-dl-transitive-role-propagates-a-universal` | teach *"containing is transitive"*; teach *"every module contains only units"*; teach *"GitHub is a module"*; teach *"GitHub contains GitLab"*; teach *"GitLab contains Polycode"*; ask `/prove is Polycode a unit` → `yes —`, citing the universal restriction and both asserted edges |
| `inference.dl.role-hierarchy` | `inference-dl-subproperty-lets-a-restriction-reach-a-narrower-role` | teach *"containing implies touching"*; teach *"every module touches only units"*; teach *"GitHub is a module"*; teach *"GitHub contains GitLab"*; ask `/prove is GitLab a unit` → `yes —` (the `contains` edge counts as a `touches` edge through the role closure) |
| `inference.dl.inverse-role` | `inference-dl-inverse-role-answers-from-the-recorded-inverse-edge` | teach *"containing is the inverse of belonging"*; teach *"every unit belongs to only modules"*; teach *"GitLab is a unit"*; teach *"GitHub contains GitLab"*; ask `/prove is GitHub a module` → `yes —` (no `mgx:partOf` row is asserted anywhere; the answer rests entirely on reading the `contains` edge backwards) |

Each row asserts on the `/prove` turn: a regex `^yes —`, a regex naming at least one premise the
answer must cite, and the `notMiss` predicate (`test/corpus/predicates-inference.mjs`).

**Check each turn against the real pipeline before committing the row.** Teach the premises in a live
session and read what comes back. Three of the phase-0 rows had to be rewritten after exactly this
check, and the plan recorded each substitution rather than quietly keeping the prettier sentence.

Acceptance:

```
npm run test:fast
node --test test/corpus/inference.test.mjs
node --test --test-name-pattern="^inference-dl-" test/corpus/inference.test.mjs
node scripts/corpus-matrix.mjs
```

---

## 8. Phase B1 — `/prove` as an automatic ask-lane fallback

Goal: a yes/no question that every existing chase missed falls through to a bounded tableau proof, and
nothing else about the turn changes.

### 8.1 Where it goes

Inside the isa reader in `src/services/chat.mjs`, immediately after `deeperChainExists` is computed
(`:11328-11330`) and immediately before `if (knownSubjectIsa.length)` (`:11331`).

That exact point is the only one that dominates every exit from the isa branch, and the reason is
worth stating because the obvious alternative is wrong. The three shapes this fallback exists for
leave the branch three different ways. E3's subject has an `rdf:type` row, so it takes the
`knownSubjectIsa` recovery at `:11331`. E4's subject has only an `owl:disjointWith` row, which is not
in `ISA_PREDICATES` (`:8393`), so it falls past the converse check to `return null` at `:11388`. A
subject the store has never seen takes the branch at `:11378`. Line 11330 is upstream of all three.

Placing it later in `runAsk` does not work. The isa reader returns `{ text, replace: true, miss: true }`
and `runAsk`'s stage 3 handling (`:15273-15351`) moves `via` off `"composed"`, so every later stage —
the teach lane at `:15458`, learn-on-miss at `:15647`, the wall at `:15703` — is gated on
`via === "composed"` and never sees an isa miss that already rendered a recovery.

**Scope: the isa family only.** The trigger reads the same `ISA_ASK_RE` (`:8392`) that `/prove` itself
parses at `:16382`. The `does X have Y` lanes and their own `/classify` offer (`:8953-8959`) are
untouched. That is a real limit on what this phase can flip, and section 10 measures it rather than
predicting it.

### 8.2 The trigger

A miss qualifies when three things hold. All three are cheap and none of them runs the prover.

1. The question parsed through `ISA_ASK_RE`, so a subject and a class exist. Already true at `:11330`.
2. Every live chase above already missed. Already true at `:11330`.
3. **The extracted module is DL-shaped.** New pure helper in `src/domain/tableau.mjs`:

```js
/** Does this module hold any axiom shape the plain subclass chases cannot read?
 *  True when some row's predicate is owl:unionOf, owl:complementOf, owl:oneOf,
 *  owl:allValuesFrom, a cardinality predicate, or a role axiom (transitive
 *  type, rdfs:subPropertyOf, owl:inverseOf). Pure. */
export function moduleHasDlShape(rows) { … }
```

Clause 3 is what keeps the fallback off the hot path in the ordinary case. Without a DL-shaped row the
tableau can only redo the subclass walk the chases just finished, so running it would spend the budget
to reach the same miss. With one, the tableau can reach something they cannot. The check is a single
pass over the already-extracted module rows.

The order of work is: extract the module around the subject and class (`extractTableauModule`), test
`moduleHasDlShape`, and only then `buildTableauKb` and prove. Extraction is bounded by
`DEFAULT_MODULE_HOPS` (`tableau.mjs:224`) and is the cheap half.

### 8.3 What it asks, and what it renders

**Two-sided, proved only.**

1. Prove `subject : C` (or `subClass ⊑ C`, by the same `kb.namedIndividuals` test `/prove` uses at
   `chat.mjs:16396`). `proved` → render yes.
2. If step 1 came back `disproved`, prove the negation: `subject : ¬C`. `proved` → render no.
3. Anything else — both runs `disproved`, either run `exhausted`, or the ex-falso guard below firing —
   leaves the existing miss text byte-identical.

A `disproved` result is never rendered as an answer on this path. The tableau built a model where the
entailment fails, which under the open-world rule means the store does not settle the question. That
is what the honest miss already says. Rendering it as "no" would convert an abstention into a denial,
and the CLINC out-of-scope result is won by not doing that. Step 2 is a different claim: the store
entails the negation, so "no" is grounded. E6's own delivered note proves its "no" exactly this way,
through `proveEntailment(kb, "teal", { t: "not", c: atom("primary-colour") })`.

`/prove` is unchanged. It keeps rendering its counter-model "no" at `chat.mjs:16424`, because a user
who typed a decision procedure's name asked for its verdict.

**The ex-falso guard.** Before rendering a proved verdict, run `findTableauViolations(kb, [subject], opts)`
(`tableau.mjs:1101-1114`). If the subject clashes on its own premises, the tableau proves anything
asked of it and the proof is worthless. Render the clash instead, through the same premise-quoting
path `findWiderConsistencyClash` already uses (`chat.mjs:8974`, rendered at `:8993-8996`).

This is not a hypothetical. `inference.dl.cardinality-clash` asks `/prove is beryl a wheel` and gets a
"yes" citing both restrictions precisely because beryl's class is unsatisfiable. On an explicit
command that is a correct and informative result. Automatic, it would turn every question about an
individual in an inconsistent class into a confident yes. The guard is the same discipline the
shipped cax-dw gate applies ahead of both proof chases, extended to the tableau.

**The return.** A rendered verdict returns `{ text, replace: true }` with no `miss` flag, so
`runAsk`'s stage 3 sets `via = "fact"` and `recordMiss = false` (`:15324-15326`). Premises render
through `renderFactLine`, so provenance and trust read as they do everywhere else. An exhausted run
sets `record.budgetExhausted = true` on the turn, the same marker `/prove` stamps at `:16437`, so
chatbench and infbench can count budget misses apart from parse misses — and then returns nothing, so
the existing recovery text renders untouched.

### 8.4 The budget posture

`prove_steps 5000` / `prove_branches 256` / `prove_nodes 512` (`reasoning-config.mjs:16-18`) are
budgets for a command a user deliberately typed. Spending them on every DL-shaped miss makes an
explicit `/prove --budget` raise slow down every ordinary question, which is the wrong coupling.

**Three new `[reasoning]` knobs**, resolved by the same `resolveReasoningConfig`:
`ask_prove_steps = 1000`, `ask_prove_branches = 64`, `ask_prove_nodes = 128`. The precedent is
already in the tree: `CONSISTENCY_TABLEAU_OPTS = { maxSteps: 200, maxBranches: 16, maxNodes: 32 }` at
`src/adapters/memory/inspect.mjs:14` is a separate, much tighter triple for the whole-store audit, for
the same reason.

**What the default buys.** A thousand steps over a hop-4 module is enough for the disjunction,
complement, nominal and cardinality shapes this plan measures, each of which closes in tens of steps
once the module is small. It is not enough for a deep subclass chain, and it is not meant to be —
`inference.dl.budget-miss` exhausts `prove_branches` at 256 on a 140-link chain, so 64 exhausts
sooner and lands on the same wall. Exhaustion on the hot path costs the user nothing: the answer is
the miss they were already getting.

**A fourth knob, boolean.** `ask_prove_fallback = true`. It has to be boolean rather than a
zero-valued budget, because `clampPositiveInt` (`reasoning-config.mjs:36-39`) rejects zero and
degrades it to the default — setting `ask_prove_steps = 0` would silently turn the fallback back on at
full budget. `resolveReasoningConfig` gains a `clampBoolean(raw, fallback)` beside `clampPositiveInt`
and a small `BOOLEAN_KEYS` set, so a corrupt value degrades to the default rather than throwing, the
same contract every numeric knob has.

### 8.5 The alternatives, and why not

Three real choices, each with a runner-up worth naming.

| decision | chosen | runner-up | why |
|---|---|---|---|
| when it runs | automatic, gated on a DL-shaped module | offer-then-run: extend the recovery ternary at `:11351-11355` with a `/prove` arm | The offer is the established pattern and it is cheaper. It cannot flip a ceiling marker: `driveChat` (`run.mjs:81`) sends premises, one query, `/exit` — there is no turn in which a user takes the offer. An offer would leave the capability exactly as unmeasured as it is now. |
| always-on vs gated | gated | always-on | Always-on spends module extraction plus a proof on every isa miss, including the large majority with no DL-shaped row, to reach the same miss. The gate is one pass over rows already extracted. |
| what "no" means | render only an entailed negation | render a counter-model as "no", the way `/prove` does | A counter-model means "not entailed", and the open-world clause of the constitution is the whole product promise. `/prove` keeps the counter-model render because the command is an explicit request for a decision. |

One more, small enough to note rather than table: exhaustion leaves the existing miss text alone
rather than replacing it with the budget wall. `/prove`'s budget message tells a user which knob to
raise, which is useful when they asked for a proof and useless when they asked a question. The
recovery text they were already getting names something they can actually do.

### 8.6 Phase B1 tests

New file `test/adapters/chat-auto-prove-fallback.test.mjs`:

- E3's premises taught, asked as a plain question, answer with `yes` and both premises cited;
- E4's premises taught, asked plainly, answered (the subject with no isa facts at all, proving the
  insertion point dominates `return null`);
- an entailed negation renders `no`; a counter-model renders the unchanged miss;
- the ex-falso case: an individual whose class carries a min/max clash gets the clash report, never a
  yes;
- a miss whose module has no DL-shaped row is byte-identical to today's, and the prover never ran;
- an exhausted run is byte-identical to today's miss and carries `budgetExhausted`;
- `ask_prove_fallback = false` restores today's text everywhere;
- the `/classify` and `/syllogise` offers still fire on the shapes that earn them.

Extend `test/adapters/reasoning-config.test.mjs` for the four new knobs, including a corrupt boolean
degrading to the default and `ask_prove_steps = 0` clamping to its default rather than disabling
anything.

Corpus rows in `test/corpus/inference.jsonl`:

| key | id |
|---|---|
| `inference.dl.auto-fallback` | `inference-dl-a-missed-question-falls-through-to-a-bounded-proof` |
| `inference.dl.auto-fallback-honest-miss` | `inference-dl-an-ungrounded-question-stays-a-miss-after-the-fallback` |
| `inference.dl.auto-fallback-inconsistent` | `inference-dl-the-fallback-reports-a-clash-instead-of-certifying-from-it` |

### 8.7 Phase B1 acceptance

```
npm run test:fast
node --test test/adapters/chat-auto-prove-fallback.test.mjs
node --test test/adapters/chat-prove-command.test.mjs
node --test test/adapters/reasoning-config.test.mjs test/adapters/toml-config.test.mjs
node --test "test/adapters/chat-*.test.mjs"
node --test test/corpus/inference.test.mjs
node scripts/corpus-matrix.mjs
npm run build:ask-bundle
```

---

## 9. Phase B2 — a by-cases answer names its cases

Today a case-split proof says `in every case, X is a Y.` and stops (`chat.mjs:16412`). A reader cannot
check a case analysis whose cases are not named, and an automatic fallback makes that worse by
producing them without being asked.

### 9.1 Carrying the split out of the engine

`src/domain/tableau.mjs`:

1. **Record the choice.** The ⊔-rule (`applyOrRule`, `:546-575`) already picks a disjunct per branch.
   Record it on the branch as `choices: [{ key, expr, from }]`, appended in the rule's existing fixed
   `canonicalKey` order, so the list is deterministic.
2. **Keep it at the clash.** `search` (`:744-812`) discards per-branch state at `:756` and `:762`.
   Carry each closed branch's `choices` into its clash record alongside `premises`.
3. **Return it.** `proveByRefutation` (`:868-876`) gains a `cases` field beside `premises`: the sorted
   distinct disjunct expressions across closed branches, filtered to those whose `from` names an
   `owl:unionOf` or `owl:oneOf` row. That filter is the same distinction `caseSplit` already draws at
   `chat.mjs:16411` — the ⊑-rule's routine internalization disjunction fires on every proof and is not
   a case analysis.

`cases` is capped by its own small constant and truncation is reported rather than silent, so a proof
that split fifty ways renders one readable sentence instead of a paragraph.

### 9.2 Rendering

Both `/prove` (`chat.mjs:16404-16413`) and the B1 fallback read the same field:

> `yes — every pet is a cat or a dog (source: …); rex is a pet (source: …); rex is not a cat (source: …); in every case — a cat or a dog — rex is a dog.`

When `cases` is empty the conclusion stays `so X is a Y.` unchanged. When it truncated, the phrase
names the count instead of listing beyond the cap.

### 9.3 Phase B2 tests

Extend `test/adapters/tableau-prove.test.mjs`: a union-driven proof returns its disjuncts in
`cases`; a proof with no genuine split returns an empty `cases` even though the ⊑-rule internalized
many disjunctions; two input orders give the same `cases` list; the cap truncates deterministically.

Extend `test/adapters/chat-prove-command.test.mjs` and `chat-auto-prove-fallback.test.mjs`: the
rendered sentence names the disjuncts; a non-split proof is unchanged.

Update `inference.dl.disjunction`'s expectation in `test/corpus/inference.jsonl:237` — its
`in every case, rex is a dog\.` regex is written against the current phrasing and the new phrasing
inserts the case list before the subject.

Acceptance:

```
npm run test:fast
node --test "test/adapters/tableau-*.test.mjs"
node --test test/adapters/chat-prove-command.test.mjs test/adapters/chat-auto-prove-fallback.test.mjs
node --test test/corpus/inference.test.mjs
npm run build:ask-bundle
```

---

## 10. Phase B3 — the infbench regeneration

The ceiling markers are the measurement this plan exists to move. This phase re-runs the bench, reads
what actually happened, and edits the markers to match. It edits nothing before the run.

### 10.1 What should flip, and what to check

`dlDisjunction`, `dlComplement` and `dlNominalEnumeration` drive plain isa questions through the lane
B1 changes, so their expected verdicts should move from `unproven` to `yes`, `yes` and `no`.
`dlCardinalityClash` already expects `inconsistent` and grades the clash rather than a verdict, so
what changes there is whether the engine now admits the clash — which is exactly what B1's ex-falso
guard makes it do.

INF-7 is measured in the same run and claimed by nobody. Its `EL_CEILING` text says EL saturation has
not shipped, which stopped being true at phase 2, and its rows drive `does a N1 have a N3` — the
`DOES_HAVE_ASK_RE` lane, which B1 does not touch. Read its `ceiling/pass` column and report the
number. If the rows pass, flip the marker and note that phase 2 earned it. If they do not, rewrite the
marker text so it describes the current gap rather than a shipped one.

Predicting any of these in the doc would be the same mistake `PLAN_SYLLOGIST_EL_DL.md:1469-1483`
avoided by checking `driveChat` directly instead of assuming `/prove` was enough.

### 10.2 The regeneration steps

```
npm run infbench
node test-benchmarks/infbench/run.mjs --replay
node test-benchmarks/infbench/generate-envelope.mjs
node --test test/bench/infbench.test.mjs test/bench/infbench-kernel.test.mjs test/bench/infbench-chat.test.mjs
```

`npm run infbench` is `generate-cases.mjs && run.mjs` (`package.json:150`). The `--replay` run is the
determinism check. `generate-envelope.mjs` has no npm script and is invoked directly.

**Edit `expect`, `ceiling` and `note` only.** Every template in `generate-cases.mjs` draws from one
shared rng stream, and the file's own comment says appending is what keeps earlier templates
byte-stable. Touching the noun pool or a template's draw order reshuffles every later template's
premises, which turns a three-marker edit into a whole-file diff. Changing a template's `expect`,
`ceiling` or `note` changes those fields and nothing else.

Several `note` strings are stale independently of this plan and get corrected in the same pass:
`generate-cases.mjs:825` says "ACE has no bare-existential teach frame", which pattern 15 fixed;
`:887` says ACE declines "or", which pattern 10 fixed; `:911` says `complementOf` does not exist in
the graph vocabulary, which pattern 11 fixed. A note that describes a gap the repo closed is a
measurement claim that is no longer true.

### 10.3 The write-up

`reports/BENCHMARK_INFERENCE_<version>.md` is hand-authored from the two rollup tables `run.mjs`
prints. No script writes it. `archive/BENCHMARK_INFERENCE_5.0.5.md` is the format template, including
its "Kind 2 — ceiling markers" section (`:123-129`) with the `band | template / variant | rows |
capability that would lift it` columns. Report the before and after for every band this plan touched,
and the budget-exhaustion count as its own line.

Acceptance:

```
npm run infbench
node --test test/bench/infbench.test.mjs test/bench/infbench-kernel.test.mjs test/bench/infbench-chat.test.mjs
node --test test/corpus/bench-smoke.test.mjs
node --test "test/estate/*.test.mjs"
```

---

## 11. Config knobs

Five, and each earns its place.

| knob | where | default | why it exists |
|---|---|--:|---|
| `ask_prove_fallback` | `[reasoning]`, `src/domain/reasoning-config.mjs` | `true` | The off switch. Boolean rather than a zero budget because `clampPositiveInt` (`:36-39`) rejects zero and silently restores the default. |
| `ask_prove_steps` | `[reasoning]` | 1000 | The hot-path step budget, kept apart from `prove_steps` so raising the command's budget does not slow every question. |
| `ask_prove_branches` | `[reasoning]` | 64 | As above, for branches. |
| `ask_prove_nodes` | `[reasoning]` | 128 | As above, for nodes per branch. |
| `maxRoleAssertions` | module constant, `src/domain/tableau.mjs` | 256 | Caps how many asserted edges one KB admits (phase A3). A constant rather than config: it bounds a data structure's size for termination, which is a design decision, not a preference. Applied after sorting so truncation is deterministic. |

**`module_hops` stays a constant.** `PLAN_SYLLOGIST_EL_DL.md:1178` called for `[reasoning] module_hops = 4`,
and it shipped as `DEFAULT_MODULE_HOPS` at `src/domain/tableau.mjs:224` with no config path. Leave it
there. The hop count decides which facts a proof can see at all, so a user lowering it gets misses
that read as engine failures, and a user raising it pays the step budget on TBox internalization
before an interesting rule fires. Promoting it to config is a separate decision with its own
measurement, not a side effect of this plan.

Both new `[reasoning]` keys ride through `normalizeConfig`'s existing pass-through at
`src/adapters/toml-config.mjs:171`, which forwards the whole table untouched, so no adapter change is
needed beyond updating that block's own comment (`:165-170`) which enumerates the eight current keys.

---

## 12. Ownership, concurrency and model tiers

File ownership decides what runs at once. One owner per file per round.

| track | owns | depends on | model |
|---|---|---|---|
| A1-g grammar | `src/domain/grammar/ace.mjs`, `test/adapters/grammar-ace-class-expressions.test.mjs` | — | Sonnet |
| A1-k KB reader | `src/domain/tableau.mjs`, `test/adapters/tableau-kb.test.mjs`, `tableau-module.test.mjs`, `test/adapters/el-normalize.test.mjs` | A1-g's triple shapes, which this document fixes | Sonnet |
| A1-d ontology and docs | `ontology/*`, `docs/references/schemas/*` | — | Haiku |
| A2 subproperty | `src/domain/grammar/ace.mjs`, `ontology/*`, `docs/references/schemas/*`, `test/adapters/tableau-role-hierarchy.test.mjs` | A1-g and A1-d (same files) | Sonnet |
| A3 ABox route | `src/domain/tableau.mjs`, `test/adapters/tableau-{kb,core,inverse,module,transitive}.test.mjs` | A1-k (same file) | Sonnet |
| A4 corpus rows | `test/corpus/inference.jsonl` | A1, A2, A3 | Haiku |
| B1 fallback | `src/services/chat.mjs`, `src/domain/reasoning-config.mjs`, `src/adapters/toml-config.mjs`, `tmct.toml`, `test/adapters/chat-auto-prove-fallback.test.mjs` | A3 (for `moduleHasDlShape`'s home file) | Sonnet |
| B2 case naming | `src/domain/tableau.mjs`, `src/services/chat.mjs`, `test/adapters/tableau-prove.test.mjs` | B1 | Sonnet |
| B3 infbench | `test-benchmarks/infbench/generate-cases.mjs`, `envelope.json`, `cases.jsonl`, `reports/BENCHMARK_INFERENCE_<version>.md` | B2 | Haiku |

**Read-back edits are a `chat.mjs` round.** A1's `renderUniversalRestrictionLine` and A2's
`isRoleScaffoldingDeclaration` both touch `src/services/chat.mjs`. Fold them into whichever `chat.mjs`
round runs next rather than opening two more; they are a few lines each and they have no reader
dependency on the tableau work.

**What runs concurrently.** A1-g, A1-k and A1-d start together: the grammar and the reader meet only
through the triple shape this document fixes, and the docs track touches no code.

**What serializes.** Everything touching `src/domain/tableau.mjs` runs one at a time: A1-k, then A3,
then B2. Everything touching `src/domain/grammar/ace.mjs` runs one at a time: A1-g, then A2.
Everything touching `src/services/chat.mjs` runs one at a time: the A1/A2 read-back round, then B1,
then B2's render. A4 runs after A1, A2 and A3 so its expected answers are real. B3 runs last because it
measures.

**Cross-plan serialization.** `src/services/chat.mjs` has one queue across every live plan, not one per
plan. `PLAN_NEWS_FEED.md`'s phase 4, `PLAN_COMMON_SENSE_QA.md`'s F2/R2/R3/R4, and this plan's
read-back, B1 and B2 rounds interleave in whatever order the coordinator dispatches them, and no two
run at once. `NEXT.md`'s merge note applies to each: rebuild the ask bundle, rerun the pack-manifest
check, and watch for same-name top-level declarations across branches, because esbuild's
duplicate-symbol error at bundle time is the tell.

**Model tiers.** Sonnet is enough for every code track, because this document fixes the triple shapes,
the KB fields, the insertion point and the verdict rules, which is where the design risk lives. Haiku
covers three mechanical tracks: the ontology and docs rows against four verbatim precedents, the
corpus rows, and the infbench marker edits plus the hand-authored report.

Two tracks are worth watching, and if either stalls the answer is a tighter test file rather than a
larger model. A3's edge seeding is the subtlest work here: `buildInitialBranch` has returned
`edges: []` since the engine was written, and every rule assumed it. Write the
`tableau-core.test.mjs` cases for a seeded edge first and let them pin the design. B1's ex-falso guard
is the second: write the inconsistent-subject test before the fallback, so the guard is asserted
rather than remembered.

**Sub-agent discipline.** Every dispatch brief caps testing at `npm run test:fast` plus that track's
own blast radius. The full suite and the e2e tiers are the coordinator's job after the merge. A fresh
worktree has no `corpus/worlds/`, no `corpus/sprites/` and no ask bundle, so every brief says to run
`node scripts/ensure-worlds-pack.mjs`, `node scripts/ensure-sprite-facts.mjs` and
`npm run build:ask-bundle` before any `node --test`.

---

## 13. Costs and risks

- **The fallback runs on the hot path, and the hot path is the product.** The gate is what protects
  it: without a DL-shaped row nothing runs but one pass over already-extracted rows. Measure the
  ordinary-miss path before and after and keep the `test:fast` and `test:smoke` budgets green —
  `npm run check:budgets` enforces them, and a tier that breaks its budget is a bug in the tier.
- **Ex falso is the honesty risk in this plan.** An inconsistent subject makes the tableau prove
  anything, and `inference.dl.cardinality-clash` shows the shape doing it today under an explicit
  command. Automatic, unguarded, it manufactures confident yeses. The guard is not optional and its
  test is written first.
- **A3 widens what counts as an individual.** `individuals` currently comes from type assertions
  alone. Widening it to relation endpoints changes which subjects `/prove` routes to `proveEntailment`
  rather than `proveSubsumption` (`chat.mjs:16396`), so a question that used to be answered as a
  subsumption may now be answered as an entailment. `tableau-prove.test.mjs` and
  `chat-prove-command.test.mjs` are the blast radius, and both run in A3's acceptance.
- **The `else` arm is a wide net over a wide store.** The shipped corpus carries around 63,000 facts,
  many with `mgx:` predicates. The `isIndividualTerm` gate plus `maxRoleAssertions` plus module
  extraction are the three bounds; check the KB size on a real store before trusting them, because a
  KB that grew by an order of magnitude exhausts the step budget before an interesting rule fires and
  the symptom reads as a prover failure.
- **Determinism under seeded edges.** Edge order is a new way for arrival order to leak into a
  verdict. The KB sorts before returning and the branch seeds in that order; the check is feeding one
  fact set in two orders and demanding identical output, the same check `sortFactIndividualsById`
  protects the fact store with.
- **The infbench rng stream is one stream.** Editing a template's draw order rewrites every later
  template's premises. B3 edits `expect`, `ceiling` and `note`, and nothing else.
- **A1 can shrink a module silently.** If `extractTableauModule` is not taught to follow
  `owl:allValuesFrom`, the axiom stores, reads back, passes its KB test, and then never appears in the
  module a real question builds. The module test is what catches it, and it is in A1's acceptance for
  that reason.

---

## 14. Not in this plan

- The `mgx:<lemma>` teach-lane relation spelling. Section 6.4 names the mismatch and the candidate
  mechanism; reconciling it touches every stored `mgx:` fact and belongs in its own round.
- Negated role assertions. Section 6.4 names the nominal encoding as the candidate.
- Batch materialisation of tableau conclusions. A case-split conclusion rests on every branch of its
  proof, and provenance for that shape needs its own design pass. `PLAN_SYLLOGIST_EL_DL.md` section 14
  owns it.
- Widening the fallback past the isa family. The `does X have Y` lanes have their own `/classify`
  offer and their own INF-7 measurement; extending the fallback there is a separate round with its own
  corpus rows.
- Promoting `module_hops` to config. Section 11 gives the reasoning.
- The site and claims surfacing for any of this. `PLAN_SYLLOGIST_EL_DL.md` phase 6 owns that block,
  and it reads the INF-7/INF-8 numbers phase B3 produces.
- Any LLM, in the product path or the measurement path.
