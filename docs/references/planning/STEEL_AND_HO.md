# Steel & Ho — planning *and execution* under uncertainty (Essex, 1993)

**Canonical source:** Steel, S. & Ho, L.C. (1993), *Planning and Execution using Partial Decision
Trees*, University of Essex, Computer Science Memorandum CSM-184. Essex repository (scanned report):
https://repository.essex.ac.uk/8658/
**Related:** Steel, S. & Alami, R. (eds.) (1997), *Recent Advances in AI Planning (ECP'97)*, LNCS
1348, Springer, https://link.springer.com/book/10.1007/3-540-63912-8
**Licence:** link-only — the report exists only as a **scanned image PDF** (text not extractable) and
is not redistributable here; retrieve it from the Essex repository. · **Consumer:**
`PLAN_CAPABILITY_ROUTER.md` (the loop's act-vs-plan decision; the per-run budget). · **Status:**
UNVERIFIED-pending-web-check.

## What it is

Most classical planners answer "what sequence of actions achieves the goal?" and assume you plan
fully, then execute. Steel & Ho ask the harder, more realistic question: **given uncertainty about
outcomes and the fact that planning itself costs time, should we plan more or act now?** Their plan
representation is simultaneously a **conditional plan tree** (branches = possible action outcomes,
each with its own continuation) and a **decision tree** (branches = choices, with utilities at the
leaves) — so the system can *interleave* planning and execution: plan until the decision tree says
acting beats planning, act, observe the real outcome, then plan again from the new state.

Two ideas carry the weight:
- **Planning has a cost.** At some point an imperfect plan executed now beats a better plan computed
  later. That trade-off is a formal, decision-theoretic calculation, not a heuristic.
- **Monitoring + re-plan.** Actions have *expected* outcomes; when the observed outcome differs, the
  system re-plans from what it actually saw rather than pressing on with false assumptions.

## Why it matters to tmct

This is the reference most directly about **running a tool loop**, not just producing a plan:

1. **"Act now or plan more" is every turn of the loop.** A tmct-backed loop, at each step, must decide:
   emit the tool call it already has, or resolve further first. Steel & Ho give the principled frame
   for that decision instead of an ad-hoc "always plan to completion".
2. **Partial plans are normal.** The loop should not need a complete plan before acting — open
   conditions (gaps) are expected and explicit. This matches the router's honest posture: act on what
   is proven, surface what is not.
3. **Monitoring = read the `tool_result`.** After a tool runs, compare the observed result to the
   expected effect; if they diverge, re-plan from the observed state. That is rung **B2**
   (conditional / retry) on the agentic ladder, expressed as decision-theoretic monitoring.
4. **Cost-of-planning = the budget.** tmct already reasons about a per-run budget; Steel & Ho's
   cost-of-planning term is the theory under it — at some point further resolution isn't worth the
   spend, so land what you have.

Because the report is a scanned document, treat the summary above as a faithful secondary account and
retrieve CSM-184 from the Essex repository for the primary text.

## Links

- Essex repository (CSM-184): https://repository.essex.ac.uk/8658/
- ECP'97 proceedings: https://link.springer.com/book/10.1007/3-540-63912-8
