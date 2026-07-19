tmct playtest 011 — spider-fly round 2 of 5 — a THIRD agent's goal keeps naming a subject that died this same tick
====================================================================================================================

tmct version under test: 2.7.16

Area: the spider-and-fly game, following up directly on round 1's fix (`playtests/PLAYTEST_LOG_009.md`)
— that fix scrubbed a died-this-tick agent's OWN stale entry, but not other agents' text naming it.

Axes explored this iteration: chat-told positional facts combined with an extended (20+ tick) run
covering multiple eats, multiple starves (of both a fly AND a spider), egg-laying/hatching into a
third spider, and spider-vs-spider avoidance among 3 live spiders at once.

Axes still untouched: the browser page end-to-end.

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play spider and fly\n@spider the fly is east\ntick\n@fly the spider is west\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\ntick\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: a fly still "evades" a spider that starved this same tick
==================================================================

Expectations
------------

At turn 21, `spider-1` starved:
```log
Turn 21 — ... spider-1 starved; fly-8 arrived at the board edge.
```

Expected: no OTHER agent's goal line should still name spider-1 as a live, present threat in the
SAME turn's response.

Actual:
```
Goal (inferred): Fly-6 — no spider in sight — wandering; fly-7 — evading — last saw spider-1 at
cell-3-9; spider-2 — avoiding spider-3, last seen at cell-1-1; spider-3 — avoiding spider-2, last
seen at cell-1-1.
```
`fly-7 — evading — last saw spider-1 at cell-3-9` names a spider the SAME response just said
starved. Round 1's fix only handled the dying agent's OWN entry (and, for the eaten case, patched
the EATING spider's text) — it never scrubbed a THIRD agent's goal, computed at movement time
(before the ecology pass resolves deaths), that happens to reference a subject that dies later in
the same tick's ecology pass. The same class of bug, one level removed.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> tick
Turn 21 — fly-6 is now at cell-7-7; fly-7 is now at cell-1-10; spider-2 is now at cell-1-1;
spider-3 is now at cell-1-1. spider-1 starved; fly-8 arrived at the board edge.

Goal (inferred): Fly-6 — no spider in sight — wandering; fly-7 — evading — last saw spider-1 at
cell-3-9; spider-2 — avoiding spider-3, last seen at cell-1-1; spider-3 — avoiding spider-2, last
seen at cell-1-1.
```

Fix
---

`src/services/spider-fly.mjs`'s `runSpiderFlyTick`: right after `runEcologyPass` resolves, before
the existing eaten/starved-specific handling, a new generic pass builds `diedThisTick` (every eaten
fly plus every starved subject, fly or spider) and scans EVERY remaining agent's goal text for a
reference to any died-this-tick id, replacing it with `"${deadId} is gone — re-evaluating."` when
found. Runs before the existing eaten-pair handling so that handling's own nicer "just ate X"
message (set second) still wins for the eating spider, whose own pre-scrub goal also names its
prey. The match uses `(?!\d)` so "fly-1" never false-matches inside "fly-10".

Regression: `test/corpus/games/spider-fly.jsonl` gains
`sf-a-third-agents-goal-never-names-a-subject-that-died-this-tick`, seeding a spider at mass 1 next
to a fly so the spider starves on turn 1 while chasing it, asserting the fly's own goal never keeps
"evading — last saw spider-1" once spider-1 is gone.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
Turn 16 — ... fly-3 starved.
Goal (inferred): Fly-4 — trapped in an active web — can't move; fly-6 — no spider in sight —
wandering; spider-1 — fly-3 is gone — re-evaluating; spider-2 — chasing fly-4, last seen at
cell-1-2.

Turn 21 — ... spider-1 starved; fly-8 arrived at the board edge.
Goal (inferred): Fly-6 — no spider in sight — wandering; fly-7 — spider-1 is gone — re-evaluating;
spider-2 — avoiding spider-3, last seen at cell-1-2; spider-3 — avoiding spider-2, last seen at
cell-1-2.
```
Both directions confirmed: a spider's "chasing X" reference to a fly that starved, and a fly's
"evading X" reference to a spider that starved, both scrub correctly in the same turn they die.
