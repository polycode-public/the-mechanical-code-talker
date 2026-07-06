# AGENTBENCH_0.8.1_002 — Stage 2, widened imperative reach + tmct_calls made reachable

**Headline (the honest delta):** Stage 2 widens the router's NL→capability front-end, and the
**last routing gap closes**. The `tmct_calls` capability — the raw call-edge dump that shipped
tagged **`NOT_NL_REACHABLE`** ("no command verb; distinguishing it needs a Stage-2 intent frame we
have not authored") — is now reached by a **dedicated imperative frame** keyed on the explicit
edge-dump phrasings the relational grammar never emits ("the call edges of X", "call graph of X",
"outgoing calls from X"). `NOT_NL_REACHABLE` is now **`{}`** — every declared capability is
NL/command/frame-reachable, and the bidirectional conformance test proves it (an over-claimed tag
would now FAIL, because `tmct_calls` genuinely resolves). On the ladder — now **43 cases** (the 39 of
_001 + **4 Stage-2 cases**) — the goal driver holds **100% plan / 95% result / 0% hallucination on
every rung**, unchanged in rate while the **A1 reach grows 9→12** and **A2 grows 3→4**. Two runs over
the same tree + `--stamp 0.8.1_002` are byte-identical.

> ## What _001 left open — and this run closes
> _001 measured the closed-world C2 goal-reasoner but left the router's FRONT-END at its 0.8.0
> width: one declared capability (`tmct_calls`) was honestly tagged unreachable, and bare
> imperatives outside the curated frames ("explain X") still refused. Stage 2 is the front-end
> widening the RFC names — *request → intent for a **controlled fragment*** — done additively: new
> resolver FRAMES (a tmct_calls edge-dump frame + imperative synonyms), a resolveOne fall-through
> that rescues an NL parse which picked an OUT-OF-SET capability by re-selecting a DECLARED one, and
> the ACE controlled-grammar wired into the interpretation pipeline as an additive strategy. The
> **sharp boundary is kept**: an undeclared verb ("refactor") with no bindable query intent still
> REFUSES — the refuse-across-the-line contract that makes the widened reach honest.

## The metric pair, per rung — Stage 5 active (`--driver goal`), 43 cases

`node agentbench/run.mjs --driver goal --ladder --stamp 0.8.1_002`

| rung | n | **plan-compl** | **result-compl** | **halluc** | gate | reading |
| ---- | --: | --: | --: | --: | ---- | --- |
| **A0** | 7 | **100%** | **100%** | **0%** | PASS | C1 pass-through |
| **A1** | **12** | **100%** | **100%** | **0%** | PASS | +3 Stage-2 cases: tmct_calls ×2, imperative `explain` — all bind + ground |
| **A2** | **4** | **100%** | **100%** | **0%** | PASS | +1 Stage-2 case: an undeclared verb REFUSES (the boundary held) |
| **B1** | 6 | **100%** | **100%** | **0%** | PASS | C1 sequences |
| **B2** | 4 | **100%** | **100%** | **0%** | PASS | C1 conditional folds |
| **C1** | 4 | **100%** | **75%** | **0%** | PASS | 3 intersections compose; 1 reachability filter stays honestly red |
| **C2** | 6 | **100%** | **83%** | **0%** | **PASS** | 5/6 goal-deduced + composed; 1 kept honestly red |
| **all** | **43** | **100%** | **95%** | **0%** | **PASS** | 0% hallucination everywhere; result trails plan only on the two honest gaps |

**Ladder:** `A0 → A1 → A2 → B1 → B2 → C1 → C2 — all rungs pass the gate`.

## vs _001 — the reach delta the 4 Stage-2 cases measure

| | _001 (39 cases) | _002 (43 cases) | delta |
| ---- | --: | --: | --- |
| A1 cases | 9 | **12** | +3 (widened reach) |
| A2 cases | 3 | **4** | +1 (the boundary) |
| overall plan-compl | 100% | **100%** | held |
| overall result-compl | 95% | **95%** | held |
| hallucination (every rung) | 0% | **0%** | held |
| capabilities tagged NOT_NL_REACHABLE | 1 (`tmct_calls`) | **0** | **gap closed** |

The 4 new cases (all `driver:"resolver-0.8.0"` except the refuse, which the goal driver also refuses):

| case | rung | what it proves | produced |
| ---- | ---- | --- | --- |
| `ab-a1-calls-render` | A1 | `tmct_calls` reachable via the explicit edge-dump frame, NOT colliding with in-set `tmct_callees` | `tmct_calls{symbol:"Widget.render"}` |
| `ab-a1-calls-outgoing-fnalpha` | A1 | held-out phrasing; keyword-spot mis-reads it toward an out-of-set relational shape, the frame RESCUES to the declared `tmct_calls` | `tmct_calls{symbol:"fnAlpha"}` |
| `ab-a1-explain-widget` | A1 | a bare imperative both the grammar and command register MISS now binds via the description frame | `tmct_describe{symbol:"Widget"}` |
| `ab-a2-refuse-undeclared-verb` | A2 | the sharp boundary: an UNDECLARED verb ("refactor") refuses, never a guessed call | `refuse` (0 calls) |

## The C1-only floor the goal driver climbs (same 43 cases, `--driver resolver`)

| driver | C2 plan | C2 result | C2 gate | overall plan | overall result |
| ---- | --: | --: | ---- | --: | --: |
| `resolver` (C1 only) | 33% | 17% | **gated** (<50% plan) | 91% | 86% |
| `goal` (Stage 5) | **100%** | **83%** | **PASS** | **100%** | **95%** |

(The Stage-2 reach cases are grounded by the C1 resolver in BOTH drivers — the widening lives in the
resolver's front-end, below the goal-reasoner. C2 still needs Stage 5, exactly as _001.)

## How tmct_calls is genuinely reached (not a keyword hack)

The old tag named a REAL collision: the relational "call" verb ("what does X call") routes
`tmct_callees`, and there is no `calls` command verb. Stage 2 does **not** touch that verb. It opens a
**second, distinct surface** — a frame keyed on the explicit edge-dump NOUNS (`call edges`,
`call graph`, `outgoing calls of X`) the relational grammar never produces — that backward-chains the
`calls` topic to `tmct_calls`. The two surfaces are provably disjoint:

- `show the call edges of Widget.render` → **tmct_calls** (edge-dump frame)
- `what does Widget.render call` → **tmct_callees** (relational verb, unchanged)
- `which functions call fnAlpha` → **tmct_callers** (relational verb, unchanged)

The `ab-a1-calls-render` case declares BOTH `tmct_calls` and `tmct_callees` in-set, so the routing is
graded against the collision, not around it. The held-out `outgoing calls of X` phrasing additionally
exercises the **resolveOne fall-through**: keyword-spot reads it as an `ask` shape (→ NL refuse), and
rather than stop, the resolver falls through to the imperative frame, which reaches the DECLARED
`tmct_calls` — a widening that can only turn a refuse into a grounded, DECLARED, non-hallucinated call
(the declared-set + zero-hallucination gates still fire before emit).

## ACE reach — additive, and byte-neutral on the CHATBENCH spine

The ACE-OWL controlled-fragment grammar (`src/grammar/ace.mjs`, imported UNCHANGED) is now wired into
the interpretation pipeline as an additive strategy (`src/interpret/strategies/ace.mjs`, its own class
`ace-fact`). It emits a candidate ONLY on a **clean** ACE parse (declarative fragment with triples); a
structural-fit-with-residue or a miss contributes nothing — fitting the grammar is a strong signal,
missing it falls through to the tolerant strategies (never a new wall). It is registered **async on
purpose**: `runStrategiesSync` (the `parseQuery` / CHATBENCH-facing path) skips Promise-returning
strategies, so the sync chat spine is **provably** untouched while `interpret()` gains the reach.
`src/ask.mjs` is not edited; the viewer-bundle boundary degrades the (Node-flavored) ACE import the
same `typeof`-guarded way as the wink adapter.

## CHATBENCH — no tier-1 regression (proven two ways)

- **Byte-identity with vs without ACE.** The chatbench product replay run **with** the ACE strategy
  registered vs **with it removed** is IDENTICAL on all **333 spine rows** once the two run-varying
  fields are normalized (`timingMs`, informational + excluded by the harness; and the time-based
  `uuidv7` session id, non-deterministic regardless of this change). Tier-1 pass is **333/333 in
  both**. The ACE wiring changes no parse and no verdict.
- **`--compare` vs the committed baseline.** `node chatbench/run.mjs --stamp s2cmp --compare
  chatbench/results/raw/run-cycle-006/product-a.jsonl` → **tier-1 pass 333/333 (draw A) + 285/285
  (draw B), ZERO regressions**, exit 0. (The prescribed `run-0.7.1` baseline is not present in this
  worktree; `run-cycle-006` is the latest committed product baseline and is used in its place.)

## Discipline — the non-negotiables, checked

- **Zero hallucination on every rung** (43/43 rows, both drivers) — the automatic-fail line, held.
- **The boundary is sharp.** Declared verb + resolveObject-bindable slot = in-scope (routed + bound +
  grounded); undeclared verb ("refactor") = REFUSE. No case guesses a capability or an argument.
- **No overfit.** The tmct_calls reach is a phrasing FRAME + backward-chain over the registry, not a
  request-string literal; the held-out `outgoing calls` phrasing hits the same frame with no
  per-request path; `expect.result` is not used by the reach cases (single grounded calls / a refuse
  are their own answer), so nothing is memorised.
- **Additive to the product path.** `agentbench/grade.mjs`, `src/chat.mjs`, `src/ask.mjs`,
  `agentbench/driver-resolver.mjs` (its result-composition), and `src/router/goal-reasoner.mjs` are
  UNCHANGED; the widening lives in `src/router/resolver.mjs` (FRAMES + resolveOne) and the new
  additive `src/interpret/strategies/ace.mjs` (+ its pipeline registration).
- **Determinism.** `--stamp 0.8.1_002`, re-run byte-identical (checked); `version` reads
  `package.json` = **0.8.1**.
- `npm test` green (**910** tests, incl. the frozen showcase + chatflow-* suites and +9 new
  Stage-2/ACE unit tests); CLI smoke `printf 'hi\n/exit\n' | node bin/tmct.mjs` exits 0.

## Decision

**Stage 2 accepted; the router's NL front-end is widened and the last routing gap is closed.** Every
declared capability is now NL/command/frame-reachable (`NOT_NL_REACHABLE` = `{}`), the widened reach
grounds imperative requests to bound tool calls at **0% hallucination**, and the controlled-fragment
boundary is refused across honestly. The ACE grammar is available to the interpretation pipeline
without disturbing the 333-row CHATBENCH spine. The frontier named honestly, unchanged from _001:
**open-world imperative NL** (arbitrary "sort out the flaky tests" — no declared verb, no bindable
slot) and **cross-turn anaphora slot-filling** — the seams a Stage-2 controlled fragment deliberately
does not cross.

Artifacts: raw product rows in `agentbench/results/raw/run-0.8.1_002/product.jsonl` (43 graded rows,
drivers `resolver-0.8.0` + `goal-0.8.1`, `stamp:"0.8.1_002"`) and the console rollup `console.txt`;
resolver `src/router/resolver.mjs` (Stage-2 FRAMES + emptied `NOT_NL_REACHABLE` + resolveOne
fall-through), ACE strategy `src/interpret/strategies/ace.mjs` + registration in
`src/interpret/pipeline.mjs`, cases `agentbench/cases.jsonl` (the 4 Stage-2 cases), tests
`test/router-resolver.test.mjs` (Stage-2 routing) + `test/interpret-ace-strategy.test.mjs`.
