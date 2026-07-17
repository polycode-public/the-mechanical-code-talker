# agentbench — the tmct AGENTIC measurement harness

The **sibling of chatbench**, on a new axis. chatbench measures the *chat turn*
(a request → the right grounded answer) on the CEFR ladder; AGENTBENCH measures
the **tool loop** (a request → the right *tool call(s)*) on the **TOOL-0→TOOL-8 tool-use
rungs**. Same versioned-naming + regression discipline (`BENCHMARK_AGENT_<version>.md`,
`_00N` for re-runs), one decisive difference:

> **A hallucinated tool call is an AUTOMATIC FAIL.** Emitting a call to a tool
> that is not in the declared set, or with arguments that cannot bind, fails the
> case outright — no matter how good the rest of the loop looks. This is the one
> thing a deterministic router must never do, so it is the gate the whole bench
> is built around.

**No LLM, no judge.** chatbench has a tier-2 LLM judge; AGENTBENCH has none.
Grading is **entirely deterministic** — compare the produced call(s) to the
expected call(s), gate against the capability registry, check termination and
(when required) the proof chain. A deterministic router is measured by a
deterministic ruler.

## The pluggable "agent under test" (the seam)

The agent is a **function**, swapped without touching the harness:

```
driver(request, tools, ctx) => Promise<loopResult>
  request : string     — the user's imperative
  tools   : string[]   — the DECLARED toolset for this case
  ctx     : { dispatch(name,input) => {ok,text|error}, capabilityByName, config }
  loopResult = { calls: [{name, input}], refused, terminated, proof, driver }
```

Today the default is **`driver-stub.mjs`** — a trivial keyword→tool stub that
maps the obvious single-tool requests, binds one entity, executes tmct's real
`dispatchTool`, and **refuses otherwise**. It exists so the harness is runnable
and testable *now*, before Stage 1 (the resolver) and the HTTP shim exist. The
coordinator swaps in the real resolver/planner/shim driver later behind this
exact signature (`runAgentbench(cases, { driver })`).

> **Stub-driver FLOOR, not the router baseline.** Every row the stub produces is
> stamped `driver: "stub-floor"` and the runner prints a banner saying so. The
> real engine, built later, must not be compared against this mislabeled anchor:
> the stub is a floor (what a dumb keyword matcher gets), not the router's score.

## The rungs (the TOOL ladder — tool-use capability, this bench's own scale)

| Rung | Name | What it demands |
| ---- | ---- | --------------- |
| **TOOL-0** | Direct dispatch | one obvious tool, arguments on a plate |
| **TOOL-1** | Tool selection | pick the right tool from a small declared set + bind one entity |
| **TOOL-2** | Scope refusal | **honest refuse** when no declared tool fits or the entity does not resolve |
| **TOOL-3** | Sequential composition | a bounded multi-step recipe — thread one result into the next call |
| **TOOL-4** | Conditional dispatch | conditional / retry — monitor an outcome, re-plan |
| **TOOL-5** | Goal planning | compose a plan for a novel goal (closed-world) |
| **TOOL-6** | Goal deduction | self-directed — deduce the goal, then plan (closed-world) |
| **TOOL-7** | Recovery & replanning | a step fails (empty/error) and the driver observes it and replans a fallback — `expect.recover` |
| **TOOL-8** | Composition under ambiguity | enumerate the tied readings (`expect.candidateResults`) or refuse-with-a-nudge — never an arbitrary pick |

The stub driver is exercised only on **TOOL-0/TOOL-1/TOOL-2**; the goal driver clears through
**TOOL-6**. **TOOL-7/TOOL-8** name capabilities the current drivers do not have yet (a replanning
branch in the planner; a tied-candidate composer in the goal reasoner) and gate at the honest floor
until those ship — named horizons, declared up front so the ladder and the regression frame exist
before the engine that will climb them.

## The grade (deterministic) + the metric PAIR

A case PASSES iff **all** hold:

1. **Zero hallucinated calls** — every produced call names a tool in the declared
   set *and* a real registry capability, with only accepted arg-keys and every
   required arg bound. Any violation = automatic fail. (Closed-world default-deny:
   see below.)
2. **The loop terminated** (`expect.terminates`).
3. **Outcome matches** — the produced call sequence matches `expect.calls`
   (name + pinned input, positionally); OR, for an `expect.refuse` case, the
   driver **refused cleanly** (no call). *Refusing-when-unsure is a PASS at the
   honest-miss level.*
4. **Proof chain** — when `expect.proof`, a non-empty proof chain whose
   precondition steps are all `ok` (the glass-box receipt: which preconditions
   held, which effect the call achieves).

Per rung the runner reports a **METRIC PAIR**, because a single number is
gameable — a driver that *refuses everything* scores 0% hallucination at ~0%
completion:

- **completion (coverage)** — fraction of cases whose expected outcome was
  correctly produced (the right call(s), or a correct refusal);
- **hallucination rate** — fraction of cases with any out-of-set / unbindable call.

The honest **gate** is therefore **"0% hallucination AT ≥50% completion"**
(`COMPLETION_FLOOR = 0.5`). A refuse-everything driver fails the gate on
completion; a reckless driver fails it on hallucination. Only a driver that is
both **safe and useful** clears it. `--ladder` runs rungs ascending and the
first rung that fails the gate gates every rung above it (skipped with a
receipt, e.g. `rung TOOL-5 skipped: gated by TOOL-2 completion 40% < 50%`), exactly like
chatbench's grade ladder.

## Closed-world / default-deny

The capability registry (`src/domain/router/registry.mjs`) is a deliberate, documented
**strict subset** of the `dispatchTool` switch. The model is **closed-world
default-deny**: a tool name that is not a registered capability is treated as
UNKNOWN and rejected as a hallucination (`unknown-tool`). So a planner or shim
that emits an **unregistered** tool is an automatic fail — identical to inventing
a tool that does not exist. The unbounded-output tools (`tmct_snippet`,
`tmct_context`, `tmct_context_more`) are **intentionally unregistered** (they
emit raw snippets / whole edit bundles — the most hallucination-prone surface;
they need output-size / file-read preconditions we have not committed to), and
the exclusion is recorded in `EXCLUDED_FROM_REGISTRY` so it reads as a decision,
not an omission. A conformance test (`test/bench/agentbench.test.mjs`) makes the
"verified against the switch" claim executable: every registry arg-key is proven
to be the key `dispatchTool` actually reads, and the registry is proven a strict
subset of the dispatch case set — so arg-key drift fails at merge, not at runtime.

## Files

| file | role |
| ---- | ---- |
| `cases.jsonl` | the seed case set (TOOL-0/TOOL-1/TOOL-2 over the graph-query toolset) — append-only once the AGENTBENCH arc starts |
| `grade.mjs` | the deterministic grading core: rungs, case lint, the zero-hallucination gate, the metric pair + ladder rollup (pure, no I/O) |
| `driver-stub.mjs` | the default pluggable driver — the **stub-driver floor** |
| `run.mjs` | the deterministic runner: replays cases through the driver, writes `results/raw/run-<stamp>/product.jsonl` |
| `results/` | run output (`results/raw/` is transient) |

## Running

```sh
node agentbench/run.mjs                       # stamp defaults to the version 0.8.0
node agentbench/run.mjs --stamp 0.8.0 --ladder
node agentbench/run.mjs --rung TOOL-1             # one rung only
node agentbench/run.mjs --only ab-a0-describe-widget
# (npm run agentbench:run -- --stamp 0.8.0  is the provisioned script)
```

- **Determinism:** no `Date.now()` in recorded output — the run stamp comes from
  `--stamp` (default the pinned bench version **`0.8.0`**, stamped explicitly and
  NOT read from `package.json`). Two runs over the same tree + stamp produce
  byte-identical `product.jsonl`.
- **`--stamp`** must be a filesystem-safe label; **`--out`** overrides the output
  dir; **`--rung <TOOL-0|…|TOOL-8>`** and **`--only <id,…>`** narrow the selection;
  **`--ladder`** gates ascending rungs.

## Case shape (`cases.jsonl`, one JSON object per line)

```json
{ "id": "ab-a1-callers-fnalpha", "rung": "TOOL-1",
  "request": "which functions call fnAlpha",
  "tools": ["tmct_describe", "tmct_callers", "tmct_callees"],
  "expect": { "calls": [{ "name": "tmct_callers", "input": { "symbol": "fnAlpha" } }],
              "terminates": true, "proof": true } }
```

- **`rung`** — one of `TOOL-0 TOOL-1 TOOL-2 TOOL-3 TOOL-4 TOOL-5 TOOL-6 TOOL-7 TOOL-8`.
- **`request`** — the imperative handed to the driver.
- **`tools`** — the DECLARED toolset (every name must be a registered capability).
- **`expect.calls`** — the expected call sequence (name + pinned input as a lower
  bound; extra optional keys on the produced call are allowed). Omitted for a
  refuse case.
- **`expect.refuse`** — `true` when the correct outcome is an honest refusal
  (no fitting declared tool, or an unresolvable entity). Mutually exclusive with
  `expect.calls`.
- **`expect.terminates`** — the loop must end (always `true` for these bounded cases).
- **`expect.proof`** — when `true`, a valid proof chain is required.

## Reference bands (ILLUSTRATIVE anchors — NOT run here)

AGENTBENCH's ladder is read against **comparable models** as illustrative
anchors, the way chatbench frames CEFR bands. These are the intended reference
points for a future write-up; **none are run by this harness** (no network, no
LLM), and no scores are claimed for them here:

| band | anchor | rough expected reach on the declarable graph-query slice |
| ---- | ------ | -------------------------------------------------------- |
| tiny-local | a small local model (≈1–3B) | TOOL-0, shaky on TOOL-1 tool selection |
| 8B-open | an 8B open-weights model | TOOL-0–TOOL-1, unreliable TOOL-2 refusal (over-eager to call) |
| Nova-micro | Amazon Nova Micro | TOOL-1–TOOL-2 |
| Nova-lite | Amazon Nova Lite | TOOL-2, some TOOL-3 |
| Haiku | Claude Haiku | TOOL-3–TOOL-4 |

The point of the bench is to say, honestly and measurably, where a
**tmct-backed** driver sits against these anchors on the slice it *declares* — and
where it should refuse. Per Phase A's `bedrock-meter` framing, the rung
AGENTBENCH proves in-envelope is exactly the request class an optimiser may route
to the deterministic $0 floor instead of a metered model.
