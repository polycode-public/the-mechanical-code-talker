tmct playtest 002 — modal negation in set-complement queries
============================================================

Version under test: 2.0.0 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, against the shipped example graph):
```bash
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo examples/mini-webapp --ephemeral
```

Area: negation — the set-complement query ("which modules do not import X")
across the ways English writes the negative. The tensed auxiliaries all pass.
The modals do not, and one of them answers with the exact opposite set.

Axes explored this iteration: negation, over the auxiliary that carries it.
Axes still untouched: quantifiers, inference depth, teach-side variation,
anaphora, multi-word terms, the teach/query boundary.


test: which modules cannot import store.mjs
===========================================

Expectations
------------

Given the shipped `examples/mini-webapp` graph, where exactly two modules
import store.mjs:

```log
tmct> which modules import store.mjs
src/handlers/tasks.mjs and src/handlers/users.mjs.
```

When the following prompts were entered:
```log
tmct> which modules do not import store.mjs
tmct> which modules cannot import store.mjs
tmct> which modules can't import store.mjs
```

Expected: all three name the same complement — the ten modules that do not
import store.mjs.

Actual: only the first does. "cannot" returns the two modules that DO import
store.mjs — the exact inverse of the question, stated with full confidence and
no hedge. "can't" and the other modals miss instead, reporting the modal itself
as an unresolvable subject.

Result
------

Fail. The inverted answer is the serious half: a miss is visible to the reader,
whereas "which modules cannot import store.mjs" answering with the importers is
indistinguishable from a correct answer unless you already know the graph. The
negation is dropped silently and a later strategy reads the leftover modal as
filler, leaving a plain positive reverse-import query behind.

Play test session log
---------------------

```txt
tmct — starting…
tmct chat — examples/mini-webapp — 12 module(s)
ask a question, or /help for commands (/stats for an overview) — /exit to leave
tmct> which modules do not import store.mjs
src/core/model.mjs, src/core/store.mjs, src/core/validate.mjs, src/lib/logger.mjs,
src/lib/http.mjs, src/handlers/base.mjs, src/server/router.mjs, src/server/app.mjs,
test/tasks.test.mjs and test/store.test.mjs.
Canonical: a compositional query (boolean) — composite(boolean)

tmct> which modules cannot import store.mjs
src/handlers/tasks.mjs and src/handlers/users.mjs.
Canonical: modules that imports "store.mjs" — reverse(imports, entityType=Module, "store.mjs")

tmct> which modules can't import store.mjs
couldn't resolve one of the terms in this question.
Canonical: does "can't" imports "store.mjs"? — ask(imports, subject="can't", "store.mjs")
```

The `Canonical:` line on turn 2 is the whole diagnosis: no complement, no
negation, just the positive reverse query.

Fix
---

`src/domain/interpret/normalize.mjs` — the set-complement matcher
(`NEGATION_SET_RE`) accepted only the tensed auxiliaries (`do|does|did|are|is|
was|were|have|has`) before `not`. It now also accepts the modals (`can|could|
will|would|should`) and the fused negatives (`cannot`, `can't`, `won't`,
`couldn't`, `shouldn't`, `wouldn't`). The complement machinery behind it
(`parseNegation` in `src/domain/ask.mjs`) already did the right thing once the
shape was recognized, so nothing downstream changed.

The graph records only what IS, so a modal negation has one answerable reading:
the same factual complement "do not" asks for. That reading is written down at
the matcher.

The first attempt put the fused forms in the shared `CONTRACTIONS` table
instead, expanding "cannot" to "can not" for every surface. That table also
feeds the teach lane, and it diverted "penguin cannot fly" — a negative
capability teach — past its grounding gate, so an unknown subject was stored
instead of drawing the "I don't know penguin yet" hint, and the hint for a
genuinely unknown subject degraded to a generic decline. The corpus test
`inference-ungrounded-negative-capability-hint-keeps-the-sentence-polarity`
caught it. Matching the fused forms in the query-side matcher alone leaves the
teach lane byte-identical.

Regression test: `test/corpus/grammar.jsonl` —
`grammar/negation-modal-forms-compute-the-complement-not-its-inverse` asserts
the modal forms compute the complement and, separately, that the answer lacks
the two real importers, which is the guard against the inversion coming back.

Retest
------

Same probe, plus the remaining modal forms and the positive control:

```log
tmct> which modules do not import store.mjs
tmct> which modules cannot import store.mjs
tmct> which modules can't import store.mjs
tmct> which modules won't import store.mjs
tmct> which modules can not import store.mjs
tmct> modules not importing store.mjs
tmct> which modules import store.mjs
```

Retest result
-------------

Pass. Every negated form returns the same ten-module complement; the positive
control still returns the two importers; the gerund form ("modules not
importing store.mjs") is unchanged. `npm test` 2445 pass / 0 fail, and
`printf 'hi\n/exit\n' | node bin/tmct.mjs` greets and exits 0.

Retest session log
------------------

```txt
tmct> which modules do not import store.mjs
src/core/model.mjs, src/core/store.mjs, src/core/validate.mjs, src/lib/logger.mjs,
src/lib/http.mjs, src/handlers/base.mjs, src/server/router.mjs, src/server/app.mjs,
test/tasks.test.mjs and test/store.test.mjs.
Canonical: modules that do not import "store.mjs" — composite(boolean)

tmct> which modules cannot import store.mjs
src/core/model.mjs, src/core/store.mjs, src/core/validate.mjs, src/lib/logger.mjs,
src/lib/http.mjs, src/handlers/base.mjs, src/server/router.mjs, src/server/app.mjs,
test/tasks.test.mjs and test/store.test.mjs.
Canonical: modules that do not import "store.mjs" — composite(boolean)

tmct> which modules can't import store.mjs
src/core/model.mjs, src/core/store.mjs, src/core/validate.mjs, src/lib/logger.mjs,
src/lib/http.mjs, src/handlers/base.mjs, src/server/router.mjs, src/server/app.mjs,
test/tasks.test.mjs and test/store.test.mjs.
Canonical: modules that do not import "store.mjs" — composite(boolean)

tmct> which modules import store.mjs
src/handlers/tasks.mjs and src/handlers/users.mjs.
Canonical: modules that imports "store.mjs" — reverse(imports, entityType=Module, "store.mjs")
```


test: the Canonical line for a set complement
=============================================

Found while diagnosing the edge above, and folded in: the `Canonical:` line is
what should have made the inversion obvious, and it couldn't.

Expectations
------------

When the following prompts were entered:
```log
tmct> which modules do not import store.mjs
tmct> which modules import store.mjs
```

Expected: the line restates each request in tmct's own grammar, so the two read
differently.

Actual: the negated query restated as `a compositional query (boolean)` — the
node type, not the question. Its positive twin restated as
`modules that imports "store.mjs"`. Every complement, whatever it asks, printed
the same eight words.

Result
------

Fail. The machine half (`composite(boolean)`) is right and stays. The English
half named the AST's node type instead of the question, so it carried nothing a
reader could check an answer against — and a complement was indistinguishable
from any other compositional query, including from its own positive twin. That
is the same blind spot the inverted answer above hid in.

Fix
---

`src/domain/ask.mjs` — `canonicalOf` glosses the set-complement AST
(`allOfClass` DIFFERENCE the positive set) in the grammar the positive
canonical already uses, covering the concrete-object, qualifier and
existential complements. Any other boolean shape keeps the coarse fallback
rather than risking a wrong restatement, and the `machine` half is untouched.

The gloss needs an infinitive ("modules that do not IMPORT x"), where the
relation token would read "do not imports". `src/domain/ask-vocab.mjs` gains a
hand-curated `bare` form per relation, beside the `verbs` list it belongs with:
stripping an "s" is a morphology rule, and it gets "touches" and
"co-change with" wrong.

Regression tests: `test/tools/ask.test.mjs`, the `canonical:` group — including
that a complement never reads the same as its positive twin, that the base verb
is used rather than the inflected token, and that a non-complement boolean
keeps the coarse text.

Retest
------

```log
tmct> which modules do not import store.mjs
tmct> which modules cannot import store.mjs
tmct> which classes do not inherit from Base
tmct> which modules are not tested
tmct> which modules do not import anything
tmct> which modules import store.mjs
```

Retest result
-------------

Pass.

Retest session log
------------------

```txt
tmct> which modules do not import store.mjs
Canonical: modules that do not import "store.mjs" — composite(boolean)

tmct> which modules cannot import store.mjs
Canonical: modules that do not import "store.mjs" — composite(boolean)

tmct> which classes do not inherit from Base
Canonical: classes that do not inherit from "Base" — composite(boolean)

tmct> which modules are not tested
Canonical: modules that are not tested — composite(boolean)

tmct> which modules do not import anything
Canonical: modules that do not import anything — composite(boolean)

tmct> which modules import store.mjs
Canonical: modules that imports "store.mjs" — reverse(imports, entityType=Module, "store.mjs")
```

Had this line read as it does now, the inverted answer above would have been a
one-glance catch: the question restates as the complement, the answer named the
importers.


Noted alongside: the vocabulary side has no enumerable kind
===========================================================

Probing the same shape over general vocabulary ("which animals cannot fly")
lands on an honest miss, and did so before this fix too. `parseNegation`
requires a concrete enumerable kind, and "animals" is not one of the graph's
entity types, so the complement's universe is undefined. That is a different
question from this edge — it needs a bounded universe for corpus classes, not a
surface form — and it is left where it lands, on the miss, rather than answered
by guessing the universe.
