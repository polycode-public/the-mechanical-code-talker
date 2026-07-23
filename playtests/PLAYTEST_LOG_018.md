tmct playtest 018 — quantifiers — "can all/every X ..." answers a bare universal yes
====================================================================================

tmct version under test: 2.11.1

Area: quantifiers over remembered capability facts — the all/every yes/no forms across the two
question auxiliaries (do-support and modal "can").

Axes explored this iteration: universal quantifiers (all/every) on capability yes/no questions,
varying only the auxiliary (do/does vs can/could) with meaning held constant; the unquantified
bare-plural control ("can dogs bark").

Axes still untouched: quantifiers over other relations (has/is-a: "do all dogs have tails" reads
through a different reader), negative quantifiers ("can no dog fly"), "which"-quantified forms
(covered separately by WHICH_KIND_CAN_RE), inference depth, teach-side variation, multi-word terms.

Probe recipe:

```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'dogs are animals\ndogs can bark\n...\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
```

test: the universal hedge fires for do-led but not can-led quantified questions
===============================================================================

Expectations
------------

Given (taught in the same session):

```txt
tmct> noted — remembered 1 fact: dog rdfs:subClassOf animal (dog counts as an animal)
noted — remembered 1 fact: dog mgx:capableOf bark
```

When:

```txt
do all dogs bark
can all dogs bark
can every dog bark
```

Expected: all three get the same generic-not-universal hedge — a remembered capability fact is
generic, so a bare "yes" to an all/every question claims universality the memory can't support.

Actual: only the do-led form hedges; both can-led forms answer a bare universal yes.

```txt
tmct> I can't speak for all dogs — what I remember is generic, not universal. yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...).
yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...)
yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...)
```

A second, smaller edge in the same family: "does every dog bark" hedges but echoes the garbled
"all dog" (the quantifier is normalized to "all" and the subject echoed singular).

Result
------

Fail

Fix
---

`src/services/chat.mjs`: `CAN_ASK_RE` gains the same optional `(all |every )` capture group
`DO_VERB_ASK_RE` already has, and the "can a dog bark" reader now returns the same hedged reply
for a quantified match that the do-support reader returns — same wording, one surface. Both hedge
sites now echo the quantifier as the user typed it ("every dog", "all dogs"), replacing the
hard-coded "all" that produced "all dog" for singular every-questions.

Regression: `test/corpus/inference.jsonl` gains three rows under the existing
`inference.quantified.generic-hedge` key — `can all birds fly` (hedged, never a line starting
"yes"), `can every bird fly` (hedged, echoes "every bird"), and the control `can birds fly`
(plain grounded yes, no hedge).

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> I can't speak for all dogs — what I remember is generic, not universal. yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...).
I can't speak for every dog — what I remember is generic, not universal. yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...).
I can't speak for all dogs — what I remember is generic, not universal. yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...).
I can't speak for every dog — what I remember is generic, not universal. yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...).
yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...)
yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:...)
```

(Order: can all / does every / do all / can every / can a dog / can dogs — the four quantified
forms hedge consistently, the two bare forms answer plainly.)
