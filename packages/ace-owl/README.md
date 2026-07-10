# @polycode-projects/ace-owl

A deterministic, **dependency-free**, ESM parser that turns controlled-English
sentences into OWL-labelled triples — no Prolog runtime, no NLP model, no
external service. Runs anywhere JS runs (Node, a browser bundle, an edge
worker).

Nothing else like this exists as an installable, permissive JS package today.
The reference implementation of Attempto Controlled English (ACE), **APE**,
is GPL/LGPL and SWI-Prolog-native — disqualified for a permissive,
browser-capable JS product on both license and platform. This library
reimplements a small, deliberately bounded sub-fragment of ACE from the
published grammar descriptions (it does not link or vendor APE) and ships
under MPL-2.0.

## Install

```sh
npm install @polycode-projects/ace-owl
```

## Quick start

```js
import { parseAce, loadLexicon } from "@polycode-projects/ace-owl";

parseAce("every module is a unit");
// → {
//     pattern: "subClassOf",
//     triples: [{ subject: "ex:module", predicate: "rdfs:subClassOf", object: "ex:unit", kind: "rdfs:subClassOf" }],
//     residue: [],
//   }

parseAce("modules import tests");
// → { pattern: "relation", triples: [{ subject: "ex:module", predicate: "ex:imports", object: "ex:test", kind: "owl:ObjectProperty" }], residue: [] }

parseAce("every widget is a gadget"); // structurally fits, but neither word is declared
// → { pattern: "subClassOf", triples: [], residue: ["widget", "gadget"] }

parseAce("please summarize the codebase"); // doesn't fit the fragment at all
// → null
```

A **miss is a feature, not a bug.** `parseAce` either fits one of the 8
declared patterns whole, or declines (`null`, or an empty-triples result
naming the unknown words as `residue`) — it never guesses. A caller that
wants broader coverage falls through to a more tolerant strategy of its own;
this library's entire value is a *reliable, honest* floor under that.

## The lexicon is load-bearing

The grammar is only deterministic because every noun, verb (with any
preposition), adjective (with its declared type), and proper name it accepts
is **declared** in a lexicon — the parser never infers a word's part of
speech from context. `loadLexicon(extra, ns)` loads the package's committed
starter vocabulary (`src/lexicon-core.json`, a software/engineering-domain
word list — nouns like `module`/`class`/`repository`, verbs like
`import`/`depend`/`extend`, adjectives like `legacy`/`deprecated`) merged with
an optional caller-supplied block of the same shape; `extra` entries win on
conflict:

```js
const lex = loadLexicon({
  nouns: { widget: {} },
  verbs: { frobnicate: { prep: "with" } },
  adjectives: { bespoke: { type: "subclass" } },
  properNames: ["Seonix"],
});
parseAce("Seonix is a widget", lex);
```

A domain unrelated to software (cooking, law, biology…) can start from an
empty `extra` and grow its own vocabulary from scratch — the bundled core
file is a convenience starter, not a requirement of the grammar itself.

## Namespacing

Every term this library mints is a CURIE under the lexicon's own namespace:
`loadLexicon(extra, ns)`'s second argument (default `"ex:"`, exported as
`DEFAULT_NS`) is stamped onto the returned lexicon as `.ns`, and every
`ace.mjs` term-minting site reads it from there — never a hardcoded prefix.
Two independent consumers can use the exact same parser code with two
different namespaces:

```js
import { parseAce, loadLexicon } from "@polycode-projects/ace-owl";

const mine = loadLexicon(undefined, "myapp:");
parseAce("every module is a unit", mine).triples[0].subject; // "myapp:module"
```

## Public API

- **`parseAce(sentence, lexicon?) → { pattern, triples, residue } | null`**
  — parse one sentence against the 8-pattern fragment. `lexicon` defaults to
  `loadLexicon()` (the committed core, `DEFAULT_NS` namespace).
  - `pattern` — one of the 8 pattern constants below.
  - `triples` — `[{ subject, predicate, object, kind, n? }]`, a NEUTRAL
    interchange shape carrying no assumptions about how a consumer stores or
    reasons over it (see "The boundary design", below).
  - `residue` — `[]` on a clean parse; the undeclared tokens when the
    sentence fits a pattern's *shape* but uses words the lexicon doesn't
    know (triples is then empty).
- **`tokenize(sentence) → string[]`** — the whitespace tokenizer `parseAce`
  itself uses (curly quotes normalized, `,`/`;` dropped, one trailing
  punctuation run stripped).
- **`loadLexicon(extra?, ns = DEFAULT_NS) → lexicon`** — merge a caller
  block over the committed core; the no-`extra` call is cached per-`ns`.
- **`classify(word, lexicon?) → { pos, type, ... } | null`** — classify one
  word (or a two-word quantifier phrase like `"at least"`) against the
  lexicon outside of a full parse; `null` for an undeclared word.
- **`predicateOf(verbEntry, ns = DEFAULT_NS) → string`** — the URI-style
  predicate a verb lexicon entry emits: a declared `verbEntry.predicate`
  override, or `` `${ns}<3rd-person-singular lemma><Preposition?>` ``
  (`"depend"` + prep `"on"` → `` `${ns}dependsOn` ``).
- **`numberOf(word) → number | null`** / **`thirdPerson(lemma) → string`**
  — small morphology helpers `ace.mjs` uses internally, exported because
  they're independently useful.
- **`lookupNoun` / `lookupVerb` / `lookupAdjective` / `lookupProperName`**
  — direct lexicon lookups with the same plural/3sg folding `parseAce` uses.
- **`DETERMINERS` / `QUANTIFIERS`** — the closed determiner
  (`every`/`a`/`an`/`the`/`no`) and cardinality-quantifier
  (`at least`/`at most`/`exactly`) vocabularies the grammar consumes.
- **`PATTERNS`** and the 8 named constants (`PATTERN_SUB_CLASS_OF`,
  `PATTERN_TYPE_ASSERTION`, `PATTERN_RELATION`, `PATTERN_SOME_VALUES_FROM`,
  `PATTERN_CARDINALITY`, `PATTERN_DISJOINT_WITH`, `PATTERN_POSSESSIVE`,
  `PATTERN_ADJECTIVE`) — the `pattern` field's domain.

## The pattern table

`N`, `N1`, `N2`, `N3` are nouns declared in the lexicon; `VERB` is a declared
verb; `PROPERNAME` is a declared proper name.

| # | Pattern constant | Sentence pattern | OWL emission |
|---|---|---|---|
| 1 | `subClassOf` | *every N1 is a N2* | `N1 rdfs:subClassOf N2` |
| 2 | `typeAssertion` | *PROPERNAME is a N* | class assertion: `PROPERNAME rdf:type N` |
| 3 | `relation` | *N1 VERB N2* / *PROPERNAME VERBs PROPERNAME* | object property assertion (`owl:ObjectProperty` per lexicon) |
| 4 | `someValuesFrom` | *every N1 that VERBs a N2 is a N3* | `N1 ⊓ (owl:Restriction on VERB, owl:someValuesFrom N2) rdfs:subClassOf N3` |
| 5 | `cardinality` | *every N has at least / at most / exactly n N2* | `owl:minCardinality` / `owl:maxCardinality` / `owl:cardinality` restriction on the `has` property |
| 6 | `disjointWith` | *no N1 is a N2* | `N1 owl:disjointWith N2` |
| 7 | `possessive` | *N1's N2 is …* / *the N2 of N1 is …* | data or object property assertion, per the lexicon's declaration of that noun property |
| 8 | `adjective` | *every ADJ N1 is …* / *N1 is ADJ* | subclass-with-restriction or `owl:DatatypeProperty` value, per the declared adjective type |

Sentences that fit no pattern fall through — the grammar never rejects, it
just declines to emit (`null`).

## Design notes

- **The lexicon is load-bearing** (see above) — patterns 7 and 8 in
  particular are only deterministic because every noun/verb/adjective/proper
  name involved is declared.
- **This fragment is much smaller than full ACE.** Full ACE covers anaphora,
  relative clauses, queries, commands, modality, and maps to full DRS
  (Discourse Representation Structure). This library takes only the
  axiom-shaped declarative core in the table above.
- **Restriction/intersection node names are deterministic, not blank nodes.**
  The same sentence always re-emits byte-identical triples, so a
  content-addressed store built on top stays idempotent across re-assertion.
  An intersection is flattened to repeated `owl:intersectionOf` triples (one
  per member) rather than an RDF list structure.

## The boundary design (what this library does *not* do)

`parseAce` emits a **neutral triple shape** — `{ subject, predicate, object,
kind }` — that carries no assumptions about storage or reasoning. It is the
consumer's job to:

- normalize terms (CURIE-stripping, casing, whitespace) for its own storage
  convention;
- content-address / dedupe / upsert triples into whatever graph it maintains;
- decide what a `residue`-carrying miss means for its UX (surface an
  "if you mean X…" prompt, silently drop, log, …).

This keeps the library usable by *any* RDF/OWL project, not just one
particular memory store's schema.

## Development

```sh
npm test   # node --test "test/**/*.test.mjs"
```

## Provenance

Originally built inside [tmct](https://gitlab.com/polycode-projects/the-mechanical-code-talker)
(`the-mechanical-code-talker`, ROADMAP Phase 2 item 2) and extracted into this
standalone package once its lexicon/parser boundary stabilized. tmct itself
now depends on this package as a library rather than carrying its own copy.

## License

MPL-2.0. See `LICENSE`.
