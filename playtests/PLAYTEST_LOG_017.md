# tmct playtest 017 — goal sentences probed as features

Version under test: 1.11.5 (working tree, post-backlog batch).
Probe recipe: fresh scratch repo per session — `S=$(mktemp -d); node bin/tmct.mjs init
--repo "$S"; printf '…\n/exit\n' | node bin/tmct.mjs chat --repo "$S"`.

Area: the plan lane's goal sentence ("the goal is that every disk rests on peg-c"),
shipped in 1.11.0 and never hostile-playtested as a feature.
Axes explored this iteration: paraphrase variation of the goal sentence.
Axes still untouched: contractions and cleft rungs of the paraphrase ladder,
passive↔active beyond UsedFor and the rule signature.

## test: the natural voicings of the goal sentence

### Expectations

**Given**: a taught one-disk domain (signature + effect + state, all passing forms).

**When**:

```txt
the goal is that every disk rests on peg-b.    (canonical — passes)
the goal is for every disk to rest on peg-b.   (infinitive complement)
i want every disk to rest on peg-b.            (want + infinitive)
i want every disk on peg-b.                    (verbless want)
```

**Expected**: the three verbed forms register the same goal; the verbless form may
honestly decline but must not mis-teach.

**Actual** (before the fix):

- infinitive form → `couldn't resolve one of the terms in this question.` (a graph
  miss with the misleading "Assess test coverage" goal line).
- want + infinitive → `I can't store a fact about "i" as a class — pronouns aren't
  things I can classify …` — a wrong-reason decline from the teach lane.
- Adjacent edge, visible on the PASSING canonical form too: every goal turn leaked a
  fuzzy-misparse canonical (`Canonical: does "goal that disk" tests "peg-b."? …` —
  "rests" repaired to "tests"). Same class as playtest 015's teach-lane leak; the plan
  lane revises its goal line but left the structural canonical standing.

Minimal pairs: "…is that X rests on Y" ↔ "…is for X to rest on Y"; want-form with and
without the infinitive verb.

### Result

Fail.

### Fix

Layer: `src/chat.mjs` plan lane (closed sibling frame, no general rule widened).

1. New `GOAL_TEACH_INFINITIVE_RE` — `(the goal is for | i want) <quantifier?> <subject>
   to <verb> <prep> <object>` — feeding the same goal-spec handler; the confirmation
   restates the that-form ("noted — the goal is that every disk rests on peg-b") so the
   normalization is disclosed and the later "done — …" check reads identically. The
   multi-sentence pre-split gate accepts the new form too.
2. The plan lane drops a canonical built from a fuzzy-repaired parse (same
   `fuzzyVerb`-gated rule the teach lane applies since playtest 015); exact parses keep
   their receipts.

Regression tests: `test/chat-goal-infinitive.test.mjs` (4 — both infinitive voicings
register and solve; a goal turn carries no fuzzy canonical; the verbless want form
declines without recording a goal).

Known remainder (named openly, not fixed here): the verbless want form ("i want every
disk on peg-b") still gets the teach lane's pronoun decline — recognizing it means
inferring the location verb, a desire-frame family of its own, left on the open-items
list.

### Retest

```txt
tmct> the goal is for every disk to rest on peg-b.
noted — the goal is that every disk rests on peg-b. Say "solve it" when the state is taught.
tmct> solve it
plan found — 1 move (shortest):
  1. move disk-1 onto peg-b
```

Goal turns (all forms) carry no Canonical line.

### Retest result

Pass. Full suite green (2374/2374); CLI smoke green.
