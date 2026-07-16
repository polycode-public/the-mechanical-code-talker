# STRIPS and PDDL — the operator/effect model

**Canonical sources:** Fikes & Nilsson (1971), *STRIPS: A New Approach to the Application of Theorem
Proving to Problem Solving*, Artificial Intelligence 2(3–4), pp. 189–208,
https://ai.stanford.edu/~nilsson/OnlinePubs-Nils/PublishedPapers/strips.pdf · McDermott et al.
(1998), *PDDL — The Planning Domain Definition Language*, Yale/AIPS,
https://en.wikipedia.org/wiki/Planning_Domain_Definition_Language
**Licence:** link-only. · **Consumer:** `PLAN_AGENTS.md` (Stage 0, the capability
declaration format; Stage 1, the resolver; router status at §1.3). · **Status:** UNVERIFIED-pending-web-check.

## What it is

**STRIPS** (Stanford Research Institute Problem Solver) gave planning its enduring representation: an
**operator** is a triple of
- **preconditions** — facts that must hold for the operator to apply,
- an **add list** — facts it makes true,
- a **delete list** — facts it makes false.

A planning problem is an initial state, a goal (a set of facts to make true), and a set of operators;
a plan is a sequence (or partial order) of operator instances that transforms the initial state into
one satisfying the goal. The **STRIPS assumption** — everything not on the delete list is unchanged —
is what makes the state update tractable, and it is the definition of a **closed world**.

**PDDL** (Planning Domain Definition Language) is the modern, standard *syntax* for that model,
factored into a reusable **domain** (the operators/types/predicates) and a per-task **problem** (the
objects, initial state, goal). It is the lingua franca of the International Planning Competition, so a
domain written in PDDL can be handed to dozens of off-the-shelf solvers.

## Why it matters to tmct

This is the **most direct mapping** in the whole reference set: a **capability is a STRIPS/PDDL
operator**.

1. **Capabilities-as-facts = operators.** A tool declared with the type of thing it acts on, its
   **preconditions** (what must be true to call it — file exists, path in-repo) and its **effects**
   (what it changes) *is* a STRIPS operator expressed in tmct's OWL vocabulary. The router's "declare
   your capabilities" step is authoring a PDDL-style domain.
2. **The resolver is operator selection.** Backward chaining from a goal/open condition to an operator
   whose effect achieves it is exactly what Stage 1 does; the difference is only notation (OWL
   unification vs. PDDL matching).
3. **Preconditions are the safety gate.** A capability that will not fire unless its preconditions are
   provably satisfied is why the router *refuses* rather than issuing an unsafe call — the same
   discipline as tmct's honest miss, now enforced by the operator model.
4. **The closed-world assumption is the ceiling line.** STRIPS is powerful *because* it assumes a
   closed world. That assumption is exactly where the agentic-ladder ceiling sits: inside a declared,
   closed domain, a planner is complete and deterministic (reachable C1); the moment the world is open
   — an effect you didn't model, a novel error — the assumption breaks and tmct must escalate.

Reusing PDDL rather than inventing a format also means the router could, in principle, **defer to a
mature external solver** (Fast Downward, an IPC planner) for the hard search, keeping tmct's job as
the NL→domain compiler and the proof-chain renderer.

## Links

- STRIPS (1971): https://ai.stanford.edu/~nilsson/OnlinePubs-Nils/PublishedPapers/strips.pdf
- PDDL overview: https://en.wikipedia.org/wiki/Planning_Domain_Definition_Language
- Fast Downward (reference solver): https://www.fast-downward.org/
