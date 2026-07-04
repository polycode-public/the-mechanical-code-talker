# tmct's ACE-OWL sub-fragment — the controlled-grammar pattern table

Hand-authored stub defining the ~8 controlled-English sentence patterns tmct's
grammar (Phase 2, `src/grammar/ace.mjs`) maps to OWL axioms. The fragment is
**inspired by** Attempto Controlled English (ACE) and the OWL output of its APE
parser — it is a deliberately small sub-fragment, not an ACE implementation.

- **Canonical sources:**
  - Attempto project — http://attempto.ifi.uzh.ch/
  - APE (Attempto Parsing Engine), version 6.7 — the ACE→DRS→OWL/SWRL
    reference implementation (SWI-Prolog; **LGPL**) —
    https://github.com/Attempto/APE
  - ACE 6.7 syntax / construction rules — Attempto documentation site.
- **Licence:** APE is LGPL (referenced, not vendored — tmct reimplements the
  sub-fragment in JS from the published grammar descriptions, it does not link
  APE). Attempto docs quoted by link + brief excerpt.
- **Retrieval date:** UNVERIFIED-pending-web-check (authored offline
  2026-07-04; the APE version number, repo URL, and per-pattern OWL mappings
  are to be verified against the live Attempto sources and stamped).
- **Consumer in repo:** `src/grammar/ace.mjs` + `src/grammar/lexicon.mjs`
  (Phase 2); the interpretation pipeline (`src/interpret/`, Phase 1) treats a
  grammar fit as a high-confidence strategy result.

## The pattern table

`N`, `N1`, `N2`, `N3` are nouns declared in the lexicon; `VERB` is a declared
verb; `PROPERNAME` is a declared proper name. Sentences that fit no pattern
fall through to the tolerant strategies — the grammar never rejects, it just
declines to emit.

| # | Sentence pattern | OWL emission |
|---|---|---|
| 1 | *every N1 is a N2* | `N1 rdfs:subClassOf N2` |
| 2 | *PROPERNAME is a N* | class assertion: `PROPERNAME rdf:type N` |
| 3 | *N1 VERB N2* / *PROPERNAME VERBs PROPERNAME* | object property assertion (`owl:ObjectProperty` per lexicon) |
| 4 | *every N1 that VERBs a N2 is a N3* | `N1 ⊓ (owl:Restriction on VERB, owl:someValuesFrom N2) rdfs:subClassOf N3` — someValuesFrom restriction |
| 5 | *every N has at least / at most / exactly n N2* | cardinality restriction: `owl:minCardinality` / `owl:maxCardinality` / `owl:cardinality` on the `has` property |
| 6 | *no N1 is a N2* | `N1 owl:disjointWith N2` |
| 7 | possessives — *N1's N2 is …* / *the N2 of N1 is …* | data or object property assertion, **per the lexicon's declaration** of that property (datatype vs object) |
| 8 | adjectives — *every ADJ N1 is …* / *N1 is ADJ* | subclass-with-restriction or `owl:DatatypeProperty` value, **per the declared adjective type** in the lexicon |

## Design notes

- **The lexicon is load-bearing.** Patterns 7 and 8 are only deterministic
  because every noun, verb, adjective (with its type), and proper name is
  *declared* — tmct never guesses a word's category. Undeclared words route
  the sentence out of the grammar strategy.
- **ACE is much larger than this.** Full ACE covers anaphora, relative
  clauses, queries, commands, modality, and maps to full DRS. tmct takes only
  the axiom-shaped declarative core above; growth beyond it is a Phase 2+
  decision driven by chatbench evidence.
- The planned ConceptNet mapping (`src/corpus/conceptnet-map.toml`) targets
  **these same 8 patterns** — each ConceptNet relation is expressed as one of
  the surface templates above so corpus assertions and user assertions land in
  the graph identically. See `conceptnet-relations.md`.

## Deepen next

- Verify each pattern's OWL mapping against APE's documented ACE→OWL mapping
  (the "ACE in OWL" / Kaljurand & Fuchs line of work) and cite the specific
  paper(s) in `papers/`.
- Confirm APE 6.7 as the contemporary version and stamp retrieval dates.
- Decide pattern 5's qualified-cardinality question (see
  `owl2-vocabulary.md`).
