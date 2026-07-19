tmct playtest 013 — spider-fly round 3 of 5 — a spider eating two flies in one tick only credits the last one in its own goal line
====================================================================================================================================

tmct version under test: 2.7.18

Area: the spider-and-fly game — a targeted edge case following the same "goal line vs. the real
event" family rounds 1 and 2 fixed, this time for a spider eating MORE than one fly in the same tick.

Axes explored this iteration: the graphical renderer's static shell (confirmed no dynamic state
embeds at render time, by design — the page loads a live client-side session, matching the pattern
already documented in `spider-fly-viz.mjs`'s own header comment); a direct API test forcing two
flies onto the exact same cell as a spider inside the static web, so both get eaten in one tick.

Axes still untouched: the browser page's own live interactivity end-to-end.

Probe recipe: a small Node script seeding two flies co-located with a spider via `appendFacts`, then
calling `runSpiderFlyTick` directly (not reproducible via the ordinary chat CLI, since natural
gameplay rarely lands two flies on the exact same cell as each other in the same tick — a
deliberately constructed edge case, not a randomly-hit one).

test: the spider's goal line drops the first of two flies it ate
====================================================================

Expectations
------------

Two flies (`fly-1`, `fly-2`) both sitting on the spider's own cell inside the static web zone; a
tick fires:

```
ecology.eaten: [{"fly":"fly-1", ...}, {"fly":"fly-2", ...}]
```

Expected: the spider's own goal line should credit BOTH flies it ate this tick, matching what the
"Turn N — ..." event text already correctly lists.

Actual:
```
spider-1 goal: just ate fly-2 in the web.
```
The event text (`renderTickText`, which iterates `eco.eaten` directly) already correctly says
"fly-1 was eaten by spider-1 ...; fly-2 was eaten by spider-1 ..." — both named. But the goal-line
patch from round 1 (`playtests/PLAYTEST_LOG_009.md`) iterates the SAME eaten-pairs list and
OVERWRITES `agents[spider].goal` once per fly, so only the LAST eaten fly survives in the summary —
the first is silently dropped from that one line, even though nothing else about it is wrong or
lost (the fact writes, the mass transfer, and the main event text are all correct for both flies).

Result
------

Fail

Fix
---

`src/services/spider-fly.mjs`'s `runSpiderFlyTick`: group `ecology.events.eaten` by spider FIRST
(a `Map(spiderId -> flyIds[])`) instead of assigning the goal once per eaten pair, then set each
spider's goal to `"just ate ${flyIds.join(" and ")} in the web."` — `"just ate fly-1 in the web."`
unchanged for the single-fly case, `"just ate fly-1 and fly-2 in the web."` for a double (or more)
eat.

Regression: `test/corpus/games/spider-fly.jsonl` gains
`sf-spider-eating-two-flies-same-tick-credits-both-in-its-goal`, seeding two flies on the spider's
own cell and asserting both appear in the eaten-event text AND both are named in the goal line.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
ecology.eaten: [{"fly":"fly-1","spider":"spider-1","cell":"cell-2-2"},{"fly":"fly-2","spider":"spider-1","cell":"cell-2-2"}]
spider-1 goal: just ate fly-1 and fly-2 in the web.
```
