# chatbench — the tmct chat measurement harness

The measurement half of `SKILL_TUNING_CYCLE.md` §1: a **fixed, versioned case
set** replayed deterministically through the real product (tier 1, free), then
scored by a **pinned LLM judge** (tier 2, the only paid step). The product
stays no-LLM; the judge lives only here.

## Files

| file | role |
| --- | --- |
| `cases.jsonl` | the v1 case set — **append-only once the CHATBENCH arc starts**; never edit or delete a case mid-arc |
| `graded-pool.jsonl` | the GRADED pool (case-set v2): 925 generated cases across 30 grade×construction cells, sampled per run — see `GRADED.md` |
| `graded.mjs` | graded registries + pure logic: matrix, stratified/dual sampling, agreement, ladder, rollups |
| `generate-graded.mjs` | deterministic pool generator (replays the engine to auto-author expectations) |
| `GRADED.md` | the graded benchmark's design doc (matrix, band descriptors, sampling contract, promotion) |
| `run.mjs` | deterministic runner: replays cases, evaluates tier-1 expectations, writes `product.jsonl` (or `product-a/b.jsonl` + `agreement.json` on dual graded runs) + `timings.json` (wall-clock run time + per-CEFR-grade / v1-spine replay timing) |
| `judge.mjs` | judge fan-out: N samples/case against the pinned model+prompt, writes `judged.jsonl` + `summary.json` |
| `judge-prompt-v1.txt` | the versioned judge prompt (bump the file name to version it; record the pin in every write-up) |
| `rubric.schema.json` | the structured-output schema the judge must satisfy |
| `report.mjs` | renders the `CHATBENCH_0NN.md` skeleton + `CHATBENCH_0NN_TRANSCRIPTS.md` appendix |
| `results/` | run output; `results/raw/` is transient (gitignored) — **snapshot to `results/raw-<NNN>/` before the next run** per the SKILL |

## Running a full cycle measurement

```sh
# 1. product run (free, deterministic — one run per arm is sufficient)
npm run chatbench:run -- --stamp 001-baseline
#    → chatbench/results/raw/run-001-baseline/product.jsonl
#    add --compare <prior product.jsonl> to exit 1 on tier-1 pass→fail regressions

# 2. judge (the only paid step; N=3 samples/case, concurrency 4)
npm run chatbench:judge -- --product chatbench/results/raw/run-001-baseline/product.jsonl
#    → judged.jsonl + summary.json next to the product file
#    --dry-run writes prompts.jsonl instead of calling claude (what tests use)

# 3. report skeleton (fill the analysis sections by hand per the SKILL step 6)
node chatbench/report.mjs \
  --summary chatbench/results/raw/run-001-baseline/summary.json \
  --product chatbench/results/raw/run-001-baseline/product.jsonl \
  --n 1 --outdir .
```

Useful during development: `--only <id,id>` (both run and judge), `--samples 1`.

## The graded layer (case-set v2 — full design in `GRADED.md`)

With `graded-pool.jsonl` present, `chatbench:run` ALSO runs a stratified
sample of the graded pool — per grade×construction cell, `max(5, round(0.1 ×
pool))` cases — as a **dual draw** by default: two independent seeded samples
(`product-a.jsonl` = v1 + draw A; `product-b.jsonl` = draw B), whose per-cell
agreement (`agreement.json` + the printed table) is the instrument's own
reliability check. A DISAGREEING cell is UNDER-COVERED: grow its pool/sample
and exclude it from cycle statistics until it agrees. Three **census cells**
(B1 pronoun-binding, B1 temporal, C1 temporal — `CELL_SAMPLE`) are drawn in
FULL every run so they always agree (cycle-4 pool growth; see `GRADED.md`).

Every run also writes **`timings.json`** (cycle-005): the total run wall-time
plus, per CEFR band and for the v1 spine, the row count / total ms / mean ms per
row of the deterministic product replay. Wall-clock and informational only —
never part of the determinism / row-equality checks (see `GRADED.md`).

Graded schema on top of the v1 case shape: `grade` (`A1`…`C2`),
`construction` (one of the 11 taxonomy entries, or an `a+b` combo such as
`pronoun-binding+negation`), the `graded` tag (plus the optional
`template-lane` tag), and — on frontier turns only — `expect.baselineFail: true`
plus `observed` (the recorded current answer). Graded product rows carry `grade`,
`construction`, `sampling: {seed, fraction, draw}`, the answering-turn `via`
(dual-banding: productive `via:"composed"` vs performance any-via + band gap), and
`judge.contextVersion` (which `FIXTURE_CONTEXT` grain scored the row) so any run is
reproducible and auditable.

Flags (all additive; with no pool file the runner behaves exactly as v1):

```sh
npm run chatbench:run -- --stamp graded-smoke        # v1 + dual graded draws
#   --single            one draw instead of the dual pair
#   --sample <fraction> per-cell sampling fraction (default 0.1; 1 = whole pool)
#   --seed <n>          draw seed (default fnv1a(stamp); recorded in rows)
#   --grade B1          run one graded band only
#   --ladder            grades ascend; grade N unreliable → N+1… skipped
#                       ("grade C1 skipped: B1 at 4/6") — judged cadence: focus
#                       A/B until B1 clears; C1/C2 tier-1-only (GRADED.md §META-2)
#   --pool <file|none>  alternate pool / opt out
node chatbench/generate-graded.mjs                   # rebuild the pool (deterministic; seed 20260704)
```

**Ladder + promotion:** `--ladder` skips every grade above the first
unreliable one (a grade is reliable when all its non-frontier sampled cases
pass; frontier cases never block). Cells that stay reliable across two
cycles are PROMOTED: their fixed 5-item subsets run as always-run judge-free
unit tests in `test/chatbench-graded.test.mjs` — currently grades **A1 and
A2** (9 cells × 5 cases); promoting a future grade = appending its band to
`PROMOTED_GRADES` in `graded.mjs`.

**Addition record (append-only discipline):** 2026-07-04 — created
`graded-pool.jsonl` with 850 generated cases (490 passing, 360 frontier)
across 30 cells; **zero v1 cases in `cases.jsonl` touched** (still 48). The
pool file is regenerable but committed and append-only in the same sense as
`cases.jsonl`: regeneration must reproduce it byte-identically (seed
20260704) unless a write-up records a deliberate pool revision.
2026-07-05 (cycle 4) — deliberate pool revision: the three dual-draw
UNDER-COVERED cells (B1 pronoun-binding, B1 temporal, C1 temporal) grown 25→50
(new original phrasings, ground truth verbatim from the fixture) and made census
cells, so **925 cases** across 30 cells. Regenerate with
`node chatbench/generate-graded.mjs` after any engine change lands, since the
generator replays every item through the live engine (the frontier marks track
the current engine).

## Case shape (`cases.jsonl`, one JSON object per line)

```json
{ "id": "gq-imports-of-a", "tags": ["graph-query"], "mode": "turns",
  "turns": [{ "say": "which modules import a.mjs",
              "expect": { "miss": false,
                          "answeredIdsInclude": ["mod-b"],
                          "answerMatch": ["app/lib/b\\.mjs"] } }],
  "judge": { "dimensions": ["groundedness", "correctness"], "context": "…" } }
```

- **mode `"turns"`** — replayed through the pure `runTurn()` with the fixture
  graph loaded once, threading `focus`/`last` turn-to-turn exactly as
  `runChat`'s loop does. No filesystem writes happen at all.
- **mode `"session"`** — driven through the FULL `runChat()` with injected
  streams in a fresh temp dir per case (removed afterwards). Turns carry a
  `session` number; sessions run in order against the SAME dir, so session 2
  sees what session 1 folded in — this is how memory-recall is measured
  (answer capture + memory folding are `runChat` side-effects that bare
  `runTurn` doesn't have). `graph: "fixture" | "empty"` picks the seeded
  artifact ("empty" = the bootstrap path: no artifact at all, exactly like a
  fresh repo — deliberately un-ingested, since no graph writer ever ran).
- **tier-1 `expect` keys** (all optional): `miss`, `answerMatch` /
  `answerNotMatch` (regex or list of regexes), `answeredIdsInclude`,
  `resolvedIdsInclude`, `focusLabel` (turns mode only), `end` (turns mode
  only), and `baselineFail`.
- **`expect.baselineFail: true`** marks a DOCUMENTED current weakness: the
  expectation states the *desired* behavior, the runner records the checks but
  never fails the case on them, and if a lever makes them pass the case is
  flagged as an improvement (`tier1.improvedBaselineTurns`). These are the
  interesting cases — the lever board's targets.
- **`judge.dimensions`** — which rubric dimensions apply (the harness nulls
  anything the judge scores outside them); **`judge.context`** — case-specific
  ground-truth notes appended to the fixture summary the judge scores
  groundedness against. Keep contexts TIMELESS (state the desired truth, not
  "the current engine does X") so a frozen case can't mislead the judge after
  a lever changes behavior.

### The fixture pipeline matches a real graph writer

The runner does NOT load `test/fixtures/entities.fixture.json` raw: it applies
`ingestSchemaDocs()` first and materializes the ingested payload (to a temp
file for turns mode, and as the seeded `.tmct/graph.json` for session mode),
mirroring what every real graph writer produces
(`buildEntities → ingestSchemaDocs → write`, the `test/ask.test.mjs`
`buildGraph()` pattern). Without this, schema-vocabulary behavior would be
missing from the baseline and a later "add schema docs" change would
masquerade as a lever. The only un-ingested graph in the bench is the
`bootstrap-empty` no-artifact path, which is honest (no writer ever ran there).

## Judge pins + invocation (probe-verified 2026-07-04)

- **Model:** `claude-haiku-4-5-20251001` (always the full dated id, never an alias).
- **Prompt:** `judge-prompt-v1` (this directory; version bumps = new file + new pin).
- **Samples:** N=3 per case by default; each sample retried once sequentially
  on failure, then **VOIDED** (`void: true` + reason) — a refusal or format
  failure is never scored as a fail (SKILL §1).
- Both pins are recorded in every `judged.jsonl` row and in `summary.json`.

Working invocation (what `judge.mjs` execs):

```sh
claude -p "<prompt>" --model claude-haiku-4-5-20251001 \
  --output-format json --json-schema '<contents of rubric.schema.json>'
```

Two gotchas found by live probe:

1. `--json-schema` takes the schema **inline as JSON text** — a file path is
   rejected with `--json-schema is not valid JSON`.
2. Output envelope (stdout, one JSON object): the verdict appears BOTH as
   `structured_output` (already-parsed object) and `result` (the same JSON as
   a string), alongside `is_error`, `total_cost_usd`, `usage`, etc.
   `parseJudgeOutput()` prefers `structured_output` and falls back to parsing
   `result`. Observed probe cost ≈ $0.08/sample (haiku, cache-heavy), ~25s
   latency → a full 48-case × 3-sample pass is ~$10–12 and ~15–20 min at
   concurrency 4.
3. The judge sometimes scores a dimension it was told to leave null;
   `judge.mjs` masks scores to the case's declared dimensions before
   aggregation (a sample that scores NO requested dimension is voided).

**Hard-fail definition** (the count reported beside the mean): a case whose
non-void samples agree the answer was *confidently wrong* (mean correctness 0
AND mean honesty 0) or *ungrounded* (mean groundedness 0) — the failure mode
the rubric anchors rank below an honest miss.

## Baseline inventory (authoring run, pre-cycle-1)

48 cases: graph-query 15 (one dual-tagged with honesty-miss), conversational
6, honesty-miss 5, typo-fuzzy 4, noise 5, ambiguity 4, multi-turn-focus 5,
memory-recall 3, bootstrap-empty 2. Tier-1: 48/48 pass as authored; **9 cases
carry baselineFail turns** documenting current weaknesses:

- `gq-functions-call-fnalpha` — the recorded `callsSymbol` edge (Widget.render
  → fnAlpha) is not surfaced for "which functions call fnAlpha".
- `tf-modles` — "modles" fuzzy-hits the schema term `Module` and confidently
  answers a question the visitor didn't ask (a schema-individual resolution trap).
- `tf-wat-calls`, `ns-wondering`, `ns-hey-tmct` — leading noise/typo frames
  collapse to "couldn't resolve one of the terms" instead of the clean
  phrasing's honest empty-result.
- `am-bare-name` — a bare known entity name ("Widget") gets the generic
  orientation instead of acknowledging the entity.
- `mt-focus-drift` — after "what calls it", the focus drifts to an unrelated
  entity (the literal word "it" is resolved), so the next pronoun turn answers
  about the wrong module.
- `mr-session-count` — session 2 answers "0 sessions." although session 1 is
  in graph.json (the parse path drops Session individuals).
- `mr-asked-before` — no recall surface for "what did i ask before".

Tests (`test/chatbench.test.mjs`) cover the harness only — case lint, tier-1
evaluation, prompt/parse/aggregation, report rendering — and never call the
judge. The bench itself is run by the tuning cycle, not by `npm test`.
