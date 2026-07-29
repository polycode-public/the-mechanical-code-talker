# PLAN_FACT.md — one record per assertion, not one record per triple

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-29 session, during a chat.html corpus-scale-up pass. The operator, looking at a worked
example of `trustInputs`, named the shape they actually want: **"trustInputs, working like a MIME
received header"** — every fact-assertion event its own append-only entry, one per hop, in order,
never merged or collapsed into a single summary. This document works out what that means for tmct's
fact model, against what's shipped today.

## The current model (shipped)

A Fact's identity is a hash of `(subject, predicate, object)` alone — nothing else. `appendFacts`
(`src/adapters/memory/core.mjs`) upserts by that id: if the triple already exists, the incoming
provenance tag is unioned onto it (a `" | "`-joined compat string) and a new Source is added if the
tag names a distinct source type; if not, a new Fact is created. `mgx:trustScore`/`mgx:trustInputs`
(`src/domain/memory/trust.mjs`'s `computeTrust`) are then recomputed over ALL distinct sources on
that one id: noisy-OR over each source type's prior (`operator` 1.0, `teach` 0.95, `provider` 0.9,
`corpus` 0.7, `reference` 0.6, `corpusWeak` 0.55, `referenceLive` 0.5, `extracted` 0.45, `web` 0.4,
`optimisticExtract` 0.35, `entailed` 0.3), each nudged by that source's own `mgx:sourceReliability`,
times a recency decay off the fact's own `createdAt`. `trustInputs` is the audit trail of that ONE
computation: `{ sourceTypes: [...distinct types], corroboration: types.length, createdAt, recency }`.

This is deliberate, not an oversight. `PLAN_MUD.md`: *"The CRDT merge function already exists.
`appendFacts`... upserts a fact by its content-addressed id... and unions the incoming provenance tag
onto whatever's already stored at that id. That's a G-Set's merge rule, byte for byte,"* and
explicitly: *"including the case where the receiving peer independently taught the identical fact —
both tags corroborate the same id, correctly."* A G-Set (grow-only set) merges idempotently and
commutatively regardless of delivery order or duplication — exactly what a P2P mesh needs when the
same fact can arrive redundantly over multiple paths. A code comment on `findContradictions`
(`core.mjs`) states the underlying principle: *"Same (s,p,o) is corroboration, not contradiction."*

Multiple records for the same `(subject, predicate)` already exist today, but only for genuine
disagreement: `findContradictions` keeps separate Fact records apart when the OBJECT differs (two
characters claiming different locations for something), reporting them as a group — *"both kept,
never silently resolved."* Multi-valued predicates (`mgx:hasA`, `mgx:capableOf`, and their negations)
are explicitly excluded from ever counting as a contradiction: "a dog has legs AND a dog has a tail"
are both true, not a disagreement.

The real worked example from this session (a peer independently teaching a fact the corpus already
had, over the real relabel-and-receive path):

```json
{
  "id": "fact:d5327019d311a956",
  "label": "dog mgx:capableOf bark",
  "class": "Fact",
  "derived_from": [], "mentions": [],
  "trustInputs": [
    { "key": "sourceTypes", "value": ["corpus", "teach"] },
    { "key": "corroboration", "value": 2 },
    { "key": "createdAt", "value": "<timestamp>" },
    { "key": "recency", "value": 1 }
  ],
  "attributes": [
    { "prop": "rdf:type", "key": "type", "value": "rdf:Statement" },
    { "prop": "rdf:subject", "key": "subject", "value": "dog" },
    { "prop": "rdf:predicate", "key": "predicate", "value": "mgx:capableOf" },
    { "prop": "rdf:object", "key": "object", "value": "bark" },
    { "prop": "mgx:createdAt", "key": "createdAt", "value": "<timestamp>" },
    { "prop": "mgx:factProvenance", "key": "provenance", "value": "corpus:human /r/CapableOf | teach:peer:scavenger-dial@<timestamp>" },
    { "prop": "mgx:hasProseTokens", "key": "prose_tokens", "value": "bark capableof dog mgx" },
    { "prop": "mgx:trustScore", "key": "trustScore", "value": "0.992125" },
    { "prop": "mgx:updatedAt", "key": "updatedAt", "value": "<timestamp>" }
  ]
}
```

The 0.992125 is real, not illustrative: noisy-OR of corpus's 0.7 and teach's EFFECTIVE prior
0.95 × 1.025 (the peer's Source already carried `sourceReliability: 1.025` on its first-ever fact —
`sessionReliabilityFrom` treats "1 asserted, 0 contradicted" as mildly positive, not neutral, at any
sample size) gives `1 - (1-0.7)(1-0.97375) = 0.992125` exactly.

What this model cannot show: WHICH node taught it, when, distinct from the corpus's own origin —
that's compressed into one blended number and a provenance string you'd have to re-parse.

## The proposed model

Give every fact-ASSERTION its own record, not every fact-TRIPLE. Concretely:

- **Identity becomes `hash(subject, predicate, object) + sourceNodeId`**, not `hash(subject,
  predicate, object)` alone. Two different nodes asserting the same triple get two different Fact
  ids that share a common `tripleHash` prefix; the SAME node re-asserting the SAME triple still
  upserts onto its own one record (this preserves the G-Set property for the case that actually needs
  it — repeated/duplicate delivery from one origin — without merging away distinct origins).
- **`trustScore`/`trustInputs` move from "stored on the record" to "computed over the group"** —
  a query for "how much do I trust dog-can-bark" becomes: fetch every record sharing `tripleHash`
  d5327019d311a956, then noisy-OR over each record's own (single) source prior. This is the SAME
  math as today, just deferred from write-time to read-time. A "head"/cached view per `tripleHash`
  group can still store the last-computed aggregate for cheap reads, invalidated whenever a record
  in the group is added — structurally close to how `recomputeFactTrust` already works, just
  re-keyed from "sources on one fact" to "records in one group."
- **Each record's own `trustInputs` simplifies**, because it no longer needs to describe more than
  one source: `{ sourceType, sourceNodeId, sourceNodeName?, createdAt, recency }` — no array needed
  at this level. The array-of-hops the MIME analogy wants is the SET of records sharing a
  `tripleHash`, not a field inside any one of them.
- **`mgx:factProvenance`** becomes one tag per record (its own single event), rather than a
  `" | "`-joined union — the union already lived across separate Source objects; now it lives
  across separate Fact records instead, which is more queryable (list them, don't re-parse a string).

## Worked example: the operator's scenario, two records

Same "dog can bark" fact, corpus-origin and peer-taught-and-transferred, as two records instead of
one. Every record stays a plain, flat `attributes[]` list — the same shape every fact already has —
with source identity riding in `mgx:factProvenance`'s string rather than living in extra top-level
fields. `tripleHash` isn't a separate field either: it's just the part of `id` before the `@`,
splittable trivially. No `recency` is ever stored — it's `recencyNudge(createdAt, now)`, a function
of the current moment, not a fact about the record; computing it fresh at read time is the only
form that's ever correct, in either model.

The corpus isn't a live P2P node, so it gets a `seed:` node id rather than a fabricated peer
identity — an honest distinction, not papered over.

```json
{
  "id": "fact:d5327019d311a956@seed:human",
  "label": "dog mgx:capableOf bark",
  "class": "Fact",
  "derived_from": [], "mentions": [],
  "attributes": [
    { "prop": "rdf:type", "key": "type", "value": "rdf:Statement" },
    { "prop": "rdf:subject", "key": "subject", "value": "dog" },
    { "prop": "rdf:predicate", "key": "predicate", "value": "mgx:capableOf" },
    { "prop": "rdf:object", "key": "object", "value": "bark" },
    { "prop": "mgx:createdAt", "key": "createdAt", "value": "2026-07-29T07:31:11.613Z" },
    { "prop": "mgx:factProvenance", "key": "provenance", "value": "corpus:human /r/CapableOf" },
    { "prop": "mgx:hasProseTokens", "key": "prose_tokens", "value": "bark capableof dog mgx" },
    { "prop": "mgx:trustScore", "key": "trustScore", "value": "0.7" },
    { "prop": "mgx:updatedAt", "key": "updatedAt", "value": "2026-07-29T07:31:11.613Z" }
  ]
}
```

```json
{
  "id": "fact:d5327019d311a956@node:7f3a9c2e",
  "label": "dog mgx:capableOf bark",
  "class": "Fact",
  "derived_from": [], "mentions": [],
  "attributes": [
    { "prop": "rdf:type", "key": "type", "value": "rdf:Statement" },
    { "prop": "rdf:subject", "key": "subject", "value": "dog" },
    { "prop": "rdf:predicate", "key": "predicate", "value": "mgx:capableOf" },
    { "prop": "rdf:object", "key": "object", "value": "bark" },
    { "prop": "mgx:createdAt", "key": "createdAt", "value": "2026-07-29T20:00:00.000Z" },
    { "prop": "mgx:factProvenance", "key": "provenance", "value": "teach:peer:scavenger-dial@node:7f3a9c2e@2026-07-29T20:00:00.000Z" },
    { "prop": "mgx:hasProseTokens", "key": "prose_tokens", "value": "bark capableof dog mgx" },
    { "prop": "mgx:sourceReliability", "key": "sourceReliability", "value": "1.025" },
    { "prop": "mgx:trustScore", "key": "trustScore", "value": "0.97375" },
    { "prop": "mgx:updatedAt", "key": "updatedAt", "value": "2026-07-29T20:00:00.000Z" }
  ]
}
```

Each record's own `trustScore` is just its own source's effective prior (corpus: bare 0.7; peer
teach: 0.95 × 1.025 reliability = 0.97375 — the SAME effective prior the old model folded into its
noisy-OR, now visible on its own). Reading "how much do I trust this" means grouping both records by
the part of `id` before `@` and running the same noisy-OR as before:
`1 - (1-0.7)(1-0.97375) = 0.992125` — identical to today's stored number. Nothing about the
user-facing answer changes; what changes is that the two events are now separately visible,
separately timestamped, separately attributable to a node, rather than pre-collapsed.

## Sibling resolution, borrowing from Riak

Riak (a leaderless, eventually-consistent KV store) faces a structurally similar problem: two
clients can write the same key with neither having seen the other's write. Riak's answer, with
`allow_mult=true`: don't guess a winner. Keep both values as **siblings** under the key, return all
of them on read, and let a **pluggable per-bucket resolver** collapse them to one value — or leave
them unresolved until something explicitly writes a value that causally descends from both,
closing the fork. (Riak's own vector-clock/DVV machinery is for a narrower question than tmct
needs — detecting whether two writes are truly concurrent versus one following the other in a
distributed KV store. tmct's multi-record model sidesteps that detection problem entirely: identity
is `tripleHash + sourceNodeId`, so every distinct source gets its own record by construction, no
concurrency check required. What's worth taking from Riak isn't the vector clock — it's the
architectural split between KEEPING conflicting writes instead of silently picking one, and
RESOLVING them via a strategy chosen by the data's own type, not ad hoc per query.)

Riak also grew native CRDTs (Sets, Counters, Maps) precisely so common patterns stop needing an
app-level resolver at all — their merge functions are commutative/associative/idempotent by
construction, safe with zero business logic. tmct already has an equivalent: `mgx:hasA`/
`mgx:capableOf` (`MULTI_VALUED_PREDICATES` in `core.mjs`) are set-union by nature — "a dog has legs"
and "a dog has a tail" were never in conflict, so there's nothing to resolve, only to merge.

**Proposed resolution taxonomy** — a small, closed enum keyed mostly by PREDICATE (matching this
codebase's existing preference for closed vocabularies over general rules — `SOURCE_PRIOR`, the ISA
predicate set, `MULTI_VALUED_PREDICATES` are all the same shape), not an arbitrary per-fact
resolver function:

- **`merge` (CRDT-like, no real conflict).** Predicate is in `MULTI_VALUED_PREDICATES` and the
  sibling objects differ → not competing claims, just aggregate them into one presented answer.
  Exactly today's behavior, just re-derived from grouping records instead of grouping sources.
- **`corroborate` (same claim, different sources).** Same triple, different `sourceNodeId` → the
  noisy-OR trust math already in this doc. No genuine disagreement; strength of belief goes up.
- **`latest-observation-wins` (state-of-the-world predicates — location, current status).** Same
  subject+predicate, different object, and the predicate describes a point-in-time state rather
  than a settled fact. The resolver here must NOT simply prefer whichever record has the latest
  `mgx:createdAt` (ingestion time) — this is the operator's sun example: a stale newspaper article
  *read* today, about the sun still being in the sky, was *observed* long before an eyewitness
  report of it exploding yesterday. Preferring the later ingestion would get this exactly backwards.
  This strategy needs a genuine bitemporal split tmct doesn't have today — `mgx:createdAt` (when
  the LOCAL record was written) versus a new `mgx:observedAt` (when the asserted party actually
  witnessed/verified the claim) — and prefers the sibling with the later `observedAt`, not the later
  `createdAt`. Worked example, one record:
  ```json
  { "prop": "mgx:observedAt", "key": "observedAt", "value": "2019-03-01T00:00:00.000Z" },
  { "prop": "mgx:createdAt", "key": "createdAt", "value": "2026-07-29T09:00:00.000Z" },
  { "prop": "mgx:factProvenance", "key": "provenance", "value": "reference:newspaper:evening-star@2026-07-29T09:00:00.000Z" }
  ```
  read on 2026-07-29 but describing what was true as of 2019 — `observedAt` carries that distinction,
  `createdAt` alone can't.
- **`highest-trust-wins` / genuine contradiction (settled, non-multi-valued facts).** Same
  subject+predicate, different object, predicate is NOT multi-valued, no observation-time axis
  applies (e.g. a definitional claim). This is exactly `findContradictions`'s existing job — unchanged
  by this plan, see below.

A fact's resolution strategy is a lookup by predicate (with a default), computed at READ time over
whichever siblings a `tripleHash` group holds — never stored per-record, since the same predicate
always resolves the same way regardless of which particular siblings happen to exist.

## Reading siblings: breadth-first grouping, merge where safe

Answering "what do I know about dog capableOf X" (or any subject+predicate question) becomes:

1. **Gather breadth-first**: pull every record sharing the `(subject, predicate)` pair — not just
   one exact triple, the whole neighborhood of objects — in one pass. This is the same grouping
   `findContradictions` already does; the records being grouped are now the sibling Fact records
   themselves rather than Sources hanging off one Fact.
2. **Split by object**: records with the SAME object are siblings of each other → resolve via
   `corroborate` (noisy-OR) into one effective trust score for that object.
3. **Records with DIFFERENT objects** → look up the predicate's resolution strategy: `merge` (present
   all, e.g. hasA/capableOf), `latest-observation-wins` (compare `observedAt`, pick one), or fall
   through to `findContradictions`'s existing "both kept, never silently resolved" reporting.

`findContradictions` doesn't get replaced by any of this — it's still the mechanism for genuine,
unresolvable disagreement. What changes is what it's grouping: sibling Fact records that already
exist as separate rows by construction, instead of a search that has to notice two whole Facts
happen to share a subject+predicate today.

## Delegating search to the RDBMS: real indexed columns

Confirmed this session (an agent read the actual schema): today's sqlite backend stores every
individual as one opaque JSON blob (`individuals(id PK, ord, class, label, json)`), no subject/
predicate/object columns anywhere for facts. `loadMemory` runs `SELECT json FROM individuals ORDER
BY ord` — the WHOLE table, unconditionally — and everything downstream is a JS array scan. SQLite is
being used as a durable blob store keyed by id, not a query engine, for facts.

The operator wants this to work with sqlite locally, but be portable to a cloud-hosted relational
backend later (this repo already has an open item for an AWS-hosted memory store, `s3`/`s3+dynamo`,
for marginalia — see `NEXT.md`) — so the schema below is deliberately plain, portable SQL: no
sqlite-specific functions, nothing that wouldn't equally work against Postgres/MySQL/Aurora.

Proposed `facts` table — real columns duplicating a few `attributes[]` values specifically so the
RDBMS's own query planner and indices can do the filtering, with the JSON blob remaining the single
source of truth (columns are a derived, write-time-maintained projection, not a second copy to keep
in sync by hand):

```sql
CREATE TABLE IF NOT EXISTS facts (
  id            TEXT PRIMARY KEY,     -- "<tripleHash>@<sourceNodeId>" under this plan's proposed model
  triple_hash   TEXT NOT NULL,
  subject       TEXT NOT NULL,
  predicate     TEXT NOT NULL,
  object        TEXT NOT NULL,
  source_node_id TEXT,
  trust_score   REAL,
  created_at    TEXT NOT NULL,
  observed_at   TEXT,                 -- nullable: only state-of-the-world predicates set this
  json          TEXT NOT NULL         -- the full individual — source of truth, same as today
);
CREATE INDEX facts_by_triple_hash        ON facts(triple_hash);
CREATE INDEX facts_by_subject_predicate  ON facts(subject, predicate);
CREATE INDEX facts_by_predicate_object   ON facts(predicate, object);
```

This turns "every fact about dog" into `SELECT json FROM facts WHERE subject = 'dog'` (indexed,
sqlite/Postgres/Aurora alike) instead of loading everything and filtering in JS; "every sibling for
this triple" into `SELECT json FROM facts WHERE triple_hash = ?` — a real indexed lookup, no
string-prefix parsing of `id` needed at all. This is genuinely orthogonal to the sibling-resolution
model above: even the CURRENT one-record-per-triple design would benefit from real subject/
predicate/object columns instead of an opaque blob. It could land as an independent, lower-risk
step before (or regardless of) the multi-record model.

This isn't free: it needs write-path work (populate the redundant columns on every insert/update
alongside the JSON blob) and its own perf-guard test — today's only perf guard
(`test/adapters/memory-seed-perf.test.mjs`) covers write-batch cost, nothing on the read/query
side. Both would need to exist before this is more than a plan.

## Open questions

- **CRDT convergence.** Keying by `hash(triple) + sourceNodeId` keeps the G-Set property for the
  case it exists to solve (the same node's fact arriving twice over different mesh paths still
  upserts one record, not two) — but this needs to actually be checked against `PLAN_MUD.md`'s real
  replication paths, not just asserted here. Does every P2P delivery path already carry a stable
  node id early enough to key on, or does something need to start carrying one that doesn't today?
- **Storage growth.** N records for a widely-corroborated fact is the whole point of this model, not
  a defect — but is there a real ceiling worth planning for (a fact taught by hundreds of visitors),
  and if so is a later compaction/summarization pass the right answer, or a cap on how many records
  one `tripleHash` group keeps before older ones roll up into a summary record? Not decided here.
- **Consumer impact.** `chat.mjs`'s answer rendering (`capabilityReply`'s `renderFactLine`, the is-a
  ladder, etc.) reads `mgx:trustScore` off ONE fact today. Under this model every read site that
  currently does that needs to either read a cached per-`tripleHash` aggregate (cheap, but is another
  materialized-view invalidation path to keep correct) or explicitly aggregate at query time (correct
  by construction, costs a fan-out per read). Which of these — or some mix — is the real
  implementation question this plan doesn't yet answer.
- **Relationship to `findContradictions`.** These stay two different mechanisms, not one subsuming
  the other: `findContradictions` is about DIFFERENT objects for the same subject+predicate (genuine
  disagreement); this plan is about the SAME triple from different sources (corroboration, just kept
  un-merged). A `tripleHash` group under this model is internally agreeing by construction — the
  disagreement case still needs its own separate-object grouping exactly as today.
