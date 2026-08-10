# PLAN_MEMORY_BACKEND.md — a pluggable session-memory backend: injected row stores, a conformance kit, and news.html as the second consumer

Status: DESIGN. Nothing in this plan is built. The consumer requirements it answers are
bedrock-meter's `GRAPH_BACKEND_SPEC.md` (untracked in their repo, carried over by the operator;
its section numbers are cited as spec §N throughout). The seam it formalizes already exists in
embryo: `src/adapters/memory/core.mjs` routes every read and write through one opaque
`memoryDir` token today, and this plan turns that token's closed set into an open one.

This plan is written to be built by Sonnet-tier implementers with no further design work, with
the two `core.mjs` phases marked for Opus. Every phase names its module paths, data structures,
function signatures, test files, and acceptance commands. The hard decisions (the interface, the
row shape, the index key, where bookkeeping lives, what the conformance suite can and cannot
check) are fixed here, in writing.

The feature in one paragraph: `createSession`/`runTurn` accept an injected backend object
beside today's `"memory"`/`"sqlite"` strings. The backend is a small async row store bound to
one opaque session key. tmct assembles its working payload from the backend's rows, writes back
only the rows a turn changed, and keeps every sidecar (the syllogise watermark, the node id, the
research queue, the researched-terms dedup set) behind the same object. tmct ships the contract
as a published conformance kit, the way the repository interface already ships one. Three
implementations prove it: the in-tree in-memory reference backend, the existing sqlite backend
refactored to pass the same suite, and news.html's new IndexedDB backend, which makes a
visitor's news session survive a reload on the same device and gives "stop & forget" a real
delete-by-key. bedrock-meter's DynamoDB adapter becomes the third consumer, on their side,
against the published suite.

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
payload patched in lockstep. The sqlite DDL is already row-oriented: `individuals`, `relations`,
`edges`, `facts`, `meta`. The projection this plan factors out is the same one that code
performs inline today.

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
- **The graph and lexicon are read-only inputs per session and out of scope.** Only mutable
  session memory moves behind the seam. The reference pack stays bundled and offline.
- **Best-effort in the browser, honest everywhere.** A missing IndexedDB degrades to in-memory
  rows and the page still works. A backend failure inside a turn surfaces as an error, never as
  a silently partial answer.

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
  deleteRows(rowKeys),        // remove by key; missing keys are a no-op
  readRowsByTerm(term),       // OPTIONAL: rows whose index term matches; absent → core reads readRows()
  readMeta(key),              // → string | null   (sidecar values, JSON-encoded by the caller)
  putMeta(key, value),        // upsert one sidecar value
  deleteAll(),                // remove every row and meta entry this session key reaches (spec §4)
  close(),                    // release connections; further calls may reject
}
```

Decisions folded into that shape:

- **Session binding at construction.** The object is already scoped to one opaque session key
  the consumer chose (spec §4). tmct never sees the key, the table name, credentials, or an SDK.
  This matches how `memoryDir` is per-session today.
- **Batch, then per-row atomicity.** `putRows` takes the batch (`appendFacts`' research fan-out
  lands in one call, spec §3.1) and promises only per-row atomicity. A batch that half-lands
  leaves individually valid rows, which is exactly what the spec asks and what row-keyed KV
  stores give natively.
- **The optional term read.** `readRowsByTerm` is in the contract so the index shape (§3.3) is
  settled now, and the conformance suite exercises it when present. Core's v1 read path does not
  call it (§3.5 explains why and what changes later).
- **Meta is part of the seam** (spec §3.4). The syllogise watermark, node id, research queue,
  and the researched-terms dedup set all become `readMeta`/`putMeta` keys
  (`"syllogiseState"`, `"nodeId"`, `"researchQueue"`, `"researchedTerms"`). The sqlite backend
  already has the `meta` table this maps onto. `research-queue-store.mjs` keeps its file path
  for Backend C tokens and gains the meta path for row backends, so the queue stops being
  consumer glue.

### 3.2 The wire row

The backend stores opaque, versioned rows. It needs no understanding of tmct's payload beyond
three indexable fields:

```js
{
  rowKey: "fact:1a2b…",   // stable id; facts are content-addressed by factIdFor, so the same
                           // triple is the same rowKey on every device
  rowClass: "fact",        // closed set: fact | source | utterance | session | rule |
                           //             retraction | edge-group | bookkeeping
  term: "tariff",          // the canonical index term (normFactTerm of the subject) for fact
                           // rows; "" for row classes with no term read path
  json: "…",               // the serialized record, ≤ 4 KB (spec §4); the projection enforces it
  expiresAt: 1739145600,   // OPTIONAL epoch seconds; stamped by the adapter from the consumer's
                           // TTL policy, absent when no policy is set
}
```

- **`rowClass` is the structural bookkeeping gate** (spec §3.7). Internal rows — the `tmct:needs`
  queue markers and anything else that must never compose into a visitor-facing answer — are
  written with `rowClass: "bookkeeping"`. Read paths exclude them by field, never by string
  matching on content, and an adapter can partition or filter them at the storage level.
- **The projection lives in one module.** `src/adapters/memory/rows.mjs` owns
  `payloadToRows(payload)` and `rowsToPayload(rows)`, factored from what `persistSqlitePayload`
  does inline today, plus `diffRows(before, after)` returning `{ puts, deletes }`. Round-trip
  identity (`rowsToPayload(payloadToRows(p))` equals `p` up to key order) is a unit-tested
  invariant, and `rowsToPayload` sorts by `rowKey` before assembly so arrival order never
  reaches a resolver (the crdt.md rule).

### 3.3 The index key, settled now

For fact rows, `term` is the normalized subject term. The recommended adapter key layout, which
bedrock-meter's single-table Store maps onto directly:

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
sqlite path does. `basePayload` is a read-only overlay for seed graphs (the browser case, §3.7):
seed rows are never written back, and the diff runs against base plus rows so only
session-written deltas persist.

### 3.5 Statelessness and the latency budget, stated honestly

tmct's resolution layer is synchronous over one assembled payload: `readFactRows`, the folds,
contradiction checks, and syllogise all read the whole session store, and that store is the
turn's working set. So the v1 read path is: one `readRows()` per cold open, assembled once,
cached for the process's lifetime, with row-level writes thereafter.

Against the spec's budget (§4): at the stated demo envelope (≤ ~40 facts/session, ≤ 4 KB rows)
a cold open is one paginated query returning the session's rows, in-region ~5–15 ms, and a
warm turn's backend time is its writes alone. That sits inside p50 ≤ 25 ms with margin and
replaces two whole-archive S3 round trips plus a whole-store write-back. The stricter reading
of "O(rows actually read this turn)" — term-indexed partial reads feeding a lazy resolver — is
a real engine change (async reads inside currently-synchronous folds) and is the named horizon
(§9), which is why the index key is settled now: when core starts calling `readRowsByTerm`,
no adapter or table changes.

### 3.6 Concurrency, TTL, determinism

- **Concurrency** (spec §4): fact rows are content-addressed, so two simultaneous turns on one
  session key land distinct rows, or the same row with identical content. Derived rows (class
  counts, materialised heads) are last-write-wins per rowKey and recomputable from the fact
  rows on the next load, so an interleaving costs staleness, never corruption. No
  turn-serialization guarantee is required from the consumer.
- **TTL** (spec §4): a consumer policy the adapter enforces. The adapter stamps `expiresAt`;
  expired rows are simply absent on read. tmct core neither reads nor writes clocks in the
  contract.
- **Determinism**: rows round-trip byte-stable, read order never carries meaning, and the
  assembled payload is a pure function of the row set (§3.2's sort). The conformance suite
  feeds one row set in two different orders and demands identical payloads.

### 3.7 news.html, the second consumer

`createBrowserRowBackend({ dbName, sessionKey, stamp, indexedDB })` in
`src/surfaces/web/idb-row-backend.mjs`: an IndexedDB implementation of the §3.1 contract, one
object store keyed by rowKey with `rowClass` and `term` in the record, inheriting
`idb-persist.mjs`'s best-effort contract wholesale — no IndexedDB (private mode, quota, denial)
degrades to in-memory rows for the visit, a `stamp` mismatch discards stored rows on open, and
nothing ever blocks boot. The taught-facts promise keeps its exact current terms: kept
best-effort on this device, never sent anywhere.

`createNewsSession` swaps `createInMemoryStore()` for the row backend with the 61k-fact seed as
`basePayload` (seed rows never touch IndexedDB; only session-written rows persist). Two visible
behaviour changes, both pinned:

- a reload on the same device restores the session's polled and taught rows, so a returning
  visit's feed rebuilds from real rows instead of starting empty;
- "stop & forget" calls `deleteAll()`, so the purge empties the device store, and the existing
  e2e ("stop & forget clears the start preference and purges the articles") extends to assert
  the IndexedDB store holds zero rows afterwards.

The point of this consumer: it proves the contract on a storage engine with none of DynamoDB's
shape (transactions, sort keys, TTL) before bedrock-meter writes the third implementation.
chat.html keeps its whole-snapshot `idb-persist.mjs` wrapper unchanged; moving it onto the row
backend is a named follow-on (§9), a separate track because its export/paste controls serialize
whole payloads.

### 3.8 Adapting bedrock-meter's Store shape

Their offered seam (single-table `pk`/`sk`, `put/get/update/del/query(skPrefix)/batchGet/add`)
adapts in roughly a hundred lines: `readRows` → `query("")` paginated; `putRows` → looped
`put` (their seam has no batch write; per-row atomicity holds either way); `readRowsByTerm` →
`query("fact#<term>#")`; meta → `put`/`get` under `sk = "meta#<key>"`; `deleteAll` → `query`
then looped `del` (documented as their seam's cost, no native truncate). The adapter and its
tests are theirs (spec §7); the acceptance is that it passes the published suite unmodified.

---

## 4. The operational contract as checks

| requirement (spec §4) | conformance-checkable | how |
| --- | --- | --- |
| stateless open, no bulk load | partly | tmct-side integration test asserts one `readRows()` per cold `loadMemory` (spy backend); O() itself is design, §3.5 |
| per-fact atomicity, no cross-fact transactions | yes | a poisoned batch (one row rejected by a wrapping test backend) leaves the others readable and valid |
| row-level concurrency, both writers land | yes | two handles on one key interleave `putRows`; the suite asserts both fact rows present |
| delete-by-key reachability | yes | `deleteAll()` then `readRows()` empty and every meta key null |
| meta round-trip | yes | put/get/absent-is-null for each named key |
| bookkeeping exclusion | yes | a `rowClass: "bookkeeping"` row round-trips but never surfaces in `rowsToPayload`'s answer-facing individuals |
| determinism / order independence | yes | one row set, two arrival orders, identical assembled payloads |
| ≤ 4 KB rows | yes | the projection rejects an oversized row at `payloadToRows` time with a named error |
| TTL enforcement | no — adapter-documented | time-driven; the suite asserts only that `expiresAt` round-trips untouched |
| latency budget | no — consumer-measured | bedrock-meter's e2e owns the §4 numbers, as their spec §7 already states |
| lazy SDK, no import-time IO | no — adapter-documented | stated in the contract doc; unobservable from inside the suite |

---

## 5. Phase M0 — the row projection (`rows.mjs`)

**Owns** `src/adapters/memory/rows.mjs` (new), `src/adapters/memory/row-backend.mjs` (new:
the contract doc-comment, `isRowBackend`, the row-shape validator), `test/adapters/memory-rows.test.mjs`
(new). Serialized on `core.mjs` knowledge, no `core.mjs` edits yet. **Opus.**

Deliver `payloadToRows`, `rowsToPayload`, `diffRows` per §3.2, factored to match what
`persistSqlitePayload` stores today (same tables, same fields, expressed as wire rows). Unit
tests: round-trip identity on a seeded fixture payload, sort-before-assembly order independence,
the 4 KB rejection, `rowClass` classification for every individual class in the store including
a `bookkeeping` row, and `diffRows` producing the minimal put/delete sets for an append, a
supersession, and a retraction.

Acceptance: `node --test test/adapters/memory-rows.test.mjs`; `npm run test:fast`.

## 6. Phase M1 — Backend D dispatch

**Owns** `src/adapters/memory/core.mjs` (the dispatch sites: `openMemoryBackend`,
`loadMemory`, `persistMemory`, `loadSyllogiseState`/`saveSyllogiseState`,
`loadNodeId`/`saveNodeId`, `isMemoryOrSqliteHandle` widened to cover row handles),
`src/services/chat-session.mjs` (accept an object `memoryBackend`), `src/services/init.mjs`
(same for the seed path), `src/adapters/research-queue-store.mjs` (meta path for row backends),
`test/adapters/memory-row-backend.test.mjs` (new). **Opus**, serialized after M0.

The wrapped handle, cache, and base-overlay semantics are §3.4 verbatim. The integration test
drives `appendFact`/`appendFacts`/`removeFacts`/`readFactRows`/`loadMemory` through a spy row
backend and asserts: one `readRows` per cold load, delta-only `putRows` per mutate, sidecars
landing in meta, and byte-identical answers between a sqlite-backed and a row-backed session
running the same taught turns (the storage-seam-not-behaviour-change pin).

Acceptance: `node --test test/adapters/memory-row-backend.test.mjs test/adapters/memory-rows.test.mjs`;
`npm run test:fast`; CLI smoke `printf 'hi\n/exit\n' | node bin/tmct.mjs`.

## 7. Phase M2 — the reference backend and the conformance kit

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

Acceptance: `node --test test/adapters/memory-sqlite-conformance.test.mjs` plus the existing
memory/store test files; `npm run test:fast`.

## 9. Phase M4 — the browser row backend

**Owns** `src/surfaces/web/idb-row-backend.mjs` (new, §3.7's construction), `test/adapters/idb-row-backend.test.mjs`
(new: the whole contract against the same injectable `indexedDB` stub style `idb-persist.mjs`'s
tests use, plus the kit run against it with the stub). **Sonnet**, after M2.

Acceptance: `node --test test/adapters/idb-row-backend.test.mjs`; `npm run test:fast`.

## 10. Phase M5 — news.html consumes it

**Owns** `src/surfaces/web/news-browser-entry.mjs` (construction wiring: the row backend with
the seed as `basePayload`; `revokeConsent` calls `deleteAll()`), `src/services/news-viz.mjs`
(only if the returning-visit copy needs a line), `test/adapters/news-browser-entry.test.mjs`,
`test-e2e/pages-news-feed.test.mjs` (the two §3.7 pins: reload restores session rows;
stop-&-forget leaves zero rows in the device store, asserted by `page.evaluate` against the
page's own IndexedDB). **Sonnet**, after M1 and M4. The news e2e's hard-won waits (sleep-then-
evaluate loops, `waitUntil: "load"`, the seed copy into the snapshot) all stay as they are.

Acceptance: `node --test test/adapters/news-browser-entry.test.mjs`;
`node --disable-warning=ExperimentalWarning --test test-e2e/pages-news-feed.test.mjs`;
`npm run test:fast`.

## 11. Phase M6 — the contract page and README

**Owns** `docs/adapter-contract.md` (a memory-backend section beside the existing provider
seam: the §3.1 method table, the row shape, the key recommendation, the adapter-documented
items from §4), `README.md` (a short consumer paragraph: inject an object, run the suite, link
to the contract doc). **Haiku**, after M2 and M3. Docs gate only: `npm run check:links`,
estate tier, `test:fast`.

## 12. Phase M7 — hand it to bedrock-meter

**Owns** `~/.claude/inboxes/bedrock-meter.md` (append-only note). **Haiku**, last. The note
names: the export subpath and kit entry point, the contract doc location, the row shape and
recommended pk/sk layout (§3.3), the meta keys, the §4 split between conformance-checked and
adapter-documented, and the two spec asks answered differently than written — reads are
session-scoped per §3.5 with the term-read path settled but dormant, and `deleteAll` over their
Store shape is query-then-delete. Their spec §7/§8 items (the adapter, its tests, the live e2e,
S3-path retirement) stay theirs.

---

## 13. Concurrency and model tiers

| phase | files | tier | after | parallel with |
| --- | --- | --- | --- | --- |
| M0 projection | rows.mjs, row-backend.mjs | Opus | — | — |
| M1 dispatch | core.mjs, chat-session.mjs, init.mjs, research-queue-store.mjs | Opus | M0 | M2 |
| M2 reference + kit | row-backend-memory.mjs, memory-backend-conformance.mjs, package.json | Sonnet | M0 | M1 |
| M3 sqlite conformance | core.mjs | Opus | M1, M2 | M4 |
| M4 browser backend | idb-row-backend.mjs | Sonnet | M2 | M3 |
| M5 news.html wiring | news-browser-entry.mjs, news e2e | Sonnet | M1, M4 | M6 |
| M6 docs | adapter-contract.md, README.md | Haiku | M2, M3 | M5 |
| M7 inbox handoff | bedrock-meter inbox | Haiku | all | — |

`core.mjs` serializes M0-knowledge → M1 → M3; `package.json` is touched only in M2. The full
suite runs at the coordinator's push moments, per the standing rule; each phase's own acceptance
list is its blast radius.

## 14. Costs and risks

- **The M3 refactor is the risky phase.** It rewrites Backend C's persistence internals under a
  byte-identical-storage pin. The before/after dump comparison in its test is the guard; if the
  dump differs, the phase stops and the difference is diagnosed, never waved through.
- **The browser seed overlay must never leak into writes.** M1's diff runs against base ⊕ rows
  by construction; M1's integration test includes a seeded-base case asserting `putRows` never
  receives a seed row.
- **Two concurrent Lambda turns share no cache.** Each cold open reads the session's rows, so
  cross-container read-back (bedrock-meter's pinned e2e) holds by construction; staleness
  between two live containers is bounded by §3.6's recompute-on-load rule.

## 15. Not in this plan

The spec's own non-goals (§9), adopted: cross-session shared knowledge, search, multi-region,
sqlite-store migration, answer-composition changes. Also out, each with its standing pointer:

- **Term-lazy resolution** — partial reads feeding an async resolver, for the 10⁴ sessions/day,
  10³ facts/session headroom envelope. The index key (§3.3) is settled so this lands without a
  table migration; the engine work (async folds) is its own future plan.
- **Merge semantics beyond row-level last-write-wins.** `docs/references/papers/crdt.md` is the
  standing design authority if multi-writer merge is ever wanted; nothing here forecloses it,
  since rows are content-addressed and order-independent already.
- **chat.html on the row backend.** It keeps `idb-persist.mjs`'s whole-payload snapshot until a
  follow-on moves its export/paste controls onto row serialization.
