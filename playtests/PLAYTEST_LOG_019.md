tmct playtest 019 — inference depth — "a X is a Y" silently stores a kind as a property once the store is warm
==============================================================================================================

tmct version under test: 2.11.2

Area: inference depth over taught isa chains — teach a chain, query at 1, 2, and 3 hops, and
check every link actually stored as the kind fact the chain needs.

Axes explored this iteration: a four-link taught chain queried at each hop count; the same teach
sentence ("a dog is a mammal") probed fresh-store vs warmed-store; the object noun varied across
lexicon-known ("animal") and lexicon-unknown ("mammal", "robot"); the decline's own suggested
"every X is a Y" form as the control.

Axes still untouched: chains longer than the answering depth limit are a designed, disclosed
bound ("the chain is longer than I follow while answering. Run \"/syllogise spaniel\"") — honest,
not an edge; capability lifts through taught chains; teach-side variation generally (a bare
capitalized "Mary is female" lands on the orientation card while the wrapped form works — noted
for a later teach-side iteration).

Probe recipe:

```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'a spaniel is a dog\na dog is a mammal\n...\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
node bin/tmct.mjs memory --repo "$SCRATCH" --verbose   # storage check per teach
```

test: a warmed store turns an articled kind claim into a property garble
========================================================================

Expectations
------------

Given (fresh store, then the same sentence again after one successful teach):

```txt
tmct> a dog is a mammal
I couldn't store that — I don't recognize "mammal" as a word I know — … Did you mean: "every dog is a mammal"?
```

When (after "a dog is an animal" stored):

```txt
a dog is a mammal
is a dog a mammal
```

Expected: the same honest decline as the fresh store — same sentence, same answer, regardless of
what was taught before. (The fresh decline is the designed behavior: minting a new class needs a
universal quantifier, and the decline names the storable form.)

Actual: the warmed store silently stored the kind claim as a property fact, and the read-back
then denied the fact it had just confirmed:

```txt
noted — remembered: dog is mammal
I can't confirm that — nothing I remember says dog is a mammal. … If it's true, teach me: "dog is a kind of mammal".
```

`tmct memory --verbose` showed the garble directly: `dog mgx:hasProperty mammal`. In the chain
probe this silently broke 2-hop inference ("is a spaniel a mammal" missed while "is a spaniel an
animal" chained fine through the corpus-seeded link).

Result
------

Fail

Fix
---

`src/services/chat.mjs`, `unknownAdjectiveFallback`: the shared teach regex strips the object's
article before capture, so the property mint saw "a dog is a mammal" and "the cache is bespoke"
as the same shape, and a subject grounded by any prior taught fact activated the mint. The
fallback now declines when the original sentence carries an article on the complement ("is a/an
Y") — an articled complement is a noun-phrase kind claim, never an adjective property — landing
on the honest teach-miss whose nudge already names the storable "every X is a Y" form. The
genuine adjective mints ("the cache is bespoke", "every snake is venomous") are untouched.

Regression: `test/corpus/inference.jsonl` gains three rows under
`inference.teach.kind-vs-property` — the warmed-store decline (and no garble in the store), the
suggested every-form storing and reading back yes, and the bare-adjective property mint control.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> noted — remembered 1 fact: dog rdfs:subClassOf animal (dog counts as an animal)
I couldn't store that — I don't recognize "mammal" as a word I know — … Did you mean: "every dog is a mammal"? …
I can't confirm that — nothing I remember says dog is a mammal. …
noted — remembered: dog is a kind of mammal
yes — you told me: dog is a kind of mammal (source: teach:chat:…)
noted — remembered: cache is bespoke
```

Chain control after the fix (every-form teaches): "is a spaniel a mammal" chains through two
taught links ("spaniel is a kind of dog; dog is a kind of mammal; so spaniel is a mammal").
