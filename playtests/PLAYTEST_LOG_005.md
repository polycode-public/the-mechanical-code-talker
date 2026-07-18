tmct playtest 005 — examine/talk response framing follows object type, not the verb asked
=========================================================================================

tmct version under test: 2.7.8

Area: the adventure game (Ashcombe Hall) — the shared `examine`/`talk` handler's response
phrasing, probed against every combination of {verb} x {person-typed or not}.

Axes explored this iteration: response-text framing for the two new verbs against both
NPCs and ordinary objects, in both directions.

Axes still untouched: multi-world coexistence (ashcombe-hall + spider-fly sharing one
pack); a full win-condition playthrough using only the new verbs.

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play ashcombe hall\ngo north\ngo north\nexamine the butler\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
printf 'play ashcombe hall\ntalk to the lamp\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: examine a person, talk to an object
==========================================

Expectations
------------

When the following prompts were entered:
```log
tmct> examine the butler
tmct> talk to the lamp
```

Expected: `examine`'s response reads as an inspection regardless of what's being
looked at (a plain description); `talk`'s response reads as an attempted
conversation regardless of what's being spoken to (the "doesn't have much to
say, but you know: ..." framing) — the verb the player typed should decide the
framing, not the object's type.

Actual: the goal line correctly names the verb either way ("Take a closer look
at the butler" / "Talk to the lamp"), but the response TEXT ignores which verb
was actually used and framing follows the OBJECT's type instead:

```
tmct> examine the butler
the butler doesn't have much to say, but you know: Butler is a person. ...

tmct> talk to the lamp
Lamp is a portable. Lamp is in the study.
```

`examine the butler` gets talk's framing ("doesn't have much to say") even
though the player asked to look, not talk — reads like a failed conversation
attempt to an inspection request. `talk to the lamp` gets examine's plain
digest with no acknowledgment the player tried to talk to an inanimate object
at all.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> go north
you go north. Now in the library. ...

tmct> go north
you go north. Now in the drawing-room. ... Butler is in the drawing-room. ...

tmct> examine the butler
the butler doesn't have much to say, but you know: Butler is a person. Butler is in the drawing-room. Butler works in the drawing-room.

Goal (inferred): Take a closer look at the butler.
```

```txt
tmct> talk to the lamp
Lamp is a portable. Lamp is in the study.

Goal (inferred): Talk to the lamp.
```

Fix
---

`src/services/adventure.mjs`'s shared `examine`/`talk` branch built its response
text from `person` (`isTyped(rows, object, "person")`) instead of `cmd.verb`.
Changed the framing gate to `cmd.verb === "talk"` — talking to anything (person
or object) gets the "doesn't have much to say" framing; examining anything gets
the plain digest (+ container status, when applicable — `person` still gates
that half, since a person is never a container). `talk to the lamp` reading as
mildly whimsical ("the lamp doesn't have much to say") is an acceptable, even
fitting, tone for a text adventure — the point is the verb the player typed now
actually decides the response shape.

Regression: `test/services/adventure.test.mjs` gains cases for both mismatched
combinations; `games/adventure` gains `adv-examine-person-uses-examine-framing`
and `adv-talk-to-object-uses-talk-framing`.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> examine the butler
Butler is a person. Butler is in the drawing-room. Butler works in the drawing-room.

tmct> talk to the lamp
the lamp doesn't have much to say, but you know: Lamp is a portable. Lamp is in the study.
```
