# The graph-provider adapter contract

tmct **reads** a code graph through this seam; its own writes go to `.tmct/memory/`,
never back into a provider's artifact. It can also **produce** a graph — `tmct index`
(`src/index/`) walks a repo's source and writes one through `graph-build.mjs`'s
`buildEntities()` — but that is a separate write-side module tree; this seam stays
read-only, and any other producer (seonix, a CI indexer, a hand-written JSON file,
an in-process loader) feeds it the same way. This document is the complete touchpoint:
what tmct reads, in what shape, from where, and the guarantees each side gets.

## The seam, in one sentence

A provider hands tmct one **entities payload** (JSON on disk at
`config.graphFile`, or an object from a registered loader); tmct parses it with
`parseEntities()` into `{ individuals, byId, relations, proseIndex }` and runs
every query, template, and traversal off that — nothing else crosses the
boundary.

## 1. The entities payload (the on-disk / on-the-wire shape)

The payload is a single JSON object. Every field tmct reads is listed here;
unknown extra fields are ignored (safe to extend). `src/adapters/graph-build.mjs`'s
`buildEntities()` is the reference producer of this shape.

```jsonc
{
  "generated_at": "2026-07-03T10:00:00.000Z",   // string; surfaced as provenance
  "classes": [                                   // per-class counts for /stats + count questions
    { "name": "Module", "count": 12, "sample": ["app/a.mjs", "app/b.mjs"] }
  ],
  "vocabulary": [                                // OPTIONAL: documents the prop tokens used below
    { "prop": "mgx:importsNamespace", "predicate": "imports", "note": "module→module" }
  ],
  "objectProperties": [                          // the typed edges, grouped by relation
    {
      "predicate": "imports",                    // verb; used for rendering + kind fallback
      "prop": "mgx:importsNamespace",            // closed token; primary relation-kind classifier
      "count": 1,                                // may exceed examples.length (truncated graphs)
      "examples": [
        { "subject": "mod:app/b.mjs", "object": "mod:app/a.mjs",
          "subjectLabel": "app/b.mjs", "objectLabel": "app/a.mjs" }
      ]
    }
  ],
  "individuals": [                               // the nodes
    {
      "id": "mod:app/a.mjs",                     // REQUIRED, unique; nodes without id are dropped
      "label": "app/a.mjs",                      // display + label-tier symbol resolution
      "class": "Module",                         // Module | Class | Function | Method | Attribute
                                                 //   | GlobalVariable | Commit | Session | …
      "derived_from": ["git:e6a9419567f7"],      // provenance refs; a touches edge, not a ref, is what
                                                 //   makes a commit count as having touched the node
      "mentions": [],                            // [{id, count}] mention stats (may be empty)
      "attributes": [                            // typed literals; {prop, key, value} triples
        { "prop": "seon:hasDoc", "key": "doc", "value": "first docstring line" },
        { "prop": "mgx:hasProseTokens", "key": "prose_tokens", "value": "alpha beta" }
      ]
    }
  ],
  "proseIndex": {                                // OPTIONAL: word → [individual ids], inverted
    "alpha": ["mod:app/a.mjs"]                   //   from the prose_tokens attributes
  }
}
```

Field notes:

- **`individuals[].id`** — the only required node field. Conventional shapes
  (`mod:<path>`, `fn:<path>#<name>`, `commit:<sha>`) matter for one thing:
  session fold-in re-resolution derives a fallback *label* from the id shape
  (`src/services/sessions.mjs`, `labelFromId`). Other id schemes work; they just skip
  that fallback tier.
- **`objectProperties[].prop`** — the closed vocabulary token. tmct classifies
  each group into a relation *kind* (imports / calls / defines / tests /
  touches / contains / inherits / callsSymbol / touchesSymbol) primarily by
  this token (`src/domain/codegraph.mjs`, `PROP_KIND` — SEON + `mgx:` tokens, with
  legacy `mg:`/`seon:` aliases), falling back to keyword-matching the
  `predicate` verb. An unclassifiable group is still rendered and traversable
  by its predicate name; it just doesn't join the impact closure.
- **`count` vs `examples.length`** — `count` may be larger; tmct reports the
  group as truncated and works with the examples it has.
- **`proseIndex`** — optional but what makes free-text object resolution and
  lexical ranking cheap. Producers using `attachProseTokens()` +
  `buildProseIndex()` (`src/domain/prose.mjs`) get it for free and it can never
  disagree with the `prose_tokens` attributes it inverts. A reserved
  `"tmct:layers"` key may carry normalised sub-indexes (spell/stem/lemma
  layers); absent is fine.
- **`vocabulary` / `classes`** — read for `/stats`, count questions and schema
  self-description; both may be empty arrays.

## 2. What tmct parses it into

`parseEntities(payload)` (`src/domain/codegraph.mjs`) — the loader every surface goes
through — yields:

| field | shape | what tmct does with it |
|---|---|---|
| `individuals` | the payload array, as-is | ranking, rendering, symbol resolution |
| `byId` | `Map<id, individual>` | O(1) node lookup for traversals |
| `relations` | `[{ predicate, prop, count, edges[] }]` | every edge walk; `edges` are the validated `examples` (subject+object present) |
| `truncated` | `[{ predicate, count, shown }]` | honest "graph is truncated" messaging |
| `generatedAt` | `generated_at` or `null` | provenance line in answers |
| `proseIndex` | passed through byte-identical | free-text resolution + lexical boosts |

Malformed pieces degrade, never throw: non-array fields parse as empty, edges
missing subject/object are dropped, nodes without `id` are skipped.

## 3. Where the payload comes from (resolution order)

1. **A registered provider** (in-process): `registerProvider(fn)`
   (`src/adapters/source.mjs`) installs `(config) => payload | Promise<payload>`; while
   registered, `fetchEntities(config)` returns the provider's result **as-is
   and uncached** (a live provider owns its own refresh policy). Register
   `null` to restore the default loader; the previous provider is returned so
   wrappers can restore it. Provider errors surface as clean `ToolError`s.
2. **`TMCT_GRAPH_FILE`** (environment): an absolute or cwd-relative path to the
   payload JSON. Trimmed; empty means unset.
3. **Default**: `<repo>/.tmct/graph.json` (`DEFAULT_GRAPH_REL`), where
   `<repo>` is `--repo` if given, else the git toplevel of the cwd, else the
   cwd itself (`runChat`, `src/services/chat.mjs`).

File reads are cached per path for the process; `clearCache()` (tests,
long-lived embedders) discards it.

## 4. Bootstrap-empty behaviour (a missing artifact is not an error)

`fetchEntities` maps ENOENT to the **bootstrap payload** — `emptyEntities()`:
the exact shape above with all collections empty and `"bootstrap": true`
marking it. The chat surface then starts honestly empty ("no graph loaded —
starting empty"), answers with honest misses, and the first session upsert
**creates** `.tmct/graph.json` from the conversation itself
(`appendSessionToGraph`, `src/services/sessions.mjs`). The bootstrap payload is never
cached, so a provider (or indexer) writing the artifact mid-session is picked
up on the next fetch. Any other read/parse failure is a clean `ToolError`.

## 5. Write-ownership guarantees

- **tmct never writes a provider's graph content.** The only thing tmct ever
  writes into `config.graphFile` is its own *runtime observations*: `Session`
  individuals + `mgx:asksAbout` edges, upserted atomically (temp + rename)
  with a fresh read first, so a provider re-index that replaces the file
  mid-session is tolerated — session edges whose targets vanished are dropped
  and counted, never left dangling. Source-derived content is never modified;
  a re-index simply wins, and recorded sessions re-attach via
  `foldInSessions()`.
- **tmct's own memory never touches the seam.** Conversational memory — the
  OWL-labelled utterance/fact graph and the text-block corpus — lives under
  `.tmct/memory/` (`src/adapters/memory/core.mjs`, `blocks.mjs`, `fold.mjs`), a store
  the provider never supplies and tmct never routes through `fetchEntities`.
  A provider payload is read-only input; `.tmct/memory/` is tmct-only output.
- Providers registered via `registerProvider` are **read-only by
  construction**: nothing in tmct calls back into a provider to write.
- A repo whose `tmct.toml` sets `[graph] read_only = true` disables even the
  session-observation write: chat reads the graph but writes no
  `Session` node, transcript, or memory back into its `.tmct/` (the committed
  `examples/*` fixtures carry it so a plain `tmct chat --repo examples/<x>`
  can't rewrite the hand-stamped graph).

## 6. Minimal provider checklist

1. Emit one JSON object in the section-1 shape (only `individuals[].id` is
   hard-required per node; edges need `subject`/`object`).
2. Use SEON/`mgx:` prop tokens where they fit so relation kinds classify; any
   other token still renders under its `predicate` verb.
3. Either write it to `.tmct/graph.json` (or point `TMCT_GRAPH_FILE` at it),
   or ship a loader and call `registerProvider(loader)` before `runChat`.
4. Replace the file atomically if you re-index while tmct runs; tmct's session
   upsert already tolerates the swap.
5. Optionally run `attachProseTokens` + `buildProseIndex` over your
   individuals to light up free-text resolution.

---

# The memory-backend adapter contract

tmct's session memory lives behind a pluggable seam. The reference and sqlite backends ship in the library; you can build a custom one and inject it into a session. This document is the complete interface: what tmct calls, what it expects back, the shape of data that travels the seam, and what stays adapter-specific.

## The seam, in one sentence

You construct a small async row store scoped to one session key and hand it to `createSession`. tmct loads its working payload once per session, writes back only the rows that changed, and binds every read and write through the same backend object.

## 1. The backend interface

A backend is an object (duck-typed; `isRowBackend(obj)` tests it). It has these properties:

```js
{
  kind: "tmct-memory-row-backend",
  contractVersion: 1,

  // All async. Rows are wire rows (below).
  readRows(),              // → AsyncIterable<row> | Promise<row[]>
  putRows(rows),           // upsert; per-row atomic; resolves when durable
  deleteRows(rowKeys),     // rows absent from every later read; missing keys are a no-op
  readRowsByTerm(term),    // OPTIONAL: rows whose index term matches
  readMeta(key),           // → string | null
  putMeta(key, value),     // upsert one sidecar value
  deleteAll(),             // every row and meta entry this session key reaches goes absent
  close(),                 // release connections; further calls may reject
}
```

Read order never carries meaning. What a row means rides its own content, so two backends handing the same rows back in different orders assemble the same payload.

Deleting is observable, not physical. The contract promises one thing: a deleted row never appears in any later read. You can remove the item or tombstone it behind a filtered read — both satisfy the contract. An adapter picks whichever its store makes cheap.

## 2. The wire row

This is what your backend stores:

```js
{
  rowKey: "fact:1a2b…@src:…",  // stable id; the same (triple, source) is the same rowKey
                                // everywhere, so two sources asserting one triple are two rows
  rowClass: "fact",             // closed set: fact | source | utterance | session | rule |
                                //   retraction | edge-group | bookkeeping
  term: "tariff",               // canonical index term for fact rows; "" otherwise
  json: "…",                    // serialized record, ≤ 4 KB; the only field carrying tmct content
  expiresAt: 1739145600,        // OPTIONAL epoch seconds; stamped by the adapter from TTL policy
}
```

`rowClass` is the structural gate: `bookkeeping` rows are internal (research-queue entries, the researched-terms set) and never surface in answers. Read paths exclude them by field, not by content matching, so an adapter can filter them at the storage level.

Mutation is additive. A supersession carries `mgx:supersedes: [oldId]` in the json. Assembly derives `mgx:supersededBy` from the union of `supersedes` pointers, never by rewriting the old row. A retraction is its own `retraction`-class row. Two concurrent supersessions both land; assembly applies both.

The 4 KB cap fails before the network. tmct rejects an oversized row at projection time with `BackendRejected`, before any write leaves the process. The default posture is throw. A backend constructed with `onOversizedRow: "drop"` logs the row's provenance and skips it; the turn completes with everything else persisted.

### Extraction findings

The extractor records named structural findings about how a sentence was parsed. Findings ride the json's per-assertion `mgx:extractionFinding` property (space-joined list of finding names) and surface in assembled rows under the per-row `extraction` union field.

**The findings vocabulary** — a closed set of named detectors:

| finding | meaning |
| --- | --- |
| `identifier-token` | an endpoint's raw surface is an identifier (camelCase, snake_case, dotted, or path-like) |
| `clause-fallback` | the row grounded from a clause fragment after the whole sentence declined |
| `pronoun-carry` | the subject was substituted from the paragraph's pronoun carry, not stated in the sentence |
| `definitional-frame` | the row is a `mgx:nameFor` edge minted from a definitional copula frame ("the name for Y") |

`relative-clause-verb` and `fragment-term` are decline reasons: candidates bearing these findings are not stored at all, named only in the ingest result.

**The absence rule** — a fact row with no findings listed carries an absent (or empty-array) `extraction` field. Absent means no findings were recorded for this sentence, never that the sentence was checked and found structurally clean. A consumer must not treat absence as a guarantee of clean reading; the distinction is honest: rows written by builds that detect findings either carry them or genuinely triggered none.

**The caveat templates** — a read-back answer that leans on a finding-bearing row says so in a short caveat beside the citation:

| finding | caveat |
| --- | --- |
| `clause-fallback` | `(read from a clause fragment)` |
| `pronoun-carry` | `(subject carried from the previous sentence)` |
| `identifier-token` | `(identifier token)` |

`definitional-frame` needs no caveat: its own phrase ("is the name for") already says how the row was read. Decline reasons (never stored) carry no caveats.

**Helper** — `findingCaveat(finding)` (exported from `src/domain/fact-phrase.mjs` and the `./phrase` subpath) takes a row, a bare finding name, or a list of them, and returns the space-joined caveats those findings map to, in table order. Returns `""` when it has nothing to declare. Consumers render the caveat (if present) between the fact text and its citation: `<fact> <caveat(s)> (source: <provenance>)`.

## 3. The index key

For fact rows, `term` is the normalized subject term. The recommended table layout:

- partition key: the session key;
- sort key: `${rowClass}#${term}#${rowKey}` (empty term collapses cleanly).

This makes `query(skPrefix: "fact#tariff#")` a native term read with no table migration when tmct starts issuing term reads. Object-side lookups ride the assembled payload; an adapter that wants them indexed adds its own duplicate row or GSI.

## 4. The HTTP service (the wire between page and backend)

When the backend is remote, `createHttpRowBackend({apiBase, sessionKey, fetchImpl})` wires the contract over HTTP. The row service implements the other side.

| method | path | wire call | response | notes |
| --- | --- | --- | --- | --- |
| GET | /api/rows | readRows | 200 `{rows:[…]}` | key in `x-tmct-session` |
| PUT | /api/sessions/:uuid/rows | putRows | 204 | body `{puts:[row…]}` |
| DELETE | /api/sessions/:uuid/rows | deleteRows \| deleteAll | 204 | body `{rowKeys:[…]}` or `{all:true}` |
| GET | /api/meta/:key | readMeta | 200 `{value}` \| 404 | key in `x-tmct-session` |
| PUT | /api/sessions/:uuid/meta/:key | putMeta | 204 | body `{value}` |

Errors map to the contract's two failure classes (below).

## 5. Failure semantics

Two named error classes are part of the published contract:

- `BackendRejected` (`code: "TMCT_BACKEND_REJECTED"`) — the input was refused: an oversized row, a malformed key, a validation failure. Retrying the same input gets the same answer.
- `BackendUnavailable` (`code: "TMCT_BACKEND_UNAVAILABLE"`) — the store could not be reached or refused service: a network failure, a 429/507/5xx. The same input may well succeed later.

A consumer whose turn is itself a last-resort fallback catches by class or by `code` and continues without persistence.

## 6. Adapter-documented requirements

These are the adapter's responsibility, not checked by the conformance suite:

- **TTL enforcement** — time-driven, outside tmct's control. The suite asserts only that `expiresAt` round-trips untouched. Your adapter deletes expired rows per its own schedule.
- **Latency budget** — consumer-measured. Your adapter's cold-open latency and its write throughput are the inputs to this measure. Expect one read per cold session load and delta-only writes thereafter.
- **Lazy SDK, no import-time IO** — the DynamoDB backend loads with the AWS SDK absent. Only the first storage call requires it. No adapter should do I/O at import time.
- **Concurrency handling** — fact rows are content-addressed, so concurrent writers land distinct rows or the same row with identical content. Metadata and derived rows use last-write-wins semantics; a regression costs one re-derivation. No turn-serialization guarantee is required.

## 7. Running the conformance suite

Every shipped backend passes this suite:

```js
import { runMemoryBackendConformance } from "@polycode-projects/the-mechanical-code-talker/memory-backend-conformance";

await runMemoryBackendConformance("my-backend", async () => {
  return await createMyCustomBackend(/* config */);
});
```

The kit checks: per-row atomicity, row-level concurrency, concurrent supersession, delete-by-key reachability (observable semantics only), meta round-trip, bookkeeping exclusion, determinism across read orders, the 4 KB cap in both modes, and typed failures with stable codes.

Export the essentials:

```js
import { createRowMemoryBackend, createDynamoRowBackend, isRowBackend } from "@polycode-projects/the-mechanical-code-talker/memory-backends";
import { createSqliteRowBackend } from "@polycode-projects/the-mechanical-code-talker/memory";
```

## 8. Shipped implementations

**In-memory reference backend** (`createRowMemoryBackend`): the simplest implementation, for testing and small ephemeral sessions. Deletes are physical removal.

**DynamoDB backend** (`createDynamoRowBackend`): wired through the `./memory-backends` subpath for consumers hosting on AWS. Takes configuration for soft-delete mode (tombstoning for TTL reclamation) and key remapping to fit existing tables. See the constructor docstring in `src/adapters/memory/row-backend-dynamo.mjs` for the full option set.

**SQLite backend** (`createSqliteRowBackend`, exported from `src/adapters/memory/core.mjs`): the CLI's persistent store, wired as a row backend for consistency with the other two. Each call opens one database connection; one `.sqlite` file is one store viewed through two entry points: `createSqliteMemoryStore` (the classic memory-store interface) and `createSqliteRowBackend` (the row-backend interface). Both see the same seven tables (individuals, relations, edges, facts, meta, fact_heads, fact_object_supersessions).

SQLite-specific notes:

- Deletes are physical removal, not tombstoned. The `deleteRows` method issues `DELETE` statements; `deleteAll` issues a `DELETE FROM` over the whole session partition.
- Term reads scan the individuals table; SQLite has no sort-key index like the recommended partition layout provides. Performance is acceptable at the reference-backend scale (~40 facts per session).
- The 4 KB cap applies at `putRows` time (the wire row's json field). Internal payload writes have no cap; the payload's own scalars (`memory`, `prefixes`) live as meta rows, and derived rows (classes, vocabulary, proseIndex) are recomputed at assembly.
- Meta keys are shared with the payload's own stored scalars: `memory`, `prefixes`, `nodeId`, and `syllogiseState` occupy meta rows the store already writes. A consumer-injected backend's meta keys coexist.
- Fixture rows (those not mappable to tmct's own classes) live verbatim in an unmapped_rows table, created on first use. The conformance kit's fixture rows land there, unchallenged. Real payloads' rows go to the seven base tables; a store that never sees a verbatim row never grows unmapped_rows.

## 9. Building a custom backend

You can skip the three shipped implementations and build your own. The conformance kit is the single authority on what tmct expects.

The minimum viable backend:

```js
class MyRowBackend {
  kind = "tmct-memory-row-backend";
  contractVersion = 1;

  async readRows() { /* return all rows as AsyncIterable or Promise<array> */ }
  async putRows(rows) { /* upsert all rows; resolve when durable */ }
  async deleteRows(rowKeys) { /* mark rows absent from reads */ }
  async readMeta(key) { /* return value string or null */ }
  async putMeta(key, value) { /* upsert one value */ }
  async deleteAll() { /* mark all rows and meta absent */ }
  async close() { /* release resources */ }
}

export function createMyBackend(sessionKey) {
  return new MyRowBackend(sessionKey);
}
```

Wire `readRowsByTerm` only if your store has a term index. Delete observability is the contract; you pick the mechanism (physical removal or filtered reads). Test with the conformance kit before shipping. Join the `./memory-backends` export if it belongs in the library; otherwise stay local.

Expect tmct to:

- Call `readRows` once per cold session load, once per recovery, never mid-session.
- Call `putRows` with 1–5 rows per turn, only rows that changed.
- Call `deleteRows` or `deleteAll` when a visitor retracts facts or forgets.
- Call `readMeta` and `putMeta` for scalars (watermark, node id) with last-write-wins semantics.
- Construct a fresh backend per session. Never reuse one across sessions.
- Close the backend when the session ends; further calls may error.

---

# The turn surface adapter contract

tmct's turn operation is a synchronous engine that reads facts, answers questions, and persists learned rows. This surface wraps the engine in an HTTP API. You provide the request (text), the backend provides the session store and corpus source, and the surface returns the answer plus what the turn learned.

## The turn endpoint

One route wraps the engine:

| method | path | request | success | notes |
| --- | --- | --- | --- | --- |
| POST | /api/sessions/:uuid/turn | `{text, retrieval?: {fuzzy}}` | 200 `{reply, factsTouched, narration}` | session key rides the path (strict v4 format); body ≤ 4 KB; optional `retrieval.fuzzy` toggles fuzzy corpus retrieval per request; first learning turn creates the session implicitly; turn rate is per-session (30/hour default), 429 over it; when the global table cap or an unreachable store refuses the write, the turn still answers 200 — learned facts are not persisted and the reply says so |

## The handler sequence

`POST /api/sessions/:uuid/turn` invokes:

1. **Validate** — key shape, body size, content type (the same rules the row service applies to its own routes);
2. **Load session** — construct a fresh row backend for the session; call `loadMemory` to assemble the working payload;
3. **Retrieve** — fetch a bounded, deterministic subgraph from the corpus bands under fixed budgets, unless a circuit breaker says skip;
4. **Run** — call `runTurn` with seed + corpus subgraph + session assembled together (same engine, byte-identical to the library);
5. **Persist** — `persistMemory` writes only the rows the turn changed (delta writes; the service's soft-delete rules apply);
6. **Reply** — return `{reply, factsTouched, narration}` where `reply` is the text answer, `factsTouched` keeps its published shape, and `narration` matches what `--narrate` would emit.

Retrieved corpus facts are read-only per turn. Only what the engine learns persists to the session. A fact cited in the answer names its source: session facts cite their `teach:` provenance, corpus facts cite their `corpus:<band>@<version>` provenance.

## Rate and concurrency

Each session has its own 30-turns-per-hour counter (default, deployment parameter). An atomic counter row tracks it; TTL manages cleanup. On tmct's own deployment a per-IP edge rate limit covers all `/api/*` requests, and the account-wide Lambda concurrency cap bounds compute for every function in the stack.

Concurrent turns on one session are allowed. Fact rows are content-addressed, so concurrent writers land distinct rows or the same row with identical content. Metadata (watermark, node id) use last-write-wins; a regression costs one recompute. No turn-serialization guarantee is required from the consumer.

## Error semantics

Errors map to the row backend's two classes (section 5 above):

- **400 / 413** → `BackendRejected` (the input was invalid: an oversized row, malformed session key, oversized request body);
- **429 / 507 / 5xx** → `BackendUnavailable` (a 429 turn was refused outright; a persist-side failure still answers 200 with learned facts unpersisted and the reply saying so; the consumer's page degrades gracefully).

A consumer catches by class or by `code`, never by message text.

## The first page consumer

`news.html` is the reference implementation. The same session UUID that the feed uses is the turn endpoint's session key. The reply is immediate (`200 {reply, factsTouched, narration}`); learned rows land in the session partition alongside the materialized feed. When the turn's `factsTouched` is non-empty, the handler async-invokes the news worker in materialize mode before responding — the reply is immediate, the feed catches up seconds later on the next page poll.

Other pages (chat.html, ledger.html) run their engines in-page and do not call this endpoint. The turn surface is for consumers hosting the engine themselves.

## Corpus bands and the loader

Corpus data lives in the same table under reserved partitions (pk `corpus:<band>`). Three bands ship with tmct:

- `corpus:wikidata-slice` — CC0, no attribution burden;
- `corpus:wordnet-complete` — Open English WordNet, CC-BY-4.0, attribution in the band manifest;
- `corpus:conceptnet-full` — CC BY-SA 4.0, share-alike.

A fourth band, `corpus:simplewiki-derived` (extracted article facts), is future work; `PLAN_WIKIPEDIA_BAND.md` scopes it.

Load or clear bands with `tmct corpus load <band> [--table <name>]` and `tmct corpus clear <band>`. Content-addressed keys make re-runs idempotent. The loader streams jsonl from the band's source, writes with bounded concurrency and backoff, and computes a manifest digest for idempotency checks. Both commands are operator tools — credentials are ambient, never embedded. A consumer hosting the turn surface runs the same CLI verb against their own table.

Band facts carry their provenance (`corpus:<band>@<version>`) in citations. No new provenance grammar for bands; they use the same existing corpus grammar tmct's shipped corpora already use.
