# NONLIN and the HTN lineage (Tate, Edinburgh, 1976)

**Canonical sources:** Tate, A. (1976), *Project Planning Using a Hierarchic Non-linear Planner*,
D.A.I. Research Report No. 25, University of Edinburgh · Tate, A. (1977), *Generating Project
Networks*, IJCAI-77, pp. 888–893 (reprinted in *Readings in Planning*, Morgan-Kaufmann, 1990).
**Project pages:** https://www.aiai.ed.ac.uk/project/nonlin/ ·
https://www.aiai.ed.ac.uk/project/early-planners/ · code archive:
https://github.com/aiaustin/planners
**Licence:** link-only. · **Consumer:** `PLAN_CAPABILITY_ROUTER.md` (Stage 5, the recipe/HTN shape).
· **Status:** UNVERIFIED-pending-web-check.

## What it is

NONLIN is the original **hierarchical task network (HTN)**, **partial-order** planner. It introduced
two ideas that every later planner inherited:

1. **Least commitment / non-linearity** — "non-linear" here means *not totally ordered*: steps are
   ordered only when a dependency requires it (the principle [`PARTIAL_ORDER_PLANNING.md`](PARTIAL_ORDER_PLANNING.md)
   formalises).
2. **Hierarchical task decomposition** — a high-level task is expanded into a network of subtasks via
   **methods**, and each subtask decomposes further, so the planner reasons at multiple levels of
   abstraction instead of searching raw primitive actions from the start.

It also gave the field **goal structure** (tracking which action achieves which goal) and explicit
**causal links + threat detection** — the machinery for noticing that a newly added action would undo
a condition another action depends on.

The lineage from NONLIN: **O-Plan** (Currie & Tate, 1983–99) added an open architecture, rich
constraint management, and *execution*; **SHOP2** (Nau et al., 2003) is the practical, ordered HTN
planner most worth reading as an implementation model; **I-X / I-Plan** carried it into
mixed-initiative multi-agent planning.

## Why it matters to tmct

HTN is the shape that best fits a **capability that is really a recipe**:

1. **A capability decomposes into sub-calls.** "rename the http module and fix its importers" is not
   one primitive — it is a *method* that expands into `find_importers → for each: edit_import →
   verify`. That is precisely rung **B1** (the bounded recipe) on the agentic ladder, and HTN is the
   canonical, deterministic way to represent and expand it.
2. **Declared decomposition, not invented planning.** HTN does not search for a plan from first
   principles; it applies **author-declared methods**. That is exactly tmct's stance — the
   intelligence is pre-declared, the engine composes it — and it is why HTN is far more tractable (and
   auditable) than open-world first-principles planning. It buys closed-world C1 without the
   open-world cost.
3. **Multiple levels of abstraction** map onto a capability registry that mixes primitive tools
   (`edit_file`) with composite capabilities (`refactor_module`) that expand into them.

## Links

- Project page: https://www.aiai.ed.ac.uk/project/nonlin/
- Early planners: https://www.aiai.ed.ac.uk/project/early-planners/
- SHOP2 (JAIR 2003): https://www.jair.org/index.php/jair/article/view/10362
