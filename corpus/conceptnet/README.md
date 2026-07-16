# corpus/conceptnet — the committed tech-domain ConceptNet slice

`slice.jsonl` is a filtered excerpt of **real ConceptNet 5.7.0 data** — one
assertion per line:

```json
{"start":"/c/en/bug","rel":"/r/IsA","end":"/c/en/insect","weight":6.32,"surfaceText":"[[a bug]] is [[an insect]]"}
```

**Licence: CC-BY-SA 4.0** (ConceptNet-derived data; NOT this repo's MPL-2.0) —
see `LICENSE-NOTICE` in this directory for the full attribution.

## Provenance and retrieval

- **Source:** ConceptNet 5.7.0 assertions dump,
  `https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz`
  (published 2019-07-03).
- **Retrieved + filtered:** 2026-07-04; **regrown to the ~40k tier-1 target on
  2026-07-05** (same dump, same licence) by widening the tech-seed domain and
  raising the size budget — see "Growing the slice" below.
- **Why the dump, not the API:** the public API (`api.conceptnet.io`) was
  hard-down (HTTP 502 from its nginx front-end on every request across ~15
  attempts over 10+ minutes on 2026-07-04), so the slice was stream-filtered
  from the published dump instead — same data, same licence. `fetch-slice.mjs`
  (the API route) is kept for when the API is healthy; `filter-dump.mjs` is
  the route that actually produced the committed slice.

## Filter rules

1. **English only**: `start` AND `end` are `/c/en/…` concepts; word-sense
   suffixes are stripped (`/c/en/bug/n` → `/c/en/bug`); self-loops after
   stripping are dropped.
2. **Canonical relations only**: the closed set of 34 relations (the same set
   mapped in `src/adapters/corpus/conceptnet-map.toml`), minus three filtered by
   policy: `/r/EtymologicallyRelatedTo`, `/r/EtymologicallyDerivedFrom`,
   `/r/ExternalURL` (etymology noise and link-outs — no consumer in tmct).
3. **Tech-domain seed terms**: at least one endpoint's bare term is in the
   tech seed list — the ~90-term base `SEED_TERMS` exported from
   `fetch-slice.mjs` (software, computer, program, code, module, function,
   database, server, network, bug, test, file, memory, algorithm, keyboard,
   programmer, repository, commit, …) **plus** the ~230-term `EXTRA_SEEDS`
   growth list in `filter-dump.mjs` (programming languages, frameworks, data
   structures, cloud/infra, protocols, tools, ML — python, java, docker,
   kubernetes, git, neural_network, tcp, kernel, hashtable, …), added
   2026-07-05 to reach the ~40k tier-1 target while staying in the tech domain.
4. **Dedupe** by `(start, rel, end)`, keeping the higher weight.
5. **Size budget** (committed slice ≤ 5 MB; target ~4.3 MB), **two-tier**:
   assertions whose relation maps to an ACE-OWL pattern (`ace != "none"` in
   `conceptnet-map.toml`) are kept first, weight-descending; `ace = "none"`
   relations (`RelatedTo`, `Synonym`, …) fill the remaining budget — they
   are kept for future lexicon/fuzzy-match use but never crowd out seedable
   facts.
6. Deterministic output order: `(rel, start, end)`.

## Quality-filter pass (regrown slice, 2026-07-05)

`filter-dump.mjs` keeps the DATA honest (tech-seed match, canonical relations,
budget) but not the SEMANTICS: ConceptNet's crowd-sourced "Verbosity"/Open-Mind
rows leave sentence-fragment "concepts" and opinion axioms that read as nonsense
once seeded ("a computer is a kind of dumb", "a class is a kind of elegance",
"mouse AtLocation taloned_grip_of_owl", "2 is a kind of software"). A second
pass, `quality-filter.mjs`, removes those by term/relation shape (never per
row):

- **numeric endpoint** — bare term all digits (`2`, `1000`, `80386`)
- **single-char endpoint** — bare term length ≤ 1 (`a`, `r`, `m`)
- **sentence fragment** — ≥ 4 underscore-words on either endpoint
  (`taloned_grip_of_owl`, `worlds_largest_interconnected_network_of_networks`)
- **definitional phrase** — `/r/DefinedAs` with a ≥ 3-word object (real
  `DefinedAs` is a synonym: `cpu → processor`)
- **opinion object** — `/r/IsA` / `/r/DefinedAs` whose object is in a small
  evidence-based set (`elegance, evil, gloom, unreality, universalism, dumb,
  free, junk`) — never a class

**Result (2026-07-05 regrow): 45,633 → 44,947 rows (686 cut), 4,308,850 →
4,220,629 bytes.** Cuts by reason: sentence-fragment 613, single-char 48,
numeric 11, opinion-object 8, definitional-phrase 6. Of the seedable (mapped,
`ace≠none`) facts, the clean slice carries **6,255** — up from 3,884 in the
1.35 MB slice. No relation disappeared entirely (the drift guard stays
satisfied). Re-run any time with:

```bash
node corpus/conceptnet/quality-filter.mjs --in-place corpus/conceptnet/slice.jsonl
```

## Growing the slice toward the ~40k tier-1 target (done 2026-07-05)

The operator's ~40k-fact tier-1 target is **shipped**: the slice was regrown
from the same ConceptNet dump by (a) widening the tech domain with the
`EXTRA_SEEDS` list in `filter-dump.mjs` (~230 tech terms — languages,
frameworks, data structures, cloud/infra, protocols, tools, ML) and (b) raising
`MAX_BYTES` in `filter-dump.mjs` from 1.4 MB to 4.5 MB with the matching test
budget assertion (`test/adapters/corpus-conceptnet.test.mjs`) raised from 1.5 MB to
5 MB. The widened seed set matched **45,633 unique en→en assertions** (all under
budget, so no tier-trimming was needed this pass), and the quality filter
trimmed them to the committed **44,947 clean facts**. Regenerate with:

```bash
# 1. stream-filter the dump (widened seeds + raised budget already live in filter-dump.mjs)
curl -s https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz \
  | gunzip -c | node corpus/conceptnet/filter-dump.mjs > corpus/conceptnet/slice.jsonl
# 2. re-apply the semantic quality filter
node corpus/conceptnet/quality-filter.mjs --in-place corpus/conceptnet/slice.jsonl
```

## Row counts (regrown slice, 2026-07-05)

**44,947 clean assertions, 4,220,629 bytes** — the quality-filtered committed
slice (raw filter-dump output was 45,633 rows / 4,308,850 bytes; 34,074,917 dump
lines scanned; 45,633 unique en→en seed assertions matched = 6,670 mappable +
38,963 `ace="none"`; ALL kept under the 4.5 MB budget, then 686 noise rows cut).
30 of the 31 non-filtered canonical relations are present; **6,255 seedable
(`ace≠none`) facts**:

| Relation | Rows | | Relation | Rows |
|---|---|---|---|---|
| `/r/RelatedTo` | 29016 | | `/r/HasSubevent` | 42 |
| `/r/HasContext` | 4376 | | `/r/DistinctFrom` | 32 |
| `/r/IsA` | 4173 | | `/r/HasProperty` | 30 |
| `/r/DerivedFrom` | 3388 | | `/r/ReceivesAction` | 27 |
| `/r/Synonym` | 1126 | | `/r/MotivatedByGoal` | 26 |
| `/r/AtLocation` | 642 | | `/r/MadeOf` | 20 |
| `/r/FormOf` | 528 | | `/r/Causes` | 18 |
| `/r/UsedFor` | 378 | | `/r/CreatedBy` | 15 |
| `/r/CapableOf` | 231 | | `/r/CausesDesire` | 13 |
| `/r/MannerOf` | 230 | | `/r/Desires` | 9 |
| `/r/PartOf` | 196 | | `/r/HasLastSubevent` | 8 |
| `/r/Antonym` | 155 | | `/r/HasFirstSubevent` | 7 |
| `/r/HasPrerequisite` | 108 | | `/r/LocatedNear` | 3 |
| `/r/SimilarTo` | 102 | | `/r/DefinedAs` | 2 |
| `/r/HasA` | 45 | | `/r/SymbolOf` | 1 |

Absent from the slice (nothing matched the seed terms): `/r/ObstructedBy` — it
still has a mapping row, so a regenerated slice that surfaces it stays covered.

## How to regenerate / extend

```bash
# preferred when api.conceptnet.io is healthy (polite, ~1 req/s, several minutes):
node corpus/conceptnet/fetch-slice.mjs corpus/conceptnet/slice.jsonl

# the dump route (used for the committed slice; ~500 MB streamed, nothing stored):
curl -s https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz \
  | gunzip -c \
  | node corpus/conceptnet/filter-dump.mjs > corpus/conceptnet/slice.jsonl
```

To extend the domain, add seed terms to `EXTRA_SEEDS` in `filter-dump.mjs` (the
dump route that produces the committed slice) or `SEED_TERMS` in
`fetch-slice.mjs` (the API route) and re-run. `npm test` guards the contract:
every relation present in the slice must have a row in
`src/adapters/corpus/conceptnet-map.toml` (drift guard), en→en shape and the ≤ 5 MB
budget are asserted, and the seeding path is exercised end-to-end.

## Consumers

- `src/adapters/corpus/conceptnet.mjs` — `loadSlice()` / `toFacts()` / `seedMemory()`:
  maps mappable assertions onto memory facts
  (`{subject, predicate, object, provenance:"corpus:conceptnet /r/…"}`)
  and seeds `.tmct/memory/` via `appendFact` (idempotent).
- `src/adapters/corpus/conceptnet-map.toml` — the relation → ACE-OWL pattern table
  deciding which relations emit facts and under which predicate URI.
