# AGENTBENCH_0.8.1_001 — Stage 5, the closed-world C2 goal-reasoner, measured

**Headline (lead with the honest delta):** AGENTBENCH now runs a **Stage-5 goal-reasoner**
on top of the C1 router, and **C2 moves off the floor**. On the same 39-case ladder, swapping
the C1-only resolver driver for the **goal driver** (`--driver goal`) lifts **C2 plan-completion
33% → 100%** and **C2 result-completion 17% → 83%**, turning C2 from a **gated** rung into a
**PASSING** one — at the non-negotiable **0% hallucination on every rung**. The goal-reasoner
does this by genuine **goal-DEDUCTION over a declared goal model**, not by memorising the
request: there is **no request-string / "safe" literal in `src/`**, the composed answer (not the
call-sequence) is graded, and **held-out phrasings** decompose via the **same** goal-rule, graded
blind. Two runs over the same tree + `--stamp 0.8.1_001` are byte-identical.

> ## What 0.8.1 left open — and this run closes (honestly)
> AGENTBENCH_0.8.1 measured C2 at **50% plan / 0% result**: `ab-c2-safe-to-change` **refused**
> (no goal model to deduce from) and `ab-c2-what-to-test` was **plan-relaxed, result-incomplete**
> (ranking is a goal-reasoner, unbuilt). Stage 5 builds the goal-reasoner as the RFC's **canned
> meta-loop** — *deduce current goals → plan-each (C1) → threat-aware, PERSISTENT first-step
> arbitration → execute one → observe → repeat* — **hard-bounded** so it always terminates, and
> **honest at the open-world seam** (it REFUSES an uncovered goal rather than inventing one). The
> genuine C2 miss `ab-c2-safe-to-change` now **clears on the composed answer**; the one case that
> stays red (`ab-c2-what-to-test`) is **kept red on purpose** (see "the boundary held", below).

## The metric pair, per rung — Stage 5 active (`--driver goal`)

`node agentbench/run.mjs --driver goal --ladder --stamp 0.8.1_001`

| rung | n | **plan-compl** | **result-compl** | **halluc** | gate | reading |
| ---- | --: | --: | --: | --: | ---- | --- |
| **A0** | 7 | **100%** | **100%** | **0%** | PASS | C1 pass-through (the goal-reasoner adds nothing it already grounds) |
| **A1** | 9 | **100%** | **100%** | **0%** | PASS | C1 pass-through |
| **A2** | 3 | **100%** | **100%** | **0%** | PASS | honest refuse — the goal-reasoner ALSO refuses (no declared tool / non-Module focus) |
| **B1** | 6 | **100%** | **100%** | **0%** | PASS | C1 sequences |
| **B2** | 4 | **100%** | **100%** | **0%** | PASS | C1 conditional folds |
| **C1** | 4 | **100%** | **75%** | **0%** | PASS | 3 intersections compose; 1 reachability filter stays honestly red |
| **C2** | 6 | **100%** | **83%** | **0%** | **PASS** | **5/6 goal-deduced + composed; 1 kept honestly red** |
| **all** | 39 | **100%** | **95%** | **0%** | **PASS** | 0% hallucination everywhere; result trails plan only on the two honest gaps |

**Ladder:** `A0 → A1 → A2 → B1 → B2 → C1 → C2 — all rungs pass the gate`.

## The delta Stage 5 buys — C1-only vs goal driver, SAME 39 cases

| driver | C2 plan | C2 result | C2 gate | overall plan | overall result |
| ---- | --: | --: | ---- | --: | --: |
| `resolver` (C1 only) | 33% | 17% | **gated** (<50% plan) | 90% | 85% |
| `goal` (Stage 5) | **100%** | **83%** | **PASS** | **100%** | **95%** |
| **Δ** | **+67pp** | **+66pp** | gated → PASS | +10pp | +10pp |

(The C1-only C2 result is **17%**, not 0%, only because the expanded C2 set now includes an
honest-refuse case the resolver passes; on the original two C2 cases it was **0%**. Either way the
goal-reasoner is what climbs C2.)

**Row provenance:** of 39 rows, **31** are `driver:"resolver-0.8.0"` (C1 grounded them) and **8**
are `driver:"goal-0.8.1"` — the 5 C2 goal cases the C1 layer refused (4 composed answers + 1 honest
escalation) plus 3 A2 cases the goal-reasoner *also* correctly refuses. The goal driver is
**C1-first**: it only escalates a C1 **refusal**, so it never overrides an answer C1 already grounds.

## What the goal-reasoner deduces + composes (the genuine C2)

The single declared goal-rule is a **maintenance invariant** (`GOAL_RULES`, frozen data mirroring
the STRIPS registry): *a Module whose change reaches other modules (non-empty impact closure) MUST
have direct test coverage; an untested, impactful module VIOLATES it*, with **declared priority =
blast radius `|impact(m)|`**. Evaluating it is a deduction over the graph — never a keyword read of
the request. The only thing read off the request is a **FOCUS entity** (the resolver's
`extractEntity` + the binding oracle — entity resolution, not intent keywords):

- **Scoped (a bound Module focus).** `is app/lib/a.mjs safe to change` — the resolver **refuses**
  (no relative-filter syntax to decompose). The goal-reasoner backward-chains the goal-rule, plans
  `impact(a)` + the `untested` scan, and composes the change's **untested footprint**
  `untested ∩ ({a} ∪ impact(a)) =` **{a, c, e, f, g}** — a real composed set (∅ would mean "no gap").
  **Held-out, graded blind, via the SAME rule:** `how risky is it to touch app/lib/f.mjs` → **{e, f}**;
  `should I be worried about changing app/lib/c.mjs` → **{c}** (c's one dependent is tested, so it
  drops out — a singleton, computed not memorised).
- **Global keystone (no bound focus).** `which module is the biggest testing risk` — the
  goal-reasoner enumerates `untested`, **EXPANDS** (GDA monitor → replan) to `impact` of each
  violating module, and **arbitrates the KEYSTONE** by declared priority: `argmax |impact|` =
  **app/lib/a.mjs** (weight 6). This is the first-step arbitration the design note calls the core
  deliverable, exercised on real data.
- **The open-world seam — REFUSE, don't invent.** `is Widget.render safe to change` binds a
  **Method**; the coverage-invariant is Module-scoped, so **no declared rule covers it** → the
  goal-reasoner **escalates** (honest refuse), the C2 analogue of the resolver's "never emit a call
  it cannot prove". The `why` cites the rule by backward-chain, so the refusal is glass-box.

## The boundary held — what stays honestly red (and why that is the point)

- **`ab-c2-what-to-test`** ("what most needs a test") — **plan-correct, result-INCOMPLETE**, kept red.
  The **resolver already answers it** (the `untested` frame grounds a single relaxed call), so the
  goal driver — C1-first — does not escalate it. Ranking a request the C1 layer *answers* would
  require intercepting it on a **request keyword** ("most") — exactly the memorisation the anti-overfit
  discipline forbids. So the boundary is left honest rather than faked green. (The **global keystone**
  case proves the ranking machinery genuinely works when the request reaches the goal-reasoner.)
- **`ab-c1-widget-methods-calling`** — the C1 reachability filter, unchanged from 0.8.1.

A hardcoded/regex C2 pass would be worse than these two honest reds; the goal-reasoner earns its
green by deduction or refuses.

## Discipline — the non-negotiables, checked

- **No overfit.** No request-string / "safe"/"risk"/"change" literal appears in `src/` (grep-clean);
  routing is a **deduction over `GOAL_RULES` + a bound focus's class**, not the request text. The
  composed **answer** is graded against a **static `expect.result` literal**, fixture-lint-checked at
  parse (a stale literal fails loudly), and **held-out phrasings** hit the same rule with **no
  per-request code path**.
- **Mechanical termination (not a convergence argument).** The meta-loop carries a hard
  **`MAX_TICKS`** outer budget (mirrors the planner's `MAX_STEPS`) **AND** a **monotone-progress
  invariant** — every tick achieves exactly one intention (removes it); the only growth is a
  **single, bounded** GDA expansion (impact-of-each over the finite `untested` set), one-shot-gated —
  so the pending set strictly shrinks to ∅ in ≤ (initial + |untested|) ticks. A non-progress tick
  HALTS. Two independent bounds; proven, not argued.
- **Threat-awareness, derived not assumed.** Meta-level POP threats are computed from the registry's
  **delete-lists** (`threatsAmong`); every capability is read-only (empty delete-list), so threats are
  **provably []** — the guarantee holds the day a mutating capability is ever registered.
- **Bounded inside the guard.** The whole meta-loop (deduce → plan → execute → compose) runs inside
  `driver()` — i.e. inside `runCase`'s `Promise.race([driver, timeout])` — so the 0.8.0 backstop still
  covers it: a runaway loop records a non-terminating loopResult (auto-FAIL on `terminates:true`),
  never hangs the suite.
- **No circularity in grading.** `grade.mjs` imports **no** composition/goal function; it only
  value-compares the driver's produced `composed` to the static literal. `grade.mjs` is unchanged
  (it is imported by the product resolver — kept additive).
- **Determinism.** `--stamp 0.8.1_001`, re-run byte-identical (checked); `version` reads
  `package.json` = **0.8.1**.
- `npm test` green (**892** tests, +23 for the goal-reasoner unit + e2e); CLI smoke
  `printf 'hi\n/exit\n' | node bin/tmct.mjs` exits 0.

## Decision

**Stage 5 accepted; closed-world C2 is genuinely reached and measured.** The goal-reasoner deduces
the active goals from a declared goal model, plans-each over C1, arbitrates the keystone under a
hard-bounded, threat-aware, persistent meta-loop, and **composes true answers where the model
covers the state** (safe-to-change + held-out phrasings + the global keystone) — **honestly refusing
at the open-world goal-generation seam** (a non-Module focus, an undeclared sub-goal tool) and
**leaving the one request the C1 layer already answers honestly red** rather than memorising it. The
router's demonstrated deterministic-floor envelope is now **A0–B2 end-to-end, the determinable C1
folds, AND the closed-world C2 goal-deductions** — at **0% hallucination on every rung**. The frontier
named honestly: **open-world goal *generation*** (novel states implying undeclared goals) — the seam
where an LLM earns its cost.

Artifacts: raw product rows in `agentbench/results/raw/run-0.8.1_001/product.jsonl` (39 graded rows,
drivers `resolver-0.8.0` + `goal-0.8.1`, `stamp:"0.8.1_001"`, each with `produced.composed` +
`verdict.resultCompleted`) and the console rollup `console.txt`; goal-reasoner
`src/router/goal-reasoner.mjs`, driver `agentbench/driver-goal.mjs` (registered as `--driver goal`),
cases `agentbench/cases.jsonl` (the C2 goal cases), tests `test/goal-reasoner.test.mjs`.
