# RDF reification, RDF-star, and named graphs — how to attach data to a triple

**Consumer in repo:** `src/adapters/memory/core.mjs` (`tmct:Fact rdfs:subClassOf rdf:Statement`),
`ontology/tmct-core.ttl`, `PLAN_NORMATIVE.md` §9.2.
**Retrieval date:** 2026-07-17 — VERIFIED. Every status line and date below was read from the
document's own header, and the reification claims were checked by grepping the specs' raw HTML.
**Licence:** W3C Document License. Brief factual excerpts with attribution; no specification is
committed here.

## Why this entry exists

tmct stores every fact as an RDF-reified statement. A widely repeated claim says reification is
"deprecated in favour of RDF-star". **That claim is false**, and the true position is more useful.

## Reification is not deprecated. Anywhere.

| document | status | date | says about reification |
|---|---|---|---|
| RDF 1.1 Concepts | Recommendation | 2014-02-25 | **nothing** — zero occurrences of "reif" |
| RDF 1.1 Primer | Working Group **Note** | 2014-06-24 | **nothing** — zero occurrences of "reif". RDF Primer 1.0 (2004) had a reification section; 1.1 silently dropped it |
| RDF 1.1 Semantics | Recommendation | 2014-02-25 | Appendix D.1, marked **(Informative)**. The word "deprecated" never appears |

RDF 1.1 Semantics **endorses reification for exactly tmct's use case**:

> "The subject of a reification is intended to refer to a concrete realization of an RDF triple…
> This supports use cases where properties such as dates of composition or provenance information
> are applied to the reified triple."

It also states the limit that matters:

> "A reification of a triple does not entail the triple, and is not entailed by it. The reification
> only says that the triple token exists and what it is about, not that it is true."

## What is true: RDF 1.2 demotes it to a legacy vocabulary

| document | status | date |
|---|---|---|
| RDF 1.2 Concepts and Abstract Data Model | **Candidate Recommendation Snapshot** | 2026-04-07 |
| RDF 1.2 Semantics | **Candidate Recommendation Snapshot** | 2026-04-07 |
| RDF 1.2 Schema | Working Draft | 2026-03-28 |
| RDF 1.2 Turtle | Working Draft | 2026-06-12 |
| RDF-star and SPARQL-star | Community Group **Final Report** (not a standard) | 2021-12-17 |

**There is no RDF 1.2 Recommendation.** The CR Snapshot says it "is not expected to advance to
Recommendation any earlier than 05 May 2026". The group is the RDF & SPARQL Working Group.

**RDF 1.2 Schema §7 is titled "Legacy vocabularies". §7.2 is titled "Old-style" Reification**, and
holds `rdf:Statement`, `rdf:subject`, `rdf:predicate`, `rdf:object`. Both sections are
**non-normative**. The framing sentence:

> "This section describes vocabularies defined in earlier versions of RDF and RDF Schema. These
> vocabularies remain in use in certain applications and data sets for historical and compatibility
> reasons. However, the vocabularies and constructs presented in the preceding sections of this
> document are generally recommended as preferable alternatives for new developments and modern
> RDF-based systems."

That is **soft-deprecation by editorial demotion**, and it is the strongest anti-reification
statement in any W3C document. `rdf:Statement` still carries its axiomatic triples and is **not**
marked deprecated in the vocabulary registry — the only use of "deprecat" in RDF 1.2 Schema is the
registry's own policy text.

RDF 1.2 Semantics' changelog gives the reason, and it is not "wrong":

> "The appendix on RDF reification, containers, and collections has been removed because it had no
> semantic content."

## The drift worth policing: `<< :s :p :o >>` is a superseded design

The 2021 Community Group report defined **quoted triples**, `<< :s :p :o >>`, usable in subject or
object position and referentially opaque. **The Working Group did not adopt it.**

RDF 1.2 replaced quoted triples with **triple terms** and **reifiers**:

- A **triple term** is written `<<( :s :p :o )>>` and may appear **only in object position**.
- A **reifying triple** is `_:r rdf:reifies <<( :s :p :o )>>`. The subject `_:r` is the **reifier**.
- `<< :s :p :o ~ :r >>` is syntactic sugar for that. RDF 1.2 Turtle: "Triple terms are typically not
  used explicitly as the reifiedTriple construction is generally preferred."
- `rdf:reifies` has `rdfs:range rdfs:Proposition`. RDF 1.2 Concepts: "the meaning of the
  rdf:reifies property is deliberately generic".

**So citing "RDF-star quoted triples" in 2026 is citing a 2021 Community Group design the standard
abandoned.** The word "reification" now also means two things — RDF 1.2 Turtle says so directly:
"Reification in RDF 1.2 is a concept **distinct** from the Reification vocabulary originally defined
in RDF Semantics." Say which you mean.

## Named graphs, the third option

RDF 1.1 TriG (Recommendation, 2014-02-25) and SPARQL 1.1 Query Language (Recommendation,
2013-03-21). The caveat is in W3C's own note, *RDF 1.1: On Semantics of RDF Datasets* (Working Group
Note, 2014-02-25):

> "While RDF graphs have a formal model-theoretic semantics… no agreed formal semantics exists for
> RDF datasets."

All three options have a semantics problem: reification has *no* semantic content, datasets have *no
agreed* semantics, and triple terms have semantics but no Recommendation yet.

## The verdict for tmct

**Keep reification. Do not rip it out.** It is not deprecated, RDF 1.1's Recommendation endorses it
for provenance specifically, and it works.

**But the accurate sentence is not "we use the standard reification vocabulary".** It is: *tmct uses
the RDF 1.1 reification vocabulary, which RDF 1.2 (Candidate Recommendation, not yet a
Recommendation) reclassifies as a legacy vocabulary and steers new systems away from, in favour of
triple terms and `rdf:reifies`.*

The migration horizon is real and cheap to describe: **a tmct Fact individual already *is* a
reifier.** `rdf:reifies` maps onto the existing model almost exactly, so the eventual move is a
vocabulary swap rather than a redesign. Nothing needs to happen until RDF 1.2 reaches
Recommendation and tooling follows.

Per-fact granularity is also why named graphs are not the answer here: one graph per fact is the
shape that would be needed, and most stores handle that badly.

## Deepen-next

- Watch RDF 1.2 Concepts and Semantics for Recommendation status (not expected before 2026-05-05 per
  the CR Snapshot). When it lands, revisit the `rdf:reifies` swap.
- `rdfs:Proposition` is new in RDF 1.2 and has no tmct counterpart. It is the class `rdf:reifies`
  ranges over, and worth reading when the swap is considered.
