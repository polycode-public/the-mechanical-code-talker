# PLAN_HANOI.md — a goal-directed planning loop for tmct, validated against Towers of Hanoi

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

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

The code graph is architecturally **provider-owned and read-only by design** — "tmct never
writes a provider's graph" (`memory/core.mjs:6-7`'s own docblock) — and several read paths cache
against the ASSUMPTION that a loaded graph object never changes mid-session
(`inheritsApplicableCache`/`EMB_CACHE`, both `WeakMap`s keyed on graph identity,
`src/ask.mjs:1382`, `src/codegraph.mjs:528`). The memory store is the opposite: it is tmct's OWN,
session-local, designed-to-be-written graph.

Hanoi's state changes every turn (a move mutates which peg a disk is on). That single fact
settles the question: **Hanoi state belongs in the memory store, represented as taught facts
(subject/predicate/object triples through `appendFact`), not as an ad-hoc individual set loaded
the way a code graph is.** The code-graph shape is the right SCHEMA to imitate (individuals +
typed edges), but the code graph itself is the wrong PLACE — it is architecturally static.

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
individuals" — a new, closed-set relation kind (`restsOn`) sitting next to `inherits` in spirit,
not in the code graph's `PROP_KIND` table (that table is code-graph-specific and closed on
purpose) but in the memory store's own, separately-declared vocabulary
(`MEMORY_VOCABULARY`, `core.mjs:65-89`).

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
independent Fact individual that coexists with the first — by design, this is exactly what
`findContradictions` (`memory/core.mjs:622-637`) is built to surface ("two high-trust sources
disagree → show both, never silently pick", per `ROADMAP.md`'s provenance section). There is
**no retraction primitive anywhere in the codebase** (`grep -rn retract src/` returns nothing) —
the "fully RETRACTABLE by provenance" language in `syllogise.mjs`'s own comment (line 38) describes
an aspiration for entailed facts, not a shipped mechanism.

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
  recognizer for the one "solve Hanoi"-shaped ask. Open-ended goal recognition from arbitrary
  phrasing is out of scope here (see risk list below) — this phase proves the composition, not
  the recognizer's generality.
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
- **No retraction primitive exists in `memory/core.mjs` today** (verified: `grep -rn retract src/`
  finds nothing shipped, only aspirational comment language in `syllogise.mjs:38`). §3's
  recommended snapshot-per-step design avoids needing one for Phase 1-3, but any FUTURE domain
  that wants to mutate a fact in place (rather than append a new snapshot) will need this built
  first — flagging it now so it isn't rediscovered as a surprise later.
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
