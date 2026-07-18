tmct playtest 004 — verb-synonym coverage beyond the 2-token prefix
=====================================================================

tmct version under test: 2.7.7

Area: the adventure game (Ashcombe Hall) — `VERB_SYNONYMS`' phrasing coverage,
probed for natural verb-phrase variants beyond what `PLAN_ADVENTURE_ROUTING.md`
shipped.

Axes explored this iteration: verb-phrase synonym coverage, specifically
idiomatic multi-word forms ("have a look at", "check out") the existing
2-token-prefix design structurally couldn't reach, plus two straightforward
missing 2-token entries ("chat with", "converse with").

Axes still untouched: `talk` against every NPC in the world; the room-
affordance list under compound state changes; multi-world coexistence
(ashcombe-hall + spider-fly sharing one pack); a full win-condition
playthrough using only the new verbs.

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play ashcombe hall\ngo north\nchat with the butler\nhave a look at the desk\ncheck out the desk\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: idiomatic verb phrases beyond the 2-token prefix
=======================================================

Expectations
------------

Given the player is in the library (the butler is in the drawing-room, the
desk is in the study — neither is present here):

When the following prompts were entered:
```log
tmct> chat with the butler
tmct> have a look at the desk
tmct> check out the desk
```

Expected: all three route to the adventure lane's `talk`/`examine` verbs and
decline honestly ("I don't see a butler/desk here") — the same decline
`talk to the butler` or `examine the desk` would give from the wrong room.

Actual: `chat with the butler` fell through to the ordinary conversational
miss (not in `VERB_SYNONYMS` at all). `have a look at the desk` and
`check out the desk` were WORSE — both misrouted into confident, wrong
code-graph queries:

```
no module matching "look desk" found in the index. ...
Canonical: defines "look desk" — reverse(defines, "look desk")
```
```
no module matching "out desk" found in the index. ...
Canonical: tests "out desk" — reverse(tests, "out desk")
```

This is the same class of bug `PLAN_ADVENTURE_ROUTING.md` §5 closed for
"talk to butler" pre-fix — a confident wrong answer, not an honest miss —
recurring on two phrasings that document's own fix never covered, because
`VERB_SYNONYMS`' matching only ever checked a 2-token prefix (`"have a"` /
`"check out"` themselves aren't verbs, so the check fell through entirely,
then the ordinary ask pipeline's keyword-matching latched onto the residue).

Result
------

Fail

Play test session log
----------------------

```txt
tmct> go north
you go north. Now in the library. ...

tmct> chat with the butler
I couldn't read that as a question I can answer. Try "what is a dog" for general vocabulary. Type /help for all query shapes.

tmct> have a look at the desk
no module matching "look desk" found in the index. This store holds no code index, so it records no modules or commits to look through.

Goal (inferred): Locate what a module/class defines.
Canonical: defines "look desk" — reverse(defines, "look desk")

tmct> check out the desk
no module matching "out desk" found in the index. ...
Goal (inferred): Assess test coverage.
Canonical: tests "out desk" — reverse(tests, "out desk")
```

Fix
---

`src/domain/grammar/ace.mjs`'s `resolveImperativeVerb` only ever tried a
fixed 2-token prefix against `VERB_SYNONYMS` before falling to the 1-token
checks — a hard ceiling that couldn't reach any 3+-token idiom no matter how
many entries were added. Generalized it to try prefixes from the longest
entry's own token count down to 2 (longest match wins, so a multi-word idiom
is consumed whole before a shorter prefix inside it gets a chance). Added
entries: `chat with`/`converse with` -> `talk`; `have a look at`/
`take a look at`/`check out` -> `examine`. `take a look at` wasn't itself
probed but is the same idiom family as `have a look at`, added alongside it
per this project's own "fold in the adjacent gap" convention rather than
leaving an obvious sibling case unfixed. Regression:
`test/adapters/grammar-imperative.test.mjs` gains cases for the 3-4-token
idioms; the `games/adventure` corpus lane gains
`adv-verb-synonym-multiword-idiom`.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> chat with the butler
I don't see a butler here.

tmct> have a look at the desk
I don't see a desk here.

tmct> check out the desk
I don't see a desk here.
```

All three are now the honest, room-scoped decline `talk`/`examine` already
give for any object/person that genuinely isn't present — never a code-graph
misroute, never a bare conversational miss.
