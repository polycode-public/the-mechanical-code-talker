# BDI and Goal-Driven Autonomy — the deduce-goals → plan → act meta-loop

**Canonical sources:** Rao, A.S. & Georgeff, M.P. (1995), *BDI Agents: From Theory to Practice*,
Proc. 1st International Conference on Multi-Agent Systems (ICMAS-95), San Francisco, pp. 312–319,
https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf · Molineaux, M., Klenk, M. & Aha, D.W. (2010),
*Goal-Driven Autonomy in a Navy Strategy Simulation*, Proc. 24th AAAI Conference on Artificial
Intelligence (AAAI-10), https://cdn.aaai.org/ojs/7576/7576-13-11106-1-2-20201228.pdf · Cox, M.T.
(2007), *Perpetual Self-Aware Cognitive Agents*, AI Magazine 28(1), pp. 32–45 (goal reasoning /
goal-generation) · Ghallab, M., Nau, D. & Traverso, P. (2016), *Automated Planning and Acting*,
Cambridge University Press (continual / online planning-and-acting).
**Licence:** link-only (publisher/author copyright). · **Consumer:** `PLAN_CAPABILITY_ROUTER.md`
(Stage 5, the closed-world C2 goal-reasoner) and [`STAGE_5_GOAL_REASONER.md`](STAGE_5_GOAL_REASONER.md).
· **Status:** BDI (ICMAS-95) and GDA (AAAI-10) citations **web-verified 2026-07-06** (canonical
PDFs above resolve); Cox (2007) and Ghallab/Nau/Traverso (2016) authored from established knowledge —
**UNVERIFIED-pending-web-check** (treat page numbers as good-faith).

## What it is

This note covers the three literatures that back the RFC's C2 speculation — its claim that
"self-directed" is not magic but a **canned meta-loop**: deduce current goals → plan for each (that
is C1) → arbitrate among the plans' first steps → execute one → observe → repeat.

**BDI (Belief–Desire–Intention).** Rao & Georgeff formalised the practical-reasoning agent as three
attitudes: **beliefs** (what the agent holds true — the KB / world model), **desires** (goal states
it would like to bring about), and **intentions** (the desires it has *committed to* pursuing). The
architecture's decisive contribution is the third attitude: an **intention is a commitment**, not a
recomputed preference. Once adopted, an intention **persists** — the agent does not re-deliberate
from scratch every cycle — until it is *achieved*, becomes *impossible*, or its motivating goal
*lapses* (the three drop conditions). This bounded reconsideration is exactly what separates an agent
that makes progress from one that thrashes; it is the part a naive "re-derive everything every tick"
loop omits.

**Goal-Driven Autonomy (GDA).** Molineaux, Klenk & Aha extend the classic plan-execute-monitor loop
with an explicit **goal-reasoning** layer: the agent forms **expectations** about what each action
should produce, **detects discrepancies** between expectation and observation, **explains** the
discrepancy, and from the explanation **generates or reprioritises goals** — then plans for the new
goal set. GDA is the reference architecture for the router's "what are the current goals?" step:
goals are not fixed at design time but derived from the running state. Cox's goal-reasoning line
frames the same faculty as an agent reasoning about *its own* goals — the open-ended
**goal-generation** capability that the RFC (correctly) marks as the residual that stays open in an
open world.

**Continual / online planning.** Ghallab, Nau & Traverso reframe planning as **planning *and
acting*** — a deliberation process interleaved with execution, not a batch computed once. This is the
substrate under both BDI and GDA: plan a little, act, observe, revise, and keep a persistent
commitment across cycles rather than replanning wholesale. It is the same interleaving Steel & Ho
formalise decision-theoretically ([`STEEL_AND_HO.md`](STEEL_AND_HO.md)), lifted to the goal level.

## The tmct-router mapping

| BDI / GDA concept                          | tmct's capability router                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Beliefs** (world model)                  | The OWL-labelled graph memory (`.tmct/`) + entailed closure (`syllogise`)           |
| **Desires** (candidate goals)              | A declared **goal model** — maintenance goals, triggers, unmet desired-states       |
| **"What are the current goals?"** (GDA)    | **Long-chain deduction** over the KB — Datalog/Prolog/RETE or an extended `syllogise` |
| **Plan for each goal**                     | Stage 3, the C1 planner (POP/HTN over capabilities — the three planning refs)        |
| **Intention** (the committed goal)         | The persisted first-step choice — carried across ticks, not re-derived              |
| **Intention persistence / drop conditions** | Keep the current intention until *achieved / impossible / goal-lapsed*; only then re-arbitrate |
| **First-step arbitration** among plans     | Keystone (most-shared step) / decision-theoretic (Steel & Ho) / declared priority — **threat-aware** (POP threats at the meta-level) |
| **Expectation → discrepancy → explain**    | Steel & Ho monitor: compare `tool_result` to modelled effect; divergence forces re-plan |
| **Goal *generation* (open world)**         | **Unsolved residual** — the escalation seam where an LLM earns its cost             |

## Why it matters to tmct

The RFC's C2 reduction is *this literature*, and naming it does two things. First, it shows the only
genuinely new part is the goal-deduction step — everything downstream (plan-each, arbitrate, monitor,
re-plan) is solved machinery already covered by the planning refs. Second, it supplies the one piece
the raw reduction misses: **intention persistence**. Without BDI's commitment, the deduce → plan →
act loop oscillates — goals flicker, the first-step choice churns, and the agent is *busy, not
autonomous*. The commitment (and its three drop conditions) is what makes the loop converge.

## Links

- BDI (ICMAS-95): https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf
- Goal-Driven Autonomy (AAAI-10): https://cdn.aaai.org/ojs/7576/7576-13-11106-1-2-20201228.pdf
- GDA overview / project: https://www.cse.lehigh.edu/~munoz/projects/GDA/
- Cox, *Perpetual Self-Aware Cognitive Agents*, AI Magazine 28(1), 2007 (goal reasoning).
- Ghallab, Nau & Traverso, *Automated Planning and Acting*, CUP 2016: https://projects.laas.fr/planning/
