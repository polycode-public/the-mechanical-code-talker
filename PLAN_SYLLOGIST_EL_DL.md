# PLAN_SYLLOGIST_EL_DL.md — beyond OWL 2 RL: an EL classifier, then a DL tableau prover

Status: Phase 0's grammar/ontology/docs/test slice has landed (section 5, except 5.3's
`chat.mjs` teach-lane widening and read-back phrasing, and the corpus rows that depend on it —
both deferred to a later serialized round). Phases 1 through 6 remain DESIGN, nothing built; every
module path in those sections is a file that does not exist yet.
The plan delivers the whole arc — phase 0 representation, the EL classifier, and the DL tableau
through the SHOIQ increments — as one body of work. Where a phase overlaps the cheaper OWL 2 RL
property levers (L7/L8 in `PLAN_NLU_BENCHMARKS.md`, both open), the overlap is stated at that
phase so whichever lands first is visible to the other.

This plan is written to be built by a Sonnet-tier implementer with no further design work. Every
phase names its module paths, its data structures, its function signatures, its test files, its
corpus rows and its acceptance commands. Where a phase needs a different model tier, it says so.

---

## 1. What ships today

`src/domain/syllogise.mjs` (1,768 lines) holds seven inference kernels. Five run in the batch
materialising pass, `syllogise()`. Two are query-rooted and run only as a live read-only chase
from `src/services/chat.mjs`.

| kernel | export | shape | inside OWL 2 RL? |
|---|---|---|---|
| scm-sco | `deriveSubClassClosure`, `deriveSubClassClosureDelta` | (a ⊑ b), (b ⊑ c) ⊨ a ⊑ c | yes |
| cax-sco | `deriveTypePropagation` | (x : C), (C ⊑ … ⊑ D) ⊨ x : D | yes |
| cax-dw | `deriveDisjointViolations` | (x : C1), (C1 ⊥ C2) ⊨ x is not a C2 | yes |
| cls-svf1 | `deriveSomeValuesFromApplication` | (x p y), (y : C), R = ∃p.C ⊨ x : R | yes |
| scm-svf1 | `deriveSomeValuesFromSubsumption` | ∃p.C1 ⊑ ∃p.C2 when C1 ⊑ C2 | yes |
| cardinality monotonicity | `proveCardinalityAtLeast` | (C ⊑ =n p.D or ≥n p.D), n ≥ m ⊨ C has at least m D | no |
| cax-maxc0 | `proveMaxCardinalityZeroDenial` | C ⊑ ≤0 p.D ⊨ no C has a D | no |

The last two step outside RL. The file's own "cardinality monotonicity" section header calls the
first one "outside OWL 2 RL's own decidable profile". `cax-maxc0` is not a W3C rule name. It is a
universal generalization of the real W3C `cls-maxc1` (Table 6): `cls-maxc1` derives `false` for one
individual, `cax-maxc0` derives a class-level negative fact.

Two more exports are not rules. `findConsistencyViolations` detects a single subject whose own
asserted types clash under a stored `owl:disjointWith`. `findIsaChain` is a bounded rooted proof
search that chat uses to cite a chain.

All five batch rules run under the same four guards: BUDGET (max new derivations per pass, plus max
fixpoint rounds for scm-sco), FOCUS (an optional term set scoping derivations), SCREENS (tautology
and dedup against what is already stored), and TRUST (every conclusion writes under an `entailed:*`
provenance tag with prior 0.3, so it never outranks a stated fact).

Retraction is delete-and-rederive, not JTMS. `retractSubClassOf` removes a fact, then walks the
`citedBy` index built from each entailed fact's `mgx:factJustification` environments. Each candidate
is checked three ways, cheapest first: an intact stored environment keeps it, a fresh enumeration
from survivors re-grounds it, and the closure-walking derivability check is the final authority.
`archive/PLAN_SYLLOGIST.md` owns the incrementality and retraction horizon and records what is
already delivered there. This plan does not restate it.

### What the graph can already hold

Every stored fact is an RDF reification written by `appendFact` in `src/adapters/memory/core.mjs`.
`readFactRows(memory)` folds each triple group into one row:

```js
{ id, subject, predicate, object, provenance, trust, observedAt, quantifier,
  environments, justification, sourceIds, sourceTypes, assertions }
```

`subject` and `object` are normalized through `normFactTerm` (CURIE prefix stripped, lowercased).
The predicate keeps its vocabulary casing. The fact id content-addresses the triple, so re-asserting
the same sentence upserts rather than duplicates.

The OWL vocabulary the store actually carries today:

`rdf:type`, `rdfs:subClassOf`, `owl:disjointWith`, `owl:Restriction`, `owl:onProperty`,
`owl:someValuesFrom`, `owl:onClass`, `owl:intersectionOf`, `owl:cardinality`,
`owl:minCardinality`, `owl:maxCardinality`, `owl:hasValue`, plus the `mgx:` relation predicates and
their `mgxneg:` negative twins (`src/domain/memory/capability.mjs`).

`owl:unionOf`, `owl:complementOf`, `owl:oneOf` and `owl:differentFrom` appear nowhere in `src/`.
`owl:oneOf` appears in `ontology/tmct-core.ttl` only inside datatype enumerations for tmct's own
meta-model.

### Where a sentence becomes a fact

Two paths write class axioms, and they run in a fixed order.

**The ACE grammar** is tried first. `src/services/chat.mjs`'s `assertTurn` calls
`assertSentence` (`src/domain/grammar/assert.mjs`), which calls `parseAce`
(`src/domain/grammar/ace.mjs`) and appends every emitted triple under an `ace:chat:<sessionId>@<ts>`
tag. It implements nine patterns, listed in `docs/references/schemas/ace-owl-fragment.md`. It is the
only path that emits real class axioms. Every content word must be declared in
`src/domain/grammar/lexicon-core.json`; an undeclared word makes the parse decline rather than
guess.

**The teach lane** runs only when ACE declines. It is a long ordered `if` chain of regexes in
`src/services/chat.mjs`, each writing through `teachFact` under a `teach:chat:<sessionId>@<ts>` tag.
It mints mostly `mgx:` relation predicates, plus `owl:disjointWith` through `mintNegativeUniversal`
and `mgxneg:subClassOf` through the bare-negative branch.

Read-back goes through `FACT_PREDICATE_PHRASES` in `src/services/chat.mjs` (a flat predicate →
English-phrase table), then `predicatePhrase`, `factPhrase` and `renderFactLine`. The restriction
scaffolding predicates are absent from that table on purpose: a restriction never renders as a plain
fact line, it renders through a dedicated live-chase sentence built from the restriction's own
fields.

---

## 2. The failure edge today — the six worked examples

Each example gives what the graph holds, what the user asks, what happens now, and where it lands
after delivery. Every "today" claim below was re-checked against the code at 5.0.21.

Four of the six already have generated benchmark cases. `test-benchmarks/infbench/` grades bands
INF-1 through INF-8; INF-7 is E1 and E2, INF-8 is E3 and E4. Its `generate-cases.mjs` mints them
from templates `elConstructedRestriction`, `elExistentialChain`, `dlDisjunction` and `dlComplement`,
each row carrying a `ceiling` field naming what would have to ship for the row to move. E5 and E6
have no infbench template yet; phase 0 adds them.

**E1 — nested existential (lands in EL).**
Graph: `heart ⊑ ∃has.valve`, `valve ⊑ flap`. Ask: *"does a heart have a flap?"*

Today: a miss, and it misses one step earlier than the old text said. ACE has no bare-existential
teach frame, so "every heart has a valve" is declined outright. `parseEvery` routes a sentence
containing "has" to `parseCardinality` only when the next token is "at" or "exactly"; otherwise it
looks for "is", finds none, and returns null. The teach lane then reads it through
`QUANTIFIED_HAS_TEACH_RE` and mints a plain `mgx:hasA` relation fact, which carries no restriction.
So the premise never becomes `heart ⊑ ∃has.valve` at all.

There is one route that does store the shape: "every heart has at least 1 valve" goes through
`parseCardinality`, which emits `heart rdfs:subClassOf min-1-valve` plus the restriction node's
`owl:onProperty has`, `owl:minCardinality 1` and `owl:onClass valve` rows. That is ∃has.valve in
cardinality clothing, and phase 1's normalizer reads it as such.

Even with the premise stored, `scm-svf1` cannot close E1: it relates two restriction nodes that were
both independently declared, and `∃has.flap` was never declared.

After phase 0 the bare-existential frame stores the premise directly. After EL, the answer is
"yes — every heart has a valve, and a valve is a flap."

**E2 — existential chain (lands in EL).**
Graph: `heart ⊑ ∃has.valve`, `valve ⊑ ∃has.hinge`. Ask: *"does a heart contain a hinge, somewhere?"*

Today: a miss, for the same premise-storage reason as E1, and because nothing composes two
existentials. The composition also needs the role to be declared transitive, and no teach frame
declares a role property today.

Note the overlap with the cheaper tier: plain `has` transitivity at the assertion level is RL's
`prp-trp`, which is lever L7. The EL-only part is composing it through class expressions that were
never declared, as in E1. Phase 0's transitive-role frame writes the one row both tiers read.

**E3 — disjunction elimination (lands in DL).**
Teach: *"every pet is a cat or a dog"*, *"rex is a pet"*, *"rex is not a cat"*. Ask: *"is rex a dog?"*

Today: a miss, but only the disjunction is missing. The old text said "rex is not a cat" triggers
retraction. It does not, and has not for some time. `RETRACT_NOT_A_RE` matches the sentence, and the
branch behind it stores rather than deletes:

1. If a positive `rex rdf:type cat` or `rex rdfs:subClassOf cat` is stored, it writes
   `rex mgxneg:subClassOf cat` beside it and reports the disagreement.
2. If no positive is stored and the object resolves as a declared lexicon noun, it mints
   `rex owl:disjointWith cat` through `mintNegativeUniversal`.
3. If the store has nothing about the subject at all, it declines by name and stores nothing.

Only "forget that X is a Y" retracts, through `RETRACT_FORGET_RE` and `retractSubClassOf`.

So E3's negative half stores today under path 2, gated on the object being in the lexicon. The
residual phase-0 work is to make an individual-level negative type assertion store without that
gate, and to add `owl:unionOf`. After phase 0 the knowledge is stateable. After DL the prover
answers yes by case elimination, the first tmct conclusion that needs reasoning by cases.

**E4 — complement classes (lands in DL).**
Teach: *"everything that is not aquatic is terrestrial"*, *"a stone is not aquatic"*. Ask: *"is a
stone terrestrial?"*

Today: a miss. `owl:complementOf` does not exist in the graph vocabulary, so the first sentence has
nowhere to land. The second sentence stores as in E3 when the lexicon gate passes.

After phase 0 both store. After DL, yes.

**E5 — contradiction through cardinality interplay (lands in DL).**
Graph: `bicycle ⊑ ≥2 has.wheel` (from "every bicycle has at least 2 wheels"), `beryl rdf:type
bicycle`, and a max-0 wheels restriction on beryl's class.

Today: `proveCardinalityAtLeast` and `proveMaxCardinalityZeroDenial` each work alone from chat's
live chase. Nothing puts them together. `findConsistencyViolations` reads only type edges, subclass
edges and disjointness edges; it never looks at a cardinality restriction, so the min/max clash sits
in the store silently. `findContradictions` in `src/adapters/memory/core.mjs` is a different check
again. It compares object counts per predicate against the resolution table, and reads no
restriction at all.

After DL's qualified-cardinality increment, the consistency pass reports the contradiction and names
both premises.

**E6 — enumerated classes and nominals (lands in DL).**
Teach: *"the primary colours are exactly red, yellow and blue"*. Ask: *"is teal a primary colour?"*

Today: a miss. `owl:oneOf` is unrepresentable for classes.

The enumeration alone does not make the "no" provable. Pure open-world identity never rules out
`teal` being the same individual as `red` under a second name, so nothing stops the question from
sitting unproven even after nominals land. Section 4 states the fix: tmct adopts UNA-lite as a
deliberate decision, so two distinct declared names denote distinct individuals unless `owl:sameAs`
says otherwise, and `teal` and `red` are distinct declared names. Pattern 13 (section 5.2) also
mints pairwise `owl:differentFrom` rows among the enumerated members, so the tableau's inequality
machinery has the stated inequalities the ≤-rule needs.

After phase 0 the enumeration stores, which alone buys the positive half (red, yellow and blue each
get an `rdf:type` row). After DL's nominal increment, "is teal a primary colour" becomes a provable
no, and the rendered answer names UNA-lite as the assumption it leaned on. Closing a class by
enumeration is the route to "no, and I know the complete list", an answer shape tmct has for no
class today.

---

## 3. Where the edge moves after delivery

A budget-exhausted proof and an out-of-scope question must land on the same honest miss wall the
chat surface already has. A tableau timeout is a miss, never a guess. After both stages the edge
sits at:

- **Arithmetic and datatypes.** *"does the bicycle have more wheels than seats?"* compares two
  derived counts. That needs a counting tier neither stage here designs. Candidate engineering
  exists to adopt: SWRL built-ins, Datalog with aggregation. Until a tier is designed these land on
  the honest miss wall.
- **N-ary events and time.** *"alice gave bob a book yesterday; who had the book last week?"* needs
  n-ary relations, fluents and temporal ordering. Candidate literatures: reification, event
  calculus.
- **Defaults and exceptions.** Storage shipped: `archive/PLAN_DEFEASIBLE_NEGATION.md` records the
  `mgxneg:` polarity prefix and source-indexed claims, so a taught "penguins don't fly" is stored
  beside the positive and read as disagreement. The open tier is the reasoning, which means
  resolving a same-source conflict by preferring the more specific rule. Candidate literatures:
  default logic, answer-set programming. Until that lands, a single-source positive and negative is
  surfaced rather than silently coalesced.
- **Budget-exhausted proofs.** Any query whose tableau exceeds its step budget returns "can't prove
  or disprove within budget", surfaced as an honest miss with its own marker so infbench and
  chatbench count it separately from a parse miss.
- **Full FOL, probability, induction.** Research horizons with no generally accepted engineering to
  adopt today. Nothing here depends on them, and their absence is benchmark-observable.

---

## 4. The constitution

These hold for every phase and every module below.

- **Pure JS, no LLM in the product path.** Proof rendering goes through the same template machinery
  as every other answer.
- **Deterministic.** Fixed rule-application order, fixed branch order, no randomization, no wall
  clock, no arrival-order dependence. Feeding the same fact set in two different orders must produce
  the same answer, byte for byte. Sort candidate lists before committing them, exactly as every
  kernel in `syllogise.mjs` already does.
- **$0 per query.** No network, no model, no service.
- **Budget exhaustion is an honest miss.** A prover that runs out of budget returns `exhausted`, and
  the caller renders a miss. It never downgrades to a guess and never reports a partial result as a
  verdict.
- **Open-world.** Nothing may introduce a closed-world assumption outside explicitly enumerated
  (`owl:oneOf`) or explicitly negated knowledge. The CLINC out-of-scope result is won by refusing
  what tmct cannot ground.
- **UNA-lite, stated.** Pure open-world identity does not separate `teal` from `red` — nothing says
  they are different individuals. tmct adopts a Unique Name Assumption in its lite form as a
  deliberate decision, the same status as `owl:oneOf`'s user-asserted closure: two distinct declared
  proper names denote distinct individuals unless `owl:sameAs` asserts they are the same. `owl:sameAs`
  itself stays undeclared vocabulary until a plan needs it, so today every declared name is distinct
  by this rule. The tableau applies it at two points only: the identity side-conditions of the merge
  rules (the ≤-rule's successor merge in increment 4d, the nominal merge in 4c) and clash detection
  (section 8.3) — nowhere else. A rendered answer that leans on UNA-lite says so in words, the same
  way a `oneOf` answer names its closure.
- **Domain purity.** Every new module lives under `src/domain/` and imports nothing non-relative.
  Not a package, not a node builtin. `test/estate/import-layers.test.mjs` fails on the first
  violation and its allowlist may only shrink. Store access is injected through a `store` option,
  the same contract `syllogise()` already uses via `requireStore`.

---

## 5. Phase 0 — representation before inference

Goal: the graph can hold union, complement, enumeration, individual-level negative types,
individual inequality, bare existentials and transitive roles. Everything stores, reads back and
round-trips with zero inference. Useful on its own, and a prerequisite for both stages.

### 5.1 New vocabulary

| predicate | subject | object | meaning |
|---|---|---|---|
| `owl:unionOf` | union node | a member class | repeated rows, one per member |
| `owl:complementOf` | complement node | the negated class | exactly one row per node |
| `owl:oneOf` | the enumerated class | a member individual | repeated rows, one per member |
| `owl:differentFrom` | an individual | another individual | symmetric, stored one direction |
| `owl:TransitiveProperty` | (as `rdf:type` object) | — | `p rdf:type owl:TransitiveProperty` |

Repeated rows for `owl:unionOf` and `owl:oneOf` follow the flat-store convention
`owl:intersectionOf` already uses: the JSON fact store has no RDF lists, so a list flattens to one
row per member. `ontology/tmct-core.ttl` documents the same class expression in proper Turtle list
syntax beside it.

Negative type assertion reuses `owl:disjointWith` with an individual subject. That is the shape
`deriveDisjointViolations` already writes for its own conclusions (`{ subject: x, predicate:
"owl:disjointWith", object: C }`), and the shape `mintNegativeUniversal` already writes from the
teach lane. Reusing it means the shipped cax-dw dedup screen recognises a taught negative as known,
and `FACT_PREDICATE_PHRASES` already renders it as "is not a". Phase 0 adds no new predicate for
this case; it removes the lexicon gate that currently blocks it.

### 5.2 New ACE patterns

**Delivered.** All seven patterns are in `src/domain/grammar/ace.mjs`. Two lexicon nouns the
worked examples need (`terrestrial`, `yellow`) were missing and are now declared in
`lexicon-core.json`. Pattern 15's bare-existential arm covers every plain "every N1 VERB [a] N2"
shape, not just "has", so it now also claims several sentences the teach lane's flat has-a frame
used to own. The corpus rows built on that exact shape were retargeted from "every" to "each" —
`QUANTIFIED_HAS_TEACH_RE` reads the two quantifiers identically, so the taught fact and its
confirmation text are unchanged, and the rows still exercise the teach lane they were written for.

All seven go in `src/domain/grammar/ace.mjs`, beside the existing nine. Each adds a
`PATTERN_<NAME>` constant, an entry in the frozen `PATTERNS` array, a parse function, and a row in
`docs/references/schemas/ace-owl-fragment.md`'s pattern table.

Node names stay readable and deterministic, matching the existing `some-<pred>-<target>` and
`<tag>-<n>-<class>` conventions, so the same sentence always re-emits the same triples and
`appendFact` stays idempotent.

**Pattern 10 — union.** *"every pet is a cat or a dog"*, extending to "or a N4" and so on.

```
u  = `${ns}` + members sorted by local name, joined with "-or-"   e.g. tmct:cat-or-dog
u  rdf:type          owl:Class     kind owl:unionOf
u  owl:unionOf       cat           kind owl:unionOf
u  owl:unionOf       dog           kind owl:unionOf
pet rdfs:subClassOf  u             kind owl:unionOf
```

Sort the members lexicographically by normalized local name before building the node name, so "a cat
or a dog" and "a dog or a cat" mint the same node. Emit the `owl:unionOf` rows in that same sorted
order.

Parse: `parseEvery` already finds the `is` index. When the tail after `is` contains a top-level
"or", split on it, resolve each arm as a noun phrase with `resolveNP`, and require every arm to be a
class (`individual` false). Any arm that fails to resolve makes the whole pattern decline through
`missOrNull`, as every other pattern does.

**Pattern 11 — complement.** *"everything that is not aquatic is terrestrial"*.

```
c  = `${ns}not-aquatic`
c  rdf:type          owl:Class      kind owl:complementOf
c  owl:complementOf  aquatic        kind owl:complementOf
c  rdfs:subClassOf   terrestrial    kind owl:complementOf
```

Parse: leading token "everything", then "that", "is", "not", an optional determiner, a class noun
phrase, then "is", then a class noun phrase. Also accept "everything that is not a N1 is a N2".

**Pattern 12 — negative type assertion.** *"rex is not a cat"* where the subject resolves as an
individual (a declared proper name, or a code-ref shape).

```
rex owl:disjointWith cat    kind owl:disjointWith
```

The class-level form "no N1 is a N2" stays pattern 6, unchanged. The two are separated by
`resolveNP`'s `individual` flag, so no new disambiguation is needed.

**Pattern 13 — enumeration.** *"the primary colours are exactly red, yellow and blue"*.

```
primary-colour owl:oneOf red        kind owl:oneOf
primary-colour owl:oneOf yellow     kind owl:oneOf
primary-colour owl:oneOf blue       kind owl:oneOf
red    rdf:type primary-colour      kind owl:oneOf
yellow rdf:type primary-colour      kind owl:oneOf
blue   rdf:type primary-colour      kind owl:oneOf
red    owl:differentFrom yellow     kind owl:oneOf
red    owl:differentFrom blue       kind owl:oneOf
yellow owl:differentFrom blue       kind owl:oneOf
```

The `rdf:type` rows are the positive half, and they make the enumeration immediately useful to the
five shipped rules with no new inference at all. The `owl:differentFrom` rows are every pairwise
combination of the sorted members — n-choose-2, bounded by the enumeration's own size — minted
because 4d's ≥/≤ merge machinery needs stated inequalities to keep enumerated members distinct under
UNA-lite (section 4). Members sort lexicographically before emission, and the `differentFrom` pairs
follow in the same sorted order (each member against every later member), so re-teaching the same
sentence re-emits the identical triple list. The subject noun phrase folds to its singular lemma
through `lookupNoun`, so "the primary colours" stores under `primary-colour`.

Parse: "the", a plural class noun phrase, "are", "exactly", then a comma or "and" separated list of
noun phrases. `tokenize` already drops commas, so the list is the token run with "and" as the only
separator left.

**Pattern 14 — individual inequality.** *"rex is not whiskers"* where both sides resolve as
individuals.

```
rex owl:differentFrom whiskers    kind owl:differentFrom
```

Pattern 12 requires a determiner plus a class noun after "not". Pattern 14 requires a declared
proper name with no determiner. That split is deterministic and needs no lookahead.

**Pattern 15 — bare existential.** *"every heart has a valve"*, and the general verb form *"every
heart contains a valve"*.

```
r  = `${ns}some-has-valve`                       (or some-<pred>-<target> for a general verb)
r  rdf:type            owl:Restriction   kind owl:someValuesFrom
r  owl:onProperty      tmct:has          kind owl:someValuesFrom
r  owl:someValuesFrom  valve             kind owl:someValuesFrom
heart rdfs:subClassOf  r                 kind owl:someValuesFrom
```

Parse: this is a new arm inside `parseEvery`, tried after the existing `that` and cardinality arms.
`parseCardinality` already claims the sentence when the token after "has" is "at" or "exactly", so
the new arm fires only when the token after the verb is a determiner or a noun. The verb resolves
through `lookupVerb` and the predicate through `predicateOf`, so `${ns}has` is just the case where
the verb is "has".

This is the pattern E1 and E2 have been waiting on. `test-benchmarks/infbench/generate-cases.mjs`'s
INF-7 notes say so directly.

**Pattern 16 — transitive role.** *"containing is transitive"*, *"contains is transitive"*.

```
tmct:contains rdf:type owl:TransitiveProperty    kind owl:TransitiveProperty
```

Parse: a single declared verb token, then "is transitive". Fold the surface form to the verb's
lemma through `lookupVerb` before minting the predicate with `predicateOf`.

### 5.3 Teach-lane changes

**Delivered.**

Two changes in `src/services/chat.mjs`, both narrow.

1. **Drop the lexicon gate on the singular-negation path.** Today the bare-negative branch only
   mints a `owl:disjointWith` exclusion when `lookupNoun(loadLexicon(), object)` resolves. Widen it
   so a subject that resolves as an individual (a code-ref shape, or a term the store already knows
   as an `rdf:type` subject) writes the individual-level negative directly, with no lexicon
   requirement. Keep the existing adjective guard: "zeus is not mortal" must keep declining, so the
   widened arm requires the object to be a term the store already carries as a class, or a declared
   noun, and never a bare adjective.
2. **Add read-back phrasing.** Extend `FACT_PREDICATE_PHRASES`:

   | predicate | phrase |
   |---|---|
   | `owl:unionOf` | `is either` |
   | `owl:complementOf` | `is anything that is not` |
   | `owl:oneOf` | `includes exactly` |
   | `owl:differentFrom` | `is not the same as` |

   A union node needs a sentence, not a row-per-member dump. Add `renderUnionLine(node, members)`
   beside `renderFactLine`, producing *"every pet is a cat or a dog (source: …)"* from the node's
   `rdfs:subClassOf` parent and its sorted members. Same shape for an enumeration:
   `renderEnumerationLine(cls, members)` producing *"the primary colours are exactly red, yellow and
   blue (source: …)"*. Both take the fact rows and return one line; both are pure.

`owl:TransitiveProperty` never renders as a plain fact line. Suppress it in the describe lane the
same way the restriction scaffolding predicates are suppressed.

**Coordination with `PLAN_NEWS_FEED.md`.** News's own phase 1 extraction (`src/domain/fact-phrase.mjs`)
had already landed by the time 0b ran, so the four new phrase rows went into both tables,
byte-identical — `test/domain/fact-phrase.test.mjs`'s pin stays green until news's own phase 4
deletes chat's private copy.

### 5.4 Ontology and docs

**Delivered.** The five terms are documented in `ontology/tmct-core.ttl` section 2 exactly the way
`owl:intersectionOf` already is — a kind-table comment plus a real Turtle documentation example,
not a formal `owl:AnnotationProperty` declaration: OWL's own vocabulary needs no redeclaration in
tmct's ontology, matching the file's own existing convention for every other `owl:` term it uses.

- `ontology/tmct-core.ttl`: declare the five new terms in section 2, with the flat-store convention
  comment for the two repeated-row predicates, matching the existing `owl:intersectionOf` note.
  `test/adapters/grammar-ontology.test.mjs` pins the core vocabulary against this file.
- `docs/references/schemas/ace-owl-fragment.md`: seven new rows in the pattern table, numbered 10
  through 16.
- `docs/references/schemas/owl2-vocabulary.md`: add the five terms to the emitted-vocabulary list.
- `ontology/README.md`: seven new rows in the pattern → kind table.

### 5.5 Phase 0 tests

**Delivered.** `grammar-ace-class-expressions.test.mjs`, the `grammar-ontology.test.mjs` extension,
and `teach-negative-and-enumeration.test.mjs` are all in.

Corpus rows landed: all eight rows below, each checked against the real chat pipeline's actual
current output (not the eventual post-DL answer). Adjustments from the table as written:
`.enumeration` teaches "the metals are exactly copper, iron and tin" rather than "the primary
colours are exactly red, yellow and blue" — `colour` and the separately-declared `colours` are two
distinct lexicon nouns, so the plan's own example mints `primary-colours` (plural) while an "is X a
primary colour" question folds to the singular and misses; `metal`/`metals` has no such collision.
`.bare-existential`'s ask turn stays an honest miss (`does a heart have a valve`) — the
someValuesFrom shape pattern 15 stores has no reader in the does-have ask lane yet, which is exactly
what phase 2 wires up. `.different-from` substitutes too: pattern 14 fires only on resolveNP's own
narrow `individual` flag (a declared proper name or a code-ref shape), which "rex"/"whiskers" are
neither — the row teaches "GitHub is not GitLab" (both declared proper names) instead, matching what
the pattern actually accepts today.

| file | what it holds |
|---|---|
| `test/adapters/grammar-ace-class-expressions.test.mjs` | one test per new pattern: the exact triple list emitted, node-name determinism (same sentence twice, same names), member sort order, and the decline path for an undeclared word |
| `test/adapters/teach-negative-and-enumeration.test.mjs` | the widened individual-negative path stores; the adjective guard still declines; "forget that X is a Y" still retracts and the bare negative still does not; the four new read-back phrasings; `owl:TransitiveProperty` stays out of the plain fact-line describe lane; `renderUnionLine`/`renderEnumerationLine` compose their sentence deterministically regardless of row order |
| `test/adapters/grammar-ontology.test.mjs` | extended: the five new terms are declared in `tmct-core.ttl` |

New corpus rows in `test/corpus/inference.jsonl`, one JSON object per line. Row contract is enforced
by `validateRow` in `test/corpus/run-lane.mjs` and guarded by `test/estate/corpus-schema.test.mjs`:
`id`, `key`, `turns`, `expect`, optional `note` and `setup`.

| key | id | turns |
|---|---|---|
| `inference.represent.union` | `inference-represent-union-stores-and-reads-back` | teach "every pet is a cat or a dog", ask "what is a pet" |
| `inference.represent.complement` | `inference-represent-complement-stores-and-reads-back` | teach "everything that is not aquatic is terrestrial", ask "what do you know about terrestrial" |
| `inference.represent.enumeration` | `inference-represent-enumeration-stores-members-as-types` | teach "the primary colours are exactly red, yellow and blue", ask "is red a primary colour" (yes, from the `rdf:type` rows alone; the pairwise `owl:differentFrom` rows are asserted directly by `grammar-ace-class-expressions.test.mjs`, not here) |
| `inference.represent.negative-type` | `inference-represent-negative-type-stores-without-a-lexicon-entry` | teach "rex is a pet", teach "rex is not a cat", ask "is rex a cat" |
| `inference.represent.different-from` | `inference-represent-different-from-stores` | teach "rex is not whiskers", ask "what do you know about rex" |
| `inference.represent.bare-existential` | `inference-represent-bare-existential-mints-a-restriction` | teach "every heart has a valve", ask "does a heart have a valve" |
| `inference.represent.transitive-role` | `inference-represent-transitive-role-stores` | teach "containing is transitive", ask "what do you know about contains" |
| `inference.represent.bare-negative-never-retracts` | `inference-represent-bare-negative-keeps-the-positive` | teach "rex is a cat", teach "rex is not a cat", ask "is rex a cat" (both stored, disagreement reported) |

**Delivered**, both appended after every earlier template in `generateCases()`'s own template list
(not physically beside `dlDisjunction`/`dlComplement` in that list — every template shares one rng
stream, and the file's own comment is explicit that appending is what keeps every earlier
template's cases byte-stable across a regeneration; the function bodies do sit beside `dlDisjunction`
and `dlComplement` in the file). Both stay at today's honest floor, `expect.verdict: "unproven"`
(`dlNominalEnumeration`) matching `dlDisjunction`/`dlComplement`'s own convention, or the
`checkType: "inconsistent"` shape `dlDisjointProofSoundness` already uses (`dlCardinalityClash`,
whose grader never reads `expect.verdict` at all) — not the eventual `inconsistent`/`no` verdicts
this section names, which are what each `ceiling` field is measured against once Stage DL ships.
Regenerating `cases.jsonl` also picked up the two lexicon nouns 5.2 added: every template drawing
from the shared noun pool reshuffles around them, so most of the file's premises read differently
even though every band's case count is unchanged.

Add two infbench templates in `test-benchmarks/infbench/generate-cases.mjs`, beside `dlDisjunction`
and `dlComplement`, so E5 and E6 are measured from the same run as E1 through E4:

- `dlCardinalityClash`, band INF-8, premises *"every bicycle has at least 2 wheels"*, *"every
  bicycle has at most 0 wheels"*, *"beryl is a bicycle"*, query *"is beryl a bicycle"*, expected
  verdict `inconsistent`. `ceiling`: qualified cardinality in Stage DL.
- `dlNominalEnumeration`, band INF-8, premises *"the primary colours are exactly red, yellow and
  blue"*, query *"is teal a primary colour"*, expected verdict `no`. `ceiling`: nominals in Stage
  DL plus phase-0 `oneOf` representation.

Regenerate `cases.jsonl` with `node test-benchmarks/infbench/generate-cases.mjs` and update
`envelope.json` through `generate-envelope.mjs`.

### 5.6 Phase 0 acceptance

```
npm run test:fast
node --test test/adapters/grammar-ace-class-expressions.test.mjs
node --test test/adapters/teach-negative-and-enumeration.test.mjs
node --test test/adapters/grammar-ace.test.mjs test/adapters/grammar-assert.test.mjs test/adapters/grammar-ontology.test.mjs
node --test test/adapters/interpret-ace-strategy.test.mjs
node --test "test/estate/*.test.mjs"
node --test test/corpus/inference.test.mjs
node scripts/corpus-matrix.mjs
node --test test/bench/infbench.test.mjs test/bench/infbench-kernel.test.mjs test/bench/infbench-chat.test.mjs
```

New tests go in `test/adapters/`, never in `test/fast/` or `test/smoke/`. Those two tiers have
wall-clock budgets that `npm run check:budgets` enforces, and a tier that breaks its budget is a bug
in the tier.

---

## 6. Phase 1 — the EL saturation classifier

**DELIVERED** — sections 6.1 through 6.5 shipped in `src/domain/el-classify.mjs`: normal-form
reading, the seven completion rules, batch and query-mode goal minting, and the materialising pass.
All of 6.6 shipped: `src/domain/reasoning-config.mjs`, the `[reasoning]` pass-through in
`src/adapters/toml-config.mjs`, `tmct classify` (`src/domain/cli-verbs.mjs`, `bin/tmct.mjs`, the
`classify` npm script), and `/classify <term>` in `src/services/chat.mjs`. Tests per 6.7 landed: `el-normalize`,
`el-saturate`, `el-goals`, `el-classify-pass`, `el-entailment-fixtures` (21 fixture rows, one or
more per completion rule) in `test/adapters/`, plus `test/fixtures/el-entailments.jsonl`.

New module: **`src/domain/el-classify.mjs`**. Imports `./hash.mjs` and `./syllogise.mjs` only. Both
relative, both domain, so the layer checker stays green.

ELK-style: normalize the TBox to EL canonical forms, then saturate with the completion rules to a
fixpoint. Polynomial. Same operational shape as `syllogise()`: a batch pass off the hot path, budget
and focus caps, deterministic ordering, conclusions written under `entailed:el-*` provenance,
retractable by provenance.

### 6.1 Normal forms

Four forms, following Baader, Brandt and Lutz, *Pushing the EL Envelope* (IJCAI 2005). `A`, `A1`,
`A2`, `B` are concept names, `⊤` or `⊥`.

```js
// NF1  A ⊑ B
{ form: "sub", sub: "heart", sup: "organ", from: ["fact:…"] }
// NF2  A1 ⊓ A2 ⊑ B          subs sorted, always length 2
{ form: "and", subs: ["cat", "dog"], sup: "bot", from: ["fact:…"] }
// NF3  A ⊑ ∃r.B
{ form: "someRight", sub: "heart", role: "has", filler: "valve", from: ["fact:…"] }
// NF4  ∃r.A ⊑ B
{ form: "someLeft", role: "has", filler: "flap", sup: "some-has-flap", from: ["fact:…"] }
```

`from` is the ordered list of stored fact ids the axiom came from. It is what makes a derived
conclusion's justification real rather than decorative.

Two reserved names: `"top"` and `"bot"`. Neither can collide with a stored term, because
`normFactTerm` never produces them from a class noun and the normalizer rejects a graph that
declares either.

### 6.2 Reading the store into normal form

```js
/** Fold stored fact rows into normalized EL axioms. Pure, no I/O.
 *  Returns { axioms, roleAxioms, concepts, roles, restrictionOf, truncated }. */
export function normalizeElTBox(rows, { budget = 500 } = {}) { … }
```

The five stored shapes it recognises, in this order:

1. `A rdfs:subClassOf B` where `B` is not a restriction node → NF1.
2. `A rdfs:subClassOf R` where `R` carries `owl:onProperty p` and `owl:someValuesFrom C` → NF3
   `A ⊑ ∃p.C`, plus NF4 `∃p.C ⊑ R` so the restriction node itself stays a named concept.
3. `A rdfs:subClassOf R` where `R` carries `owl:onProperty has`, `owl:onClass C`, and either
   `owl:minCardinality n` or `owl:cardinality n` with `n ≥ 1` → NF3 `A ⊑ ∃has.C`, plus NF4
   `∃has.C ⊑ R`. This is the cardinality-as-existential bridge, and it is what lets the shipped
   pattern-5 frame feed EL. Reuse `buildCardinalityRestrictions` from `syllogise.mjs` to reconstruct
   the records.
4. `I owl:intersectionOf M1`, `I owl:intersectionOf M2`, `I rdfs:subClassOf B`. Members that are
   atomic give NF2 `M1 ⊓ M2 ⊑ B`. A member that is a restriction node is already a named concept by
   rule 2 or 3, so it needs no fresh name. An intersection of more than two members folds left into
   a chain of NF2 axioms over deterministic intermediate names `${m1}-and-${m2}`, members sorted.
5. `A owl:disjointWith B` → NF2 `A ⊓ B ⊑ ⊥`. This is EL⊥, and it is what lets the classifier prove a
   "no" and detect an unsatisfiable class.

`roleAxioms` carries `{ kind: "transitive", role, from }` from `p rdf:type owl:TransitiveProperty`,
and `{ kind: "sub", sub, sup, from }` from `p rdfs:subPropertyOf q` when lever L7 lands that row.

`restrictionOf` is a `Map` from restriction node id to `{ role, filler }`, so the write path can
re-emit a restriction's scaffolding.

`truncated` is true when the row count exceeded `budget`. A truncated normalization still returns
what it built; the saturation below just sees less.

### 6.3 The completion rules

State is two indexes:

- `subsumers: Map<conceptName, Set<conceptName>>` — `S(A)`, every named concept `A` is known to be
  subsumed by.
- `roleEdges: Map<roleName, Set<"A␟B">>` — `R(r)`, every pair with `A ⊑ ∃r.B`.

Seven rules, applied in this fixed order every round. Each names its inputs and its output.

| rule | inputs | output |
|---|---|---|
| CR0 init | every concept name `A` | add `A` and `top` to `S(A)` |
| CR1 | `A' ∈ S(A)`, NF1 `A' ⊑ B` | add `B` to `S(A)` |
| CR2 | `A1 ∈ S(A)`, `A2 ∈ S(A)`, NF2 `A1 ⊓ A2 ⊑ B` | add `B` to `S(A)` |
| CR3 | `A' ∈ S(A)`, NF3 `A' ⊑ ∃r.B` | add `(A, B)` to `R(r)` |
| CR4 | `(A, B) ∈ R(r)`, `B' ∈ S(B)`, NF4 `∃r.B' ⊑ C` | add `C` to `S(A)` |
| CR5 | `(A, B) ∈ R(r)`, `bot ∈ S(B)` | add `bot` to `S(A)` |
| CR6 | `(A, B) ∈ R(r)`, role axiom `r ⊑ s` | add `(A, B)` to `R(s)` |
| CR7 | `(A, B) ∈ R(r)`, `(B, C) ∈ R(r)`, `r` transitive | add `(A, C)` to `R(r)` |

```js
/** Saturate the normalized TBox to a fixpoint. Pure, no I/O.
 *  Returns { subsumers, roleEdges, unsatisfiable, derivationOf, rounds, truncated }. */
export function saturateEl(normalized, { budget = 2000, rounds = 64, focus = null } = {}) { … }
```

`derivationOf` is a `Map` from `"A␟B"` (a derived subsumption) to the ordered premise fact-id list of
the FIRST derivation that produced it. First-derivation-wins is deterministic given a fixed rule
order and a sorted worklist, so the same fact set always yields the same justification.

`unsatisfiable` is the sorted array of concept names with `bot ∈ S(A)`. Those are reported, never
materialised. An unsatisfiable class is a consistency finding, and phase 5 surfaces it.

Determinism rules the implementer must follow, matching what `syllogise.mjs` already does:

- Every iteration over a `Map` or `Set` goes through a sorted array first.
- The worklist is a FIFO queue, seeded in sorted concept order.
- Each round collects its additions from a snapshot, sorts them, then commits. No read during
  mutate.
- `budget` counts committed additions across the whole pass. `rounds` bounds the fixpoint loop. Hit
  either and `truncated` is true.
- `focus`, when given, is a `Set` of normalized terms; a rule only fires when one of the concepts it
  touches is in the set. No focus means whole graph, exactly as `normalizeFocus` handles it today.

### 6.4 Goal axioms — how E1 actually closes

Plain saturation never derives `heart ⊑ ∃has.flap`, because `∃has.flap` is not a concept in the
TBox. That expression has to be introduced as a goal before the rules can reach it. This is the
piece that makes E1 work, and it has two modes.

**Batch mode.** Minting goals from the store's asserted `rdfs:subClassOf` ancestor chain misses an
ancestor that only appears once saturation runs — a subsumer CR2 or CR4 derives rather than one NF1
states directly. Query mode does not have this problem, because `proveElSubsumption` saturates with
its one goal already in the mix. Batch mode needs the same information before it can mint a matching
goal, so it saturates twice.

First, saturate the plain TBox with no goals at all, using the routine section 6.3 above already
builds, to get each concept's real subsumer set `S(A)`. Second, for every NF3 axiom `A ⊑ ∃r.B`, mint
a goal NF4 axiom `∃r.B' ⊑ X` for every `B'` in `S(B)` from that first pass — not the asserted
ancestor closure — where `X` is the deterministic name `some-${r}-${B'}`. Third, saturate again with
the goals added, so they actually fire. That is exactly the E1 shape, and it is bounded: the goal
count is the number of NF3 axioms times the average subsumer-set size, capped by its own budget.

One re-saturation is enough for every shape this plan covers: a goal only ever reads an
already-saturated `S(B)`, so nothing the second saturation derives can change which goals the third
pass would have wanted to mint. A future rule family that let a goal's own conclusion feed back into
which goals get minted would need another round; none of the seven completion rules in section 6.3
do that.

```js
/** Mint the bounded goal set for a batch pass, from the already-saturated `subsumers`
 *  index a first `saturateEl` pass built — not the raw normalized TBox. Pure. Returns
 *  an array of NF4 axioms. */
export function elGoalAxioms(normalized, subsumers, { budget = 200 } = {}) { … }
```

**Query mode.** One goal, minted from the question.

```js
/** Mint the single goal axiom for "does a <sub> <role> a <filler>?". Pure.
 *  Returns { axiom, name }. */
export function elGoalFor(role, filler) { … }

/** Bounded query-rooted EL proof. Normalizes, adds the one goal, saturates, and
 *  reports whether `sub` acquired the goal name. Pure, no I/O.
 *  Returns { proved: true, premises } | { proved: false, exhausted } */
export function proveElSubsumption(rows, sub, { role, filler }, { budget = 2000, rounds = 64 } = {}) { … }
```

E1 traced through: NF3 `heart ⊑ ∃has.valve` gives `(heart, valve) ∈ R(has)` by CR3. NF1
`valve ⊑ flap` gives `flap ∈ S(valve)` by CR1. The goal NF4 `∃has.flap ⊑ some-has-flap` fires CR4:
`(heart, valve) ∈ R(has)`, `flap ∈ S(valve)`, so `some-has-flap ∈ S(heart)`. Answer: yes.

E2 traced through: NF3 `heart ⊑ ∃has.valve` and `valve ⊑ ∃has.hinge` give `(heart, valve)` and
`(valve, hinge)` in `R(has)`. With `has` declared transitive, CR7 gives `(heart, hinge) ∈ R(has)`.
The goal `∃has.hinge ⊑ some-has-hinge` then fires CR4. Answer: yes.

### 6.5 The materialising pass

```js
export const EL_SUBSUMPTION_RULE = "elSubsumption";
export const ENTAILED_EL_PROVENANCE = `entailed:${EL_SUBSUMPTION_RULE}`;
export const EL_RESTRICTION_RULE = "elRestriction";
export const ENTAILED_EL_RESTRICTION_PROVENANCE = `entailed:${EL_RESTRICTION_RULE}`;
/** Same sub-1 discount as CAX_DW_RULE_CONFIDENCE, same reason. */
export const EL_RULE_CONFIDENCE = 0.95;
export const DEFAULT_EL_BUDGET = 2000;
export const DEFAULT_EL_ROUNDS = 64;

/**
 * Run one bounded EL classification pass over the memory graph under `repoDir`.
 * Normalizes, saturates once to find real subsumers, mints batch goals from that
 * saturation, saturates again with the goals in place, and materialises each new
 * named subsumption via `appendFacts` under its entailed provenance.
 *
 * opts: `budget`, `rounds`, `focus`, `maxEnvironments`, `store` (REQUIRED —
 * { loadMemory, readFactRows, appendFacts }).
 *
 * Returns { derived, count, budget, rounds, truncated, unsatisfiable, goalCount }.
 */
export async function classifyEl(repoDir, {
  budget = DEFAULT_EL_BUDGET, rounds = DEFAULT_EL_ROUNDS, focus = null,
  maxEnvironments = DEFAULT_MAX_ENVIRONMENTS, store,
} = {}) { … }
```

What it writes:

- `A rdfs:subClassOf B` for every `B ∈ S(A)` where `B` is a concept the graph already names, `B ≠ A`,
  `B ≠ top`, and the row is not already stored. Provenance `entailed:elSubsumption`,
  `justification: [derivationOf.get("A␟B")]`, `premiseTrusts` from the premise rows,
  `ruleConfidence: EL_RULE_CONFIDENCE`.
- `A rdfs:subClassOf X` where `X` is an introduced restriction name. Provenance
  `entailed:elRestriction`, and the pass writes `X`'s scaffolding rows alongside
  (`X rdf:type owl:Restriction`, `X owl:onProperty r`, `X owl:someValuesFrom B`) under the same
  provenance, so a later reader and the shipped cls-svf1 and scm-svf1 kernels see a well-formed
  restriction.

What it does not write: an unsatisfiable concept. Those come back in `unsatisfiable` for phase 5.

Justification: an EL conclusion carries exactly one environment. `syllogise()`'s alternate-discovery
step enumerates support only for the predicates its own rule families own, so it will not grow an EL
conclusion's environment set. An EL-aware enumerator is a later increment; `retractSubClassOf`'s
boolean backstop keeps retraction correct in the meantime, because the closure walk re-verifies
every candidate rather than trusting the citation.

Trust: `min(premiseTrusts) × EL_RULE_CONFIDENCE`, computed by the existing `entailedTrustFrom` hook,
so an EL conclusion stays strictly below its weakest premise.

### 6.6 CLI verb, chat command, config

**CLI.** Add one entry to `CLI_VERBS` in `src/domain/cli-verbs.mjs`, directly after the `syllogise`
entry, in the same shape:

```js
{
  mode: "classify",
  errorLabel: "classify",
  usage: "tmct classify [--repo <abs>]",
  prose: ["EL classification (offline maintenance job): saturation-based TBox"],
  flags: [
    { flag: "[--budget <n>] [--rounds <n>]", prose: ["classification that reaches class expressions the graph never"] },
    { flag: "[--config <path>]", prose: ["declared as nodes, writing bounded, low-trust, retractable", "entailed facts (never on the chat path)"] },
  ],
},
```

`dispatchableModes()` and `renderUsage()` pick it up with no further change. Add the dispatch block
in `bin/tmct.mjs`'s `main()`, modelled line for line on the `syllogise` block: same `numFlag` helper,
same `resolveRuntimeConfig`, same `openMemoryBackend` and `finally { await closeMemoryStore() }`,
same one-line stdout summary. Add `"classify": "node --disable-warning=ExperimentalWarning bin/tmct.mjs classify"`
to `package.json`'s scripts, matching the `syllogise` wrapper.

**Chat — deferred to the serialized `chat.mjs` wave.** Add `/classify <term>` to `runCommand`'s if-chain in `src/services/chat.mjs`, directly
after the `/syllogise` branch and modelled on it: refuse without an argument, build the focus set
through `factTermVariants(normFactTerm, argText)`, call `classifyEl`, list the derived facts, state
the budget wall when `truncated`, and close with the "these are derived, not taught" line. Add its
row to `helpText()`.

**Config.** Add a `[reasoning]` section to `tmct.toml` and a pure resolver.

```toml
[reasoning]
syllogise_budget = 50       # syllogise() budget
syllogise_depth = 32        # syllogise() depth
classify_budget = 2000      # classifyEl() budget
classify_rounds = 64        # classifyEl() rounds
max_environments = 4        # shared environment-set cap
prove_steps = 5000          # tableau step budget, phase 3
prove_branches = 256        # tableau branch budget, phase 3
prove_nodes = 512           # tableau nodes-per-branch budget, phase 3
```

New module **`src/domain/reasoning-config.mjs`**, following the `src/domain/game-config.mjs`
precedent: it exports the default constants and `resolveReasoningConfig(toml)`, which fills every
unset key from those constants and clamps each to a positive integer. Add `reasoning` to
`normalizeConfig`'s pass-through list in `src/adapters/toml-config.mjs`, beside `research` and
`discourse`. An absent `tmct.toml` yields the defaults, which is the state
`loadTomlConfig` already returns `null` for.

CLI flags still win over the file, and the file wins over the defaults, through `mergeEffective`'s
existing precedence.

**Default budget posture.** `classify_budget = 2000` is a bounded maintenance pass, not a
full-corpus closure, and `tmct classify` with no `--budget` is expected to report `truncated: true`
every time it runs unfocused against the shipped corpus, about 63,000 facts today: normalizing that
many rows alone can spend the whole budget before saturation gets a single round. That is the
intended default, the same posture `tmct syllogise` already has, not a number to raise away from —
`classify` with no term argument is for a focused slice, not a standing full-graph pass. The
truncation line names the flag directly, matching `/syllogise`'s existing wording: `budget of 2000
reached — more may follow; run \`tmct classify --budget <n>\` for a wider pass.` For a genuine
full-corpus closure: budget has to cover normalizing every row once, roughly one unit per stored
fact, so about 63,000 for today's corpus, plus the saturation rounds after it — `--budget 100000
--rounds 128` is the arithmetic starting point for the shipped corpus size, re-estimated as the
corpus grows.

### 6.7 Phase 1 tests

| file | what it holds |
|---|---|
| `test/adapters/el-normalize.test.mjs` | one test per stored shape → normal form, including the cardinality-as-existential bridge and the ⊥ form from `owl:disjointWith`; the >2-member intersection fold; the `truncated` flag |
| `test/adapters/el-saturate.test.mjs` | one test per completion rule CR1–CR7, each with a positive and a control case; order-independence (feed the axioms in two different orders, demand identical output); budget and rounds truncation; the unsatisfiable report |
| `test/adapters/el-goals.test.mjs` | batch goal minting is bounded and deterministic; `elGoalFor` names match the batch names; E1 and E2 close through `proveElSubsumption`; a subsumer that only appears after CR2 saturation, not in the plain asserted ancestor chain, still gets its goal minted and materialises in a batch pass |
| `test/adapters/el-classify-pass.test.mjs` | `classifyEl` writes the right rows with the right provenance, trust and justification; a second pass derives nothing new (idempotence); restriction scaffolding is written; a store missing a required function throws a loud construction error |
| `test/adapters/el-entailment-fixtures.test.mjs` | the EL entailment fixture set, below |

**Entailment fixtures.** There is no OWL conformance harness in this repo. `src/tools/conformance.mjs`
is the provider-interface contract kit and has nothing to do with OWL. So phase 1 authors its own
fixture set at `test/fixtures/el-entailments.jsonl`, one object per line:

```json
{"id":"el-cr4-nested-existential","axioms":[["heart","rdfs:subClassOf","some-has-valve"],["some-has-valve","owl:onProperty","has"],["some-has-valve","owl:someValuesFrom","valve"],["valve","rdfs:subClassOf","flap"]],"ask":{"sub":"heart","role":"has","filler":"flap"},"expect":"proved"}
```

Draw the cases from the W3C OWL 2 EL profile's own entailment examples and from *Pushing the EL
Envelope*'s worked rules, one fixture per completion rule plus the six examples in section 2 that
land in EL. Twenty to thirty rows is enough; the point is per-rule coverage, not volume.

### 6.8 Phase 1 acceptance

```
npm run test:fast
node --test "test/adapters/el-*.test.mjs"
node --test test/adapters/syllogise.test.mjs
node --test test/adapters/cli-verbs.test.mjs test/adapters/toml-config.test.mjs test/adapters/config.test.mjs
node --test "test/estate/*.test.mjs"
npm run check:budgets
```

---

## 7. Phase 2 — wire EL into the ask lanes

**DELIVERED**, in `src/services/chat.mjs`. Revises this section's own opening claim — "no
query-time changes to the ask engine at all" didn't hold, item 3 below is exactly such a change,
found necessary while making the corpus rows below actually pass.

1. **The auto-fold hook.** `synthesiseAroundTerm` (the focused `syllogise` fold sibling a
   learn-on-miss load already runs) now runs a focused `classifyEl` pass beside it, off the same
   seed focus term set and budgeted from `resolveReasoningConfig`. The two passes are independently
   failure-tolerant — a miss in either never disturbs the other or the answer the load already
   composed.
2. **Focus expansion for `classifyEl`.** `classifyEl`'s own focus gate takes its input as given —
   unlike `syllogise`'s `expandFocus`, it has no expansion step of its own, so a `/classify heart`
   seeded on "heart" alone never reached a second premise's own subject (e.g. "valve" in "every
   valve is a flap"), and a chained restriction never closed. `elClassifyFocus` (new, pure) walks
   the `rdfs:subClassOf` graph forward from the seed terms, following every someValuesFrom
   restriction onto its filler and continuing from there, bounded by a hop count. Both `/classify`
   and the auto-fold hook use it.
3. **The ask-lane existential reader.** `DOES_HAVE_ASK_RE`'s existing block only ever read a direct
   `mgx:hasA`/`tmct:has` fact, never a `subClassOf`-to-restriction shape — "does a heart have a
   valve" stayed a miss even for a directly taught bare-existential premise, with no classification
   involved at all. `restrictionExistentialHit` (new) reads a taught or EL-entailed someValuesFrom
   restriction reachable from the subject and cites the taught premises an entailed hit composed
   through (its own `justification`), not just its single entailed row; `DOES_HAVE_ASK_RE`'s block
   tries it after its direct-fact/⊑-lift checks fail. A sibling regex, `DOES_EXISTENTIAL_ASK_RE`,
   answers the same shape for any other verb ("does a heart contain a hinge") — the chase is
   role-agnostic by design, since the store carries no per-verb sense distinction yet.
4. **Provenance rendering.** `citationProvenance`/`renderFactLine` already handled every
   `entailed:*` tag generically (stripping `#node:…`, an "i learned: …" fallback); `entailed:
   elSubsumption` and `entailed:elRestriction` read cleanly through that same path with no new case
   needed, confirmed by `chat-el-lane.test.mjs` and by `/memory`'s own provenance listing.
5. **The miss message.** The "is X a Y" ladder's own `/syllogise` recovery offer now names
   `/classify` instead whenever the subject's own remembered isa facts include a someValuesFrom
   restriction — `/syllogise`'s plain scm-sco chase never composes a class expression, so it is
   never offered for a gap only `/classify` can close. `restrictionExistentialHit`'s own miss path
   offers `/classify <subject>` the same way for a "does X have/verb Y" question whose subject has
   some restriction on record that just doesn't reach the asked filler — but never for a
   cardinality restriction (`owl:maxCardinality`/`minCardinality`/`cardinality`, no someValuesFrom
   of its own): `classifyEl`'s rules don't touch that shape, and the cardinality live chases in
   `factReadBackReaders` are the ones meant to answer it, including a provable "no".

New test file `test/adapters/chat-el-lane.test.mjs`: the auto-fold hook fires and cites both
premises, it writes nothing for a term with no existential chain to classify, a directly taught
restriction answers with no classify pass needed, provenance renders cleanly, the shape-only
reader answers a verb the classifier never saw, and an untaught filler stays an honest miss.

Corpus rows landed in `test/corpus/inference.jsonl`, plus the phase-0
`inference.represent.bare-existential` row's own expectation flipped from an honest miss to a
direct "yes" — exactly the reader gap item 3 above closes:

| key | id | shape |
|---|---|---|
| `inference.el.nested-existential` | `inference-el-nested-existential-answers-through-a-constructed-restriction` | teach "every heart has a valve", teach "every valve is a flap", run `/classify heart`, ask "does a heart have a flap" → yes, both premises cited |
| `inference.el.existential-chain` | `inference-el-existential-chain-composes-through-a-transitive-role` | a transitive role composes two existentials; the ask uses "contain", a verb the classifier never saw |
| `inference.el.honest-miss` | `inference-el-untaught-filler-stays-an-honest-miss` | teach only the first premise, ask the E1 question → not a yes |
| `inference.el.budget-wall` | `inference-el-budget-exhaustion-reads-as-a-miss` | a `setup.facts`-preloaded chain long enough to exhaust the default classify budget on its own pairwise closure → truncates, the follow-up stays honest |

The budget-wall row reaches truncation through the default budget's own combinatorial cost (a few
reached chain concepts pairwise-close through the rest of a long `subClassOf` chain), not a
lowered `[reasoning]` config: `memoryDir` is an opaque store handle in a real chat session
(`createSession`'s own `openMemoryBackend` result), not a filesystem path, so there is no repo root
to read a `tmct.toml` override from at that layer. `resolveReasoningConfigForRepo` (new) reads one
when `memoryDir` genuinely is a path — the common case for a direct `runTurn` caller, including
every test in this file — and degrades to the shipped defaults otherwise, matching `/classify`'s
prior behaviour exactly for a real session.

Regenerating the infbench INF-7 band's cases and flipping its `ceiling` markers, as this section
originally called for, is open: `test/bench/infbench-chat.test.mjs`'s pinned verdicts already stay
green against the delivered reader, so nothing here blocks on it, but the marker text itself still
reads as pre-EL.

Acceptance:

```
npm run test:fast
node --test test/adapters/chat-el-lane.test.mjs
node --test test/corpus/inference.test.mjs
node --test "test/adapters/chat-*.test.mjs"
node scripts/corpus-matrix.mjs
node --test test/bench/infbench-chat.test.mjs
npm run build:ask-bundle
```

The ask bundle inlines chat readers, so it drifts on every reader change. Rebuild it before running
anything that reads it.

---

## 8. Phase 3 — the ALC tableau core

Shipped: `src/domain/tableau.mjs` (sections 8.1–8.6 below — the concept-expression AST, the
explicit-stack search engine and its five expansion rules, subset blocking, the tri-state proof
API, KB module extraction, and reading the store into a KB), plus section 8.8's test files
(`test/adapters/tableau-expr.test.mjs`, `tableau-core.test.mjs`, `tableau-module.test.mjs`,
`tableau-kb.test.mjs`, `tableau-prove.test.mjs`, `tableau-alc-fixtures.test.mjs`) and
`test/fixtures/alc-entailments.jsonl`. Open: section 8.7's `/prove` chat command, its
`chat-prove-command.test.mjs`, and the `inference.dl.*` corpus rows — these land in the serialized
`src/services/chat.mjs` track.

New module: **`src/domain/tableau.mjs`**. Imports `./hash.mjs` only.

ALC first: ⊓, ⊔, ¬, ∃, ∀. Query-time only, never materialised in this plan's stages. A case-split
conclusion depends on every branch of its proof, and batch provenance for that shape is an open
design problem a later tier can take on with the JTMS groundwork as its starting point.

### 8.1 Concept expressions

A plain JSON AST. No classes, no symbols, so it serializes and compares cheaply.

```js
{ t: "atom", name: "cat" }
{ t: "top" }
{ t: "bot" }
{ t: "nom",  ind: "rex" }                    // a nominal, phase 4c
{ t: "not",  c: <expr> }
{ t: "and",  cs: [<expr>, …] }               // cs sorted by canonicalKey
{ t: "or",   cs: [<expr>, …] }               // cs sorted by canonicalKey
{ t: "some", r: "has", c: <expr> }
{ t: "all",  r: "has", c: <expr> }
{ t: "atLeast", n: 2, r: "has", c: <expr> }  // phase 4d
{ t: "atMost",  n: 0, r: "has", c: <expr> }  // phase 4d
```

```js
/** A stable string key for an expression. Sorting, dedup and clash detection
 *  all go through this, so two structurally equal expressions are one key. Pure. */
export function canonicalKey(expr) { … }

/** Negation normal form: push every ¬ inward to the atoms. Pure. */
export function toNNF(expr) { … }
```

### 8.2 Nodes, edges, branches

```js
// One individual in the model under construction.
{ id: "x0", labels: Map<canonicalKey, { expr, from: string[] }>, blockedBy: null }

// One role edge.
{ from: "x0", r: "has", to: "x0.1", fromFacts: string[] }

// One branch of the search.
{
  nodes: Map<string, node>,
  edges: [edge, …],
  todo: [{ nodeId, key }, …],   // pending rule applications, FIFO
  steps: 0,
  closed: false,
  clash: null,                  // { nodeId, keyA, keyB, premises: string[] }
}
```

Branches live on an explicit stack. No recursion: a deep ∃-chain must not depend on the JS call
stack.

Successor naming is deterministic: a node `x` creating its `n`-th successor names it `${x.id}.${n}`,
counting from 1, in the order the ∃-rules fire. Because rule order is fixed, so is every id.

### 8.3 Expansion rules and their order

Fixed priority, non-generating before generating and deterministic before non-deterministic. The
implementer applies the first rule that has any applicable instance, and re-checks from the top after
every application.

1. **⊓-rule.** A node labelled `{t:"and", cs}` gets every element of `cs` added to its label, each
   carrying the parent label's `from` list.
2. **∀-rule.** A node labelled `{t:"all", r, c}` adds `c` to every existing `r`-successor.
3. **⊑-rule (TBox internalization).** For each TBox axiom `C ⊑ D`, every node gets
   `toNNF({t:"or", cs:[{t:"not",c:C}, D]})`. Axioms are applied in sorted `canonicalKey(C)` order,
   one axiom per node per application, tracked so an axiom is never re-applied to the same node.
4. **⊔-rule.** A node labelled `{t:"or", cs}` branches. Disjuncts are tried in `canonicalKey` order.
   The stack pushes them in reverse, so the lexicographically first disjunct is explored first.
5. **∃-rule.** A node labelled `{t:"some", r, c}` with no `r`-successor already labelled `c` creates
   a fresh successor and labels it `c`.

**Blocking.** Subset blocking: a node `x` is blocked when some ancestor `y` has
`labels(x) ⊆ labels(y)` by key. A blocked node applies no generating rule. This is sound and
complete for ALC. Phase 4a upgrades it to equality blocking, which transitive roles need.

**Clash.** A branch closes when some node's label set holds `{t:"bot"}`, or holds both `C` and
`toNNF({t:"not", c: C})` by key. The clash record carries the union of both labels' `from` lists.
A branch also closes when a merge rule (4c's nominal merge, 4d's ≤-rule) tries to merge two nodes
that name distinct declared individuals with no `owl:sameAs` between them: UNA-lite (section 4)
makes that attempted merge itself a clash, not a step that proceeds silently.

### 8.4 The tri-state result

```js
{ status: "proved",    premises: string[], steps, branches }
{ status: "disproved", model: { nodes, edges }, steps, branches }
{ status: "exhausted", reason: "steps" | "branches" | "nodes", steps, branches }
```

```js
export const DEFAULT_PROVE_STEPS = 5000;
export const DEFAULT_PROVE_BRANCHES = 256;
export const DEFAULT_PROVE_NODES = 512;
/** Same sub-1 discount as CAX_DW_RULE_CONFIDENCE, same reason. */
export const TABLEAU_RULE_CONFIDENCE = 0.95;

/** Build the tableau knowledge base from a row set — on a real question, the
 *  output of `extractTableauModule` (section 8.5), never the raw store. Pure.
 *  Returns { axioms, assertions, roles, individuals }. */
export function buildTableauKb(rows) { … }

/** Is the KB plus the given assertions satisfiable? Pure, no I/O. */
export function isSatisfiable(kb, extraAssertions, { maxSteps, maxBranches, maxNodes } = {}) { … }

/** Entailment by refutation: does the KB entail `subject : concept`, `subject`
 *  a named individual? Asserts NNF(¬concept) on the subject and checks
 *  satisfiability. Every branch closed → proved. An open branch → disproved,
 *  with the branch as a counter-model. Any budget hit → exhausted, never a
 *  verdict. A class-level question ("is a stone terrestrial?") is a
 *  subsumption, not an individual entailment — `proveSubsumption`, below,
 *  answers that shape instead. */
export function proveEntailment(kb, subject, concept, opts = {}) { … }

/** Class subsumption by refutation: does the KB entail `subClass ⊑ superClass`?
 *  Mints one fresh individual, named "fresh-0" and never re-derived from the
 *  store — a subsumption proof owns its own namespace, disjoint from every
 *  real successor `buildTableauKb` or the ∃-rule could ever name — asserts
 *  `subClass ⊓ ¬superClass` on it, and checks satisfiability exactly as
 *  `proveEntailment` does for a named individual. Same tri-state result. The
 *  fresh individual is a tableau-internal label: it never touches the store
 *  and never appears in a rendered answer. */
export function proveSubsumption(kb, subClass, superClass, opts = {}) { … }

/** Every clash the KB produces on its own, with both premises named. Pure. */
export function findTableauViolations(kb, subjects, opts = {}) { … }
```

Budgets are part of the semantics, not a tuning knob. `maxSteps` counts rule applications across all
branches. `maxBranches` counts branches opened. `maxNodes` counts nodes in any one branch. Exceeding
any one of them returns `exhausted` for the whole call. A partially explored search never reports a
verdict. Every one of those counts is over the module section 8.5 below extracts, not the whole
store — extraction is what makes the budget mean something for a real question rather than exhausting
on TBox internalization before an interesting rule fires.

**Premises for a proved result.** Each label entry carries `from`, the fact ids that put it there.
The premise set for `proved` is the union, across every closed branch, of that branch's clash
premises plus the `from` lists of every axiom applied on the path to it. Trust for a case-split
conclusion is `min` over that union times `TABLEAU_RULE_CONFIDENCE`, computed through the existing
`entailedTrustFrom` helper. That settles the plan's old open question about case-split trust:
the union over branches, the minimum over the union.

**Class subsumption proofs.** `proveEntailment` only answers an individual question: does the KB
entail `subject : concept` for a named individual. E4 asks a different question — is the class
`stone` a subclass of `terrestrial`? The standard tableau encoding for a subsumption `C ⊑ D` is to
test satisfiability of `C ⊓ ¬D` on a fresh individual that touches nothing else in the KB: if no
model can put anything in `C ⊓ ¬D`, nothing can be a `C` without also being a `D`, so `C ⊑ D` holds.
`proveSubsumption` (above) is that encoding. `/prove`'s question parse (section 8.7) routes to it
instead of `proveEntailment` whenever the parsed subject resolves as a class term rather than an
individual, reusing the same `individual` test section 8.6 already runs.

E4 traced through: the fresh individual `fresh-0` gets `{t:"and", cs:[{t:"atom",name:"stone"},
{t:"not",c:{t:"atom",name:"terrestrial"}}]}`. The ⊑-rule applies the complement axioms to it:
`stone` is already asserted `¬aquatic` at the class level, `¬aquatic ⊑ terrestrial` fires, giving
`terrestrial` on `fresh-0` — which clashes directly with the asserted `¬terrestrial`. Every branch
closes. Proved.

### 8.5 KB module extraction

As designed above, `buildTableauKb` reading the whole store is a scaling trap. The store carries
around 63,000 facts, and the ⊑-rule (section 8.3, rule 3) internalises every TBox axiom as a
disjunction on every node in the branch. Against the full store that exhausts the 5,000-step default
budget before an interesting rule fires even once, so `/prove` would return `exhausted` on almost any
real question. Extraction fixes this by restricting the KB to the part of the store the question can
actually reach, the same focus discipline `syllogise()`'s FOCUS guard already applies to batch
derivation.

```js
export const DEFAULT_MODULE_HOPS = 4;

/** Restrict fact rows to the signature-connected module around a set of seed terms.
 *  A hop-bounded closure over the subclass, role and restriction graph: from each
 *  seed term, follow rdfs:subClassOf in both directions, owl:onProperty /
 *  owl:someValuesFrom / owl:onClass from a restriction to its filler and back, and
 *  owl:unionOf / owl:complementOf / owl:oneOf members, up to `hops` steps. A term
 *  reached through a restriction or role axiom re-seeds its own `hops`-bounded walk,
 *  so a chain of restrictions extends the module without an unbounded hop count.
 *  Pure, no I/O. Returns the restricted row array, in the input's own row order. */
export function extractTableauModule(rows, seedTerms, { hops = DEFAULT_MODULE_HOPS } = {}) { … }
```

Always included, regardless of hop count: the question's own terms (the subject and the concept
`/prove` is asked about); every ancestor and descendant of those terms in the `rdfs:subClassOf`
graph; every restriction node that mentions a term in the closure (`owl:onProperty`,
`owl:someValuesFrom`, `owl:onClass`); and every role axiom (`owl:TransitiveProperty`,
`rdfs:subPropertyOf`, `owl:inverseOf`) naming a role that closure uses.

`hops` is a `reasoning-config.mjs` knob, `[reasoning] module_hops = 4` in `tmct.toml` (section 6.6),
resolved through the same `resolveReasoningConfig` precedence as every other reasoning budget: CLI
flag, then file, then this default.

`/prove`'s steps (section 8.7) become: read the fact rows, extract the module around the question's
subject and concept, `buildTableauKb`, `proveEntailment` or `proveSubsumption`. The step, branch and
node budgets (section 8.4) are counted over the module the tableau actually searches, not the store
it was cut from, so a budget number in a rendered miss means "exhausted after n steps over this
question's module," never "over the whole graph."

Test `test/adapters/tableau-module.test.mjs`: a store of a few hundred unrelated facts plus a small
signature-connected slice around two seed terms extracts only the slice, checked both by row count
and by content (every extracted row has a path back to a seed term within `hops`); a chain of
restrictions longer than `hops` from the seed still extracts, because each restriction re-seeds its
own walk; a term with nothing in the store extracts to a module of just that term's own axiom, never
a crash.

### 8.6 Reading the store into a KB

`buildTableauKb(rows)` maps each stored shape:

| stored | KB |
|---|---|
| `A rdfs:subClassOf B` | axiom `A ⊑ B` |
| `A rdfs:subClassOf R`, `R` a someValuesFrom restriction | axiom `A ⊑ ∃r.C` |
| `A rdfs:subClassOf R`, `R` a cardinality restriction | axiom `A ⊑ ≥n r.C` or `≤n r.C` (phase 4d; before that, `≥1` reads as `∃r.C` and anything else is skipped) |
| `A owl:disjointWith B`, both classes | axiom `A ⊑ ¬B` |
| `x rdf:type C` | assertion `C(x)` |
| `x owl:disjointWith C`, `x` an individual | assertion `¬C(x)` |
| `x mgxneg:subClassOf C` | assertion `¬C(x)` |
| `U owl:unionOf A`, `U owl:unionOf B` | axioms `U ⊑ A ⊔ B` and `A ⊔ B ⊑ U` |
| `N owl:complementOf A` | axioms `N ⊑ ¬A` and `¬A ⊑ N` |
| `C owl:oneOf a`, `C owl:oneOf b` | axioms `C ⊑ {a} ⊔ {b}` and each `{a} ⊑ C` (phase 4c) |
| `a owl:differentFrom b` | inequality `a ≠ b` (phase 4d) |
| `p rdf:type owl:TransitiveProperty` | role axiom, transitive (phase 4a) |
| `p rdfs:subPropertyOf q` | role axiom, hierarchy (phase 4b) |
| `p owl:inverseOf q` | role axiom, inverse (phase 4e) |

An individual `x` is distinguished from a class by the same test `deriveDisjointViolations` already
relies on, carved out for the meta-vocabulary the tableau's own scaffolding writes: a code-ref
individual carries one of `. / \ # : @`, and an individual is anything that appears as an `rdf:type`
subject **whose object is not itself `owl:` or `rdfs:` vocabulary**. Without the carve-out, pattern
16's `contains rdf:type owl:TransitiveProperty` and a restriction node's own `rdf:type
owl:Restriction` would both misclassify their subjects as individuals — they are meta-vocabulary
assertions about a role and a restriction node, not individuals. The carve-out excludes both by
their object. It does not resolve punning: pattern 13's `red rdf:type primary-colour` makes `red` a
nominal individual through `owl:oneOf`, and a store that also declares a `red` colour class elsewhere
makes `red` a class term too. Punning stays legal and reads from context — an assertion position
reads `red` as an individual, a subsumption position reads it as a class.

### 8.7 The `/prove` command

New branch in `runCommand`'s if-chain in `src/services/chat.mjs`, after `/classify`, following the
`/syllogise` shape exactly.

```
/prove is rex a dog
```

Steps: refuse without an argument; parse the argument through the ask engine's existing question
parse to get a `(subject, class)` pair; refuse when the parse declines, naming the shapes that work;
read the fact rows; extract the module (section 8.5) around the subject and class; `buildTableauKb`;
`proveEntailment` when the subject resolves as an individual, `proveSubsumption` when it resolves as
a class; render.

Rendering, through the existing template machinery and nothing new:

- `proved`: `yes — <premise lines joined with "; ">; so <subject> is a <class>.` Premise lines come
  from `renderFactLine`, so provenance and trust read exactly as they do everywhere else. When the
  proof used a ⊔-rule, prefix the conclusion clause with `in every case, ` so the reader sees it was
  a case analysis.
- `disproved`: `no — I can build a consistent picture where <subject> is not a <class>.` Name the
  premises that constrain it.
- `exhausted`: the honest miss wall. `I can't prove or disprove that within my budget (<n> steps).
  Nothing was guessed.` Mark the turn `miss: true` and tag the record so chatbench and infbench can
  count budget misses separately from parse misses.

`/prove` stays an explicit command in phase 3. Only after infbench and chatbench show it safe does it
become an automatic fallback on an ask-lane miss. That promotion is its own increment.

### 8.8 Phase 3 tests

| file | what it holds |
|---|---|
| `test/adapters/tableau-expr.test.mjs` | `canonicalKey` stability and `toNNF` correctness, one case per connective; the sorted-`cs` invariant |
| `test/adapters/tableau-core.test.mjs` | one test per expansion rule; blocking terminates a `A ⊑ ∃r.A` loop; the branch stack explores the lexicographically first disjunct first; every budget returns `exhausted` and never a verdict |
| `test/adapters/tableau-module.test.mjs` | `extractTableauModule` extracts only the signature-connected slice, by row count and content, from section 8.5 |
| `test/adapters/tableau-kb.test.mjs` | `buildTableauKb` maps each stored shape from the table above; an individual is told from a class correctly, including the meta-vocabulary carve-out (a role marked transitive and a restriction node are never read as individuals) and the punning case (a term that is a `oneOf` member and a class elsewhere resolves correctly in each position) |
| `test/adapters/tableau-prove.test.mjs` | E3 and E4 close; E4 proves as a class subsumption through `proveSubsumption`'s fresh-individual encoding, and the fresh individual never appears in `buildTableauKb`'s own `individuals` output or in a rendered premise line; the premise union is right for a case-split proof; trust is `min × 0.95`; a satisfiable KB gives `disproved` with a counter-model; order-independence over the input rows |
| `test/adapters/tableau-alc-fixtures.test.mjs` | the ALC entailment fixture set at `test/fixtures/alc-entailments.jsonl`, same JSONL shape as the EL fixtures, drawn from the standard ALC tableau worked examples |
| `test/adapters/chat-prove-command.test.mjs` | `/prove` without an argument refuses; a proved answer cites premises; an exhausted answer is a miss and carries the budget marker |

Corpus rows in `test/corpus/inference.jsonl`:

| key | id |
|---|---|
| `inference.dl.disjunction` | `inference-dl-disjunction-elimination-answers-by-cases` |
| `inference.dl.complement` | `inference-dl-complement-answers-from-a-negated-class` |
| `inference.dl.budget-miss` | `inference-dl-budget-exhaustion-is-a-miss-never-a-guess` |
| `inference.dl.counter-model` | `inference-dl-unentailed-question-reads-as-a-disproof-not-a-miss` |

Acceptance:

```
npm run test:fast
node --test "test/adapters/tableau-*.test.mjs"
node --test test/adapters/chat-prove-command.test.mjs
node --test test/corpus/inference.test.mjs
node --test "test/estate/*.test.mjs"
node scripts/corpus-matrix.mjs
npm run build:ask-bundle
```

---

## 9. Phase 4 — growing toward SHOIQ

Five increments, each its own commit, each with its own test file. All five touch
`src/domain/tableau.mjs`, so they serialize. The calculus follows Horrocks and Sattler's SHOIQ
tableau algorithm (*A Tableau Decision Procedure for SHOIQ*, 2007): each increment below lands one
of its expressivity letters as its own commit rather than all at once, and each one states what it
does to blocking, because blocking is the piece SHOIQ's termination argument rests on and the piece
most likely to break silently if an increment forgets it.

**4a — S: transitive roles.** `p rdf:type owl:TransitiveProperty` makes the ∀-rule propagate through
transitive successors: a node labelled `{t:"all", r, c}` with `r` transitive adds both `c` and
`{t:"all", r, c}` to each `r`-successor. Blocking upgrades from subset to equality blocking, which
transitive roles need for termination. Test file `test/adapters/tableau-transitive.test.mjs`,
including a termination test on `A ⊑ ∃r.A` with `r` transitive.

**Delivered.** `kb.transitiveRoles` reads `owl:TransitiveProperty` declarations off the store; the
∀-rule copies its own label onto a transitive role's successor alongside the filler; blocking runs
as equality blocking throughout. Tests in `test/adapters/tableau-transitive.test.mjs`.

**4b — H: role hierarchies.** `p rdfs:subPropertyOf q` makes ∃ and ∀ read the role closure: an
`r`-edge counts as an `s`-edge for every `s` above `r`. Precompute the closure once per KB with the
same memoized ancestor walk `buildAncestorCloser` uses. Blocking is unaffected: the closure is
precomputed data the existing equality-blocking test already reads correctly. Test file
`test/adapters/tableau-role-hierarchy.test.mjs`. This increment is the smallest of the five.

**Delivered.** `kb.roleClosure` maps every role to the set of roles below it in the
`rdfs:subPropertyOf` hierarchy, precomputed once per KB; the ∃-rule's witness check and the ∀-rule's
successor walk both read an edge's role through it instead of an exact match. Blocking untouched.
Tests in `test/adapters/tableau-role-hierarchy.test.mjs`.

**4c — O: nominals.** `owl:oneOf` gives `{t:"nom", ind}`. A nominal is a singleton concept: two nodes
labelled the same nominal are the same individual and must be merged. This is E6. Merging needs the
same machinery 4d's ≤-rule needs, so build 4d's merge first and reuse it. Nominals break the
tree-model property blocking normally relies on: a `oneOf` merge can connect two branches that would
otherwise never see each other, so the search is no longer strictly a tree. The discipline that keeps
4c terminating without a blocking upgrade of its own: the number of nominals in a KB is fixed by what
the store declares, so the ≤-rule-shaped merge bounds how many extra edges a nominal can introduce,
and equality blocking (unchanged from 4a) still terminates every non-nominal branch. Full pairwise
blocking, which the tree-model breakage properly calls for, is not needed until 4e adds inverse
roles. Test file `test/adapters/tableau-nominals.test.mjs`, covering "is teal a primary colour" as a
provable no.

**Delivered**, built on top of 4d's merge machinery (landed first, in commit order, per this
section's own note). `owl:oneOf` reads as a closed union of nominal disjuncts plus each member
subsumed back into the class; every nominal individual gets its own self-label at branch-init so the
new nominal-merge rule (highest priority among the deterministic rules — it runs right after ⊓/∀,
before ⊑-internalization) has a real carrier to identify an outsider against. E6 proves through
`proveEntailment(kb, "teal", { t: "not", c: atom("primary-colour") })`. Tests in
`test/adapters/tableau-nominals.test.mjs`.

**4d — Q: qualified cardinality.** `owl:minCardinality`, `owl:maxCardinality` and `owl:cardinality`
with `owl:onClass` give `{t:"atLeast"}` and `{t:"atMost"}`. The ≥-rule generates `n` pairwise-distinct
successors. The ≤-rule merges two successors when a node has more than `n` of them, branching over
which pair merges, in a fixed pair order. `owl:differentFrom` seeds the inequality relation that
keeps the ≥-rule's successors distinct. The merge carries an identity side-condition from UNA-lite
(section 4): it may never merge two nodes that carry distinct declared individual names, or that are
connected by `owl:differentFrom`, with no `owl:sameAs` between them — attempting to do so is itself a
clash (section 8.3), not a step the search takes. This is E5. Test file
`test/adapters/tableau-cardinality.test.mjs`, covering the min/max clash with both premises named.

**Delivered.** The ≥-rule creates one fresh successor per invocation (the same per-step granularity
the ∃-rule has, so the step budget scales with `n` rather than landing in one step) and marks it
pairwise-distinct from every witness that already existed. The ≤-rule tries every candidate pair in a
fixed order; a surplus with fewer than two witnesses to pair (`n=0` against exactly one witness) is
an unconditional clash, since no merge could ever reach zero. E5 (`bicycleWithWheels(2, 0)`) closes
with both restrictions' fact ids named in the premises, verified through both `proveEntailment` and
`findTableauViolations`. `mergeNodes`, `isMergeBlocked` and the UNA-lite named-individual test live at
module scope, reused as-is by 4c. Tests in `test/adapters/tableau-cardinality.test.mjs`.

**4e — I: inverse roles.** `owl:inverseOf` gives each role its own recorded inverse. Represented
through a new ACE pattern, pattern 17, added to `src/domain/grammar/ace.mjs`'s frozen `PATTERNS`
array in this increment's own round rather than phase 0's: *"containing is the inverse of being part
of"*, general form *"V1 is the inverse of V2"* over two declared verbs (or verb phrases), each folded
to its predicate lemma through `lookupVerb`/`predicateOf` before minting:

```
tmct:contains owl:inverseOf tmct:part-of    kind owl:inverseOf
tmct:part-of  owl:inverseOf tmct:contains   kind owl:inverseOf
```

Both directions are written, unlike `owl:differentFrom`'s one-direction storage, so either verb's
forward walk finds the other with no extra graph hop. `buildTableauKb` (section 8.6) reads it as a
role axiom `{ kind: "inverse", role, inverseRole, from }`.

The ∃, ∀ and ≤ rules all become inverse-aware: an `r`-successor edge `x → y` counts as an `inv(r)`
-predecessor edge `y → x` for every rule that reads role edges, so `{t:"some", r:"part-of", c}` on
`y` can fire off an existing `contains` edge into `y` without generating a fresh successor — the same
"no fresh successor when one is already labelled" discipline the ∃-rule already has (section 8.3,
rule 5), extended to read edges in both directions. The ∀-rule and the ≤-rule read the same
inverse-aware edge set.

Blocking upgrades again, and has to: once a role and its inverse can both be walked, an
ancestor-blocking node must match its candidate on edges in both directions to stay sound, not just
on successor edges. That is Horrocks and Sattler's **pairwise blocking** — a node `x` is blocked by
an ancestor `y` only when their labels match *and* their sets of predecessor edge labels match too.
Nominals (4c) plus inverses (4e) together are the combination the SHOIQ literature flags as needing
this care; pairwise blocking is the documented fix, and this increment adopts it rather than
re-deriving it.

Motivating example: teach *"every heart contains a valve"*, *"containing is the inverse of being
part of"*, ask *"is a valve part of a heart?"* The KB has no `part-of` edge asserted anywhere, only
`contains`, so the answer depends entirely on reading the `contains` edge through its recorded
inverse.

Add pattern 17's row to `docs/references/schemas/ace-owl-fragment.md`'s pattern table and
`ontology/README.md`'s pattern → kind table, the same two docs phase 0's patterns update (section
5.4), and declare `owl:inverseOf` in `ontology/tmct-core.ttl` section 2 beside the five phase-0
terms. Test file `test/adapters/tableau-inverse.test.mjs`, covering the ACE pattern's triple
emission, the inverse-aware ∃/∀/≤ handling, pairwise blocking terminating a mutually-referential loop
(`A ⊑ ∃r.A`, `A ⊑ ∀invR.A`, `r owl:inverseOf invR`), and the motivating example above proved.

**Delivered.** All role-edge reads (∃, ∀, ≥, ≤) go through one `roleEdgeTargets` helper, so an
inverse-declared role is read backwards for every one of them at once. Blocking checks
`kb.inverseOf.size > 0` and switches to pairwise (matching incoming-edge role sets, not just concept
labels) only then — with no inverse declared it is byte-identical to plain equality blocking, so 4a
through 4d's own termination tests are untouched. `buildTableauKb` has no reader for an asserted ABox
role fact between two named individuals (no ACE pattern or teach-lane frame stores one, and adding
that is outside this plan's scope), so the motivating example's own "does the store already have a
`part-of` edge to read" question is answered through nominals instead of a directly-asserted relation:
two `owl:oneOf`-declared individuals stand in for the named heart and valve, one asserts
`∃contains.{other}`, and the question ("is the valve NOT part of the heart") only stays consistent by
contradicting itself — the inverse edge alone proves the positive. The verb pair used throughout
(`test/adapters/tableau-inverse.test.mjs`, `ontology/tmct-core.ttl`) is "containing"/"belonging"
rather than "being part of": the lexicon's own declared `belong` verb already carries the override
predicate `mgx:partOf`, so it reaches the same predicate this section's flavour text names without
adding a lexicon entry — pattern 17 itself accepts any two declared verbs, 3sg or gerund, on either
side. Tests in `test/adapters/tableau-inverse.test.mjs`.

Corpus rows, one per increment — deferred with the `chat.mjs` `/prove` wiring (section 8's own
`test/adapters/chat-prove-command.test.mjs` and `inference.dl.*` rows), since a corpus row exercises
the chat surface a query actually reaches, not the tableau module alone:

| key | id |
|---|---|
| `inference.dl.transitive-role` | `inference-dl-transitive-role-propagates-a-universal` |
| `inference.dl.role-hierarchy` | `inference-dl-subproperty-lets-a-restriction-reach-a-narrower-role` |
| `inference.dl.enumeration` | `inference-dl-closed-enumeration-answers-a-provable-no` |
| `inference.dl.cardinality-clash` | `inference-dl-min-max-clash-names-both-premises` |
| `inference.dl.inverse-role` | `inference-dl-inverse-role-answers-from-the-recorded-inverse-edge` |

Acceptance for each increment: `npm run test:fast`, that increment's test file, all of
`test/adapters/tableau-*.test.mjs`, and `node --test test/corpus/inference.test.mjs`.

After 4d, delete `DL_DISJUNCTION_CEILING`, `DL_COMPLEMENT_CEILING` and the two markers phase 0 added
from `test-benchmarks/infbench/generate-cases.mjs`, flip the INF-8 expected verdicts,
regenerate `cases.jsonl` and `envelope.json`, and rerun the band. **Deferred alongside the corpus rows
above**: every INF-8 template runs `arms: ["chat"]` only, graded by driving a real `runChat()`
session — checked directly against the committed corpus (`node test-benchmarks/infbench/generate-cases.mjs`'s
own dlDisjunction/dlComplement/dlCardinalityClash/dlNominalEnumeration cases, run through
`runInfbench`), today's chat surface still answers "I couldn't read that as a question I can answer"
for all four, since none of them route through `/prove` yet — that wiring is section 8.7's, not this
plan's phase-4 tableau work. Flipping the expected verdicts now, before that wiring lands, would
commit a corpus that claims a capability the chat surface doesn't have.

---

## 10. Phase 5 — surfacing consistency

Today `findConsistencyViolations` in `src/domain/syllogise.mjs` reads only type edges, subclass edges
and disjointness edges. It stays that way: it runs on chat's hot path and it is cheap.

Phase 5 adds the wider check beside it, not inside it.

1. `findTableauViolations(kb, subjects, opts)` in `src/domain/tableau.mjs` returns every clash the KB
   produces on its own, each as `{ subject, premises, kind }`, bounded by the same three budgets and
   sorted deterministically.
2. `classifyEl`'s `unsatisfiable` array feeds the same report: an EL-detected unsatisfiable class is
   the cheap half of the same finding.
3. `src/services/chat.mjs` calls both from the existing contradiction-report path and renders each
   through the template that already quotes both premises for a disjointness clash. A tableau clash
   quotes its premise lines through `renderFactLine`, so provenance reads the same as everywhere
   else.
4. `tmct memory` and `/memory verbose` list the findings alongside the existing contradiction
   groups.

Test file `test/adapters/consistency-tableau.test.mjs`: the E5 clash is reported with both premises;
an EL-unsatisfiable class is reported; a consistent store reports nothing; a budget-exhausted check
reports nothing rather than a false clean bill.

Corpus row `inference.consistency.cardinality-clash`, id
`inference-consistency-min-max-clash-is-reported-not-answered-from`.

Acceptance: `npm run test:fast`, the new test file, `node --test test/adapters/syllogise.test.mjs`,
`node --test test/adapters/memory-inspect.test.mjs`, `node --test test/corpus/inference.test.mjs`.

---

## 11. Phase 6 — site and claims surfacing

The measured story stops at infbench today: INF-7 and INF-8 flip from `unproven` to `yes` across
phases 2 and 4, and nothing outside the test suite says so. This phase carries that flip onto the
site and into the product's own help text, so a visitor can see the claim and a user can find the
commands that back it.

1. **A claims-page block.** `results/claims/syllogist.json`, written by a new
   `scripts/claims/claim-syllogist.mjs` (registered as `"claim:syllogist"` in `package.json`,
   following `claim-prose-band.mjs`'s shape, `writeClaim("syllogist", { … })`) that replays the
   INF-7 and INF-8 corpus rows through the shipped engine and counts verdicts. It uses
   `schema.json`'s before/after/delta branch, the one built for an extensibility claim like this
   one: `before` is the pre-plan verdict count (`unproven` across both bands), `after` is the
   post-plan count (`yes`, premises cited), `delta` the difference, `unit: "question shapes
   proved"`, and `detail.budgetExhausted` naming the count of rows that land on the honest miss
   wall rather than a verdict — the cost line, named rather than hidden. `sources` cites
   `test-benchmarks/infbench/cases.jsonl` and `test-benchmarks/infbench/envelope.json`. Add
   `"syllogist"` to `CLAIMS_PAGE_BLOCKS` in `scripts/site-pages.mjs`; its prose, kicker (`C8`, the
   page's next capability block after `C7`), and which `detail` field it renders live beside the
   other blocks' copy in `build-demo-site.mjs`'s `renderClaimsHtml`, through `claimFigureBlock` the
   same way `l1`/`l2`/`c7` already do. `test/estate/claims.test.mjs` picks the new block up once
   `CLAIMS_PAGE_BLOCKS` names it — no test file changes needed, the three checks it already runs
   (parses, matches schema, cites sources that exist) apply automatically.
2. **`/classify` and `/prove` documented.** `public/chat-about.html` gets a new subsection, its own
   `#reasoning` anchor beside the page's existing `#inference`, `#play`, `#papers` and `#build`,
   walking one EL example and one DL example verbatim from the corpus — the same "every exchange
   below is real" posture the rest of that page holds to. `public/help.html`'s `#chat` ("Asking and
   teaching") section gets one paragraph naming `/classify` and `/prove` as the two commands for a
   question a plain ask can't reach alone, each with one worked transcript line in the page's
   existing `<pre class="transcript">` style.
3. **A share post.** `public/share.mjs`'s `POSTS.chat.posts` gets one new entry, angle `"it proves
   things"`, linking to `chat-about.html#reasoning`, text naming the measured number from
   `results/claims/syllogist.json`'s `delta` once the rig's first run lands — written with the
   number filled in, not a placeholder, because the rig runs before this post is written.

Corpus dependency: none new. This phase reads the INF-7/INF-8 results phases 2 and 4 already
produce; it adds no corpus rows of its own.

Acceptance:

```
node scripts/claims/claim-syllogist.mjs
node --test test/estate/claims.test.mjs
npm run demo:build
node --test "test-e2e/pages-*.test.mjs"
npm run check:links
```

---

## 12. Concurrency and model tiers

File ownership is what decides what can run at once. The rule is one owner per file per round.

| track | owns | depends on | model |
|---|---|---|---|
| 0a ACE patterns | `src/domain/grammar/ace.mjs`, `lexicon.mjs`, `test/adapters/grammar-ace-class-expressions.test.mjs` | — | Sonnet |
| 0b teach lane and read-back | `src/services/chat.mjs`, or `src/domain/fact-phrase.mjs` if `PLAN_NEWS_FEED.md`'s extraction has already landed; `test/adapters/teach-negative-and-enumeration.test.mjs` | 0a's triple shapes | Sonnet |
| 0c ontology and docs | `ontology/*`, `docs/references/schemas/*` | — | Haiku |
| 0d corpus and infbench | `test/corpus/inference.jsonl`, `test-benchmarks/infbench/generate-cases.mjs` | 0a, 0b | Haiku |
| 1 EL classifier | `src/domain/el-classify.mjs`, `test/adapters/el-*.test.mjs`, `test/fixtures/el-entailments.jsonl` | phase 0's stored shapes, which this document fixes | Sonnet |
| 1b verb, command, config | `src/domain/cli-verbs.mjs`, `bin/tmct.mjs`, `src/domain/reasoning-config.mjs`, `src/adapters/toml-config.mjs`, `tmct.toml`, `package.json` | 1's exports | Haiku |
| 2 EL wiring | `src/services/chat.mjs` | 0b, 1, 1b | Sonnet |
| 3 tableau core | `src/domain/tableau.mjs`, `test/adapters/tableau-*.test.mjs`, `test/fixtures/alc-entailments.jsonl` | phase 0's stored shapes | Sonnet |
| 3b `/prove` | `src/services/chat.mjs` | 2, 3 | Sonnet |
| 4a–4e SHOIQ | `src/domain/tableau.mjs`; 4e also `src/domain/grammar/ace.mjs`, `ontology/tmct-core.ttl`, `ontology/README.md`, `docs/references/schemas/ace-owl-fragment.md` | 3, then each other in order | Sonnet |
| 5 consistency | `src/domain/tableau.mjs`, `src/services/chat.mjs` | 4e | Sonnet |
| 6 site and claims | `scripts/claims/claim-syllogist.mjs`, `results/claims/syllogist.json`, `scripts/site-pages.mjs`, `scripts/build-demo-site.mjs`, `public/chat-about.html`, `public/help.html`, `public/share.mjs`, `test/estate/claims.test.mjs`, `package.json`'s `claim:syllogist` entry | 4e, 5 | Haiku |

**What runs concurrently.** 0a, 0c and 3 can all start at once: 0c touches no code, and 3 builds
against the stored shapes this document fixes rather than against phase 0's code. 1 can start
alongside 3 for the same reason. 1b can start once 1's exported names exist, which this document
already gives.

**What serializes.** Everything touching `src/services/chat.mjs` runs one at a time: 0b, then 2,
then 3b, then 5. Everything touching `src/domain/tableau.mjs` runs one at a time: 3, then 4a, 4b,
4c, 4d, 4e, then 5. 0d runs after 0a and 0b so its expected answers are real. Track 6 waits for 4e
and 5 to land before it measures anything real, though it owns no file an earlier track also owns.

**Cross-plan serialization.** `PLAN_NEWS_FEED.md` also runs a round against `src/services/chat.mjs`
(its own phase 4). The two plans' `chat.mjs` tracks are one queue, not two: 0b, 2, 3b and 5 here
interleave with news's chat round in whatever order the coordinator dispatches them, but no two
`chat.mjs` rounds from either plan ever run concurrently with each other.

**Model tiers.** Sonnet is enough for every code track here, because this document fixes the data
structures, the rule set and the signatures, which is where the design risk lives. Haiku covers the
four mechanical tracks: the ontology and docs table entries, the verb and config wiring against two
verbatim precedents, the corpus rows, and site and claims wiring against `claim-prose-band.mjs`'s
own precedent.

Three tracks are worth watching, and if any stalls the answer is a tighter test file rather than a
larger model. Track 3's clash bookkeeping is the subtlest code in the plan: the `from` lists have to
be threaded through every rule so the premise union comes out right. Write
`test/adapters/tableau-core.test.mjs` first, one test per rule, and let it pin the design before the
engine exists. Track 4d's ≤-rule merge is the second: build the merge and its test before 4c needs
it. Track 4e's pairwise blocking is the third: write the mutually-referential-loop termination test
in `test/adapters/tableau-inverse.test.mjs` before extending blocking, the same test-first order that
protects tracks 3 and 4d.

**Sub-agent discipline.** Every dispatch brief caps testing at `npm run test:fast` plus that track's
own blast radius. The full suite and the e2e tiers are the coordinator's job after the merge. A
fresh worktree has no `corpus/worlds/`, no `corpus/sprites/` and no ask bundle, so every brief says
to run `node scripts/ensure-worlds-pack.mjs`, `node scripts/ensure-sprite-facts.mjs` and
`npm run build:ask-bundle` before any `node --test`.

---

## 13. Costs and risks

- **Size.** Stage EL is comparable to `src/domain/syllogise.mjs` today, around 900 to 1,200 lines
  plus tests. Stage DL is the largest single component since `src/domain/ask.mjs`: a real engine plus
  a fixture corpus, and phase 4 roughly doubles phase 3's line count. The per-phase test-first
  pins in sections 8 and 9 are what keep that size deliverable by a Sonnet-tier implementer.
- **Worst-case blowup is a semantics problem.** SHOIQ is NEXPTIME-hard. Budgets are part of the
  contract from the first commit, and every budget exhaustion is counted in infbench, so a silent
  weakening shows up as a number rather than a feeling.
- **Determinism under branching.** The ⊔-rule and the ≤-rule are the two places where an
  implementation can drift into arrival-order dependence. Both tests demand the same answer from two
  differently ordered inputs, the same check `sortFactIndividualsById` protects the fact store with.
- **The EL justification is single-environment.** `syllogise()`'s alternate-discovery step does not
  know the EL predicates, so an EL conclusion carries one environment until an EL-aware enumerator
  lands. Retraction stays correct through its boolean backstop, which re-verifies rather than
  trusting a citation. Growing the enumerator is a later increment with a clear starting point.
- **Open-world honesty.** The CLINC out-of-scope result is won by refusing what tmct cannot ground.
  Nothing in phase 0 or either prover may introduce a closed-world assumption outside explicitly
  enumerated or explicitly negated knowledge. The `owl:oneOf` case and UNA-lite (section 4) are the
  two places a closure or an identity assumption is asserted rather than derived, and both are
  asserted in words: the user's own sentence for `oneOf`, the tableau's rendered assumption clause
  for UNA-lite.
- **Overlap discipline.** E2 partly falls to the cheaper L7 property rules. Every example above has
  an infbench case tagged with the tier that should first solve it, so a cheaper tier landing early
  is visible and this plan shrinks accordingly.

---

## 14. Not in this plan

- FOL, arithmetic, temporal and event reasoning, defaults, probabilistic weighting. Section 3 names
  the candidate literatures for whichever gets designed next.
- Incremental and RETE-shaped materialisation, and the retraction algorithms.
  `archive/PLAN_SYLLOGIST.md` owns that horizon, including its own named remainder: the `citedBy`
  index is rebuilt per retraction rather than persisted, chat's live proof-chase does not consume the
  relevance frontier, and `/syllogise <term>` runs the plain focus rather than `expandFocus`.
- Batch materialisation of tableau conclusions. A case-split conclusion rests on every branch of its
  proof, and provenance for that shape needs its own design pass.
- LLM involvement of any kind, including proof rendering. Proofs render through the same template
  machinery as every other answer.
