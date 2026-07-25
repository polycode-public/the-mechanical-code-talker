# researchbench — the tmct RESEARCH-TRAVERSAL measurement harness

The sibling of `idxbench`/`agentbench`/`infbench`, on the focused-crawling axis.
Full design in `SKILL_BENCHMARK_RESEARCH.md` — this file is the mechanics.

**What it grades: the TRAVERSAL, not the per-article facts.** RESEARCHBENCH
replays `research <seed>` + `research next` through the REAL lane
(`src/services/research.mjs`'s `researchTurn`/`researchSnapshot`) and grades
which links get followed, in what order, and when the run stops. It never
grades whether the triples a fetched article yields are correct — that is
`SKILL_BENCHMARK_INGEST.md`'s job; this harness's own `ingest` callback is a
deliberate no-op (`async () => 0`), so no memory store is ever written by a
graded run.

**No live wiki, no LLM, no judge, no network.** Every fetch is answered by a
frozen stub graph (`researchbench/fixture/graph.json`) registered through the
lane's own provider seam (`registerResearchProvider`,
`src/adapters/corpus/wikipedia-live.mjs`) — the same seam
`test-e2e/pages-ledger-research.test.mjs` stubs. Two runs over the same fixture and
stamp produce byte-identical `product.jsonl`.

## The ladder

| rung | what this harness measures | today |
| ---- | --------------------------- | ----- |
| RES-0 | fetch and stop at depth 0 | PASS |
| RES-1 | the lead-section links queue in document order | PASS |
| RES-2 | the kin rank ahead of the hubs in that queue | gates (today's lane doesn't reorder) |
| RES-3 | a tight budget skips the hubs entirely | skipped-with-a-receipt (gated by RES-2) |
| RES-4 | every useful term reachable in `k` hops is reached | skipped-with-a-receipt |
| RES-5 | the useful terms are reached WITHIN a tight budget | skipped-with-a-receipt |
| RES-6 | a promising branch gets more depth than a thin one | skipped-with-a-receipt |
| RES-7 | need-directed research (a question ends the run) | ceiling marker — no lane capability |
| RES-8 | self-assessed coverage (the run stops on its own judgement) | ceiling marker — no lane capability |

RES-2 gating RES-3 onward is the honest, expected shape of a fresh
measure-then-build cycle: today's fan-out is plain document order with no
relevance ranking or hub demotion, so RES-2's ordering floor (0.8) legitimately
fails against the canonical volcano case (order score ≈0.67) — a real signal
for a future cycle to push past, not a harness bug. RES-7/RES-8 are named
research horizons per the skill doc (§3: focused crawling, information
foraging, active-learning stopping rules) and never reach the gate at all —
`run.mjs` never even drives the lane for them.

## The fixture

`researchbench/fixture/graph.json` — the canonical volcano case from
`playtests/PLAYTEST_LOG_023`: `Volcano`'s lead links to `Active volcano`,
`Earth`, `East African Rift`, `Geology`, `Hawaii`, and one ISBN-shaped
identifier link. `Earth` and `Geology` are the crowded hubs (referenced from
multiple fixture articles — the degree-proxy hub signal,
`HUB_DEGREE_FLOOR = 2` in `grade.mjs`); the ISBN link is flagged by the
pattern signal regardless of degree. `Active volcano`, `East African Rift`,
and `Hawaii` are the useful kin; `Active volcano` itself links on to `Magma`,
the 2-hop term RES-4/5/6's cases reach for. Every title any article's
`leadLinks` names either has its own entry or is listed in `deadTitles` (the
fixture provider returns `null` for those — the stub's 404 shape, exercising
the same skip path a live dead link takes).

`researchbench/fixture/provider.mjs` builds the `{lookup, pageByTitle,
linkedTitles}` provider over that graph — pure, no network, no fs beyond
reading the committed JSON once.

## Running

```sh
node researchbench/run.mjs --ladder --stamp 3.0.0
node researchbench/run.mjs --rung RES-2
node researchbench/run.mjs --only res-volcano-queue
# (npm run researchbench:run -- --stamp 3.0.0  once the coordinator adds the script)
```

- **`--stamp`** must be a filesystem-safe label; **`--out`** overrides the
  output dir; **`--rung <RES-0|…|RES-8>`** and **`--only <id,…>`** narrow the
  selection; **`--ladder`** gates ascending rungs (RES-7/RES-8 excluded from
  the gate entirely — see above) and prints skipped-with-a-receipt lines.

## Files

| file | role |
| ---- | ---- |
| `cases.jsonl` | the case set — append-only once the arc starts |
| `grade.mjs` | pure grading: the hub-signal computation, the metric trio (ordering, hub-avoidance, recall@budget), the invented-traversal check, rollup + ladder gate |
| `fixture/graph.json` | the frozen stub wiki graph |
| `fixture/provider.mjs` | builds a `{lookup, pageByTitle, linkedTitles}` provider over that graph |
| `run.mjs` | the runner: drives each case through the real lane, grades, writes `results/raw/run-<stamp>/product.jsonl` |
| `results/` | run output (`results/raw/` is gitignored) |

## Case shape (`cases.jsonl`)

```json
{ "id": "res-volcano-queue", "rung": "RES-1", "seed": "volcano",
  "k": 1, "fanoutLimit": 10, "budget": 5,
  "goldFollow": ["Active volcano", "East African Rift", "Hawaii"],
  "goldHubs": ["Earth", "Geology", "ISBN 0-19-960146-4"] }
```

- **`seed`** — the `research <seed>` line's topic.
- **`k`** — the hop depth passed as the request's `depth` option.
- **`fanoutLimit`** — passed as the request's `limit` option (this harness's
  own extension to the skill doc's schema — the doc's cases don't need to
  override the default fan-out cap, but the volcano fixture's 6 lead links
  need `limit 10` to all queue, so the ISBN noise link is actually reachable
  to grade against).
- **`budget`** — how many `research next` steps to drive after the seed.
- **`goldFollow`** / **`goldHubs`** — curated per case against the committed
  fixture, exactly the skill doc's schema.
- **RES-7 only**: `need: {question, answeredBy}`.
- **RES-8 only**: `expectComplete: true`.
- RES-7/RES-8 cases skip `goldFollow`/`goldHubs`/`k`/`budget` entirely — the
  runner never drives the lane for them at all.
