tmct playtest 017 — spider-fly round 5 of 5 — a hatched spider or spawned fly is invisible for its own birth tick
==================================================================================================================

tmct version under test: 2.7.22

Area: the spider-and-fly game's graphical page, driven end to end in a real headless browser — the
one axis every prior round in this game's hunt flagged and deferred.

Axes explored this iteration: `public/spider-fly.html` loaded directly in Chromium — boot render,
step/play/reset, the addressed chat teach-frame (`@spider the fly is east`), and the `?preview=1`
mode the home page's hero embeds; the mass bars' own visual width (a live check that round 4's
`playtests/PLAYTEST_LOG_015.md` fix renders correctly, not just writes correctly); the orphan-egg
scenario (a parent spider starving the exact turn its own egg is due to hatch), checked directly
against `runEcologyPass`.

Axes still untouched: none flagged as remaining for this game — this closes out the spider-fly side
of the second (10-round) hunt.

Probe recipe: a Playwright script serving the built demo site and driving `spider-fly.html`'s own
buttons directly, reading `.hud-row`/`.mass-fill` DOM state after each tick; a direct Node script
against `runEcologyPass` for the orphan-egg case.

test: a newly hatched spider or spawned fly is missing from its own birth tick
=================================================================================

Expectations
------------

Given: a live `spider-fly.html` session, stepped forward with the browser's own Step button.

When: a tick lands on a spawn turn (every third turn) or a hatch turn (three turns after an egg is
laid) — the same tick whose event text says "fly-N arrived at the board edge" or "egg-1 hatched into
spider-2".

Expected: the new individual's sprite and HUD row appear on that same turn.

Actual: stepping through 25 turns and diffing the HUD's own id list after each step, every new id
(`fly-2` at turn 3, `spider-2` at turn 10, `spider-3` at turn 20, and so on) was checked — before the
fix, none of them appeared until the turn AFTER their actual spawn/hatch turn, one full tick behind
the event text that already announced them.

Root cause: the same movement-before-ecology shape rounds 1-4 of this hunt already fixed for goal
text and mass — `runSpiderFlyTick`'s `agents` object is built during the movement loops, from the
roster of spiders/flies that existed BEFORE this tick started. `runEcologyPass` then runs afterward
and mints the new spider/fly, but nothing ever added it to the SAME tick's `agents` — so the browser
page (which redraws directly from `agents`, matching `spider-fly-viz.mjs`'s own header note that it
carries spider-fly.mjs's tick shape "unmodified") had no sprite to draw for it until the next tick's
fold picked it up naturally. Self-correcting one tick later, so never a permanent gap or a crash —
still a real, confirmed mismatch between what the event text says happened and what the board shows.

Result
------

Fail

Play test session log
----------------------

```txt
turn 3: new HUD rows this exact tick: [] (fly-2 not yet visible, despite the turn-3 spawn)
turn 4: new HUD rows this exact tick: ["fly-2"] (one tick late)
```

Fix
---

`src/services/spider-fly.mjs`: `runEcologyPass`'s spawn step now also records `events.spawnedCell`
(the existing `events.spawned` stays a plain fly-id string, unchanged, since `renderTickText` already
depends on that shape). `runSpiderFlyTick` backfills `agents` for both a hatched spider (from
`ecology.events.hatched`, which already carries `{egg, spider, cell}`) and a spawned fly (from
`events.spawned` + the new `events.spawnedCell`) right after the existing eaten/starved cleanup, so
a brand-new individual is present in the very same tick's own returned `agents` — matching the event
text that already announces it that turn.

Regression: `test/services/spider-fly.test.mjs` gains "runSpiderFlyTick: a hatched spider and a
spawned fly are both present in the SAME tick's own returned agents, not one tick late", asserting
directly against `tick.agents` on the exact spawn and hatch turns (not just the store's own facts,
which were always correct — the existing "drives lay, hatch and spawn" test already covered that
half).

The orphan-egg probe (a parent spider forced to starve the exact turn its own earlier egg is due to
hatch) turned up no separate bug: the egg hatches into a new spider at its own cell regardless of the
parent's fate, exactly as the code's own turn-gated hatch check (independent of which spider laid the
egg) already implies — not chased further, no fix needed.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
turn 3: new HUD rows this exact tick: ["fly-2"], all rows: ["fly-1","fly-2","spider-1"]
turn 6: new HUD rows this exact tick: ["fly-3"], all rows: ["fly-1","fly-2","fly-3","spider-1"]
turn 10: new HUD rows this exact tick: ["spider-2"], all rows: ["fly-3","fly-4","spider-1","spider-2"]
turn 20: new HUD rows this exact tick: ["spider-3"], all rows: ["fly-6","fly-7","spider-1","spider-2","spider-3"]
```

## Closing note — spider-fly side of the hunt

This closes the 5 planned spider-fly rounds of the second (10-round) hunt: rounds 2, 4, 6, 8 and
this one. Every finding across all five (`PLAYTEST_LOG_009.md`, `_011.md`, `_013.md`, `_015.md`, this
log) is fixed and shipped. The live browser page — mass bars, sprite positions, web rendering, the
addressed chat teach-frame, and the `?preview=1` auto-playing embed — was driven end to end this
round with no console errors beyond the one finding above, closing the last axis any prior round in
this game's hunt had flagged as untouched. Together with `playtests/PLAYTEST_LOG_016.md`, this
closes Stage 5's full 10-round requirement (5 adventure, 5 spider-fly).
