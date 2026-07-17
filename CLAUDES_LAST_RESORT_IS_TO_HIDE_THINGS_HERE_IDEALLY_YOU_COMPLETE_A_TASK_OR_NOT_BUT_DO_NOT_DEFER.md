# Complete a task or don't — there is no in-between, and nothing is deferred

Planned work has two states: **DONE** or **OPEN**. There is no "mostly done", "in progress but
basically there", "done except", or "deferred". A task is complete or it is not.

- Work we decide not to do is **deleted from scope** — never negated in place ("not doing X", "X is
  out of scope", "won't ship") and never held as "deferred / postponed / set aside / a later cycle".
- When a chunk is delivered but a real remainder exists, the item stays **OPEN** and the
  delivered-vs-remaining split is recorded **here** — so a partial delivery is never dressed up as
  complete in a plan doc.
- Prefer deleting a sentence to negating it.

This file is the last resort: if the honest move is to record a remainder rather than hide it under
a green "DONE", it goes here. An empty file is the goal.

---

## Phase 8 / Phase 9 — public-surface capability claims + plain-prose pass — OPEN

Not done. Two questions are unresolved, and until they are the claims on the public README are not
verified — there is no partial credit, only OPEN.

1. **A caveat conflict that could put a false statement on the public README.** The table's
   multi-hop-entailment caveat follows `BENCHMARK_INFERENCE_2.0.3.md` — "50 of 219 graded against a
   floor; INF-C2 measures no consistency checking." `PLAN_OPEN_ITEMS.md` §4.4's correction table says
   **"30, not 50"** and **"C2's checker WORKS."** One is wrong. Establish which is current at HEAD and
   correct the stale one.
2. **The CONVERSATION axis is absent from the table** because its 2.0.3 measurement pre-dates the
   Phase-1 dropped-input fixes. Include it with a current caveat, re-measure it, or drop it from the
   claim set.

On disk toward this (commit `2cd570e` — a fact, not a status): a capability table in README's
"Measuring it", a home-page capability line, a plain-prose pass on both surfaces; README harness and
page tests green. None of it closes the two questions, so the phase is OPEN.
