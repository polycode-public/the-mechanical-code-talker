# Reference library

A citable reference set for tmct — the specs, schemas, and papers the grammar,
ontology, and corpus work depends on. Built so future sessions elaborate from
verified primary sources, not memory.

- Every entry carries a **canonical URL**, **retrieval date**, **licence**, the
  **consumer in this repo**, and **deepen-next** notes for what to verify or
  expand.
- Entries whose facts have not yet been checked against the live source are
  marked **UNVERIFIED-pending-web-check** — treat those as good-faith stubs,
  not citations, until a session with web access verifies them and stamps a
  retrieval date.

## Licensing policy (MPL-2.0 repo)

- **Papers** are committed as PDFs **only** when the licence permits
  redistribution (CC BY / CC BY-SA / CC0), with attribution in a companion
  `.md` stub. Everything else is link + short factual excerpt only.
- **Vendor docs** (commercial or restrictively-licensed documentation) are
  referenced by **link + short factual excerpt** only — never copied wholesale.
  See `api/`.
- **Schemas** are either fetched from openly-licensed sources or hand-authored
  here. W3C specifications are quoted under the W3C Document License (brief
  excerpts with attribution; the specs themselves are not committed).
- **Corpus data** (e.g. ConceptNet, CC-BY-SA 4.0) keeps its own licence and
  notice, separate from the repo's MPL-2.0 — see `ROADMAP.md` Phase 2.

## Contents

```
docs/references/
  README.md                       <- this index
  api/                            <- link+excerpt stubs (restrictive-licence docs)
    README.md
  schemas/
    README.md                     <- the standards index: edition, date, verified-state
    prov-o.md                     <- W3C PROV-O (Rec 2013-04-30) — the provenance vocabulary
    skos.md                       <- W3C SKOS Reference (Rec 2009-08-18) — concept schemes
    seon-code-ontology.md         <- SEON code.owl — the code vocabulary tmct borrows
    ace-6.7.md                    <- ACE 6.7 + the table of what tmct implements and diverges on
    iso-24617-2-dialogue-acts.md  <- ISO 24617-2:2020 — dialogue acts (draft-sourced, see the entry)
    owl2-vocabulary.md            <- hand: the OWL 2 / RDF / RDFS terms tmct uses
    ace-owl-fragment.md           <- hand: tmct's ACE-inspired sub-fragment (~8 patterns)
    conceptnet-relations.md       <- hand: ConceptNet's fixed relation types
  papers/
    README.md                     <- ACE/APE + ELIZA/PARRY lineage candidates
  planning/
    README.md                     <- classical planning & KR (the C1-ceiling correction)
    PARTIAL_ORDER_PLANNING.md     <- least-commitment planning: causal links, threats
    NONLIN.md                     <- Tate 1976: the first HTN partial-order planner
    STRIPS_PDDL.md                <- the operator/effect model + its declaration language
    STEEL_AND_HO.md               <- planning + execution under uncertainty (link-only, scanned)
```

## 1. OWL 2 / RDF / RDFS vocabulary — [`schemas/owl2-vocabulary.md`](schemas/owl2-vocabulary.md)

The subset of the OWL 2 and RDF/RDFS vocabularies that tmct's grammar emits and
its graph memory stores. Canonical sources: the W3C OWL 2 Primer and the RDF
1.1 / RDF Schema 1.1 Recommendations (W3C Document License).
**Consumer:** `src/domain/grammar/ace.mjs` (Phase 2), `ontology/tmct-core.ttl`,
`src/adapters/memory/core.mjs` (Phase 1).

## 2. ACE-OWL sub-fragment — [`schemas/ace-owl-fragment.md`](schemas/ace-owl-fragment.md)

The ~8 controlled-English sentence patterns tmct maps to OWL axioms, derived
from Attempto Controlled English (ACE) and its APE parser's OWL output.
**Consumer:** `src/domain/grammar/ace.mjs` + `src/domain/grammar/lexicon.mjs` (Phase 2);
the item-8 interpretation pipeline treats a grammar fit as a
high-confidence strategy win.

## 3. ConceptNet relations — [`schemas/conceptnet-relations.md`](schemas/conceptnet-relations.md)

ConceptNet's fixed set of ~35 relation types (CC-BY-SA 4.0). The planned
relation→ACE-OWL-pattern mapping table lives in `src/adapters/corpus/conceptnet-map.toml`
(Phase 2), not here — this stub is the reference list the mapping is checked
against. **Consumer:** `src/adapters/corpus/conceptnet.mjs` (Phase 2).

## 4. Papers — [`papers/`](papers/README.md)

Empty pending Phase 2: ACE/APE papers and the ELIZA/PARRY lineage
(Weizenbaum 1966; Colby et al. 1971). Only redistributable licences get
committed; the rest are link+excerpt stubs.

## 5. Classical planning & KR — [`planning/`](planning/)

The 40-plus-year body of **deterministic, no-LLM, goal-directed planning** —
partial-order planning, HTN/NONLIN, STRIPS/PDDL, Steel & Ho — behind the
capability-router RFC. Its load-bearing point: *open-ended planning is not an
LLM-only capability*. Within a declared operator model, a planner does
goal-directed multi-step decomposition deterministically, so the agentic
ladder's C1 ceiling is **open-world**, not planning itself. Primary papers are
link-only (publisher copyright / scanned reports).

## 6. Standards reconciliation — [`schemas/README.md`](schemas/README.md)

The published standards tmct's vocabulary is checked against — PROV-O, SKOS, SEON, ACE 6.7,
ConceptNet, ISO 24617-2 — each pinned to an edition and a date, each naming what could not be
verified. `PLAN_NORMATIVE.md` holds the reconciliation: one verdict per coined term, and the
`owl:equivalentProperty` / `rdfs:subPropertyOf` triples that pin the alignments in
`ontology/tmct-core.ttl`.

## Deepen-next index

- `schemas/owl2-vocabulary.md` is still UNVERIFIED-pending-web-check. It is now the only
  schema entry that is, and OWL 2 is the vocabulary tmct emits most.
- Read SEON's `nl/2012/02/code-nl.owl` (its natural-language layer) and
  `domain-spanning/2012/02/change-couplings.owl` (the published co-change vocabulary tmct coins
  `mgx:changeCoupledWith` for). Both are named in `schemas/seon-code-ontology.md`'s deepen-next.
- Obtain the published ISO 24617-2:2020 text. The current entry rests on a 2019 draft and the
  editors' LREC paper, and says so.
- Read ISO 704 and ISO 25964 (terminology work, thesaurus structure) — the lexicon and corpus are
  terminology work, and neither standard has been opened.
- Source candidate PDFs for `papers/`: the ACE/APE papers and the ELIZA/PARRY lineage.
