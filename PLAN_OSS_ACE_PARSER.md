# PLAN_OSS_ACE_PARSER.md — extract tmct's ACE-OWL parser into a standalone MPL-2.0 library

A Phase-LATER workstream plan (operator, 2026-07-05), from the dependency audit's publish-not-replace
finding. `src/grammar/ace.mjs` is a pure-JS, ESM, dependency-free parser that turns controlled-English
sentences into OWL-labelled triples — and nothing like it exists as an installable JS package. This plan
extracts it out of tmct into its own repository and npm package, and settles the seam between the
domain-agnostic parser and tmct's memory-specific consumption of it.

This is the **same move `PLAN_CHAT_EXTRACTION.md` made, one level down.** That plan pulled `seonix chat`
OUT of the seonix core into its own repo; this one pulls the ACE parser OUT of tmct into its own package.
There, chat depended back on `@polycode-projects/seonix` as a library; here, tmct depends back on the
extracted `ace-owl` as a library. Extraction, not fork; the host becomes a consumer.

## Context — what the parser is today

Built in ROADMAP Phase 2 item 2, backed by `docs/references/schemas/ace-owl-fragment.md`:

- **`src/grammar/ace.mjs`** — a deterministic recursive-descent parser over the 8 controlled-English
  sentence patterns (subClassOf, typeAssertion, relation, someValuesFrom, cardinality, disjointWith,
  possessive, adjective). `parseAce(sentence, lexicon) → { pattern, triples, residue } | null`. No NLP
  dependency: tokenization is whitespace + one trailing-punctuation strip; morphology is the lexicon's
  suffix fold. Fitting a pattern is a strong signal; missing is a **feature** (`null`, or an empty-triples
  result carrying the unknown words as `residue`), and tmct's pipeline falls through to tolerant strategies.
- **`src/grammar/lexicon.mjs` + `lexicon-core.json`** — the load-bearing declared lexicon and its loader.
  The grammar is only deterministic because every noun, verb (+ any preposition), adjective (+ declared
  type), and proper name is DECLARED; tmct never guesses a word's category. `loadLexicon(extra)` merges a
  caller-supplied block over the committed software-domain starter (user entries win).
- **`docs/references/schemas/ace-owl-fragment.md`** — the pattern table (the 8-row grammar↔OWL map). This
  becomes the extracted package's README/docs.

The reference implementation of ACE, **APE**, is GPL/LGPL + SWI-Prolog native — disqualified for a
permissive, browser-capable JS product on both license and platform.

## Why this is worth open-sourcing (the gap it fills)

Per `PLAN_DEPENDENCY_STRATEGY.md`, this is the strongest publish-not-replace candidate. No permissive,
ESM, browser-capable, npm-installable ACE→OWL controlled-natural-language parser exists in JS. The
RDF-JS / semantic-web community (the `rdfjs`/N3 family the dep-strategy plan pre-cleared) has excellent
serialization, stores, and reasoners — but **no controlled-NL front-end**: nothing that takes English a
human can write and emits OWL axioms, without a Prolog runtime. tmct's parser is exactly that, and it is
pure-JS and dependency-free. Publishing it fills a real ecosystem gap and raises tmct's profile as the
project the parser came from.

## What moves vs what stays

- **Moves (into `ace-owl`):** `ace.mjs` (the parser), `lexicon.mjs` + `lexicon-core.json` (the declared
  lexicon + loader, re-cast as a domain-agnostic base with a software-domain starter overlay), the
  ACE-OWL pattern docs, and the parser's own unit tests.
- **Stays in tmct:** `src/grammar/assert.mjs` — the memory bridge / write path (`assertSentence` →
  `appendFact`) is tmct-specific and consumes triples; it stays. The `src/interpret/strategies/` ACE
  adapter (the Phase 2 pipeline seam that treats a grammar fit as a high-confidence strategy result)
  stays. `normFactTerm` / `appendFact` normalization (`src/memory/core.mjs`) stays — **the consumer
  normalizes.** Everything that stores or reasons over triples is tmct's.
- tmct depends on `ace-owl` as a library, exactly as chat depends on seonix.

## The package surface

Propose **`ace-owl`** (unscoped, community-facing) or **`@polycode-projects/ace-owl`** (scoped, safe from
collision). npm-collision risk on the bare name is real and is an **operator decision** at publish time;
default to the scope if the bare name is taken or ambiguous. The surface:

- `parseAce(sentence, lexicon) → { pattern, triples, residue } | null` — unchanged signature and contract.
- `loadLexicon(extra) → lexicon` — merge a caller block over the neutral base.
- The **8 pattern constants** exported as named values (the `pattern` field's domain).
- The **triple shape** as the documented interchange type (below).
- Helpers already public and worth exporting: `tokenize`, `classify`, `predicateOf`, `numberOf`.

## The boundary design (the clean seam)

The parser must emit a **NEUTRAL triple shape** — `{ subject, predicate, object, kind }` — that carries no
tmct-memory assumptions. Two things make this real:

1. **De-hardcode the namespace.** `ace.mjs` today bakes in the `tmct:` CURIE prefix (`tmct:${lexeme}`,
   readable restriction node names like `tmct:some-imports-test`). The library must take the term prefix as
   a parameter/lexicon field (default e.g. `ex:` or a caller-supplied namespace); tmct passes `tmct:` and
   gets byte-identical output to today. This is the one code change extraction forces.
2. **The consumer normalizes.** tmct's `normFactTerm` (CURIE-stripping, casing) and `appendFact`
   content-addressing stay on tmct's side. The library emits stable, deterministic string triples; what a
   consumer does with them (store, normalize, reason) is not the library's concern. This keeps `ace-owl`
   usable by ANY RDF/OWL project, not just tmct.

**RDFJS-quad value-add (optional adapter).** The dep-strategy plan pre-clears N3.js at the I/O edge. The
library can offer an optional adapter emitting RDFJS quads (via N3.js) from the neutral triples — a direct
bridge into the semantic-web toolchain that would make `ace-owl` a first-class citizen of that ecosystem.
Keep it a separate entry point / optional peer dep so the core parser stays zero-dependency.

## Publishing mechanics

- **License MPL-2.0**, matching tmct — file-level copyleft is fine for a library and share-friendly.
- Its own **repo, CI, README, docs, semver.** The `ace-owl-fragment.md` pattern table becomes the docs; the
  README leads with "controlled English → OWL triples, in the browser, no Prolog."
- **The lexicon ships as extensible data:** a domain-agnostic neutral base plus the software-domain starter
  as an overlay, with `loadLexicon(extra)` the documented extension path. This is the generalization from
  tmct's tech-domain lexicon to a parser any domain can drive with its own vocabulary.

## Why gated on Phase 8

`PLAN_REPOSITORY_INTERFACE.md` (Phase 8) settles how tmct consumes external libraries cleanly — the
library-surface discipline, capability negotiation, the named/versioned boundary. Extract the ACE parser
**once that boundary pattern exists**, so `ace-owl` is the **second proof of the same seam**: the first is
seonix inverting into a tmct user; this is tmct depending outward on an extracted parser. Doing it before
Phase 8 would invent the boundary discipline twice.

## Sibling publish candidates (follow-on, lower priority)

Per the dep-strategy plan, two other home-grown pieces could follow the same path **if demand appears**:
the **bounded-Damerau fuzzy matcher** (`interpret/fuzzy.mjs`, transposition-aware + tie-refusal) and the
**PageRank + IDF block ranker** (`memory/blocks.mjs`). Both are lower priority than the ACE parser, because
both DO have permissive JS alternatives — the ACE parser is uniquely gap-filling, which is why it goes first.

## First steps (when this track opens)

1. Confirm Phase-8's library-surface boundary is settled (this plan's gate).
2. De-hardcode the `tmct:` prefix in `ace.mjs` into a namespace parameter/lexicon field, `npm test` green
   with tmct passing `tmct:` for byte-stable output.
3. Split the lexicon into a neutral base + software-domain starter overlay; confirm `loadLexicon(extra)`
   round-trips tmct's current behaviour.
4. Stand up the `ace-owl` repo (MPL-2.0, CI, README from the pattern table); move `ace.mjs`, `lexicon.mjs`,
   `lexicon-core.json`, and the parser tests; publish 0.1.0.
5. Make tmct depend on `ace-owl`; keep `assert.mjs`, the interpret strategy adapter, and normalization in
   tmct; delete the moved files, re-import from the package, `npm test` green.
6. (Optional) ship the RDFJS-quad adapter as a separate entry point.

## Open questions (genuinely open)

- **Does a domain-agnostic lexicon weaken tmct's tech-domain tuning?** Likely tmct ships its tech lexicon
  as an OVERLAY on the library's neutral base — but confirm the overlay carries all current tuning (noun
  property typings, verb prepositions, adjective types) with no loss versus today's single `lexicon-core.json`.
- **Versioning coupling.** How tightly does tmct pin `ace-owl`? A parser change that shifts emitted triples
  is a breaking change for tmct's stored memory (content-addressed fact ids). Semver discipline plus tmct
  pinning a known-good range; settle whether triple-shape stability is a MAJOR-only guarantee.
- **RDFJS quads native or separate adapter?** Emit quads from the core, or keep the core zero-dep and leave
  N3.js to an optional adapter (this plan's lean)? Depends on how central RDFJS is to the target audience.
- **Naming / scope.** `@polycode-projects/ace-owl` (collision-safe, obviously ours) vs an unscoped community
  name (more discoverable, higher adoption) — an operator decision at publish time.
