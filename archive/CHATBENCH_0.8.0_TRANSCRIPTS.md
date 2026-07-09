# CHATBENCH_0.8.0 — transcript appendix (discriminating cases first)

Every case below is a full-coverage Part-1 replay: the SAME turns run through 0.7.1 and 0.8.0,
so the behaviour change is visible line-for-line. `_(via …)_` is the answering turn's provenance
(`composed` = the productive band). Source: `run-0.7.1/product-a.jsonl` vs
`run-0.8.0/families/product.jsonl`.


## Pronoun/focus lever — flipped to passing

### g-b1-pron-6

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: /describe app/lib/c.mjs
  - tmct: app/lib/c.mjs — Module (id: mod-c) ⏎ edges: ⏎   imports [mgx:importsNamespace] (1) → app/lib/a.mjs ⏎   ← imports [mgx:importsNamespace] (1) by app/functions/d/handler.mjs ⏎   ← cochange [mgx:changeCoupledWith] (1) by app/lib/a.mjs _(via command)_
- visitor: what calls it
  - tmct: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/c.mjs) _(via composed)_
- visitor: which modules import it
  - tmct: No modules found whose module directly imports it. (traversal: imports edges where object = Commit) _(via composed)_

**0.8.0** (tier1.pass=true, improved=[2]):

- visitor: /describe app/lib/c.mjs
  - tmct: app/lib/c.mjs — Module (id: mod-c) ⏎ edges: ⏎   imports [mgx:importsNamespace] (1) → app/lib/a.mjs ⏎   ← imports [mgx:importsNamespace] (1) by app/functions/d/handler.mjs ⏎   ← cochange [mgx:changeCoupledWith] (1) by app/lib/a.mjs _(via command)_
- visitor: what calls it
  - tmct: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/c.mjs) _(via composed)_
- visitor: which modules import it
  - tmct: app/functions/d/handler.mjs. _(via composed)_

### g-b1-pron-15

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: which modules import app/lib/a.mjs
  - tmct: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs. _(via composed)_
- visitor: what does it import
  - tmct: app/lib/a.mjs has no imports edges in the index. (traversal: imports edges where subject = app/lib/a.mjs) _(via composed)_
- visitor: who touched it
  - tmct: I answer questions about THIS codebase's structure — imports, calls, definitions, ⏎ history and counts. For example: ⏎   which modules import walk.mjs ⏎   what calls buildContextBundle ⏎   how many classes are there ⏎ /help for commands, /stats for an overview of the graph. _(via template)_

**0.8.0** (tier1.pass=true, improved=[2]):

- visitor: which modules import app/lib/a.mjs
  - tmct: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs. _(via composed)_
- visitor: what does it import
  - tmct: app/lib/a.mjs has no imports edges in the index. (traversal: imports edges where subject = app/lib/a.mjs) _(via composed)_
- visitor: who touched it
  - tmct: abc1234. _(via composed)_

### g-b1-pron-25

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: /describe app/lib/e.mjs
  - tmct: app/lib/e.mjs — Module (id: mod-e) ⏎ edges: ⏎   imports [mgx:importsNamespace] (2) → app/lib/a.mjs, app/lib/f.mjs ⏎   ← imports [mgx:importsNamespace] (1) by app/lib/f.mjs _(via command)_
- visitor: what calls it
  - tmct: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/e.mjs) _(via composed)_
- visitor: which modules import it
  - tmct: No modules found whose module directly imports it. (traversal: imports edges where object = Commit) _(via composed)_

**0.8.0** (tier1.pass=true, improved=[2]):

- visitor: /describe app/lib/e.mjs
  - tmct: app/lib/e.mjs — Module (id: mod-e) ⏎ edges: ⏎   imports [mgx:importsNamespace] (2) → app/lib/a.mjs, app/lib/f.mjs ⏎   ← imports [mgx:importsNamespace] (1) by app/lib/f.mjs _(via command)_
- visitor: what calls it
  - tmct: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/e.mjs) _(via composed)_
- visitor: which modules import it
  - tmct: app/lib/f.mjs. _(via composed)_

### g-b1-pron-39

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: /describe app/lib/b.mjs
  - tmct: app/lib/b.mjs — Module (id: mod-b) ⏎ attestation: touched by 1 commit(s) ⏎ edges: ⏎   imports [mgx:importsNamespace] (1) → app/lib/a.mjs ⏎   defines [seon:declaresMethod] (2) → Widget, register ⏎   ← imports [mgx:importsNamespace] (1) by app/functions/d/handler.mjs ⏎   ← tests [mgx:testsCoverage] (1) by app/unit-tests/b.test.mjs ⏎   ← cochange [mgx:changeCoupledWith] (1) by app/lib/a.mjs ⏎ provenance: git:abc1234 _(via command)_
- visitor: what calls it
  - tmct: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/b.mjs) _(via composed)_
- visitor: which modules import it
  - tmct: No modules found whose module directly imports it. (traversal: imports edges where object = Commit) _(via composed)_

**0.8.0** (tier1.pass=true, improved=[2]):

- visitor: /describe app/lib/b.mjs
  - tmct: app/lib/b.mjs — Module (id: mod-b) ⏎ attestation: touched by 1 commit(s) ⏎ edges: ⏎   imports [mgx:importsNamespace] (1) → app/lib/a.mjs ⏎   defines [seon:declaresMethod] (2) → Widget, register ⏎   ← imports [mgx:importsNamespace] (1) by app/functions/d/handler.mjs ⏎   ← tests [mgx:testsCoverage] (1) by app/unit-tests/b.test.mjs ⏎   ← cochange [mgx:changeCoupledWith] (1) by app/lib/a.mjs ⏎ provenance: git:abc1234 _(via command)_
- visitor: what calls it
  - tmct: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/b.mjs) _(via composed)_
- visitor: which modules import it
  - tmct: app/functions/d/handler.mjs. _(via composed)_

### g-b1-pron-44

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: /describe app/lib/f.mjs
  - tmct: app/lib/f.mjs — Module (id: mod-f) ⏎ edges: ⏎   imports [mgx:importsNamespace] (1) → app/lib/e.mjs ⏎   ← imports [mgx:importsNamespace] (1) by app/lib/e.mjs _(via command)_
- visitor: what calls it
  - tmct: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/f.mjs) _(via composed)_
- visitor: which modules import it
  - tmct: No modules found whose module directly imports it. (traversal: imports edges where object = Commit) _(via composed)_

**0.8.0** (tier1.pass=true, improved=[2]):

- visitor: /describe app/lib/f.mjs
  - tmct: app/lib/f.mjs — Module (id: mod-f) ⏎ edges: ⏎   imports [mgx:importsNamespace] (1) → app/lib/e.mjs ⏎   ← imports [mgx:importsNamespace] (1) by app/lib/e.mjs _(via command)_
- visitor: what calls it
  - tmct: No modules found whose module directly calls it. (traversal: calls edges where object = app/lib/f.mjs) _(via composed)_
- visitor: which modules import it
  - tmct: app/lib/e.mjs. _(via composed)_


## Discourse-count lever — 0.7.1 tier-1 misses now cleared

### g-b1-disc-count-22

**0.7.1** (tier1.pass=false, improved=[]):

- visitor: untested classes
  - tmct: 5 source module(s) with no covering test module: ⏎   app/lib/a.mjs ⏎   app/lib/c.mjs ⏎   app/lib/e.mjs ⏎   app/lib/f.mjs ⏎   scripts/g.mjs _(via command)_
- visitor: count them
  - tmct: I answer questions about THIS codebase's structure — imports, calls, definitions, ⏎ history and counts. For example: ⏎   which modules import walk.mjs ⏎   what calls buildContextBundle ⏎   how many classes are there ⏎ /help for commands, /stats for an overview of the graph. _(via template)_

**0.8.0** (tier1.pass=true, improved=[]):

- visitor: untested classes
  - tmct: Base and Button. _(via composed)_
- visitor: count them
  - tmct: 2 classes. _(via composed)_

### g-b1-disc-count-3

**0.7.1** (tier1.pass=false, improved=[]):

- visitor: untested classes
  - tmct: 5 source module(s) with no covering test module: ⏎   app/lib/a.mjs ⏎   app/lib/c.mjs ⏎   app/lib/e.mjs ⏎   app/lib/f.mjs ⏎   scripts/g.mjs _(via command)_
- visitor: how many of those are tested
  - tmct: "those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[]):

- visitor: untested classes
  - tmct: Base and Button. _(via composed)_
- visitor: how many of those are tested
  - tmct: 0 results. _(via composed)_


## C1 temporal lever — two-hop now assembles

### g-c1-temp-9

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: when did the module that defines fnAlpha change
  - tmct: this could mean more than one thing: 1) touches "the module that defines fnAlpha" or 2) defines "fnAlpha change" — try rephrasing more specifically. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[0]):

- visitor: when did the module that defines fnAlpha change
  - tmct: the module in that set was last touched by commit abc1234 on 2026-06-28 ("Render the widget with full mode"). _(via composed)_

### g-c1-temp-18

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: when did the module that imports app/lib/f.mjs change
  - tmct: this could mean more than one thing: 1) touches "the module that imports app/lib/f.mjs" or 2) imports "app/lib/f.mjs change" — try rephrasing more specifically. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[0]):

- visitor: when did the module that imports app/lib/f.mjs change
  - tmct: no recorded commit touched the 1 module in that set in this index. _(via composed)_

### g-c1-temp-20

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: when did the module that defines register change
  - tmct: this could mean more than one thing: 1) touches "the module that defines register" or 2) defines "register change" — try rephrasing more specifically. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[0]):

- visitor: when did the module that defines register change
  - tmct: no recorded commit touched the 1 module in that set in this index. _(via composed)_

### g-c1-temp-22

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: when did the module that imports app/lib/b.mjs change
  - tmct: this could mean more than one thing: 1) touches "the module that imports app/lib/b.mjs" or 2) imports "app/lib/b.mjs change" — try rephrasing more specifically. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[0]):

- visitor: when did the module that imports app/lib/b.mjs change
  - tmct: no recorded commit touched the 1 module in that set in this index. _(via composed)_

### g-c1-temp-35

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: when did the module that imports app/lib/c.mjs change
  - tmct: this could mean more than one thing: 1) touches "the module that imports app/lib/c.mjs" or 2) imports "app/lib/c.mjs change" — try rephrasing more specifically. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[0]):

- visitor: when did the module that imports app/lib/c.mjs change
  - tmct: no recorded commit touched the 1 module in that set in this index. _(via composed)_

### g-c1-temp-45

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: when did the module that imports app/lib/a.mjs change
  - tmct: this could mean more than one thing: 1) touches "the module that imports app/lib/a.mjs" or 2) imports "app/lib/a.mjs change" — try rephrasing more specifically. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[0]):

- visitor: when did the module that imports app/lib/a.mjs change
  - tmct: no recorded commit touched the 3 modules in that set in this index. _(via composed)_

### g-c1-temp-50

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: when did the module that defines Widget change
  - tmct: this could mean more than one thing: 1) touches "the module that defines Widget" or 2) defines "Widget change" — try rephrasing more specifically. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[0]):

- visitor: when did the module that defines Widget change
  - tmct: no recorded commit touched the 1 module in that set in this index. _(via composed)_


## C1 temporal — composition-works / data-absent (honest miss on thin fixture)

### g-c1-temp-31

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: who touched the module that imports app/lib/f.mjs
  - tmct: nothing in the index matches that. _(via composed)_

**0.8.0** (tier1.pass=true, improved=[]):

- visitor: who touched the module that imports app/lib/f.mjs
  - tmct: nothing in the index matches that. _(via composed)_


## B1 temporal — control (not a lever target, unchanged)

### g-b1-temp-1

**0.7.1** (tier1.pass=true, improved=[]):

- visitor: which modules changed together with app/lib/f.mjs
  - tmct: No modules found whose module directly touches together with app/lib/f.mjs. (traversal: touches edges where object = app/lib/f.mjs) _(via composed)_

**0.8.0** (tier1.pass=true, improved=[]):

- visitor: which modules changed together with app/lib/f.mjs
  - tmct: No modules found whose module directly touches together with app/lib/f.mjs. (traversal: touches edges where object = app/lib/f.mjs) _(via composed)_

