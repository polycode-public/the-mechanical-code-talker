# CHATBENCH_001_TRANSCRIPTS — appendix (discriminating transcripts first)

Judge pin: claude-haiku-4-5-20251001, prompt judge-prompt-v1. Run stamp: `cycle-001`.

Ordered for discrimination: §1 the six hard fails, §2 the contrast pairs that isolate each
failure seam (fail beside its passing twin), §3 the remaining notable low/mid scorers, §4 the
rest. Every "what this shows" traces to the matching rows in
`chatbench/results/raw/run-cycle-001/{product,judged}.jsonl`.

## 1. Hard fails (6)

### gq-functions-call-fnalpha (graph-query) — judged mean 0 — documented baselineFail, HARD FAIL

**What this shows:** the graph records `callsSymbol` Widget.render → fnAlpha, but the answer path
only walks module-grain calls edges — a recorded fact is confidently denied (judge zeroed all
four dims, 3/3 samples).

```
> which functions call fnAlpha
No functions found whose module directly calls fnAlpha. (traversal: callsSymbol edges where object = fnAlpha)
```

### mr-session-count (memory-recall) — judged mean 0 — documented baselineFail, HARD FAIL

**What this shows:** session 1 IS appended to graph.json (verified), but the bench replays both
sessions in one process and `src/source.mjs`'s read cache serves session 2 the stale pre-session
payload — bench wiring, fixed by `clearCache()` between sessions (verified → "1 session.").

```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> how many sessions are there
0 sessions.
```

### mt-focus-drift (multi-turn-focus) — judged mean 0 — documented baselineFail, HARD FAIL

**What this shows:** turn 3's "it" binds to a Commit instead of the focused a.mjs (receipt:
`object = Commit`), contradicting turn 1's own importer list; turn 1's "2 commit(s)/def5678"
judge complaints are a FIXTURE_CONTEXT artifact — that provenance IS in the fixture.

```
> /describe app/lib/a.mjs
app/lib/a.mjs — Module (id: mod-a)
attestation: touched by 2 commit(s)
attribute: dotted = app.lib.a [mgx:dotted]
edges:
  defines [seon:declaresMethod] (1) → fnAlpha
  cochange [mgx:changeCoupledWith] (2) → app/lib/b.mjs, app/lib/c.mjs
  ← imports [mgx:importsNamespace] (3) by app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs
  ← calls [mgx:callsCoarse] (1) by scripts/g.mjs
  ← touches [mgx:touchedByCommit] (1) by abc1234
provenance: git:abc1234, git:def5678
> what calls it
scripts/g.mjs.
> which modules import it
No modules found whose module directly imports it. (traversal: imports edges where object = Commit)
```

### ns-hey-tmct (noise) — judged mean 0 — documented baselineFail, HARD FAIL

**What this shows:** `stripNoise` drops "hey"/"thanks" but keeps the product's own name — the
residual "tmct" becomes an unresolvable term and the judge zeroes the vague refusal as a
fabricated limitation.

```
> hey tmct, what calls fnAlpha thanks
couldn't resolve one of the terms in this question.
```

### ns-wondering (noise) — judged mean 0 — documented baselineFail, HARD FAIL

**What this shows:** same seam, different residue — "i was wondering …" strips to "was what
calls fnAlpha"; the surviving "was" defeats the anchored re-parse.

```
> i was wondering what calls fnAlpha
couldn't resolve one of the terms in this question.
```

### tf-modles (typo-fuzzy) — judged mean 0.5 — documented baselineFail, HARD FAIL

**What this shows:** the fuzzy tier pivots the typo "modles" onto the SCHEMA individual `Module`
and confidently answers a question nobody asked (groundedness 2, correctness 0 + honesty 0 →
hard fail: the confidently-wrong anchor).

```
> which modles import a.mjs
No — no imports edge found from Module to app/lib/a.mjs.
```

## 2. Contrast pairs — the failure seam beside its passing twin

### noise: ns-um-hey (mean 2) vs the two ns-* hard fails above

**What this shows:** when every non-grammar token is curated noise the strip recovers the parse
perfectly — the seam is exactly the residual-token list, nothing deeper.

```
> um hey so like which modules import a.mjs please
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

### typo repair: tf-whcih-imprt (mean 2) vs tf-wat-calls (mean 0.833, baselineFail)

**What this shows:** the trigger-typo restore handles "whcih"/"imprt" but not "wat" — the same
question collapses to a vague refusal with zero rephrase help.

```
> whcih modules imprt a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

```
> wat calls fnAlpha
couldn't resolve one of the terms in this question.
```

### answer grain: hm-empty-result-calls (mean 1.111) vs gq-functions-call-fnalpha (§1)

**What this shows:** the module-grain empty is tier-1-correct and honest, yet the judge docks
honesty/rephrase for concealing the recorded symbol-grain caller (Widget.render) — the same
disclosure gap that zeroes the gq case caps this one at ~1.1.

```
> what calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

### memory: mr-graph-intact (mean 1.833) vs mr-session-count (§1)

**What this shows:** the per-turn graph fold-in does not corrupt the graph — session 2 re-answers
perfectly; memory-recall's terrible tag mean is the stale-cache artifact plus mr-asked-before,
not a broken fold.

```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
> who touched a.mjs
abc1234.
--- session 2 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

### pronoun focus: mt-ask-then-touched (mean 2) vs mt-focus-drift (§1)

**What this shows:** "it" after a bare-ask hit resolves correctly — the drift only appears after
"what calls it" moves the focus, isolating the bug to focus-update-on-pronoun-turns.

```
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
> who touched it
abc1234.
```

### fuzzy receipt done right: tf-fnalpah (mean 1.111)

**What this shows:** the desired repair-receipt shape exists ("assuming you meant fnAlpha") —
tf-modles's trap is the pivot-to-schema-term, not a missing receipt mechanism; score is capped
by the same symbol-grain concealment as hm-empty-result-calls.

```
> what calls fnAlpah
assuming you meant fnAlpha: No modules found whose module directly calls fnAlpah. (traversal: calls edges where object = fnAlpha)
```

## 3. Remaining notable low/mid scorers

### mt-describe-then-callers (multi-turn-focus) — judged mean 0.667

**What this shows:** turn 2 is fully correct; the low mean is the judge zeroing turn 1's
truthful /describe against a FIXTURE_CONTEXT that wrongly claims "no other commits" — a harness
accuracy bug, not product fabrication.

```
> /describe app/lib/a.mjs
app/lib/a.mjs — Module (id: mod-a)
attestation: touched by 2 commit(s)
attribute: dotted = app.lib.a [mgx:dotted]
edges:
  defines [seon:declaresMethod] (1) → fnAlpha
  cochange [mgx:changeCoupledWith] (2) → app/lib/b.mjs, app/lib/c.mjs
  ← imports [mgx:importsNamespace] (3) by app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs
  ← calls [mgx:callsCoarse] (1) by scripts/g.mjs
  ← touches [mgx:touchedByCommit] (1) by abc1234
provenance: git:abc1234, git:def5678
> what calls it
scripts/g.mjs.
```

### mr-asked-before (memory-recall) — judged mean 0.75 — documented baselineFail

**What this shows:** the one real product memory gap — the utterances are recorded, but no
recall surface reads them, so a history question gets the full grammar-miss dump (judge: "the
weakest possible approach").

```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> what did i ask before
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

### hm-unknown-fn (honesty-miss) — judged mean 0.778

**What this shows:** a kind-category error in the miss message — a *function* question answered
with a *module*-shaped miss; the judge reads it as hiding the real limitation.

```
> what calls nonExistentFn
no module matching "nonExistentFn" found in the index.
```

### am-bare-name (ambiguity) — judged mean 1.083 — documented baselineFail

**What this shows:** Widget is a known class, but the bare name gets the generic orientation —
which also cites entities (walk.mjs, buildContextBundle) that don't exist in this graph.

```
> Widget
I answer questions about THIS codebase's structure — imports, calls, definitions,
history and counts. For example:
  which modules import walk.mjs
  what calls buildContextBundle
  how many classes are there
/help for commands, /stats for an overview of the graph.
```

### hm-unknown-module (honesty-miss) — judged mean 1.111

**What this shows:** an honest, grounded miss scoring low only on rephrase — the nudge gap, not
a truth gap.

```
> which modules import zebra.mjs
no symbol matching "zebra.mjs" found in the index.
```

### conv-what-can-you-do (conversational) — judged mean 1.167

**What this shows:** hardcoded orientation examples name entities absent from the loaded graph;
2 of 3 judge samples dock honesty for it (also the tag's only sub-1.5 case).

```
> what can you do
I answer questions about THIS codebase's structure — imports, calls, definitions,
history and counts. For example:
  which modules import walk.mjs
  what calls buildContextBundle
  how many classes are there
/help for commands, /stats for an overview of the graph.
```

### gq-describe-widget (graph-query) — judged mean 1.333

**What this shows:** /describe over Widget is correct; samples split 1/2/2 on groundedness
detail-reading — mild judge variance, no product defect identified.

```
> /describe Widget
Widget — Class (id: cls-widget)
attribute: site = app/lib/b.mjs:1-30 [seon:startsAt]
edges:
  contains [seon:containsCodeEntity] (2) → render, name
  inherits [seon:hasSuperType] (1) → Base
  ← defines [seon:declaresMethod] (1) by app/lib/b.mjs
  ← inherits [seon:hasSuperType] (1) by Button
other matches: Widget.name (Attribute), Widget.render (Method)
```

### gq-impact-a (graph-query) — judged mean 1.5

**What this shows:** the highest-variance case (samples 2.0/2.0/0.5) — sample 3 read the
depth-2 "(imports it)" phrasing as claiming direct imports of a.mjs; a render-clarity nit plus
judge noise, tracked in the judge-integrity section.

```
> /impact app/lib/a.mjs
Impact of changing app/lib/a.mjs (reverse closure over imports/calls edges, module- and function-level):
total: 6 dependent(s) across 2 depth level(s) (lists capped for brevity).
depth 1 (4 direct dependents):
  - app/lib/b.mjs (imports it) — tests: app/unit-tests/b.test.mjs
  - app/lib/c.mjs (imports it) — tests: none recorded
  - app/lib/e.mjs (imports it) — tests: none recorded
  - scripts/g.mjs (calls it) — tests: none recorded
depth 2 (2):
  - app/functions/d/handler.mjs (imports it) — tests: app/unit-tests/b.test.mjs
  - app/lib/f.mjs (imports it) — tests: none recorded
```

### gq-members-widget (graph-query) — judged mean 1.5

**What this shows:** correct members listing; groundedness docked once for the @property
annotation detail.

```
> /members Widget
Widget — Class (id: cls-widget)
methods (1): render [app/lib/b.mjs:5-9] @property
attributes (1): name [app/lib/b.mjs:2]
Use tmct_snippet <Class.member> for an exact body.
```

### mt-focus-members (multi-turn-focus) — judged mean 1.5

**What this shows:** /focus + no-arg /members reuse the focus correctly.

```
> /focus Widget
focus set to Widget.
> /members
Widget — Class (id: cls-widget)
methods (1): render [app/lib/b.mjs:5-9] @property
attributes (1): name [app/lib/b.mjs:2]
Use tmct_snippet <Class.member> for an exact body.
```

## 4. The rest (mid-to-perfect scorers)

### am-meta-imports (ambiguity) — judged mean 1.667

```
> what does imports mean
this could mean more than one thing: 1) meta "imports" or 2) imports "mean" — try rephrasing more specifically.
```

### be-honest-empty (bootstrap-empty) — judged mean 1.667

```
--- session 1 ---
> which modules import a.mjs
the graph at <repo>/.tmct/graph.json is empty — no entities to answer from yet (this repo starts with no graph; the chat session folds the conversation into one).
> how many modules are there
0 modules.
```

### gq-public-methods-widget (graph-query) — judged mean 1.667

```
> public methods of Widget
Widget.render().
```

### gq-who-touched-a (graph-query) — judged mean 1.667

```
> who touched a.mjs
abc1234.
```

### am-two-readings (ambiguity) — judged mean 1.833

```
> which classes extends Base and couples to app/lib/b.mjs
this could mean more than one thing: 1) classes that inherits "Base and couples to app/lib/b.mjs" or 2) imports "app/lib/b.mjs" — try rephrasing more specifically.
```

### am-tests-cover (ambiguity) — judged mean 2

```
> which tests cover b.mjs
"cover b.mjs" matches more than one module ambiguously — please narrow the term.
```

### be-greet-stats (bootstrap-empty) — judged mean 2

```
--- session 1 ---
> hi
Hi. Ask me about this codebase — imports, calls, definitions, history — or /help.
> /stats
graph overview — 0 entities.
entities by class:
relationships by predicate:
  (none recorded)
0 module(s) across 0 top-level package(s).
```

### conv-bye (conversational) — judged mean 2

```
> bye
Bye — flushing the session log. Come back with a question any time.
```

### conv-hello-there (conversational) — judged mean 2

```
> hello there
Hello there. (A hollow voice says, "fool.") Ask me about this codebase, or /help.
```

### conv-hi (conversational) — judged mean 2

```
> hi
Hi. Ask me about this codebase — imports, calls, definitions, history — or /help.
```

### conv-thanks (conversational) — judged mean 2

```
> thanks
Any time. Ask another, or /help for what I can do.
```

### conv-why-empty (conversational) — judged mean 2

```
> why
No previous answer to expand yet — ask me a question first, then say "why" or "say more".
```

### gq-count-classes (graph-query) — judged mean 2

```
> how many classes are there
3 classes.
```

### gq-imports-by-e (graph-query) — judged mean 2

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
```

### gq-imports-of-a (graph-query) — judged mean 2

```
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

### gq-inherit-from-base (graph-query) — judged mean 2

```
> which classes inherit from Base
in app/lib/b.mjs there is Widget.
```

### gq-subclasses-base (graph-query) — judged mean 2

```
> /subclasses Base
Base — Class (id: cls-base)
extends: (no internal/recorded base classes)
subclasses: 2 total across 2 level(s).
  depth 1 (1): Widget
  depth 2 (1): Button
```

### gq-tests-for-b (graph-query) — judged mean 2

```
> what tests touch app/lib/b.mjs
app/unit-tests/b.test.mjs.
```

### gq-when-changed-a (graph-query) — judged mean 2

```
> when did a.mjs change
app/lib/a.mjs was last touched by commit abc1234 on 2026-06-28 ("Render the widget with full mode").
```

### gq-where-defined-fnalpha (graph-query) — judged mean 2

```
> where is fnAlpha defined
function fnAlpha() is defined in app/lib/a.mjs at line 12.
```

### hm-count-bananas (honesty-miss) — judged mean 2

```
> how many bananas are there
I can't count "bananas". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

### hm-joke (honesty-miss) — judged mean 2

```
> tell me a joke
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

### mt-why-expand (multi-turn-focus) — judged mean 2

```
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
> why
(expanding: which modules import a.mjs)
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
traversal: imports edges where object = app/lib/a.mjs
matches (3):
  app/lib/b.mjs [Module] — app/lib/b.mjs
  app/lib/c.mjs [Module] — app/lib/c.mjs
  app/lib/e.mjs [Module] — app/lib/e.mjs
```

### ns-could-you (noise) — judged mean 2

```
> could you tell me which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

### ns-so-uh-count (noise) — judged mean 2

```
> so, uh, how many classes are there then
3 classes.
```
