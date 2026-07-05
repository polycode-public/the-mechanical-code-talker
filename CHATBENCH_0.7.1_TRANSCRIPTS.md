# CHATBENCH_0.7.1 — transcript appendix

Verbatim product transcripts from `chatbench/results/raw/run-0.7.1/product-a.jsonl` (arm A). The
**discriminating** cases (the tier-1 misses and the hard-fail ceilings) lead; the best examples
follow. `¶` marks a line break inside an answer.

---

## Discriminating — the 2 tier-1 misses (discourse-count anaphora)

### `g-b1-disc-count-22` (via template) — tier-1 **FAIL**

```
Q: untested classes
A: 5 source module(s) with no covering test module:
     app/lib/a.mjs
     app/lib/c.mjs
     app/lib/e.mjs
     app/lib/f.mjs
     scripts/g.mjs
Q: count them
A: I answer questions about THIS codebase's structure — imports, calls, definitions,
   history and counts. For example:
     which modules import walk.mjs
     what calls buildContextBundle
     how many classes are there
   /help for commands, /stats for an overview of the graph.
```

The first turn is correct. The miss is turn 2: **"count them"** should count the previous answer's
five-item set (→ "5") but instead falls through to the grammar-wall help text. The discourse anaphora
over a just-produced listing isn't wired for the *count* form (it is for "which of those are tested").
`g-b1-disc-count-3` fails identically. **This one lever clears both tier-1 misses.**

---

## Discriminating — hard-fail ceilings

### `g-b1-pron-25` (via composed) — the pronoun mis-bind

```
Q: /describe app/lib/e.mjs
A: app/lib/e.mjs — Module (id: mod-e)
   edges:
     imports [mgx:importsNamespace] (2) → app/lib/a.mjs, app/lib/f.mjs
     ← imports [mgx:importsNamespace] (1) by app/lib/f.mjs
Q: what calls it
A: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/e.mjs)
Q: which modules import it
A: No modules found whose module directly imports it. (traversal: imports edges where object = Commit)
```

Turn 2 binds "it" correctly (`object = app/lib/e.mjs`). Turn 3 **mis-binds** — `object = Commit` — so
the anaphor jumped off the focus to an unrelated antecedent. Honestly-empty, but wrong; the fix is in
the multi-turn focus/antecedent resolution.

### `g-c1-temp-31` (via composed) — the C1 temporal-over-relative ceiling

```
Q: who touched the module that imports app/lib/f.mjs
A: nothing in the index matches that.
```

A two-hop composition — *find the module that imports f.mjs*, then *who touched it* — that the engine
doesn't assemble. The dominant hard-fail cluster (C1 temporal, ×10) is this shape.

---

## Best examples (mean 2.00)

### `gq-impact-a` (via command)

```
Q: /impact app/lib/a.mjs
A: Impact of changing app/lib/a.mjs (reverse closure over imports/calls edges, module- and function-level):
   total: 6 dependent(s) across 2 depth level(s) (lists capped for brevity).
   depth 1 (4 direct dependents):
     - app/lib/b.mjs (imports it) — tests: app/unit-tests/b.test.mjs
     - app/lib/c.mjs (imports it) — tests: none recorded
     - app/lib/e.mjs (imports it) — tests: none recorded
     - scripts/g.mjs (calls it) — tests: none recorded
   depth 2 (2):
     - app/functions/d/handler.mjs (imports it) — tests: app/unit-tests/b.test.mjs
     - app/lib/f.mjs (imports it) — …
```

### `gq-count-classes` (via count)

```
Q: how many classes are there
A: 3 classes.
```

### `am-tests-cover` (via composed) — honest ambiguity

```
Q: which tests cover b.mjs
A: "cover b.mjs" matches more than one module ambiguously — please narrow the term.
```

### `conv-why-empty` (via template) — a guiding non-answer

```
Q: why
A: No previous answer to expand yet — ask me a question first, then say "why" or "say more".
```
