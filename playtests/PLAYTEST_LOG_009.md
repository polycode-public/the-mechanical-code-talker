tmct playtest 009 — spider-fly round 1 of 5 (post ecology v2) — an eaten fly's stale pre-death goal contradicts its own eaten event, same turn
==============================================================================================================================================

tmct version under test: 2.7.15

Area: the spider-and-fly game — probing the ecology v2 uplift (wander, spider-vs-spider avoidance,
dynamic webs, mass symmetry — `PLAN_GAMES_UPLIFT_V2.md` Part A) for the first time; this game has
never had a dedicated playtest edge hunt before.

Axes explored this iteration: an extended tick run (15 turns) covering wandering, web-trapping,
spider-vs-spider avoidance, egg-laying/hatching, and multiple eat/starve events in sequence.

Axes still untouched: chat-told positional facts (`@spider the fly is east`), the graphical
renderer and the web page's own Play control (browser-only, no CLI entry point).

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play spider and fly\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: the goal line contradicts the eaten event it sits beside
================================================================

Expectations
------------

At turn 15 of the extended run, `fly-5` was eaten by `spider-2`:
```log
Turn 15 — ... fly-5 is now at cell-2-1; ... fly-5 was eaten by spider-2 at cell-2-1; fly-6 arrived at the board edge.
```

Expected: the SAME response's "Goal (inferred):" summary should be consistent with the event line
right above it — fly-5 is gone, so its own entry should either be absent or reflect that, and the
eating spider's entry should say what it just did, not a now-false present-tense claim.

Actual:
```
Goal (inferred): Fly-3 — evading — last saw spider-1 at cell-3-6; fly-4 — trapped in an active web
— can't move; fly-5 — trapped in an active web — can't move; spider-1 — chasing fly-3, last seen at
cell-1-10; spider-2 — co-located with fly-5 in the web.
```
Two contradictions in the same sentence: `fly-5 — trapped in an active web — can't move` describes
an entity the response ITSELF just said was eaten one clause earlier, in the present tense as if
still on the board; `spider-2 — co-located with fly-5 in the web` makes the same mistake from the
spider's side. Root cause: `tick.agents` is built during the movement phase, before
`runEcologyPass` resolves eating for that same tick — an eaten-this-tick fly's pre-ecology goal
entry was never removed or updated once the eat actually fired.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> tick
Turn 15 — fly-3 is now at cell-1-10; fly-4 is now at cell-1-2; fly-5 is now at cell-2-1;
spider-1 is now at cell-3-7; spider-2 is now at cell-2-1. fly-5 was eaten by spider-2 at cell-2-1;
fly-6 arrived at the board edge.

Goal (inferred): Fly-3 — evading — last saw spider-1 at cell-3-6; fly-4 — trapped in an active web
— can't move; fly-5 — trapped in an active web — can't move; spider-1 — chasing fly-3, last seen at
cell-1-10; spider-2 — co-located with fly-5 in the web.
```

Fix
---

`src/services/spider-fly.mjs`'s `runSpiderFlyTick`, right after `runEcologyPass` resolves: for every
fly in `ecology.events.eaten`, delete its entry from `agents` (its own goal is moot — it's gone) and
overwrite the EATING SPIDER's goal to `"just ate ${fly} in the web."` (past tense, accurate) instead
of leaving its pre-ecology `"co-located with ${fly} in the web"` framing, which reads as a live,
ongoing state once the fly is actually dead. The same delete applies to `ecology.events.starved`.
This also cleans up the "Turn N — positions" line, which previously still listed the eaten fly's
last cell redundantly alongside the "was eaten ... at that cell" event text one clause later.

Regression: `test/corpus/games/spider-fly.jsonl` gains
`sf-eaten-fly-goal-line-never-shows-stale-post-death-state`, seeding a spider and fly co-located
inside the static web so the eat fires on turn 1, asserting the eaten fly never appears in the
position line, never shows the stale "trapped" goal, and the spider's own goal says "just ate" —
all in the same turn's response.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> tick
Turn 7 — fly-1 is now at cell-10-2; fly-3 is now at cell-1-7; spider-1 is now at cell-3-1.
fly-2 was eaten by spider-1 at cell-3-1; egg-1 was laid.

Goal (inferred): Fly-1 — no spider in sight — wandering; fly-3 — no spider in sight — wandering;
spider-1 — just ate fly-2 in the web.
```
