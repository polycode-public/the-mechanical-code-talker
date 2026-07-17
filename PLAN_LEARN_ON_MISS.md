# PLAN_LEARN_ON_MISS.md — answer a clean miss by learning, not just refusing (Tier-4 acquisition)

Status: DESIGN. Two acquisition tiers. The DEFAULT tier — a pre-cleaned reference pack shipped with
the package, keyword-indexed and lazy-loaded on a miss — is offline, $0, deterministic, and a solved
engineering problem: no research risk. The SECOND tier — a network "pro" feature that web-searches
when the shipped pack also misses — is opt-in, key-gated, and carries the one genuinely open problem
(deterministic extraction from arbitrary web text). The provenance/trust infrastructure both tiers
need is mostly built. This plan carries the idea out of the retired ROADMAP research horizon.

## The idea

Today a query tmct cannot ground produces an **honest miss** and stops — a timeout is a miss, never
a guess (the product's central promise). Tier-4 keeps that promise and adds one behaviour, **only on
the cleanest kind of miss and only when explicitly enabled**: go and learn the answer, from the web,
through tmct's own deterministic controlled-grammar pipeline, store it with distinct provenance, and
answer the original question citing what it just learned.

This is the single place tmct would ever touch the network. It does **not** breach the no-LLM
constitution: the constitution bans a model in the product path, and this adds a network fetch plus a
deterministic ACE→OWL parse — no model summarises the web, and nothing generative decides truth.

## The Tier-4 miss signal (why this miss and not others)

Misses are not all equal. The signal that makes acquisition worthwhile is the sharpest one tmct can
emit:

- the term is **recognised** by the lexicon (not an unknown word),
- the query **compiled cleanly** (not a parse failure, not an ambiguity),
- and there are **zero matches** anywhere — graph, corpus, taught memory.

Nothing is broken; the knowledge is simply **absent**. That is the one case where tmct already knows
exactly *what* to search for, so a fetch is well-targeted rather than a guess about what the user
even meant. Every other miss class (unknown word, unparseable input, ambiguous reading) is NOT a
Tier-4 signal and stays a plain honest miss — acquisition never fires on them.

**Where the signal already exists.** The ask/traverse path already distinguishes a resolvable-but-empty
answer from a parse miss and from an unresolved term (the relaxation cascade in `src/domain/ask.mjs`
and the miss reasons in `src/adapters/repository-interface.mjs`'s `MISS_REASONS`). Tier-4 detection
is a read over that existing classification: fire only when the parse succeeded, the term resolved to
a lexicon entry, and the result set is empty — never on `NO_PARSE`/unresolved/ambiguous.

## What is already built (the provenance/trust half)

The infrastructure to store a web-sourced fact *without* it contaminating trusted knowledge already
exists, from the PROV Source work:

- `trust.mjs`'s `SOURCE_PRIOR` already carries a **`web`** and an **`extracted`** source type, ranked
  below `operator`/`teach`/`corpus`.
- The Source split (`archive/PLAN_NORMATIVE.md` §7.5) classifies a `web` source as a
  `tmct:DocumentSource` (`prov:Entity`), distinct from an agent (operator) or an activity (a rule).
- Every fact records `mgx:statedBy` a Source and `mgx:sourceType`, so a web-learned fact is already
  distinguishable at read time and never silently blended with graph/operator facts.

So the prerequisite the horizon named — "the provenance-trust policy must extend to
`via:\"learned:web\"`" — is most of the way there. What is missing is a **`learned:web`** provenance
tag distinct from a bulk `web` corpus import (so a fact learned live in this session is marked as
such and can be shown as "I just learned this"), and a **read-side trust rule** that keeps a
`learned:web` fact from ever outranking an operator or corpus fact in a proof or an answer.

## The two tiers: a shipped reference pack first, the web second

Acquisition has two tiers, and the DEFAULT one needs no network and carries no research risk.

### Tier-4a — the shipped reference pack (default, offline, $0, deterministic)

Ship a large body of pre-cleaned knowledge-base articles AND a pre-built keyword index with the
package (bundled or as a companion pack — see distribution below). On a Tier-4 miss:

1. **Keyword-search the shipped index** for the resolved term — a lookup, not a scan, so it is fast
   over a large pack and nothing but the index need be resident.
2. **Lazy-load the matching article(s)** — only what the index points at, not the whole pack, so
   init stays cheap and memory bounded. The pack is a big corpus loaded ON DEMAND, keyed on the miss
   term, not bulk-imported at init the way `init:xxl` is.
3. **Answer from it** — either the article was pre-parsed into OWL facts at BUILD time (its facts are
   stored and queried), or it is answered as a completions-style read-out through the existing
   `src/domain/completions/` pipeline. Store what is used with a corpus/reference provenance.
4. **Cite the article.**

This is a solved engineering problem, not a research one: the articles are cleaned once, at build
time, from public sources into a known format, so at run time there is no free-text extraction —
only a keyword lookup and a load. It stays inside the constitution (offline, $0, no model in the
product path) and is really the corpus-import machinery tmct already has
(`seon`/`conceptnet`/`wordnet`) made LAZY and keyed on the miss term.

### Tier-4b — web acquisition (a "pro" feature: network + key, opt-in)

Only when the shipped pack ALSO misses, and only when the operator has enabled web learning and
supplied a key, fall through to the web: fetch the resolved term → clean the fetched text through
the ACE→OWL controlled grammar (`src/domain/grammar/ace.mjs`), keeping only what parses into
grounded facts (no model summarises or paraphrases; a sentence that does not parse is dropped, not
guessed at) → store as `learned:web`, a lower trust tier that is never blended → answer and cite.
This is the network tier, off by default. If it also finds nothing, the turn falls straight back to
the ordinary honest miss.

## Distribution and the open problem — the decisions each tier carries

**Tier-4a's decisions are engineering, not research:**
- **Where the pack lives.** A big KB bloats the core package, so the options are: bundle it
  compressed; ship it as a **companion optional-dependency package** (e.g. `@polycode-projects/…-kb`)
  so the core stays lean and the pack is opt-in-installed; or a **downloadable pack** pulled by a
  `tmct import --pack reference` step. Recommendation: a companion/optional package — the core stays
  small, the KB is there for whoever wants it.
- **Source and licence.** Public, licence-compatible sources cleanable deterministically — Simple
  English Wikipedia, Wiktionary, WordNet and ConceptNet (both already shipped here), Wikidata/DBpedia
  triples. Licence terms decide what can ship.
- **Article format.** Pre-parsed OWL facts (strongest grounding, more build-time work) versus indexed
  articles answered through the existing completions read-out (less parsing, reuses shipped
  machinery). The completions route is the cheaper first cut.

**Tier-4b carries the one genuinely open problem.** Raw web prose almost never parses as Attempto
Controlled English, so a naive fetch → ACE parse extracts little. The unsolved-in-the-field question
is how much groundable fact can be extracted **deterministically, without an LLM doing the
cleaning** — open information extraction and controlled-language normalisation are the candidate
literatures. Until a deterministic extractor with a useful yield exists, Tier-4b stays behind its
opt-in and low yield is accepted honestly (learn only what parses, never fabricate). Tier-4a does
not wait on this — it ships pre-cleaned articles, so there is no run-time extraction to solve.

## The opt-in and the inviolable default

- **Off by default, always.** A dedicated flag / config key (e.g. `--learn` or
  `learn: { web: true }`) enables it; absent that, the fetch adapter is never constructed and the
  offline/$0 guarantee is untouched.
- **The default path is byte-for-byte what it is today** — a Tier-4 miss with acquisition off is an
  ordinary honest miss. No behaviour change ships until the operator turns it on.

## Tests / evidence (per `SKILL_CAPABILITIES_AUDIT.md` §1)

- **Tier-4 detection** — a unit/tool-layer test that the acquisition path fires ONLY on the
  clean-resolved-empty signal and NEVER on an unknown word, a parse miss, or an ambiguous term
  (negative rows are load-bearing here).
- **The clean step is deterministic and lossy-safe** — a test feeding non-ACE text yields zero facts
  (nothing fabricated), and ACE-shaped text yields exactly the expected facts.
- **Provenance/trust** — a stored `learned:web` fact reads back with its source, is shown as
  web-learned, and never outranks an operator/corpus fact in a proof (extend
  `test/adapters/trust.test.mjs`).
- **The offline default is inviolable** — a test that with the flag OFF, no network adapter is
  constructed and a Tier-4 miss is byte-identical to an ordinary honest miss.
- The fetch adapter itself is exercised against a **local fixture**, never a live network call in the
  suite.

## Sequencing

1. **Provenance/trust first** (cheap, mostly built): add a `learned:web`/reference provenance tag and
   the read-side trust rule that keeps an acquired fact below operator/corpus; pin it. Shippable on
   its own and makes any acquired fact safe to store.
2. **Tier-4 detection** (a read over the existing miss classification) + the opt-in wiring, to a
   no-op acquirer. Pinned by the detection tests. Ships nothing user-visible yet.
3. **Tier-4a — the shipped reference pack** (the main deliverable, no research gate): the pack
   (source + build-time cleaning + keyword index), the lazy loader, and the on-miss lookup; answer
   through the completions read-out first. This is the default, offline capability.
4. **Tier-4b — web acquisition (pro)**: only after Tier-4a ships and only once the deterministic
   web-extraction question has a useful-yield answer. Key-gated, off by default, honest-miss fallback
   inviolable.
