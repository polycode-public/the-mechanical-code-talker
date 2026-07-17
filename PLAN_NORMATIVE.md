# PLAN_NORMATIVE.md — reconciling tmct's vocabulary with published standards

tmct stores OWL-labelled triples and grounds them in `ontology/tmct-core.ttl`. So the question is
not whether to adopt a standard. It is whether the vocabulary tmct writes says what the standards
already say, or reinvents it under a new name.

This document answers that term by term. It is research-then-uplift: the standards get read before
an identifier moves.

**Bias: `map`, not `rename`.** An `owl:equivalentProperty` / `skos:exactMatch` triple is additive.
It cannot break a caller, and it leaves the `.tmct/graph.json` payloads already on disk valid. A
rename does neither. Any rename of a stored predicate needs a migration for those payloads, or it is
a data-loss bug wearing a tidiness costume.

---

## 1. The two-casings defect: it is not a defect

`PLAN_OPEN_ITEMS.md` §10.1 reports that the same term exists in two casings — `mgx:callscoarse` and
`mgx:callsCoarse`, `mgx:canonicalisedfrom` and `mgx:canonicalisedFrom`, `mgx:changecoupledwith` and
`mgx:changeCoupledWith`, `mgx:cause` and `mgx:causes` — and calls it a bug that needs no standard to
justify fixing.

Checked. **The claim is false, in two different ways, and no migration is needed.**

### 1.1 The lowercase spellings are lookup keys, not IRIs

The inventory (`scripts/term-inventory.mjs`) finds **13** case-colliding groups, not four:

| camelCase (the term) | lowercase (the key) |
|---|---|
| `mgx:testsCoverage` | `mgx:testscoverage` |
| `mgx:touchesSymbol` | `mgx:touchessymbol` |
| `mgx:callsSymbol` | `mgx:callssymbol` |
| `mgx:importsNamespace` | `mgx:importsnamespace` |
| `mgx:callsCoarse` | `mgx:callscoarse` |
| `mgx:touchedByCommit` | `mgx:touchedbycommit` |
| `mgx:changeCoupledWith` | `mgx:changecoupledwith` |
| `mgx:reExports` | `mgx:reexports` |
| `mgx:saidInSession` | `mgx:saidinsession` |
| `mgx:inReplyTo` | `mgx:inreplyto` |
| `mgx:statedBy` | `mgx:statedby` |
| `mgx:canonicalisedFrom` | `mgx:canonicalisedfrom` |
| `mgx:subclassOf` | `mgx:subclassof` |

Every one of those 13 lowercase spellings occurs at exactly **one** file: `src/domain/codegraph.mjs`,
in the `PROP_KIND` table (lines 65-94). That table is a prop-token → relation-kind classifier. Its
own header says "Lower-cased keys", and `relationKind()` lowercases before it looks up:

```js
const prop = String(group?.prop || "").toLowerCase();
if (PROP_KIND[prop]) return PROP_KIND[prop];
```

A lowercased map key is not an IRI. It is a case-insensitive lookup — the read side accepting a
prop token whatever casing the artifact spells it in. Nothing writes it, nothing publishes it, and
no graph contains it.

**Confirmed against a real store, not by reading.** A fresh `init` (664 corpus facts) plus a chat
session that teaches facts writes `mgx:canonicalisedFrom`, `mgx:statedBy`, `mgx:saidInSession`,
`mgx:inReplyTo`, `mgx:derivedFrom` — and **zero** occurrences of any lowercase variant:

| predicate | occurrences in `.tmct/memory/graph.json` |
|---|--:|
| `mgx:canonicalisedFrom` | 1 |
| `mgx:callscoarse`, `mgx:canonicalisedfrom`, `mgx:changecoupledwith` | 0 |

**Verdict: keep. No migration needed, because there is nothing on disk to migrate.** The lowercase
keys are correct as written and the camelCase spellings are authoritative.

The one thing worth adding is a guard: `PROP_KIND`'s contract is that its keys are lowercase, and
nothing enforces it. A camelCase key added to that table would never match, and would fail silently
— the classifier would just return `null` and the edge would go unclassified. That is a cheap test
(§6).

### 1.2 `mgx:cause` / `mgx:causes` is not a casing pair at all

Both spellings are lowercase. They are not two casings of one term; they are a **verb lemma** and a
**curated relation**, and folding one onto the other is a feature that already works.

`src/domain/hash.mjs`'s `CANONICAL_FACT_PREDICATE` is a closed table that folds a lemma the teach
lane mints onto the corpus's curated spelling:

| minted lemma | curated predicate |
|---|---|
| `mgx:cause` | `mgx:causes` |
| `mgx:desire` | `mgx:desires` |
| `mgx:want` | `mgx:desires` |
| `mgx:require` | `mgx:hasPrerequisite` |
| `mgx:involve` | `mgx:hasSubevent` |

`normFactPredicate()` applies it on the write path, so both spellings converge on one fact id — which
is the whole point, since a fact is content-addressed by `(subject, predicate, object)`. Left apart,
a taught fact and the corpus fact for the same triple would be two facts and neither reader would
find the other's.

**Confirmed against a real store.** Teaching `remember that fire causes smoke` and
`remember that boredom causes mischief` stores:

```
"subjectLabel":"fire mgx:causes smoke"
"subjectLabel":"boredom mgx:causes mischief"
```

`mgx:cause` occurrences: **0**. Teaching `smoke requires oxygen` stores `mgx:hasPrerequisite`, not
`mgx:require`.

**Verdict: keep.** The fold is deliberate, documented, and load-bearing. `mgx:cause` is an input
spelling that never reaches storage.

### 1.3 What the scan did turn up: one stale comment

`mgx:subclassOf` appears at `src/adapters/graph-build.mjs:18` and `src/domain/codegraph.mjs:1140`.
Both are **comments**. `graph-build.mjs:18`'s header comment lists it as an emitted edge:

```
//   mgx:subclassOf          Class  -> Class    (inheritance)
```

The file does not emit it. It emits `seon:hasSuperType` (`graph-build.mjs:380`, `:415`). The
`mgx:subclassof` key in `PROP_KIND` is filed under "legacy tokens (pre-realign graphs)", which is
where the real term went. `src/domain/memory/capability.mjs:58` names `mgx:subClassOf` too, in a
comment that correctly calls it "a term that exists nowhere".

**Verdict: `drop` (the comment).** Both files are owned by other work this cycle, so this is
recorded here rather than edited — see §7.

---

## 2. Inventory

Machine-generated by `scripts/term-inventory.mjs`. Terms are imported from the modules that define
them wherever a module exports them, so an imported constant cannot drift from the runtime; only
terms with no exported home are scanned from source text, and the scan reports its own `file:line`
evidence. Run `node scripts/term-inventory.mjs` for the report, `--json` for the record.

| group | count |
|---|--:|
| `mgx:` terms in the tree | 137 |
| `mgxneg:` terms in the tree | 3 |
| terms `ontology/tmct-core.ttl` defines | 18 |
| `mgx:` terms the ontology does **not** define | 119 |
| `mgxneg:` terms the ontology does **not** define | 3 |
| memory-vocabulary props | 33 |
| edge kinds | 11 |
| miss reasons | 4 |
| relation tokens | 10 |
| interface services | 16 |
| case-colliding groups | 13 (all benign — §1.1) |

**The headline: the ontology defines 18 of 137 coined terms.** The gap is not that tmct's terms are
wrong. It is that most of them have no formal home at all, so there is nothing for an outside graph
to reconcile against.

### 2.1 The `mgxneg:` prefix is undeclared in the ontology

`ontology/tmct-core.ttl` declares seven prefixes: `owl:`, `rdf:`, `rdfs:`, `xsd:`, `tmct:`, `mgx:`,
`seon:`. **`mgxneg:` is not among them, and the ontology defines no term in it.**

The store payload disagrees. `emptyMemory()` (`src/adapters/memory/core.mjs:105-111`) declares:

```js
prefixes: {
  owl: "...", rdf: "...", rdfs: "...",
  mgx: "urn:tmct:mgx#",
  mgxneg: "urn:tmct:mgxneg#",
},
```

So every graph tmct writes declares a namespace its own ontology has never heard of. The negative
polarity vocabulary — `mgxneg:capableOf`, `mgxneg:subClassOf`, and by construction every other
negated predicate — is ungrounded.

**`mgxneg:` is generative, not enumerable.** `negatedPredicate()` swaps the prefix on any `mgx:X`,
so `mgxneg:` contains exactly as many terms as `mgx:` does, minted on demand. The inventory finds 3
spelled out in source; the real set is open. This matters for the fix: the ontology must declare the
**namespace and the polarity convention**, not 137 hand-written twins. See §5.2.

`mgxneg:subClassOf` is the asymmetric case and deserves its own note: the polarity prefix is tmct's,
the term negated is RDFS's. It cannot be minted by the prefix swap, so `capability.mjs` states it
explicitly in `EXPLICIT_NEGATIVE_TWINS`. Its docstring already argues why it is not
`owl:disjointWith` — "john is not a man" denies one membership and says nothing about any other
john, so disjointness would over-claim. That reasoning is sound and survives this review.

### 2.2 The provenance vocabulary

The count that started this phase: `mgx:` 741 uses, `prov:` 3. Provenance is tmct's central claim,
and PROV-O is the W3C standard for exactly it.

The code already knows. `src/adapters/memory/core.mjs:84` carries this note on `mgx:derivedFrom`:

> "ext ref prov:wasDerivedFrom (UNVERIFIED-pending-web-check)"

The question was asked at authoring time and never closed. §4 closes it.

---

## 3. The standards

Read from primary sources, pinned to edition and date. Held under `docs/references/`, one entry per
standard, with the existing README-per-directory pattern. W3C specifications are cited by link and
brief excerpt under the W3C Document License — the specs themselves are not committed, per
`docs/references/README.md`'s licensing policy.

| standard | edition | date | entry | verified |
|---|---|---|---|---|
| **W3C PROV-O** | Recommendation | 2013-04-30 | [`prov-o.md`](docs/references/schemas/prov-o.md) | live spec, 2026-07-17 |
| **W3C SKOS Reference** | Recommendation | 2009-08-18 | [`skos.md`](docs/references/schemas/skos.md) | live spec + namespace RDF, 2026-07-17 |
| **SEON `code.owl`** | no `versionInfo`; IRI says `2012/02` | mirror last commit 2013-01-23 | [`seon-code-ontology.md`](docs/references/schemas/seon-code-ontology.md) | **the OWL file itself**, fetched 2026-07-17 |
| **ACE** | 6.7 | docs 2013-07-31 | [`ace-6.7.md`](docs/references/schemas/ace-6.7.md) | construction + interpretation rules, 2026-07-17 |
| **ConceptNet relations** | slice pins 5.7.0; 5.8 current | 5.8 released 2020-05-20 | [`conceptnet-relations.md`](docs/references/schemas/conceptnet-relations.md) | 2026-07-04, re-checked 2026-07-17 |
| **ISO 24617-2 (SemAF)** | **2**, current | 2020-12-02 | [`iso-24617-2-dialogue-acts.md`](docs/references/schemas/iso-24617-2-dialogue-acts.md) | **draft + editors' paper only** |

`docs/references/schemas/README.md` is the index and carries the rules for adding an entry.

**One entry is weaker than the others and says so.** ISO 24617-2:2020 is paywalled. It was not
bought and not pirated. The entry rests on the 2019 DIS draft that the standard's own editor posts
publicly, plus the editors' peer-reviewed LREC 2020 paper. No public tmct claim should rest on it
until someone reads the published text.

### What the reading changed

Research is only worth the time if it overturns something. It overturned three things:

- **`prov:wasDerivedFrom` is the wrong referent for `mgx:derivedFrom`.** The code guessed it and
  flagged the guess. The guess was wrong. §4.1.
- **`seon:History` and `seon:hasSupertype` do not exist**, and neither do `seon:Module`,
  `seon:ClassDefinition`, `seon:Attribute` or `seon:subKind`. §4.3.
- **ISO 24617-2's second edition has ten dimensions, not nine.** `/contactManagement/` was added in
  2020. Anything built from the 2012 list would be a version behind on arrival.

PDDL/STRIPS and JTMS/ATMS were already in `docs/references/planning/` and are not re-read here.
Their bearing on the vocabulary is recorded in §4.6.

---

## 4. Reconciliation

One verdict per coined term: `aligned` / `map` / `extend` / `rename` / `drop`.

Grouped by family. A 137-row table is not a document anyone reads, and 25 of those rows are one
decision made 25 times. Families with a single verdict are stated once with their count; every term
carrying its own decision gets its own row.

### Counts

| verdict | terms | where |
|---|--:|---|
| `aligned` | 21 | already spelling the standard's term |
| `map` | 34 | §4.1, §4.4 — the alignment triples now in `tmct-core.ttl` |
| `extend` | 26 | §4.2, §4.5, §4.6 — real concepts no standard carries |
| `rename` | 4 | §4.3 — all four borrow a prefix for a term the namespace does not define |
| `drop` | 2 | §4.3 — stale comments |

**No stored predicate is renamed, so nothing needs a migration.** The four renames are §4.3's, and
three of them are read-side or internal. The fourth is written, and it is written into a *derivable*
artifact — see §5.3.

### 4.1 Provenance → PROV-O — `map`

The finding, and the largest alignment.

**`mgx:derivedFrom` does not mean `prov:wasDerivedFrom`.** It means `prov:wasInfluencedBy`.

`mgx:derivedFrom` is an umbrella with two subproperties that split exactly the way PROV splits its
own vocabulary:

- `mgx:statedBy` — a Source **asserts** a Fact. That is attribution.
- `mgx:canonicalisedFrom` — a Fact is **cleaned from** a raw form. That is derivation.

PROV keeps attribution (`prov:wasAttributedTo`, Entity → Agent) and derivation
(`prov:wasDerivedFrom`, Entity → Entity) apart, and puts `prov:wasInfluencedBy` over both. That is
the shape `mgx:derivedFrom` already has. Claiming `prov:wasDerivedFrom` would narrow it to one of
its two halves, and would assert an Entity range for sources that are agents.

| tmct term | verdict | triple emitted | why |
|---|---|---|---|
| `mgx:derivedFrom` | `map` | `rdfs:subPropertyOf prov:wasInfluencedBy` | unconditionally true: every influence PROV names is one of these |
| `mgx:canonicalisedFrom` | `map` | `rdfs:subPropertyOf prov:wasDerivedFrom` | both ends are `prov:Entity` (a Fact cleaned from an Utterance) |
| `mgx:statedBy` | `map` | `rdfs:seeAlso prov:wasAttributedTo` | see the Source problem below |
| `mgx:saidInSession` | `map` | `rdfs:subPropertyOf prov:wasGeneratedBy` | Utterance (Entity) → Session (Activity) is that property's exact signature |
| `mgx:sessionStarted` | `map` | `rdfs:subPropertyOf prov:startedAtTime` | Activity → `xsd:dateTime`, same meaning |
| `mgx:createdAt` | `map` | `rdfs:seeAlso prov:generatedAtTime` | same meaning, wider domain — see below |
| `tmct:Utterance` | `map` | `rdfs:subClassOf prov:Entity` | a fixed digital thing |
| `tmct:Fact` | `map` | `rdfs:subClassOf prov:Entity` | this is what makes `canonicalisedFrom` a real derivation |
| `tmct:Session` | `map` | `rdfs:subClassOf prov:Activity` | occurs over time, generates its utterances |

**The Source problem, and why `statedBy` gets `seeAlso` and not `subPropertyOf`.**

`prov:wasAttributedTo` ranges over `prov:Agent`. `tmct:Source` **unions all three of PROV's disjoint
top classes**, keyed by `mgx:sourceType`:

| `mgx:sourceType` | what it is | PROV class |
|---|---|---|
| `operator`, `teach` | someone talking | `prov:Agent` |
| `corpus`, `corpusWeak`, `web`, `extracted` | a document | `prov:Entity` |
| `entailed` | a rule firing | `prov:Activity` |

Asserting `mgx:statedBy rdfs:subPropertyOf prov:wasAttributedTo` would entail that every corpus pack
is an Agent. So the ontology points at the term and states the restriction in prose instead. The
real alignment is to split `tmct:Source` by `sourceType`, and that changes a stored shape rather
than a label — which puts it outside this plan's bias. It is written up in §7 as the next step, not
declared out of reach.

`mgx:createdAt` has the same shape of problem, one size smaller: it means `prov:generatedAtTime`
exactly, but it is carried by Sessions too, which are Activities, where the PROV term is
`startedAtTime`. `seeAlso` says the true thing without the false entailment.

### 4.2 Trust → no standard — `extend`

`mgx:trustScore`, `mgx:trustInputs`, `mgx:sourceReliability`.

PROV records who said a thing, not whether to believe them. There is no trust or reliability term
anywhere in the Recommendation, and no W3C Recommendation covers it.

These stay `mgx:` and the ontology now says why. Candidate literatures, named so a future session
starts somewhere: Golbeck on trust propagation in social and semantic networks; Artz & Gil, "A
survey of trust in computer science and the Semantic Web" (*Journal of Web Semantics* 5(2), 2007);
the W3C Provenance Incubator Group's trust use cases.

`mgx:updatedAt` is an `extend` for a structural reason worth recording: **a `prov:Entity` does not
change.** PROV models an update as a new entity standing in `prov:wasRevisionOf` to the old one.
tmct mutates in place and keeps one id. Aligning would mean versioning every individual.

### 4.3 SEON → four terms borrowed under a prefix that does not define them — `rename`

The plan asked whether the SEON alignment is real or partial. It is **real and partial**: of the 24
distinct SEON spellings tmct uses, **19 are genuine SEON terms and 5 are not**.

The 19 are `aligned` and need nothing. `seon:hasSuperType` in particular is spelled correctly,
capital T and all, which is easy to get wrong — SEON itself is inconsistent (`hasSuperType` but
`hasSubtype`).

The five that are not:

| term | reality | verdict | reaches a store? |
|---|---|---|---|
| `seon:subKind` | SEON has no such property | `rename` → `mgx:subKind` | **yes** — `graph-build.mjs:146` writes it; present in `examples/polyglot/.tmct/graph.json` (×2) and `examples/mini-webapp/.tmct/graph.json` (×1) |
| `seon:Module` | SEON has `Namespace`; the file-level class is `main:File` | `rename` → `mgx:Module` | no — a router type tag (`registry.mjs:31`) |
| `seon:ClassDefinition` | SEON's class is `ClassType` | `rename` → `seon:ClassType` | no — a router type tag (`registry.mjs:32`) |
| `seon:Attribute` | SEON's instance-variable class is `Field` | `rename` → `seon:Field` | no — a comment in `tmct-core.ttl` |
| `seon:history` | SEON has no `History`; the real term is `history:isCommittedIn` | already handled | no — a legacy read key |

**`seon:history` is the one tmct already caught.** `graph-build.mjs:374` carries the note "seon:history
is not a real SEON property (cf. history:isCommittedIn)" and emits `mgx:touchedByCommit` instead.
The key that remains in `PROP_KIND` is a read-side legacy token. That realign is the model for the
other four.

**Why this matters more than a coinage under `mgx:`.** A term invented under tmct's own prefix is
honest — it says "we made this up". A term invented under **SEON's** prefix claims an authority that
does not exist. `seon:subKind` resolves to nothing; a reasoner given tmct's graph and SEON's
ontology gets an undefined IRI, and a reader who looks it up finds nothing and mistrusts the rest.

`seon:Attribute` is in this plan's own file and is fixed. The other three are not — see §7.

**Two `drop`s**, both stale comments naming terms nothing emits: `graph-build.mjs:18` lists
`mgx:subclassOf` as an emitted edge (the file emits `seon:hasSuperType`), and
`codegraph.mjs:1140`'s docstring says the same. §7.

### 4.4 Corpus relations → ConceptNet — `map`

**25 of ConceptNet's 34 relations are mirrored into `mgx:` by camelCasing the `/r/` name.** The
mapping table already records each origin in `src/adapters/corpus/conceptnet-map.toml`'s `rel`
field, so this was machine-generable and is now machine-checked.

Each mirrored predicate is declared in `tmct-core.ttl` with `rdfs:seeAlso cn:<Relation>`.

**`rdfs:seeAlso`, not `owl:equivalentProperty` or `skos:exactMatch`.** A ConceptNet `/r/` URI names a
relation in a data model that publishes no OWL semantics. `owl:equivalentProperty` asserts a shared
property *extension* that ConceptNet never defined. `skos:exactMatch` ranges over `skos:Concept`
(SKOS S19/S20), and a relation is not a concept. `seeAlso` cites the origin, which is what the
mirror needs and all it can honestly claim.

**The three deliberate divergences are upgrades, and they are right.** `/r/IsA` and `/r/DefinedAs`
map to `rdfs:subClassOf`; `/r/DistinctFrom` maps to `owl:disjointWith`. Where a standard term
exists, the corpus uses it instead of mirroring. That is the behaviour this whole phase is arguing
for, already in place.

Six relations emit no fact (the TOML's `ace = "none"` rows).

**ConceptNet's five deprecated negatives are not mirrored, and should not be.** `/r/NotIsA`,
`/r/NotDesires`, `/r/NotUsedFor`, `/r/NotCapableOf`, `/r/NotHasProperty` are slated for removal
upstream. tmct's `mgxneg:` prefix negates *any* predicate rather than five hand-picked ones, which
is strictly more general than the thing ConceptNet is deprecating.

### 4.5 SKOS → the corpus is not a concept scheme — `extend`

`mgx:relatedTo`, `mgx:synonym`, `mgx:antonym`, `mgx:similarTo`.

The tempting map is `mgx:relatedTo` → `skos:related`. Both are symmetric associative links, and the
definitions line up.

**It does not hold, for a reason worth writing down.** SKOS S19/S20 fix the domain and range of
`skos:semanticRelation` — and so of every sub-property, `skos:related` included — to `skos:Concept`.
tmct's corpus terms are **bare strings**. `normFactTerm` strips CURIE prefixes at write time, so
`tmct:module` is stored as `"module"`. There is no concept identity to hang `skos:Concept` on, and
asserting `skos:related` between two strings asserts they are Concepts, which they are not.

`mgx:synonym` has the same problem from the other side: SKOS models synonymy as two `skos:altLabel`s
on **one** concept, not as a relation between two. Mapping it would need the concept identity tmct
does not mint.

So these stay `mgx:`. The open problem is concept identity for corpus terms — minting a
`skos:Concept` per term, with the strings as `skos:prefLabel`/`skos:altLabel`. That is a stored-shape
change and a real piece of design, and `skos.md` plus ISO 25964 are where it would start. It is not
out of reach; it is unbuilt, and nothing in the current shape blocks it.

The SKOS reading was not wasted: it settled `rdfs:seeAlso` over `skos:exactMatch` in §4.4, and
`skos.md` records the S46 subtlety and the `owl:sameAs` argument for whoever does build it.

### 4.6 The vocabularies with no reconciliation yet

| family | verdict | note |
|---|---|---|
| `mgxneg:*` | `extend` | tmct's own polarity operator. Generative, so it is a *convention* to declare, not a term list. §5.2. |
| `MISS_REASONS` (4) | `extend` | `UNRESOLVED_TERM`, `CAPABILITY_ABSENT`, `TRUNCATED_GRAPH`, `NO_SOURCE`. These are reasons a machine could not answer, not dialogue acts. ISO 24617-2 has no such vocabulary; nothing else does either. |
| `EDGE_KINDS` (11), `RELATIONS` (10) | `aligned` | not coined terms at all — each is already keyed to a `tmct:` property by `EDGE_KIND_TO_TMCT`, and the props are SEON's or `mgx:`'s. The kind names are internal identifiers. |
| `SERVICES` (16) | `extend` | the Repository Interface's operation names. An interface's operations are not an ontology's terms, and no standard names them. |
| rule kinds (`compose2`/`filter`/`recursive`) | `extend` | structural tags, enforced closed by `shacl.mjs`. Now declared. |
| action rule kinds (`action-signature`/`action-precond`/`action-effect`) | **open** | the shape is STRIPS's and PDDL's exactly (`docs/references/planning/STRIPS_PDDL.md`), and the names are not. The `cap:` vocabulary is where that alignment lands. §7. |
| the `cap:` namespace (11 terms) | **open** | undeclared anywhere. `registry.mjs`'s capability/precondition/effect vocabulary. Not this plan's file. §7. |
| `taught:` (4 terms) | **open** | `taught:world-effect`, `taught:world-precond`, `taught:world-constraint`, `taught:world-effect-replaced`. Undeclared. §7. |
| JTMS/ATMS | `extend`, for now | `mgx:sourceRule` on an entailed Source is a JTMS justification in shape. The full JTMS vocabulary (in/out labels, support, nogoods) has no tmct counterpart because tmct does not retract on belief change. `PLAN_SYLLOGIST.md` already names the literature. |
| ISO 24617-2 dialogue acts | **unbuilt** | tmct has no intent vocabulary (`CAPABILITIES_2.0.3.md` row 139, `absent`). The mapping is drafted in `iso-24617-2-dialogue-acts.md` so that if one is built, it is built to the standard's names rather than coined ad hoc. The honest-miss reply is the interesting row: it is a claim about tmct's own processing, which is `/autoFeedback/`, not a `/task/` answer. |

---

## 5. Uplift

All of it lands in `ontology/tmct-core.ttl`. **No source file changed, and no stored predicate
moved**, so every `.tmct/graph.json` on disk stays valid.

### 5.1 Prefixes

Added: `prov:`, `skos:`, `cn:` (ConceptNet's relation namespace), and **`mgxneg:`**.

The `seon:` header note said "Namespace IRI as conventionally published;
UNVERIFIED-pending-web-check". It is now verified — the IRI resolves and serves the ontology, over
`http:` only. That quirk is recorded in `seon-code-ontology.md` rather than lost.

### 5.2 The `mgxneg:` namespace now has a home

This was the real defect, and it was not the casing one.

**Every graph tmct writes declares a namespace its own ontology had never heard of.**
`emptyMemory()` declares `mgxneg: "urn:tmct:mgxneg#"`. `tmct-core.ttl` declared seven prefixes and
that was not one of them. The whole negative-polarity vocabulary was ungrounded, including the
shipped `mgxneg:capableOf`.

The ontology now declares the namespace and, more importantly, **the convention** — because the
namespace cannot be enumerated. `negatedPredicate()` swaps the prefix on any `mgx:X`, so `mgxneg:`
holds exactly as many terms as `mgx:` does, minted on demand. Writing 122 hand-maintained twins
would be wrong the first time a corpus relation is added. Section 1b states the rule, and declares
only the two terms the code names explicitly.

It also records the two arguments the code makes and the ontology did not:

- **Why polarity rides on the predicate.** A Fact is content-addressed by (subject, predicate,
  object). A polarity flag as its own attribute would leave both polarities sharing one id, so "a
  penguin can fly" and "a penguin cannot fly" would union their `statedBy` edges into one fact that
  asserts and denies itself.
- **Why not `owl:disjointWith`.** Disjointness is a class-class axiom ("no man is a stone"). "john
  is not a man" denies one membership and says nothing about any other john. OWL 2's
  `owl:negativePropertyAssertion` says the right thing, but it is a reified axiom shape the flat
  JSON store has no room for — the same constraint that flattens pattern-4 intersections.

`mgxneg:subClassOf` is declared with its asymmetry explained: the polarity prefix is tmct's, the
term negated is RDFS's, so the prefix swap cannot mint it and `capability.mjs` states it.

### 5.3 Every documented memory property is now grounded

**Before: 18 of 28. Now: 28 of 28**, and a test holds it there.

The gap was not exotic. `mgx:updatedAt`, `mgx:sourceReliability`, `mgx:factQuantifier` and the seven
`mgx:rule*` props were documented in the payload's own `vocabulary` block and defined nowhere.

`mgx:factProvenance` is now marked `owl:deprecated true`. It is labelled "LEGACY COMPAT SHIM" in
three places and the source-of-truth moved to `statedBy` edges. `owl:deprecated` is the standard way
to say that, and it is additive.

### 5.4 What a rename would have cost, and why the distinction matters

The plan's rule is that a rename of a stored predicate needs a migration or it is data loss. That is
right, and it needs one refinement this phase found:

**tmct has two kinds of graph on disk, and only one of them is precious.**

| artifact | holds | derivable? | a rename costs |
|---|---|---|---|
| `.tmct/memory/graph.json` | taught facts, utterances, sessions | **no** | a real migration — nobody can regenerate what a visitor said |
| `.tmct/graph.json` | the code graph | **yes** — the indexer rebuilds it from source | a re-index, plus a legacy read key |

`PROP_KIND`'s "legacy tokens (pre-realign graphs)" block exists because that second rename already
happened once. It is the pattern, and it is why §4.3's `seon:subKind` rename is cheap despite being
written: it lands in a derivable artifact, so the migration is a rebuild.

Nothing in §4 renames anything in the memory graph.

---

## 6. Tests

An alignment claim is a claim, so it needs a test. `test/adapters/grammar-ontology.test.mjs` already
asserts the ontology mirrors the memory vocabulary; it is where the alignment gets pinned. It grew
from 4 tests to 10, all green (232ms).

| test | pins |
|---|---|
| well-formed Turtle | the prefix list, now 11 |
| **every namespace a written graph declares is a namespace the ontology declares** | the §5.2 defect, generically — any future prefix added to `emptyMemory()` and not to the ontology fails here |
| **every `mgx:` property the store's vocabulary documents has a definition in the ontology** | the §5.3 gap, generically — 28 of 28, and a floor so the vocabulary cannot shrink silently |
| the negative-polarity namespace is grounded | `mgxneg:`'s IRI matches the store's, and the asymmetric twin is declared |
| **the provenance family aligns to PROV-O** | §4.1, including the two *negative* claims: `mgx:derivedFrom` is NOT asserted as `prov:wasDerivedFrom`, and `statedBy` does NOT assert the Agent range |
| a prop token classifies by the ontology's camelCase spelling, whatever the casing | §1.1 — the case-insensitivity contract, through the public `relationKind` |
| every corpus relation mirrored from ConceptNet cites its origin | §4.4 — read from the TOML, so a new mirrored relation without a `seeAlso` fails |

**Three of these are generic rather than enumerated**, which is the point. A test that lists today's
terms passes forever and catches nothing. These read the runtime's own vocabulary and the mapping
table, so the next term added is the next term checked.

**The negative assertions matter as much as the positive ones.** `mgx:derivedFrom rdfs:subPropertyOf
prov:wasDerivedFrom` is the mistake the code already made once, in a comment. The test now fails if
anyone re-asserts it.

**The helper is not a rubber stamp.** The `clause()` regex was checked against eight cases including
a nonexistent subject and a nonsense object; it discriminates correctly on all eight.

Blast radius run: `node --test test/adapters/grammar-ontology.test.mjs` (10 pass),
`npm run test:smoke` (green), `npm run test:fast`, `npm run check:links` (OK). `npm test` is the
coordinator's, once, at the end.

---

## 7. Next steps that need a file this plan does not own

Ordered by what they cost. Each has a verdict already; none needs more research.

### 7.1 `seon:subKind` → `mgx:subKind` — the one stored undefined IRI

**`src/adapters/graph-build.mjs:146`, `src/tools/schema-docs.mjs:157`, `src/domain/codegraph.mjs`.**

SEON has no `subKind` property. tmct writes one, under SEON's prefix, into every code graph it
builds — `examples/polyglot/.tmct/graph.json` (×2) and `examples/mini-webapp/.tmct/graph.json` (×1)
carry it today.

The fix follows the `seon:history` realign exactly:

1. `graph-build.mjs` emits `mgx:subKind`.
2. `codegraph.mjs`'s `PROP_KIND` keeps `"seon:subkind"` as a legacy read key, in the block that
   already exists for pre-realign graphs.
3. Re-index the example graphs.
4. `tmct-core.ttl` declares `mgx:subKind` (this plan's file — say the word and it lands).

**No migration needed.** A code graph is derivable; the indexer rebuilds it. §5.4.

### 7.2 `seon:Module` and `seon:ClassDefinition` — router type tags

**`src/domain/router/registry.mjs:31-32`.**

Neither is a SEON term. `seon:ClassDefinition` → **`seon:ClassType`**, which is the real SEON class
and means exactly what the tag means. `seon:Module` has no SEON equivalent (SEON's nearest are
`Namespace` and `main:File`, and neither is a JS module) → **`mgx:Module`**.

Cheapest of the four: these are internal type tags for capability-parameter validation. They reach
no store.

### 7.3 The stale comments — `drop`

- `src/adapters/graph-build.mjs:18` lists `mgx:subclassOf` as an emitted edge. The file emits
  `seon:hasSuperType`.
- `src/domain/codegraph.mjs:1140`'s docstring says `inherits` is `mgx:subclassOf`. Same correction.

### 7.4 The `cap:` and `taught:` namespaces are undeclared

**`src/domain/router/registry.mjs`, `src/domain/router/taught.mjs`.**

`cap:` has 11 terms (`cap:Capability`, `cap:Parameter`, `cap:Precondition`, `cap:Effect`,
`cap:graph-loaded`, `cap:resolves`, `cap:any-present`, …). `taught:` has 4. Neither is declared in
any ontology file or any store payload — the same defect class as `mgxneg:` in §5.2, found by the
same scan.

**And `cap:`'s vocabulary has a standard waiting for it.** A capability is a signature, a
precondition and an effect. That is STRIPS's operator model and PDDL's action model, both already
sitting in `docs/references/planning/STRIPS_PDDL.md`. `cap:Precondition` and `cap:Effect` are
PDDL's `:precondition` and `:effect` under other names. Declaring the namespace and citing PDDL is
one pass, and it is the natural companion to this one.

### 7.5 The Source split — the real PROV alignment

**`src/adapters/memory/core.mjs`, and every reader of `mgx:sourceType`.**

§4.1's `seeAlso`-not-`subPropertyOf` compromise exists because `tmct:Source` unions `prov:Agent`,
`prov:Entity` and `prov:Activity`. Splitting it by `sourceType` would let `mgx:statedBy` assert
`prov:wasAttributedTo` properly for actor sources, `prov:hadPrimarySource` for documents, and
`prov:wasGeneratedBy` for entailments.

This one **does** touch a stored shape and **does** need a migration story — `sourceType` is
already on every Source individual on disk, so the split is derivable from what is stored, which
makes it a read-side reclassification rather than a rewrite. That is a design worth doing
deliberately, not folded into a vocabulary pass.

### 7.6 Concept identity for corpus terms — the SKOS alignment

§4.5. Minting a `skos:Concept` per corpus term, with the strings as `skos:prefLabel` /
`skos:altLabel`, would let `mgx:synonym` and `mgx:relatedTo` map onto SKOS. It needs concept
identity that does not exist yet. `docs/references/schemas/skos.md` and ISO 25964 are the starting
points, and ISO 704 / ISO 25964 have not been read at all.

---

## 8. README standards section — draft

`README.md` is another agent's file this cycle, so this is a draft to lift, not an edit.

Phase 9's prose rules apply, and the constraint is the interesting part: **no boasting.** "Facts
carry PROV-O provenance" is checkable. "Built on open standards" is selling. Every row below is
pinned by a test in `test/adapters/grammar-ontology.test.mjs`, and the two rows that are *not*
alignments say so rather than being quietly dropped.

---

### Standards

tmct's vocabulary is grounded in published standards where they exist, and says so where they
don't. Each alignment below is a triple in `ontology/tmct-core.ttl` and a test in
`test/adapters/grammar-ontology.test.mjs`.

| standard | edition | what tmct uses it for |
|---|---|---|
| [W3C PROV-O](https://www.w3.org/TR/prov-o/) | Recommendation, 2013-04-30 | Provenance. A fact's source links are sub-properties of `prov:wasInfluencedBy`; a fact cleaned from a raw utterance is a `prov:wasDerivedFrom`; a session is a `prov:Activity` and the utterances in it are `prov:Entity`s it generated. |
| [W3C OWL 2 / RDF / RDFS](https://www.w3.org/TR/owl2-primer/) | Recommendation | The triple model itself. The grammar emits `rdfs:subClassOf`, `owl:Restriction`, `owl:someValuesFrom`, `owl:disjointWith` and cardinality axioms; facts are RDF-reified statements. |
| [SEON](http://se-on.org/) `code.owl` | `2012/02` | Code-graph vocabulary: `seon:hasSuperType`, `seon:containsCodeEntity`, `seon:declaresMethod`, `seon:invokesMethod` and 15 more. Where SEON has no term, tmct coins under its own `mgx:` prefix and does not borrow SEON's. |
| [ACE 6.7](http://attempto.ifi.uzh.ch/site/docs/) | 6.7, 2013 | The controlled-English fragment. tmct implements 9 of ACE's declarative sentence patterns. |
| [ConceptNet](https://github.com/commonsense/conceptnet5/wiki/Relations) | slice pins 5.7.0 | The commonsense corpus. 25 relations are mirrored into `mgx:` and each cites its `/r/` origin; `/r/IsA` and `/r/DistinctFrom` use `rdfs:subClassOf` and `owl:disjointWith` instead. |
| [STRIPS / PDDL](https://en.wikipedia.org/wiki/Planning_Domain_Definition_Language) | — | The action-rule model: signature, precondition, effect. |

`docs/references/schemas/` holds an entry per standard — the edition, the retrieval date, the terms
tmct uses, and what could not be verified.

**Where tmct diverges, on purpose:**

- **ACE reads "a" as existential; tmct reads it as universal.** "a dog is a mammal" is stored as a
  subclass axiom, because that is what someone teaching it means. ACE's other composite forms
  (conditionals, coordination, "it is false that") are not implemented and land on the miss wall
  rather than being guessed at.
- **Negation.** tmct negates with its own `mgxneg:` prefix, which applies to any predicate.
  `owl:disjointWith` would over-claim ("john is not a man" denies one membership, not a class
  axiom), and OWL 2's `negativePropertyAssertion` needs a reified shape the flat JSON store has no
  room for.

**Where no standard fits:**

- **Trust.** PROV records who said a thing, not whether to believe them, and no W3C Recommendation
  covers trust. `mgx:trustScore` and its inputs are tmct's own.
- **Dialogue acts.** tmct has no intent vocabulary. ISO 24617-2 (SemAF) is the standard for one, and
  `docs/references/schemas/iso-24617-2-dialogue-acts.md` maps tmct's behaviour onto it, so that if
  one is built it uses the standard's names.

---

**Notes for whoever lands this.** The ISO row is deliberately not in the table: tmct uses it for
nothing today, and a table row would imply otherwise. The PDDL row is in the table because the
action-rule shape genuinely is PDDL's — but if §7.4 has not landed when the README is written, cut
that row, because the `cap:` vocabulary does not cite PDDL yet and the row would be a claim without
a test.
