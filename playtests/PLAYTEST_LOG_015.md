tmct playtest 015 — spider-fly round 4 of 5 — a spider's own returned mass is stale for the very tick it eats
=============================================================================================================

tmct version under test: 2.7.20

Area: the spider-and-fly game — the value `runSpiderFlyTick` hands back to its own caller (the
chat lane and the live browser session) for the eating spider's mass, on the exact tick an eat
happens.

Axes explored this iteration: a direct probe seeding a spider and a fly on the same cell, forcing
an eat on turn 1, then comparing `tick.agents["spider-1"].mass` (the value the CLI/browser session
actually reads for that turn) against the raw `mgx:mass` facts written to the store for that same
turn.

Axes still untouched: the orphan-egg/hatch mechanic under a starved parent (surfaced this same
probing session but not itself a mass-tracking bug — no finding to log).

Probe recipe: a small Node script seeding `spider-1` at mass 5 and `fly-1` at mass 10 on the same
cell via `appendFacts`, then calling `runSpiderFlyTick` directly and comparing its returned
`agents["spider-1"].mass` against a fresh `readFactRows` of the store (not reproducible via the
ordinary chat CLI within a single glance, since the mismatch is between two representations of the
SAME tick rather than visible chat text — see Root cause).

test: the returned mass for the tick a spider eats in
========================================================

Expectations
------------

Spider at mass 5, fly at mass 10, both on `cell-2-2`. One tick: the spider decrements by 1 during
movement (5 → 4), then eats the fly, gaining the fly's own post-decrement remaining mass (10 - 1 =
9), landing at 4 + 9 = 13. `tick.agents["spider-1"].mass` — the value the CLI/browser session
actually reads for this turn — should read 13.

Actual:
```
returned agents[spider-1].mass: 4
written mass facts for spider-1: [
  {"subject":"spider-1@turn1","predicate":"mgx:mass","object":"4", ...},
  {"subject":"spider-1@turn1","predicate":"mgx:mass","object":"13", ...}
]
```
Root cause: `runSpiderFlyTick` computes `tick.agents` in two phases. The MOVEMENT phase runs first
and writes each spider's post-decrement mass (4) straight onto `agents[spiderId].mass`. The ecology
pass then runs SEPARATELY and correctly writes the true post-eat mass (13) as a fact — but it never
handed that number back to its caller, so the eaten-pair loop that already exists to fix up the
spider's GOAL line after an eat (round 3, `playtests/PLAYTEST_LOG_013.md`) had nothing to read for
mass and left the stale movement-phase value in place. The store itself was always correct — the
next tick's own fold would resolve to 13 — but THIS tick's own returned snapshot was wrong for
exactly the turn it mattered. The same movement-phase-runs-before-ecology-resolves shape already
caused the goal-line bugs fixed in rounds 1, 2 and 3 of this hunt; this is the same architectural
seam, now caught on the mass field instead of the goal text.

Result
------

Fail

Play test session log
----------------------

```txt
returned agents[spider-1].mass: 4
written mass facts for spider-1: [{"subject":"spider-1@turn1","predicate":"mgx:mass","object":"4",...},{"subject":"spider-1@turn1","predicate":"mgx:mass","object":"13",...}]
```

Fix
---

`src/services/spider-fly.mjs`'s `runEcologyPass`: the `events` object gains a
`massAfterEating: new Map()` field, populated in the eat step's per-spider loop right alongside the
existing `mgx:mass` fact write (`events.massAfterEating.set(spiderId, newSpiderMass)`).
`runSpiderFlyTick`'s existing eaten-pair loop (the one round 3 already uses to fix up the goal line)
now also sets `agents[spider].mass = ecology.events.massAfterEating.get(spider) ?? agents[spider].mass`
— reading the true post-eat total instead of leaving the movement phase's stale write in place.

Regression: `test/services/spider-fly.test.mjs` gains "runSpiderFlyTick: the eating spider's own
returned agents[].mass reflects the post-eat total this same tick, not the stale pre-eat
movement-phase value" — seeding the same 5/10 masses, asserting `tick.agents["spider-1"].mass`
equals 13 directly (this is a unit-level assertion on the raw return value, not a corpus/chat-text
lane row, since mass is never rendered into chat text for any turn — nothing in the existing
`test/corpus/games/spider-fly.jsonl` convention could express this check).

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
returned agents[spider-1].mass: 13
written mass facts for spider-1: [{"subject":"spider-1@turn1","predicate":"mgx:mass","object":"4",...},{"subject":"spider-1@turn1","predicate":"mgx:mass","object":"13",...}]
```
