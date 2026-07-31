# SKILL_BENCHMARK_RESEARCH.md — the RESEARCHBENCH measure-then-build cycle (traversal-graded, deterministic, no judge)

The repeatable loop that drives the tmct **research traversal** forward one crawl capability at a
time: run the ladder against a frozen stub wiki graph, read the rung table, decide ship-or-build,
and if building, implement the next queue/ordering/stopping capability, regression-test, and
re-measure. RESEARCHBENCH is `test-benchmarks/researchbench/`'s harness; this skill is the loop a session runs each
time it wants to advance the ladder.

**Status: this skill specifies the harness; `test-benchmarks/researchbench/` does not exist yet — the first cycle
builds it from this spec, then measures against it.**

**What this bench grades: the TRAVERSAL, not the per-article facts.** The research lane
(`src/services/research.mjs`) fetches a seed topic, queues the topics its lead section links to, and
walks that queue one step per turn. RESEARCHBENCH grades that walk: **which links get followed, in
what order, and when the run stops.** It does NOT grade whether the triples extracted from each
fetched article are correct or complete — that per-article fact fidelity is
`SKILL_BENCHMARK_INGEST.md`'s job (the ingest pipeline, `src/services/extract-facts.mjs`), and the
two benches share nothing but a topic name. A case here can score a perfect traversal over articles
whose fact extraction INGEST separately marks as poor, and the reverse. Keep the boundary sharp:
if the complaint is "it stored a confused fact from the Earth summary," that is an INGEST case
(see `playtests/PLAYTEST_LOG_023`); if the complaint is "it followed Earth at all when the topic was
volcanoes," that is a RESEARCHBENCH case.

**The RES ladder (`RES-0…RES-8`) is its own scale, drawn from focused crawling.** RESEARCHBENCH
grades **crawl capability** — can the lane follow the relevant links, avoid the crowded generic
hubs, cover the useful terms within a courtesy budget, and know when to stop. The rungs are named for
that meaning, not borrowed from CHATBENCH's CEFR (linguistic complexity), AGENTBENCH's `TOOL-0…TOOL-8`
(tool-use), or INFBENCH's `INF-1…INF-8` (logic-fragment expressivity). The progression matches the
shape the focused-crawling and information-foraging literatures grade on (topical crawling,
Chakrabarti et al. 1999; information foraging theory, Pirolli & Card 1999; the hub/authority split,
Kleinberg 1999; active-learning stopping rules, Settles 2009):

| rung | name | what it tests |
|---|---|---|
| RES-0 | Fetch and stop | one seed topic, no queue: ground depth 0, fan out nothing (`fanout 0` / `depth_limit 0`) |
| RES-1 | Queue the lead links | fan out at all: the seed's lead-section namespace-0 links queue at depth 1, in document order |
| RES-2 | Relevance ordering | the topic's own kin rank ahead of the generic hubs the lead also links to |
| RES-3 | Hub avoidance | the crowded generic hubs (Earth, Geology, year pages, ISBN-class identifier links) are demoted or skipped, not followed early |
| RES-4 | Completeness | the useful terms reachable in `k` hops are all reached — recall against a curated per-case gold follow-set |
| RES-5 | Budget discipline | the MOST useful terms are reached within a fetch budget — recall@budget, courtesy held structurally |
| RES-6 | Adaptive depth | a promising branch is followed deeper while a thin one is pruned — depth spent where the yield is |
| RES-7 | Need-directed research | research runs until a named question becomes answerable, then stops — the queue serves an information NEED, not a fixed fan-out |
| RES-8 | Self-assessed coverage | the run knows its map is complete enough and stops on its own judgement, without a question or a hard cap driving it |

RES-0 and RES-1 describe the lane as it stands today (`researchTurn`'s depth-0 ground plus the
depth-1 `linkedTitles` fan-out). RES-2 through RES-6 are the crawl-quality arc the loop builds one
rung at a time. RES-7 and RES-8 are **research horizons**: no settled deterministic engineering
exists in the lane yet for research driven by an information need (RES-7) or for a run that judges
its own coverage complete (RES-8). Candidate literatures are named against each below. Until a tier
is designed, its cases land on the honest miss wall and the rung sits as a ceiling marker, exactly
as INFBENCH's INF-7/INF-8 sit until `PLAN_SYLLOGIST_EL_DL.md` lands. Don't compare a RES rung against
a CEFR grade, a `TOOL-*` rung, or an `INF-*` band: same ladder shape, unrelated axes.

> **Invoke it by telling a session:** *"Follow `SKILL_BENCHMARK_RESEARCH.md` and run a RESEARCHBENCH
> cycle"* (optionally: a rung to target, a version stamp).

---

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Artifact naming — match the `package.json` version.** A cycle's write-up is named after the tmct
  version it measures: `BENCHMARK_RESEARCH_<version>.md`, raw under
  `test-benchmarks/researchbench/results/raw/run-<version>[_00N]/`. A RE-RUN of the same version (a harness fix, a
  re-verify) appends `_00N`: `BENCHMARK_RESEARCH_2.12.0_001.md`, `_002`, … — the same convention
  `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1, `SKILL_BENCHMARK_AGENT.md` §1 and `SKILL_BENCHMARK_INFERENCE.md`
  §1 already use.
- **Record the timing.** The write-up carries four wall-clock stamps: the start and end of the
  **benchmarking session** (the run itself) and the start and end of the **analysis** (reading the
  results and writing the report). State the date and both intervals — a reader comparing two
  versions needs the measurement time and the write-up time as separate figures.
- **Fixed, versioned case set:** `test-benchmarks/researchbench/cases.jsonl` — one JSON object per line (case shape
  in §3). Append-only once the RESEARCHBENCH arc starts: new cases may be added between cycles (record
  the addition in the write-up), existing cases are never edited or removed mid-arc, for the same
  reason every other bench's case set is sacred — editing a case invalidates every prior cycle's
  comparison against it. The frozen stub wiki graph (§3) is part of the case set and is sacred the
  same way: a fixture article's summary or lead-link list is never edited mid-arc.
- **No live wiki, no LLM, no judge — fully deterministic.** Grading runs the traversal against a
  **frozen stub wiki graph committed as a fixture** (`test-benchmarks/researchbench/fixture/`), never against
  `simple.wikipedia.org`. The stub is registered through the lane's own provider seam
  (`registerResearchProvider`, `src/adapters/corpus/wikipedia-live.mjs`), the same seam the ledger
  e2e test stubs (`test-e2e/pages-ledger-research.test.mjs`'s `SUMMARIES` / `routeSimpleWikipedia`). Two
  runs over the same fixture and stamp produce byte-identical `product.jsonl`. One run per arm is
  sufficient; there is no judge-noise tier to sample against, unlike CHATBENCH. A cycle that reaches
  the real network in grading is a broken harness, not a result — the whole point is a deterministic
  ruler for a traversal that is otherwise paced against a live site.
- **The automatic-fail line: no invented traversal.** A run that reports a topic grounded which the
  queue never fetched, or follows a link that is not in the source article's own lead-link set in the
  fixture, fails that case outright — no matter how good the ordering or recall looks. This is the
  traversal analogue of AGENTBENCH's zero-hallucination line and CHATBENCH's honest-miss rule: the
  queue may only walk edges the fixture actually holds, and may only claim what it actually reached.
  A fixture fetch that returns null (the stub's 404 shape) must read as a skip that stores nothing,
  exactly as the live lane skips a dead title (`stepRun`'s skip path).
- **The metric trio per rung.** A single number is gameable (a crawler that fetches everything scores
  perfect recall while following every hub; one that fetches nothing scores perfect hub-avoidance at
  zero recall), so a graded rung reports all three, each a pure function over the fixture graph and
  the recorded walk (`test-benchmarks/researchbench/grade.mjs`):
  - **ordering score** — of every (useful term, hub) pair the seed's lead links to, the fraction the
    queue orders correctly (useful before hub). `1 − inversions / pairs`. Undefined (reported `n/a`)
    when a case has no hub in its lead, which is fine below RES-2.
  - **hub-avoidance rate** — of the case's gold hub-set reachable within the fetch budget, the fraction
    the run did NOT fetch (or demoted below every useful term). `1 − hubsFetched / hubsAvailable`.
  - **recall@budget** — of the case's gold follow-set (the useful terms reachable in `k` hops), the
    fraction the run actually grounded within the fetch budget. `reached / gold`.
- **The rung-gate rule (the RESEARCHBENCH analogue of the AGENTBENCH rung gate and INFBENCH's
  ladder-gating rule).** Rungs run **RES-0 → RES-1 → … → RES-8**, strictly in that order. A rung
  PASSES iff it clears its floor with no automatic-fail: `RECALL_FLOOR = 0.5` on recall@budget, and
  where the rung tests them, `HUB_FLOOR = 0.8` on hub-avoidance and `ORDER_FLOOR = 0.8` on ordering
  (constants in `test-benchmarks/researchbench/grade.mjs`; which floors apply to which rung is fixed by the rung's
  `what it tests` column). The FIRST rung that fails its gate gates every rung above it — report those
  higher rungs as **skipped-with-a-receipt** (e.g. `RES-5 skipped: gated by RES-4 recall 0.33 < 0.5`),
  the same Meta-2 discipline `SKILL_BENCHMARK_INFERENCE.md` §2 and `SKILL_BENCHMARK_AGENT.md` §1 hold:
  don't score a ceiling while the floor leaks. `--ladder` runs the rungs ascending and applies this
  automatically. A rung sitting at a clean floor-miss because its capability is not built yet is a
  **ceiling marker**, not a regression — name it as exactly that (RES-7 and RES-8 sit here until
  designed).
- **Courtesy is measured, not assumed.** The fetch budget a case scores against is the courtesy
  contract made legible: the live lane spaces round trips by `min_interval_ms` and caps fan-out at
  `RESEARCH_FANOUT_MAX` (`src/services/research.mjs`, `resolveResearchConfig`). RESEARCHBENCH does not
  re-measure wall-clock politeness — the fixture answers instantly — it measures whether the crawl
  gets the useful terms **within the same round-trip budget** the throttle would have paced. A rung
  that clears recall only by exceeding the budget fails: reaching everything is not the goal, reaching
  the useful terms cheaply is.
- **Bench-import direction stays one way.** The product (`src/`) never imports from `test-benchmarks/researchbench/`;
  the bench imports downward from `src/services/research.mjs` (the queue, `researchSnapshot`,
  `parseResearchRequest`) and stubs the provider from `src/adapters/corpus/wikipedia-live.mjs`. A cycle
  that reverses this is a real regression — verify with `grep -r 'researchbench' src/` before writing
  a cycle up as clean.

## 2. The loop (one cycle; repeats until the ladder tops out or the operator stops)

**Step 1 — READ.** Read the latest `BENCHMARK_RESEARCH_<version>.md` (its rung table, any kept honest
red, its decision on frontiers), the research-lane open items in `NEXT.md`, and the current
`test-benchmarks/researchbench/cases.jsonl` rung counts. Decide whether this cycle is a pure re-measurement or targets
a specific gated rung to push past.

**Step 2 — RUN the ladder.** `node test-benchmarks/researchbench/run.mjs --ladder --stamp <version>` (the provisioned
script is `npm run researchbench:run -- --stamp <version>`). It registers the fixture provider,
replays each case's `research <seed>` + `research next` walk through `researchTurn` with the fixture
stubbing every fetch, records the actual walk (fetched titles in order, skips, per-topic grounded
flag) from `researchSnapshot`, grades deterministically, snapshots raw output to
`test-benchmarks/researchbench/results/raw/run-<version>[_00N]/product.jsonl`, and prints the per-rung metric-trio
table plus ladder receipts. Fast and free — no judge concurrency to manage, no network.

> **Coordinator model — background sub-agents for the build, not (usually) the run.** Per `CLAUDE.md`'s
> standing working model, the main session is the coordinator, not the worker. The RESEARCHBENCH run
> is cheap enough to run inline most cycles. What benefits from delegation is the build in Step 5: a
> cycle that touches mostly-independent workstreams — a new ordering rule in the queue
> (`src/services/research.mjs`), a hub-signal module, new fixture articles and cases in
> `test-benchmarks/researchbench/`, the write-up — can fan those out to background sub-agents with clear file-ownership
> boundaries, serialized on the shared queue file, while the coordinator keeps the main chat free.

**Step 3 — READ the rung table.** For each rung, read ordering / hub-avoidance / recall@budget against
the contract's floors (§1). Compare against the previous `BENCHMARK_RESEARCH_<version>.md` if this
cycle re-measures a version already on record — did any previously-clean rung's numbers move, and if
so, is the move explained (a real queue change, spot-verified against a named case) or unexplained (a
regression to chase down before writing anything up)?

**Step 4 — DECIDE (apply the rung gate, §1).** Walk RES-0→RES-8 in order. The first ungated PASS is
real progress; the first gate failure names exactly where the ladder currently tops out, with a
receipt for everything above it. RES-7 and RES-8 name their ceiling until built.

**Step 5 — SHIP OR BUILD.** Two outcomes:
- **Every rung gates where expected, and the current ladder depth is where it should be:** ship the
  re-measurement as-is — a clean re-measurement is a legitimate, reportable outcome, not a null result.
- **A rung you want to move past is gating, or the case set should grow deeper:** implement the next
  crawl capability that unlocks it — a relevance-ordering pass over the queued titles (RES-2), a
  hub-signal demotion (RES-3), a `k`-hop completeness walk (RES-4), a budget-aware best-first order
  (RES-5), an adaptive depth rule (RES-6) — regression-test (`npm test` green, no exception for lane
  work), and re-run this cycle from Step 2 to confirm the target rung's gate now passes before moving
  further up.

**Step 6 — WRITE the cycle up.** `BENCHMARK_RESEARCH_<version>.md` (§1's naming), modeled on the shape
the sibling bench write-ups use: a headline naming the honest delta versus the last cycle; the run's
timing (both intervals, dated); the per-rung metric-trio table with gate receipts, including
skipped-with-a-receipt lines for gated rungs and named ceiling markers for RES-7/RES-8; a worked
example for at least one discriminating case (the actual walk versus the gold follow-set, so the
behaviour is visible — the volcano case in §3 is the canonical one); what's new this cycle, one item
per change with the commit it landed in; any deliberately-kept honest red (a case that walks correctly
but under-recalls, named as a frontier, not patched around); the discipline checklist (no invented
traversal, byte-identity verified, fixture untouched, one-way import held); and a decision line.

**Mirror every issue the cycle leaves open** (a kept honest red, an unexplained rung move, an
under-covered case) **into `NEXT.md`** as a one-line open item pointing at this write-up — `NEXT.md`
is the next-session pickup list.

**Step 7 — CONTINUE.** If the operator wants the ladder pushed further, go to Step 1 with the next
gated rung as the target. Like AGENTBENCH and INFBENCH, RESEARCHBENCH cycles are coarser-grained than
CHATBENCH's autonomous lever loop — one crawl capability is real implementation work — so each cycle
ends with a normal operator check-in rather than an automatic re-arm.

---

## 3. The harness (`test-benchmarks/researchbench/`)

The harness this skill specifies. Build it in the first cycle, then it is sacred.

**Layout**, mirroring `test-benchmarks/agentbench/` and `test-benchmarks/infbench/`:

- `test-benchmarks/researchbench/fixture/` — the **frozen stub wiki graph**, committed. One entry per article:
  `{ title, summary, leadLinks: [ titles, in document order ] }`. The graph is closed — every title
  a `leadLinks` list names either has its own fixture entry or is a deliberate dead title (the stub
  returns null for it, exercising the skip path). This is the same stub shape
  `test-e2e/pages-ledger-research.test.mjs` builds inline (`SUMMARIES` plus the `action=parse` link list),
  lifted into a committed fixture so grading never touches the live site. `leadLinks` order is
  authored to match how a real lead section introduces the topic, because the lane orders the queue
  by document order (`linkedTitles` reads `section=0`, not an alphabetical `prop=links`).
- `test-benchmarks/researchbench/cases.jsonl` — the append-only case set. Case shape:
  ```
  { id, rung,                         // "res-volcano-order", "RES-2"
    seed,                             // "volcano" — the research <seed> line
    k,                               // hop depth the gold set is reachable within (1 today)
    budget,                          // fetch cap the run scores against (round trips past depth 0)
    goldFollow: [ titles ],          // the useful terms a good crawl reaches (recall@budget target)
    goldHubs:   [ titles ],          // the crowded/generic terms it must demote or skip (hub-avoidance target)
    need?,                           // RES-7: { question, answeredBy } — the fact that ends the run
    expectComplete? }                // RES-8: the run should stop itself here, no more useful terms
  ```
  `goldFollow` and `goldHubs` are curated per case against the committed fixture — both are subsets of
  the seed's reachable titles, partitioned by hand into useful and hub. A title in neither is neutral:
  reaching it neither helps recall nor hurts hub-avoidance.
- `test-benchmarks/researchbench/run.mjs` — registers the fixture provider (`registerResearchProvider`), replays each
  case, records the walk, grades, snapshots raw, prints the table. `--ladder` ascends the rungs and
  applies the gate; `--rung RES-N` runs one; `--stamp <version>` keys the raw dir.
- `test-benchmarks/researchbench/grade.mjs` — the three pure metrics (§1) and the gate. No network, no model.
- `test-benchmarks/researchbench/README.md` — the mechanics in full, the way `test-benchmarks/agentbench/README.md` documents
  AGENTBENCH.

**The hub-signal treatment — deterministic, closed, two signals.** A hub is what the crawl should
demote or skip. RESEARCHBENCH derives each case's hub-set deterministically from committed data, never
from a live degree count or a heuristic score:

1. **Degree proxy over the frozen graph.** Compute in-degree for every fixture title (how many fixture
   articles' `leadLinks` name it). A title whose in-degree clears `HUB_DEGREE_FLOOR` (a committed
   constant in `grade.mjs`) is a structural hub — Earth and Geology are linked from many articles, so
   they score high; a volcano's own kin (Lava, Magma, Crater) are linked from few. This is the
   fixture's frozen, deterministic stand-in for Kleinberg's hub notion.
2. **A committed generic-term list and pattern set.** A small closed vocabulary of pure-noise links
   plus two regexes: year pages (`^\d{1,4}$`), century pages (`^\d{1,2}(st|nd|rd|th) century$`), and
   the identifier links a lead section carries that are never a topic (ISBN, DOI, and the like). These
   are hubs regardless of degree — an ISBN link is noise the first time it appears. The list lives in
   the fixture, versioned with the case set.

A title flagged by either signal is in the hub-set. Both signals are pure functions over committed
data, so two graders agree byte-for-byte. Neither ever consults the live wiki or a computed relevance
score — the point is a ruler a future cycle can trust, not a second heuristic to tune.

**The canonical worked case — volcano (from `playtests/PLAYTEST_LOG_023`).** A real run of
`research volcano` queued: Active volcano, Earth, East African Rift, Geology, Hawaii. Earth and
Geology are the crowded hubs (high in-degree, linked from most geology-adjacent articles); the
ISBN-class identifier links the lead also carries are pure noise; Active volcano, East African Rift
and Hawaii are the useful kin. A case built from this fixture sets `goldFollow: [Active volcano, East
African Rift, Hawaii]`, `goldHubs: [Earth, Geology]` (plus any identifier links), `budget: 3`. At
RES-1 the lane queues all five in document order and scores full recall but zero hub-avoidance (it
follows Earth and Geology). RES-2 asks the ordering to put the three kin ahead of the two hubs; RES-3
asks a budget-3 run to skip the hubs entirely and reach the three kin. The write-up shows this walk
against the gold set as its discriminating example.

**The horizon rungs.** RES-7 (need-directed) and RES-8 (self-assessed coverage) have committed cases
and fixtures so the ladder is complete and the receipts are honest, but no lane capability answers
them yet:

- **RES-7 — need-directed research.** A case carries a `need`: a question and the fact that answers it
  (`answeredBy`, a title in the fixture whose summary grounds the answer). A passing run researches
  until that fact is grounded, then stops — the queue serves the information need rather than a fixed
  fan-out. This brushes autonomous goal formation (`SKILL_BENCHMARK_AGI_SCALES.md`'s goal-origination scale:
  a run that pursues a goal rather than draining a queue). Candidate literatures: information foraging
  and information scent (Pirolli & Card 1999), the anomalous-state-of-knowledge model of an
  information need (Belkin 1980), question-driven retrieval. Until a tier is designed, these cases sit
  at the honest miss wall — the lane drains its fan-out with no notion of the question — and RES-7 is a
  named ceiling marker.
- **RES-8 — self-assessed coverage.** A case carries `expectComplete`: the run should recognise its
  map is complete enough and stop on its own, with no question and no hard cap forcing it. This is
  metacognition beyond the miss wall — the miss wall says "I don't know this"; RES-8 asks "I now know
  enough about this." Candidate literatures: stopping rules in active learning and sequential analysis
  (Settles 2009), coverage/saturation criteria. Until a tier is designed, these cases sit as a ceiling
  marker too; the lane stops when the queue empties or a cap hits, which is a mechanism, not a
  judgement of coverage.

Naming these as horizons is deliberate. They are open crawl-design problems with candidate
literatures, not settled work being deferred and not features the lane refuses — when a tier is
designed, whoever builds it graduates the case from ceiling marker to a gated rung and freezes the
receipt.

---

## 4. Cadence

- One cycle per crawl capability. Like AGENTBENCH and INFBENCH, and unlike CHATBENCH's continuous
  autonomous lever loop, a RESEARCHBENCH cycle's build is genuine lane engineering (an ordering pass, a
  hub demotion, an adaptive-depth rule) — size the cycle to that, not to a fixed time box.
- A pure re-measurement (no build) is a fast, cheap cycle — worth running whenever
  `src/services/research.mjs` or `src/adapters/corpus/wikipedia-live.mjs`'s fan-out surface changes, to
  catch a traversal regression before it compounds.
- Run alongside the sibling benches when a release touches the research lane, and always alongside a
  `SKILL_BENCHMARK_INGEST.md` cycle when it exists: the two measure the two halves of a research run
  (which articles get fetched here; what facts each yields there) and belong in the same write-up
  cadence.

## 5. Guardrails (delivery discipline)

- **The case set and the fixture are sacred.** Append-only between cycles; never edit or delete an
  existing case, a fixture article's summary, or its `leadLinks` order mid-arc; record every addition
  in the write-up. Editing any of them invalidates every prior cycle's comparison.
- **Snapshot before overwrite.** The raw dir is keyed on `--stamp`, so a same-version re-run stamps
  `_00N` rather than clobbering the prior run's raw output — a skipped snapshot is a process slip, the
  same rule every bench holds.
- **No invented traversal, non-negotiable.** No cycle ships a queue change that claims a grounding it
  never fetched or follows an edge the fixture does not hold. A change that makes the crawl report
  reached-but-unfetched on any rung is reverted or gated off, not shipped with a caveat — it is the
  traversal's honest-miss invariant.
- **Never memorize the seed string.** Ordering and hub-demotion must derive from the queued titles,
  the fixture's link structure, and the closed hub signals — never pattern-match the seed's literal
  word or the gold-set titles. This is what keeps a PASS honest rather than overfit to the seed cases;
  it is the RESEARCHBENCH analogue of AGENTBENCH's "never memorize the request string."
- **A gated rung is reported, not hidden.** Skipped-with-a-receipt, every time, even when a gated
  rung's raw numbers look fine by coincidence — a small fixture can clear a floor without the rule that
  makes the number mean something.
- **No live wiki in grading, ever.** The fixture provider is the only source a graded run reads. A run
  that reaches `simple.wikipedia.org` is a broken harness — verify the provider is registered before
  trusting any number.
- **Push state is session-scoped.** Commit locally with the repo-local identity; whether to push
  depends on the current session's operator authorization, same as every other loop in this repo.
- **No LLM leaks into the product or the bench.** RESEARCHBENCH's whole value is a deterministic ruler
  for a deterministic traversal; a lever that would put a model call in either path is rejected by
  definition.

## 6. One-paragraph TL;DR

Run `node test-benchmarks/researchbench/run.mjs --ladder --stamp <version>` (fast, free, fully deterministic — a
frozen stub wiki graph registered through the lane's provider seam, no live wiki, no LLM, no judge)
and read the per-rung metric trio — ordering score, hub-avoidance rate, recall@budget — against the
honest gate: recall@budget ≥ 0.5 with hub-avoidance ≥ 0.8 and ordering ≥ 0.8 where the rung tests
them, no invented traversal, walking RES-0→RES-8 strictly in order, the first failing rung gating
every rung above it skipped-with-a-receipt. This bench grades the TRAVERSAL — which links get
followed, in what order, when to stop — not the per-article facts, which are
`SKILL_BENCHMARK_INGEST.md`'s job. Hubs (Earth, Geology, year/ISBN-class links) are flagged
deterministically by a degree proxy over the frozen graph plus a committed generic-term list, never a
live count. RES-0/RES-1 describe today's lane; RES-2…RES-6 are the crawl-quality arc built one rung at
a time; RES-7 (need-directed research) and RES-8 (self-assessed coverage) are named research horizons
(focused crawling, information foraging, active-learning stopping rules) that sit as ceiling markers
until a tier is designed. `RES-0…RES-8` is a distinct scale from CEFR, `TOOL-*` and `INF-*` — drawn
from focused crawling, never compared across benches. If every rung gates where expected, ship the
re-measurement; to push further, implement the next queue/ordering/stopping capability, keep `npm
test` green, and re-run to confirm the gate passes; write up `BENCHMARK_RESEARCH_<version>.md` (headline
delta, timing, metric-trio table with receipts and ceiling markers, the volcano worked example, what's
new, any kept honest red, the discipline checklist, a decision), mirroring anything left open into
`NEXT.md`.
