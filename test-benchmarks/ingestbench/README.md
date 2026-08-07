# ingestbench — text-to-facts fidelity, one extraction capability at a time

INGESTBENCH grades how faithfully `ingestText` (`src/services/extract-facts.mjs`)
turns a document into stored facts, on the `ING-0…ING-9` ladder. This file is
the design record and the mechanics. Dev-only, never shipped.

## The ladder

| rung | name | what it measures | status |
| ---- | ---- | ----------------- | ------ |
| ING-0 | Single grounded term | one declarative sentence yields at least one correct stored entity — the floor | measured |
| ING-1 | One clean isa | a clean copula frame stores exactly the right class fact and nothing else | measured |
| ING-2 | Isa under span and clause pressure | the correct isa (or a correct abstention) survives compound modifiers, partitive chains, and cross-clause bleed | measured |
| ING-3 | Relation coverage beyond isa | a known relation verb flanked by two entities stores its predicate, with subject-side partitive discipline | measured |
| ING-4 | Multiple facts per sentence | one sentence contributes every fact it grounds, not just the copula | measured |
| ING-5 | Cross-sentence pronoun carry | a pronoun-led sentence grounds against the paragraph's last subject, never bridging a topic break | measured |
| ING-6 | Discourse-level ingest | a typed discourse record threads entities and relations across turns — definite descriptions, ordinal and temporal links | measured |
| ING-7 | Paraphrase-equivalence, deterministic | each stored triple restated as a canonical statement, with a deterministic equivalence check confirming the same triple | measured |
| ING-8 | Meaning-preservation, judged | the whole input restated in canonical statements, meaning preserved both ways, scored by the offline judge | judge-graded, not run in CI |
| ING-9 | Full-fidelity restatement | an arbitrary document restated with nothing lost and nothing added — the top of the scale, graded for headroom, never claimed | judge-graded, not run in CI |

Run the ladder:

    node test-benchmarks/ingestbench/run.mjs --ladder --stamp <version>

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

    node test-benchmarks/ingestbench/judge.mjs --product <run-dir>/judge-input.jsonl   # live
    node test-benchmarks/ingestbench/run.mjs --ladder --stamp <version> --judge-dry-run  # prompts only, no calls

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
