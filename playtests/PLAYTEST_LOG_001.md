
tmct playtest 001 — canonical yes/no questions over corpus facts
================================================================

Version under test: 1.10.3 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: the textbook yes/no question for each corpus relation — the forms anyone
tries first. "is a dog an animal" (IsA) and "can a dog bark" (CapableOf) both
pass. The HasA form does not.

Axes explored this iteration: relation coverage of forward yes/no questions.
Axes still untouched: negation, quantifiers, inference depth, teach-side
variation, anaphora, multi-word terms, the teach/query boundary.


test: does a dog have a tail
============================

Expectations
------------

Given the corpus-seeded facts:

```log
tmct> what is a dog
dog is a kind of animal (source: corpus:human /r/IsA)
dog has tail (source: corpus:human /r/HasA)
dog can bark (source: corpus:human /r/CapableOf)
```

When the following prompts were entered:
```log
tmct> does a dog have a tail
tmct> do dogs have tails
```

Expected: yes — dog has tail (source: corpus:human /r/HasA)

Actual: misparsed as the code-graph `defines` relation ("does \"dog\" defines
\"tail\"? — ask(defines, …)"), answered with a term-resolution miss. The
sibling forms "is a dog an animal" and "can a dog bark" both answer yes, so
the gap is specific to the HasA yes/no lead.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> does a dog have a tail
couldn't resolve one of the terms in this question.
(this repo has no code graph — for structure, point me at a `.tmct/graph.json` with `--repo <path>` or run `npm run example:mini`; tmct doesn't index code itself.)

Goal (inferred): Locate what a module/class defines.

Canonical: does "dog" defines "tail"? — ask(defines, subject="dog", "tail")

tmct> do dogs have tails
no module matching "dog" found in the index. Try "who touched <a module that actually has commits>" or "/describe <module>" to see what's in the index.
(this repo has no code graph — for structure, point me at a `.tmct/graph.json` with `--repo <path>` or run `npm run example:mini`; tmct doesn't index code itself.)

Goal (inferred): Locate what a module/class defines.

Canonical: does "dogs" defines "tails"? — ask(defines, subject="dogs", "tails")
```


Fix
---

`src/chat.mjs`: the factAnswer cascade already had forward yes/no readers for
IsA ("is a X a Y") and CapableOf ("can a X <verb>"), and a reverse-by-object
reader for HasA ("what has a wheel") — but no forward yes/no HasA reader. Added
lane (b2b): `DOES_HAVE_ASK_RE` ("does/do <X> have <Y>") answering yes off a
remembered `mgx:hasA` fact, mirroring the CapableOf lane's single-hit lookup
and "never a guessed no" discipline. It only diverts on a real hit, so
code-shaped queries with the same lead ("does app.mjs have tests") keep their
existing behaviour — verified byte-identical before/after for "do all dogs
have tails", "do you have a memory", and "does app.mjs have tests".

Regression tests: three new cases in `test/wiring-facts-reverse.test.mjs`
(singular yes, plural yes, code-shaped non-divert).

Known cosmetic remainder (not fixed here): the article-less variants still
print a stale "Goal (inferred): Locate what a module/class defines" line under
the correct yes-answer — the goal display reads the parse envelope, which
still carries the old `defines` reading. Small, display-only, noted for a
later iteration.

Adjacent edge found while probing, deferred to playtest 002 (stated, not
silent): "is a dog a cat" — the IsA yes/no ladder exhausts honestly, but the
downstream miss text claims "couldn't parse this as a graph question" and
suggests the exact shape the user typed. Different axis (honesty on miss), so
it gets its own iteration.


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> does a dog have a tail
yes — dog has tail (source: corpus:human /r/HasA)

tmct> do dogs have tails
yes — dog has tail (source: corpus:human /r/HasA)
```

Full suite: 2172 pass, 0 fail. CLI smoke: greets and exits 0.


## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)

Result: Pass (drift: the article-less plural form still prints the stale "defines" goal/canonical receipt under the correct yes — the cosmetic remainder already noted above)

```txt
tmct> does a dog have a tail
yes — dog has tail (source: corpus:human /r/HasA)

tmct> do dogs have tails
yes — dog has tail (source: corpus:human /r/HasA)

Goal (inferred): Locate what a module/class defines.

Canonical: does "dogs" defines "tails"? — ask(defines, subject="dogs", "tails")
```
