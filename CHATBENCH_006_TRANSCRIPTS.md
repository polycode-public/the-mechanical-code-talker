# CHATBENCH_006 — transcript appendix (discriminating transcripts first)

Verbatim from `chatbench/results/raw/run-cycle-006/product-a.jsonl`. The multi-turn discourse and
assert-recall cases that cycle 006 moved.

## Multi-turn discourse + counting (B1 disc+count, 0/25 → 25/25)

### g-b1-disc-count-7 (`via:composed`)
```
Q: which classes inherit from Base
A: in app/lib/b.mjs there is Widget.
Q: count them
A: 1 class.
```
"count them" resolves against the prior turn's result set instead of failing with "I can't count of".
The referent from the previous answer is carried into the count.

## Assert-recall at C1, unlocked by the lexicon (2/25 → 25/25)

### g-c1-assert-20 (`via:fact`)
```
Q: every class is a category
A: noted — remembered 1 fact: class rdfs:subClassOf category
Q: every module is a part
A: noted — remembered 1 fact: module rdfs:subClassOf part
Q: what is a category
A: you told me: class is a kind of category (source: ace:chat:<session>@<ts>)
```
The object nouns "category" and "part" now parse (they were admitted to the ACE lexicon this cycle),
so the asserts land as facts and the later turn recalls them with provenance. The recall machinery
was already in place from cycle 005; the lexicon was the whole gate.

## Discourse continuation ("what about X")

`what does e.mjs import` → `what about c.mjs` now answers as if asked `what does c.mjs import`,
rewriting to the prior turn's shape with the new subject. The record keeps the user's literal words.
