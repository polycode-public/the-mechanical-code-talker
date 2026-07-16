# BENCHMARK_AGENT_1.7.0 — unchanged since 1.5.7; a clean re-confirmation, not a null finding

**Headline:** AGENTBENCH re-run against the current **1.7.0** codebase (per `package.json`), following
`SKILL_BENCHMARK_AGENT.md`'s cycle. Since `1.5.7` (the last measured version), this session's work
touched `src/ask.mjs`, `src/chat.mjs`, `src/codegraph.mjs`, `src/memory/core.mjs`, and
`src/sessions.mjs` — PLAN_VIZ.md's traversal/timestamp groundwork and PLAN_CONVERSATION.md's Findings
3/5 — nothing in `src/router/` or `agentbench/`. `git log --oneline --all -- src/router/ agentbench/`
shows the newest touch to either path is still `e293295`, the same report-renaming docs commit
`BENCHMARK_AGENT_1.5.7.md` already accounted for. The numbers below are, rung-for-rung, identical to
`BENCHMARK_AGENT_1.5.7.md`'s own table — the honest, correct result of re-measuring an unchanged
router against an unchanged case set, not a stale copy.

**Bench-import direction check** (contract requirement, §1): `grep -r "agentbench" src/` returns only
comments in `src/router/set-algebra.mjs` and `src/router/call-validator.mjs` describing the *existing*
one-way dependency (bench imports downward from `src/router/`) — no reversal.

## The metric pair, per rung — goal driver (Stage 5), 56 cases

`node agentbench/run.mjs --driver goal --ladder --stamp 1.7.0` (raw:
`agentbench/results/raw/run-1.7.0/product.jsonl`, drivers `resolver-0.8.0` + `goal-0.8.1`)

| rung | n | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | ---- |
| A0 | 7 | **100%** | **100%** | **0%** | PASS |
| A1 | 12 | **100%** | **100%** | **0%** | PASS |
| A2 | 4 | **100%** | **100%** | **0%** | PASS |
| B1 | 6 | **100%** | **100%** | **0%** | PASS |
| B2 | 7 | **100%** | **100%** | **0%** | PASS |
| C1 | 9 | **100%** | **100%** | **0%** | PASS |
| C2 | 11 | **100%** | **91%** | **0%** | PASS |
| **all** | **56** | **100%** | **98%** | **0%** | **PASS** |

Ladder: A0 → A1 → A2 → B1 → B2 → C1 → C2 — **all rungs pass the gate**. The single plan-correct/
result-incomplete row is unchanged: `ab-c2-what-to-test` (plan is right, no composed result folds to
an answer yet — the same honest composing gap 1.5.7 and 1.4.1 both named).

## The metric pair, per rung — resolver-floor driver (Stage 1), 56 cases

`node agentbench/run.mjs --driver resolver --ladder --stamp 1.7.0r` (raw:
`agentbench/results/raw/run-1.7.0r/product.jsonl`, driver `resolver-0.8.0` only — no planner/goal
reasoner)

| rung | n | plan-compl | result-compl | halluc | gate |
| ---- | --: | --: | --: | --: | ---- |
| A0 | 7 | **100%** | **100%** | **0%** | PASS |
| A1 | 12 | **100%** | **100%** | **0%** | PASS |
| A2 | 4 | **100%** | **100%** | **0%** | PASS |
| B1 | 6 | **100%** | **100%** | **0%** | PASS |
| B2 | 7 | **100%** | **100%** | **0%** | PASS |
| C1 | 9 | **100%** | **100%** | **0%** | PASS |
| C2 | 11 | 36% | 27% | 0% | ---- |
| **all** | **56** | **88%** | **86%** | **0%** | gated at C2 |

The resolver-only floor gates at C2 (36% < the 50% completion floor) exactly as it did in every prior
cycle — the goal-reasoner (Stage 5) is what closes C2's multi-step composed-proof cases (impact
chains, cochange-gated risk checks). 0% hallucination holds at every rung on both drivers.

## Decision

**Ship as-is.** This cycle's real work (PLAN_VIZ.md, PLAN_CONVERSATION.md) is orthogonal to the
router/planner axis AGENTBENCH measures — a clean re-confirmation at an unchanged ladder depth is the
correct, expected outcome, not a null result. No router/planner capability was targeted this cycle;
the next AGENTBENCH-focused session should read `ROADMAP.md`'s agent-axis items before picking a rung
to push past `ab-c2-what-to-test`'s composing gap.
