tmct playtest 022 — negation — a negated can-question agrees with the wrong polarity, and "what cannot fly" lands on the identity card
======================================================================================================================================

tmct version under test: 2.11.5

Area: negation over remembered capability facts — negated yes/no surfaces, the taught negative
exception, and the negative reverse-by-verb list.

Axes explored this iteration: the taught negative override ("a penguin cannot fly" over the
seeded "bird can fly" — answers with the exception and says what it overrides, correct as
shipped); negated yes/no surfaces across lead ("can't/cant/cannot") and infix ("can X not Y")
positions, against both stored polarities; "what cannot/can't <verb>" with and without stored
negatives; "is a dog not a cat" (honest can't-confirm with a teach hint, correct as shipped).

Axes still untouched: negated general-verb yes/no ("does tony not eat ribs" — the general-verb
reader shares positiveQuestionSurface but its leads were not probed this round); negative
quantifiers ("can no dog fly").

Probe recipe:

```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'a penguin is a bird\na penguin cannot fly\n<q>\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
```

test: the bare yes/no lead survives the negation strip and reads as the wrong answer
====================================================================================

Expectations
------------

Given (seeded store, "penguin cannot fly" taught):

When:

```txt
can dogs not bark
what cannot fly
cant a penguin fly
```

Expected: the negation-strip design answers the same polarity question as the positive twin —
fine — but the reply must not open with a bare "yes/no" that reads as agreeing with the asked
negative surface; "what cannot fly" should list the stored negative ("penguin cannot fly");
"cant" should resolve like "can't".

Actual:

```txt
yes — dog can bark (source: corpus:human /r/CapableOf)
I'm tmct — a deterministic, offline chat assistant (no LLM). …
(this repo has no code graph — …)
```

"yes —" to "can dogs not bark" reads as "yes, they can not bark" — the opposite of the cited
fact. "what cannot fly" was claimed by the conversational catch-all and answered with the
identity card despite a stored negative. "cant a penguin fly" fell to a plain miss.

Result
------

Fail

Fix
---

`src/services/chat.mjs`, three scoped changes in the capability-reader family: (1) when
positiveQuestionSurface stripped a negation, the capability and do-support readers drop the
bare yes/no lead and let the cited fact carry the polarity alone ("dog can bark (source: …)");
this deliberately revises the corpus row that pinned byte-identical answers for the two
surfaces — the same stored fact still comes back, only the lead differs. (2) A negative twin of
the "what can fly" reader lists mgxneg:capableOf facts by object, and a matched shape with no
stored negatives returns a definitive memory miss instead of falling to the conversational
catch-all (the catch-all's capability-shape exemption gains the new pattern). (3) "cant" joins
the lead-negation spellings.

Regression: `test/corpus/inference.jsonl` — the revised
`inference-capability-negated-question-surface-answers-with-the-same-fact` row plus three new
rows under `inference.negation.surface`.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
[can dogs not bark] -> tmct> dog can bark (source: corpus:human /r/CapableOf)
[can a penguin not fly] -> tmct> you told me: penguin cannot fly (source: teach:chat:…)
[cant a penguin fly] -> tmct> you told me: penguin cannot fly (source: teach:chat:…)
[what cannot fly] -> tmct> you told me: penguin cannot fly (source: teach:chat:…)
[what can't swim] -> tmct> nothing I remember says anything cannot swim.
[can a penguin fly] -> tmct> no — you told me: penguin cannot fly (source: teach:chat:…)
[can dogs bark] -> tmct> yes — dog can bark (source: corpus:human /r/CapableOf)
```

(Positive surfaces keep their yes/no leads and the universal hedge; only negated surfaces drop
the lead.)
