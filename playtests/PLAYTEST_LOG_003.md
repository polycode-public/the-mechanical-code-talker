tmct playtest 003 — examine a carried object
=============================================

tmct version under test: 2.7.6

Area: the adventure game (Ashcombe Hall) — the new `examine`/`talk` verbs
`PLAN_ADVENTURE_ROUTING.md` shipped this session, probed for edges that
document didn't cover.

Axes explored this iteration: `examine` against every placement state an
object can be in (visible in a room, inside an opened container, carried by
the player).

Axes still untouched: `talk` against every NPC in the world; the room-
affordance list under compound state changes; multi-world coexistence
(ashcombe-hall + spider-fly sharing one pack); a full win-condition
playthrough using only the new verbs.

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play ashcombe hall\ngo north\ngo north\nopen the portrait\nexamine the key\ntake the key\nexamine the key\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: examine the key after taking it
======================================

Expectations
------------

Given this previous answer:

```log
tmct> open the portrait
you open the portrait — inside: the key. ...
```

When the following prompts were entered:
```log
tmct> examine the key
tmct> take the key
tmct> examine the key
```

Expected: the first `examine the key` (key still in the opened portrait)
describes it; the second `examine the key` (key now carried) ALSO describes
it — a player should be able to examine something in their own inventory.

Actual: the first `examine the key` describes it correctly. The second, after
`take the key`, declines with "I don't see a key here." — the exact dead-end
shape `PLAN_ADVENTURE_ROUTING.md` §1 named for `take`, now showing up on
`examine` instead, for the one placement state that document's own worked
examples never carried an object into: player inventory.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> the adventure begins. You are in the study of Ashcombe Hall. Somewhere in this house is a letter meant for you. Say "look" to look around, "go north" (or south, east, west, up, down) to move, and "stop playing" to end the game.

tmct> go north
you go north. Now in the library. ...

tmct> go north
you go north. Now in the drawing-room. ... Portrait is fixed in the drawing-room. You can: go south, talk to butler, open portrait.

tmct> open the portrait
you open the portrait — inside: the key. ... You can: go south, talk to butler, take key.

tmct> examine the key
Key is a portable. Key is in the portrait. Key is used for opening a lock. Key mgx:partOf lock and key. Lock has key.

tmct> take the key
you take the key. ... You can: go south, talk to butler.

tmct> examine the key
I don't see a key here.
```

Fix
---

`src/services/adventure.mjs`'s shared `examine`/`talk` branch gated presence
on `visibleRoomOf(object, {rows, state}) !== here` — the same check `take`
uses to find objects in the current ROOM. `visibleRoomOf` explicitly returns
`null` for a carried object ("carried, not on show in a room") since that
function's whole job is room-visibility, not player-possession. `talk` never
needs a carried exception (NPCs aren't portable), but `examine` does: a player
should be able to look at what they're holding. Added a `carriedByPlayer`
check (the same helper `drop`/`give`/`unlock` already use) as an alternate
pass condition for `examine` specifically, before the room-visibility decline.
Regression: `test/services/adventure.test.mjs` gains a case for `examine`
after `take`; the `games/adventure` corpus lane gains
`adventure-examine-carried-object`.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> take the key
you take the key. ...

tmct> examine the key
Key is a portable. Key is used for opening a lock. Key mgx:partOf lock and key. Lock has key.
```
