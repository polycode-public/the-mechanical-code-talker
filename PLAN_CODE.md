# PLAN_CODE.md — non-LLM code generation and transformation in tmct

> **STATUS (re-baselined 2026-07-22).** Track 1 (rule/frame synthesis, `synthbench/`) **SHIPPED
> 2026-07-08**. Tracks 2–4 (JS repair, JS snippet synthesis, HTML/CSS synthesis) remain
> **sign-off-gated designs** (§8) — no implementation exists. The new headline proposal is
> **Track 5 (§3): planning over code states** — a code change as a classical plan whose actions
> are language-neutral transformation operators, materialised per language by an adaptor,
> verified against real tests, with the code graph re-indexed between steps. Track 5 is grounded
> in machinery the repo already ships (the planning lane, the code graph, the Track 1 oracle
> posture) and in the survey of fifty years of non-LLM program transformation in §4. It is also
> sign-off-gated.

**Ground rules.** tmct's constitution: no LLM in the product path, ever (`CLAUDE.md`). Synthesis
and transformation here mean **search + verification over closed grammars and closed operator
catalogues**, never a language model guessing code. LLMs and coding assistants ARE permitted
offline — authoring and curating rule bases, operator catalogues, corpora, and test oracles that
ship as reviewed static data — the same posture as the eval harness. A synthesized or transformed
artifact must read exactly like a hand-written one and passes the same review as any PR. §4's
survey shows this division of labour (assistants author offline, a deterministic engine executes
in the product) is now the visible industry direction, not a private constraint.

---

## 1. Baseline — what exists today (verified against the code, 2026-07-22)

- **`synthbench/`** — Track 1's shipped harness: `phrasing/` (a `PHRASING_FRAMES`
  template-generalization synthesizer over `src/domain/interpret/normalize.mjs`'s frame table)
  and `rules/` (`cases.jsonl`, `enumerate.mjs` — the bounded `GOAL_RULE` field-grammar
  enumerator, `oracle.mjs` — verification through the real engine, `synthesize.mjs` — the CEGIS
  loop). Reproduces both hand-written `GOAL_RULES` byte-for-byte and synthesized one novel rule,
  0% call fabrication, held-out-checked.
- **`src/domain/router/`** — the substrate Track 1 synthesizes into: `registry.mjs` (closed
  `KINDS` — `Symbol`/`Module`/`Class`/`Query`/`Kind`/`Package` — and `PRECOND` vocabularies;
  every built-in capability `readOnly: true`), `goal-reasoner.mjs` (`GOAL_RULES` with two live
  entries, `coverage-invariant` and `cochange-risk-invariant`; `applicableRules`/`goalReason`
  both take an optional `ruleSet` param whose only overriding caller is the synthesis oracle),
  `resolver.mjs` (`backwardChain`), `planner.mjs`, `set-algebra.mjs`, `taught.mjs`
  (`capabilityFromActionRules` — taught action families registered `readOnly: false` but never
  auto-dispatched). Invokable via `tmct plan "<request>"` (`bin/tmct.mjs`), chat's `/plan`, and
  the `./plan` library export.
- **The planning lane** — `src/domain/planning.mjs` (`findActionPath`/`findReachableSet`:
  bounded, cycle-safe BFS over on-demand successors), `src/domain/domain.mjs`
  (`movesFromRules`, `compileGoal`), `src/adapters/memory/core.mjs` (the four taught action-rule
  kinds: `RULE_KIND_ACTION_SIGNATURE`/`_PRECOND`/`_EFFECT`/`_CONSTRAINT`). The Hanoi/
  river-crossing lane in `src/services/chat.mjs` runs the full loop live: taught action
  families, plan moves written as `board@step` snapshots, and a mid-plan write guard that
  refuses base-state mutation while a plan is live. Corpus: `test/corpus/planning.jsonl`.
- **The code graph** — `src/domain/codegraph.mjs` (pure query logic over the typed `entities`
  payload at `.tmct/graph.json`), `src/domain/ask.mjs` (the mechanical NL query engine over a
  loaded graph), `src/adapters/repository-interface.mjs` (versioned contract,
  `INTERFACE_VERSION = "1.1.0"`: 16 services, closed `MISS_REASONS`, OWL-grounded),
  `src/adapters/graph-build.mjs` (`buildEntities` — the reference producer of the graph shape,
  fully implemented, currently exercised only by tests), `ontology/tmct-core.ttl` (code-entity
  classes and predicates, term-aligned with seonix).
- **The code-explorer surface** — rebuilt as a full-viewport IDE shell
  (`src/services/code-explorer-viz.mjs`, `src/surfaces/web/code-explorer-browser-entry.mjs`,
  `scripts/build-code-explorer-bundle.mjs`): title bar, explorer sidebar reading graph edges
  back as sentences, a chat centre whose session seeds BOTH the loaded code graph and the
  general-knowledge bands, status bar. Shipped by the site build and the Electron shell.
- **Parsing is the open gap.** `PLAN_REPO_INDEX.md` (status: RESEARCH/DESIGN, not implemented)
  proposes porting seonix's five language extractors (Python `ast`, JS/TS via the TypeScript
  compiler API, C# Roslyn/tree-sitter, Java JavaParser/tree-sitter) into a producer feeding
  `buildEntities`. Until that lands, every graph tmct operates on is produced elsewhere
  (`docs/adapter-contract.md`: "tmct consumes a code graph"). Track 5's re-index stage names
  this dependency precisely (§3.6).
- **Sandbox inventory** — `playwright` 1.61.1 pinned in `devDependencies`, Chromium installed
  by `npm run e2e:browsers`; product `dependencies` stay `ink`, `react`, `smol-toml`,
  `wink-eng-lite-web-model`, `wink-nlp`. Any harness for Tracks 2–5 lives as a dev-only sibling
  directory (like `synthbench/`), never in `files`/`exports`.

---

## 2. Track 1 (SHIPPED 2026-07-08) — synthesizing a `GOAL_RULE` or `PHRASING_FRAMES` entry

The record, compressed; the code in `synthbench/` is the reference.

- **Shape.** A `GOAL_RULE` is closed data: `focusClass` over the registry's `KINDS`, `modes`
  over `{scoped, global}`, `subGoals` over the topics `backwardChain` can reach, `compose` over
  `set-algebra.mjs`'s three exported ops. Low thousands of candidates, fully enumerable. The
  `PHRASING_FRAMES` warm-up is the same species one order smaller: generalize a varying span
  into a capture group against a closed set of anchor-phrase families.
- **Oracle.** A candidate is DATA run by the SAME trusted engine every hand-written rule runs
  through: clone `GOAL_RULES`, pass via the `ruleSet` param, call the real
  `applicableRules`/`goalReason`, value-compare `calls`/`composed`/`proof` to static `expect`
  literals (`agentbench/grade.mjs`'s zero-fabrication posture — compare to pinned literals,
  never re-derive). No sandbox: no untrusted code ever executes.
- **CEGIS.** A failing example is a counter-example that prunes the enumeration on the next
  pass. Exit bar met: a novel rule synthesized at 0% fabrication against held-out examples,
  fields reading as a plausible hand-authored entry.

One backward-compatible product change shipped with it: the `ruleSet` param on
`goalReason`/`applicableRules`, default preserving every existing caller.

This track is the repo's local proof of the survey's central claim (§4): a closed grammar plus
a trusted verification oracle turns "code generation" into bounded search, with no model in the
loop. Track 5 generalizes exactly this posture from router data to code.

---

## 3. Track 5 (headline proposal, sign-off-gated) — planning over code states

The operator's target: use the classical-planning machinery tmct already ships to plan over
**code states**. A code change is a PLAN. Its actions are **language-neutral code
transformations** — operators with preconditions and effects over the code graph. The plan
moves between code states. A language-specific **adaptor** materialises each abstract step into
concrete edits. A **verifier** runs the result through real tests. The graph is **re-indexed**,
and the next step plans from the observed state. Every stage below names which tmct pieces
exist, which are partial, and which are new.

### 3.1 The state: code-graph snapshots, deltas as effects

The planning state is the typed `entities` payload the repo already queries — modules, classes,
functions, and the `imports`/`calls`/`contains`/`defines`/`tests` edges
(`codegraph.mjs`/`repository-interface.mjs`), plus the verification status of the working tree
(which test tiers are green). An action's **declared effect is a graph delta**: entity adds/
removes and edge adds/removes, exactly the add/del effect lists taught action families already
carry (`RULE_KIND_ACTION_EFFECT`, `src/adapters/memory/core.mjs`). Plan search projects
snapshots without touching the base state, the same way the Hanoi lane projects `board@step`
snapshots and guards the base against mid-plan mutation (`src/services/chat.mjs`'s mid-plan
write guard). The state key for cycle detection canonicalizes the graph delta, not the source
text — two orderings of independent steps that reach the same graph are one state.

Exists today: the action-rule kinds, `findActionPath` over projected snapshots, the @step
snapshot pattern, the mid-plan guard. Partial: a canonical state key for graph-shaped states
(`planning.mjs`'s `defaultStateKey` JSON-stringifies; a graph state needs sorted, delta-based
canonicalization). New: the graph-delta effect vocabulary itself (a closed set of
add/del-entity, add/del-edge, retitle-entity effect tokens over the ontology's classes and
predicates).

### 3.2 The operator catalogue: transformations as taught action families

Each transformation operator is one taught action family, slot for slot:

| Action-rule slot | For a code transformation |
|---|---|
| signature | the graph shape it applies to ("a function entity contained by a module") |
| precondition | applicability as graph predicates — Opdyke's behavior-preservation preconditions (1992), machine-checked against the graph: rename requires no name collision in scope; move requires the move not create an import cycle; inline requires a single definition and no recursion at the site |
| effect | the graph delta (§3.1), deterministic and declared before execution |
| constraint | the standing goal-state constraint: every currently-green test stays green |

The starting catalogue, drawn from the refactoring literature's settled core (Opdyke 1992;
Fowler 1999) plus the semantic-patch family (§4.4): **rename**, **extract-function**,
**inline**, **move** (entity between modules), **wrap** (guard/decorator around a call
boundary), **add-parameter** (with default, call sites updated), **delete-dead** (no inbound
`calls`/`imports` edges), **split-module**, and **apply-semantic-patch** (a taught
pattern→replacement pair, comby/ast-grep-shaped, promoted to a first-class operator so
project-specific transformations join the same catalogue without new engine code). Operators
are TAUGHT — authored offline (by the operator, or by a coding assistant whose output is
reviewed and committed like any rule data), stored as action-rule facts, never hardcoded. This
is Draco/KIDS/PAR's rule-base architecture with the historical authoring bottleneck paid by
assistants (§4.10).

Exists today: the taught-action-family machinery end to end (`taught.mjs`,
`capabilityFromActionRules`, teach-and-plan through chat). New: the catalogue content, and the
signature/precondition vocabulary extended from world-state facts to graph predicates (the
`PRECOND` pattern in `registry.mjs` is the template: a small closed predicate vocabulary,
resolver-checked).

### 3.3 The planner: bounded BFS to a graph-predicate goal

The goal is a graph predicate set, same species as `compileGoal`'s goal specs: "function
`parseRow` lives in `src/parse.mjs`; every former call site imports the new path; tests stay
green." `findActionPath` searches operator applications over projected graph snapshots, bounded
depth, shortest plan first, honest miss on exhaustion — no new search engine. Precondition
pruning does the real work (never propose a rename into a collision; never move into a cycle),
exactly as it does for Hanoi.

Where **e-graphs and equality saturation** (§4.7) enter: two plan prefixes that reach
equivalent graph states should merge, and semantically-equal materialisations of one abstract
step form an equivalence class. An e-graph over abstract code states — egg/egglog-style, with
deterministic cost-based extraction — is the natural upgrade path when the operator catalogue
grows past what plain BFS with a canonical state key handles. Not stage-1 machinery; named here
so the state representation (deltas, canonical keys) is chosen to be e-class-friendly from the
start.

Exists today: `findActionPath`, `compileGoal`, the honest-miss discipline. New: goal predicates
over graph shape; later, the e-graph layer.

### 3.4 The adaptor: language-specific materialisation

An abstract step ("rename `f` to `parseRow` in module `m`") is language-neutral. The
**adaptor** turns it into concrete edits for one language: for JS, the list of exact text
edits across the defining module and every importer, computed from the graph's own edge set.
The adaptor is deterministic given (abstract step, graph, source text). One adaptor per
language; JS first, since the repo, its fixtures, and its test estate are JS. The adaptor's
contract mirrors `repository-interface.mjs`: a versioned, typed service with closed miss
reasons ("site not found", "source drifted since index") rather than best-effort edits.

**The jittering question, both readings designed.** The operator's phrase "possibly jittering
at that stage" admits two readings:

- **(a) Bounded variation among semantically-equal materialisations, verifier-selected.** The
  adaptor emits an ORDERED list of k candidate spellings of the same abstract edit (declaration
  vs arrow form, import placement, formatting variants), and the verifier takes the first that
  passes all tiers. Deterministic: the candidate order is fixed by the adaptor, the selector is
  the verifier, nothing is ever random in the product. Equality saturation gives this its
  formal footing — the candidates are one e-class, extraction is cost-ordered.
- **(b) Just-in-time materialisation.** The plan stays abstract until execution. Each step is
  materialised only when reached, against the freshly re-indexed graph — so drift between the
  planned snapshot and the observed state is caught at materialisation time, and the loop
  replans instead of editing against a stale picture.

**Recommendation: build (b) first; add (a) later inside the adaptor.** Reading (b) is
structural — it IS the plan-act-observe-replan loop the repo already runs for hidden state
(`PLAN_GUESS_NUMBER.md`'s posture, restated for Track 2 in §6.2), and it is what makes the
mid-plan re-index (§3.6) safe rather than decorative. Reading (a) is an adaptor feature, not a
loop change: it needs (b)'s verifier-in-the-loop to exist before "verifier-selected" means
anything, and until the catalogue is big enough for spelling variants to matter, k=1 is the
right k. Both readings keep the product deterministic; neither ever samples.

Exists today: nothing edits source (by standing policy, tmct only reads). This stage is the
new capability category §8 gates. Partial precedent: `src/adapters/source-slice.mjs`
locates source ranges for entities, which is the read half of site location.

### 3.5 Verification tiers

Track 1's oracle posture, extended: run candidates through the real, unmodified engine — here,
the real toolchain and the real test suite, never a simulation of them.

| Tier | Check | Cost |
|---|---|---|
| 0 | the edited file re-parses (the adaptor's own parser pass) | ms |
| 1 | re-index, then compare **observed** graph delta to the step's **declared** effect — the predicted-vs-actual ledger, per step | sub-second |
| 2 | blast-radius tests: the tests reachable from the touched entities via the graph's own `tests`/`calls` edges (the graph makes "blast radius" computable instead of judged) | seconds |
| 3 | the fixture repo's full suite, at plan completion | as costed |

Tier 1 is the code-state version of the asymmetry §6.2 names: source effects are declarable,
behavioral effects are only observable. A tier-1 mismatch (the edit changed graph shape beyond
its declared delta) aborts the plan and replans from observed state — a miss, never a guess.
GumTree-class tree diffing (§4.9) is the candidate instrument if tier 1 needs finer grain than
graph-delta comparison.

Exists today: the test estate and blast-radius discipline (`CLAUDE.md`), the
predictions-vs-actuals ledger pattern (chatbench). New: the tier harness itself.

### 3.6 Re-index, then plan the next step

After a verified step, the graph is rebuilt from the edited source and the next step plans from
the OBSERVED state. This is where `PLAN_REPO_INDEX.md` becomes Track 5's direct dependency: the
ported JS/TS extractor feeding `buildEntities` (`graph-build.mjs` — implemented, zero callers
today) is the re-index engine. Sequencing: the JS extractor alone unblocks Track 5's milestone;
the other four languages follow `PLAN_REPO_INDEX.md`'s own schedule. Until any extractor lands,
a stage-0 harness can re-index by regenerating the fixture graph with the same external
producer that built it — workable for the demo graph, not for the milestone below, which
should demonstrate the real loop.

### 3.7 First end-to-end milestone (small enough to demo)

**A planned two-step refactor on a small JS fixture repo, materialised through the JS adaptor,
verified by the fixture's own test suite, graph re-indexed between steps.** Concretely, on a
fixture shaped like `examples/mini-webapp`: step 1 **rename** a function with two call sites;
step 2 **move** it to a sibling module, importers updated. The demo artifact is the plan
receipt, `tmct plan`-style: the goal predicate, each step's operator, its checked
preconditions, its declared vs observed graph delta, and the tier results — ending with the
fixture suite green and the graph's answer to "where is `parseRow` defined" reflecting the
move. Exit bar: byte-deterministic re-run (same fixture, same catalogue, same plan, same
edits), honest miss demonstrated on a poisoned variant (a collision that fails rename's
precondition), and one mid-plan drift demonstrated and caught by tier 1.

Staging within the milestone: (i) effect vocabulary + canonical state key; (ii) catalogue of
two operators as taught families; (iii) planner goal predicates; (iv) JS adaptor for those two
operators; (v) verification tiers 0–3 on the fixture; (vi) re-index via the ported JS
extractor; (vii) the receipt. Each is separately testable; none touches tmct's own product
`dependencies`.

---

## 4. The survey — fifty years of non-LLM program generation and transformation

What each family does, where it went, and — the question this survey exists to answer — which
historical stalls are revivable now that coding assistants and abundant compute can author and
curate the rule bases, oracles, and corpora that were the bottleneck. Bibliography in §9.

### 4.1 Transformational programming (1970s–90s)

Burstall & Darlington (1977) refined clear specifications into efficient programs via
meaning-preserving rewrite rules plus strategies guiding their application. CIP (Munich,
1985) built an entire wide-spectrum language around the idea. Draco (Neighbors, 1980) organized
it by DOMAIN: a library of domain languages and transformation catalogues, reuse through
refinement. KIDS and Specware (Kestrel) mechanized algorithm design from algebraic
specifications; Specware still exists. The Programmer's Apprentice (Rich & Waters, MIT,
1976–91) represented programs in a language-independent **plan calculus** over a curated
library of clichés — the closest historical ancestor of Track 5's language-neutral operator
layer. **Why it stalled:** every system needed a hand-authored knowledge base (rules, domain
theories, cliché libraries) whose construction cost outran its payoff — the knowledge-
acquisition bottleneck, named as such at the time — plus search guidance that only experts
could supply. **Revivability: high, and it is the thesis of this plan.** The artifacts these
systems starved for (catalogues, preconditions, domain theories) are exactly what assistants
now author cheaply offline, and what a deterministic engine can execute exactly as these
systems intended. The plan calculus's language-independence + per-language materialisation is
Track 5's architecture, re-based on a graph the repo already ships.

### 4.2 Deductive and planning-based synthesis (1969–)

Green (1969) framed synthesis as theorem proving; Manna & Waldinger (1980) made it a deductive
tableau where the proof's constructive content is the program. **Why it stalled:** proof burden
and limited automation; it survives where solvers got strong — Leon, Synquid (Polikarpova
2016), Suslik for heap programs. **Revivability: moderate, indirect.** tmct should not prove
programs; it should keep the family's real bequest, the artifact-as-receipt: every Track 5 plan
carries its deduction (preconditions checked, effects declared) the way `tmct plan` already
carries proofs. Planning-based synthesis proper (actions with preconditions/effects over
states) is not stalled at all — it is tmct's shipped Hanoi lane, and Track 5 applies it to
code states.

### 4.3 Term rewriting and transformation languages (1980s–)

ASF+SDF, TXL (Cordy, 1991), Stratego/XT → Spoofax (Visser, 2008–; documentation actively
maintained through 2025), Rascal (Klint et al., 2009–). Programs are terms; transformations
are rewrite rules under explicit strategies. **Where it lives today:** language workbenches,
DSL engineering, research infrastructure — never mass adoption, because each language needed a
grammar and each task a rule set, all hand-authored. **Revivability: high, largely already
happening under a different name.** tree-sitter amortized the grammar cost across languages
once; ast-grep (§4.4) is strategic term rewriting reborn on top of it, with agents now writing
the rules. For tmct the lesson is architectural: rules + strategies separated, rules as data —
which is what taught action families already are.

### 4.4 Semantic patches and codemods (2006–) — the family that never stalled

Coccinelle (Padioleau et al., 2008) applies SmPL semantic patches across the Linux kernel to
this day — C-only, but the proof that a closed patch language plus a deterministic engine
scales to millions of lines. comby (Van Tonder & Le Goues, 2019): language-neutral structural
matching, no per-language parser, at the cost of syntax awareness. ast-grep: multi-language
AST pattern matching/rewriting via tree-sitter, Rust, repo-scale fast; MIT-licensed as of
2026; used by CodeRabbit, Vercel Turbo, Vue tooling. jscodeshift (2015, JS-only) and its 2026
successor JSSG (JavaScript ast-grep). OpenRewrite: **Lossless Semantic Trees** — type-attributed,
format-preserving — and a 10,000+ recipe library across 10+ languages (Java-centric,
expanding); recipes are deterministic and repeatable by design; per-language LSTs, not
language-neutral. Language-neutral vs per-language, plainly: comby is neutral (textual-
structural), ast-grep is multi-language via per-grammar tree-sitter, Coccinelle/jscodeshift are
single-language, OpenRewrite is per-language with deep semantics. **This family is today's
industrially winning non-LLM transformation technology**, and its July-2026 state (§4.11) is
the strongest external validation of tmct's constitution available.

### 4.5 Refactoring theory (1991–)

Griswold (1991) automated meaning-preserving restructuring; Opdyke (1992) defined refactorings
as operations with **behavior-preservation preconditions** — some undecidable in general,
checked conservatively; Fowler (1999) catalogued them into the vocabulary every IDE ships.
**Where it lives:** every IDE's rename/extract/move, executed deterministically millions of
times a day — the quiet, total victory of non-LLM transformation. **Revivability: not needed;
adoption is the point.** Track 5's catalogue (§3.2) IS Opdyke's preconditions re-expressed as
graph predicates in taught action families.

### 4.6 Graph rewriting on program graphs (1990s–)

PROGRES, GrGen.NET, and the plan calculus treated programs as graphs and transformations as
graph rewrite rules with application conditions. **Why it stalled:** schema and rule authoring
cost, and competition from tree-based tools closer to source text. **Revivability: high for
tmct specifically** — tmct already owns an OWL-typed program graph and queries it; Track 5's
effects-as-graph-deltas is graph rewriting with the schema cost already paid by
`tmct-core.ttl`.

### 4.7 E-graphs and equality saturation (2009–) — an open frontier

Peggy (Tate et al., 2009) introduced equality saturation for optimization; egg (Willsey et
al., POPL 2021) made e-graphs fast and extensible; egglog (Zhang et al., PLDI 2023) unified
them with Datalog. Ruler (Nandi et al., OOPSLA 2021) and Enumo (OOPSLA 2023) **infer rewrite
rules automatically** — the rule base authored by search itself, validated by SMT/fuzzing:
5.8× smaller rulesets 25× faster than the CVC4-based approach, matching domain experts in an
end-to-end study. 2025–26: DialEgg (CGO 2025) drives MLIR optimization dialect-agnostically
through egglog; contextual/relational equality saturation extends conditioning on term
position; egglog runs inside industrial mathematical-optimization tooling (JijModeling, 2026).
**Never stalled — currently compounding.** For Track 5: the equivalence structure for both
plan-state merging and adaptor variation (§3.3, §3.4a), and Ruler's pattern (rules inferred,
solver-validated, human-reviewed) is a second non-assistant route to growing the operator
catalogue.

### 4.8 Superoptimization and solver-aided synthesis (1987–)

Massalin (1987) brute-forced shortest instruction sequences; STOKE (Schkufza et al., 2013)
made the search stochastic; Souper (Sasnauskas et al., 2017) synthesizes LLVM peephole
optimizations with an SMT verifier. Sketch (Solar-Lezama, 2006) and Rosette (Torlak & Bodik,
2013) let a human write the skeleton and a solver fill holes — alive and well (FPGA technology
mapping via sketches, 2024). **Why the pure-search end stalled:** exponential spaces and
verification cost at scale. **Revivability: in progress externally** — 2026 work uses LLMs
offline to generalize Souper-style peepholes and to synthesize equality-saturation strategies,
with solvers still the gate: the author/verify split again. For tmct the transferable posture
is candidate-generation-plus-trusted-verifier, which Track 1 already ships.

### 4.9 PBE, APR, SBSE, and semantic diff (supporting families)

FlashFill (Gulwani, 2011) and PROSE: version-space algebras over closed DSLs, shipped to
hundreds of millions of Excel users — the strongest deployment proof that closed-grammar
synthesis works when the domain is right; Tracks 1/3 are this family. APR: GenProg (2009,
genetic), PAR/TBar (2013/2019, closed template catalogues from human fixes), Nopol (SMT for
conditionals); overfitting named and measured (Qi et al., 2015; Smith et al., 2015); random
search competitive with genetic (Qi et al., 2014) — the space definition matters more than
the strategy. Track 2 (§6) is grounded here, and the field's current LLM tilt does not retire
the template catalogues: TBar remains the reference baseline. SBSE/genetic improvement:
GIN v2 and PyGGI 2.0 keep language-independent mutation search alive; refactoring-as-search
has industrial case studies (ToSEM 2016). Semantic diff: GumTree (Falleri et al., 2014;
scaled and improved ICSE 2024), Difftastic, diffsitter, RefactoringMiner-based AST diffing
(ToSEM 2024) — instrumentation for Track 5's tier-1 declared-vs-observed check.

### 4.10 The revivable dead-ends, summarized

One stall recurs across §4.1, §4.3, §4.6, and APR's template family: **the knowledge was the
bottleneck, not the engine.** Transformation catalogues, domain theories, cliché libraries,
grammars, fix templates, oracles, labeled corpora — all hand-authored, all expensive, each
system dying or plateauing when its knowledge base stopped growing. That cost has now
collapsed: coding assistants author rules/recipes/operators offline at marginal cost, and
compute makes wide validation (fuzzing, SMT, test sweeps, Ruler-style rule inference) cheap.
The engines these fields built — deterministic, auditable, replayable — were never the weak
part. The revival move is therefore: keep the engines' discipline, refill their knowledge
bases with assistant-authored, human-reviewed, statically-committed data. That is tmct's
existing corpus posture applied to code, and Track 5 is its concrete instance.

### 4.11 The frontier as of July 2026

- **Moderne/OpenRewrite agent-assisted recipe authoring (2026):** CLI-embedded skills let
  Claude Code, Cursor, Copilot, Codex and others author deterministic OpenRewrite recipes; the
  agent proposes, the human guides, the deterministic engine executes at estate scale. Their
  own framing: probabilistic assistants suggest file-by-file, deterministic recipes land
  identically across 100,000 repos.
- **Codemod platform (2026):** campaigns orchestrating multi-step deterministic
  transformations; `npx codemod ai` has an agent write the ast-grep YAML rule, the
  deterministic runtime executes and validates; ESLint's own migrations now ship as codemods
  (ESLint blog, July 2026).
- **ReaComp (arXiv, May 2026):** compiles LLM reasoning traces offline into standalone
  symbolic PBE solvers — no LLM calls at test time, deterministic, 91.3% on PBEBench-Lite,
  beating LLMs with test-time scaling. The clearest published instance of "assistant authors
  the solver, product runs without it."
- **Equality saturation:** DialEgg (CGO 2025), contextual equality saturation, egglog in
  industrial optimization tooling (2026), LLM-guided strategy synthesis for equality
  saturation (arXiv 2026) — strategies proposed offline, saturation engine deterministic.
- **Peephole generalization (arXiv 2026):** LLMs generalize solver-verified superoptimizer
  rewrites into reusable compiler rules — again offline authoring, solver gate.

The pattern across all five: the industry is converging on the split tmct adopted by
constitution — models author and curate offline; deterministic, reviewable engines execute in
the product. tmct is not swimming against the current here; it is early to the destination.

---

## 5. Track 2 (sign-off-gated) — goal-directed program repair: planning over mutation actions (JS)

Design retained from the 2026-07-16 revision, compressed. Start from an existing function plus
a target expressed as test executions (failing tests to flip, green set to keep). This is APR,
the easier problem: real fixes are small local deltas (Purushothaman & Perry, 2005).

- **Frame (§4.9 grounding):** goal state = `pass(<test-id>)` set + regression constraint.
  Actions = a closed PAR/TBar-style mutation-template catalogue, each template one action-rule:
  signature (AST shape), precondition (site inside the fault region — the coverage of the
  failing tests), declared effect (the source edit, deterministic), predicted effect (which
  tests flip — a ranking prior, never trusted), constraint (green stays green).
- **The declarable/observable asymmetry:** the source effect of a mutation is fully declarable;
  the behavioral effect is only observable (Rice). So the loop is plan → act → observe (run
  tests sandboxed) → fold in (cache the observed test vector; demote priors that missed) →
  replan — the same closed loop as `PLAN_GUESS_NUMBER.md`'s hidden-state design, with a
  predicted-vs-actual ledger per step.
- **Scoring:** three combined equivalence signals, each an approximation and stated as such —
  AST edit distance (Zhang & Shasha, 1989) plus cheap complexity pre-filters; behavioral
  distance under seeded property-based inputs (fast-check-style); mutation-template symmetry
  (bounded by the equivalent-mutant undecidability, Budd & Angluin, 1982).
- **Overfitting mitigations, mandatory:** the regression set inside the goal state, and
  mutation-testing validation (DeMillo/Lipton/Sayward, 1978; DiffTGen's lesson) — a candidate
  that survives deliberate breakage is overfit and rejected.
- **Search:** HTN-style decomposition per failing test + greedy best-first at bounded depth; a
  persisted transposition table keyed by AST content hash doubles as the observation cache,
  with dependency-tracked invalidation that fails closed. Calibration: random search rivals
  genetic on real APR benchmarks (Qi et al., 2014) — the space definition is the work.
  Planning's contributions are decomposition, precondition pruning, and receipts.
- **Sandbox:** Playwright (§7).

Track 5 and Track 2 are siblings: Track 2 plans over behavior-changing mutations where effects
are half-observable; Track 5 plans over behavior-preserving transformations where effects are
declarable as graph deltas. Track 5's tier-1 check and Track 2's predicted-vs-actual ledger
are the same instrument.

## 6. Tracks 3 and 4 (sign-off-gated) — from-scratch JS and HTML/CSS synthesis

Compressed; specs and staging retained in git history (this file, pre-2026-07-22) and
re-expanded at sign-off if these tracks proceed.

- **Track 3 — pure-JS snippets from I/O examples.** Classic PBE over closed operator families
  (arith, compare/ternary, string, array), bottom-up enumeration depth-capped at
  single-expression bodies; case shape `{id, kind, signature, grammar, examples, heldOut}`;
  held-out examples checked only after all given examples pass; smallest-AST tie-break.
  Verified by `page.evaluate` in Playwright: value-compare outputs, prune on throw/timeout.
- **Track 4 — HTML/CSS fragments from structural/visual specs.** Enumerate only the
  tag/property vocabulary the spec's own `structure`/`computedStyle` assertions declare;
  verify by rendering: `page.setContent` + `addStyleTag`, existence/tag per selector,
  `getComputedStyle` for canonical value comparison. Exit bar excludes pixel/layout exactness:
  viewport, sub-pixel, and font-metric variance break the repo's byte-identical-replay
  determinism bar, so screenshot diffing needs a determinism design of its own before any
  track adopts it. Staged last; its combinatorics grow fastest.

## 7. The sandbox

Unchanged verdict, restated. Track 1 and Track 5's planning/enumeration need no sandbox
(candidates are data through trusted code; plan search is pure projection). Tracks 2/3/4 —
and Track 5's verify stage when it runs a fixture's test suite — execute candidate-influenced
code, and Playwright is the unified answer: real OS-process isolation, one environment that
runs JS (`page.evaluate`), renders DOM/CSS (`page.content`, `getComputedStyle`), already
pinned (1.61.1) in `devDependencies` with Chromium installed by the e2e tier — no new
dependency, but a NEW USE of an existing one (running code the search wrote), which is part of
what §8 gates. Track 5's tier-2/3 test runs execute the fixture's own suite via its own runner
in a subprocess, the mildest form of this surface, named at sign-off all the same.

## 8. Sign-off gates — per track, not as a bundle

Every built-in registry capability reads the graph (`readOnly: true`, hardcoded). Taught action
families cross that line for world state only, never auto-dispatched. Synthesis and
transformation are the first capability category to generate or MODIFY source artifacts — a
first for the product's ethos, not an incremental feature. The tracks' risk profiles differ
and are approved separately:

| Track | The ask | Sandbox | New surface |
|---|---|---|---|
| 1 | shipped 2026-07-08 | none | none (data through trusted code) |
| 5 | plan + materialise + verify + re-index over a FIXTURE repo | subprocess test runs | first source-editing capability (adaptor); depends on PLAN_REPO_INDEX's JS extractor |
| 2 | mutate REAL existing functions to flip tests | Playwright | candidate code execution; edits to shipped source |
| 3 | from-scratch JS snippets | Playwright | candidate code execution |
| 4 | HTML/CSS fragments | Playwright | rendering-based verification, fuzzier than anything measured today |

Track 5's gate is the operator's to open, with its milestone (§3.7) scoped to a fixture repo —
tmct's own source is not a Track 5 target until a separate, later sign-off says so. Risks
carried from the prior revision, all still live: PBE overfitting (held-out checks mandatory);
equivalence signals are approximations, never proofs; search spaces grow with every grammar,
fastest where verification is fuzziest; caches fail closed; no LLM in any search loop, even
dev-only, because a harness that ships artifacts into `src/` is transitively the product path;
determinism pinned (one engine, one Playwright version, seeded PRNGs); every output as
auditable as hand-written code, reviewed like any PR.

## 9. Bibliography

Historical families:
- Burstall & Darlington, "A Transformation System for Developing Recursive Programs", JACM 1977. https://dl.acm.org/doi/10.1145/321992.321996
- Bauer et al., The Munich Project CIP, LNCS 183, 1985.
- Neighbors, "The Draco Approach to Constructing Software from Reusable Components", 1984.
- Smith, "KIDS: A Semiautomatic Program Development System", 1990; Kestrel Specware. https://www.slideserve.com/mya/mechanized-algorithm-design-in-kids-specware-and-planware
- Rich & Waters, "The Programmer's Apprentice: A Research Overview", IEEE Computer 1988. https://dspace.mit.edu/handle/1721.1/6054
- Green, "Application of Theorem Proving to Problem Solving", IJCAI 1969.
- Manna & Waldinger, "A Deductive Approach to Program Synthesis", TOPLAS 1980. https://dl.acm.org/doi/10.1145/357084.357090
- Cordy, TXL, 1991–; Visser, Stratego/XT 0.17, 2008 (Spoofax docs maintained through 2025). https://spoofax.dev/background/stratego/
- Klint, van der Storm, Vinju, "RASCAL: A DSL for Source Code Analysis and Manipulation", SCAM 2009. https://www.researchgate.net/publication/220703689
- Opdyke, "Refactoring Object-Oriented Frameworks", PhD thesis, UIUC 1992. https://www.laputan.org/pub/papers/opdyke-thesis.pdf
- Griswold, "Program Restructuring as an Aid to Software Maintenance", PhD thesis, UW 1991.
- Fowler, Refactoring, 1999.
- Massalin, "Superoptimizer: A Look at the Smallest Program", ASPLOS 1987.
- Schkufza, Sharma, Aiken, "Stochastic Superoptimization" (STOKE), ASPLOS 2013.
- Sasnauskas et al., "Souper: A Synthesizing Superoptimizer", 2017. https://arxiv.org/pdf/1711.04422
- Solar-Lezama, Sketch, 2006; Torlak & Bodik, Rosette, 2013. https://docs.racket-lang.org/rosette-guide/ch_essentials.html
- Polikarpova et al., Synquid, PLDI 2016; Leon deductive synthesis/repair. https://arxiv.org/pdf/1611.07625
- Gulwani, "Automating String Processing in Spreadsheets" (FlashFill), POPL 2011; Microsoft PROSE.
- Weimer et al., GenProg, ICSE 2009; Kim et al., PAR, ICSE 2013; Liu et al., "TBar: Revisiting Template-based Automated Program Repair", ISSTA 2019. https://dl.acm.org/doi/10.1145/3293882.3330577
- Qi et al., "The Strength of Random Search on Automated Program Repair", ICSE 2014; Qi et al., 2015 and Smith et al., 2015 (patch overfitting); Xin & Reiss, DiffTGen, ISSTA 2017.
- Xuan et al., Nopol (SMT-based condition repair), TSE 2016.
- Zhang & Shasha, tree edit distance, SIAM J. Comput. 1989; DeMillo, Lipton & Sayward, mutation testing, 1978; Budd & Angluin, equivalent mutants, 1982.
- Falleri et al., GumTree, ASE 2014; "Fine-grained, Accurate and Scalable Source Differencing", ICSE 2024. https://dl.acm.org/doi/10.1145/3597503.3639148
- AST diff benchmark and refactoring-aware differ, ToSEM 2024. https://dl.acm.org/doi/10.1145/3696002
- Erol, Hendler & Nau, HTN planning, 1994; Cheeseman, Kanefsky & Taylor, phase transitions, IJCAI 1991; Acar et al., self-adjusting computation, 2002; Hammer et al., Adapton, PLDI 2014.
- Padioleau et al., "Documenting and Automating Collateral Evolutions in Linux Device Drivers" (Coccinelle), EuroSys 2008.
- Van Tonder & Le Goues, "Lightweight Multi-language Syntax Transformation with Parser Parsing Combinators" (comby), PLDI 2019. https://comby.dev

E-graphs and rule inference:
- Tate et al., "Equality Saturation: A New Approach to Optimization" (Peggy), POPL 2009.
- Willsey et al., "egg: Fast and Extensible Equality Saturation", POPL 2021. https://dl.acm.org/doi/10.1145/3434304
- Zhang et al., "Better Together: Unifying Datalog and Equality Saturation" (egglog), PLDI 2023. https://dl.acm.org/doi/abs/10.1145/3591239
- Nandi et al., "Rewrite Rule Inference Using Equality Saturation" (Ruler), OOPSLA 2021. https://arxiv.org/abs/2108.10436 — and Enumo, OOPSLA 2023.
- "DialEgg: Dialect-Agnostic MLIR Optimizer using Equality Saturation with Egglog", CGO 2025. https://dl.acm.org/doi/abs/10.1145/3696443.3708957
- Contextual/relational equality saturation, e-graphs community, 2025. https://egraphs.org/meeting/2025-08-21-dialegg

The 2025–2026 frontier:
- Moderne, "AI-Powered Recipe Authoring with Agent Skills and OpenRewrite", 2026. https://moderne.ai/blog/ai-powered-openrewrite-recipe-authoring-with-claude-skill
- OpenRewrite docs: Lossless Semantic Trees; Recipes. https://docs.openrewrite.org/concepts-and-explanations/lossless-semantic-trees
- "The Open Source, Deterministic Engine Maintaining Java's Next 30 Years", JAVAPRO, 2026-02-04. https://javapro.io/2026/02/04/the-open-source-deterministic-engine-maintaining-javas-next-30-years/
- Codemod platform + JSSG (JavaScript ast-grep), 2026. https://github.com/codemod/codemod ; https://codemod.com/blog/jssg
- ESLint, "Automating ESLint migrations with Codemod", 2026-07. https://eslint.org/blog/2026/07/eslint-codemod-migrations/
- ast-grep tool comparison. https://ast-grep.github.io/advanced/tool-comparison.html
- "ReaComp: Compiling LLM Reasoning into Symbolic Solvers for Efficient Program Synthesis", arXiv 2605.05485, 2026. https://arxiv.org/abs/2605.05485
- "LLM-Guided Strategy Synthesis for Scalable Equality Saturation", arXiv 2604.17364, 2026. https://arxiv.org/pdf/2604.17364
- "Leveraging Large Language Models for Generalizing Peephole Optimizations", arXiv 2603.18477, 2026. https://arxiv.org/pdf/2603.18477
- Gin v2 (genetic improvement microframework); PyGGI 2.0, ESEC/FSE 2019. https://github.com/gintool/gin

### Critical files for implementation

- <repo-checkout>/src/domain/planning.mjs
- <repo-checkout>/src/domain/domain.mjs
- <repo-checkout>/src/adapters/memory/core.mjs
- <repo-checkout>/src/domain/router/registry.mjs
- <repo-checkout>/src/domain/router/goal-reasoner.mjs
- <repo-checkout>/src/domain/router/planner.mjs
- <repo-checkout>/src/domain/router/resolver.mjs
- <repo-checkout>/src/domain/router/set-algebra.mjs
- <repo-checkout>/src/domain/router/taught.mjs
- <repo-checkout>/src/domain/codegraph.mjs
- <repo-checkout>/src/domain/ask.mjs
- <repo-checkout>/src/adapters/repository-interface.mjs
- <repo-checkout>/src/adapters/graph-build.mjs
- <repo-checkout>/src/adapters/source-slice.mjs
- <repo-checkout>/src/domain/interpret/normalize.mjs
- <repo-checkout>/synthbench/rules/oracle.mjs
- <repo-checkout>/agentbench/grade.mjs
- <repo-checkout>/test/corpus/planning.jsonl
- <repo-checkout>/PLAN_REPO_INDEX.md
- <repo-checkout>/package.json
