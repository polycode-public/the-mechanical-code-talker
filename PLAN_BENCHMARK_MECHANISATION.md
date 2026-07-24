# PLAN_BENCHMARK_MECHANISATION.md — intelligence authored once, benchmarks run mechanical

Status: PROPOSAL — for operator review. Nothing here is built. Written 2026-07-24 against the
nine `SKILL_BENCHMARK_*.md` docs at 2.11.10.

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
