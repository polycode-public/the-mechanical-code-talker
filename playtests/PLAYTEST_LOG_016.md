tmct playtest 016 — adventure round 5 of 5 — auto-play can never actually win Ashcombe Hall
============================================================================================

tmct version under test: 2.7.21

Area: the adventure game's graphical page and goal-inferring auto-play, driven end to end in a real
headless browser (the one untouched axis every prior round in this hunt flagged and deferred).

Axes explored this iteration: `public/adventure.html` loaded directly (not through the home page's
iframe) in Chromium — boot render, step, play, reset, and the `?preview=1` mode the home page's hero
embeds; letting auto-play run to completion via the Play button rather than a handful of manual
ticks.

Axes still untouched: none flagged as remaining for this game — this closes out the adventure side
of the second (10-round) hunt.

Probe recipe: a small Playwright script (styled after `e2e/pages-home.test.mjs`'s own browser
harness) that builds the demo site into a temp directory, serves it, opens `adventure.html`
directly, and drives its Play/Step/Reset buttons while watching the console and the goal line;
separately, a direct Node script loading the shipped Ashcombe Hall world and calling
`runAdventureAutoplayTick` in a loop to isolate the finding from anything browser-specific.

test: auto-play stalls having explored every room, having never found the letter
====================================================================================

Expectations
------------

Given: the shipped Ashcombe Hall world (the same one a real chat session opens), loaded into the
graphical page.

When: clicking Play and letting auto-play run.

Expected: auto-play eventually reports "carrying the letter — the adventure is won" (a full win was
already confirmed reachable by a human player in `playtests/PLAYTEST_LOG_012.md`'s own probe:
`open the portrait`, `take the key`, `unlock the cabinet with the key`, `open the cabinet`, `take the
letter`).

Actual:
```
t+7s turn=8 goal="stalled — every reachable room is already explored, and no goal was ever found."
```
Root cause: the letter sits `mgx:hidden-in cabinet`, and the cabinet `mgx:stands-locked-in study` —
reaching it needs `open the portrait` (an unlocked container elsewhere, revealing the key),
`take the key`, `unlock the cabinet with the key`, then `open the cabinet`. `runAdventureAutoplayTick`
only ever issued two kinds of command: `go <direction>` and `take <objective>`. It never opened or
unlocked anything, so a hidden object's placement fact can never resolve to a room (`roomOfSubject`
returns null for anything still `mgx:hidden-in` a closed container, by design) and the "fetch" branch
never fires. Auto-play dutifully visits all six rooms, sees the cabinet standing locked in the study
the whole time, and has no way to act on that — it can only stall. The design doc's own words for the
fetch case ("revealed by an opened container") assumed the opening itself would happen somehow, but
nothing was ever written to make it happen.

Result
------

Fail

Play test session log
----------------------

```txt
turn 1: exploring — heading down into unseen ground.
...
turn 8: exploring — heading north into unseen ground.
turn 8: stalled — every reachable room is already explored, and no goal was ever found.
```

Fix
---

`src/services/adventure-autoplay.mjs` gains a new goal branch, tried after "fetch" and before plain
"explore": **progress a known container**. Every `mgx:is-container` subject whose own placement is
exposed (its room has been visited, even though its contents stay hidden) is a candidate — a
container's presence and lock state are visible on sight, only its contents are hidden until opened.
An unlocked, still-closed one is opened outright (opening can only ever reveal more, never a wrong
guess); a locked one whose instrument (`mgx:unlocks-with`) is exposed and already carried is unlocked;
a locked one whose instrument's own room is known but not yet carried gets that instrument fetched
first, via the same fetch logic used for the main objective. Every branch reuses one small shared
helper (`stepTowardThenAct`) for "path toward a room, then act once there," rather than re-deriving
the same `findActionPath` call three times.

Regression: `test/services/adventure-autoplay.test.mjs` gains four new tests under "container
progress" — opening a bare unlocked container, unlocking-then-opening one whose key is already
carried, detouring to fetch a known-but-uncarried key first, and the full open-fetch-unlock-open-take
chain reaching a win from a cold start — plus a direct probe against the real shipped Ashcombe Hall
world and a live-browser run of `adventure.html` confirming the Play button now reaches "carrying the
letter — the adventure is won." `PLAN_GAMES_UPLIFT_V2.md`'s own design section is updated to describe
the new branch (it previously assumed a hidden object's container "revealed by an opened container"
without ever specifying what does the opening).

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
turn 1: exploring — heading down into unseen ground.
turn 2: exploring — backtracking toward unseen ground.
turn 3: exploring — heading north into unseen ground.
turn 4: exploring — heading east into unseen ground.
turn 5: exploring — heading east into unseen ground.
turn 6: exploring — backtracking toward unseen ground.
turn 7: exploring — backtracking toward unseen ground.
turn 8: exploring — heading north into unseen ground.
turn 9: in the drawing-room — opening the portrait to see what's inside.
turn 10: in the drawing-room — taking the key to unlock the cabinet later.
turn 11: heading toward the study to unlock the cabinet.
turn 12: heading toward the study to unlock the cabinet.
turn 13: in the study — unlocking the cabinet with the key.
turn 14: in the study — opening the cabinet to see what's inside.
turn 15: in the study — taking the letter.
turn 15: carrying the letter — the adventure is won.
WON
```

The live-browser retest against `adventure.html`'s own Play button confirms the same result with no
console errors:

```txt
WON at turn: 15: carrying the letter — the adventure is won.
console errors: []
```

## Closing note — adventure side of the hunt

This closes the 5 planned adventure rounds of the second (10-round) hunt: rounds 1, 3, 5, 7 and this
one. Every finding across all five (`PLAYTEST_LOG_008.md`, `_010.md`, `_012.md`, `_014.md`, this log)
is fixed and shipped; the axes each round flagged as untouched have now all been picked up by a later
round in the same set, except the browser page's own live interactivity beyond what this round drove
(clicking through the full page in an actual desktop browser by a human, as opposed to Playwright) —
a reasonable remaining gap for future manual QA, not a further automated round.
