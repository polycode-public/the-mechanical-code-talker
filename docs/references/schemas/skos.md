# SKOS — the concept-scheme vocabulary

**Canonical source:** *SKOS Simple Knowledge Organization System Reference*, **W3C Recommendation
18 August 2009**, https://www.w3.org/TR/skos-reference/ · this version:
https://www.w3.org/TR/2009/REC-skos-reference-20090818/ · editors Alistair Miles, Sean Bechhofer.
**Namespace:** `http://www.w3.org/2004/02/skos/core#` (prefix `skos:`).
**Licence:** W3C Document License. Brief factual excerpts with attribution; the specification is not
committed here.
**Retrieval date:** 2026-07-17 — VERIFIED against the live Recommendation and the namespace RDF at
https://www.w3.org/2009/08/skos-reference/skos.rdf.
**Consumer in repo:** `PLAN_NORMATIVE.md` §4.4 (the corpus's concept vocabulary).
The document header carries a live errata pointer, which may include normative corrections.

## Why tmct reads this

tmct's corpus is a terminology: terms, their relations, and their synonyms. SKOS is the published
model for exactly that shape. The live question is whether `mgx:relatedTo`, `mgx:synonym` and
`mgx:antonym` mean SKOS terms under other names.

## Classes

| term | definition (verbatim) |
|---|---|
| `skos:Concept` | "An idea or notion; a unit of thought." |
| `skos:ConceptScheme` | "A set of concepts, optionally including statements about semantic relationships between those concepts." |
| `skos:Collection` | "A meaningful collection of concepts." |
| `skos:OrderedCollection` | "An ordered collection of concepts, where both the grouping and the ordering are meaningful." |

`Concept` and `ConceptScheme` are disjoint (S9). `Collection` is disjoint with both (S37).

## Labels

**All three label properties are `owl:AnnotationProperty`** (S10), sub-properties of `rdfs:label`
(S11), with **no declared domain**. Anything may carry a `skos:prefLabel`, not only a
`skos:Concept`.

| term | definition (verbatim) |
|---|---|
| `skos:prefLabel` | "The preferred lexical label for a resource, in a given language." |
| `skos:altLabel` | "An alternative lexical label for a resource." |
| `skos:hiddenLabel` | "A lexical label for a resource that should be hidden when generating visual displays of the resource, but should still be accessible to free text search operations." |
| `skos:notation` | "A notation, also known as classification code, is a string of characters such as 'T58.5' or '303.4833' used to uniquely identify a concept within the scope of a given concept scheme." (`owl:DatatypeProperty`, S15) |

- **S13:** "skos:prefLabel, skos:altLabel and skos:hiddenLabel are pairwise disjoint properties."
- **S14:** "A resource has no more than one value of skos:prefLabel per language tag."

## Documentation properties

All `owl:AnnotationProperty` (S16), all sub-properties of `skos:note`, no domain or range declared:
`skos:note` ("A general note, for any purpose"), `skos:definition` ("A statement or formal
explanation of the meaning of a concept"), `skos:scopeNote`, `skos:example`, plus `changeNote`,
`editorialNote`, `historyNote`.

## Semantic relations

Domain and range of `skos:semanticRelation` are both `skos:Concept` (S19, S20), and that propagates
to every sub-property. **This is the constraint that decides whether tmct can use them** — see §4.4
of `PLAN_NORMATIVE.md`.

| term | definition (verbatim) |
|---|---|
| `skos:semanticRelation` | "Links a concept to a concept related by meaning." |
| `skos:broader` | "Relates a concept to a concept that is more general in meaning." |
| `skos:narrower` | "Relates a concept to a concept that is more specific in meaning." |
| `skos:related` | "Relates a concept to a concept with which there is an associative semantic relationship." |
| `skos:broaderTransitive` | "skos:broaderTransitive is a transitive superproperty of skos:broader." |
| `skos:narrowerTransitive` | "skos:narrowerTransitive is a transitive superproperty of skos:narrower." |

Axioms: S23 `skos:related` is symmetric · S24 the two Transitive properties are transitive ·
S25 `narrower` is the inverse of `broader` · S27 `skos:related` is disjoint with
`skos:broaderTransitive`.

**`skos:broader` and `skos:narrower` are not transitive.** The spec says so in a note, not an
axiom: "skos:broader and skos:narrower are not declared as transitive properties". `A broader B`
and `B broader C` do not entail `A broader C`. The transitive closure has its own two terms.

## Mapping properties

All six are `owl:ObjectProperty` (S38) and sub-properties of `skos:mappingRelation`, itself a
sub-property of `skos:semanticRelation` (S39).

| term | definition (verbatim, abridged) | axioms |
|---|---|---|
| `skos:closeMatch` | "used to link two concepts that are sufficiently similar that they can be used interchangeably in some information retrieval applications. In order to avoid the possibility of 'compound errors' … not declared to be a transitive property." | symmetric |
| `skos:exactMatch` | "used to link two concepts, indicating a high degree of confidence that the concepts can be used interchangeably across a wide range of information retrieval applications." | symmetric, **transitive** (S45), ⊑ `closeMatch` |
| `skos:broadMatch` | "used to state a hierarchical mapping link between two conceptual resources in different concept schemes." | ⊑ `broader`; inverse of `narrowMatch` |
| `skos:narrowMatch` | as above, narrower direction | ⊑ `narrower` |
| `skos:relatedMatch` | "used to state an associative mapping link between two conceptual resources in different concept schemes." | symmetric, ⊑ `related` |

**S46, verbatim:** "skos:exactMatch is disjoint with each of the properties skos:broadMatch and
skos:relatedMatch."

Note the pairing: **broadMatch and relatedMatch**. Disjointness with `narrowMatch` follows as a
consequence (exactMatch is symmetric, broadMatch and narrowMatch are inverses) and is stated in a
trailing note, not asserted. A validator built from a misremembered version of S46 would be wrong.

`skos:exactMatch` is the **only** transitive mapping property.

## Why exactMatch is not owl:sameAs

This is a note (§10.6.8), not an axiom. Nothing in the data model forbids asserting both.

> "owl:sameAs, owl:equivalentClass or owl:equivalentProperty would typically be inappropriate for
> linking SKOS concepts in different concept schemes, because the formal consequences that follow
> could be undesirable."

`owl:sameAs` merges every property of both concepts, so two concepts labelled `"love"@en` and
`"adoration"@en` end up with two English `prefLabel`s and two schemes — an S14 violation. The spec
then adds the sharper point:

> "This will not always be the case, however."

So the S14 clash is incidental. `owl:sameAs` is discouraged because identity is a stronger claim
than interchangeability-for-retrieval, not because a rule reliably catches the difference.

**For tmct:** where the claim is "these two terms mean the same", `skos:exactMatch` says it without
merging anything. Where the claim is "these two properties have the same extension",
`owl:equivalentProperty` is the right tool and SKOS is not involved. The two questions are
different and the vocabulary choice follows the question.

## The "different schemes" convention is not enforced

> "By convention, the SKOS mapping properties are only used to link concepts in different concept
> schemes. However, note that using the SKOS semantic relation properties … to link concepts in
> different concept schemes is also consistent with the SKOS data model."

The spec's rationale: "it is hard to draw an absolute distinction between internal links within a
concept scheme and mapping links between concept schemes." Nothing rejects a `skos:exactMatch`
inside one scheme; the mapping properties are a convenience for readers, not a constraint.

## Deepen-next

- SKOS-XL (a companion Recommendation of the same date) reifies labels as first-class resources.
  Read it if tmct ever needs to attach provenance to a *label* rather than to a fact.
- ISO 25964 (thesauri and interoperability with other vocabularies) publishes a SKOS mapping. It is
  the terminology-work standard `PLAN_OPEN_ITEMS.md` §10.2 names alongside ISO 704, and neither has
  been read yet.
