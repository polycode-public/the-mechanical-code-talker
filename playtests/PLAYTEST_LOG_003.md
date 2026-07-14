
tmct playtest 003 — negation
============================

Version under test: 1.10.6 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: negation, question side and teach side — "is a X not a Y", disjointness
follow-through, "can X <verb>" with no supporting fact, and negative teaching.

Axes explored so far: relation coverage of forward yes/no (001), honesty on
miss (002), negation (this).
Axes still untouched: quantifiers, inference depth, teach-side variation,
anaphora, multi-word terms, the teach/query boundary.


test: is a dog not a cat
========================

Expectations
------------

Given the corpus facts (dog IsA animal) and the already-supported disjointness
teach shape:

```log
tmct> no dog is a cat
noted — remembered 1 fact: dog owl:disjointWith cat
```

When the following prompts were entered:
```log
tmct> is a dog not a cat
tmct> is a dog a cat          (after teaching "no dog is a cat")
tmct> can a dog fly
```

Expected: the negated question answered honestly (confirmed by a taught
disjointness, refuted by a positive fact, or an honest either-way miss); the
taught disjointness answering the positive question "no"; the capability
question an honest miss citing what dog CAN do.

Actual: "is a dog not a cat" captured "dog not" as the subject and offered the
nonsense teach hint `"dog not is a kind of cat"`. After teaching "no dog is a
cat", "is a dog a cat" still said "I can't confirm that" — the disjointness
chase only fires through a taught rdf:type premise, never a direct disjoint
fact. "can a dog fly" fell to the parse wall.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> is a dog not a cat
I can't confirm that — I don't know "dog not" at all yet. If it's true, teach me: "dog not is a kind of cat".

tmct> no dog is a cat
noted — remembered 1 fact: dog owl:disjointWith cat

tmct> is a dog a cat
I can't confirm that — nothing I remember says dog is a cat. I do know: dog is a kind of animal (source: corpus:human /r/IsA). If it's true, teach me: "dog is a kind of cat".

tmct> can a dog fly
couldn't parse this as a graph question. Try: "which modules import <name>" or "what calls <name>". Type /help for all query shapes.
```


Fix
---

Four changes, all on the same negation/capability seam:

1. `src/chat.mjs`, is-a ladder: a negated membership question ("is a X not a
   Y") is recognized before the positive ladder walks it with a garbage
   subject. Answered inverted — a positive isa fact refutes it ("no — dog is
   a kind of animal"), a taught disjointness confirms it ("yes — dog is not a
   cat"), otherwise an honest either-way miss pointing at the supported
   "no X is a Y" teach shape. Deliberately shallow: no chain chases on the
   negated side.
2. `src/chat.mjs`, same ladder: a DIRECT taught disjointness now answers the
   positive question "no — dog is not a cat" (previously only type-mediated
   disjointness could produce a "no").
3. `src/chat.mjs`, can-lane: "can a dog fly" with a known subject now answers
   the same honest-miss closer as the is-a shape, citing what the subject CAN
   do, with the turn still recorded as a miss.
4. Capability became teachable — the closer's own hint round-trips now.
   `src/grammar/ace.mjs` pattern 9 ("N can VERB" → `mgx:capableOf`, single
   bare-word object, falls through on a noun "can"); the general-verb teach
   lane maps the modal onto `mgx:capableOf` (same precedent as has/have →
   `mgx:hasA`) instead of minting a mangled "dog cans swim" fact; "cannot"
   declines honestly — the vocabulary has no negative-capability predicate,
   and a stored positive would invert the taught meaning on read-back.

Deferred (stated, not silent): negative-capability data ("a penguin cannot
fly") has no predicate in the fact vocabulary — teaching it declines honestly
rather than storing something wrong. Modelling negative capability (e.g. via
the existing max-0 cardinality encoding) is its own body of work. "what
cannot fly" (reverse negative listing) depends on the same missing data model.

Regression tests: six new chat-level cases in
`test/wiring-facts-reverse.test.mjs`, one ACE unit case in
`test/grammar-ace.test.mjs`; pattern table updated in
`docs/references/schemas/ace-owl-fragment.md`.


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> is a dog not a cat
I can't confirm that either way — nothing I remember links dog and cat. If no dog is a cat, teach me: "no dog is a cat".

tmct> no dog is a cat
noted — remembered 1 fact: dog owl:disjointWith cat

tmct> is a dog a cat
no — you told me: dog is not a cat (source: ace:chat:…)

tmct> is a dog not a cat
yes — you told me: dog is not a cat (source: ace:chat:…)

tmct> is a dog not an animal
no — dog is a kind of animal (source: corpus:human /r/IsA)

tmct> a dog can swim
noted — remembered 1 fact: dog mgx:capableOf swim

tmct> can a dog swim
yes — you told me: dog can swim (source: ace:chat:…)

tmct> can a dog fly
I can't confirm that — nothing I remember says dog can fly. I do know: dog can bark (source: corpus:human /r/CapableOf); you told me: dog can swim (source: ace:chat:…). If it's true, teach me: "a dog can fly".
```

Full suite: 2175 pass, 0 fail (plus 7 new regression cases). CLI smoke:
greets and exits 0.
