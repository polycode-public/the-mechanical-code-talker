# tmct playtest 018 — uber retest: replay of 001–017

Version under test: 1.12.0 (working tree).
Recipe: every prior log's recorded probe sessions replayed verbatim against the current
build, one continuous sweep, each session in a fresh scratch repo (`S=$(mktemp -d);
node bin/tmct.mjs init --repo "$S"; printf '…' | node bin/tmct.mjs chat --repo "$S"`).
This is a RETEST run, not an edge hunt: no area was probed for new edges and no fix was
applied. Verdicts are semantic — a fixed behavior that still holds passes even when
surrounding receipt lines drifted; only the old failure returning, or a new wrong or
dishonest answer on the same probes, would count as a regression.

Each of the seventeen source logs now carries its own
`## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)` section with
the trimmed replay evidence; this log is the roll-up.

## Result

**17/17 Pass. Zero regressions.** Every fixed behavior holds on its discriminating
answers.

| log | area | verdict |
|---|---|---|
| 001 | HasA forward yes/no | Pass (drift: stale "defines" receipt on the plural yes) |
| 002 | honesty on is-a miss | Pass (drift: teach-turn receipt) |
| 003 | negation, question + teach side | Pass (drift: disjointWith fact receipts) |
| 004 | derived forward yes/no readers | Pass (drift: same stale receipt as 001) |
| 005 | vocabulary anaphora | Pass (drift: receipts under correct bindings) |
| 006 | multi-word teach terms | Pass (drift: teach receipts) |
| 007 | mixed-source inference chain | Pass (exact, incl. the syllogise CLI recovery) |
| 008 | prepositional-verb facts + /memory | Pass (drift: "tests" receipt under correct answers; /memory clean) |
| 009 | comparatives | Pass (drift: stale "calls" receipt on the honest miss) |
| 010 | quantifiers / capability paraphrases | Pass (exact, all 9 probes) |
| 011 | genitives + bare plurals | Pass (exact, all 7 probes) |
| 012 | politeness wrappers | Pass (drift: meta receipts under unwrapped answers) |
| 013 | bare habitual declaratives | Pass (drift: stale "uses" receipt on one yes) |
| 014 | keyword-colliding terms | Pass (exact) |
| 015 | where-lane over taught locatives | Pass (drift: where-lane receipt; teach turn still clean) |
| 016 | rule-teach frame paraphrases | Pass (exact) |
| 017 | goal-sentence voicings | Pass (drift: duplicate goals — see below) |

Full untrimmed transcripts were captured per log during the run (scratch artifacts, not
committed); the committed evidence is each log's supplemental section.

## Two new findings (recorded, not fixed in this run)

1. **Misparse-receipt leakage on ask turns.** The one recurring drift class: fuzzy or
   stale Goal/Canonical receipts printed under CORRECT fact answers on ask turns —
   "rests" repaired to "tests" (008), "bigger" to "calls" (009), a "uses" reading (013),
   a "defines" reading (001/004/005). Playtest 015's `fuzzyVerb` rule suppresses these on
   teach turns and goal turns only; ask turns that a fact reader answers still print the
   structural misparse's receipt. Honest answers throughout, so no regression — but the
   receipt restates a question nobody asked. A coherent single edge for a future round:
   extend the fuzzy-receipt drop to fact-reader-answered ask turns.

2. **Identical goals accumulate instead of folding.** Restating the same goal in a
   different voicing ("the goal is that…", "…is for … to…", "i want … to…") appends a
   duplicate — "(2 goals held)", "(3 goals held)" — rather than recognizing the specs are
   equal. The solver is unaffected here (identical conjuncts), but the count misleads and
   a later `next`-walk goal check re-verifies the same spec N times. Candidate fix: fold
   an incoming goal spec that deep-equals one already held, and say so.

Both are named in `HANDOVER.md`'s open items.

## Retest result

Pass (all seventeen), zero code changes, suite untouched by this run.
