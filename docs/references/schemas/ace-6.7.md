# ACE 6.7 — Attempto Controlled English, and what tmct implements of it

**Canonical source:** Attempto Controlled English, **version 6.7**,
http://attempto.ifi.uzh.ch/site/docs/ — Attempto group, University of Zurich.
Construction Rules (dated **2013-07-31**): http://attempto.ifi.uzh.ch/site/docs/ace_constructionrules.html ·
Interpretation Rules (**2013-08-01**): http://attempto.ifi.uzh.ch/site/docs/ace_interpretationrules.html ·
Lexicon Specification (**2013-07-31**): http://attempto.ifi.uzh.ch/site/docs/ace_lexicon.html
**Licence:** link + brief factual excerpt. Nothing from Attempto is committed here.
**Retrieval date:** 2026-07-17 — VERIFIED. 6.7 is the current version; the docs index lists no
later one, and the documents have not changed since 2013.
**Consumer in repo:** `src/domain/grammar/ace.mjs`, `src/domain/grammar/lexicon.mjs`,
`docs/references/schemas/ace-owl-fragment.md` (tmct's own fragment).

`ace.mjs` names ACE as its basis. This entry records what ACE actually specifies, and which parts
tmct implements. The reconciliation is checked by running the parser, not by reading it — every
verdict in the divergence table below has a probe behind it.

## ACE's framing rule

> "every ACE sentence is a syntactically acceptable English sentence, but not every English sentence
> is an ACE sentence."

## Construction rules — the section tree

1. **Words**
2. **Phrases** — noun phrases (singular/plural countable, mass, proper names, numbers, arithmetic,
   strings, sets and lists, pronouns, generalised quantifiers, measurement nouns, variables, NP
   conjunction); modifiers (adjectives, relative clauses, apposition, genitives); verb phrases
   (intransitive, transitive, ditransitive, copula, negation, negation as failure, modality,
   coordination)
3. **Declarative sentences** — simple sentences; *there is/are*-sentences; boolean formulas;
   composite sentences (coordinated, locally quantified, globally quantified, subordination →
   conditional, logical negation, negation as failure, modality, sentence subordination)
4. **Interrogative sentences**
5. **Imperative sentences**
6. **ACE texts**

A declarative sentence is defined as: "Declarative sentences are simple sentences, *there
is/are*-sentences, boolean formulas, and composite sentences."

## Lexicon

**Function words** are predefined and not user-modifiable: determiners, quantifiers, coordinators,
negation words, pronouns, query words, modal auxiliaries, the copula *be*, the Saxon genitive *'s*.

**Content words** are user-definable: nouns, verbs, adjectives, adverbs, prepositions. The entry
types are `noun_sg(Form, Symbol, Gender)` / `noun_pl` / `noun_mass`, `iv_finsg` / `iv_infpl`
(intransitive), `tv_finsg` / `tv_infpl` / `tv_pp` (transitive), `dv_*` (ditransitive, plus a
preposition argument), `adj_itr` / `adj_tr` with comparative and superlative forms, `adv`, `prep`,
`mn_sg` / `mn_pl` (measurement), `pn_sg` / `pndef_sg` (proper names).

## Quantifiers, plurals, negation

- **Quantifiers:** `a` is existential; `every` / `each` / `all` are universal. Generalised
  quantifiers are `at least`, `at most`, `more than`, `less than`, `exactly` plus a positive integer.
- **Plurals:** the default reading is **collective**. A distributive reading needs an explicit
  `each of`.
- **Negation, at three levels:** VP negation (`does not`, `is not`); negation as failure (`does not
  provably`); sentence negation (`it is false that`, `it is not true that`).

## The 15 interpretation rules

ACE's ambiguity is resolved by rule, not by statistics — the property that makes it deterministic,
and the reason tmct cites it.

1. Plurals are collective by default; distributive needs *each of*.
2. Of-constructs introduce relations, not functions.
3. Prepositional phrases modify verbs, not nouns.
4. Adverbs attach to the **preceding** verb.
5. Relative clauses modify the **immediately preceding** noun.
6. Coordinator binding order: `and` > `or` > `,and` > `,or`.
7. Sentence subordination extends to the end of the clause.
8. An if-then's then-part scope extends to the end of the coordination.
9. **`a` is existential, not universal.**
10. Local quantifier scopes open at their textual position and run to the sentence end.
11. Global quantifier scopes span the whole sentence regardless of coordination.
12. On a countable/mass overlap, the countable reading is preferred.
13. Phrasal and prepositional verbs need hyphenation to disambiguate.
14. On a transitive/ditransitive overlap, the ditransitive reading wins.
15. Anaphora resolve by accessibility, recency, specificity, reflexivity.

## What tmct implements

`ace.mjs` implements **9 sentence patterns and nothing more**, all of them **simple declarative
sentences**. The module's own contract is that missing the grammar is a feature: `parseAce` returns
`null`, or a result with empty `triples` and the unknown words as `residue`, and the interpretation
pipeline falls through to its tolerant strategies.

| tmct pattern | shape | OWL construct | ACE construction it draws on |
|---|---|---|---|
| 1 `subClassOf` | every N1 is a N2 | `rdfs:subClassOf` | simple sentence, universal quantifier |
| 2 `typeAssertion` | PROPERNAME is a N | `rdf:type` | proper name + copula |
| 3 `relation` | N1 VERB N2 | a `tmct:` object property | transitive verb |
| 4 `someValuesFrom` | every N1 that VERBs a N2 is a N3 | `owl:Restriction` + `owl:onProperty` + `owl:someValuesFrom` | relative clause (rule 5) |
| 5 `cardinality` | every N has at least/at most/exactly n N2 | `owl:minCardinality` / `owl:maxCardinality` / `owl:cardinality` | generalised quantifiers |
| 6 `disjointWith` | no N1 is a N2 | `owl:disjointWith` | *no* determiner |
| 7 `possessive` | N1's N2 is VALUE | datatype or object property assertion | Saxon genitive |
| 8 `adjective` | ADJ N / X is ADJ | `rdfs:subClassOf` or `owl:hasValue` | adjectives |
| 9 `capability` | (modal) | `mgx:capableOf` / `mgxneg:capableOf` | modal VP |

## Where tmct diverges

Every row below was produced by running `parseAce` against the lexicon, not by reading the source.

| ACE construction | tmct result | verdict |
|---|---|---|
| `a module is a file` | `subClassOf`, 1 triple, no residue | **semantic divergence** — see below |
| `there is a module` | `subClassOf`, **0 triples**, residue `["there"]` | honest miss |
| `if a module imports a test then the module is a service` | `subClassOf`, **0 triples**, residue `["if"]` | honest miss |
| `it is false that every module is a file` | `subClassOf`, **0 triples**, residue `["it","false","that","is"]` | honest miss |
| `every module imports a test and calls a service` | `null` | honest miss |
| `every module does not provably import a test` | `null` | honest miss |

**The composite sentence family lands on the miss wall, and lands there safely.** The three probes
that return a pattern all return **zero triples** and a populated `residue`, so the pipeline knows
the sentence did not parse. Sentence negation is the case that mattered most to check: `it is false
that every module is a file` stores nothing. It does not store the sentence it negates.

### The one semantic divergence: ACE interpretation rule 9

**ACE reads `a` as existential. tmct reads it as universal.**

`a module is a file` parses to `tmct:module rdfs:subClassOf tmct:file` — a universal class axiom.
Under ACE rule 9 the same sentence introduces an individual.

This is a deliberate fit to what tmct is for, not an oversight. A visitor teaching "a dog is a
mammal" means every dog, and reading it existentially would store a fact about one unnamed dog that
no later question could retrieve. `every`, `a`, `an` and `the` all route to pattern 1 for that
reason.

The cost is that tmct cannot express ACE's existential reading at all, and a sentence that means
"some particular module is a file" has nowhere to go. Pattern 2 covers the named case
(`PROPERNAME is a N`), which is the form a user reaches for anyway.

**A README that says "ACE-inspired" should say this.** The draft in `PLAN_NORMATIVE.md` §8 does.

## Deepen-next

- The **OWL ACE construction rules** document (in the same doc set) is the one that specifies ACE's
  own OWL output. tmct's fragment was derived from ACE generally; a pass against the OWL-specific
  document would settle whether patterns 4, 5 and 8 emit what ACE's own translator emits.
- ACE's interrogative sentences are specified and tmct does not use them: questions go through
  `src/domain/interpret/`, not `parseAce`. Whether the question grammar could be ACE-conformant is
  open, and ACE's query words are the place to start.
- APE (the Attempto Parsing Engine) publishes its DRS and OWL/SWRL output formats. Reading them
  would show how far tmct's readable-node stand-in (`tmct:some-imports-test` for a blank node)
  diverges from the reference translator.
