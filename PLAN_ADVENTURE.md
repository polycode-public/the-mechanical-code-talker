# PLAN_ADVENTURE.md — a text-adventure game as a fourth architectural stretch, validated against a country-house mystery

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-11 session. The operator asked how close tmct is to something like the 1982 game The
Hobbit — famous for a graph-shaped world, an imperative parser, and NPCs that acted on their own
between the player's turns. The honest answer at the time: tmct already has the right substrate (a
taught, queryable fact graph, deterministic parsing, and — from this session's persona work — real
place/object/person vocabulary), but three things are missing: an imperative command grammar, a
mutable turn-by-turn world/player state, and an NPC turn scheduler. The operator then asked for a
plan doc in the spirit of `PLAN_HANOI.md`/`PLAN_GUESS_NUMBER.md` — a genuine architectural stretch
with a concrete, measurable success criterion, not an open-ended feature wishlist — with two hard
constraints carried over verbatim from the operator's own framing:

> actions [are] things in the graph to be rationalised about before execution (not a hard wired
> tool set) ... the state of the player/visitor needs to be maintained ... this should also be just
> a part of the graph ... a node in the graph maps to the player and the player's location is then
> just a property and so on ... a completion digest [for the player's current state] using the
> completions work we did. So no special player state store.

This document is the third in the "architectural stretch" family, alongside `PLAN_HANOI.md`
(open-loop planning) and `PLAN_GUESS_NUMBER.md` (closed-loop, observation-driven planning). All
three validate a piece of "be an agent" — Hanoi validates *executing a precomputed plan*, the
number-guessing game validates *sensing and replanning*, and this document validates *the world
itself changing in response to actions, some of which the agent didn't take* (NPC autonomy). It is
also the first of the three to require a genuinely NEW parsing capability (imperative commands)
rather than reusing the ACE declarative/question grammar as-is.

## Why a country-house mystery, not fantasy

The world is a small, original English country house — Ashcombe Hall — invented for this document,
no references to any existing book, game, or IP. This choice is deliberate, not decorative: this
session's persona batch (`archive/PLAN_SEED.md`) already built a genuine, curated everyday-knowledge
vocabulary (`corpus/tier2/human.jsonl`, `src/grammar/lexicon-core.json`'s `human-core`/
`human-places`/`human-objects` clumps) — rooms, roles, household objects. Grounding the game world in
that same lexicon tests grammar already in scope, in the spirit of this project's own standing
preference for closed-set templates over general rules (`[[tmct-prefers-templates-over-general-rules]]`
in operator memory, and `CLAUDE.md`'s own "templates over general rules"). Overfitting to a small,
well-understood vocabulary is the point (formulaic competence); overfitting to a disconnected
fantasy lexicon (orcs, goblins, generic dungeon-crawl nouns) would test nothing this codebase
already has reason to know. Confirmed directly against the real corpus before writing this doc: of
the world's core nouns, `cook`, `key`, `letter`, `cabinet`, `study`, `library`, `kitchen`, `garden`,
`cellar`, `door`, `room`, `house`, `drawer`, `box`, `table`, `shelf`, `window` are **already**
declared nouns in `src/grammar/lexicon-core.json`; only `butler`, `housekeeper`, `gardener`, `lamp`,
`portrait`, `desk` need adding. `corpus/tier2/human.jsonl` already carries real background facts
this world can build straight on — e.g. `cook AtLocation kitchen`, `kitchen IsA room`, `library IsA
place`, `library HasA book`, `library UsedFor reading` (all verified by direct grep, not assumed).
None of the imperative verbs this doc needs (`go`, `open`, `unlock`, `close`, `look`) are declared
yet; `take` and `give` already are.

## The four architectural gaps, and what tmct already has for each

### Gap 1 — an imperative command grammar

`src/grammar/ace.mjs` (375 lines) has exactly 8 patterns today, all declarative or interrogative:
Pattern 1 (universal ISA, `parseEvery`), Pattern 2 (class assertion, `parseCopula`), Pattern 3
(`N1 VERB N2` relation, `parseRelation`), Pattern 4 (someValuesFrom restriction, `parseRestriction`),
Pattern 5 (cardinality, `parseCardinality`), Pattern 6 (disjointWith, `parseDisjoint`), Pattern 7
(possessive/of-form, `parsePossessive`/`parseOfForm`), Pattern 8 (copula adjective, folded into
Patterns 1/4/5's "every ..." arm and `parseCopula`'s copula arm). None of them parse an imperative
sentence with no stated subject ("go north," "take the key") — every existing pattern requires an
explicit subject noun phrase. This is a real, new grammar surface, not a missing case of an existing
one.

### Gap 2 — mutable turn-by-turn state, with no special player-state store

Confirmed directly: `src/memory/core.mjs`'s `appendFact(dir, {subject, predicate, object, ...})`
(line 1157) is **content-addressed and additive** — re-asserting the same triple upserts in place,
but a DIFFERENT object for the same `(subject, predicate)` produces a second, coexisting Fact
individual (`PLAN_HANOI.md` §3 already established this precisely, for the same reason: no
retraction primitive exists anywhere in the codebase, confirmed again this session with
`grep -rn retract src/` — still nothing). `PLAN_HANOI.md` solved this for board state via
snapshot-per-step (never mutate, always append a fresh timestamped fact). This document reuses that
exact convention for player/world state: `player currentlyIn library@turn7` rather than mutating a
`player currentlyIn library` fact in place. The operator's own framing — "a node in the graph maps
to the player and the player's location is then just a property" — is honoured literally: the player
is one ordinary individual (e.g. `mgx:player`), and `currentlyIn`/`carries`/`hasVisited` are ordinary
taught-fact predicates on that node, read back through the exact same `readFactRows(memory)`
(`core.mjs:1629`) every other feature already uses. No new store, no new schema table — only a
snapshot-write convention, which is already precedented.

### Gap 3 — actions as graph-resident data, reasoned about before execution

This is where `PLAN_TAUGHT_RELATIONS.md`'s Rule model (archived, all six items shipped) is the
direct precedent the operator's framing is asking to extend. Confirmed directly in
`src/memory/core.mjs`: `RULE_KINDS = Object.freeze([RULE_KIND_COMPOSE2, RULE_KIND_FILTER,
RULE_KIND_RECURSIVE])` (line 1306), each with its own slot spec in `RULE_SLOT_SPEC` (line 1318, e.g.
`compose2: [["base1", "mgx:ruleBase1"], ["base2", "mgx:ruleBase2"]]`), stored via
`appendRule(dir, {name, kind, slots, provenance, createdAt})` (line 1356) and looked up via
`findRuleByName(memory, name)` (line 1404) — a genuinely closed, extensible, self-documenting
vocabulary of "things you can teach tmct to reason about," already proven to grow (three kinds
shipped, each independently). This document proposes a **fourth Rule kind, `RULE_KIND_ACTION =
"action"`**, with slots `[["verb", "mgx:ruleActionVerb"], ["precondition", "mgx:ruleActionPrecond"],
["effect", "mgx:ruleActionEffect"]]` — an action is taught the same way a compose2/filter/recursive
relation is taught today, stored as an ordinary Rule individual, never a hardcoded per-verb switch
statement in `chat.mjs`. "Take" is not special-cased JS; it is a Rule named "take" with a
precondition ("the object is in the player's current room, and is not fixed-in-place") and an effect
("the object's `carriedBy` becomes the player"). A new command is teachable through chat the same way
a new relation already is, per `PLAN_TAUGHT_RELATIONS.md`'s own precedent — the plan's own worked
example below stays inside a small closed starter set (go/take/drop/open/unlock/give/look), but the
mechanism itself is not closed to exactly those six.

**Evaluating a precondition before firing** reuses `resolveRelationChase`'s own dispatch discipline
(`memory/core.mjs`, generic over "is this base a plain relation or another Rule," per
`PLAN_TAUGHT_RELATIONS.md` Phase 5's note) rather than inventing a second reasoning engine: a
precondition is itself expressed as an ordinary fact/relation check against the CURRENT graph state
(does `key carriedBy player` hold, or does `door isLockedBy key` fail to hold), evaluated through the
same fact-lookup machinery `factReadBack`'s existing `(a0)` block already uses. `src/syllogise.mjs`'s
budget/focus/deterministic-order discipline (the same convention `PLAN_HANOI.md` §2 already
identified as reusable-by-analogy) governs how far a precondition check is allowed to chase before
giving an honest "you can't do that yet" rather than hanging or guessing.

### Gap 4 — an NPC turn scheduler (the hardest, most genuinely new piece)

tmct today is purely reactive: `runTurn`/`runAsk` only ever run in response to a line of input, never
on their own initiative — confirmed by reading `createSession`'s handle shape (`chat.mjs`, same
`focus`/`last` closure-variable relay `PLAN_GUESS_NUMBER.md` §1 already documented in detail): there
is no timer, no background loop, nothing that calls back into the graph without a `turn(line)` call
first. This document proposes the minimal honest version of autonomy that fits that constraint
without inventing a live process: **each player command that actually changes world state (a
successful action, not a look/inventory query) is followed by exactly one bounded NPC-evaluation
pass**, run synchronously inside the SAME `turn()` call, immediately after the player's own effect is
written. The pass walks every NPC individual in the graph (a small, fixed cast — see the world design
below), checks each NPC's own taught action Rules (the SAME `RULE_KIND_ACTION` mechanism Gap 3
defines — an NPC's "routine" is not special code, it is a Rule whose subject happens to be an NPC
instead of the player) against current state, and fires the first one whose precondition now holds
and whose own scheduling fact (e.g. `housekeeper actsOnTurn 3`) matches the current turn count. This
is honestly a **scripted-by-data, not emergent**, form of autonomy — closer to The Hobbit's own
reality (its "Inference Engine" was itself a fixed rule table over NPC moods, not free simulation)
than to a general planner. The plan is explicit that this is the ceiling for this design, not a
placeholder for something smarter: real emergent NPC behaviour (an NPC that *plans* its own actions
via `findActionPath`, `src/planning.mjs:94`, the same kernel `PLAN_HANOI.md` built) is named as an
explicit non-goal below, not attempted.

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

One new ACE pattern, alongside the existing 8, not folded into any of them (their shapes assume a
subject; this one doesn't). A closed starter verb set — `go`, `take`, `drop`, `open`, `unlock`,
`close`, `give`, `look` — parsed as `{ verb, object?, indirectObject?, direction? }` (`"unlock the
cabinet with the key"` → `{verb: "unlock", object: "cabinet", instrument: "key"}`; `"go north"` →
`{verb: "go", direction: "north"}`). This does NOT resolve to an OWL triple the way Patterns 1-8 do —
an imperative has no truth value to assert, it has an ACTION NAME to look up via `findRuleByName`
(Gap 3). The parser's output shape is closer to `parseCardinality`'s already-structured (non-triple)
return than to `parseRelation`'s triple — precedent already exists in the same file for "a pattern
that doesn't produce a plain subject-predicate-object fact."

### The action Rule kind (Gap 3) — precise slot design

```
RULE_KIND_ACTION = "action"
RULE_SLOT_SPEC[RULE_KIND_ACTION] = [
  ["verb", "mgx:ruleActionVerb"],
  ["precondition", "mgx:ruleActionPrecond"],   // a relation-check expression (see below)
  ["effect", "mgx:ruleActionEffect"],          // a snapshot-fact template (see below)
]
```

A precondition is stored as a small closed expression shape (subject-slot, predicate, object-slot,
polarity — "must hold" or "must NOT hold"), not free text — mirroring `RULE_SLOT_SPEC`'s own existing
discipline of storing STRUCTURE, never prose, in a Rule's slots. An effect is a template for the
snapshot fact to append (`{subject: "$object", predicate: "carriedBy", object: "$player"}` for take,
substituting the actual parsed object/player ids at execution time). Both are intentionally minimal —
this is not a general programming language, it is the smallest closed vocabulary that can express
Ashcombe Hall's own six actions, matching this project's own "breadth over depth, closed-set over
general rules" discipline everywhere else.

### The player-state digest (Gap 2, "no special player state store")

`"look"` and `"what am I carrying"` do NOT get hand-written room-description templates. They call
`generateCompletion(dir, playerLocationLabel, { query: playerLocationLabel, memory, graph, graphService
})` exactly as `src/completions/complete.mjs` already defines it, letting Stage 1's `broadSearch`
(via `createCompletionsGraphAdapter`, `src/completions/graph-adapter.mjs`) surface every taught fact
whose subject or object mentions the current room (`readFactRows(memory)`, the adapter's own `.ask()`
already does exactly this term-matching search, confirmed by rereading `graph-adapter.mjs:97-105`).
"What am I carrying" is the same call with `query = playerId` instead of the room label. This is
genuinely just pointing the existing extractive pipeline at a different query term — no new
digest/rendering code, matching the operator's explicit instruction not to build a bespoke player
summarizer. The one real risk, named honestly: `pruneCompletion`'s top-K-per-group cutoff
(`DEFAULT_MAX_SENTENCES_PER_GROUP = 3`, `complete.mjs:54`) could silently drop a fact that matters for
correctness (e.g. the locked-cabinet fact, if it's competing with other room-facts for the top-3
slot) — Phase 2 below must verify this concretely against the real worked example, not assume it away.

### The NPC scheduler (Gap 4) — precise mechanism

A turn counter (`mgx:turnNumber` on a small session-scoped Turn individual, incremented by one on
every state-changing player command — queries like "look" do not advance it). After the player's own
effect is written, one bounded pass: for each NPC individual tagged `mgx:isNpc`, check its own taught
`action`-kind Rules whose `precondition` includes an `actsOnTurn` match against the current counter;
fire the first one that both matches the turn AND passes its stated precondition, writing its effect
via the same snapshot-append convention as the player's own actions. This pass is capped at one fired
action per NPC per turn (never a cascade) and is fully deterministic (NPCs are walked in a fixed,
sorted order; ties are impossible by construction since each NPC's own Rules are turn-scoped to a
single number) — no hidden randomness, matching this project's zero-LLM, deterministic ethos
throughout.

## Staged build plan

*(Mirrors `PLAN_HANOI.md`/`PLAN_GUESS_NUMBER.md`'s own phase-writing convention: numbered,
independently testable, `npm test` green throughout, nothing here implemented yet.)*

**Phase 1 — World corpus + missing lexicon.** Add `butler`/`housekeeper`/`gardener`/`lamp`/`portrait`/
`desk` to `lexicon-core.json`; add Ashcombe Hall's rooms/exits/objects/roles as `corpus/tier2/
adventure.jsonl` (new tier-2 bundle, inactive by default, activated the same way `human-medium`/
`human-large` already are — `PLAN_SEED.md`'s own precedent). Exit criterion: `tmct init --with-persona
adventure` (or equivalent) seeds a graph where every room/object/role from the worked example is a
real individual, confirmed by direct query, zero grammar/scheduler code touched yet.

**Phase 2 — The imperative grammar pattern + `RULE_KIND_ACTION` storage.** The new ACE pattern (Gap
1) and the fourth Rule kind (Gap 3), unit-tested purely (parse → structured command; teach → stored
Rule; no chat wiring, no player-state writes yet). Exit criterion: all six starter verbs parse
correctly, and a hand-authored action Rule for each round-trips through `appendRule`/`findRuleByName`
unchanged.

**Phase 3 — Player-state-as-facts + the digest.** The snapshot-per-step player/world state convention
(Gap 2) and the `generateCompletion`-driven "look"/"inventory" digest, wired into chat but with NO NPC
autonomy yet (single-player, fully player-driven). Exit criterion: the worked example's command
sequence runs correctly end to end MINUS the housekeeper's turn-3 move, with every precondition
failure honestly declined (the "take the portrait" step in particular — a real negative case, not
just the happy path).

**Phase 4 — The NPC scheduler.** Gap 4's turn-counted pass, the housekeeper's turn-3 Rule as the
first (and, for this validation, only) NPC action. Exit criterion: the FULL worked example above
passes exactly as specified, including the independent graph-state check for the housekeeper's move
whether or not the player was present to see it.

**Phase 5 — Generalization spike (deferred, explicitly not this document's scope).** Once this and
both prior planning docs have independently validated their own piece (open-loop execution, closed-
loop replanning, world-mutation-with-autonomous-actors), revisit whether a single unifying "agent
loop" abstraction is warranted — same explicit deferral `PLAN_HANOI.md` Phase 4 and
`PLAN_GUESS_NUMBER.md` Phase 4 both already stage for their own convergence point.

## Open risks / questions

- **Precondition-expression ceiling.** The closed (subject-slot, predicate, object-slot, polarity)
  shape covers Ashcombe Hall's six actions but is genuinely limited — no conjunctions/disjunctions
  of multiple conditions, no "N of M" style checks. Whether that ceiling is a real product limit or
  just this validation's own small scope is unresolved; not designed further here.
- **Snapshot volume.** `PLAN_HANOI.md` §3 already flagged snapshot-per-step's cost profile as fine at
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
- **Confirmation-before-executing.** `PLAN_HANOI.md`'s own open question (should a move require
  confirmation) applies here too, and this document's answer leans the same direction that doc's
  `teachFact` precedent suggests (act, then state plainly what happened) — but a MISTAKEN action here
  (e.g. "give the letter to the housekeeper" before you've even found it) has no real-world stakes in
  a toy game either, so this is left as a Phase 3 implementation decision, not resolved here.

## Non-goals for this document

- Not an implementation — no code changes land from this doc alone.
- Not a general game engine — Ashcombe Hall is a validation harness for the four architectural gaps,
  the same way Hanoi and the number-guessing game are validation harnesses, not products in their own
  right.
- Not emergent/planning NPC behaviour — Gap 4's scheduler is explicitly scripted-by-data (a fixed
  Rule table per NPC), not an NPC that plans its own path via `findActionPath`. A genuinely planning
  NPC is a real, much larger follow-on, not attempted here.
- Not a replacement for `PLAN_HANOI.md`/`PLAN_GUESS_NUMBER.md` — a third, complementary validation of
  the same underlying "read state, reason about actions' effects, act, repeat" capability, from the
  angle neither of the other two covers (a world that changes for reasons other than the agent's own
  choices).
