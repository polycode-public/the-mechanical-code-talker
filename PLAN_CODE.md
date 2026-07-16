# PLAN_CODE.md — program synthesis over tmct's closed DSLs (and, now, JS/HTML/CSS)

> **STATUS (2026-07-08): Track 1 ✅ SHIPPED** — all 5 staged units (`synthbench/`): a
> `PHRASING_FRAMES` template-generalization synthesizer, a labeled-example harness reusing
> agentbench's own case shape, a bounded `GOAL_RULE` field-grammar enumerator (grounded in the
> live registry, not hardcoded), a verification oracle that runs a candidate through the real
> unmodified `goalReason`, and a deterministic CEGIS refiner. Reproduces both hand-written
> `GOAL_RULES` byte-for-byte and synthesizes one genuinely novel rule (0% call fabrication,
> held-out-checked). One small backward-compatible product change (`goalReason`/
> `applicableRules` gained an optional `ruleSet` param, default preserves every existing
> caller) — merged cleanly alongside the Bug 8 domain-gate fix, both independently
> re-verified working together. **Tracks 2–4 remain unsigned-off and untouched** — each still
> requires its own separate operator sign-off per §8's gate before any implementation begins.

> **Separately (not this doc's own build): the substrate Track 1 synthesizes into is now
> invokable.** `src/router/*` — the registry/resolver/planner/goal-reasoner Track 1's own oracle
> runs candidates through (§1.4's `goalReason`/`applicableRules`) — was real and tested but
> unreachable outside `agentbench/`/the test suite until this cycle. It now has a real invocation
> surface: `tmct plan "<request>"`, chat's `/plan`, and a `./plan` library export (see
> `CAPABILITIES_1.7.3.md` row 99, `PLAN_AGENTS.md` §1.3). This changes nothing about Track 1's own
> synthesis PROCESS (still `synthbench/`, still hand-reviewed before a synthesized `GOAL_RULE`
> joins the frozen `GOAL_RULES` array) — but once a synthesized rule IS merged, `tmct plan` reaches
> it the same way it reaches every hand-written rule, with no extra wiring. Tracks 2-4 (executable
> JS/HTML/CSS synthesis) are unaffected — they are still sign-off-gated and untouched.

*(Drafted 2026-07-07. Status: RESEARCH PLAN, not a build order — see §8, explicit operator sign-off
required before any implementation. Origin: operator's conversational prompt — "I wonder if you
could implement program synthesis, only not with a 1957 tech stack" — resolved to
example-based/syntax-guided synthesis over tmct's own **closed** DSLs, verified against the real
graph instead of an SMT solver (FlashFill-adjacent, not general code generation). Scope then grew
three times in-session: first to the operator's own idea of a Playwright sandbox for the
verify/execute step, then to a three-language target set — "we'll support 3 languages... JS, HTML
and CSS" (§4/§5 below) — then to a bounded-mutation-search/program-repair track (§2, grounded in
Automated Program Repair literature) for the JS case specifically. This plan does not duplicate
the Progol/ILP finding now carried in `PLAN_SYLLOGIST.md` §5 — learning new *inference rules* is
"a separate far spike" this repo has looked at and left shut. This plan is a **different**
synthesis target — not
learning logic rules, but synthesizing small **declarative router data** (Track 1), **repairing
existing code via goal-directed mutation search** (Track 2), or synthesizing small **executable
snippets/markup from scratch** (Tracks 3/4) — and should be read as a sibling finding, not a
re-opening of that door.)*

**Ground rules, restated because this topic is the one most likely to be built past them.** tmct is
no-LLM, permanently, and every mechanism must be deterministic, explainable, and closed
(`CLAUDE.md`: "LLMs are allowed ONLY in the offline eval harness… never in the product path").
Synthesis here means **search + verification against a bounded grammar**, never a language model
guessing code. A synthesized artifact must be **as auditable as a hand-written one** — a
synthesized `GOAL_RULE` must read exactly like the hand-written `GOAL_RULES` entries in
`src/router/goal-reasoner.mjs`, a synthesized
or repaired JS/HTML/CSS fragment must be plain, inspectable source text, never an opaque blob.
Every **built-in** capability in `src/router/registry.mjs` is `readOnly: true` with an empty
delete-list (the `capability()` builder hardcodes it — "queries mutate nothing"). Taught action
families have since crossed the read-only line for WORLD STATE: `capabilityFromActionRules`
(`src/router/taught.mjs`) registers `readOnly: false` records with real add/del effect lists,
never auto-dispatched (`registerCapability` forces `dispatchable: false` on them; planning grounds
them by pure simulation). Synthesis would be the first capability category to generate or modify
**source artifacts** — code and rules, not world-state facts — which is still a genuine first for
the product's ethos, not an incremental feature, and is called out again in §8. (The second, a sibling and competing approach targeting
natural-language completions rather than structured/executable artifacts, is `archive/PLAN_COMPLETIONS.md`
— see its §0 for how the two compare.)

---

## 1. Track 1 (primary target) — synthesizing a `GOAL_RULE` or `PHRASING_FRAMES` entry

This is the lowest-risk, most tmct-native target, and — this is the direct answer to the operator's
sandbox idea for this track specifically — **needs no sandbox at all**. A candidate `GOAL_RULE` is
plain frozen data fed through the SAME trusted, already-shipped engine code
(`applicableRules`/`goalReason`, `src/router/goal-reasoner.mjs` — both now take an optional
`ruleSet` param for exactly this) that every hand-written rule
already runs through. `agentbench/driver-goal.mjs`'s `goalDriver` already calls `goalReason`
**in-process**,
inside the bench's own `Promise.race` timeout guard, no isolation layer of any kind — proof by
existing precedent that grading a candidate rule this way is already how this repo works.

### 1.1 The exact shape being synthesized

The `GOAL_RULES` docblock plus the two live entries (`coverage-invariant`,
`cochange-risk-invariant`, `src/router/goal-reasoner.mjs`) pin the
field set precisely:

| Field | Type | Constrains the search to |
|---|---|---|
| `id` | string | free (mechanically generated, e.g. `synth-<slug>`) |
| `invariant` | string | free-text explanation, not searched (post-hoc, from the rule's own composed fields) |
| `focusClass` | enum | the `seon`/`mgx` classes actually used as a capability parameter `kind` (the `KINDS` enum, `src/router/registry.mjs`) — today `Module`/`Class`/`seon:CodeEntity` (Symbol) |
| `modes` | subset of `{"scoped","global"}` | closed 2-element powerset minus ∅ — 3 possibilities |
| `subGoals` | ordered list of topics | the topics reachable via `backwardChain` (`src/router/resolver.mjs`) — i.e. any `add`-effect `topic` string emitted by a registered capability: `matches, description, signature, impact, members, subclasses, exports, callers, callees, calls, tests, untested, history, cochanges, architecture` (the `CAPABILITIES` array, one per `knows(...)` call) |
| `priorityTopic`/`coverageTopic` | topic string | same closed topic set, used only when `"global"` ∈ `modes` |
| `compose` | `{op, a, b, names, empty}` | `op` ∈ the exported `set-algebra.mjs` operators — `intersect`, `fallbackIfEmpty`, `guardIfEmpty`; `a`/`b` are `{topic, of?: "focus", withFocus?: bool}` |
| `achieves` | string | the meta-goal name a request backward-chains to (`backwardChainGoal`) |

This is exactly a small, **already-closed grammar** — nothing here is unbounded natural code; every
field ranges over an enumerable set the registry/resolver already declare, which is what makes this
track tractable at all.

### 1.2 The simpler warm-up target — `PHRASING_FRAMES`

`PHRASING_FRAMES` (`src/interpret/normalize.mjs`) is a strictly smaller instance of the same
species: an entry is
`{re: RegExp, to: (m) => string}`, first-match-wins, unmatched text passes through byte-unchanged
(`applyPhrasingFrames`). The synthesis target is narrower still — not an arbitrary regex, but a
**template instantiation**: given paired examples `("what functions are in Task", "what does Task
contain")`, generalize the varying span (`Task`) into a capture group and generalize the fixed
scaffold (`"what functions are in ___"`) from a small closed set of anchor-phrase templates already
present in the table's own comment-delimited families (members-of-class, where-defined,
predicative-qualifier, co-change, authorship, has-tests, needs-tests, … — 10 families at this
writing; count them from the table, not from here). This is a good
**stage-0 warm-up**: the search space is one order of magnitude smaller (generalize-a-template vs.
select-6-closed-fields), and the verification oracle is nearly the same shape (§1.4), so building it
first exercises the CEGIS loop cheaply before Track 1's fuller grammar.

### 1.3 The search space (enumerative, bounded)

Given labeled examples `{request, tools, expect: {calls, composed}}` (reusing `agentbench/
cases.jsonl`'s exact case shape — `{id, rung, request, tools, expect}`, `agentbench/cases.jsonl:1`),
enumerate candidates bottom-up over the closed grammar in §1.1: for each `focusClass` × `modes`
combination, generate every `subGoals` ordering that is a subset of `{matches, description, …}`
whose topics all `backwardChain` (never invent a topic outside the registry — the same
default-deny discipline `registerCapability`'s validation already enforces for tool names), then every valid
`compose` spec pairing two gathered topics through one of the 3 set-algebra ops. This is a small,
fully enumerable space (roughly: 3 focusClasses × 3 mode-subsets × C(15,≤3) subGoal subsets × 3
compose ops × 2 sides-with-`withFocus` — low thousands of candidates, not combinatorial explosion),
which is exactly why this is a defensible *first* synthesis target and not a general program search.

### 1.4 Verification oracle + CEGIS refinement

For each candidate rule, insert it into a **cloned** `GOAL_RULES` array and call the real
`applicableRules`/`goalReason` (via their `ruleSet` param) against the real fixture graph for
every labeled example — mirroring `agentbench/driver-goal.mjs`'s own in-process call, and mirroring
`agentbench/grade.mjs`'s zero-fabrication discipline (`gradeCase` value-compares the
driver's `composed` field to the case's **static** `expect` literal, "no composition function
imported — it only compares… so the check is not the code testing itself"; the exact posture
`infbench/grade.mjs` takes too — compare to literals pinned at generation time, never re-derive).
A candidate **passes** an example
iff the produced `calls`/`composed`/`proof` match `expect` exactly (`proofConnected`,
`agentbench/grade.mjs`). A failing example is a genuine **counter-example**: it prunes every candidate
whose `subGoals`/`compose` combination cannot reproduce it, shrinking the enumeration on the next
pass — textbook CEGIS, and the same "never trust the candidate, only the pinned static label" gate
`ladderGate`/`COMPLETION_FLOOR` already enforce elsewhere in `agentbench/grade.mjs`.

---

## 2. Track 2 (revised 2026-07-16) — goal-directed program repair: planning over mutation actions, with bounded mutation search as the proposal engine (JS)

Starting point: an **existing real function** in the repo, plus a target behavior change expressed
as **test executions** — a named set of failing tests that must pass, and the already-green
regression set that must stay green. Rather than enumerating candidate programs bottom-up from
nothing (Track 3), this track searches the space of **compound edits to the existing AST** — this
is Automated Program Repair (APR), not from-scratch synthesis, and it is empirically the *easier*
problem: most real fixes are small, local deltas (Purushothaman & Perry, 2005), so starting from
working code is a far stronger prior than blank-slate enumeration.

*(Revision note. The first draft framed this track as greedy mutation search with an HTN aside.
The planning substrate that shipped since — `findActionPath`/`findReachableSet` in
`src/planning.mjs`, the four action rule kinds in `src/adapters/memory/core.mjs`,
`compileGoal`/`movesFromRules` in `src/domain.mjs`, validated end to end by Hanoi and
river-crossing in `test/corpus/planning.jsonl` — makes the planning frame primary and the mutation
search the inner proposal engine. Nothing from the first draft is dropped; §2.4–§2.6 carry it
forward.)*

### 2.1 The frame: tests are the goal state, mutations are the actions

The goal state is declared in terms of test executions: `pass(<test-id>)` for each target failing
test, plus the standing constraint that every currently-green test stays green. Actions are
mutation operators drawn from a **closed template catalog** (never arbitrary text edits) — e.g.
"replace comparison operator", "swap operand order", "invert boolean", "add/relax a guard clause",
"change a literal constant" — mirroring the fixed repair-template catalogs published as **PAR**
(Kim et al., 2013) and **TBar** (Liu et al., 2019), which found a small closed set of templates
covers a large fraction of real human-authored fixes.

Each template maps onto the shipped action-rule shape (`RULE_KIND_ACTION_SIGNATURE`/`_PRECOND`/
`_EFFECT`/`_CONSTRAINT`, `src/adapters/memory/core.mjs`) almost slot for slot:

| Action-rule slot | For a mutation template |
|---|---|
| signature | the AST shape it applies to ("a comparison operator inside an if-guard") |
| precondition | applicability at a concrete site, inside the fault region (§2.3) |
| effect, declared | the source edit itself — deterministic, fully known before execution |
| effect, predicted | which tests the edit should flip — a ranking prior, never trusted (§2.2) |
| constraint | stay inside the fault region; never break a green test |

**Small vs. composite changes** are the primitive-action vs. composed-plan distinction. A small
change is one template application. A composite change is either an HTN method — decompose "make
suite X green" into per-failing-test or per-function sub-goals, each searched within its own
bounded depth (Erol, Hendler & Nau, 1994) — or a macro-action: a recurring template sequence
("extract guard, then invert condition") promoted to a single named action once it recurs.
`src/router/planner.mjs` and `goal-reasoner.mjs` already run HTN-style decomposition for tool-call
planning; this track reuses the same paradigm for code-edit planning.

### 2.2 The load-bearing asymmetry: source effects are declarable, behavioral effects are only observable

In the shipped planning domains (Hanoi, river-crossing) every action's effect on state is
declared, so `findActionPath` computes the whole move sequence before anything executes. Code has
only half that property. The effect **on the source file** is deterministic and declarable —
apply template A at site X and the resulting text is known exactly. The effect **on behavior**
("test T now passes") is NOT derivable from the action description; general behavior prediction
runs into Rice's theorem, and no effect annotation removes that.

So the behavioral half of each action's effect is a **prediction** — useful for ranking what to
try next, refutable by every run. The control structure is therefore the closed observe-and-replan
loop `PLAN_GUESS_NUMBER.md` designs for hidden state, not classical fully-observed planning:
**plan** (over declared source effects, ranked by predicted behavioral effects plus §2.4's
distance signals) → **act** (apply the mutation) → **observe** (run the tests in the sandbox,
§2.8) → **fold in** (record the candidate's actual test vector in §2.6's cache; demote the priors
of templates whose predictions missed) → **replan**. Every predicted-vs-actual mismatch is a
counter-example that refines the action model — the same CEGIS posture Track 1 already ships,
applied to action priors instead of rule fields. Each step's predicted-vs-actual pair is written
into the track's run artifacts, the same honesty discipline as chatbench's predictions-vs-actuals
table.

### 2.3 Fault localisation is the planner's relevance step

Where to mutate is not free choice: the coverage of the failing tests defines the fault region —
the sub-graph of functions and branches the target tests actually execute — and every action's
precondition binds to sites inside it. This gives the track something the greedy framing lacked: a
principled "where", not just a "what". Precondition pruning does real work here (never apply a
comparison-flip where there is no comparison; never mutate a file the failing tests never reach).

### 2.4 Candidate scoring — the proposal engine's three equivalence signals

Within a chosen sub-goal and fault region, ranking candidates needs a cheap behavioral-closeness
measure. General program equivalence is undecidable (Rice's theorem) — this track never claims to
decide it, only to approximate it cheaply enough to prune and rank candidates, combining three
signals:

- **Structural distance**: AST/tree edit distance (Zhang & Shasha, 1989) between candidate and
  original — a literal count of "how many discrete changes apart" two programs are — plus cheap
  static complexity signals (McCabe cyclomatic complexity, Halstead operator/operand counts) as
  coarse pre-filters. Neither is sufficient alone: two programs can share a cyclomatic complexity
  number while differing completely in behavior, since it only counts control-flow paths, not data
  operations.
- **Behavioral distance under randomized/property-based inputs**: generate a range of random inputs
  matching the function's parameter shapes and compare outputs — property-based testing
  (QuickCheck-style; `fast-check` is the JS-ecosystem equivalent), used as an equivalence *oracle*
  rather than a pass/fail assertion. Two programs that agree across a large randomized input range
  are equivalent-for-practical-purposes, never equivalent-by-proof.
- **Mutation-template symmetry**: apply the *same* closed mutation template (e.g. "flip the 1st
  comparison") to both programs; if it matches an analogous location in each and the resulting
  behavioral distance stays low for both, that corroborates equivalence. If the template cannot
  match one program the way it matches the other, treat that as evidence of non-equivalence, not
  proof — this is exactly the **equivalent mutant problem** from mutation testing (deciding whether
  a mutant is behaviorally identical to the original is itself undecidable in general, Budd &
  Angluin, 1982), so this signal is one heuristic among three, never a standalone verdict.

### 2.5 Overfitting mitigation — stronger, not weaker, under a test-execution goal

The classic APR failure mode is **patch overfitting** — a candidate that passes the given example
set by deleting or short-circuiting functionality rather than genuinely reproducing the target
behavior (documented empirically for GenProg-class tools by Qi et al., 2015 and Smith et al., 2015).
Declaring the goal AS test executions makes this failure mode *more* tempting, not less — deleting
the functionality a failing test exercises is an excellent plan for "make the suite exit 0" — so
two mitigations are mandatory, not optional. First, the regression set is part of the goal state
itself (§2.1's constraint slot), never an afterthought. Second, the check the field itself
converged on: validate every surviving candidate against tests *beyond* the given set — generated
tests (**DiffTGen**, Xin & Reiss, 2017; Yu et al., 2019) here realized as **mutation testing**
(DeMillo, Lipton & Sayward, 1978): apply small independent mutations to the *candidate* and
confirm the property-based input range still discriminates it from those mutants. A candidate that
still passes when deliberately broken (a mutant that survives when it should be killed) is
exhibiting exactly the overfitting signature, and is rejected regardless of how well it scored on
the original goal.

### 2.6 A persisted, memoized search graph — the transposition table doubles as the observation cache

The search graph (program-state nodes, mutation-template edges) is memoized and persisted: once a
state has been evaluated, its behavioral/structural distance scores AND its actual observed test
vector (§2.2's observation step) are cached, keyed by a content hash of the AST — exactly a
**transposition table** (standard in game-tree search since 1970s chess engines, avoiding
re-evaluation of a position reached via a different move order), combined with
**dependency-tracked incremental invalidation** (self-adjusting computation, Acar, Blelloch & Harper,
2002; Adapton, Hammer et al., 2014): a change to one function only invalidates the cached evaluations
of states whose dependency set includes that function, not the whole graph. This makes repeated,
iterative search sessions over the same codebase cheap after the first pass, and it means
replanning never re-runs an already-observed candidate.

### 2.7 Search strategy: HTN decomposition + greedy best-first, with honesty about what planning adds

Exhaustive search over compound-edit sequences explodes combinatorially past a fairly low depth.
Similar to the SAT phase-transition phenomenon (Cheeseman, Kanefsky & Taylor, 1991: problem hardness
is not uniform, there is a narrow genuinely-hard region, and problems below a complexity threshold
are comparatively easy), the tractable move is staying below that threshold via depth-bounding and
§2.1's decomposition, plus **greedy best-first search** for step selection — at each state,
evaluate the locally-best next mutation-template application (by §2.4's distance signals and the
predicted behavioral effects) and commit to it, rather than exploring the full remaining chain.
Program space is astronomically larger than any shipped planning domain, so
`findReachableSet`-style exhaustive reachability does not transfer; the planner plans over action
structure at bounded depth and never enumerates program states. Worth naming honestly: greedy
search is not always the strongest strategy in this literature — Qi et al. (2014, "The Strength of
Random Search") found plain random search performs comparably to genetic search on many real APR
benchmarks, a useful calibration that the search-*space* definition (§2.1/§2.4) likely matters
more than the search *strategy*. Planning's real contributions here are decomposition, precondition
pruning, and **receipts**: a finished repair carries its plan ("applied invert-guard at `clamp`'s
first branch because failing test `synth-js-clamp-03` exercises it"), which serves §7's
auditability bar in a way "hill-climbed 400 candidates" does not.

### 2.8 Verification loop

Same Playwright-sandboxed execution as Tracks 3/4 (§5 below) — a candidate here is executable JS,
same isolation need as Track 3's from-scratch candidates. The §2.4 behavioral-distance check runs
candidate and original side by side in the same sandboxed context, over the same randomized input
batch, at every observe step of §2.2's loop.

---

## 3. Track 3 (new, harder) — small JS snippet synthesis from I/O examples

Classic PBE, closer to FlashFill: synthesize a short **pure function** from `(input, output)`
pairs, from scratch rather than from an existing seed. Like Track 2, the candidate here is
**literal executable JS source text**, not data fed through trusted engine code — this is where a
sandbox stops being optional (§5).

### 3.1 Spec format (concrete, reusing the repo's case-shape convention)

```json
{
  "id": "synth-js-clamp-01",
  "kind": "js-function",
  "signature": "clamp(x, lo, hi)",
  "grammar": "arith-compare",
  "examples": [
    { "in": [5, 0, 10],   "out": 5 },
    { "in": [-5, 0, 10],  "out": 0 },
    { "in": [15, 0, 10],  "out": 10 },
    { "in": [7, 2, 9],    "out": 7 }
  ],
  "heldOut": [ { "in": [3, 5, 9], "out": 5 } ]
}
```

`heldOut` examples are withheld from the search itself and checked only after a candidate passes
every `examples` row — the direct mitigation for §7's overfitting risk (a candidate that memorizes
the 4 given rows but fails the 5th is rejected, never shipped).

### 3.2 Search space — genuinely larger, must stay bounded by a declared sub-grammar

Free-form JS is not enumerable, and leaning on an LLM to guide the search would violate the
no-LLM-in-the-product-path ground rule (§0) even if the harness itself is dev-only — so the search
must stay a fixed, bounded sub-grammar, not open text. `grammar` names one of a small, closed set of
**operator families** (mirroring how `registry.mjs`'s `KINDS`/`PRECOND` are closed vocabularies, not
open text): arithmetic (`+ - * / Math.min Math.max Math.abs`), comparison/ternary (`< > === ? :`),
string (`slice indexOf toUpperCase concat`), array (`map filter reduce length`) — each family fixes
the terminal/operator alphabet. Enumerate closed-form ASTs over parameters + small integer literals
bottom-up by increasing depth (depth 0: parameters/literals; depth *k*: one operator over depth
*<k* subterms), the standard bottom-up enumerative-synthesis algorithm. Depth must be hard-capped
(e.g. 3) — even a 6-operator family at depth 3 is combinatorially real, so this track's exit
criterion (§6) is explicitly scoped to single-expression, loop-free bodies, never general control
flow.

### 3.3 Verification loop (Playwright-sandboxed)

For each candidate source string, `page.evaluate((src, cases) => { const fn = new Function("return "+src)(); return cases.map(c => fn(...c.in)); }, candidateSrc, allInputs)` inside a headless Chromium page (a fresh page/context per candidate or per batch, closed after use) — value-compares every returned output to the pinned `out`. A candidate that throws, times out (Playwright's own per-call timeout), or mismatches even one row is pruned; the surviving, smallest-AST candidate (Occam's-razor tie-break, §7) is the synthesized function, then checked against `heldOut`.

---

## 4. Track 4 (new, hardest) — HTML/CSS fragment synthesis from a structural/visual spec

The genuinely new part: synthesizing **markup + styles**, verified not by exact value comparison
but by **rendering** — there is no way to "run" HTML/CSS without a layout/paint engine computing the
result, which is exactly why this track (alongside Tracks 2/3) makes Playwright's headless browser
the well-motivated choice rather than a nice-to-have (§5).

### 4.1 Spec format (concrete)

```json
{
  "id": "synth-htmlcss-card-badge-01",
  "kind": "html-css-fragment",
  "given": "a card with a title and a status badge",
  "expect": {
    "structure": [
      { "selector": ".card",           "tag": "div"  },
      { "selector": ".card > h3",      "tag": "h3", "textNotEmpty": true },
      { "selector": ".card .badge",    "tag": "span" }
    ],
    "computedStyle": [
      { "selector": ".card",  "prop": "display",         "equals": "flex" },
      { "selector": ".badge", "prop": "backgroundColor", "equals": "rgb(220, 38, 38)" },
      { "selector": ".badge", "prop": "borderRadius",    "notEquals": "0px" }
    ]
  }
}
```

### 4.2 Search space — closed to the tags/properties the spec itself asserts

Free-form HTML+CSS is unbounded, and — same constraint as §3.2 — the search must not lean on an LLM
for guidance, so it has to stay a **closed** enumeration. The tractable move is to enumerate
**only** the tag/attribute/class vocabulary and CSS property/value vocabulary that appear in
`expect.structure`/`computedStyle` across the example set — a closed tag alphabet (`div span h1-h3
p img button ul li`) and a closed property alphabet keyed off the spec's own asserted properties
(`display color background-color padding margin border-radius flex-*`), never a general "any valid
CSS" search. This mirrors Track 1's discipline of enumerating over what the registry/topic set
already declares, not over the full language — and it is honestly a **less bounded** space than
Tracks 1-3, since HTML/CSS combinatorics (tag nesting × class assignment × property value choice)
grow faster than a single-expression AST does; this is exactly why Track 4 is staged last (§6), not
attempted alongside the earlier tracks.

### 4.3 Verification loop (same Playwright page, DOM + CSS in one context)

`page.setContent(candidateHtml)` + `page.addStyleTag({content: candidateCss})`, then per structure
assertion `page.$$(selector)` (existence, tag name), per style assertion `page.$eval(selector, (el,
p) => getComputedStyle(el)[p])`. `getComputedStyle` is the load-bearing normalization step — it
resolves `red`/`#dc2626`/`rgb(220,38,38)` to one canonical form regardless of how the candidate CSS
spelled it, so exact-string comparison after that call is honest, not fragile.

### 4.4 Honesty about this track's verification surface — deliberately fuzzier than Tracks 1-3

Structure and computed-style checks are exact-match, like the earlier tracks. **Pixel-level
layout/visual correctness is not**, and this plan explicitly does NOT stage it as an exit criterion:
viewport-dependent widths/heights, sub-pixel rounding, and font-metric variance make exact dimension
assertions flaky rather than deterministic — directly against the repo's own determinism bar
("same seed → byte-identical replay", the standard `SKILL_BENCHMARK_INFERENCE.md` and every other
bench in this repo hold themselves to). Track 4's exit criterion is therefore
scoped to structural presence + a bounded, spec-declared set of computed-style equalities only;
screenshot/visual-regression diffing needs a determinism answer of its own before any track
adopts it, so no track here assumes it.

---

## 5. The sandbox question — three options, compared per track (not force-fit to one answer)

`package.json` today has **no** sandbox/vm/browser-adjacent dependency: `dependencies` are `ink`,
`react`, `smol-toml`, `wink-eng-lite-web-model`, `wink-nlp`; `devDependencies` are `esbuild` (the
ask-browser bundle builder, not a sandbox), `ink-testing-library`, and `publint`. `files` ships
`bin/ src/ README.md ROADMAP.md LICENSE corpus/ data/`;
`exports` resolves only to `src/*.mjs` files (a broader key surface now — `./plan`,
`./generateCompletion`, and friends — but every target is in-tree source) — `agentbench/`,
`chatbench/`, `synthbench/` are **not** in `files`
and are never imported by `bin/tmct.mjs` or any `src/` module. Any
synthesis harness, for any track, must live the same way: a new dev-only sibling directory (e.g.
`synthbench/`, mirroring `agentbench/`/`chatbench/`), its dependencies added to `devDependencies`
only, never touching `dependencies`/`files`/`exports`.

| Option | Isolation | DOM/CSS capable? | Dependency cost | Fits which track |
|---|---|---|---|---|
| (a) direct in-process call (`goalReason`/`applicableRules`) | none needed — the candidate is DATA, not code, run by the SAME trusted engine already shipped | n/a | **zero** — no new dependency at all | **Track 1** (and its `PHRASING_FRAMES` warm-up) — the right answer, and the Playwright question is moot here |
| (b) Node `vm` module | process-shared, weak — known sandbox-escape / prototype-pollution / DoS surface for genuinely untrusted candidate code; a hung synchronous loop is only softly mitigated by `Script` timeouts | **no DOM at all** | zero (built-in) | would cover Track 3's pure-JS case *alone*, if Tracks 2/4 didn't exist |
| (c) Playwright headless browser | real OS-process isolation (separate browser process per context, hard-killable) | **yes** — `page.evaluate` is simultaneously a JS execution context, `page.content()`/`page.$eval` a DOM, `getComputedStyle` a CSS engine | heavy — multi-hundred-MB browser binaries, a new devDependency surface, version pinning to keep replay deterministic | **Tracks 2, 3 and 4, uniformly** |

**Verdict, per track, stated plainly rather than force-fit to one answer.** For Track 1, the
operator's sandbox idea does not apply — a candidate `GOAL_RULE` is data run by trusted code, so (a)
is not merely cheaper than (b)/(c), it is the *correct* model (no untrusted code ever executes);
adding Playwright for Track 1 alone would be pure unjustified dependency weight. Once Tracks 2-4 are
in scope, the comparison changes in Playwright's favor, and decisively so: `vm` cannot render
HTML/CSS at all, so it is no longer a candidate for a unified sandbox once JS, JS-repair, and HTML/CSS
are co-equal targets. With three languages and a repair track on the table, Playwright is the
**clearly right tool** — not a nice-to-have — specifically *because* one headless page is one
execution environment for all of it: `page.evaluate()` runs Track 2's mutated candidates and
Track 3's from-scratch candidates alike, `page.content()`/`page.$eval()` inspects Track 4's DOM
structure, and `page.evaluate(() => getComputedStyle(el))` inspects its CSS, all inside the same
OS-process-isolated sandbox rather than stitching together `vm` for JS and something else entirely
for markup. That also means Track 3 should use Playwright too, even though `vm` would suffice for
its pure arithmetic snippets alone — the honest reason to prefer Playwright there is uniformity of
one sandbox technology across Tracks 2-4, not that `vm` is inadequate on its own. The
dependency-weight tradeoff is real and should be named to the operator explicitly (§8), not absorbed
silently.

---

## 6. Staging (measure-before-building)

Track 1 breaks into four build stages (0-4, harness → search skeleton → oracle wiring → CEGIS +
exit) before Tracks 2-4 are attempted at all — each a genuinely separable unit of work:

| Stage | Track | What ships | Sandbox | Effort | Exit criterion |
|---|---|---|---|---|---|
| 0 | warm-up | `PHRASING_FRAMES` entry synthesis (§1.2) — template-generalization over paired utterance examples | none (in-process, `normalizeQuery`) | S | synthesizes ≥1 of the existing frame families byte-identically from its own hand-written examples (a "can we reproduce a known-good frame" self-check) |
| 1 | Track 1 | labeled-example harness — a `synthbench/rules/cases.jsonl` reusing `agentbench/cases.jsonl`'s exact `{id, tools, request, expect}` shape (§1.4), no search yet | none | S | a hand-authored `GOAL_RULE` (e.g. `coverage-invariant`) round-trips through the case format losslessly |
| 2 | Track 1 | the bounded field-grammar enumerator (§1.3) — produces candidate rule objects, not yet wired to the real engine | none | S-M | enumeration count matches the "low thousands" estimate (§1.3) for the current registry topic set; dry-run sanity check only |
| 3 | Track 1 | verification oracle wiring — each candidate cloned into `GOAL_RULES`, run through the real `goalReason` in-process (§1.4), graded like `agentbench/grade.mjs` | none | M | a synthesized candidate reproduces a hand-authored rule's behavior byte-for-byte on that rule's own labeled examples |
| 4 | Track 1 | full CEGIS refinement loop + held-out check + human-readability review pass | none | M | synthesizes a **novel** rule (not one already hand-written) matching a held-out labeled example set at 0% fabrication (mirrors `ladderGate`'s "0% hallucination at ≥`COMPLETION_FLOOR`" gate, `agentbench/grade.mjs`), AND the synthesized rule's fields read as a plausible hand-authored entry on manual review |
| 5 | Track 2 | mutation-template catalog (§2.1, start with 5-10 PAR/TBar-style templates, each expressed in the action-rule slot shape) + the equivalence-scoring oracle (§2.4, structural + property-based + mutation-symmetry) over ONE small, real, existing repo function — no search/planning yet, just "can we score two variants correctly" | Playwright | M | scores a hand-picked pair of known-equivalent variants (e.g. a manually refactored function) as equivalent, and a hand-picked pair of known-different variants as non-equivalent, with the overfitting check (§2.5) correctly rejecting a deliberately-overfit hand-written "patch" |
| 6 | Track 2 | the transposition-table/observation cache (§2.6) + the plan-act-observe loop over a test-execution goal (§2.1, §2.2, §2.7) wired to the stage-5 oracle | Playwright | M-L | repairs/adapts ≥1 real small function (≤10 lines) to a stated failing-test target with the regression set green, verified via the stage-5 oracle; the run emits a predicted-vs-actual ledger per step; search-graph reuse measurably cheaper on a second run over an overlapping target |
| 7 | Track 3 | small pure-JS-function synthesis (§3) — bottom-up enumerative search over one closed operator family at a time, verified via Playwright | Playwright (shared) | M-L | synthesizes a function passing all given examples AND its held-out example, for ≥1 grammar family (start with arithmetic/comparison only) |
| 8 | Track 4 | HTML/CSS fragment synthesis (§4) — closed tag/property enumeration keyed to the spec's own assertions, verified by rendering in the same Playwright page | Playwright (shared) | L | synthesizes a fragment passing all structure + computed-style assertions for a small hand-authored spec set; explicitly excludes pixel/layout exactness (§4.4) from the exit bar |

Stages 0-4 (Track 1) are deliberately built and measured **before** stages 5-8 (Tracks 2-4) are
attempted — the same measure-before-building discipline this repo's benchmark loops hold every
stage to (`SKILL_BENCHMARK_INFERENCE.md`'s gate-then-build rule): a stage that doesn't
clear its exit bar is parked and written up, not silently carried forward into the next stage's
scope. Track 2 (stages 5-6) is staged *before* Track 3 (stage 7) even though both need the same
sandbox, because repair-from-existing-code has a smaller effective search space than
synthesize-from-scratch (§2's own opening claim) — proving the oracle and search loop work on the
easier problem first de-risks the harder one.

**Case/example authoring convention to reuse, not invent fresh.** Track 1 reuses `agentbench/
cases.jsonl`'s exact shape (`{id, tools, request, expect: {calls, composed}}`, `agentbench/
cases.jsonl:1`) — a labeled example for rule synthesis IS an agentbench case, so the two artifacts
can share tooling (`agentbench/grade.mjs`'s `hallucinationsIn`/`proofConnected` apply unmodified).
Tracks 2-4 need new shapes (§2/§3.1/§4.1) since there is no existing "behavior-change target",
"JS I/O example", or "HTML/CSS spec" convention in the repo to reuse — these are named as genuinely
new artifacts, not squeezed into agentbench's tool-call shape where they don't fit.

---

## 7. Risks and honesty

- **PBE overfitting — the classic "works on N examples, wrong on the N+1th."** Sharpest on Tracks
  2-4 where the search space is far larger than Track 1's closed field grammar. Mitigation: a
  mandatory `heldOut` example per spec (§2.5/§3.1/§4.1, never used during the primary search), a
  minimum-AST-size/edit-distance tie-break among passing candidates (Occam's razor — the standard
  enumerative-PBE bias), and for Track 2 specifically, the mutation-testing check (§2.5) that
  generated tests beyond the given set converged on independently in the published APR literature.
- **The equivalent mutant problem is a real, undecidable limit on Track 2's equivalence signals
  (§2.4), not a solved sub-problem.** Mutation-template symmetry is one heuristic among three
  (structural distance, behavioral distance, template symmetry), never a standalone verdict — a
  candidate is judged by the combination, and the combination is still an approximation, never a
  proof of equivalence.
- **Search-space explosion grows with the grammar, and grows fastest on Track 4.** Track 1's field
  grammar is genuinely small today (§1.3, low thousands of candidates) precisely because
  `registry.mjs`'s topic set is small; every future capability added to the registry linearly grows
  Track 1's space too. Track 2's space is bounded by the mutation-template catalog's size and the
  HTN decomposition depth (§2.1/§2.7); Tracks 3/4 are bounded only by *closing* the operator/tag/
  property alphabet per spec — Track 4's tag-nesting × class × property-value combinatorics grow
  faster than Track 3's single-expression AST does, which is the concrete reason it is staged last
  (§6), not merely "harder" in the abstract.
- **Transposition-table cache correctness is a real engineering risk, not just a performance
  nicety.** If the dependency tracking behind Track 2's cache invalidation (§2.6) misses a real
  dependency, a stale cached score can silently pass a candidate that would fail against the current
  code — the cache must fail closed (invalidate when uncertain) rather than fail open.
- **No LLM in the search loop, even as a dev-only convenience.** Tracks 2-4 are all tempted to reach
  for an LLM to propose candidates instead of enumerating/mutating within a closed grammar — that
  would violate the ground rule even confined to a dev harness (`CLAUDE.md`: LLMs "never in the
  product path"; a synthesis harness that ships synthesized artifacts into `src/` is, transitively,
  part of that path). The closed sub-grammar/template-catalog constraints in §2.1/§3.2/§4.2 are
  load-bearing for this reason, not just for tractability.
- **Determinism under Playwright.** `getComputedStyle` normalizes color/layout representation
  (§4.3), but browser engine choice still matters — pin to one engine (Chromium) and one Playwright
  version so replay is byte-identical, mirroring INFBENCH's "same seed →
  byte-identical" bar (`SKILL_BENCHMARK_INFERENCE.md`); Playwright's multi-browser support is a distraction here, not a
  feature to exercise. Property-based test generation (§2.4/§2.5) needs the same seeded-PRNG
  discipline every other bench in this repo already uses, or replay stops being byte-identical too.
- **A synthesized or repaired artifact must stay as auditable as a hand-written one.** The synthesis
  PROCESS may be a nontrivial search; its OUTPUT — a `GOAL_RULE` entry, a repaired or synthesized JS
  function body, an HTML/CSS fragment — must read exactly like something a person would have written
  and committed, with the same review posture as any other PR. No candidate ships un-reviewed merely
  because it passed the verification oracle; the oracle proves consistency with the given examples
  and the equivalence heuristics, not that a human has endorsed the artifact for the codebase's
  actual conventions.
- **Dependency-weight honesty, restated per §5.** Playwright's browser binaries are a real,
  multi-hundred-MB addition to the *dev* tree the moment Track 2, 3, or 4 starts — bigger than
  anything currently in `devDependencies`. This must be a visible, named tradeoff at sign-off time,
  not a quiet `npm install` line.

---

## 8. This is a new capability category — explicit sign-off required, more so with three languages and a repair track

Every **built-in** registry capability **reads** the graph — the `capability()` builder hardcodes
`readOnly: true` with an empty delete-list. Taught action families already cross that line for
world state (`readOnly: false` records with real add/del lists, registered but never
auto-dispatched — grounded by pure simulation). Synthesis is the first
capability that **generates or modifies a source artifact** — a declarative rule in Track 1, a repaired
existing function in Track 2, from-scratch executable JS text in Track 3, markup+styles in Track 4 —
and Tracks 2-4 additionally introduce the first genuinely untrusted-code-execution surface (however
sandboxed) this repo has ever had; Track 2 specifically is the first track that would ever propose
**modifying real, already-shipped source code**, which is a materially different risk class from
generating a new, separate artifact. Track 1 alone is a comparatively small ask (no sandbox, no new
dependency, output is inert JSON-shaped data run by existing trusted code). Tracks 2-4 are a
materially bigger ask, and expanding the scope to three language targets plus a repair track makes
this **more** true, not less: a new heavy devDependency, a real (if sandboxed) code-execution loop,
a verification surface (§4.4) that is honestly fuzzier than anything else this repo measures
deterministically today, a search space (§7) that grows fastest exactly where the verification is
fuzziest, and — for Track 2 specifically — candidates that would touch real shipped code, not just
generate new declarative data. **This plan recommends staging (§6) and recommends the operator
explicitly sign off before any implementation begins — separately per track**, since the four
tracks' cost/risk profiles are not comparable and should not be approved as one bundle; the
three-language expansion plus the repair track are reasons to be *more* deliberate about that
sign-off gate, not less.

### Critical Files for Implementation
- <repo-checkout>/src/router/registry.mjs
- <repo-checkout>/src/router/goal-reasoner.mjs
- <repo-checkout>/src/router/planner.mjs
- <repo-checkout>/src/router/resolver.mjs
- <repo-checkout>/src/router/set-algebra.mjs
- <repo-checkout>/src/router/taught.mjs
- <repo-checkout>/src/router/drive.mjs
- <repo-checkout>/src/planning.mjs
- <repo-checkout>/src/domain.mjs
- <repo-checkout>/src/interpret/normalize.mjs
- <repo-checkout>/synthbench/rules/oracle.mjs
- <repo-checkout>/agentbench/cases.jsonl
- <repo-checkout>/agentbench/grade.mjs
- <repo-checkout>/agentbench/driver-goal.mjs
- <repo-checkout>/test/corpus/planning.jsonl
- <repo-checkout>/package.json
