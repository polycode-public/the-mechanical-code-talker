# PLAN_BENCHMARK_MECHANISATION.md — intelligence authored once, benchmarks run mechanical

Status: harness machinery LANDED (levers 1, 2, 3, 6, 7), and lever 1's seed pass has RUN — the
3.0.3 cycle judged the full 1,075-case pool and committed `chatbench/verdict-cache.json`
(`BENCHMARK_CEFR_ENGLISH_3.0.3.md`; its final top-up judged 47 and inherited 1,028, the
mechanism working as designed). Remaining scope, all unblocked: lever 4 (`ingestbench/` now
exists — wire its deterministic equivalence checker into the judged tiers' cycle), the bulk
matcher distillation over the all-green pool (lever 2's authoring pass), and the calibration
grade (lever 3's paired frontier/small-model runs feeding `--gate`). Written 2026-07-24 against
the nine `SKILL_BENCHMARK_*.md` docs at 2.11.10.

## What landed (the mechanism; the paid runs stay the coordinator's)

- **Lever 1 — verdict cache.** `chatbench/verdict-cache.mjs`; `chatbench/judge.mjs --cache <file>`.
  A run inherits the prior verdict for every case whose answer text AND judge identity (model +
  prompt version + `fixture-context` grain) are unchanged, and judges only the changed cases. The
  cache is rewritten each run. Deterministic; keyed on answer content, never a file date.
- **Lever 2 — tier-promotion matchers.** `chatbench/matchers.mjs`. Distils a case judged PASS with
  byte-stable wording across two cycles into a deterministic `answerMatch` of escaped-literal
  grounded tokens — tighter than the judge by construction (`matcherTighterThanJudge`). A promoted
  case gates on its matcher and the judge is the appeal court for a matcher that now fails. The
  bulk distillation over the all-green pool is a reviewed authoring pass for the coordinator.
- **Lever 3 — rubric compilation + down-tiering.** Per-construction rubrics as committed data
  (`chatbench/rubrics.json`); `chatbench/rubrics.mjs` maps a construction to a rubric family and
  holds the calibration-set selection, the per-family agreement metric, the down-tier gate and the
  model pick. `chatbench/calibrate.mjs --select` writes the ~50-case set (`chatbench/calibration.jsonl`);
  `--gate` reads a frontier + a small-model summary and emits the down-tier decision. The two paid
  grade passes are the coordinator's; the gate is calibration-locked — a family never leaves the
  frontier model unmeasured.
- **Lever 6 — execution speed.** Skip-unchanged replay (`chatbench/skip-unchanged.mjs`;
  `chatbench/run.mjs --reuse <prior.jsonl> --engine-token <tok>`) reuses a prior product row when the
  case input hash and engine token match; `--concurrency <n>` shards turns-mode replays (session
  cases stay sequential — they share a process-global source cache). The seeded fixture store is
  already built once per run and cloned per case. Residual judge calls batch per rubric family
  (`chatbench/batch-judge.mjs`; `judge.mjs --batch <n>`, dry-run-emitted). Defaults are unchanged:
  no engine token means byte-identical rows and single-lane replay.
- **Lever 7 — AGI-scales aggregation.** `scripts/agi-scales-aggregate.mjs` reads the sibling benches'
  committed envelopes (AGENTBENCH's today) and emits the eight entry-rung readings mechanically,
  marking a scale MEASURED only when a bench artifact produced the scalar — abstention calibration
  and goal-origination distance read scalars off the envelope; the other six read assessment-only.
  No rung is ever fabricated.

Coordinator hand-off: to expose the delta-judging default, add to `package.json` scripts —
`"chatbench:judge:cached": "node chatbench/judge.mjs --cache chatbench/verdict-cache.json"` —
(this sub-agent does not edit `package.json`). The verdict cache file itself is written on the
first cached judged run and committed as reviewed data thereafter.

## The idea

The eval harness may use LLMs; the product may not. Today that budget concentrates in a few
places — above all the CEFR judge — and most of it re-buys the same judgment every cycle. The
fix is the same split the repo's own constitution and `PLAN_CODE_PLANNING.md` §4 describe: a frontier
model (this one) authors graders, rubrics and caches ONCE, as reviewed committed data; the
harness then runs them mechanically, forever, at near-zero model cost. Each lever below names
what we author together once, and what runs without a model afterwards.

## Where the cost sits today

| bench | grading today | LLM exposure |
|---|---|---|
| CEFR_ENGLISH | tier-1 answerMatch, then LLM judge over the graded pool (~1,075 cases) | the heaviest: judge re-reads every case every cycle |
| CONVERSATION | judged flows + frozen chatflow regressions | moderate; the ratchet already freezes passes |
| AGENT, INFERENCE | deterministic value-compare | none |
| RESEARCH, CODE_INDEX, CODE_SYNTHESIS | deterministic by design (specs) | none |
| INGEST | ING-0..7 deterministic; ING-8/9 judged equivalence | small once built |
| AGI_SCALES | a reviewed code assessment per cycle | rare, one document |

## The levers

1. **Delta-judging (largest win, no intelligence needed — just the cache).** tmct is
   deterministic: an unchanged case against unchanged machinery produces a byte-identical
   answer. Key a committed verdict cache by `(case id, answer hash)`; a cycle judges only
   cases whose answer TEXT changed since the last judged run, and unchanged answers inherit
   their verdict. On a typical cycle (a handful of fixes), judge calls drop from ~1,075 to the
   dozens that actually changed. Estimated judge-token cut: 90%+ per ordinary cycle.
   Authored once: the cache format and the invalidation rule (answer hash, never file dates).

2. **Tier promotion — judge verdicts distilled into deterministic matchers.** Any case judged
   PASS with stable wording across two consecutive cycles gets a hand-authored `answerMatch`
   capturing the semantic essentials (we author these in bulk from the judge transcripts, as
   reviewed data — the `-v2` supersede discipline already covers revisions). The deterministic
   tier becomes the gate; the judge becomes the appeal court for tier-1 failures only.
   Composes with lever 1: a promoted case never reaches the judge at all.

3. **Rubric compilation + judge down-tiering.** For cases that still need judgment: we author
   per-construction rubrics once (short checklists with quotable criteria and a structured
   three-field verdict schema — no prose verdicts). Then a calibration set (~50 cases we grade
   at frontier tier) measures a small judge model against it per construction family; families
   above an agreement threshold run on the small model from then on. Re-calibrate only when a
   rubric changes. Cuts per-call cost on the residual judge load; the structured schema also
   cuts tokens and parse failures.

4. **ING-8 equivalence compiled to a checker.** Rather than judging paraphrase equivalence
   forever, we author a deterministic equivalence checker (normalization + synonym tables over
   the closed relation vocabulary, seeded from `verifySubClassParaphrase`'s pattern) from a
   corpus of judged examples, then hold it to a held-out judged set. The judge stays only for
   ING-9's whole-document fidelity. This is the ReaComp pattern `PLAN_CODE_PLANNING.md` §4.11 cites,
   applied to our own harness.

5. **CONVERSATION's ratchet, made a rule.** Every judged pass becomes a frozen chatflow
   regression within one cycle (the machinery exists; the proposal is only the discipline
   line in the skill doc). The judged surface then shrinks monotonically.

6. **Execution speed, no model involved.** Skip-unchanged-case execution using the same
   determinism (hash of case input + the engine files its lane reaches); one seeded store
   built per run and cloned per case rather than re-seeded; shard lanes across workers at the
   concurrency the suite already tolerates; batch residual judge calls per rubric family.

7. **AGI_SCALES entry checks scripted.** The eight entry-level passes are all facts other
   benches already record — a small aggregator script reads their envelopes/write-ups and
   emits the AGI scales row mechanically. The code assessment stays a per-major-version
   frontier task, by design.

## What we would do together, in order

1. Lever 1 (cache) + lever 6 (skip-unchanged) — pure harness work, no judgment authoring; one
   session. Biggest cost and wall-clock cut.
2. Lever 2's first bulk distillation pass over the current all-green judged pool — one
   authoring session with review.
3. Lever 3's rubrics + calibration set — one authoring session; then measure the small judge's
   agreement before trusting it with anything.
4. Lever 4 when `ingestbench/` gets built (its spec already stages the deterministic/judged
   boundary at ING-7/8).

The invariants that never move: graders are committed, reviewed data; a fabricated pass is
impossible by construction (caches key on answer content, matchers are tighter than the judge,
down-tiered judges are calibration-gated); and no model output ever enters the product path.
