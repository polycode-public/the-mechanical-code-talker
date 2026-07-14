
tmct playtest 004 — forward yes/no coverage across the whole relation table
===========================================================================

Version under test: 1.10.7 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: the edge CLASS behind playtests 001–003 — forward yes/no questions for
every relation the phrase table can render. isa, capableOf, and hasA got
hand-written readers in earlier rounds; the other ~19 relations (usedFor,
partOf, madeOf, causes, atLocation, desires, requires, …) had none.

Axes explored so far: relation coverage of forward yes/no (001), honesty on
miss (002), negation (003), the generalization of all three (this).
Axes still untouched: quantifiers, inference depth, teach-side variation,
anaphora, multi-word terms, the teach/query boundary.


test: is a horse used for riding
================================

Expectations
------------

Given the corpus facts (horse UsedFor riding; wheel PartOf vehicle; pen MadeOf
plastic), when the following prompts were entered:

```log
tmct> is a horse used for riding
tmct> is a wheel part of a car
tmct> is a house made of brick
```

Expected: yes for the first (the fact exists and renders one line earlier in
"what is a horse"); honest misses for the others, citing what IS known.

Actual: three different failure flavours of the same class —
a garbled mis-split ("I don't have a fact saying a horse used for is
riding"), ISA_ASK_RE swallowing the shape whole ("is a wheel part of a car"
read subject "wheel part of" and offered the nonsense teach hint
`"wheel part of is a kind of car"`), and "does fire cause smoke" misread as a
code-graph calls question.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> is a horse used for riding
I don't have a fact saying a horse used for is riding.

tmct> is a wheel part of a car
I can't confirm that — I don't know "wheel part of" at all yet. If it's true, teach me: "wheel part of is a kind of car".

tmct> does fire cause smoke
no module matching "cause smoke" found in the index. Try "who touched <a module that actually has commits>" or "/describe <module>" to see what's in the index.

Goal (inferred): Understand a call relationship.
Canonical: calls "cause smoke" — reverse(calls, "cause smoke")

tmct> is a house made of brick
I don't have a fact saying a house made of is brick.
```


Fix
---

`src/chat.mjs`: instead of a fourth hand-written reader, the whole class in
one data-driven pass — `FORWARD_YESNO_MARKERS`, the forward mirror of the
existing `REVERSE_PREDICATE_MARKERS` derivation. One reader is DERIVED per
`FACT_PREDICATE_PHRASES` entry: copula phrases become "is/are X <phrase> Y",
verb phrases become "does/do X <base-verb> Y" (naive de-3sg fold), "can be"
becomes "can X be Y". The lane runs before the isa lane (whose lazy subject
otherwise swallows these shapes) and answers: yes on a real fact; an honest
miss citing the subject's same-relation facts; a bare honest miss for a
subject known at all (only when no structural parse is standing, so code
queries are never hijacked); otherwise it leaves the standing miss alone.

Design rule the suite enforced immediately: derived readers YIELD to
dedicated ones. The ownership reader answers a confident closed-world "no" —
a stronger contract than the derived "can't confirm" — so `mgx:ownedBy` sits
in the exclusion set beside isa/hasProperty/hasA/capableOf. One tier-5
regression caught the interception; exclusion fixed it.

No teach hints on the derived misses, deliberately: no teach phrasing for
these relations is verified to round-trip (playtest 003's lesson — a hint
that doesn't parse is worse than no hint). Teach-side predicate unification
(taught "fire causes smoke" mints mgx:cause, corpus uses mgx:causes — they
never unify) is the adjacent class deferred here, stated for a future round.

Regression tests: four new cases in `test/wiring-facts-reverse.test.mjs`
(derived yes, honest miss with same-relation citation + miss record, second
derived relation yes, dedicated-reader non-interception).


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> is a horse used for riding
yes — horse is used for riding (source: corpus:human /r/UsedFor)

tmct> is a horse used for racing
I can't confirm that — nothing I remember says horse is used for racing. I do know: horse is used for riding (source: corpus:human /r/UsedFor).

tmct> is a wheel part of a car
I can't confirm that — nothing I remember says wheel is part of car. I do know: wheel is part of vehicle (source: corpus:human /r/PartOf).

tmct> is a pen made of plastic
yes — pen is made of plastic (source: corpus:human /r/MadeOf)

tmct> is a house made of brick
I can't confirm that — nothing I remember says house is made of brick.

tmct> is a dog an animal
yes — dog is a kind of animal (source: corpus:human /r/IsA)

tmct> can a dog bark
yes — dog can bark (source: corpus:human /r/CapableOf)

tmct> does a dog have a tail
yes — dog has tail (source: corpus:human /r/HasA)
```

Full suite: green (see commit). CLI smoke: greets and exits 0.
