# PLAN_MEMORY_BACKEND.md — a pluggable session-memory backend, the AWS row service behind the deployed demos, and a consumer-hosted turn surface over a Dynamo corpus

Status: BUILDING — the operator gave the build go on 2026-08-10; the campaign (§28) is running.
Revised ten times before the go. The first draft made news.html an IndexedDB consumer; the
operator redirected it (2026-08-10): the deployed news demo must BE the AWS-backed architecture,
fronted by a new row service in tmct's own stack. The second revision (same day) moved every
backend into the library: there is no consumer-written adapter — tmct builds, tests, demos, and
ships the DynamoDB backend in-tree, and a consumer's integration is configuration. The third
(same day) reshaped the service surface: session keys ride the mutating request paths, TTL is a
configurable deployment knob defaulting to one week, and the per-session row limit gave way to
one hard global table cap. The fourth (same day) made the service's deletes soft: a delete
marks rows and reclaims nothing, so filling and deleting in a loop cannot burn spend — the cap
holds, TTL alone removes data, and the operator accepts waiting out the TTL window after an
attack. The fifth (same day) folded in bedrock-meter's adoption review: reads are consistent by
default, writes go out concurrently, an oversized row can drop instead of failing the turn, the
error taxonomy is published, and the spec's own bookkeeping example is corrected — the
`tmct:needs` row is an extractor defect, and no storage class retires it. The sixth (same day)
absorbed the turn-service plan whole — this document now also owns the consumer-hosted turn
surface, the Dynamo corpus supplement and its loader, retrieve-then-resolve, and the circuit
breakers — generalized the good-citizen pattern to the external research and reference sources,
gave chat.html and ledger.html an opt-in AWS backend mode behind a slider and a query
parameter, and renamed the home grid to the demo grid with nine deep-linked buttons. The seventh
(same day) fixed the operator's remaining calls: the turn Lambda bundles the full xl seed
(§3.18); three corpus bands ship first-class with the Wikidata slice as the demo's loaded set
and the wikipedia-derived band deferred to its own future design doc (§3.13); the AWS spend is
approved in full (§3.8); the build, when it comes, runs as one continuous campaign (§28); T1
calibrates the retrieval budgets from measurements before anything consumes them (§3.15.1);
fuzzy retrieval ships on, mode-configurable and per-request togglable (§3.15.2); and T4 is
guarded by tier-1 alone, the judge spend declined (§20). The eighth revision is the
code-cross-check pass: every cited seam verified against the tree (the per-assertion record
ids, the seven sqlite tables and their two deliberate orderings, the real dispatch and
session-threading call sites, the news session's construction, the infra layout), each phase
thickened with implementation notes from that survey; plus three additions — the news page's
poll and enrichment cycles move server-side behind async triggers with the page polling a
`graphVersion` meta value to refresh (§3.21, phases T12–T13), the good-citizen/breaker
machinery goes shared-state on the worker, and bedrock-meter's adoption items land
(`basePayload` and per-session bounds on the constructor, the M0–M4+M9 npm cut named inside
the campaign, the attributeNames fixed-fields rule). The ninth replays the seed decision with
the corpus-migration framing the seventh missed: the turn Lambda bundles the mid band set
(persona, SEON, the code corpuses — a one-second-class parse), WordNet and ConceptNet return
per-query from their corpus bands as supersets of what the bundle gave up, and all three bands
become the demo's loaded set with tmct's own deployment owning their attribution (§3.13,
§3.18). The tenth makes news.html a true thin client (operator directive): the page carries no
in-page graph at all — no seed fetch, no engine assembly, no in-page ingest — the news worker
materializes the feed server-side after every change and the page renders `GET /api/feed`,
teaches flow through an async ingest trigger, a chat area joins the page below the teach panel
as the turn endpoint's first page consumer, and the previous unpersisted-but-functional
degraded mode is recorded as considered-and-replaced (§3.7, §3.21, §3.22, phases M8/T12–T14).
The consumer
requirements it answers are bedrock-meter's
`GRAPH_BACKEND_SPEC.md` (untracked in their repo, carried over by the operator; its section
numbers are cited as spec §N throughout). The seam it formalizes already exists in embryo:
`src/adapters/memory/core.mjs` routes every read and write through one opaque `memoryDir` token
today, and this plan turns that token's closed set into an open one.

This plan is written to be built by Sonnet-tier implementers with no further design work, with
the two `core.mjs` phases marked for Opus. Every phase names its module paths, data structures,
function signatures, test files, and acceptance commands. The hard decisions (the interface, the
row shape, the index key, where bookkeeping lives, which backends ship in the library, the
service's endpoints and caps, what the conformance suite can and cannot check) are fixed here,
in writing.

The feature in one paragraph: `createSession`/`runTurn` accept an injected backend object beside
today's `"memory"`/`"sqlite"` strings. The backend is a small async row store bound to one opaque
session key. tmct assembles its working payload from the backend's rows, writes back only the
rows a turn changed, and keeps every sidecar behind the same object. The library ships three
backends, all first-class in-tree code passing one published conformance suite: in-memory (the
reference implementation and the suite's own fixture), sqlite (the CLI's store, refactored onto
the same contract), and DynamoDB (`createDynamoRowBackend` — a consumer hands it a document
client, a table name, and a TTL policy, and writes no storage code). An HTTP client backend
carries the same contract over the wire, and the deployed news.html demos the whole stack as a
true thin client: the page renders a feed the news worker materializes server-side, its teaches
and its chat run through the service's endpoints, and no graph is ever assembled in the browser
— page → `/api/*` on the existing CloudFront distribution → row/turn/news-worker Lambdas → the
library's own DynamoDB backend → table. bedrock-meter embeds tmct
and configures the shipped DynamoDB backend over their own table; nothing on the storage path is
theirs to build. On top of the same table, `POST /api/sessions/:uuid/turn` runs a full tmct
turn in a Lambda with no network but DynamoDB — the whole engine as a consumer-hosted API tmct
demos on its own deployment — fed by shared `corpus:<band>` partitions holding the corpora the
Lambda does not bundle (both the too-large-to-bundle and the deliberately migrated, §3.18),
retrieved per turn as a bounded, deterministic subgraph the unchanged synchronous engine
resolves over. And the demo pages meet the same architecture from the
browser side: chat.html and ledger.html gain an opt-in AWS-backed mode behind a slider and a
`?backend=aws` deep link, and the home grid — renamed the demo grid — carries nine deep-linked
buttons.

---

## 1. What ships today

Every phase below cites these seams instead of re-deriving them.

**The `memoryDir` token.** Every memory call in the tree threads one opaque value. It is either
a repo-path string (Backend A, flat JSON, retired from routing), `{ backend: "memory", payload }`
from `createInMemoryStore()` (Backend B), or `{ backend: "sqlite", db, dbPath }` from
`createSqliteMemoryStore()` (Backend C). Only `loadMemory(dir)` and the internal
`persistMemory(dir, payload)` dispatch on the backend; every other function in `core.mjs`
operates on the plain payload they hand back. That narrow waist is why this plan is a seam
change and a projection, and leaves the resolution engine alone.

**The selection seam.** `chat-session.mjs` resolves `backendChoice` from the `memoryBackend`
option, `TMCT_MEMORY_BACKEND`, then `tmct.toml`'s `[memory] backend`, and hands it to
`openMemoryBackend(repoRoot, backendChoice)` — the one shared resolver `init.mjs`'s corpus seed
also calls, so seeded and taught facts land in the same store.

**Diffed row writes exist already.** Backend C's `persistSqlitePayload` diffs a mutated payload
against what the connection last saw and issues per-row INSERT/REPLACE/DELETE, with a cached
payload patched in lockstep (`cacheUpsertIndividual` and friends mirror every SQL write). The
sqlite DDL is row-oriented across seven tables: `individuals` (id, ord, class, label, json —
the JSON blob is the source of truth, the columns are a queryable projection), `relations` and
`edges` (the objectProperties groups and their example edges, NUL-delimited (subject, object)
keys), `facts` (a per-Fact projection written in the same transaction as its `individuals`
row), `meta` (the payload's top-level scalars: `generated_at`, `memory`, `prefixes`,
`vocabulary`, `classes`, `proseIndex`), and two DERIVED tables re-materialised per write for
exactly what moved — `fact_heads` (per-group trust bases) and `fact_object_supersessions` (an
ordered supersession log per subject+predicate). The payload shape those tables reconstruct is
`emptyMemory()`'s: `{ generated_at, memory, prefixes, vocabulary, classes, objectProperties,
individuals, proseIndex }`. Two ordering semantics are deliberate and load-bearing:
`individuals` keep a stable `ord` (an update preserves array position), and a changed edge
moves to the END of its group's `examples` (recency). A record's id is per-ASSERTION —
`<tripleHash>@<sourceId>` (`factGroupId` strips the suffix; two sources asserting one triple
are two records sharing a group). The projection this plan factors out is the same one that
code performs inline today, and §3.2's implementation notes carry these exact shapes.

**The sidecars.** The syllogise watermark and node id already dispatch per backend
(`loadSyllogiseState`/`saveSyllogiseState`, `loadNodeId`/`saveNodeId`). The research queue does
not: `research-queue-store.mjs` derives a filesystem path from the token (`dbPath`'s `.tmct/`
sibling) and silently no-ops for any handle without one. The researched-terms dedup set the spec
names (§3.4) lives in bedrock-meter glue (`researched.json`), outside tmct entirely.

**The conformance precedent.** `src/tools/conformance.mjs` is the repository-interface contract
suite as a reusable kit, published as the `./conformance` export: `runConformance(name,
makeProvider)` plus shape validators. Passing the suite is what conformance means. This plan
copies that shape for the memory backend.

**Browser persistence today.** chat.html snapshots its whole Backend-B payload into IndexedDB
through `src/surfaces/web/idb-persist.mjs` (best-effort by contract: no IndexedDB means load
resolves null and save resolves false, never a blocked boot; a stamp mismatch discards the
snapshot). news.html persists nothing across reloads: `createNewsSession` builds a fresh
Backend-B handle each load, and only the start-consent preference lives in localStorage.
"Stop & forget" already retracts every news/research row and resets session state in-page.
The "kept best-effort on this device, never sent anywhere" promise is chat.html's and
ingest.html's (`persistNote` in `chat-page-viz.mjs`/`ingest-viz.mjs`); news.html has never
made it.

**The site's AWS stack, in-repo.** `infra/` is the CDK app: `website-stack.ts` owns the publish
bucket, the CloudFront distribution (a viewer-request CloudFront Function rewrites oversized
asset paths), OAC, ACM, and Route53; `apex-stack.ts` the apex. CI's `deploy:website` job builds
`public/`, assumes the prod role over GitLab OIDC (no static keys), and runs `npx cdk deploy
tmct-prod-prod-website`. `scripts/fast-deploy-web.sh` is the pipeline-skipping sync for content-
only changes. After a publish, `npm run smoke:deploy` (`scripts/post-deploy-smoke.mjs`) polls
the live origin until it serves the built version. The row service lands inside this same stack
and deploy path.

**The engine is already a bounded reasoner.** The alias chase is two hops. Property, capability,
and does-have inheritance widen exactly one stored `rdfs:subClassOf` hop. Syllogise runs under
a budget. The planner search is bounded. The choice lane's constraint pull is capped per turn.
This matters because the retrieval phase (§3.15) mirrors those bounds; a subgraph that covers
them loses nothing the engine could have reached.

**The term machinery retrieval needs exists.** `normFactTerm` folds surface forms to canonical
terms; the lexicon's plural/lemma folds and the real-word collision table (an estate-guarded
generated artifact) give a deterministic, closed way to produce fuzzy variants without ranking
or scoring.

**The embedded target is proven.** bedrock-meter runs `createSession`/`runTurn` inside Lambda
today. The engine needs no decomposition into services: resolution, the syllogist, `/prove`,
and the reference lanes are in-process library calls.

**The offline research and reference sources.** `researchSource: "simple-wikipedia-pack"` and
the shipped reference pack already serve wiki-backed lookups with zero network. On the turn
surface they are the wiki story; the deferred wikipedia-derived band (§3.13,
`PLAN_WIKIPEDIA_BAND.md`) would extend the same posture to much larger data when its own
design lands.

**The external sources and their manners today.** The live research adapters (wikipedia,
wikidata) fetch over HTTPS behind a 2 s per-source courtesy throttle. The news page's KB
lookups run under an abort seam with a negative cache. liveReference supplements reference
answers for embedded consumers under a consumer-set budget. These are the external call
sites §3.16 gives one shared pattern; the courtesy throttle is that pattern's ancestor.

**CLI verbs have one home.** `src/domain/cli-verbs.mjs` is the single verb list both `--help`
and unknown-invocation errors render from; `bin/tmct.mjs` dispatches on it. The loader verb
(§3.14) follows that pattern.

**The grid and the page modes today.** The home page's grid is the claim grid: eight cells
(seven demo pages plus the river deep link), classes `.claim-grid`/`.claim-cell`/`.claim-page`,
eyebrow "eight easy pieces" — a name it shares with the claims table and claims.html, which it
no longer exclusively serves. chat.html persists its payload locally through `idb-persist.mjs`;
ledger.html runs in-page with no cross-reload persistence; neither page has a backend choice.

**The ordering rule.** Any read-time resolver over the fact store must be a pure function of the
fact set. `p2p-room.mjs`'s `sortFactIndividualsById` is the precedent, and
`docs/references/papers/crdt.md` the full account. The backend contract below inherits it: row
order on read never carries meaning.

---

## 2. The constitution for this plan

- **A storage seam, never a behaviour change.** Same store state plus same turn input gives the
  same answer, on every backend. The spec's non-goals (§9) are adopted whole: no cross-session
  knowledge bases, no search, no replication, no migration of existing stores, no change to
  answer composition.
- **Provenance grammar untouched** (spec §5). `reference:simplewiki:<Title>@<revid>`,
  `research:<topic>@<depth>`, `teach:...` keep their exact current forms; two downstream
  consumers parse them.
- **`factsTouched` keeps its row shape** — `{id, subject, predicate, object, provenance}` plus
  the additive fields 5.0.32 and later carry.
- **Storage code ships in the library.** Every backend a supported consumer needs is built,
  tested, and demonstrated in-tree; embedding tmct against DynamoDB is configuration (a client,
  a table name, a TTL policy), never storage code. The conformance kit stays published for
  anyone who chooses to build a custom backend anyway; no supported path requires one.
- **The graph and lexicon are read-only inputs per session and out of scope.** Only mutable
  session memory moves behind the seam. The reference pack stays bundled and offline.
- **The privacy split is explicit, honest, and per mode.** chat.html's local mode — the
  default — keeps its promise unchanged, to the word: taught facts kept best-effort on this
  device, never sent anywhere. Its opt-in AWS mode (§3.19) swaps the copy whole: while the
  slider is on AWS, the page says facts are stored server-side against an anonymous seven-day
  session, and the local-only wording is absent, not amended. news.html makes the server-side
  promise only: facts taught or polled there are stored against an anonymous session addressed
  by a random key kept in this browser, expire after seven days, and "stop & forget" hides them
  from every read immediately, with physical removal finishing inside that seven-day window.
  The one local item beyond the existing consent preference is that key — a session pointer,
  never facts — and the copy says so. No page or mode ever shows a promise it is not keeping.
- **Best-effort in the browser, honest everywhere.** On chat.html and ledger.html the service
  being unreachable never blocks the page: their engines are in-page, so an AWS-mode visit
  runs without persistence and says so. news.html is the deliberate exception (§3.7): it is a
  thin client with nothing to compute locally, so an unreachable service leaves the page
  booted, labelled feed-and-chat-unavailable, and idle — stated plainly, never dressed as a
  working mode. A failed write surfaces visibly on every page, never as a silently dropped
  row, and no fact is ever stored locally on the news page — localStorage holds the consent
  preference and the session pointer, nothing else.
- **Fixture-true testing.** No test reaches live AWS. The service's own handler, run locally
  over the reference backend, is the test double; the live check is the post-deploy smoke probe,
  which is measurement, not a test tier.
- **tmct is offline; the hosted surfaces are consumer-hosted, and tmct demos them.** The
  browser demo stays the product claim on the pages that make it — chat.html, ledger.html, and
  the rest keep the engine in your page, deterministic. news.html is the one thin page: it
  demos the hosted architecture instead, and no offline claim attaches to it (§3.7). The
  row service and the turn API are the architecture a consumer hosts (bedrock-meter-style), and
  tmct's own deployment exists to demonstrate it working end to end. Every consumer-facing
  sentence in docs and site copy frames it that way.
- **No egress from the turn Lambda.** Its only network is DynamoDB. No live wikipedia, no
  outbound HTTP of any kind. Wiki-backed search is served by the shipped reference pack and
  the loaded corpus bands (the deferred wikipedia-derived band extends it when its own plan
  lands); every fact a turn can ground comes from a committed or loaded
  source, and its provenance says which. The one Lambda WITH egress is the news worker
  (§3.21), whose whole job is polling external feeds: its outbound HTTP is allow-listed to
  the source roster and KB hosts, and it carries §3.16's manners in their strongest form.
- **Every remote call is a good citizen.** Dynamo corpus Queries and external source fetches
  alike run under declared budgets, back off inside them, degrade honestly, and sit behind a
  circuit breaker suited to their runtime (§3.16).
- **Determinism holds through retrieval.** Same query + same corpus state + same session rows
  gives the same subgraph and the same answer. Retrieval uses sorted terms, sorted sort-key
  traversal, and fixed caps, so a budget cut always lands in the same place (§3.15).
- **The honest miss survives bounding.** A fact outside the retrieved subgraph is an honest
  miss, the same miss the browser page gives for a fact outside its seed. A retrieval timeout
  is a smaller subgraph, never a guess. Enumeration answers state their bounds (§3.17), and
  breaker state selects between two honest modes — with the corpus supplement or without —
  with the answer saying which one served it.

---

## 3. The decisions

### 3.1 The interface: a session-scoped async row store

A custom backend is an object the consumer constructs and injects. tmct binds it into the same
`memoryDir` token every existing call already threads. The contract, in
`src/adapters/memory/row-backend.mjs`:

```js
// Duck-typed marker; isRowBackend(dir) tests it.
{
  kind: "tmct-memory-row-backend",
  contractVersion: 1,

  // All async. `rows` are wire rows (§3.2). Order never carries meaning.
  readRows(),                 // → AsyncIterable<row> or Promise<row[]>; every live row for this session
  putRows(rows),              // upsert; per-row atomic; resolves when all rows are durable
  deleteRows(rowKeys),        // make the rows absent from every read; missing keys are a no-op
  readRowsByTerm(term),       // OPTIONAL: rows whose index term matches; absent → core reads readRows()
  readMeta(key),              // → string | null   (sidecar values, JSON-encoded by the caller)
  putMeta(key, value),        // upsert one sidecar value
  deleteAll(),                // make every row and meta entry this session key reaches absent (spec §4)
  close(),                    // release connections; further calls may reject
}
```

**Delete semantics are observable, not physical.** The contract promises one thing: a deleted
row never appears in any subsequent read. Whether a backend removes the item (the in-memory
and sqlite backends do) or tombstones it and filters reads (the DynamoDB backend's soft-delete
mode, which the row service uses — §3.10) is that backend's implementation choice. The
conformance suite checks the observable behaviour only, so its delete-then-read-empty checks
pass both ways.

**Failure is typed.** Two named error classes are part of the published contract, exported
beside the backends (§3.10): `BackendRejected` (`code: "TMCT_BACKEND_REJECTED"` — the input
was refused: an oversized row, a malformed key, a validation failure) and `BackendUnavailable`
(`code: "TMCT_BACKEND_UNAVAILABLE"` — the store could not be reached or refused service: a
network failure, a 429/507/5xx). A consumer whose turn is itself a last-resort fallback — a
visitor must get an answer even when persistence fails — catches by class or by `code` and
continues without persistence, the same posture news.html takes (§3.7). Nothing requires
string-matching an error message. The conformance kit asserts every backend's failures are
instances of these classes with those codes.

Decisions folded into that shape:

- **Session binding at construction.** The object is already scoped to one opaque session key
  the consumer chose (spec §4). The engine never sees the key, the table name, credentials, or
  an SDK — they live inside the backend object; for the shipped DynamoDB backend that means an
  injected, consumer-credentialed document client (§3.10), never bundled credentials. This
  matches how `memoryDir` is per-session today. (In the browser the page itself mints the key
  and holds it in localStorage — §3.7; the engine still never sees it.)
- **Batch, then per-row atomicity.** `putRows` takes the batch (`appendFacts`' research fan-out
  lands in one call, spec §3.1) and promises only per-row atomicity. A batch that half-lands
  leaves individually valid rows, which is exactly what the spec asks and what row-keyed KV
  stores give natively.
- **The optional term read.** `readRowsByTerm` is in the contract so the index shape (§3.3) is
  settled now, and the conformance suite exercises it when present. Core's v1 read path does not
  call it (§3.5 explains why and what changes later).
- **Meta is for scalars only.** `readMeta`/`putMeta` carry the syllogise watermark
  (`"syllogiseState"`) and node id (`"nodeId"`) — single values whose last-write-wins semantics
  are survivable (§3.6). The research queue and the researched-terms dedup set (spec §3.4) are
  NOT meta: each entry projects as its own `bookkeeping` row (§3.2), so concurrent turns append
  to the queue without a read-modify-write race. `research-queue-store.mjs` keeps its file path
  for Backend C tokens and gains the row path for row backends, so the queue stops being
  consumer glue either way.

### 3.2 The wire row

The backend stores opaque, versioned rows. It needs no understanding of tmct's payload beyond
three indexable fields:

```js
{
  rowKey: "fact:1a2b…@src:…",  // stable id; a Fact's record id is per-ASSERTION —
                           // `<tripleHash>@<sourceId>` (core.mjs's factGroupId model) — so the
                           // same (triple, asserting source) is the same rowKey on every
                           // device, and two sources asserting one triple are two rows
  rowClass: "fact",        // closed set: fact | source | utterance | session | rule |
                           //             retraction | edge-group | bookkeeping
  term: "tariff",          // the canonical index term (normFactTerm of the subject) for fact
                           // rows; "" for row classes with no term read path
  json: "…",               // the serialized record, ≤ 4 KB (spec §4); the projection enforces it
  expiresAt: 1739145600,   // OPTIONAL epoch seconds; stamped by the adapter from the consumer's
                           // TTL policy, absent when no policy is set
}
```

- **`rowClass` is the structural bookkeeping gate** (spec §3.7). Internal rows — research-queue
  entries, the researched-terms set, and anything else that must never compose into a
  visitor-facing answer — are written with `rowClass: "bookkeeping"`. Read paths exclude them by
  field, never by string matching on content, and an adapter can partition or filter them at the
  storage level. One correction, from the spec's own author: spec §3.7's example ("the
  `tmct:needs` queue markers") named the wrong thing. The live `latency tmct:needs result` row
  is a genuine fact-class row — the article extractor picked a verb out of a relative clause
  and minted a predicate the phrase table lacked. It is teach-path data, so the bookkeeping
  gate cannot and does not retire it; §8.4's acceptance passes while that defect lives. The
  5.0.46 phrase fix corrected the rendering (the local-name fall-through), the extractor still
  mints the row, and its real fix is the extraction-quality confidence-marker item recorded in
  `NEXT.md`.
- **Mutation is additive, and the mechanism is derivation.** Today's payload mutates BOTH ends
  of a supersession: the new record carries `mgx:supersedes: [oldId]` and the old record gains
  `mgx:supersededBy` (core.mjs's `SUPERSEDES_PROP`/`SUPERSEDED_BY_PROP` pair). Projected
  naively, that rewrites the old row — the LWW hazard. So the projection stores only the
  FORWARD pointer: a superseding record's row carries its `supersedes` list, the superseded
  row's stored `json` never changes, and `rowsToPayload` derives every `supersededBy` at
  assembly from the union of `supersedes` pointers (the same move `fact_object_supersessions`
  makes queryable in sqlite). A retraction projects as its own `retraction`-class row. Two
  turns superseding concurrently then both land — distinct new rows, an untouched old row —
  and assembly applies both; last-write-wins can only lose a write when two rows share a key,
  and additive rows never do. `payloadToRows` enforces this shape (a projected old row whose
  only change is `supersededBy` diffs as UNCHANGED); M1's integration test races two handles
  to prove it.
- **The 4 KB cap fails before the network, and the failure posture is a knob.** `payloadToRows`
  rejects an oversized row with a `BackendRejected` carrying the offending fact's provenance,
  at projection time — before any `putRows`, local or HTTP. The service's own 400 (§3.8) is
  the backstop, not the discovery point. The default posture is throw: a single fact that big
  is an extraction pathology and the turn fails loudly. A backend constructed with
  `onOversizedRow: "drop"` (§3.10; every shipped constructor takes it, default `"throw"`)
  changes the posture per fact: the projection logs the dropped row's provenance, skips it,
  and the turn completes with everything else persisted — for a consumer whose turn is itself
  the last resort and must never return nothing because one fact was pathological. M0 pins
  both modes.
- **The projection lives in one module.** `src/adapters/memory/rows.mjs` owns
  `payloadToRows(payload)` and `rowsToPayload(rows)`, factored from what `persistSqlitePayload`
  does inline today, plus `diffRows(before, after)` returning `{ puts, deletes }`. Round-trip
  identity (`rowsToPayload(payloadToRows(p))` equals `p` up to key order) is a unit-tested
  invariant. Assembly order is deterministic without erasing meaning: the payload carries two
  DELIBERATE orders the sqlite store already preserves — `individuals` keep a stable `ord`,
  and an edge group's `examples` order is recency (an updated edge moves to the end) — so each
  row's `json` carries its `ord` (and an edge-group row its examples in order), and
  `rowsToPayload` reconstructs by `(ord, rowKey)`, never by raw `rowKey` sort alone. That is
  still a pure function of the row set (the crdt.md rule holds: arrival order never reaches a
  resolver, because order rides row content), while Fact individuals additionally get the
  `sortFactIndividualsById` treatment the p2p path already applies.
- **Derived state is recomputed, never stored.** The sqlite store's two derived tables
  (`fact_heads`, `fact_object_supersessions`) and the payload's derived scalars (`classes`,
  `vocabulary` beyond the seed's own entries, `proseIndex`, `generated_at`) are NOT projected
  as rows: `rowsToPayload` recomputes them at assembly (the `backfillFactHeads`/
  `buildProseIndex` code paths exist and are the reference). This keeps every stored row small
  — a 61k-fact store's `vocabulary` or `proseIndex` serialized whole would dwarf the 4 KB cap —
  and it is the same recompute-on-load rule §3.6 already applies to derived rows. What DOES
  store beyond individuals and edge groups: the two small true scalars (`memory`, `prefixes`)
  as meta values.

### 3.3 The index key, settled now

For fact rows, `term` is the normalized subject term. The recommended adapter key layout, which
both the row service's table (§3.8) and bedrock-meter's single-table Store map onto directly:

- partition key: the session key;
- sort key: `${rowClass}#${term}#${rowKey}` (empty term collapses cleanly).

That makes `query(skPrefix: "fact#tariff#")` a native term read (spec §3.2) with no table
migration when core starts issuing term reads. Object-side lookups ride the assembled payload;
an adapter that wants them indexed adds its own duplicate row or GSI, documented as an adapter
concern, since no core read path needs it.

### 3.4 Dispatch: Backend D beside B and C

`openMemoryBackend(repoRoot, backendChoice)` accepts an object as `backendChoice`: when
`isRowBackend(backendChoice)`, it returns `{ dir: wrapRowBackend(backendChoice), close }`
untouched by config resolution. `chat-session.mjs` and `init.mjs` pass an object
`memoryBackend` straight through; string choices behave exactly as today. `dispatchTool`'s
`memoryBackend` context param already forwards whatever handle the session holds, so the tool
layer needs no change.

`wrapRowBackend` produces the internal handle `{ backend: "row", impl, cachedPayload,
basePayload }`. `loadMemory` on it assembles `basePayload ⊕ rowsToPayload(await
impl.readRows())` and caches; `persistMemory` diffs the mutated payload against the cache and
issues `putRows`/`deleteRows` for the delta only, patching the cache in lockstep exactly as the
sqlite path does. `basePayload` is a read-only overlay for seed graphs — the turn Lambda's and the
news worker's bundled seeds (§3.18, §3.22) and a consumer's own overlay corpus (§3.11,
bedrock-meter's ~1,400-fact case): seed rows are never written back, and the diff runs
against base plus rows so only session-written deltas persist.

### 3.5 Statelessness and the latency budget, stated honestly

tmct's resolution layer is synchronous over one assembled payload: `readFactRows`, the folds,
contradiction checks, and syllogise all read the whole session store, and that store is the
turn's working set. So the v1 read path is: one `readRows()` per cold open, assembled once,
cached for the process's lifetime, with row-level writes thereafter.

Against the spec's budget (§4): at the stated demo envelope (≤ ~40 facts/session, ≤ 4 KB rows)
a cold open is one paginated query returning the session's rows, in-region ~5–15 ms, and a
warm turn's backend time is its writes alone. That sits inside p50 ≤ 25 ms with margin and
replaces two whole-archive S3 round trips plus a whole-store write-back. With no per-session
row limit (§3.8's cap is global), a session's size is bounded by its own mutation rate times
the TTL, so a real news session stays tens of kilobytes and only a session that spent days
flooding itself can make its own cold open slow — self-harm inside its own isolation, while
the global cap bounds the table. The stricter reading of "O(rows actually read
this turn)" — term-indexed partial reads feeding a lazy resolver — is a real engine change
(async reads inside currently-synchronous folds) and is the named horizon (§30), which is why
the index key is settled now: when core starts calling `readRowsByTerm`, no adapter or table
changes.

### 3.6 Concurrency, TTL, determinism

- **Concurrency** (spec §4): fact rows are content-addressed, so two simultaneous turns on one
  session key land distinct rows, or the same row with identical content. Supersession and the
  research queue are additive rows (§3.1, §3.2), so concurrent writers append rather than
  clobber. What remains last-write-wins per rowKey: derived rows (class counts, materialised
  heads), recomputable from fact rows on the next load, and the two scalar meta values — a
  watermark regression costs one redundant re-syllogise and a nodeId is effectively
  write-once. An interleaving costs staleness, never corruption. No turn-serialization
  guarantee is required from the consumer.
- **TTL** (spec §4): a consumer policy the adapter enforces. The adapter stamps `expiresAt`;
  expired rows are simply absent on read. tmct core neither reads nor writes clocks in the
  contract.
- **Determinism**: rows round-trip byte-stable, read order never carries meaning, and the
  assembled payload is a pure function of the row set (§3.2's sort). The conformance suite
  feeds one row set in two different orders and demands identical payloads.

### 3.7 news.html: the deployed demo is a thin client

The deployed news page IS the AWS architecture, all the way down (operator directive, tenth
revision): the page carries **no in-page graph**. No seed fetch, no engine bundle, no payload
assembly, no in-page ingest — the engine lives in the Lambdas, the feed is materialized
server-side (§3.22), and the page is render-and-controls over five service calls:

```
news.html (render + controls only; no engine, no seed, no graph)
  ├─ GET  /api/feed                       the materialized feed document (§3.22)
  ├─ GET  /api/meta/feedVersion           the refresh loop's cheap poll
  ├─ POST /api/sessions/<uuid>/poll|enrich|ingest   async triggers → news worker
  ├─ POST /api/sessions/<uuid>/turn       the chat area (§3.12)
  └─ DELETE /api/sessions/<uuid>/rows {all:true}    stop & forget
       └─ CloudFront behavior /api/* on the existing distribution
            └─ row service / turn service / news worker Lambdas
                 └─ DynamoDB session table + corpus bands
```

- **The page mints the session, at consent.** Unchanged: before the start press, zero API
  calls; the press mints a UUIDv4 in page JS, keeps it in localStorage beside the consent
  preference, and the first write creates the session implicitly. What lives locally is that
  pointer, never facts, and the copy says so.
- **The page's whole data surface is the feed document.** Cards, ranked terms, tiles, source
  panel status, request log, cycle status — everything rendered comes from `GET /api/feed`
  (§3.22's contents), refreshed when `feedVersion` moves. Sort and filter run client-side over
  the document's own per-card sort keys; nothing recomputes.
- **Teaches are asynchronous ingest.** The teach panel's textarea and file drop POST the text
  or rows to the ingest trigger (§3.8); the worker runs the same `ingestText`/
  `ingestUploadedFactRows` the page ran in-page before, under the session's rows, and
  re-materializes. The teach status line reads the cycle marker, exactly as poll progress does.
- **The chat area is the turn endpoint's first page consumer** (§3.12): a chat section below
  the teach panel, same session UUID, replies synchronous, taught facts landing as session
  rows and reaching the feed at the next materialization (§3.22 states the flow and its
  staleness).
- **Unreachable service: the page is honestly idle.** It boots — the shell is static — and
  states feed-and-chat-unavailable; controls disable; nothing is computable locally; a reload
  retries against the stored key. The previous design (an in-page engine over the static seed,
  running unpersisted when the service failed) is **considered and replaced**: the operator
  chose the thin client over per-visit offline capability for this page — the offline claim
  lives on the pages whose engines are in-page, and news.html demos the hosted architecture
  instead. With no engine and no seed on the page, there is nothing for a degraded mode to
  compute with, and pretending otherwise would be a simulation.
- **The copy tells the truth, both halves of it.** As before: anonymous session, random key
  kept in this browser, seven-day expiry; stop & forget hides everything immediately (rows AND
  the materialized feed document, §3.22) and physical removal finishes inside the window.
  "Stop & forget" wires to `deleteAll()` and discards the stored UUID; the e2e asserts the
  double reports zero readable rows and no feed document afterwards.
- **Reload restores the session.** One `GET /api/feed` against the stored key and the page
  renders where it left off; the seed-stamp guard moves server-side with the engine (the
  worker stamps the seed version into session meta and expires a mismatched session rather
  than mixing rows across versions).
- **What the page sheds, measured honestly.** The ~7 MB gzipped seed fetch and the multi-MB
  engine bundle both leave this page; the thin bundle is the renderer, the controls, the API
  client, and the version-poll loop. T13 re-measures the page in `reports/PAGE_WEIGHTS.md`
  and publishes the before/after.

The point of this consumer, sharpened again: it proves the whole hosted architecture — row
store, worker, materialization, turn endpoint — end to end on a public page, exactly the stack
a consumer would host, with the browser reduced to what a consumer's own thin client would be.

### 3.8 The row service

A new, tmct-owned service in the site's own stack, storing rows through the library's own
DynamoDB backend (§3.10). bedrock-meter's deployment is separate: same shipped backend, their
own table (§3.11).

**Endpoints.** All same-origin under `/api/`, JSON only. There are no session endpoints: reads
carry the client-minted session key in an `x-tmct-session` header, mutations address it in the
path, and the first write under a fresh key creates the session implicitly.

| method + path | contract call | success | notes |
| --- | --- | --- | --- |
| GET /api/rows | readRows | 200 `{rows:[…]}` | key in `x-tmct-session`; an unknown key reads as an empty session; soft-deleted rows are filtered out before the response, so a deleted row is observably absent; one response — the global cap and the mutation-rate cap bound any one session's realistic size, and the handler 500s loudly rather than truncating if the one-response assumption ever breaks |
| PUT /api/sessions/:uuid/rows | putRows | 204 | body `{puts:[row…]}`; whole batch validated before any apply; first write under a fresh key is the implicit mint; 507 when the global table cap (below) is reached, nothing applied |
| DELETE /api/sessions/:uuid/rows | deleteRows / deleteAll | 204 | **soft delete, never physical**: body `{rowKeys:[…]}` marks the named rows deleted (an UpdateItem stamping `deletedAt` — §3.10's soft-delete mode) for diff-driven removal (a retraction or forget dropping rows, derived-row invalidation); body `{all: true}` marks every session row and meta entry. Nothing is removed from the table, the global counter never decrements, and TTL alone reclaims the items (§29.4) |
| GET /api/meta/:key | readMeta | 200 `{value}` / 404 | key in `x-tmct-session`; client maps 404 to null; a soft-deleted meta entry reads as absent |
| PUT /api/sessions/:uuid/meta/:key | putMeta | 204 | body `{value}` |
| GET /api/corpus/:band/rows?term=X&fuzzy=0\|1 | `queryBandTerm` (§3.14) | 200 `{rows:[…]}` | lands with T6. Read-only, no session key, band name validated against the configured band list (404 otherwise); one sort-key prefix Query per requested term, `fuzzy=1` adding the term's deterministic variants (§3.15.2); page-capped; the public corpus read (and the smoke probe's target) |
| POST /api/sessions/:uuid/poll | — (async trigger, §3.21) | 202 `{cycleId}` | lands with T12. Validates, stamps the cycle marker in session meta, async-invokes the news worker, returns immediately; 409 while a cycle is already running for the session; 429 over the cycle rate; body may carry `{sources:[…]}` to narrow the roster |
| POST /api/sessions/:uuid/enrich | — (async trigger, §3.21) | 202 `{cycleId}` | lands with T12. Same shape; body may carry `{fuzzy: 0\|1}` — §3.15.2's per-request rung riding the trigger, read by the worker's corpus source |
| POST /api/sessions/:uuid/ingest | — (async trigger, §3.21) | 202 `{cycleId}` | lands with T12. The teach panel's server-side path: body `{text}` (pasted prose) or `{rows:[…]}` (the upload shapes `ingestUploadedFactRows` already validates), ≤ 256 KB; validates and stamps like poll/enrich, worker mode `ingest` runs the same `ingestText`/`ingestUploadedFactRows` the page ran in-page before, then re-materializes; counted in the cycle rate and the mutation rate |
| GET /api/feed | — (materialized read, §3.22) | 200 `{feed}` / 404 | lands with T12. Key in `x-tmct-session`; returns the session's materialized feed document whole — one item read, no assembly; 404 before the first materialization (the page renders its empty state); a purged session 404s (the document is soft-deleted with the rows) |
| GET /api/meta/feedVersion | readMeta | 200 `{value}` / 404 | the page's refresh poll (§3.22) — one eventually-consistent point read; 404 reads as version 0 |

`readRowsByTerm` stays dormant client-side, and the handler already serves it
(`GET /api/rows?class=fact&term=X` → a sort-key prefix query) because the sk layout (§3.3) makes
it one line; nothing calls it until the term-lazy horizon lands.

**Sessions and auth.** The client mints a UUIDv4; reads send it in `x-tmct-session`, mutations
carry it as the `:uuid` path segment. The handler validates the format strictly wherever the
key appears — the exact v4 shape, version and variant bits included, rejecting anything else
with a 400 — so a chosen low-entropy key is impossible and the keyspace is the full 122 random
bits. A missing or malformed key is a 400 before any storage call, and a mutating request that
carries both the path segment and the header must have them match, or 400. There are no
cookies, no accounts, no tokens, nothing identifying: the session is anonymous by construction,
the key is the only credential, its holder is its owner, and TTL is the garbage collector. The
service serves no CORS headers, so no cross-origin page can call it from a browser; non-browser
callers are bounded by the edge rate limit and the caps (§3.9).

**The logging consequence of keys in paths.** Mutating URLs contain session keys, and URLs land
in access logs. The distribution's access logging stays off — it is off today and nothing
consumes it — and the handler's own logging redacts the `:uuid` path segment before any line is
written, so no log stores a usable key. Header-borne GETs stay out of URL logging by nature. If
distribution logging is ever enabled for some other need, this mitigation is the line item that
must be revisited first.

**Caps, fixed here.** At most 4,096 bytes of `json` per row (400); at most 256 KB request body
(413); at most 120 mutating requests per session per hour (429; an atomic `ADD` counter row
with its own TTL); Lambda reserved concurrency 10 as the blunt account-level bound; and one
**hard global table cap** in place of any per-session row limit — the table as a whole holds at
most `TABLE_ROW_CAP` rows (deployment parameter, default 2,000,000), and a PUT that would
exceed it is refused with a 507 and a named error, nothing applied. The arithmetic behind the
default: 2 M rows × 4 KB worst case is 8 GB — about $2/month stored at the absolute ceiling
(on-demand storage rates), roughly $12 of write units if an attacker filled it once, and the
billing alarm (§3.9) pages far below either. The mechanism is the service's own atomic counter
item (a reserved partition no valid v4 key can collide with, e.g. pk `_meta`, sk `counter`),
incremented by row count inside every write path. **The counter never decrements on a delete**:
deletes are soft (the endpoint table above), a marked row still occupies the table, and
counting it toward the cap is the cost-protection point — a session that fills and deletes in
a loop reclaims nothing and just reaches the 507 sooner. The only thing that trues the counter
down is the reconcile below, after TTL has physically reaped rows. DescribeTable's `ItemCount`
is explicitly rejected as the mechanism: it refreshes roughly every six hours, and a cap
enforced on six-hour-old data is not a cap. The counter is one hot item; at reserved
concurrency 10 and the edge rate limit, its write rate is bounded far below DynamoDB's
per-item throughput, noted and fine at this scale. Every row, meta value, and counter row
carries `expiresAt` = its own write time + the configured TTL (`TTL_DAYS`, default 7 — §3.10's
`ttlSeconds` at the backend seam), enforced by DynamoDB-native TTL — implicit sessions have no
mint moment, so expiry is per row, a soft-deleted row keeps the `expiresAt` it was written
with, and a session is physically gone when its last row is. Physical removal is TTL's job
alone. TTL reaping happens outside the service's write paths, so the counter drifts upward
relative to the real row count; the reconciliation is a scheduled daily reconcile run (an
EventBridge rule invoking the same Lambda in a reconcile mode) that counts the table with a
paginated `Scan` (`Select: COUNT`) — a physical count, so tombstoned rows rightly stay in it
until TTL takes them — and rewrites the counter. Cost: pennies at expected occupancy, ≈ $0.30
per run if the table ever sits at the full 8 GB cap. Between reconciles the drift direction is
toward over-refusal — the safe direction: the service refuses writes it could have taken,
never accepts writes past the cap. The threats these caps answer, and the ones they don't, are
enumerated in §3.9.

**Error semantics, pinned for the client and the kit.** The two classes are §3.1's published
taxonomy, exported from `./memory-backends`. 400/413 → `BackendRejected` (the turn errors; the
session stays networked; a 400 on the session key is a client bug, not a retry case); 429,
507, 5xx, and network failure → `BackendUnavailable` (the turn reports it and the visit
continues without persistence per §3.7 — a full table reads to the visitor exactly like an
unreachable service, which is what it is). A consumer distinguishes the two by class or by
`code`, never by message text. 4xx and 507 refusals apply nothing; a 5xx mid-batch may leave
rows applied, which is the contract's own half-landed-batch stance (§3.1).

**The handler is in-repo, backend-agnostic, and contains no storage code.** `server/row-service/`
(new, top-level, excluded from the npm `files` array — the published library ships no Lambda)
holds `handler.mjs`: parse, validate, enforce caps, then call a §3.1 row backend. In AWS that
backend is the library's own `createDynamoRowBackend` (§3.10) with `softDelete: true`, imported
from `src/adapters/memory/row-backend-dynamo.mjs` — the service is the first consumer of the
shipped backend, so the deployed demo exercises the exact code a library consumer installs. The
SDK is marked external in the bundle because the Lambda Node runtime ships it. Locally the SAME
handler mounts on `node:http` over the M2 in-memory reference backend —
`server/row-service/local.mjs` — and that is the test double: real routing, real validation,
real error semantics, fake storage. The reference backend removes rows physically where the
deployed backend tombstones them; the contract's delete semantics are observable (§3.1), so the
double and the deployment behave identically to every caller and every test. The service is
itself a consumer of the seam it fronts, twice over.

**Deploy path.** The service is new constructs inside the existing `infra/` stack: a
`dynamodb.Table` (pk `sessionKey`, sk `sk`, TTL attribute `expiresAt`, on-demand billing), a
`lambda.Function` from the esbuild bundle (`npm run build:row-service` emits
`server/row-service/dist/handler.js`), a function URL with OAC, and
`distribution.addBehavior("/api/*", …)` on the distribution `website-stack.ts` already owns —
same origin as the site, no new DNS, no CORS. CI's existing `deploy:website` job deploys it (it
already runs `cdk deploy` on the same stack; the job gains the `build:row-service` step).
`scripts/post-deploy-smoke.mjs` gains the live probe: PUT one row under a fresh page-style
UUID, GET it back, DELETE with `{all: true}`, against the deployed origin — measurement after
release, never a test tier.

**Spend, approved.** The operator signed off the full posture on 2026-08-10: the WAF
rate rules (~$8/month), the CloudWatch billing and table alarms (~$1/month), and the
on-demand table and Lambda (pennies at demo traffic) — roughly $9–10/month standing plus
usage. The infra phases (M7, T6) carry no separate spend gate.

### 3.9 The abuse surface, enumerated

An anonymous write API on a public page, addressed by client-minted keys. The structural
defense is isolation: a session's pk is a full-entropy UUIDv4 its holder minted, the strict
format check (§3.8) keeps the keyspace at 122 random bits, and no endpoint reads or returns
any key but the caller's own — so one session can never read or write another's rows, and
every attack below is bounded to the attacker's own sessions and the account's bill.

| risk | mitigation |
| --- | --- |
| write flooding (implicit creation makes every fresh-UUID write a mint) | a WAF rate-based rule on the distribution scoped to `/api/*` — per-IP, 300 requests per 5 minutes; the one new edge construct, roughly $8/month; writes also queue behind Lambda reserved concurrency 10 |
| storage flooding | the hard global cap (§3.8) bounds the whole table at `TABLE_ROW_CAP` rows — 8 GB absolute worst case at the default — enforced by the service's own atomic counter, with the daily reconcile correcting TTL drift toward over-refusal. The accepted consequence, stated plainly: with no per-session bound, one determined session (or many) can consume the entire global budget and deny persistence to every visitor until the TTL reclaims rows — the page then degrades to §3.7's unpersisted mode for everyone. The per-IP edge rate limit and the per-session mutation rate bound how fast the budget can be eaten, the 7-day TTL bounds how long the denial lasts (accepted: it's a demo, waiting out the window is fine), and the billing alarm plus kill switch below remain the operational backstops |
| fill-and-delete write churn | dead by construction: deletes are soft (§3.8), so a delete reclaims no cap space and the counter never decrements. The maximum an attacker can spend is one table fill (~$12 of write units at the 2 M cap), plus rate-limited delete-marks (each one UpdateItem write unit, bounded by the per-IP and per-session mutation limits), plus the counter pre-check read on each refused write (~$0.25 per million). After the cap, their PUTs 507 and their DELETEs recover nothing — there is no loop to run. Recovery is TTL within `TTL_DAYS` |
| cost attack (Lambda invocations, table writes) | reserved concurrency 10 caps compute; the on-demand table plus a CloudWatch estimated-charges alarm (threshold set in the stack, $20/month to start); the kill switch is removing the `/api/*` behavior from the distribution — one CDK deploy or a console action — after which the page degrades to §3.7's unpersisted mode and keeps working |
| cross-site request forgery | effectively gone by construction: there is no ambient credential — no cookie rides a cross-site request, and a cross-origin page cannot know the victim's UUID. The no-CORS posture and the `application/json` content-type check stay as hygiene |
| session-key theft | the key is page-readable by design (localStorage, sent in headers and mutating paths), so exfiltrating it requires running script in the page — the stored-XSS row below — and the prize is one anonymous, 7-day, self-owned session; no cross-session pivot exists. The key never appears in a response body or any cross-origin channel; it does appear in the page's own same-origin mutating URLs, which is why access logging stays off and the handler redacts the path segment (§3.8) |
| session fixation / chosen keys | the strict UUIDv4 format check rejects any attacker-shaped or low-entropy key, and the page only ever uses a key it minted itself or one from its own localStorage — never from the URL or another origin |
| stored XSS through fact text (a taught fact carrying markup, read back into the DOM) | render-side escaping is already the page's rule — answer text lands via text nodes, never markup injection — and M8's e2e pins it: teach a fact containing a script tag through the real flow, reload from the service double, assert zero script execution and the literal text on screen. Isolation (above) bounds a miss to self-XSS even before the pin |
| enumeration / cross-session reads | structural: 122 bits of key entropy, the format check as the floor, no endpoint that lists or returns keys, and an unknown key reading as an empty session (a probe learns nothing) |
| corpus read flooding (the one sessionless route) | the corpus read (§3.8) serves public reference data, so the exposure is cost, not confidentiality: the same per-IP WAF rule covers `/api/*` whole, the route is one page-capped Query per term (fuzzy adds a capped variant count, §3.15.2), reserved concurrency queues the rest, and the read is `ConsistentRead: false` — eventually consistent is fine for a never-mutated band and halves the read cost |
| cycle-trigger flooding (a poll trigger buys a whole worker run) | one running cycle per session (409), the per-session cycle rate (default 12/hour), triggers counted in the mutation rate, the same per-IP WAF rule, and the worker's own reserved concurrency (default 5) as the compute ceiling — a flood of triggers queues and 409s, it cannot fan out workers (§3.21) |
| worker egress abuse (the one Lambda with outbound HTTP) | the allow-list is the source roster and KB hosts, compiled into the worker — no caller-supplied URL is ever fetched except through `/news add`'s existing preflight, which keeps its https-only and validation rules; the shared per-source courtesy throttle in `_meta` bounds the aggregate rate at the sources regardless of worker count, and the per-source breakers stop a failing source being hammered (§3.21) |
| version-poll flooding (the page's refresh loop) | `GET /api/meta/feedVersion` is one eventually-consistent point read (~$0.125/million); the page's own backoff stretches the interval while idle, and the WAF rule bounds a hostile poller like any other `/api/*` caller |
| feed-read flooding | `GET /api/feed` is one item read of a ≤ 350 KB document (§3.22) — pennies per million at on-demand rates; the page only refetches on a version change, and the WAF rule bounds everyone else |
| ingest-trigger flooding (pasted prose buys worker extraction compute) | the 256 KB body cap, the shared per-session cycle rate (an ingest is a cycle), the mutation-rate counter, one running cycle per session (409), and the worker's reserved concurrency — the same box the poll trigger lives in; a flood queues and 409s, it cannot fan out workers |

### 3.10 The DynamoDB backend ships in the library

`src/adapters/memory/row-backend-dynamo.mjs` — first-class library code, not service glue:

```js
createDynamoRowBackend({
  client,          // an @aws-sdk/lib-dynamodb DynamoDBDocumentClient the consumer constructs
                   // and credentials; tmct bundles no credentials and builds no client
  tableName,
  sessionKey,      // the pk; opaque, consumer-chosen (the row service passes the caller's validated key)
  ttlSeconds = null,   // null → no expiresAt stamped; the row service passes its configured
                       // TTL through this knob (TTL_DAYS, default 7 — §3.8)
  softDelete = false,  // true → deletes tombstone instead of removing; the row service sets it
                       // (§3.8); either mode satisfies the contract's observable semantics (§3.1)
  consistentRead = true,   // strongly consistent Query on readRows/readRowsByTerm; the default,
                           // because cross-container read-after-write is what a session store is
                           // for. false trades that for half the read cost (a consistent read is
                           // 2x RCU on the one cold-open Query) — a read-heavy consumer's call
  writeConcurrency = Infinity,  // putRows sends its PutCommands concurrently, bounded by this;
                                // batches are 1–5 rows, so the default is the whole batch
  onOversizedRow = "throw",     // or "drop" — the §3.2 per-fact posture; drop logs the row's
                                // provenance and persists the rest of the batch
  basePayload = null,           // a read-only overlay assembled beneath the session's rows
                                // (§3.4's mechanics): seed graphs, a consumer's rich-corpus
                                // overlay. NEVER written back — the diff runs against
                                // base ⊕ rows by construction, and the M1 seeded-base test
                                // is the guarantee's pin
  maxRows = null,               // per-session bounds at the library seam, enforced by the
  maxBytes = null,              // backend before any network call: a putRows that would
                                // exceed either rejects with BackendRejected. null = unbounded
                                // (the row service uses its own global cap instead, §3.8);
                                // a consumer embedding tmct on a public surface sets these so
                                // one unbounded visitor partition cannot degrade every play
  attributeNames = { pk: "pk", sk: "sk", expiresAt: "expiresAt", deletedAt: "deletedAt" },
                                // remaps the four STORAGE attribute names only, to fit an
                                // existing table; the field names INSIDE the record —
                                // rowClass, term, json — are fixed contract vocabulary and
                                // do not remap
})
```

- **Ops mapping.** `readRows` → one paginated Query on the pk; `readRowsByTerm` → Query with
  `begins_with(sk, "fact#<term>#")`; both set `ConsistentRead` from the `consistentRead`
  option, true by default — a session written on one Lambda container and read seconds later
  on another must see its own writes, and an eventually consistent Query fails that
  intermittently, the worst kind of red. `putRows` → concurrent PutCommands bounded by
  `writeConcurrency` (per-row atomicity is the contract; batch write APIs' partial-failure
  bookkeeping buys nothing here). Concurrency is the budget: a serial loop over a 5-fact
  research fan-out is five sequential round trips, ~30 ms in-region against the spec's
  p50 ≤ 25 ms; sent together it costs one round-trip time. Meta → Get/Put under
  `sk = "meta#<key>"`. Deletes depend on the mode. Default: `deleteRows` → looped
  DeleteCommand; `deleteAll` → Query then looped Delete. With `softDelete: true`: `deleteRows`
  → looped UpdateCommand stamping `deletedAt` (the row keeps its `expiresAt`, so TTL removes it
  on the original schedule); `deleteAll` → Query then looped Update over rows and meta; and
  both Query paths add a filter so a `deletedAt`-stamped item never reaches a read — the §3.1
  observable semantics, satisfied by tombstone. Re-marking an already-marked row is an
  idempotent Update.
- **Fresh backend per invocation.** The consumer guidance, stated once here and repeated in the
  M10 handoff: construct the backend (and its handle) per Lambda invocation, never cached
  across invocations on a warm container. The handle caches the assembled payload for its own
  lifetime (§3.4); per-session binding already stops a handle serving another session, but a
  handle reused across turns of the SAME session on a warm container serves stale reads
  whenever another container wrote in between. A fresh construction per invocation costs one
  consistent Query and buys cross-container correctness by construction.
- **Lazy SDK, exactly.** The module imports nothing from AWS at load. The first storage call
  runs `await import("@aws-sdk/lib-dynamodb")` once and caches the command constructors.
  `package.json` declares `"peerDependencies": { "@aws-sdk/lib-dynamodb": ">=3" }` with
  `"peerDependenciesMeta": { "@aws-sdk/lib-dynamodb": { "optional": true } }` — installing tmct
  pulls no AWS code, importing the module performs no IO, and a consumer without the SDK fails
  at first use with a named error saying what to install. An in-tree test pins
  module-load-without-SDK.
- **Published surface.** A `./memory-backends` export subpath (entry
  `src/adapters/memory/backends-exports.mjs` re-exporting `createRowMemoryBackend`,
  `createDynamoRowBackend`, `isRowBackend`, and the §3.1 error classes `BackendRejected` and
  `BackendUnavailable`), following the `./envelope`/`./news`/`./memory-backend-conformance`
  precedents; pack manifest regenerated the standard way.
- **Conformance in-tree, no network.** The full kit runs against `createDynamoRowBackend` over
  an injected fake document client (`test/adapters/fake-dynamo-document-client.mjs`): a
  deliberate mirror of the backend's own call shapes — Query/Put/Delete/Get over a Map keyed
  `pk|sk`, `begins_with` on the sort key — not a DynamoDB emulator, and it validates the key
  expressions the backend is specified to emit. No dynamodb-local, and nothing in CI touches
  AWS. Setting `TMCT_DYNAMO_LIVE_TABLE` (never set in CI) points the same conformance file at a
  real table for a hand-run pass; the deployed path's standing live check is the post-deploy
  smoke probe (§3.8).

### 3.11 bedrock-meter's integration: configuration, not code

There is no bedrock-meter adapter. Their Lambda imports the shipped backend and configures it:

```js
import { createDynamoRowBackend } from "@polycode-projects/the-mechanical-code-talker/memory-backends";
const memoryBackend = createDynamoRowBackend({
  client, tableName, sessionKey, ttlSeconds: 7 * 86_400,
});
const session = createSession({ memoryBackend /* … */ });
```

They own the table (or a keyspace of an existing one — `attributeNames` fits their single-table
layout, and it remaps exactly four storage attribute names: `pk`, `sk`, `expiresAt`,
`deletedAt`; the record's own field names — `rowClass`, `term`, `json` — are fixed contract
vocabulary that no option renames). Their ~1,400-fact read-only corpus overlay is the
`basePayload` option — assembled beneath the session's rows, never written back, no
session-row writes spent seeding it. They own the IAM on their Lambda role and the TTL value. tmct owns every line of storage code
and its tests; the first draft's hundred-line Store-seam adaptation is superseded, because
nothing needs adapting when the backend ships finished. Their spec's §7 offer — they build the
adapter and its conformance tests — is answered differently: the backend and its suite run ship
in tmct, and their integration surface is the constructor above. What stays theirs (spec §7/§8):
the table and IAM, their live e2e (cross-container read-back), the S3-path retirement, and
their §4 latency numbers, measured on their own deployment. The published suite remains
available to any consumer who chooses a custom store anyway.

Two lines of consumer guidance, theirs by request. Construct the backend fresh per Lambda
invocation (§3.10) — the handle's payload cache lives as long as the handle, and a warm
container reusing one across turns of the same session reads stale whenever another container
wrote in between; the defaults (consistent reads, fresh construction) make their pinned
cross-container read-back hold by construction. And a fallback turn that must never fail whole
catches `BackendUnavailable` by class or `code` (§3.1) and continues without persistence, with
`onOversizedRow: "drop"` covering the one-pathological-fact case the same way.

### 3.12 The turn endpoint

One route joins the row service's table (§3.8):

| method + path | success | notes |
| --- | --- | --- |
| POST /api/sessions/:uuid/turn | 200 `{reply, factsTouched, narration}` | body `{text, retrieval?: {fuzzy}}`, ≤ 4 KB (413 above) — the optional `retrieval.fuzzy` is §3.15.2's per-request override, most specific rung of the mode ladder; the key rides the path because a turn can write, same strict v4 rule, implicit session creation on the first learning turn; 429 over the turn rate; 507 surfaces as the `BackendUnavailable` posture — the turn still answers, learned facts are not persisted, and the reply says so |

The handler's sequence, `server/turn-service/handler.mjs`:

1. validate (key shape, body size, content type) — §3.8's rules verbatim;
2. read the breaker item and the cap counter (one `_meta` read each, §3.16);
3. construct a fresh `createDynamoRowBackend` for the session (fresh per invocation, §3.10)
   and `loadMemory` — one Query;
4. retrieval (§3.15): assemble the corpus subgraph, unless the breaker says skip;
5. assemble seed ⊕ subgraph ⊕ session and `runTurn` — the synchronous engine, byte-identical
   to the library's;
6. `persistMemory` — the turn's learned rows land as session rows through the same backend
   (delta puts, soft-delete rules, cap enforcement, all §3.8);
7. respond. `narration` is the same trace `--narrate` emits; `factsTouched` keeps its
   published shape (§2).

Retrieved corpus facts are a per-turn read-only overlay. They are never written to the session
partition; only what the turn *learns* persists. A corpus fact cited in an answer cites its
band provenance.

**Turn rate and spend.** Turns cost real CPU, so the limits sit below the row-write limits:
30 turns per session per hour (an atomic counter row beside the mutation counter, own TTL),
the same per-IP WAF rule at the edge (§3.9), and the turn Lambda's own reserved concurrency
(deployment parameter, default 5) separate from the row service's 10. Lambda timeout 10 s; the
retrieval wall budget (§3.15.1) keeps the turn's storage phase far inside it.

**Its first page consumer: the news chat** (tenth revision). news.html gains a chat area —
§3.7's page has no in-page engine, so its chat is this endpoint: same session UUID as the feed,
the reply synchronous (`200 {reply, factsTouched, narration}`), and the turn's learned rows
landing in the same partition the feed materializes from. When a turn's `factsTouched` is
non-empty, the handler async-invokes the news worker in materialize mode before responding
(§3.22) — the reply is immediate, the feed catches up seconds later, and the chat rendering
says nothing about the feed (the feed's own refresh loop shows the change when it lands). The
turn-rate limits above apply to the page's chat exactly as to any consumer; chat.html and
ledger.html still never call this endpoint — their engines are in-page (§3.19).

**What the turn surface inherits without change.** The session model, key validation, implicit
creation, path-scoped mutation, caps, soft deletes, TTL, global cap and counter, error
taxonomy, abuse table, kill switch, deploy path, and local-double testing pattern are all
§3.8–§3.10 and §4, unchanged. The turn endpoint adds exactly two rows to that abuse surface:
turn-rate flooding (the 30/hour counter and the turn Lambda's own reserved concurrency answer
it) and retrieval read amplification (the §3.15.1 budgets and per-session metering answer it).

### 3.13 The corpus supplement: shared read-only partitions

The corpora the Lambda does not bundle live in the same table under band partitions — both
the ones too large ever to bundle and the two §3.18 deliberately migrates out of the seed.
Three bands are first-class deliverables of this plan — their build pipelines ship in-tree
(T0) and any credentialed operator loads or clears them with the CLI verb (§3.14):

- **`corpus:wikidata-slice`** — CC0, no attribution burden.
- **`corpus:wordnet-complete`** — Open English WordNet, CC-BY-4.0, attribution in the band's
  NOTICE. A superset of the bundled WordNet-xl band, which §3.18 moves out of the turn
  Lambda's seed — this band is how its content comes back.
- **`corpus:conceptnet-full`** — CC BY-SA 4.0, share-alike. A superset of the capped
  ConceptNet band §3.18 likewise moves out. Its pipeline emits a NOTICE alongside the jsonl
  (the `commonsenseqa-sample.NOTICE` precedent), the loader writes the licence into the band
  manifest, and citations of its facts carry the attribution.

**The demo's loaded set is all three.** The seed decision (§3.18) makes the two moved bands
required for the demo's base competence, not optional extras: the CI post-deploy job loads
wikidata-slice, wordnet-complete, and conceptnet-full. That puts the attribution duty on
tmct's own deployment: the repo's existing machinery is `corpus/LICENSES.json` (the
machine-readable rollup, one entry per corpus family, each naming its human-readable
`LICENSE-NOTICE` file, guarded by `test/estate/corpus-licences.test.mjs`) — the band
pipelines' emitted NOTICEs join that rollup as new entries, and the deployed site serves the
attribution the same way it serves the shipped corpora's (WordNet CC-BY attribution;
ConceptNet CC BY-SA with share-alike stated). An operator loading bands into their own
deployment inherits the same duty, which the manifest's licence field makes visible.

A fourth, the wikipedia-derived band (`corpus:simplewiki-derived` — extracted article facts
at a scale the reference pack doesn't attempt), is future work with its own design doc:
`PLAN_WIKIPEDIA_BAND.md`, authored as a stub-scoped design reference by T10. This plan ships
the partition naming and nothing else for it.

The partition layout, shared by every band:

- pk `corpus:<band>`; sk `fact#<term>#<rowKey>`, the same
  layout as session fact rows (§3.3), so a term read is one `begins_with` Query;
- rows are §3.2 wire rows: content-addressed `rowKey`, `rowClass: "fact"`, canonical
  `term`, `json` ≤ 4 KB, **no `expiresAt`** — bands never expire;
- one manifest row per band: sk `manifest`, json `{band, version, rowCount, loadedAt,
  sourceDigest}` — the loader's idempotency check and the citation's version;
- outside the global session counter (§3.8): the cap protects against anonymous writes, and
  bands are written only by the credentialed loader;
- unwritable through the public API by construction: every session route validates its key as
  a UUIDv4, and `corpus:<band>` is not one, so no anonymous caller can write a band. Reads get
  exactly one deliberate route — the read-only, term-scoped corpus read (§3.8's table, landing
  with T6) that serves the pages' corpus enrichment (§3.15.2). Band data is public reference
  content; the route exposes nothing a bundled corpus doesn't, and its abuse surface is a
  §3.9 row.

Band fact provenance is stamped at load time from the band's source, in the existing corpus
grammar (`corpus:<name>`), with the manifest version available to citations. No new provenance
grammar.

### 3.14 The loader: a CLI verb pair

`tmct corpus load <band> [--table <name>] [--source <path>] [--dry-run]` and
`tmct corpus clear <band> [--table <name>]`, following `cli-verbs.mjs`'s pattern (one
`CLI_VERBS` entry, `bin/tmct.mjs` dispatch, help text in the two-column layout).

- **Load**: stream the band source (a jsonl of wire-row-shaped facts, produced by the T0
  build pipelines for the three first-class bands; any other band supplies its own jsonl in
  the same shape), write with
  `BatchWriteItem` in 25s, bounded concurrency, backoff on throttle. Content-addressed keys
  make re-runs idempotent overwrites. The manifest row is written last; a run that dies
  mid-load leaves individually valid rows and a stale manifest, and the re-run completes it.
- **No-op on unchanged**: load computes the source digest first, reads the manifest, and exits
  0 with "unchanged" when digests match — that is what makes the CI post-deploy job cheap to
  run every pipeline.
- **Clear**: a paginated Scan of the band partition and physical `DeleteItem`s, manifest last.
  Physical, unlike the service's soft deletes, because the loader is an operator tool holding
  AWS credentials, on the other side of the trust line from the public API.
- Credentials are ambient (a profile locally, OIDC in CI). The verb never embeds any.

Module paths: `src/adapters/memory/corpus-bands.mjs` (band naming, manifest shape, the term
Query helper `queryBandTerm(client, tableName, band, term)`), `src/services/corpus-loader.mjs`
(load/clear/status over an injected document client — lazy SDK, same discipline as §3.10).
Both ship in the library: a consumer hosting this surface loads their own bands with the same
verb.

### 3.15 Retrieve-then-resolve

The fix for §30's term-lazy horizon, without the engine surgery. The horizon assumed
resolution might touch anything, forcing async reads inside the folds. But §1's observation is
load-bearing: the engine's reasoning is already bounded by design. A retrieval phase that
mirrors those bounds, run *before* the engine, feeds the unchanged synchronous folds
everything they can reach.

The sequence, in `src/domain/retrieval-plan.mjs` (pure) and
`src/services/subgraph-retrieval.mjs` (executes the plan over a document client):

1. **Term extraction** (pure): the turn text's content terms, folded through `normFactTerm`
   and the lexicon's lemma/plural folds, plus — when the fuzzy mode is on (§3.15.2; on by
   default) — deterministic fuzzy variants: a fixed edit distance over the lexicon's own
   vocabulary with the real-word collision table as the guard, no scoring, no ranking, capped
   per term. Sorted output.
2. **Hop plan** (pure): for each term, a k-hop relation expansion (k fixed at 2, matching the
   engine's two-hop alias chase; a config constant, not a request option) plus the full
   `rdfs:subClassOf` ancestry chain (the ontology is shallow; ancestry is what the one-hop
   inheritance lanes read, and pulling the whole chain costs a few rows per term).
3. **Execution**: `begins_with(sk, "fact#<term>#")` Queries against each configured band
   partition, breadth-first over the hop plan, terms and pages in sorted order, bounded
   concurrency, until done or a budget trips (§3.15.1).
4. **Assembly**: the retrieved rows join `rowsToPayload`'s input beside the bundled seed and
   the session rows (§3.4's base-overlay mechanics — the subgraph is a second read-only
   overlay; the diff can never emit it as a write).
5. The engine runs. It cannot tell a retrieved fact from a seed fact; provenance carries the
   difference into citations.

Determinism: steps 1–3 are pure functions of (turn text, fuzzy mode, corpus state, fixed
caps). The fuzzy mode is an input like the text — same query, same mode, same corpus gives
the same subgraph; flipping the mode is asking a different retrieval, honestly. Sorted
traversal means a budget cut always lands at the same row for the same inputs. The conformance
of this claim is a unit test feeding the same plan twice and demanding identical subgraphs,
once more with a lowered budget demanding a reproducible prefix, and once per fuzzy mode
demanding each mode's own stable answer.

What this does not cover, honestly: a term that only becomes relevant *mid-resolution*, beyond
k hops from any query term, stays outside the subgraph and reads as an honest miss — exactly
the miss the browser page gives beyond its seed. The engine's own chase depths make this rare
by construction; §29 keeps it as a named sharp edge, and true term-lazy folds remain the
horizon (§30) if measurement ever shows the bounds pinching.

#### 3.15.1 The retrieval budgets

All fixed constants, one frozen exported object (`RETRIEVAL_BUDGETS` in
`subgraph-retrieval.mjs`), changed only by a code change. **The numbers below are starting
hypotheses, not decisions.** T1 ships its measurement harness before anything consumes these
budgets: it replays a committed query set against the fixture band, publishes
subgraph-size/latency/budget-hit tables (and the same tables with fuzzy off — §3.15.2), and
the frozen constants are set from those measurements, recorded in T1's build marker, before
T3's handler ever reads them.

| budget | starting hypothesis | trips into |
| --- | --- | --- |
| fuzzy variants per term | 4 | fewer variants |
| hop depth k | 2 | plan truncation |
| rows per Query page | 200 | pagination |
| total rows | 5,000 | stop, mark bounded |
| total Queries per turn | 40 | stop, mark bounded |
| wall time | 300 ms | stop, mark bounded |
| in-flight Queries | 8 | queueing |

- Exhaustion degrades, never errors: assemble what arrived, set the retrieval-bounded marker
  (§3.17), proceed. A timeout is a smaller subgraph, never a guess.
- Throttle responses get exponential backoff *inside* the wall budget, then degrade. No retry
  storms; a throttled Query also feeds the breaker's failure count (§3.16).
- Retrieval reads are metered per session beside the turn counter, so one chatty session
  cannot monopolize table throughput.
- Every turn's narration carries the retrieval metrics — subgraph size, Queries issued, which
  budget tripped — which is the tuning instrument for k and the caps.

#### 3.15.2 The fuzzy mode: on by default, configurable, per-request

Fuzzy variant expansion ships enabled. Its relevance over a large corpus is unmeasured, which
is exactly why T1's harness runs its whole calibration set twice — fuzzy on and off — and
publishes both tables; the budgets bound the cost either way, and §29.15 records the accepted
worst case (wasted rows inside the budget, never a wrong answer).

The mode resolves the same way every tmct option does, most specific first:

1. **per request** — the turn endpoint's body accepts an optional `retrieval: {fuzzy: boolean}`;
   the corpus read route carries it as `?fuzzy=0|1` (§3.8);
2. **environment** — `TMCT_RETRIEVAL_FUZZY=0|1`;
3. **config** — `tmct.toml`'s `[retrieval] fuzzy = true|false`;
4. **default** — on.

**Where news.html meets it.** The page's corpus contact is the enrichment path, which runs
server-side in §3.21's worker (the page's chat also reaches the corpus through the turn
endpoint's own retrieval, §3.12 — that path follows the turn body's `retrieval.fuzzy` rung). The
`dynamo-corpus` KB source joins the enrichment roster (registered through the same source
registry the other KB sources use) — in the worker it queries the band partitions directly
(`queryBandTerm`, no HTTP hop); in the M8→T13 intermediate state, and for the local double,
the same source fetches the T6 corpus read route. The page surfaces a visible fuzzy toggle
beside its other enrichment controls: on, the enrich trigger's body carries `{fuzzy: 1}`
(§3.8), the worker's source queries each fact-ungrounded term's deterministic variants too,
and whatever grounds joins the session's rows with band provenance — the operator's "include
the fuzzy-matched terms in the subgraph", at the page's enrichment grain. The toggle goes
live at T8 (it needs T0's bands and T6's route); local mode never touches the corpus, and the
toggle renders only in AWS mode.

### 3.16 Good citizens and circuit breakers, on both transports

One pattern governs every remote call tmct makes: the turn surface's Dynamo corpus Queries and
the browser's external source fetches alike. The 2 s per-source courtesy throttle the live
research adapters already carry is this pattern's ancestor; this section makes the rest
explicit.

**The pattern.** Budgets declared as fixed constants — a per-source timeout, a per-turn fetch
or Query cap, a wall-clock budget, bounded concurrency. Backoff inside the budget, never past
it. Degradation always honest: a failed or timed-out remote call produces the miss,
pack-fallback, or supplement-absent behaviour the surface already defines, never an error page
and never a guess. And a per-source circuit breaker, so a failing dependency is skipped
instead of hammered, with the answer marked whenever a skip changed what served it. Only
systemic failures count — throttles, 5xx, timeouts. An empty result is an answer, never a
failure.

**The Dynamo-backed breaker (the Lambda surface).** Lambdas share nothing, so the breaker
state is one item in the reserved `_meta` partition (sk `breaker#corpus`):
`{state, failures, windowStart, openedAt}`.

```
closed     turn reads the item (piggybacked beside the cap pre-check read);
           retrieval runs. A SYSTEMIC failure atomically ADDs failures in the
           current window (window length fixed, 60 s; a new window resets the
           count). failures ≥ threshold (fixed, 5) → conditional write
           {state: open, openedAt: now}. One Lambda wins; the rest read the
           new state.

open       inside cooldown (fixed, 60 s from openedAt): the turn SKIPS corpus
           retrieval entirely and runs seed ⊕ session — the mid-bundle
           baseline of §3.18: persona, ontology and common vocabulary,
           without the moved bands' depth — and the answer carries the
           supplement-absent marker (§3.17), which under this floor is the
           reader's only signal of the thinner mode. After cooldown:
           conditional write {state: half-open}; exactly the winner probes.

half-open  the winning turn retrieves with a single bounded probe Query
           before committing to the full plan. Success → conditional
           {state: closed, failures: 0}. Failure → conditional
           {state: open, openedAt: now}. Losers of the transition race read
           half-open and skip, as in open.
```

The breaker protects three things: the table (no hammering through a throttle storm), the
turn's latency (fail fast instead of forty timing-out Queries), and the bill. The Lambda clock
feeds windows and cooldowns only — operational mode selection, never answer content. The
honesty nuance, stated plainly: breaker state means the same question can answer with or
without the supplement at different moments. Both modes are honest, and the answer's marker
says which one served it. Skip mode is not a stub; it is the current product.

**The in-page breaker (the browser).** Pages share nothing across visits and need no table:
breaker state is per-source, in-memory, page-lifetime. The same machine with the same
thresholds, minus the conditional-write races — one page, one writer. A source that trips its
threshold (wikipedia research, a news KB source) is skipped for the rest of the visit; the
turn or enrich cycle proceeds exactly as it does today when that source returns nothing, and
the answer or status line carries the same honest answered-without-that-source marker. A
reload starts fresh. The news page's negative cache and abort seam stay as they are; the
breaker sits beside them, catching systemic failure where the negative cache catches per-term
emptiness.

**Where it applies.** Every external call site that exists today adopts the pattern: the live
research sources (wikipedia, wikidata) in the browser chat; the news page's KB lookups;
liveReference for embedded consumers. The turn Lambda has no external call sites — its only
network is DynamoDB (§2) — so its breaker is the corpus breaker alone.

### 3.17 The enumeration honesty marker

The constitutional requirement retrieval creates. A bounded subgraph either grounds a
point-answer or misses honestly — nothing changes for is-a, property, proof, or does-have
answers. Enumeration is different: "list animals" over a corpus band reached through a bounded
retrieval is structurally partial, and reporting the subgraph's contents as the store's would
be a silent completeness claim.

The mechanism:

- the assembled payload carries `retrieval: { mode, bounded }` — `mode` is `"supplemented"`
  (corpus retrieval ran) or `"seed-session"` (breaker skip, or no bands configured);
  `bounded` is true when any §3.15.1 budget tripped;
- enumeration-class lanes (list, count, what-else — the lanes whose answers assert a set's
  extent) append their bound in the answer when `mode: "supplemented"`: "counted among what
  this query pulled in from the corpus" — and when `bounded` is also true, the stronger "the
  corpus may hold more than this query pulled in". The phrasing is a template, written once;
- every answer in `mode: "seed-session"` while bands are configured carries one trailing
  source-note line: "answered without the corpus supplement" — the breaker marker;
- point-answer lanes change nothing.

This is an answer-shape change through `chat.mjs`'s enumeration lanes and templates, which is
why its phase (T4) is Opus and carries corpus-row pins: the marked shapes, the unmarked
point-answers, and a lane-inventory test asserting every enumeration-class lane reads the flag
(the guard against a lane silently claiming completeness — §29.12).

### 3.18 Cold start and the seed band

The turn tier bundles the **mid band set** — the human persona bands (small, medium, large:
13,632 facts by the deployed page's own band counts), SEON (399), and the three small code
corpuses (88) — roughly 14,100 facts, an estimated fifth of the xl set's ~93.5 MB, a parse in
the one-second class rather than multi-second. The two heavy bands leave the bundle and return
per-query: **WordNet-xl's content is a subset of `corpus:wordnet-complete`, and the capped
ConceptNet band is a subset of `corpus:conceptnet-full`** (§3.13), so retrieval serves a
superset of everything the bundle gave up. Point answers are near-lossless — term-anchored
retrieval mirrors the bounded reads the engine does anyway (§3.15) — and the recorded trade
is two-sided: enumeration answers over the moved bands are retrieval-bounded and say so
(§3.17), and breaker-open mode (§3.16) answers from the mid bundle alone — common vocabulary,
the persona, the ontology, but not the moved bands' depth.

Two alternatives are recorded as considered:

- **Full xl bundled** — an earlier revision's decision, replaced on replay: it bought
  breaker-open parity with the browser demo at a multi-second cold start, and the replay
  recognised that corpus migration loses almost nothing per-query, so the parity was priced
  too high.
- **Near-empty boot** — still rejected: baseline competence must not depend on DynamoDB
  being up; a breaker-open turn over a near-empty bundle would be no product at all.

Warm invocations pay nothing — the parsed payload lives for the container's lifetime. T3's
acceptance measures the cold boot with the mid bundle and publishes the number in the plan's
build marker; provisioned concurrency is the named fallback lever if that measurement
disappoints, priced when needed, and not the plan.

### 3.19 Page backend modes: the slider and the query parameter

chat.html and ledger.html each gain a visible backend slider with two positions:

- **local** — the default: today's behaviour to the byte. The in-page engine over its current
  store (chat.html's `idb-persist.mjs` snapshot; ledger.html's in-page payload), today's
  privacy copy, zero network beyond the page's existing fetches.
- **AWS** — the same in-page engine with its session rows behind `createHttpRowBackend`
  against the row service — §3.7's architecture on another page: page-minted UUID in
  localStorage, synchronous writes, the persistence-unavailable fall-through, and the copy
  flipped whole to the server-side promise (anonymous session, seven-day TTL, purge semantics
  where the page has a purge).

Decisions folded in:

- **The mode is a boot choice.** `?backend=aws` boots the page in AWS mode; the slider
  rewrites the URL and reloads, so the slider and the parameter never disagree and a mode is
  never switched under a live session. An absent or unknown value is local, silently.
- **Deep links are the mechanism.** `chat.html?backend=aws` is a first-class address — it is
  what the demo grid's chat-AWS button links to (§3.20).
- **No data crosses modes.** Local snapshots never upload; server rows never download into
  the local store. Switching modes switches stores, each living and expiring under its own
  rules. Reconciling the two is the merge problem §30 parks behind crdt.md.
- **The copy flips entirely with the mode.** In AWS mode the local-only wording is absent,
  not amended; in local mode the server wording is absent. The e2e pins both directions.
- **news.html has no slider.** Its mode is the architecture (§3.7); the page states the
  server-side promise always.
- **The engine stays in-page in both modes, on these pages.** chat.html and ledger.html never
  call the turn endpoint in either mode. news.html is the deliberate exception: a thin client
  with no in-page engine (§3.7), whose chat is the turn endpoint (§3.12).

### 3.20 The demo grid: renamed, nine buttons

The home page grid renames from the claim grid to the **demo grid** — element classes
(`.demo-grid`, `.demo-cell`, `.demo-page`), copy, and pins all move — separating the grid's
name from the claims table and claims.html, which keep theirs. The eyebrow follows the count.

The settled composition, nine deep-linked buttons, recorded so no future session re-derives
it:

1. `chat.html` — the chat engine, local mode (the default);
2. `chat.html?backend=aws` — the same engine, session rows on the row service;
3. `news.html` — AWS-backed only;
4. `sprites.html`;
5. `ledger.html` — one button; the page's own slider carries its AWS mode;
6. `plan.html`;
7. `mudiii.html` — the town square;
8. `mudiii.html?scenario=river` — the crossing;
9. `adventure.html`.

The chat-AWS cell follows the river cell's precedent exactly: its own share posts (globally
unique text), About pointing at chat.html's existing about page, no new claims block, no
screenshot, no OG image — a different perspective on the same demo, not a new capability. The
chip shows the page name; the deep link stays on the href (the river cell's overflow lesson).

### 3.21 The server-side news cycle

The deployed news page's polling and enrichment move server-side (operator directive): a press
triggers a Lambda, the cycle runs asynchronously against the session's own row partition, and
the page refreshes by polling the graph. The engine code needs no change to run there —
`pollNewsSources(ctx)` and `enrichTopTerms(ctx)` already take an injected `ctx` carrying
`memoryDir`, a `providers.newsFetchers` map, and the `shouldAbort` seam read between sources
and between articles (news.mjs's own documented contract) — the worker builds that ctx over
`createDynamoRowBackend` instead of `createInMemoryStore` and calls the same functions.

**The trigger endpoints** (§3.8's table): POST poll and POST enrich validate exactly like every
mutating route (key shape, content type, rate), write a cycle marker into session meta
(`cycle`: `{cycleId, kind, state: "running", startedAt, sources: {…per-source progress}}`),
async-invoke the news worker Lambda (an `InvocationType: "Event"` self-invoke or a second
function — the CDK phase decides which, the contract is only that the 202 returns before the
cycle runs), and answer `202 {cycleId}`. One cycle per session at a time: a trigger while
`state: "running"` is a 409, unless the marker is stale past the worker's own timeout, in
which case the trigger replaces it (a crashed worker never wedges a session).

**The worker.** `server/news-worker/handler.mjs`: fresh backend per invocation (§3.10),
`loadMemory`, build the ctx with REAL fetchers (`createNewsFetcher` over the source roster,
`getResearchProvider` for KB lookups, the `dynamo-corpus` source of §3.15.2 querying the band
partitions directly — it is server-side, so no HTTP hop through the corpus route), run the
cycle, `persistMemory` the delta as it lands per source (facts appear row by row, not at the
end), update the per-source progress in the cycle marker as each source completes, and finish
by writing `state: "done"` (or `"failed"` with the reason). Every mutating write also bumps
`graphVersion` (below). The worker honours `shouldAbort` wired to its own remaining-time
budget, so a Lambda nearing its timeout stops between articles and marks the cycle done-partial
— the same honest abort the page's stop button performs today.

**Egress, refined.** The turn Lambda's no-egress rule (§2) stands untouched. The news worker
is the one Lambda WITH outbound HTTP, allow-listed to the source roster and KB hosts it serves
(the five contemporary feeds, the KB lookup origins) — polling external feeds is its entire
job. It carries §3.16's manners upgraded to their strongest form: the per-source courtesy
throttle and the per-source breaker state live in `_meta` items (sk `breaker#source#<id>`,
`throttle#<id>`), so ALL worker invocations share one throttle per source instead of each
Lambda pacing independently — the 2 s courtesy gate, made global.

**The page's refresh loop.** Every mutating service write still bumps the monotonic
`graphVersion` meta value (an atomic `ADD` beside the write — the row-level signal any
consumer can watch), and every completed materialization bumps `feedVersion` (§3.22). The
page polls `GET /api/meta/feedVersion` — one cheap point read, ~2 s interval with backoff
toward ~10 s while nothing changes — and refetches `GET /api/feed` only when the version
moves; it renders the document, computes nothing (§3.7). The cycle marker
(`GET /api/meta/cycle`) drives the same phase UI the page shows today — per-source chips,
"polling…", the request-log lines — reporting the worker's progress. No push infrastructure;
polling a version counter is the whole mechanism.

**Caps.** One running cycle per session (the 409); N cycles per session per hour (deployment
parameter, default 12 — a poll is worth many row writes); the worker's own reserved
concurrency (deployment parameter, default 5) separate from the row service's and the turn
service's; the worker Lambda timeout sized to a full roster poll with the abort budget inside
it. Trigger requests count toward the session's mutation rate.

**Sequencing, honestly.** The tenth revision removed the intermediate in-page state: there
is no point building backend-swap wiring for an engine the page is about to lose. The thin
page (M8) depends on the worker, the materializer, and the turn handler existing first —
§28's table carries the reordered dependencies — and until M8 lands, the deployed page keeps
running exactly as it does today. The in-page ingest path survives in the library (it IS the
engine's code, and the worker runs it); only the page stops hosting it.

### 3.22 The materialized feed

The worker owns the feed. After every cycle (poll, enrich, ingest) and after every learning
turn (§3.12), the news worker runs the real feed pipeline server-side — `buildFeed` with the
newsworthiness gate, `rankedTerms` over the ledger, the tile stats, the per-card fact
expansions rendered through the same `factRows` read the page's drill-down used — and writes
one **feed document** into session meta (key `feed`), then bumps `feedVersion`.

**The document's contents** — everything the page renders, so the page computes nothing:

- `items[]`: per card — `hub`, `paragraph`, `tier`, `newName`, `sources` (title + url),
  `backgroundParagraph`, `factLines[]` (the drill-down, pre-rendered through the shared
  phrase layer, trimmed per the size rule below), `factCount`, and the client-side sort keys
  the pills need (`observedMs`, `factCount`, `changedCount`);
- `rankedTerms` (the panel's rows), `stats` (`graphSize`, `factsFromNews` — the tiles),
  `sourceStatus` (the per-source roster lines), `requestLog` (the worker's fetch log),
  `builtAt`, and the cycle summary.

**Size, stated against the plan's own rules.** The 4 KB cap is for fact rows; the feed
document is one meta item and DynamoDB's hard ceiling is 400 KB. The arithmetic at the
shipped `itemCap` (30 cards): paragraph + background + sources + keys ≈ 1.2 KB per card, and
the drill-downs dominate — up to ~60 facts per card at ~150 B a line would be ~9 KB per card,
~300 KB per feed, uncomfortably near the ceiling. The rule: **`factLines` trims to the first
24 lines per card** (deterministic order, the document carries `factCount` so the card says
"…and N more"), giving ≈ 4.8 KB per card and ≈ 150–200 KB per document worst case; the
serializer enforces a hard 350 KB bound and, if a pathological feed still exceeds it, drops
whole cards' `factLines` from the feed's tail upward (deterministic, `trimmed: true` on the
document) until it fits. Chunking across items was considered and rejected: a single item
keeps the read atomic (one GET, no torn feed between chunks) and the trim rule keeps the
single item honest. The trimmed drill-down is a display bound, not a data bound — the rows
themselves are all in the store.

**When materialization runs, and the staleness it costs.** At cycle end, always (poll,
enrich, ingest). After a learning turn, the turn handler async-invokes the worker in
**materialize mode** — no fetching, no extraction: load rows, build the document, write,
bump — so a taught fact reaches the feed seconds after its turn replied (invoke + load +
build + write; low single-digit seconds at session scale). The alternative — waiting for the
next poll cycle — was rejected: a taught fact that never surfaces until an unrelated poll is
a broken promise, and the cost of the chosen shape is one cheap worker invocation per
feed-changing write, bounded by the turn and mutation rates. Between the write's
acknowledgement and the materialization's completion the feed shows the previous state; that
window is the design's whole staleness, it is seconds long, and the version poll closes it
without user action.

**The worker's seed posture** (it owns the engine now, so this is explicit): the news worker
bundles the **full xl seed**, not §3.18's mid set. Two reasons, both correctness rather than
taste: grounding parity — the page's ingest has always grounded against the full 61k
vocabulary, and a mid-band worker would ground less and enrich more, silently changing the
page's behaviour; and the newsworthiness gate — `priorTerms`/`isNovelTerm` and
`isVocabGroundedTerm` read the assembled store's vocabulary, so a worker missing WordNet and
ConceptNet would read half the dictionary as "novel" and wave junk hubs through the
entity-anchored gate. The worker is asynchronous behind a 202, so its cold start hides where
the turn Lambda's could not — the xl parse costs seconds on a path that already takes
seconds. The turn Lambda keeps the mid set (§3.18 unchanged): its lexicon-driven teach
grounding does not depend on the seed bands, and the feed's novelty judgements always run in
the worker with the full universe.

**Purge.** `deleteAll()` soft-deletes the feed document and both version counters with the
rows; `GET /api/feed` 404s from the moment of the press, and the page clears to its empty
state immediately.

---

## 4. The operational contract as checks

| requirement (spec §4) | conformance-checkable | how |
| --- | --- | --- |
| stateless open, no bulk load | partly | tmct-side integration test asserts one `readRows()` per cold `loadMemory` (spy backend); O() itself is design, §3.5 |
| per-fact atomicity, no cross-fact transactions | yes | a poisoned batch (one row rejected by a wrapping test backend) leaves the others readable and valid |
| row-level concurrency, both writers land | yes | two handles on one key interleave `putRows`; the suite asserts both fact rows present |
| concurrent supersession survives | yes | two handles supersede the same fact differently; assembly over the union shows both supersessions applied (§3.2's additive rule) |
| delete-by-key reachability, observable semantics | yes | `deleteAll()` then `readRows()` empty and every meta key null; `deleteRows` then the row absent from reads. Satisfiable by physical removal or by tombstoning with filtered reads (§3.1) — the suite checks what a reader can observe, never the storage |
| meta round-trip | yes | put/get/absent-is-null for each named key |
| bookkeeping exclusion | yes | a `rowClass: "bookkeeping"` row round-trips but never surfaces in `rowsToPayload`'s answer-facing individuals. This gates internal rows only; it does not touch extractor-minted fact rows like the `tmct:needs` example the spec's author has since corrected (§3.2) |
| determinism / order independence | yes | one row set, two arrival orders, identical assembled payloads |
| ≤ 4 KB rows | yes | the projection rejects an oversized row at `payloadToRows` time with a `BackendRejected` naming the provenance; in `onOversizedRow: "drop"` mode the same row is logged and skipped and the batch's remainder persists (§3.2) |
| typed failures | yes | every failure a backend or the client surfaces is an instance of `BackendRejected`/`BackendUnavailable` with its stable `code` (§3.1); the kit asserts the classes and codes |
| HTTP error mapping | yes (client) | the kit runs against the HTTP client over the local double; a scripted double answers 400/413/429/507/500 and the client must map each per §3.8, onto the exported classes |
| TTL enforcement | no — adapter-documented | time-driven; the suite asserts only that `expiresAt` round-trips untouched |
| latency budget | no — consumer-measured | the smoke probe records the service's numbers as measurement; bedrock-meter's e2e measures their own deployment |
| lazy SDK, no import-time IO | partly — in-tree pin | the kit cannot see imports, but the shipped DynamoDB backend pins it directly: the module loads with the SDK absent, and only the first storage call requires it (§3.10) |

---

## 5. Phase M0 — the row projection (`rows.mjs`)

**BUILT** (2026-08-10, merged to main): both modules plus 20 projection tests; round-trip
identity holds as lossless-by-id plus a fixed point (assembly re-attaches the derived
`supersededBy` last and Fact individuals return in content-addressed id order);
`payloadToRows` takes `priorRows` so surviving rows keep their `ord` and a removal diffs
minimally; an individual outside the closed rowClass set refuses by name with
`BackendRejected`.

**Owns** `src/adapters/memory/rows.mjs` (new), `src/adapters/memory/row-backend.mjs` (new:
the contract doc-comment, `isRowBackend`, the row-shape validator), `test/adapters/memory-rows.test.mjs`
(new). Serialized on `core.mjs` knowledge, no `core.mjs` edits yet. **Opus.**

Deliver `payloadToRows`, `rowsToPayload`, `diffRows` per §3.2, factored to match what
`persistSqlitePayload` stores today (same tables, same fields, expressed as wire rows), plus
the §3.1 error classes (`BackendRejected`, `BackendUnavailable`, stable `code` fields) in
`row-backend.mjs` beside the validator. Three projection rules carry the sharp-edge fixes:
supersession and retraction are additive rows; research-queue and researched-terms entries are
individual `bookkeeping` rows; the 4 KB cap throws a `BackendRejected` carrying the fact's
provenance, or logs and skips the row under the `"drop"` posture (§3.2). Unit tests:
round-trip identity on a seeded fixture payload, sort-before-assembly order independence, the
4 KB rejection in throw mode and the logged skip-with-remainder-persisted in drop mode,
`rowClass` classification for every individual class in the store including a `bookkeeping`
row, `diffRows` producing the minimal put/delete sets for an append, a supersession, and a
retraction, and the union of two conflicting supersession projections assembling with both
applied.

Implementation notes (from the code survey):

- The payload to project is `emptyMemory()`'s shape: `{generated_at, memory, prefixes,
  vocabulary, classes, objectProperties, individuals, proseIndex}`. Project `individuals`
  (each with its `ord` carried in the row json) and `objectProperties` groups (one
  `edge-group` row per prop, examples in stored order — order is recency by design); store
  `memory` and `prefixes` as meta; RECOMPUTE `classes`, `vocabulary`'s derived entries,
  `proseIndex` (via `buildProseIndex`), and `generated_at` at assembly — never as rows (§3.2's
  derive-not-store rule; a 61k store's proseIndex serialized whole dwarfs the 4 KB cap).
- Fact rows: `rowClass` from `ind.class === FACT_CLASS`; `rowKey` is the RECORD id
  (`<tripleHash>@<sourceId>` — `factGroupId` strips the group); `term` =
  `normFactTerm(individualKey(ind, "subject"))` mirroring `factProjectionValues`. The
  supersession derivation (§3.2) replaces both `SUPERSEDED_BY_PROP` stamping and the
  `fact_object_supersessions`/`fact_heads` tables — those are sqlite's queryable
  materialisations of what assembly recomputes (`backfillFactHeads` is the reference
  recompute).
- Reuse the fixture payloads `test/adapters/memory-backend-sqlite.test.mjs` and
  `memory-core.test.mjs` already build; `memory-retraction.test.mjs` shows the retraction
  shapes `diffRows` must emit, and `memory-fact-heads.test.mjs` the head recompute the
  assembly inherits.
- One byte-level trap: `core.mjs` contains characters that make GNU grep treat it as binary —
  survey it with `grep -a` or node, not bare grep.

Acceptance: `node --test test/adapters/memory-rows.test.mjs`; `npm run test:fast`.

## 6. Phase M1 — Backend D dispatch

**BUILT** (2026-08-10, merged): `wrapRowBackend` with the seed overlay (putRows provably
never receives a seed row), the two-live-handles supersession race pinned, the sidecars and
research queue on rows (queue state monotone per title — queued → finished/passed-over —
so a stale snapshot cannot resurrect a finished title), and one fold beyond the spec:
`persistRowPayload` suppresses rows whose only change is the `mgx:updatedAt` audit stamp,
because `recomputeSourceReliability` re-stamps every fact on every mutate and a raw byte
diff would write the whole store per turn and let a stale handle clobber a concurrent
supersession. The suppression is Backend D's alone — `diffRows` and the sqlite path are
untouched for M3's byte-identity pin.

**Owns** `src/adapters/memory/core.mjs` (the dispatch sites: `openMemoryBackend`,
`loadMemory`, `persistMemory`, `loadSyllogiseState`/`saveSyllogiseState`,
`loadNodeId`/`saveNodeId`, `isMemoryOrSqliteHandle` widened to cover row handles),
`src/services/chat-session.mjs` (accept an object `memoryBackend`), `src/services/init.mjs`
(same for the seed path), `src/adapters/research-queue-store.mjs` (the row path: queue entries
as bookkeeping rows for row backends), `test/adapters/memory-row-backend.test.mjs` (new).
**Opus**, serialized after M0.

The wrapped handle, cache, and base-overlay semantics are §3.4 verbatim. The integration test
drives `appendFact`/`appendFacts`/`removeFacts`/`readFactRows`/`loadMemory` through a spy row
backend and asserts: one `readRows` per cold load, delta-only `putRows` per mutate, the
scalar sidecars landing in meta and the queue landing as rows, a seeded-base case where
`putRows` never receives a seed row, a two-handle race where both writers' facts and both
supersessions land, and byte-identical answers between a sqlite-backed and a row-backed
session running the same taught turns (the storage-seam-not-behaviour-change pin).

Implementation notes (from the code survey):

- The dispatch set is wider than the two loaders. Cover: `openMemoryBackend` (object
  passthrough when `isRowBackend`), `openExistingMemoryBackend` and
  `openConfiguredMemoryBackend` (string-only paths — unchanged, but their docblocks gain the
  object caveat), `readOnlyMemorySnapshot` (works via `loadMemory`, so row handles come free —
  add the test), `closeSqliteMemoryStore` (already a guarded no-op for foreign handles; the
  row handle's `close()` needs its own call site in the session teardown), `isMemoryOrSqliteHandle`
  (widen or add `isRowHandle` beside it — blocks.mjs and friends guard raw path joins with it).
- `chat-session.mjs:418` coerces the choice with `String(memoryBackend || …)` BEFORE
  `openMemoryBackend` — an injected object must be tested with `isRowBackend` ahead of that
  line or it stringifies. Two session behaviours also branch on the choice string: the W3
  bootstrap seed fires only on the default token (row backends skip it — correct, note it in
  the docblock) and `discardsWrites`/`whereItGoes` copy needs a third arm for a persistent
  row backend ("kept in your configured store").
- `research-queue-store.mjs` is 76 lines writing one `research-queue.json` beside the store —
  the row path replaces the file with `bookkeeping` rows per §3.1; keep the file path for
  string/sqlite tokens byte-identically.
- `test/adapters/chat-memory-backend.test.mjs` and `memory-backend-default.test.mjs` pin
  today's selection precedence — extend them rather than writing parallel selection tests.
- The sqlite handle's cross-connection cache guard (`PRAGMA data_version` in
  `readSqlitePayload`) has no row-backend equivalent by design — sharp edge #3's accepted
  staleness; cite it in the wrapped handle's docblock so nobody "fixes" it ad hoc.

Acceptance: `node --test test/adapters/memory-row-backend.test.mjs test/adapters/memory-rows.test.mjs`;
`npm run test:fast`; CLI smoke `printf 'hi\n/exit\n' | node bin/tmct.mjs`.

## 7. Phase M2 — the reference backend and the conformance kit

**BUILT** (2026-08-10, merged): `createRowMemoryBackend` plus the published
`./memory-backend-conformance` kit (25 kit tests); the kit runs against both a
physical-delete and a tombstoning backend, and `collectRows` normalizes both `readRows`
return shapes.

**Owns** `src/adapters/memory/row-backend-memory.mjs` (new: `createRowMemoryBackend()`, the
simplest complete implementation), `src/tools/memory-backend-conformance.mjs` (new kit:
`runMemoryBackendConformance(name, makeBackend)` plus row validators, shaped like
`conformance.mjs`), `package.json` (`"./memory-backend-conformance"` export subpath, following
the `./envelope` and `./news` precedents), `test/estate/pack-manifest.json` (regenerated the
standard way), `test/tools/memory-backend-conformance.test.mjs` (runs the kit against the
reference backend). **Sonnet**, after M0, parallel with M1.

The kit's checks are the "yes" rows of §4's table. It must run against a bare backend object
with no tmct internals loaded, so a third party can wire it into their own `node --test` run
exactly as the spec asks.

Implementation notes: `conformance.mjs`'s public surface is `runConformance(name,
makeProvider)` plus `assertResult`/`assertIndividual`-style validators — mirror that surface
shape. One naming caution: a `./memory` subpath ALREADY exists (it maps to
`src/adapters/memory/core.mjs`), so the new subpaths are `./memory-backends` and
`./memory-backend-conformance` exactly — never a bare `./memory-…` collision — and the
consumer-style import test resolves both through the exports map beside the existing
`./memory` entry.

Acceptance: `node --test test/tools/memory-backend-conformance.test.mjs test/estate/pack.test.mjs`;
a consumer-style import through the exports map (the `agentbench-envelope.test.mjs` resolve
trick) proving the subpath resolves.

## 8. Phase M3 — sqlite passes the same suite

**Owns** `src/adapters/memory/core.mjs` (Backend C refactor: `createSqliteMemoryStore`'s handle
implements the §3.1 methods over its existing tables; `persistSqlitePayload` collapses onto
`diffRows` + the handle's own `putRows`/`deleteRows`), `test/adapters/memory-sqlite-conformance.test.mjs`
(new: the kit against a temp-file sqlite backend). **Opus**, serialized after M1 (same file).

The refactor must leave every existing sqlite test green with no assertion edits: same DDL, same
stored bytes for the same payload (checked by a before/after dump comparison in the new test).
This phase is what makes "the sqlite backend passes it" (spec §8.1) literally true rather than
true-by-analogy.

Implementation notes (from the code survey): `persistSqlitePayload` is subtler than a diff
loop — the refactor must preserve, byte for byte: the unchanged-row skip (`existing.json ===
json` continues without a write), `ord` assignment (existing rows keep theirs; new rows take
`MAX(ord)+1`), the NUL-delimited edge keys and the per-group edge diff scoped by
`edges_by_prop`, the `facts` projection upsert riding the SAME transaction as its
`individuals` row (`FACT_PROJECTION_UPSERT_SQL`), the touched-groups/touched-pairs
re-materialisation of `fact_heads` and `fact_object_supersessions` for exactly what moved,
and the cache mirror calls (`cacheUpsertIndividual` et al) in lockstep. The existing pins to
keep green unedited: `test/adapters/memory-backend-sqlite.test.mjs`,
`memory-backend-default.test.mjs`, `memory-fact-heads.test.mjs`, `memory-versioning.test.mjs`,
`memory-retraction.test.mjs`, `memory-facts-read-perf.test.mjs` (the read-path perf pin —
the refactor must not regress the cached-read shortcut or `PRAGMA data_version` guard).

Acceptance: `node --test test/adapters/memory-sqlite-conformance.test.mjs` plus the existing
memory/store test files; `npm run test:fast`.

## 9. Phase M4 — the DynamoDB backend, in-tree

**BUILT** (2026-08-10, merged): `createDynamoRowBackend` with the full §3.10 constructor,
the `./memory-backends` subpath, and the fake document client; the kit passes in both delete
modes (31 tests + the env-gated live-table pass); rowKey/rowClass/term/json travel as plain
item attributes beside the composed sk (a rowKey can itself contain `#` or `@`);
`maxRows`/`maxBytes` bound each `putRows` batch; the no-SDK pin runs the production files
from a temp directory outside any node_modules ancestry.

**Owns** `src/adapters/memory/row-backend-dynamo.mjs` (new: §3.10's construction and ops
mapping), `src/adapters/memory/backends-exports.mjs` (new: the `./memory-backends` entry),
`package.json` (the export subpath; the optional peer-dependency declaration per §3.10),
`test/estate/pack-manifest.json` (regenerated the standard way),
`test/adapters/fake-dynamo-document-client.mjs` (new: the client double per §3.10),
`test/adapters/memory-dynamo-conformance.test.mjs` (new). **Sonnet**, after M2, parallel with
M3.

The conformance test runs the FULL kit against the backend over the fake client — twice, once
per delete mode, since both must satisfy the same observable semantics — plus the
backend-specific pins: the module loads with no SDK installed and the first call without it
fails with the named install hint; the key expressions the backend emits match §3.3's layout
exactly; every Query the fake records carries `ConsistentRead: true` by default and `false`
when the option disables it; a 5-row `putRows` reaches the fake concurrently (in-flight count
above one) and `writeConcurrency: 1` serializes it; `ttlSeconds` stamps `expiresAt` and null
stamps nothing; `attributeNames` remaps every expression; failures surface as the exported
classes with their codes; in default mode `deleteRows`/`deleteAll` remove items; in
`softDelete` mode they stamp `deletedAt` (the item still present in the fake's map, its
`expiresAt` unchanged), every read filters stamped items out, and re-marking a marked row is
an idempotent no-op-shaped Update. Setting `TMCT_DYNAMO_LIVE_TABLE` reruns the same file
against a real table by hand; CI never sets it.

Acceptance: `node --test test/adapters/memory-dynamo-conformance.test.mjs test/estate/pack.test.mjs`;
a consumer-style import through the exports map proving `./memory-backends` resolves;
`npm run test:fast`.

## 10. Phase M5 — the row service handler and its local double

**Owns** `server/row-service/handler.mjs` (new: routing, validation, caps, error semantics per
§3.8, calling an injected §3.1 backend — no storage code; the AWS entry constructs the M4
backend), `server/row-service/local.mjs` (new: the handler on `node:http` over the M2 reference
backend — the test double every later phase uses), `server/row-service/README.md` (one page:
run locally, env vars `TABLE_NAME`/`TTL_DAYS`/`TABLE_ROW_CAP`, what deploys it),
`test/server/row-service.test.mjs` (new). **Sonnet**, after M2 and M4.

The handler tests drive every endpoint through `local.mjs`: the session-key gate (a valid v4
accepted in header and in path; missing, malformed, wrong-version, and wrong-variant keys each
400 before any storage call; a mutating request whose path segment and header disagree is a
400), implicit creation on a fresh key's first write, an unknown key reading as an empty
session, each cap answering its status code with nothing applied on refusal — including the
global table cap: `local.mjs` takes a `TABLE_ROW_CAP` override so the test fills a tiny cap
and asserts the 507 with nothing applied, that deletes do NOT free the cap (delete rows, write
again, still 507 — the counter never decrements on a delete), and that only the reconcile mode
trues the counter down — the mutation-rate counter, the TTL knob (`TTL_DAYS` reaching the
backend as `ttlSeconds`, stamped on written rows; unset stamping nothing), batch validation
before any apply, the JSON-only content-type rejection (§3.9), and the soft-delete semantics
end to end: a keyed DELETE leaves the row absent from every subsequent read, `{all: true}`
leaves the whole session absent, a repeated DELETE of the same keys is idempotent 204s, and
the purge never touches the session's rate-counter rows, so a purge cannot reset the mutation
rate limit (§29.4).

Acceptance: `node --test test/server/row-service.test.mjs`; `npm run test:fast`.

## 11. Phase M6 — the HTTP client backend, conformance over the wire

**BUILT** (2026-08-10, merged): `src/surfaces/web/http-row-backend.mjs`
(`createHttpRowBackend({apiBase, sessionKey, fetchImpl})`, fetch-only), 21 tests running
the full kit over the real three-layer stack (client → handler → reference backend) plus
status-mapping pins; only `deleteAll()` retries once on 5xx (the idempotent purge), all
other mutations are single-attempt with retry left to the caller.

**Owns** `src/surfaces/web/http-row-backend.mjs` (new: `createHttpRowBackend({ apiBase,
sessionKey, fetchImpl })`, the §3.1 contract over fetch — reads under the `x-tmct-session`
header, mutations addressed to `/api/sessions/<sessionKey>/…` per §3.8's table — `deleteAll`
as the `{all: true}` delete, the §3.8 error mapping onto the exported §3.1 classes, 507 →
`BackendUnavailable` included), `test/adapters/http-row-backend.test.mjs` (new). **Sonnet**,
after M5.

Its test file runs the FULL conformance kit against the client pointed at `local.mjs` — three
real layers (client → handler → reference backend), no fakes — plus the scripted error double
for §4's mapping row.

Acceptance: `node --test test/adapters/http-row-backend.test.mjs`; `npm run test:fast`.

## 12. Phase M7 — infra and deploy

**BUILT** (2026-08-10, merged): the table, Lambda (reserved concurrency 10), function URL +
OAC, `/api/*` behavior, and daily reconcile rule join `WebsiteStack`; the WAF rate rule and
the $20 estimated-charges alarm live in a new us-east-1 `EdgeGuardStack` crossed in via
`crossRegionReferences` (both are region-locked, the same constraint the ACM cert already
works around); `deploy:website` gains `npm run build:row-service`; the post-deploy smoke
gains the row round-trip probe, and its live check no longer fires as a module-load side
effect (a latent bug the probe work surfaced). Verified by `cdk synth`, never a live deploy.

**Owns** `infra/lib/website-stack.ts` (the table, the Lambda from the built bundle, the
function URL + OAC, `addBehavior("/api/*", …)`, reserved concurrency, the two deployment
parameters — `TTL_DAYS` default 7 and `TABLE_ROW_CAP` default 2,000,000 — as Lambda env, and
the daily EventBridge rule invoking the Lambda in reconcile mode to recount the table and
rewrite the global counter per §3.8), `package.json` (`build:row-service`: esbuild
`handler.mjs` → `server/row-service/dist/`, SDK external), `.gitlab-ci.yml` (`deploy:website`
gains the `build:row-service` step), `scripts/post-deploy-smoke.mjs` (the live probe: put one
row under a fresh UUID → read it back → delete `{all: true}`, against the deployed origin,
polled with the same patience the version check uses). **Sonnet**, after M5;
the stack change deploys through the existing job on the next main push, no new pipeline
surface. The first deploy lands the table empty; there is nothing to migrate.

Implementation notes: the CDK app is self-contained under `infra/` with its own
`package.json`/`tsconfig.json`; the constructs join `WebsiteStack`
(`infra/lib/website-stack.ts:128`), whose stack instance CI deploys as
`tmct-prod-prod-website` — new constructs land inside that class, no new stack, and the
distribution object the behavior attaches to is the one the class already owns (beside its
viewer-request CloudFront Function). `apex-stack.ts` is untouched.

Acceptance: `npx tsc --noEmit` in `infra/`; `npm run build:row-service` emits a bundle;
`node --test test/server/row-service.test.mjs` still green; the smoke probe runs against
`local.mjs` in a dry-run mode so the script itself is tested without AWS.

## 13. Phase M8 — news.html goes thin

**Owns** `src/surfaces/web/news-browser-entry.mjs` (the thin rewrite: the session mint at
consent; the API client for feed/version/triggers/purge; the render path fed by the feed
document instead of the in-page store; the teach panel posting the ingest trigger; the
feed-and-chat-unavailable state; `revokeConsent` calling `deleteAll()` and discarding the
key), `src/services/news-viz.mjs` (rendering from the document — cards from `factLines` +
`factCount`, pills over the document's sort keys, tiles from `stats`, the phase UI from the
cycle marker; the honest copy per §3.7), `scripts/build-news-bundle.mjs` (the thin bundle:
renderer + controls + client; the engine chunks and the seed loading leave this page),
`test/adapters/news-browser-entry.test.mjs`, `test-e2e/pages-news-feed.test.mjs`. **Sonnet**,
after M5, T12, and T3 (the chat area itself is T14, but the page shell it mounts in lands
here).

Implementation notes (from the code survey): `createNewsSession`
(news-browser-entry.mjs:133) and its `store` wrapper with the `foldedRows` cache exist to
serve the in-page engine — the thin page does not construct them; what survives of the entry
module is consent, the pref store (`localStoragePrefStore` under `NEWS_START_PREF_KEY`, the
UUID joining it), the API client, and the render wiring. The teach panel
(`news-viz.mjs:254`, `#teachPanel` — textarea, file drop, `teachIngest`) keeps its exact UI;
its ingest handler becomes the trigger POST and its status line reads the cycle marker. The
seed-copy-into-snapshot mechanics the news e2e carries exist because the PAGE loaded the
seed; this page stops needing them (they stay for the other pages' specs — do not touch the
helper).

The e2e mounts M5's `local.mjs` double WITH T12's in-process worker (the double must
materialize, or the page has nothing to render). Pins: zero `/api/` requests before consent;
the press mints the UUID; **no request for the seed asset and no engine chunk load, ever** —
the thin claim, asserted by the page's own request log; press poll → 202 → the feed document
appears → cards render with zero in-page ingest; the version poll backs off while idle;
teach-panel text → ingest trigger → re-materialized feed shows the taught fact; stop &
forget → feed 404 + zero readable rows + key discarded; kill the double → the
feed-and-chat-unavailable state, controls disabled, localStorage still holding nothing
beyond the preference and the pointer. The waits stay sleep-then-evaluate with
`waitUntil: "load"`.

Acceptance: `node --test test/adapters/news-browser-entry.test.mjs`;
`node --disable-warning=ExperimentalWarning --test test-e2e/pages-news-feed.test.mjs`;
`npm run test:fast`.

## 14. Phase M9 — the contract page and README

**Owns** `docs/adapter-contract.md` (a memory-backend section beside the existing provider
seam: the §3.1 method table, the row shape, the key recommendation, the endpoint table, the
adapter-documented items from §4), `README.md` (a short consumer paragraph: inject an object,
run the suite, link to the contract doc). **Haiku**, after M6 and M7. Docs gate only:
`npm run check:links`, estate tier, `test:fast`.

## 15. Phase M10 — hand it to bedrock-meter

**Owns** `~/.claude/inboxes/bedrock-meter.md` (append-only note). **Haiku**, last. The note
names: the `./memory-backends` subpath and the `createDynamoRowBackend` constructor (§3.11's
snippet verbatim), the `attributeNames` fit for their existing single-table layout, the
`./memory-backend-conformance` kit location, the contract doc, the meta keys and the
queue-as-rows change, the §4 split between conformance-checked and adapter-documented, and
that tmct's own site now runs the same shipped backend live against a tmct-owned table (theirs
stays theirs). Their four review asks, answered: consistent reads default on (their
load-bearing one, with the off-knob and the 2x RCU note); `putRows` concurrent with the
`writeConcurrency` knob; `onOversizedRow: "drop"` plus the exported `BackendRejected`/
`BackendUnavailable` classes for continue-without-persistence by type; and their §3.7
correction adopted — the `tmct:needs` row is extractor-minted fact data the bookkeeping gate
does not touch, its fix tracked as the extraction-quality item, their demo-side guard right to
stay meanwhile. Also restated: fresh backend per invocation (their own integration note, now
the documented pattern); reads session-scoped per §3.5 with the term-read path settled but
dormant; deletes as observable semantics with two shipped modes (physical by default,
`softDelete` tombstoning — tmct's service uses the latter, theirs is their choice); their §7
adapter offer superseded because the backend ships finished. What stays theirs: the table and
IAM, the TTL value, their live e2e, the S3-path retirement.

---

## 16. Phase T0 — corpus bands, the loader, and the three band pipelines

**BUILT** (2026-08-10, merged): band identity/manifest/wire-row builder in
`corpus-bands.mjs` (adapters), the loader plus `queryBandTerm` in
`src/services/corpus-loader.mjs` (moved there from the planned adapters home — the layering
guard forbids adapters importing T1's services-layer Query helper), the
`tmct corpus load|clear` verb pair, and the three pipelines with miniature fixtures. The
WordNet pipeline ran for real: 206,357 rows (285 MB). The ConceptNet and Wikidata pipelines
are fixture-tested only — no raw dump was available locally; T6's CI load job is where they
first run at scale. Corpus surface takes `DynamoDBDocument.from` convenience clients; the
session row backend takes `DynamoDBDocumentClient.from` — one `DynamoDBClient`, wrapped
two ways.

**Owns** `src/adapters/memory/corpus-bands.mjs` (new), `src/services/corpus-loader.mjs` (new),
`src/domain/cli-verbs.mjs` (the `corpus` entry), `bin/tmct.mjs` (dispatch),
`test/adapters/corpus-bands.test.mjs`, `test/services/corpus-loader.test.mjs` (new; the loader
over M4's fake document client, including idempotent re-run, digest no-op, mid-load-death
recovery, clear) — plus the three first-class band build pipelines under
`scripts/corpus-bands/` (new: `build-wikidata-slice.mjs`, `build-wordnet-complete.mjs`,
`build-conceptnet-full.mjs`), each reading its upstream dump from an operator-supplied path
and emitting the §3.14 jsonl beside a manifest-ready digest; the ConceptNet pipeline also
emits its CC BY-SA NOTICE and the WordNet pipeline its licence attribution, which the loader
carries into the band manifest and `corpus/LICENSES.json`'s rollup gains as entries (§3.13).
The Wikidata slice's selection rule (which entities and relations make the slice) is committed
inside its pipeline and recorded in this phase's build marker when it lands. Pipelines are
tested over committed miniature dump fixtures — no network and no real dump in CI; running a
real dump is an operator act. The WordNet and ConceptNet pipelines are **demo-blocking**
under §3.18's seed decision: the deployed turn surface needs their bands loaded to exceed the
mid-bundle floor, so they are not optional extras behind the Wikidata slice. **Sonnet**,
after M4.

Acceptance: `node --test test/adapters/corpus-bands.test.mjs test/services/corpus-loader.test.mjs`;
the pipeline test files over the miniature fixtures;
`node --test test/adapters/cli-verbs.test.mjs`; `npm run test:fast`; CLI smoke.

## 17. Phase T1 — the retrieval module, calibrated before consumed

**BUILT** (2026-08-10, merged): `retrieval-plan.mjs` (pure domain), `subgraph-retrieval.mjs`
(`retrieveSubgraph` with injected `queryTerm`, clock and sleep), and the calibration harness,
55 tests. Budgets frozen from measurement over 54,174 real-shaped band rows: hopDepth 2,
rowsPerQueryPage 200 (heaviest measured term returned 92), totalRows 1,000 (folding 5,000
cost 61 ms and 5.3 MB — a third of the bundled seed for one question), totalQueries 64
(a wide turn spends 20–30 on its own terms; 8 rounds of 8 in flight), fuzzyVariantsPerTerm 6
(the widest one-distance tie was 5), wallTimeMs 300, inFlightQueries 8, retries 2 at 25 ms
base backoff. A grounded turn under these budgets: 64–70 queries, 194–809 rows, ≤97 ms with
no network; an unbounded run wants 5,789–11,961 queries because the subClassOf closure
branches — so `bounded: true` is the norm on corpus-supplemented answers and T4's marker
carries weight on essentially every one, not an edge case. Calibration also caught a
function-word filter eating real terms ("always") and metrics conflating planned with read
terms — both fixed. `isSystemicFailure` is exported for T2's breaker; T3 should pass the
bundled seed's own term set as the fuzzy vocabulary (the grammar lexicon misses common
nouns) and reconcile `queryBandTerm` onto `termQueryOverDocumentClient`.

**Owns** `src/domain/retrieval-plan.mjs` (new, pure), `src/services/subgraph-retrieval.mjs`
(new), the calibration harness (`scripts/corpus-bands/calibrate-retrieval.mjs`, new: replays a
committed query set against the fixture band over the fake client and prints the
subgraph-size/latency/budget-hit tables), `test/domain/retrieval-plan.test.mjs`,
`test/services/subgraph-retrieval.test.mjs` (new; determinism twice-same and per fuzzy mode,
budget-cut prefix reproducibility, every budget's trip path, backoff-inside-budget, the
metrics record, the mode-resolution ladder of §3.15.2). **Opus** — it composes the lexicon
fold, the collision table, and the hop plan, and its determinism claims carry the surface.

The order inside the phase is fixed: the harness runs first — the full calibration set twice,
fuzzy on and fuzzy off — its tables land in this phase's build marker, and `RETRIEVAL_BUDGETS`
is set from those measurements (§3.15.1). T3 consumes calibrated constants, never the starting
hypotheses. The calibration set's named cases include the moved-band round trips §3.18
creates: a what-is over a WordNet-only word (absent from the mid bundle) and a
ConceptNet-only relation must come back through retrieval, so the harness proves the
migration's near-losslessness rather than assuming it.

Acceptance: the two test files; the harness run recorded in the build marker;
`npm run test:fast`.

## 18. Phase T2 — the corpus breaker

**BUILT** (2026-08-10, merged): `createDynamoRowBackend`-adjacent
`dynamo-circuit-breaker.mjs` with `decide()/report()/readState()`, state in the reserved
`_meta`/`breaker#corpus` item, transitions by conditional write (concurrent racers pinned in
tests), 11 tests. The mode constants moved to `src/domain/retrieval-modes.mjs` and the
failure classifier to `src/adapters/memory/systemic-failure.mjs` so the breaker never
imports upward from adapters into services; `subgraph-retrieval.mjs` re-exports both under
its original names.

**Owns** `src/adapters/memory/dynamo-circuit-breaker.mjs` (new; over an injected document
client, the `_meta` item, §3.16's machine), `test/adapters/dynamo-circuit-breaker.test.mjs`
(new; the full state machine over the fake client, the conditional-write races — two
contenders, one winner — window roll, systemic-vs-empty classification). **Sonnet**, parallel
with T1.

Acceptance: the test file; `npm run test:fast`.

## 19. Phase T3 — the turn handler

**Owns** `server/turn-service/handler.mjs`, `server/turn-service/local.mjs` (new; the same
double pattern as M5 — the real handler on `node:http`, the in-memory backend, a fixture band
loaded through the real loader), `npm run build:turn-service`,
`test/services/turn-handler.test.mjs` (new; the §3.12 sequence, the turn-rate counter, the
breaker-skip path answering from the mid bundle with the supplement-absent marker,
413/429/507 semantics, fresh-backend-per-invocation, the cold-boot measurement published in
the build marker — the target is the one-second class §3.18's mid bundle buys, not the
multi-second xl parse). **Sonnet**, after T0–T2 and M5.

Acceptance: the test file; `npm run test:fast`; the measured boot number recorded.

## 20. Phase T4 — the enumeration marker

**Owns** `src/services/chat.mjs` (the enumeration lanes and templates), the corpus rows
pinning marked and unmarked shapes, `test/adapters/chat-retrieval-marker.test.mjs` (new,
including the lane-inventory guard). **Opus**, serialized on `chat.mjs`.

The phase is guarded by tier-1 alone: its pins, the corpus rows, and the free 1,075-case
replay both arms — no judged round. The operator declined the judge spend, and the accepted
risk is stated: the marker's trailing lines land in prose the CEFR judge scores, so a wording
that reads as hedging could move judged cells unseen until some later judged round crosses
them. The marker templates are written once and pinned byte-for-byte, which is the cheap half
of the protection.

Acceptance: the test file; the corpus runners for the new rows; the tier-1 replay both arms
with zero regressions; `node --test
test/tools/ask.test.mjs`; `npm run test:fast`; ask bundle rebuilt.

## 21. Phase T5 — the turn service end to end

**Owns** `test-e2e/turn-service.test.mjs` (new): a real HTTP conversation against
`server/turn-service/local.mjs` with a loaded fixture band — teach, ask, a corpus-grounded
answer citing band provenance, an enumeration answer carrying the marker, a breaker-forced
skip turn carrying the absent-marker, learned rows persisted and read back on a second
"invocation", stop & forget through the row service's purge. **Sonnet**, after T3 and T4. No
network, no AWS.

Acceptance: the e2e file; `npm run test:fast`.

## 22. Phase T6 — turn infra, the corpus read route, and the CI load job

**Owns** the turn Lambda constructs in `infra/` (function, reserved concurrency parameter,
the `/api/sessions/*/turn` behavior wiring), the corpus read route
(`GET /api/corpus/:band/rows` per §3.8's table — one `queryBandTerm` call in the row-service
handler, band name validated against the configured list, `fuzzy=1` expanding through the T1
variant machinery, eventually consistent reads; its handler tests join
`test/server/row-service.test.mjs`), the `corpus:load` post-deploy CI job
(`.gitlab-ci.yml`: runs `tmct corpus load` for all three demo bands — wikidata-slice,
wordnet-complete, conceptnet-full (§3.13); the digest no-op makes the unchanged bands cheap
every pipeline, and the two moved bands are demo-blocking — a turn surface without them has
only the mid-bundle floor of §3.18), and the post-deploy smoke's turn probe (one live turn
under a fresh UUID) plus a corpus-route probe (one term read against a loaded band, including
one WordNet-only term that the bundle no longer carries). **Sonnet**, after T3.

Acceptance: `npx tsc --noEmit` in `infra/`; `node --test test/server/row-service.test.mjs`;
the CI lint job; the smoke script dry-run against the double.

## 23. Phase T7 — the external sources join the pattern

**Owns** the external call sites and their manners (§3.16): the live research adapters
(`src/adapters/corpus/wikipedia-live.mjs` and siblings — per-source timeout and per-turn
fetch caps as declared constants beside the existing 2 s courtesy throttle), the research
lane's budget seam in `src/services/chat.mjs`, the news page's KB lookup path in
`src/services/news.mjs` (beside its negative cache and abort seam), a small shared breaker
core (`src/domain/source-breaker.mjs`, new: §3.16's machine over injected state — the Dynamo
item on the Lambda surface through T2's module, an in-memory per-source object in the page),
the answered-without-that-source markers where a skip changed what served an answer, and
their tests (`test/domain/source-breaker.test.mjs` new; extensions to the research and news
test files). **Opus**, after T4 (serialized on `chat.mjs`).

Pins: a source failing systemically past the threshold is skipped for the rest of the visit
and the marker shows; empty results never count as failures; budgets exhaust into the
existing miss and fallback shapes; the courtesy throttle is unchanged.

Acceptance: the named test files; `npm run test:fast`; ask bundle rebuilt.

## 24. Phase T8 — page backend modes and the news corpus toggle

**Owns** `src/surfaces/web/chat-browser-entry.mjs` and `src/services/chat-page-viz.mjs` (the
slider, the `?backend=aws` boot switch, the copy flip), `src/surfaces/web/ledger-browser-entry.mjs`
and `src/services/ledger-viz.mjs` (the same treatment), unit coverage for the mode resolution
(the parameter wins, an unknown value falls back to local, the slider rewrites the URL and
reloads), and the two pages' e2e files driving both modes against the M5 double mounted
same-origin (the M8 pattern): local mode byte-identical to today including its privacy copy;
AWS mode minting the UUID, writing through the service, restoring on reload, showing the
server-side copy with the local-only wording absent; no data crossing modes.

Also owns the news page's corpus enrichment (§3.15.2): the `dynamo-corpus` KB source in
`src/surfaces/web/news-browser-entry.mjs` (registered in AWS mode only, fetching the T6
corpus read route for fact-ungrounded terms), the visible fuzzy toggle beside the page's
enrichment controls in `src/services/news-viz.mjs`, and their pins — the source grounding a
term from the fixture band through the local double with band provenance on the stored fact,
the toggle flipping `fuzzy=0|1` on the request, and the toggle absent in any mode without the
source. **Sonnet**, after M6, M8, T0, and T6.

Acceptance: the touched e2e and unit files; `npm run test:fast`.

## 25. Phase T9 — the demo grid

**Owns** `public/index.html` (the rename to `.demo-grid`/`.demo-cell`/`.demo-page`, the
chat-AWS cell, the eyebrow's count), `public/site.css` (the renamed classes),
`public/share.mjs` (the chat-AWS share posts, globally unique), `test-e2e/pages-index.test.mjs`
and `test-e2e/pages-home.test.mjs` (§3.20's composition pinned in order, the
chip-shows-page-name rule, the share-sheet click-through). **Sonnet**, after T8.

Acceptance: both page specs; the estate tier; `npm run test:fast`.

## 26. Phase T10 — docs and framing

**Owns** `docs/adapter-contract.md` (the turn surface section beside M9's backend section),
`README.md` (one consumer paragraph: host it yourself, load your bands, the demo is our
deployment), the site copy the M8 and T8/T9 phases touch, extended with the
consumer-hosted framing, and `PLAN_WIKIPEDIA_BAND.md` (new: the stub-scoped design reference
§3.13 defers to — the band's goal, the extraction question it must answer, and the pointer
back to this plan's partition layout and loader; a scoping doc for a future design wave, not
an execution plan). **Haiku**, after T5 and T9. Docs gate only.

## 27. Phase T11 — consumer handoff

**Owns** the bedrock-meter inbox note: the turn endpoint, the corpus-band loader, the
retrieval budgets, the breaker, what their embedded path can adopt (the retrieval module and
bands work identically over their table), and what stays theirs. **Haiku**, last.

## 27a. Phase T12 — the news worker and the cycle triggers

**Owns** `server/news-worker/handler.mjs` and `server/news-worker/local.mjs` (new; §3.21's
worker — the real `pollNewsSources`/`enrichTopTerms` over a fresh dynamo backend, the cycle
marker lifecycle, per-source progress, `graphVersion` bumps, the abort-on-remaining-time
budget; the local double runs the same worker in-process over the reference backend with
fixture fetchers), the two trigger routes in `server/row-service/handler.mjs` (validate,
stamp, async-invoke — with the invocation seam injectable so the local double invokes
in-process), the shared-throttle/breaker `_meta` items through T2's module,
`npm run build:news-worker`, `test/server/news-worker.test.mjs` (new; a full cycle over the
double: 202-then-rows-appear, per-source progress in the marker, the 409 while running, a
stale marker replaced, the abort budget stopping between articles with `state` done-partial,
`graphVersion` monotonic across the cycle's writes, the shared throttle read by two
concurrent "invocations"). **Plus the materializer (§3.22), tenth revision:** the worker's
cycle-end materialization and its standalone materialize mode (the turn handler's invoke
target and the ingest trigger's finish), the feed-document serializer with the 24-line
`factLines` trim and the 350 KB hard bound, `feedVersion`, the ingest trigger route, and the
worker bundling the full xl seed (§3.22's grounding-parity and gate-correctness reasoning —
its tests pin that a WordNet-only term does NOT read as novel in the worker). Test additions:
a cycle ends with a document whose cards match the store's rows; materialize mode rebuilds
without fetching (fetchers asserted uncalled); the trim rule at a fabricated 60-fact card
(24 lines + the count); the 350 KB bound's deterministic card-tail trim with `trimmed: true`;
ingest trigger end to end (text in → rows → document reflects); purge soft-deletes the
document (feed 404). **Sonnet**, after M5 and T0; parallel with T3.

Implementation notes: the ctx the worker builds is `createNewsSession`'s own shape
(news-browser-entry.mjs:213 — `{memoryDir, store, cache, lexicon, config, state, providers,
now, shouldAbort}`) minus the page concerns; reuse `createNewsFetcher` and the source registry
exactly as `rebuildFetchers()` does, and keep the store wrapper's fold-cache invalidation
(the `foldedRows = null` on every append/remove) — the worker folds the assembled store the
same way the page does. The `news-fixture:` replay fetchers the e2e uses are the local
double's fetchers.

Acceptance: the test file; `npm run test:fast`.

## 27b. Phase T13 — the refresh loop, the cycle UI, and the page weights

**Owns** `src/surfaces/web/news-browser-entry.mjs` (the `feedVersion` polling loop with
backoff; refetch-on-change; stop writing the marker's stop request — the worker's
`shouldAbort` reads it between sources), `src/services/news-viz.mjs` (the cycle marker
driving the phase UI; the fuzzy toggle riding the enrich trigger per §3.15.2),
`reports/PAGE_WEIGHTS.md` (re-measured: the thin page's before/after — the shed seed fetch
and engine bundle, published), `test-e2e/pages-news-feed.test.mjs` (the loop pins: version
poll backs off while idle; a worker cycle's document lands without any page-side ingest;
stop honoured between sources; the fuzzy flag observed by the double). **Sonnet**, after M8
and T12; parallel with T9.

Acceptance: the e2e file; `node --test test/adapters/news-browser-entry.test.mjs`;
`npm run test:fast`.

## 27c. Phase T14 — the news chat area

**Owns** `src/services/news-viz.mjs` (the chat section below `#teachPanel`: transcript,
input row, send; each turn rendering the reply as text nodes, citations through the shared
`./phrase` layer from `factsTouched`, and a collapsible narration block presented the way
chat.html presents its trace; disabled state joining the feed-unavailable posture),
`src/surfaces/web/news-browser-entry.mjs` (the turn POST against the session UUID; a
non-empty `factsTouched` sets the local expectation that the feed will move — no page-side
computation, the version poll does the rest; 429 rendered as the rate message,
`BackendUnavailable` as the chat-unavailable state), `test-e2e/pages-news-feed.test.mjs`
(the chat pins against the double + in-process worker: a teach turn returns its reply with
citations; the taught row lands in the double; the next materialization's document carries
it and the rendered feed shows it — the full §3.12 flow; a turn while the double is down
renders the unavailable state, nothing lost silently). **Sonnet**, after M8 and T3.

The turn-rate limits (§3.12) apply as to any consumer; the chat adds no new abuse surface
beyond the turn rows already in §3.9.

Acceptance: the e2e file; `npm run test:fast`.

## 28. Concurrency and model tiers

**The campaign shape, decided:** when the operator's build go comes, every phase below runs as
one continuous campaign under the standing merge/gate/push cadence — no review pauses between
phase groups. The gates are the phases' own acceptance lists and the full suite at each push
moment, nothing else. One boundary inside the campaign is named for consumers: the push that
lands **M0–M4 plus M9's contract doc** is a publishable npm cut — the library half whole
(projection, dispatch, kit, sqlite conformance, DynamoDB backend, docs) with nothing of the
service required — and bedrock-meter's backend phases pin that version. The campaign does not
pause there; the cut is a version number their side can depend on, not a review gate.

| phase | files | tier | after | parallel with |
| --- | --- | --- | --- | --- |
| M0 projection | rows.mjs, row-backend.mjs | Opus | — | — |
| M1 dispatch | core.mjs, chat-session.mjs, init.mjs, research-queue-store.mjs | Opus | M0 | M2 |
| M2 reference + kit | row-backend-memory.mjs, memory-backend-conformance.mjs, package.json | Sonnet | M0 | M1 |
| M3 sqlite conformance | core.mjs | Opus | M1, M2 | M4 |
| M4 DynamoDB backend | row-backend-dynamo.mjs, backends-exports.mjs | Sonnet | M2 | M3 |
| M5 service handler + double | server/row-service/ | Sonnet | M2, M4 | M6 prep |
| M6 HTTP client | http-row-backend.mjs | Sonnet | M5 | M7 |
| M7 infra + deploy | infra/, CI | Sonnet | M5 | M6 |
| M8 news.html goes thin | news-browser-entry.mjs, news-viz.mjs, build-news-bundle.mjs, news e2e | Sonnet | M5, T3, T12 | M9 prep |
| M9 docs (backend) | contract doc, README | Haiku | M6, M7 | — |
| M10 handoff (backend) | bedrock-meter inbox | Haiku | all M | — |
| T0 bands + loader + pipelines | corpus-bands.mjs, corpus-loader.mjs, cli-verbs.mjs, scripts/corpus-bands/ | Sonnet | M4 | T1, T2 |
| T1 retrieval + calibration harness | retrieval-plan.mjs, subgraph-retrieval.mjs, calibrate-retrieval.mjs | Opus | M0 | T0, T2 |
| T2 corpus breaker | dynamo-circuit-breaker.mjs | Sonnet | M4 | T0, T1 |
| T3 turn handler | server/turn-service/ | Sonnet | T0–T2, M5 | T4 |
| T4 enumeration marker | chat.mjs, corpus rows | Opus | T1 | T3 |
| T5 turn e2e | turn-service e2e | Sonnet | T3, T4 | T6 |
| T6 turn infra + corpus route + CI load | infra/, row-service handler, .gitlab-ci.yml | Sonnet | T3 | T5 |
| T7 external-source manners | research adapters, chat.mjs, news.mjs, source-breaker.mjs | Opus | T4 | T8 |
| T8 page modes + news corpus toggle | chat/ledger entries + viz, news entry + viz, page e2e | Sonnet | M6, M8, T0, T6 | T7 |
| T9 demo grid | index.html, site.css, share.mjs, page specs | Sonnet | T8 | — |
| T10 docs (surface) | contract doc, README, site copy | Haiku | T5, T9 | — |
| T11 handoff (surface) | bedrock-meter inbox | Haiku | all | — |
| T12 news worker + triggers + materializer | server/news-worker/, row-service handler | Sonnet | M5, T0 | T3 |
| T13 refresh loop + cycle UI + page weights | news-browser-entry.mjs, news-viz.mjs, PAGE_WEIGHTS.md, news e2e | Sonnet | M8, T12 | T9 |
| T14 news chat area | news-viz.mjs, news-browser-entry.mjs, news e2e | Sonnet | M8, T3 | T9 |

`core.mjs` serializes M0-knowledge → M1 → M3. `chat.mjs` serializes T4 → T7 and either
against anything else touching it. `news-browser-entry.mjs`/`news-viz.mjs` serialize
M8 → T13 → T14 in that order (T8's news-side fuzzy toggle lands with T13 — same files, one
owner at a time). M8's dependency on T12 and T3 pulls the news-page work to the campaign's
back half; the deployed page runs exactly as today until M8's push, then flips thin in one
release. `package.json` is touched in M2 and M4 only. T6's CI load job is demo-blocking on all
three T0 pipelines (§3.18 moved WordNet and ConceptNet out of the bundle, so their bands are
base competence, not extras). The full suite runs at the coordinator's push moments; each
phase's acceptance list is its blast radius.

---

## 29. Known sharp edges

The operator's design reviews named these. Each gets a stance here; "accepted" means the plan
ships with it and says so, not that it hides.

1. **The cold open is a partition scan, not O(rows-touched).** Accepted for v1 (§3.5): the
   engine is synchronous over one payload, the caps bound the scan, and the sk layout means
   the term-lazy fix (§30) lands with no storage migration. The spec's stricter reading is
   deferred engine work, named as such.
2. **Concurrent supersession under last-write-wins.** Fixed by representation, not accepted:
   §3.2 makes supersession additive rows, M0 tests the union assembly, M1 races two live
   handles, and the kit carries the check (§4). In-place supersession mutation is a projection
   bug by definition.
3. **Cache staleness across a warm process.** Accepted with its bound stated (§3.6): a second
   writer's rows appear at the next cold open; derived rows recompute on load. Two tabs on one
   news session are two writers and see each other only on reload. The serverless consumer
   sidesteps it entirely by constructing a fresh backend per invocation (§3.10) — the
   documented pattern, and what bedrock-meter does. No partition version, no ETag in v1; if
   the staleness bites a real consumer, an `If-None-Match` on GET /api/rows is the cheap add
   and the endpoint table leaves room for it.
4. **`deleteAll` is query-then-mark, non-atomic.** Accepted, ordered, and made retryable: the
   purge marks rows, then meta — never the session's rate-counter rows, so a purge cannot
   reset the mutation-rate limit — and the global counter is untouched throughout (§3.8). The
   purge is idempotent: a crash mid-way leaves some rows marked, a retried DELETE marks the
   rest (re-marking is a no-op-shaped Update), and the client retries the `{all: true}` DELETE
   once on 5xx. Until the retry lands, unmarked rows remain readable — the residue of a
   half-purge is visibility, bounded by the retry and by TTL. The page discards its stored key
   regardless, so the visitor's pointer to any residue is gone even while fragments wait for
   TTL to remove them physically.
5. **The 4 KB cap as a runtime failure.** Mitigated at the earliest honest point (§3.2): the
   projection throws before the network with the offending fact's provenance named, the M0
   boundary test pins it, and the service 400 is the backstop. Discovery stays possible at
   run time — an article sentence can always be pathological — but it fails loudly in the
   turn that caused it, never as a silent drop.
6. **Meta read-modify-write races on the research queue.** Fixed by representation (§3.1):
   queue and dedup entries are individual bookkeeping rows, additive under concurrency. The
   two values left in meta are a watermark whose regression costs one recompute and a nodeId
   written once.
7. **The global counter drifts.** TTL reaping deletes rows outside the service's write paths,
   so the counter over-counts between reconciles, and the two writes inside a mutating request
   (the rows, then the `ADD`) are not one transaction, so a crash between them mis-counts by
   one batch. Deletes add nothing to the drift — they never touch the counter (§3.8). Both
   sources drift the same direction — over-refusal, never past the cap — and the daily
   reconcile rewrites the counter from a real physical count, tombstoned rows included, since
   they occupy the table until TTL takes them. Accepted with that direction stated; a table
   refusing writes it could take for at most a day is the cheap side of the trade.
8. **Soft-deleted rows are load until TTL.** A tombstoned row still counts toward the cap (by
   design — that is the cost protection) and still travels inside the backend's Query pages
   before the filter drops it, so a session that deleted heavily reads slightly slower than an
   empty one until TTL clears the tombstones. Bounded by the same arithmetic as everything
   else: the mutation-rate limit bounds how many tombstones a session can mint, and the TTL
   window bounds how long they sit. Re-marking already-marked rows burns one write unit per
   idempotent call, bounded by the same rate limits.
9. **Beyond-k discoveries.** A chain that would need a term more than k hops from any query
   term misses, honestly. Mirrored bounds make it rare; the retrieval metrics in every
   narration are the evidence base for ever raising k, and raising k is a one-constant change
   priced in Queries.
10. **Corpus staleness between loads.** A band is as fresh as its last `corpus load`; answers
    cite the band, and the manifest carries version and load time. Accepted: bands are
    reference corpora, not news.
11. **Breaker flap.** A partial brownout can oscillate open/half-open/open. The cooldown and
    threshold are fixed constants tuned once from the metrics; flap's worst case is
    alternating honest modes, both marked. The in-page breaker cannot flap past a visit — its
    state dies with the page.
12. **Marker coverage.** An enumeration-class lane that never reads the retrieval flag would
    silently claim completeness. T4's lane-inventory test is the guard; a new enumeration lane
    fails it until it reads the flag.
13. **Retrieval cost per turn.** Up to 40 Queries inside 300 ms, bounded and metered, but
    real: the per-session metering and the turn rate cap bound the aggregate, and the
    narration metrics price every turn.
14. **Hot band partitions.** Popular terms concentrate reads on one `corpus:<band>` pk.
    At this surface's turn rates the per-partition throughput ceiling is far away; if a load
    test ever finds it, band sharding by term prefix (`corpus:<band>#a`…) is the lever, a
    loader-and-helper change with no service or engine impact.
15. **Fuzzy false friends.** A variant within edit distance that means something else pulls
    irrelevant rows. The collision table already exists to guard exactly this class; variants
    stay capped, deterministic, and unranked, so the worst case is wasted rows inside the
    budget, never a wrong answer — grounding still has to succeed on the engine's own terms.
    T1's harness measures both modes before the budgets freeze, and the per-request knob
    (§3.15.2) means a bad experience is one toggle from an exact-only comparison.
16. **The mid-bundle breaker floor.** With the heavy bands moved to corpus partitions
    (§3.18), breaker-open mode answers from ~14k facts instead of ~63k: common vocabulary,
    persona and ontology hold, WordNet/ConceptNet depth does not. The trade bought a
    one-second-class cold start (measured and published in T3's build marker; provisioned
    concurrency stays the priced lever if even that disappoints). The supplement-absent
    marker (§3.17) carries more weight under this floor — it is the reader's only signal
    that a thin answer came from the degraded mode and not from the engine — and T4's pins
    cover the marker in breaker-open mode explicitly.

17. **The feed's staleness window is the design.** Between a write's acknowledgement and the
    materializer's finish, `GET /api/feed` serves the previous document — seconds, closed by
    the version poll without user action (§3.22). Accepted: the alternative (the page
    computing anything) is the in-page graph this revision removed. The chat states nothing
    about the feed for exactly this reason.
18. **The feed document has a ceiling and a trim.** One meta item, 400 KB hard, 350 KB
    enforced, `factLines` trimmed at 24 per card and whole-card-tail trimmed beyond that,
    `trimmed: true` when it happens (§3.22). The drill-down bound is display-only — the rows
    are all in the store — but a reader of a trimmed card sees 24 lines and a count, and the
    document says so rather than pretending completeness.
19. **news.html has no offline anything, and the worker is heavy on purpose.** The dead
    degraded mode is a decision, recorded in §3.7 — an unreachable service leaves the page
    honestly idle. And the worker bundles the full xl seed where the turn Lambda bundles the
    mid set (§3.22): grounding parity and the novelty gate's prior-term universe are
    correctness, and the 202 hides the cold start. Anyone "optimizing" the worker onto the
    mid set re-opens the junk-hub hole the newsworthiness plan closed.

And the two build risks carried from the first draft: **the M3 sqlite refactor** rewrites
Backend C's persistence internals under a byte-identical-storage pin — the before/after dump
comparison is the guard, and a differing dump stops the phase; **the browser seed overlay**
must never leak into writes — M1's diff runs against base ⊕ rows by construction and its
seeded-base test asserts `putRows` never receives a seed row.

## 30. Not in this plan

The spec's own non-goals (§9), adopted: cross-session shared knowledge, search, multi-region,
sqlite-store migration, answer-composition changes beyond §3.17's marker. Also out, each with
its standing pointer:

- **True term-lazy resolution** — partial reads feeding an async resolver, for the 10⁴
  sessions/day, 10³ facts/session headroom envelope. Retrieve-then-resolve (§3.15) covers the
  bounded reach the engine actually has; if measurement ever shows those bounds pinching —
  point misses beyond k at meaningful rates, or enumeration bounds users refuse — the folds
  going async over `readRowsByTerm` remains the named engine work, its own plan. The index
  key (§3.3) still needs no migration for it; nothing here forecloses it.
- **Merge semantics beyond additive rows and last-write-wins.** Offline-first browser
  persistence, reconciling a forked local copy, cross-mode data movement (§3.19), and
  multi-writer merge all live behind `docs/references/papers/crdt.md`, the standing design
  authority; rows being content-addressed and order-independent is the groundwork it would
  build on.
- **Local persistence for news.html, in any form.** The page's durability is the service and
  nothing else (§3.7); rows kept locally across a lost connection would fork from the server
  copy, which is the merge problem above.
- **The wikipedia-derived band.** The three first-class bands' pipelines are in scope (T0);
  the wikipedia-derived band is not — extracting article facts at scale is its own design
  problem, deferred to `PLAN_WIKIPEDIA_BAND.md` (a stub-scoped design reference T10 authors).
  The partition name is reserved (§3.13) and nothing else here builds toward it.
- **chat.html and ledger.html as thin clients.** Those pages keep their in-page engines in
  every mode — that is the product claim, and they never call the turn endpoint. news.html is
  the one thin page, by the operator's tenth-revision directive (§3.7); extending that shape
  to any other page is out of scope here and would be its own decision against the same
  product claim.
