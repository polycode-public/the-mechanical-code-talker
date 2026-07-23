tmct playtest 020 — multi-word terms pass; the politeness ladder drops "please" and "mind telling me"
=====================================================================================================

tmct version under test: 2.11.3

Area: multi-word and awkward terms (first area — passed clean), then the paraphrase ladder's
politeness rungs (second area — edge found).

Axes explored this iteration: multi-word compounds through teach and read-back ("guinea pig",
"ice cream", "polar bear"), including the decline's own two-step grounding recipe followed
verbatim; query-keyword-colliding terms ("what-if analysis", "can-opener" — including "can a
can-opener open", auxiliary colliding with the term); politeness wrappers around the canonical
"what is a dog" ("could/would you tell me", "tell me", "please" prefix and infix, "would you
mind telling me", bare "mind telling me").

Axes still untouched: cleft constructions ("it's a dog that barks — true?" — a genuinely
different shape, not a wrapper; misses today and generalizes to little, left unfixed rather than
distorting a frame for it); negative quantifiers; teach-side variation.

Probe recipe:

```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf '<q>\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
```

First area, no edge: all three compounds decline with the same grounding nudge when both sides
are unknown, and the nudge's own recipe round-trips ("every guinea pig is a thing" → "every
rodent is a thing" → "a guinea pig is a rodent" stores, reads back yes, and "what is a guinea
pig" renders the chain). "what is a what-if analysis" and "can a can-opener open" both parse
their term despite the embedded query keyword; the latter answers with the precise base-rate
decline ("can-opener is a kind of tool, but nothing I remember says whether any kind of tool
can open").

test: a courtesy "please" (prefix or infix) and the "mind telling me" gerund drop the question
==============================================================================================

Expectations
------------

When:

```txt
please tell me what a dog is
tell me please what a dog is
would you mind telling me what a dog is
```

Expected: each peels to "what a dog is" → "what is a dog", the same unwrap "could you tell me
what a dog is" already gets.

Actual: all three miss —

```txt
I couldn't read that as a question I can answer. Try "what is a dog" for general vocabulary. Type /help for all query shapes.
```

Minimal pairs: "tell me what a dog is" passes / "tell me please what a dog is" fails;
"would you tell me what a dog is" passes / "would you mind telling me what a dog is" fails.

Result
------

Fail

Fix
---

`src/domain/interpret/normalize.mjs`, three additions to the closed preamble-frame family:
a leading-courtesy peel (`please <Q>` / `please, <Q>` — the modal wrapper only stripped a
"please" inside its own frame, so a sentence leading with one never reached any wrapper); an
optional infix "please" on the tell-me wrapper (mirroring the modal wrapper's own); and a
"[would/do you] mind telling me <Q>" gerund wrapper, interrogative-remainder-gated like its
tell-me sibling. No general rule widened — all closed alternations.

Regression: `test/corpus/templates.jsonl` gains
`templates-politeness-wrappers-unwrap-to-the-embedded-question` (five turns covering the fixed
family plus "please, what is a dog").

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
0 <- tell me please what a dog is
0 <- please tell me what a dog is
0 <- would you mind telling me what a dog is
0 <- mind telling me what a dog is
0 <- please, what is a dog
0 <- tell me what a dog is
0 <- could you tell me what a dog is
```

(Count of "couldn't read" misses per probe — zero across the family; each answers the dog
definition from the seeded corpus.)
