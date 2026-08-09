tmct playtest 007 — an operator's own pig-and-leaves session, replayed as findings
==================================================================================

tmct version under test: 5.0.26 (operator session 2285fb9f, 2026-08-08 22:03)

Area: the teach/ask loop an unscripted visitor actually walks — property and
capability teaching across singular/plural surface forms, type questions about
a taught individual, and read-back grammar on plural subjects.

Axes explored: has-a inheritance through a taught type (works); type-of asks
with a class qualifier; bare plural property statements; capability teach in
both numbers; capability inheritance through a taught subclass edge; plural
subject folding at teach time; adjective-qualified have-asks.

The session, verbatim
---------------------

### turn 1 — a pig has a tail
noted — remembered 1 fact: pig tmct:has tail

### turn 2 — john is a pig
noted — remembered: john is a pig

### turn 3 — does john have a tail
yes — you told me: john is a pig; you told me: pig tmct:has tail

### turn 4 — what type of creature is john
I couldn't ground that in anything I know. Try "what is a dog" for general vocabulary.

### turn 5 — a creature is any living thing that can move on its own
I couldn't ground that in anything I know.

### turn 6 — the defenition of a creature is any living thing that can move on its own
I couldn't ground that in anything I know.

### turn 7 — what is a creature
creature is a kind of organism → living thing → whole (source: corpus:human-large /r/IsA)

### turn 8 — is a pig a creature
I can't confirm that — nothing I remember says pig is a creature. I do know: pig is a
kind of animal. If it's true, teach me: "pig is a kind of creature".

### turn 9 — pig is a kind of creature
noted — remembered 1 fact: pig rdfs:subClassOf creature

### turn 10 — is a pig alive
I don't have a fact saying a pig is alive.

### turn 11 — a pig is an animal
noted — remembered 1 fact: pig rdfs:subClassOf animal

### turn 12 — animals are alive
response templates unavailable — ask a question, or /help for commands.

### turn 13 — animals can be alive
noted — remembered: animals can be alive

### turn 14 — can a pig be alive
I can't confirm that — nothing I remember says pig can be alive.

### turn 15 — a pig can be alive
I couldn't ground that in anything I know.

### turn 16 — Remember: a pig can be alive
I couldn't store that — I remember facts in the shape "every X is a Y".

### turn 17 — what is alive
tree is alive (source: corpus:conceptnet /r/HasProperty)

### turn 18 — does a tree have leaves
yes — tree has leaf (source: corpus:human /r/HasA)

### turn 19 — leaves are green
response templates unavailable — ask a question, or /help for commands.

### turn 20 — Remember: leaves are green
noted — remembered: leaves is green

### turn 21 — do trees have green leaves?
I couldn't ground that in anything I know.

What worked
-----------

Turns 1-3 are the product promise working end to end: two taught facts chain
into a cited yes. Turn 7's corpus chase, turn 8's honest miss with both the
counter-fact and the exact teach phrasing, and turn 18's corpus read are all
the design behaving as written.

Findings and the fixes queued
-----------------------------

1. **"response templates unavailable" leaks on bare plural property
   statements** (turns 12, 19: "animals are alive", "leaves are green"). An
   internal failure string is not an answer. The statement should either
   teach a property fact or decline in the house voice naming what shape
   would land. DELIVERED — a bare generic plural now mints under the
   singular the same way the explicit-quantifier form already did.

2. **Capability and property facts never inherit through a taught subclass
   edge** (turn 14: "animals can be alive" + "a pig is an animal" stored,
   "can a pig be alive" misses). The same one-hop gap NEXT.md already holds
   for `does X have Y` restriction inheritance — that item's scope now
   covers capability (`mgx:capableOf`) and property reads too. QUEUED (as
   the widened existing item).

3. **Singular capability teach declines where the plural teaches** (turn 15
   "a pig can be alive" vs turn 13 "animals can be alive"). One surface
   family, two outcomes. DELIVERED — a determiner-led capability lead now
   reaches the same mint, positive and negated alike.

4. **"what type/kind of X is <individual>" never reads the taught type**
   (turn 4: john's type was taught two turns earlier). The qualifier noun
   swallows the parse. DELIVERED — the qualifier is no longer restricted to
   a closed five-word set, and a taught or corpus subclass bridge to it
   rides along with the answer when one exists.

5. **A plural teach subject stores unfolded** (turn 20 stores and reads
   back "leaves is green" instead of folding to "leaf"), which also blocks
   turn 21's composition against "tree has leaf". DELIVERED — the same fold
   as item 1; turn 21's "do trees have green leaves" now grounds its parts
   honestly instead of declining over a phantom unknown word.

6. **No definitional teach frame** (turns 5-6: "a creature is any living
   thing that can move on its own"). A genus-plus-gloss frame (creature ⊑
   living-thing, gloss kept as prose) is a design candidate, not a quick
   fix. RECORDED as a candidate, not queued.

7. **Adjective-qualified have-asks don't compose** (turn 21 "do trees have
   green leaves" over "tree has leaf" + "leaf is green"). Real composition
   work across two facts. RECORDED as a candidate, not queued.
