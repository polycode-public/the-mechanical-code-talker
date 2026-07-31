tmct playtest 023 — research round 1 (volcano) — the optimistic isa scan bridges clauses
========================================================================================

tmct version under test: 2.11.6

Area: the research capability (`research <topic>` over Simple English Wikipedia) — fact
extraction quality on an unseeded everyday topic, hunting greedy objects, nonsense relations,
missed useful facts, and confused facts.

Axes explored this iteration: `research volcano` plus three `research next` steps (List of
active volcanoes, Earth, Great Rift Valley) in one session; per-article storage inspected via
read-back and `optimisticTriples` run directly over the fetched summaries, sentence by
sentence.

Axes still untouched: deeper queue walks; the taught-vs-researched trust interplay; violin and
glacier (rounds 024-025).

Probe recipe:

```bash
SCRATCH=$(mktemp -d)
printf 'research volcano\nresearch next\nresearch next\nresearch next\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
printf 'what do you know about earth\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
node -e '…optimisticTriples(sentence)…'   # per-sentence extractor replay
```

Correct behavior seen first: "volcano ⊑ mountain", "earth ⊑ planet", "great rift valley ⊑
trench" all stored with article provenance and read back with citations; "is a volcano a
mountain" answers yes.

test: three confused facts from one real summary — the entity scan crosses clause boundaries
============================================================================================

Expectations
------------

Given the real Earth summary from Simple English Wikipedia, When the optimistic isa tier reads
it, Expected: either a correct class-membership triple or nothing per sentence.

Actual (extractor replay, verbatim):

```txt
[{"subject":"life","predicate":"rdfs:subClassOf","object":"earth"}] <- One big reason life can exist here is that Earth has a lot of water…
[{"subject":"water","predicate":"rdfs:subClassOf","object":"ocean"}] <- Most of Earth's water is in the oceans…
[{"subject":"land","predicate":"rdfs:subClassOf","object":"continents"}] <- Most of this land is grouped into large continents…
```

"life is a kind of earth" then propagated through entailment to "life is a kind of planet" —
a confused fact breeding more. The module's own docblock promises the entity scan "never
crosses a clause", but the stop set was punctuation only, so the nearest-noun walk crossed
verbs ("can exist"), prepositions ("is in"), participles ("is grouped into") and subordinators
("is that") freely.

Result
------

Fail

Fix
---

`src/services/extract-facts.mjs`, scoped to the copula (isa) branch of the POS tier: the
entity scan now voids the read when it would cross VERB, AUX, ADP, SCONJ or CCONJ — a clean
copula frame allows only determiners/adjectives/adverbs/numerals between each entity and the
copula. The relation-verb tier and the lexical fallback are untouched. All three garbles now
extract nothing; the clean frames ("Earth is the third planet…", "A volcano is a mountain
that…") survive unchanged.

Two findings recorded in NEXT.md, not fixed this round: the one-triple-per-sentence cap drops
real facts a summary offers ("has lava coming out from a magma chamber", "formed by the
movement of tectonic plates" — the copula wins the sentence and the rest is skipped), and the
research queue is session-local while the reply promises "'research next' fetches the next
one" — a new CLI session answers "no research is running".

Regression: `test/adapters/extract-facts-from-text.test.mjs` gains the clause/preposition/
participle guards plus the two clean-frame survivors.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
[] <- One big reason life can exist here is that Earth has a lot o
[] <- Most of Earth's water is in the oceans, which cover about 71
[] <- Most of this land is grouped into large continents, like Nor
[{"subject":"earth","predicate":"rdfs:subClassOf","object":"planet"}] <- Earth is the third planet from the Sun…
[{"subject":"volcano","predicate":"rdfs:subClassOf","object":"mountain"}] <- A volcano is a mountain that has lava…
[{"subject":"rift","predicate":"rdfs:subClassOf","object":"trench"}] <- The Great Rift Valley or East African Rift is…
[{"subject":"dog","predicate":"rdfs:subClassOf","object":"animal"}] <- A dog is an animal.
```
