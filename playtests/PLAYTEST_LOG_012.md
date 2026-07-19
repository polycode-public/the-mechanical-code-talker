tmct playtest 012 — adventure round 3 of the second hunt — the internal is-objective marker leaks into the examine digest
========================================================================================================================

tmct version under test: 2.7.17

Area: the adventure game — NPC exploration (butler/housekeeper/cook/gardener) across all six rooms,
then examining the letter itself once revealed.

Axes explored this iteration: talking to every NPC in the world in turn; the where-aside for an
NPC/object not in the current room; a meta-question about a non-existent "compare two rooms"
capability (confirmed an honest, if code-flavored, decline — a known, already-catalogued gap, not
chased further); examining the letter after unlocking the cabinet and revealing it.

Axes still untouched: chat-told positional facts feeding an NPC's own behavior (NPCs don't have a
belief model — not applicable); the drawing-room's portrait once emptied of its contents.

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play ashcombe hall\ngo north\ngo north\nopen the portrait\ntake the key\ngo south\ngo south\nunlock the cabinet with the key\nopen the cabinet\nexamine the letter\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: "examine the letter" shows a raw internal marker
=========================================================

Expectations
------------

The letter carries `mgx:is-objective true` — a new, internal-only fact this session's own auto-play
feature introduced (`PLAN_GAMES_UPLIFT_V2.md` Part B), meant to be read by the auto-play goal
inferencer only, never shown to a human player (the plan doc's own words: it "does not tell the
auto-play agent anything a human player doesn't already learn from the opening line").

Expected: `examine the letter` shows only player-facing prose, exactly as before this session's
auto-play work.

Actual:
```
Letter is a portable. Letter is in the cabinet. Letter is used for communicating.
Letter mgx:is-objective true. Letter mgx:madeOf paper.
```
A raw, unphrased triple — `Letter mgx:is-objective true.` — sits right in the middle of otherwise
normal prose, reading exactly like an internal debug leak (which it is). `mgx:madeOf` also renders
raw in this same line, but that's a separate, pre-existing gap (no curated phrase for that
predicate) — not part of this finding, not chased this round.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> examine the letter
Letter is a portable. Letter is in the cabinet. Letter is used for communicating.
Letter mgx:is-objective true. Letter mgx:madeOf paper.
```

Fix
---

`src/services/adventure.mjs`'s `VIEW_EXCLUDED_PREDICATES` (the digest's existing "hidden means
hidden" exclusion set, already covering `mgx:hidden-in`/`mgx:is-open`/the NPC schedule wiring) gains
`mgx:is-objective`. The exclusion is scoped to `worldDigestRows` only — the underlying fact rows are
untouched, so `adventure-autoplay.mjs`'s own direct fact-row read (never routed through the digest)
is completely unaffected; confirmed directly by re-running the auto-play exploration trace after the
fix and seeing identical, correct behavior.

Regression: `test/corpus/games/adventure.jsonl` gains `adv-is-objective-marker-never-leaks-into-the-
digest`, asserting the letter's digest still shows its portable/placement/used-for facts but never
the string "is-objective".

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> examine the letter
Letter is a portable. Letter is in the cabinet. Letter is used for communicating.
Letter mgx:madeOf paper.
```
