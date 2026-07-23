# REPORT_AGI_CHECK_IN.md — the demo site against the AI capability map

*(Written 2026-07-23, against the live site at 2.11.x. A point-in-time check-in, not a plan:
it maps what the demo pages show onto the capability areas a survey course would list under
"artificial intelligence", names what is absent at that same level, and separates those
absences from the different-in-kind capabilities that belong to general intelligence. Absences
here are observations about today, not decisions — the plan docs stage several of them
already.)*

## What the site demos, in classic-AI terms

- **Knowledge representation and deduction.** The ledger reads an OWL-labelled graph back as
  sentences; syllogisms chain taught and seeded facts; exceptions work ("a penguin cannot
  fly" overrides "birds fly", and the answer says what it overrode).
- **Natural language understanding and generation.** The chat parses a closed grammar with
  layered strategies and templates, and renders grounded, cited answers.
- **Planning and acting.** Classical planning over declared operators (the plan page, Hanoi,
  river crossing), goal deduction, per-step execution records, and post-condition checks that
  re-read the store rather than assuming success.
- **Learning, symbolic.** Teaching by telling, learning on a miss, document ingestion, wiki
  research, and (offline, in the harness) rule synthesis by bounded search with a
  verification oracle.
- **Multi-agent worlds and partial observability.** Spider-fly runs two sides with belief
  states and limited sight; a taught false belief misleads an agent. The adventure runs NPCs
  on their own schedules.
- **Reading as perception.** ingest.html is the perception-shaped demo: unstructured
  documents in, structured facts out, with provenance. Its input is already symbolic — text
  is somebody's symbols — so it covers the reading half of perception and leaves the
  sub-symbolic half (below) open.
- **Knowing what it doesn't know.** The miss wall: a query nothing grounds gets a refusal
  with a reason, never a guess. Most demos skip this area entirely.

## Absent at the same level

Each of these is a standard capability area with settled literatures. Nothing here is
research-hard by nature; each would be its own engineering arc of the kind the repo already
does (closed vocabularies, bounded search, verified data).

1. **Sub-symbolic perception.** No path from raw signal — pixels, audio, sensor streams — to
   symbols. Ingestion starts where symbols already exist.
2. **Reasoning under uncertainty.** Facts carry trust and provenance, but there are no
   degrees of belief, no updating on evidence, no probabilistic inference. Everything is
   grounded-or-miss.
3. **Induction from examples at runtime.** The system is told facts or extracts them by
   rule. The example-driven generalization it owns (the CEGIS loop) runs offline in the
   harness, by design.
4. **Abduction.** It deduces consequences; it does not infer the best explanation for an
   observation — no diagnosis-shaped reasoning.
5. **Analogy.** No case-based or structure-mapping reasoning.
6. **Causal and counterfactual reasoning.** State snapshots exist; a causal model and
   "what if it had gone the other way" do not. The counterfactuals plan doc stages a first
   step.
7. **An open discourse record.** Cross-turn composition beyond the anaphora lanes — the
   typed record the frozen corpus row marks, staged as the DRT-lite spike.

## Different in kind: the AGI-shaped capabilities

If every area above were engineered closed, the result would be a broader narrow system.
These are the capabilities that separate that from general intelligence, and the site's own
boundary marker — the miss wall — is where each would have to begin:

- **Transfer.** Acquiring a genuinely new domain with no authored rule base, corpus, or
  operator catalogue behind it. Every growth path tmct has is authored somewhere.
- **Autonomous goal formation.** Its goals are declared or deduced from closed rules. It
  does not want new things, and it is not curious.
- **Concept invention.** It mints new terms inside existing slots; it does not invent a new
  representational primitive — a kind of relation the ontology never anticipated.
- **Open-ended self-improvement.** The code-planning track edges toward code that edits
  code, deterministically, on fixtures, from a fixed catalogue. Improvement that changes the
  improver is a different thing.
- **Deep other-minds modeling.** The spiders hold first-order beliefs about the world;
  nothing models a believer of beliefs.
- **Graceful novelty.** Outside every closed set, tmct posts the miss wall — the product's
  central promise, stated as a behavioral invariant. A general system would form a usable
  partial understanding there instead of refusing.

## The point of the comparison

The site's thesis, inverted: it demonstrates how far deterministic, auditable machinery goes
across the classic capability areas, and the miss wall marks precisely where the
different-in-kind capabilities would have to start. The no-LLM product path is a
constitutional decision, not a capability claim; the horizon sections of the plan docs
(`PLAN_AGENTS.md` §5, `PLAN_CODE.md` §4) carry the staged next steps for the near items.
