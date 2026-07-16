# tmct playtest 019 — uber retest: replay of 001–017 after the src/ re-layering

Version under test: 1.12.1 (working tree).

Recipe: every prior log's recorded probe session replayed verbatim against the current
build, each in a fresh scratch repo — `S=$(mktemp -d); node bin/tmct.mjs init --repo
"$S"; printf '…\n/exit\n' | node bin/tmct.mjs chat --repo "$S"`. This is a retest, not
an edge hunt: no area was probed for new edges and no fix was applied.

Why this run exists: since 018 the whole `src/` tree moved into five layers
(`adapters`, `domain`, `services`, `tools`, `surfaces`), the memory store, the NLP
adapter and file reads went behind injected seams, session orchestration split out of
`chat.mjs` into `src/services/chat-session.mjs`, and the package exports shrank. All of
that was meant to preserve behaviour. This run is the independent check on that intent.

Verdicts are semantic, as in 018: a fixed behaviour that still holds passes even when a
surrounding receipt line drifted. Only the old failure returning, or a new wrong or
dishonest answer on the same probes, counts as a regression.

This log is self-contained. Unlike 018 it appends nothing to logs 001–017; the probes
and their discriminating answers live in each source log's supplemental section from the
018 run, and the evidence below is trimmed to what separates a pass from a regression.

## Result

**17/17 Pass. Zero regressions.** Every fixed behaviour holds on its discriminating
answers. The re-layering drifted nothing a user can see.

| log | area | verdict |
|---|---|---|
| 001 | HasA forward yes/no | Pass (drift: stale "defines" receipt on the plural yes) |
| 002 | honesty on is-a miss | Pass (drift: teach-turn receipt) |
| 003 | negation, question + teach side | Pass (drift: disjointWith fact receipts) |
| 004 | derived forward yes/no readers | Pass (drift: same stale "defines" receipt as 001) |
| 005 | vocabulary anaphora | Pass (drift: receipts under correct bindings) |
| 006 | multi-word teach terms | Pass (drift: teach receipts) |
| 007 | mixed-source inference chain | Pass (exact, incl. the syllogise CLI recovery) |
| 008 | prepositional-verb facts + /memory | Pass (drift: "tests" receipt under correct answers; /memory clean) |
| 009 | comparatives | Pass (drift: stale "calls" receipt on the honest miss) |
| 010 | quantifiers / capability paraphrases | Pass (exact, all 8 probes) |
| 011 | genitives + bare plurals | Pass (exact, all 7 probes) |
| 012 | politeness wrappers | Pass (drift: meta receipts under unwrapped answers) |
| 013 | bare habitual declaratives | Pass (drift: stale "uses" receipt on one yes) |
| 014 | keyword-colliding terms | Pass (exact) |
| 015 | where-lane over taught locatives | Pass (drift: where-lane receipt; teach turn still clean) |
| 016 | rule-teach frame paraphrases | Pass (exact) |
| 017 | goal-sentence voicings | Pass (drift: duplicate goals) |

Every drift noted above is the same drift 018 recorded, in the same place, with the same
wording. Nothing new appeared and nothing old came back.

## The load-bearing answers, checked

The things most likely to break under a seam change are the ones that cross layers: the
store, the inference chain, the CLI, and the plan lane. All held.

The mixed-source chain (007) still cites both sources and shows its work:

```txt
tmct> is a poodle an animal
yes — poodle is a kind of dog (source: teach:chat:…); dog is a kind of animal (source: corpus:human /r/IsA); so poodle is an animal
```

The syllogise recovery (007) still works across a separate CLI invocation, which
exercises the store seam in both directions — teach in one process, derive in a second,
read back in a third:

```txt
$ node bin/tmct.mjs syllogise --repo "$S"
tmct syllogise — derived 50 entailed fact(s) (subClassOf closure, depth 32, budget 50) — budget reached, more available

tmct> is a dachshund an animal
yes — dachshund is a kind of dog (source: entailed:subClassOf); dog is a kind of animal (source: corpus:human /r/IsA); so dachshund is an animal
```

Playtest 008's storage fix holds where it matters. The predicate still carries the
preposition and `/memory` still shows the user's bytes back unrewritten — no "peg-an"
anywhere:

```txt
top facts by trust:
  disk-1 mgx:rest-on peg-a — trust 1.00, 1 source: teach:chat:…
  disk-2 mgx:rest-on peg-a — trust 1.00, 1 source: teach:chat:…
```

The plan lane (017) still compiles a taught domain and solves it end to end:

```txt
tmct> solve it
plan found — 1 move (shortest):
  1. move disk-1 onto peg-b

because — you taught me the "move onto" rule. Say "next" to make move 1, or ask "what moves are legal now".
```

Honesty on a miss (002, 003, 009) is unchanged in every voicing probed: the declines
still name what is known, still offer the teach shape, and still never guess.

## The two open findings from 018 both reproduce

Neither was fixed since, and both show up identically. Recording that they are stable,
not new:

1. **Misparse-receipt leakage on ask turns.** Fuzzy or stale Goal/Canonical receipts
   still print under correct answers on ask turns — "rests" repaired to "tests" (008),
   "bigger" to "calls" (009), a "uses" reading (013), a "defines" reading (001/004/005).
   The `fuzzyVerb` rule suppresses these on teach turns and goal turns only. Answers stay
   honest, so this is not a regression, but the receipt restates a question nobody asked.

2. **Identical goals accumulate instead of folding.** Restating one goal in three
   voicings still appends duplicates — "(2 goals held)", "(3 goals held)" — rather than
   recognizing the specs are equal. The solver is unaffected; the count misleads.

## Retest result

Pass (all seventeen). Zero code changes in this run, no test suite touched.
