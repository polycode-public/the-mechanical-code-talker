# PLAN_GRAPH_SCAN.md — why `init:xl`/`init:xxl`-scale corpora seed and query slowly, and how to fix it

Status: SHIPPED. All three phases are live code. Phase 1's seed-side index and Phase 2's per-turn
`factRows` memoisation landed in `src/adapters/memory/core.mjs` and `src/services/chat.mjs`. Phase 3
re-measured at real scale and beat its exit criterion: `init:xl` seeds 72,075 facts in 16.6s (was
~8m25s), and `init:xxl` seeds 238,866 in 38.5s (was still running past 70 minutes).

One question stays open. Nothing records what made the original "what is a horse" query take 13
minutes against the `init:xl` store. The three candidates below are still unresolved.

## Origin

2026-07-13 session. The prior session added `npm run init:xl`/`init:xxl` (`package.json`), which seed
much bigger corpora than before. Real measured numbers from `NEXT.md`: `init:large` seeds 37,797
facts; `init:xl` (that chain plus `--persona-size large` and `wordnet-xl`) seeds 72,075 facts in about
8m25s; `init:xxl` swaps in `wordnet-full` (192,498 raw rows) and was still running past 70 minutes
when that session stopped it. A single chat query against the `init:xl`-seeded repo — "what is a
horse" — took about 13 minutes.

That session's own handover flagged a starting hypothesis without fully verifying it:

> `syncFactSources`'s per-fact `payload.individuals.find` scan and `recomputeFactTrust`'s per-fact
> `sourcesByIdMap` full-array rebuild (`src/adapters/memory/core.mjs`) each do an O(total individuals) pass per
> newly-seeded fact; a single chat query against `init:xl`'s 72,075 facts took ~13 minutes.

This document verifies that claim by reading the real code, measuring the real seed and query paths at
several corpus sizes, and profiling a real seed + query run — then designs the fix.

## What the hypothesis got right, and what it missed

The SEED-side half of the hypothesis is correct and, on inspection, understated. `recomputeFactTrust`
doesn't do one O(n) scan per fact — `syncFactSources` (which calls it) does **six**.

Every fact `appendFacts` (`src/adapters/memory/core.mjs:1319`) touches gets one call to `syncFactSources`
(`core.mjs:949`, called from the batch loop at `core.mjs:1391`). Assume the common case of one
provenance tag per fact (a corpus seed always has exactly one — its own corpus name). Inside that one
call:

1. `upsertSource` (`core.mjs:827`) does `payload.individuals.find((i) => i?.id === info.id)`
   (`core.mjs:830`) — a linear scan of **every individual in the graph** (Facts, Utterances, Sessions,
   Sources, Rules) to find the one Source this fact's provenance tag names. A corpus bundle mints only
   a handful of distinct Source ids (one per corpus name, roughly), so after the bundle's first fact,
   this scan runs and finds a hit on every subsequent fact — still a full scan every time, because
   nothing remembers where that Source individual lives.
2. `upsertSource` then calls `upsertIndividual` (`core.mjs:1062`) to write the Source back, which does
   `payload.individuals.findIndex((x) => x?.id === ind.id)` (`core.mjs:1063`) — a **second** full scan
   of the same array, to find the position to overwrite.
3. `upsertEdge` (`core.mjs:1073`), writing the fact's `statedBy` edge, does
   `group.examples.find((e) => ...)` (`core.mjs:1082`) to check for a prior edge, then rebuilds the
   whole examples array with `group.examples.filter((e) => !(...))` (`core.mjs:1084`–`1086`) to drop
   it before pushing the new one — two full scans of the `statedBy` edge list, which has roughly one
   entry per fact ever seeded.
4. `recomputeFactTrust` (`core.mjs:931`) calls `statedByObjectsFor` (`core.mjs:914`), which does
   `(g?.examples || []).filter((e) => e?.subject === factId)` (`core.mjs:917`) — a **third** scan of
   that same `statedBy` edge list.
5. `recomputeFactTrust` then calls `sourcesByIdMap` (`core.mjs:908`), which rebuilds a fresh
   `{id: Source}` map with `for (const i of payload.individuals) if (i?.class === SOURCE_CLASS) ...`
   (`core.mjs:909`–`910`) — a full scan of every individual again, from scratch, discarded after one
   use.

That is six linear scans over arrays whose length is proportional to the total graph size, run once
per fact in the batch. `appendFacts` itself does the right thing for the FACT upsert — it builds an
`id → individual` `Map` once (`core.mjs:1344`) and reuses it — but that map is never threaded into
`syncFactSources`/`upsertSource`/`upsertEdge`/`recomputeFactTrust`, so all of the Source/edge/trust
bookkeeping those call out to still re-scans the raw arrays every time. The result is O(n) work per
fact for a batch of n facts: **O(n²)** for one bundle, not the O(n) the batching comment above
`appendFacts` (`core.mjs:1290`–`1295`) claims it achieves relative to a per-fact `appendFact` loop.
That comment is right about eliminating the O(n²) **I/O** (one read-modify-write instead of n of
them); it does not eliminate the O(n²) **CPU** work inside the single write.

## Confirming it: real measurements

All repro code lived outside the repo (scratch directory, deleted after use) and ran against the
real `appendFacts`/`seedMemory`/`factAnswer`/`runTurn` from this worktree's `src/`, in throwaway temp
dirs — never the real repo's `.tmct/`.

**Synthetic facts, one `appendFacts` batch call per size** (unique subject/object per fact, one shared
provenance tag, mirroring one corpus bundle):

| facts (n) | seed time | query time |
| ---: | ---: | ---: |
| 500 | 0.07s | 0.012s |
| 2,000 | 0.44s | 0.028s |
| 8,000 | 5.49s | 0.094s |
| 16,000 | 27.21s | 0.156s |
| 32,000 | 75.38s | 0.356s |

Doubling n from 8,000 to 16,000 multiplies seed time by 4.96×; doubling again to 32,000 multiplies it
by 2.77×. Both are far above the 2× a linear cost would produce and roughly track the 4× an O(n²) cost
predicts — noisy (V8 array/GC behavior at these sizes isn't perfectly smooth), but the shape is
unambiguous: seeding is super-linear, consistent with the six-scans-per-fact analysis above.

**Real `corpus/wordnet/wordnet-xl.jsonl`** (the actual file `init:xl` seeds, 23,805 rows, via the real
`seedMemory`), which carries real hub structure (a common word appears in many rows), not synthetic
one-off terms:

| rows (limit) | facts appended | seed time | `factAnswer` alone | full `runTurn` |
| ---: | ---: | ---: | ---: | ---: |
| 4,000 | 4,000 | 1.48s | 0.059s | 0.345s |
| 8,000 | 8,000 | 7.50s | 0.126s | 0.442s |
| 16,000 | 16,000 | 24.99s | 0.171s | 0.778s |
| all | 23,805 | 39.43s | 0.300s | 0.311s |

Same super-linear seed pattern on real data. Extrapolating this growth to a single 72,075-fact bundle
lands in the same ballpark as the real, independently measured `init:xl` figure (~8m25s) — strong
corroboration that the seed-side mechanism identified above is the real driver, not an artifact of the
synthetic test.

**A real CPU profile** (`node --prof`) of one `seedMemory` call over the full 23,805-row
`wordnet-xl.jsonl`, followed by 40 repeated `runTurn("what is a horse", ...)` calls against the
resulting store, confirms the code-reading analysis directly: the three hottest JavaScript functions
by sample count were `upsertSource` (10.2% of all ticks), `syncFactSources` (9.4%), and
`sourcesByIdMap` (6.0%), with their scanning closures at `core.mjs:830` (the `upsertSource` `.find`),
`core.mjs:1063` (the `upsertIndividual` `.findIndex`), and `core.mjs:917` (the `statedByObjectsFor`
`.filter`) rounding out the next three entries. Half the total profile (52.6%) was C++ time dominated
by `std::__1::vector<...>::reserve` — consistent with `upsertEdge`'s pattern of rebuilding the entire
`statedBy` examples array on every single fact (`core.mjs:1084`–`1087`) instead of mutating it in
place.

## The query-side hypothesis: not confirmed at the scale this repro could reach

The original finding named the query side too — a 13-minute single query against the 72,075-fact
`init:xl` store. Reading the query path found a real, related defect: `factRows` (`src/services/chat.mjs:4209`)
calls `loadMemory` (full file read + `JSON.parse`) and `readFactRows` (`core.mjs:1728`, another O(n)
pass building two `Map`s and scanning every individual) **fresh, uncached, on every call** — and
`factAnswer` alone (`chat.mjs:4615`–`5018`) calls it from at least seven separate call sites
(`chat.mjs:4635`, `4656`, `4706`, `4766`, `4785`, `4822`, `4850`), with more call sites in
`factReadBack` (`chat.mjs:5286` onward) and other reader functions (`memoryFacts`, `chat.mjs:4189`,
has the same shape). One `runTurn` call can trigger many of these full reloads.

That is a real inefficiency and worth fixing. But it does not, by itself, explain a 13-minute query.
The tables above show `factAnswer` and full `runTurn` both staying under one second even at 23,805
real, hub-shaped facts (44,075 short of the 72,075 in the original observation) and under half a
second at 32,000 synthetic facts. Extrapolating either curve — linearly or with real seed-side's
quadratic slope applied — predicts low single-digit seconds at 72,075 facts, not 780 seconds.

This document could not safely close that gap. Reproducing the real `init:xl` scale (72,075 facts
across seven corpus bundles, ~8m25s to seed under the current code) was out of budget for one repro
pass on a machine already running many concurrent agents, and the task's own instructions were
explicit about not repeating heavy runs. Three honest candidates remain open, in decreasing order of
plausibility given the evidence gathered here:

1. **The uncached-reload pattern above, at a genuinely larger scale than tested here.** Seven-plus
   full O(n) reloads per turn is cheap at 24,000–32,000 facts (each reload costs well under 100ms) but
   is not free, and this document's repro didn't reach 72,075 facts to see whether the per-reload cost
   itself starts growing worse than O(n) at that size (e.g. GC pause growth as heap size crosses a
   generation threshold).
2. **A hub effect specific to combining multiple corpora.** The real `init:xl` store merges seven
   bundles (seon, conceptnet, aws, python, java, `human-large`, wordnet-xl); "horse" or its neighbors
   may accumulate a much larger candidate/citation set once every bundle's facts about it are unioned
   than the single-bundle wordnet-xl test here shows (16 "horse" mentions in wordnet-xl alone).
3. **Environmental contention.** This project's own standing operating note is that the machine was
   "heavily oversubscribed tonight from multiple concurrent agents" when the original 13-minute figure
   was recorded — a real confound this document cannot rule out from a single anecdotal observation.

None of these were confirmed. The fix design below still recommends closing the uncached-reload gap
(item 1) because it is real, cheap, and low-risk regardless of how much of the 13 minutes it explains
— but the phased plan below names a concrete, cheap follow-up step to actually pin this down once the
seed-side fix makes rebuilding the real 72,075-fact corpus fast enough to iterate on directly.

## Fix design

### Seed side: an index scoped to one `mutateMemory` call

The six scans above all exist because nothing in `syncFactSources`'s call chain remembers where a
Source individual or a `statedBy` edge already lives — every lookup re-derives it from the raw arrays.
The fix is the same shape `appendFacts` already proved for the Fact upsert itself (`core.mjs:1344`'s
`byId` `Map`): build small index `Map`s once, and thread them through every helper that currently
does a linear scan.

Concretely, `mutateMemory` (`core.mjs:765`) builds three `Map`s right after `loadMemory` resolves,
attached to the `payload` object under a `Symbol` key (never a plain enumerable property, so
`JSON.stringify`/`persistMemory`'s write never serializes it and the on-disk `graph.json` shape is
unchanged):

- `individualsById: Map<id, individual>` — replaces `upsertSource`'s `.find` (`core.mjs:830`) and
  `upsertIndividual`'s `.findIndex` (`core.mjs:1063`) with an O(1) lookup; `upsertIndividual` also
  updates this map on every insert, the same way it already updates the array.
- `sourcesById: Map<id, Source individual>` — a subset view kept incrementally (add an entry when
  `upsertSource` creates or updates a Source), replacing `sourcesByIdMap`'s full rebuild
  (`core.mjs:908`–`911`) with a value that's already correct.
- `statedByBySubject: Map<factId, sourceId[]>` — replaces both `statedByObjectsFor`'s `.filter`
  (`core.mjs:917`) and `upsertEdge`'s `.find`+`.filter` pair (`core.mjs:1082`, `1084`–`1086`) for the
  `statedBy` predicate specifically; `upsertEdge` updates this map when it writes that predicate's
  group, keyed by the edge's subject.

Each of `upsertSource`, `upsertIndividual`, `upsertEdge`, `statedByObjectsFor`, and `sourcesByIdMap`
gains an optional index-bag parameter (or reads it off `payload`'s Symbol slot); when present, they
use the O(1) path; when absent — a bare payload object built outside `mutateMemory` (a test fixture,
say) — they fall back to today's linear scan, so nothing outside `mutateMemory`'s own call chain can
observe a behavior change. This is additive and backward compatible by construction.

**Consistency.** The index is rebuilt from scratch at the top of every `mutateMemory` call (one O(n)
pass, not per fact) and discarded at the end. It never survives across calls, so there is no
invalidation logic to get wrong and no way for a prior mutation's index to leak into a later one. The
only discipline required is mechanical: any function that adds to `payload.individuals` or
`payload.objectProperties` must also write the matching index entry in the same statement — the exact
pattern `appendFacts`'s own `byId` `Map` (`core.mjs:1344`, `1376`) already uses correctly for the Fact
upsert; this fix generalizes that proven pattern rather than inventing a new one.

### Query side: memoize the per-turn reload

`runTurn` (`chat.mjs:8933`) should load the memory payload once and thread it (or the `readFactRows`
output derived from it) down to `factAnswer`, `factReadBack`, and every other reader that currently
calls `factRows`/`memoryFacts` independently. This is a mechanical refactor, not a new mechanism —
every call site already takes `memoryDir` and re-derives the same rows; the fix is to derive them once
per turn and pass them through. It does not change any answer's content (same data, computed once
instead of repeatedly), so it should be behavior-preserving and verifiable by the existing test suite
without new fixtures.

## Expected impact

**Seed side:** high confidence. O(n²) → O(n) on a mechanism this document measured directly (six
redundant scans collapsing to O(1) lookups) should take `init:xl`'s ~8m25s seed down to low
single-digit seconds — the underlying per-fact work outside the six scans (normalize, tokenize,
hash) is already cheap and already O(n) total. `init:xxl`'s `wordnet-full` step (192,498 rows, still
running past 70 minutes today) should become tractable, likely low minutes dominated by legitimate
JSON parsing and disk I/O of a 25MB+ file rather than algorithmic waste.

**Query side:** honest, not confident. The uncached-reload fix is real and should turn N full-graph
rescans per turn into one, which is a straightforward, low-risk win regardless of scale. Whether it
closes the specific 13-minute gap reported for the original "what is a horse" query is unverified —
this document's own repro didn't reproduce anywhere near that magnitude at up to 32,000 facts, so the
honest claim is "this removes a real inefficiency," not "this fixes the 13-minute number." Phase 3
below names the concrete follow-up to find out.

## Phased implementation plan

**Phase 1 — seed-side index.** Add the Symbol-keyed index bag in `mutateMemory`; rewire
`upsertSource`/`upsertIndividual`/`upsertEdge`/`statedByObjectsFor`/`sourcesByIdMap` to use it with a
linear-scan fallback when absent. Exit criterion: `npm test` green, and re-running this document's own
repro at the same sizes (500 → 32,000 facts, both synthetic and real `wordnet-xl.jsonl`) shows
near-linear seed scaling instead of the super-linear pattern measured here.

**Phase 2 — query-side memoization.** Thread one loaded payload/rows through a single `runTurn` call
instead of each reader independently reloading. Exit criterion: `npm test` green; a temporary call-count
check (not committed) confirms one `loadMemory` per `runTurn` call instead of the seven-plus measured
here for `factAnswer` alone.

**Phase 3 — real-scale verification.** With Phase 1 landed, re-run `npm run init:xl` (now fast enough
to iterate on directly) and record the real new wall-clock seed time in `NEXT.md`. Re-run the
original "what is a horse" query against that real store, with Phase 2 also landed, and profile it if
it's still slow. The seed re-measure landed (16.6s / 38.5s above). The query-side gap did not get
pinned down, so the three candidates above stay open.

## Non-goals

- No storage-backend redesign. The flat-JSON (Backend A) and sqlite (Backend C) backends keep their
  existing shape; this document is about making the existing backends scale correctly, not replacing
  them. `PLAN_MUD.md`'s DynamoDB-backed `server:` backend is a separate track for a separate reason.
- No change to `graph.json`'s on-disk shape. The proposed index is in-memory-only, scoped to one
  `mutateMemory` call, and never serialized.
- No attempt to fully root-cause the exact 13-minute query figure. The evidence gathered here rules
  out simple total-fact-count scaling as the sole explanation but could not reach the real
  72,075-fact, multi-corpus scale to confirm what does explain it. Still open.
