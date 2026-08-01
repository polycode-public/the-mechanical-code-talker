---
name: benchmark-code-index
description: Runs the IDXBENCH cycle that grades how faithfully tmct's code-index producer restates source as a graph on the IDX-0 through IDX-10 fidelity ladder; invoke when the operator asks to run an IDXBENCH cycle or advance the code-index fidelity ladder. The harness is specified but not yet built.
---

# benchmark-code-index — the IDXBENCH restate-the-source cycle (rung-gated, deterministic, no judge)

The repeatable loop that drives the tmct **code-index producer** forward one fidelity rung at a
time: index a fixture repo, compare the produced graph against a gold entity/edge set and a set of
canonical question/answer pairs, decide ship-or-build, and if building, add the next extractor or
resolver capability, regression-test, and re-measure. IDXBENCH is `test-benchmarks/idxbench/`'s harness; this skill
is the loop a session RUNS every time it wants to advance the ladder.

> **Build status: the harness is specified here, not yet built.** `test-benchmarks/idxbench/` does not exist yet.
> This document is the design a later session implements; nothing in `test-benchmarks/idxbench/` is live code.

**What it grades: does the produced graph RESTATE the source?** This is the code sibling of the
Ingest restatement check. Ingest reads prose and restates it as canonical graph statements you can
read back byte-for-byte; the code index reads source and restates it as canonical graph statements
(`defines`, `imports`, `callsSymbol`, `inherits`, `tests`, `exports`, `touches`) you can read back
the same way. The question is always the same: is what the graph says about the code exactly what
the code says about itself, no more (a fabricated edge) and, at each rung's floor, no less (a missed
edge).

**The IDX ladder (`IDX-0…IDX-10`) is its own scale, drawn from code-index fidelity.** It grades one
axis: how faithfully the producer turns source into a graph. The rungs are named for that meaning.
Do not compare an IDX rung against a CEFR grade (CHATBENCH grades linguistic complexity), a TOOL
rung (AGENTBENCH grades tool-use), or an `INF-*` band (INFBENCH grades logic fragments). Same ladder
shape, unrelated axes.

| rung | name | what it tests |
|---|---|---|
| IDX-0 | Single-file defines | one module's top-level functions/classes/variables become Individuals with the right `tmct:` class; entity precision + recall against the gold set. The conformance kit (below) is the floor beneath this rung. |
| IDX-1 | Cross-module imports | an import specifier resolves to an internal module `imports` edge (`src/app.mjs->src/core.mjs`), not left as an unresolved string |
| IDX-2 | Direct call edges | a unique-named callee resolves to a symbol-granular `callsSymbol` edge (`Widget.render->parseNode`) |
| IDX-3 | Exports & re-exports | a module's export set is emitted; a re-export chain resolves to the origin symbol |
| IDX-4 | Restatement fidelity | the graph answers the canonical questions ("where is X defined", "who calls X") byte-consistently with the source, and a source-capable read returns the real body over the emitted line span. The Ingest-restatement mirror. |
| IDX-5 | Multi-language parity | JS/TS and Python emit the same contract shape and answer the same canonical Q&A per language. C#/Java are `archive/PLAN_REPO_INDEX.md` phase-3 horizons: until a backend registers, that language is ABSENT, scored as unmeasured, never as wrong. |
| IDX-6 | Deterministic re-index | same source + pinned timestamp → byte-identical `graph.json`. Already proven on the producer branch (`test/index/index-repo-write.test.mjs`); IDXBENCH re-asserts it as a scored axis every run. |
| IDX-7 | Temporal / history edges | git module-level `touches` plus symbol-level line-range `touches` edges; `tmct index --no-history` is the clean-skip control that must produce a graph with zero history edges and nothing else changed |
| IDX-8 | Semantic-depth resolution | a method call dispatched through an interface or heritage chain, where the callee cannot be read off a single call site. No settled deterministic engineering exists yet for the general case (the seonix-port horizon the producer branch's own notes name); until a resolver is designed these land on the honest miss wall — an unresolved callee, never a guessed edge. |
| IDX-9 | Self-index | index tmct itself and answer its own architecture questions (which modules import `chat.mjs`, what the `init --with-persona code` wiring touches — `archive/PLAN_REPO_INDEX.md` phase 5) |
| IDX-10 | Round-trip refactor fidelity | the graph is rich enough that a `PLAN_CODE_PLANNING.md` Track 5 refactor verifies from the graph alone: a step's DECLARED graph delta matches the OBSERVED delta after re-index (§3.5's tier-1 predicted-vs-actual ledger), and "where is X defined" reflects the move |

`IDX-0…IDX-10` is a finite ladder because today's producer covers two languages and structural
resolution. It is not a fixed ceiling: IDX-8's semantic resolver, more languages at IDX-5, and
richer round-trip deltas at IDX-10 extend it as the producer grows. New rungs append; a shipped
rung's cases are frozen.

> **Invoke it by telling a session:** *"Run the `benchmark-code-index` skill and run an IDXBENCH
> cycle"* (optionally: a language to measure, a rung to target, a version stamp).

---

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Artifact naming — match the `package.json` version.** A cycle's write-up is named after the
  tmct version it measures: `BENCHMARK_CODE_INDEX_<version>.md`, raw under
  `test-benchmarks/idxbench/results/raw/run-<version>[_00N]/`. A RE-RUN of the same version (a harness fix, a second
  language, a re-verify) appends `_00N`: `BENCHMARK_CODE_INDEX_0.9.0_001.md`, `_002`, … — the same
  convention `.claude/skills/benchmark-agent/SKILL.md` §1, `.claude/skills/benchmark-cefr-english/SKILL.md` §1, and
  `.claude/skills/benchmark-inference/SKILL.md` §1 already use.
- **Record the timing.** The write-up carries four wall-clock stamps: the start and end of the
  **indexing session** (the producer runs) and the start and end of the **analysis** (reading the
  gold comparison and writing the report). State the date and both intervals.
- **Fixed, versioned case set:** `test-benchmarks/idxbench/cases.jsonl` — one JSON object per line:
  `{ id, rung, repo, gold: { entities[], edges[] }, questions: [{ q, expect }] }`. `repo` names a
  committed fixture tree; `gold` is the authored truth for that fixture; `questions` are the
  canonical Q&A pairs. Append-only once the arc starts: new cases may be added between cycles
  (record the addition in the write-up), existing cases are never edited or removed mid-arc — editing
  a case invalidates every prior cycle's comparison against it, the same rule every other bench in
  this repo holds.
- **The gold set is authored from the SOURCE, never captured from the producer.** A gold entity/edge
  set read back out of the producer's own output is a snapshot test: it locks in whatever the
  producer does, including its bugs, and can never catch a wrong graph. Author each `gold` block by
  reading the fixture source and writing down what the code actually declares, independent of any
  run. This is the one rule that makes IDXBENCH a fidelity measure rather than a change-detector.
- **No LLM, no judge, fully deterministic.** Grading compares the produced entity set and edge set
  against `gold`, and each produced canonical answer against its `expect`, with pure functions in
  `test-benchmarks/idxbench/grade.mjs`. No network, no model call anywhere in this loop. Two runs over the same tree
  and stamp produce byte-identical output. One run per arm is sufficient; there is no judge-noise
  tier to sample against, unlike CHATBENCH.
- **The automatic-fail line: zero fabrication.** A produced entity with no witness in the source, or
  an edge whose subject or object the source does not support (an `imports` edge to a module the file
  never imports, a `callsSymbol` edge to a callee it never calls), fails that case outright — no
  matter how good the rest of the graph looks. This is the honest miss carried into the producer: an
  import that cannot be resolved to an internal module is dropped or left unresolved, never invented
  as an edge to a guessed target. Fabrication is the code-index analogue of AGENTBENCH's zero
  hallucination.
- **The metric set per rung.** A single number is gameable (a producer that emits nothing scores
  zero fabrication at zero recall), so every rung reports:
  - **entity precision + recall** — produced Individuals against the gold entity set;
  - **edge precision + recall, per predicate** — `imports`, `callsSymbol`, `inherits`, `tests`,
    `exports`, `touches`, each scored on its own;
  - **Q&A exactness** — the fraction of the rung's canonical questions answered byte-consistently
    with `expect`;
  - **determinism** — a second index of the same source with the same pinned timestamp is
    byte-identical to the first.
- **The rung-gate rule (the IDXBENCH analogue of AGENTBENCH's rung gate).** Rungs run
  **IDX-0 → IDX-1 → … → IDX-10**, strictly in that order. A rung PASSES iff **zero fabrication**
  (precision on invention is perfect — no tolerance), **recall ≥ `RECALL_FLOOR` (0.5,
  `test-benchmarks/idxbench/grade.mjs`)** on the rung's target relation, and **every canonical Q&A for that rung
  exact**. A missed edge below the floor is a recall shortfall, not a fabrication; an invented edge
  is fatal regardless of recall. The FIRST rung that fails this gate gates every rung above it —
  report those higher rungs as **skipped-with-a-receipt** (e.g. `IDX-8 skipped: gated by IDX-4 Q&A
  exactness 0/3`), the same Meta-2 discipline the other benches honor: do not score a ceiling while
  the floor leaks. `--ladder` runs the rungs ascending and applies this automatically.
- **Determinism and the restatement rung are hard, not floored.** `RECALL_FLOOR` gives the
  structural rungs room for honest under-resolution. It does not apply to IDX-4 (restatement
  fidelity) or IDX-6 (determinism): a byte-consistency claim is exact or it is failed, and a
  re-index that is not byte-identical is a determinism failure with no partial credit.
- **The conformance kit is the floor beneath IDX-0.** A producer whose graph does not pass
  `runConformance(name, makeProvider)` (`src/tools/conformance.mjs`) cannot be scored at all — the
  graph is not a well-formed Repository-Interface artifact, so there is nothing to grade. Every
  cycle runs the kit against the produced graph first; a conformance failure voids the run the way a
  failed smoke voids a CHATBENCH cycle.
- **Reference bands stay illustrative, never run.** External code-graph tools (seonix's own pinned
  bench corpora — Django, eShopOnWeb, aws-cdk-examples, commander/express, gson) are anchors for a
  future write-up, not scores this harness produces. Don't claim a number for them.
- **Bench-import direction stays one way.** The product (`src/`) never imports from `test-benchmarks/idxbench/`; the
  bench imports downward from `src/index/index-repo.mjs`, `src/index/registry.mjs`, and
  `src/tools/conformance.mjs`. A cycle that reverses this is a real regression — verify with
  `grep -r 'idxbench' src/` before writing up a cycle as clean.

## 2. The branch dependency (read before Step 2)

**The producer ships on the `repo-index` branch, not `main`.** The modules IDXBENCH measures —
`src/index/index-repo.mjs` (`indexRepository`, `extractRepo`, `assembleEntities`),
`src/index/registry.mjs` (the language backend registry), `src/index/extract-jsts.mjs`,
`src/index/extract-python.mjs` / `extract_ast.py`, the `tmct index` CLI, and the
`test/index/*.test.mjs` suite — all live on `repo-index` and are not on `main` yet. This skill doc
lands on `main` ahead of them, so the spec is reviewable before the harness is built.

Until `repo-index` merges, an IDXBENCH cycle runs against the branch: `git fetch origin repo-index`
and index from a checkout or worktree of it, or run the cycle after the merge. `test-benchmarks/idxbench/` itself
(harness, cases, gold sets) can be authored on either branch, but its Step 2 run needs the producer
present. Once `repo-index` merges to `main`, delete this section and treat the producer as a normal
`main` dependency. The conformance kit `runConformance` is already the branch's own Phase-1 exit
criterion (`test/index/js-extractor-seam.test.mjs`), which is why it is IDXBENCH's floor.

## 3. The loop (one cycle; repeats until the ladder tops out or the operator stops)

**Step 1 — READ.** Read the latest `BENCHMARK_CODE_INDEX_<version>.md` (its kept-red section and its
decision on frontiers), the code-index open items in `NEXT.md`, `archive/PLAN_REPO_INDEX.md`'s
implementation-log phase markers, and the current `test-benchmarks/idxbench/cases.jsonl` rung counts. Decide which
language or rung this cycle measures, and whether it is a pure re-measurement or targets a gated rung
to push past.

**Step 2 — RUN the ladder.** `node test-benchmarks/idxbench/run.mjs --ladder --stamp <version>` (provisioned as
`npm run idxbench:run -- --stamp <version>`). Each case indexes its fixture with a pinned timestamp
and `historyDepth` fixed by the rung, runs `runConformance` against the produced graph, then grades
entities/edges/Q&A against `gold`. Fast and free — no judge concurrency to manage. Route it through
the coordinator model below when it is one of several concurrent workstreams.

> **Coordinator model — background sub-agents for the build, not usually the run.** Per `CLAUDE.md`'s
> standing working model, the main session is the coordinator, not the worker. The IDXBENCH run is
> cheap enough to run inline most cycles. What benefits from delegation is the build: a cycle that
> adds a language backend (`src/index/extract-*.mjs`), a resolver pass, new fixture-linted cases and
> gold sets, and the write-up can fan those out to background sub-agents with clear file-ownership
> boundaries, serialized on any shared file (the registry, `graph-build.mjs`), while the coordinator
> keeps the main chat free. A genuinely long run (indexing a large real corpus) moves to a
> background task too.

**Step 3 — READ the rung table.** For each rung read entity P/R, per-predicate edge P/R, Q&A
exactness, and determinism against the gate (§1). Compare against the previous
`BENCHMARK_CODE_INDEX_<version>.md` if this cycle re-measures a producer already on record — did any
previously-clean rung move, and is that move explained (a real producer change, spot-verified against
the fixture source) or unexplained (a regression to chase before writing anything up)?

**Step 4 — DECIDE (apply the rung gate, §1).** Walk IDX-0 → IDX-10 in order. The first ungated PASS
is real fidelity; the first gate failure names exactly where the producer's faithfulness currently
tops out, with a receipt for everything above it.

**Step 5 — SHIP OR BUILD.** Two outcomes:
- **Every rung gates where expected, and the ladder depth is where it should be:** ship as-is. A
  clean re-measurement is a legitimate, reportable outcome, not a null result.
- **A rung you want to move past is gating, or the case set should grow:** implement the next
  producer capability that unlocks it (a new language backend, a resolver for a call-edge class, a
  history pass, a self-index fixture), keep `npm test` green (no exception for `src/index/` work),
  add fixture-linted cases with source-authored gold, and re-run from Step 2 to confirm the target
  rung's gate now passes before moving further up the ladder.

**Step 6 — WRITE the cycle up.** `BENCHMARK_CODE_INDEX_<version>.md` (§1's naming), modeled on the
sibling benches' shape: a headline naming the fidelity delta versus the last cycle; the per-rung
metric table (entity P/R, per-predicate edge P/R, Q&A exactness, determinism); a per-language
comparison when more than one language is measured; a **best-examples pick** — 3-5 canonical
question/answer pairs where the graph restated the source exactly ("where is `parseNode` defined" →
the real file and span, "who calls `coreFn`" → the real caller set), each with a one-line "what this
demonstrates"; what's new this cycle, one item per change with the commit it landed in; any
deliberately-kept red (a rung that resolves structure correctly but misses a canonical answer, named
as a frontier, not patched around); the discipline checklist (zero fabrication held, determinism
byte-verified, gold authored from source not captured, conformance kit green, import direction one
way); and a decision line. Snapshot the raw grader output to
`test-benchmarks/idxbench/results/raw/run-<version>[_00N]/` BEFORE the next run overwrites it. **Mirror every issue
the cycle leaves open** (a kept red, an unexplained rung move, an under-covered language) **into
`NEXT.md`** as a one-line open item pointing at this write-up.

**Step 7 — CONTINUE.** If the operator wants the ladder pushed further, go to Step 1 of the next
cycle with the next gated rung as the target. Like AGENTBENCH and unlike CHATBENCH, IDXBENCH cycles
are coarse-grained — a language backend or a resolver is real implementation work, not a lever
toggle — so each cycle ends with a normal operator check-in rather than an automatic re-arm.

---

## 4. Cadence

- One cycle per producer capability: a language backend, a call-edge resolver class, a history pass,
  the self-index fixture. Size the cycle to that, not to a fixed time box.
- A pure re-measurement (no build) is a fast, cheap cycle — worth running whenever `src/index/` or
  `test-benchmarks/idxbench/cases.jsonl` changes, to catch a fidelity regression before it compounds.
- Run alongside the other bench cycles when a release touches both the chat surface and the
  producer; they measure different axes of the same release.

## 5. Guardrails (delivery discipline)

- **The case set is sacred.** Append-only between cycles; never edit or delete an existing case
  mid-arc; record every addition in the write-up.
- **Gold is authored from source, always.** Never regenerate a gold set from producer output to
  "update" it after a producer change — that erases the bug you are trying to catch. If the fixture
  source changes, re-author the gold by reading the new source; if the producer changes, the gold
  stays put and the producer is measured against it.
- **Zero fabrication is non-negotiable.** No cycle ships a producer change that trades a fabricated
  edge for recall. A change that invents edges to raise a recall number is reverted or gated off,
  not shipped with a caveat. An unresolvable reference is a miss, never a guessed edge.
- **A gated rung is reported, not hidden.** Skipped-with-a-receipt, every time, even when a gated
  rung's raw numbers look fine by coincidence.
- **Snapshot before overwrite.** `test-benchmarks/idxbench/results/raw/run-<version>[_00N]/` is written before the
  next run starts; a same-version re-run stamps `_00N` rather than clobbering the prior raw output.
- **Push state is session-scoped.** Commit locally with the repo-local identity; whether to push
  depends on the current session's operator authorization, same as every other loop in this repo.
- **No LLM leaks into the product or the bench.** The producer is CPU-bound static parsing plus git,
  zero model calls (`src/index/index-repo.mjs`'s own header states it). IDXBENCH's whole value is a
  deterministic ruler for a deterministic producer; a change that puts a model call in either path is
  rejected by definition.

## 6. One-paragraph TL;DR

Run `node test-benchmarks/idxbench/run.mjs --ladder --stamp <version>` (fast, free, fully deterministic — no judge,
no LLM anywhere) and read each rung's metric set — entity precision/recall, per-predicate edge
precision/recall, canonical Q&A exactness, and byte-identical re-index — against the honest gate:
**zero fabrication, recall ≥ 0.5, every canonical Q&A exact** passes a rung (`IDX-0 → IDX-10`,
strictly in order), the first rung that fails gates every rung above it skipped-with-a-receipt, and
an unresolvable reference is a miss, never a guessed edge. `IDX-0…IDX-10` grades one axis — how
faithfully the producer restates source as graph, the code sibling of Ingest's restatement check —
and is a distinct scale from CEFR, `TOOL-*`, and `INF-*`, never compared across benches. The gold
entity/edge sets are authored from the fixture SOURCE, never captured from producer output, which is
what makes this a fidelity measure and not a snapshot test; `runConformance` (`src/tools/conformance.mjs`)
is the floor beneath IDX-0. The producer lives on the `repo-index` branch until it merges, so a
cycle runs against that branch until then (§2). If every rung lands where expected, ship the
re-measurement; to push further, implement the next producer capability that unlocks the gating rung,
keep `npm test` green, and re-run to confirm the gate passes. Write up as
`BENCHMARK_CODE_INDEX_<version>.md` (headline delta, per-rung metric table, per-language comparison,
best-examples pick, what's new, any kept red, the discipline checklist, a decision), snapshotting raw
grader output to `test-benchmarks/idxbench/results/raw/run-<version>[_00N]/` first and mirroring anything left open
into `NEXT.md`. The harness is specified here, not yet built.
