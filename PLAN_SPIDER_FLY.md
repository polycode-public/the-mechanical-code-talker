# PLAN_SPIDER_FLY.md — a spider and a fly, planning against each other on a partly-hidden grid, rendered through an ontology→sprite mapping

Status: RESEARCH/DESIGN — not yet implemented. Nothing in this document is live code.

## Build status (2026-07-18, paused mid-build on operator instruction)

The design (this document) is committed on `main`. Code build started the same session, staged per
§12's steps, then paused deliberately — not a blocker, the operator said stop.

- **Committed on `main`**: this document only (`339f617`).
- **In progress, uncommitted, in a stopped-but-not-removed worktree** — step 1 (world + grid
  substrate) of §12, roughly a third done:
  - `worktree-agent-a60844992f9b69653` at
    `.claude/worktrees/agent-a60844992f9b69653` (branched from `6e1d3b1`, predates this doc's own
    commit on `main` — reconcile by rebase/cherry-pick when resuming, not a straight merge).
  - Done there: `src/domain/spider-fly-world.mjs` (pure grid geometry, the seed taxonomy, the
    static fact/rule/meta row generators — §3/§4/§7), `scripts/gen-spider-fly-world.mjs` (writes
    `corpus/worlds/src/spider-fly.jsonl`, 479 rows), and a completed `npm run gen:worlds-pack` run
    (`corpus/worlds/shards/spider-fly.jsonl.gz` at 2,829 bytes gzipped, well under the 32KB budget;
    `corpus/worlds/index.json.gz`/`manifest.json` updated to carry it alongside `ashcombe-hall`).
  - Not yet started there: the actual turn engine (`src/services/spider-fly.mjs` — pathfinding,
    visibility/belief, the fly's evasion scoring, the ecology pass) and its tests. The agent was
    about to start that file when stopped.
- **Not started**: §12 steps 4-8 (chat integration, rendering, pages, the guess-number retrofit).

**To resume**: dispatch a fresh worktree-isolated agent continuing from
`worktree-agent-a60844992f9b69653`'s work (check it's still there with `git worktree list` first,
per this project's own standing lesson in `CLAUDE.md` about stale worktrees), or start step 1 over —
it's small enough that redoing it is cheap if the branch has aged out.

**Revised 2026-07-18, same session.** A second research pass checked three things this document
originally left open, and the operator settled three more:

- **Rendering drops RPG-JS.** Checked directly, not assumed: `@rpgjs/client`'s own `package.json`
  lists `@rpgjs/server` as a hard `dependencies` entry (not a peer or optional one), plus a
  real-time room-sync stack (`@signe/room`, `@signe/sync`) and a `CanvasEngine`+`pixi.js`+Vue
  rendering stack; the package is still beta (`5.0.0-beta.25`); and no documented solo/no-server
  mode exists. tmct's whole browser story is zero-server (the home page, `ledger.html`, `plan.html`
  all run client-side or are pre-baked at build time, no backend anywhere). §8 below now designs
  the plain canvas/SVG renderer this project already builds everything else with. The
  ontology→sprite mechanism (§7) is unaffected — it was always renderer-agnostic, and dropping
  RPG-JS removes a dependency, a licence-gate question, and an unresolved server-architecture risk
  in one move, at the cost of hand-drawing the sprites tmct now owns outright instead of pulling
  them from a stock asset pack.
- **An egg hatches into a new spider** (§10), not a fly.
- **A fly's "mass" is a health bar** — reaching zero removes the fly with no spider involved
  (starve), a second exit condition alongside being eaten (§3, §10).
- **The fly's evasion move is greedy distance-maximizing** over `findReachableSet`'s one-ply output,
  not an adversarial lookahead (§5).

This revision also folds in two implementation facts a second research pass found and the original
draft didn't have precisely enough to build from: the exact `chat.mjs`/`adventure.mjs` line-level
insertion points for the fourth chat lane, and a real grammar gap — no directional/positional
relation exists in tmct today — that §6's chat-targeting design needs to close with new grammar,
not by routing through what's already there.

## Origin

2026-07-18 session. The operator sketched a 10×10 grid game on paper (a spider in its web, a fly
that arrives and loses mass over time, a "POV" panel showing one agent's fogged view of the board)
and asked for a design doc covering: an embedded panel on the project's home page and a full-screen
standalone version; a scene with a spider and a fly, each planning against the other and each seeing
only part of the grid; a chat window into the same graph so a visitor can feed either agent
information; rendering through RPG-JS (github.com/RSamaium/RPG-JS) with ontology classes mapped to
sprites at whatever granularity tmct's ontology actually has; and a worked ecology on top — an egg
the spider lays after eating two flies, hatching three turns later, with new flies arriving every
three turns. The brief asked explicitly to build on the game-planning and inference substrate this
project has already shipped (Hanoi, river-crossing, guess-the-number, Ashcombe Hall) rather than
start from nothing, and named the frontend-design skill for the visual pass.

## 1. Why this is a fourth architectural stretch

tmct has three prior "be an agent" validations, each deliberately probing a different axis:

- **Hanoi / river-crossing** (`data/games/hanoi-3.txt`, `river.txt`) — fully observed, open-loop
  planning: the whole move sequence is computed once, up front, and walked step by step.
- **Guess-the-number** (`archive/PLAN_GUESS_NUMBER.md`, DELIVERED) — closed-loop planning over
  hidden state: each guess returns an observation that must update a belief before the next guess
  can be chosen.
- **Ashcombe Hall** (`archive/PLAN_ADVENTURE.md`, DELIVERED 2.7.0) — a world that changes for
  reasons other than the agent's own choices: an NPC scheduler fires taught, turn-gated actions on
  its own.

Spider-and-fly needs all three at once, in the same session, live: the spider plans a path (Hanoi's
shape), over a board it only partly observes and must update its belief about as it moves and as
the visitor tells it things (guess-the-number's shape), while eggs hatch and flies arrive on their
own schedule regardless of what either agent does (Ashcombe's shape). Both
`archive/PLAN_ADVENTURE.md`'s Phase 5 and `archive/PLAN_GUESS_NUMBER.md`'s own closing section left
the same question open: whether a single unifying "agent loop" abstraction is warranted once more
than one of these shapes needs to run together. This document does not resolve that question in the
abstract — it is the first concrete case that needs the answer, and the design below is written so
the three mechanisms compose rather than merge into a new fourth one.

One more thing is new here: every prior game has exactly one autonomous side and one human-typed
side (the plan lane's "next", guess-the-number's human guesser or human thinker, Ashcombe's single
player typing imperatives). Spider-and-fly has **no player-controlled entity at all.** Both agents
move on their own, every turn; the human's only channel in is chat, informing one agent or the
other, or just watching. That is a real posture change worth naming plainly rather than glossing
over.

## 2. What's already shipped and directly reusable

None of the mechanisms below are proposed here — they are the actual substrate, cited at the file
and function that implements each:

- **The generic bounded search kernel** — `findActionPath` / `findReachableSet`
  (`src/domain/planning.mjs:30,63`). Both take an opaque `state`, an
  `applyActions(state) → [{action, nextState}]` closure, and an optional `stateKey` canonicaliser;
  neither knows or cares what a state looks like. Already proven state-shape-agnostic across three
  unrelated callers: Hanoi/river's fact-row board state (`src/domain/domain.mjs`), the
  relation-chase reachability check inside `src/adapters/memory/core.mjs:1443-1548`, and (this
  document proposes) a fourth: grid-position state. Both the spider's path search (§5) and the
  fly's one-ply evasion scoring (§5) call `findReachableSet` on the same grid state, just with
  different scoring on top of its output.
- **The taught four-kind action-rule vocabulary** (`RULE_KIND_ACTION_SIGNATURE/PRECOND/EFFECT/
  CONSTRAINT`, `src/adapters/memory/core.mjs:1259-1300`) plus `compileDomain`/`stateFromFacts`/
  `movesFromRules`/`compileGoal` (`src/domain/domain.mjs:44,150,271,318`) — the mechanism Hanoi and
  river-crossing use with **zero bespoke planning code**, only taught sentences.
  `archive/PLAN_ADVENTURE.md`'s own Phase 2 found this vocabulary's two precondition shapes
  (`no-incoming`, `comparator`) could not express Ashcombe's exit-adjacency, lock-state or
  instrument checks, and shipped a documented workaround instead (next bullet). The same limitation
  applies here — see §5.
- **The generic-fact-checking workaround for preconditions the taught-rule DSL can't express** —
  `src/services/adventure.mjs`'s `runWorldCommand` (`adventure.mjs:368-580`) checks exit-adjacency,
  lock state, hidden contents and instruments as ordinary closed-predicate fact lookups, hand-written
  per verb, declining by name when a check fails. This is the precedent §5 below reuses for grid
  adjacency and vision.
- **The exit-adjacency predicate pattern** — `mgx:has-exit-<direction>`, folded by
  `foldWorldState`'s `EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/` (`adventure.mjs:140,166-169`)
  into `Map(room → Map(direction → room))`. This is real, shipped code (2.7.0), not a proposal — it
  is the exact pattern a 10×10 grid's cell-to-cell adjacency reuses, just with 100 cell individuals
  instead of six rooms.
- **The worlds-pack build pipeline is agnostic to hand-authored vs. generated source.**
  `scripts/build-worlds-pack.mjs` only validates row shape (`isWorldFactRow`/`isWorldRuleRow`/
  `isWorldMetaRow`, `src/domain/worlds-pack.mjs:14-60`) and a byte budget
  (`sourceBytesPerWorld: 128*1024`, `shardGzBytes: 32*1024`) — it never inspects how the source
  `.jsonl` was produced. A 100-cell grid's generated fact rows satisfy this reader exactly like
  Ashcombe's hand-authored `corpus/worlds/src/ashcombe-hall.jsonl` does, with room to spare on the
  budget.
- **The `@turnN` snapshot convention** — every effect is a *new* fact row (`entity@turnN predicate
  object`), written through plain `appendFacts` (`src/adapters/memory/core.mjs:1158`), never a
  mutation; current state is always a fold over the full row history (`foldWorldState`,
  `adventure.mjs:146-173`). The turn counter itself is derived, never stored — the largest `@turnN`
  suffix seen.
- **The turn-gated autonomous scheduler** — `runNpcPass` (`adventure.mjs:239-264`): one bounded
  pass per state-changing command, walking every `mgx:is-npc` individual in fixed sorted order,
  firing an action whose `mgx:acts-on-turn` fact matches the current turn count, capped at one fired
  action per individual per turn, fully deterministic. This is the direct precedent for egg-hatch
  and fly-spawn scheduling (§10) — though both of those write a *new individual* rather than moving
  an existing one, which the taught `"go"` family this pass currently checks does not cover; the
  pass's *shape* (turn-gated, deterministic, one-per-tick) generalises, not its literal `"go"` check.
- **The session-slot threading pattern** — `planState` (`src/services/chat-session.mjs:318`,
  threaded through `runTurn` as `planHolder.state`) already carries three mutually-exclusive tagged
  payloads on one slot: bare plan-lane fields, `{ game: {...} }` for guess-the-number, `{ adventure:
  { world } }` for Ashcombe. A fourth tag, `{ spiderFly: {...} }`, follows the identical convention
  — the exact insertion mechanics are in §6.
- **`withGoalLine`** (`src/services/chat.mjs:276-285`) — appends a `"Goal (inferred): …"` line onto
  any turn whose result carries a `.goal` string, driven purely by that field being present. Reused
  as-is for each agent's per-turn goal line.
- **The completions read-out for a scoped "what can you see" digest** — `generateCompletion`/
  `createCompletionsGraphAdapter`, called by Ashcombe's `worldDigest` (`adventure.mjs:337-360`) with
  a substituted `readFactRows` returning only the folded, phrase-rendered facts for the current room,
  block retrieval switched off, and a widened `maxSentencesPerGroup`. The same call, re-scoped to an
  agent's visible cell set instead of one room, is the mechanism for both the chat "what does the
  spider see" answer and the click-to-inspect POV overlay's text (the overlay's *rendering* is
  separate, §9).
- **The flat closed-vocabulary registry idiom** — `SOURCE_PRIOR` (`src/domain/memory/trust.mjs:
  89-98`), `PERSONA_PRESETS` (`src/services/init.mjs:51-55`), `EDGE_KIND_TO_TMCT`
  (`src/adapters/repository-interface.mjs:46-58`): a small `Object.freeze({...})` string-to-value map
  with a doc comment. §7's ontology-to-sprite table follows this exactly.
- **The self-contained-page build pattern** — `src/services/ledger-viz.mjs` / `plan-viz.mjs` (pure
  string builders: one inlined `<style>`, data embedded as escaped inline JSON, behaviour as an
  inlined IIFE that in places `.toString()`-splices a tested Node function straight into the page)
  and `scripts/build-chat-bundle.mjs`'s `buildBundle` helper (`scripts/lib/browser-bundle.mjs:
  114-140`: esbuild IIFE, `write:false` + atomic rename, Node-builtin stub plugins) are the exact
  templates §11 below builds the new feature on.
- **A play/pause/step/reset *pattern* already exists, but it isn't an importable module.**
  `plan-viz.mjs`'s inlined ticker script (lines ~321-478: `step`/`playing`/`animating` state,
  `forward`/`playRange`/`wait(300)`, `prefers-reduced-motion` respected) is read in full closing
  directly over Hanoi/river's block-board DOM and the `PLAN.layouts` x/y shape — `animateMove`/
  `drawState`/`render` are not generic. §11 extracts the *pattern* (the state triple and the
  pacing loop), not the code, into one small shared helper both this feature's ticker and the
  guess-the-number retrofit import.

## 3. The world model

A 10×10 grid of 100 cell individuals, `cell-<x>-<y>` (`x, y` in `1..10`), generated programmatically
at world-load time — the same "generated, not hand-authored" posture Hanoi takes for `n` disks, not
Ashcombe's six hand-placed rooms, because 100 cells is squarely a generate-this case. Each cell
carries up to four `mgx:has-exit-{north,south,east,west}` facts to its grid neighbours (edge cells
simply have fewer), reusing the existing predicate and fold verbatim (§2).

Individuals:

- **`spider-1`** — `mgx:currently-in cell-x-y@turnN` (the same placement predicate `foldWorldState`
  already folds), `mgx:mass`, `mgx:flies-eaten` (a running count).
- **`fly-1`, `fly-2`, …** — `mgx:currently-in`, `mgx:mass@turnN`. Mass is a health bar: it decrements
  each turn per the sketch's "loses mass" annotation, and reaching zero removes the fly with no
  spider involved (starve) — the second way a fly leaves the board, alongside being eaten (§10).
- **`web-1`** — not a moving individual: a declared set of cells (`mgx:in-web` tagged on the cell
  individuals themselves, a 3×3 block around the spider's home cell) rather than a separate geometry
  object, so "is the fly in the web" is the same kind of closed-predicate fact lookup as Ashcombe's
  `mgx:is-container`.
- **`egg-1`, …** — minted when the spider's eat condition fires the second time (`mgx:laid-at-turn`,
  `mgx:currently-in` the spider's cell at lay time).

Eating: spider and a fly co-located in a cell tagged `mgx:in-web` removes the fly, increments
`spider-1 mgx:flies-eaten`, and — the second time this fires with no live egg outstanding — lays an
egg (§10).

**Snapshot convention decision:** reuse `@turnN`, matching Ashcombe's convention and `runNpcPass`'s
own turn-counting idiom, rather than the plan lane's `@stepN`. The two are structurally identical
(independently invented twice already); picking the one already wired to a turn-gated scheduler
avoids inventing a third.

## 4. Visibility — no existing analog, designed from scratch

Every ancestor-walk and placement-fold utility in tmct assumes full visibility of whatever it's
handed. Nothing in `src/` has a vision-radius, line-of-sight, or partial-observability primitive —
the closest thing is Ashcombe's `visibleRoomOf` (`adventure.mjs:196-207`), which is
containment-based (hidden-in-a-container), not distance-based, and doesn't generalise to "this cell
is too far away to see."

Design: **static board structure (the grid topology, the web's location) is common knowledge,
always fully known to both agents.** Only *dynamic entity positions* — the other agent, other
flies, an egg — are gated by visibility. This matches "sees about half the grid" to what the
sketch's POV panel actually shows (a fogged view of *where things are*, not a fogged maze), and
sidesteps inventing fog-of-war over static geometry that has no walls to hide anyway.

- **Sensed cells**: a pure function of an agent's own current cell, `visibleCells(cx, cy, radius)`
  — Chebyshev distance ≤ `radius`. A spider that starts near its web in a corner naturally sees
  close to half the board just from edge-clipping, without hand-picking a corner-specific shape;
  `radius = 4` is a starting parameter to tune once the board is actually playable, not a fixed
  constant (still open — §13).
- **Told facts**: a chat message addressed to an agent (§6) mints a fact the same way a taught fact
  does today, tagged with an addressee — e.g. provenance `teach:chat:<session>:to=spider` — rather
  than a new trust tier or a second session/graph. An agent's belief, at planning time, is the union
  of (ground-truth positions currently inside its sensed cells) and (any told fact addressed to it),
  with a fresh direct observation always preferred over a stale told fact for the same target — the
  existing relevance × trust ranking (`SOURCE_PRIOR`, recency) already prefers a fresher fact over
  an older one of comparable trust, so this needs no new scoring code, only feeding it the right
  candidate set.
- **The click-to-inspect POV overlay** (§9) renders exactly this function's output for whichever
  agent was clicked — a filtered view of the one ground-truth graph, never a second world model.

## 5. Planning and the replan loop

**Design call, and the reasoning behind it:** route grid pathfinding through `findActionPath`/
`findReachableSet` (§2) directly, with a hand-written JS `applyActions` closure, not the taught
`RULE_KIND_ACTION_*` DSL. Two precedents point the same way. First, `archive/PLAN_ADVENTURE.md`
Phase 2 found the shipped precondition shapes (`no-incoming`, `comparator`) can't express
adjacency-style checks — exactly what grid movement and vision need — and shipped hand-written
per-verb checks instead (§2's workaround bullet). Second, Ashcombe's own `runWorldCommand` never
routes through `movesFromRules`/`findActionPath` at all for its per-turn resolution — only Hanoi and
river-crossing, whose action shapes fit the taught DSL, use that path. Grid movement is closer to
Ashcombe's shape than Hanoi's, so it should follow Ashcombe's resolution style (hand-written,
closed-predicate checks) while still reusing Hanoi's *search kernel* for the multi-step lookahead a
single Ashcombe command never needed.

**The spider** plans a genuine multi-step path: `findActionPath(state, isGoal, applyActions,
{ stateKey })`, `isGoal` = "co-located with the believed fly target, inside `in-web`."

**The fly** does not plan a path at all — it decides one move per turn, greedily: score every
one-ply option `findReachableSet` returns (or the fly's current cell, if staying put scores best)
by Chebyshev distance from the fly's belief about the spider's position, and move to the
highest-scoring reachable cell. No lookahead, no simulation of the spider's own plan — cheap,
deterministic, and it reuses the same search primitive the spider's own path search already calls,
just scored differently on the output instead of searched to a goal.

Concretely, each agent's turn:

1. **Fold current state** — `foldWorldState`-style fold over the fact rows, extended with
   `mass`/`flies-eaten`/`in-web` reads.
2. **Compute belief** — §4's sensed-cells ∪ told-facts union, scoped to this agent.
3. **Decide whether to replan** — for the spider: replan if no plan exists yet, the previous plan's
   assumed target cell no longer matches belief (the fly moved since the plan was made), or a chat
   message was just addressed to it; otherwise keep walking the existing plan. The fly has no
   standing plan to keep — it re-scores its one-ply move every turn, so this step is a no-op for it.
4. On a spider replan: `findActionPath` as above, using only `has-exit-*` edges the spider's belief
   marks passable. On every fly turn: the one-ply greedy score above.
5. **Execute exactly one step** — the spider's next plan step, or the fly's freshly-scored move —
   write it as an `@turnN` fact via `appendFacts` (never mutate).
6. **Check eat/lay/hatch/spawn/starve conditions** (§3, §10) and fire whichever fire this turn.
7. **Render the plan** — the spider's current plan (the sequence `findActionPath` returned) is
   visible on the page, refreshed whenever step 3 triggers a fresh one; the fly has no multi-step
   plan to draw, only its live goal line. `withGoalLine`'s existing renderer carries each agent's
   one-line summary ("Goal: reach and eat the fly — 2 moves away, last seen at cell-6-3" for the
   spider; "Goal: get away from the spider" for the fly).

A full auto-play tick (§11) runs steps 1-7 for both agents once; a chat message addressed to one
agent runs the same full tick (both agents move), per the brief's own "if a user types something,
this triggers a replan and a turn for both fly and spider."

## 6. Chat integration

One shared chat window, one shared session, one graph — the brief's own requirement, and the
natural read of "share information with the spiders or fly... into the same graph."

### 6.1 A new grammar gap: no directional/positional relation exists today

Checked directly, not assumed: "the fly is east" does not parse into a usable fact today, and fails
in two different ways depending on phrasing.

- **"north"/"east"/"west"/"south" are lexicon nouns, not adjectives or prepositions**
  (`lexicon-core.json:2921,2957,2960,2964`, all inside the `"nouns"` object). For the bare copula
  form "the fly is east," `parseAce` routes to `parseCopula` (`ace.mjs:413-434`); since
  `lookupAdjective` misses on "east," it falls to resolving "east" as an ordinary class term, and
  the sentence would assert `rdfs:subClassOf(fly, east)` — a nonsense "fly is a kind of east" class
  axiom, not a positional fact, even when parsing "succeeds."
- **"the fly is east of the spider" hits a hard `null`.** `parseAce`'s first branch
  (`ace.mjs:447-449`) commits unconditionally to `parseOfForm` for any sentence containing both "of"
  and "is" and starting with "the." `parseOfForm`/`buildPossessive` (`ace.mjs:377-410`) require "is"
  to occur *after* "of" (the "the HEAD of OWNER is VALUE" shape, e.g. "the color of the sky is
  blue"). In "the fly **is** east **of** the spider," "is" precedes "of," so the guard trips and
  `parseAce` returns `null` for the whole sentence — never falling through to `parseRelation`/
  `parseCopula`.

**Consequence**: chat-told positional hints need a **new closed teach-frame** in `chat.mjs`, styled
exactly like the `ACTION_SIGNATURE_TEACH_RE` family (`chat.mjs:2075-2170` — a dedicated regex, not
a route through the existing declarative patterns). One new regex recognizing
`"@spider the fly is east"` / `"@spider the fly is at cell-7-3"` (a fixed compass-direction set,
`IMPERATIVE_DIRECTIONS`'s existing four cardinal members, `ace.mjs:477`, or a `cell-<x>-<y>` literal)
and writing the told-fact directly — the same closed-template-over-general-grammar posture this
project already prefers, not a generalization of `parseOfForm`.

### 6.2 Targeting and lane wiring

- **Targeting**: `@spider`/`@fly` at the start of a line, or clicking an agent's sprite/portrait to
  set the addressee for the next message — a closed-set recognizer of the same shape as `MORE_RE`,
  not a general-grammar extension.
- **An addressed message** parses through §6.1's new teach-frame, tagged with the addressee and
  forcing that agent's replan on the current tick.
- **An unaddressed message** falls through to ordinary chat lanes unchanged — "where is the spider"
  is answered by the completions digest (§2) over the current ground truth, no separate code path.
- **The exact insertion point, confirmed at the line.** `runTurn` (`chat.mjs:12471`) dispatches
  `guessNumberTurn` (`chat.mjs:12588-12600`) then `adventureTurn` (`chat.mjs:12602-12622`) in
  sequence, before the conversational layer (`chat.mjs:12624`+); each returns early on a non-null
  result via the identical shape — build the reply, set `.goal`/`.lane`, `withLast(...)`, then
  `rec.planState = planHolder.state;` and `return rec;`. A fourth `spiderFlyTurn` block goes
  immediately after the adventure block (after line 12622), in the same shape.
- **Symmetric coexistence, confirmed at the line — no central arbiter exists, lane order plus
  pairwise checks is the whole mechanism:**
  - `guessNumberTurn` (`chat.mjs:12230-12279`) already declines with `if (state?.adventure) {...}`
    at line 12246 and a `planActive` bare-plan-lane check at lines 12249-12253. Add one more arm
    there: `if (state?.spiderFly) {...}`.
  - `adventureTurn` (`adventure.mjs:663-717`) already declines with `if (slot?.game) {...}` at
    line 670 and its own `planActive` check at lines 677-684. Add the mirror: `if (slot?.spiderFly)
    {...}`.
  - `spiderFlyTurn` itself must check both `state?.game` and `state?.adventure`, plus the standard
    `planActive` check, before opening — the same three-way pattern the other two lanes already
    each implement pairwise.
- **Session-slot tagging**: `planHolder.state = { spiderFly: { grid, spider, flies, egg, turn } }`,
  the fourth tag on the existing `planState` slot (`src/services/chat-session.mjs:318`).

## 7. Ontology-to-sprite mapping

**What the default persona actually has, checked directly rather than assumed:**
`corpus/tier2/human.jsonl` (the always-active default) has `spider IsA animal` — a direct child,
skipping `insect`/`arachnid` entirely — and no `IsA` fact for `fly` at all (only the verb sense,
`bird CapableOf fly`). The richer chain — `spider ⊑ arachnid ⊑ arthropod`, `fly ⊑ "dipterous
insect" ⊑ insect` — exists only in the opt-in `human-large.jsonl` tier. `ontology/tmct-core.ttl`
itself declares no animal/biological classes at all today; it is the software-entity and provenance
vocabulary only. Both `spider` and `fly` are already declared lexicon nouns
(`lexicon-core.json:429,873`), so ACE sentences about them parse regardless of which persona tier is
active.

**Consequence for the design**: don't depend on `--persona-size large` for the worked example.
Follow Ashcombe Hall's own precedent exactly — that world shipped its own missing nouns and facts
rather than assuming persona depth (`archive/PLAN_ADVENTURE.md`'s "the six nouns landed in
lexicon-core.json"). The spider-fly world pack ships its own small taxonomy: `poodle IsA dog`,
`sheepdog IsA dog`, `dog IsA animal`, `spider IsA arachnid`, `arachnid IsA animal`, `fly IsA insect`,
`insect IsA animal` — enough to make the user's own worked example (poodle has a specific sprite,
sheepdog doesn't and falls back to the generic dog sprite) run standalone, on the default persona,
with no init flag required. A later session can still additionally activate `--persona-size large`
for the fuller WordNet-derived chain; the game doesn't require it.

**The resolver needs new code — none exists today.** No "walk to nearest ancestor with property X"
utility exists anywhere: `src/domain/ask.mjs`'s private `ancestorsOf` (`ask.mjs:1438`) is BFS and
nearest-first-ordered but scoped to code-graph `inherits` edges only; `src/domain/syllogise.mjs`'s
private `buildAncestorCloser` (`syllogise.mjs:258`) operates on the right data (generic
`rdfs:subClassOf` fact edges) but is DFS and returns an unordered Set, and isn't exported. A new
small pure function, styled after `ancestorsOf`'s shape but pointed at fact-store IsA edges:

```
resolveSpriteForClass(className, factRows, spriteRegistry)
  → BFS upward over rdfs:subClassOf edges from className, nearest first,
    return the first ancestor (className itself included) present as a key in spriteRegistry,
    or the registry's declared root fallback ("object"/"animal"/"plant") if the walk exhausts.
```

**The registry** follows the flat-map idiom exactly (`SOURCE_PRIOR`, `EDGE_KIND_TO_TMCT`, §2):
`Object.freeze({ poodle: "<svg-id>", dog: "<svg-id>", spider: "<svg-id>", fly: "<svg-id>", animal:
"<generic fallback svg-id>", ... })`, keyed on the same normalised spelling the fact store already
uses (`normFactTerm`, `src/adapters/memory/core.mjs:112-119`), so a lookup never has to re-normalise.
Values are small inline SVG path strings tmct authors itself (§8) — no third-party asset pack, so
building this table out beyond the spider/fly seed is just drawing more small icons, not an
inventory-and-licence-check spike.

## 8. Rendering — plain canvas/SVG, no third-party engine

RPG-JS is dropped (see the revision note at the top of this document for why: a hard server
dependency, a real-time sync stack, beta status, no solo mode — incompatible with tmct's
zero-server browser architecture). The rendering layer instead follows the same pattern this
project already uses for `ledger.html` and `plan.html`: a self-contained page, plain positioned
`<div>`s or inline `<canvas>`/SVG, no framework, no build-time asset pipeline beyond esbuild.

This is a genuine simplification, not just a fallback: it needs zero new npm dependencies (the
`devDependencies`-vs-`dependencies` question RPG-JS would have raised is moot), zero licence-gate
work (§7's sprites are tmct's own small original SVG shapes, MPL-2.0 like the rest of the code, not
a third-party asset pack), and it reuses machinery this codebase already tests and maintains
(`ledger-viz.mjs`/`plan-viz.mjs`'s pattern, `viz-theme.mjs`'s shared tokens) instead of introducing
a new rendering stack's own conventions.

The render loop per turn: fold state (§5) → resolve each visible entity's class to a sprite (§7) →
place each sprite at its `mgx:currently-in` cell's on-page position → draw the spider's current
plan as the silk-thread signature element (§9) → redraw. The click-to-inspect POV overlay (§4) is
the same render function, called with the clicked agent's `visibleCells` set as a mask over the
same board instead of showing everything.

## 9. Visual design direction

Loaded the frontend-design skill and checked the existing home page's actual token set rather than
proposing colours in a vacuum (`public/index.html:33-59`): parchment/near-black background
(`#F7F6F2` / `#15181C`), graphite/paper foreground (`#23272B` / `#E7E5DF`), muted (`#6E7168` /
`#9A9E95`), a forest-green brand accent (`#2E7D4F` / `#5FBE8B`), and a terracotta (`#d9704f`)
already reserved for error states (`.term-error`). Display face is Georgia serif; chat/code/data is
system monospace. That's already a field-notebook palette — parchment, ink, one green accent —
which happens to suit this subject without inventing a new one.

**Extend, don't replace.** Keep bg/fg/muted/accent/fonts exactly as shipped. The spider takes the
existing green accent (tmct's own colour, for the agent that is doing the reasoning the demo is
showing off). The fly gets one new accent — a warm amber/honey, distinct from both the green and the
reserved error-terracotta — proposed as `#A6791F` (light) / `#D9A94B` (dark), pending a real
contrast check against the shipped backgrounds at build time; treat these as a starting point, not a
final value.

**Signature element**: the spider's plan is drawn as a silk thread — a thin line strung cell-to-cell
along its current path, in its accent colour, each segment labelled with its step number on
hover/tap. This is not decoration: a tmct plan already is a proof chain (the same "because — you
taught me…" causal-link structure every other `tmct plan` render carries), and a spider's web is,
physically, a set of threads. Drawing the plan as a thread makes the visualisation and the
underlying proof the same object, which is the one idea worth spending this design's boldness on.
The fly has no multi-step plan to draw this way (§5) — its sprite alone, plus its live goal line, is
enough. Everything else — the grid, the HUD, the chat dock — stays quiet: graph-paper-faint
gridlines, no drop shadows, no gradients, sharp corners consistent with the site's existing
zero-border-radius, hairline-rule register.

**Layout** (full-screen page; the home-page embed is a cropped, non-interactive preview of the same
panel, matching the existing ledger-hero/plan-render iframe pattern):

```
+-----------------------------------------------+---------------+
|                                                 |  spider - Goal|
|              10x10 grid                        |  (goal line)  |
|         (silk-thread plan drawn live)          |  fly - Goal   |
|                                                 |  (goal line)  |
|                                                 +---------------+
|                                                 |  chat dock    |
|                                                 |  (@spider/@fly|
|                                                 |   or click)   |
+-------------------------------------------------+---------------+
|  <- back   > play/pause   step   reset          turn: N        |
+------------------------------------------------------------------+
```

Clicking a sprite opens the POV overlay as a float over the grid (not a separate page), the visible
cells lit and everything outside dimmed, dismissed by clicking again or pressing Escape.

## 10. The egg / hatch / spawn / starve scheduler

Generalises `runNpcPass`'s shape (turn-gated, deterministic, fixed order, one fire per tick) rather
than reusing it literally, since laying/hatching/spawning write a *new* individual rather than
moving an existing one, which the shipped pass's `"go"`-family check doesn't cover.

- **Lay**: the eat condition (§3) fires for the second time since the last egg (or the first, at
  game start) with no live egg outstanding → mint `egg-<n>` at the spider's current cell,
  `mgx:laid-at-turn = <k>`.
- **Hatch**: any egg with `laid-at-turn + 3 == current turn` → mint a new **spider** individual at
  the egg's cell, remove the egg. Spiderlings are what a real spider egg produces, and this grows
  the demo into a genuine multi-agent case as play continues — more spiders competing for the same
  fly supply.
- **Spawn**: every third turn, a new fly individual at a board-edge cell (uncontested by either
  agent's current belief, so it doesn't spawn directly on top of a search that's mid-plan).
- **Starve**: any fly whose `mgx:mass` reaches zero (§3, §4) is removed with no spider involved —
  checked in the same per-tick pass as the eat condition, since both are "does this fly still exist
  after this turn" checks.

All four are ordinary turn-gated checks inside the same per-tick pass (§5 step 6), not a second
scheduler.

## 11. Home page, full-screen page, and the guess-number Play control

Three build-pipeline reuses, cited exactly (§2):

- **Full-screen page**: a new `src/services/spider-fly-viz.mjs`, shaped like `ledger-viz.mjs`/
  `plan-viz.mjs` — one inlined `<style>` (importing `viz-theme.mjs`'s shared tokens), the world
  state embedded as escaped inline JSON, behaviour as an inlined IIFE.
- **A shared ticker helper, extracted once.** `plan-viz.mjs`'s play/pause/step/reset control is a
  pattern, not an importable module (§2) — its `forward`/`animateMove`/`drawState`/`render` close
  directly over Hanoi/river's block-board DOM. Extract the reusable part (the `step`/`playing`/
  `animating` state triple, `playRange`/`wait(300)`, the `prefers-reduced-motion` guard, the
  button-row semantics) into one small shared helper, consumed by both this page's ticker and §11's
  guess-number retrofit below — written once here rather than duplicated twice or reused only once.
- **Home-page embed**: follow the shipped `.ledger-hero`/`.plan-render` pattern exactly — a hero
  `<div>` with an `<iframe src="./spider-fly.html">` and an "open full-screen →" link, positioned
  per `e2e/pages-index.test.mjs`'s existing ordering assertions (above the ELIZA/PARRY prose,
  alongside the other two heroes). A small, auto-playing, non-interactive preview inside the iframe
  (reduced radius grid or a short scripted opening) rather than the full interactive board, matching
  how the ledger/plan heroes are previews of their full-screen page, not the page itself.
- **Browser bundle**: a new `src/surfaces/web/spider-fly-browser-entry.mjs`, bundled via the same
  `buildBundle` helper `scripts/build-chat-bundle.mjs` calls (`scripts/lib/browser-bundle.mjs:
  114-140`) from a new small `scripts/build-spider-fly-bundle.mjs` wrapper mirroring
  `build-chat-bundle.mjs`'s shape — the same `stubNodeBuiltins`/`stubNodeZlib` plugins, no new
  stubs needed now that RPG-JS is out of the picture.
- **Build-pipeline insertion point**: `scripts/build-demo-site.mjs`'s step sequence, after its
  current last step (the plan-render block) — generate the world pack, run the new bundle, call
  `spider-fly-viz.mjs`'s render function, write `public/spider-fly.html`.
- **Guess-the-number gets the same Play control retrofitted.** The brief asks for this explicitly.
  Today's demo rail (`public/chat-ui.mjs`'s `runDemo`, lines 184-211) is a fire-and-forget scripted
  loop with no pause/step. Apply the shared ticker helper above to it, reusing `typeInto`'s existing
  `prefers-reduced-motion` handling — a smaller, separable piece of work since it touches an
  existing shipped feature rather than new game content.

**e2e conventions any new page/panel must satisfy**, per the existing `e2e/pages-*.test.mjs` suite:
zero same-origin request failures and zero console errors; honest degradation on any optional/CDN
dependency (no `.term-error`-class failure surfaced as if it were normal); no horizontal overflow at
a 375px viewport; every piece of on-page example/demo text must be provably reproducible by the real
engine, never hand-typed copy that happens to look plausible.

## 12. Staged build plan

Mirrors `archive/PLAN_ADVENTURE.md`/`archive/PLAN_GUESS_NUMBER.md`'s own convention: numbered,
independently testable, `npm test` green throughout. Renumbered from the original draft now that
the RPG-JS spike is gone.

**Step 1 — World + grid substrate.** Generate the 100 cell individuals and their `has-exit-*`
edges through a new generator script feeding the existing `npm run gen:worlds-pack` pipeline
unmodified; the seed taxonomy facts (§7); `mgx:in-web` cell tagging. No planning, no rendering yet —
pinned by a fact-row/fold-shape test only.

**Step 2 — Single-agent pathfinding.** The `applyActions` closure and `findActionPath` wiring (§5)
for the spider alone, against a stationary fly, no visibility limits yet (full board known).
Validates the search-kernel reuse in isolation before layering belief on top.

**Step 3 — Visibility, belief, evasion, and the health-bar mass.** `visibleCells`, the told-fact
union, the replan trigger, the fly's greedy one-ply evasion, `mgx:mass` decrementing and the starve
condition (§4-§5). Both agents live, moving every tick, still no chat.

**Step 4 — Chat integration.** The new spatial teach-frame (§6.1), `@`/click targeting, the
`spiderFlyTurn` lane inserted at the confirmed line, and the symmetric coexistence checks added to
`guessNumberTurn`/`adventureTurn` (§6.2).

**Step 5 — Ecology.** Lay/hatch/spawn/starve (§3, §10) — starve itself lands in step 3; this step
is lay/hatch/spawn.

**Step 6 — Rendering.** The sprite registry and resolver (§7), the plain canvas/SVG renderer and
silk-thread plan drawing (§8/§9), the POV click overlay (§4).

**Step 7 — Pages.** The full-screen self-contained page, the shared ticker helper, the home-page
embed, the browser bundle and build-pipeline wiring (§11).

**Step 8 — Guess-number Play retrofit.** Apply the shared ticker helper from step 7 to the existing
demo rail (§11) — independent of steps 1-6, can land any time after step 7's helper exists.

## 13. Open risks and questions

- **Vision radius calibration.** `radius = 4` (§4) is a starting guess, not a measured value — it
  needs checking against the real page once step 6's renderer exists, to confirm it actually reads
  as "about half the grid."
- **Four lanes on one `planState` slot.** §6.2 extends the existing pairwise-check pattern to a
  fourth lane without redesigning it. Whether that pattern still scales cleanly at four (and
  whatever comes after) is worth watching, not solved here.
- **The new spatial teach-frame's exact phrasing coverage** (§6.1) — the design fixes the mechanism
  (a new closed regex, not a route through existing grammar) but not its full phrasing set; step 4's
  build is where the concrete regex and its accepted variants get authored and tested.

## Non-goals for this document

- Not an implementation — no code changes land from this doc alone.
- Not a general 2D-game framework for tmct — spider-and-fly is a validation harness for combining
  three already-shipped planning shapes into one live session, the same way Hanoi, guess-the-number
  and Ashcombe Hall were each validation harnesses for one shape at a time, not products in their own
  right.
- Not a redesign of the `planState` one-at-a-time coexistence pattern — §6.2 extends it by one lane;
  a genuine arbiter/unification is the same open question §1 names and defers, not something this
  document resolves.
