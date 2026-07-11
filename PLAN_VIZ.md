# PLAN_VIZ.md — graph visualisation: recency-seeded spiral walk + pseudo-3D depth rendering

> **STATUS: design-only, nothing implemented.** Grounded directly against real code in both
> repos (citations below), not a from-scratch idea. Not staffed, not scheduled.

## Origin

Operator request, 2026-07-11: visualise tmct's own graph as a feature, inspired by seonix's `viz`
command but explicitly not its timeline view. The idea: the default view is seeded at the most
recently created or updated node and steps backward a finite number of hops via a hub-avoiding walk
("spiral fetch"), then renders with older nodes deeper/darker and newer nodes shallower/higher-
contrast — a pseudo-3D depth effect, either through a real 3D-to-2D projecting library or simulated
via z-index and colour.

## What already exists to build on

### tmct already has the hub-avoiding spiral walk — no porting needed

`spiralExpand` (`src/codegraph.mjs:718-800`) is the same algorithm seonix's own `codegraph.mjs` uses
(both descend from the marginalia/seon-mcp lineage). It seeds from a set of nodes, then expands via a
binary min-heap ordered `(hop ASC, degree ASC, id ASC)` — always popping the closest, least-connected
node first — and at each step keeps only the lowest-degree `⌊q·n⌋` fraction of candidate neighbours
(default `q=0.9`, drop the densest 10%), so expansion fans through sparse regions and fizzles at
hubs rather than flooding through them. Bounded by `depth` (max hops) and `nodeLimit` (emit budget).

Two things need to change for this feature, both scoped, neither a rewrite:

1. **Seed selection.** Today `spiralExpand` seeds from `scored` — the modules a lexical query already
   matched (`scoreModules`, `src/codegraph.mjs:1076`). This feature needs a different seed: the single
   individual with the most recent `mgx:createdAt` (or an operator-supplied `--focus <id>`).
2. **Class restriction.** The walk currently only ever visits/emits `ind.class === "Module"` nodes
   (`src/codegraph.mjs:757,762`) — a hardcoded code-graph assumption. The memory graph's classes are
   `Utterance`/`Fact`/`Session`/`Source`/`Rule` (`src/memory/core.mjs:41-45`), not `Module`, so this
   restriction needs generalising (a caller-supplied class predicate, not a literal string) before the
   walk can run over `.tmct/memory/graph.json` at all.

`node.hop` is already computed internally for the decay-scoring math — it just needs to be part of
the function's *returned* shape (it currently isn't; `spiralExpand` mutates `scored` and returns
nothing) so a renderer can use it for depth encoding.

### Recency data already exists on every memory-graph individual

`CREATED_AT_PROP = "mgx:createdAt"` (`src/memory/core.mjs:52`) — first-write-wins ISO-8601, stamped
on every individual in `.tmct/memory/graph.json`. This is real, already-written data (also already
consumed for trust's recency nudge, `src/memory/trust.mjs:83-96`) — no new instrumentation needed to
pick a seed or bucket nodes by age.

### The code graph has no per-individual timestamps — scope this to the memory graph

`.tmct/graph.json` (the `--repo` code graph) carries one top-level `generated_at` on the whole
snapshot, nothing per-individual. A recency-seeded walk has nothing to seed from there. **v1 targets
the memory graph only.** A degree-seeded default view for the code graph (mirroring how seonix's own
`viz --focus` defaults to the highest-degree module, `../seonix/src/viz.mjs:84,840`) would be a
different, later feature — not what was asked for here.

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
class restriction (generalise past the hardcoded `"Module"` check), and the output shape (surface
`hop` per node) need to change. Depth/budget stay operator-tunable, the same knobs already named
(`spiralDepth`, `spiralNodeLimit`), exposed directly on the CLI rather than buried in ranking options.

**Open question to resolve before implementation**: `spiralExpand`'s current edge-kind allowlist
(`SPIRAL_EXPAND_KINDS`) is code-graph-specific (imports/calls/callsSymbol/inherits). The memory
graph's own edge kinds — `mgx:saidInSession`, `mgx:inReplyTo`, `mgx:derivedFrom`, the reified
`rdf:subject`/`rdf:predicate`/`rdf:object` triple edges on each `Fact`, taught `owl:ObjectProperty`
edges — need their own deliberate allowlist. Walking through every reified-Fact triple edge blindly
would likely be noisy (three edges per fact, all pointing at the same node); this needs a real pass,
not a blind copy of the code-graph kind list.

### 2. Rendering — Cytoscape.js as the base, a pseudo-3D depth layer on top

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
  (simpler, matches the ring layout exactly) or by real elapsed time from `mgx:createdAt` (more
  literally "recency", but could produce uneven rings if graph activity is bursty) — hop-bucketing is
  the simpler default, revisit if it reads wrong in practice. A small size/blur reduction per hop
  reinforces the same depth read without needing a projection matrix.
- **Considered alternative — true 3D**: a WebGL force-graph library (e.g. `3d-force-graph`, itself
  three.js-based) gives a real rotatable projection instead of a simulated one. Heavier dependency,
  needs WebGL, more implementation surface (camera controls, projection tuning). Worth a quick
  prototype spike before committing either way — not a call to make from a doc alone.
- **Carry over seonix's proven readability wins**: bounded node sizing and a label budget both already
  have working reference implementations to copy from (`../seonix/src/viz.mjs:365,369,438-450`).

### 3. Scope boundaries

- No timeline, no Chronograph-style temporal scrub/diff browser — a graph view only.
- v1 targets the memory graph (`.tmct/memory/graph.json`) only, not the code graph.
- CLI shape loosely mirrors seonix's own (`tmct viz [--focus <id>] [--steps N] [--out f.html]`),
  landing as a new `bin/tmct.mjs` mode alongside the existing `chat`/`memory`/`serve`/etc. modes.

## Out of scope

- The Chronograph browser and the commit-timeline page.
- Visualising the code graph in this pass — no per-individual recency data to seed a spiral from; a
  separate, degree-seeded default view would be a different, later feature.
- Committing to a WebGL/3D rendering library without a prototype spike first.

## Next step

Not staffed. When picked up: (1) resolve the memory-graph edge-kind allowlist question above,
(2) generalise `spiralExpand`'s seed source and class restriction, and expose `hop` in its output
shape rather than only using it internally for score decay, (3) spike the CSS-depth-effect renderer
against a real `.tmct/memory/graph.json` from an active session, checking the "structurally less
noisy than seonix's default" hypothesis for real before writing more of it.
