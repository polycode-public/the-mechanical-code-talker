# Schemas — the vocabularies tmct borrows from or is checked against

Two kinds of entry live here, and the difference matters when you cite one.

**Published standards**, read from the primary source and pinned to an edition and a date. The
specification itself is never committed: W3C documents are quoted as brief factual excerpts under
the W3C Document License, and paywalled standards are not quoted at all.

**tmct's own fragments**, hand-authored here, which describe what tmct does rather than what anyone
published.

`archive/PLAN_NORMATIVE.md` is the reconciliation between the two: one verdict per coined term.

## Published standards

| entry | standard | edition | date | verified |
|---|---|---|---|---|
| [`prov-o.md`](prov-o.md) | W3C PROV-O | Recommendation | 2013-04-30 | 2026-07-17 |
| [`skos.md`](skos.md) | W3C SKOS Reference | Recommendation | 2009-08-18 | 2026-07-17 |
| [`seon-code-ontology.md`](seon-code-ontology.md) | SEON `code.owl` | no `versionInfo`; IRI says `2012/02` | mirror last commit 2013-01-23 | 2026-07-17 |
| [`ace-6.7.md`](ace-6.7.md) | Attempto Controlled English | 6.7 | docs 2013-07-31 | 2026-07-17 |
| [`conceptnet-relations.md`](conceptnet-relations.md) | ConceptNet relations | slice pins 5.7.0; 5.8 is current | 5.8 released 2020-05-20 | 2026-07-04, re-checked 2026-07-17 |
| [`iso-24617-2-dialogue-acts.md`](iso-24617-2-dialogue-acts.md) | ISO 24617-2 (SemAF) | **2**, current | 2020-12-02 | **draft + editors' paper only** |
| [`owl2-vocabulary.md`](owl2-vocabulary.md) | OWL 2 / RDF / RDFS | — | — | UNVERIFIED-pending-web-check |
| [`rdf-reification-and-rdf-star.md`](rdf-reification-and-rdf-star.md) | RDF 1.1 / RDF 1.2 / RDF-star | Rec 2014-02-25; **CR** 2026-04-07 | — | 2026-07-17 |
| [`content-addressing-and-storage.md`](content-addressing-and-storage.md) | temporal, content addressing, logs, provenance | mixed — per entry | — | 2026-07-17 |

**Two entries carry findings, not just terms.**
`rdf-reification-and-rdf-star.md` settles that reification is **not** deprecated (the common claim
is false) and that RDF-star's `<< >>` quoted triples are a superseded 2021 Community Group design.
`content-addressing-and-storage.md` carries the fact-id collision measurement — a terminology
question ("is `content-addressed` the right word?") that turned into a data-loss bug.

**`iso-24617-2-dialogue-acts.md` is the one to be careful with.** The published text is paywalled
and was not obtained. The entry rests on the 2019 DIS draft plus a peer-reviewed LREC paper by the
standard's own editors. It says so at the top. No public tmct claim should rest on it until someone
reads the published standard.

## tmct's own fragments

| entry | what it describes |
|---|---|
| [`ace-owl-fragment.md`](ace-owl-fragment.md) | the ~9 controlled-English patterns `src/domain/grammar/ace.mjs` implements |

`ace-6.7.md` and `ace-owl-fragment.md` are a pair: the first is the standard, the second is tmct's
subset of it, and `ace-6.7.md`'s divergence table is the seam between them.

## Rules for adding an entry

- **Read the primary source.** Not a summary, not a memory. Two of the entries here corrected a
  brief they were written from: `seon:History` and `seon:hasSupertype` do not exist, and the ISO
  dimension list is ten, not nine.
- **Pin the edition and the date, from the document's own header.** A standard read in 2026 cites
  its 2026 edition.
- **Say what you could not verify.** An entry that hides a gap is worse than no entry, because the
  next session trusts it.
- **Record the consumer in the repo**, so a term's home is findable from either end.
- **Fetch quirks belong in the entry.** `se-on.org` serves the namespace over `http:` only, and its
  certificate breaks on `https:`. That cost a session once; it is written down now.
