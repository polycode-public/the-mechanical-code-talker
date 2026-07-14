# PLAN_HANOI.md — a goal-directed planning loop for tmct, validated against Towers of Hanoi

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code. Phase 2's
search kernel (`findActionPath`, `src/planning.mjs`) shipped as a standalone proof-of-mechanism —
see the dated entry at the end of this document — but Hanoi's own state/legal-moves/goal (Phases
1/3/4) are still unbuilt. The 2026-07-15 proposal at the end of this document supersedes Phases
1/3/4 with a revised phasing (1R-5R): the game domain is defined in chat sentences (or a text file
via `tmct import --file`), a generic interpreter replaces the hard-coded Hanoi module, and the plan
renders as an animated, self-contained HTML page.

**A different, already-live planning capability, for contrast.** `src/router/*` is a SEPARATE
STRIPS/PDDL planner — not this document's design, and not built from it — that composes and
executes read-only graph-query tool calls (search/describe/impact/members/…) for a compound or
maintenance-goal request over a repo's code graph. It shipped separately and is now invokable
directly: `tmct plan "<request>"`, chat's `/plan`, or the `./plan` library export (see
`CAPABILITIES_1.7.3.md` row 99, `PLAN_AGENTS.md` §1.3). It answers questions like "of the modules
impacted by X, which are untested" — a genuinely different domain (querying an existing, static
code graph) from this document's (searching a MUTABLE Hanoi board state via `legalMoves`/`applyMove`).
Worth knowing about since it's the router the router doc terminology below (STRIPS, backward
chaining, closed-world) also describes — don't confuse the two when reading either document. The
2026-07-15 section below plans their convergence at the operator-model level (a registry
registration seam); the two search engines stay distinct.

## Origin

2026-07-09 session, closing HANDOVER.md's Seonix-backlog follow-ups. The operator's own framing,
verbatim (this is the design target, not a paraphrase):

> Infer the goal, read the relevant sub-graph of the current state, infer the paths to the goal
> by reasoning about the effect of actions on the sub-graph, answer the question: given the goal
> and the current state and the possible paths to the goal, pick the next step, execute, repeat,
> be an agent.

This is a genuine planning/agentic-loop architecture — qualitatively different from every routing
fix landed this session (which map a natural-language phrasing to an EXISTING single-shot
capability). It deserves its own design pass rather than being bolted onto a batch of regex
fixes, hence this standalone doc rather than a HANDOVER.md bullet.

## Why Towers of Hanoi

A deliberately minimal, well-understood benchmark to validate the design against before
attempting anything domain-general:
- Tiny, exact state space (a stack configuration over 3 pegs) — easy to represent as a small OWL
  graph (individuals + relations), matching tmct's own existing graph model.
- A crisp goal predicate ("all disks on peg C, in order") — easy to check for satisfaction against
  a state.
- A small, exact set of legal-move operators (move top disk of peg X to peg Y, if legal) — a clean
  first case for representing ACTIONS as first-class graph-transforming rules, distinct from
  tmct's existing read-only query/traversal machinery.
- A known-optimal solution (2^n - 1 moves) — an unambiguous correctness check for whatever search
  strategy tmct ends up implementing (no "is this answer good" judgment call needed, unlike a real
  code-impact-analysis planning task).
- Zero-LLM constraint stays intact (CLAUDE.md: LLMs are never in the product path) — Hanoi is
  solvable by deterministic state-space search alone, so it's a fair test of whether tmct's
  existing "no-LLM, deterministic" ethos extends to planning, not just to language understanding.

## Research findings — how this composes with tmct's existing code, concretely

### 1. Where Hanoi state should live: the memory store, not the code graph

tmct already has TWO graphs in the exact same on-disk shape (`{individuals, byId, relations,
proseIndex}`, `codegraph.mjs`'s `parseEntities`, `src/codegraph.mjs:27-59`):

- **The code graph** (`.tmct/graph.json`, any `examples/*/.tmct/graph.json`, or anything pointed
  to by `TMCT_GRAPH_FILE`, `src/config.mjs:23-24`) — individuals `{id, label, class, derived_from,
  mentions, attributes}` plus typed `objectProperties` edge groups (`{predicate, prop, edges:
  [{subject, object, subjectLabel, objectLabel}]}`), classified into a CLOSED relation-kind
  vocabulary by `PROP_KIND`/`relationKind` (`src/codegraph.mjs:63-114`: imports/calls/defines/
  tests/touches/contains/inherits/…).
- **The memory store** (`.tmct/memory/graph.json`, `src/memory/core.mjs`) — the SAME payload
  shape (`emptyMemory()`, `core.mjs:94-110`), but purpose-built to be **mutated live, turn by
  turn**, through `appendFact`/`appendUtterance` (`core.mjs:448-488`, `402-409`): fresh-read →
  mutate → atomic write, one call per turn.

tmct has no write path for a code graph (`parseEntities` and every consumer of it only read;
provider files are written by the providers that own them), and several read paths cache against
the assumption that a loaded graph object never changes mid-session
(`inheritsApplicableCache`/`EMB_CACHE`, both `WeakMap`s keyed on graph identity,
`src/ask.mjs:1382`, `src/codegraph.mjs:528`). The memory store is tmct's OWN,
session-local, designed-to-be-written graph.

Hanoi's state changes every turn (a move mutates which peg a disk is on). That single fact
settles the question: **Hanoi state belongs in the memory store, represented as taught facts
(subject/predicate/object triples through `appendFact`), not as an ad-hoc individual set loaded
the way a code graph is.** The code-graph shape is the right SCHEMA to imitate (individuals +
typed edges); the memory store is where the write machinery already exists.

**Concrete sketch** — one Hanoi state as facts (`normFactTerm`/`appendFact`'s own vocabulary,
`memory/core.mjs:428-434`, `448-488`):

```
disk-1 restsOn peg-a
disk-2 restsOn peg-a
disk-3 restsOn disk-2      // disk-3 rests directly on disk-2, which rests on peg-a
peg-a  isPeg   board       // (or: classify disk-N/peg-X individuals via appendFacts' class,
disk-1 isDisk  board       //  or simply by naming convention "disk-*"/"peg-*" — either works;
                           //  a real implementation would add a tiny `class` tag per individual
                           //  the way Utterance/Fact/Session already are, memory/core.mjs:40-43)
```

`restsOn` (disk → peg-or-disk-beneath-it) is deliberately chosen over a flatter `onPeg` (disk →
peg) because it encodes the FULL STACK ORDER for free, in the same "one outgoing edge per node,
walk it to find ancestors/descendants" shape `ask.mjs`'s `directParentsOf`/`ancestorsOf` already
use for `inherits` (`src/ask.mjs:1340-1374`). Legality of "move disk X onto Y" reduces to a pure
graph check with no extra bookkeeping: X has no incoming `restsOn` edge (nothing rests on it — it
is topmost), and Y (a peg, or another disk) either is a peg with no disk on it, or is a disk with
no incoming `restsOn` edge AND is textually/numerically larger than X. This is the SAME shape as
`inheritsApplicable` (`ask.mjs:1382-1393`) checking "does this edge kind connect same-class
individuals" — a new relation kind (`restsOn`) sitting next to `inherits` in spirit. It needs no
declaration anywhere: `appendFact` stores any predicate verbatim, and `MEMORY_VOCABULARY`
(`core.mjs:65-89`) is a documentation table a new predicate can be noted in, not a gate.

### 2. What's reusable for reasoning about action effects — a moderate extension, not a new subsystem, plus one real gap

Everything read-only in `ask.mjs`/`codegraph.mjs` — `ancestorsOf`, `descendantsOf`,
`inheritsApplicable`, `computeFind`'s narrow-then-broaden cascade (`ask.mjs:1352-1509`),
`impactClosure` (`codegraph.mjs:289-341`) — walks a **fixed, already-loaded edge list**. None of
them produce a new edge list; they return sets/paths over one static relation. That is the entire
gap between "what exists" and "what planning needs": **something has to compute the SUCCESSOR
STATE** (apply a legal move, get a new set of `restsOn` edges) — nothing in the codebase does this
today, for any domain. That piece is genuinely new.

But the SEARCH shape planning needs is much closer to existing code than it first looks, thanks
to `src/syllogise.mjs`:

- `deriveSubClassClosure`/`deriveTypePropagation` (`syllogise.mjs:78-192`) are **pure functions
  over edge lists in, NEW edge lists out**, budget- and depth-bounded, deterministically sorted,
  focus-filtered — exactly the functional shape a "apply legal-move operator, get new state" step
  needs. They compute ENTAILMENT (what must follow), not ACTION (one of several things an agent
  MAY choose to do) — a real semantic difference — but the *code shape* (pure, bounded,
  deterministic, edge-list-to-edge-list) transfers directly.
- `findIsaChain` (`syllogise.mjs:273-311`) is closer still: it is **already a bounded, rooted,
  breadth-first PATH search** from one start node to a target set, over pure edge lists, stopping
  the instant a target is reached, returning the shortest chain as an ordered list of premises. In
  shape, this **already is a planner** — "given a start state and a goal set, find the shortest
  path, using the applicable edges" — restricted today to `subClassOf`/`rdf:type` edges that are
  all pre-loaded up front.

The one thing `findIsaChain` assumes that a real planner cannot: that every edge it will ever walk
already exists in the input edge lists. A Hanoi (or any) state-space search must instead GENERATE
each state's outgoing edges on demand, by applying the domain's legal-move function to the current
state — `findIsaChain` has no notion of "compute a successor," only "look one up." Generalizing it
from a closed-edge-list walk to an on-demand-successor walk is a real, novel piece of code (a
`legalMoves(state) -> [ {move, nextState} ]` generator, Hanoi-specific in Phase 1, domain-general
by Phase 4 below) — but the BFS/queue/seen-set/shortest-path/deterministic-tie-break scaffolding
around it is a close cousin of `findIsaChain`'s, not an invention from scratch.

**Assessment: a moderate extension.** Reused as-is or by close analogy: the pure-function-over-
edge-lists discipline, the budget/depth/focus safety-rail convention, the bounded-BFS-to-target
shape, the deterministic-sort-for-determinism convention, the provenance-stamped write path
(§3). Genuinely new: the successor-state generator (the legal-move function itself) and the loop
that calls it repeatedly instead of reading a precomputed relation.

### 3. The write path: `appendFact` is the right primitive for DURABLE facts, wrong (as-is) for MUTABLE state — snapshot-per-step sidesteps the gap

`appendFact` (`memory/core.mjs:448-488`) is **content-addressed and additive**: a fact's id hashes
its full `(subject, predicate, object)` triple, so re-asserting the SAME triple upserts in place,
but asserting a DIFFERENT object for the same `(subject, predicate)` produces a SECOND,
independent Fact individual that coexists with the first — , this is exactly what
`findContradictions` (`memory/core.mjs:622-637`) is built to surface ("two high-trust sources
disagree → show both, never silently pick", per `ROADMAP.md`'s provenance section). (2026-07-15
update: when this section was written, no retraction existed anywhere in the codebase. A scoped
slice has shipped since — `retractSubClassOf`, `src/syllogise.mjs:860`, driven by chat's "forget
that X is a Y" phrasing — but it is subClassOf-specific; there is still no general retraction for
an arbitrary `(subject, predicate)` fact.)

That is a genuine mismatch for "move disk 1 from A to C": naively re-asserting `disk-1 restsOn
peg-c` after previously asserting `disk-1 restsOn peg-a` does NOT retract the old fact — both
would persist, and `findContradictions` would (correctly, given its contract) flag them as
contradictory sources on the same subject/predicate, which is the wrong framing for a value that
is SUPPOSED to change over time (state), as opposed to a durable claim about the world (a taught
fact).

Two ways to close this gap; recommending the second because it needs **zero new primitives**:

1. **Add a retraction primitive** to `memory/core.mjs` (e.g. `retractFact(dir, {subject,
   predicate})` that drops the current `restsOn` edge for a subject before the new one is
   written) — a real, if small, new piece of write-path plumbing, and a new failure mode to get
   right (what if the retract fails but the append succeeds, or vice versa — the existing
   `mutateMemory` fresh-read/mutate/atomic-write cycle, `core.mjs:141-149`, would need the
   retract-then-append to happen inside ONE mutation, which it can, but it is new code, not reuse).
2. **Never mutate a fact in place; append immutable per-step SNAPSHOTS instead.** Each move writes
   a whole new `Board@step<N>` individual (or a small named set of `restsOn` facts scoped to that
   step, e.g. subject terms like `disk-1@step7`) alongside the previous one, never touching it.
   This fits `appendFact`'s additive, content-addressed write model AS IT EXISTS TODAY — no new
   primitive, no retraction semantics to get right — at the cost of one Board's worth of facts
   per move (small for the disk counts Hanoi validates at) and turns the move history into a
   free, already-in-the-house-style audit trail (append-only, provenance-stamped, exactly how
   Utterances already accumulate one per turn, `core.mjs:397-421`).

**Recommendation: start with (2), snapshot-per-step**, specifically because it requires no new
primitive in a store other agents/features also depend on, and because "append, never mutate" is
already this codebase's stated ethos elsewhere (provenance, entailed-fact trust, the Utterance
log). Revisit (1) only if snapshot volume becomes a real problem in a later, larger-state domain
(Hanoi itself, at the disk counts worth demonstrating, will not stress this).

### 4. Composing with the existing "Goal (inferred): …" line — reuse, not a parallel mechanism, for the common case

`chat.mjs`'s Feature B goal line is simpler under the hood than its output suggests: `runAsk`
computes a single mutable string, `deduced` (`chat.mjs:3885`, `deduceGoalFromParsed(envelope?.
parsed)`), notes it into the trace, and then **revises it in place** as later lanes in the
miss-cascade fire and answer the turn a different way than the raw parse suggested — e.g. the
relation-force fix (`chat.mjs:4174-4177`) and the teach-lane fix (`chat.mjs:4216-4217`) both
overwrite `deduced` with a more specific string once THEIR lane, not the original parse, is what
actually answered. Whatever `deduced` holds at the end rides out as `result.goal`
(`withGoalLine`, `chat.mjs:253-269`), which appends `Goal (inferred): {goal}.` — unconditionally,
with no knowledge of WHERE the string came from.

This means a **per-step Hanoi goal line composes as pure reuse, not a new mechanism**, for the
turn-per-move case (a user says "next"/hits enter to advance one move at a time): add a "plan"
lane to the SAME miss-cascade `runAsk` already runs (parallel to the existing teach/author/meta
lanes, `chat.mjs:3904-4246`), which, when a plan is in progress, sets
`deduced = "move disk 1 from A to C (step 3 of 7, working toward: all disks on C)"` and lets
`withGoalLine` render it exactly as today — **zero changes needed to `withGoalLine` or
`renderNarration`**, since both already treat the goal as an opaque string.

The one case this does NOT already cover: a single chat turn that auto-plays the WHOLE solved
plan at once (a transcript of N moves in one answer). `deduced` is one string; it cannot carry N
per-step goals. That case is structurally closer to the OTHER existing mechanism, the full
`--narrate` trace block (`withNarration`, `chat.mjs:214-222`, a list of bucketed lines appended
after the main answer) — a "plan trace" of one line per step would reuse THAT shape (a list, not
a single string) rather than stretching the one-line goal feature to do a job it isn't shaped for.
Recommendation: keep the always-on short goal line as "what step is in progress / what plan is
active", and reuse the narrate-block SHAPE (not the narrate FLAG itself) for an optional
step-by-step trace when a whole plan executes in one turn.

### 5. Search strategy: genuine domain-general search, not a hard-coded closed form — recommendation and reasoning

Hanoi has a well-known closed-form optimal strategy (move N-1 disks A→B via C, move disk N A→C,
move N-1 disks B→C via A) that could be transcribed directly into JS with no search at all. The
operator's own framing — "infer the paths to the goal by reasoning about the effect of actions" —
reads as wanting genuine search, and this document recommends exactly that, for three reasons:

1. **The stated goal is generalization, not Hanoi.** Both this document's "Why Towers of Hanoi"
   section and the Origin explicitly frame Hanoi as "the test harness, not the destination." A
   hard-coded recursive Hanoi strategy demonstrates nothing about the general "read state, reason
   about action effects, find a path" capability being asked for — it is domain trivia dressed up
   as planning, exactly the "looks like it's planning but isn't" risk worth naming explicitly.
2. **tmct already has the right SHAPE of code for real search**, one level down: `findIsaChain`'s
   bounded rooted BFS (§2 above) is structurally the same thing a domain-general planner needs,
   just walking classes instead of states. Lifting that shape to walk STATES (generated by a
   `legalMoves` function) rather than pre-loaded class edges is the natural, in-house-idiom-
   consistent way to build this — not a foreign paradigm import.
3. **The search space is provably small enough that "real search" costs nothing at the scale that
   matters.** Hanoi's state space is 3^N; even N=12 (4096x the disk count of any practical demo)
   is 531,441 states — trivially exhaustible by breadth-first search in milliseconds, no heuristic
   required. There is no performance argument for the shortcut at Hanoi's own validation scale.

**Recommendation: implement (b) — a domain-general, bounded BFS/iterative-deepening state-space
search**, structured as a pure `search(startState, isGoal, legalMoves, {budget, maxDepth})`
kernel modeled directly on `findIsaChain`'s shape (frontier/seen-set/path-carrying/deterministic
tie-break), with Hanoi's `legalMoves`/`isGoal` as the first plugged-in domain. The closed-form
recursive solution should still be WRITTEN, but only ever as a **test oracle** — asserting the
search kernel finds a path of exactly `2^n - 1` moves for `n = 1..~10` — never as the shipped
planning path itself. This keeps the closed-form's genuine value (an unambiguous, well-known
correctness check, exactly why Hanoi was chosen as the validation domain in the first place)
without letting it substitute for the capability actually being built.

A middle ground worth flagging for later (not now): plain BFS explores the WHOLE state space
outward from the start; a heuristic-guided iterative-deepening search (e.g., ranking successor
states by a domain-general "how many disks are already correctly placed" count, computable from
any domain's own state without Hanoi-specific knowledge) would generalize better to larger state
spaces in later, non-Hanoi domains while remaining genuine search rather than a hard-coded answer.
Note this as a Phase 2+ refinement, not a Phase 1 requirement — Hanoi's own scale doesn't need it.

## Phased implementation sketch

*(Following `ROADMAP.md`'s own phase-writing convention: numbered phases, each independently
committable/testable, `npm test` green throughout, nothing here implemented yet.)*

### Phase 1 — State representation spike (Hanoi only; no search, no chat wiring)
- A pure, I/O-free Hanoi state module: `legalMoves(state) -> [{move, nextState}]` and
  `applyMove(state, move) -> nextState`, plus `isGoal(state, goal)` — the genuinely-new piece §2
  identified. Unit-tested directly against small hand-verified boards (N=1..4), no graph
  involvement at all yet.
- A pure `boardToFacts(state, step)` / `factsToBoard(rows, step)` translation pair, targeting the
  snapshot-per-step `restsOn` shape sketched in §1/§3, going through `appendFact`/`readFactRows`
  exactly as any other memory write does — no parallel storage mechanism.
- Exit criterion: a hand-driven sequence of moves for a small N, applied one at a time through
  `appendFact`, round-trips through `readFactRows` back into the same board shape.

### Phase 2 — Domain-general state-space search kernel
- `src/plan.mjs` (name tentative): a pure `search(startState, isGoal, legalMoves, {budget,
  maxDepth})`, modeled on `findIsaChain`'s frontier/seen-set/shortest-path shape (§2), generalized
  from "walk a pre-loaded edge list" to "walk on-demand successor states."
- Hanoi's `legalMoves`/`isGoal` (Phase 1) plugged in as the first domain. Tests assert the
  search finds a path of exactly `2^n - 1` moves for `n = 1..~10`, cross-checked against the
  closed-form recursive solution used STRICTLY as a test oracle (§5) — never shipped as the
  planner.
- Exit criterion: `search()` solves Hanoi optimally for every tested N, is pure/deterministic
  (same inputs → byte-identical move list), and is demonstrably domain-agnostic in its own
  signature (nothing Hanoi-specific inside `plan.mjs` itself).

### Phase 3 — Chat-turn wiring + the goal-line composition
- A new "plan" lane in `runAsk`'s miss-cascade (`chat.mjs:3904-4246`), parallel in shape to the
  existing teach/author/meta lanes: a closed recognizer for a Hanoi-shaped ask ("solve towers of
  hanoi with N disks") triggers Phase 2's `search()` once, and the resulting move list is stored
  as plan state (open question — see risk below on WHERE) alongside the Phase-1 board-snapshot
  chain.
- Each following turn ("next"/"continue"/bare confirmation) applies exactly one queued move via
  the Phase-1 write path, and revises `deduced` to a per-step goal string using the SAME
  mid-cascade-revision pattern the relation-force and teach-lane fixes already use
  (`chat.mjs:4174-4177`, `4216-4217`) — `withGoalLine` itself needs no changes (§4).
- Explicit non-goal for this phase: no general natural-language goal INFERENCE beyond a closed
  recognizer for the one "solve Hanoi"-shaped ask.
- Exit criterion: a full `tmct chat` session can be driven, turn by turn, through a small Hanoi
  solve, each turn's answer carrying an honest, correct, per-step "Goal (inferred): …" line, and
  the final turn confirming the goal state (all disks on the target peg) against the actual
  written facts, not an assumed success.

### Phase 4 — Generalize beyond Hanoi (the operator's actual destination)
- Extract Phase 2's search kernel plus the Phase 1 board-snapshot/fact-translation convention into
  a small, documented "planning domain" contract — `{legalMoves(state), applyMove(state, move),
  isGoal(state, goal)}` — so a second, real domain (candidate: "add a missing test for an
  untested function" as a state-mutating operator over the CODE graph's own `tests`/`defines`
  edges, `codegraph.mjs`'s existing relation vocabulary) can be plugged into the SAME search
  kernel without touching it.
- Converge with `PLAN_GUESS_NUMBER.md`'s closed-loop mechanism wherever the underlying
  state/goal/action/path representation is genuinely shared — Hanoi's search computes a whole
  path up front (open-loop); a closed-loop domain instead re-plans after each new observation.
  The domain contract above should anticipate a "replan after observation" entry point even
  though Hanoi itself never exercises it, so the two docs' mechanisms can converge later without
  a rewrite. Not resolved in this document — flagged for joint follow-up once both docs exist.

## Open risks/questions

- **Search-space blow-up beyond toy scale.** Hanoi's 3^N is tiny; a real code-graph planning
  domain (Phase 4) could have a state space many orders of magnitude larger, where unbounded BFS
  stops being viable and needs either a hard depth/budget cap (in the existing house style —
  `syllogise.mjs`'s `budget`/`depth` convention) or a genuine heuristic (§5's "middle ground").
  Not resolved here; explicitly deferred to Phase 4's first non-Hanoi domain.
- **Goal recognition from free-form natural language.** Phase 3 deliberately scopes this to one
  closed recognizer ("solve towers of hanoi with N disks"). The operator's own framing implies
  recognizing a goal from much more open phrasing eventually — a much harder, and separately
  risky, problem (this project's own house style is deeply skeptical of anything that isn't a
  closed-set/template match, per `CLAUDE.md`'s "templates over general rules" preference) that
  this document does not attempt to solve.
- **Execution confirmation gating.** Should applying a move (or a whole plan) require the same
  kind of explicit confirmation `teachFact`-shaped writes implicitly get (a user's own sentence
  triggers the write; there's no separate "yes, really do it" step today) — or does a plan, once
  computed, execute unattended turn by turn? An honest open question; Hanoi's own zero real-world
  side effects (it's a toy graph, not a live codebase) make it a low-stakes place to prototype
  either answer before Phase 4's real-graph domain has to actually decide.
- **No general fact-retraction primitive exists in `memory/core.mjs`** (2026-07-15 re-check:
  `retractSubClassOf`, `src/syllogise.mjs:860`, shipped after this bullet was first written, with
  chat's "forget that X is a Y" phrasing driving it — but it is subClassOf-specific). §3's
  recommended snapshot-per-step design avoids needing one for Phases 1-3; a future domain that
  wants in-place fact mutation now has the shipped slice as a precedent to generalize rather than
  a blank page.
- **Per-graph-identity caches assume an immutable graph object.** `inheritsApplicableCache` and
  `EMB_CACHE` (`ask.mjs:1382`, `codegraph.mjs:528`) are `WeakMap`s keyed on graph object identity,
  implicitly assuming a loaded graph never changes shape mid-session. The snapshot-per-step design
  sidesteps this (a new snapshot is a new set of facts, not an in-place edit to an already-cached
  graph object) — but it is a real landmine for any future design that considers mutating a
  loaded graph object directly instead.
- **Where does in-progress plan state live between chat turns?** The durable memory graph
  (survives a process restart, gets the same provenance/trust treatment as everything else) vs.
  an ephemeral in-process session object (lost on restart, but avoids growing the permanent graph
  with transient scratch state) is a real design choice with no existing precedent to copy —
  Utterances and Facts both already have an obvious permanent home; a "plan in progress" does not
  obviously belong in either bucket. Needs its own decision before Phase 3 lands.
- **How much of a plan executes per chat turn.** One move per turn (fits the existing single-
  question/single-answer chat shape unmodified) vs. auto-playing several/all moves in one turn
  (needs the narrate-block-shaped multi-line trace sketched in §4) is a real UX choice with no
  existing analog in this single-turn-single-answer codebase — directly determines whether the
  goal-line mechanism alone suffices or the narrate-block shape needs to be reused too.
- **Shared kernel must anticipate closed-loop "replan after observation" even though Hanoi never
  triggers it** (Phase 4/§5's convergence point with `PLAN_GUESS_NUMBER.md`) — a design constraint
  to carry forward, not something this document can validate on its own, since Hanoi's own
  open-loop nature means this path is untestable from Hanoi alone.

## Non-goals for this document

- Not an implementation — no code changes land from this doc alone.
- Not scoped to Hanoi permanently — Hanoi is the validation harness for a general mechanism, not
  a one-off toy feature.
- Not a replacement for HANDOVER.md's ordinary bug-fix backlog — this is a separate, longer-horizon
  initiative, tracked here on purpose so it doesn't get lost or half-built inside an unrelated
  session's routing-fix batch.

## 2026-07-09 (later same day) — Phase 2's search kernel landed, ahead of the phased plan

The generic search kernel this document's §2/§5 scoped for Phase 2 now exists, landed as a
standalone proof-of-mechanism ahead of Phases 1/3/4 below (none of which are started):

- `findActionPath(startState, isGoal, applyActions, { maxDepth, stateKey })`,
  `src/planning.mjs:80` (new file, new sibling of `syllogise.mjs`, NOT a change to
  `findIsaChain` itself — see the file's own header comment for why it lands as an independent
  sibling rather than a shared-code extraction: `findIsaChain`'s edge lists are pre-built once
  into a `Map` before its search loop starts, a real optimization for its own static-edge-list
  domain that doesn't transfer to on-demand successor generation).
- Same discipline as `findIsaChain` (`syllogise.mjs:289-327`): frontier-expansion BFS, a `seen`
  state-key set for cycle safety, check-the-frontier-BEFORE-extending (the exact
  "hop counts the LENGTH of the paths currently in frontier" comment this document quoted in §2
  — carried over verbatim into `planning.mjs`'s own comment, and the off-by-one it once fixed was
  not reintroduced), `maxDepth`-bounded, and a real path returned on success (`{ actions, states
  }`, the full sequence, not just a boolean) or `null` on an honest miss.
- Toy-domain proof (`test/planning.test.mjs`, 6 tests, all passing): a small 5-node fixed graph
  (`S/M1/M2/G/X`) with a dead-end branch and two cycle edges (`M1->S`, `M2->M1`), where the only
  route to the goal is a genuine 3-hop discovery (`S->M1->M2->G`) the search must actually find,
  not assume — plus a second 3-node cycle domain (`P<->Q->Goal`) proving the `seen`-set guard
  both terminates AND still returns the correct shortest path through a cycle sitting directly on
  the route to the goal. Covers: shortest-path success, no-path-at-all (null), budget-exhaustion
  (a real 3-hop path exists but `maxDepth:2` correctly misses it, not a truncated path), and the
  zero-hop start-already-satisfies-goal case.
- Regression: `test/syllogise.test.mjs` (`findIsaChain`'s own suite) reran green, unchanged,
  21/21 — this function was not touched. Full suite: 1355 → 1361 (`npm test`).

**Still missing before real Hanoi could be attempted** (everything else this document scopes,
untouched by this landing):
- Phase 1: the actual Hanoi state representation as memory-store facts (the `restsOn` edge
  convention sketched in §1, `boardToFacts`/`factsToBoard`, the snapshot-per-step write path
  from §3) — none of that exists yet; `findActionPath` itself has no notion of Hanoi, disks,
  pegs, or facts at all,  (it is domain-agnostic, proven only against the toy graph
  above).
- Hanoi's own `legalMoves`/`isGoal` functions (the genuinely-new "successor state generator"
  piece §2 called out) — not written. `applyActions` in this landing's tests is a toy 5-node
  adjacency list, not a disk/peg legality check.
- Phase 4's domain-general extraction/second-domain plug-in and the `PLAN_GUESS_NUMBER.md`
  convergence point — not started.

## 2026-07-15 — proposal: chat-defined game domains, a plan lane, and an animated HTML render surface

### The ask

Operator, 2026-07-15, paraphrased faithfully. Define a game's constructs — its pieces, places,
ordering, and legal actions — entirely in chat sentences, the same way the grandfather chain in
`EXAMPLE_PLAYTEST_LOG.md` teaches kinship. tmct remembers them as ordinary taught facts and Rules.
The same sentences can arrive from a text file through the CLI instead of being typed. A later
single prompt states a start state and a goal in one message. A closed set of plan-requiring
phrasings invokes the planning engine on that prompt. Three surfaces must exist:

1. the JS library (a session turn that returns the plan as data),
2. `npx tmct import --file <game-definition.txt>` (batch-teach the definition),
3. `npx tmct chat --prompt '<state and goal>' --render blocks --output plan.html`.

`plan.html` is a self-contained page. It renders the sub-graph the plan touches, using render
templates keyed to ontology classes, and animates each plan step as the state changes.

### What this changes in the existing phased sketch

Phase 2's kernel is untouched. `findActionPath(startState, isGoal, applyActions, { maxDepth,
stateKey })` (`src/planning.mjs:30`; sibling `findReachableSet`, `:63`) already ships and is
domain-agnostic. What changes is Phase 1: the hard-coded Hanoi `legalMoves`/`applyMove` module it
scoped is dropped. In its place, a data-driven action interpreter reads taught action Rules and
generates successors for ANY domain defined this way. Hanoi ships as a game-definition text file;
the code ships a generic interpreter. Phases 3 and 4 are superseded by the revised phasing below.

The mapping to the reference set is direct (`docs/references/planning/STRIPS_PDDL.md`). The
definition file is the PDDL **domain**: types, predicates, operators. The single prompt is the
**problem**: objects, initial state, goal. tmct's teach pipeline is the NL-to-domain compiler that
reference note anticipates. The closed-world assumption holds by construction, because the taught
facts ARE the whole world.

One placement decision to record explicitly, in two layers. The DURABLE home of a taught action
is the memory store's Rule machinery: a definition is a teaching about the world, and it deserves
provenance, trust, and recall like any other taught thing. The RUNTIME operator model is a
separate question, and `src/router`'s registry is the natural convergence target rather than a
separate world. Its capability records are already the right shape — plain STRIPS data,
`{parameters, preconditions, effects: {add, del}}` (`src/router/registry.mjs`) — and the declared
set is today populated at module load with the read-only graph-query tools, whose effects are
`knows` add-lists. Give the registry a registration seam (a `registerCapability()` the session
calls after loading taught action Rules) and taught actions become capability records beside the
query tools: their effect slots carry world triples instead of `knows` topics, the guardrail's
precondition checking covers game moves with no new gate code, and a later plan can mix query
steps and world actions in one proof chain. The seam is Phase 5R convergence work, not a Phase 1R
dependency; the interpreter consumes the same record shape either way. What does NOT move is the
search engine. The resolver backward-chains each goal to a single achieving capability and never
tracks interacting subgoals, so mutable-state domains (Hanoi is the canonical interacting-subgoal
case) still search forward through `findActionPath`. That split is a property of the two engines,
not of where the operators live. One invariant to respect when the seam lands: parts of the
router assume registered capabilities are read-only (e.g. `guardrail.mjs`'s re-dispatch-per-
candidate enrichment is only safe because dispatch has no side effects), so registered
world-mutating actions must be planned over, never dispatched through that path.

That machinery is already live and already planner-shaped. The grandfather playtest
(`EXAMPLE_PLAYTEST_LOG.md`) teaches compose2/filter Rules through chat and answers "who is the
grandfather of ishmael" with full provenance. At ask time those Rules resolve through the planning
kernel itself: `resolveRelationChase` runs `findActionPath` with a hop-counted goal
(`src/memory/core.mjs:1267`, call at `:1302`), and `resolveRelationChaseReverse` runs
`findReachableSet` (`:1343`, call at `:1389`). The teach → Rule → lazy-chase mechanism this
proposal extends is proven in production, on kinship. Games add a fourth Rule kind and an
interpreter, on the same rails.

### Teaching the domain — what exists, what's missing

Classes and instances need nothing new. "a disk is a kind of game piece" and "peg-a is a peg" go
through the ACE patterns (`parseCopula`/`parseEvery`, `src/grammar/ace.mjs`) exactly as the
playtest's "a father is a kind of parent" does. Taught facts mint predicates freely:
`generalVerbPredicate` produces `mgx:<lemma>` for any verb (`src/chat.mjs:2314`), and
`MEMORY_VOCABULARY` is a documentation table, never an allow-list (`appendFact` stores the
predicate verbatim, `src/memory/core.mjs:1021`).

Two real grammar gaps block the state sentences, both verified against current code:

- `GENERAL_VERB_TEACH_RE` (`src/chat.mjs:2236`) requires a single bare-token subject. "the small
  disk rests on the middle disk" is declined outright (determiner-led, multi-word).
- Prepositions never fold into the predicate. "remember that disk-1 rests on peg-a" WOULD match,
  but stores predicate `mgx:rest` with the literal object "on peg-a". The peg is unreachable as a
  graph node.

Fix: one closed **prepositional-verb teach frame** — "X rests on Y" (and the small family: "sits
on", "is on", "stands on") parses to a single predicate (`mgx:restsOn`) with Y as a clean object
term. This is new Phase-1R work, a sibling of the existing teach recognizers, and it is what makes
the §1 `restsOn` sketch teachable rather than hand-seeded.

A second small frame covers ordering: "disk-1 is smaller than disk-2" → `mgx:smallerThan`. Move
legality needs this total order; three facts define it for a 3-disk game. (Deriving transitivity
through the existing entailment machinery is a nice-to-have, and explicitly out of scope; the
definition file can state all pairs.)

**Actions adopt `PLAN_ADVENTURE.md` Gap 3's `RULE_KIND_ACTION`**. That doc already designs
actions as graph-resident Rule data with precondition and effect slots, stored via `appendRule`
(`src/memory/core.mjs:1194`) next to the three shipped kinds (`RULE_KINDS`, `:1169`;
`RULE_SLOT_SPEC`, `:1180-1184`) and looked up via `findRuleByName` (`:1240`). This proposal
converges the two docs on ONE fourth kind. The adventure doc's slot design gets extended here, in
two ways it did not need for Ashcombe Hall, rather than duplicated:

1. **Typed parameters.** Hanoi's move is parameterised: move ?disk onto ?target, where ?disk
   ranges over class `disk` and ?target over `peg` or `disk`. An action Rule therefore declares
   its variables with their classes, and the interpreter grounds them over the individuals of
   those classes at expansion time. Ashcombe Hall's verbs bind their nouns from the parsed
   command; a planner has no command to bind from, so the declaration must carry the types.
2. **A closed precondition vocabulary of exactly three shapes**: a triple pattern that must hold;
   a triple pattern that must NOT hold (this expresses "nothing rests on the disk", i.e. clear);
   and one comparator against a taught ordering predicate ("?disk smallerThan ?target"). No
   conjunction syntax is needed, because an action simply carries several precondition slots and
   ALL must pass.

Each taught sentence contributes one precondition or one effect, keyed to the action name, so
every sentence stays one-triple-shaped — the same granularity every existing teach frame has. The
closed sentence frames:

```
you can move a disk onto a peg.                       // declares the action + typed parameters
you can move a disk onto a disk.                      // second signature, same action name
to move a disk onto a target, nothing may rest on the disk.
to move a disk onto a target, nothing may rest on the target.
to move a disk onto a disk, the disk must be smaller than the target.
moving a disk onto a target makes the disk rest on the target.
```

Effect semantics: the effect template REPLACES the subject's existing `(subject, predicate)` edge
in the successor snapshot. This is the STRIPS delete-list, handled structurally by §3's
snapshot-per-step recommendation. Each successor state is a fresh set of `restsOn` rows; nothing
is retracted in place, so no general fact-retraction primitive is needed (§3's dated note tracks
what has shipped there).

### State + goal in one prompt

The state half of the prompt is plain teach sentences ("disk-1 rests on disk-2. disk-2 rests on
disk-3. disk-3 rests on peg-a.") written as the step-0 snapshot through `appendFact`, exactly the
§1 shape. The goal is one closed frame: "the goal is that every disk rests on peg-c" (variants:
"the goal is that X rests on Y"). The universal form compiles to a per-individual conjunction over
the taught members of the class, checked against a state's fact rows by a pure `isGoal`.

Where each piece lives, answering this doc's own "where does plan state live" open question:

- **The definition and the step-0 state are durable facts/Rules** in the memory store. They are
  teachings about the world and deserve provenance, trust, and recall like any other.
- **The in-progress plan (computed move list, step cursor, goal) rides a session slot**, following
  `PLAN_GUESS_NUMBER.md` §1's `game`-slot threading design verbatim (a closure variable in
  `createSession`, threaded through `runTurn` like `focus`/`last`). A half-executed plan is
  conversation state, best lost on restart, and must survive an unrelated aside mid-game — the
  exact clearing-rule argument that doc already makes. Adopting its slot (or a sibling `plan`
  slot) closes the open question for both docs at once.

Plan triggering is a closed recognizer set, per this doc's Phase-3 non-goal on open goal
inference: "solve it", "plan the moves", "how do I get from here to the goal", and the
one-message combined form (state sentences + goal frame + trigger). It lands as a new plan lane in
`runAsk`'s miss-cascade, exactly as §4 sketches, and reuses the goal-line mechanism unchanged.
Per-step execution ("next") revises `deduced` mid-cascade; whole-plan playback in one turn reuses
the narrate-block SHAPE for a one-line-per-move trace, both exactly as §4 already recommends.

### The generic interpreter — the genuinely new code

One new pure module (working name `src/domain.mjs`), the piece §2 called the successor-state
generator, now domain-general instead of Hanoi-specific:

```
movesFromRules(state, actionRules, facts) -> [ { action, nextState } ]
```

- Ground each action Rule's typed variables over the individuals of their declared classes
  (classes and members read from the same taught facts).
- Check every precondition slot against the state's rows: must-hold and must-not-hold by direct
  row lookup, the comparator by lookup in the taught ordering facts.
- For each grounding that passes, apply the effect template: copy the state, replace the moved
  subject's `(subject, predicate)` row, and emit the successor.
- Pure, I/O-free, bounded, and deterministically sorted (groundings walked in sorted individual
  order), matching `syllogise.mjs`'s budget/determinism discipline the way §2 prescribes.

This plugs into `findActionPath` as its `applyActions`, with `stateKey` a canonical sorted
serialization of the state's rows. `isGoal` compiles from the goal frame the same way. The 2^n − 1
oracle test survives intact, and gets stronger: it now runs end to end from the definition TEXT
(sentences → facts/Rules → interpreter → search), with the closed-form recursion still used only
as the test oracle, per §5.

### CLI and JS surfaces

**`tmct import --file <path>`.** The batch-teach tool already exists as a script:
`scripts/extract-facts-from-text.mjs` (`npm run extract:facts`, `package.json:109`) sentence-splits
a file with wink (`splitSentences`, `:58`) and runs each sentence through `runTurn` exactly as if
typed. Promote that flow into the existing `import` subcommand (`bin/tmct.mjs:842`) as a `--file`
mode next to `--corpus`/`--ontology`/`--lexicon`/`--graph`. One behavior requirement, stated now
because it is a correctness matter: the import must report per-sentence results loudly, echoing
every sentence the recognizer declined and its lane's decline reason. A silently dropped
precondition sentence produces a planner that finds an ILLEGAL "solution"; a silently dropped
action sentence produces "no plan found" with no visible cause. The script's existing
kept/declined split (`record.via === "assert" && !record.miss`) already computes this; the CLI
must print it, and should exit non-zero if any sentence was declined.

**`tmct chat --prompt '<text>' [--render <archetype>] [--output <path>]`.** Chat today has no
one-shot mode; stdin piping is the only non-interactive path, and it stays as the fallback. The
new flag: create a session (`createSession`, `src/chat.mjs:8169`), sentence-split the prompt with
the same `splitSentences`, run each sentence as a turn, print the final turn's answer, exit. Flag
parsing follows viz's conventions (`strFlag` with an `--output`/`--out` alias and a default
filename, `resolveRuntimeConfig` for `--repo`; `bin/tmct.mjs:1024-1032`). `--render`/`--output`
are only meaningful when the final turn produced a plan; otherwise the command says so and exits
non-zero rather than writing an empty page.

**JS library.** The plan lane attaches the structured result to the turn it answered:
`result.plan = { actions, states, goal, domain }`, the same `{ actions, states }` shape
`findActionPath` returns plus the goal and the touched individuals. Library consumers, the CLI
renderer, and tests all consume this one shape; the prose answer stays a rendering of it, never
the other way round.

### The render surface

A new `src/plan-viz.mjs`, a sibling of `src/viz.mjs` with the same three-way factoring: an I/O
compute step, a pure HTML string builder, a never-throw artifact read. It inherits viz's
self-containment rules wholesale — no external requests, inline `<style>`, canvas 2D, JSON
embedded via the same script-breakout-safe escaping (`embedJson`, `src/viz.mjs:123`;
`renderVizHtml`'s inline `const GRAPH = ...` pattern, `:137` and the embedded-payload block).

**Render templates key to ontology classes**, the same dimension viz already colors by (one
stable hue per `class`, `src/viz.mjs:283-288`). The binding is itself taught: `mgx:rendersAs`
facts ("a disk renders as a block", "a peg renders as a slot") map each class to a render
archetype, and the `mgx:smallerThan` order derives relative block widths. `--render blocks` names
the first built-in archetype: places drawn as fixed baselines, movables as rectangles stacked by
their `restsOn` chains. The archetype set is closed and small (`blocks` first, later perhaps
`tokens` for board positions), matching the templates-over-general-rules house preference. A class
with no `rendersAs` fact falls back to a labeled circle, so an incomplete definition still renders
honestly.

**Animation.** `findActionPath` already returns the full `states` list. The page embeds every
snapshot as JSON. Consecutive snapshots differ by exactly one moved individual (one effect per
action, by construction), so the in-page player diffs neighbours, finds the moved piece, and
animates it between its two computed positions with `requestAnimationFrame`, with play/pause/step
controls and a move-list sidebar showing the plan's own per-step goal strings. Nothing time-driven
exists anywhere in the repo today (verified by grep across `src/` and the generated page), so this
player is new code, but it is page-local and small.

One discovered fact worth recording: the planning kernel already ships in the browser.
`src/memory-ask-browser.bundle.js` carries `findActionPath`/`findReachableSet` (`:394`, `:416`)
because `chat.mjs`'s dynamic import gets inlined by esbuild. A later interactive page (re-plan
after the user drags a disk) is therefore one bundle-entry export away. Scoped out here: the CLI
computes the plan once; the page only replays it.

### Revised phasing

This supersedes Phases 1, 3, and 4 above. Phase 2 shipped (`src/planning.mjs`) and stands.

- **Phase 1R — domain-definition vocabulary.** The prepositional-verb frame, the comparative
  frame, `RULE_KIND_ACTION` with typed parameters and the three precondition shapes, and the
  action/precondition/effect teach frames. Unit tests round-trip a hand-authored Hanoi definition
  through `appendRule`/`appendFact`/`readFactRows` (`src/memory/core.mjs:1194`, `:1021`, `:1445`)
  and back into the same structures. Exit criterion: every sentence of the worked example below
  teaches successfully, and the stored Rules/facts match a hand-written expected shape exactly.
- **Phase 2R — the interpreter.** `movesFromRules`, the goal compiler, `findActionPath`
  integration. Exit criterion: the 2^n − 1 oracle passes for n = 1..8, driven purely from the
  definition text; the interpreter module contains nothing Hanoi-specific (no "disk", "peg", or
  "restsOn" literal anywhere in it).
- **Phase 3R — chat and CLI surfaces.** Multi-sentence turns, the plan lane with its goal-line and
  narrate-shaped trace, `tmct import --file` with loud per-sentence reporting, `tmct chat
  --prompt` one-shot. Exit criterion: a fresh repo can be taught the whole game via `import
  --file`, then solve it from one `chat --prompt` invocation, with the CLI smoke test and full
  suite green.
- **Phase 4R — render.** `src/plan-viz.mjs`, the `blocks` archetype, the animation player,
  `--render`/`--output` wiring. Exit criterion: the worked example's `plan.html` opens offline,
  replays all 7 moves correctly, and the page's final drawn state matches the goal.
- **Phase 5R — a second domain from data only.** Candidate: a river-crossing puzzle (same
  move-onto shape, different legality), or Ashcombe Hall's opening moves through the shared
  `RULE_KIND_ACTION`. Exit criterion: the second domain works with ZERO interpreter changes. This
  phase also owns the three standing convergence points: the shared action-Rule kind with
  `PLAN_ADVENTURE.md`, `PLAN_GUESS_NUMBER.md`'s replan-after-observation seam (the interpreter
  must stay callable per-state, never assuming the whole plan precomputes), and the router
  registration seam (`registerCapability()`, the placement paragraph above) that puts taught
  actions beside the query tools in one operator model.

### Worked example

`hanoi-3.txt`, complete, in the closed frames:

```
a disk is a kind of game piece.
a peg is a kind of place.
disk-1 is a disk. disk-2 is a disk. disk-3 is a disk.
peg-a is a peg. peg-b is a peg. peg-c is a peg.
disk-1 is smaller than disk-2. disk-1 is smaller than disk-3.
disk-2 is smaller than disk-3.
you can move a disk onto a peg.
you can move a disk onto a disk.
to move a disk onto a target, nothing may rest on the disk.
to move a disk onto a target, nothing may rest on the target.
to move a disk onto a disk, the disk must be smaller than the target.
moving a disk onto a target makes the disk rest on the target.
a disk renders as a block. a peg renders as a slot.
```

Then:

```
npx tmct import --file hanoi-3.txt
npx tmct chat --prompt 'disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a.
  the goal is that every disk rests on peg-c. solve it.' --render blocks --output plan.html
```

The chat answer lists the 7 moves with a goal line per step and cites the taught action Rule as
provenance, the same way the grandfather answer cites its taught premises. `plan.html` opens
offline, draws three slots with a 3-block tower on the left, and plays the 7 moves as sliding
blocks, with step controls and the move list alongside.

### Open risks/questions (this proposal's own, appended to the standing list above)

- **The controlled-English ceiling of action frames.** A definition file is controlled English,
  the ACE tradition this project already builds on, never free text. The frames above cover
  move-onto games. A domain needing arithmetic effects, multi-subject effects, or disjunctive
  preconditions does not fit and must be declined honestly at teach time. Growing the frame set is
  by-need, one closed frame at a time.
- **Variable-grounding blow-up.** Groundings scale with the product of the parameter classes'
  sizes. Hanoi's is trivial (n disks × n+2 targets). The interpreter still needs a hard grounding
  budget in the `syllogise.mjs` style, declined loudly when exceeded, before any larger domain is
  attempted.
- **Import must fail loud, per sentence.** Named above as a requirement; recorded here as the
  risk it guards against — a definition that half-teaches produces wrong plans or missing plans
  with no visible cause. The exit-nonzero-on-any-decline rule is the mitigation.
- **The goal recognizer stays closed.** Same posture as the standing "goal recognition from
  free-form natural language" risk above; this proposal adds the one-message state+goal+trigger
  form and nothing more open than that.
- **Render archetype generality.** `blocks` fits stacking games. Whether two or three archetypes
  cover the interesting closed-world puzzle space, or whether the archetype itself needs to be
  data, is deliberately unresolved until Phase 5R's second domain forces the question.
- **Where the in-progress plan lives is now decided** (session slot for the plan, durable facts
  for definition and state), resolving the standing open question above for this design; the
  guess-number doc's clearing rules apply verbatim.
