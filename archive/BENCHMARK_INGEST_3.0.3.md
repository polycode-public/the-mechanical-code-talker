# BENCHMARK_INGEST_3.0.3 — the founding INGESTBENCH baseline; the ladder tops out at ING-6

## Timing

- **Date:** 2026-07-24 (CEST).
- **Benchmarking session:** 05:39:19–05:40:25. Two parts:
  - deterministic ladder (`ING-0`–`ING-7`), 05:39:19–05:39:20, ~1s, 20 cases, no LLM, no network.
  - judge fan-out (`ING-8`/`ING-9`), 05:39:49–05:40:25, ~36s, 2 cases x 3 samples = 6 live
    `claude` calls, 0 voids.
- **Analysis + write-up:** 05:40:25 onward, same session.

## Headline

**First-ever INGESTBENCH cycle. This is the founding baseline — there is no prior
`BENCHMARK_INGEST_*.md` to compare against.** The deterministic ladder passes clean from `ING-0`
through `ING-5` (13/13, 100% recall, zero wrong facts), then gates at `ING-6` on 38% recall of its
expected statements, below the 50% completion floor. `ING-7`'s own value-compare passes 3/3, but it
sits skipped-with-a-receipt because `ING-6` gates first, the same ladder discipline the sibling
benches hold. The `ING-6` gate is today's honest DRT-lite horizon reading, reported as measured, not
patched around. Zero wrong facts across all 20 cases: precision 100% on every rung. The two judged
rungs, scored with the real `claude-haiku-4-5-20251001` judge, read 2.0/2 on `ING-8` and 1.5/2 on
`ING-9`.

## Run

`npm run ingestbench:run -- --ladder --stamp 3.0.3`: 20 cases, one deterministic pass, exit 0. Raw
output (untracked, per `test-benchmarks/ingestbench/results/.gitignore`):
`test-benchmarks/ingestbench/results/raw/run-3.0.3/product.jsonl`, with `judge-input.jsonl` for the two judged
rungs.

Determinism confirmed with a separate `--replay` run: rows byte-identical across two passes over
the same cases and version (`test-benchmarks/ingestbench/run.mjs --replay: byte-identical across 2 runs — determinism
check PASSED`).

## The rung table — 20 cases

Gate = zero wrong facts (fabricated + confused + meaning-changing greedy-span) at >= 50% recall of
the rung's expected statements. The first rung to fail gates every rung above it.

| rung | n | pass | recall | precision | wrong | ceil/pass | gate |
| ---- | --: | --: | --: | --: | --: | --: | ---- |
| ING-0 | 1 | 1 | **100%** | **100%** | 0 | 0/1 | PASS |
| ING-1 | 1 | 1 | **100%** | **100%** | 0 | 0/1 | PASS |
| ING-2 | 4 | 4 | **100%** | **100%** | 0 | 0/4 | PASS |
| ING-3 | 2 | 2 | **100%** | **100%** | 0 | 0/2 | PASS |
| ING-4 | 1 | 1 | **100%** | **100%** | 0 | 0/1 | PASS |
| ING-5 | 2 | 2 | **100%** | **100%** | 0 | 0/2 | PASS |
| ING-6 | 4 | 2 | 38% | **100%** | 0 | 1/2 | **gated (38% < 50%)** |
| ING-7 | 3 | 3 | 100% | 100% | 0 | 0/3 | skipped: gated by ING-6 |
| ING-8 | 1 | judged | — | — | 0 | — | skipped in ladder; judged below |
| ING-9 | 1 | judged | — | — | 0 | — | skipped in ladder; judged below |
| **all** | **20** | **16** | **77%** | **100%** | **0** | 1/16 | **ladder gates at ING-6** |

`ceil/pass` counts passes graded against a declared horizon rather than a shipped capability. The
`ING-6` row's one ceiling/pass is `ing-6-temporal-star`, which clears the gate at exactly 50% recall
against the ordinal/temporal-threading horizon.

### The four failure classes

Zero fabricated, zero confused, zero greedy-span facts across all 20 cases — the automatic-fail
line holds everywhere, precision 100% on every rung. The only recall shortfall is on `ING-6`:

- `ing-6-ordinal-cell` ("First a cell grows. Then it splits.") — 0% recall, 2 missed-useful
  (`cell capableOf grow`, `cell capableOf split`). Stored nothing.
- `ing-6-ordinal-seed` ("First a seed sprouts. Then it flowers.") — 0% recall, 2 missed-useful
  (`seed capableOf sprout`, `seed capableOf flower`). Stored nothing.

Both are the honest-miss side: the extractor stores nothing rather than guess a wrong participant.
A missed-useful fact lowers recall and is never scored worse than a wrong fact.

## ING-6, the DRT-lite horizon — reported as measured

`ING-6` grades a typed discourse record threading entities and relations across turns. Its four
cases split cleanly by which discourse device they lean on:

| case | input | stored | recall |
| ---- | ---- | ---- | --: |
| `ing-6-definite-desc-comet` | "A comet is an object. The comet has ice." | comet ⊑ object; comet hasA ice | 100% |
| `ing-6-temporal-star` | "A star forms. Then it collapses." | star capableOf form | 50% |
| `ing-6-ordinal-cell` | "First a cell grows. Then it splits." | (nothing) | 0% |
| `ing-6-ordinal-seed` | "First a seed sprouts. Then it flowers." | (nothing) | 0% |

The definite-description slice ("the comet" resolving to the paragraph subject) is shipped and
passes at 100%. The temporal slice reads the first clause's relation but drops the "then"-led
second one, so it lands at exactly 50%. The ordinal "First … Then …" slice stores nothing. Aggregate
recall over `ING-6`'s eight expected statements is 3/8 = 38%, below the 50% floor, so `ING-6` gates.

This is the ordinal/temporal-threading capability named in `SKILL_BENCHMARK_INGEST.md` and staged as
slices 3–5 in `PLAN_DISCOURSE_AND_RECOGNITION.md` (slices 1–2, the discourse record threading through
`runTurn` and cross-turn-temporal composition, already ship). The grounding literatures are discourse
representation theory (Kamp & Reyle 1993), file-change semantics (Heim 1982), and centering (Grosz,
Joshi & Weinstein 1995). Until that tier is built, these ordinal cases land on the honest-miss floor
and the 38% reading stands as the current ladder depth.

## Judge verdicts — ING-8 and ING-9

The two judged rungs were scored with the real judge. The ladder gates them behind `ING-6`, so they
are skipped-with-a-receipt in the formal rollup; the verdicts below are informative headroom
readings on the harness-produced restatements, not ladder-cleared passes.

- **Judge model:** `claude-haiku-4-5-20251001` (the full pinned id, unchanged).
- **Prompt version:** `ingest-judge-v1` (`test-benchmarks/ingestbench/ingest-judge-v1.txt`).
- **Samples:** 3 per case; **voids:** 0; **overall mean:** 1.75 / 2.

| rung | case | forward | backward | mean | reading |
| ---- | ---- | --: | --: | --: | ---- |
| ING-8 | `ing-8-doc-planet` | 2 | 2 | **2.0** | full meaning preservation both ways |
| ING-9 | `ing-9-prose-glacier` | 2 | 1 | **1.5** | nothing wrong, severely partial |

**ING-8** ("A planet is a world. A planet has an atmosphere. The atmosphere has gas.") restated to
three canonical statements — `planet ⊑ world`, `planet has atmosphere`, `atmosphere has gas` — with
the judge scoring forward 2 and backward 2 on every sample. Sample rationale: "The restatement
captures all three factual claims from the input without overreach ... no facts are invented,
confused, or unsupported."

**ING-9** ("A glacier is a mass of ice. It forms from snow. The weight of the snow creates pressure.
Over many years the glacier moves downhill.") restated to the single triple `weight creates
pressure`. Forward 2 (nothing wrong), backward 1 (three of four claims dropped: glacier ⊑ mass of
ice, forms-from-snow, moves-downhill). Sample rationale: "The extraction is accurate but severely
partial." This is `ING-9`'s tagged horizon — arbitrary relation coverage and complete meaning
representation, the open information-extraction / AMR-style semantic-parsing frontier. The forward-2
score is the point that matters: the extractor drops facts rather than invent them.

## Best examples — five verbatim input-to-canonical restatements

Each is the shipped `ingestText` output over the case input, read back from the store.

1. **ING-4, one sentence contributes every fact it grounds.** "A volcano is a mountain that has
   lava." → `volcano ⊑ mountain` AND `volcano has lava`. The copula and the relative-clause
   relation both land; the one-triple-per-sentence cap is lifted.
2. **ING-3, subject-side partitive discipline.** "The weight of all of the snow creates pressure."
   → `weight creates pressure`, not `snow creates pressure`. The of-chain head, not the object of
   the partitive, becomes the subject.
3. **ING-2, correct abstention under partitive pressure.** "A glacier is a large body of ice." →
   nothing stored. "A body of ice" states composition, not a class, so the correct output is no
   fact. A clean abstain is a pass, the ingest analogue of the honest miss.
4. **ING-5, cross-sentence pronoun carry that respects a topic break.** "A dog is an animal. It has
   fur." → `dog ⊑ animal` AND `dog has fur`; the same text with a blank-line topic break stores only
   `dog ⊑ animal`, dropping the orphaned pronoun rather than mis-binding it.
5. **ING-6, definite-description resolution.** "A comet is an object. The comet has ice." → `comet ⊑
   object` AND `comet hasA ice`. "The comet" resolves to the paragraph subject across the sentence
   boundary.

## Predictions vs. actuals

This is the founding cycle, so the prediction is the ladder-shape stated in
`SKILL_BENCHMARK_INGEST.md`: the shipped tiers (definite descriptions, single-clause temporal reads,
the isa-family equivalence check) clear their rungs, and the ordinal/temporal-threading horizon at
`ING-6` and the full-restatement horizon at `ING-9` sit as measurement headroom.

| predicted | actual |
| ---- | ---- |
| ING-0–ING-5 clear clean | 13/13 pass, 100% recall, 0 wrong facts |
| ING-6 gates on the un-built ordinal/temporal slice | gated at 38% recall; ordinal cases store nothing, temporal at 50% |
| ING-7 value-compare passes but is gated by ING-6 | 3/3 pass, skipped-with-a-receipt |
| ING-8 meaning-preserving | judge 2.0/2, forward 2 / backward 2 |
| ING-9 partial, nothing invented | judge 1.5/2, forward 2 / backward 1 |

Everything landed where the ladder shape predicted.

## Deliberately-kept honest miss

The `ING-6` ordinal cases (`ing-6-ordinal-cell`, `ing-6-ordinal-seed`) store nothing rather than
guess a participant. Their `capableOf` facts are real and the text plainly offers them, but the
ordinal-threading slice that would ground them across the "First … Then …" turn boundary is not yet
built. Kept as a named frontier, not patched with a guess. The `ING-9` glacier restatement is the
second kept miss: three of four claims dropped, none invented.

## What's new this cycle

- **The `test-benchmarks/ingestbench/` harness landed** (`7e7a154a`, "Build the ingestbench harness to
  SKILL_BENCHMARK_INGEST.md", 2026-07-24). This cycle is its first run. Nothing in the extraction
  path (`src/services/extract-facts.mjs`) changed for this cycle; it measures the shipped `ingestText`
  seam as-is.
- **Case set:** 20 cases in `test-benchmarks/ingestbench/cases.jsonl`, the founding set. No additions or edits this
  cycle; the set is append-only from here.

## Discipline checklist

- **No wrong fact held:** 0 fabricated, 0 confused, 0 greedy-span across all 20 cases. Precision
  100% on every rung. The automatic-fail line never tripped.
- **Determinism verified on the deterministic tiers:** `--replay` byte-identical across two runs.
- **Bench-import direction one-way:** `grep -rn "ingestbench" src/` returns nothing; the product
  never imports from the bench.
- **Judge integrity:** real `claude-haiku-4-5-20251001` judge, prompt `ingest-judge-v1`, 3 samples
  per case, 0 voids. Model and prompt pins recorded above and in
  `test-benchmarks/ingestbench/results/raw/run-3.0.3/summary.json`. The pin was not changed.
- **Gate reported, not hidden:** `ING-6` gates at 38%; `ING-7`/`ING-8`/`ING-9` reported
  skipped-with-a-receipt in the ladder rollup even though `ING-7`'s raw numbers pass and the judged
  rungs score well.
- **Case set sacred:** 20 cases, unchanged this cycle.

## Decision

**Ship the founding baseline as measured.** The ladder tops out at `ING-6`, exactly the
ordinal/temporal-threading horizon the skill and `PLAN_DISCOURSE_AND_RECOGNITION.md` name. The next
capability worth building is that DRT-lite ordinal/temporal slice, which would lift `ING-6` past the
50% floor and un-gate `ING-7`'s already-passing value-compare and the two judged rungs. Not attempted
this cycle: this run is the first measurement, not a build.
