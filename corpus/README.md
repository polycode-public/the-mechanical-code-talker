# corpus/ — committed corpus data

The corpuses tmct ships so that an **empty** tmct still has a vocabulary
(ROADMAP Phase 2). Everything here is plain, diffable data; the loaders live
in `src/corpus/`. Related committed data lives in `data/` (response templates
+ the SE phrase book — items 4+7).

## The tiering policy (tier-1 / tier-2 / tier-3)

tmct's knowledge arrives in three tiers, distinguished by **when** it lands and
**whether it ships in the npm package**:

| Tier | What | Ships in the package? | Lands when | Provenance |
|---|---|---|---|---|
| **1 — base** | the general English/tech ConceptNet slice + the response templates + the SE phrasebook — the vocabulary every tmct has out of the box | **yes**, committed here | `tmct init` seeds `.tmct/` from committed data (offline, $0) | `corpus:conceptnet /r/…` |
| **2 — specialised** | LANGUAGE- or DOMAIN-specific fact sets (`aws`, `python`, `java`, …) so tmct can "expand into a concept for an applicable codebase" | **no** — selected per repo | `tmct init` fetches/generates the chosen tier-2 corpuses into `.tmct/` (Wave-2 wiring) | `corpus:tier2:<id> /r/…` |
| **3 — learned** | facts tmct writes from the actual conversation / the actual codebase it is pointed at | never committed | at runtime, into `.tmct/memory/` | `chat:…`, `codegraph:…` |

**Offline / $0 is the default at every tier.** Tier-1 is committed. Tier-2's
sample corpuses are *curated* (generated locally by `tier2/generate.mjs`, no
network); a tier-2 corpus too large to curate by hand may declare a `fetch`
source (a URL + a `sha256`), but the network is **opt-in only** — nothing
reaches out unless the operator asks for it. Tier-3 is whatever the user says.

**Checksums / integrity.** Every tier-2 corpus carries a `sha256` and a `bytes`
count in `tier2/manifest.json`; a `fetch`-sourced corpus is checksum-verified on
download (`generate.mjs` `fetchCorpus()`), so a corrupt or tampered fetch fails
loudly instead of seeding garbage.

## What's here

| Path | What | Size | Licence |
|---|---|---|---|
| `conceptnet/slice.jsonl` | tier-1: filtered English/tech-domain ConceptNet 5.7 slice, quality-filtered (one assertion per line) | ~1.35 MB | **CC-BY-SA 4.0** (see `conceptnet/LICENSE-NOTICE`) |
| `conceptnet/fetch-slice.mjs` | regeneration tool — the ConceptNet **API** route (polite, ~1 req/s) | — | MPL-2.0 |
| `conceptnet/filter-dump.mjs` | regeneration tool — the ConceptNet **dump** route (produced the committed slice; the API was down) | — | MPL-2.0 |
| `conceptnet/quality-filter.mjs` | second-pass noise filter (drops sentence-fragment/numeric/opinion rows); produced the committed clean slice | — | MPL-2.0 |
| `conceptnet/README.md` | provenance, retrieval date, seed terms, filter rules, row counts | — | — |
| `tier2/manifest.json` | tier-2: index of specialised corpuses (id, kind, description, source, sha256, size) | — | MPL-2.0 |
| `tier2/generate.mjs` | tier-2: the curated-corpus generator + manifest writer (+ opt-in network-fetch path) | — | MPL-2.0 |
| `tier2/{aws,python,java}.jsonl` | tier-2 SAMPLE corpuses — same fact shape as the tier-1 slice, loadable via the same path | ~4 KB each | MPL-2.0 |

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

## Tier-2 specialised corpuses (`tier2/`)

A tier-2 corpus is a small, curated, LANGUAGE- or DOMAIN-specific fact set in
the **exact tier-1 fact shape** — one JSON object per line,
`{"start":"/c/en/…","rel":"/r/…","end":"/c/en/…","weight":N,"surfaceText":"…"}`,
with `rel` drawn only from the mapped relations in
`src/corpus/conceptnet-map.toml`. Because the shape is identical, a tier-2 file
loads and seeds through the very same `loadSlice()`/`toFacts()` path as the
tier-1 slice — `tier2/generate.mjs --verify` proves it (each sample loads and
all its facts seed cleanly, no `ace=none` dead rows).

The idea: a Python repo pulls the `python` corpus so tmct knows "a dict is a
kind of hash table"; an AWS project pulls `aws` so it knows "S3 is object
storage, a bucket is part of S3". Language terms unify onto the **shared CS
concept vocabulary** (`list → array`, `hashmap → hash table`) so specialised
knowledge connects to the tier-1 graph instead of floating apart.

**To add a corpus:** add an entry to `CORPUSES` in `tier2/generate.mjs` (a list
of `[subject, relation, concept]` triples) and run `node tier2/generate.mjs
--verify`. It rewrites `<id>.jsonl` and `manifest.json` (facts count, byte size,
sha256) in one deterministic pass. Curated data is authored in that file so it
stays reviewable; a corpus too big to hand-curate is a `fetch` manifest entry
(URL + sha256, opt-in network — `fetchCorpus()` is the reference downloader).

**How the coordinator should wire tier-2 into `tmct init` (Wave-2 — NOT done
here):**

1. Add a tier-2-aware seeder next to `seedMemory()` (e.g. `seedTier2(dir, id)`)
   that reads `corpus/tier2/manifest.json`, resolves the requested corpus's
   `file` (curated → already on disk; `fetch` → download + `sha256`-verify
   first, only when network is explicitly enabled), then runs the SAME
   `loadSlice → toFacts → appendFact` pipeline — **but stamps provenance
   `corpus:tier2:<id> <rel>`** instead of the hard-coded `corpus:conceptnet …`
   string in `toFacts()`. (Simplest: give `toFacts` an optional
   `provenancePrefix` argument, default `"corpus:conceptnet"`.)
2. Give `tmct init` a `--corpus <id>[,<id>…]` flag (and/or codebase
   auto-detection: a `requirements.txt`/`pyproject.toml` → `python`, a
   `pom.xml`/`build.gradle` → `java`, an AWS SDK dep / `serverless.yml` →
   `aws`). Default stays tier-1-only, offline, $0.
3. Idempotency is free — `seedMemory`'s content-hashed fact ids and pre-read
   skip already handle re-seeds; tier-2 rides the same path.

None of that touches `package.json` or the tier-1 budget; tier-2 files are not
shipped, so they do not count against the ≤ 1.5 MB slice budget.

## How to regenerate / extend

See `conceptnet/README.md` — one command per route (API vs dump), the
quality-filter pass, plus the seed-term list to extend. The test suite
(`test/corpus-conceptnet.test.mjs`, `test/corpus-templates.test.mjs`) guards the
contracts: slice/mapping drift, en→en shape, the ≤ 1.5 MB budget, template
ids/slots, and end-to-end seeding.
