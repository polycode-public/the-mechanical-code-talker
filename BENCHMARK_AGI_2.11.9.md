# BENCHMARK_AGI_2.11.9.md — first AGI-scales cycle, assessment only

The first cycle of `SKILL_BENCHMARK_AGI_SCALES.md`, graded against `package.json` 2.11.9.

**This cycle grades by assessment alone.** No scalar measures were run. None of the eight scales has
a runnable probe yet, so every scale reads at its entry rung by the reviewed reading below, not by a
number a harness produced. The code assessment is the only measure this cycle. The eight scales are
the ruler future cycles hold tmct to, and each entry rung is held from here (§ "Per-scale reading").

**Timing.** Assessment: 2026-07-23, one sitting, reading the live site at 2.11.x and the tree at
2.11.9. No measurement run — no scale was read as a scalar this cycle.

---

## Code assessment

A reviewed reading of the demo site and the codebase against the AI capability map: what the demos
show in classic-AI terms, what is absent at that same level, and what is different in kind and would
belong to general intelligence. Absences here are observations about today, not decisions; the plan
docs stage several of them already.

### What the site demos, in classic-AI terms

- **Knowledge representation and deduction.** The ledger reads an OWL-labelled graph back as
  sentences; syllogisms chain taught and seeded facts; exceptions work ("a penguin cannot fly"
  overrides "birds fly", and the answer says what it overrode).
- **Natural language understanding and generation.** The chat parses a closed grammar with layered
  strategies and templates, and renders grounded, cited answers.
- **Planning and acting.** Classical planning over declared operators (the plan page, Hanoi, river
  crossing), goal deduction, per-step execution records, and post-condition checks that re-read the
  store rather than assuming success.
- **Learning, symbolic.** Teaching by telling, learning on a miss, document ingestion, wiki research,
  and (offline, in the harness) rule synthesis by bounded search with a verification oracle.
- **Multi-agent worlds and partial observability.** Spider-fly runs two sides with belief states and
  limited sight; a taught false belief misleads an agent. The adventure runs NPCs on their own
  schedules.
- **Reading as perception.** ingest.html is the perception-shaped demo: unstructured documents in,
  structured facts out, with provenance. Its input is already symbolic — text is somebody's symbols —
  so it covers the reading half of perception and leaves the sub-symbolic half (below) open.
- **Knowing what it doesn't know.** The miss wall: a query nothing grounds gets a refusal with a
  reason, never a guess. Most demos skip this area entirely.

### Absent at the same level

Each of these is a standard capability area with settled literatures. Nothing here is research-hard
by nature; each would be its own engineering arc of the kind the repo already does (closed
vocabularies, bounded search, verified data).

1. **Sub-symbolic perception.** Nothing here turns raw signal (pixels, audio, sensor streams) into
   symbols yet. Ingestion starts where symbols already exist.
2. **Reasoning under uncertainty.** Facts carry trust and provenance, but there are no degrees of
   belief, no updating on evidence, no probabilistic inference. Everything is grounded-or-miss.
3. **Induction from examples at runtime.** The system is told facts or extracts them by rule. The
   example-driven generalization it owns (the CEGIS loop) runs offline in the harness, by design.
4. **Abduction.** It deduces consequences; it does not infer the best explanation for an observation.
   No diagnosis-shaped reasoning.
5. **Analogy.** No case-based or structure-mapping reasoning.
6. **Causal and counterfactual reasoning.** State snapshots exist; a causal model and "what if it had
   gone the other way" do not. The counterfactuals plan doc stages a first step.
7. **An open discourse record.** Cross-turn composition beyond the anaphora lanes — the typed record
   the frozen corpus row marks, staged as the DRT-lite spike.

### Different in kind: the AGI-shaped capabilities

If every area above were engineered closed, the result would be a broader narrow system. These are
the capabilities that separate that from general intelligence, and the site's own boundary marker
(the miss wall) is where each would have to begin:

- **Transfer.** Acquiring a new domain with no authored rule base, corpus, or operator catalogue
  behind it. Every growth path tmct has is authored somewhere.
- **Autonomous goal formation.** Its goals are declared or deduced from closed rules. It does not
  want new things, and it is not curious.
- **Concept invention.** It mints new terms inside existing slots; it does not invent a new
  representational primitive: a kind of relation the ontology never anticipated.
- **Open-ended self-improvement.** The code-planning track edges toward code that edits code,
  deterministically, on fixtures, from a fixed catalogue. Improvement that changes the improver is a
  different thing.
- **Deep other-minds modeling.** The spiders hold first-order beliefs about the world; nothing models
  a believer of beliefs.
- **Graceful novelty.** Outside every closed set, tmct posts the miss wall — the product's central
  promise, stated as a behavioral invariant. A general system would form a usable partial
  understanding there instead of refusing.

### The point of the comparison

The site's thesis, inverted: it demonstrates how far deterministic, auditable machinery goes across
the classic capability areas, and the miss wall marks precisely where the different-in-kind
capabilities would have to start. The no-LLM product path is a constitutional decision, not a
capability claim; the horizon sections of the plan docs (`PLAN_AGENTS.md` §5, `PLAN_CODE.md` §4)
carry the staged next steps for the near items.

---

## Per-scale reading (all entry rungs held, assessment only)

Each scale is read at its entry rung by the assessment above and the sources
`SKILL_BENCHMARK_AGI_SCALES.md` cites. No scalar was run this cycle.

- **Abstention calibration.** Entry rung held: fabrication 0% at ≥50% coverage on the graded pools,
  on record across INFBENCH, AGENTBENCH, and CHATBENCH. Assessment only.
- **Transfer breadth.** Entry rung held: three plan-lane domains (hanoi, river crossing, crates)
  acquired with zero engine changes, on record. Assessment only.
- **Other-minds depth.** Entry rung held: depth 1, spider-fly beliefs including taught false beliefs.
  Assessment only. Sibling axis: `SKILL_BENCHMARK_CONVERSATION.md` FLOW-8.
- **Temporal-causal depth.** Entry rung held: ordered snapshots plus last-touch temporal reads.
  Assessment only. Sibling axis: `SKILL_BENCHMARK_INFERENCE.md` INF-10 and frozen compositional row
  19.
- **Goal-origination distance.** Entry rung held: notch 2 of 4, declared goals plus deduced
  maintenance goals. Assessment only. Sibling axis: `SKILL_BENCHMARK_AGENT.md` TOOL-6 (reached),
  TOOL-9 (horizon).
- **Knowledge-scale tolerance.** Entry rung held: the shipped seed bands (~93k triples) answer with
  0% fabrication, on record. Assessment only.
- **Stability × plasticity.** Entry rung held: append-only teach with prior answers byte-stable
  within a session, regression-pinned across the corpus lanes. Assessment only.
- **Loop closure.** Entry rung held: autoplay completes perceive → decide → act → verify to a stall
  or a win honestly, on record. Assessment only.

---

## Decision

Assessment-only baseline established; all eight entry rungs held. The next cycle's first candidate
for a scalar probe is **abstention calibration**: the risk-coverage curve is the closest to
buildable, since the fabrication rate and coverage it needs are already produced by INFBENCH,
AGENTBENCH, and CHATBENCH — a cycle would gather them into one curve rather than build new
machinery. The other seven scales stay assessment-only until the axis they read grows a probe in the
plan doc that owns it.
