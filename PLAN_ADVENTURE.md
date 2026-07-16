# PLAN_ADVENTURE.md — a text-adventure game as a fourth architectural stretch, validated against a country-house mystery

Status: RESEARCH / DESIGN. Two of the four gaps this document originally designed have since
shipped generically; this document now scopes the pieces still unbuilt (the imperative command
grammar, the NPC turn scheduler, the Ashcombe Hall corpus, and the room-look digest) on top of
that shipped substrate.

**What shipped since this document was written.**

- Mutable turn-by-turn world state as graph facts (this document's Gap 2) shipped as per-step
  board snapshots (`board@step1…N`), written through ordinary `appendFact` and executed by the
  "next" command (`PLAN_NEXT_RE` in `src/chat.mjs`). The river-crossing rows in
  `test/corpus/planning.jsonl` validate it end to end.
- Actions as taught, graph-resident data with precondition checks before firing (Gap 3) shipped
  richer than proposed here: four action rule kinds (`RULE_KIND_ACTION_SIGNATURE` /
  `RULE_KIND_ACTION_PRECOND` / `RULE_KIND_ACTION_EFFECT` / `RULE_KIND_ACTION_CONSTRAINT` in
  `src/memory/core.mjs`), live teach frames (the ACTION-RULE TEACH FRAMES in `src/chat.mjs`),
  legal-move enumeration with constraint pruning (`movesFromRules` in `src/domain.mjs`), and
  plan search (`findActionPath` / `findReachableSet` in `src/planning.mjs`).
- Taught action families register as capability records the router executes
  (`src/router/taught.mjs`; chat's `/plan`; `tmct plan "<request>"`). World-mutating actions now
  flow through the router, alongside the read-only graph-QUERY tools it started with.

Ashcombe Hall builds ON this substrate. Nothing below redesigns it.

## Origin

2026-07-11 session. The operator asked how close tmct is to something like the 1982 game The
Hobbit — famous for a graph-shaped world, an imperative parser, and NPCs that acted on their own
between the player's turns. The answer at the time: tmct already had the right substrate (a
taught, queryable fact graph, deterministic parsing, and — from that session's persona work — real
place/object/person vocabulary), but three things were missing: an imperative command grammar, a
mutable turn-by-turn world/player state, and an NPC turn scheduler. The operator then asked for a
plan doc in the spirit of `archive/PLAN_HANOI.md`/`PLAN_GUESS_NUMBER.md` — a genuine architectural
stretch with a concrete, measurable success criterion, not an open-ended feature wishlist — with
two hard constraints carried over verbatim from the operator's own framing:

> actions [are] things in the graph to be rationalised about before execution (not a hard wired
> tool set) ... the state of the player/visitor needs to be maintained ... this should also be just
> a part of the graph ... a node in the graph maps to the player and the player's location is then
> just a property and so on ... a completion digest [for the player's current state] using the
> completions work we did. So no special player state store.

This document is the third in the "architectural stretch" family, alongside `archive/PLAN_HANOI.md`
(open-loop planning) and `PLAN_GUESS_NUMBER.md` (closed-loop, observation-driven planning). All
three validate a piece of "be an agent" — Hanoi validates *executing a precomputed plan*, the
number-guessing game validates *sensing and replanning*, and this document validates *the world
itself changing in response to actions, some of which the agent didn't take* (NPC autonomy). It is
also the only one of the three to need a genuinely NEW parsing capability (imperative commands)
rather than reusing the ACE declarative/question grammar as-is.

## Why a country-house mystery, not fantasy

The world is a small, original English country house — Ashcombe Hall — invented for this document,
no references to any existing book, game, or IP. This choice is deliberate, not decorative: the
persona batch (`archive/PLAN_SEED.md`) already built a genuine, curated everyday-knowledge
vocabulary (`corpus/tier2/human.jsonl`, `src/grammar/lexicon-core.json`'s `human-core`/
`human-places`/`human-objects` clumps) — rooms, roles, household objects. Grounding the game world in
that same lexicon tests grammar already in scope, in the spirit of this project's own standing
preference for closed-set templates over general rules (`[[tmct-prefers-templates-over-general-rules]]`
in operator memory, and `CLAUDE.md`'s own "templates over general rules"). Overfitting to a small,
well-understood vocabulary is the point (formulaic competence); overfitting to a disconnected
fantasy lexicon (orcs, goblins, generic dungeon-crawl nouns) would test nothing this codebase
already has reason to know. Confirmed directly against the real corpus: of the world's core nouns,
`cook`, `key`, `letter`, `cabinet`, `study`, `library`, `kitchen`, `garden`, `cellar`, `door`,
`room`, `house`, `drawer`, `box`, `table`, `shelf`, `window` are **already** declared nouns in
`src/grammar/lexicon-core.json`; only `butler`, `housekeeper`, `gardener`, `lamp`, `portrait`,
`desk` need adding. `corpus/tier2/human.jsonl` already carries real background facts this world can
build straight on — e.g. `cook AtLocation kitchen`, `kitchen IsA room`, `library IsA place`,
`library HasA book`, `library UsedFor reading` (all verified by direct grep, not assumed). None of
the imperative verbs this doc needs (`go`, `open`, `unlock`, `close`, `look`) are declared yet;
`take` and `give` already are.

## The four architectural gaps: two shipped, two open

### Gap 1 — an imperative command grammar (open)

`src/grammar/ace.mjs` (~480 lines) has nine patterns today, all declarative or interrogative:
Pattern 1 (universal ISA, `parseEvery`), Pattern 2 (class assertion, `parseCopula`), Pattern 3
(`N1 VERB N2` relation, `parseRelation`), Pattern 4 (someValuesFrom restriction, `parseRestriction`),
Pattern 5 (cardinality, `parseCardinality`), Pattern 6 (disjointWith, `parseDisjoint`), Pattern 7
(possessive/of-form, `parsePossessive`/`parseOfForm`), Pattern 8 (copula adjective, folded into
Patterns 1/4/5's "every ..." arm and `parseCopula`'s copula arm), and Pattern 9 ("N can VERB" →
`mgx:capableOf`, `parseCapability`). None of them parse an imperative sentence with no stated
subject ("go north," "take the key") — every existing pattern requires an explicit subject noun
phrase. `lexicon-core.json` carries an empty `"imperative"` stub and nothing more; no
`parseImperative` exists anywhere in the tree. This is a real, new grammar surface, not a missing
case of an existing one.

### Gap 2 — mutable turn-by-turn state, no special player-state store (shipped; reuse it)

Shipped generically as the snapshot-per-step convention this document proposed: never mutate,
always append a fresh per-step fact through the ordinary `appendFact` path, read back through the
same `readFactRows(memory)` every other feature uses. The "next" command (`PLAN_NEXT_RE` in
`src/chat.mjs`) executes one plan step and writes the `board@stepN` snapshot; the river-crossing
rows in `test/corpus/planning.jsonl` check every intermediate board against the written facts.
Ashcombe Hall reuses this as-is: the player is one ordinary individual (e.g. `mgx:player`), and
`currentlyIn`/`carries`/`hasVisited` are ordinary snapshot facts on that node
(`player currentlyIn library@turn7`). The one piece still unbuilt is Ashcombe-specific: the
room-look digest over `generateCompletion` (see Design detail).

### Gap 3 — actions as graph-resident data, reasoned about before execution (shipped; reuse it)

This document proposed one new rule kind, `RULE_KIND_ACTION`, with `[verb, precondition, effect]`
slots. The shipped design is finer-grained: four action rule kinds in `src/memory/core.mjs` —
`RULE_KIND_ACTION_SIGNATURE`, `RULE_KIND_ACTION_PRECOND`, `RULE_KIND_ACTION_EFFECT`,
`RULE_KIND_ACTION_CONSTRAINT` (`RULE_KINDS` now has seven entries). An action is a named family of
these rules, taught one sentence at a time through the ACTION-RULE TEACH FRAMES in `src/chat.mjs`,
stored as ordinary Rule individuals, never a hardcoded per-verb switch. `movesFromRules`
(`src/domain.mjs`) enumerates the legal moves a state allows and prunes with the taught
constraints; `findActionPath`/`findReachableSet` (`src/planning.mjs`) search over them; each taught
family also registers as a capability record the router consumes (`src/router/taught.mjs`,
`/plan`). Ashcombe Hall's verbs (`go`, `take`, `drop`, `open`, `unlock`, `close`, `give`, `look`)
are ordinary taught families on this mechanism. Nothing here needs a new kind or new storage.

### Gap 4 — an NPC turn scheduler (open; the hardest genuinely new piece)

tmct today is purely reactive: the planner and everything else run only in response to a line of
input, inside `turn(line)` — confirmed by reading `createSession`'s handle shape (`src/chat.mjs`,
the same `focus`/`last` closure-variable relay `PLAN_GUESS_NUMBER.md` §1 documented). There is no
turn counter, no timer, no background loop; nothing calls back into the graph without a `turn(line)`
call first. This document proposes the minimal honest version of autonomy that fits that constraint
without inventing a live process: **each player command that actually changes world state (a
successful action, not a look/inventory query) is followed by exactly one bounded NPC-evaluation
pass**, run synchronously inside the SAME `turn()` call, immediately after the player's own effect
is written. The pass walks every NPC individual in the graph (a small, fixed cast — see the world
design below), checks each NPC's own taught action families (the same shipped mechanism Gap 3 now
points to — an NPC's "routine" is not special code, it is a taught action family whose subject
happens to be an NPC instead of the player) against current state, and fires the first one whose
precondition now holds and whose own scheduling fact (e.g. `housekeeper actsOnTurn 3`) matches the
current turn count. This is honestly a **scripted-by-data, not emergent**, form of autonomy —
closer to The Hobbit's own reality (its "Inference Engine" was itself a fixed rule table over NPC
moods, not free simulation) than to a general planner. Real emergent NPC behaviour (an NPC that
plans its own path with `findActionPath`) is a further tier this document doesn't design; the
search it needs already runs in live goal-solving, so that tier would build on shipped code.

## The world: Ashcombe Hall

A small manor, six rooms (`study`, `library`, `kitchen`, `drawing-room`, `cellar`, `garden`), each an
ordinary graph individual connected by `mgx:hasExit` edges (`study --north--> library`, etc. — one
new closed-set predicate, the same shape `restsOn` was for Hanoi's board). Four staff/family roles,
reusing the existing corpus where a role already exists (`cook`, already present and already tied to
`kitchen` via `cook AtLocation kitchen`) and adding the three genuinely missing ones (`butler`,
`housekeeper`, `gardener`) to `corpus/tier2/human.jsonl`/`lexicon-core.json`, following exactly the
tier-2 curation discipline `PLAN_SEED.md` already established (hand-authored, homage-to-source-shape,
never a wholesale dump). Five objects: a `key`, a `letter`, a `lamp`, a `cabinet`, a `portrait` (the
first two nouns already declared; `lamp`/`portrait` need adding, `cabinet` already declared).

**The worked mystery, and this document's measurable success criterion**: the study's `cabinet` is
locked; its `key` is hidden inside the `portrait` in the drawing room (`key locatedIn portrait`); the
`letter` (the goal object) is inside the locked `cabinet`. One NPC autonomous action is load-bearing:
the `housekeeper` is taught a Rule that, on turn 3 (regardless of what the player has done), moves
from `kitchen` to `library` (`housekeeper actsOnTurn 3`, effect `housekeeper currentlyIn library`) —
if the player is in the library at that moment, this is directly observable ("the housekeeper walks
in, carrying a duster"); if not, it is still a real, verifiable graph-state change the success
criterion checks for, exactly the way The Hobbit's NPCs moved whether or not you were there to see
it.

**Exact success criterion** (the equivalent of Hanoi's `2^n - 1` or the number game's `⌈log2 N⌉` —
an unambiguous, checkable pass/fail, not a vibe): starting fresh in the `study`, the following command
sequence must complete with every intermediate state correct, not just the final one —

```
look                              -> honest room description (a completions digest, see below),
                                      cites the locked cabinet, no key visible
go north                          -> now in the library
go north                          -> now in the drawing-room
look                              -> mentions the portrait
take the portrait                 -> declines (fixed-in-place; a precondition failure, not silence)
open the portrait                 -> succeeds; key becomes visible/takeable (its effect)
take the key                      -> key's carriedBy becomes player
go south                          -> back in the library
[if the housekeeper's turn-3 rule has fired by now, "look" here names her presence]
go south                          -> back in the study
unlock the cabinet with the key   -> precondition (key carriedBy player) holds; cabinet unlocks
open the cabinet                  -> succeeds now the lock is gone
take the letter                   -> success; the win condition
```

Pass = every step's graph-state effect is correct AND every precondition failure is an honest,
specific decline (never silence, never a fabricated success) AND the housekeeper's turn-3 move is
independently confirmed in the graph (`readFactRows` shows `housekeeper currentlyIn library@turn3`)
whether or not the player witnessed it. This mirrors Hanoi's own bar: not "did it look plausible," but
"does the actual written graph state match the expected state at every step."

## Design detail

### The imperative grammar pattern (Gap 1)

One new ACE pattern, alongside the existing nine, not folded into any of them (their shapes assume
a subject; this one doesn't). A closed starter verb set — `go`, `take`, `drop`, `open`, `unlock`,
`close`, `give`, `look` — parsed as `{ verb, object?, indirectObject?, direction? }` (`"unlock the
cabinet with the key"` → `{verb: "unlock", object: "cabinet", instrument: "key"}`; `"go north"` →
`{verb: "go", direction: "north"}`). This does NOT resolve to an OWL triple the way the other
patterns do — an imperative has no truth value to assert, it has an ACTION NAME to resolve against
the taught action families Gap 3 already ships. The parser's output shape is closer to
`parseCardinality`'s already-structured (non-triple) return than to `parseRelation`'s triple —
precedent already exists in the same file for "a pattern that doesn't produce a plain
subject-predicate-object fact."

### The action rules (Gap 3) — reuse the shipped mechanism

This document's original single-kind slot design is superseded. The shipped vocabulary
(`RULE_KIND_ACTION_SIGNATURE`/`PRECOND`/`EFFECT`/`CONSTRAINT`, `src/memory/core.mjs`) already
stores structure, never prose: a signature names the verb and its slots, preconditions and effects
are separate rule individuals in the same named family, and constraints prune illegal moves. The
game teaches its starter verbs through the existing teach frames in `src/chat.mjs`. If one of
Ashcombe's actions needs a precondition shape the shipped vocabulary can't express, Phase 2
surfaces that as a concrete gap in the shipped mechanism, not a new design here.

### The player-state digest (Gap 2 residue, "no special player state store")

`"look"` and `"what am I carrying"` do NOT get hand-written room-description templates. They call
`generateCompletion(dir, playerLocationLabel, { query: playerLocationLabel, memory, graph, graphService
})` exactly as `src/completions/complete.mjs` already defines it, letting Stage 1's `broadSearch`
(via `createCompletionsGraphAdapter`, `src/completions/graph-adapter.mjs`) surface every taught fact
whose subject or object mentions the current room — the adapter's own `.ask()` already does exactly
this term-matching search over `readFactRows(memory)`. "What am I carrying" is the same call with
`query = playerId` instead of the room label. This is genuinely just pointing the existing
extractive pipeline at a different query term — no new digest/rendering code, matching the
operator's explicit instruction not to build a bespoke player summarizer. An adjacent shipped
mechanism worth knowing about: taught `mgx:rendersAs` bindings already drive the plan lane's board
digest (the render-binding teach frame in `src/chat.mjs`, consumed by `src/plan-viz.mjs`), so a
room rendering has a second precedented path if the extractive digest falls short. The one real
risk, named plainly: `pruneCompletion`'s top-K-per-group cutoff (`DEFAULT_MAX_SENTENCES_PER_GROUP`
in `src/completions/complete.mjs`) could silently drop a fact that matters for correctness (e.g.
the locked-cabinet fact, if it's competing with other room-facts for the top-K slots) — Phase 3
below must verify this concretely against the real worked example, not assume it away.

### The NPC scheduler (Gap 4) — precise mechanism

A turn counter (`mgx:turnNumber` on a small session-scoped Turn individual, incremented by one on
every state-changing player command — queries like "look" do not advance it). After the player's own
effect is written, one bounded pass: for each NPC individual tagged `mgx:isNpc`, check its own taught
action families whose preconditions include an `actsOnTurn` match against the current counter; fire
the first one that both matches the turn AND passes its stated precondition, writing its effect
via the same snapshot-append convention as the player's own actions. This pass is capped at one fired
action per NPC per turn (never a cascade) and is fully deterministic (NPCs are walked in a fixed,
sorted order; ties are impossible by construction since each NPC's own Rules are turn-scoped to a
single number) — no hidden randomness, matching this project's zero-LLM, deterministic ethos
throughout.

## Staged build plan

*(Mirrors `archive/PLAN_HANOI.md`/`PLAN_GUESS_NUMBER.md`'s own phase-writing convention: numbered,
independently testable, `npm test` green throughout.)*

**Phase 1 — World corpus + missing lexicon.** Add `butler`/`housekeeper`/`gardener`/`lamp`/`portrait`/
`desk` to `lexicon-core.json`; add Ashcombe Hall's rooms/exits/objects/roles as `corpus/tier2/
adventure.jsonl` (new tier-2 bundle, inactive by default, activated the same way `human-medium`/
`human-large` already are — `PLAN_SEED.md`'s own precedent). Exit criterion: `tmct init --with-persona
adventure` (or equivalent) seeds a graph where every room/object/role from the worked example is a
real individual, confirmed by direct query, zero grammar/scheduler code touched yet.

**Phase 2 — The imperative grammar pattern.** The new ACE pattern (Gap 1), unit-tested purely
(parse → structured command; no chat wiring, no player-state writes yet). Action storage already
shipped, so this phase also teaches each Ashcombe action through the existing teach frames and
confirms `movesFromRules` enumerates it. Exit criterion: all starter verbs parse correctly, and
every Ashcombe action family round-trips through the shipped teach/lookup path unchanged.

**Phase 3 — Player-state wiring + the digest.** Wire parsed imperatives to fire their taught action
family and write player/world snapshot facts (the shipped Gap 2 convention), plus the
`generateCompletion`-driven "look"/"inventory" digest — chat-wired but with NO NPC autonomy yet
(single-player, fully player-driven). Exit criterion: the worked example's command sequence runs
correctly end to end MINUS the housekeeper's turn-3 move, with every precondition failure honestly
declined (the "take the portrait" step in particular — a real negative case, not just the happy
path).

**Phase 4 — The NPC scheduler.** Gap 4's turn-counted pass, the housekeeper's turn-3 Rule as the
first (and, for this validation, only) NPC action. Exit criterion: the FULL worked example above
passes exactly as specified, including the independent graph-state check for the housekeeper's move
whether or not the player was present to see it.

**Phase 5 — Generalization spike (deferred, explicitly not this document's scope).** Once this and
both prior planning docs have independently validated their own piece (open-loop execution, closed-
loop replanning, world-mutation-with-autonomous-actors), revisit whether a single unifying "agent
loop" abstraction is warranted — same explicit deferral `archive/PLAN_HANOI.md` Phase 4 and
`PLAN_GUESS_NUMBER.md` Phase 4 both already stage for their own convergence point.

## Open risks / questions

- **Precondition-expression coverage.** The shipped precond/constraint rule shapes already carry
  the river crossing's co-travel constraints. Whether they express Ashcombe's fixed-in-place
  decline ("take the portrait") and instrument checks ("unlock the cabinet with the key") is
  Phase 2's first concrete question; a shape they can't express becomes a targeted extension to
  the shipped vocabulary, designed then.
- **Snapshot volume.** `archive/PLAN_HANOI.md` §3 already flagged snapshot-per-step's cost profile as fine at
  toy scale, expensive at larger ones. A full playthrough of Ashcombe Hall's worked example is ~12
  turns — trivial — but a much longer game would revisit this exactly as Hanoi's own doc already
  anticipated (recommendation there: revisit a real retraction primitive only if volume becomes a
  real problem, not preemptively).
- **The completions top-K risk named above** (pruneCompletion possibly dropping a correctness-critical
  fact from a room digest) needs a real check against the worked example in Phase 3, not an assumption
  either way.
- **NPC scheduling scale.** One NPC, one scripted turn-3 action, is enough to validate the mechanism
  but says nothing about how this would hold up with many NPCs each carrying many turn-gated Rules —
  named as an explicit non-goal for this document, consistent with Hanoi's own "search-space blow-up
  beyond toy scale" deferral.
- **Confirmation-before-executing.** `archive/PLAN_HANOI.md`'s own open question (should a move require
  confirmation) applies here too, and this document's answer leans the same direction that doc's
  `teachFact` precedent suggests (act, then state plainly what happened) — but a MISTAKEN action here
  (e.g. "give the letter to the housekeeper" before you've even found it) has no real-world stakes in
  a toy game either, so this is left as a Phase 3 implementation decision, not resolved here.

## Non-goals for this document

- Not an implementation — no code changes land from this doc alone.
- Not a general game engine — Ashcombe Hall is a validation harness for the remaining architectural
  gaps, the same way Hanoi and the number-guessing game are validation harnesses, not products in
  their own right.
- Not emergent/planning NPC behaviour — Gap 4's scheduler is explicitly scripted-by-data (a fixed
  Rule table per NPC), not an NPC that plans its own path. A genuinely planning NPC is a real,
  larger follow-on tier; the `findActionPath` search it would use already runs in live
  goal-solving, so the tier starts from shipped code when someone designs it.
- Not a replacement for `archive/PLAN_HANOI.md`/`PLAN_GUESS_NUMBER.md` — a third, complementary validation of
  the same underlying "read state, reason about actions' effects, act, repeat" capability, from the
  angle neither of the other two covers (a world that changes for reasons other than the agent's own
  choices).
