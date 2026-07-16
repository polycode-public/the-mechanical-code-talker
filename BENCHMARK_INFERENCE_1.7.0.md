# BENCHMARK_INFERENCE_1.7.0 — first re-run since the full ladder closed; every band passes, both arms

**Headline:** first INFBENCH measurement since `1.3.1` (the last written-up cycle), against the
current **1.7.0** codebase. Stages 0-5 shipped in the sessions between `1.3.1` and now, closing the
full 6-band ladder with every rule chat-wired, but that closure was never measured by a written-up
INFBENCH cycle until this one. This session's own work (`src/ask.mjs`, `src/chat.mjs`,
`src/codegraph.mjs`, `src/memory/core.mjs`, `src/sessions.mjs` — PLAN_VIZ.md and PLAN_CONVERSATION.md
Findings 3/5) touches none of `src/syllogise.mjs` or `infbench/`, so this cycle is a first
confirmation of already-landed reasoning-engine work, not new work from this session.

`npm run infbench` (`generate-cases.mjs` then `run.mjs`) ran to completion in the foreground: 219
cases generated at the default seed `20260707`, 9 per-template counts (`a1Lookup` 30, `a2ChainLen2`
40, `b1Disjoint` 39, `b2ChainLenK` 30, `b2Svf1` 10, `b2Svf1Apply` 10, `c1Cardinality` 30,
`c1ScmSvfApply` 10, `c2Inconsistent` 20).

**The ladder no longer gates at INF-B1.** `1.3.1` (and `1.3.0`, `1.2.0`, `0.8.2` before it) gated at
INF-B1, 33% completion. This cycle: **both arms pass every band, 100% completion, 0% fabrication,
all the way to INF-C2.**

## The metric pair, per band — kernel arm (80 cases; the pure-prover subset)

`node infbench/run.mjs` (raw: `infbench/results/raw/run-1.7.0/product.jsonl`)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 10 | 10 | **100%** | 0% | PASS |
| INF-A2 | 20 | 20 | **100%** | 0% | PASS |
| INF-B2 | 10 | 10 | **100%** | 0% | PASS |
| INF-C1 | 40 | 40 | **100%** | 0% | PASS |
| **all** | **80** | **80** | **100%** | **0%** | **PASS** |

Ladder: INF-A1 → INF-A2 → INF-B2 → INF-C1 — all bands pass the gate.

## The metric pair, per band — chat arm (219 cases; the full `runTurn()` surface)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 30 | 30 | **100%** | 0% | PASS |
| INF-A2 | 40 | 40 | **100%** | 0% | PASS |
| INF-B1 | 39 | 39 | **100%** | 0% | PASS |
| INF-B2 | 50 | 50 | **100%** | 0% | PASS |
| INF-C1 | 40 | 40 | **100%** | 0% | PASS |
| INF-C2 | 20 | 20 | **100%** | 0% | PASS |
| **all** | **219** | **219** | **100%** | **0%** | **PASS** |

Ladder: INF-A1 → INF-A2 → INF-B1 → INF-B2 → INF-C1 → INF-C2 — **every band passes the gate**, on
both arms, at both bands INF-B1 gated on previously.

## Decision

**Ship as-is.** The ladder tops out clean at both arms' final bands — there is no higher rung to
climb until the case-set generator grows a 7th band or a deeper composition depth. This cycle is a
confirmation, not new build work: the reasoning-engine phases that closed INF-B1 (`cax-dw`
disjointness, `scm-svf` composition-of-restriction, the recursive/reachability rule) landed in prior
sessions. Nothing in this session's own
diff (VIZ/CONVERSATION work) touches the reasoning engine, so no band's movement is attributable to
today's changes — this is INFBENCH catching up to already-shipped state, not measuring it.
