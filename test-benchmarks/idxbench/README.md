# idxbench — the tmct CODE-INDEX measurement harness

The sibling of `agentbench`/`infbench`, on the code-index axis. Full design in
`.claude/skills/benchmark-code-index/SKILL.md` — this file is the mechanics.

**What it grades: does the produced graph RESTATE the source?** IDXBENCH indexes
committed fixture repos through the real producer
(`src/index/index-repo.mjs`'s `extractRepo`/`assembleEntities`/`indexRepository`)
and compares the produced entities/edges against a gold set authored by reading
the fixture source directly — never captured from the producer's own output.

**No LLM, no judge, no network.** Grading is a pure comparison
(`test-benchmarks/idxbench/grade.mjs`). Two runs over the same tree and stamp produce
byte-identical `product.jsonl`.

## The ladder

`IDX-0` through `IDX-9` are measured against real fixture cases (`test-benchmarks/idxbench/cases.jsonl`).
`IDX-10` (round-trip refactor fidelity, `PLAN_CODE.md` Track 5) has no cases yet —
it needs that track's own predicted-vs-actual ledger as a runnable primitive, so
it is absent from the ladder table rather than gated: nothing to measure yet,
not a wall.

| rung | what this harness measures |
| ---- | --------------------------- |
| IDX-0 | one module's own defines (entities + `defines` edges), scoped to that module |
| IDX-1 | cross-module `imports` edges |
| IDX-2 | symbol-granular `callsSymbol` edges, including a multi-call-site symbol |
| IDX-3 | a module's own export set, plus a genuine cross-module re-export chain (`test-benchmarks/idxbench/fixtures/reexport-py`) |
| IDX-4 | canonical Q&A — "where is X defined" (path + line span, body re-derived from the real file via `sliceSpan`) and "who calls X" |
| IDX-5 | the same Q&A shape run against both registered languages (JS/TS, Python); a third, unregistered language (`csharp`) reports `measured:false` — absent, never wrong |
| IDX-6 | deterministic re-index: `indexRepository` run twice over a throwaway temp copy of each fixture, byte-compared |
| IDX-7 | git history edges (`touches`, `touchesSymbol`) over a synthetic two-commit repo built at run time from the case's own pinned commit script, plus the `--no-history` control |
| IDX-8 | zero-fabrication under an ambiguous call: two modules define the same top-level name, so the caller's `callsSymbol` edge must stay absent — never a guessed target |
| IDX-9 | self-index: indexes `src/index/` itself and checks its own `imports` edges |

## Fixtures

Three real fixtures the coordinator named, indexed read-only:
`test/fixtures/js-repo/`, `examples/tiny-webapp-src/`, `examples/tiny-lib-py/`.
Every structural case calls `extractRepo`/`assembleEntities` directly — neither
function writes to disk, so a committed example's own `.tmct/graph.json` is
never touched by a graded run.

Two small fixtures this harness owns, for cases the three assigned repos don't
exercise:

- `test-benchmarks/idxbench/fixtures/reexport-py/` — a two-module Python package
  (`pkg/__init__.py` imports `pkg/core.py`'s `greet` and re-declares it via
  `__all__`) — the one committed fixture with a genuine cross-module re-export
  chain, IDX-3's harder half.
- `test-benchmarks/idxbench/fixtures/ambiguous-js/` — two modules each define a top-level
  `handle`, and a third calls it bare — IDX-8's honest-miss-on-ambiguity case.

IDX-6 (determinism) and IDX-7 (history) are the only rungs that write anything:
both do it against a `mkdtemp` throwaway, and IDX-6 copies the fixture there
first rather than indexing it in place — see `test-benchmarks/idxbench/run.mjs`'s own header.

## The conformance gate

Every produced graph runs through `runConformance()` (`src/tools/conformance.mjs`)
before it is scored, via `test-benchmarks/idxbench/conformance-runner.mjs` — a tiny file whose
only job is giving `runConformance`'s `node:test` registrations a real
test-runner context, driven programmatically by `node:test`'s `run()` API
(`test-benchmarks/idxbench/run.mjs`'s `checkConformance`). A conformance failure folds into the
rung's fabrication gate exactly like an invented edge.

## Running

```sh
node test-benchmarks/idxbench/run.mjs --ladder --stamp 3.0.0
node test-benchmarks/idxbench/run.mjs --rung IDX-2
node test-benchmarks/idxbench/run.mjs --only idx0-js-graph,idx1-js-repo
# (npm run idxbench:run -- --stamp 3.0.0  once the coordinator adds the script)
```

- **`--stamp`** must be a filesystem-safe label; **`--out`** overrides the
  output dir; **`--rung <IDX-0|…|IDX-9>`** and **`--only <id,…>`** narrow the
  selection; **`--ladder`** gates ascending rungs and prints skipped-with-a-
  receipt lines for anything a lower rung's failure would gate.
- Cases run **sequentially** — the conformance gate hands one produced graph
  at a time to `node:test`'s `run()` through two env vars, so concurrent cases
  would race on them; every case is small enough that this stays fast.

## Files

| file | role |
| ---- | ---- |
| `cases.jsonl` | the case set — append-only once the arc starts |
| `grade.mjs` | pure grading: entity/edge precision+recall, Q&A exactness, the IDX-7 history-shape check, rollup + ladder gate |
| `conformance-runner.mjs` | the `node:test` context `runConformance` runs inside, parameterized by env var |
| `run.mjs` | the runner: indexes each case's fixture, grades, writes `results/raw/run-<stamp>/product.jsonl` |
| `fixtures/` | the two fixtures this harness owns (see above) |
| `results/` | run output (`results/raw/` is gitignored) |

## Case shape (`cases.jsonl`)

```json
{ "id": "idx0-js-graph", "rung": "IDX-0", "repo": "test/fixtures/js-repo",
  "scope": { "modules": ["src/graph.mjs"] },
  "gold": { "entities": [{ "label": "parseNode", "class": "Function" }],
            "edges": { "defines": [{ "subject": "src/graph.mjs", "object": "parseNode" }] } } }
```

- **`repo`** — a path relative to the repo root (or an absolute path).
- **`scope.modules`** — optional; when given, both the gold comparison and the
  fabrication check are restricted to individuals/edges whose id names one of
  these modules (IDX-0's "one file's own defines," IDX-8's ambiguous caller).
- **`gold.entities`** — `{label, class}` pairs; Module-class individuals are
  always excluded (a case's gold describes symbols, not the module itself).
- **`gold.edges`** — a map of predicate → `{subject, object}` label pairs. An
  empty array for a predicate makes ANY in-scope produced edge of that
  predicate a fabrication — IDX-8 relies on exactly this.
- **`questions`** — `[{ q, expect }]`; `q` is one of two canonical templates
  ("where is X defined", "who calls X"); `expect` pins `{path, span}` (the body
  is re-derived from the real file at grading time, never hand-transcribed)
  or `{callers: [...]}`.
- **IDX-5 only**: `language` — one of `src/index/registry.mjs`'s registered
  keys, or an unregistered one to prove the absent-language path.
- **IDX-6 only**: no `gold` — the case is just a `repo` to re-index twice.
- **IDX-7 only**: `commits: [{message, authorDate, files: {path: content}}]`
  (no `repo` — the git repo is built fresh from this script) and
  `gold: {moduleTouches: {path: commitCount}, symbolTouchGroups: [[symbols…]]}`
  — a commit sha is a real git hash, never predicted, so gold pins the SHAPE
  (which module a commit touched, how symbol-touches partition across
  commits), not an id.
