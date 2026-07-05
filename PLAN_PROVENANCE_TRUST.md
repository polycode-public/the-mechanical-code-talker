# PLAN_PROVENANCE_TRUST.md — one source-link primitive, built once, consumed everywhere

> **STATUS: shipped.** The primitive is live: `mgx:createdAt` on every fact/block; `Source`
> first-class individuals linked by `mgx:derivedFrom` / `mgx:statedBy` / `mgx:canonicalisedFrom`;
> a deterministic, explainable `computeTrust` (source-type prior × corroboration × recency);
> retrieval weighted by relevance × trust; the `/memory` inspector surfaces contradictions with
> both sides + provenance rather than silently picking. Fact ids still content-address `(s,p,o)`;
> legacy `mgx:factProvenance` retained as a compat shim.

A cross-cutting infrastructure plan (operator-specified 2026-07-05). Four features on the roadmap
already need the same thing in four disguises: Phase 7's canonicalise-and-link, Phase LATER tier-4's
learn-on-miss (raw web text → cleaned linked form), tier-5's entailment (conclusion linked to
premises + rule), and the ConceptNet slice that already seeds memory. This plan names the shared
shape, promotes it to a first-class primitive, and specifies the one build every consumer reads
back. It is NOT a phase. It is the substrate several phases stand on, so it lands early and
incrementally (see Sequencing) rather than in a numbered slot.

## The unifying principle

**Raw preserved, canonical derived and linked, provenance on everything, nothing canonical ever
replaces its source.** Every one of the four features above ingests something raw (an operator
utterance, a corpus row, a fetched web page, a set of premises), produces a cleaner derived form (a
reified Fact, a canonical phrasing, an entailed conclusion), and must be able to walk
back from the derived form to what it came from. Today each writer improvises that link as a string.
This plan makes it one primitive.

## Context — what exists today

`src/memory/core.mjs` `appendFact()` reifies each grammar/corpus triple as a `Fact` individual
(`rdf:subject`/`rdf:predicate`/`rdf:object`) and records where it came from in a SINGLE
`mgx:factProvenance` STRING, a `" | "`-joined union of opaque tags: `corpus:conceptnet /r/IsA`
(from `src/corpus/conceptnet.mjs` `toFacts`), `ace:<source>:<sessionId>@<ts>` (from the grammar's
assert path). The union is real corroboration information — the deterministic fnv1a fact id hashes
only `(s,p,o)`, so re-asserting the same triple from a second writer UPSERTS and appends its tag to
the union — but it is trapped in a string no ranker can read. `retrieveBlocks()` (`blocks.mjs`)
ranks by `idfSum × (1 + rank)` — IDF relevance × PageRank connectivity — with trust NOWHERE in the
formula. And Facts carry NO timestamp: Utterances have `mgx:utteranceTs`, Sessions
`mgx:sessionStarted`, but a Fact records neither when it was learned nor when it was written. The
recency input to trust and the novelty signal Phase 9 needs are both missing.

## What changes

### 1. `Source` becomes a first-class individual

A new payload class `Source` (rdf:type `owl:NamedIndividual`), counted in `classes[]` and sampled by
the memory inspector like every other class. Deterministic ids over a small closed set of kinds:
`src:operator-chat`, `src:provider:seonix`, `src:corpus:conceptnet`, `src:learned:web:<urlhash>`,
`src:entailed:<rule>`. Each Source carries `mgx:sourceType` (one of `operator | provider | corpus |
web | entailed` — the trust-prior key), `mgx:createdAt`, and kind specifics (`mgx:sourceUrl` for
web, `mgx:sourceRule` for entailed). Sources are upserted by `upsertIndividual` exactly like
Utterances: deterministic id → idempotent, edges never dangle.

The per-writer `mgx:factProvenance` STRING is replaced by real EDGES through
`upsertEdge`, under ONE predicate family, minted in the owned `mgx:` namespace to match
`tmct-core.ttl`'s existing object-property style (`mgx:saidInSession`, `mgx:inReplyTo` — simple
domain/range + owned-namespace comment):

- **`mgx:derivedFrom`** — the umbrella `owl:ObjectProperty` (domain `tmct:Fact`, range
  `tmct:Source` or `tmct:Fact`). Its intended external referent is PROV-O `prov:wasDerivedFrom`,
  carried as `rdfs:seeAlso` and marked UNVERIFIED-pending-web-check per `docs/references/`
  discipline. We do not claim PROV ownership.
- **`mgx:statedBy`** (`rdfs:subPropertyOf mgx:derivedFrom`) — the workhorse: a Source directly
  ASSERTS this Fact. The old `" | "`-union becomes N `statedBy` edges, one per independent source.
- **`mgx:canonicalisedFrom`** (`rdfs:subPropertyOf mgx:derivedFrom`) — a canonical Fact derived by
  cleaning from a raw form (Phase 7's canonicalise-and-link; tier-4's raw→cleaned). Points at the
  raw prose Block or raw Source, never replacing it. This is where the unifying principle bites.

**Migration of the union.** A Fact's id still hashes only `(s,p,o)`, so migration ADDS edges and
never re-keys. A lazy one-shot runs inside `mutateMemory`: a Fact carrying legacy
`mgx:factProvenance` and no `statedBy` edges has its `" | "`-tags parsed into Source ids
(`corpus:conceptnet …` → `src:corpus:conceptnet`; `ace:…@<ts>` → the session/operator Source plus a
`createdAt` recovered from `@<ts>`), the Sources upserted, the edges written, and the string dropped.
Deterministic Source ids make the migration idempotent. Re-running converges. `conceptnet.mjs`
`toFacts()`/`seedMemory()` and the grammar assert path switch from emitting a provenance STRING to
naming a Source id; `seedMemory`'s existing pre-read dedupe by normalised `(s,p,o)` key is unchanged.

### 2. Universal `mgx:createdAt` timestamping

Every created individual — Utterance, Fact, Session, Source, and each block-index entry — gets an
`mgx:createdAt` (ISO-8601) at first write. **First-write-wins on upsert**: `putUtterance`,
`appendFact`, `ensureSession`, and the Source upsert set `createdAt` only when the prior individual
lacks one, so it records when a thing was FIRST learned, not when it was last touched. It is itself
provenance (the audit trail's "when"), the recency input to trust (below), and the novelty signal
Phase 9 reads. It is distinct from `mgx:utteranceTs` (the turn time an utterance CLAIMS). For Facts
the two usually coincide but the semantics differ, so both are kept.

**Ownership: this plan owns the implementation; PLAN_RESPONSE_FINISHING consumes it.** Both name
`mgx:createdAt`; the universal first-write-wins primitive is built HERE (step (a)), and Phase 7's
canonical-form individuals get their timestamp for free by going through the same write path. That
plan asserts the field, it does not implement the timestamping.

### 3. Calculable trust scores — deterministic, explainable, auditable

Trust is a COMPUTED attribute of a Fact, never hand-set, always a pure function of its Source edges +
those Sources' types + `createdAt`. Three inputs combine:

- **Source-type prior** — the ordering operator > provider-graph > curated-corpus > web >
  unverified-entailment, rough weights `operator 1.0, provider 0.9, corpus 0.7, web 0.4, entailed
  0.3` (the entailed prior is a floor before premise adjustment, below).
- **Corroboration** — independent-source count, which the union already gives us as N `statedBy`
  edges. Combined by noisy-OR over distinct-Source priors: `1 − Π(1 − wᵢ)`, capped at 1. Two
  independent web sources (0.4) reach `1 − 0.6² = 0.64`; a lone operator fact is already 1.0.
- **Recency** — a BOUNDED nudge from `createdAt` (a multiplier in ~[0.9, 1.0] decaying by a
  half-life), never a dominator, the codegraph "capped nudge" philosophy, so recency breaks ties
  and freshens but never flips a source-type ordering by itself.

For **entailed facts (tier-5)**: `trust = min(premise trusts) × rule-confidence`. A conclusion is
only as trustworthy as its weakest premise, and that number is computed from the premise Facts'
own trust, not asserted. This is where `mgx:derivedFrom` points a conclusion at BOTH its premise
Facts and its `src:entailed:<rule>` Source.

**Store the inputs, not just the score.** The Fact carries `mgx:trustScore` (a materialised cache)
alongside the inputs it was computed from (source-type multiset, corroboration count, recency age),
so any score is reproducible and auditable. "Why does this rank high?" is answerable from the
record. The cache is invalidated exactly on the upsert path that could change it: adding a `statedBy`
edge. (Recompute-on-read vs materialise-and-invalidate is an open question below; either way the
inputs are the source of truth and the score is derived.)

### 4. Trust as retrieval WEIGHTING + contradiction surfacing

`retrieveBlocks`, the W4 fact-lookup seam, and the `/memory` inspector rank by **relevance × trust**,
not relevance alone. In `blocks.mjs` the score becomes `idfSum × (1 + rank) × trustFactor`, where
`trustFactor` is a bounded multiplier (`≈ 0.5 + trust`, giving ~[0.5, 1.5]), a capped nudge, not a
dominator, so a weakly-trusted but perfectly-relevant block still surfaces. Blocks inherit trust from
the Source(s) they were folded from (a session block = operator-chat trust; a corpus block = its
corpus Source). Fact lookup (W4) ranks candidate Facts by relevance × their computed trust directly.
The inspector's "top facts ranked by provenance breadth" (Phase 4) upgrades from raw breadth to
computed trust. Result: a corroborated operator-stated fact outranks a lone web scrape on the same
query. By construction, verifiable as a retrieval-order test.

**Contradiction handling — the honesty rule applied to belief.** Same `(s,p,o)` from two writers is
corroboration (one Fact id, two `statedBy` edges). Same `(s,p)` with DIFFERENT `o`, both above a
trust floor, is a CONTRADICTION: distinct Fact ids sharing subject+predicate. The answer path surfaces
BOTH with their provenance ("operator says X; ConceptNet says Y"), NEVER silently picking the
higher-trust one, the same never-silently-wrong rule that governs the honest miss.

## What changes vs what stays

- **Changes:** `appendFact`'s provenance string → Source individuals + `mgx:statedBy` edges; a new
  `Source` class + `mgx:derivedFrom`/`statedBy`/`canonicalisedFrom` family in `core.mjs` and
  `tmct-core.ttl`; universal `mgx:createdAt`; a pure `computeTrust()` over source edges; the trust
  factor in `retrieveBlocks` and the fact-lookup/inspector rankers; contradiction detection on the
  answer path.
- **Stays:** the fnv1a `(s,p,o)` fact id and its upsert-not-duplicate idempotence; `normFactTerm`;
  the reified-Statement shape; `mutateMemory`'s read→mutate→atomic-write discipline; the
  adapter-contract write-ownership rule (memory is tmct-only output; Sources live under
  `.tmct/memory/`, never crossing the provider seam). The provider's own `derived_from:["git:<sha>"]`
  attestation (already in the adapter contract) is the existing hook a `provider:seonix` Source maps.

## Sequencing (early, incremental — it underpins others)

- **(a) `createdAt` timestamping** — tiny, first. Adds the attribute + first-write-wins to the
  existing write paths. **Phase 9 novelty is BLOCKED on (a)** (novelty × recency needs the timestamp).
- **(b) `Source` individuals + edges** — migrate the union string. **Tier-4 (learn:web provenance)
  and tier-5 (entailed provenance) are BLOCKED on (b)**. Both need somewhere to hang a Source.
- **(c) trust computation** — pure function over (a)+(b); nothing else changes yet.
- **(d) trust-as-retrieval-weighting + contradiction surfacing** — folds (c) into `blocks.mjs`, the
  W4 fact lookup, and the inspector.

Phase 6 formulaic dual-banding (PLAN_FORMULAIC_COMPETENCE) is **independent** — it reads the `via`
provenance field, not trust — and is not blocked on any step here.

## First steps

1. **(a) now:** add `mgx:createdAt` + first-write-wins to `putUtterance`, `appendFact`,
   `ensureSession`; document it in `MEMORY_VOCABULARY` and `tmct-core.ttl`; unit-test first-write-wins
   (second upsert of the same id preserves the earliest timestamp).
2. **(b):** add the `Source` class, the `mgx:derivedFrom`/`statedBy`/`canonicalisedFrom` family, and a
   `provenanceTagToSource()` parser; write the lazy in-`mutateMemory` migration; switch
   `conceptnet.mjs` and the grammar assert path to name Source ids. Round-trip test: a legacy store
   migrates with its source set preserved.
3. **(c):** implement pure `computeTrust(fact, sourcesById)`; fixture-source unit tests prove
   determinism and the prior/corroboration/recency composition.
4. **(d):** thread `trustFactor` into `retrieveBlocks` and the fact/inspector rankers; add
   contradiction detection. Retrieval-order test (corroborated operator > lone web); contradiction
   test (both surfaced). Then the bench check: does trust-weighted retrieval lift the memory-recall
   and fact-answer graded cells (per PLAN_CYCLE_4's ladder)?

## Open questions (genuinely open)

- **Recompute-on-read vs materialise-and-invalidate.** Trust is cheap per fact but retrieval touches
  many; a materialised `mgx:trustScore` invalidated on `statedBy`-edge writes trades staleness risk
  for read speed. Start materialised, keep the pure function as the source of truth. But the
  invalidation surface (recency decays continuously; does a day-old score need refreshing on read?)
  is unsettled.
- **The provider graph's OWN provenance.** seonix's Facts carry `derived_from:["git:<sha>"]`. How
  does that git history map into a `provider:seonix` Source WITHOUT tmct claiming to own or version
  seonix's commit graph? This ties to PLAN_REPOSITORY_INTERFACE: the provider should attest its own
  source across the seam (a provenance service on the repository interface), tmct recording the
  attestation, not re-deriving it.
- **Does contradiction surfacing need UI beyond text?** The in-ethos answer is prose ("A says X, B
  says Y"), but a persistent contradiction between high-trust sources may warrant an inspector view or
  a flagged-facts list. Deferred until the text form is measured.
- **Does the source-type prior entrench corpus errors over fresh web truth?** A wrong curated-corpus
  fact (0.7) outranks a correct lone web scrape (0.4) forever. The recency nudge is the partial
  answer; whether corroborated fresh web evidence should be allowed to OVERRIDE stale corpus, and how
  much recency weight that needs, is the sharpest open tension. It directly gates how aggressive
  tier-4 learn-on-miss can be.
