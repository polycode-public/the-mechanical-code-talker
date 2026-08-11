# PLAN_WIKIPEDIA_BAND.md — the Wikipedia-derived corpus band

Status: FUTURE — deferred design.

This plan is a stub scope. It names one corpus band the memory backend campaign defers to a
future design wave: `corpus:simplewiki-derived`, extracted article facts at a scale the shipped
reference pack does not attempt. The partition layout, the loader, and the loader CLI verb live
in `archive/PLAN_MEMORY_BACKEND.md` (§3.13, §3.14) and `docs/adapter-contract.md` (the turn surface
section). This scope defines the band itself: what facts it must extract, the quality gate that
validates them, and how to build it.

---

## The goal

Extract encyclopaedia article structure as OWL facts, grounded and cited to the source article,
valid enough that a turn can cite them in an answer without caveat.

A Wikipedia article states facts implicitly through its structure and prose. The band must recover
those facts — *is-a* relationships, *part-of*, property assignments — and stamp each with the
article revision it came from, so a citation names the source and version. The facts must survive
the strict extraction rules below, so a consumer can trust them the way a turn trusts a taught
fact: no extraction-caveat annotation needed.

---

## The extraction question

**What definite, single-valued triples can an article's infobox, first paragraph, and list
sections assert, extracted by template and structural rules, that survive the gate?**

Not questions this band answers:

- How-to articles (wikiHow, repair guides). The band excludes them or the extraction quality
  suffers.
- Narrative prose longer than a sentence. "In the 1920s the city was rebuilt after a fire" is
  too vague to extract as a triple without risking hallucinatory confidence.
- Probability or hedge ("possibly", "may have been"). The gate rejects them.
- Relationships that depend on context or disambiguation. "The capital of France" is clear;
  "the largest city in the region" is not.

Scope for future work:

- Relationships from causal prose ("A caused B because..." becomes the edge "A rdf:cause B").
- Negation ("X is not Y" becomes a negative property assertion).
- Quantified facts ("The river is 200 miles long" as a literal property).

The gate enforces that this band's facts read as clean, not hedged.

---

## The build and gate

The band is built from Simple English Wikipedia. A future pipeline:

1. **Infobox extraction** — extract stated properties from infobox templates per Wikipedia's
   [infobox spec](https://en.wikipedia.org/wiki/Help:Infobox). Map template properties to OWL
   predicates. Exclude missing or placeholder values.

2. **First-paragraph class** — extract the *is-a* relationship from the opening sentence using
   ACE patterns (the same grammar tmct's chat uses). "X is a Y" → `X rdf:type Y`.

3. **List section facts** — extract facts from bulleted/numbered lists in sections like
   "See also", "Related", "Components". Skip prose paragraphs and narrative sections.

4. **Gate** — before persisting any fact:
   - Is it a single, definite triple (one subject, one predicate, one object)?
   - Does the object exist as a Wikipedia article or redirect, or is it a well-known entity
     (ISO 3166 country, Gregorian month)? Facts pointing to nonsense are dropped.
   - Is it non-redundant with facts already extracted from this article?
   - Would a human agree, reading the article once, that this fact is stated?

The gate is conservative. If ambiguity exists, the fact is dropped. Facts that pass become
`corpus:simplewiki-derived@<article-revid>` rows in the band partition.

---

## Storage and indexing

Partition key: `corpus:simplewiki-derived`; sort key: `fact#<term>#<rowKey>`, per §3.3 of
`docs/adapter-contract.md`. Facts are indexed by the subject's normalized term. The manifest row
carries the extraction run timestamp, the Wikipedia snapshot revision, and a row count.

Facts are never updated. An article's revision moves to a new row if the article is re-indexed;
old rows persist and expire on TTL. No deduplication across revisions, so a fact that appears
in multiple versions appears as multiple rows — the assembled payload de-duplicates at read time
through content-addressed ids.

---

## Relationship to the reference pack

The shipped reference pack (built into the turn Lambda's seed) holds Wikipedia facts extracted by
hand or by the SEON indexer from a curated subset of English Wikipedia. That set is small by
design: what a chat user might reference off-hand (major cities, historical figures, species).

This band scales to a much larger excerpt, built mechanically by the extraction rules above. The
two overlap; a consumer can load both (the turn's retrieval will see both and de-duplicate at
assembly), or load only this band if their use case has no need for the hand-curated set.

The future design work settles how to handle conflicts (if the reference pack says one thing and
this band says another, how does a turn handle it?) and whether to filter the extracted set
further post-hoc (via a judge tier, or by thresholding extraction confidence).

---

## Design horizon

This band's own future work remains open:

- **Quality metric.** How many of the extracted facts would a human mark as correct? Build a
  sample, judge it, report precision and recall. The gate may be wrong.
- **Narrative extraction.** Relax the prose-exclusion rule carefully. Some narratives encode
  real relationships ("X lived from 1900 to 1950" → X is-alive during [1900–1950]). The
  extraction rules would need to be much tighter.
- **Multilingual.** Simple English Wikipedia is smallest; Wikidata covers more languages and
  has explicit, structured data already. A future extraction could merge Wikidata-structured
  facts with extracted facts from language-specific Wikipedias.
- **Change detection.** Once built, maintain the band incrementally as articles are edited,
  rather than a full re-extract each time. A consumer's own deployment could then subscribe to
  incremental updates.

---

## Scope note

This plan is a design scope document, not an execution plan. It names the band, constrains its
content, and lists the work. The actual extraction code, pipeline, validation harness, and
deployment integration are future implementation. The partition layout and loader infrastructure
are already specified in `archive/PLAN_MEMORY_BACKEND.md` §3.13–3.14 and `docs/adapter-contract.md`, so
the build work is isolated to the extraction logic itself.
