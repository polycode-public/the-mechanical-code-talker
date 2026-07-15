
tmct playtest 011 — teach-side variation (genitives and bare plurals)
=====================================================================

Version under test: 1.11.1 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: teach-side variation — the same fact phrased differently, verified
with the same query. Genitive relational teaches ("ahab is john's father",
"mary's mother is june") against the passing canonical ("ahab is the
father of john"), and bare plural membership ("dogs are animals") against
the passing singular ("a dog is an animal").

Axes explored so far: relation coverage of forward yes/no (001), honesty
on miss (002/003), forward yes/no class (004), inference depth (005),
negation (006), anaphora (007), two-word nouns + prepositional verbs
(008), comparatives (009), quantifiers/capability paraphrases (010),
teach-side variation (this). Axes still untouched: the teach/query
boundary, the politeness rungs of the paraphrase ladder.


test: ahab is john's father / dogs are animals
==============================================

Expectations
------------

When the following prompts were entered on a fresh session:

```log
tmct> ahab is the father of john      (control — passes)
tmct> ahab is john's father
tmct> mary's mother is june
tmct> who is john's father
tmct> dogs are animals
tmct> remember that dogs are animals
```

Expected: every teach surface stores the same fact its canonical phrasing
stores; the genitive query answers like "who is the father of john"; the
plural declarative stores the same subClassOf fact as "a dog is an
animal".

Actual: both genitive teaches fell to the parse wall. The genitive query
fell to the parse wall. Bare "dogs are animals" (3 words) got the
self-introduction card. Worst: the wrapped "remember that dogs are
animals" SILENTLY stored the garbled fact `dogs mgx:hasProperty animals`
("dogs is animals" on read-back) — a plural noun class stored as an
adjective property under an unsingularized subject.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> ahab is john's father
couldn't parse this as a graph question. Try: "which modules import <name>" …

tmct> mary's mother is june
still couldn't parse that — /help lists every query shape. …

tmct> dogs are animals
I'm tmct — a deterministic, offline chat assistant (no LLM). …

tmct> remember that dogs are animals
noted — remembered: dogs is animals
(memory --verbose: dogs mgx:hasProperty animals)
```


Fix
---

Four small changes, each riding an existing lane rather than a new one:

1. **Plural membership teach** — `assertCandidates` (src/chat.mjs) adds a
   rewritten candidate for "Xs are Ys(. too)": the canonical
   "every <singular X> is a/an <singular Y>" the ACE grammar already owns.
   Purely additive and inherently safe — the candidate still has to parse
   against the closed lexicon, so a false singular ("redis" → "redi")
   never stores. This also kills the hasProperty garble: the ACE candidate
   now stores before TEACH_PROPERTY_RE ever sees the sentence.
2. **The 3-word catch-all** — a bare "dogs are animals" is an unambiguous
   teach shape, but isConversational()'s ≤3-word heuristic claimed it
   first. New exemption in the conversational gate, armed only when BOTH
   sides singularize to known lexicon nouns ("these are yours" stays
   chatter). `BARE_DECLARATIVE_RE` additionally tolerates a trailing
   "too".
3. **Genitive relational teach** — `GENITIVE_RELATION_TEACH_RE` (+ the
   reversed surface): "ahab is john's father" and "john's father is ahab"
   store through the SAME predicate mint as "ahab is the father of john"
   (subject=ahab, mgx:father, object=john), so all read-backs answer all
   three phrasings identically.
4. **Genitive relational query** — "who is john's father" is a pure text
   rewrite onto RELATION_WHO_ASK_RE's own match shape (the matchWhyIsa
   approach), so the existing reverse relational dispatcher serves both
   surfaces with no second lane.

Regression tests: two genitive cases in
`test/chat-taught-relations.test.mjs` (store + both query surfaces;
reversed surface stores subject/object the right way round), four plural
cases in `test/chat-teach-quantifier.test.mjs` (bare 3-word store; the
wrapped form never stores the hasProperty garble; trailing "too"; the
exemption never claims real chatter).

Known remainder (stated): "ahab fathered john" (verb-inflected teach) and
conjunction teaches ("ahab is male and is the father of john") stay
unparsed — verb-morphology folding is a different, bigger change than
these surface rewrites; deferred openly as a future area, not silently.


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> ahab is john's father
noted — remembered: ahab fathers john

tmct> who is john's father
ahab — you told me: ahab fathers john (source: teach:chat:…)

tmct> mary's mother is june
noted — remembered: june mothers mary

tmct> who is mary's mother
june — you told me: june mothers mary (source: teach:chat:…)

tmct> dogs are animals
noted — remembered 1 fact: dog rdfs:subClassOf animal (dog counts as an animal)

tmct> cats are animals too
noted — remembered 1 fact: cat rdfs:subClassOf animal (cat is a type of animal)

tmct> is a cat an animal
yes — you told me: cat is a kind of animal (source: corpus:human /r/IsA | ace:chat:…)
```

Full suite: 2277 pass, 0 fail (including the 6 new regression cases). CLI
smoke: greets and exits 0.


## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)

Result: Pass

```txt
tmct> ahab is john's father
noted — remembered: ahab fathers john

tmct> who is john's father
ahab — you told me: ahab fathers john (source: teach:chat:…)

tmct> mary's mother is june
noted — remembered: june mothers mary

tmct> who is mary's mother
june — you told me: june mothers mary (source: teach:chat:…)

tmct> dogs are animals
noted — remembered 1 fact: dog rdfs:subClassOf animal (dog counts as an animal)

tmct> cats are animals too
noted — remembered 1 fact: cat rdfs:subClassOf animal (cat is a type of animal)

tmct> is a cat an animal
yes — you told me: cat is a kind of animal (source: corpus:human /r/IsA | ace:chat:…)
```
