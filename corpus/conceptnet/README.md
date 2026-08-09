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
  raising the size budget — see "Growing the slice" below; **re-cut on
  2026-08-09** to add CommonsenseQA's train-split concepts as a third seed
  source — see "Adding the CommonsenseQA seed" below.
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
3. **Seed terms**: at least one endpoint's bare term is in one of three seed
   lists — the ~90-term tech base `SEED_TERMS` exported from `fetch-slice.mjs`
   (software, computer, program, code, module, function, database, server,
   network, bug, test, file, memory, algorithm, keyboard, programmer,
   repository, commit, …); the ~230-term `EXTRA_SEEDS` tech growth list in
   `filter-dump.mjs` (programming languages, frameworks, data structures,
   cloud/infra, protocols, tools, ML — python, java, docker, kubernetes, git,
   neural_network, tcp, kernel, hashtable, …), added 2026-07-05 to reach the
   ~40k tier-1 target while staying in the tech domain; and the 2,151-term
   `COMMONSENSEQA_SEED_TERMS` list in `commonsenseqa-seed.mjs` (every distinct
   `question_concept` in CommonsenseQA's train split — dog, magazine,
   bookstore, restaurant, …), added 2026-08-09 so the slice can carry a
   relational edge between a commonsense question's source concept and its
   answer.
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

## Adding the CommonsenseQA seed (2026-08-09)

`corpus/conceptnet/manifest.json` (built on the `corpus/child/manifest.json`
model) pins the dump, the three seed files and the committed slice's byte
count, sha256 and per-relation counts — a re-cut that drifts fails
`test/estate/corpus-manifests.test.mjs` rather than landing silently, the same
guard `corpus/child/` already had and `corpus/conceptnet/` did not.

Adding `COMMONSENSEQA_SEED_TERMS` widened the matched candidate set from
45,633 to 603,217 unique en→en assertions (520,899 of them mappable, `ace !=
"none"`), which is now larger than the 4.5 MB budget on its own — so the
budget-trim tier that used to spend leftover space on `ace="none"` rows
(`RelatedTo`, `HasContext`, `DerivedFrom`, `FormOf`, …) mostly stopped
reaching them: mappable rows alone fill the budget. `CONCEPTNET_PREFER` in
`src/services/extensions.mjs` gained the five relational predicates a
commonsense question keys on (`atLocation`, `causes`, `desires`,
`motivatedByGoal`, `hasSubevent`), ranked after the definitional backbone,
which is a separate stage (`scripts/build-chat-seed.mjs`'s band-cap spend) —
`filter-dump.mjs`'s own tier/weight order decides what ships in the committed
slice.

## Row counts (CommonsenseQA-seeded re-cut, 2026-08-09)

**30,250 clean assertions, 4,271,438 bytes** — the quality-filtered committed
slice (raw filter-dump output was 31,575 rows / 4,499,981 bytes; 34,074,917
dump lines scanned; 603,217 unique en→en seed assertions matched = 520,899
mappable + 82,318 `ace="none"`; 31,575 mappable rows fit the 4.5 MB budget,
0 `ace="none"` rows did; then 1,325 noise rows cut — 1,318 by shape, plus 7
`DENIED_ROWS` entries, all newly reachable now that `dog` is seeded:
Verbosity-game description hints ConceptNet stored as `/r/IsA` rather than
real classes (`dog IsA chap`, `example_of_pet`, `faithful_companion`,
`good_friend`, `loyal_friend`, `mans_best_friend`, `nice_friend`) — the digest
layer's rarity-favouring scorer (`src/domain/digest/select.mjs`) picked
whichever of these was rarest across the store as the "most informative"
class for a plain "what is a dog", one at a time, each denial surfacing the
next; `canine`/`domestic_animal`/`four_legged_animal`/`mammal`/`pet` are
genuine classes and stay).

| Relation | Rows | | Relation | Rows |
|---|---|---|---|---|
| `/r/IsA` | 11722 | | `/r/HasFirstSubevent` | 103 |
| `/r/AtLocation` | 4500 | | `/r/HasLastSubevent` | 96 |
| `/r/RelatedTo` | 4422 | | `/r/PartOf` | 91 |
| `/r/HasSubevent` | 1762 | | `/r/DistinctFrom` | 72 |
| `/r/CapableOf` | 1557 | | `/r/ReceivesAction` | 70 |
| `/r/HasPrerequisite` | 1388 | | `/r/CreatedBy` | 36 |
| `/r/UsedFor` | 1241 | | `/r/Synonym` | 26 |
| `/r/Causes` | 1193 | | `/r/MadeOf` | 18 |
| `/r/HasProperty` | 481 | | `/r/DefinedAs` | 10 |
| `/r/Desires` | 453 | | | |
| `/r/HasA` | 339 | | | |
| `/r/CausesDesire` | 305 | | | |
| `/r/MotivatedByGoal` | 219 | | | |
| `/r/Antonym` | 146 | | | |

Absent from this cut: `/r/FormOf`, `/r/HasContext` and `/r/DerivedFrom` are
`ace="none"` by design (lexicon/domain-tag material, not world knowledge) and
got none of the budget now that mappable rows alone fill it; `/r/MannerOf`,
`/r/SimilarTo`, `/r/LocatedNear`, `/r/SymbolOf` and `/r/ObstructedBy` are
mappable but lost the weight-descending cut within the budget. Every one of
them still has a mapping row, so a regenerated slice that surfaces one stays
covered.

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
dump route that produces the committed slice), `SEED_TERMS` in
`fetch-slice.mjs` (the API route), or `COMMONSENSEQA_SEED_TERMS` in
`commonsenseqa-seed.mjs` (the CommonsenseQA train-split concepts), and re-run.
After a re-cut, regenerate `manifest.json`'s byte count, sha256 and per-
relation counts too — `test/estate/corpus-manifests.test.mjs` fails on drift
against the committed pin. `npm test` guards the rest of the contract: every
relation present in the slice must have a row in
`src/adapters/corpus/conceptnet-map.toml` (drift guard), en→en shape and the
≤ 5 MB budget are asserted, and the seeding path is exercised end-to-end.

## Consumers

- `src/adapters/corpus/conceptnet.mjs` — `loadSlice()` / `toFacts()` / `seedMemory()`:
  maps mappable assertions onto memory facts
  (`{subject, predicate, object, provenance:"corpus:conceptnet /r/…"}`)
  and seeds `.tmct/memory/` via `appendFact` (idempotent).
- `src/adapters/corpus/conceptnet-map.toml` — the relation → ACE-OWL pattern table
  deciding which relations emit facts and under which predicate URI.
