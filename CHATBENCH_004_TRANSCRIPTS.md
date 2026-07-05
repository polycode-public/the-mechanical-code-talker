# CHATBENCH_004 — transcript appendix (discriminating transcripts first)

Verbatim product output from `chatbench/results/raw/run-cycle-004/product-a.jsonl`. These are the
cases where cycle-4 differs from cycle-3 — the levers and the Meta-1 re-float made visible.

## The B1 levers (new machinery, previously the cliff)

### g-b1-neg-23 — negation set complement (`via:composed`)
```
Q: classes that do not inherit from Base
A: Base and Button.
```
The engine now recognises the set-negation, builds `allOfClass(Class)` DIFFERENCE the positive
`inherits→Base` set, and returns the complement — where cycle-3 died on a leaked "not" term. Bounded
universe; honest-empty cases still miss honestly.

### g-b1-passive-6 — reversible-passive direction (`via:composed`)
```
Q: which modules are imported by app/unit-tests/b.test.mjs
A: app/unit-tests/b.test.mjs has no imports edges in the index.
   (traversal: imports edges where subject = app/unit-tests/b.test.mjs)
```
Passive "imported by X" now traverses forward from the agent (subject = the named module) instead of
backwards — an honest, specific result with its traversal receipt. Cycle-3 traversed the edge in the
wrong direction and produced a confused miss.

## The Meta-1 re-float (truthful output no longer scored as fabrication)

### gq-describe-widget — full symbol-grain detail (`via:command`), groundedness 1.00 → 2.00
```
Q: /describe Widget
A: Widget — Class (id: cls-widget)
   attribute: site = app/lib/b.mjs:1-30 [seon:startsAt]
   edges:
     contains [seon:containsCodeEntity] (2) → render, name
     inherits [seon:hasSuperType] (1) → Base
     ← defines [seon:declaresMethod] (1) by app/lib/b.mjs
     ← inherits [seon:hasSuperType] (1) by Button
   other matches: Widget.name (Attribute), Widget.render (Method)
```
Every id, site, and edge here is present verbatim in the fixture — the judge now has the enriched
context to confirm it, so the truthful answer scores 2 instead of being docked as fabrication.

### mr-asked-before — cross-session recall (`via:recall`), groundedness 0.67 → 2.00
```
[session 1]  Q: which modules import a.mjs
             A: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
[session 2]  Q: what did i ask before
             A: last time (session 019f3033, 2026-07-05) you asked: "which modules import a.mjs"
```
The recall frame cites a real session id + date; the enriched context now includes the session/memory
vocabulary, so the judge can verify the citation instead of penalising it.

## Provenance & assert-recall (new this cycle, chat surface)

### assert-then-recall (chat, `via:fact`)
```
Q: every function is a component        A: noted — remembered 1 fact: function rdfs:subClassOf component
Q: what is a component                  A: you told me: function is a kind of component (source: ace:chat:…)
```
The superclass side ("what is a Y") is now answerable after the assert — the read-back the Phase-4
wiring left open. An un-asserted term still misses honestly, byte-identical to the no-memory path.
