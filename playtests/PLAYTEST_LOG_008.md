tmct playtest 008 — adventure round 1 of 5 (post rule-shape retrofit) — a direct "is X open" question reports a known-false state as an epistemic gap
================================================================================================================================================

tmct version under test: 2.7.14

Area: the adventure game (Ashcombe Hall) — probing the taught fact-value rule-shape retrofit for
open/close (landed earlier this session) fresh, since it's genuinely new code.

Axes explored this iteration: a full win-condition playthrough using the retrofitted open/close/
unlock chain; adversarial re-open/re-unlock/re-close probing of the same state machine; verb
synonyms combined with the retrofitted state; a direct status question ("is the cabinet open")
against the container's own known boolean state.

Axes still untouched: the new adventure-viz graphical renderer and the goal-inferring auto-play
mode (neither has a chat-CLI entry point by design — a dedicated round drives them directly via
Node instead of this probe recipe).

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play ashcombe hall\ngo north\ngo north\nopen the portrait\npick up the key\ngo south\ngo south\nunlock the cabinet with the key\nhave a look at the cabinet\nopen the cabinet\nshut the cabinet\nis the cabinet open\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: "is the cabinet open" after closing it
==============================================

Expectations
------------

When the following prompt was entered right after closing a cabinet that had just been opened:
```log
tmct> is the cabinet open
```

Expected: an honest, direct answer reading the container's own known state — "no, the cabinet is
closed" — since the taught rule-shape retrofit's `close` effect had just written `mgx:is-open =
"false"` for exactly this reason.

Actual:
```
I don't have a fact saying the cabinet is open.
```
Not FALSE, but misleading: this phrasing reads as an epistemic gap ("I don't know"), when the
truth is fully known and NEGATIVE (a `mgx:is-open = "false"` fact is present) rather than absent.
The SAME state, asked via "look"/"examine", already phrases correctly — `containerStatusPhrase`
reads the identical `state.openness` fold and says "the cabinet is closed." plainly. Only the
direct yes/no question routed through the generic ask engine, which has no mapping from the
adjective "open" to the datatype predicate `mgx:is-open` (a predicate this session's own rule-shape
retrofit introduced), so it never even looked at the fact that settles the question.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> unlock the cabinet with the key
you unlock the cabinet with the key. ...

tmct> have a look at the cabinet
Cabinet is a furniture. Cabinet is fixed in the study. the cabinet is closed.

tmct> open the cabinet
you open the cabinet — inside: the letter. ...

tmct> shut the cabinet
you close the cabinet. ...

tmct> is the cabinet open
I don't have a fact saying the cabinet is open.
```

Fix
---

`src/services/adventure.mjs` gains `WORLD_IS_OPEN_RE` + `worldOpennessAnswer`, a new mid-game aside
recognizer styled exactly after the existing `WORLD_WHERE_RE`/`worldWhereAnswer` pair: it matches
"is (the/a/an) X open/closed/shut", folds the world, and reads `state.openness.get(x)` — the SAME
fold `containerStatusPhrase` already reads for "look"/"examine" — directly. When the container has
no openness fact at all (never opened/closed this session), it returns null so the ordinary honest-
miss lane still answers, unchanged; that case is genuinely unknown, not a bug. Wired into the same
turn-dispatch point as `worldWhereAnswer`, right after it.

Regression: `test/corpus/games/adventure.jsonl` gains `adv-is-open-aside-reads-the-known-state`,
covering the portrait (open, answered "yes") and the cabinet across open → close → both
"open"/"closed" phrasings of the same question, so both the true and false paths, and both
question forms, are pinned.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> is the portrait open
yes — the portrait is open.

tmct> is the cabinet open
[right after unlock, before ever opening it]
I don't have a fact saying the cabinet is open.
[correct — genuinely unknown at this point, no is-open fact has ever been written]

tmct> open the cabinet
you open the cabinet — inside: the letter. ...

tmct> is the cabinet open
yes — the cabinet is open.

tmct> close the cabinet
you close the cabinet. ...

tmct> is the cabinet open
no — the cabinet is closed.

tmct> is the cabinet closed
yes — the cabinet is closed.
```
