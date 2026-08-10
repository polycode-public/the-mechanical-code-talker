# PLAN_MEMORY_BACKEND.md — a pluggable session-memory backend: injected row stores, a conformance kit, and the deployed news demo running on a tmct-owned AWS row service

Status: DESIGN, revised once. The first draft made news.html an IndexedDB consumer; the operator
redirected it (2026-08-10): the deployed news demo must BE the AWS-backed architecture, fronted by
a new row service in tmct's own stack. The consumer requirements it answers are bedrock-meter's
`GRAPH_BACKEND_SPEC.md` (untracked in their repo, carried over by the operator; its section
numbers are cited as spec §N throughout). The seam it formalizes already exists in embryo:
`src/adapters/memory/core.mjs` routes every read and write through one opaque `memoryDir` token
today, and this plan turns that token's closed set into an open one.

This plan is written to be built by Sonnet-tier implementers with no further design work, with
the two `core.mjs` phases marked for Opus. Every phase names its module paths, data structures,
function signatures, test files, and acceptance commands. The hard decisions (the interface, the
row shape, the index key, where bookkeeping lives, the service's endpoints and caps, what the
conformance suite can and cannot check) are fixed here, in writing.

The feature in one paragraph: `createSession`/`runTurn` accept an injected backend object beside
today's `"memory"`/`"sqlite"` strings. The backend is a small async row store bound to one opaque
session key. tmct assembles its working payload from the backend's rows, writes back only the
rows a turn changed, and keeps every sidecar behind the same object. tmct ships the contract as a
published conformance kit, the way the repository interface already ships one. Four
implementations prove it: the in-tree in-memory reference backend, the existing sqlite backend
refactored to pass the same suite, an HTTP client backend, and the server side of that client — a
new row service in tmct's own AWS stack (Lambda + DynamoDB behind the existing CloudFront
distribution) that the deployed news.html writes its session facts through. bedrock-meter's
DynamoDB adapter is a further consumer, on their side, over their own table, against the
published suite.

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
- **The privacy split is explicit and honest.** chat.html's promise — taught facts kept
  best-effort on this device, never sent anywhere — is unchanged, to the word. news.html makes a
  different promise and says so on the page: facts taught or polled there are stored server-side
  against an anonymous session, expire after seven days, and "stop & forget" deletes them.
  Neither page borrows the other's wording.
- **Best-effort in the browser, honest everywhere.** The service being unreachable never blocks
  the page: the seed is a static asset and the in-page payload needs no store, so the visit
  runs — without persistence, saying so. A failed write surfaces visibly, never as a silently
  dropped row, and nothing is ever stored locally on the news page.
- **Fixture-true testing.** No test reaches live AWS. The service's own handler, run locally
  over the reference backend, is the test double; the live check is the post-deploy smoke probe,
  which is measurement, not a test tier.

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
  This matches how `memoryDir` is per-session today. (The browser is the one consumer that never
  sees the key either — §3.8's service minted it and holds it in an HttpOnly cookie.)
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
  queue markers, research-queue entries, the researched-terms set, and anything else that must
  never compose into a visitor-facing answer — are written with `rowClass: "bookkeeping"`. Read
  paths exclude them by field, never by string matching on content, and an adapter can partition
  or filter them at the storage level.
- **Mutation is additive.** A supersession or retraction projects as its own new row (the
  `retraction` class, or a new fact-version row), never as an in-place rewrite of the superseded
  row's `json`. Two turns superseding concurrently then both land, and assembly applies both;
  last-write-wins can only lose a write when two rows share a key, and additive rows never do.
  `payloadToRows` enforces this shape; M1's integration test races two handles to prove it.
- **The 4 KB cap fails before the network.** `payloadToRows` rejects an oversized row with a
  named error carrying the offending fact's provenance, at projection time — before any
  `putRows`, local or HTTP. The service's own 400 (§3.8) is the backstop, not the discovery
  point. A single fact that big is an extraction pathology and the turn fails loudly.
- **The projection lives in one module.** `src/adapters/memory/rows.mjs` owns
  `payloadToRows(payload)` and `rowsToPayload(rows)`, factored from what `persistSqlitePayload`
  does inline today, plus `diffRows(before, after)` returning `{ puts, deletes }`. Round-trip
  identity (`rowsToPayload(payloadToRows(p))` equals `p` up to key order) is a unit-tested
  invariant, and `rowsToPayload` sorts by `rowKey` before assembly so arrival order never
  reaches a resolver (the crdt.md rule).

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
replaces two whole-archive S3 round trips plus a whole-store write-back. The row caps (§3.8)
bound the cold-open response for the browser consumer: 1,000 rows × 4 KB is a 4 MB worst case,
and a real news session is tens of kilobytes. The stricter reading of "O(rows actually read
this turn)" — term-indexed partial reads feeding a lazy resolver — is a real engine change
(async reads inside currently-synchronous folds) and is the named horizon (§16), which is why
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

### 3.7 news.html: the deployed demo runs on the row service

The deployed news page IS the AWS architecture. The engine still runs in-page; what changes is
where its session rows live:

```
news.html (engine in-page, seed graph as basePayload, never persisted)
  └─ injected backend: createHttpRowBackend()  — the §3.1 contract over fetch,
     same-origin /api/*, credentials included, no key in JS
       └─ CloudFront behavior /api/* on the existing distribution
            └─ row service Lambda (§3.8)
                 └─ DynamoDB session table (pk = server-minted session key)
```

- **The session starts at consent.** Before the visitor presses start, the page makes zero API
  calls and runs in-memory over the seed — the same posture as today, where nothing is fetched
  before that press. The start press mints the server session (POST /api/session) beside the
  poll consent it already grants. The e2e pins pre-consent network silence through the page's
  own request log plus route interception.
- **Writes are synchronous.** A turn is not done until its rows are durable: `persistMemory`
  awaits the PUT. The cost is one round trip per mutating turn — the diff batches a whole
  poll's stored facts into one `putRows` call — roughly 20–60 ms from the UK to eu-west-2 and
  100–300 ms from far geographies, paid once per poll cycle or teach, on a page whose polls
  already spend seconds ingesting. Honesty over latency, chosen deliberately.
- **Unreachable service: the visit runs without persistence, and says so.** The page boots
  regardless — the seed is a static asset and the in-page payload assembly needs no store. If
  the mint or the cold-open GET fails, or a write fails mid-visit, the page states through the
  existing status affordances that persistence is unavailable; the visit continues on the
  in-page payload alone, further writes are not attempted until the page reloads, and a reload
  in that state starts fresh. Nothing is ever stored locally on this page — no IndexedDB, no
  localStorage beyond the existing start-consent preference — so an unpersisted visit's rows
  live exactly as long as the tab.
- **The copy tells the truth.** The consent moment and the page's persistence note say: facts
  taught or polled here are stored against an anonymous session on our server, expire after
  seven days, and "stop & forget" deletes them now. "Stop & forget" wires its purge to
  `deleteAll()` (DELETE /api/session), keeps its existing in-page retraction behaviour, and
  the e2e extends to assert the server side reports zero rows afterwards (against the local
  double). chat.html's local-only promise is untouched.
- **Reload restores the session.** A returning visit re-opens against the cookie's session:
  one GET /api/rows, and the feed rebuilds from real rows. Schema drift is guarded
  server-side: the session stores the seed-content stamp as a meta value, and a mismatch
  expires the session rather than assembling rows across versions.

The point of this consumer is unchanged from the first draft, sharpened: it proves the contract
end to end over HTTP against real service code before bedrock-meter writes their adapter, and it
makes the public demo the architecture rather than a simulation of it.

### 3.8 The row service

A new, tmct-owned service in the site's own stack. Nothing in it is bedrock-meter's: their
deployment keeps their own table and adapter (§3.9).

**Endpoints.** All same-origin under `/api/`, JSON only, cookie-authenticated except the mint:

| method + path | contract call | success | notes |
| --- | --- | --- | --- |
| POST /api/session | — (mint) | 201 + Set-Cookie | valid cookie already present → 200, same session |
| GET /api/rows | readRows | 200 `{rows:[…]}` | one response; the row cap makes pagination unnecessary, and the handler 500s loudly rather than truncating if that assumption ever breaks |
| PUT /api/rows | putRows | 204 | body `{puts:[row…]}`; whole batch validated before any apply |
| DELETE /api/rows | deleteRows | 204 | body `{rowKeys:[…]}`; missing keys are a no-op |
| GET /api/meta/:key | readMeta | 200 `{value}` / 404 | client maps 404 to null |
| PUT /api/meta/:key | putMeta | 204 | body `{value}` |
| DELETE /api/session | deleteAll | 204 + cookie cleared | rows, then meta, then the session marker (§15.4) |

`readRowsByTerm` stays dormant client-side, and the handler already serves it
(`GET /api/rows?class=fact&term=X` → a sort-key prefix query) because the sk layout (§3.3) makes
it one line; nothing calls it until the term-lazy horizon lands.

**Sessions and auth.** POST /api/session mints a UUID and returns it only as an HttpOnly,
Secure, SameSite=Strict cookie scoped to `Path=/api`, `Max-Age` = the TTL. The browser never
chooses or reads the key — the pk is server-controlled, which closes the write-anywhere hole an
attacker-supplied key would open. Cross-site requests carry no cookie (SameSite=Strict) and the
service serves no CORS headers, so only the site's own pages can use it. No accounts, no
tokens, nothing identifying: the session is anonymous by construction and TTL is the garbage
collector.

**Caps, fixed here.** At most 1,000 rows per session (a PUT that would exceed it → 409, nothing
applied); at most 4,096 bytes of `json` per row (400); at most 256 KB request body (413); at
most 120 mutating requests per session per hour (429; an atomic counter row with its own TTL —
the one place the service uses DynamoDB's `ADD`); Lambda reserved concurrency 10 as the blunt
account-level bound. Every row, meta value, and the session marker carry `expiresAt` = mint
time + 7 days (env-configurable), enforced by DynamoDB-native TTL.

**Error semantics, pinned for the client and the kit.** 400/409/413 → `BackendRejected` (the
turn errors; the session stays networked); 401 → the client re-mints once and retries once,
then surfaces; 429, 5xx, and network failure → `BackendUnavailable` (the turn reports it and
the visit continues without persistence per §3.7). 4xx validation failures apply nothing; a
5xx mid-batch may
leave rows applied, which is the contract's own half-landed-batch stance (§3.1).

**The handler is in-repo and backend-agnostic — that is the whole trick.** `server/row-service/`
(new, top-level, excluded from the npm `files` array — the published library ships no Lambda)
holds `handler.mjs`: parse, validate, enforce caps, then call a §3.1 row backend. In AWS that
backend is `dynamo-row-backend.mjs` in the same directory (lazy `@aws-sdk/lib-dynamodb` import;
the SDK is marked external in the bundle because the Lambda Node runtime ships it, so the repo
gains no production dependency). Locally the SAME handler mounts on `node:http` over the M2
in-memory reference backend — `server/row-service/local.mjs` — and that is the test double:
real routing, real validation, real error semantics, fake storage. The service is itself a
consumer of the seam it fronts.

**Deploy path.** The service is new constructs inside the existing `infra/` stack: a
`dynamodb.Table` (pk `sessionKey`, sk `sk`, TTL attribute `expiresAt`, on-demand billing), a
`lambda.Function` from the esbuild bundle (`npm run build:row-service` emits
`server/row-service/dist/handler.js`), a function URL with OAC, and
`distribution.addBehavior("/api/*", …)` on the distribution `website-stack.ts` already owns —
same origin as the site, no new DNS, no CORS. CI's existing `deploy:website` job deploys it (it
already runs `cdk deploy` on the same stack; the job gains the `build:row-service` step).
`scripts/post-deploy-smoke.mjs` gains the live probe: mint a session, PUT one row, GET it back,
DELETE the session, against the deployed origin — measurement after release, never a test tier.

### 3.9 bedrock-meter's consumer story, unchanged

Their Lambda-embedded path injects their own adapter over their own table; this plan's service
is not on their path, and their spec's §7/§8 stay theirs. Their offered seam (single-table
`pk`/`sk`, `put/get/update/del/query(skPrefix)/batchGet/add`) adapts in roughly a hundred
lines: `readRows` → `query("")` paginated; `putRows` → looped `put` (their seam has no batch
write; per-row atomicity holds either way); `readRowsByTerm` → `query("fact#<term>#")`; meta →
`put`/`get` under `sk = "meta#<key>"`; `deleteAll` → `query` then looped `del` (documented as
their seam's cost, no native truncate). The adapter and its tests are theirs (spec §7); the
acceptance is that it passes the published suite unmodified.

---

## 4. The operational contract as checks

| requirement (spec §4) | conformance-checkable | how |
| --- | --- | --- |
| stateless open, no bulk load | partly | tmct-side integration test asserts one `readRows()` per cold `loadMemory` (spy backend); O() itself is design, §3.5 |
| per-fact atomicity, no cross-fact transactions | yes | a poisoned batch (one row rejected by a wrapping test backend) leaves the others readable and valid |
| row-level concurrency, both writers land | yes | two handles on one key interleave `putRows`; the suite asserts both fact rows present |
| concurrent supersession survives | yes | two handles supersede the same fact differently; assembly over the union shows both supersessions applied (§3.2's additive rule) |
| delete-by-key reachability | yes | `deleteAll()` then `readRows()` empty and every meta key null |
| meta round-trip | yes | put/get/absent-is-null for each named key |
| bookkeeping exclusion | yes | a `rowClass: "bookkeeping"` row round-trips but never surfaces in `rowsToPayload`'s answer-facing individuals |
| determinism / order independence | yes | one row set, two arrival orders, identical assembled payloads |
| ≤ 4 KB rows | yes | the projection rejects an oversized row at `payloadToRows` time with a named error |
| HTTP error mapping | yes (client) | the kit runs against the HTTP client over the local double; a scripted double answers 400/401/409/413/429/500 and the client must map each per §3.8 |
| TTL enforcement | no — adapter-documented | time-driven; the suite asserts only that `expiresAt` round-trips untouched |
| latency budget | no — consumer-measured | bedrock-meter's e2e owns the §4 numbers for their path; the smoke probe records the service's, as measurement |
| lazy SDK, no import-time IO | no — adapter-documented | stated in the contract doc; unobservable from inside the suite |

---

## 5. Phase M0 — the row projection (`rows.mjs`)

**Owns** `src/adapters/memory/rows.mjs` (new), `src/adapters/memory/row-backend.mjs` (new:
the contract doc-comment, `isRowBackend`, the row-shape validator), `test/adapters/memory-rows.test.mjs`
(new). Serialized on `core.mjs` knowledge, no `core.mjs` edits yet. **Opus.**

Deliver `payloadToRows`, `rowsToPayload`, `diffRows` per §3.2, factored to match what
`persistSqlitePayload` stores today (same tables, same fields, expressed as wire rows). Three
projection rules carry the sharp-edge fixes: supersession and retraction are additive rows;
research-queue and researched-terms entries are individual `bookkeeping` rows; the 4 KB cap
throws a named error carrying the fact's provenance. Unit tests: round-trip identity on a
seeded fixture payload, sort-before-assembly order independence, the 4 KB rejection,
`rowClass` classification for every individual class in the store including a `bookkeeping`
row, `diffRows` producing the minimal put/delete sets for an append, a supersession, and a
retraction, and the union of two conflicting supersession projections assembling with both
applied.

Acceptance: `node --test test/adapters/memory-rows.test.mjs`; `npm run test:fast`.

## 6. Phase M1 — Backend D dispatch

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

## 9. Phase M4 — the row service handler and its local double

**Owns** `server/row-service/handler.mjs` (new: routing, validation, caps, error semantics per
§3.8, calling an injected §3.1 backend), `server/row-service/dynamo-row-backend.mjs` (new: the
service's own DynamoDB implementation, lazy SDK, sk layout per §3.3),
`server/row-service/local.mjs` (new: the handler on `node:http` over the M2 reference backend —
the test double every later phase uses), `server/row-service/README.md` (one page: run locally,
env vars `TABLE_NAME`/`TTL_DAYS`, what deploys it), `test/server/row-service.test.mjs` (new).
**Sonnet**, after M2. The dynamo backend's unit tests run against an injected fake document
client — no AWS, no network; the kit cannot reach DynamoDB from CI and does not try (the smoke
probe is the live check).

The handler tests drive every endpoint through `local.mjs`: mint/reuse/clear of the session
cookie, each cap answering its status code with nothing applied on 4xx, the mutation-rate
counter, batch validation before any apply, and the delete ordering of §15.4.

Acceptance: `node --test test/server/row-service.test.mjs`; `npm run test:fast`.

## 10. Phase M5 — the HTTP client backend, conformance over the wire

**Owns** `src/surfaces/web/http-row-backend.mjs` (new: `createHttpRowBackend({ apiBase,
fetchImpl })`, the §3.1 contract over fetch with credentials included, the §3.8 error mapping,
the one 401 re-mint retry), `test/adapters/http-row-backend.test.mjs` (new). **Sonnet**, after
M4.

Its test file runs the FULL conformance kit against the client pointed at `local.mjs` — three
real layers (client → handler → reference backend), no fakes — plus the scripted error double
for §4's mapping row.

Acceptance: `node --test test/adapters/http-row-backend.test.mjs`; `npm run test:fast`.

## 11. Phase M6 — infra and deploy

**Owns** `infra/lib/website-stack.ts` (the table, the Lambda from the built bundle, the
function URL + OAC, `addBehavior("/api/*", …)`, reserved concurrency, TTL env),
`package.json` (`build:row-service`: esbuild `handler.mjs` → `server/row-service/dist/`, SDK
external), `.gitlab-ci.yml` (`deploy:website` gains the `build:row-service` step),
`scripts/post-deploy-smoke.mjs` (the live probe: mint → put → read → delete against the
deployed origin, polled with the same patience the version check uses). **Sonnet**, after M4;
the stack change deploys through the existing job on the next main push, no new pipeline
surface. The first deploy lands the table empty; there is nothing to migrate.

Acceptance: `npx tsc --noEmit` in `infra/`; `npm run build:row-service` emits a bundle;
`node --test test/server/row-service.test.mjs` still green; the smoke probe runs against
`local.mjs` in a dry-run mode so the script itself is tested without AWS.

## 12. Phase M7 — news.html consumes it

**Owns** `src/surfaces/web/news-browser-entry.mjs` (construction: `createHttpRowBackend` with
the seed as `basePayload`; mint-at-consent; the persistence-unavailable fall-through of §3.7;
`revokeConsent` calling `deleteAll()`), `src/services/news-viz.mjs` (the honest persistence
copy at the consent moment and beside stop & forget; the persistence-unavailable status line),
`test/adapters/news-browser-entry.test.mjs`, `test-e2e/pages-news-feed.test.mjs`.
**Sonnet**, after M1 and M5.

The e2e mounts `local.mjs` on the same static server the snapshot is served from, under
`/api/` — same-origin, fixture-true, never AWS. Pins: zero `/api/` requests before the start
press; a poll's stored facts arrive as one PUT; a reload rebuilds the feed from the double's
rows; stop & forget leaves the double reporting zero rows and the cookie cleared; killing the
double mid-visit flips the page to the persistence-unavailable status line, the visit
continues, and no local storage appears. The news
e2e's hard-won waits (sleep-then-evaluate loops, `waitUntil: "load"`, the seed copy into the
snapshot) all stay as they are.

Acceptance: `node --test test/adapters/news-browser-entry.test.mjs`;
`node --disable-warning=ExperimentalWarning --test test-e2e/pages-news-feed.test.mjs`;
`npm run test:fast`.

## 13. Phase M8 — the contract page and README

**Owns** `docs/adapter-contract.md` (a memory-backend section beside the existing provider
seam: the §3.1 method table, the row shape, the key recommendation, the endpoint table, the
adapter-documented items from §4), `README.md` (a short consumer paragraph: inject an object,
run the suite, link to the contract doc). **Haiku**, after M5 and M6. Docs gate only:
`npm run check:links`, estate tier, `test:fast`.

## 14. Phase M9 — hand it to bedrock-meter

**Owns** `~/.claude/inboxes/bedrock-meter.md` (append-only note). **Haiku**, last. The note
names: the export subpath and kit entry point, the contract doc location, the row shape and
recommended pk/sk layout (§3.3), the meta keys and the queue-as-rows change, the §4 split
between conformance-checked and adapter-documented, that tmct's own site now runs the seam
over HTTP against a tmct-owned table (theirs stays theirs), and the two spec asks answered
differently than written — reads are session-scoped per §3.5 with the term-read path settled
but dormant, and `deleteAll` over their Store shape is query-then-delete. Their spec §7/§8
items (the adapter, its tests, the live e2e, S3-path retirement) stay theirs.

---

## 15. Known sharp edges

The operator's design review named six. Each gets a stance here; "accepted" means the plan
ships with it and says so, not that it hides.

1. **The cold open is a partition scan, not O(rows-touched).** Accepted for v1 (§3.5): the
   engine is synchronous over one payload, the caps bound the scan, and the sk layout means
   the term-lazy fix (§16) lands with no storage migration. The spec's stricter reading is
   deferred engine work, named as such.
2. **Concurrent supersession under last-write-wins.** Fixed by representation, not accepted:
   §3.2 makes supersession additive rows, M0 tests the union assembly, M1 races two live
   handles, and the kit carries the check (§4). In-place supersession mutation is a projection
   bug by definition.
3. **Cache staleness across a warm process.** Accepted with its bound stated (§3.6): a second
   writer's rows appear at the next cold open; derived rows recompute on load. Two tabs on one
   news session are two writers and see each other only on reload. No partition version, no
   ETag in v1; if the staleness bites a real consumer, an `If-None-Match` on GET /api/rows is
   the cheap add and the endpoint table leaves room for it.
4. **`deleteAll` is query-then-delete, non-atomic.** Accepted, ordered, and made retryable:
   the service deletes rows, then meta, then the session marker, so a crash mid-way leaves a
   session that still looks live and a retried DELETE finishes the job; the client retries
   the idempotent DELETE once on 5xx; TTL reaps whatever survives both. A half-deleted
   session can never look like a fresh one.
5. **The 4 KB cap as a runtime failure.** Mitigated at the earliest honest point (§3.2): the
   projection throws before the network with the offending fact's provenance named, the M0
   boundary test pins it, and the service 400 is the backstop. Discovery stays possible at
   run time — an article sentence can always be pathological — but it fails loudly in the
   turn that caused it, never as a silent drop.
6. **Meta read-modify-write races on the research queue.** Fixed by representation (§3.1):
   queue and dedup entries are individual bookkeeping rows, additive under concurrency. The
   two values left in meta are a watermark whose regression costs one recompute and a nodeId
   written once.

And the two build risks carried from the first draft: **the M3 sqlite refactor** rewrites
Backend C's persistence internals under a byte-identical-storage pin — the before/after dump
comparison is the guard, and a differing dump stops the phase; **the browser seed overlay**
must never leak into writes — M1's diff runs against base ⊕ rows by construction and its
seeded-base test asserts `putRows` never receives a seed row.

## 16. Not in this plan

The spec's own non-goals (§9), adopted: cross-session shared knowledge, search, multi-region,
sqlite-store migration, answer-composition changes. Also out, each with its standing pointer:

- **Term-lazy resolution** — partial reads feeding an async resolver, for the 10⁴ sessions/day,
  10³ facts/session headroom envelope. The index key (§3.3) is settled so this lands without a
  table migration; the engine work (async folds) is its own future plan.
- **Merge semantics beyond additive rows and last-write-wins.** Offline-first browser
  persistence, reconciling a forked local copy, and multi-writer merge all live behind
  `docs/references/papers/crdt.md`, the standing design authority; rows being content-addressed
  and order-independent is the groundwork it would build on.
- **Local persistence for news.html, in any form.** The page's durability is the service and
  nothing else (§3.7); rows kept locally across a lost connection would fork from the server
  copy, which is the merge problem above.
- **chat.html on the row backend.** A different page with a different promise: it keeps
  `idb-persist.mjs`'s whole-payload snapshot and its never-sent-anywhere wording, untouched,
  until a follow-on decides otherwise deliberately.
