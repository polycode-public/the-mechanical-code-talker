
tmct playtest 008 — prepositional-verb facts (PLAN_HANOI Phase-1R seed 1/5)
===========================================================================

Version under test: 1.10.12 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: seed 1 of the Phase-1R menu — "disk-1 rests on peg-a" in the teach AND
read-back directions. The seed's own warning held exactly: the poison case
was silent garble, not honest declines.

Axes explored so far (this dispatch): prepositional-verb facts (this).
Remaining seeds: comparatives, hyphenated instance names, rule frames, goal
sentences.


test: disk-1 rests on peg-a
===========================

Expectations
------------

When the following prompts were entered on a fresh session:

```log
tmct> disk-1 rests on peg-a
tmct> what rests on peg-a
tmct> what is on peg-a
tmct> does disk-1 rest on peg-a
```

Expected: the teach stores a fact whose predicate carries the preposition
and whose object is the bare "peg-a"; the read-backs answer from it.

Actual: two silent garbles and a spell-correction misfire —

1. The teach ECHOED correctly but stored `disk-1 mgx:rest` with object
   `"on peg-a"` — the meaning-bearing preposition buried inside the object,
   where no reverse read-back can ever match it.
2. `/memory` displayed the object as "peg-an": the finish() article rule's
   `\b(a|an)` matched the "a" INSIDE the hyphenated token "peg-a" whenever
   the next displayed word begins with a vowel sound ("Utterance", "A:"),
   rewriting user-quoted data — a straight violation of the rule's own
   byte-stable contract. Display-only (the stored row was clean), but it
   made the stored data LOOK corrupted, which is its own honesty failure.
3. "what rests on peg-a" — the spell-corrector read "rests" as the code
   relation "tests" and walled with a module-index miss.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> disk-1 rests on peg-a
noted — remembered: disk-1 rests on peg-a

tmct> what rests on peg-a
no module matching "peg-a" found in the index. Try "who touched <a module that actually has commits>" …
Canonical: tests "peg-a" — reverse(tests, "peg-a")

tmct> /memory (excerpt)
  disk-1 mgx:rest on peg-an
```


Fix
---

Three pieces, one seam:

1. `src/chat.mjs` — `foldPrepositionIntoPredicate`: the general-verb teach
   lane folds a leading closed-set preposition out of the object and into
   the minted predicate ("disk-1 rests on peg-a" → `mgx:rest-on` / "peg-a").
   Curated predicates (mgx:hasA, mgx:capableOf) are never suffixed.
   `predicatePhrase` renders the fold back naturally (mgx:rest-on → "rests
   on"), and both general-verb question lanes apply the SAME fold, so the
   yes/no ("does disk-1 rest on peg-a"), the open form ("what does disk-1
   rest on" — the trailing preposition now part of the captured verb), and a
   NEW reverse-by-object reader ("what rests on peg-a", listing every
   subject) all answer off the stored shape. The reverse reader only diverts
   on a real stored hit, so "what calls chat.mjs" and its code siblings are
   untouched — and a real hit outranks the "rests"→"tests" spell-correction
   wall that used to claim this phrasing.
2. `src/finish.mjs` — the article rule (both the in-span and the
   span-boundary arms) no longer treats an "a"/"an" preceded by a hyphen as
   an article, so hyphenated names ("peg-a", "option-a") are never
   rewritten. This was the "peg-an" display corruption.
3. Hyphenated/numbered instance names otherwise tokenized cleanly through
   the teach and fact lanes (seed 3 partially covered for free — disk-1 and
   peg-a round-trip through every lane touched here; the dedicated
   instance-name round remains for ask-side lanes).

Known remainders (stated): "the small disk rests on the middle disk"
(determiner-led multi-word subjects in the general-verb teach) still
declines — a known, previously-reverted widening (tier-5 cycle 4); Phase 1R
owns the real frame. "what is on peg-a" (bare copula + preposition, no
verb) still misses — "is" is deliberately excluded from the general-verb
family. "does disk-1 rest on peg-b" falls to the generic wall rather than a
specific honest miss — the general-verb yes/no lane declines rather than
closes; candidate for the shared honest-miss closer in a later round.

Regression tests: two chat-level cases in
`test/chat-generalverb-query.test.mjs` (three-direction round trip; no
fabricated yes), one finish golden in `test/finish.test.mjs` (hyphenated
name survives the article rule).


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> disk-1 rests on peg-a
noted — remembered: disk-1 rests on peg-a

tmct> disk-2 rests on peg-a
noted — remembered: disk-2 rests on peg-a

tmct> does disk-1 rest on peg-a
yes — you told me: disk-1 rests on peg-a (source: teach:chat:…)

tmct> what does disk-1 rest on
you told me: disk-1 rests on peg-a (source: teach:chat:…)

tmct> what rests on peg-a
you told me: disk-1 rests on peg-a (source: teach:chat:…)
you told me: disk-2 rests on peg-a (source: teach:chat:…)

tmct> /memory (excerpt)
  disk-2 mgx:rest-on peg-a — trust 1.00, 1 source: teach:chat:…
```

Full suite: 2194 pass, 0 fail (plus 3 new regression cases). CLI smoke:
greets and exits 0.
