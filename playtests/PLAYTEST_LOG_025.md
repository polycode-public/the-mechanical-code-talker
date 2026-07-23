tmct playtest 025 — research round 3 (glacier) — "a body of ice" stores as two wrong kinds
==========================================================================================

tmct version under test: 2.11.8

Area: the research capability, round 3 — the glacier queue (Glacier, Baltoro Glacier, Earth),
same four failure classes.

Axes explored this iteration: `research glacier` plus two `research next` steps; read-back of
every stored class; both extraction paths (the optimistic tier and the reference pack's
first-sentence isa) replayed on the article's opening sentence; classifier ("a type of
mammal", "a kind of dog") and content-head ("a game of skill") controls.

Axes still untouched: the verb tier's partitive subjects (recorded in NEXT.md); deeper queue
walks.

Probe recipe:

```bash
SCRATCH=$(mktemp -d)
printf 'research glacier\nresearch next\nresearch next\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
printf 'what do you know about glacier\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
```

test: a partitive "body of ice" becomes both "glacier ⊑ body" and "glacier ⊑ ice"
=================================================================================

Expectations
------------

Given the Glacier article's opening sentence ("A glacier is a large body of ice and snow."),
When both extraction paths read it, Expected: no class fact at all — "a body of ice" states
composition, and a stored subClassOf must stay meaningful.

Actual:

```txt
2 remembered facts about glacier:
  i learned: glacier is a kind of ice (source: research:glacier@0)
  i learned: glacier is a kind of body (source: research:glacier@0)
```

Two confused facts from one sentence, one per extraction path: the optimistic tier kept the
bare container noun ("body") as the class, and the reference pack's isa reader jumped its
of-chain unconditionally to the final noun ("ice") — right for "a kind of dog", wrong for a
partitive.

Result
------

Fail

Fix
---

Both extractors, the same closed rule: an of-chain on a copula object reads through CLASSIFIER
heads only (type/kind/sort/form/class/variety/species/breed/genus → the real class), a
PARTITIVE container head (body/mass/group/collection/piece/part/…) yields no isa at all, and
any other content head keeps the outer class ("a game of skill" → game). In
`src/domain/reference-pack.mjs` the unconditional last-"of" jump becomes the guarded walk, and
"body"/"mass" join the generic-heads set; in `src/services/extract-facts.mjs` the copula
branch gains the same three-way of-chain handling (which also fixes the POS tier's own "a type
of mammal" → "type" garble).

The trade is deliberate: the glacier article now contributes no isa from its opening sentence
— an honest absence instead of two wrong classes ("is a glacier a body" now declines).

Recorded in NEXT.md, not fixed: the relation-verb tier's partitive subjects ("The weight of
all of the snow creates pressure" stores "snow creates pressure" — the inner noun of the
of-chain steals the subject from its head "weight").

Regression: partitive/classifier/content-head cases in
`test/adapters/extract-facts-from-text.test.mjs` and `test/adapters/reference-pack.test.mjs`.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
[] | isaOf: null <- A glacier is a large body of ice and snow.
[] | isaOf: null <- A lake is a large body of water.
[dog ⊑ mammal] | isaOf: null (lexicon-gated) <- A dog is a type of mammal.
[chess ⊑ game] | isaOf: "game" <- Chess is a game of skill.
[poodle ⊑ dog] | isaOf: "dog" <- A poodle is a kind of dog.
stored 1 fact from "Glacier".   (was 3 — both wrong classes gone)
I can't confirm that — I don't know "glacier" at all yet. …   (was: yes — a kind of body)
```
