# PLAN_BENCHMARK_MECHANISATION.md — intelligence authored once, benchmarks run mechanical

Status: harness machinery LANDED (levers 1, 2, 3, 6, 7), and lever 1's seed pass has RUN — the
3.0.3 cycle judged the full 1,075-case pool and committed `test-benchmarks/chatbench/verdict-cache.json`
(`reports/BENCHMARK_CEFR_ENGLISH_3.0.3.md`; its final top-up judged 47 and inherited 1,028, the
mechanism working as designed). Lever 4's chatbench half has also LANDED: `chatbench/run.mjs`'s
tier-1 carries `expect.subclassParaphrase`, checked with ingestbench's own ING-7 checker
(`verifySubClassParaphrase`, `src/domain/paraphrase.mjs`) — a case whose answer only needs to be a
valid subclass paraphrase, not one pinned literal string, now settles free instead of reaching the
judge. Remaining scope: the bulk matcher distillation over the all-green pool (lever 2's authoring
pass), the calibration grade (lever 3's paired frontier/small-model runs feeding `--gate`), and
ING-8's own corpus-authored equivalence checker (a separate, larger piece — "The levers" §4 below;
not touched by the chatbench wiring). Written 2026-07-24 against the nine `SKILL_BENCHMARK_*.md`
docs at 2.11.10; the chatbench wiring landed 2026-07-27.

## What landed (the mechanism; the paid runs stay the coordinator's)

- **Lever 1 — verdict cache.** `test-benchmarks/chatbench/verdict-cache.mjs`; `test-benchmarks/chatbench/judge.mjs --cache <file>`.
  A run inherits the prior verdict for every case whose answer text AND judge identity (model +
  prompt version + `fixture-context` grain) are unchanged, and judges only the changed cases. The
  cache is rewritten each run. Deterministic; keyed on answer content, never a file date.
- **Lever 2 — tier-promotion matchers.** `test-benchmarks/chatbench/matchers.mjs`. Distils a case judged PASS with
  byte-stable wording across two cycles into a deterministic `answerMatch` of escaped-literal
  grounded tokens — tighter than the judge by construction (`matcherTighterThanJudge`). A promoted
  case gates on its matcher and the judge is the appeal court for a matcher that now fails. The
  bulk distillation over the all-green pool is a reviewed authoring pass for the coordinator.
- **Lever 3 — rubric compilation + down-tiering.** Per-construction rubrics as committed data
  (`test-benchmarks/chatbench/rubrics.json`); `test-benchmarks/chatbench/rubrics.mjs` maps a construction to a rubric family and
  holds the calibration-set selection, the per-family agreement metric, the down-tier gate and the
  model pick. `test-benchmarks/chatbench/calibrate.mjs --select` writes the ~50-case set (`test-benchmarks/chatbench/calibration.jsonl`);
  `--gate` reads a frontier + a small-model summary and emits the down-tier decision. The two paid
  grade passes are the coordinator's; the gate is calibration-locked — a family never leaves the
  frontier model unmeasured.
- **Lever 4 (chatbench half) — subclass-paraphrase equivalence in tier-1.**
  `test-benchmarks/chatbench/run.mjs`'s `expect.subclassParaphrase: {subject, object}` checks a
  turn's answer with ingestbench's own ING-7 checker (`verifySubClassParaphrase`,
  `src/domain/paraphrase.mjs`) instead of a pinned `answerMatch` string — a case whose answer only
  needs to be a valid `rdfs:subClassOf` paraphrase of the pair, not one hardcoded template pick,
  settles at tier-1 for free. ING-8's own corpus-authored checker (the harder, whole-document piece
  "The levers" §4 describes) is a separate, larger, not-yet-started step.
- **Lever 6 — execution speed.** Skip-unchanged replay (`test-benchmarks/chatbench/skip-unchanged.mjs`;
  `test-benchmarks/chatbench/run.mjs --reuse <prior.jsonl> --engine-token <tok>`) reuses a prior product row when the
  case input hash and engine token match; `--concurrency <n>` shards turns-mode replays (session
  cases stay sequential — they share a process-global source cache). The seeded fixture store is
  already built once per run and cloned per case. Residual judge calls batch per rubric family
  (`test-benchmarks/chatbench/batch-judge.mjs`; `judge.mjs --batch <n>`, dry-run-emitted). Defaults are unchanged:
  no engine token means byte-identical rows and single-lane replay.
- **Lever 7 — AGI-scales aggregation.** `scripts/agi-scales-aggregate.mjs` reads the sibling benches'
  committed envelopes (AGENTBENCH's and INFBENCH's; CHATBENCH's generator exists — `test-benchmarks/chatbench/generate-envelope.mjs`,
  a pure read+reshape over an already-graded run's summary.json/product.jsonl, no model calls of its
  own — but its envelope is committed only once a live judge pass has actually produced a summary to
  read) and emits the eight entry-rung readings mechanically, marking a scale MEASURED only when a
  bench artifact produced the scalar. Abstention calibration reads AGENTBENCH's zero-hallucination
  gate alone until INFBENCH's/CHATBENCH's envelopes both also clear their own zero-fabrication check,
  at which point it reports the reading spanning all three pools; goal-origination distance reads
  AGENTBENCH's reached ladder rung; knowledge-scale-tolerance reads `corpus/child/manifest.json`'s
  fact count directly. The other five read assessment-only. No rung or reading is ever fabricated,
  and every new envelope is read null-safe — an older checkout without one degrades to the readings
  available before it existed.

Coordinator hand-off: to expose the delta-judging default, add to `package.json` scripts —
`"chatbench:judge:cached": "node test-benchmarks/chatbench/judge.mjs --cache test-benchmarks/chatbench/verdict-cache.json"` —
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
   session. Biggest cost and wall-clock cut. **DONE 2026-07-24**, including the paid seed pass.
2. Lever 2's first bulk distillation pass over the current all-green judged pool — one
   authoring session with review.
3. Lever 3's rubrics + calibration set — one authoring session; then measure the small judge's
   agreement before trusting it with anything. Machinery DONE; the paired calibration runs
   remain.
4. Lever 4's chatbench half — **DONE 2026-07-27**: ING-7's checker now runs inside chatbench's
   tier-1 (`expect.subclassParaphrase`, above). `test-benchmarks/ingestbench/` still stages the
   deterministic/judged boundary exactly as this plan assumed (deterministic checker at ING-7,
   judge at ING-8/9) — ING-8's own corpus-authored checker is the piece still to author.

The invariants that never move: graders are committed, reviewed data; a fabricated pass is
impossible by construction (caches key on answer content, matchers are tighter than the judge,
down-tiered judges are calibration-gated); and no model output ever enters the product path.

## Cost to land the remainder (measured basis, 2026-07-24)

The measured constants these estimates rest on: judge throughput is ~0.32 calls/s at
concurrency 24 (API-latency-bound — 48-way gave no gain), so 2,150 calls ≈ ~1.9 h; the seed
pass proved the cache (final top-up: 47 judged, 1,028 inherited); a harness-building background
agent runs 50k–400k tokens and 15 min–1 h; the full 21-agent 3.0.x session plus its ~4,300-call
judge activity crossed one monthly spend limit — the remainder below is roughly a tenth of that
session.

| item | agent effort | judge cost | wall clock |
|---|---|---|---|
| Lever 4 (ING-8 checker) | one agent authors candidate paraphrase pairs; one builds the checker + held-out gate (the sibling ING-7 checker was ~18 min inside a ~180k-token build) | ~200 pairs × 2 samples ≈ 400 haiku calls ≈ ~20 min | ~2–3 h |
| Lever 2 distillation pass | one agent runs the distiller over the all-green pool, sample-reviews the generated matchers, freezes tests | zero — that is the lever's point | ~1–2 h |
| Lever 3 calibration grade | one agent runs paired frontier + small-model passes over the committed 52-case set, then the mechanical `--gate` | ~52 × 2 models × 2 samples ≈ 200 calls ≈ ~15 min | ~1 h |

Total: about half a coordinated session — three background agents, mostly parallel (~2–3 h wall
clock), 0.5–1M tokens of agent work, under ~600 haiku judge calls (~35 min of API time).

Two scheduling caveats:

1. **Lever 4's bottleneck is corpus, not code.** The checker distills from JUDGED examples and
   only two real ING-8/9 verdicts exist (`reports/BENCHMARK_INGEST_3.0.3.md`). The pair-authoring and
   judging pass is the unavoidable paid step; the checker build is mechanical after it.
2. **Lever 2's "byte-stable across two cycles" rule** strictly wants a second full-pool judged
   cycle to compare against (3.0.3 was the first). The pragmatic reading — product replay is
   deterministic, so wording stability is established by replay, not re-judging — keeps it
   free; the strict reading adds one ~2,150-call cycle that the cache would mostly inherit
   anyway.

The payoff already banked plus what the remainder buys: an ordinary CEFR cycle has dropped from
2,150 judge calls to the dozens the cache misses; matchers pull the routine tier to zero calls;
ING-8 leaves the judged column. The judge ends as an appeal court invoked rarely, not a
per-cycle bill.
