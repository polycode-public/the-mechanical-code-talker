# AGENTBENCH_0.8.0 — the shim-transport baseline, measured

**Headline:** **0% hallucination on every rung** (A0→C2) — the router's one non-negotiable,
demonstrated by the *transport floor*. Overall **completion 13 / 28 = 46%**, hallucination **0 / 28
= 0%**. On the honest gate (**0% hallucination AT ≥50% completion**) the shim **clears A0 (71%), A1
(56%), A2 (100%)** and hits its **ceiling at B1** (0% — it gates B2/C1/C2). Deterministic replay,
no LLM, no judge; two runs over the same tree + `--stamp 0.8.0` are byte-identical.

> ## ⚠ This is the SHIM-TRANSPORT floor — NOT the router baseline, NOT the stub floor
> The driver under test is `shim-transport` (`agentbench/driver-shim.mjs`): it reuses the HTTP
> shim's deterministic `selectTool` (`src/server-http.mjs`) **in-process**, executes the chosen call
> through the real `dispatchTool`, and closes the loop on the tool_result. The shim is the
> **common-interface serialization layer** a tool-loop client (Claude Code) already speaks — the
> *transport*, **not the routing brain**. `selectTool` only emits a `tool_use` for an explicit
> COMMANDS verb (`describe X`, `callers X`, `untested`, …) or for `tmct_ask` when declared; AGENTBENCH
> cases are free-NL and can only declare **registry** capabilities (never `tmct_ask`), so anything
> outside the command register maps to a **text answer** → here, an honest **refuse**. The REAL router
> anchor is the **resolver/planner** driver, swapped in later behind the same `driver(request,tools,ctx)`
> seam. Do not read 46% as "the router scores 46%": read it as "the transport layer, with no resolver,
> completes the command register and refuses the rest — at zero hallucination."

## The metric pair, per rung (the honest gate)

`node agentbench/run.mjs --stamp 0.8.0 --driver shim --ladder`

| rung | n | pass | **completion** | **halluc** | gate | reading |
| ---- | --: | --: | --: | --: | ---- | --- |
| **A0** | 7 | 5 | **71%** | **0%** | PASS | single tool, args on a plate — cleared in the command register |
| **A1** | 9 | 5 | **56%** | **0%** | PASS | pick from a set + bind one entity — cleared in the command register |
| **A2** | 3 | 3 | **100%** | **0%** | PASS | honest refuse (unresolvable entity / out-of-set / unknown class) — the shim's strongest lane |
| **B1** | 3 | 0 | **0%** | **0%** | ---- | **the ceiling** — a bounded 2-step recipe; single-call transport can't thread |
| **B2** | 2 | 0 | **0%** | **0%** | gated | conditional / retry — gated by B1 |
| **C1** | 2 | 0 | **0%** | **0%** | gated | compose a plan for a novel goal — gated by B1 |
| **C2** | 2 | 0 | **0%** | **0%** | gated | self-directed goal deduction — gated by B1 |
| **all** | 28 | 13 | **46%** | **0%** | ---- | 0% hallucination everywhere; completion tops out at the command register |

**Ladder:** `A0 → A1 → A2 → B1 → B2 → C1 → C2 — gated at B1 completion 0% < 50%`. A0/A1/A2 pass the
honest gate; B1 is the first un-gated rung and gates everything above it (B2/C1/C2 skipped with a
receipt), exactly as the frame intends.

## The honest reading

- **The 0%-hallucination number IS the result.** On the graph-query domain, across all 28 cases and
  all seven rungs, the transport floor emits **zero** out-of-set / unbindable calls. It refuses or
  answers in text rather than guess a call the graph can't ground. That is the property a
  deterministic router exists to guarantee, and it holds unconditionally here — the load-bearing
  baseline the honest gate demands.
- **Completion is the command register, and only the command register.** Every A0/A1 case the shim
  *completes* is phrased as a bare COMMANDS verb (`untested`, `arch`, `signature Widget.render`,
  `callers fnAlpha`, `impact app/lib/a.mjs`, `members Widget`, …). Every A0/A1 case it *misses* is
  free-NL for the same intent — and it misses by **refusing**, not by hallucinating. The seed set is
  built as **minimal pairs** to make this visible:
  - `ab-a0-cmd-untested` *"untested"* → `tmct_untested{}` ✅ vs `ab-a0-untested` *"list the untested
    symbols"* → **refuse** ❌ (no route)
  - `ab-a0-cmd-exports-b` *"exports app/lib/b.mjs"* → `tmct_exports{module}` ✅ vs `ab-a0-exports-b`
    *"what does app/lib/b.mjs export"* → **refuse** ❌
  - `ab-a1-cmd-callers-fnalpha` *"callers fnAlpha"* → `tmct_callers{symbol}` ✅ vs
    `ab-a1-callers-fnalpha` *"which functions call fnAlpha"* → **refuse** ❌
- **`ab-a1-search-widget` is an honest completion miss, not a fudge.** *"search for widget"* routes,
  but the shim's thin prefix-stripping binds `query:"for widget"` where the correct arg is
  `query:"widget"`. The case pins the **correct** arg, so the shim fails it — a real miss the
  resolver will fix, recorded truthfully rather than papered over.
- **B1 is the true ceiling.** The shim emits **at most one** `tool_use` per turn and has no
  thread-through; every B1/B2/C1/C2 case needs ≥2 chained calls, so the shim refuses (0 calls) — a
  **ceiling marker, not a bug**. These rungs are declared with real entities and real registry tools
  so the ladder and the regression frame exist *before* the resolver that will climb them.

## Transport floor vs the stub-keyword floor (a sharp contrast)

Run the same 28 cases through the dumb keyword-matcher stub (`--driver stub`) for contrast:

| driver | overall completion | overall halluc | note |
| ------ | --: | --: | --- |
| `stub` (keyword floor) | **64%** (18/28) | 0% | guesses a tool from NL keywords — so it *out-completes* the shim on A0/A1 |
| `shim-transport` | **46%** (13/28) | 0% | only routes the explicit command register — the serialization layer, not a router |

The stub floor **beats** the transport floor on completion — precisely *because* the shim is
transport, not routing. A dumb NL keyword matcher at least guesses from *"which functions call
fnAlpha"*; the shim, faithful to its job, only serializes an explicit command and otherwise hands the
turn to a text answer. Both hold 0% hallucination. **Neither is the router.** The number that will
actually move — completion on free-NL — is the resolver/planner's to lift; this baseline pins where
it starts.

## Reference bands (ILLUSTRATIVE anchors — NOT run here)

Per `agentbench/README.md`, the ladder is read against comparable models as illustrative anchors, the
way chatbench frames CEFR bands. **None are run by this harness** (no network, no LLM); no scores are
claimed for them. They orient where a tmct-backed driver *should* sit on the slice it declares:

| band | anchor | rough expected reach |
| ---- | ------ | -------------------- |
| tiny-local (≈1–3B) | small local model | A0, shaky A1 tool selection |
| 8B-open | 8B open-weights | A0–A1, unreliable A2 refusal |
| Nova-micro | Amazon Nova Micro | A1–A2 |
| Nova-lite | Amazon Nova Lite | A2, some B1 |
| Haiku | Claude Haiku | B1–B2 |

The transport floor reaches the **command-register slice of A0–A1 and all of A2-refuse at 0%
hallucination** — a narrow but perfectly safe envelope. Per the bedrock-meter framing, the rung
AGENTBENCH proves in-envelope at $0 is exactly the request class an optimiser may route to the
deterministic floor instead of a metered model — today that is "explicit command + honest refusal."

## Decision

**Baseline accepted as the transport/interface floor.** The non-negotiable — **0% hallucination on
every rung** — holds, and the honest gate is cleared through A2 with the ceiling landing exactly where
the ladder predicts (B1, the first multi-step rung). The gap to close is **completion on free-NL**,
which is the **resolver's** job (Stage 1): map an NL request to a capability + bound args without the
command-verb crutch, so `ab-a0-untested`, `ab-a1-callers-fnalpha`, and the `search` arg-binding miss
convert from refuse to complete — still at 0% hallucination. Then B1+ open up to the planner (Stage
2+). Recommended next levers: (1) the **resolver driver** (NL → capability, the real router anchor);
(2) fix the `search` prefix-stripping so `query:"widget"` binds; (3) a **2-step planner** to break the
B1 ceiling.

## Discipline notes

- **Determinism:** stamped `--stamp 0.8.0` (never `Date.now()`); re-running is byte-identical.
- **Structural no-hallucination is tested, not asserted:** `test/agentbench.test.mjs` runs the shim
  over the whole ladder and proves every produced call is in-registry, declared, and bindable
  (0 hallucinations on all 28 cases). A companion test pins the **COMMANDS.arg seam invariant** —
  every command verb's arg-key is an accepted registry arg-key — so an arg edit can't silently turn a
  shim `tool_use.input` into a grader `unknown-arg` false-positive.
- `npm test` green (**830** tests).

Artifacts: raw product rows in `agentbench/results/raw/run-0.8.0/product.jsonl` (28 graded rows,
`driver:"shim-transport"`, `stamp:"0.8.0"`); harness `agentbench/run.mjs` (`--driver shim`),
grader `agentbench/grade.mjs`, driver `agentbench/driver-shim.mjs`, cases `agentbench/cases.jsonl`.
