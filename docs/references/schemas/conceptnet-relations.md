# ConceptNet relations — the fixed relation vocabulary

Hand-authored stub listing ConceptNet's closed set of ~35 relation types. tmct
plans (Phase 2) to commit a filtered English/tech-domain **slice** of
ConceptNet and map each relation onto one of the ACE-OWL surface patterns
(`ace-owl-fragment.md`), so corpus assertions can be auto-generated as
controlled-English sentences / OWL-labelled triples. The relation→pattern
**mapping table itself lives in `src/adapters/corpus/conceptnet-map.toml`** when Phase 2
lands — this stub is the reference list it is checked against.

- **Canonical sources:**
  - ConceptNet — https://conceptnet.io/
  - Relation documentation —
    https://github.com/commonsense/conceptnet5/wiki/Relations
- **Licence:** ConceptNet data is **CC-BY-SA 4.0** (attribution to ConceptNet
  and its upstream sources; the committed slice ships with its own notice,
  separate from this repo's MPL-2.0).
- **Retrieval date:** 2026-07-04 — VERIFIED against the ConceptNet 5.7.0
  assertions dump (the committed slice's source): the 34-relation canonical
  list below matched the dump exactly (29 of them appear in the tech slice).
- **Version pin (re-checked 2026-07-17):** the committed slice is **5.7.0**
  (released 2019-04-30). The last data release is **5.8, 2020-05-20**; its
  release notes cover language codes, Wiktionary and curation, and name no
  relation additions, removals or renames. The relation wiki page was last
  edited 2019-06-20, so it documents the 5.7-era set — which is the set below,
  and is current for 5.8 too. Upgrading the slice to 5.8 needs no change to
  this list or to `conceptnet-map.toml`'s rows.
- **Do not build on the deprecated relations:** `/r/InstanceOf`, `/r/Entails`,
  the `/r/dbpedia/*` family, and the negatives `/r/NotIsA`, `/r/NotDesires`,
  `/r/NotUsedFor`, `/r/NotCapableOf`, `/r/NotHasProperty`. They appear in the
  data but are slated for consolidation or removal. tmct expresses negation
  with its own polarity prefix instead (`mgxneg:`, see
  `src/domain/memory/capability.mjs`), which is a deliberate divergence:
  ConceptNet's negatives are five one-off terms, tmct's prefix negates any
  predicate.
- **Consumer in repo:** `src/adapters/corpus/conceptnet.mjs` +
  `src/adapters/corpus/conceptnet-map.toml` (Phase 2).

## The relation types

ConceptNet uses a fixed, closed vocabulary of relations (each assertion also
carries surface text — ConceptNet's own templates generate natural-language
sentences from `(relation, start, end)` triples, which is exactly the seam
tmct's surface templates exploit). The documented set (VERIFIED 2026-07-04 against the ConceptNet 5.7.0 dump —
all 34 relations matched exactly):

| Relation | Gloss | Notes for the ACE-OWL mapping |
|---|---|---|
| `RelatedTo` | weakest, undirected association | likely unmapped or a plain object property |
| `FormOf` | inflection → root form | lexicon normalization, not an axiom |
| `IsA` | hyponym → hypernym | pattern 1/2 (`rdfs:subClassOf` / class assertion) |
| `PartOf` | meronymy | object property (pattern 3) |
| `HasA` | inverse-ish of PartOf | object property / pattern 5 candidate |
| `UsedFor` | typical purpose | object property |
| `CapableOf` | typical capability | object property |
| `AtLocation` | typical location | object property |
| `Causes` | causation | object property |
| `HasSubevent` | event decomposition | object property |
| `HasFirstSubevent` | first step | object property |
| `HasLastSubevent` | last step | object property |
| `HasPrerequisite` | dependency | object property |
| `HasProperty` | attribute | pattern 8 (adjective) |
| `MotivatedByGoal` | motivation | object property |
| `ObstructedBy` | blocker | object property |
| `Desires` | typical desire | object property |
| `CreatedBy` | provenance | object property |
| `Synonym` | same meaning | lexicon alias, not an axiom |
| `Antonym` | opposite | disjointness candidate (pattern 6) |
| `DistinctFrom` | mutually exclusive | pattern 6 (`owl:disjointWith`) |
| `DerivedFrom` | word derivation | lexicon, not an axiom |
| `SymbolOf` | symbolism | probably unmapped |
| `DefinedAs` | definitional | pattern 1 candidate |
| `MannerOf` | verb specialization | subproperty candidate |
| `LocatedNear` | proximity | object property |
| `HasContext` | usage domain | slice-filtering signal (tech-domain filter) |
| `SimilarTo` | similarity | probably unmapped |
| `EtymologicallyRelatedTo` | shared origin | unmapped (filtered out of slice) |
| `EtymologicallyDerivedFrom` | origin | unmapped (filtered out of slice) |
| `CausesDesire` | evoked desire | object property |
| `MadeOf` | material | object property |
| `ReceivesAction` | typical patient role | object property |
| `ExternalURL` | link out of the graph | unmapped (filtered out of slice) |

Plus deprecated/legacy relations (e.g. `InstanceOf`, `Entails`) that may still
appear in dumps — the loader should treat unknown relations as unmapped, not
as errors.

## Deepen next

- Verify the relation list, count, and deprecation status against the live
  wiki; stamp the retrieval date.
- Pin the ConceptNet version + dump file the Phase 2 slice is filtered from,
  and record the slice's size budget + filter criteria.
- The right-hand "Notes" column above is a **sketch**, not the mapping — the
  authoritative ~35-row relation→ACE-OWL-pattern table is built and tested in
  `src/adapters/corpus/conceptnet-map.toml` at Phase 2.
