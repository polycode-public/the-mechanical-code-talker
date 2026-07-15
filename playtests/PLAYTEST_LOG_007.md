
tmct playtest 007 — inference depth on taught chains
====================================================

Version under test: 1.10.11 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: how many hops the live is-a proof chase really covers, and where the
taught world is allowed to join the corpus world.

Axes explored so far: relation coverage of forward yes/no (001), honesty on
miss (002), negation (003), the derived-reader generalization (004),
anaphora (005), multi-word terms (006), inference depth (this).
Axes still untouched: quantifiers, teach-side variation, the teach/query
boundary — plus the PLAN_HANOI Phase-1R probe menu (prepositional verbs,
comparatives, hyphenated instance names, rule frames, goal sentences) queued
as the seed list for the next dispatch.


test: is a poodle an animal
===========================

Expectations
------------

Given the taught anchor and the corpus hierarchy:

```log
tmct> every poodle is a dog
noted — remembered: poodle is a kind of dog
```

When the following prompts were entered:
```log
tmct> is a poodle an animal        (taught hop + corpus hop)
tmct> every dachshund is a hound
tmct> every hound is a dog
tmct> is a dachshund an animal     (2 taught hops + 1 corpus hop)
```

Expected: yes for the poodle (one taught + one corpus premise, both
citable); for the dachshund, either a yes or an honest ceiling with a
working recovery.

Actual: the poodle question missed — the live chain chase excludes corpus
edges wholesale (a fabrication guard against PURE-ConceptNet coincidence
chains), which also blocked the everyday taught-anchor-into-corpus case even
though the corpus edge answers its own 1-hop question directly. The
dachshund question missed at the documented maxHops-2 ceiling.

Result
------

Fail (the poodle case; the dachshund ceiling is by design, with a recovery
documented below)


Play test session log
---------------------

```txt
tmct> every poodle is a dog
noted — remembered: poodle is a kind of dog

tmct> is a poodle an animal
I can't confirm that — nothing I remember says poodle is an animal. I do know: you told me: poodle is a kind of dog (source: teach:chat:…). If it's true, teach me: "poodle is a kind of animal".
```


Fix
---

`src/chat.mjs`: a MIXED-SOURCE extension of the live cax-sco/scm-sco chase,
added after the taught-only pass. Corpus isa facts may JOIN a chain when the
chain contains AT LEAST ONE operator-taught premise; a chain of only corpus
edges still never answers. Every premise is cited with its own source,
corpus ones included. The shared taught-only row filters are untouched — the
disjointness and someValuesFrom chases keep their original, narrower
discipline, and the maxHops-2 live ceiling stands.

The 3+ hop recovery already exists and works: `tmct syllogise --repo <path>`
materializes the subClassOf closure as `entailed:*` facts, after which the
same question answers through the live chase —

```txt
$ node bin/tmct.mjs syllogise --repo "$S"
tmct syllogise — derived 50 entailed fact(s) (subClassOf closure, depth 32, budget 50) — budget reached, more available

tmct> is a dachshund an animal
yes — dachshund is a kind of dog (source: entailed:subClassOf); dog is a kind of animal (source: corpus:human /r/IsA); so dachshund is an animal
```

Noted for a later round rather than changed here: there is no in-chat
`/syllogise` command, so the recovery needs the CLI; and the honest miss for
a deep chain doesn't mention the recovery.

Regression tests: two new cases in `test/wiring-facts-reverse.test.mjs`
(mixed chain answers with both sources cited; a pure-corpus chain never
answers).


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> every poodle is a dog
noted — remembered: poodle is a kind of dog

tmct> is a poodle an animal
yes — poodle is a kind of dog (source: teach:chat:…); dog is a kind of animal (source: corpus:human /r/IsA); so poodle is an animal

tmct> is a poodle a plant
I can't confirm that — nothing I remember says poodle is a plant. I do know: you told me: poodle is a kind of dog (source: teach:chat:…). If it's true, teach me: "poodle is a kind of plant".
```

Full suite: 2192 pass, 0 fail (plus 2 new regression cases). CLI smoke:
greets and exits 0.


## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)

Result: Pass (the mixed-source chain and the syllogise recovery both still hold)

```txt
tmct> every poodle is a dog
noted — remembered: poodle is a kind of dog

tmct> is a poodle an animal
yes — poodle is a kind of dog (source: teach:chat:…); dog is a kind of animal (source: corpus:human /r/IsA); so poodle is an animal

tmct> is a poodle a plant
I can't confirm that — nothing I remember says poodle is a plant. I do know: you told me: poodle is a kind of dog (source: teach:chat:…). If it's true, teach me: "poodle is a kind of plant".
```

The 3+ hop recovery replayed too (fresh repo, dachshund→hound→dog taught, then
the CLI):

```txt
$ node bin/tmct.mjs syllogise --repo "$S"
tmct syllogise — derived 50 entailed fact(s) (subClassOf closure, depth 32, budget 50) — budget reached, more available

tmct> is a dachshund an animal
yes — dachshund is a kind of dog (source: entailed:subClassOf); dog is a kind of animal (source: corpus:human /r/IsA); so dachshund is an animal
```
