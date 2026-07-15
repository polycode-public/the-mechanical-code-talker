
tmct playtest 009 — comparatives (PLAN_HANOI Phase-1R seed 2/5)
===============================================================

Version under test: 1.10.13 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: seed 2 of the Phase-1R menu — "disk-1 is smaller than disk-2" teach
plus read-back. No comparative frame existed anywhere.

Dispatch status: this is the LAST round of this dispatch — the operator
stopped the loop here. Remaining seeds (rule-teach frames, goal sentences,
the dedicated instance-name ask-lane sweep) are unprobed; seed 3 was partly
covered for free in playtest 008.


test: disk-1 is smaller than disk-2
===================================

Expectations
------------

When the following prompts were entered on a fresh session:

```log
tmct> disk-1 is smaller than disk-2
tmct> is disk-1 smaller than disk-2
tmct> is disk-2 smaller than disk-1
tmct> which disk is smallest
```

Expected: the teach to land (or decline honestly with actionable advice);
the forward question to answer yes; the reverse question never guessed; the
superlative an honest decline (ordering inference is Phase 1R/2R work).

Actual: no comparative frame existed. The bare teach fell to the
empty-graph wall; the wrapped teach got the both-sides-ungrounded decline
whose advice CANNOT express a comparison; the question side produced a
nonsense hint — 'teach me: "remember that disk-1 smaller than is disk-2"' —
a hint-honesty violation (playtest 003's lesson recurring). No silent
garble anywhere, though: every failure was a decline.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> disk-1 is smaller than disk-2
the graph at …/.tmct/graph.json is empty — no entities to answer from yet …

tmct> remember that disk-1 is smaller than disk-2
I couldn't store that — I don't recognize "disk-1", "smaller", "than" and "disk-2" as words I know …

tmct> is disk-1 smaller than disk-2
I don't know anything about "disk-1 smaller than" yet — teach me directly, e.g. "remember that disk-1 smaller than is disk-2".

tmct> which disk is smallest
couldn't compile this compositional question (a superlative needs an entity kind (module, class, function, …)). …
```


Fix
---

`src/chat.mjs`, one closed frame, both directions:

1. **Teach** — `COMPARATIVE_TEACH_RE` ("X is <comparative> than Y", where
   the comparative slot is closed by SHAPE: an -er word, better/worse, or
   more/less + adjective — never a hand-list of adjectives). Stores
   `mgx:<comparative>-than` with a clean object; works bare and wrapped,
   article-led subjects included. `predicatePhrase` renders it back as the
   copula surface ("is smaller than"), never a 3sg fold.
2. **Ask** — `COMPARATIVE_ASK_RE`: yes iff the exact taught fact exists; the
   REVERSE direction is never a guessed answer (the frame stores no
   antisymmetry — "is disk-2 smaller than disk-1" stays a can't-confirm,
   citing the taught fact so the user sees why). The miss hint is the exact
   phrasing the teach frame accepts, so it round-trips.

Known remainders (stated): "which disk is smallest" stays an honest
compositional decline — a superlative over taught comparatives needs
transitive ordering inference, which is Phase 1R/2R interpreter territory,
not a chat-lane fix. Antisymmetry/inverse pairs ("smaller" ⇔ "bigger") are
deliberately not derived — same honesty discipline as the negation round.

Regression tests: three cases in `test/chat-generalverb-query.test.mjs`
(teach + yes round trip; reverse never guessed, fact cited; the miss hint's
own phrasing round-trips with wrapped article-led subjects).


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> disk-1 is smaller than disk-2
noted — remembered: disk-1 is smaller than disk-2

tmct> is disk-1 smaller than disk-2
yes — you told me: disk-1 is smaller than disk-2 (source: teach:chat:…)

tmct> is disk-2 smaller than disk-1
I can't confirm that — nothing I remember compares them that way. I do know: you told me: disk-1 is smaller than disk-2 (source: teach:chat:…). If it's true, teach me: "disk-2 is smaller than disk-1".

tmct> is disk-1 bigger than disk-2
I can't confirm that — nothing I remember compares them that way. If it's true, teach me: "disk-1 is bigger than disk-2".

tmct> remember that the north tower is taller than the gate
noted — remembered: north tower is taller than gate

tmct> is the north tower taller than the gate
yes — you told me: north tower is taller than gate (source: teach:chat:…)
```

Full suite: 2197 pass, 0 fail (including the 3 new regression cases). CLI
smoke: greets and exits 0.
