# Reference library — classical planning & knowledge representation

The reference set behind [`PLAN_CAPABILITY_ROUTER.md`](../../../PLAN_CAPABILITY_ROUTER.md):
the 40-plus-year body of **deterministic, no-LLM, goal-directed planning** that tells us how far a
tmct-backed tool loop can climb before it has to escalate.

> **Why this correction matters.** The capability-router RFC — and the agentic-capability ladder it
> ships with — drew "open-ended planning" (rung C1) as a ceiling where a deterministic router simply
> *refuses*. That is too pessimistic, and this literature is why. Classical AI planning is exactly
> **goal-directed, multi-step decomposition without a language model**: given a declared operator
> model (each action's preconditions and effects), a planner finds an ordered set of actions that
> reaches a goal, adapts when execution surprises it, and can *prove* why every step is there. The
> honest ceiling is not *planning* — it is **open-world** planning, where the operator model is
> incomplete and novelty is unbounded. **Closed-world, declared-operator C1 is reachable
> deterministically** (POP / HTN / PDDL solvers do it today); open-world C1 is where the LLM still
> wins and tmct escalates. The ladder's C1 row should read "closed-world: reachable · open-world:
> refuses / escalates", not a flat "refuses".

## How each idea maps onto tmct

tmct's substrate lines up with classical planning almost term-for-term — the router's "new engine"
is less novel than it first looks:

| Classical planning                         | tmct's capability router                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| **Operators** (preconditions → effects)    | Capabilities-as-facts (`Capability` / `Precondition` / `Effect` individuals)    |
| **Open-condition satisfaction**            | The unification + backward-chaining **resolver** (Stage 1)                       |
| **Causal links** (A achieves *p* for B)    | The **proof chain** — *why* each tool call is in the plan (the glass box)        |
| **Threats** + promotion/demotion           | Conflict detection between tool calls; kin to the "if you mean X …" surround     |
| **HTN methods** (task → subtask network)   | A capability that decomposes into a declared sub-recipe (the B1 "recipe" rung)   |
| **Plan-vs-execute under uncertainty**      | The loop's "act now or plan more" decision — and tmct's per-run **budget** model |
| **PDDL** (the operator declaration format) | The capability declaration format (ACE sentences or TOML) the router compiles    |

## Contents

| File                                                         | Reference                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`PARTIAL_ORDER_PLANNING.md`](PARTIAL_ORDER_PLANNING.md)     | Least-commitment planning: causal links, threats, open conditions (SNLP, UCPOP).                |
| [`NONLIN.md`](NONLIN.md)                                     | Tate (1976), Edinburgh — the first HTN, partial-order planner; O-Plan and the HTN lineage.      |
| [`STRIPS_PDDL.md`](STRIPS_PDDL.md)                           | The operator/effect model (STRIPS, 1971) and its modern declaration language, PDDL.             |
| [`STEEL_AND_HO.md`](STEEL_AND_HO.md)                         | Steel & Ho (1993), Essex — planning *and execution* under uncertainty; when to stop planning.   |
| [`BDI_GOAL_DRIVEN_AUTONOMY.md`](BDI_GOAL_DRIVEN_AUTONOMY.md) | Rao & Georgeff BDI + Aha/Molineaux/Cox Goal-Driven Autonomy + continual planning (Stage 5).     |
| Also linked below                                            | GraphPlan (Blum & Furst, 1995), SATPLAN (Kautz & Selman), HTN solvers (SHOP2), the IPC.         |

### Design notes (router-stage synthesis, not primary-source references)

| File                                                         | Covers                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`STAGE_2_INTENT_FRAMES.md`](STAGE_2_INTENT_FRAMES.md)       | Stage 2 — imperative NL → intent frames over a controlled fragment; reuse of the ACE parser + lexicon; the in-scope/escalate boundary. |
| [`STAGE_5_GOAL_REASONER.md`](STAGE_5_GOAL_REASONER.md)       | Stage 5 — closed-world C2 goal-reasoner; first-step arbitration, intention persistence, the open-world goal-generation residual. |

## Further primary works (link-only)

- **GraphPlan** — Blum & Furst (1995), *Fast Planning Through Planning Graph Analysis*.
  https://www.cs.cmu.edu/~avrim/Papers/graphplan.pdf — the planning-graph mutex analysis that made
  classical planning fast; still the backbone of many modern planners.
- **SATPLAN / Blackbox** — Kautz & Selman, planning as Boolean satisfiability.
  https://www.cs.cornell.edu/selman/ — relevant if the router's match step is ever cast as SAT.
- **SHOP2** — Nau et al. (2003), *SHOP2: An HTN Planning System*, JAIR 20.
  https://www.jair.org/index.php/jair/article/view/10362 — a practical, ordered HTN planner; the
  closest off-the-shelf shape to "capabilities that decompose into sub-recipes".
- **PDDL / the International Planning Competition** — the standard operator/domain language and the
  benchmark suite. https://www.icaps-conference.org/competitions/ — where "how good is a
  deterministic planner today" is actually measured (the agentic-ladder's real B1–C1 evidence).
- **AIAI Edinburgh — early planners archive** (NONLIN, O-Plan, I-X).
  https://www.aiai.ed.ac.uk/project/early-planners/ and https://github.com/aiaustin/planners

## Licensing policy (MPL-2.0 repo)

Consistent with [`../README.md`](../README.md): these are **original synthesis notes** under the
repo licence, written from the primary sources — the papers themselves are **link-only** (they are
copyright of their publishers/authors, and some, like the Essex CSM-184 report, exist only as
scanned images). No PDFs are committed here; every note carries the canonical URL for the reader to
retrieve the source. Where a sibling Polycode project holds fuller notes on the same works
(`agentic-lib`'s planning reference), these tmct notes are written fresh and framed for tmct's own
consumer, not copied.

## Consumer in this repo

[`PLAN_CAPABILITY_ROUTER.md`](../../../PLAN_CAPABILITY_ROUTER.md) — Stage 1 (the resolver =
open-condition satisfaction), Stage 5 (the planner = POP/HTN over declared capabilities), and the
honest-ceiling framing throughout.

## Deepen-next

- When the router reaches Stage 5, pick a concrete target: **HTN (SHOP2-style)** if capabilities are
  naturally hierarchical recipes, or **POP (UCPOP-style)** if least-commitment + causal-link proofs
  are the priority. Prototype against a small PDDL-style domain before building the engine.
- Verify each note's dates/attributions against the live sources and stamp a retrieval date
  (currently authored from established secondary knowledge — treat as good-faith until web-checked).
- Add a worked example: one file-ops domain expressed as PDDL operators **and** as tmct capabilities,
  side by side, to make the mapping table above concrete.
