tmct playtest 006 — the generic adventure opener claims a non-adventure world
==============================================================================

tmct version under test: 2.7.9

Area: multi-world coexistence — `ashcombe-hall` and `spider-fly` now share one
worlds pack (`corpus/worlds/`), probed for cross-system interference between
the adventure lane and the spider-and-fly lane.

Axes explored this iteration: whether `matchAdventureOpening`'s generic
"play X" recognizer can claim a world that was never adventure-shaped.

Axes still untouched: a full win-condition playthrough of Ashcombe Hall using
only the new verbs.

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play spider fly\nlook\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: "play spider fly" loads the wrong lane
=============================================

Expectations
------------

Given the worlds pack now ships two worlds, `ashcombe-hall` (a rooms-and-
player adventure) and `spider-fly` (two autonomous agents, no player-controlled
entity at all — `PLAN_SPIDER_FLY.md` §1's own framing):

When the following prompt was entered:
```log
tmct> play spider fly
tmct> look
```

Expected: either the dedicated spider-fly lane's own opener claims this line
(starting the actual spider/fly game), or an honest decline naming that
"spider fly" isn't an Ashcombe-Hall-shaped world — never a partially-loaded,
broken adventure session.

Actual: `matchAdventureOpening`'s generic `ADVENTURE_NAMED_OPEN_RE` matches
"play X" for ANY X, `openAdventure` finds "spider-fly" genuinely listed in the
shared pack's `provider.list()`, and loads its facts/rules into the ADVENTURE
lane — announcing spider-fly's own opening line ("a spider waits in its
web..."), which reads plausibly enough that nothing looks wrong yet. Then
`look` breaks:

```
the world has no written player position — reload it with its opening line.
```

Because spider-fly's world pack has no `player` individual at all — by
design, its board is reusable static content and `player`/`spider-1`/`fly-1`
are all minted fresh by `startSpiderFlyGame`, not shipped in the pack. The
adventure lane has no way to tell "a world shaped for me" from "a world
sharing my pack but meant for a different game entirely," so it claims the
name before the spider-fly lane (later in `runTurn`'s dispatch order) ever
gets a chance to recognize its own opener.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> play spider fly
a spider waits in its web; a fly drifts in from the edge of the board. Neither is yours to move — watch, or address one by name in chat.

Goal (inferred): Play the spider fly adventure.

tmct> look
the world has no written player position — reload it with its opening line.
```

Fix
---

`src/services/adventure.mjs`'s `openAdventure`, right after loading the named
world's payload, now checks whether the payload's own fact rows place a
`player` individual at all (`payload.facts.some(f => f.subject === "player")`).
Ashcombe Hall's shipped facts do; spider-fly's don't, by design. A world with
no starting player placement isn't shaped for the adventure lane — decline
cleanly (return `null`, the same "not necessarily an adventure ask at all"
fallthrough `adv-unknown-play-falls-through` already pins for an unrecognized
name like "chess") rather than load a broken session. Falling through lets
`runTurn`'s later `spiderFlyTurn` lane recognize its own opener and actually
start the right game.

Regression: `test/services/adventure.test.mjs` gains a case asserting a
player-less world declines and falls through; `games/adventure` gains
`adv-non-player-world-falls-through`.

A second, adjacent gap surfaced while retesting: the exact phrase "play
spider fly" (no probe of "play spider AND fly") doesn't match
`SPIDER_FLY_OPEN_RE` either — it requires "and" between spider/fly, or
nothing after "spider" at all. Dropping "and" is a natural, plausible thing
to type. Loosened `src/services/spider-fly-turn.mjs`'s opener regex
alongside the main fix rather than leave it as a second, separately-filed
gap from the same probing session.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> play spider and fly
a spider waits in its web; a fly drifts in from the edge of the board. Neither is yours to move — watch, or address one by name in chat.

Goal (inferred): Watch the spider and fly, or address one (e.g. "@spider the fly is east").

tmct> play spider fly
a spider waits in its web; a fly drifts in from the edge of the board. Neither is yours to move — watch, or address one by name in chat.

Goal (inferred): Watch the spider and fly, or address one (e.g. "@spider the fly is east").
```

Both phrasings now correctly start the spider-fly game itself, instead of
the adventure lane's broken partial load.
