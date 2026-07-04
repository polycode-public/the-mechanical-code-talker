# OWL 2 / RDF / RDFS vocabulary — the terms tmct uses

Hand-authored stub listing the subset of the OWL 2 and RDF/RDFS vocabularies
that tmct's controlled grammar emits and its graph memory stores. This is a
working vocabulary note, not a copy of the specs.

- **Canonical sources:**
  - OWL 2 Web Ontology Language Primer (Second Edition) —
    https://www.w3.org/TR/owl2-primer/
  - OWL 2 Structural Specification and Functional-Style Syntax —
    https://www.w3.org/TR/owl2-syntax/
  - RDF Schema 1.1 — https://www.w3.org/TR/rdf-schema/
  - RDF 1.1 Concepts and Abstract Syntax — https://www.w3.org/TR/rdf11-concepts/
- **Licence:** W3C Document License (link + brief excerpt only; specs not
  committed).
- **Retrieval date:** UNVERIFIED-pending-web-check (authored offline from
  working knowledge 2026-07-04; URLs and term definitions to be verified
  against the live specs and stamped).
- **Consumer in repo:** `src/grammar/ace.mjs` and `src/grammar/lexicon.mjs`
  (Phase 2), `ontology/tmct-core.ttl`, `src/memory/core.mjs` (Phase 1 graph
  memory labels).

## Terms tmct emits

| Term | Vocabulary | tmct use |
|---|---|---|
| `rdf:type` | RDF | class assertion — "PROPERNAME is a N" |
| `rdfs:subClassOf` | RDFS | subclass axiom — "every N1 is a N2" |
| `rdfs:label` | RDFS | human-readable names on every node tmct writes |
| `owl:Class` | OWL 2 | declared noun classes from the lexicon |
| `owl:NamedIndividual` | OWL 2 | proper names (visitors, repos, modules, …) |
| `owl:ObjectProperty` | OWL 2 | declared verbs relating two individuals/classes |
| `owl:DatatypeProperty` | OWL 2 | declared verbs/possessives with literal values |
| `owl:disjointWith` | OWL 2 | negation — "no N1 is a N2" |
| `owl:Restriction` | OWL 2 | anonymous superclass in restriction patterns |
| `owl:onProperty` | OWL 2 | the property a restriction constrains |
| `owl:someValuesFrom` | OWL 2 | existential — "every N1 that VERBs a N2 is a N3" |
| `owl:minCardinality` / `owl:maxCardinality` / `owl:cardinality` | OWL 2 | "every N has at least / at most / exactly n N2" |

Notes:

- tmct stores these as **OWL-labelled triples in a plain JSON graph**
  (`.tmct/graph.json`), not as a serialized OWL document — the labels give the
  graph OWL semantics without requiring an OWL toolchain at runtime.
- Qualified cardinality (`owl:qualifiedCardinality` + `owl:onClass`) is noted
  as the OWL 2 form when the counted class matters; whether tmct needs the
  qualified form or the plain one is a Phase 2 decision.
  UNVERIFIED-pending-web-check.
- `rdfs:subClassOf` is RDFS vocabulary but carries the OWL 2 SubClassOf axiom
  meaning in this graph, per the OWL 2 RDF-based mapping.

## Deepen next

- Verify each term IRI and its exact OWL 2 mapping against the live specs;
  stamp retrieval dates.
- Decide qualified vs unqualified cardinality (see note above).
- Cross-check against the SEON-derived terms already present in graphs tmct
  consumes (`seon:`, `mgx:` prefixes) when authoring `ontology/tmct-core.ttl`.
