# BENCHMARK_INGEST_5.0.18 — the ordinal/temporal discourse slice lands; the ladder now tops out at ING-7

## Timing

- **Date:** 2026-08-07.
- **Benchmarking session:** 19:44–19:47 CEST. Deterministic ladder (`ING-0`–`ING-7`), 20 cases, no
  LLM, no network, wall time 0.61s. The two judged rungs (`ING-8`/`ING-9`) were not run this cycle —
  see "Not measured this cycle" below.
- **Analysis + write-up:** 19:47–20:05 CEST, same session.

**Headline: the deterministic ladder now clears ING-0 through ING-7 clean, past the ING-6 gate
`BENCHMARK_INGEST_3.0.3.md` recorded.** The ordinal/temporal discourse-threading slice landed since
that baseline, so all four ING-6 cases — including the two "First … Then …" ordinal cases that
stored nothing at 3.0.3 — now recall 100% of their expected statements at zero wrong facts. Zero
wrong facts across all 18 deterministic cases: precision 100% on every rung.

## Run

`node test-benchmarks/ingestbench/run.mjs --ladder --stamp 5.0.18` (matching the committed
`ingestbench:run` script): 20 cases, one deterministic pass, exit 0. Determinism confirmed with a
separate `--replay` run: rows byte-identical across two passes over the same cases and version.

## The rung table — 18 deterministic cases (ING-0…ING-7)

Gate = zero wrong facts (fabricated + confused + meaning-changing greedy-span) at ≥ 50% recall of
the rung's expected statements. The first rung to fail gates every rung above it.

| rung | n | pass | recall | precision | wrong | ceil/pass | gate |
| ---- | --: | --: | --: | --: | --: | --: | ---- |
| ING-0 | 1 | 1 | **100%** | **100%** | 0 | 0/1 | PASS |
| ING-1 | 1 | 1 | **100%** | **100%** | 0 | 0/1 | PASS |
| ING-2 | 4 | 4 | **100%** | **100%** | 0 | 0/4 | PASS |
| ING-3 | 2 | 2 | **100%** | **100%** | 0 | 0/2 | PASS |
| ING-4 | 1 | 1 | **100%** | **100%** | 0 | 0/1 | PASS |
| ING-5 | 2 | 2 | **100%** | **100%** | 0 | 0/2 | PASS |
| ING-6 | 4 | 4 | **100%** | **100%** | 0 | 3/4 | **PASS** |
| ING-7 | 3 | 3 | **100%** | **100%** | 0 | 0/3 | PASS |
| **all (deterministic)** | **18** | **18** | **100%** | **100%** | **0** | **3/18** | **PASS** |

`ceil/pass` counts passes graded against a case still carrying a declared-horizon `ceiling` tag in
`test-benchmarks/ingestbench/cases.jsonl` (`ing-6-ordinal-cell`, `ing-6-ordinal-seed`,
`ing-6-temporal-star`) — see "The tag that outlived the gap" below.

**Ladder (ascending, `--ladder`): ING-0 → ING-1 → ING-2 → ING-3 → ING-4 → ING-5 → ING-6 → ING-7 —
every deterministic rung passes the gate.** No receipts to print; nothing gates below ING-8.

### Zero wrong facts, zero recall shortfall

Zero fabricated, zero confused, zero greedy-span facts across all 20 cases (18 deterministic + 2
judged) — the automatic-fail line holds everywhere, precision 100% on every rung. Unlike 3.0.3,
there is no recall shortfall this cycle: every deterministic case reaches 100% recall of its
expected statements.

## ING-6, the ordinal/temporal slice — now measured, not gated

`ING-6` grades a typed discourse record threading entities and relations across turns. All four
cases now clear 100% recall:

| case | input | stored | recall |
| ---- | ---- | ---- | --: |
| `ing-6-definite-desc-comet` | "A comet is an object. The comet has ice." | comet ⊑ object; comet hasA ice | 100% |
| `ing-6-temporal-star` | "A star forms. Then it collapses." | star capableOf form; star capableOf collapse | 100% |
| `ing-6-ordinal-cell` | "First a cell grows. Then it splits." | cell capableOf grow; cell capableOf split | 100% |
| `ing-6-ordinal-seed` | "First a seed sprouts. Then it flowers." | seed capableOf sprout; seed capableOf flower | 100% |

At 3.0.3, `ing-6-temporal-star` read the first clause and dropped the "then"-led second one (50%
recall), and both ordinal cases stored nothing (0% recall) — aggregate recall was 3/8 = 38%, below
the 50% floor, and the rung gated. This cycle, the temporal case picks up its second clause and both
ordinal cases store their full pair of facts: aggregate recall is 8/8 = 100%.

This is the ordinal/temporal-threading capability `.claude/skills/benchmark-ingest/SKILL.md` named
and `PLAN_DISCOURSE_AND_RECOGNITION.md` staged as slices 3–5. `4de1cdf7`/`aa7181e8` ("thread
ordinal/temporal discourse lead-ins through ingest") built it. The grounding literatures named at
3.0.3 stand: discourse representation theory (Kamp & Reyle 1993), file-change semantics (Heim
1982), and centering (Grosz, Joshi & Weinstein 1995).

### The tag that outlived the gap

`ing-6-ordinal-cell`, `ing-6-ordinal-seed`, and `ing-6-temporal-star` still carry a `ceiling` field
in `test-benchmarks/ingestbench/cases.jsonl` naming "DRT-lite typed discourse record:
ordinal/temporal threading" as an unbuilt capability. That capability is now built and these three
cases pass on their own merits, at 100% recall, with no gap left to name — the `ceiling` tag is a
label the case data carries forward from before the slice landed, not a live gap this cycle
measures. Retagging the case file is a case-authoring change, out of this report's scope; it's
recorded here so the `ceil/pass` column in the rung table above reads correctly against what's
actually happening.

## ING-7, the equivalence rung

`ING-7`'s three cases each pass their deterministic paraphrase-equivalence check
(`verifyCanonicalRestatement`) on top of the plain value-compare: 3/3 pass, 100% recall, 0 wrong
facts, `equivChecked === equivVerified` on every case. Unchanged from 3.0.3 — nothing in the
equivalence path moved this cycle.

## Not measured this cycle: ING-8 and ING-9

`ING-8` and `ING-9` are judged rungs (`ingestbench/judge.mjs`, real `claude` model calls) and this
cycle does not invoke the judge — Track D's brief is the deterministic re-measurement, and a judge
pass is a separate, live-model cost. The underlying stored triples for both judged cases are
unchanged from 3.0.3 (`ing-8-doc-planet` still stores the same three triples; `ing-9-prose-glacier`
still stores the same single triple), so nothing in the extraction path this cycle touches would
move a judge score, but no fresh judge score is claimed here. `BENCHMARK_INGEST_3.0.3.md` carries
the last judge read (2.0/2 on `ING-8`, 1.5/2 on `ING-9`) as historical record, not a re-measurement.

## Best examples — five verbatim input-to-canonical restatements

Each is the shipped `ingestText` output over the case input, read back from the store. Unchanged
from 3.0.3 except the ING-6 examples, which now include the two ordinal cases.

1. **ING-4, one sentence contributes every fact it grounds.** "A volcano is a mountain that has
   lava." → `volcano ⊑ mountain` AND `volcano has lava`.
2. **ING-3, subject-side partitive discipline.** "The weight of all of the snow creates pressure."
   → `weight creates pressure`, not `snow creates pressure`.
3. **ING-2, correct abstention under partitive pressure.** "A glacier is a large body of ice." →
   nothing stored. A clean abstain is a pass, the ingest analogue of the honest miss.
4. **ING-6, the ordinal slice.** "First a cell grows. Then it splits." → `cell capableOf grow` AND
   `cell capableOf split` — both ordinal clauses now thread to the same subject across the "First …
   Then …" boundary.
5. **ING-6, definite-description resolution.** "A comet is an object. The comet has ice." → `comet
   ⊑ object` AND `comet hasA ice`.

## Predictions vs. actuals

The prediction, carried from 3.0.3's decision: the next capability worth building is the
ordinal/temporal-threading slice, which would lift `ING-6` past the 50% floor and un-gate `ING-7`'s
already-passing value-compare.

| predicted | actual |
| ---- | ---- |
| ING-0–ING-5 stay clean | 13/13 pass, 100% recall, 0 wrong facts |
| the ordinal/temporal slice lifts ING-6 past 50% | 8/8 expected statements recalled, 100% |
| ING-7 un-gates once ING-6 clears | 3/3 pass, no longer skipped |
| ING-8/ING-9 unaffected by the ING-6 build | stored triples unchanged from 3.0.3 (not re-judged) |

Everything landed where the 3.0.3 decision predicted.

## Discipline checklist

- **No wrong fact held:** 0 fabricated, 0 confused, 0 greedy-span across all 20 cases. Precision
  100% on every rung. The automatic-fail line never tripped.
- **Determinism verified:** `--replay` byte-identical across two runs.
- **Bench-import direction one-way:** `grep -rn "ingestbench" src/` returns nothing.
- **Judge not invoked this cycle:** no live model calls; `ING-8`/`ING-9` carry no fresh score, per
  "Not measured this cycle" above.
- **Case set unchanged:** 20 cases, the same set as 3.0.3.

## Decision

**Ship the re-measurement as-is.** The ordinal/temporal-threading build landed as its own commit,
ahead of and independent of this write-up; this cycle records what it moved. The deterministic
ladder now tops out at `ING-7`. The next capability that would extend it further is the
full-restatement horizon `ING-9` names — arbitrary relation coverage and complete meaning
representation, the open information-extraction / AMR-style semantic-parsing frontier — which stays
a judged rung, not a target this cycle measures.
