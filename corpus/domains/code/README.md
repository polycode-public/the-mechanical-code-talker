# corpus/domains/code — tmct's code domain pack

The code domain pack: a hand-authored, **language-neutral** ontology of the
software-engineering concepts tmct's grammar lexicon knows about, plus the
pack's own lane vocabulary (count nouns, help rows, the miss-recovery pointer).
Registered as the `code` pack extension entry (`src/services/extensions.mjs`);
`--with-persona code` and `tmct index` both activate it. The ontology's own
bundle name is `seon` and its provenance prefix is `corpus:seon` — unchanged
by this directory's location (see `LICENSE-NOTICE`). Its purpose, in the
operator's words: *"the chat knows about what it knows about."* Every lexicon
concept gets

1. an **English definition** — what it IS (`definitions.jsonl`), and
2. **relation facts** — how it RELATES to other concepts (`concepts.jsonl`),

so tmct can explain its own vocabulary, and so a Java `class`, a C# `class`, and a
Python `class` all resolve to the **same** language-neutral concept.

This is **tier-1, curated** data: every line is hand-checked and tech-correct — no
ConceptNet-style noise. It is repo-owned (**MPL-2.0**, see `LICENSE-NOTICE`), *not*
CC-BY-SA like the ConceptNet slice.

## Files

| file | shape | count |
|------|-------|-------|
| `concepts.jsonl`    | relation facts, byte-identical shape to `corpus/conceptnet/slice.jsonl` | 399 facts |
| `definitions.jsonl` | `{ "term", "definition", "sense": "software" }`, one per line             | 288 definitions |
| `relations.jsonl`   | `{ "relation", "definition", "sense": "software" }`, one per line — what each edge kind means, so "what does imports mean" answers without per-repo seeding | 9 relations |
| `vocab.json`         | the pack's lane vocabulary: `countNouns`, `classLabels`, `helpRows`, `missRecoveryPointer` — merged in by `mergedLaneVocab` (`src/services/extensions.mjs`) | — |
| `LICENSE-NOTICE`    | MPL-2.0 provenance for this directory | — |

### `concepts.jsonl` — same shape as the ConceptNet slice

Each line is exactly `{ "start", "rel", "end", "weight" }` with `/c/en/<term>`
endpoints, so the existing `loadSlice` / `loadMap` / `toFacts` / `seedMemory`
(`src/adapters/corpus/conceptnet.mjs`) consume this file with **no code change** — pass it as
the `slicePath`.

```jsonc
{"start":"/c/en/class","rel":"/r/IsA","end":"/c/en/type","weight":2}
{"start":"/c/en/method","rel":"/r/PartOf","end":"/c/en/class","weight":2}
{"start":"/c/en/cache","rel":"/r/UsedFor","end":"/c/en/performance","weight":2}
{"start":"/c/en/java_class","rel":"/r/IsA","end":"/c/en/class","weight":2}
```

Only relations already mapped in `src/adapters/corpus/conceptnet-map.toml` are used, so there
is **no slice/map drift** (verified: the file loads through `toFacts` cleanly). The
emitted-predicate breakdown:

| ConceptNet rel | → predicate | facts | meaning |
|----------------|-------------|-------|---------|
| `/r/IsA`         | `rdfs:subClassOf` | 132 | taxonomy (`class` ⊑ `type`) — the load-bearing layer the syllogise closure walks. Includes the upper-ontology spine (`artifact`/`agent`/`event`/`quality`/`quantity`) added 2026-07-10 |
| `/r/UsedFor`     | `mgx:usedFor`     | 48  | purpose (`cache` usedFor `performance`) |
| `/r/PartOf`      | `mgx:partOf`      | 37  | meronymy (`method` partOf `class`) |
| `/r/HasA`        | `mgx:hasA`        | 18  | holonymy (`class` hasA `method`) |
| `/r/CapableOf`   | `mgx:capableOf`   | 8   | behaviour (`cache` capableOf `store data`) |
| `/r/CreatedBy`   | `mgx:createdBy`   | 4   | provenance (`commit` createdBy `developer`) |
| `/r/HasProperty` | `mgx:hasProperty` | 19  | attributes (`cache` hasProperty `fast`) |
| `/r/RelatedTo`   | *(none — non-emitting)* | 19 | weak peer hints (`interface` relatedTo `class`); kept per the map's own note as a future fuzzy-match signal — they load without drift but emit no fact today |
| `/r/DistinctFrom`| `owl:disjointWith` | 114 | mutual exclusion (`cache` disjointWith `queue`); grown 2026-07-10 (was 42) from a token starter set to a genuine upper-ontology + sibling-cluster disjointness spine for `PLAN_INFERENCE_TESTING.md`'s `cax-dw` rule |

`normFactTerm` lowercases and de-underscores endpoints, so `/c/en/java_class` stores
as the term `java class`.

### `definitions.jsonl` — term → English gloss

One object per line, tech-domain sense:

```jsonc
{"term":"class","definition":"A class is a template that defines the structure and behaviour of objects; in code it groups methods and attributes under one type.","sense":"software"}
{"term":"cache","definition":"A cache is a fast, temporary store that keeps copies of recently used data so future requests are served more quickly.","sense":"software"}
{"term":"deprecated","definition":"Deprecated means an entity is marked obsolete and discouraged, kept for now but scheduled for removal.","sense":"software"}
{"term":"import","definition":"To import is to bring the definitions of another module into the current one so its code can be used.","sense":"software"}
```

Covers **every** lexicon term: all 173 nouns, 63 relation verbs (so the chat can
explain what a relation *means*), and 33 attribute adjectives — plus the
language-neutral keywords and tmct self-knowledge terms below.

## Language-neutral layer

Language-specific spellings are linked to the shared concept with `/r/IsA`
(`rdfs:subClassOf`) edges, so a query about an `object`, `class`, or `function`
reasons **across languages** through the taxonomy the syllogise closure already walks:

- **Same concept, many languages:** `java class`, `python class`, `csharp class`,
  `cpp class`, `ruby class` are each `subClassOf` `class`; likewise the interface,
  method, module and package families.
- **Keyword → concept:** `def`, `func`, `fn`, `sub` are each `subClassOf` `function`;
  `struct` and `record` are `subClassOf` `class`; `trait` is `subClassOf` `interface`;
  `namespace` is `subClassOf` `module`.
- Because the specific terms share a parent, `syllogise` connects e.g.
  `java class` → `class` → `type` with no per-language rule.

## Orientation (tmct self-knowledge)

A handful of facts and definitions give meta-questions real ground to stand on:
`tmct isa chatbot`; `tmct usedFor answering questions about a code graph`;
`tmct usedFor explaining its own vocabulary`; `module relatedTo source file`;
`memory graph usedFor storing facts`; `seon isa ontology` — plus definitions for
`tmct`, `code graph`, `memory graph`, and `seon`.

## How this seeds

`seedMemory(repo, { slicePath: SEON_CONCEPTS_FILE, provenancePrefix: "corpus:seon" })`
seeds this ontology whole, uncapped, ahead of the capped ConceptNet band — the
`code` (or `seon`) extension entry's own activation drives it
(`src/services/extensions.mjs`'s `seedActiveCorpusEntries`). The idempotent,
content-hashed `appendFact` ids mean a term appearing in both tiers converges
to one fact. `SEED_PREFER`'s order
(`rdfs:subClassOf`, `rdf:type`, `mgx:usedFor`, `mgx:partOf`, `mgx:capableOf`)
front-loads this file's dominant predicates.

## Regenerating / extending

Add a `[term, definition]` pair (definitions) or a `[start, rel, end]` row (facts) —
keep every line curated and tech-correct, and only use relations that exist in
`conceptnet-map.toml` (else `toFacts` throws a drift error). Endpoints are bare terms;
multiword terms use `_` (they de-underscore on load).
