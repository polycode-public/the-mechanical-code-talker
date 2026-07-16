# corpus/ — committed corpus data

The corpuses tmct ships so that an **empty** tmct still has a vocabulary
(ROADMAP Phase 2). Everything here is plain, diffable data; the loaders live
in `src/adapters/corpus/`. Related committed data lives in `data/` (response templates
+ the SE phrase book — items 4+7).

## The tiering policy (tier-1 / tier-2 / tier-3)

tmct's knowledge arrives in three tiers, distinguished by **when** it lands and
**whether it ships in the npm package**:

| Tier | What | Ships in the package? | Lands when | Provenance |
|---|---|---|---|---|
| **1 — base** | the general English/tech ConceptNet slice + the response templates + the SE phrasebook — the vocabulary every tmct has out of the box | **yes**, committed here | `tmct init` seeds `.tmct/` from committed data (offline, $0) | `corpus:conceptnet /r/…` |
| **2 — specialised** | LANGUAGE- or DOMAIN-specific fact sets (`aws`, `python`, `java`) plus one deliberately NON-code-domain "wider general-knowledge" bundle (`general`) so tmct can "expand into a concept for an applicable codebase" — or into a seed set that isn't code at all | **no** — selected per repo | activated via `src/services/extensions.mjs`'s `[extensions.tier2-<id>] active = true` (or `tmct init --corpus <id>`), inactive by default | `corpus:tier2-<id> /r/…` |
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

`LICENSES.json` in this directory is the machine-readable rollup of the table
below — one entry per corpus family ({path, upstream, license, shareAlike,
notice}), guarded by `test/estate/corpus-licences.test.mjs`.

| Path | What | Size | Licence |
|---|---|---|---|
| `conceptnet/slice.jsonl` | tier-1: filtered English/tech-domain ConceptNet 5.7 slice, quality-filtered (one assertion per line) | ~1.35 MB | **CC-BY-SA 4.0** (see `conceptnet/LICENSE-NOTICE`) |
| `conceptnet/fetch-slice.mjs` | regeneration tool — the ConceptNet **API** route (polite, ~1 req/s) | — | MPL-2.0 |
| `conceptnet/filter-dump.mjs` | regeneration tool — the ConceptNet **dump** route (produced the committed slice; the API was down) | — | MPL-2.0 |
| `conceptnet/quality-filter.mjs` | second-pass noise filter (drops sentence-fragment/numeric/opinion rows); produced the committed clean slice | — | MPL-2.0 |
| `conceptnet/README.md` | provenance, retrieval date, seed terms, filter rules, row counts | — | — |
| `tier2/manifest.json` | tier-2: index of specialised corpuses (id, kind, description, source, sha256, size) | — | MPL-2.0 |
| `tier2/generate.mjs` | tier-2: the curated-corpus generator + manifest writer (+ opt-in network-fetch path) | — | MPL-2.0 |
| `tier2/{aws,python,java,general}.jsonl` | tier-2 SAMPLE corpuses — same fact shape as the tier-1 slice, loadable via the same path (`general` is the one deliberately non-code-domain bundle) | ~4-6 KB each | MPL-2.0 |
| `tier2/human.jsonl` | the DEFAULT active bundle (archive/PLAN_SEED.md): the everyday "human-world" persona, Small tier (664 facts) — hand-curated from Open English WordNet, bridged to Schema.org's top-level classes (archive/PLAN_SEED.md §3, §8) | ~80 KB | MPL-2.0 (hand-authored fact set; not a verbatim WordNet/Schema.org excerpt — see `tier2/generate.mjs`'s own header comment) |
| `tier2/human-medium.jsonl` / `tier2/human-large.jsonl` | SIZE tiers of the SAME `human` bundle (archive/PLAN_SEED.md §3) — each holds ONLY the facts that size adds beyond the previous one; both shipped INACTIVE by default, activated via `tmct init --persona-size medium\|large`. Built by `scripts/build-persona-tiers.mjs` from the same WordNet source, automatically curated (sense-ranked, blocklist/denylist-filtered) rather than hand-typed one at a time, given the scale (944 / ~12,000 facts) | ~111 KB / ~1.4 MB | MPL-2.0 (same "hand-authored in homage to the source's shape" basis as `human.jsonl`) |
| `tier2/human-examples.jsonl` / `tier2/human-examples-medium.jsonl` / `tier2/human-examples-large.jsonl` | the example-sentence corpus (archive/PLAN_SEED.md §9) — real natural-language sentences mapped to the same curated vocabulary, NOT fact triples. Small/Medium tiers are 100% WordNet's own inline `example:` field (same CC-BY-4.0 basis as the fact bundles). Large tier ALSO includes a SemCor-filtered supplement (real Brown Corpus text, re-tagged to modern OEWN senses) for categories where WordNet's own inline coverage is thin (`human-nature` especially — `noun.animal.yaml`'s inline rate is under 1%, archive/PLAN_SEED.md §9's own measurement) | ~11 KB / ~43 KB / ~257 KB | **The WordNet-inline entries**: CC-BY-4.0 (Princeton WordNet + Open English WordNet team), reproduced verbatim (these ARE the source's own example sentences, not a paraphrase). **The `source: "semcor:…"` entries**: CC-BY-4.0 per this SemCor fork's own `LICENSE.md` (a local uncommitted checkout of `globalwordnet/semcor`, real Brown Corpus text re-tagged to modern senses — the original 1960s Brown Corpus permissions aren't independently re-verified beyond that fork's own license statement; proceeding with attribution was an explicit operator decision, archive/PLAN_SEED.md §9) — each entry's own `source` field names its origin file (`semcor:<genre>/<file>.yaml`) for exactly this reason |

And alongside (same phase, different directory because it is tmct-original
data, not a derived corpus):

| Path | What | Licence |
|---|---|---|
| `../data/templates/responses.jsonl` | ~56 response templates ({id, class, template, register}) | MPL-2.0 |
| `../data/phrasebook/software-phrases.txt` | ~170 SE phrase patterns + 31 synonym families | MPL-2.0 |

## How seeding works

`src/adapters/corpus/conceptnet.mjs` turns the slice into tmct memory facts:

```js
import { seedMemory } from "./src/adapters/corpus/conceptnet.mjs";
await seedMemory(repoDir);            // writes <repoDir>/.tmct/memory/graph.json
await seedMemory(repoDir, { limit: 500 }); // capped (fast bootstrap)
```

- Each assertion whose relation maps to an ACE-OWL pattern
  (`src/adapters/corpus/conceptnet-map.toml`, `ace != "none"`) becomes one reified
  fact via `src/adapters/memory/core.mjs` `appendFact`:
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
`src/adapters/corpus/conceptnet-map.toml`. Because the shape is identical, a tier-2 file
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

**How tier-2 wires into `tmct init` (done — `src/services/extensions.mjs`):**
`resolveExtensions(repoRoot)` ships all four tier-2 bundles as
shipped-but-inactive `BUILTIN_EXTENSIONS` entries (`tier2-aws`/`tier2-python`/
`tier2-java`/`tier2-general`); `[extensions.tier2-<id>] active = true` in
`tmct.toml` (or `tmct init --corpus <id>`) flips one on, and
`seedActiveCorpusEntries` runs it through the exact same
`loadSlice → toFacts → appendFacts` pipeline as tier-1, stamped
`corpus:tier2-<id> <rel>` via `toFacts`'s `provenancePrefix` argument — no
separate tier-2 code path. Idempotency is free (`seedMemory`'s content-hashed
fact ids + pre-read skip). None of this touches `package.json` or the tier-1
budget; tier-2 files are not shipped, so they do not count against the
≤ 1.5 MB slice budget. Codebase auto-detection (a `requirements.txt` →
`python`, a `pom.xml`/`build.gradle` → `java`, an AWS SDK dep → `aws`) is
still unbuilt — activation today is config-only, never automatic.

A term that would otherwise be silently dropped when a bundle is seeded (an
`ace = "none"` relation like RelatedTo/HasContext, e.g. from a broader slice)
can optionally be captured instead of vanishing: `seedMemory`'s
`captureUnknownContext: true` option (default off) runs
`src/adapters/corpus/unknown-ingest.mjs` over the same batch — see that module's own
doc comment.

## How to regenerate / extend

See `conceptnet/README.md` — one command per route (API vs dump), the
quality-filter pass, plus the seed-term list to extend. The test suite
(`test/corpus-conceptnet.test.mjs`, `test/corpus-templates.test.mjs`) guards the
contracts: slice/mapping drift, en→en shape, the ≤ 1.5 MB budget, template
ids/slots, and end-to-end seeding.
