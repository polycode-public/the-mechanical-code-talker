# corpus/ — committed corpus data

The corpuses tmct ships so that an **empty** tmct still has a vocabulary.
Everything here is plain, diffable data; the loaders live
in `src/adapters/corpus/`. Related committed data lives in `data/` (response templates
+ the SE phrase book).

## The tiering policy (tier-1 / tier-2 / tier-3)

tmct's knowledge arrives in three tiers, distinguished by **when** it lands and
**whether it ships in the npm package**:

| Tier | What | Ships in the package? | Lands when | Provenance |
|---|---|---|---|---|
| **1 — base** | the general English/tech ConceptNet slice + the response templates + the SE phrasebook — the vocabulary every tmct has out of the box | **yes**, committed here | `tmct init` seeds `.tmct/` from committed data (offline, $0) | `corpus:conceptnet /r/…` |
| **2 — specialised** | DOMAIN-specific fact sets — today the deliberately NON-code-domain "wider general-knowledge" bundle (`general`) plus the `human` persona tiers — so tmct can "expand into a concept for an applicable codebase", or into a seed set that isn't code at all | **no** — selected per repo | activated via `src/services/extensions.mjs`'s `[extensions.tier2-<id>] active = true` (or `tmct init --corpus <id>`), inactive by default | `corpus:tier2-<id> /r/…` |
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
| `tier2/general.jsonl` | a tier-2 SAMPLE corpus — same fact shape as the tier-1 slice, loadable via the same path, and deliberately non-code-domain | ~6 KB | MPL-2.0 |
| `tier2/human.jsonl` | the DEFAULT active bundle: the everyday "human-world" persona, Small tier (664 facts) — hand-curated from Open English WordNet, bridged to Schema.org's top-level classes | ~80 KB | MPL-2.0 (hand-authored fact set; not a verbatim WordNet/Schema.org excerpt — see `tier2/generate.mjs`'s own header comment) |
| `tier2/human-medium.jsonl` / `tier2/human-large.jsonl` | SIZE tiers of the SAME `human` bundle — each holds ONLY the facts that size adds beyond the previous one; both shipped INACTIVE by default, activated via `tmct init --persona-size medium\|large`. Built by `scripts/build-persona-tiers.mjs` from the same WordNet source, automatically curated (sense-ranked, blocklist/denylist-filtered) rather than hand-typed one at a time, given the scale (944 / ~12,000 facts) | ~111 KB / ~1.4 MB | MPL-2.0 (same "hand-authored in homage to the source's shape" basis as `human.jsonl`) |
| `prose/sqlite/*.txt` | the frozen prose corpus, code half: plain-text extractions of 12 SQLite documentation pages | ~375 KB | **public domain** (see `prose/sqlite/LICENSE-NOTICE`) |
| `prose/wikipedia/*.txt` | the frozen prose corpus, English half: 56 simple-English lead sections (everyday concepts) + 12 en.wikipedia full articles (NLP/OWL/logic) | ~356 KB | **CC-BY-SA 4.0** (see `prose/wikipedia/LICENSE-NOTICE`) |
| `prose/manifest.json` | provenance for the above: source URL, byte count and sha256 per file, plus the fetch date | — | MPL-2.0 |
| `tier2/human-examples.jsonl` / `tier2/human-examples-medium.jsonl` / `tier2/human-examples-large.jsonl` | the example-sentence corpus — real natural-language sentences mapped to the same curated vocabulary, NOT fact triples. Small/Medium tiers are 100% WordNet's own inline `example:` field (same CC-BY-4.0 basis as the fact bundles). Large tier ALSO includes a SemCor-filtered supplement (real Brown Corpus text, re-tagged to modern OEWN senses) for categories where WordNet's own inline coverage is thin (`human-nature` especially — `noun.animal.yaml`'s inline rate is under 1%) | ~11 KB / ~43 KB / ~257 KB | **The WordNet-inline entries**: CC-BY-4.0 (Princeton WordNet + Open English WordNet team), reproduced verbatim (these ARE the source's own example sentences, not a paraphrase). **The `source: "semcor:…"` entries**: CC-BY-4.0 per this SemCor fork's own `LICENSE.md` (a local uncommitted checkout of `globalwordnet/semcor`, real Brown Corpus text re-tagged to modern senses — the original 1960s Brown Corpus permissions aren't independently re-verified beyond that fork's own license statement; proceeding with attribution was an explicit operator decision) — each entry's own `source` field names its origin file (`semcor:<genre>/<file>.yaml`) for exactly this reason |

And alongside (same phase, different directory because it is tmct-original
data, not a derived corpus):

| Path | What | Licence |
|---|---|---|
| `../data/templates/responses.jsonl` | ~56 response templates ({id, class, template, register}) | MPL-2.0 |
| `../data/phrasebook/software-phrases.txt` | ~170 SE phrase patterns + 31 synonym families | MPL-2.0 |

## The prose corpus (`prose/`) — external and frozen, on purpose

`prose/` is plain English text. It is not seeded and holds no facts. It exists
to be *measured against*: `scripts/template-coverage.mjs` asks how much of it
tmct's ACE grammar parses, and the rescue pass in
`scripts/generate-template-variants.mjs` mines it for near-misses.

It used to be this repository's own root `*.md` docs, and both reasons it moved
are worth stating, because both were real bugs:

- **A doc edit could drift a shipped artifact.** The corpus was globbed from
  every root `*.md`, so editing a README or a plan changed
  `generated/ace-surface-variants.jsonl` — a file npm ships. A rescue row could
  be, and once was, a sentence someone had written into a plan that morning.
  Committed text fetched from a recorded URL cannot do that.
- **The coverage metric was not comparable across versions.** A hit rate only
  means something against a fixed corpus. When the corpus moves with every doc
  edit, two versions' numbers are not measuring the same thing, and a change in
  the number says nothing about a change in the grammar.

So the corpus is external (nothing in this repo can edit it), frozen (a
snapshot, checksummed per file in `prose/manifest.json`), and re-fetched only
when someone deliberately runs `npm run gen:prose-corpus`. `test/estate/prose-corpus.test.mjs`
checks the committed bytes against the manifest, so a hand-edit fails loudly.

**Licensing picked the sources, not preference.** The rescue pass substitutes
words and commits the result to a file npm publishes, so this corpus is
republished as a *modified derivative*. Only sources that permit derivatives
qualify. IETF RFCs and W3C specifications — including the OWL 2 Primer, the
best domain match there is — permit redistribution but **not** modification, so
they are unusable here and must not be added. SQLite's documentation is public
domain; Wikipedia is CC BY-SA 4.0. Adding Wikipedia is what makes
`generated/ace-surface-variants.jsonl` CC-BY-SA-4.0 rather than CC-BY-4.0:
share-alike is viral, and it reaches the generated file.

**Why simple-English lead sections for the everyday half.** Measured, on the
metric the rescue pass actually consumes (sentences with exactly one undeclared
word): simple.wikipedia.org lead sections yield ~0.33 rescue candidates per KB
against ~0.12 for technical prose. Lead sections are dense definitional English
("A penguin is a bird that cannot fly"), which is the shape the ACE grammar was
built to parse; later article sections drift into history and citations. The
titles cover the same everyday concepts the persona clumps model
(`scripts/build-persona-tiers.mjs`'s `CLUMP_FILES`). The technical half stays
because tmct's own domain is code.

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

The idea: a repo pulls the bundle that matches what it is about, and that
bundle's terms unify onto the **shared concept vocabulary** already in the
tier-1 graph, so specialised knowledge connects instead of floating apart.

**To add a corpus:** add an entry to `CORPUSES` in `tier2/generate.mjs` (a list
of `[subject, relation, concept]` triples) and run `node tier2/generate.mjs
--verify`. It rewrites `<id>.jsonl` and `manifest.json` (facts count, byte size,
sha256) in one deterministic pass. Curated data is authored in that file so it
stays reviewable; a corpus too big to hand-curate is a `fetch` manifest entry
(URL + sha256, opt-in network — `fetchCorpus()` is the reference downloader).

**How tier-2 wires into `tmct init` (done — `src/services/extensions.mjs`):**
`resolveExtensions(repoRoot)` ships every tier-2 bundle as a
shipped-but-inactive `BUILTIN_EXTENSIONS` entry (`tier2-general`);
`[extensions.tier2-<id>] active = true` in
`tmct.toml` (or `tmct init --corpus <id>`) flips one on, and
`seedActiveCorpusEntries` runs it through the exact same
`loadSlice → toFacts → appendFacts` pipeline as tier-1, stamped
`corpus:tier2-<id> <rel>` via `toFacts`'s `provenancePrefix` argument — no
separate tier-2 code path. Idempotency is free (`seedMemory`'s content-hashed
fact ids + pre-read skip). None of this touches `package.json` or the tier-1
budget; tier-2 files are not shipped, so they do not count against the
≤ 1.5 MB slice budget. Activation today is config-only: nothing reads a repo's
own build manifests to pick a bundle for you.

A term that would otherwise be silently dropped when a bundle is seeded (an
`ace = "none"` relation like RelatedTo/HasContext, e.g. from a broader slice)
can optionally be captured instead of vanishing: `seedMemory`'s
`captureUnknownContext: true` option (default off) runs
`src/adapters/corpus/unknown-ingest.mjs` over the same batch — see that module's own
doc comment.

## How to regenerate / extend

See `conceptnet/README.md` — one command per route (API vs dump), the
quality-filter pass, plus the seed-term list to extend. The test suite
(`test/adapters/corpus-conceptnet.test.mjs`, `test/corpus-templates.test.mjs`) guards the
contracts: slice/mapping drift, en→en shape, the ≤ 1.5 MB budget, template
ids/slots, and end-to-end seeding.
