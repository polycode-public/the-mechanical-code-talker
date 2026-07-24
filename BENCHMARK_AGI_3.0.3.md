# BENCHMARK_AGI_3.0.3.md — second AGI-scales cycle: all eight entry rungs held, two scales read a scalar, three scales moved

The second cycle of `SKILL_BENCHMARK_AGI_SCALES.md`, graded against the 3.0.3 bench sweep
(`package.json` read 3.0.4 at assessment time, rolled after the sweep; every sibling write-up cited
below measured 3.0.3).

**Headline: 3.0.x is the major that added code indexing, and this cycle's reading reflects it.**
Four sibling benches ran their founding baselines this sweep (`BENCHMARK_CODE_INDEX_3.0.3.md`,
`BENCHMARK_CODE_SYNTHESIS_3.0.3.md`, `BENCHMARK_RESEARCH_3.0.3.md`, `BENCHMARK_INGEST_3.0.3.md`)
and three re-measured (`BENCHMARK_AGENT_3.0.3.md`, `BENCHMARK_INFERENCE_3.0.3.md`,
`BENCHMARK_CONVERSATION_3.0.3.md`). Against that estate: all eight entry rungs still hold with
their sources; **temporal-causal depth, loop closure, and stability × plasticity each moved toward
the rung above**; and for the first time a cycle carries mechanised scalar readings — the new
`scripts/agi-scales-aggregate.mjs` reads the committed AGENTBENCH envelope and emits two of the
eight scales as scalars (abstention calibration, goal-origination distance). The other six read
"entry rung held, assessment only", the label the skill requires when no probe produced a number.

**Timing.**

- Assessment (reading the tree, the sibling write-ups, and the demos against the eight scales,
  plus this write-up): 2026-07-24, 08:31:01Z → 08:35:12Z, one sitting.
- Measurement run (the aggregator, the only scalar run this cycle):
  2026-07-24, 08:31:21Z → 08:31:21Z, under one second. No other scalar probe ran.

**The no-LLM line held.** Every scalar cited here came from a deterministic harness (AGENTBENCH's
four driver arms, INFBENCH's replay, IDXBENCH, SYNTHBENCH-CODE, RESEARCHBENCH, INGESTBENCH's
deterministic ladder — no LLM, no network in any of them). LLM judges appear only where the eval
harness already allows them (INGESTBENCH's two judged rungs, CONVERSATION's flow judge, CHATBENCH),
and never in the product path.

---

## The mechanised aggregator (new since 2.11.10)

`node scripts/agi-scales-aggregate.mjs` reads sibling benches' committed machine-readable envelopes
(today: `agentbench/envelope.json`) and emits the eight entry-rung readings, scalar only where a
bench artifact produced the number. This cycle's run:

```
# AGI-scales row — 3.0.4 (2/8 scales read a scalar)

- abstention-calibration — entry rung: fabrication 0% at ≥50% coverage on the graded pools.
  scalar: fabrication 0% at 100% completion on AGENTBENCH (gate-pass), the fixed-risk point.
- goal-origination-distance — entry rung: notch 2 of 4: declared goals plus deduced maintenance
  goals. scalar: notch 2 of 4 — declared goals plus deduced maintenance goals (TOOL-6);
  AGENTBENCH rungReached=TOOL-8.
- transfer-breadth — assessment only.
- other-minds-depth — assessment only.
- temporal-causal-depth — assessment only.
- knowledge-scale-tolerance — assessment only.
- stability-plasticity — assessment only.
- loop-closure — assessment only.
```

Two notes on the row, so the next cycle reads it right. The row stamps **3.0.4** because the
aggregator reads `package.json`, which rolled after the 3.0.3 sweep; the envelope's numbers are the
same 68-case gate-pass `BENCHMARK_AGENT_3.0.3.md` reports (68/68, 0% hallucination, rungReached
TOOL-8), re-stamped by the envelope build. And the aggregator's own header names its growth path:
it reads more scales as scalars when INFBENCH and CHATBENCH grow committed envelopes of their own.

---

## Code assessment

The reviewed reading of the tree and demos, updated from `archive/BENCHMARK_AGI_2.11.10.md`. That cycle's
map still describes the chat, inference, planning, teaching, and multi-agent surfaces accurately;
this section records what 3.0.x added and what it changed in the absence list.

### What 3.0.x added, in classic-AI terms

- **Code as a perception domain.** `tmct index` (and `tmct init`, which runs the same indexer)
  parses real JS/TS and Python source into a typed code graph — modules, classes, functions,
  `imports`/`calls`/`defines`/`tests` edges — with a registry seam
  (`src/index/registry.mjs`) that admits new language backends without engine change. IDXBENCH's
  founding baseline grades it IDX-0 through IDX-9, all clear, zero fabrication across 21 surfaces
  (`BENCHMARK_CODE_INDEX_3.0.3.md`).
- **Chat over the indexed graph.** The code-index query family (members, importers, definition,
  caller anaphora, count, honest-empty), architecture overviews, and module digests all answer over
  the graph `init` wrote, judged live in the persona sweep and frozen as
  `test/chatflow-codeindex-architecture-digest.test.mjs` (`BENCHMARK_CONVERSATION_3.0.3.md`).
- **A typed discourse record.** `PLAN_DISCOURSE_AND_RECOGNITION.md` slices 1–2 shipped: the record
  threads through `runTurn`, and cross-turn temporal composition composes (frozen row 19, below).
- **Planned code edits with real verification.** SYNTHBENCH-CODE's SYN-0: a taught operator binds
  to a goal, refuses on a failed precondition, and the edit is verified by running the edited
  export in a sandboxed subprocess — 4/4, 0% false-pass, byte-deterministic across processes
  (`BENCHMARK_CODE_SYNTHESIS_3.0.3.md`). Above it, the codeplan layer (`PLAN_CODE_PLANNING.md`
  §3.1–3.3, landed) gives the planner a code-graph state with delta effects, an operator catalogue
  as taught action families with Opdyke-style machine-checked preconditions, and `planCodeChange`
  finding a three-step rename-then-move refactor by bounded BFS, honest miss on exhaustion.
- **The research and ingest lanes under measurement.** RESEARCHBENCH's founding run gates at RES-2
  (ordering 67% against an 80% floor — the fan-out queues in document order, as predicted);
  INGESTBENCH's gates at ING-6 (38% recall on the ordinal/temporal-threading slice), with
  precision 100% everywhere and the two judged rungs at 2.0/2 and 1.5/2.

### The absence list, updated

From 2.11.10's seven absences: **sub-symbolic perception, reasoning under uncertainty, runtime
induction from examples, abduction, and analogy stand unchanged** — still observations about
today, with the same staging notes. Two moved:

- **Causal and counterfactual reasoning:** state snapshots now compose across turns through the
  discourse record (the temporal half moved; see the per-scale reading). The counterfactual
  re-solve (INF-10) remains staged in `PLAN_FILLER_AND_COUNTERFACTUALS.md`.
- **An open discourse record:** no longer absent. Slices 1–2 shipped; slices 3–5 (plural binding,
  the tie refusal, the remaining bindable forms) are the open remainder in
  `PLAN_DISCOURSE_AND_RECOGNITION.md`, and ING-6's 38% is their ingest-side measurement.

The different-in-kind list (transfer without authored bases, autonomous goal formation, concept
invention, self-improvement that changes the improver, deep other-minds, graceful novelty) reads
as 2.11.10 wrote it; the miss wall still marks where each would begin. One edge sharpened: the
codeplan track now plans real edits to code from a taught catalogue, which brings the
"code that edits code, deterministically, on fixtures" line closer to measured fact (SYN-0) while
leaving improvement-that-changes-the-improver exactly where the map put it.

---

## Per-scale reading

Each scale: entry rung with its source, whether this cycle read a scalar or graded by assessment,
and any movement toward the rung above.

- **Abstention calibration — entry rung held; SCALAR.** Fabrication 0% at 100% completion on
  AGENTBENCH (gate-pass), the fixed-risk point, read mechanically from the committed envelope.
  The evidence base behind the rung widened this sweep: 0% hallucination on 272 AGENTBENCH rows,
  0% fabrication on 479 INFBENCH rows, 0 fabricated entries across IDXBENCH's 21 surfaces,
  precision 100% on all 20 INGESTBENCH cases, zero invented traversal on RESEARCHBENCH's 7
  measured cases, 0% false-pass on SYNTHBENCH-CODE — seven harnesses now hold the same fixed-risk
  point. CEFR_ENGLISH 3.0.3 (write-up not yet merged at assessment time; numbers from the sweep):
  tier-1 replay 1068/1075, judged mean ~1.78/2 with ~50 hard fails on the graded pool, against
  2.11.0's 1.787/2 on its 92-case sample (`archive/BENCHMARK_CEFR_ENGLISH_2.11.0.md`).
- **Transfer breadth — entry rung held; assessment only.** Three plan-lane domains (hanoi, river
  crossing, crates) acquired with zero engine changes, on record. Movement in mechanism, not yet
  in reading: the index registry seam acquired Python as a second language backend at IDX-5 parity
  (and C# reads unmeasured-not-wrong until a backend registers), and the codeplan operator
  catalogue is taught data, not engine code. Both are authored acquisitions, so the rung above (a
  domain acquired teach-only in one session) is not claimed.
- **Other-minds depth — entry rung held; assessment only.** Depth 1: spider-fly beliefs including
  taught false beliefs, on record in `test/corpus/games/spider-fly.jsonl`. No FLOW-8 probe ran
  this sweep (the persona frames pressed the new code surfaces instead); no movement.
- **Temporal-causal depth — entry rung held; assessment only, and MOVED.** Ordered snapshots plus
  last-touch temporal reads, on record (INFBENCH INF-1…INF-8 all pass). The movement: frozen
  compositional row 19 flipped this sweep — `games/cross-turn-temporal-composition-composes`
  (`test/corpus/games/compositional.jsonl`): "was that before logger.mjs was touched" binds "that"
  to the prior commit-filter pivot through the discourse record, re-runs the embedded clause as
  its own when-question, and cites both dates. The same lane ran live in CONVERSATION's
  git-historian frame (6 turns, 0 dead-ends) and is frozen in the chatflow regression. The rung
  above names two parts — the cross-turn composition (row 19) and a re-solved counterfactual
  (INF-10); the first is now on record, the second remains staged. ING-6's 38% marks the adjacent
  ingest-side threading still to build.
- **Goal-origination distance — entry rung held; SCALAR.** Notch 2 of 4 (declared goals plus
  deduced maintenance goals, TOOL-6), read mechanically from the envelope; AGENTBENCH
  rungReached=TOOL-8, byte-identical to 2.11.0 across all four driver arms. The codeplan planner
  adds a new goal species (graph predicates over code state, `compileCodeGoal`) but they are
  declared goals, so the notch does not move. Notch 3 (a goal inferred from an observed trace,
  TOOL-9) stays the described rung above.
- **Knowledge-scale tolerance — entry rung held; assessment only.** The shipped seed bands (~93k
  child-pack triples, README's corpus table) answer with 0% fabrication, on record. No 10×
  measurement ran. Sideways growth rather than scale growth: the code graph is a second knowledge
  species answered at the same zero-fabrication discipline (IDXBENCH), which widens what the rung
  covers without reading a larger number.
- **Stability × plasticity — entry rung held; assessment only, and MOVED.** Append-only teach with
  prior answers byte-stable within a session, regression-pinned across the corpus lanes, on
  record. The movement is cross-version stability now being measured rather than assumed: INFBENCH
  replayed byte-identical to 2.11.0 across 577 intervening commits (379/379 chat, 100/100 kernel,
  every ceiling count unchanged), AGENTBENCH matched 2.11.0 to the percentage point on 272 rows,
  and the founding benches all pin determinism (IDXBENCH 4/4 byte-identical re-index,
  SYNTHBENCH-CODE identical md5 across independent processes, INGESTBENCH `--replay`
  byte-identical). Plasticity in the same sweep: twelve new chatflow regressions frozen from
  judged passes with dead-end density falling 43% → 8%. Growth with interference measured at zero
  on everything pinned — within-version; the rung above (a growth-per-session rate with a
  zero-interference guarantee across sessions) stays described.
- **Loop closure — entry rung held; assessment only, and MOVED.** Autoplay completes perceive →
  decide → act → verify to a stall or a win honestly, on record
  (`src/services/adventure-autoplay.mjs`, its test). Two movements. First, init-to-indexed-chat:
  `tmct init` perceives a real repo (parses source into the graph), and later chat turns provably
  use the artifact (the code-index family answers over it, frozen in the chatflow regression) — a
  perceive → represent → use chain where the produced knowledge demonstrably feeds later cycles,
  though initiated by the operator, not closed autonomously. Second, SYN-0 closes an act → verify
  loop on code: synthesize an edit, run it in a sandbox, read the outcome, refuse on a failed
  precondition. The rung above (a full cycle closed autonomously with the learned fact provably
  used by a later cycle) is not claimed: the use is proven, the autonomy is not.

---

## Decision

The aggregator delivered the probe the 2.11.10 cycle named (abstention calibration read as a
scalar) for the one bench with a committed envelope. The next growth is mechanical and cheap:
**commit envelopes for INFBENCH and CHATBENCH** so the aggregator's abstention reading spans the
three pools its entry rung actually names, and knowledge-scale tolerance can read the seed-band
count from an artifact instead of prose. Among the capability scales, temporal-causal depth is
closest to its rung above — half of it (row 19) is already on record, and the remaining half is
INF-10's counterfactual re-solve, already staged in its plan doc.

Open items surfaced by this cycle, for the coordinator to mirror into `NEXT.md` (this write-up
deliberately does not edit that file — the sweep coordinator owns it): the two sibling envelopes
above, and re-pinning the aggregator row's version stamp to the measured sweep rather than the
post-roll `package.json` when the two differ.
