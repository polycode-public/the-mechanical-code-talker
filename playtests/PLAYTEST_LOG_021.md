tmct playtest 021 — teach-side variation — the genitive ask rejects its own askable surfaces
============================================================================================

tmct version under test: 2.11.4

Area: teach-side variation — the same relational fact phrased differently, verified with one
query — and the query-side surfaces of the genitive relation ask.

Axes explored this iteration: three teach phrasings of one fact ("ahab is john's father",
"john's father is ahab", "ahab fathered john" — all converge on the identical stored fact and
answer); a conjunction teach ("ahab is male and is the father of pete" stores both); the bare
declarative ("dogs bark" teaches the same capableOf every time); the genitive ask's surface
ladder (apostrophed, apostrophe-less, who's/whos contraction leads).

Axes still untouched: a bare capitalized "Mary is female" lands on the orientation card while
the wrapped "remember that Mary is female" works (carried from log 019 — an entry-routing
question, not a teach-parse one); negative quantifiers; anaphora ladders.

Probe recipe:

```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf '<teach>\n<query>\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
```

Teach-side result: no edge. All three phrasings store "ahab fathers john" identically; the
conjunction splits and stores both facts; repetition is consistent.

test: the possessive query drops its apostrophe-less and contraction surfaces
=============================================================================

Expectations
------------

Given:

```txt
tmct> noted — remembered both: ahab is male; and ahab fathers pete
```

When:

```txt
who is petes father
who's pete's father
```

Expected: both answer "ahab" like "who is pete's father" does — an apostrophe-less possessive
is the commonest typed form of the same question, and the contraction lead is already in the
ask path's CONTRACTIONS table.

Actual: both miss —

```txt
I couldn't read that as a question I can answer. …
```

Minimal pairs: "who is pete's father" passes / "who is petes father" fails; "who is pete's
father" passes / "who's pete's father" fails. Diagnosis (--narrate): the passing form is
answered by the memory-facts lane's relation reader, which reads the raw surface — the
contraction table lives in the ask path's normalize step and never reaches it, and the genitive
regex requires the literal apostrophe.

Result
------

Fail

Fix
---

`src/services/chat.mjs`, scoped to the relation reader's own match step: a lead expansion
("who's"/"whos"/"what's"/"whats" → "who is"/"what is", applied at the reader's two match sites
— "whose" cannot match); and an apostrophe-less genitive alternative gated at match time on the
possessor already being a term some stored fact names — the reader's own miss text is
definitive, never a fall-through, so a plain plural or pronoun ("who is his father", "who is
the dogs father") must never be mis-split into a claimed relation ask. Both guards probed.

Regression: `test/corpus/inference.jsonl` gains two rows under
`inference.relation.genitive-surface` — the four askable surfaces all answering, and the
pronoun/plural guard staying unclaimed.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
[who is petes father] -> tmct> ahab — you told me: ahab fathers pete (source: teach:chat:…)
[whos petes father] -> tmct> ahab — you told me: ahab fathers pete (source: teach:chat:…)
[who is pete's father] -> tmct> ahab — you told me: ahab fathers pete (source: teach:chat:…)
[who is his father] -> I couldn't read that as a question I can answer. … (unclaimed, unchanged)
[who is the dogs father] -> (unclaimed, unchanged)
[whats the capital of france] -> tmct> I don't know a relation or rule called 'capital' yet.
```
