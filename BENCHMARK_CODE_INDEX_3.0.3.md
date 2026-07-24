# BENCHMARK_CODE_INDEX_3.0.3 — the founding baseline, every scored rung clears

## Timing

- **Date:** 2026-07-24.
- **Indexing session:** 05:38:34–05:39:09 CEST (25 cases, no LLM, no network, no judge; JS/TS and
  Python backends both run — `python3` (3.14.6) was on `PATH`, so every Python case measured rather
  than reporting `measured:false`).
- **Analysis + write-up:** 05:39:09–06:05 CEST, same session.

**Headline: this is IDXBENCH's first-ever cycle, and every rung the case set can score clears the
gate — IDX-0 through IDX-9, zero fabrication, 25/25 cases.** There is no prior
`BENCHMARK_CODE_INDEX_*.md` to compare against; this write-up is the baseline every later cycle
measures its own rung movement against. IDX-10 (round-trip refactor fidelity) has no cases yet — it
needs `PLAN_CODE.md` Track 5's predicted-vs-actual ledger as a runnable primitive first, so it is
absent from the table rather than gated, exactly as `idxbench/README.md` already documents.

## Run

`npm run idxbench:run -- --ladder --stamp 3.0.3`: 25 cases, one run, no LLM, no network, no judge.
Exited 0. Raw output (untracked, `idxbench/results/.gitignore` covers `raw/`):
`idxbench/results/raw/run-3.0.3/product.jsonl`.

## The rung table

| rung | n | entities P/R | edges (per predicate) | Q&A | determinism | fabricated | gate |
| ---- | --: | ---- | ---- | ---- | ---- | --: | ---- |
| IDX-0 | 3 | **100%/8** | `defines` 100%/8 | n/a | n/a | 0% | PASS |
| IDX-1 | 3 | n/a | `imports` 100%/9 | n/a | n/a | 0% | PASS |
| IDX-2 | 3 | n/a | `callsSymbol` 100%/21 | n/a | n/a | 0% | PASS |
| IDX-3 | 2 | n/a | `reexports` 100%/12, `imports` 100%/1 | 100%/1 | n/a | 0% | PASS |
| IDX-4 | 4 | n/a | n/a | 100%/7 | n/a | 0% | PASS |
| IDX-5 | 2 measured + 1 unmeasured | n/a | n/a | 100%/4 | n/a | 0% | PASS |
| IDX-6 | 4 | n/a | n/a | n/a | 4/4 | 0% | PASS |
| IDX-7 | 1 | n/a | `historyEdges` 100%/3 | n/a | n/a | 0% | PASS |
| IDX-8 | 1 | n/a | `callsSymbol` 0/0 (correctly empty) | n/a | n/a | 0% | PASS |
| IDX-9 | 1 | n/a | `imports` 100%/8 | n/a | n/a | 0% | PASS |

**Ladder: IDX-0 → IDX-1 → IDX-2 → IDX-3 → IDX-4 → IDX-5 → IDX-6 → IDX-7 → IDX-8 → IDX-9 — every
measured rung passes the gate.** No rung gates the one above it; there is nothing to report as
skipped-with-a-receipt this cycle.

**Zero fabrication across all 21 fabrication-check surfaces** (3 entity blocks + 18 edge-predicate
blocks): every one reads `extra: 0`. **Conformance clean on all 20 graphs that carry it**
(`runConformance` 9/9 assertions each, 180/180 total) — `IDX-6`'s four cases score determinism only
and don't run the kit, matching `idxbench/run.mjs`'s own design.

## IDX-5 per-language readings

| language | case | measured | Q&A result |
| ---- | ---- | ---- | ---- |
| JS/TS | `idx5-js-parity` (`test/fixtures/js-repo`) | yes | 2/2 — "where is `parseNode` defined", "who calls `parseNode`" |
| Python | `idx5-py-parity` (`examples/tiny-lib-py`) | yes | 2/2 — "where is `parse_price` defined", "who calls `parse_price`" |
| C# | `idx5-csharp-absent` | **unmeasured** | no registered backend — absent, not wrong |

Both registered languages answer the same canonical Q&A shape byte-consistently. C# has no backend
registered against `src/index/registry.mjs` yet — a real absence, not a failing score. Registering a
C#/Java backend against a released tmct is tracked as its own open item in `NEXT.md` (the seonix-side
proof), unchanged by this cycle.

## Best-examples pick

Five canonical restatements the graph got byte-consistent with the source, one per resolution class:

1. **"Where is `parseNode` defined?"** (JS, `idx4-js-parseNode`) → real file + line span, body
   re-derived via `sliceSpan` at grading time. Demonstrates: plain single-file define resolution.
2. **"Who calls `parseNode`?"** (JS, same case) → the real caller set, no more and no fewer.
   Demonstrates: symbol-granular `callsSymbol` reversed into a caller query.
3. **"Where is `Widget.render` defined?"** (JS, `idx4-js-widget-render`) → resolves a method member,
   not just a bare top-level name. Demonstrates: qualified-name resolution inside a class body.
4. **"Where is `parse_price` defined?"** (Python, `idx5-py-parity`) → same Q&A template, same exact
   result shape as the JS case above. Demonstrates: cross-language parity at IDX-5.
5. **"Where is `greet` defined?"** (Python, `idx3-reexport-chain`, `idxbench/fixtures/reexport-py`)
   → resolves through a re-export (`pkg/__init__.py` re-declaring `pkg/core.py`'s `greet` via
   `__all__`) back to the origin symbol, not the re-exporting module. Demonstrates: re-export-chain
   resolution, IDX-3's harder half.

## What shipped into this baseline

No prior cycle exists, so "what's new" is the arc that got the producer to a scoreable state at all:

- **`bb908e76`** — repo-index merges to `main`: the JS/TS and Python code parsers land as
  `src/index/index-repo.mjs`, `src/index/extract-jsts.mjs`, `src/index/extract-python.mjs`.
- **`16aea803`** — the JS/TS producer wires `buildEntities` to real source (not a stub).
- **`c59f022d`** — a Python backend registers against `src/index/registry.mjs`, using the stdlib
  `ast` module via `extract_ast.py` — zero npm dependency for the Python side.
- **`3803fe96`** — `idxbench/` and `researchbench/` land: the harness this cycle runs.
- **`b3ca25ef`** — every bench gets an `npm run <bench>:run` script (`idxbench:run` included).
- Version rolls `3.0.1` → `3.0.2` → `3.0.3` carry no further content change to the producer or the
  harness.

Case set: 25 lines in `idxbench/cases.jsonl`, all new this cycle (there is no prior version to diff
against). No case was edited or removed — the append-only rule has nothing to enforce yet.

## Kept open (not red — absence, not failure)

- **IDX-5 C#:** unmeasured, no registered backend. Tracked in `NEXT.md` as the seonix-side proof
  that the backend seam admits an out-of-repo language registration.
- **IDX-10:** no cases yet. It needs `PLAN_CODE.md` Track 5's own predicted-vs-actual ledger as a
  runnable primitive before a case can be authored against it — a sequencing dependency, not a rung
  that failed a gate.

Nothing this cycle qualifies as a kept red: every rung the case set can score, scored clean.

## Discipline checklist

- **Zero fabrication held**: 0% across 21 fabrication-check surfaces (3 entity + 18 edge-predicate
  blocks), all reading `extra: 0`.
- **Conformance kit green**: 20/20 graphs, 180/180 `runConformance` assertions.
- **Gold authored from source**: `idxbench/cases.jsonl`'s `gold` blocks were authored by reading the
  fixture source (`idxbench/README.md`'s own contract); this cycle did not regenerate any gold from
  producer output.
- **Determinism byte-verified**: 4/4 IDX-6 cases re-index the same fixture twice against a pinned
  timestamp and compare byte-identical.
- **Bench-import direction stays one-way**: `grep -r 'idxbench' src/` returns nothing — the bench
  imports downward from `src/index/`, never the reverse.
- **Rung gate applied strictly ascending**: `--ladder` walked IDX-0 → IDX-9 in order; nothing needed
  a skipped-with-a-receipt line this cycle because nothing gated.

## Decision

**Ship as the baseline.** Every rung the current case set can score — IDX-0 through IDX-9 — clears
the gate with zero fabrication and full Q&A exactness. The two open items (C#/Java backend
registration, the IDX-10 ledger primitive) are sequencing dependencies on other work, not gates this
cycle failed to clear. The next cycle's job is to compare against this table: did any rung move, and
is that move explained by a producer change or does it need chasing.
