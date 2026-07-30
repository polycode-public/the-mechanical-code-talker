# PLAN_TOOL_SURFACE.md — demo-page JS audited toward library, tool, ask

Status: SURVEY + DESIGN. Rows and phases marked **landed** are done; everything else is still a
dispatch list: every item carries a file:line, a category, and a named target, so a future session
can hand a row straight to a sub-agent without re-reading the estate.

## Origin

The operator's framing, verbatim, in two parts:

> the reason for all the demos existing is to exercise tmct in different directions so we should
> push what we can in and try and access as much as we can from the consumer tool surface which
> would be chat calling tools using classical planning based on the graph.

> if anyone looks at the page source, they should see a showcase of what tmct is capable of at the
> highest level.

And the concrete shape of "done", also the operator's: `spider-fly.html` should call a single
generic function against a natural-language request and get render-ready data back —
`fn("list the locations of flies and spiders")` for the grid, `fn("get me the large sprite for a
happy spider")` for one asset — routed through tmct's real NL-understanding and tool-calling
pipeline, rather than each page hand-rolling its own fact-store and sprite-resolver glue.

## The three tiers, and how to choose between them

Every candidate below is tagged with the tier it should land in. The rule the operator gave is to
keep as much of the user's original wording intact as the item allows:

- **lib** — a plain shared function. Nothing about the request is natural language; it is layout,
  escaping, geometry, or a fold over rows the caller already holds. Move it, import it, delete the
  copies.
- **tool** — a real entry in `src/tools/definitions.mjs` with a capability record in
  `src/domain/router/registry.mjs`. Earn this when a user's own words should be able to trigger the
  action, and no existing tool answers it.
- **ask** — route through the existing `tmct_ask` (`src/tools/handlers/tmct-ask.mjs`,
  `src/domain/ask.mjs`). Prefer this whenever the request is really a question the graph can already
  answer. It keeps the whole sentence.

## What already exists

A future session should build on this substrate rather than invent a parallel one.

**The tool layer.** `src/tools/definitions.mjs` declares 25 tools in one frozen table
(`TOOL_DEFINITIONS`, lines 47-314): 3 hot, whose schemas stay resident (`tmct_context`,
`tmct_snippet`, `tmct_ask`), and 22 cold, reached through `dispatchTool` and the CLI `cli <tool>`
route. `src/tools/server.mjs:47` is the single dispatch entry. Every tool is
query-only over the code-map graph, except `tmct_related` / `tmct_export` / `tmct_ingest`, which
read or write the conversational-memory store.

**The capability registry — the classical planner's operator set.**
`src/domain/router/registry.mjs` models each tool as a STRIPS/PDDL operator declared as plain frozen
data: typed parameters, preconditions, add and delete lists (lines 92-194, sixteen capabilities).
`resolver.mjs` backward-chains from an epistemic goal `(knows <topic> ?of)` to the capability whose
add-list achieves it, and proves the preconditions bind before the call fires. `registerCapability`
(registry.mjs:217) is a real, tested runtime extension point that returns an `unregister` disposer.

**The driver — already the "one generic function".** `runCapabilityPlan(request, tools, ctx)`
(`src/domain/router/drive.mjs:257`) takes a plain English request and returns
`{ calls, refused, terminated, proof, why, driver, composed?, observed? }`. Single-shot requests go
to the resolver; compound ones ("of the X, which are Y", "... and then ...", "... instead") are HTN-
decomposed into an ordered call sequence with a causal-link proof chain and folded by set algebra;
world goals ("make every disk rest on peg-c") go to the taught lane and are grounded by simulation
over `findActionPath` (`src/domain/planning.mjs`); anything left escalates to the closed-world goal
reasoner. This is the shape the operator described, and it is already built.

**The NL-to-capability tables.** `resolver.mjs:37-48` (`NL_INTENTS`, keyed off `parseQuery`'s shape
and kind) and `resolver.mjs:69-95` (`FRAMES`, curated imperative phrasings, first match wins) are
where a new phrasing is taught. `resolver.mjs:53-59` (`UNMAPPED_KINDS`) and `registry.mjs:247-257`
(`EXCLUDED_FROM_REGISTRY`) both name, with a reason, every gap between the tool set and the router —
the estate already has the habit of writing gaps down, and new work should keep it.

**Shared page libraries that already work.** `src/services/viz-theme.mjs` (escaping, JSON and script
embedding, theme tokens) is imported by all ten viz modules. `viz-ticker.mjs` (`createTicker`),
`memory-panel-viz.mjs` (`fetchWithProgress`, `renderStatsPanelInto`), `session-log-format.mjs` and
`src/surfaces/web/idb-persist.mjs` are each single-source and imported by several pages. The pattern
works; most of the inventory below is places it was not followed.

**The splice pattern.** `mud-viz.mjs:894` (`pageScript`) hands real, module-level, unit-testable
functions to `embedScriptText` via `Function.prototype.toString()`, listing each as a `const` binding
at the top of the page's IIFE. `spider-fly-viz.mjs:593-599` does the same. This is the good pattern:
the page's own source reads as named calls, and the functions behind those names are importable and
testable in Node. Pages that instead type their JS as raw template text (`code-explorer-viz.mjs:117`
`CLIENT_JS`) end up re-typing `escapeHtml` and `fetchWithProgress` by hand — see the inventory.

## The three structural gaps

Everything page-specific in the inventory is downstream of these three. Fixing them is what turns a
demo that uses tmct into a consumer surface that calls tmct.

### Gap A — eight browser entries hand the engine an empty code graph

`parseEntities({ individuals: [], objectProperties: [] })` appears, identically, at:

| file | line |
|---|---|
| `src/surfaces/web/adventure-browser-entry.mjs` | 98 |
| `src/surfaces/web/chat-browser-entry.mjs` | 86 |
| `src/surfaces/web/ledger-browser-entry.mjs` | 51 |
| `src/surfaces/web/mud-browser-entry.mjs` | 84 |
| `src/surfaces/web/plan-browser-entry.mjs` | 57 |
| `src/surfaces/web/research-browser-entry.mjs` | 210 |
| `src/surfaces/web/spider-fly-browser-entry.mjs` | 87 |
| `src/surfaces/web/sprites-browser-entry.mjs` | 31 |

Only `code-explorer-browser-entry.mjs:44` passes a real payload; `ingest-browser-entry.mjs` passes no
graph at all. The empty graph is correct for what those pages do today — they live on the memory
graph, not a code map — but it is also why the whole capability layer is dark on every demo except
code-explorer. `chat.mjs:14013` refuses `/plan` outright
with "no graph loaded", and `buildCapabilityPlanCtx` (`drive.mjs:295-301`) binds every parameter slot
through `resolveObject` over that same code graph. So `tmct_ask`, `/plan`, and `runCapabilityPlan`
cannot reach a single fact in a mud room or a spider's cell.

The seam to widen already exists and is named as such. `registry.mjs:44` declares a `memoryFacts`
precondition; `resolver.mjs:92` carries the one memory-graph-bound frame (`arg: "term"`, for
`tmct_related`); `drive.mjs:322` wires `ctx.resolveMemoryTerm` as "the memory-graph sibling of
`resolve`". One binding oracle exists for one slot. The work is to make memory-graph binding a
first-class kind alongside `KINDS.Symbol` / `KINDS.Module` / `KINDS.Class`, so a capability can
declare a slot that resolves against world facts.

**Target:** a `KINDS.MemoryTerm` (or `KINDS.Individual`) parameter kind in
`src/domain/router/registry.mjs`, a `resolves` branch for it in `resolver.mjs`, and a
`buildCapabilityPlanCtx` that accepts `memoryDir` alone with no code graph. Then the eight entries
above pass `memoryDir` where they currently pass an empty graph, and every page gets the planner.

### Gap B — the tool contract returns a string, and a page needs data

`dispatchTool` (`server.mjs:47`) returns text for every tool. `tmct_ask` already works around this:
its handler (`handlers/tmct-ask.mjs:13`) appends the structured envelope after a `---tmct_ask---`
delimiter, and `chat.mjs:87` documents the split on the other side. `ask()` itself
(`ask.mjs:4551-4577`) returns `{ content, tmct_ask: { mechanical, parsed, canonical, matches,
traversal, miss, ambiguous, relaxed, matchedVia, discourse?, candidates? } }` — a render-ready
shape, with typed `matches` carrying `{ id, label, type, module }`.

Meanwhile `runTurn` (`chat.mjs:14952`) returns `{ answer, end, record, plan, focus, last,
factsTouched, planState }`, where `answer` is prose. Every page that needs data rather than a
sentence therefore folds the fact rows itself. That is the single root cause of most of the "bespoke
page JS" in the inventory.

**Target:** promote the delimiter workaround into a real contract. A `dispatchToolStructured(name,
args, ctx)` beside `dispatchTool` returning `{ content, data }`, with `data` the envelope a handler
already computes; `runCapabilityPlan`'s loop result already carries `composed` (a label array) and
`observed`, so the router half needs no new shape. Then `fn(request)` returns
`{ content, data, proof }` and a page renders `data` instead of re-deriving it.

### Gap C — the page's contract with the engine is eleven ad-hoc global bags

Each browser entry dumps a different set of primitives onto its own global:

`globalThis.tmctResearch` (`research-browser-entry.mjs:345`), `tmctPlan` (`plan-browser-entry.mjs:112`),
`tmctSpiderFly` (`spider-fly-browser-entry.mjs:183`, 12 members), `tmctSprites`
(`sprites-browser-entry.mjs:68`), `tmctIngest` (`ingest-browser-entry.mjs:205`), `tmctChat`
(`chat-browser-entry.mjs:222`, 12 members), `tmctMud` (`mud-browser-entry.mjs:320`, 26 members),
`tmctCodeExplorer` (`code-explorer-browser-entry.mjs:87`), `tmctLedger`
(`ledger-browser-entry.mjs:105`, 8 members), `tmctAdventure` (`adventure-browser-entry.mjs:196`),
`tmctMemoryAsk` (`memory-ask-browser-entry.mjs:20`).

`mud-browser-entry.mjs:316-319` states the reason plainly: re-exported "so mud-viz.mjs's own inlined
script never duplicates sprite resolution or the digest/affordance/knowledge readers". That is the
right instinct and the wrong unit. A visitor reading the page source sees 26 raw primitives being
wired together by hand, which is the opposite of a showcase.

**Target:** one `globalThis.tmct` with a small, stable surface — `ask(request)`, `plan(request)`,
`turn(line)`, `session` — and the per-page primitive bags shrink to whatever has no natural-language
form (canvas geometry, sprite templates).

## Inventory

Each row carries a category and a target. **cat 1** = reusable across pages, currently duplicated or
page-local. **cat 2** = touches the engine — either it already calls it, or it is bespoke JS
reimplementing something the engine could answer. The **target** is the tier from the section above:
lib, tool, or ask.

### Theme 1 — the browser-entry layer

The nine entries that run chat turns each reimplement the same wrapper: a closure over
`focus`/`last`/`planState`, a `try { runTurn(...) } catch` that converts a throw into a safe answer,
the post-call state capture, and a normalized return.

| item | file:line | cat | target |
|---|---|---|---|
| The turn-session wrapper, nine times over | `chat-browser-entry.mjs:119-141`, `code-explorer-browser-entry.mjs:64-79`, `ledger-browser-entry.mjs:67-87`, `adventure-browser-entry.mjs:124-143`, `spider-fly-browser-entry.mjs:118-138`, `plan-browser-entry.mjs:60-97`, `research-browser-entry.mjs:248-269`, `mud-browser-entry.mjs:108-147`, `sprites-browser-entry.mjs:35-60` | 1 | **lib** — `src/surfaces/web/turn-session.mjs`, `createTurnSession({ memoryDir, graph, lexicon, sessionId, vocabHint, buildExtraOptions, captureExtraState })`. Each call site drops to a short adapter. Largest single win in the survey. |
| The catch fallback string, verbatim in eight files | `chat-browser-entry.mjs:130`, `code-explorer-browser-entry.mjs:73`, `ledger-browser-entry.mjs:76`, `adventure-browser-entry.mjs:135`, `spider-fly-browser-entry.mjs:132`, `plan-browser-entry.mjs:88`, `sprites-browser-entry.mjs:55`, `mud-browser-entry.mjs:138` (shortened variant), plus `chat-session.mjs:430` | 1 | **lib** — absorbed by `createTurnSession` above. Note `mud-browser-entry.mjs:138` has already drifted (drops "or /help"), which is what duplication does. |
| Seed-payload spreading, five copies with the same comment | `chat-browser-entry.mjs:79-82`, `code-explorer-browser-entry.mjs:46-49`, `ledger-browser-entry.mjs:45-49`, `ingest-browser-entry.mjs:180-181`, `research-browser-entry.mjs:207-208` | 1 | **lib** — `applySeedPayload(memoryDir, seedPayload)` in `src/adapters/memory/core.mjs`, which every caller already imports. |
| `memoryStats` duplicated verbatim | `memory-stats.mjs:27-53` and `chat-browser-entry.mjs:164-190` | 1 | **lib** — delete the copy; `ingest-browser-entry.mjs:34` already imports the shared one. |
| `exportFactsJsonl` one-line wrapper, four copies | `chat-browser-entry.mjs:198-200`, `ledger-browser-entry.mjs:94-96`, `ingest-browser-entry.mjs:201-203`, `research-browser-entry.mjs:341-343` | 1 | **lib** — one export beside `memoryStats` in `memory-stats.mjs`. |
| `cloneSeed`, three copies | `research-viz.mjs:435-438`, `ingest-viz.mjs:421-424`, `code-explorer-viz.mjs:266-269` | 1 | **lib** — `cloneMemoryPayload(payload)` beside `applySeedPayload`. |
| The wink loader — six copies of `tryLoadWink` + `WINK_LOAD_TIMEOUT_MS = 8000`, in three subtly different shapes | `research-viz.mjs:400-421`, `ingest-viz.mjs:430-444`, `plan-viz.mjs:702-721`, `ledger-viz.mjs:1155-1178`, `sprite-catalog-viz.mjs:589-607`, `chat-page-viz.mjs:1035-1059` (idle-poll rather than `Promise.race`); `code-explorer-viz.mjs:45-48` is a seventh with no timeout at all. Four of the files comment that they use "the same pattern" as another | 1 | **lib** — `loadWinkVendor({ timeoutMs, register })` in a new `src/services/viz-boot.mjs`, splice-safe like its neighbours. Converge on one failure behaviour. |
| `spider-fly-viz.mjs` registers no wink model at all — no `tryLoadWink`, no `registerWinkModel` | absence, vs the six above | 2 | Confirm intent, then fix or write it down. Its chat dock (`spider-fly-viz.mjs:1018-1030`) runs `session.turn` without the lemma and fuzzy NLU tiers every sibling dock gets. It may be deliberate (the game's commands are closed regexes), but nothing in the file says so. |
| The boot sequence (bundle guard → `Promise.all([wink, seed])` → session → `enableInputs` → status → refresh) | `research-viz.mjs:464-481`, `ingest-viz.mjs:518-547` | 1 | **lib** — same `viz-boot.mjs`. |

### Theme 2 — spider-fly, the headline example

The two calls the operator named, traced end to end.

**`fn("list the locations of flies and spiders")`.** Today the grid's data comes from
`session.snapshot()` (`spider-fly-viz.mjs:1027`), which is
`spider-fly-browser-entry.mjs:145-154`: load the memory rows, call `foldSpiderFlyState`, walk
`state.placements`, skip `state.removed` and anything matching `/^web-\d+$/`, and return
`{ turn, agents, activeWebs }`. Every one of those steps is a hand-written filter over rows the
graph already holds — `mgx:currently-in` placements plus an `rdf:type` taxonomy seeded at
`spider-fly-browser-entry.mjs:73-78` from `spider-fly-world.mjs:134` (`worldFactRows`).

The facts are all on record already. Nothing needs teaching first.

Nothing answers this shape today. `spider-fly-turn.mjs:441` (`SF_WHERE_AGENT_RE`) takes one singular
kind — "where is the spider" — and returns a sentence via `positionsOfKind`
(`spider-fly-turn.mjs:448-470`), not the plural two-kind shape and not structured data. `chat.mjs`'s
generic membership list (`MEMBERSHIP_LIST_RE`, `chat.mjs:986`) reads "locations" as the noun and finds
no ISA facts for it, because `spider-1` is never taught as a kind of spider (`chat.mjs:1013-1019`).
And `tmct_ask` is pointed at the empty code graph, per Gap A.

**This one has a real design fork, and it should be decided before the work is dispatched.**

- *Route through `ask`.* The request is a relational listing over `mgx:currently-in` with a two-class
  subject filter, which is a question the graph can answer. `ask.mjs` already carries a dynamic
  memory-graph class count/list fallback (`ask.mjs:4360-4400`) that resolves against whatever classes
  have an individual in the graph, plus `LIST_TRIGGERS` and `AGGREGATE_TRIGGERS` in `ask-vocab.mjs`.
  This keeps the whole sentence and is what the operator's ordering asks for. The cost is real:
  `ask-vocab.mjs`'s `RELATIONS` vocabulary is code-shaped (calls, imports, touches, history), so
  world predicates need a home in it, and Gap A has to land first.
- *A new closed lane or tool.* `game_positions` in `spider-fly-turn.mjs`, or a `tmct_positions` tool,
  returning `foldSpiderFlyState`'s own `agents` map as structured data beside its sentence. Cheaper,
  and it matches this project's stated preference for closed template libraries over general grammar
  rules. The cost is that the page keeps a bespoke route to its own facts, which is the thing this
  plan exists to remove.

The two are not mutually exclusive — a closed lane can ship first and be re-pointed at `ask` once
Gap A lands. Recommendation: take `ask`, because a second closed lane per page is how the estate got
here. Whoever picks up phase 6 should read both options and say which they took.

- Sub-item, cat 1, **lib**: the web-id exclusion regex (`browser-entry.mjs:150`) and the
  `removed`-set skip encode world rules that `spider-fly-world.mjs` should own, not the browser entry.

**`fn("get me the large sprite for a happy spider")`.** Today:

- `spider-fly-viz.mjs:694-697` `propertyFactsForAgent` builds `[{ predicate: "mgx:feels", object:
  emotionFor(agent, cls, maxMassFor(cls)) }]` by hand, and hardcodes at line 695 that only `spider`
  and `fly` have emotion templates.
- `spider-fly-viz.mjs:691-693` `maxMassFor` hardcodes the per-class mass denominator, with a comment
  admitting it "mirrors massBarHtml's own per-class denominator below" — the same number written
  twice in one file.
- `spider-fly-viz.mjs:698-702` `resolveSpriteFace` calls
  `tmctSpiderFly.resolveSpriteAsset(cls, session.taxonomyRows, propertyFacts, SPIDERFLY.spriteTemplates,
  tmctSpiderFly.SPRITE_REGISTRY)` — five positional arguments, four of them page-held state.
- `src/domain/sprite-templates.mjs:174` is the real resolver; `sprite-map.mjs:197`
  (`resolveSpriteForClass`) and `sprite-map.mjs:172` (`classAncestorChain`) do the taxonomy walk;
  `sprite-size.mjs:28` (`sizeScaleFor`) reads size off property facts;
  `sprite-expressions.mjs:51` (`EXPRESSION_PALETTE`) holds the expression vocabulary.

Every ingredient of "large sprite for a happy spider" is already a domain module. The fact for the
emotion now exists (see below). Two things are still missing: a decision about what "large" means,
and a grammar that turns the sentence into arguments.

**The emotion is a fact — landed.** `runSpiderFlyTick` assigns a `mood` word in every branch that
renders a `goal` sentence and appends it as a real `mgx:feels` row per agent per turn, beside the
`mgx:currently-in` placement; `startSpiderFlyGame` writes the starting `calm` so an agent has a mood
from the moment it exists. Vocabulary: happy, angry, scared, calm — the four of
`sprite-expressions.mjs`'s six palette words this game's goal chain reaches. `emotionFor` is gone and
the page reads `agent.mood`. So "a happy spider" has a fact to bind to.

**"Large" means two unrelated things.** `sprite-size.mjs:28` (`sizeScaleFor`) is a scale multiplier
for a taught `small`/`large` property fact on an individual, and its own header (`sprite-size.mjs:6-8`)
records that no shipped world carries such a property, so nothing calls it. Separately, "large" in
"the large sprite" means the template *tier* (icon vs large set) — a hardcoded call-site choice
(`spider-fly-viz.mjs:211-219`: it always loads the large tier because that is the only one with
emotion templates), not a queryable attribute. The fact that would let a question select a tier
already exists — `mgx:render-at` (`sprite-facts.mjs:74-76`) — but is only ever embedded into
`sprites.html`'s dock (`sprite-catalog-viz.mjs:528`) and never consulted by the resolution path.
Whoever builds `tmct_sprite` has to pick which sense the word carries, and say so in the schema.

- cat 2, **tool**. The third missing piece, and a new capability: `tmct_sprite`, arguments
  `{ class, expression?, size?, material? }`, handler wrapping `resolveSpriteAsset`, returning the
  asset plus the resolution chain (which template matched, which ancestor it fell back to). Register
  it in `registry.mjs` with a `memoryFacts` precondition and a `KINDS.MemoryTerm` slot for `class`,
  add-effect `knows("sprite", "class")`.
- The phrasing that should trigger it, for `resolver.mjs`'s `FRAMES`: `/\bsprite\b|\bicon\b|\bavatar\b|
  \bpicture\s+of\b|\bwhat\s+does\s+.+\s+look\s+like\b/i` → `{ topic: "sprite", arg: "class" }`.
  Example requests: "get me the large sprite for a happy spider", "what does a hungry fly look like",
  "show me the spider icon".
- The expression and size slots should bind against the real vocabularies
  (`sprite-expressions.mjs:51`, `sprite-size.mjs:28`) rather than a new hand-kept list, exactly as
  `definitions.mjs:26` derives `askLexicon` from the parser's own `RELATIONS` table.

**The rest of the page.** `spider-fly-viz.mjs:590-1189` is 599 lines of inline browser JS. Most of it
is canvas and DOM work that belongs there. The parts that are not:

| item | file:line | cat | target |
|---|---|---|---|
| `emotionFor` regexing the engine's rendered prose | was `spider-fly-viz.mjs:159-177` | 2 | **landed** — the engine emits `mood` and writes `mgx:feels`; the function is deleted. |
| `maxMassFor` mirroring `massBarHtml`'s denominator, with a comment saying so | was `spider-fly-viz.mjs:691-693` | 1 | **landed** — `maxMassFor` existed only to feed `emotionFor`'s unused `maxMass` argument, so it went with it. `massBarHtml` now holds the only per-class denominator; nothing to converge. |
| Which classes carry `mgx:feels` hardcoded in the page | `spider-fly-viz.mjs:645-648` | 2 | **lib** — ask `sprite-templates.mjs` which classes have an emotion variant instead of listing them. |
| `resolveSpriteFace`'s five-argument call | `spider-fly-viz.mjs:649-653` | 2 | **tool** — replaced by the `tmct_sprite` call above. |
| "kind from agent id" regex, four hand-rolled implementations across three files | `spider-fly-viz.mjs:68-70` (`classOfAgentId`), `spider-fly.mjs:148-158`, `:399-400`, `:707-708`, `spider-fly-turn.mjs:124-127`, `:196-199` | 1 | **lib** — `agentKindOf(id)` and `liveIdsOfKind(agents, kind)` in `spider-fly-world.mjs`. |
| Belief sentences hand-typed twice, where the page's own comment says they must match the dock's wording | `spider-fly-viz.mjs:833-864` (`planLineHtml`/`beliefLineHtml`/`observedFactsHtml`, comment at `:355-356`) vs `spider-fly-turn.mjs:353-360`, `:369-391` | 1 | **lib** — one `believedFactSentence(id, cell)` in `spider-fly-turn.mjs`, which already exports `oneStepDirectionBetween` for this same reason (`spider-fly-turn.mjs:184`). A rule enforced by comment is a rule that drifts. |
| `massBarHtml` is a generic clamped-percentage meter with a page-specific class name | `spider-fly-viz.mjs:821-826` | 1 | **lib** — `meterBarHtml(cls, value, max)` in `viz-theme.mjs`. |
| 12 primitives on `globalThis.tmctSpiderFly` | `spider-fly-browser-entry.mjs:183-187` | 1 | see Gap C. |

**sprites.html, the same family.** `sprite-catalog-viz.mjs` holds the estate's only case of a page
answering natural language *in front of* the engine.

| item | file:line | cat | target |
|---|---|---|---|
| `answerSpriteQuestion` answers two question shapes before the line reaches `session.turn` | `sprite-catalog-viz.mjs:397-429`, dispatched at `:628-634`, rationale at `:388-396` | 2 | **ask** — "what classes can you render" and "what parameters does a spider sprite take" are membership and property questions `chat.mjs:909-926` and `:995-1019` already answer generically over taught ISA facts. They are bespoke here only because the sprite-facts rows use predicates (`mgx:take-parameter`, `mgx:accept-<p>`) the generic lane does not key on. The rows are already in the same `memoryDir` the real session queries (`sprites-browser-entry.mjs:25-29`). Key the generic lane on those predicates and this lane deletes. Credit where due: it returns `null` on no rows so the engine still gets its honest miss — the interception is careful, it just should not exist. |
| `extractSceneItems`/`tokenizeSceneText` — a longest-match multi-word tokenizer over free text, matched against a class index scraped from the DOM | `sprite-catalog-viz.mjs:329-384`, index at `:828-851`, scope note at `:316-324` | 2 | **ask** — term resolution is `ask.mjs`'s `resolveObject` (`ask.mjs:2857`), with exact, lemma and fuzzy tiers this hand-rolled matcher does not have. Blocked on Gap A. Largest bespoke-NLU block in the sprite family; the file's header calls it "never a general NLU pass", which is an accurate description of what it is and also the reason to replace it. |

### Theme 3 — mud and adventure

`mud-viz.mjs` already imports eight functions from `adventure-viz.mjs` (`mud-viz.mjs:79-81`), which
is the right direction. These are the places it stopped.

| item | file:line | cat | target |
|---|---|---|---|
| Room-graph layout + SVG renderer, written twice (BFS grid layout off `state.exits`, unexplored-neighbour dots, rect/text per room, edge lines, tiled components) | `mud-viz.mjs:185-231` + `1502-1570` vs `adventure-viz.mjs:358-398` + `1299-1330`; `mud-viz.mjs:57-63` admits the copy | 1 | **lib** — `src/services/viz-room-graph.mjs`: `directedGridLayout(state, roomIds, opts)` and `roomGraphSvg(graph, opts)`, spliced into both. |
| Async serialization queue under two names | `mud-viz.mjs:936-941` (`tickChain`/`serializeTick`) vs `adventure-viz.mjs:1204-1209` (`lock`/`withLock`); `spider-fly-viz.mjs` has a third inlined `withLock` | 1 | **lib** — `createSerialQueue()` in `viz-ticker.mjs`, which already owns the shared turn-orchestration primitive. |
| `wordBeforeCursor`, byte-identical | `mud-editor.mjs:309-313` and `adventure-editor.mjs:365-369` | 1 | **lib** — the self-contained-for-splicing rationale those files give covers their sentence tables, not a cursor-word regex. One copy in `viz-theme.mjs` or a `viz-editor-text.mjs`. |
| `worldOnlyRows` — same provenance-prefix filter | `mud-viz.mjs:1677-1682` and `adventure-viz.mjs:1645-1648` | 1 | **lib** — `rowsForWorld(rows, worldName)` in `viz-theme.mjs`. |
| Room-caption builder, near-duplicate with a real casing difference | `mud-viz.mjs:1389-1402` (`roomCaptionFor`, case-insensitive) vs `adventure-viz.mjs:516-531` (`roomCaptionText`, capitalized room ids) | 1 | **lib** — one `roomCaptionText(rows, state, here, { caseInsensitive })`; adventure-viz already exports its version. |
| `carriedItemsFor` vs `carriedItems` — same filter, one hardcodes `"player"` | `mud-viz.mjs:137-142` vs `adventure-viz.mjs:336-341` | 1 | **lib** — `carriedItems(rows, state, holder = "player")`, added to mud-viz's existing import list. |
| Log append + autoscroll, three implementations with drifting features (mud has clip detection and a "read more" popup; adventure's two logs do not) | `mud-viz.mjs:1117-1135` vs `adventure-viz.mjs:1472-1476` and `1362-1366` | 1 | **lib** — `appendLogLine(el, cls, text, { clip })`, so the affordance stops being accidental. |
| Hand-rolled `h = h*31 + charCode` hash for backdrop art | `mud-viz.mjs:1222-1226` | 1 | **lib** — splice `src/domain/hash.mjs` `fnv1a32` (already pure and documented splice-safe; `mud-turn.mjs:49` uses it server-side). |
| `predatorInRows` / `predatorRooms` — same `mgx:is-predator` filter across the client/server boundary | `mud-viz.mjs:1031-1036` and `mud-turn.mjs:223-226` | 2 | **lib** — a `domain/mud-facts.mjs` predicate reader. As a natural-language question this is `tmct_ask("what has mgx:is-predator set to true")`, which is the right shape for a developer poking at the graph and the wrong shape for a per-frame animation check. |
| Speech-bubble text invented rather than read from the engine | `mud-viz.mjs:1092` puts the fixed string `"what food do you know about?"` in the asking character's mouth on every ask or talk action, while `mud-viz.mjs:1094` — the very next line — correctly reads `action.text` for the other speaker, and `mud-turn.mjs:440` already computed the real narration | 2 | **lib** (one-file fix) — read `result.actions[].text` on both branches. A page putting invented words in a character's mouth is the inverse of the showcase goal, and the correct call is already one line below. |
| Affordance strings parsed back apart to find click targets | `mud-viz.mjs:1441-1452` (`subjectOfAction`/`commandsBySubject`) and `adventure-viz.mjs:1491-1501` (`pillsFor`/`renderPills`) | 2 | **lib** — have `roomAffordances` return `{ subject, verb, command }` objects instead of bare strings; deletes the parsing from both pages and removes a shared breakage point. |
| 26 primitives on `globalThis.tmctMud` | `mud-browser-entry.mjs:320-330` | 1 | see Gap C. |

Engine calls already correct on these pages, for the record so nobody "fixes" them: every typed turn
routes through `runTurn` (`mud-viz.mjs:1149`, `adventure-viz.mjs:1616` and `:1391`); autoplay goes
through `mud-turn.mjs` `runMudTurn` (`mud-viz.mjs:995`); `roomAffordances`, `worldDigestRows`,
`relatedForTerm`, `classAncestorChain` and `resolveSpriteAsset` are all real domain calls reached
through the page global.

### Theme 4 — chat, ledger, plan

The answering paths on all three are real. `chat-page-viz.mjs:1122` boots a real session and
`:1395` runs every turn through it; `plan-viz.mjs:743-778` creates and re-solves through
`tmctPlan.createPlanSession` / `s.turn(q, { maxDepth })`, which is `findActionPath`
(`src/domain/planning.mjs:30`) — `plan-viz.mjs:50-232` is pixel geometry and hue assignment, not a
second planner; `plan-pddl.mjs:144` only formats an already-solved plan. `ledger-viz.mjs:1179-1198`
runs the dock through a real session, falling back to `factAnswer`/`factReadBack`
(`ledger-viz.mjs:1407-1412`).

| item | file:line | cat | target |
|---|---|---|---|
| Hand-pluralized counts, `n === 1 ? "" : "s"`, 15+ sites in 4 files, all regular plurals | `plan-pddl.mjs:211`, `plan-viz.mjs:288`, `:761`, `ledger-viz.mjs:456`, `:470`, `:548`, `:968`, `:1274`, `:1326`, `chat-page-viz.mjs:1472`, `:1592-1593`, `:1756`, `:1851`, `:1914`, `:2212` | 1 | **lib** — `countLabel(n, singular, plural?)` in `viz-theme.mjs`, built on `src/domain/inflect.mjs:33` `pluralOf`. Every current site is regular, so this is a clean swap. |
| Partial HTML escape in a file that already imports `escapeHtml` | `plan-viz.mjs:576` escapes `&` and `<` only, leaving `>`, `"`, `'`; the file imports `escapeHtml` at `:21` but never splices it | 1 | **lib** and a correctness fix — splice `escapeHtml.toString()` as `ledger-viz.mjs:830` already does, delete the local chain. |
| `BAND_ORDER` written twice inside one module | `memory-panel-viz.mjs:40-44` and `:99-103`, character-identical | 1 | **lib** — hoist to a module-level const. |
| Dashboard tiles and the chat dock compute overlapping numbers by different routes | tiles via `computeLedgerStats` (`ledger-viz.mjs:350-398`) and `facetCounts` (`:273-296`); dock via `s.turn(q)` → `ask()` (`ledger-viz.mjs:1198`) | 2 | **ask** for the interactive half. `ask-vocab.mjs`'s `AGGREGATE_TRIGGERS` / `SUPERLATIVE_EXTREMES` / `LIST_TRIGGERS` already cover "how many facts are entailed", "which predicate is used the most", "how many sources do you have". Keep the tiles as direct computation — a fixed-layout strip refreshed every teach is not a user question — but the two surfaces phrase the same numbers independently and can drift. Worth one estate test asserting a tile and its spoken answer agree. |
| Hand-rolled 1-hop/2-hop BFS for the minimap | `ledger-viz.mjs:1021-1058` (`renderMap`, `hop1`/`hop2` built from `LEDGER.edges` at `:1031-1037`) | 2 | **lib** — `bfsLevels` (`planning.mjs:104`) already computes the set; keep positioning bespoke. Cheap now, and it stops a third hop from being written by hand. |
| Adjacency/degree index and focus resolution built from raw rows | `ledger-viz.mjs:135-228` (`computeLedgerDataFromPayload`), `:350-398` (`computeLedgerStats`) | 2 | **lib** — already pure and exported; leave as the bulk-render path. Named here so a future session does not mistake it for an unrouted question. |
| `nodeRowsFor` parsing `teach:peer:<name>@<ts>` provenance tags client-side | `chat-page-viz.mjs:204-242` | 2 | no change — peer activity is not a graph fact; there is no engine call to route to. Listed so it is not re-flagged. |
| `DASH_DARK_CHROME_CSS` restating dark-mode token values | `ledger-viz.mjs:41-52`, with its own comment at `:32-40` explaining why | 1 | **lib**, only if touched — export `TOKENS` (currently unexported, `viz-theme.mjs:40-51`) rather than restating values. |
| `relativeWhen`, `tapeClock`, `nodeInitials`, `inviteLinkFor` written as raw template text rather than spliced module functions | `chat-page-viz.mjs:1888`, `:1802`, `:252`, `:267` | 1 | **lib** — not duplicated, but inconsistent with the same file's own splice discipline for `provenanceChipFor`. Moving them makes them testable. |

### Theme 5 — research, ingest, code-explorer

`research-viz.mjs` and `ingest-viz.mjs` route correctly: `research-viz.mjs:640-667` calls
`session.ask` → `factAnswer`/`factReadBack`; `:730-746` calls `session.turn` → `runTurn`; `:749-760`
calls `session.ingest` → `groundTextToFacts`, the same recognizer `ingest-browser-entry.mjs:66-166`
exports and `research-browser-entry.mjs:39` reuses; `:715-725` calls `digestTermFromPayloadBrowser`
(`digest-client.mjs:52-59`). No parallel NLU anywhere in either page.

`code-explorer-viz.mjs` is the one page with a real second implementation.

| item | file:line | cat | target |
|---|---|---|---|
| `EDGE_PHRASE` — a second hand-curated relation-verb table | `code-explorer-viz.mjs:25-35` (`inherits from`, `co-changes with`, `re-exports`) duplicating `src/domain/ask-vocab.mjs` `RELATIONS` (`inherits from` at `ask-vocab.mjs:110-111`, `touches`/`touched` at `:126`) | 1 | **lib** and a drift risk — export `phraseForRelation(kind)` from `ask-vocab.mjs` (or `code-explorer-hints.mjs`, which already imports `RELATIONS`), and have `code-explorer-viz.mjs:37-39` call it. A relation added to one table currently appears mis-phrased in the other. |
| `esc()` retyped inside `CLIENT_JS` while `escapeHtml` is imported at the top of the file | `code-explorer-viz.mjs:135-139` vs `:19` | 1 | **lib** — splice the imported one; the raw-string `CLIENT_JS` block (`:117-348`) is the cause, and the splice trick every other page uses works here too. |
| `fetchTextWithProgress` reimplementing the shared `fetchWithProgress` | `code-explorer-viz.mjs:222-238` vs `memory-panel-viz.mjs:56-76` | 1 | **lib** — same fix, same cause. |
| `computeCodeLedger` walking `payload.objectProperties` to build a degree-ranked term index | `code-explorer-viz.mjs:59-107`, degree map at `:66-79` | 2 | no change — "render every edge as a sentence, ranked by degree, capped" is a bulk view, not a question. Fix the phrasing table above so the sidebar and the chat answer never phrase one relation two ways. |
| `focusOn` / `renderFocusRows` near-vs-rest split — this *is* "what relates to X" | `code-explorer-viz.mjs:148-163`, `:172-177` | 2 | **ask** — `tmct_ask({ query: "what relates to <focus>" })`, or `tmct_related` directly. This page has a real code graph (`code-explorer-browser-entry.mjs:44`), so unlike the rest of the estate it can do this today without Gap A. Good first proof. Three implementations currently exist for one question: the chat dock's `runTurn`, this client-side filter, and `handlers/tmct-related.mjs:11`. |
| `loadProgressLine`, byte-identical | `research-viz.mjs:80-93` and `ingest-viz.mjs:54-67`; both comment that they are "the same aggregator" as the other | 1 | **lib** — `memory-panel-viz.mjs`, which already hosts `fetchWithProgress` for this exact purpose. |
| `factTripleParts`, same shape minus one field | `research-viz.mjs:68-75` (no `provenance`) and `ingest-viz.mjs:37-44` (with) | 1 | **lib** — one shape, `provenance` empty when absent. |

### Theme 6 — the page source itself

Over 6,000 lines of browser JS live inside template literals across the ten viz modules. That text is
the page source a visitor reads:

| module | inline page JS | lines |
|---|---|--:|
| `chat-page-viz.mjs` | 870-2245 | 1,375 |
| `mud-viz.mjs` | 894-2054 (`pageScript`) | 1,160 |
| `adventure-viz.mjs` | 1079-1855 | 776 |
| `ledger-viz.mjs` | 820-1440 | 620 |
| `spider-fly-viz.mjs` | 590-1189 | 599 |
| `research-viz.mjs` | 370-879 | 509 |
| `ingest-viz.mjs` | 233-639 | 406 |
| `plan-viz.mjs` | 482-792 | 310 |
| `code-explorer-viz.mjs` | 117-348 (`CLIENT_JS`) | 231 |
| `sprite-catalog-viz.mjs` | 576-656, 796-890 | 174 |

The splice pattern (`mud-viz.mjs:894`, `spider-fly-viz.mjs:593-599`) already lets a page's source read
as a list of named calls into real, testable module functions. Two pages opted out and pay for it
directly: `code-explorer-viz.mjs:117` (`CLIENT_JS` as raw text — hence the retyped `esc` and
`fetchTextWithProgress` above) and the four `chat-page-viz.mjs` helpers in Theme 4's last row.

**Target:** every viz module builds its page script the way `mud-viz.mjs` does, and every helper in
that script is a named import or a spliced module function. That is the mechanical half of "the page
source reads as a showcase". The semantic half is Gaps A-C: once a page can call
`tmct.ask("list the locations of flies and spiders")`, its source shows a question and a render, and
the fold disappears.

## Phasing

Ordered so each phase is useful on its own and unblocks the next.

1. **The pure-library sweep.** Every **lib** row above that needs no engine change: `turn-session.mjs`,
   `applySeedPayload`, `cloneMemoryPayload`, `loadWinkVendor`, `viz-room-graph.mjs`,
   `createSerialQueue`, `countLabel`, `rowsForWorld`, `wordBeforeCursor`, `carriedItems(holder)`,
   `appendLogLine`, `fnv1a32`, the `memoryStats`/`exportFactsJsonl`/`loadProgressLine`/
   `factTripleParts` de-duplications, and the `plan-viz.mjs:576` escape fix. Mechanical, wide, no
   design decisions. Splits cleanly by file ownership across several sub-agents.
2. **`phraseForRelation`.** The one drift risk in the survey — two hand-kept relation-verb tables.
   Small, and it lands before anything else touches relation phrasing.
3. **Gap B, the structured tool result.** Landed. `dispatchToolStructured(name, args, ctx)` returns
   `{ content, data }` beside `dispatchTool`'s unchanged string; a handler opts in by returning
   `kit.mjs`'s `toolResult({ content, data, text })`, and `tmct_ask`, `tmct_related` and
   `tmct_ingest` populate `data`. Follow-up: `chat.mjs` still splits the flat `---tmct_ask---`
   string, so it should read the envelope off the structured entry instead. The delimiter is
   exported as `ASK_ENVELOPE_DELIM` from the tool layer until it does.
4. **The code-explorer proof.** Route `code-explorer-viz.mjs:148-163` through `tmct_related` /
   `tmct_ask`. This page already has a real graph, so it proves the round trip end to end before any
   engine change.
5. **Gap A, memory-graph binding.** Router half LANDED: `KINDS.MemoryTerm` in `registry.mjs`
   (with `MEMORY_KINDS` and a `resolves("term", KINDS.MemoryTerm)` gate on `tmct_related`), the
   registry-driven oracle switch in `resolver.mjs` (`isMemoryTermSlot` + a two-tier
   `resolveMemoryTerm`: SKOS concept, then any world-fact subject/object), and
   `buildCapabilityPlanCtx`'s memory-only mode (`memoryDir` with no graph and no source; code-graph
   capabilities refuse honestly). Covered by `test/adapters/router-memory-binding.test.mjs`.
   Remaining: the eight entries in Gap A's table pass `memoryDir` instead of an empty graph, and
   `chat.mjs` drops its `/plan` no-graph refusal — caller wiring, a separate small wave.
6. **`fn("list the locations of flies and spiders")`.** Falls out of phase 5 as an `ask` call. Read
   the design fork in Theme 2 first and record which option you took. Prove it against the spider-fly
   grid, with `snapshot()` kept as the fast path.
7. **Mood becomes a fact — landed.** `runSpiderFlyTick` assigns a `mood` word beside every `goal` it
   renders and appends it as an `mgx:feels` fact per agent per turn; `startSpiderFlyGame` writes the
   starting `calm`. `emotionFor` is deleted and the page reads `agent.mood`. Vocabulary: happy,
   angry, scared, calm. `tmct_sprite` now has a fact to ground "a happy spider" against.
8. **`tmct_sprite`.** The new tool, its capability record, its `FRAMES` entry, and the expression and
   size slots bound to `sprite-expressions.mjs` / `sprite-size.mjs` rather than a new hand-kept list.
   Decide which sense of "large" the schema carries (tier or property — see Theme 2). Then
   `fn("get me the large sprite for a happy spider")` works, and `spider-fly-viz.mjs:691-702`
   collapses.
9. **The sprites.html interceptions.** Key `chat.mjs`'s generic membership and property lanes on the
   sprite-facts predicates so `answerSpriteQuestion` (`sprite-catalog-viz.mjs:397-429`) deletes, and
   route `extractSceneItems` (`:329-384`) through `resolveObject`. Needs phase 5.
10. **Gap C, one `globalThis.tmct`.** `ask`, `plan`, `turn`, `session`. The eleven per-page bags shrink
    to whatever has no natural-language form. Late, because it needs 3, 5 and 8 to have somewhere to
    go.
11. **The showcase pass.** Every viz module builds its page script the `mud-viz.mjs` way; the two
    raw-text holdouts convert; each page's source is read start to finish against the operator's
    test — does this read as a thin caller of real tmct capability.

## Non-goals

- No LLM anywhere in the product path. Every routing decision here is the existing deterministic
  resolver, planner and goal reasoner.
- Canvas drawing, DOM layout, CSS and sprite geometry stay page code. A tool call that returns pixel
  coordinates is not the goal.
- The bulk-render paths (`computeCodeLedger`, `computeLedgerDataFromPayload`, `computeLedgerStats`,
  `foldSpiderFlyState`) stay direct computation. They are folds over rows the caller already holds,
  refreshed every frame or every teach; a natural-language round trip is the wrong shape for them.
  Their *interactive* siblings — the same numbers asked for in words — are the `ask` rows above.
- `tmct_ask` stays outside the capability planner's operator set (`registry.mjs:251` states the
  reason: it is the plain-English entry point itself and calls `ask.mjs` directly). Nothing here
  changes that.
- No page's existing engine calls get rerouted for tidiness. Theme 3 and Theme 4 both list the calls
  that are already correct precisely so a later session does not "fix" them.
