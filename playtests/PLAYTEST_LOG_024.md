tmct playtest 024 — research round 2 (violin) — a compound class stores as its modifier
=======================================================================================

tmct version under test: 2.11.7

Area: the research capability, round 2 — fact quality on the violin queue (Violin, Viola,
Bow (music)), hunting the same four failure classes as round 1.

Axes explored this iteration: `research violin` plus two `research next` steps; read-back of
the stored classes ("is a violin a string instrument" / "is a violin a string"); the extractor
replayed over the article's first sentence; compound-subject and single-word controls.

Axes still untouched: glacier (round 025); the viola/bow fact quality beyond storage counts.

Probe recipe:

```bash
SCRATCH=$(mktemp -d)
printf 'research violin\nresearch next\nresearch next\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
printf 'what do you know about violin\nis a violin a string instrument\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
```

test: "The violin is a string instrument …" stores "violin is a kind of string"
===============================================================================

Expectations
------------

Given the Violin article ("The violin is a string instrument which has four strings and is
played with a bow."), When the facts store and are read back, Expected: the class is the
compound "string instrument" — and "is a violin a string instrument" answers yes.

Actual:

```txt
2 remembered facts about violin:
  i learned: violin is a kind of instrument (source: research:violin@0)
  i learned: violin is a kind of string (source: research:violin@0)
I can't confirm that — nothing I remember says violin is a string instrument. …
```

A confused fact ("violin is a kind of string" — the compound's modifier read as the class)
AND the article's actual claim missed (the compound class never stored, so the read-back
declined the very sentence the article opens with). The optimistic tier's entity capture took
the nearest single noun; "string" sits nearer the copula than "instrument".

Result
------

Fail

Fix
---

`src/services/extract-facts.mjs`, the POS tier's entity capture: a found noun now reads as its
whole contiguous NOUN/PROPN run, head-lemma folded — "a string instrument" is the class
"string instrument", "a guinea pig" is the subject "guinea pig", and a single-word run keeps
the plain lemma fold byte-identically. Applies to both the copula and relation-verb branches;
the round-023 clause guards are untouched and still hold.

Regression: `test/adapters/extract-facts-from-text.test.mjs` gains the compound-object,
compound-subject and single-word-control cases.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
stored 2 facts from "Violin". …
yes — i learned: violin is a kind of string instrument (source: research:violin@0)
I can't confirm that — nothing I remember says violin is a string. I do know: … violin is a kind of string instrument …
```

("is a violin a string" now declines — the wrong class is gone; the compound reads back yes
with its citation.)
