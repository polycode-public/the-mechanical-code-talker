# PLAN_CLASS_QUERY.md — "list/count all X of class Y", reconciled against what already shipped

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code. The item
this document was commissioned to design turns out to be **mostly already shipped**; see "Current
state" below for the precise reconciliation before any design content.

## Origin

`PLAN_BREADTH_FIRST_NLU.md`'s own "Status (2026-07-12)" section, quoted verbatim:

> Two items are genuinely open, not yet started: (c) the paraphrase-verified-via-`syllogise.mjs`
> piece of "Ambition"; (d) a real "list/count all X of class Y" query shape for memory-graph classes
> via `ask.mjs` alone (§5b's documented gap). (c) and (d) are tracked live in `ROADMAP.md`'s "What's
> next".

That is the entire existing documentation of item (d) — one line, no deeper design. §5b of the same
document is about the embedded "Ask the graph" viz chat panel, a separately-landed feature; its own
text never elaborates the gap either.

## Current state — the premise is stale, verified against real code and git history

**Item (d) already shipped**, in commit `dec95e8` ("feat: land `PLAN_BREADTH_FIRST_NLU.md`'s two
open items — dynamic memory-class list/count (d) and verified paraphrase (c)"), dated 2026-07-12
13:41 BST — an ancestor of the current `HEAD` (`9104433`, 2026-07-13). `ROADMAP.md`'s own current
"What's next" section (checked directly) no longer lists (c)/(d) as open at all — only
`PLAN_BREADTH_FIRST_NLU.md`'s "Status" section is stale here, not `ROADMAP.md`. This document does
not edit either file (out of scope per the task boundary), but the reconciliation needs stating
plainly before any design proceeds: the task's framing of item (d) as "genuinely open, not started"
does not match the current repository.

`dec95e8` added, all in `src/domain/ask.mjs` (symbol names, not line numbers — the file has drifted by
~1,000 lines since this doc's first pass and will drift again):

- `PLURAL_FORMS` gained real noun forms for `Fact`/`Utterance`/`Session`/
  `Source`/`Rule` — the memory-graph meta-classes `src/adapters/memory/core.mjs` writes.
- `resolveDynamicClass(graph, word)` singularizes the asked noun and matches it
  against whatever `individual.class` values are **actually present in the graph passed to `ask()`
  at call time** — never against a fixed vocabulary, so it works for any taught class, not just the
  five meta-classes.
- `dynamicClassQuery(graph, query)`, gated by `DYNAMIC_LIST_TRIGGER_RE`
  and `DYNAMIC_COUNT_TRIGGER_RE`, compiles a bare "list/how many `<class-noun>`"
  into the exact same `{node:"allOfClass"}` → `{node:"count"|"list"}` AST the code-graph's own count/
  list queries already build (`evalSet`'s `"allOfClass"` case; `renderComposite`'s
  `"count"`/`"list"` branches) — no new render logic, reusing `OVERFLOW_CAP = 12` verbatim.
- Wired into `ask()` itself as a fallback that fires **only** after the normal cascade
  already produced an honest miss, and is skipped for any noun `ENTITY_TO_TYPE` (the closed code-
  graph noun table, `src/domain/ask-vocab.mjs`) already owns — so it never shadows a real
  code-graph "list modules"/"how many classes" answer.
- A real restrictor tail ("list facts **that mention widget**") is explicitly declined, not silently
  dropped — `DYNAMIC_TAIL_OK_RE` only accepts a closed set of harmless fillers
  ("are there", "do you know", …); anything else falls through to the honest miss the normal cascade
  already produced.
- `test/ask-memory-class-query.test.mjs` (10 tests, all passing) pins every one of the above: count
  hits, list hits, synonym triggers, the zero-individuals honest miss, the restrictor-tail decline,
  the `ENTITY_TO_TYPE` non-interception guard, and overflow-cap rendering.

This is a genuinely correct, well-tested piece of engineering, verified by direct read of the code
and the commit that landed it — not a stub, not partial. **The real remaining gap is not the
mechanism itself. It is that the mechanism is unreachable from the one surface real users actually
use** (`npm run chat`), and two adjacent, narrower gaps sit next to it. All three are demonstrated
below with a live reproduction against the actual CLI, not assumed.

### Reconciling the "does `ask.mjs` know about Facts at all" question

`archive/PLAN_VIZ_MEMORY.md`'s Bug 1 states `ask.mjs` "has no concept of Facts or corpus data at all." That
claim is about **data reaching the engine**, not about the engine's own mechanism — which, per the
above, does understand Fact/Utterance/Session/Source/Rule (and any other taught class) once it is
handed a graph object whose `individuals` actually contain them. `archive/PLAN_VIZ_MEMORY.md` was scoped to
the viz browser panel specifically; its fix has since SHIPPED as `src/surfaces/web/memory-ask-browser-entry.mjs`
(exposing `factAnswer`/`factReadBack`/`createInMemoryStore` to the page bundle as
`globalThis.tmctMemoryAsk` — delivered via `factAnswer` handed the embedded payload, not via a
direct `ask()` call) and stays out of this document's scope. This document's own finding, below, is
the same shape of problem but in the **live chat CLI**, and traced to a different, more specific
root cause.

### Live reproduction — the mechanism does not reach `npm run chat`

Seeded a real `.tmct/memory` with `dog`/`horse`/`cat` `rdfs:subClassOf` `animal`, plus two `horse`
attribute facts, and ran real queries through `bin/tmct.mjs chat` (not a unit test, not `ask()`
called directly):

| Query | What happened | Root cause, traced |
|---|---|---|
| `list facts` | `couldn't compile this compositional question ("facts" isn't a listable kind — try functions, classes, methods, modules, …)"` — the CODE-graph compositional miss message | `runAsk` (`src/services/chat.mjs`) calls `ask(graph, askQuery, …)` where `graph` is loaded exclusively from the **code** graph (`--repo`/`source.mjs`'s `fetchEntities`). `memoryDir`'s Fact/Utterance/Session/Source/Rule individuals are never merged into that `graph` object anywhere on this path. `dynamicClassQuery` runs, correctly, against a `graph.individuals` array that structurally cannot contain a `Fact` — it was never given the memory graph at all. |
| `how many facts about horses are there` | `664 facts.` (the **unrestricted total**, ignoring "about horses" entirely — a real corpus, not the 5-fact fixture) | `answerMemoryCount` (`src/services/chat.mjs`), which fires *before* `runAsk` ever gets a turn, matches noun via `/\b(?:how many\|number of\|count(?:\s+the)?)\s+([a-z]+)\b/` — captures only the single word right after "how many", sets `cls = "Fact"`, and counts every Fact individual in the graph. The "about horses" tail is never inspected. Unlike `dynamicClassQuery`'s own `DYNAMIC_TAIL_OK_RE` discipline (decline a real restrictor rather than silently drop it), `answerMemoryCount` has no tail check at all — this is a **wrong, confidently-stated answer**, not an honest miss. |
| `how many animals are there` / `how many animals do you know about` | `I can't count "animals". I count: sessions. Try "how many classes are there".` | Falls through `answerMemoryCount` (only knows the fixed `fact`/`utterance` nouns in `MEMORY_COUNT_NOUNS`), `answerQuantifierRecall` (needs the two-noun "how many Xs are Ys" shape, `HOW_MANY_ARE_RE`), `answerEdgeCount` (code-graph edge metrics only), and `answerCount`/`countFromFacts` (only fires when the taught subject **also** names a real code-graph class via `COUNT_NOUNS`; "dog"/"horse"/"cat" never do) to the CLI's generic honest miss. |
| `what is an animal` | `dog is a kind of animal` / `cat is a kind of animal` / `horse is a kind of animal` — correct, real answer | Already works. `factAnswer`'s reverse-membership branch reads `isa.filter(f => variants.has(f.object))` — every fact whose OBJECT is "animal" — and renders each via the shared capped-list convention (`FACT_ANSWER_CAP = 32`, inline `shown`/`rest` blocks — there is no named helper) with "…and N more — say 'more' to see them" pagination. This is a genuine, already-correct "list all X of taught class Y" answer; it is just not reachable under the phrasing "list all animals" (see below). |

Four distinct, precisely-scoped findings fall out of this:

1. **The Fact/Utterance/Session/Source/Rule meta-class list/count mechanism (`dynamicClassQuery`) is
   correct and tested but architecturally orphaned in the live chat runtime** — nothing ever calls
   `ask()` with a graph containing memory individuals. `list facts` never reaches it.
2. **`answerMemoryCount` has a live, confirmed correctness bug**: a restrictor tail on a memory-class
   count question is silently dropped, not declined, producing a wrong total instead of an honest
   miss or a correct restricted answer.
3. **A real cardinality count over a *taught ontology class*'s membership** (`"how many animals are
   there"`, as opposed to the five fixed meta-classes) has no lane anywhere in `chat.mjs` or
   `ask.mjs`. The closest existing mechanism, `countFromFacts`, only bridges a taught class back to a
   **code-graph** class's cardinality (`"every class is a type"` → `"how many types"` = the class
   count) — it does not count members of a purely conceptual taught class.
4. **The list-shaped mirror of (3) already exists and works** (`"what is an animal"`), but only under
   `"what is a Y"` / `"what kind of thing is an X"` phrasings — `"list all animals"` / `"list the
   animals"` do not match `KIND_OF_RE` (`src/services/chat.mjs`) or the bare meta-question fallback beside
   it, so an equally natural phrasing of the same, already-answerable question
   currently falls through to an honest miss instead of routing to the working code.

None of these four are the item `PLAN_BREADTH_FIRST_NLU.md` (d) named — that item is done. All four
are real, narrower, freshly-found gaps immediately adjacent to it, precise enough to fix directly.

## The concrete query shapes, and what changes each one needs

| # | Query | Class of gap | Fix |
|---|---|---|---|
| 1 | `list facts` / `how many facts are there` (from live chat, not a unit test) | Orphaned mechanism (finding 1) | Give `chat.mjs` its own memory-class list/count lane that calls into `dynamicClassQuery`'s logic directly against `loadMemory(memoryDir)`'s individuals — never via the code `graph`. See "Recognizer changes" §A. |
| 2 | `list utterances` / `how many sessions are there` | Same as #1 | Same fix — the lane is generic over whatever class is present, not hardcoded to Fact. |
| 3 | `how many facts about horses are there` | Live bug (finding 2) — wrong answer, not a miss | Reuse `DYNAMIC_TAIL_OK_RE`'s decline-on-restrictor discipline in the new lane (§A), so a real restrictor either resolves correctly (§5, stretch) or declines honestly — never silently drops. |
| 4 | `how many animals are there` / `how many animals do you know about` | Missing lane (finding 3) | New `countTaughtClassMembers` function, mirroring the existing reverse-membership LIST branch's `isa.filter(f => variants.has(f.object))` query but returning `hits.length` instead of rendering each line. See §B. |
| 5 | `list all animals` / `list the animals` | Phrasing/routing gap (finding 4) | Add a `list all <noun>` trigger that routes into the SAME `factAnswer` reverse-membership branch already used by `"what is a Y"` — no new rendering, only a new regex arm feeding the same `term`/`kindOf` variables. See §C. |
| 6 | `what people do you know about` | Same shape as #4/#5, different noun | Covered by #4/#5 once those land — "people" resolves the same way "animals" does, off whatever `rdfs:subClassOf … person` facts exist in the loaded corpus. No separate work. |
| 7 | `count all facts about horses` | Same as #3 | Same fix as #3. |
| 8 | `how many modules are there` / `list all classes` (code graph) | Not a gap | Already works today, unrelated to this document — `ENTITY_TO_TYPE` + the existing count/list AST, long-predating `dec95e8`. Cited here only to show the boundary of what's already fine. |
| 9 | `how many changes touch the last commit` (superlative/ranking) | Not this shape | `archive/TOO_HARD_AUDIT.md`'s M2 entry documents a **separate** mechanism (`parseSuperlative`/`SUPERLATIVE_EXTREMES`, argmax ranking — "the most-imported module") — a different query shape from plain count/list, already fixed, not touched by this document. |

### §A — a memory-class list/count lane in `chat.mjs`, reachable from live chat

**Export, don't duplicate.** `resolveDynamicClass`, `DYNAMIC_LIST_TRIGGER_RE`,
`DYNAMIC_COUNT_TRIGGER_RE`, and `DYNAMIC_TAIL_OK_RE` (`src/domain/ask.mjs`) are internal (unexported)
today. Export all four. `chat.mjs` gains `listMemoryClass(memoryDir, query)` and extends
`answerMemoryCount` (or adds a sibling `countMemoryClass`, naming TBD at implementation time) that:

1. Match the query against the exported trigger regexes (reused verbatim — one source of truth for
   "what counts as this bare list/count shape", never a second hand-copied regex pair).
2. `await loadMemory(memoryDir)` (already imported elsewhere in `chat.mjs`) to get the real
   `individuals` array.
3. Call the exported `resolveDynamicClass(memGraph, noun)` against it.
4. On a class hit: count, or render via the SAME capped-list/`FACT_ANSWER_CAP` convention
   `factAnswer`'s other list lanes already use (§ "Rendering and bounding" below) — not
   `dynamicClassQuery`'s own `OVERFLOW_CAP = 12`, which belongs to `ask.mjs`'s code-graph-shaped
   render path and is never reached from this lane.
5. On a restrictor tail failing `DYNAMIC_TAIL_OK_RE`: decline (return `null`), same discipline
   `dynamicClassQuery` already uses — the caller's existing honest-miss fallback stands.

**Wiring point**: `runTurn` (`src/services/chat.mjs`), immediately alongside `answerMemoryCount`'s
existing call — same precedence tier (before `answerQuantifierRecall`/`answerEdgeCount`/
`answerCount`, since those are code-graph-flavored and would otherwise short-circuit first on a
shared noun). `answerMemoryCount`'s own fixed `MEMORY_COUNT_NOUNS` dict (just `fact`/
`utterance`) can stay as a fast, explicit path (cheap, no `loadMemory` needed if `answerMemoryCount`
already found a hit) or fold into the new open-ended lane once `resolveDynamicClass` is available —
implementation-time call, not designed further here; either way the new lane is a strict superset
(also covers `Session`/`Source`/`Rule` and any taught class), so nothing regresses either way.

This directly closes findings 1 and 2 (the orphaned mechanism and the wrong-total bug), because the
new lane operates on `loadMemory`'s real payload, never the code `graph`, and inherits
`DYNAMIC_TAIL_OK_RE`'s decline-not-drop discipline that `answerMemoryCount` currently lacks.

### §B — real cardinality count over a taught ontology class

New function alongside `factAnswer`'s existing reverse-membership branch
(`src/services/chat.mjs`), sharing its `variants`/`objectHits` computation:

```
countTaughtClassMembers(rows, term, biasByBundle)
  variants = factTermVariants(normFactTerm, term)
  hits = rankByBiasThenTrust(isa.filter(f => variants.has(f.object)), biasByBundle)
  return hits.length ? `${hits.length} ${pluralize(term)}.` : null
```

Trigger: a new regex alongside `KIND_OF_RE`, matching `"how many <noun> are there"` /
`"how many <noun> do you know about"` — checked **after** `answerMemoryCount`/the new §A lane (a
memory meta-class noun like "facts" must keep winning) and **after** `HOW_MANY_ARE_RE`'s own
two-noun quantifier-recall shape (`"how many Xs are Ys"` is a different, already-handled question),
but **before** `answerCount`'s final code-graph "I can't count" honest miss — mirroring the ordering
discipline every other count lane in `runTurn` already documents inline.
Declines to `null` (never fabricates zero) when `isa`'s object-side filter finds nothing, so
`"how many wizards are there"` — a term never taught — keeps today's honest "I can't count" miss,
unchanged.

### §C — `"list all <noun>"` as a second trigger for the existing reverse-membership branch

`factAnswer`'s `(c) REVERSE / "what kind of thing" membership` block already
computes everything `"list all animals"` needs — it just never receives `term`/`kindOf` from that
phrasing. Add one more `else if` arm alongside the existing bare `"what is/are …"` fallback:

```js
else if (!term) {
  const m = q.match(/^(?:list|show(?:\s+me)?)\s+(?:all\s+|the\s+)?([a-z][a-z'-]*)\s*(.*)$/i);
  if (m && DYNAMIC_TAIL_OK_RE_STYLE_CHECK(m[2])) term = m[1];
}
```

reusing §A's exported `DYNAMIC_TAIL_OK_RE` for the same restrictor-tail decline discipline (a real
`"list all animals that bark"` restrictor declines honestly rather than silently answering the
unrestricted set). This is purely additive — no change to the existing `"what is a Y"` phrasing path,
no change to the rendered output shape, only a second way to reach the same, already-correct code.

## Rendering and bounding

Two existing, already-correct capping conventions stay exactly as they are; this document does not
invent a third:

- **`ask.mjs`'s `dynamicClassQuery` path** (reachable only via a direct `ask()` call; the shipped
  viz ask panel went the `factAnswer` route instead, so today this path has no live caller outside
  tests): `OVERFLOW_CAP = 12`, `"…and N more"`, no "say more" recall
  hook (this path has no session/pending-item mechanism to resume into).
- **`chat.mjs`'s `factAnswer` family** (§A's new lane, §B, §C, and every existing capped-list
  site): `FACT_ANSWER_CAP = 32`, `"…and N more — say 'more' to see them"`, backed by a real
  `pending: {items, noun}` continuation the session shell already resumes on the next turn's
  `"more"`. §A's new memory-class list lane should use
  **this** convention, not `ask.mjs`'s, since it lives in `chat.mjs` and its output is meant to be
  resumable the same way every other capped fact listing already is — consistency with its immediate
  neighbors matters more than matching `ask.mjs`'s unrelated cap number.
- At `init:xl`/`init:xxl` scale (measured elsewhere this session: init:large's conceptnet component
  alone reaches ~37,800 facts; xl/xxl target ~74K/~264K), both count and list operations here are a
  single linear `Array.filter` over `individuals` — `O(n)` with a small constant, no traversal. This
  is fast enough at even the largest seeded scale (sub-second) and needs no pagination-at-source
  design; only the **rendered** list needs a display cap, which both conventions above already
  provide.

## Non-goals

- **Not `archive/PLAN_VIZ_MEMORY.md`'s Bug 1** (the viz browser ask panel wiring). That shipped
  separately as `src/surfaces/web/memory-ask-browser-entry.mjs` for a different surface (the generated
  HTML file, not `npm run chat`). This document's §A lane is chat-CLI-specific and does not touch
  `src/services/ledger-viz.mjs`, `scripts/build-ask-bundle.mjs`, or any browser-bundle entry point.
- **Not a new ontology mechanism.** Taught classes stay exactly what they are today — the object side
  of an `rdfs:subClassOf`/`rdf:type` fact, discovered dynamically, never a new schema table or a
  registered "class" concept distinct from an ordinary taught fact.
- **Not full restrictor support for the memory-meta-class lane.** §A's new lane declines a restrictor
  tail (`"list facts that mention widget"`) rather than answering it, matching `dynamicClassQuery`'s
  own existing, deliberate scope. A correct restricted answer for that shape already exists under a
  different phrasing (`TOLD_ABOUT_RE`, `"what did you tell me about widget"` — `src/services/chat.mjs`)
  and is not redesigned here. Teaching `"how many facts about X"` to route into
  `TOLD_ABOUT_RE`'s own machinery instead of `answerMemoryCount`'s broken bare-noun regex is a real,
  smaller follow-on, flagged below, not designed in full here.
- **Not the code-graph side.** `ENTITY_TO_TYPE` + the existing count/list AST (`Function`/`Method`/
  `Class`/`Module`/`Attribute`/`GlobalVariable`/`Commit`) already work correctly and are unrelated to
  this document's findings — confirmed, not touched.
- **Not the superlative/ranking mechanism** (`archive/TOO_HARD_AUDIT.md` M2, `parseSuperlative`) — a
  different query shape ("the most-imported module"), already fixed, out of scope here.
- **Not a fix to `PLAN_BREADTH_FIRST_NLU.md`'s own "Status" section.** Out of this task's file
  boundary; flagged here for whoever next touches that document.

## Phased implementation plan

**Phase 1 — fix the live bug (finding 2).** `answerMemoryCount`'s restrictor-tail blindness is a
wrong-answer bug in shipped code, not a missing feature — highest priority, smallest diff. Export
`DYNAMIC_TAIL_OK_RE` from `ask.mjs`; make `answerMemoryCount` decline (return `null`) when a matched
noun has a real (non-filler) tail, instead of silently ignoring it. Exit criterion: `"how many facts
about horses are there"` against a real corpus no longer returns the unrestricted total — either an
honest miss or a correct restricted count, never a wrong number stated as fact. New test in
`test/chat-*.test.mjs` pinning this exact live-repro case.

**Phase 2 — the memory-class list/count lane, reachable from live chat (finding 1).** Export
`resolveDynamicClass`/`DYNAMIC_LIST_TRIGGER_RE`/`DYNAMIC_COUNT_TRIGGER_RE` from `ask.mjs`; add §A's
new `chat.mjs` lane, wired into `runTurn` at the same precedence tier as `answerMemoryCount`. Exit
criterion: `printf 'list facts\n/exit\n' | node bin/tmct.mjs chat` against a real seeded memory
returns the real fact list (capped at `FACT_ANSWER_CAP`, resumable via "more"), not the code-graph
compositional miss message. `npm test` green throughout.

**Phase 3 — real cardinality count over a taught class (finding 3, §B).** `countTaughtClassMembers`,
wired into `runTurn`'s count cascade at the position described in §B. Exit criterion: `"how many
animals are there"` against a corpus with taught `X rdfs:subClassOf animal` facts returns a real
count; an untaught class still honestly misses.

**Phase 4 — `"list all X"` phrasing for the existing reverse-membership branch (finding 4, §C).**
Purely additive regex arm in `factAnswer`. Exit criterion: `"list all animals"` and `"what is an
animal"` return byte-identical content for the same corpus.

**Phase 5 — optional follow-on, not required for this document's scope.** Route `"how many facts
about X"` / `"count facts about X"` into `TOLD_ABOUT_RE`'s own restrictor-aware machinery (real count
+ real list of the matching facts) rather than leaving Phase 1's fix as a bare decline. Named here so
it is not lost, not designed further — a smaller, separate follow-on once Phases 1-4 are stable.

Each phase is independently testable and independently shippable; `npm test` stays green throughout,
consistent with every other `PLAN_*.md` in this repo.
