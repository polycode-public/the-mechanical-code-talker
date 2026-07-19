tmct playtest 014 — adventure round 4 of the second hunt — "examine the study" while standing in the study says it doesn't exist
=================================================================================================================================

tmct version under test: 2.7.19

Area: the adventure game — examining the current room by name, and a combined "is X here"/"is X a
Y" probe across NPCs and rooms.

Axes explored this iteration: `examine <room name>` while standing in that exact room; `is the
housekeeper here` (no dedicated recognizer, correctly honest-misses — not a new finding); `is the
drawing-room a room` (a plain class-membership question, correctly answered "yes").

Axes still untouched: examining a room from a DIFFERENT room (should still decline — not tested,
low risk given the fix's scope).

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play ashcombe hall\nexamine the study\ngo north\nexamine the library\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: examining the room you're standing in
==============================================

Expectations
------------

Standing in the study, `examine the study` should show the study's own description (the same
information "look" already reveals), not decline.

Actual:
```
I don't see a study here.
```
Root cause: `visibleRoomOf(object, {...})` resolves WHERE an object is placed by reading its own
placement fact — but a room is never the SUBJECT of a placement fact, only ever the OBJECT other
things (the player, furniture, NPCs) are placed IN. So `visibleRoomOf("study", ...)` finds nothing
and can never equal `here`, and the shared examine/talk precondition check declines exactly as if
the room didn't exist — even though the player is standing in it.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> examine the study
I don't see a study here.
```
(reproduced identically for `examine the library` while standing in the library, one room later)

Fix
---

`src/services/adventure.mjs`'s shared examine/talk precondition check gains an `isCurrentRoom =
object === here` case, alongside the existing `carried` exception (a carried object also has no
room to be "visible in", by the same existing logic). When the named object IS the room the player
currently stands in, the presence check is bypassed and the ordinary digest path renders — the same
`worldDigest`/`isTyped`/`isContainer` machinery already used for every other object, unmodified. A
room is never typed `person` or a container, so the framing logic already falls through correctly
to a plain description for `examine`, and (for the rarer `talk to the study`) the same whimsical-
but-honest "doesn't have much to say" framing an inanimate object already gets
(`playtests/PLAYTEST_LOG_005.md`'s own precedent).

Regression: `test/corpus/games/adventure.jsonl` gains `adv-examine-the-current-room-shows-its-
digest`, examining both the study (turn 1) and the library (turn 3, after moving) and asserting
each shows its own room digest rather than "I don't see X here".

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> examine the study
Cabinet stands locked in the study. Desk is fixed in the study. Lamp is in the study.
Player is in the study. Study is a room. Cellar has an exit up to the study. Library has an exit
south to the study. Study has an exit down to the cellar. Study has an exit north to the library.

tmct> go north
you go north. Now in the library. ...

tmct> examine the library
Library is used for reading. Library rdfs:subClassOf place. Player is in the library. Library is a
room. Kitchen has an exit west to the library. Library has an exit east to the kitchen. Library has
an exit south to the study. Library has book. Study has an exit north to the library. Drawing-room
has an exit south to the library. Library has an exit north to the drawing-room.
```
