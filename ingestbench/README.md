# ingestbench — text-to-facts fidelity, one extraction capability at a time

INGESTBENCH grades how faithfully `ingestText` (`src/services/extract-facts.mjs`)
turns a document into stored facts, on the `ING-0…ING-9` ladder. It is the
harness `SKILL_BENCHMARK_INGEST.md` specifies. Dev-only, never shipped.

Run the ladder:

    node ingestbench/run.mjs --ladder --stamp <version>

The deterministic rungs (`ING-0`–`ING-7`) are fast and free — no LLM, no network.
Each case's `input` is ground through the shipped ingest seam (optimistic tier on),
the stored triples are folded to canonical form and value-compared to the case's
pinned `expect.statements` / `expect.forbid` / `expect.abstain`. `ING-7` adds a
deterministic equivalence check (`verifyCanonicalRestatement`, seeded from
`src/domain/paraphrase.mjs`'s `verifySubClassParaphrase` and a `parseAce` re-parse):
each stored triple is restated as a canonical statement and confirmed to carry the
same triple.

The judged rungs (`ING-8` meaning-preservation, `ING-9` full-fidelity restatement)
are scored by the offline LLM-as-judge, eval-side only:

    node ingestbench/judge.mjs --product <run-dir>/judge-input.jsonl   # live
    node ingestbench/run.mjs --ladder --stamp <version> --judge-dry-run  # prompts only, no calls

## The gate

A rung PASSES iff **zero wrong facts** (fabricated, confused, or a meaning-changing
greedy-span) **at ≥ 50% recall** of the rung's expected statements. A correct
abstain (`expect.abstain`, storing nothing) counts toward the pass. The first rung
that fails the gate gates every rung above it, reported skipped-with-a-receipt.
A missed-useful fact lowers recall but is the honest side — never scored worse than
a wrong fact.

Metrics per rung: precision and recall on facts, split into the four failure
classes — missed-useful (recall), fabricated / confused / greedy-span (precision).

## Files

- `cases.jsonl` — the append-only case set (`{id, rung, input, expect, grade, tags}`).
- `run.mjs` — the deterministic runner (`--ladder`, `--stamp`, `--rung`, `--only`,
  `--replay`, `--judge-dry-run`).
- `grade.mjs` — the grading core: the fidelity classifier, the ING-7 equivalence
  check, the rung rollup and the ladder gate.
- `judge.mjs`, `ingest-judge-v1.txt`, `rubric.schema.json` — the ING-8/ING-9 judge
  (pinned model + prompt; `--dry-run` emits prompts and makes no calls).
- `results/raw/run-<version>/` — per-run raw output (gitignored).

The bench imports downward from `src/` only; `src/` never imports from here.
