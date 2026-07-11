# PLAN_VIZ.md — graph visualisation: recency-seeded spiral walk, pseudo-3D depth rendering, node/property timestamps, and situational-fact seeding

> **STATUS: design-only, nothing implemented.** Grounded directly against real code in both
> repos (citations below), not a from-scratch idea. Not staffed, not scheduled.

## Origin

Operator request, 2026-07-11, in three parts:

1. Visualise tmct's own graph as a feature, inspired by seonix's `viz` command but explicitly not
   its timeline view. The default view is seeded at the most recently created or updated node and
   steps backward a finite number of hops via a hub-avoiding walk ("spiral fetch"), then renders
   with older nodes deeper/darker and newer nodes shallower/higher-contrast — a pseudo-3D depth
   effect, either through a real 3D-to-2D projecting library or simulated via z-index and colour.
2. Follow-up: "updated" needs to be a real concept, not just "created" — a node counts as updated
   when one or more of its own properties were created or updated, at both the node level and the
   property level, on both graphs (not memory-graph-only).
3. Follow-up, explicitly flagged by the operator as "not strictly related" but bundled into this
   same doc rather than a separate one: inject situational facts at two points — (a) at persona/
   vocabulary seeding time: the date/time of seeding, recent changes from tmct's own git history
   (as a pre-generated, committed, shipped text corpus — **not** a live `git log` run against
   whatever repo `tmct init` happens to be pointed at — ingested at init), and the target repo's
   own `README.md` contents (parsed as much as practical, read live since it's a local file, not a
   git dependency); (b) at chat-session start or a sessionless operation's invocation: the session
   creation timestamp, the mode of invocation (chat/serve/cli), and the current time when the
   operation began.
4. Edge-kind traversal for the spiral walk: walk all real edge kinds — trust the hub-avoiding
   degree-quantile gate to keep it legible rather than hand-curating an allowlist.

## What already exists to build on

### tmct already has the hub-avoiding spiral walk — no porting needed

`spiralExpand` (`src/codegraph.mjs:718-800`) is the same algorithm seonix's own `codegraph.mjs` uses
(both descend from the marginalia/seon-mcp lineage). It seeds from a set of nodes, then expands via a
binary min-heap ordered `(hop ASC, degree ASC, id ASC)` — always popping the closest, least-connected
node first — and at each step keeps only the lowest-degree `⌊q·n⌋` fraction of candidate neighbours
(default `q=0.9`, drop the densest 10%), so expansion fans through sparse regions and fizzles at
hubs rather than flooding through them. Bounded by `depth` (max hops) and `nodeLimit` (emit budget).

Four things need to change for this feature — three scoped, one a real gap the strategy advisor
caught on an adversarial re-check of this doc (2026-07-11 tick 3, credited below) that an earlier
draft understated as already-scoped:

1. **Seed selection.** Today `spiralExpand` seeds from `scored` — the modules a lexical query already
   matched (`scoreModules`, `src/codegraph.mjs:1076`). This feature needs a different seed: the single
   individual with the most recent `mgx:createdAt` (or an operator-supplied `--focus <id>`).
2. **Class restriction.** The walk currently only ever visits/emits `ind.class === "Module"` nodes
   (`src/codegraph.mjs:772,788`) — a hardcoded code-graph assumption. The memory graph's classes are
   `Utterance`/`Fact`/`Session`/`Source`/`Rule` (`src/memory/core.mjs:41-48`), not `Module`, so this
   restriction needs generalising (a caller-supplied class predicate, not a literal string) before the
   walk can run over `.tmct/memory/graph.json` at all.
3. **Edge-kind allowlist.** Per the operator's explicit instruction, don't hand-curate — walk every
   real edge-kind group and let the degree-quantile gate do the work. Concretely, "every real edge
   kind" on the memory graph is a smaller set than an earlier draft of this doc assumed: it's the
   genuine `objectProperties` groups only — `mgx:derivedFrom`/`mgx:statedBy`/`mgx:canonicalisedFrom`,
   `mgx:saidInSession`, `mgx:inReplyTo`, `mgx:asksAbout`, plus whatever taught `owl:ObjectProperty`
   relations exist. **The reified `rdf:subject`/`rdf:predicate`/`rdf:object` triples are NOT edges at
   all** — they're plain `attributes` on the `Fact` individual itself (`src/memory/core.mjs:1181-
   1184,1264-1267`), so there is nothing to walk there and no allowlist question to resolve for them.
   This corrects an earlier draft of this doc, which mis-described them as edges.
4. **`adjacencyForKinds` itself silently produces an EMPTY adjacency map over the memory graph —
   not just a class-restriction problem, a separate blocker.** `adjacencyForKinds` (`:627-640`) routes
   every edge endpoint through `moduleIdOfId → moduleIdOf` (`:1209-1224`) before linking it —
   `moduleIdOf` returns the node itself only when `class === "Module"`, else falls back to a
   code-graph-specific `site` span or an `fn:<path>#name` id. No memory-graph individual (`utt:…`,
   `fact:…`, etc.) matches any of those, so `moduleIdOf` returns `null` for every one, and `link()`'s
   own guard (`if (!a || !b || …) return;`, `:630`) silently drops every edge. Point 2's class
   restriction alone does NOT fix this — the walk would run over an empty adjacency map and go
   nowhere. Fix sketch: give `adjacencyForKinds` a caller-supplied id-normalizer parameter, defaulting
   to the existing `moduleIdOf` for code-graph callers; a memory-graph caller passes an identity
   function (`(id) => id`) instead, since memory-graph edges already connect individuals directly —
   there's no function-within-module rollup concept to replicate there.

`node.hop` is already computed internally for the decay-scoring math — it just needs to be part of
the function's *returned* shape (it currently isn't; `spiralExpand` mutates `scored` and returns
nothing) so a renderer can use it for depth encoding.

### Timestamps today: real, but write-once, node-level only, and absent on every edge

Re-checked precisely (an earlier draft of this doc understated the gap):

- `CREATED_AT_PROP = "mgx:createdAt"` (`src/memory/core.mjs:52,59`) is genuinely **write-once**.
  `firstWriteCreatedAt()` (`:735-740`) is the single function every writer routes through (Sources
  `:778-793`, Utterances `:1043-1081`, Facts `:1157-1199` and `:1222-1296`, Rules `:1356-1395`), and
  it unconditionally keeps the prior individual's existing value if one exists. There is **no
  "updated" concept anywhere today** — `mgx:createdAt` means "first learned," full stop.
- **Edges carry no timestamp at all.** `upsertEdge()` (`src/memory/core.mjs:1000-1012`) writes plain
  `{subject, object, subjectLabel, objectLabel}` rows — no timestamp field exists to read one from.
- **Attributes generally carry no per-attribute timestamp** — only the individual's own
  `mgx:createdAt` covers its whole attribute set, at individual granularity. One partial exception in
  practice: taught adjectives (`owl:hasValue` restrictions from `resolveNP`, `src/grammar/ace.mjs:
  104-146`) mint each restriction component as its OWN `Fact` individual with its own independent
  `mgx:createdAt` — so that specific case already has fine-grained timestamps, just because each
  component happens to be its own individual, not because attributes are timestamped in general.
- **Some individuals genuinely DO mutate after creation** — this is where "updated" is a real,
  non-hypothetical need, not just a hygiene nicety: `upsertSession()` (`src/sessions.mjs:71-148`)
  re-writes `mgx:sessionTurns`/`mgx:sessionEnded`/etc. on an existing Session individual every chat
  turn, while preserving `mgx:createdAt` via the same first-write-wins discipline (`:76-79,119`) —
  so a long-running session's Individual is visibly stale-looking by `createdAt` alone today, with no
  way to tell "when was this last touched."
- **Two independently-implemented, same-named `Session` classes exist, in two different graphs** —
  worth flagging explicitly, not conflating: `MEMORY_SESSION_CLASS` (`src/memory/core.mjs:39`,
  created by `ensureSession()`, `:1026-1039`) lives in `.tmct/memory/graph.json`; a *separate*
  `Session` class (`src/sessions.mjs:71-148`, written via `appendSessionToGraph()` from
  `src/chat.mjs:7955`) lives in the **code** graph, `.tmct/graph.json`. Any timestamp/mode
  instrumentation work below needs to either touch both, deliberately pick one, or take the
  opportunity to unify them — a real decision to make before implementing, not a footnote.

### The code graph: the shape for git-derived timestamps already exists — tmct just never populates it

`src/graph-build.mjs`'s `buildEntities()` (`:33`) is explicitly documented as pure — "No
subprocesses, no filesystem, no git: data in, graph out" (`:1-5`) — but it is far richer on
git-history modelling than an earlier draft of this doc credited:

- A real **`Commit` class** exists: `commitInd()` (`:238-244`) builds one individual per commit sha
  with `mgx:commitAuthor`, **`mgx:commitDate` (ISO-8601, `:379`)**, `mgx:commitMessage`.
- Every **Module** individual already carries `derived_from: [ref]`, `ref` = the literal string
  `git:<12-char-short-sha>` (`:252,339-349`; shape confirmed in `docs/adapter-contract.md:41`) — one
  entry per commit that touched that file.
- That's already rich enough to derive real per-module created/updated timestamps (min/max of the
  `mgx:commitDate` values the module's `derived_from` short-shas resolve to) with **zero new schema
  work** — *provided* something actually supplies `commits`/`symbolHistory` to `buildEntities()`.

**The real gap**: nothing in tmct's own codebase ever calls `buildEntities()` in production — the
only callers are test fixtures. `docs/adapter-contract.md:8-9` states the actual architecture
directly: *"tmct consumes a code graph; it never produces or mutates one"* — gathering `git log`
data for the code graph is a provider's job (seonix, a CI indexer, a hand-written file), by design,
not tmct's. `bin/tmct.mjs`'s `init`/`import` modes only scaffold a config pointing at a graph-file
path (`src/init.mjs:53,125-132`) — they never build a graph.

**This is an open architectural decision, not something this doc resolves**: either (a) stay inside
the existing "tmct never produces a graph" boundary, and this feature's code-graph timestamps depend
entirely on an external provider populating `commits`/`symbolHistory` — nothing to build here beyond
documenting the ask; or (b) tmct grows a new, explicitly-scoped, opt-in provider mode of its own for
when `--repo` points at a real local git checkout (most `--repo` targets are exactly that). Whoever
picks this up needs to make that call explicitly — this doc flags it rather than picks a side.

The only git-shelling precedent in the codebase today: `defaultGitRoot()` (`src/cli-args.mjs:34-39`)
and `gitToplevel()` (`src/chat.mjs:3283-3289`), both just `git rev-parse --show-toplevel` in a
try/catch, degrading to `null`/cwd on failure. No `git log`/`git blame` call exists anywhere to copy
from — a real per-file/per-symbol history gatherer would be new work, not an extension of an existing
loop (there isn't one).

### seonix's `viz.mjs` (988 lines) — real precedent, not being copied wholesale

Cytoscape.js, bundled and inlined into a static HTML artifact (`../seonix/src/viz.mjs:1,177-183`),
flat 2D only — `cose`/`breadthfirst`/`concentric` layout choices (`:379,465,474`). Node colour encodes
class/type (fixed palette); node size encodes degree, bounded (`:365,369`); labels are budgeted to the
top-N by degree, not shown for every node (`:438-450`). No 3D, no z-depth, no recency encoding
anywhere — confirmed by a full grep, not an oversight in this doc. Two sibling artifacts, a Chronograph
temporal code-browser and a commit timeline, ship alongside it by default — both explicitly **out of
scope** here per the operator ("we don't need the timeline view").

The one documented readability complaint on file (`../seonix/PLAN_SEON_TUNING.md` §5.15, an
unimplemented backlog idea) is legend clutter (`0/0` type chips) plus "uniform depth-N BFS across all
edge types, then a flat hide-deg>16 cutoff" being a blunt instrument for what gets shown. tmct's
version should sidestep the second half of that structurally: `spiralExpand`'s degree-quantile gate
prunes hubs *during* the walk — a hub is never fetched at all — rather than being filtered out of an
already-fetched, already-noisy BFS neighbourhood after the fact.

## Design

### 1. Traversal — adapt `spiralExpand`, don't reinvent it

Sort memory-graph individuals by `mgx:createdAt` descending, seed from the single most recent (or an
operator `--focus <id>` override, matching seonix's own convention). Reuse the existing adjacency
build, degree-quantile gate, and hop/degree/id-ordered min-heap unchanged — only the seed source, the
class restriction (generalise past the hardcoded `"Module"` check), the edge-kind set (the real
object-property groups, per "What already exists," above — no reified-triple edges to worry about),
and the output shape (surface `hop` per node) need to change. Depth/budget stay operator-tunable, the
same knobs already named (`spiralDepth`, `spiralNodeLimit`), exposed directly on the CLI rather than
buried in ranking options.

### 2. Node/property timestamps — createdAt is real, updatedAt needs new, scoped instrumentation

- **Add a `createdAt`-style field to `upsertEdge()`** (`src/memory/core.mjs:1000-1012`) — small,
  contained, matches the existing first-write-wins discipline used everywhere else. This gives every
  property/edge its own creation time, which today doesn't exist at all.
- **Define node-level `updatedAt` as DERIVED, not stored** — computed at spiral-walk/render time as
  `max(node.createdAt, every attached edge's createdAt)`, not a new field every edge-writing call site
  has to remember to bump. This is the natural reading of "updated on a node means one or more of its
  properties were created or updated" and avoids the correctness risk of a stored field silently going
  stale if some future write path forgets to touch it.
- **Handle genuinely-mutated individuals explicitly** — `Session` (both graphs, see the two-classes
  flag above) is the concrete, real case: `upsertSession()`/`ensureSession()` already rewrite
  attributes on an existing individual over a session's lifetime. These call sites need to actually
  stamp an updatedAt-shaped signal when they mutate (the derived "max over edges" rule doesn't cover a
  node whose *own* attributes change without a new edge appearing) — scope this to the individuals
  that are known to mutate in place today (Session; also worth checking trust-score recomputation,
  `TRUST_SCORE_PROP`/`TRUST_INPUTS_PROP` in `src/memory/trust.mjs`, which re-stamps a Fact's trust
  attributes as new evidence arrives) rather than instrumenting every write path speculatively.
- **Code graph**: blocked on the architectural decision flagged above (provider-populated vs. a new
  tmct-owned local-git provider mode) — no schema change needed either way, since `Commit`/
  `derived_from` already carry what's needed once something populates them.

### Concrete implementation (2026-07-11 session — items 1-3 above)

Verified live against the real repo (grep + fixture tracing), not assumed. Landing as three changes:

**`adjacencyForKinds` id-normalizer + the `relationKind` gap it doesn't fix alone.** New signature:
`adjacencyForKinds(graph, kinds, idNormalizer = null)` — `idNormalizer` defaults to `(id) =>
moduleIdOf(graph, ind)` via the existing `moduleIdOfId`, so the sole existing caller
(`adjacencyForKinds(graph, kinds)` in `beamExpand`, `:678`) is untouched. A memory-graph caller passes
`(id) => id`. This alone is **not sufficient**: `edgesOfKind` (`:1189-1204`) gates on `relationKind`
(`:96-114`), a closed classifier over a hardcoded `PROP_KIND` table (`:68-94`) plus regex fallbacks —
none match the memory graph's real predicates (`saidInSession`, `inReplyTo`, `statedBy`,
`canonicalisedFrom`), so `edgesOfKind(memoryGraph, anyKind)` returns `[]` today regardless of the
id-normalizer fix. Add four lowercase entries to `PROP_KIND` mapping each predicate to itself as its
own kind name (no module-rollup abbreviation needed, unlike `imports`/`calls`). Confirmed safe: `KINDS`
(`:63`) is declared but never referenced elsewhere, and `relationKind`'s only other callers
(`src/concept.mjs:387`, `src/ask.mjs:107`) only ever run it against code-graph relation groups.

**`upsertEdge()` createdAt + derived `updatedAt`.** `upsertEdge()` (`src/memory/core.mjs:1000-1012`)
stamps `createdAt` on each edge, first-write-wins over the same `(subject,object)` pair (mirrors
`firstWriteCreatedAt`) — a re-upserted edge keeps its original creation time rather than resetting to
"now" on every write. New pure function `derivedUpdatedAt(graph, ind, {createdAtProp, updatedAtProp})`
in `src/codegraph.mjs` (next to `edgesOfKind`/`moduleIdOf` — it operates on the shared parsed-graph
shape, not memory-specific) = the node's own `updatedAt`/`createdAt` attribute, or the max `createdAt`
over every edge touching it, whichever is newer; `""` if nothing has a timestamp. New exported
constant `UPDATED_AT_PROP = "mgx:updatedAt"` in `src/memory/core.mjs`, stamped explicitly (not
derived) at the three sites that mutate attributes in place without necessarily touching an edge:
`src/sessions.mjs`'s `upsertSession` (the **code-graph** Session class — confirmed `ensureSession`,
the memory-graph Session, is actually write-once and does NOT need this), `recomputeFactTrust`, and
`recomputeSourceReliability` (both `src/memory/core.mjs`). Known, deliberately out-of-scope gap: two
edge writers bypass `upsertEdge()` entirely (`src/memory/fold.mjs`'s `addCanonicalisedFromEdges`,
`src/sessions.mjs`'s own `asksAbout` edges) — their edges get no `createdAt` from this fix; noted, not
closed, since `derivedUpdatedAt` already tolerates a missing `e.createdAt` by skipping it.

**`spiralExpand` generalization.** New options, every one defaulting to today's exact behavior so the
sole call site (`scoreModules`, `:1076-1080`) needs zero changes: `kinds` (default
`SPIRAL_EXPAND_KINDS`), `classPredicate` (default `(ind) => (ind.class || "") === "Module"`, replacing
the two hardcoded checks at `:772,788`), `idNormalizer` (default `null`, threaded into the internal
`adjacencyForKinds` call), `seeds` (explicit id iterable; default derives from `scored` as today).
`scored` itself becomes optional (`= []`) — a pure viz walk has no lexical-match list, so the existing
score-nudge machinery is gated behind `scored.length > 0 && maxSeed > 0` rather than erroring on empty
input. New constant `MEMORY_SPIRAL_EXPAND_KINDS = ["saidInSession", "inReplyTo", "statedBy",
"canonicalisedFrom"]` — the real memory-graph edge-kind inventory (traced via every
`objectProperties.push`/`.find` site in `src/memory/*.mjs` and `src/sessions.mjs`; corrects this doc's
earlier list, which incorrectly included `mgx:asksAbout` — that's code-graph-only). Return value
changes from `undefined` to `[{id, hop}]` (every node the walk actually pops, seeds at hop 0) — safe,
since the sole caller discards the return value today. New helper `mostRecentIndividual(graph,
createdAtProp)` resolves item 1's "most recent `mgx:createdAt`" seed default (deterministic tie-break
by id) — the `--focus`/CLI wiring itself stays out of this pass's scope.

Tests: extend `test/codegraph.test.mjs` (new `relationKind` entries, a `derivedUpdatedAt` unit test, a
memory-graph fixture proving `spiralExpand` reaches Session/Fact/Source via the new kinds — the one
test that would have caught both the `moduleIdOf` and `relationKind` blockers together), fix the
now-fragile exact-shape assertion at `test/memory-core.test.mjs:107-110` (adding `createdAt` to
`upsertEdge`'s output breaks its strict 4-key `deepEqual`), add a re-append-preserves-createdAt case,
and an `upsertSession`/trust-recompute `updatedAt` test.

### 3. Situational-fact seeding

**At persona/vocabulary seeding time** (`initRepo()`, `src/init.mjs:205-335`, step 3 at `:248-314` is
where corpus seeding already runs — the natural place to add this):

- **Date/time of seeding**: trivial, a live wall-clock read at init time. Note this is already
  partially captured today outside the graph — `.tmct/memory/corpus-seed.json`'s `seededAt`
  (`src/init.mjs:301`) and `.tmct/provenance.json`'s `initializedAt` (`:321`) both exist as sidecar
  JSON files the graph never reads. This feature should promote that moment into a real graph
  fact/individual, not just a sidecar file.
- **tmct's own recent git history**: per the operator's explicit correction, this is **not** a live
  `git log` run against whatever repo `tmct init` happens to be pointed at (most targets are other
  people's projects, and an npm-installed tmct has no `.git` of its own to query anyway). Instead: a
  maintainer-run generation step — `git log` against **tmct's own repository**, producing a text
  corpus, committed into this repo (alongside the existing WordNet/ConceptNet/SEON corpus files,
  `src/corpus/`), shipped via npm, and ingested at every `tmct init` regardless of target repo — the
  same pre-baked-and-shipped pattern this project already uses for every other knowledge source. This
  gives tmct's persona situational grounding in its own development history, refreshed only when a
  maintainer re-runs the generation step and re-commits the corpus, never live.
- **The target repo's own `README.md` contents**: the opposite case — read live from disk at init
  time (a local file read, not an external dependency the way git is), parsed "as much as we can" and
  ingested as facts/attributes. Confirmed genuinely new: no code anywhere currently reads `README.md`.
- **Provenance**: reuse the existing `SOURCE_CLASS` convention (`src/memory/core.mjs:41`) exactly as
  other corpus sources do — `sourceIdFor()` (`:761-771`) has an extensible kind-branch design already;
  add a new kind (e.g. `"seed"`) alongside `corpus`/`operator`/`teach`/`provider`/`web`/`entailed`,
  rather than inventing a new provenance mechanism.

**At chat-session start or a sessionless operation's invocation:**

- **Session creation timestamp**: already captured for the real chat path (`startIso`,
  `src/chat.mjs:7943`) but only written to local log/sidecar files, and only promoted into a graph
  individual **lazily**, once a session has ≥1 turn (`appendSessionToGraph()`, gated at
  `src/chat.mjs:7954`) — a true zero-turn session or a `serve`/`cli` sessionless call gets no
  individual at all today.
- **Mode of invocation**: genuinely new. Neither `Session` class (memory graph or code graph) carries
  any field distinguishing chat vs. `serve` vs. `cli` today — confirmed by reading every attribute
  either `ensureSession()` or `upsertSession()` writes.
- **Current time when the operation began**: same story as session creation timestamp — captured
  locally for chat, not captured at all for `serve` (`src/server-http.mjs:189` calls `runTurn(...,
  { sessionId: "", memoryDir: null })` — no session, no memory writes, nothing recorded anywhere) or
  `cli` (`dispatchTool()`, `src/server.mjs`, same anchor-less shape).
- **Design implication**: this needs a lightweight anchor individual created *eagerly* (at operation
  start, not lazily at first turn) for all three invocation shapes, carrying the new `mode` field and
  the operation-start timestamp — following the already-proven `upsertSession`/`ensureSession` write
  pattern rather than inventing a new one. Given the two-Session-classes wrinkle above, decide which
  graph this anchor belongs in (or both) as part of the same pass, not as an afterthought.

### 4. Rendering — Cytoscape.js as the base, a pseudo-3D depth layer on top

Recommend keeping Cytoscape.js as the renderer (proven in the sibling repo, inlines into a
dependency-light static HTML artifact, no server required) rather than adopting a true WebGL/3D engine
for v1. A true-3D option is named below as a considered alternative, not ruled out.

- **Layout**: repurpose Cytoscape's `concentric` layout (already used in seonix, `:474`), but drive
  the concentric ordering by the walk's own `hop` value instead of degree — newest node at the centre,
  each ring outward one hop further back. This makes the traversal's shape and the rendered layout the
  same idea twice: a literal spiral, not just a metaphorical one.
- **Depth/age encoding** (the operator's core idea): implement via Cytoscape style mappings, not real
  3D — paint order by hop (older rings drawn first, newer rings drawn on top, so newer nodes read as
  "in front"), plus a colour-lightness/opacity falloff keyed to age. Needs one decision: bucket by hop
  (simpler, matches the ring layout exactly) or by real elapsed time from `mgx:createdAt`/the new
  `updatedAt` (more literally "recency", but could produce uneven rings if graph activity is bursty) —
  hop-bucketing is the simpler default, revisit if it reads wrong in practice. A small size/blur
  reduction per hop reinforces the same depth read without needing a projection matrix.
- **Considered alternative — true 3D**: a WebGL force-graph library (e.g. `3d-force-graph`, itself
  three.js-based) gives a real rotatable projection instead of a simulated one. Heavier dependency,
  needs WebGL, more implementation surface (camera controls, projection tuning). Worth a quick
  prototype spike before committing either way — not a call to make from a doc alone.
- **Carry over seonix's proven readability wins**: bounded node sizing and a label budget both already
  have working reference implementations to copy from (`../seonix/src/viz.mjs:365,369,438-450`).

### 5. Scope boundaries

- No timeline, no Chronograph-style temporal scrub/diff browser — a graph view only.
- v1 rendering targets the memory graph (`.tmct/memory/graph.json`); the code graph is blocked on the
  architectural decision in "What already exists," above, not ruled out.
- CLI shape loosely mirrors seonix's own (`tmct viz [--focus <id>] [--steps N] [--out f.html]`),
  landing as a new `bin/tmct.mjs` mode alongside the existing `chat`/`memory`/`serve`/etc. modes.

## Out of scope

- The Chronograph browser and the commit-timeline page.
- Committing to a WebGL/3D rendering library without a prototype spike first.
- A live `git log` against arbitrary `--repo` targets — situational git context is tmct's own
  pre-baked history corpus only, per the operator's explicit correction; a target repo's live git
  history is a separate, unresolved question (see the code-graph architectural decision, above).

## Next step

Not staffed. When picked up, roughly in dependency order: (1) settle the code-graph architectural
question (provider-populated vs. a new tmct-owned local-git mode); (2) add `createdAt` to
`upsertEdge()` and stamp explicit update signals at the known in-place-mutation sites (Session, trust
recompute); (3) generalise `spiralExpand`'s seed source, class restriction, and edge-kind set, and
expose `hop` in its output shape; (4) build the maintainer-side git-log-corpus generation step and
wire seed-time README ingestion + the new `Source` "seed" kind; (5) add the eager session/sessionless
anchor individual with a `mode` field, deciding the two-Session-classes question at the same time;
(6) spike the CSS-depth-effect renderer against a real `.tmct/memory/graph.json` from an active
session, checking the "structurally less noisy than seonix's default" hypothesis for real.
