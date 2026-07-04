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
- **Retrieved + filtered:** 2026-07-04.
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
   mapped in `src/corpus/conceptnet-map.toml`), minus three filtered by
   policy: `/r/EtymologicallyRelatedTo`, `/r/EtymologicallyDerivedFrom`,
   `/r/ExternalURL` (etymology noise and link-outs — no consumer in tmct).
3. **Tech-domain seed terms**: at least one endpoint's bare term is in the
   90-term software/tech seed list exported as `SEED_TERMS` from
   `fetch-slice.mjs` (software, computer, program, code, module, function,
   database, server, network, bug, test, file, memory, algorithm, keyboard,
   programmer, repository, commit, …).
4. **Dedupe** by `(start, rel, end)`, keeping the higher weight.
5. **Size budget** (committed slice ≤ 1.5 MB; target ~1.4 MB), **two-tier**:
   assertions whose relation maps to an ACE-OWL pattern (`ace != "none"` in
   `conceptnet-map.toml`) are kept first, weight-descending; `ace = "none"`
   relations (`RelatedTo`, `Synonym`, …) fill the remaining budget — they
   are kept for future lexicon/fuzzy-match use but never crowd out seedable
   facts.
6. Deterministic output order: `(rel, start, end)`.

## Row counts (committed slice, 2026-07-04)

**14,258 assertions, 1,399,979 bytes** (34,074,917 dump lines scanned;
28,802 unique en→en seed assertions matched = 4,170 mappable + 24,632
`ace="none"`; ALL 4,170 mappable kept, 10,088 none-rows fill the budget).
29 of the 31 non-filtered canonical relations are present:

| Relation | Rows | | Relation | Rows |
|---|---|---|---|---|
| `/r/RelatedTo` | 4911 | | `/r/HasA` | 39 |
| `/r/HasContext` | 2634 | | `/r/HasProperty` | 27 |
| `/r/IsA` | 2594 | | `/r/Antonym` | 25 |
| `/r/DerivedFrom` | 1906 | | `/r/MotivatedByGoal` | 25 |
| `/r/AtLocation` | 459 | | `/r/SimilarTo` | 20 |
| `/r/Synonym` | 368 | | `/r/DistinctFrom` | 19 |
| `/r/UsedFor` | 312 | | `/r/DefinedAs` | 16 |
| `/r/FormOf` | 224 | | `/r/MadeOf` | 14 |
| `/r/CapableOf` | 164 | | `/r/CausesDesire` | 12 |
| `/r/MannerOf` | 141 | | `/r/HasLastSubevent` | 12 |
| `/r/PartOf` | 115 | | `/r/Causes` | 11 |
| `/r/HasPrerequisite` | 103 | | `/r/CreatedBy` | 10 |
| `/r/HasSubevent` | 42 | | `/r/Desires` | 7 |
| `/r/ReceivesAction` | 40 | | `/r/HasFirstSubevent` | 7 |
| | | | `/r/LocatedNear` | 1 |

Absent from the slice (nothing matched the seed terms): `/r/ObstructedBy`,
`/r/SymbolOf` — both still have mapping rows, so a regenerated slice that
surfaces them stays covered.

## How to regenerate / extend

```bash
# preferred when api.conceptnet.io is healthy (polite, ~1 req/s, several minutes):
node corpus/conceptnet/fetch-slice.mjs corpus/conceptnet/slice.jsonl

# the dump route (used for the committed slice; ~500 MB streamed, nothing stored):
curl -s https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz \
  | gunzip -c \
  | node corpus/conceptnet/filter-dump.mjs > corpus/conceptnet/slice.jsonl
```

To extend the domain, add seed terms to `SEED_TERMS` in `fetch-slice.mjs` and
re-run. `npm test` guards the contract: every relation present in the slice
must have a row in `src/corpus/conceptnet-map.toml` (drift guard), en→en shape
and the ≤ 1.5 MB budget are asserted, and the seeding path is exercised
end-to-end.

## Consumers

- `src/corpus/conceptnet.mjs` — `loadSlice()` / `toFacts()` / `seedMemory()`:
  maps mappable assertions onto memory facts
  (`{subject, predicate, object, provenance:"corpus:conceptnet /r/…"}`)
  and seeds `.tmct/memory/` via `appendFact` (idempotent).
- `src/corpus/conceptnet-map.toml` — the relation → ACE-OWL pattern table
  deciding which relations emit facts and under which predicate URI.
