# The Repository Interface (v1.1.0)

The versioned contract between **tmct** (the query interpreter — the brittle side) and a
**graph provider** (seonix, a fixture, a browser page — the stable side). tmct **owns and versions**
this shape; a provider **implements** it over its native graph. See `archive/PLAN_REPOSITORY_INTERFACE.md`
for the why; this file is the normative prose peer of the machine-readable
`docs/repository-interface.schema.json` (both are generated from / checked against
`src/adapters/repository-interface.mjs`, the single source of truth).

> **Conformance = passing the contract test suite** (`test/adapters/repository-interface.test.mjs`), not
> matching this prose. The suite is the compatibility kit; run it against your implementation to
> claim conformance. tmct's own reference providers (`src/adapters/providers/fixture.mjs`,
> `src/adapters/providers/bootstrap.mjs`) pass it in `npm test`.

## The type dictionary is OWL, not JSON

The interface names **operations**, not types — the types are already shared. Every `Individual.class`
is a `tmct:` class and every `Edge` carries a `tmct:` object-property kind, both defined in
`ontology/tmct-core.ttl`. Both sides agree on what a "module" or a "calls" edge *is* before any wire
format, so there is no schema war to fight.

### `Individual`

```
{ id: string,            // opaque, provider-assigned
  label: string,         // display name
  class: string,         // a tmct: class token — module|class|function|method|attribute|variable|commit|test|…
  attributes: [ { key: string, value: string, prop: string|null } ] }
```

`attributes[].prop` is the SEON/`mgx:` token the value was asserted under — the OWL grounding is
carried through, never discarded.

### `Edge`

```
{ subject: string,       // individual id
  object: string,        // individual id
  predicate: string,     // relation predicate
  prop: string|null,     // the SEON/mgx property token
  subjectLabel?, objectLabel?, weight? }   // additive conveniences
```

The required quartet is `subject / object / predicate / prop`. `edges(id, kind)` traverses one of the
**closed** edge kinds, each aligned to a `tmct:` object property:

| kind | tmct: property |
|------|----------------|
| `imports` | `tmct:imports` |
| `calls` / `callsSymbol` | `tmct:calls` |
| `defines` | `tmct:defines` |
| `tests` | `tmct:covers` |
| `touches` / `touchesSymbol` | `tmct:touches` |
| `contains` | `tmct:contains` |
| `inherits` | `tmct:extends` |
| `cochange` | `tmct:dependsOn` |
| `reexports` | `tmct:exports` |

## The error contract — an honest miss is a value, never a throw

Every service returns a **`Result`**:

```
{ ok: true,  value: T }
{ ok: false, miss: { reason: MissReason, detail: string, term: string|null } }
```

`reason` is drawn from a **closed set** (`MISS_REASONS`) so the interpreter renders the *reason*, not
free-text error prose:

| reason | meaning |
|--------|---------|
| `UNRESOLVED_TERM` | the term named no individual in the graph |
| `CAPABILITY_ABSENT` | the provider does not implement this service (negotiated away) |
| `TRUNCATED_GRAPH` | the answer exists but the provider shipped a truncated sample |
| `NO_SOURCE` | a source-reaching service, but the provider exposes no working tree |

An **empty but valid** answer (no matching edges, zero modules under a package) is a `hit` with an
empty collection — *not* a miss. A miss is reserved for "I cannot answer this," never "the answer is
empty." Programmer errors (an `edges()` kind outside `EDGE_KINDS`) still throw `TypeError` — the miss
contract is for *domain* misses, not misuse.

## Capability negotiation, not a version wall

A provider advertises `capabilities: string[]` — the service names it implements. A host calls through
`invoke(svc, service, ...args)`: a service outside the set returns `miss(CAPABILITY_ABSENT)` rather
than throwing, so the interpreter **degrades** the query (to a lesser strategy or an honest miss),
never errors. `snippet` may be *advertised yet answer* `miss(NO_SOURCE)` when there is no working
tree — it has nothing useful without fs. `context` is **graph-only-capable** since v1.1.0: a
graph-only provider still returns a real `hit` (the graph-only sections of the edit bundle) for any
resolvable symbol; only a source-capable provider adds the source body text on top. Either way, a
graph-only provider still conforms.

**Versioning is additive by default.** New services and new optional args are minor bumps; the suite
for version *N* stays green under *N+1*. A breaking change is a new **major** interface version with
its own suite; a provider claims the versions it conforms to. Absent capability = a degraded plan,
never a failure — the same tolerance the answer path already has for missing edges.

## Concurrency & the session handle

Every service is a **read** over immutable graph truth: safe to call concurrently across handles, in
any interleaving. The only mutable state is the **caller-owned session handle** (`focus`, last answer,
memory dir) — never touched by these services. tmct **never caches provider truth**; a live provider
owns its own refresh policy and tmct reads through it. The suite's concurrent cases are the evidence,
not this assertion. Memory (`.tmct/memory/`) is tmct's alone and **never** routes through a provider.

## The services

Grouped as in the plan's six-group inventory. Full arg/result/miss detail is in
`docs/repository-interface.schema.json`.

### Entity resolution / lookup

- **`resolve(term) → { match: Individual, candidates: Individual[] }`** — the resolution seam; every
  id-taking service consumes a resolved id. Miss: `UNRESOLVED_TERM`.
- **`describe(id) → { individual, out: Edge[], incoming: Edge[] }`** — full typed portrait.
- **`members(classId) → { methods: Individual[], attributes: Individual[] }`** — via `contains`.
- **`subclasses(classId) → { bases: Individual[], subclasses: Individual[] }`** — forward bases +
  transitive reverse inheritance closure.
- **`exports(moduleId) → { exports: Individual[] }`** — the curated public API (`reexports`).
- **`signature(id) → { id, label, class, params, returns, raises, decorators, doc, selfFields, flags }`**
  — the compact API surface without the body.

### Edge traversal

- **`edges(id, kind, { limit?, offset? }) → { kind, edges: Edge[] }`** — outgoing edges of one closed
  kind. An unknown kind throws `TypeError`; an empty result is an honest `hit`. `limit`/`offset`
  (both optional) paginate the already-stable edge order; an omitted `limit` is the full list,
  byte-identical to pre-pagination behavior.
- **`impact(moduleId, { maxDepth? }) → { total, levels }`** — the transitive dependent closure the
  interpreter cannot compute without provider truth. `maxDepth` (optional, default 8) bounds how
  many levels the closure walks.

### Source spans (source capability)

`graph-service.mjs`'s reference implementation keeps fs access an **explicit injected capability**,
never an ambient import: `createGraphService(graph, { sourceAccess, repoRoot, readFile })` — when
`sourceAccess` is true, `repoRoot` and `readFile` (e.g. `node:fs/promises`' `readFile`) are
**required**, or construction throws `TypeError` (a programmer error, caught at construction time,
not a runtime miss). Both `snippet` and `context` are **async** (`Promise<Result>`) — a real body
read is inherently fs I/O; callers should always `await` them regardless of whether a given
provider happens to be source-capable.

- **`snippet(id) → Promise<{ path, span, body }>`** — the exact source span. A provider with no
  working tree returns `miss(NO_SOURCE)` (carrying the span in `detail`) rather than throwing —
  UNCHANGED by v1.1.0, snippet has nothing useful without fs.
- **`context(symbol, { depth? }) → Promise<{ text, tier }>`** — the composed edit bundle.
  **Narrowed miss contract as of v1.1.0**: `contextPlan`/`sizeBundle`/`renderGraphOnlyBundle` are
  pure graph queries, so a graph-only provider now returns a real `hit` — siblings, registration,
  class members, `__all__`/re-exports, insertion region, covering tests, co-change — for ANY
  resolvable symbol. Only an unresolvable symbol still misses (`UNRESOLVED_TERM`); `NO_SOURCE` is
  no longer a reason `context` can return. A source-capable provider additionally includes the
  anchor/exemplar/inlined-callee body TEXT sections on top of the same graph-only bundle.

### Aggregates / architecture

- **`architecture({ package? }) → { modules, packages, hubs }`** — package/module shape + hub modules.
- **`untested() → { modules: Individual[] }`** — modules with no covering test.
- **`stats() → { total, classes, truncated }`** — per-`tmct:class` counts from the payload.

### History / temporal

- **`history(id) → { commits: [ { id, label, author, date, message } ] }`** — `tmct:commit`
  individuals via `tmct:touches`.

### Search / locate

- **`search(query, { kind?, name?, decorator?, limit?, offset? }) → { results: Individual[] }`** —
  REALLY ranked, not a flat filter: module-mode (no `kind`, or `kind: "module"`) ranks via the same
  path/symbol/import-proximity scorer `tmct_search` uses; symbol-mode (`kind` names a symbol kind —
  function/class/method/attribute) ranks via a dedicated symbol scorer, with real `name` (regex,
  case-insensitive) / `decorator` filters. Module-mode does not support `name`/`decorator` (matching
  `tmct_search`'s own module branch — no new filter semantic invented). `limit` (default 10) /
  `offset` paginate the full ranked array. An empty set is honest, not a miss.
- **`ask(query) → { content, tmct_ask }`** — the composed, zero-model NL round-trip.

## Reference implementations

- **`src/adapters/providers/fixture.mjs`** — a small, real, self-contained graph. Every non-source service
  returns real truth; `snippet` answers `NO_SOURCE` and `context` returns a graph-only bundle unless
  constructed source-capable. Read it first: it is the executable specification.
- **`src/adapters/providers/bootstrap.mjs`** — the empty graph a fresh repo "contains". Every id-taking
  service misses `UNRESOLVED_TERM`; every aggregate returns an honest empty. The provider with no data
  must still conform.

Both are `createGraphService(graph, opts)` (`src/adapters/providers/graph-service.mjs`) over different graphs;
`opts` passes straight through, so either can be constructed source-capable for testing:
`fixtureProvider({ sourceAccess: true, repoRoot, readFile })`. A host with a real working tree
constructs its own provider the same way to get real `snippet`/`context` body text.
