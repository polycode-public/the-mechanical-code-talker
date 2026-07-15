
tmct playtest 005 — anaphora in vocabulary conversations
========================================================

Version under test: 1.10.8 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: pronoun follow-ups — "what is a dog" then "can it bark". The code-graph
side has a real focus mechanism ("what calls it"); the vocabulary side had
nothing binding "it".

Axes explored so far: relation coverage of forward yes/no (001), honesty on
miss (002), negation (003), the derived-reader generalization (004),
anaphora (this).
Axes still untouched: quantifiers, inference depth, teach-side variation,
multi-word terms, the teach/query boundary.


test: what is a dog → can it bark
=================================

Expectations
------------

Given:

```log
tmct> what is a dog
dog is a kind of animal (source: corpus:human /r/IsA)
dog has tail (source: corpus:human /r/HasA)
dog can bark (source: corpus:human /r/CapableOf)
```

When the following prompts were entered:
```log
tmct> can it bark
tmct> does it have a tail
tmct> is it an animal
```

Expected: "it" binds to dog; yes with the cited fact for each.

Actual: three different failures — the conversational word-count catch-all
deflected "can it bark" into the orientation blurb; "does it have a tail"
misread "it" as a literal code-node reference; "is it an animal" hit the
parse wall. Worse, the orientation blurb is a dispatched turn, so it REPLACED
`last` and destroyed the antecedent for every later pronoun turn.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> can it bark
I'm tmct — a deterministic, offline chat assistant (no LLM). Try "what is a dog" for general vocabulary. /memory for what I remember.

tmct> does it have a tail
"tail" needs a selected node to refer to — click a node first, or name it directly.
Canonical: does "it" defines "tail"? — ask(defines, subject="it", "tail")

tmct> is it an animal
couldn't parse this as a graph question. Try: "is a <thing> a <kind>" (an article before the kind, too). Type /help for all query shapes.
```


Fix
---

`src/chat.mjs`, three pieces on one seam:

1. **Antecedent binding** — `vocabAntecedentFrom(last)`: fact answers render
   rigidly ("<subject> <phrase> <object> (source: …)"), so the last answer's
   leading 1–2 word subject is extractable with no NLP. When no code focus is
   standing, the turn opens like a fact question, and it contains a bare
   "it"/"they", the pronoun is substituted once at the top of `runTurn`,
   before any dispatch lane sees the text. The original line is restored
   into the turn record centrally (the same discipline the existing
   indirect-request rewrite uses). A code-graph session's own pronoun
   resolution is untouched (gated on `!focus?.id`).
2. **Conversational gate** — a turn whose pronoun was bound is provably a
   fact question, so it skips the conversational layer and the orientation
   gate; the substituted "can dog bark" (3 words) would otherwise still trip
   `isConversational`'s word-count catch-all, and the blurb would again
   destroy the antecedent by becoming `last`.
3. **Pronoun guard** on playtest 002's unknown-subject closer: it must never
   claim `I don't know "it"` — a pronoun is not a term.

Known remainders (stated): "what about cats" (topic-shift ellipsis) is a
different mechanism (discourseRewrite territory) — untouched this round. A
cold pronoun with no antecedent still falls to the generic wall, honest if
unhelpful. Bare 3-word fact questions WITHOUT a pronoun ("can dog bark",
typed directly) still deflect to the conversational layer — pre-existing,
out of this round's seam.

Regression tests: three new cases in `test/wiring-facts-reverse.test.mjs`
(three-relation binding chain, antecedent movement across subjects, no
fabricated subject cold).


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> what is a dog
dog is a kind of animal (source: corpus:human /r/IsA)
dog has tail (source: corpus:human /r/HasA)
dog can bark (source: corpus:human /r/CapableOf)

tmct> can it bark
yes — dog can bark (source: corpus:human /r/CapableOf)

tmct> does it have a tail
yes — dog has tail (source: corpus:human /r/HasA)

tmct> is it an animal
yes — dog is a kind of animal (source: corpus:human /r/IsA)

tmct> can it fly
I can't confirm that — nothing I remember says dog can fly. I do know: dog can bark (source: corpus:human /r/CapableOf). If it's true, teach me: "a dog can fly".

tmct> what is a horse
horse is a kind of animal (source: corpus:human /r/IsA)
horse can run (source: corpus:human /r/CapableOf)
horse is used for riding (source: corpus:human /r/UsedFor)

tmct> what is it used for
horse is used for riding (source: corpus:human /r/UsedFor)
```

Full suite: green (see commit). CLI smoke: greets and exits 0.
