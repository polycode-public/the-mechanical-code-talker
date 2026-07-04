# CHATBENCH_002_TRANSCRIPTS — appendix (discriminating transcripts first)

Judge pin: claude-haiku-4-5-20251001, prompt judge-prompt-v1. Run stamp: `cycle-002`.
Ordering: (A) the 2 remaining hard fails, (B) the 5 flipped cases with cycle-1→cycle-2
before/after contrast (the only 5 answers that changed — verified by product.jsonl diff),
(C) the biggest judge-side movers on byte-identical answers (ruler change + noise), (D) the rest,
ascending by judged mean.

## A. The 2 remaining hard fails (both 3/3-unanimous zeros; both cut-by-choice to cycle 3)

### gq-functions-call-fnalpha (graph-query) — judged mean 0 — HARD FAIL

The L4 answer-grain gap: the fixture records callsSymbol Widget.render → fnAlpha; the answer denies it with confidence.

```
> which functions call fnAlpha
No functions found whose module directly calls fnAlpha. (traversal: callsSymbol edges where object = fnAlpha)
```

### mt-focus-drift (multi-turn-focus) — judged mean 0 — HARD FAIL

The L5 pronoun bug: turn 3's "it" binds to a Commit, contradicting turn 1's own importer list; H1b removed the old turn-1 contamination, so the zero is now purely turn 3.

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

## B. The 5 flips — before/after (the only changed answers in the run)

### mr-session-count (memory-recall) — 0 → 2.0 — H1a (harness clearCache between sessions)

The cycle-1 "0 sessions." was the bench's stale process-level read cache; with the bench matching one-process-per-session reality, the product's append+count path scores perfect.

```
cycle 1:
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> how many sessions are there
0 sessions.

cycle 2:
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> how many sessions are there
1 session.
```

### tf-modles (typo-fuzzy) — 0.5 → 2.0 — L3 (schema-trap guard)

The fuzzy pivot onto the schema individual `Module` is gone; the repair receipt plus the complete answer took all three samples to 2/2/2.

```
cycle 1:
> which modles import a.mjs
No — no imports edge found from Module to app/lib/a.mjs.

cycle 2:
> which modles import a.mjs
read as "which modules import a.mjs" — app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

### ns-hey-tmct (noise) — 0 → 0.917 — L1 (strip the product's own name)

The fabricated-limitation zero is gone; the score now sits on the L4 grain cap — all 3 samples cite the omitted symbol-level caller Widget.render.

```
cycle 1:
> hey tmct, what calls fnAlpha thanks
couldn't resolve one of the terms in this question.

cycle 2:
> hey tmct, what calls fnAlpha thanks
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

### tf-wat-calls (typo-fuzzy) — 0.833 → 1.667 — L1 (trigger-typo restore "wat"→"what")

The vague term-resolution failure became the honest empty with a receipt — exactly the answer the case context names as the target; 2/3 samples gave full marks.

```
cycle 1:
> wat calls fnAlpha
couldn't resolve one of the terms in this question.

cycle 2:
> wat calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

### ns-wondering (noise) — 0 → 0.75 — L1 (strip aux-verb residue "was")

Same repair as ns-hey-tmct but noisier judging (spread 1.25): two samples grade the grain-capped empty as incomplete, one zeroes it as wrong-confident against the recorded Widget.render caller.

```
cycle 1:
> i was wondering what calls fnAlpha
couldn't resolve one of the terms in this question.

cycle 2:
> i was wondering what calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

## C. Biggest judge-side movers — answers byte-identical across cycles

### mt-describe-then-callers (multi-turn-focus) — 0.667 → 2.0 — H1b measurement correction

Unchanged output, 3/3 unanimous 2s once FIXTURE_CONTEXT stopped contradicting the fixture's def5678 provenance — cycle 1's zeroed groundedness was the judge scoring faithfully against an unfaithful summary.

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

### gq-when-changed-a (graph-query) — 2.0 → 1.0 — def5678 ruler effect (3/3 unanimous, NOT noise)

Same answer as cycle 1; the truthful context now documents def5678 in a.mjs's provenance, so "last touched by abc1234" is graded incomplete/overstated — the product gap behind cycle-3 lever rank 3.

```
> when did a.mjs change
app/lib/a.mjs was last touched by commit abc1234 on 2026-06-28 ("Render the widget with full mode").
```

### mt-ask-then-touched (multi-turn-focus) — 2.0 → 1.5 — def5678 ruler effect (3/3 unanimous)

Turn 1 still perfect; turn 2's "abc1234" is now graded incomplete for omitting the provenance-recorded def5678.

```
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
> who touched it
abc1234.
```

### mr-graph-intact (memory-recall) — 1.833 → 1.5 — def5678 ruler effect

The case's core invariant still holds (session 2 re-answers perfectly; fold-in corrupts nothing); the drop is the "who touched" turn now dinged for the def5678 omission.

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

### gq-who-touched-a (graph-query) — 1.667 → 1.5 — def5678 ruler effect (small)

Cycle 1's 2/3 "who asks for a person" quibble became cycle 2's 3/3 def5678-omission ding — same answer, re-rationalized.

```
> who touched a.mjs
abc1234.
```

### gq-impact-a (graph-query) — 1.5 → 1.333 — sampling noise around a real rendering looseness

The depth-2 "(imports it)" label (transitive dependents rendered as direct importers) drew 1/3 sample complaints in cycle 1 and 2/3 here; spread 1.0 both cycles.

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

### conv-what-can-you-do (conversational) — 1.167 → 1.0 — sampling noise (spread 2.0, both cycles' worst)

Judges again split on the hardcoded example questions naming entities absent from the graph (walk.mjs, buildContextBundle) — a repeat offender queued in the cycle-3 polish batch.

```
> what can you do
I answer questions about THIS codebase's structure — imports, calls, definitions,
history and counts. For example:
  which modules import walk.mjs
  what calls buildContextBundle
  how many classes are there
/help for commands, /stats for an overview of the graph.
```

## D. The remaining cases, ascending by judged mean

### mr-asked-before (memory-recall) — judged mean 0.667 — documented baselineFail (−0.083, noise)

The recall-surface gap: session memory holds the utterances but nothing reads them; the grammar-miss hint dump answers the wrong meta-question. Cycle-3+ lever rank 5.

```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> what did i ask before
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

### am-bare-name (ambiguity) — judged mean 0.917 — documented baselineFail (−0.166, noise)

Bare "Widget" still gets generic help with the non-graph examples instead of acknowledging the recognized class; queued in the polish batch.

```
> Widget
I answer questions about THIS codebase's structure — imports, calls, definitions,
history and counts. For example:
  which modules import walk.mjs
  what calls buildContextBundle
  how many classes are there
/help for commands, /stats for an overview of the graph.
```

### hm-unknown-fn (honesty-miss) — judged mean 1.0 (+0.222)

Honest miss but kind-wrong phrasing ("no module matching" for a function question) and rephrase 0.0 across all samples — polish-batch target.

```
> what calls nonExistentFn
no module matching "nonExistentFn" found in the index.
```

### hm-unknown-module (honesty-miss) — judged mean 1.111 (=)

Honest miss, wrong kind-noun ("no symbol matching" for a module question), no nudge; rephrase 0.0.

```
> which modules import zebra.mjs
no symbol matching "zebra.mjs" found in the index.
```

### tf-fnalpah (typo-fuzzy) — judged mean 1.111 (=)

The repair works but the module-grain empty conceals the recorded symbol-level caller — an L4 grain-cap case.

```
> what calls fnAlpah
assuming you meant fnAlpha: No modules found whose module directly calls fnAlpah. (traversal: calls edges where object = fnAlpha)
```

### gq-describe-widget (graph-query) — judged mean 1.333 (=)

Sample quibbles on unstated-in-context details (cls-widget id, @property); spread 1.0 — a FIXTURE_CONTEXT completeness item, rank 6.

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

### gq-members-widget (graph-query) — judged mean 1.333 (−0.167, noise)

Same @property / name-line-number quibble cluster as cycle 1, one extra sample landed on it.

```
> /members Widget
Widget — Class (id: cls-widget)
methods (1): render [app/lib/b.mjs:5-9] @property
attributes (1): name [app/lib/b.mjs:2]
Use tmct_snippet <Class.member> for an exact body.
```

### mt-focus-members (multi-turn-focus) — judged mean 1.333 (−0.167, noise)

Focus threading works; score capped by the same @property quibble as gq-members-widget.

```
> /focus Widget
focus set to Widget.
> /members
Widget — Class (id: cls-widget)
methods (1): render [app/lib/b.mjs:5-9] @property
attributes (1): name [app/lib/b.mjs:2]
Use tmct_snippet <Class.member> for an exact body.
```

### hm-empty-result-calls (honesty-miss, graph-query) — judged mean 1.444 (+0.333)

The honest module-grain empty, still concealing the symbol-grain hit — the L4 disclosure-line target, with the tier-1 `miss:true` scoping trap.

```
> what calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

### be-honest-empty (bootstrap-empty) — judged mean 1.667 (=) — regression-watch: HELD

The empty-graph honesty message survived H1a untouched.

```
--- session 1 ---
> which modules import a.mjs
the graph at <repo>/.tmct/graph.json is empty — no entities to answer from yet (this repo starts with no graph; the chat session folds the conversation into one).
> how many modules are there
0 modules.
```

### am-meta-imports (ambiguity) — judged mean 1.667 (=)

```
> what does imports mean
this could mean more than one thing: 1) meta "imports" or 2) imports "mean" — try rephrasing more specifically.
```

### gq-public-methods-widget (graph-query) — judged mean 1.667 (=)

```
> public methods of Widget
Widget.render().
```

### am-two-readings (ambiguity) — judged mean 1.833 (=)

```
> which classes extends Base and couples to app/lib/b.mjs
this could mean more than one thing: 1) classes that inherits "Base and couples to app/lib/b.mjs" or 2) imports "app/lib/b.mjs" — try rephrasing more specifically.
```

### gq-inherit-from-base (graph-query) — judged mean 1.833 (−0.167, noise)

One sample wanted transitive Button included; the other two accept direct inheritance as complete.

```
> which classes inherit from Base
in app/lib/b.mjs there is Widget.
```

### The 2.0 club (23 cases)

All 3/3-perfect; one-line annotations only.

**am-tests-cover** — clean ambiguity refusal with a narrowing nudge.

```
> which tests cover b.mjs
"cover b.mjs" matches more than one module ambiguously — please narrow the term.
```

**be-greet-stats** — honest empty-graph greeting + zeroed stats.

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

**conv-bye / conv-hello-there / conv-hi / conv-thanks / conv-why-empty** — the conversational shell: greeting, easter egg, thanks, and the no-previous-answer "why" guard, all clean.

```
> bye
Bye — flushing the session log. Come back with a question any time.
```

```
> hello there
Hello there. (A hollow voice says, "fool.") Ask me about this codebase, or /help.
```

```
> hi
Hi. Ask me about this codebase — imports, calls, definitions, history — or /help.
```

```
> thanks
Any time. Ask another, or /help for what I can do.
```

```
> why
No previous answer to expand yet — ask me a question first, then say "why" or "say more".
```

**gq-count-classes / gq-imports-by-e / gq-imports-of-a / gq-subclasses-base / gq-tests-for-b / gq-where-defined-fnalpha** — the clean graph-query core: counts, forward/reverse imports, subclass closure, test edges, definition sites.

```
> how many classes are there
3 classes.
```

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
```

```
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

```
> /subclasses Base
Base — Class (id: cls-base)
extends: (no internal/recorded base classes)
subclasses: 2 total across 2 level(s).
  depth 1 (1): Widget
  depth 2 (1): Button
```

```
> what tests touch app/lib/b.mjs
app/unit-tests/b.test.mjs.
```

```
> where is fnAlpha defined
function fnAlpha() is defined in app/lib/a.mjs at line 12.
```

**hm-count-bananas** — the model honest miss: names what it CAN count and offers a working phrasing.

```
> how many bananas are there
I can't count "bananas". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

**hm-joke** — off-domain refusal via the full grammar hint (verbose but truthful; judges accept it).

```
> tell me a joke
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> mentioned" ... (full hint as mr-asked-before above)
```

**mt-why-expand** — why-expansion replays the traversal receipt with the full match table.

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

**ns-could-you / ns-so-uh-count / ns-um-hey** — regression-watch: HELD; the curated noise-strip path still recovers all three cleanly after L1's changes.

```
> could you tell me which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

```
> so, uh, how many classes are there then
3 classes.
```

```
> um hey so like which modules import a.mjs please
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

**tf-whcih-imprt** — regression-watch: HELD; the two-typo repair still lands at 2.0 after L3's guard on the same code path.

```
> whcih modules imprt a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

**mr-session-count / tf-modles / mt-describe-then-callers** — also 2.0; shown with before/after contrast in sections B and C.
