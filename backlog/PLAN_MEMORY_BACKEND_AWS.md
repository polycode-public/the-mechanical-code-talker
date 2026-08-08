# PLAN_MEMORY_BACKEND_AWS.md — an AWS-hosted memory backend (`s3`/`s3+dynamo`)

Status: design settled at recommendation level, build not started. Tracked in `NEXT.md`'s open
items. This is a tmct/marginalia concern: marginalia is migrating onto tmct and needs a durable
store that survives a Lambda's scale-to-zero, which a local sqlite file cannot give it. The
writeup below was verified against tmct source on 2026-07-26 and relocated here from seonix's
`PLAN_TMCT.md` (a consumer repo is the wrong home for it). It is unrelated to `PLAN_AWS.md`,
which covers the website/CI move to AWS.

## What exists today

tmct ships exactly two routed backends: `memory` (process-only) and `sqlite` (the default, a
local file) — `BACKEND_MEMORY`/`BACKEND_SQLITE` at `src/adapters/memory/core.mjs:149-150`. The
CLI enum is closed to `default|memory|sqlite` (`bin/tmct.mjs:640,808`). No S3/DynamoDB/aws-sdk
reference exists anywhere under `src/`.

## Where a new backend plugs in

The whole backend seam lives in `src/adapters/memory/core.mjs`. Selection precedence:
`--memory-backend` flag, then `TMCT_MEMORY_BACKEND` env, then `tmct.toml`'s `[memory] backend`,
then `sqlite` (implemented at `src/services/chat-session.mjs:292`; documented identically at
`bin/tmct.mjs:66-67`, `src/services/init.mjs:138`, `src/domain/cli-verbs.mjs:39`). Resolution
goes through `openMemoryBackend` (`core.mjs:237` — "the ONE shared resolver"; default sqlite
path `.tmct/memory/graph.sqlite`, `:241`) plus a second, flag-less resolver for entry points
with no CLI tier, `openConfiguredMemoryBackend` (`core.mjs:255`). A new backend token has to
land in both, plus the CLI enum.

## The sqlite model is the shape to mirror

The sqlite backend is **not** query-per-operation. First `loadMemory` per handle does a full SQL
reconstruction into one JS object (`buildSqlitePayloadFromRows`, `core.mjs:292`, cold-cache only
via `readSqlitePayload`, `:279-285`); later reads are a `PRAGMA data_version` check (`:280`,
guarding the cache across connections) plus a `structuredClone` of the cache (`:268,288`).
Writes diff the mutated payload row-by-row and commit only changed rows in one transaction
(`persistSqlitePayload`, `:392`; `BEGIN IMMEDIATE` `:396`, `COMMIT` `:491`, rollback `:493`).
Two details worth carrying forward: the read cache is patched in lockstep with each committed
write rather than dropped (`:384-391`), and a rolled-back write invalidates the cache outright
(`:492-495`). Schema is four tables — `meta`, `individuals`, `relations`, `edges` (`SQLITE_DDL`,
`:180-187`). In short: whole graph resident in memory, mutated with plain JS, the store as a
durability and diff layer underneath — not an incremental per-query engine.

## Groundwork first: a formal backend interface

There is no formal `Backend` interface to implement. `sqlite`/`memory` are inline
`isMemoryHandle`/`isSqliteHandle` branches (`core.mjs:152,155`; exported guard
`isMemoryOrSqliteHandle`, `:164`) scattered through `loadMemory` (`:585-587`), `persistMemory`
(`:651-653`, not exported), `loadSyllogiseState` (`:668-670`), `saveSyllogiseState` (`:684-686`),
leaking by design into `blocks.mjs` (`:12,61,152,174`; `core.mjs:161-163` says the guard export
exists so other dir-handling modules "can guard the same way"). The retired flat-file Backend A
still has a third arm — `loadMemory`/`persistMemory` honour a plain dir string
(`core.mjs:234-236,590`), with further branch sites at `:134` and `:535`. Adding a backend today
means adding an arm to each of those functions. **Formalize an explicit `{load, persist, close}`
interface as groundwork, before or alongside the AWS backend** — otherwise the new backend
becomes yet another ad hoc branch instead of the first real plugin.

## The precedent

marginalia already runs a working AWS-hosted graph store with the same underlying shape as the
sqlite backend — full materialization, mutate in JS, write-behind — against S3+DynamoDB:

- The whole MemTree payload is **one JSON object per version in S3** (`tree.vN.json`). Insertion
  loads the full tree, mutates a JS `Map` in place, rewrites the whole object on save
  (marginalia `app/lib/s3-tree.mjs`).
- **DynamoDB holds only a lightweight manifest/version-pointer row** per graph
  (`pk: graph#<id>, sk: manifest#vN`) to find the latest S3 object. DynamoDB is not the graph
  store; S3 is.

bedrock-meter's DynamoDB ledger is a second, already-provisioned precedent for the table/CDK
shape alone (single table, `pk`/`sk` convention per row family, `PAY_PER_REQUEST`,
`AWS_MANAGED` encryption, point-in-time recovery) — a CDK template, nothing more; its content
doesn't transfer.

## Recommendation

Build a third backend (`s3`, or `s3+dynamo`) behind the existing `--memory-backend` precedence,
modeled on marginalia's S3-object-per-version + DynamoDB-manifest-pointer shape. Whole-object
rewrite first, not sqlite-style diffed writes: simpler, already proven at marginalia's scale.
Landing it here means marginalia consumes tmct's backend instead of maintaining its own AWS
persistence layer. Diffed writes can follow if whole-object rewrite proves too costly on real
graph sizes.

## Related, undecided: bedrock-meter's fallback-session grounding

Moved here from `NEXT.md` (2026-07-30) — a related but distinct ask, no timeline pressure,
planning ahead only. marginalia wants bedrock-meter-proxy's embedded over-cap fallback session
grounded in marginalia's own memory graph, not tmct's default seeded persona. The Repository
Interface itself is not the seam for this: memory is documented as "tmct's alone", and the
interface's type vocabulary is code-graph-shaped rather than conversational-fact-shaped. The real
seam is the same one this document's own backend registry
(`openMemoryBackend`/`openConfiguredMemoryBackend`, `src/adapters/memory/core.mjs`) would extend
— these two concerns are related, and possibly worth designing together once this backend lands.

Two candidate shapes, both genuinely undecided on marginalia's side:

1. **Periodic sync** — marginalia exports flat fact triples in the same shape `export-jsonl.mjs`
   already emits, a scheduled job imports via the existing `tmct import --file` path into a store
   the proxy's Lambda reads at cold start. Possibly zero new backend code needed here at all —
   just confirming the import path tolerates marginalia's scale and refresh cadence.
2. **Live read-through** — a genuine new backend querying an AWS-hosted store on every read/write,
   either speaking marginalia's DynamoDB schema directly (real cross-project coupling) or a thin
   client against a neutral flat-triple read API marginalia would expose.

Full write-up: `PLAN_TMCT.md` §7 in the marginalia repo (§6 for the related bedrock-meter
sidecar-routing ask). `~/.claude/inboxes/tmct.md` 2026-07-27T23:49.
