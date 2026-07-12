# PLAN_VIZ_MEMORY.md — make `tmct viz` show (and answer from) as much of the real memory graph as `npm run chat` does

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-12 session, live playtest. The operator asked "what is a dog" via `npm run chat` and got a
real, grounded answer (`dog is a kind of animal`, `dog has tail`, `dog can bark`, plus a
`corpus-weak:`-hedged `dog is related to screen` — the corpus-scale-up work landing the same
session). The operator then asked the SAME question through `tmct viz`'s embedded "Ask the graph"
panel and got `"dog" isn't a term in this graph's own vocabulary (no matching class or predicate)`.
Traced live in this session (not assumed): two independent, real bugs, not one.

The operator's own framing, verbatim, sets this document's scope: "I would like to be able to have
as close to the cli chat and loaded graphs in graph viz as I can, for the local browser read we
don't need to worry about page weight for download but there's still a need to determine a useful
limit for the page size and to have a high default and the ability to change it and please come up
with a strategy for what gets on the page... look at the controls ../seonix has I want more of
those and find a way to pick the types we filter on automatically from what best segments the data
this can be queried at generation time."

## Bug 1 — the embedded "Ask the graph" panel runs the wrong engine

`tmct viz`'s page bundles `ask()` (`src/ask.mjs`, browser-built by
`scripts/build-ask-bundle.mjs` from the narrow `src/ask-browser-entry.mjs` re-export) — tmct's
**code-graph** query engine, built for "which modules import X" over an indexed *codebase*: classes,
modules, predicates like `imports`/`calls`. It has no concept of Facts or corpus data at all. The
miss message (`ask.mjs:3868`) is honest from that engine's own point of view — "dog" really isn't a
class or predicate in a code graph — but it's the wrong engine entirely for a memory-graph question.
`computeVizGraph` (the part that draws nodes) correctly reads the memory graph via `loadMemory`; only
the ask panel is mis-wired.

**Why `ask()` bundles cleanly and `factAnswer`/`runTurn` don't, today:** `ask(graph, query, opts)`
takes an already-parsed, in-memory graph object as its first argument — zero I/O inside the
function. `factAnswer(memoryDir, query, ...)` and `runTurn(input, {memoryDir, ...})`
(`src/chat.mjs:4604`, `:8922`) both take a **directory path string** and do real async `fs` I/O via
`loadMemory(memoryDir)` internally, every call. That's the actual blocker — not the size or
complexity of `chat.mjs`.

**The fix does not need a `factAnswer`/`runTurn` signature refactor.** `renderVizHtml` already
embeds the full memory payload inline as a page-level constant (`payloadJson`, viz.mjs's existing
`embedJson({...payload})` call) — the data the ask panel needs is already sitting in the page,
unused by the current bundle. The precedent (`ask-browser-entry.mjs`'s narrow 7-export re-export,
not the whole `ask.mjs` file) is: build a second narrow browser entry point,
`src/memory-ask-browser-entry.mjs`, that re-exports just `factAnswer` (and whatever `chat.mjs`
helpers it calls internally that also do `fs` I/O), with `src/memory/core.mjs`'s `loadMemory`
shimmed at bundle time (the same Node-builtin-stub esbuild plugin `build-ask-bundle.mjs` already
uses for `fs`/`path`, extended to special-case `loadMemory` specifically) to return the page's
already-embedded `PAYLOAD` constant instead of doing real file I/O. Everything downstream of
`loadMemory` inside `factAnswer` is pure graph traversal over the returned payload shape — no
further I/O to stub.

**Answer scope, matching seonix's proven precedent:** seonix's ask panel deliberately queries a
SEPARATE, full (not depth-limited) graph channel — its own comment states plainly: "querying only
what's currently drawn would silently produce incomplete answers." tmct's viz already embeds the
FULL payload unconditionally (no lazy-load needed, unlike seonix's size-gated split), so the fix is
simply: point the shimmed `loadMemory` at the full `PAYLOAD`, never the depth-limited walked subset.
When an answer cites a fact whose subject/object isn't in the currently-drawn node set, the panel
should say so explicitly ("cited from the full graph, not currently shown — click to load its
neighbourhood") rather than silently answering from data the user can't currently see highlighted,
mirroring seonix's own explicit-note handling of the same situation.

## Bug 2 — the memory-graph walk only follows meta edges, never real fact relations

`computeVizGraph` → `spiralExpand(graph, [], {kinds: MEMORY_SPIRAL_EXPAND_KINDS, seeds: [seedId],
...})`. `MEMORY_SPIRAL_EXPAND_KINDS = ["saidInSession", "inReplyTo", "statedBy",
"canonicalisedFrom"]` (`src/codegraph.mjs:673`) — every one of these is a **provenance/meta** edge
(Utterance↔Session, Utterance↔Utterance reply chain, Fact↔Source). None of them is the actual
subject→predicate→object relation between concept terms ("dog IsA animal"). `buildVizNodesAndEdges`
(`codegraph.mjs:1394`) draws EDGES correctly from `graph.relations` (real subject/object pairs), but
only between nodes ALREADY in the walked set — and the walk that decides which nodes appear never
traverses those relation edges at all. So a memory graph's actual concept structure is **structurally
invisible** to the walk regardless of `--depth`/`--limit` tuning (the flags this session's Phase 1-
adjacent work just added control how far/wide the walk goes, not what kind of edge it follows). This
is the deeper reason the operator's `graph.html` looked like "just the told data from the chat
visitor" — the walk is a session/provenance browser, not a concept-graph browser, by construction.

**Fix:** add a second walkable-kind set for FACT relations — every `objectProperties`/`relations`
group's predicate (`rdfs:subClassOf`, `mgx:hasA`, `mgx:usedFor`, `mgx:relatedTo`, ... the full
`FACT_PREDICATE_PHRASES` vocabulary, `src/chat.mjs:4022`) — and walk BOTH kind sets together by
default (meta edges for the "how did this fact get here" provenance view, relation edges for the
"what does this connect to" concept view), so a click on "dog" reaches "animal"/"tail"/"bark" the
same way asking about it in chat would surface those same facts. Keep the existing meta-only walk
available as a filterable EDGE-KIND toggle (see Controls below), not deleted — provenance navigation
is still a real, useful view, just not the only one.

## Page-size strategy (local-only viewing, download weight is not a constraint)

The operator's framing is explicit: page weight for download doesn't matter here (this is a local
`file://` artifact, not something served over a network), but a useful DISPLAY limit still matters —
rendering hundreds of thousands of nodes at once in a canvas is unusable regardless of file size, and
with `init:xl`/`init:xxl` landing this session (measured: init:large's own conceptnet component alone
already jumps to ~37,800 facts; xl/xxl target ~74K/~264K), the current unconditional single-walk
default (12 nodes) is far too small and an *unbounded* default would be far too large.

Adopt seonix's proven three-cap shape, ported to tmct's existing `spiralExpand` (already has `depth`/
`nodeLimit`; needs a third cap added):
- **`depth`** (max hops from focus) — already CLI-exposed this session (`tmct viz --depth`,
  default 3).
- **`nodeLimit`** (spiral length, total nodes walked) — already CLI-exposed (`tmct viz --limit`,
  default 12) — **raise the default** now that real concept-relation edges will be walkable (Bug 2's
  fix) and the corpus is much larger; seonix's own default is 200, a defensible starting point here
  too, review once Bug 2 lands and the walk actually reaches concept-dense territory.
  seonix caps to 200 on 40 hardcoded code-graph classes at 40 hub-degree — an equivalent tmct default
  needs its own tuning pass against real xl/xxl data, not a blind copy.
- **`hubDegree`** (NEW — not present in tmct today): stop expanding THROUGH nodes above this many
  connections (still show the hub itself, just don't fan out from it) — seonix default 40. Without
  this, a high-degree concept (a common hypernym like "thing" or "entity", reachable from thousands
  of IsA facts) would swallow the entire node budget in one hop. Needs its own CLI flag
  (`--hub-degree`) and UI control.

`--depth`/`--limit`/`--hub-degree` all stay CLI-overridable (already true for the first two), with a
live client-side re-walk-capable page (see Controls) so a user doesn't need to regenerate the HTML
file just to see more/less.

**No large-graph sidecar-file split, unlike seonix.** seonix's `INLINE_ASKDATA_MAX_BYTES` gate exists
because seonix graphs are downloaded/shared and a single 300MB HTML file is genuinely unopenable in
some contexts. The operator's framing here explicitly waives that concern for local browser use — so
`tmct viz` keeps its current "always one self-contained file" model. The real limit that matters is
DISPLAY (the three caps above), not file size. Revisit only if a real complaint about file-open time
surfaces in practice.

## What gets on the page — seed strategy

Today: default seed is always `mostRecentIndividual` (whatever was most recently created — usually a
chat Utterance/Fact from the last turn). Keep this as the DEFAULT (it's a genuinely useful "what did
we just discuss" view), but once Bug 2 lands, a recent-activity seed will ALSO pull in that activity's
real concept neighbourhood (the facts actually touched), not just its provenance chain — which
directly addresses the operator's original complaint without needing a different default seed
strategy, just the walk-kind fix.

Add a **term-seed** mode alongside `--focus <id>`: `--term <word>` resolves to the Fact(s) whose
subject/object normalizes (via the existing `normFactTerm`) to that word and seeds from there — so
`tmct viz --term dog` becomes possible without hunting for a raw `fact:<hash>` id first. (The
click-to-recentre flow in the rendered page already provides this interactively once ANY node
mentioning "dog" is on screen; this flag is for reaching it directly from a cold start.)

## Controls — closing the gap to seonix's set

Current tmct viz controls: a depth stepper (client-side hop-visibility filter only, doesn't re-walk)
and per-class checkboxes seeded from the full embedded graph's classes. That's it — no hub-hide, no
beam-prune, no label-density control, no layout choice, no search.

Port, adapted to tmct's canvas renderer (see Open Question below on Cytoscape.js):
- **Hub-hide** (checkbox + number input, default matching `hubDegree` above): hide nodes above N
  connections outright, vs. the generation-time `hubDegree` cap which only stops expansion THROUGH
  them. Two different knobs, both useful (seonix ships both).
- **Beam-prune** (toggle + width input, default 8): BFS-order pruning that keeps only the top-N
  neighbours by degree per hop — makes a dense concept neighbourhood (e.g. "animal", with hundreds of
  hyponyms) navigable instead of an unreadable hairball.
- **Label mode** (select: smart / all-names / name+source / none): "smart" (seonix's default) shows
  labels only for focus + selection + neighbours + top-20-by-degree; the rest label on hover. tmct's
  equivalent "name+source" variant should show provenance (`corpus:human` vs `corpus-weak:conceptnet`
  vs `ace:chat:...`) inline, since trust-tier is a first-class concept here that seonix's code graph
  has no equivalent of.
- **Layout choice** (select: concentric-by-hop [current, keep as default] / force-directed / breadth-
  first): concentric-by-hop reads well for a single focus; a dense multi-cluster memory graph (once
  xl/xxl's wordnet-derived synonym/hypernym clusters are in play) may read better force-directed.
  Lowest priority of this list — only build if concentric-by-hop turns out to read poorly on real
  xl-scale data once tested.
- **Search box**: filter/highlight nodes by label substring — not present in either codebase today,
  a genuinely new, small, high-value addition given tmct's labels are natural-language terms (unlike
  seonix's code symbols, prose search is more immediately useful here).
- **Edge-kind toggle** (NEW, tmct-specific, not in seonix): meta edges (provenance/session view) vs.
  relation edges (concept view) vs. both — surfaces Bug 2's fix as a real user-facing choice instead
  of a silent default.

**Legend-as-filter, with live counts** (seonix's `GROUPS` chip pattern) — see next section for what
populates it.

**Ask panel answer semantics**: once Bug 1's fix lands, the panel should visually indicate an
answer's provenance/trust tier the same way `possibly:` hedges it in `npm run chat` — the panel is a
second surface for the SAME underlying fact-render logic (`renderFactLine`), so it should reuse it
rather than inventing separate formatting.

## Auto-picking the filter/legend dimension at generation time

seonix hardcodes its legend dimension (`GROUPS`, a fixed array of code-graph classes) — that's a
reasonable choice there because code-graph classes (Module/Class/Function/Attribute/...) are already
a small, meaningful, near-uniform split. tmct's memory graph does NOT have that property: the
`class` dimension is `{Fact, Session, Source, Utterance}` — once real data is seeded, `Fact`
dominates so heavily (measured this session: 7,386 of 7,483 individuals, 98.7%, in the CURRENT small
corpus — the imbalance only gets worse at xl/xxl scale) that a class-based legend filters almost
nothing. This is exactly the "find a way to pick the types we filter on automatically from what best
segments the data" problem the operator named.

**Candidate dimensions** (computed over the FACT individuals specifically, since that's the
dominant, undifferentiated class):
1. **`class`** — kept as a filter (Session/Source/Utterance are still real, useful toggles for the
   provenance view), just not expected to usefully split the dominant Fact bucket.
2. **`predicate`** (`rdfs:subClassOf`, `mgx:hasA`, `mgx:usedFor`, `mgx:relatedTo`, ... — the
   `FACT_PREDICATE_PHRASES` vocabulary, ~30 distinct values today, growing as more relations get
   un-excluded per this session's `TOO_HARD_AUDIT.md` work). A relation-shaped split — "show me only
   IsA facts" is a genuinely different, useful view from "show me only RelatedTo facts."
3. **`provenance` corpus prefix** (`corpus:human`, `corpus:conceptnet`, `corpus-weak:conceptnet`,
   `corpus:wordnet-xl`, `ace:chat:...`, `teach:chat:...`, `extracted:<file>`, ... — collapse the
   session-id/timestamp suffix, keep the corpus/source name). A TRUST-shaped split — directly
   surfaces the `corpusWeak`/`extracted` tiers this session built, letting a user visually separate
   "curated corpus fact" from "operator-taught fact" from "auto-extracted from a document."

**Segmentation-quality scoring** (computed once, at `tmct viz` generation time, over the actual node
set about to be rendered — embedded into the page's JSON as a precomputed `{dimension, buckets:
[{value, count}]}` list, never recomputed client-side):
- For each candidate dimension, bucket the walked nodes by that dimension's value.
- Score = normalized Shannon entropy of the bucket-size distribution (`H / log2(k)`, `k` = bucket
  count) — rewards an even-ish split, penalizes one dominant bucket swallowing everything (a `class`
  split scores near-zero once Fact dominates 98%+, correctly disqualifying it as the PRIMARY legend
  even though it stays available as a toggle).
- Disqualify a dimension if `k < 2` (nothing to filter) or `k > 20` (too many chips to be a usable
  legend — `predicate` may need a "top 15 by count, rest grouped as Other" collapse to stay under
  this bound; `provenance` naturally stays low-cardinality per corpus).
- **Pick the single highest-scoring qualifying dimension as the PRIMARY legend/filter**, offer the
  others as a dimension-switcher dropdown next to it (so a user can flip from "split by predicate" to
  "split by trust source" without regenerating the page) rather than trying to cram multiple
  legends on screen simultaneously.
- This computation is cheap (one pass over already-walked nodes, no new graph traversal) and belongs
  in `computeVizGraph` or a new `pickLegendDimension(nodes)` pure function alongside it, unit-testable
  the same way `buildVizNodesAndEdges` already is.

## Open question — stay canvas, or adopt Cytoscape.js like seonix?

seonix's much larger control surface (hub-hide, beam-prune, multiple layouts, a size-gated large-
graph split) leans on Cytoscape.js doing the actual rendering/layout/interaction work; tmct's viz is
hand-rolled canvas with a fixed concentric-ring layout. Porting every seonix control by hand onto raw
canvas is real, avoidable effort — Cytoscape.js is already a proven dependency choice in this exact
codebase family (seonix), and tmct's own "no external CDN, fully self-contained" constraint is
satisfiable the same way seonix satisfies it (the library ships inlined, not `<script src>`'d).
**Recommendation for the implementation phase (not decided here): evaluate bundling Cytoscape.js
inline before hand-rolling beam-prune/hub-hide/multi-layout on canvas** — the effort comparison
should be made with real numbers (inlined library size, since download weight doesn't matter locally
per the operator's own framing) before committing to either path.

## Phasing (implementation, not this document)

1. Bug 2 fix (walk-kind gap) — foundational; nothing else in this doc matters if the walk still can't
   reach real concept edges. Smallest, most isolated change (`MEMORY_SPIRAL_EXPAND_KINDS` addition +
   `buildVizNodesAndEdges` — likely already correct, re-verify against a relation-inclusive walk).
2. `hubDegree` cap + raised `nodeLimit` default, tuned against real `init:xl` data once that lands.
3. `pickLegendDimension` + the provenance/predicate legend, replacing the class-only legend.
4. Bug 1 fix (ask panel engine) — the narrow browser entry point + `loadMemory` shim.
5. Controls port (hub-hide, beam-prune, search, label modes, edge-kind toggle) — the Cytoscape.js
   question should be resolved before this phase, since it changes the shape of the work
   substantially.
6. `--term` seed flag.

## Non-goals

- No large-graph sidecar-file split (explicitly waived by the operator's framing — local, no download
  weight concern).
- No change to the CLI code-graph viz path (`--repo`-indexed codebases) — this document is scoped to
  the memory-graph viz path only; the two share `viz.mjs`/`codegraph.mjs` machinery but this plan's
  fixes (walk kinds, ask-panel engine, legend dimension) are all memory-graph-specific and should
  degrade to today's exact behavior when `--repo` points at a real codebase instead.
