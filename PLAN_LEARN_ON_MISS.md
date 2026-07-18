# PLAN_LEARN_ON_MISS.md — answer a clean miss from a shipped knowledge pack, not just a refusal

Status: IN DELIVERY (2026-07-18 run) — offline, $0, deterministic, no LLM, no runtime network.
Decisions taken for the build: pack source = Simple English Wikipedia (pinned dump, build-time
fetch + deterministic clean); pack home = in-repo `corpus/reference/` shipped in this package
(not a companion package); a small deterministic subset is emitted under `public/` so the
home-page embedded chat demos the capability. On the cleanest
class of miss, keyword-search a large pre-cleaned knowledge pack shipped with the package, lazy-load
the one matching article, and answer from it with its own provenance — otherwise fall straight back
to the honest miss. The provenance/trust half is mostly built. This plan carries the idea out of the
retired ROADMAP research horizon.

## The idea

Today a query tmct cannot ground produces an **honest miss** and stops — a timeout is a miss, never
a guess (the product's central promise). This keeps that promise and adds one behaviour, on the
cleanest kind of miss: consult a **shipped, pre-cleaned, keyword-indexed knowledge pack**, load the
article that answers, and answer the original question citing it. If the pack has nothing either,
the turn is the ordinary honest miss it is today.

It stays fully inside the constitution: **no network, no model, no cost.** The articles are cleaned
once, at build time, from public sources into a known format, so at run time there is only a keyword
lookup and a load — no free-text extraction, nothing generative, nothing that decides truth. It is
really the corpus-import machinery tmct already has (`seon`/`conceptnet`/`wordnet`) made **lazy** and
**keyed on the miss term**, so a huge body of knowledge is available without paying to load it all at
init.

## The clean-miss signal (why this miss and not others)

Misses are not all equal. The signal that makes a lookup worthwhile is the sharpest one tmct can
emit:

- the term is **recognised** by the lexicon (not an unknown word),
- the query **compiled cleanly** (not a parse failure, not an ambiguity),
- and there are **zero matches** anywhere — graph, corpus, taught memory.

Nothing is broken; the knowledge is simply **absent**. That is the one case where tmct already knows
exactly *what* to look up, so consulting the pack is well-targeted rather than a guess about what the
user even meant. Every other miss class (unknown word, unparseable input, ambiguous reading) is NOT
this signal and stays a plain honest miss — the pack is never consulted for them.

**Where the signal already exists.** The ask/traverse path already distinguishes a resolvable-but-empty
answer from a parse miss and from an unresolved term (the relaxation cascade in `src/domain/ask.mjs`
and the miss reasons in `src/adapters/repository-interface.mjs`'s `MISS_REASONS`). Detection is a
read over that existing classification: fire only when the parse succeeded, the term resolved to a
lexicon entry, and the result set is empty — never on `NO_PARSE`/unresolved/ambiguous.

## What is already built (the provenance/trust half)

The infrastructure to store a pack-sourced fact *without* it contaminating trusted knowledge already
exists, from the PROV Source work:

- `trust.mjs`'s `SOURCE_PRIOR` already carries `corpus`/`corpusWeak`/`extracted` source types, ranked
  below `operator`/`teach`.
- The Source split (`archive/PLAN_NORMATIVE.md` §7.5) classifies a document source as a
  `tmct:DocumentSource` (`prov:Entity`), distinct from an agent (operator) or an activity (a rule).
- Every fact records `mgx:statedBy` a Source and `mgx:sourceType`, so a pack-sourced fact is already
  distinguishable at read time and never silently blended with graph/operator facts.

What is missing is a **`reference`** provenance tag (or reuse of `corpus`) naming the shipped pack and
the specific article as the Source, so an answer can say *"from the &lt;article&gt; reference"*, plus the
read-side rule keeping a reference fact below what the operator taught.

## The acquisition — the shipped reference pack

Ship a large body of pre-cleaned knowledge-base articles AND a pre-built keyword index. On a
clean miss:

1. **Keyword-search the shipped index** for the resolved term — a lookup, not a scan, so it is fast
   over a large pack and nothing but the index need be resident.
2. **Lazy-load the matching article(s)** — only what the index points at, not the whole pack, so
   init stays cheap and memory bounded. The pack is a big corpus loaded ON DEMAND, keyed on the miss
   term, not bulk-imported at init the way `init:xxl` is.
3. **Answer from it** — either the article was pre-parsed into OWL facts at BUILD time (its facts are
   stored and queried like any other), or it is answered as a completions-style read-out through the
   existing `src/domain/completions/` pipeline. Store what is used with reference provenance.
4. **Cite the article**, so the source is always visible.

The whole thing is a solved engineering problem: build-time cleaning + a keyword index + a lazy
loader + the read-out tmct already has.

## Distribution — the decisions this carries (all engineering, not research)

- **Where the pack lives.** A big KB bloats the core package, so the options are: bundle it
  compressed; ship it as a **companion optional-dependency package** (e.g. `@polycode-projects/…-kb`)
  so the core stays lean and the pack is opt-in-installed; or a **downloadable pack** pulled by a
  `tmct import --pack reference` step. Recommendation: a companion/optional package — the core stays
  small, and the pack being absent means behaviour is exactly today's (an honest miss), so no default
  is broken.
- **Source and licence.** Public, licence-compatible sources cleanable deterministically — Simple
  English Wikipedia, Wiktionary, WordNet and ConceptNet (both already shipped here), Wikidata/DBpedia
  triples. Licence terms decide what can ship.
- **Article format.** Pre-parsed OWL facts (strongest grounding, more build-time work) versus indexed
  articles answered through the existing completions read-out (less parsing, reuses shipped
  machinery). The completions route is the cheaper first cut.
- **Index shape.** A keyword/inverted index keyed on the normalised term (`normFactTerm`), so the
  miss term maps to article ids directly; a later refinement could swap in the semantic-similarity
  axis (`PLAN_EMBEDDINGS.md`) for fuzzy lookups, but exact keyword lookup ships first.

## The default and the honest-miss fallback

- **The pack absent = today's behaviour, byte-for-byte.** A clean miss with no pack installed is an
  ordinary honest miss. Shipping the pack as a companion package makes the whole capability opt-in by
  installation, and the core stays offline/$0 regardless.
- **The pack present but empty on this term = the honest miss too.** Consulting the pack never
  fabricates: if the index has no article for the resolved term, the turn falls straight back to the
  honest miss. The pack only ever *adds* a grounded, cited answer where there was a refusal — it never
  turns a refusal into a guess.

## Tests / evidence (per `SKILL_CAPABILITIES_AUDIT.md` §1)

- **Clean-miss detection** — a unit/tool-layer test that the pack lookup fires ONLY on the
  clean-resolved-empty signal and NEVER on an unknown word, a parse miss, or an ambiguous term
  (negative rows are load-bearing here).
- **Deterministic lookup + load** — a test over a small fixture pack: a known term returns its
  article's facts/read-out; an absent term returns nothing and the honest miss stands.
- **Reference provenance/trust** — a stored reference fact reads back with its article as the source,
  is shown as pack-sourced, and never outranks an operator-taught fact in a proof (extend
  `test/adapters/trust.test.mjs`).
- **The fallback is inviolable** — with no pack, or an empty result, a clean miss is byte-identical
  to today's honest miss.

## Sequencing

1. **Provenance/trust first** (cheap, mostly built): add a `reference` provenance tag naming the pack
   + article, and the read-side rule that keeps a reference fact below operator/taught; pin it.
   Shippable on its own. — BUILT: `reference:<pack>:<article>[@revid]` parses in
   `src/domain/memory/trust.mjs` (prior 0.6, between corpus and corpusWeak), materialises a
   per-article `tmct:DocumentSource` in `src/adapters/memory/core.mjs`, pinned by
   `test/adapters/trust.test.mjs`.
2. **Clean-miss detection** (a read over the existing miss classification), gated to a no-op lookup.
   Pinned by the detection tests. Ships nothing user-visible yet. — PURE HALF BUILT:
   `cleanMissReferenceTerm` (`src/domain/reference-pack.mjs`) keys a lexicon noun on its lemma and
   refuses relation touches and unknown words; the chat-side wiring (parse-succeeded, graph and
   memory genuinely empty) is the chat hook, not yet landed.
3. **The pack + index + lazy loader + on-miss lookup**, answering through the completions read-out
   first. Build-time cleaning of the chosen source into the shipped format. This is the deliverable —
   the default, offline, cited answer where there used to be a refusal.
