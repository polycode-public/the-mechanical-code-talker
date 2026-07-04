# corpus/ — committed corpus data

The corpuses tmct ships so that an **empty** tmct still has a vocabulary
(ROADMAP Phase 2). Everything here is plain, diffable data; the loaders live
in `src/corpus/`. Related committed data lives in `data/` (response templates
+ the SE phrase book — items 4+7).

## What's here

| Path | What | Size | Licence |
|---|---|---|---|
| `conceptnet/slice.jsonl` | filtered English/tech-domain ConceptNet 5.7 slice (one assertion per line) | ~1.4 MB | **CC-BY-SA 4.0** (see `conceptnet/LICENSE-NOTICE`) |
| `conceptnet/fetch-slice.mjs` | regeneration tool — the ConceptNet **API** route (polite, ~1 req/s) | — | MPL-2.0 |
| `conceptnet/filter-dump.mjs` | regeneration tool — the ConceptNet **dump** route (produced the committed slice; the API was down) | — | MPL-2.0 |
| `conceptnet/README.md` | provenance, retrieval date, seed terms, filter rules, row counts | — | — |

And alongside (same phase, different directory because it is tmct-original
data, not a derived corpus):

| Path | What | Licence |
|---|---|---|
| `../data/templates/responses.jsonl` | ~56 response templates ({id, class, template, register}) | MPL-2.0 |
| `../data/phrasebook/software-phrases.txt` | ~170 SE phrase patterns + 31 synonym families | MPL-2.0 |

## How seeding works

`src/corpus/conceptnet.mjs` turns the slice into tmct memory facts:

```js
import { seedMemory } from "./src/corpus/conceptnet.mjs";
await seedMemory(repoDir);            // writes <repoDir>/.tmct/memory/graph.json
await seedMemory(repoDir, { limit: 500 }); // capped (fast bootstrap)
```

- Each assertion whose relation maps to an ACE-OWL pattern
  (`src/corpus/conceptnet-map.toml`, `ace != "none"`) becomes one reified
  fact via `src/memory/core.mjs` `appendFact`:
  `{subject:"software bug", predicate:"rdfs:subClassOf", object:"error",
  provenance:"corpus:conceptnet /r/IsA"}`.
- **Idempotent**: fact ids are content-hashed from the normalized triple, and
  `seedMemory` pre-reads the store once and skips triples already present —
  re-seeding costs one read, not N rewrites. Provenance from different
  writers of the same triple is unioned, never overwritten.
- `ace = "none"` relations (RelatedTo, Synonym, FormOf, …) are deliberately
  NOT seeded — they are kept in the slice for future lexicon/fuzzy-match use.

## How to regenerate / extend

See `conceptnet/README.md` — one command per route (API vs dump), plus the
seed-term list to extend. The test suite (`test/corpus-conceptnet.test.mjs`,
`test/corpus-templates.test.mjs`) guards the contracts: slice/mapping drift,
en→en shape, the ≤ 1.5 MB budget, template ids/slots, and end-to-end seeding.
