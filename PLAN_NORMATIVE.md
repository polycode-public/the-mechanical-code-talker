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
| action rule kinds (`action-signature`/`action-precond`/`action-effect`) | `extend` | the shape is STRIPS's and PDDL's exactly (`docs/references/planning/STRIPS_PDDL.md`), and the names are not. Now grounded via `cap:`/`taught:`, §7.4. |
| the `cap:` namespace (11 terms) | `extend` — now declared | `registry.mjs`'s capability/precondition/effect vocabulary. Declared in `tmct-core.ttl` §1c as a generative convention, cite STRIPS/PDDL. §7.4. |
| `taught:` (4 terms) | `extend` — now declared | `taught:world-effect`, `taught:world-precond`, `taught:world-constraint`, `taught:world-effect-replaced`. Declared in `tmct-core.ttl` §1c, layered on `cap:`. §7.4. |
| JTMS/ATMS | **`map` — and this row was wrong** | See §9.9. tmct's justification is **ATMS**, not JTMS, and tmct **does** retract on belief change. |
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

### 7.1 `seon:subKind` → `mgx:subKind` — the one stored undefined IRI — LANDED

Emit (`graph-build.mjs:146`) and its vocabulary note and schema doc now say `mgx:subKind`; the
ontology declares it (owned, the mgx:touchedByCommit precedent). Example graphs and fixture repos
re-indexed through the real generators. **Step 2 (a `seon:subkind` legacy read key in
`codegraph.mjs`'s `PROP_KIND`) had no site: `subKind` is an ATTRIBUTE, never a relation, so it
never entered `PROP_KIND` and old graphs render it generically by its own token with no alias.**

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

### 7.2 `seon:Module` and `seon:ClassDefinition` — router type tags — LANDED

**`src/domain/router/registry.mjs:31-32`.**

Neither is a SEON term. `seon:ClassDefinition` → **`seon:ClassType`**, which is the real SEON class
and means exactly what the tag means. `seon:Module` has no SEON equivalent (SEON's nearest are
`Namespace` and `main:File`, and neither is a JS module) → **`mgx:Module`**.

Cheapest of the four: these are internal type tags for capability-parameter validation. They reach
no store.

### 7.3 The stale comments — `drop` — LANDED

Both now name `seon:hasSuperType`, what the code actually emits.

- `src/adapters/graph-build.mjs:18` listed `mgx:subclassOf` as an emitted edge. The file emits
  `seon:hasSuperType`.
- `src/domain/codegraph.mjs:1253`'s docstring said `inherits` is `mgx:subclassOf`. Same correction.
  (The plan cited `:1140`; the line had shifted to `:1253` at HEAD.)

### 7.4 The `cap:` and `taught:` namespaces are undeclared — LANDED

`tmct-core.ttl` §1c declares both namespaces and the convention (the `mgxneg:` precedent): the
Capability/Parameter/Precondition/Effect model as STRIPS/PDDL operators, `cap:Precondition` /
`cap:Effect` cited as PDDL's `:precondition` / `:effect`. Both are generative and internal — they
reach no store — so, unlike `mgx:`, no payload declares them. `registry.mjs` gained the `taught:`
IRI so the code carries a single source of truth for it.

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

### 7.7 `factIdFor`'s 32-bit hash — the one that is not a naming fix

**`src/domain/hash.mjs:139`.** §9.1 has the proof: a real collision at 26,034 triples, and silent
data loss when both facts are written. 45.4% collision probability at `init:xl`'s documented 72,075
facts; 99.9% at `init:xxl`.

Widen `factIdFor` to at least 64 bits. `sha256Bytes` already ships in the same file, already pinned
byte-identical to `node:crypto` by a test — truncate it. This is not a crypto problem.

**This one needs a real migration**, and it is the only item in this plan that does. The memory graph
is not derivable (§5.4). But the migration is tractable: a Fact stores its own `(s, p, o)` in
`rdf:subject`/`rdf:predicate`/`rdf:object`, so every id is recomputable from the payload — rewrite
the ids and the `statedBy`/`derivedFrom` edges that point at them. A store written before the change
keeps working if the reader falls back to the old id on a miss, the same legacy-key pattern §7.1
uses.

Do not do this quietly alongside something else. It changes every fact id on disk.

### 7.8 `syllogise` — a public CLI verb, so not this plan's call

**`src/domain/syllogise.mjs`, `src/domain/cli-verbs.mjs`, `npx tmct syllogise`.** §9.3. `scm-sco` is
a genuine syllogism (Barbara); `cls-svf1` and the cardinality rules are not. The engine is a
forward-chaining fixpoint, which its own header already says.

Two defensible options, and the operator picks: keep `syllogise` as the product-facing verb and name
the mechanism accurately in the code, or rename the verb. A rename touches a published CLI surface.

### 7.9 Damerau-Levenshtein → Optimal String Alignment

**`src/domain/interpret/fuzzy.mjs:19`** (the comment) and **`PLAN_DEPS.md` §3.5** (the prose).
§9.4 has the proof: `editDistance("CA","ABC") = 3`, and true Damerau-Levenshtein gives 2.

A comment and a doc sentence. No behaviour changes, and **`PLAN_DEPS` §3.5's decision is unaffected**
— its argument is "it handles transpositions, the libraries don't", which is true of OSA too. Say
"Optimal String Alignment (restricted Damerau-Levenshtein)" and cite Damerau 1964 and Levenshtein
1966. Worth adding that OSA is not a metric, since that is the thing someone will trip over next.

### 7.10 The storage vocabulary renames

All doc and comment level, all cheap, none behavioural. §9.2:

- **`ledger` → `append-only log`**, or drop the metaphor. `src/domain/cli-verbs.mjs`,
  `src/services/ledger-viz.mjs`, `src/services/viz-theme.mjs`, the web surface. Note the twist: the
  thing called a ledger is a *view*, and the store beneath it is not append-only either. If the name
  is meant as a UI label for `tmct viz`, that is defensible — but then it should not appear in
  storage prose.
- **`content-addressed` → `content-derived (non-cryptographic 32-bit)`** until §7.7 lands. After
  §7.7, "content-addressed" is earned.
- **`mgx:updatedAt`'s prose** — call it an audit/last-modified stamp, not transaction time. The
  ontology comment (this plan's file) already says the right thing.
- **Name reification.** tmct does textbook RDF reification and the word appears nowhere. One
  sentence in `src/adapters/memory/core.mjs`'s header pointing at
  `docs/references/schemas/rdf-reification-and-rdf-star.md` closes it.
- **`materialise` / `materialize`** — 24 and 28. Pick one.

### 7.11 Cite the honest miss

§9.8. "Honest miss" (285 uses) should keep its name and gain its citation: abstention / selective
prediction, with Chow 1970's reject option as the root. One line in the README and one in
`CLAUDE.md`'s ethos prose.

### 7.12 Four wrong citations in the inference engine

All verified against *OWL 2 Profiles (Second Edition)*, W3C Recommendation 2012-12-11. **Table
numbering is identical in the first edition, so no edition excuses any of these.**

1. **`cls-svf1` is cited as "OWL 2 RL Table 8" three times. It is Table 6.** Table 8 is *The
   Semantics of Datatypes* — a different subject entirely. Sites: `src/domain/syllogise.mjs:64`,
   `src/domain/syllogise.mjs:314`, `src/services/chat.mjs:7406`. The `scm-svf1`/Table 9 citations
   are all correct.
2. **`cax-maxc0` is not a W3C rule name.** No such rule exists in any table. The real one is
   **`cls-maxc1`** (Table 6). `syllogise.mjs:555-559`'s comment already grounds this honestly — but
   the id is shaped exactly like a W3C name and appears in `PLAN_SYLLOGIST.md`, `infbench/` and
   tests, where a reader takes it for one. Same for `SCM_SVF_RULE` / `SCM_CARD_RULE`.
3. **`PLAN_SYLLOGIST_EL_DL.md:11` says all seven kernels are "inside the OWL 2 RL fragment". Two are
   not, and the code says so.** `syllogise.mjs:527` already says cardinality monotonicity is
   "outside OWL 2 RL's own decidable profile". And `cax-maxc0` is a *universal generalization* of
   `cls-maxc1` — but `cls-maxc1` derives `false` **for one individual**, where tmct derives a
   **class-level negative fact**. That is a strictly stronger step OWL 2 RL does not license.
4. **`syllogise.mjs:972`'s "JTMS-style dependency-directed removal" is DRed**, not JTMS. §9.9.

Minor: `PLAN_SYLLOGIST_EL_DL.md:25` heads a tier "**OWL 2 DL** (target: ALC first, growing toward
**SHOIQ**)". OWL 2 DL's logic is **SROIQ**; SHOIQ is weaker and different (SHOIN(D) is OWL 1 DL).
The SHOIQ *target* is sound and deliberately argued — it is the "OWL 2 DL" label over it that is
imprecise. And `PLAN_SYLLOGIST.md`'s "there is no stored justification to walk at all today" is
stale: `syllogise.mjs:758+` persists one.

### 7.13 The vocabulary test should read what a store writes, not what it documents

§9.10. `mgx:factJustification` was emitted by production code and declared in no ontology file, and
my §6 test passed at 28 of 28 because the prop is absent from `MEMORY_VOCABULARY` — so it fell
through both gates at once.

The ontology side is fixed (this plan's file). The test is stronger if it diffs the props a **real
store actually writes** against the ontology, the way §1 settled the casing question. That needs a
seeded store in the test, which is the `test:fast` budget's business and not this plan's call.

### 7.6 Concept identity for corpus terms — the SKOS alignment

§4.5. Minting a `skos:Concept` per corpus term, with the strings as `skos:prefLabel` /
`skos:altLabel`, would let `mgx:synonym` and `mgx:relatedTo` map onto SKOS. It needs concept
identity that does not exist yet. `docs/references/schemas/skos.md` and ISO 25964 are the starting
points, and ISO 704 / ISO 25964 have not been read at all.

---

## 9. The whole-repository term review

§1-§8 reviewed the CURIEs. That was the wrong scope, and `PLAN_OPEN_ITEMS.md` §10 set it. A term
does not have to be a triple to be a term: an identifier, a function name, a doc word and a test
tier all name concepts, and those concepts have literatures.

**A term needs a verdict when it names a concept from a discipline.** `src/` declares 1,802 distinct
concept words across its identifiers; most of them (`idx`, `rows`, `tail`, `next`) name nothing a
discipline has a word for, and reviewing them would be theatre. The register below is the terms that
do.

### 9.1 The finding: a terminology review found a live data-loss bug

**`factIdFor` is a 32-bit hash, and tmct's own documented corpus sizes are past its birthday bound.**

This is a terminology finding before it is a bug finding, and the route matters. tmct calls its fact
ids **content-addressed**. Git and IPFS are the two examples every reader has, and both use
cryptographic hashes — so the term silently imports collision resistance that `fnv1a32` does not
have. Meanwhile `hash.mjs:137` says the NUL delimiter is "collision-proof unlike a space", which is
true *of the delimiter* and sits two lines above the hash where the real collision lives. **The word
was doing the reassuring, and nothing was doing the checking.**

`src/domain/hash.mjs:139`:

```js
export const factIdFor = (s, p, o) => `fact:${fnv1aHex(`${s}\0${p}\0${o}`)}`;
```

`fnv1aHex` is FNV-1a **32-bit**, 8 hex characters. N = 2³². Against the fact counts `HANDOVER.md`
publishes, measured on real hardware:

| init tier | facts | P(at least one collision) |
|---|--:|--:|
| `init` (default) | 664 | 0.0% |
| `init:large` | 37,797 | **15.3%** |
| `init:xl` | 72,075 | **45.4%** |
| `init:xxl` | 238,866 | **99.9%** |

**Not a theoretical bound.** A real collision, found by brute force at **26,034 triples** — below
`init:large`:

```
(thing23102, mgx:atLocation, value3156)  -> fact:495ee929
(thing26033, mgx:causes,     value6087)  -> fact:495ee929
```

**And a collision is silent data loss.** Written to a real store, two distinct facts in, one out, no
error:

```
facts written: 2
facts stored : 1
  fact:495ee929  ->  (thing26033, mgx:causes, value6087)
```

`hash.mjs:23` says "Same (s,p,o) → same id → upsert, never a dup". That direction holds. The
converse — different (s,p,o) → different id — is what fails, and **the upsert path turns the failure
into a merge instead of a crash**.

RFC 9923 (Informational, February 2026) is unambiguous: "No assertion of suitability for
cryptographic applications is made for the FNV hash algorithms", and FNV is "NOT RECOMMENDED for any
application that requires that it be computationally infeasible" to find collisions.

**The fix is already in the file.** `hash.mjs:45` ships `sha256Bytes`, pinned byte-identical to
`node:crypto` by a test, added for the same synchronous / browser-safe / dependency-free reasons.
Truncating it to 64 or 128 bits closes the gap with code that already exists and is already tested.
At 64 bits, 100,000 facts give ≈ 2.7 × 10⁻¹⁰.

**The blocker is a migration, not cryptography**, and the migration is tractable: a fact stores its
own `(s, p, o)` in `rdf:subject`/`rdf:predicate`/`rdf:object`, so every id is recomputable from the
payload. The rewrite is the ids plus the `statedBy`/`derivedFrom` edges pointing at them. This is
the one place in this plan where the memory graph — which is **not** derivable (§5.4) — genuinely
needs one.

`src/domain/hash.mjs` is not this plan's file. **§7.7.**

### 9.2 Storage — where the operator predicted the most drift, correctly

| term | verdict | finding |
|---|---|---|
| `content-addressed` | **rename** → "content-derived (non-cryptographic 32-bit)" | §9.1. The term borrows Git/IPFS's implied collision resistance. |
| **reification** | **extend** — and *name it* | tmct does textbook RDF reification (`tmct:Fact rdfs:subClassOf rdf:Statement`) and **the word appears 0 times in the repo**. It does the thing and never says the thing. |
| `ledger` (81 uses) | **rename** → "append-only log", or drop the metaphor | The literature has no such term of art: it appears in none of LSM-tree, log-structured file systems, WAL/ARIES or Kafka. ISO 22739 (blockchain/DLT vocabulary) defines it as records "final, definitive and immutable". **tmct's ledger is neither.** It is `tmct viz` — an HTML *view* of the memory graph around a focus term. And the store underneath is not append-only either: `removeFacts` exists and upsert mutates in place. The word promises immutability twice and delivers a report. |
| `mgx:createdAt` | `aligned`, partially | transaction-time **start**, and only the start. No end, so not an interval. |
| `mgx:updatedAt` | **rename** → audit / last-modified stamp | **not transaction time.** Transaction time cannot be changed by definition; a mutable stamp destroys when the previous version stopped being current. tmct is **not bitemporal**, and the concrete test it fails is the transaction-timeslice query: "what did we believe last Tuesday". |
| `mgx:utteranceTs` | `aligned` | valid time, as an instant — correct while the modelled fact is the utterance-event, which is what the ontology says. |
| "provenance" | `aligned` | correct in the PROV-DM/PROV-O sense. **Not** how-provenance: tmct records which *rule* entailed a fact (`mgx:sourceRule`) but not which *antecedent facts* fed it. That gap is the whole distance to why-/how-provenance, and it is bridgeable — the fixed point already runs. |
| `merkle` | correctly absent | tmct is not a Merkle tree and must not claim to be: no internal nodes, no root committing to the set, no inclusion proofs. |
| `bitemporal`, `named graph`, `rdf-star`, `event sourcing` | absent | 0 uses each. §9.2.1. |

Reference: `docs/references/schemas/content-addressing-and-storage.md`.

#### 9.2.1 Reification is not deprecated — my own premise was wrong

I went looking to confirm that RDF reification is deprecated in favour of RDF-star. **It is not.
Not in RDF 1.1, not in RDF 1.2, not anywhere.** "Deprecated" never appears against it, and RDF 1.1
Semantics *endorses* it for tmct's exact use case:

> "This supports use cases where properties such as dates of composition or provenance information
> are applied to the reified triple."

What is true is narrower and more useful: **RDF 1.2 Schema §7 "Legacy vocabularies", §7.2
"Old-style" Reification** holds `rdf:Statement` and friends, non-normative, and says the newer
constructs are "generally recommended as preferable alternatives for new developments". That is
soft-deprecation by editorial demotion, and it is the strongest anti-reification statement that
exists.

**The drift worth policing is the opposite of the one I expected.** RDF-star's `<< :s :p :o >>`
quoted triples are a **2021 Community Group design the Working Group did not adopt**. RDF 1.2
(Candidate Recommendation, 2026-04-07 — *not* a Recommendation) uses **triple terms** `<<( )>>`,
object position only, plus `rdf:reifies` and reifiers. Citing `<< >>` in 2026 is citing a superseded
design.

**Verdict: keep reification, and say what it is.** The accurate sentence is "tmct uses the RDF 1.1
reification vocabulary, which RDF 1.2 reclassifies as legacy and steers new systems away from". The
migration horizon is cheap to describe: **a tmct Fact already *is* a reifier**, so `rdf:reifies` maps
onto the model almost exactly. Nothing needs to happen until RDF 1.2 is a Recommendation.

Reference: `docs/references/schemas/rdf-reification-and-rdf-star.md`.

### 9.3 Logic and inference — in better shape than expected

`src/domain/syllogise.mjs` **already uses the OWL 2 RL/RDF rule names and already cites them**:
`scm-sco`, `cax-sco`, `cax-dw`, `cls-svf1`, `scm-svf1`, `cls-maxc1` — the real, numbered rule
identifiers, with "OWL 2 RL Table 8" and "W3C OWL 2 RL Table 9" in the comments. It uses `⊨`
correctly and flags where it steps outside the profile ("outside OWL 2 RL's own decidable profile"
on the cardinality rule).

**That is the alignment this whole phase argues for, already in place.** Verdict `aligned`. The gap
is only that no reference entry pinned the spec's edition — now `OWL 2 Profiles (Second Edition),
W3C Recommendation, 2012-12-11`. Note for citers: the document's section order is **EL §2, QL §3,
RL §4** — not alphabetical.

| term | verdict | note |
|---|---|---|
| `scm-sco` / `cax-sco` / `cax-dw` / `cls-svf1` / `scm-svf1` | `aligned` | OWL 2 RL/RDF rule ids, cited by table |
| `entailment` (10) vs `inference` (385) | `aligned` | the ratio looked like drift and is not: `syllogise.mjs` reserves ⊨/"entails" for the specific claim and uses "inference" for the activity, which is correct |
| `materialise` (24) / `materialize` (28) | **rename** → pick one | both spellings ship. House style, not terminology — but it is in the payload's own vocabulary notes |
| `syllogise` | open | see below |
| `justification`, `premise` | `map` | JTMS's vocabulary (Doyle 1979). tmct's `mgx:sourceRule` is a justification's *rule* without its *antecedents* — same gap as §9.2's how-provenance row, one bridge fixes both |

**`syllogise`: keep the verb, and do not let it become the technical vocabulary.**

The objection anyone will raise — "a syllogism means two premises and three terms" — turns out to be
**the later tradition's definition, not Aristotle's**. *Prior Analytics* I.1, 24b18–20: "A syllogism
is discourse in which, certain things being stated, something other than what is stated follows of
necessity from their being so." No three terms, no two premises, no figures; the premises are plural
and unrestricted. Robin Smith — who is both the Hackett translator and the SEP author — translates
*sullogismos* as **"deduction"** precisely because "in modern usage, 'syllogism' means an argument of
a very specific form". The **Stoics** used the word for a purely propositional system in which
**modus ponens is a *sullogismos***, which settles that the word was never Aristotle-form-specific.
Forward chaining is closer to Stoic *sullogismoi* than to Aristotle's figures.

Three of tmct's five rules are literally term-logical — `scm-sco` **is** Barbara, `cax-sco` **is** the
Socrates syllogism, `cax-dw` is Celarent-shaped. Two are provably not: `cls-svf1` and `scm-svf1`
carry a binary relation in the antecedent, which is exactly what term logic cannot reach.

What weighs the other way is narrower than the objection, and real: **the noun's breadth does not
transfer to the verb.** Every dictionary reachable defines "syllogise" narrowly. And **the field
never uses the word** — `syllogis*` occurs **0 times** in all 16 chapters of the *Description Logic
Handbook* (1.24M characters), against subsumption 370 and classification 57. The literatures are
"interestingly isolated", and one peer-reviewed paper says so outright (Çine, UBMK 2018).

**But the repo never claims Aristotle** — grepped, and there is no Aristotelian claim anywhere in
docs, tests or source. `README.md` already glosses the verb accurately on first use. Nothing
overclaims today, and a CLI subcommand does not carry a scholarly claim's precision burden.

**Verdict: keep `syllogise`, and gloss it. The fix is three sentences, not a rename.**

The division of labour is **already right** and that is the thing to notice: the module header says
"forward-chains", the plans say "Datalog-shaped", `PLAN_SYLLOGIST.md` cites Forgy and RETE. tmct
already uses the field's words wherever it describes the mechanism, and reserves `syllogise` for the
command. **The only gap is that the word is never explained**, so a reader who knows the narrow
definition sees a stretch and has nothing to read that says otherwise.

So: say in the README (done — §8's draft) and in the module header that the word is used in the
older broad sense of *sullogismos*, that `scm-sco` and `cax-sco` are Barbara and the Socrates
syllogism, and that the operation's own names are forward chaining and materialisation. That turns a
loose word into an informed one and makes the objection unlandable, without touching a shipped CLI
subcommand.

A rename stays available and gets cheaper the further `PLAN_SYLLOGIST_EL_DL.md` grows the rule set
past term logic — but it is not needed to be correct today. The module header is not this plan's
file. **§7.8.**

### 9.4 IR and NLP — `fuzzy.mjs` does not implement Damerau-Levenshtein

**It implements Optimal String Alignment.** `fuzzy.mjs:19` says "hand-rolled
Damerau-Levenshtein". `PLAN_DEPS.md` §3.5 says "It is Damerau-Levenshtein."

Proven by the discriminating case:

```
editDistance("CA", "ABC", 9) = 3
```

True Damerau-Levenshtein gives **2** (transpose `CA`→`AC`, insert `B`). OSA gives 3, because no
substring may be edited twice. The implementation keeps only two previous rows (`prev2`), which is
the OSA recurrence; true Damerau-Levenshtein needs a full last-seen-position table.

- **Damerau** (1964), "A technique for computer detection and correction of spelling errors", *CACM*
  7(3), pp. 171–176 — added transposition of two **adjacent** characters.
- **Levenshtein** (1966), "Binary codes capable of correcting deletions, insertions, and reversals",
  *Soviet Physics Doklady* 10(8), pp. 707–710 — insertion, deletion, substitution.
- OSA is **not a metric** (it violates the triangle inequality). True Damerau-Levenshtein is.

**`PLAN_DEPS` §3.5's decision survives intact, and that is the point.** Its load-bearing claim is
"it handles transpositions; `leven` and `fastest-levenshtein` do not". True of OSA as well —
`editDistance("ab","ba") = 1`. So *keep, emphatically* stays right. Only the name is wrong.
Verdict: **rename** the term in the comment and in `PLAN_DEPS` §3.5. Neither is this plan's file.
**§7.9.**

Elsewhere NLP is clean:

| term | verdict | note |
|---|---|---|
| `lemma` (311), `lemmatize` (4), `stemming` (0) | `aligned` | tmct lemmatizes and does not stem, and says so. Porter stemming is correctly absent |
| `anaphora` (127) vs `coreference` (3) | `aligned` | tmct resolves a pronoun to a standing referent. That is anaphora resolution, not coreference clustering. The rarer word is the right one |
| `copula`, `determiner`, `quantifier` | `aligned` | ACE's own lexicon categories (`ace-6.7.md`) |
| `predicate` | **polysemy, worth a note** | logic/RDF sense (the middle of a triple) vs grammar sense (what is said about the subject). tmct means the RDF sense throughout, and also ships a grammar. Both senses are legitimate; the collision is real |
| `grounding` (80) | **polysemy, worth a note** | tmct means *OWL grounding* (a type traces to the ontology). Planning means *instantiating an action schema with constants*. tmct does both things and uses the word for only one |

### 9.5 Testing — a coherent taxonomy that is not the standard one, and is not written down

tmct's tiers are `smoke`, `fast`, `adapters` (120 files), `tools`, `estate`, `corpus`, `bench`,
`readme`, plus `e2e/`. That is **two taxonomies at once**: architectural layer (adapters, tools) and
budget (smoke, fast). It is coherent. It is not the unit/integration/e2e pyramid — `integration
test` appears **0 times**.

That is defensible and arguably better than the pyramid, whose "unit" is famously underdefined.
Fowler's own **solitary vs sociable** distinction (after Jay Fields) describes tmct's split more
accurately than "unit vs integration" does. The finding is not that the taxonomy is wrong — it is
that **the taxonomy is undocumented as a taxonomy**, so a newcomer maps it onto the pyramid and gets
it wrong.

| term | verdict | note |
|---|---|---|
| `mock` (47), `stub` (40), `spy` (20), `fake` (6), `dummy` (3) | `aligned` — **checked, no drift** | I expected loose "mock" and did not find it. The uses are prose asserting the opposite ("a real round trip through actual SQLite, not a mock") plus `mock` as a *domain word* in a toy ontology (`x∈mock, mock⊑fixture`). Meszaros's taxonomy is not abused |
| `test double` | absent | the umbrella term is unused while all five members are used. Harmless |
| `fixture` (874) | `aligned` | Meszaros's term |
| `blast radius` (4) | **map** | ops/SRE jargon. The academic name is **Regression Test Selection** (Yoo & Harman, STVR 2012). `CLAUDE.md`'s rule is textbook RTS and never says so |
| `lane` (657) | `extend` | a tmct coinage. No testing literature uses it. Heavily load-bearing, so a rename is expensive and the concept is real — keep it and define it |
| **two meanings of "smoke"** | **already known** | `test:smoke` (a 1-second tier) and `smoke:deploy` (a probe against a deployed site). `CLAUDE.md` already flags the collision. The literature's "smoke test" (McConnell's daily build and smoke test) is closer to `smoke:deploy` |

### 9.6 The register

`scripts/term-inventory.mjs --register` checks the register in
`docs/references/term-register.json` against the tree: every registered term must still occur, and
each carries its area, verdict and citation. A term that stops occurring is an orphan; the citation
travels with the term rather than living only in prose.

### 9.7 Verdict counts

**The register is the checked number.** `node scripts/term-inventory.mjs --register` — 45 terms,
every one still occurring in the tree, every one carrying a citation:

| area | terms | | verdict | terms |
|---|--:|---|---|--:|
| logic | 11 | | `aligned` | 26 |
| ontology | 8 | | `map` | 7 |
| storage | 7 | | `rename` | 6 |
| nlp | 4 | | `extend` | 5 |
| planning | 4 | | `open` | 1 |
| testing | 4 | | | |
| grammar | 3 | | | |
| eval | 3 | | | |
| ir | 1 | | | |

§4's CURIE reconciliation is counted separately and not folded in here: its 34 `map`s are 25
ConceptNet mirrors plus nine PROV-O alignments, which is one decision made 25 times and would drown
the table above. The register carries the terms that each needed their own thinking.

**`aligned` at 26 of 45 is the headline, and it is a good one.** Most of this vocabulary was already
the discipline's word. The whole OWL 2 RL rule set, the NLP terms, Meszaros's test doubles, PDDL's
precondition/effect — all correct before this review started.

**Where the drift actually was**, in order: **storage** (the operator's prediction, confirmed —
reification unnamed, `ledger` wrong twice, not bitemporal, and the 32-bit hash), then **eval**
(§9.8), then **IR** (one misnamed algorithm), then **testing** (an unwritten taxonomy). **Logic was
the cleanest area in the repo** and needed almost nothing.

### 9.8 The honest miss has a published name

`honest miss` appears **285 times**. It is tmct's central design claim — a timeout is a miss, never
a guess — and it is a coinage.

The literature calls it **abstention**, or **selective prediction** / **selective classification**;
the decision-theoretic root is Chow's **reject option** (Chow, "On optimum recognition error and
reject tradeoff", *IEEE Trans. Information Theory* 16(1), 1970, pp. 41–46). `abstention` appears
**0 times** in the repo, `faithfulness` **0**.

**But the obvious citation is the wrong one, and the reason is worth the paragraph.** Every one of
Chow, El-Yaniv & Wiener (*JMLR* 11, 2010), Geifman & El-Yaniv, Kamath et al. and the Wen et al.
abstention survey (arXiv:2407.18418) is built on a **confidence score** — a probability, a softmax
output, a calibrated scalar — with a threshold *t* below which the system rejects. "Reject when
confidence < t" presupposes a confidence function.

**tmct has no confidence score to threshold.** It abstains because *no rule matched*. That is not
low confidence; it is **outside the function's domain**. A different mechanism, not a different
implementation of the same one.

The literature that names tmct's actual mechanism is Reiter's — **the open-world assumption**
("On Closed World Data Bases", *Logic and Data Bases*, Plenum, 1978, pp. 55–76). An engine with no
matching rule making an open-world move is refusing to conflate "I have no rule" with "the answer is
no". That *is* "a miss is never a guess", stated formally. OWL is open-world for the same reason, and
the OWL 2 Primer says so directly.

**And this ties the two halves of the review together.** The same Reiter citation grounds tmct's
planner (whose operator model is **closed-world**, which is what makes a plan checkable) and its chat
layer (which is **open-world**). One distinction, doing opposite work on opposite sides of the
product. `docs/references/planning/STRIPS_PDDL.md` now carries that pairing.

**Verdict: `extend`, and cite both, for different jobs.** "Honest miss" stays — it is what a visitor
understands, and better than "abstention" as a product word. **Cite abstention for the goal** (it is
the prior art a 2026 reader recognises) and **open-world/unknown for the mechanism** (it is what is
true of the system). Claiming kinship with confidence-threshold ML would be the overclaim.

`MISS_REASONS` stays `mgx:`'s: those are reasons one machine could not answer, and no standard
enumerates them.

### 9.9 The justification is ATMS, not JTMS — and this section corrects itself

**§4.6's JTMS row was wrong on both of its claims, and I wrote it.** It went in from memory, in the
one review whose whole point is that memory is not a source. Recording it rather than quietly
editing it, because the shape of the error is the thing worth keeping.

**Claim 1: "tmct does not retract on belief change." False.** `syllogise.mjs` exports
`retractSubClassOf`, and line 972's own comment reads "a scoped retraction slice: **JTMS-style
dependency-directed removal**". The code contradicts the doc, and the code was there first.

**Claim 2: "`mgx:sourceRule` is a JTMS justification in shape." Wrong on the term and the field.**

tmct stores two things: `justification` (an array of premise fact ids, written as
`mgx:factJustification`) and `sourceRule` (the rule id, on the entailed Source). `mgx:sourceRule`
alone is not the justification — it is one field of it.

**Doyle's JTMS justification is `(SL ⟨inlist⟩ ⟨outlist⟩)`, and the outlist is the whole point.**
Empty inlist + empty outlist is a premise; nonempty inlist + empty outlist is a normal deduction,
which Doyle calls "a monotonic argument"; **a nonempty outlist is what makes a justification an
assumption**, and assumptions are what give a JTMS non-monotonicity. **tmct has no outlist, ever.**
So it can never form an assumption — and without assumptions, nogoods (sets of assumptions) and
dependency-directed backtracking (locating assumptions in a contradiction's support) have nothing to
range over.

**What tmct actually stores is de Kleer's ATMS justification**: ⟨consequent, antecedents,
**informant**⟩, which de Kleer describes as propositional Horn clauses, **monotonic by
construction**. The fields land exactly: premise ids are the antecedents, the fact is the consequent,
and `sourceRule` is the **informant** — which de Kleer glosses as "the problem solver's description
of the justification", which is precisely what a rule name is.

And de Kleer names tmct's actual gap, in a sentence that fits better than anything I wrote:

> "a justification describes how the datum is derived from immediately preceding antecedents, a
> label environment describes how the datum ultimately depends on assumptions."

**tmct stores justifications and computes no labels.** That is the honest gap — not the invented one
about retraction.

**The retraction is DRed, not JTMS label propagation.** `retractSubClassOf` over-deletes candidates
citing a removed id, then re-verifies against survivors and keeps anything with a second independent
derivation. That is delete-and-rederive (Gupta, Mumick & Subrahmanian, "Maintaining Views
Incrementally", SIGMOD 1993, pp. 157–166). The distinction: **a JTMS recomputes belief *labels*;
DRed recomputes the *materialization*.** tmct moves rows in a store, so it is DRed. Its own comment
saying "JTMS-style" is the same reach in the code that §4.6 made in the doc.

**Verdicts:** `mgx:factJustification` + `mgx:sourceRule` → **`map`**, to an ATMS justification, with
`rdfs:seeAlso prov:wasDerivedFrom` (the PROV reading is the better *product* framing: a provenance
record). Now declared — see below. The retraction comment's "JTMS-style" → **`rename`** to DRed, in
a file this plan does not own (§7.12).

**Five senses of "justification" are in play** and share only the word: Doyle's SL-pair; de Kleer's
Horn triple; default logic's consistency condition (the βᵢ — and **Reiter's 1980 paper never uses
the word "justification"** at all, so citing him for it is wrong); OWL's *minimal* entailment-relative
axiom subset, computed on demand; and PROV's `wasDerivedFrom`. tmct's is the second, reads best as
the fifth, and is not the first.

### 9.10 The test had a blind spot, and this is how it showed

**`mgx:factJustification` is written by production code (`core.mjs:1068`) and was declared in neither
ontology file.** My §6 test — "every `mgx:` property the store's own vocabulary documents has a
definition in the ontology" — **passed anyway**, at 28 of 28.

It passed because the prop is not in `MEMORY_VOCABULARY`. The test checks what the payload
*documents*, so a prop that is emitted but undocumented falls through **both** gates at once: absent
from the vocabulary block, and therefore never checked against the ontology.

The sharpest form of it: **the deprecated `mgx:factProvenance` shim was declared; the live
`mgx:factJustification` was not.**

Now declared. The stronger test reads what a store actually *writes* rather than what it documents,
which is the same move §1 used to settle the casing question — a real store beats a reading of the
source. **§7.13.**

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
