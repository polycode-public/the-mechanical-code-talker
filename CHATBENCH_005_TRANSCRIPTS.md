# CHATBENCH_005 — transcript appendix (discriminating transcripts first)

Verbatim from `chatbench/results/raw/run-cycle-005/product-a.jsonl`. The cases where cycle-005
differs from cycle-004 — the combo composition and multi-turn assert-recall made visible.

## Lever 1 — B1 combo: negation composing with anaphora (the headline, 0/5 → 5/5)

### g-b1-pron-neg-16 (`via:composed`)
```
Q: which modules import app/lib/b.mjs
A: app/functions/d/handler.mjs.
Q: what doesn't it import
A: app/lib/b.mjs, app/lib/c.mjs, app/functions/d/handler.mjs, app/lib/e.mjs,
   app/lib/f.mjs, scripts/g.mjs and app/unit-tests/b.test.mjs.
```
"it" resolves to the focus from the prior turn (`app/lib/b.mjs`), and the forward-negation frame
computes the set complement of what b.mjs imports — the two operators compose where in cycle-004 the
combined query died. This is the "pairing of missing verbs" gap closing.

## Lever 2 — assert-recall across turns (B2 assert 0/5 → 2/5)

### g-b2-assert-8 (`via:fact`)
```
Q: every method is a unit
A: noted — remembered 1 fact: method rdfs:subClassOf unit
Q: what is a unit
A: you told me: method is a kind of unit (source: ace:chat:<session>@<ts>)
```
The fact declared in the first turn is recalled in a later turn from remembered memory, cited with
its provenance. (The C1 assert-recall phrasings remain a miss — a cycle-006 lever.)

## Lever 3 — grain-aware counting (spillover to C2 / temporal)

Counting now reads symbol grain when the subject is a symbol — "how many commits touched
Widget.render" → 1 (was 0). The grain-consistency also lifted C2 relative-embedded (0/5 → 3/5) and
temporal cells by one each.

## Lever 5 — safe grammar rules, confirmed inert on the corpus

`terminal-punctuation` and `subject-verb-agreement` are live but fired on **zero** product answers
(no doubled sentence-stops, no "there is N" existential mis-agreement across 451 answers) — they fix
defects tmct doesn't currently emit, so they carry zero byte cost and stand ready. Capitalisation and
list punctuation stay parked for a judged A/B in cycle 006.
