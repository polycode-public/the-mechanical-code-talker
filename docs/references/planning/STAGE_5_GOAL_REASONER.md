# Stage 5 — the closed-world C2 goal-reasoner (autonomy as a fixed meta-loop)

**Consumer:** `PLAN_CAPABILITY_ROUTER.md` (Stage 5, "The goal-reasoner — the C2 speculation"; the
C2-reduction section, lines ~176–217). · **References:**
[`BDI_GOAL_DRIVEN_AUTONOMY.md`](BDI_GOAL_DRIVEN_AUTONOMY.md) (Rao & Georgeff BDI; Aha/Molineaux/Cox
GDA; continual planning), [`STEEL_AND_HO.md`](STEEL_AND_HO.md) (monitor + decision-theoretic
act-vs-plan), [`PARTIAL_ORDER_PLANNING.md`](PARTIAL_ORDER_PLANNING.md) (threats, lifted to the
meta-level), [`NONLIN.md`](NONLIN.md) / [`STRIPS_PDDL.md`](STRIPS_PDDL.md) (the C1 planner Stage 5
sits on). · **tmct seams:** `src/syllogise.mjs` (forward-chaining / long-chain deduction), the OWL
graph memory. · **Status:** design note — **gated on Stage 3 (C1) being genuinely reached and
measured**; not a near-term build.

## The reduction (restated from the RFC)

The RFC's C2 claim: **"self-directed" is not magic — it is a canned meta-loop.**

```
loop forever:
  1. deduce current goals          ← long-chain deduction over the KB (the only new part)
  2. plan for each goal            ← C1  (Stage 3: POP / HTN over capabilities)
  3. arbitrate the first steps     ← threat-aware, PERSISTENT first-step choice
  4. execute one step
  5. observe (read tool_result)    ← Steel & Ho monitor
  6. repeat
```

The elegance is that it collapses "autonomy" into **C1 + a goal-deduction step + an action-selection
rule**. Everything except step 1 is solved machinery from the planning references. This note works
out the two parts the RFC flags as "needing care" (steps 1→3), names what is deterministically
reachable closed-world versus the open-world residual, and gives a scoping recommendation.

It has a name: it is essentially a **BDI agent** (Belief–Desire–Intention: Rao & Georgeff) crossed
with **Goal-Driven Autonomy** (Aha, Molineaux, Cox) and **continual/online planning** — see
[`BDI_GOAL_DRIVEN_AUTONOMY.md`](BDI_GOAL_DRIVEN_AUTONOMY.md).

## Step 1 — "what are the current goals?" (deterministic, closed world)

In a **closed** world this step is a **deduction**, not a judgement. Goals fall out of a **declared
goal model**:
- **Maintenance goals** — invariants to keep true ("the test suite passes", "no orphaned temp files").
  When the KB shows the invariant violated, the goal to restore it is *active*.
- **Triggers** — declared condition → goal rules ("a failing build ⇒ goal: green build").
- **Unmet desired-states** — a declared target state not yet entailed by the KB.

Evaluating which goals are active is **long-chain deduction over the KB** — a Datalog / Prolog
(tau-prolog) / forward-chaining (RETE) engine, or an extension of tmct's **`src/syllogise.mjs`**.
`syllogise` today chains exactly one rule (rdfs:subClassOf transitivity) under three mechanical guards
(**budget**, **focus**, **screens** — tautology + dedup), writing entailments as low-trust,
retractable `entailed:*` facts. A goal-deduction engine is the same machinery with a richer rule set:
the guards (budget / focus / dedup) are exactly what keeps long-chain deduction bounded and offline,
and the retractable-provenance discipline is what lets a goal *lapse* cleanly when the KB moves. This
is the "long-chain deduction library" the RFC flags — and it already has a seam to grow from.

## Step 3, part A — first-step arbitration (needs care)

Each active goal yields a plan (step 2); collect the **first action** of each plan, dedupe, and pick
one. The RFC gives three admissible rules, all literature-covered:

- **(a) Keystone** — the first step **shared by the most goal-plans**. Doing it advances the widest
  front; it is the cheapest heuristic and needs no utilities.
- **(b) Decision-theoretic** — Steel & Ho **expected utility** over outcomes
  ([`STEEL_AND_HO.md`](STEEL_AND_HO.md)): pick the step whose expected value (including cost-of-acting
  vs. cost-of-planning-more) is highest.
- **(c) Declared goal priority** — an author-declared ordering breaks ties directly.

The arbitration is **not** free choice: it must be **threat-aware**. A first step that *clobbers
another live goal's plan* is a POP **threat** ([`PARTIAL_ORDER_PLANNING.md`](PARTIAL_ORDER_PLANNING.md))
lifted from within-a-plan to the **meta-level** — planning over the *conjunction* of active goals.
Don't pick a first step whose effect deletes a precondition another goal's plan depends on; resolve by
promotion/demotion (sequence the conflicting steps) or, if unresolvable, surface an honest "these
goals conflict as declared" — the meta-level cousin of tmct's "if you mean X …" surround. Recommended
default: **keystone, filtered by threat-awareness, tie-broken by declared priority**; add
decision-theoretic utilities only when outcomes are genuinely uncertain.

## Step 3, part B — intention PERSISTENCE (the part the raw loop misses)

The raw loop (deduce → plan → act → repeat) **thrashes**: if every goal and every first-step choice
is re-derived from scratch each tick, goals flicker and the choice oscillates — the agent is **busy,
not autonomous**. The fix is the **I in BDI**: an **intention is a commitment.** Once a first step /
goal is adopted, **persist with it** until one of the three BDI drop conditions fires:

1. it is **achieved** (the goal is now entailed by the KB),
2. it becomes **impossible** (no plan reaches it from the observed state), or
3. its **goal lapses** (the declared trigger/maintenance condition no longer holds).

Concretely: carry the current intention across ticks; only **re-arbitrate** when a drop condition
fires or a monitored outcome diverges (Steel & Ho). This bounded reconsideration is what makes the
meta-loop *converge* rather than churn. It is the single piece the RFC's raw reduction omits and the
BDI literature supplies — and it is the real difference between "autonomous" and "on a treadmill".

## What is deterministically reachable vs. the open-world residual

Mirroring the C1 map exactly, one level up:

| Part of the meta-loop                        | Closed world                                   | Open world                                        |
| -------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| Deduce current goals (step 1)                | **Reachable** — deduction over a declared goal model | **Unsolved** — novel situations imply undeclared goals |
| Plan for each goal (step 2 = C1)             | **Reachable** — POP/HTN, sound & complete in the domain | Escalate (open-world C1 residual)                  |
| First-step arbitration (step 3a)             | **Reachable** — keystone / EU / priority, threat-aware | —                                                  |
| Intention persistence (step 3b)              | **Reachable** — BDI drop conditions            | —                                                  |
| Monitor + re-plan (step 5)                   | **Reachable** — Steel & Ho                     | Escalate on unmodelled effect                      |

So the honest claim mirrors C1: **closed-world C2 is reachable** by this reduction — deduce-goals →
plan-each → arbitrate → act → loop, all solved machinery except the goal-deduction rule set. The
residual is **open-world goal *generation***: novel situations implying goals **no rule declared**.

**Do not pretend that residual is solved.** It is the **frame / relevance problem** — deciding, in an
unbounded situation, *which* facts matter and *which* new goals a novel state ought to raise. This is
GDA's discrepancy-driven goal-generation (Molineaux/Klenk/Aha) and Cox's goal reasoning, and it is
exactly where open-ended judgement — an LLM — earns its cost. tmct stays deterministic on the
closed-world goal-rules and **escalates at the goal-generation seam**, the same boundary as C1.

## The shared shape

Both reductions make the same move: **(solved deterministic machinery) + (a residual concentrated at
one seam: novelty the declared model does not cover).** C1 = classical planning + open-world planning;
C2 = C1 + threat-aware, persistent goal-arbitration + open-world goal-generation. The value is not the
rung height but **precisely locating where the deterministic core hands off to an LLM** — the router's
real deliverable (RFC "shared shape" section).

## Recommendation — scoping a future Stage 5

- **Gate hard on Stage 3.** C2 is C1 + a goal step; there is nothing to arbitrate over until the C1
  planner is genuinely reached *and measured* on the agentic ladder (Phase C). Do not start Stage 5
  before Stage 3 is green.
- **Grow the deduction engine from `syllogise`, not a rewrite.** Add a small declared goal-model
  vocabulary (maintenance / trigger / desired-state individuals) and extend the rule set under the
  *same* budget/focus/screens guards and retractable `entailed:*` provenance. Keep it offline and
  hard-bounded — never on the chat hot path, exactly as `syllogise` is today.
- **Ship arbitration as keystone + threat-aware + declared-priority first**; defer decision-theoretic
  utilities until measured need.
- **Make intention persistence a first-class object** with the three explicit drop conditions — it is
  cheap to state and it is the difference between a demo and an agent.
- **Declare the escalation seam explicitly.** When no declared goal-rule covers the observed state,
  the loop must *refuse-or-escalate* the goal-generation, never invent a goal. That refusal is a
  feature (safety), and it is the C2 analogue of the router's non-negotiable "never emit a call it
  cannot prove."
- **Prototype against a tiny closed domain** (e.g. a maintenance goal "tests pass" over a 3-operator
  file-ops domain) before any engine work, to make the reduction concrete — the "worked example" the
  reference README's deepen-next already asks for.
