# CHATBENCH_003_TRANSCRIPTS — appendix (discriminating transcripts first)

Judge pin: claude-haiku-4-5-20251001, prompt judge-prompt-v1. Run stamp: `cycle-003`.
Ordering: **discriminating first** — the six baseline-improved v1 wins, then the 38 hard fails
(the B1 cliff), then the tail descending by judge mean. See CHATBENCH_003.md for the full analysis.

**How to read the discriminating set (one line each):**
- **The wave's one real v1 win — `mr-asked-before`:** cross-session recall lands (correct 2/2/2);
  case mean only 1.222 because the judge context can't see the session id it truthfully cites.
- **B1 negation cliff (`g-b1-neg-*`, mean 0.20):** engine tokenizes "not"/"don't" as an *entity* —
  "no module matching 'not' found" / "couldn't resolve one of the terms" — a missing set-complement
  verb, confidently wrong. THE cycle-4 #1 lever.
- **B1 reversible-passive (`g-b1-passive-*`, 0.48):** object-first "is tested/imported BY" traverses
  the edge direction reversed → false "No modules found".
- **B1/B2 combo cells (`g-b1-pron-neg-*` 0.27, `g-b2-count-temp-*` 0.05):** two required operations
  stack (pronoun+negation, count+grain) and both fail — the composition penalty that validates the
  combination-cell design.
- **A2 naming / `/describe` cases (`g-a2-naming-*`, 0.60):** NOT a product bug — the product emits
  REAL fixture attributes (line numbers, params, ids); the judge scores them as fabrication because
  its context omits them. A judge-context-completeness artifact, cycle-4 harness lever.
- **The real help-text leak (`am-bare-name`, `conv-what-can-you-do`, `g-b1-pron-24/14`):** hardcoded
  `walk.mjs` / `buildContextBundle` examples name non-fixture entities — a separate product lever.
- **Best-working complex sequences (means 1.8–2.0):** `g-b2-noise-pron-4` (noise+pronoun over
  /describe), `g-b2-coord-32` (genuine 2-constraint intersection), `g-b2-rel-31` (relative-clause
  nesting), `mt-describe-then-callers` (multi-turn focus).

## mr-asked-before (memory-recall) — judged mean 1.222 — BASELINE IMPROVED — the wave's one real v1 win (correct 2/2/2, groundedness-capped by judge context)

```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> what did i ask before
last time (session 019f2f3e, 2026-07-04) you asked: "which modules import a.mjs"
```

## mr-session-count (memory-recall) — judged mean 2 — BASELINE IMPROVED

```
--- session 1 ---
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
--- session 2 ---
> how many sessions are there
1 session.
```

## ns-hey-tmct (noise) — judged mean 0.75 — BASELINE IMPROVED

```
> hey tmct, what calls fnAlpha thanks
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

## ns-wondering (noise) — judged mean 1.167 — BASELINE IMPROVED

```
> i was wondering what calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

## tf-modles (typo-fuzzy) — judged mean 2 — BASELINE IMPROVED

```
> which modles import a.mjs
read as "which modules import a.mjs" — app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

## tf-wat-calls (typo-fuzzy) — judged mean 1.417 — BASELINE IMPROVED

```
> wat calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

## g-a2-naming-13 (graded) — judged mean 0.167 — HARD FAIL

```
> /describe Button
Button — Class (id: cls-button)
attribute: site = app/lib/c.mjs:1-10 [seon:startsAt]
edges:
  inherits [seon:hasSuperType] (1) → Widget
```

## g-a2-naming-16 (graded) — judged mean 0 — HARD FAIL

```
> /describe Widget.render
Widget.render — Method (id: m-render)
attribute: site = app/lib/b.mjs:5-9 [seon:startsAt]
attribute: decorators = property [mgx:decorator]
attribute: params = self, mode='full' [seon:hasParameter]
attribute: returns = str [seon:hasReturnType]
attribute: raises = ValueError [seon:throwsException]
attribute: self_fields = name, size [seon:accessesField]
attribute: doc = Render the widget. [seon:hasDoc]
edges:
  callsSymbol [mgx:callsSymbol] (1) → fnAlpha
  ← touchesSymbol [mgx:touchesSymbol] (1) by abc1234
  ← contains [seon:containsCodeEntity] (1) by Widget
```

## g-b1-disc-13 (graded) — judged mean 0.111 — HARD FAIL

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
> which of those are tested
"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.
```

## g-b1-disc-16 (graded) — judged mean 0.167 — documented baselineFail, HARD FAIL

```
> which modules import app/lib/b.mjs
app/functions/d/handler.mjs.
> which of those are tested
"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.
```

## g-b1-neg-11 (graded) — judged mean 0.5 — documented baselineFail, HARD FAIL

```
> which functions are not exported
no module matching "not" found in the index.
```

## g-b1-neg-13 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which modules do not import app/lib/c.mjs
couldn't resolve one of the terms in this question.
```

## g-b1-neg-19 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which modules do not import app/functions/d/handler.mjs
couldn't resolve one of the terms in this question.
```

## g-b1-neg-5 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which modules do not import app/unit-tests/b.test.mjs
couldn't resolve one of the terms in this question.
```

## g-b1-neg-6 (graded) — judged mean 0.5 — documented baselineFail, HARD FAIL

```
> which modules don't import anything
no module matching "not" found in the index.
```

## g-b1-passive-24 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which modules are tested by app/unit-tests/b.test.mjs
No modules found whose module directly tests by app/unit-tests/b.test.mjs. (traversal: tests edges where object = app/unit-tests/b.test.mjs)
```

## g-b1-passive-25 (graded) — judged mean 0.5 — documented baselineFail, HARD FAIL

```
> which modules are imported by app/functions/d/handler.mjs
No modules found whose module directly imports by app/functions/d/handler.mjs. (traversal: imports edges where object = app/functions/d/handler.mjs)
```

## g-b1-passive-4 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which module is covered by app/unit-tests/b.test.mjs
No modules found whose module directly tests by app/unit-tests/b.test.mjs. (traversal: tests edges where object = app/unit-tests/b.test.mjs)
```

## g-b1-pron-neg-1 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

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
> which modules don't import it
couldn't resolve one of the terms in this question.
```

## g-b1-pron-neg-5 (graded) — judged mean 0.111 — documented baselineFail, HARD FAIL

```
> what does app/functions/d/handler.mjs import
app/lib/b.mjs and app/lib/c.mjs.
> which modules don't import it
couldn't resolve one of the terms in this question.
```

## g-b1-pron-neg-7 (graded) — judged mean 0.167 — documented baselineFail, HARD FAIL

```
> which modules import app/lib/b.mjs
app/functions/d/handler.mjs.
> which modules don't import it
couldn't resolve one of the terms in this question.
```

## g-b2-assert-20 (graded) — judged mean 0.167 — documented baselineFail, HARD FAIL

```
--- session 1 ---
> every function is a component
noted — remembered 1 fact: function rdfs:subClassOf component
> what is a component
"component" isn't a term in this graph's own vocabulary (no matching class or predicate).
```

## g-b2-coord-25 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which modules import app/lib/a.mjs or app/lib/e.mjs
"app/lib/a.mjs or app/lib/e.mjs" matches more than one module ambiguously — please narrow the term.
```

## g-b2-count-temp-12 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> how many commits touched app/lib/e.mjs
1 commit.
```

## g-b2-count-temp-18 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> how many commits touched the module that defines register
1 commit.
```

## g-b2-count-temp-21 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> how many commits are recorded for app/lib/e.mjs
1 commit.
```

## g-b2-count-temp-22 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> how many commits touched fnAlpha
1 commit.
```

## g-b2-count-temp-5 (graded) — judged mean 0.25 — documented baselineFail, HARD FAIL

```
> which module changed most recently
couldn't compile this compositional question (name what to rank by (imports, callers, methods, tests, or connections)). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested".
```

## g-b2-disc-1 (graded) — judged mean 0.194 — documented baselineFail, HARD FAIL

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

## g-b2-disc-5 (graded) — judged mean 0.25 — documented baselineFail, HARD FAIL

```
> which classes inherit from Base
in app/lib/b.mjs there is Widget.
> why
(expanding: which classes inherit from Base)
in app/lib/b.mjs there is Widget.
traversal: inherits edges where object = Base
matches (1):
  Widget [Class] — app/lib/b.mjs
> which of those are tested
"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.
```

## g-b2-disc-6 (graded) — judged mean 0.25 — documented baselineFail, HARD FAIL

```
> list the modules
app/lib/a.mjs, app/lib/b.mjs, app/lib/c.mjs, app/functions/d/handler.mjs, app/lib/e.mjs, app/lib/f.mjs, scripts/g.mjs and app/unit-tests/b.test.mjs.
> why
(expanding: list the modules)
app/lib/a.mjs, app/lib/b.mjs, app/lib/c.mjs, app/functions/d/handler.mjs, app/lib/e.mjs, app/lib/f.mjs, scripts/g.mjs and app/unit-tests/b.test.mjs.
matches (8):
  app/lib/a.mjs [Module] — app/lib/a.mjs
  app/lib/b.mjs [Module] — app/lib/b.mjs
  app/lib/c.mjs [Module] — app/lib/c.mjs
  app/functions/d/handler.mjs [Module] — app/functions/d/handler.mjs
  app/lib/e.mjs [Module] — app/lib/e.mjs
  app/lib/f.mjs [Module] — app/lib/f.mjs
  scripts/g.mjs [Module] — scripts/g.mjs
  app/unit-tests/b.test.mjs [Module] — app/unit-tests/b.test.mjs
> which of those are tested
"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.
```

## g-b2-passive-12 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which modules are imported by the module that defines Widget
app/functions/d/handler.mjs.
```

## g-b2-passive-4 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> fnAlpha is called by which method
couldn't resolve one of the terms in this question.
```

## g-c1-assert-5 (graded) — judged mean 0.5 — documented baselineFail, HARD FAIL

```
--- session 1 ---
> every module is a component
noted — remembered 1 fact: module rdfs:subClassOf component
--- session 2 ---
> how many components are there
I can't count "components". I count: classes, functions, modules, methods, attributes, variables, commits, sessions. Try "how many classes are there".
```

## g-c1-coord-1 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> modules that import app/lib/e.mjs but do not import app/lib/a.mjs
app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.
```

## g-c1-coord-8 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> modules that import app/lib/c.mjs but do not import app/lib/b.mjs
app/functions/d/handler.mjs.
```

## g-c1-neg-rel-22 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> modules importing the module that defines Widget but not tested
app/functions/d/handler.mjs.
```

## g-c1-rel-18 (graded) — judged mean 0 — HARD FAIL

```
> functions defined in the module that imports app/lib/b.mjs
No — no imports edge found from Module to app/lib/b.mjs.
```

## g-c1-temp-21 (graded) — judged mean 0.083 — documented baselineFail, HARD FAIL

```
> which modules changed together with app/lib/b.mjs
No modules found whose module directly touches together with app/lib/b.mjs. (traversal: touches edges where object = app/lib/b.mjs)
```

## g-c2-pron-10 (graded) — judged mean 0.25 — documented baselineFail, HARD FAIL

```
> app/lib/c.mjs imports app/lib/a.mjs because it defines fnAlpha — which of them defines fnAlpha
"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.
```

## g-c2-pron-3 (graded) — judged mean 0.167 — documented baselineFail, HARD FAIL

```
> app/lib/e.mjs can't be removed before app/lib/f.mjs because it still imports app/lib/f.mjs — which of them still imports app/lib/f.mjs
"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.
```

## g-c2-rel-20 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which modules cochange with the module that defines the function that Widget.render calls
nothing in the index matches that (modules).
```

## g-c2-rel-8 (graded) — judged mean 0 — documented baselineFail, HARD FAIL

```
> which modules import the module that defines the class that inherits from Widget
nothing in the index matches that (modules).
```

## mt-focus-drift (multi-turn-focus) — judged mean 0.111 — documented baselineFail, HARD FAIL

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

## g-b2-disc-15 (graded) — judged mean 0.111

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
> why
(expanding: what does app/lib/e.mjs import)
app/lib/a.mjs and app/lib/f.mjs.
traversal: imports edges where subject = app/lib/e.mjs
matches (2):
  app/lib/a.mjs [Module] — app/lib/a.mjs
  app/lib/f.mjs [Module] — app/lib/f.mjs
> which of those are tested
"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.
```

## g-b2-disc-23 (graded) — judged mean 0.167 — documented baselineFail

```
> /describe app/lib/e.mjs
app/lib/e.mjs — Module (id: mod-e)
edges:
  imports [mgx:importsNamespace] (2) → app/lib/a.mjs, app/lib/f.mjs
  ← imports [mgx:importsNamespace] (1) by app/lib/f.mjs
> what calls it
No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/e.mjs)
> which modules import it
No modules found whose module directly imports it. (traversal: imports edges where object = Commit)
```

## gq-functions-call-fnalpha (graph-query) — judged mean 0.25 — documented baselineFail

```
> which functions call fnAlpha
No functions found whose module directly calls fnAlpha. (traversal: callsSymbol edges where object = fnAlpha)
```

## g-b1-disc-6 (graded) — judged mean 0.417 — documented baselineFail

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
> how many of those are tested
I can't count "of". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

## g-a2-naming-11 (graded) — judged mean 0.5

```
> /describe Widget.name
Widget.name — Attribute (id: a-name)
attribute: site = app/lib/b.mjs:2 [seon:startsAt]
edges:
  ← contains [seon:containsCodeEntity] (1) by Widget
```

## g-a2-naming-12 (graded) — judged mean 0.5

```
> /describe Base
Base — Class (id: cls-base)
attribute: site = app/lib/a.mjs:1-3 [seon:startsAt]
edges:
  ← inherits [seon:hasSuperType] (1) by Widget
```

## g-b1-disc-count-2 (graded) — judged mean 0.5 — documented baselineFail

```
> untested classes
Base and Button.
> how many of them are tested
I can't count "of". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

## g-b1-disc-count-24 (graded) — judged mean 0.5 — documented baselineFail

```
> which modules import app/lib/b.mjs
app/functions/d/handler.mjs.
> how many of those are tested
I can't count "of". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

## g-b1-pron-neg-22 (graded) — judged mean 0.5 — documented baselineFail

```
> /describe scripts/g.mjs
scripts/g.mjs — Module (id: mod-g)
edges:
  calls [mgx:callsCoarse] (1) → app/lib/a.mjs
> which modules don't import it
couldn't resolve one of the terms in this question.
```

## g-c1-assert-7 (graded) — judged mean 0.5 — documented baselineFail

```
--- session 1 ---
> every class is a type
noted — remembered 1 fact: class rdfs:subClassOf type
> every function is a helper
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
> what is a type
"type" isn't a term in this graph's own vocabulary (no matching class or predicate).
```

## g-b1-passive-23 (graded) — judged mean 0.555

```
> which symbols are defined by app/lib/c.mjs
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-b1-pron-11 (graded) — judged mean 0.556

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
> what tests cover it
no module matching "cover it" found in the index.
```

## g-b1-pron-neg-14 (graded) — judged mean 0.583 — documented baselineFail

```
> /describe app/lib/e.mjs
app/lib/e.mjs — Module (id: mod-e)
edges:
  imports [mgx:importsNamespace] (2) → app/lib/a.mjs, app/lib/f.mjs
  ← imports [mgx:importsNamespace] (1) by app/lib/f.mjs
> which tests don't cover it
no module matching "not cover it" found in the index.
```

## g-c2-rel-9 (graded) — judged mean 0.583 — documented baselineFail

```
> where is the method that calls fnAlpha defined
this could mean more than one thing: 1) where "the method that calls fnAlpha" or 2) calls "fnAlpha defined" — try rephrasing more specifically.
```

## g-b1-pron-17 (graded) — judged mean 0.667

```
> what does app/lib/c.mjs import
app/lib/a.mjs.
> what tests cover it
no module matching "cover it" found in the index.
```

## g-b2-assert-16 (graded) — judged mean 0.667 — documented baselineFail

```
--- session 1 ---
> every function is a unit
noted — remembered 1 fact: function rdfs:subClassOf unit
> is fnAlpha a unit
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-b2-assert-21 (graded) — judged mean 0.667 — documented baselineFail

```
--- session 1 ---
> every commit is a thing
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
> what is a thing
"thing" isn't a term in this graph's own vocabulary (no matching class or predicate).
```

## g-b2-assert-24 (graded) — judged mean 0.75 — documented baselineFail

```
--- session 1 ---
> every method is a type
noted — remembered 1 fact: method rdfs:subClassOf type
> is Widget.render a type
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-c1-rel-24 (graded) — judged mean 0.833

```
> which commit touched something that imports app/lib/a.mjs
nothing in the index matches that (commits).
```

## g-c1-temp-10 (graded) — judged mean 0.833 — documented baselineFail

```
> when did the module that defines register change
this could mean more than one thing: 1) touches "the module that defines register" or 2) defines "register change" — try rephrasing more specifically.
```

## g-c2-rel-22 (graded) — judged mean 0.889

```
> which commit touched the module that defines the class that Widget.render belongs to
couldn't compile this compositional question (inner clause didn't parse). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested".
```

## g-b1-pron-24 (graded) — judged mean 0.917 — documented baselineFail

```
> what does app/lib/f.mjs import
app/lib/e.mjs.
> who touched that
I answer questions about THIS codebase's structure — imports, calls, definitions,
history and counts. For example:
  which modules import walk.mjs
  what calls buildContextBundle
  how many classes are there
/help for commands, /stats for an overview of the graph.
```

## g-b2-assert-9 (graded) — judged mean 0.917 — documented baselineFail

```
--- session 1 ---
> every module is a type
noted — remembered 1 fact: module rdfs:subClassOf type
> is app/lib/a.mjs a type
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-a1-svo-12 (graded) — judged mean 1

```
> where is Base defined
Base is defined in app/lib/a.mjs at lines 1-3.
```

## g-b1-temp-2 (graded) — judged mean 1

```
> when did app/lib/a.mjs last change
app/lib/a.mjs was last touched by commit abc1234 on 2026-06-28 ("Render the widget with full mode").
```

## g-c1-temp-19 (graded) — judged mean 1

```
> who touched the module that imports app/lib/a.mjs
nothing in the index matches that.
```

## gq-when-changed-a (graph-query) — judged mean 1

```
> when did a.mjs change
app/lib/a.mjs was last touched by commit abc1234 on 2026-06-28 ("Render the widget with full mode").
```

## hm-unknown-fn (honesty-miss) — judged mean 1

```
> what calls nonExistentFn
no module matching "nonExistentFn" found in the index.
```

## hm-unknown-module (honesty-miss) — judged mean 1

```
> which modules import zebra.mjs
no symbol matching "zebra.mjs" found in the index.
```

## g-b1-disc-count-10 (graded) — judged mean 1.083 — documented baselineFail

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
> how many of them are tested
I can't count "of". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

## g-b1-pron-14 (graded) — judged mean 1.083 — documented baselineFail

```
> which modules import app/lib/e.mjs
app/lib/f.mjs.
> what does it import
app/lib/a.mjs and app/lib/f.mjs.
> who touched it
I answer questions about THIS codebase's structure — imports, calls, definitions,
history and counts. For example:
  which modules import walk.mjs
  what calls buildContextBundle
  how many classes are there
/help for commands, /stats for an overview of the graph.
```

## g-c2-pron-4 (graded) — judged mean 1.083 — documented baselineFail

```
> app/lib/e.mjs can't be deleted because app/lib/f.mjs still imports it — which of them is still imported
couldn't compile this compositional question (the follow-up filter didn't parse). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested".
```

## am-bare-name (ambiguity) — judged mean 1.167 — documented baselineFail

```
> Widget
I answer questions about THIS codebase's structure — imports, calls, definitions,
history and counts. For example:
  which modules import walk.mjs
  what calls buildContextBundle
  how many classes are there
/help for commands, /stats for an overview of the graph.
```

## g-b1-disc-count-4 (graded) — judged mean 1.167 — documented baselineFail

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
> how many of those are tested
I can't count "of". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

## g-b2-coord-6 (graded) — judged mean 1.167

```
> modules that import app/lib/b.mjs and import app/lib/e.mjs
nothing in the index matches that (modules).
```

## g-b2-rel-26 (graded) — judged mean 1.167

```
> who touched the module that defines register
nothing in the index matches that.
```

## g-c1-assert-3 (graded) — judged mean 1.167 — documented baselineFail

```
--- session 1 ---
> every class is a category
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
--- session 2 ---
> how many categorys are there
I can't count "categorys". I count: classes, functions, modules, methods, attributes, variables, commits, sessions. Try "how many classes are there".
```

## g-c1-coord-3 (graded) — judged mean 1.167

```
> modules importing app/lib/a.mjs and importing app/lib/c.mjs and tested
nothing in the index matches that (modules).
```

## g-c1-rel-15 (graded) — judged mean 1.167

```
> which tests cover something that imports something that imports app/lib/b.mjs
nothing in the index matches that.
```

## g-c1-rel-22 (graded) — judged mean 1.167

```
> which tests cover something that imports something that imports app/lib/c.mjs
nothing in the index matches that.
```

## gq-members-widget (graph-query) — judged mean 1.167

```
> /members Widget
Widget — Class (id: cls-widget)
methods (1): render [app/lib/b.mjs:5-9] @property
attributes (1): name [app/lib/b.mjs:2]
Use tmct_snippet <Class.member> for an exact body.
```

## hm-empty-result-calls (honesty-miss, graph-query) — judged mean 1.222

```
> what calls fnAlpha
No modules found whose module directly calls fnAlpha. (traversal: calls edges where object = fnAlpha)
```

## tf-fnalpah (typo-fuzzy) — judged mean 1.222

```
> what calls fnAlpah
assuming you meant fnAlpha: No modules found whose module directly calls fnAlpah. (traversal: calls edges where object = fnAlpha)
```

## g-a2-pron-11 (graded) — judged mean 1.278

```
> /describe Base
Base — Class (id: cls-base)
attribute: site = app/lib/a.mjs:1-3 [seon:startsAt]
edges:
  ← inherits [seon:hasSuperType] (1) by Widget
> what does it inherit from
Base has no inherits edges in the index. (traversal: inherits edges where subject = Base)
```

## g-c1-neg-rel-16 (graded) — judged mean 1.278

```
> modules importing something that imports app/lib/c.mjs but not tested
nothing in the index matches that (modules).
```

## g-c2-pron-2 (graded) — judged mean 1.306 — documented baselineFail

```
> Button inherits from Widget although it is defined in app/lib/b.mjs — which of them is defined in app/lib/b.mjs
couldn't compile this compositional question (the follow-up filter didn't parse). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested".
```

## g-a1-naming-14 (graded) — judged mean 1.333

```
> what is a Method
Method is a class in the graph's schema: A function defined inside a Class — an instance, static, or class method. Distinct from Function so class membership (seon:containsCodeEntity) and free functions never get confused.
```

## g-a1-svo-13 (graded) — judged mean 1.333

```
> who touched app/lib/c.mjs
No modules found whose module directly touches app/lib/c.mjs. (traversal: touches edges where object = app/lib/c.mjs)
```

## g-b1-disc-18 (graded) — judged mean 1.333 — documented baselineFail

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
> what about app/lib/c.mjs
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-b1-disc-count-20 (graded) — judged mean 1.333 — documented baselineFail

```
> which classes inherit from Base
in app/lib/b.mjs there is Widget.
> how many of those
I can't count "of". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

## g-b1-passive-15 (graded) — judged mean 1.333 — documented baselineFail

```
> Widget is inherited by which classes
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-b2-passive-11 (graded) — judged mean 1.333 — documented baselineFail

```
> Widget is defined by which module
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-b2-rel-45 (graded) — judged mean 1.333

```
> public methods in the module that defines Base
nothing in the index matches that.
```

## g-c1-coord-23 (graded) — judged mean 1.333

```
> untested classes inheriting from Base
nothing in the index matches that.
```

## g-c1-temp-23 (graded) — judged mean 1.333

```
> who touched the module that imports app/lib/b.mjs
nothing in the index matches that.
```

## g-c2-pron-15 (graded) — judged mean 1.333 — documented baselineFail

```
> app/lib/a.mjs can't be deleted because app/lib/b.mjs still imports it — which of them is still imported
couldn't compile this compositional question (the follow-up filter didn't parse). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested".
```

## g-c2-rel-25 (graded) — judged mean 1.333

```
> which classes are defined in the module that is covered by app/unit-tests/b.test.mjs and named app/functions/d/handler.mjs
nothing in the index matches that (classes).
```

## gq-describe-widget (graph-query) — judged mean 1.333

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

## g-b2-noise-pron-22 (graded) — judged mean 1.444

```
> /describe app/lib/e.mjs
app/lib/e.mjs — Module (id: mod-e)
edges:
  imports [mgx:importsNamespace] (2) → app/lib/a.mjs, app/lib/f.mjs
  ← imports [mgx:importsNamespace] (1) by app/lib/f.mjs
> i was wondering who touched it
No modules found whose module directly touches it. (traversal: touches edges where object = app/lib/e.mjs)
```

## g-c1-rel-2 (graded) — judged mean 1.444

```
> what imports something that imports something that imports app/functions/d/handler.mjs
nothing in the index matches that.
```

## g-a1-svo-10 (graded) — judged mean 1.445

```
> who touched app/lib/b.mjs
No modules found whose module directly touches app/lib/b.mjs. (traversal: touches edges where object = app/lib/b.mjs)
```

## am-meta-imports (ambiguity) — judged mean 1.5

```
> what does imports mean
this could mean more than one thing: 1) meta "imports" or 2) imports "mean" — try rephrasing more specifically.
```

## g-a1-naming-10 (graded) — judged mean 1.5

```
> what is an Attribute
Attribute is a class in the graph's schema: A field or property belonging to a Class — either a class-level assignment or a self-scoped instance field seen in a method body (self.<name> =). Distinct from a module-level GlobalVariable.
```

## g-a2-count-12 (graded) — judged mean 1.5

```
> list methods in app/lib/c.mjs
no methods in this index.
```

## g-c1-assert-21 (graded) — judged mean 1.5 — documented baselineFail

```
--- session 1 ---
> every module is a artifact
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
--- session 2 ---
> how many artifacts are there
I can't count "artifacts". I count: classes, functions, modules, methods, attributes, variables, commits, sessions. Try "how many classes are there".
```

## gq-who-touched-a (graph-query) — judged mean 1.5

```
> who touched a.mjs
abc1234.
```

## mr-graph-intact (memory-recall) — judged mean 1.5

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

## mt-ask-then-touched (multi-turn-focus) — judged mean 1.5

```
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
> who touched it
abc1234.
```

## mt-focus-members (multi-turn-focus) — judged mean 1.5

```
> /focus Widget
focus set to Widget.
> /members
Widget — Class (id: cls-widget)
methods (1): render [app/lib/b.mjs:5-9] @property
attributes (1): name [app/lib/b.mjs:2]
Use tmct_snippet <Class.member> for an exact body.
```

## g-a2-svo-12 (graded) — judged mean 1.555

```
> what tests touch app/lib/a.mjs
No modules found whose module directly tests touch app/lib/a.mjs. (traversal: tests edges where object = app/lib/a.mjs)
```

## am-two-readings (ambiguity) — judged mean 1.667

```
> which classes extends Base and couples to app/lib/b.mjs
this could mean more than one thing: 1) classes that inherits "Base and couples to app/lib/b.mjs" or 2) imports "app/lib/b.mjs" — try rephrasing more specifically.
```

## be-honest-empty (bootstrap-empty) — judged mean 1.667

```
--- session 1 ---
> which modules import a.mjs
the graph at <repo>/.tmct/graph.json is empty — no entities to answer from yet (this repo starts with no graph; the chat session folds the conversation into one).
> how many modules are there
0 modules.
```

## conv-what-can-you-do (conversational) — judged mean 1.667

```
> what can you do
I answer questions about THIS codebase's structure — imports, calls, definitions,
history and counts. For example:
  which modules import walk.mjs
  what calls buildContextBundle
  how many classes are there
/help for commands, /stats for an overview of the graph.
```

## g-a1-naming-11 (graded) — judged mean 1.667

```
> what does touchesSymbol mean
touchesSymbol is a predicate (relation) in the graph's schema: Commit → Function/Method/Class/Attribute. A commit's changed-line-range intersected with a symbol's current source span — WHICH specific function or class a commit actually edited, not just which file it touched.
```

## g-a1-naming-15 (graded) — judged mean 1.667

```
> what does GlobalVariable mean
GlobalVariable is a class in the graph's schema: A module-level variable or constant assignment that belongs to no Class or function — a name defined directly in a Module's top-level scope.
```

## g-b1-temp-25 (graded) — judged mean 1.667

```
> when did Base change
no recorded commit touches Base in this index. (traversal: touches+touchesSymbol edges where object = Base, newest commit date first)
```

## g-b2-passive-24 (graded) — judged mean 1.667

```
> Button is inherited by which classes
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-c1-neg-rel-25 (graded) — judged mean 1.667

```
> untested modules that import the module that defines register
nothing in the index matches that.
```

## g-c1-temp-17 (graded) — judged mean 1.667

```
> what was the last change to app/lib/b.mjs
No modules found whose module directly touches app/lib/b.mjs. (traversal: touches edges where object = app/lib/b.mjs)
```

## g-b1-temp-11 (graded) — judged mean 1.778

```
> when did app/lib/c.mjs change
no recorded commit touches app/lib/c.mjs in this index. (traversal: touches+touchesSymbol edges where object = app/lib/c.mjs, newest commit date first)
```

## g-b1-temp-3 (graded) — judged mean 1.778

```
> when did app/unit-tests/b.test.mjs change
no recorded commit touches app/unit-tests/b.test.mjs in this index. (traversal: touches+touchesSymbol edges where object = app/unit-tests/b.test.mjs, newest commit date first)
```

## g-b2-noise-pron-19 (graded) — judged mean 1.778

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
> so what does it import
app/lib/a.mjs has no imports edges in the index. (traversal: imports edges where subject = app/lib/a.mjs)
```

## g-b2-noise-pron-5 (graded) — judged mean 1.778

```
> /describe app/lib/f.mjs
app/lib/f.mjs — Module (id: mod-f)
edges:
  imports [mgx:importsNamespace] (1) → app/lib/e.mjs
  ← imports [mgx:importsNamespace] (1) by app/lib/e.mjs
> could you tell me what it defines
app/lib/f.mjs has no defines edges in the index. (traversal: defines edges where subject = app/lib/f.mjs)
```

## am-tests-cover (ambiguity) — judged mean 1.833

```
> which tests cover b.mjs
"cover b.mjs" matches more than one module ambiguously — please narrow the term.
```

## g-a1-naming-12 (graded) — judged mean 1.833

```
> what does Commit mean
Commit is a class in the graph's schema: A single recorded git commit. Carries author/date/message attributes and connects to the Modules it touched (mgx:touchedByCommit) and, more precisely, the specific symbols whose current source span its changed lines intersect (mgx:touchesSymbol).
```

## g-a2-naming-10 (graded) — judged mean 1.833

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
```

## g-a2-noise-svo-1 (graded) — judged mean 1.833

```
> could you tell me which classes inherit from Base
in app/lib/b.mjs there is Widget.
```

## g-a2-noise-svo-11 (graded) — judged mean 1.833

```
> hey tmct, which classes inherit from Base thanks
in app/lib/b.mjs there is Widget.
```

## g-b2-rel-30 (graded) — judged mean 1.833

```
> public methods in the module that defines Widget
Widget.render().
```

## gq-inherit-from-base (graph-query) — judged mean 1.833

```
> which classes inherit from Base
in app/lib/b.mjs there is Widget.
```

## g-b2-passive-23 (graded) — judged mean 1.889

```
> which symbols are re-exported by app/lib/a.mjs
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## be-greet-stats (bootstrap-empty) — judged mean 2

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

## conv-bye (conversational) — judged mean 2

```
> bye
Bye — flushing the session log. Come back with a question any time.
```

## conv-hello-there (conversational) — judged mean 2

```
> hello there
Hello there. (A hollow voice says, "fool.") Ask me about this codebase, or /help.
```

## conv-hi (conversational) — judged mean 2

```
> hi
Hi. Ask me about this codebase — imports, calls, definitions, history — or /help.
```

## conv-thanks (conversational) — judged mean 2

```
> thanks
Any time. Ask another, or /help for what I can do.
```

## conv-why-empty (conversational) — judged mean 2

```
> why
No previous answer to expand yet — ask me a question first, then say "why" or "say more".
```

## g-a1-count-1 (graded) — judged mean 2

```
> how many commits
1 commit.
```

## g-a1-count-10 (graded) — judged mean 2

```
> how many commits are there in this graph
1 commit.
```

## g-a1-count-11 (graded) — judged mean 2

```
> how many commits are there
1 commit.
```

## g-a1-count-12 (graded) — judged mean 2

```
> how many modules
8 modules.
```

## g-a1-count-13 (graded) — judged mean 2

```
> how many methods
1 method.
```

## g-a1-svo-1 (graded) — judged mean 2

```
> what imports app/lib/e.mjs
app/lib/f.mjs.
```

## g-a1-svo-11 (graded) — judged mean 2

```
> what does app/unit-tests/b.test.mjs define
app/unit-tests/b.test.mjs has no defines edges in the index. (traversal: defines edges where subject = app/unit-tests/b.test.mjs)
```

## g-a2-count-1 (graded) — judged mean 2

```
> which module has the most tests
app/lib/b.mjs and app/functions/d/handler.mjs — the most tests (1) (2-way tie).
```

## g-a2-count-11 (graded) — judged mean 2

```
> how many methods does Widget have
1 method.
```

## g-a2-count-13 (graded) — judged mean 2

```
> list functions in app/lib/a.mjs
fnAlpha().
```

## g-a2-count-15 (graded) — judged mean 2

```
> how many functions does app/lib/a.mjs define
1 function.
```

## g-a2-neg-10 (graded) — judged mean 2

```
> modules importing app/lib/f.mjs but untested
app/lib/e.mjs.
```

## g-a2-neg-12 (graded) — judged mean 2

```
> modules importing app/lib/e.mjs but not tested
app/lib/f.mjs.
```

## g-a2-neg-13 (graded) — judged mean 2

```
> uncovered modules
app/lib/a.mjs, app/lib/c.mjs, app/lib/e.mjs, app/lib/f.mjs, scripts/g.mjs and app/unit-tests/b.test.mjs.
```

## g-a2-neg-15 (graded) — judged mean 2

```
> uncovered functions
fnAlpha().
```

## g-a2-neg-17 (graded) — judged mean 2

```
> classes inheriting from Widget but not tested
Button.
```

## g-a2-noise-svo-10 (graded) — judged mean 2

```
> could you tell me how many classes are there
3 classes.
```

## g-a2-noise-svo-12 (graded) — judged mean 2

```
> i was wondering what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
```

## g-a2-noise-svo-13 (graded) — judged mean 2

```
> um where is fnAlpha defined please
function fnAlpha() is defined in app/lib/a.mjs at line 12.
```

## g-a2-pron-1 (graded) — judged mean 2

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
> what does it import
app/lib/a.mjs and app/lib/f.mjs.
```

## g-a2-pron-10 (graded) — judged mean 2

```
> which modules import app/lib/b.mjs
app/functions/d/handler.mjs.
> what does it import
app/lib/a.mjs.
```

## g-a2-pron-12 (graded) — judged mean 2

```
> /describe app/lib/b.mjs
app/lib/b.mjs — Module (id: mod-b)
attestation: touched by 1 commit(s)
edges:
  imports [mgx:importsNamespace] (1) → app/lib/a.mjs
  defines [seon:declaresMethod] (2) → Widget, register
  ← imports [mgx:importsNamespace] (1) by app/functions/d/handler.mjs
  ← tests [mgx:testsCoverage] (1) by app/unit-tests/b.test.mjs
  ← cochange [mgx:changeCoupledWith] (1) by app/lib/a.mjs
provenance: git:abc1234
> which modules import it
app/functions/d/handler.mjs.
```

## g-a2-pron-13 (graded) — judged mean 2

```
> /describe app/lib/e.mjs
app/lib/e.mjs — Module (id: mod-e)
edges:
  imports [mgx:importsNamespace] (2) → app/lib/a.mjs, app/lib/f.mjs
  ← imports [mgx:importsNamespace] (1) by app/lib/f.mjs
> what does it define
app/lib/e.mjs has no defines edges in the index. (traversal: defines edges where subject = app/lib/e.mjs)
```

## g-a2-svo-1 (graded) — judged mean 2

```
> what did commit abc1234 touch
commit abc1234 touched module app/lib/a.mjs; method Widget.render().
```

## g-a2-svo-10 (graded) — judged mean 2

```
> what uses app/lib/e.mjs
app/lib/f.mjs.
```

## g-a2-svo-11 (graded) — judged mean 2

```
> what tests touch app/lib/f.mjs
No modules found whose module directly tests touch app/lib/f.mjs. (traversal: tests edges where object = app/lib/f.mjs)
```

## g-a2-svo-13 (graded) — judged mean 2

```
> what tests touch app/functions/d/handler.mjs
app/unit-tests/b.test.mjs.
```

## g-b1-disc-25 (graded) — judged mean 2

```
> which modules import app/lib/a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
> why
(expanding: which modules import app/lib/a.mjs)
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
traversal: imports edges where object = app/lib/a.mjs
matches (3):
  app/lib/b.mjs [Module] — app/lib/b.mjs
  app/lib/c.mjs [Module] — app/lib/c.mjs
  app/lib/e.mjs [Module] — app/lib/e.mjs
```

## g-b1-pron-19 (graded) — judged mean 2

```
> what does app/lib/a.mjs import
app/lib/a.mjs has no imports edges in the index. (traversal: imports edges where subject = app/lib/a.mjs)
> who touched that
abc1234.
```

## g-b1-temp-14 (graded) — judged mean 2

```
> what did commit abc1234 touch
commit abc1234 touched module app/lib/a.mjs; method Widget.render().
```

## g-b2-coord-22 (graded) — judged mean 2

```
> modules importing app/lib/c.mjs or app/lib/e.mjs
app/functions/d/handler.mjs and app/lib/f.mjs.
```

## g-b2-coord-23 (graded) — judged mean 2

```
> modules importing app/lib/a.mjs or app/lib/f.mjs
app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.
```

## g-b2-coord-32 (graded) — judged mean 2

```
> modules that import app/lib/a.mjs and import app/lib/f.mjs
app/lib/e.mjs.
```

## g-b2-noise-pron-16 (graded) — judged mean 2

```
> /describe app/lib/c.mjs
app/lib/c.mjs — Module (id: mod-c)
edges:
  imports [mgx:importsNamespace] (1) → app/lib/a.mjs
  ← imports [mgx:importsNamespace] (1) by app/functions/d/handler.mjs
  ← cochange [mgx:changeCoupledWith] (1) by app/lib/a.mjs
> um so what does it import then
app/lib/a.mjs.
```

## g-b2-noise-pron-4 (graded) — judged mean 2

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
> i was wondering who touched it
abc1234.
```

## g-b2-rel-19 (graded) — judged mean 2

```
> which tests cover the module that defines register
app/unit-tests/b.test.mjs.
```

## g-b2-rel-31 (graded) — judged mean 2

```
> what uses the module that defines Widget
app/functions/d/handler.mjs.
```

## g-c1-assert-6 (graded) — judged mean 2 — documented baselineFail

```
--- session 1 ---
> every module is a artifact
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
--- session 2 ---
> what facts do you know
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## g-c1-coord-25 (graded) — judged mean 2

```
> modules that import app/lib/a.mjs but do not import app/lib/b.mjs
app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.
```

## g-c1-neg-rel-24 (graded) — judged mean 2

```
> modules importing something that imports app/lib/f.mjs but not tested
app/lib/f.mjs.
```

## g-c1-neg-rel-7 (graded) — judged mean 2

```
> modules that import app/lib/a.mjs but don't import app/lib/b.mjs
app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.
```

## gq-count-classes (graph-query) — judged mean 2

```
> how many classes are there
3 classes.
```

## gq-impact-a (graph-query) — judged mean 2

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

## gq-imports-by-e (graph-query) — judged mean 2

```
> what does app/lib/e.mjs import
app/lib/a.mjs and app/lib/f.mjs.
```

## gq-imports-of-a (graph-query) — judged mean 2

```
> which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

## gq-public-methods-widget (graph-query) — judged mean 2

```
> public methods of Widget
Widget.render().
```

## gq-subclasses-base (graph-query) — judged mean 2

```
> /subclasses Base
Base — Class (id: cls-base)
extends: (no internal/recorded base classes)
subclasses: 2 total across 2 level(s).
  depth 1 (1): Widget
  depth 2 (1): Button
```

## gq-tests-for-b (graph-query) — judged mean 2

```
> what tests touch app/lib/b.mjs
app/unit-tests/b.test.mjs.
```

## gq-where-defined-fnalpha (graph-query) — judged mean 2

```
> where is fnAlpha defined
function fnAlpha() is defined in app/lib/a.mjs at line 12.
```

## hm-count-bananas (honesty-miss) — judged mean 2

```
> how many bananas are there
I can't count "bananas". I count: classes, functions, modules, methods, attributes, variables, commits. Try "how many classes are there".
```

## hm-joke (honesty-miss) — judged mean 2

```
> tell me a joke
couldn't parse this as a graph question. Try: "which <functions|classes|modules> <imports|calls|uses|inherits from|tests|touched> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", or (after a listing) "which of those are tested"
```

## mt-describe-then-callers (multi-turn-focus) — judged mean 2

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

## mt-why-expand (multi-turn-focus) — judged mean 2

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

## ns-could-you (noise) — judged mean 2

```
> could you tell me which modules import a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

## ns-so-uh-count (noise) — judged mean 2

```
> so, uh, how many classes are there then
3 classes.
```

## ns-um-hey (noise) — judged mean 2

```
> um hey so like which modules import a.mjs please
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```

## tf-whcih-imprt (typo-fuzzy) — judged mean 2

```
> whcih modules imprt a.mjs
app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```
