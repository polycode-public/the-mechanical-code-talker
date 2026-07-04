# ontology/

`tmct-core.ttl` is tmct's core OWL 2 ontology (ROADMAP Phase 2, item 3): the
formal home of every label the runtime writes into its plain-JSON graphs. The
product path never runs an OWL toolchain — the graphs are **OWL-labelled JSON**
(`.tmct/`, see `docs/references/schemas/owl2-vocabulary.md`); this document is
the type system those labels refer back to.

## What's defined

1. **Conversational memory** (`src/memory/core.mjs`): the `tmct:Utterance`,
   `tmct:Fact` (an `rdf:Statement` reification) and `tmct:Session` classes,
   and every `mgx:` predicate the memory payload emits —
   `mgx:saidInSession`, `mgx:inReplyTo`, the utterance/session datatype
   properties, `mgx:factProvenance`, `mgx:hasProseTokens`. The `mgx:`
   namespace IRI (`urn:tmct:mgx#`) is exactly the one `emptyMemory()`
   declares; the test suite (`test/grammar-ontology.test.mjs`) pins the two
   together.
2. **Software-entity classes**: the lexicon's top-level nouns as
   `tmct:<lemma>` classes (`tmct:module`, `tmct:class`, `tmct:function`,
   `tmct:test`, …), each aligned by comment to the code-graph class
   (`Module`, `Class`, …) `buildEntities` emits and — where a term exists —
   `rdfs:seeAlso`'d to the SEON/FAMIX-derived `seon:` / `mgx:` prop tokens
   the code graph uses (`se-on.org` provenance noted in the file header).
3. **Verb and possessive properties**: the `tmct:<3sg>` object properties
   lexicon verbs emit (`tmct:imports`, `tmct:dependsOn`, …), the
   data-typed possessive nouns as `owl:DatatypeProperty`
   (`tmct:license`, `tmct:version`, …), object-typed ones as
   `owl:ObjectProperty` (`tmct:owner`, …), and the data adjectives as
   boolean datatype properties (`tmct:deprecated`, `tmct:flaky`, …).

## How the grammar's kinds map

`src/grammar/ace.mjs` labels every emitted triple with a `kind` naming the
governing OWL construct; the pattern→kind table is reproduced in the .ttl's
section 2:

| ACE-OWL pattern | kind(s) emitted |
|---|---|
| every N1 is a N2 | `rdfs:subClassOf` |
| PROPERNAME is a N | `rdf:type` |
| N1 VERB N2 | `owl:ObjectProperty` (predicate `tmct:<3sg verb>`) |
| every N1 that VERBs a N2 is a N3 | `owl:someValuesFrom` (Restriction + onProperty + intersection) |
| every N has at least/at most/exactly n N2 | `owl:minCardinality` / `owl:maxCardinality` / `owl:cardinality` (+ `owl:onClass`) |
| no N1 is a N2 | `owl:disjointWith` |
| N1's N2 is VALUE | `owl:DatatypeProperty` or `owl:ObjectProperty` per the noun's declared typing |
| ADJ N / X is ADJ | `rdfs:subClassOf` (subclass adjective) or `owl:hasValue` / `owl:DatatypeProperty` (data adjective) |

Two flat-store conventions to know: an intersection (pattern 4) is stored as
**repeated `owl:intersectionOf` triples** (the JSON fact store has no RDF
lists — the .ttl shows the same class expression in proper Turtle list
syntax), and `appendFact` normalizes fact subjects/objects through
`normFactTerm` (CURIE prefix stripped, lowercased: `tmct:module` is stored as
`module`) while predicates keep their vocabulary casing.

## Extending the lexicon

The grammar only understands **declared** words. Add domain vocabulary via
`loadLexicon(extra)` (`src/grammar/lexicon.mjs`) with the same JSON shape as
`src/grammar/lexicon-core.json`:

```js
const lexicon = loadLexicon({
  nouns: { microservice: {}, sla: { property: "data" } },
  verbs: { orchestrate: {}, subscribe: { prep: "to" } },
  adjectives: { containerized: { type: "subclass" }, idempotent: { type: "data" } },
  properNames: ["Kubernetes"],
});
```

Rules: adjectives **must** declare `type` (`subclass` forms a class; `data`
asserts a boolean-ish datatype property), possessive-target nouns may declare
`property: "data" | "object"` (default `data`), verbs may declare a `prep`
(`depend` + `on` → predicate `tmct:dependsOn`). New public vocabulary that
graduates from an `extra` block into `lexicon-core.json` should get a matching
declaration here in `tmct-core.ttl`; `test/grammar-ontology.test.mjs` keeps
the core nouns/verbs and the ontology aligned.

Validation is a minimal hand-rolled Turtle well-formedness check (balanced
constructs, all used prefixes declared, terminated statements) in
`test/grammar-ontology.test.mjs` — no OWL dependency, per the repo rule.
