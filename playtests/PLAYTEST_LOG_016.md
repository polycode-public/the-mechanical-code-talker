# tmct playtest 016 — rule-teach frames probed as features

Version under test: 1.11.5 (working tree, post-backlog batch).
Probe recipe: fresh scratch repo per session — `S=$(mktemp -d); node bin/tmct.mjs init
--repo "$S"; printf '…\n/exit\n' | node bin/tmct.mjs chat --repo "$S"`.

Area: the action-rule teach frames (signature / precondition / effect / constraint),
shipped in 1.11.0 and never hostile-playtested as features — the old boundary probes
predate the implementation.
Axes explored this iteration: teach-side paraphrase variation of the rule frames.
Axes still untouched: contractions and cleft rungs of the paraphrase ladder,
passive↔active beyond UsedFor and the rule signature, goal sentences (next iteration).

## test: the natural paraphrases of the rule-teach frames

### Expectations

**Given** (grounding teaches in a fresh store):

```txt
tmct> a disk is a kind of game piece.
noted — remembered: disk is a kind of game piece
tmct> a peg is a kind of place.
noted — remembered: peg is a kind of place
```

**When** (the canonical frame, then its three natural paraphrases):

```txt
you can move a disk onto a peg.        (canonical — passes)
you may move a disk onto a peg.        (modal sibling)
a disk can be moved onto a peg.        (passive voicing)
moving a disk onto a peg makes it rest on the target.   (pronoun effect subject)
```

**Expected**: all four store rules in the same family.

**Actual** (before the fix):

- `you may move a disk onto a peg` → `I can't store a fact about "you" as a class —
  pronouns aren't things I can classify …` — a wrong-reason decline: the real gap was
  the modal ("may" not in the frame), not the pronoun.
- `a disk can be moved onto a peg` → the graph-question miss wall.
- `moving a disk onto a peg makes it rest on the target` → the graph-question miss
  wall, with a fuzzy-misparse goal line ("Assess test coverage" — "rest" read as
  "tests"). Diagnosis found a second, invisible half to this edge: the effect frame's
  confirmation text indexed the role capture unconditionally, so even after widening
  the regex the "it" form threw inside the frame's try and fell through SILENTLY to
  the ordinary miss — a store that failed with no decline naming why.

Minimal pairs: can↔may; "makes the disk rest"↔"makes it rest"; active↔passive signature.

### Result

Fail.

### Fix

Layer: `src/chat.mjs` action-rule teach frames (closed alternations, no general rule
widened).

1. `ACTION_SIGNATURE_TEACH_RE` accepts `you (can|may) …`.
2. New `ACTION_SIGNATURE_PASSIVE_RE` — `a <class> (can|may) be <participle> <prep> a
   <class>` — minted through the same `actionLemma` authority so both voicings land on
   one rule name; an unreducible participle declines honestly (same rule as the effect
   frame's gerund guard).
3. `ACTION_EFFECT_TEACH_RE` accepts `makes (it|the <word>) …`; "it" reads as the moved
   subject class, and the confirmation echoes the resolved class ("makes the crate rest
   on the target") so the normalization is disclosed. The confirmation no longer indexes
   the optional capture, which is what silently killed the "it" form.

Regression tests: `test/chat-action-frame-paraphrases.test.mjs` (5 — modal stores the
same signature; passive stores the active rule; "it" stores subjectRole=subject with the
disclosed echo; a question lead never stores; a may+it-taught family compiles and solves
a one-move domain end-to-end).

Known remainder (named openly, not fixed here): the question side — `can you move a disk
onto a peg?` stays a graph-question miss even when that exact signature was taught. A
capability read-back over taught Rule rows is its own ask-lane shape, deferred to the
open-items list.

### Retest

```txt
tmct> you may move a disk onto a peg.
noted — remembered: you can move a disk onto a peg
tmct> a crate can be stacked onto a crate.
noted — remembered: you can stack a crate onto a crate
tmct> stacking a crate onto a crate makes it rest on the target.
noted — remembered: stacking a crate onto a crate makes the crate rest on the target
```

### Retest result

Pass. Full suite green (one unrelated serve-startup timeout, green in isolation);
CLI smoke green.

## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)

Result: Pass

```txt
tmct> you may move a disk onto a peg.
noted — remembered: you can move a disk onto a peg

tmct> a crate can be stacked onto a crate.
noted — remembered: you can stack a crate onto a crate

tmct> stacking a crate onto a crate makes it rest on the target.
noted — remembered: stacking a crate onto a crate makes the crate rest on the target
```
