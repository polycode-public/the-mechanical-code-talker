# PLAN_RIVER_CROSSING.md — river-crossing puzzles on the MUDIII square, with every imperative externalised as a fact

Status: design. Nothing below is built. Every module path that is not marked "ships today" is a file
that does not exist yet.

This plan is written to be built by Sonnet-tier implementers with no further design work. Every phase
names its module paths, data structures, function signatures, test files, corpus rows and acceptance
commands. Where a phase is mechanical enough for Haiku, section 13 says so. The hard decisions (which
predicates carry a drive, what a spawn copies, what a class edit does to a live instance, where the
puzzle's constraint comes from, whether this is a new page) are fixed here, in writing.

The feature in one paragraph. MUDIII's town square already runs a fox and three goblins, each
planning its own moves over the shipped fact graph. What makes the fox a predator is a frozen JS
table; what makes it hungry is a config number. This plan moves both into facts. An agent class
carries its display name, its avatar, what it pursues, what it evades, what it consumes, what it
weighs at birth and what a turn costs it, all as ordinary `mgx:` rows. Spawning `goblin-1` copies the
goblin class's rows onto the instance, so a per-instance edit changes that goblin and leaves its
siblings alone. At the software level a fox and a goblin then differ only by their rows. On top of
that vocabulary the river-crossing family (wolf, goat and cabbage, and its three siblings from the
Wikipedia article) becomes a world you can edit in the page: the "may not be left alone with"
constraint the planner already understands is derived from the same `mgx:consumes` rows that make the
fox chase goblins. The square gains an actor card that shows the selected agent's beliefs and the
plan those beliefs produce, and both recompute on every edit without advancing a turn.

---

## 1. What ships today

Most of this plan's machinery already exists. This section names the seams so every phase below cites
them instead of re-deriving them.

### 1.1 MUDIII is shipped and deployed

`NEXT.md:26-28` carries a footnote saying MUDIII is "design only" and naming the credits to use "if
`mudiii.html` ever ships". That footnote is stale. It was written on 2026-08-01 (`af8e2cbd`), and
`backlog/PLAN_MUD_MUDIII.md:1-6` was flipped to `Status: shipped` two days later (`caebc9c4`). The
page is live, deployed and smoke-checked:

- `scripts/site-pages.mjs:16-23` — `DEMO_PAGES = ["chat", "sprites", "ledger", "plan", "mudiii",
  "adventure"]`, with head meta at `:62-65`.
- `scripts/build-demo-site.mjs:525-573` — the render block that builds the three vendor bundle, the
  page bundle, and writes `public/mudiii.html` from `renderMudiiiHtml`.
- `scripts/post-deploy-smoke.mjs:68-123` — `mudiiiPage()` fetches `mudiii.html` off the live site and
  reads `data/mudiii-assets.json`'s manifest as a release gate.
- `.gitlab-ci.yml:752` — `test-e2e/pages-mudiii.test.mjs` runs in `e2e:deployed:pages`.
- Source: `src/domain/town-square-world.mjs`, `src/services/predator-prey.mjs`,
  `src/services/mudiii-turn.mjs`, `src/services/mudiii-scene.mjs`, `src/services/mudiii-viz.mjs`,
  `src/surfaces/web/mudiii-browser-entry.mjs`, `data/mudiii-assets.json`,
  `scripts/build-mudiii-bundle.mjs`.

The MUDIII documents that are still design only are `backlog/PLAN_MUD_MUDIII_SHARED.md` (the share/join
phase) and `backlog/PLAN_MUD_MUDMMORPG.md`. Neither is a dependency here. Fixing `NEXT.md`'s footnote
is R6's job (section 10), because it is the one live doc that would tell a future session this page
does not exist.

### 1.2 The river-crossing puzzle already solves, in chat, not on the square

`data/games/river.txt` ships the wolf/goat/cabbage crossing as a taught-action lesson, scaffolded by
`tmct init` into `.tmct/imports/games/river.txt`. Its thirteen rule sentences are the whole puzzle:

```
you can ferry a passenger onto a bank.
ferrying a passenger onto a bank makes the passenger stand on the target.
ferrying a passenger onto a bank makes the farmer stand on the target.
to ferry a passenger onto a bank, the wolf may not be with the goat without the farmer.
to ferry a passenger onto a bank, the goat may not be with the cabbage without the farmer.
```

`test-e2e/domain-river.test.mjs:22-60` pins two behaviours end to end: the opening position prunes to
exactly one legal move (`1. ferry goat-1 onto bank-west`), and the solve lands the classic optimum
(`plan found — 7 moves (shortest)`), goat first and goat last. The file runs in CI in `e2e-cli` and
again in `e2e:published-package` (`.gitlab-ci.yml:371`, `:872`).

Underneath: `src/domain/domain.mjs` compiles Rule rows into an action domain
(`compileDomain:62`, `stateFromFacts:211`, `movesFromRules:366`, `compileGoal:413`), and
`src/domain/planning.mjs:30`'s `findActionPath(startState, isGoal, applyActions, { maxDepth,
stateKey })` runs a bounded, cycle-safe, shortest-first BFS over it. The constraint frame the river
needs is `{ left, right, guard }` (`src/domain/domain.mjs:104-108`), enforced by `constraintViolated`
(`:345-359`). The chat lane's success template is `src/services/chat.mjs:13670-13675`; its honest miss
is `:13613-13618` (`no plan found within ${maxDepth} moves…`), and a grounding blow-out is
`PlanBudgetError` (`src/domain/domain.mjs:51`, default budget 5000 at `:366`).

So the puzzle's *logic* ships. What does not ship is the puzzle as a place you can stand in, watch,
and edit. Nothing connects `data/games/river.txt` to the MUDIII square.

### 1.3 Where an agent's imperatives live today

They live in JavaScript, not in facts. `src/services/predator-prey.mjs:54-62`:

```js
/** The v1 cast. Keyed by role, never by species — every knob this engine reads
 *  is role-keyed too, so swapping the pair is data. `hunts` is the cast's own
 *  statement of who preys on whom, and it is the only thing the decision chain
 *  reads to tell a threat from a bystander. */
export const MUDIII_ROLES = Object.freeze({
  predator: { role: "predator", kind: "fox", idPrefix: "fox", hunts: "prey" },
  prey: { role: "prey", kind: "goblin", idPrefix: "goblin", hunts: null },
  food: { spawnedKind: "crumb", placedKind: "morsel" },
});
```

`rolesHuntedBy(role, roles)` (`:70`) and `rolesHunting(role, roles)` (`:81`) are the only readers of
that `hunts` link, and they are what the decision chain uses to tell a threat from a bystander. The
numbers sit one file over, in `src/domain/game-config.mjs:72-108` (`DEFAULT_GAME_CONFIG.mudiii`),
overridable only from `tmct.toml`'s `[games.mudiii]` table through `resolveGameConfig` (`:256`) and its
snake-to-camel map (`MUDIII_KEY_MAP`, `:165-182`):

```
predatorInitialMass 20, predatorMassDecrementPerTurn 0.08, predatorVisionRadius 4,
preyInitialMass 8,      preyMassDecrementPerTurn 0.06,     preyVisionRadius 3,
preySpawnIntervalTurns 5, foodSpawnIntervalTurns 3, spawnedFoodMass 2, placedFoodMass 2,
maxPreyPopulation 6, maxFoodItems 8,
foodVisionGated true, blendPreyDecision false, preyThreatWeight 0.5, teach false
```

The page flips exactly one of them. `teach` rides the `#teachToggle` checkbox
(`src/surfaces/web/mudiii-browser-entry.mjs:199`); everything else is fixed when the session opens. The
deck's fox, goblin, delay and max-turn sliders set roster counts and playback pacing, not these knobs.

There is a third place these numbers appear, and it is the one to watch.
`structuralFactRows(lay)` (`src/domain/town-square-world.mjs:391-431`) restates them as read-only facts
so the ask and chat surfaces can answer questions about the board:

```js
yield fact(predator, "mgx:hasA",       `vision radius of ${pluralize(knobs.predatorVisionRadius, "cell")} by default`);
yield fact(predator, "mgx:start-with", `mass ${knobs.predatorInitialMass} by default`);
yield fact(predator, "mgx:lose",       `${knobs.predatorMassDecrementPerTurn} mass per turn by default`);
```

Those rows are derived from `DEFAULT_GAME_CONFIG.mudiii` and the engine never reads them back, which is
why every one of them ends "by default". After R2 the real trait rows carry the number and these become
a second statement of the same thing. R2 owns reconciling them (section 6.3).

Two things make this a short move rather than a rewrite. First, every entry point already takes the
cast as an injected parameter: `startTownSquareGame(memoryDir, { …, roles = MUDIII_ROLES })`
(`:857-859`), and the same default on `recastTownSquare:909`, `placeFood:983`, `runTownSquareTick:1102`
and `townSquareBoard:1483`. Second, the design intent is already written down: the fixture's own
readme says roles are "Keyed by role, never by species, so a new cast is a new roles object and no
engine edit."

The decision chain itself is `runTownSquareTick` (`src/services/predator-prey.mjs:1102`), which
records a named rung per agent per turn (`:1178-1336`): `driven`, `deliver`, `carry`, `carried`,
`trapped`, `evade`, `forage`, `chase`, `hold-web`, `build-web`, `wander`. The fixture states the two
standing chains: a predator runs avoid, then chase, then wander; a prey runs evade, then forage, then
wander.

Some of the imperative vocabulary is already fact-shaped. `src/domain/mud-facts.mjs:11-16` reads
`mgx:is-predator` off the rows as the one shared answer to "which subject does the world mark
dangerous", precisely so the turn engine and the renderer cannot drift. That is the pattern this plan
generalises.

### 1.4 Beliefs and plans are already per-agent, per-tick

`src/domain/agent-belief.mjs` (97 lines, pure) is a real epistemic model, separate from world truth.
Its core is a three-rung resolution (`:49-59`): a removed target is believed nowhere; a target inside
the observer's Chebyshev vision radius is ground truth; otherwise the newest `toldFacts` entry
addressed to this observer about this subject; otherwise `null`. Its header states the point plainly:

> "an agent that has not seen and has not been told believes nothing, and a deceived agent stays
> visibly wrong until it looks."

It also exports `nearestBelievedTarget:65` and `beliefSnapshotFor:88`, the latter described in its own
comment as feeding a belief panel and "deliberately never ground truth". `test/domain/agent-belief.test.mjs`
holds 15 tests, including a told fact about a never-placed id being believed (`:110-120`) and a told
fact addressed to another agent never leaking (`:82-91`).

The tick payload already carries both belief and plan. `test/fixtures/mudiii-ticks.json`'s `_readme`
fixes the shape as `{ turn, agents: { id: { role, cell, facing, goal, mood, plan, mass, belief } },
items, ecology }`, and describes the two fields:

- `plan` — "The direction sequence that produced THIS tick's move: the full search result when
  `findActionPath` found one, a length-1 array for a single greedy step, `[]` when the agent held
  still."
- `belief` — "A flat object whose key set is every live agent and item id except the observer's own,
  sorted, each value a cell-id string or `null`. `null` means the observer believes nothing about that
  subject, which is the difference between this map and ground truth."

So the data exists on every tick. What is missing is a surface that shows it for a chosen actor, and a
path that recomputes it on an edit rather than on a turn.

### 1.5 The whole-world edit affordance

The sketch's "edit button like the one for the whole world" ships on three pages: `mud.html`,
`adventure.html` and `mudiii.html` itself.

On MUDIII: the toggle and textarea are `src/services/mudiii-viz.mjs:623` and `:705-711`
(`<textarea id="editorText" … aria-label="the world's own facts as plain sentences, one per line">`),
inside a `.edit-stage` labelled "the square's own facts, in plain sentences". Entering edit mode
snapshots the store and renders the world's rows to sentences (`:1686-1702`), using
`renderMudEditorText` and `gridWorldEditorState` imported from `src/services/mud-editor.mjs:48`.
Typing debounces at 450ms (`:1751`) into `applyEditorText` (`:1780-1801`), which calls
`session.applyEdit(text)`, re-snapshots, rebuilds the scene, and reports either "N line(s) not
understood yet — nothing is retracted until they are" or "synced — N fact(s) written, N retracted".

The write path is `src/surfaces/web/mud-browser-entry.mjs:263-294` (`mudiii-browser-entry.mjs:284`
is the MUDIII twin): parse the text to triples, diff against the world's current rows via
`planMudEditorSync`, append what is new, and retract only when the whole document parsed cleanly, so
a half-typed line is never read as "this fact is gone". It is entirely client-side over
`createInMemoryStore()`; no server round trip and no rebuild.

`test/services/mud-editor.test.mjs:24` pins the round trip ("every sentence the shipped world renders
parses back, and re-syncing it writes nothing") and `:72` pins the honest miss ("a line in no phrase
the table knows is an honest miss, never a guessed triple"). The e2e precedent is
`test-e2e/pages-adventure-edit.test.mjs:71`.

Three details of this affordance shape R4 and R5, and each one is a constraint rather than a
convenience:

1. **The sentence table is `mud.html`'s, reused whole.** `LINE_PATTERNS`
   (`src/services/mud-editor.mjs:183-241`) covers placement, mass, `rdf:type`, `mgx:model`,
   `mgx:rotation`, `rdfs:subClassOf` and `mgx:display-name`, projected onto the grid by
   `gridWorldEditorState` (`:87-97`). It has no phrase for `mgx:feels`, `mgx:facing` or any drive knob.
   Those five live in a different table on a different code path, `TOWN_SQUARE_TEACH_PATTERNS`
   (`src/services/mudiii-turn.mjs:666-675`), gated behind `gameConfig.mudiii.teach`. R4 adds a third
   table and must say in its own header which of the three owns which predicate, or they drift.
2. **An add or a remove re-casts the whole board.** `rebuildSceneFromEdit`
   (`src/services/mudiii-viz.mjs:1765-1778`) calls `session.recast({ agents: cast })` whenever
   `result.added || result.removed`, and `recastTownSquare` (`src/services/predator-prey.mjs:909`) bumps
   the world epoch and re-mints the roster at fresh seeded cells. A trait edit writes rows, so today it
   would trigger that. R4.3 states the rule that stops it.
3. **The actor selector already exists.** `#agentSelect` (`src/services/mudiii-viz.mjs:648-651`,
   "which agent to follow") picks the camera's follow target and the drive ring's subject, and it is
   disabled while the board plays (`el("agentSelect").disabled = state.playing`, `:1243`). R4 reuses it
   rather than adding a second selector.

### 1.6 The class-chain trait read, already shipping next door

The adventure lane already does what the sketch asks for, for one trait. `src/services/adventure.mjs:1085-1096`:

```js
/** What one turn costs `subject` in mass, from a `mgx:mass-drain-per-turn` fact
 *  on its own class chain (so a whole species is tuned in one line, and one
 *  individual can still overrule its species by writing its own). Null when
 *  nothing in the chain declares one — a knob nobody set is not a reason to
 *  invent a number and starve something with it. Pure. */
export function massDrainPerTurnOf(rows, subject) {
  for (const kind of objectClassChain(rows, subject)) {
    const written = declaredNumber(rows, kind, MASS_DRAIN_PREDICATE);
    if (written !== null && written >= 0) return written;
  }
  return null;
}
```

That is the whole design of this plan's phase R1, already written and tested for one predicate. The
predicates it leans on all exist: `MASS_PREDICATE = "mgx:hasMass"` (`:216`),
`DISPLAY_NAME_PREDICATE = "mgx:display-name"` (`:221`),
`MASS_DRAIN_PREDICATE = "mgx:mass-drain-per-turn"` (`:234`), with `objectClassChain(rows, object)` at
`:980` walking the `rdf:type`/`rdfs:subClassOf` chain and `displayNameOf(rows, subject)` at `:1267`
reading the display name off the rows.

**Two of those predicates exist but MUDIII does not read them, and R2 has to close both.**

- **The name.** No MUDIII module reads `mgx:display-name`. An agent's on-screen label is its raw id,
  drawn onto a canvas texture in `makeAgentLabel(id, height)`
  (`src/services/mudiii-scene.mjs:831-853`, `ctx.fillText(id, 128, 34)`). The sentence "X is shown as Y"
  is in the shared editor table (`mud-editor.mjs`), so a visitor can already write the row; nothing
  looks at it.
- **The avatar.** `mgx:model` is a fact for props only, written by `propFactRows`
  (`src/domain/town-square-world.mjs:338-345`). For an agent, the model comes from the id's species
  prefix: `roleOfAgentId(id)` strips the numeric suffix (`src/services/mudiii-viz.mjs:113-115`) and
  `ensureAgent` looks that kind up in `manifestByKind` (`src/services/mudiii-scene.mjs:855-885`, built
  at `:1111-1117`). Every `fox-N` shares one mesh and there is no per-agent override.

So the sketch's "display name and avatar are facts" is half true today: the predicates and the store
are ready, and the two readers are not. That is a small, well-bounded piece of R2 rather than new
machinery.

The adventure lane also already spawns instances from a class and copies class facts onto them.
`freshObjectId(rows, kind, alsoTaken)` (`adventure.mjs:1228-1233`) mints `<kind>-<n>`;
`classMassFacts(rows, instance, kind)` (`:1247-1250`) copies the class's mass onto the instance; the
dig call site (`:1537-1541`) writes the four rows an instance needs:

```js
{ subject: spawned[i], predicate: "rdf:type",            object: kind },
{ subject: spawned[i], predicate: DISPLAY_NAME_PREDICATE, object: kind },
{ subject: spawned[i], predicate: "mgx:located-in",       object: dug },
...classMassFacts(rows, spawned[i], kind),
```

with the comment at `:1532-1536` stating why: "The class's own mass copies onto the instance for the
same reason: eat reads the instance."

The pure-domain analogue is `expandWorldDefaultContents` (`src/domain/worlds-pack.mjs:80-115`), which
materialises `<room> mgx:default-contains <class>` rows into placed instances, visiting in sorted
order and numbering collisions `<class>-2`, `-3` (`:95-99`).

MUDIII's own roster minting is `seededRoster` (`src/services/predator-prey.mjs:939-965`), which builds
`fox-1`, `goblin-1`, `goblin-2` from `roles.<role>.idPrefix`, and `build-demo-site.mjs:551-557` mints
the same ids ahead of the first turn so the HUD can draw the opening cast. Today none of those spawns
copies a class fact; the traits stay in the JS table.

### 1.7 Facts, ids, rules and determinism

- **Facts** are RDF-reified individuals in `src/adapters/memory/core.mjs`: `appendFact:2314`,
  `appendFacts:2380`, `readFactRows:2857`, `removeFacts:3091`. A read row is
  `{ id, subject, predicate, object, provenance, quantifier, sourceIds, sourceTypes, environments,
  justification, assertions }` (`:3040-3056`), with trust computed fresh at read time (`:2872`).
- **Ids are content-addressed.** `src/domain/hash.mjs:161` —
  `export const factIdFor = (s, p, o) => \`fact:${sha256Hex(\`${s}\0${p}\0${o}\`, 8)}\`` — the first
  eight bytes of SHA-256 over the NUL-joined normalised triple, with `factIdForTriple:173` normalising
  first. NUL is the delimiter because it never occurs in a normalised term (`:156-158`). Re-asserting
  the same triple upserts onto the same group rather than minting a duplicate. This is what makes a
  spawn copy idempotent for free.
- **Rules** are their own individual class with a closed kind set. `src/adapters/memory/shacl.mjs:9-12`:
  `compose2`, `filter`, `recursive`, `action-signature`, `action-precond`, `action-effect`,
  `action-constraint`; the slot vocabulary is `mgx:`-named at `:21-34`, e.g.
  `action-constraint` requires `mgx:ruleActionConstraintLeft/Right/Guard`. `appendRule(dir, { name,
  kind, slots, provenance, createdAt })` is `core.mjs:2541`; `readRuleRows` is `:2623`.
- **Worlds ship facts and rules together.** `corpus/worlds/src/*.jsonl` rows are
  `{ world, kind: "fact", subject, predicate, object }`,
  `{ world, kind: "rule", name, ruleKind, slots }` or `{ world, kind: "meta", opening }`
  (`src/domain/worlds-pack.mjs:37-61`), with `WORLD_RULE_KINDS` at `:19-20` being exactly the four
  action kinds. `scripts/build-worlds-pack.mjs` validates every row, requires one meta row and at least
  one fact and one rule row per world (`:58-61`), and writes gzipped shards plus a hash manifest with no
  build date (`:6`, "same sources in, same bytes out"). The output is gitignored (`.gitignore:134-136`);
  `scripts/ensure-worlds-pack.mjs` rebuilds it before every `npm run test*`.
  `src/surfaces/web/mudiii-browser-entry.mjs:170` instates a world's rule rows into the browser store
  through `appendRule`, so a browser-side MUDIII world can already carry action rules.
- **Read-time resolvers must be pure functions of the fact set.** The precedent is
  `sortFactIndividualsById` (`src/services/p2p-room.mjs:361-382`), which sorts Fact individuals by
  content-addressed id after every merge, in codepoint order and never `localeCompare`, so two peers
  never fold the same set differently. `docs/references/papers/crdt.md:181-192` gives the reasoning and
  names `foldWorldState`'s `turn >= prior.turn` tiebreak as the exact hazard. `CLAUDE.md` restates it as
  a standing rule and names the check: feed one peer's facts to the resolver in two different orders and
  demand the same answer back.
- **Seeded randomness, never `Math.random`.** `mulberry32(fnv1a32(seedKey))`
  (`src/services/predator-prey.mjs:150-164`) drives every wander and spawn cell, keyed by
  `(layoutName, epoch, turn, id, purpose)`.
- **Domain purity.** `test/estate/import-layers.test.mjs:50-56` fails on any non-relative import from
  `src/domain/`, and `:76-80` fails on any import that points up the rank
  `domain(0) < adapters(1) < tools(2) < index(3) < services(4) < surfaces(5)`
  (`test/estate/layer-map.mjs:21`). The allowlist may only shrink.

### 1.8 What the estate charges for a MUDIII change

- Tests that exist: `test/services/mudiii-viz.test.mjs`, `mudiii-scene.test.mjs`,
  `mudiii-turn.test.mjs`, `test/services/predator-prey.test.mjs`, `predator-prey-fixture.test.mjs`,
  `test/adapters/mudiii-browser-entry.test.mjs`, `test/adapters/game-config.test.mjs`,
  `test/domain/town-square-world.test.mjs`, `test/domain/agent-belief.test.mjs`,
  `test/corpus/games/mudiii.jsonl` (31 rows) + its runner, and `test-e2e/pages-mudiii.test.mjs`
  (1,239 lines).
- The tick fixture `test/fixtures/mudiii-ticks.json` is a frozen contract, and its `_designNote` says
  so: "If a generated run does not match the tape, retune `initial` (starting cells and the prop
  layout), never the tape and never the config."
- Site surfaces a page change touches: `public/mudiii-about.html`, `public/index.html`,
  `public/share.mjs`, `public/screenshots/mudiii.png` + manifest, `public/og/mudiii.png`,
  `test/estate/site-meta.test.mjs`, `test/estate/home-page-links.test.mjs` (which deliberately excludes
  mudiii from its anchor set, `:17-19`), `test/estate/screenshots.test.mjs`.
- Acceptance rungs and their budgets: `npm run test:smoke` (~0.6s), `npm run test:fast` (~1.8s),
  blast radius, `npm test`. A fresh worktree needs `node scripts/ensure-worlds-pack.mjs`,
  `node scripts/ensure-sprite-facts.mjs` and `npm run build:ask-bundle` before any `node --test`.

---

## 2. The sketch, clause by clause

| the sketch says | what ships today | what this plan builds |
|---|---|---|
| built on the MUDIII surface | `mudiii.html` is live, deployed and e2e-covered (1.1) | a fourth scenario on the same page, no new page (section 10 states the choice) |
| the actor selected in the dashboard is editable | the dashboard has no actor selection; the world editor edits everything at once (1.5) | R4: an actor card with a per-instance editor beside the world one |
| imperatives externalised as facts | `mgx:is-predator` is a fact; `hunts`, vision, mass and drain are JS (1.3) | R0's predicates, R1's resolver, R2's engine re-read |
| a fox and a goblin are the same at the software level | already the stated intent, not yet the implementation (1.3) | R2: the engine reads a cast built from rows, `MUDIII_ROLES` becomes the fallback |
| display name and avatar are facts | the predicates exist; MUDIII labels from the raw id and picks a mesh by species prefix (1.6) | R1 reads them through the class chain; R2 wires the label and the mesh to them |
| the drive to evade or pursue is a fact | `hunts` in a frozen object (1.3) | `mgx:pursues` / `mgx:evades` (R0), read per instance (R1) |
| draining and consuming are facts | `mgx:mass-drain-per-turn` in the adventure lane only (1.6) | R0/R2 bring it and `mgx:consumes` to MUDIII |
| starting mass is a fact | `mgx:hasMass` exists; MUDIII seeds it from config (1.3, 1.6) | R2 reads the class fact, config is the fallback |
| copy class facts to `goblin-1` on spawn | `classMassFacts` copies one predicate in the adventure lane (1.6) | R1: `instanceFactsFrom`, the whole trait set, content-addressed |
| per-instance edits touch the instance facts | no per-instance surface exists | R4 |
| the river puzzle defined in these same rules | the puzzle solves in chat off `data/games/river.txt` (1.2) | R3: the world, plus `constraintsFromDrives` so the puzzle's constraint *is* the drive facts |
| see each agent's beliefs and plan | both are in the tick payload; nothing renders them (1.4) | R5 |
| the plan recalculates as edits are made | edits rebuild the scene; nothing re-plans without a turn (1.5) | R5's recompute-on-edit path |

---

## 3. The constitution

These hold for every phase and module below.

- **Pure JS, no LLM in the product path.** A drive is a row, a plan is a search, a sentence is a
  template.
- **Deterministic, and a pure function of the fact set.** The trait resolver, the belief snapshot and
  the plan must depend on the rows alone, never on wall clock, arrival order or a local counter. Sort
  before you commit. The check is the one `CLAUDE.md` names: feed the same rows in two orders and
  demand the same answer. `sortFactIndividualsById` (`src/services/p2p-room.mjs:368`) is the
  precedent, and `docs/references/papers/crdt.md:181-192` is the reasoning.
- **A spawn copy is content-addressed and idempotent.** Every copied row goes in through
  `appendFacts`, so `factIdFor` (`src/domain/hash.mjs:185`) gives the same id for the same triple and
  a second spawn of the same instance writes nothing new. Re-running a spawn is a no-op, not a
  duplicate.
- **Beliefs and plans are inspectable facts or pure derivations, never hidden state.** A belief map is
  computed from rows by `beliefSnapshotFor`; a plan is computed from rows by `findActionPath`. Nothing
  the panel shows may live only in a closure. If a surface shows it, a test can recompute it from the
  rows alone.
- **The honest miss survives.** An agent whose drives leave it nothing to reach reports that it has no
  plan. A puzzle state with no solution inside the depth bound reports `no plan found within N moves`.
  A budget blow-out reports the budget. None of the three ever renders a shortened or invented plan,
  and a trait nobody declared reads as absent rather than as a default someone invented. That last one
  is already the shipped rule (`adventure.mjs:1088-1090`: "a knob nobody set is not a reason to invent
  a number and starve something with it").
- **Open-world.** A class that states no `mgx:evades` row is a class nobody has said anything about
  yet. The engine treats it as no drive, and the editor shows the gap rather than filling it.
- **$0 per query and offline.** No network on any path this plan adds. The page keeps working with the
  network off, as `mudiii.html` does today.
- **Domain purity.** Every new pure module lives under `src/domain/` and imports nothing non-relative.
  `test/estate/import-layers.test.mjs` fails on the first violation and its allowlist may only shrink.
  Store access is injected, the way `syllogise()` takes a `store` option.
- **The tick fixture is the contract.** `test/fixtures/mudiii-ticks.json`'s `expectedTape` stays
  byte-identical across R1 and R2. A refactor that changes what the engine reads must not change what
  it does. If a generated run stops matching the tape, the bug is in the change.

---

## 4. Phase R0 — the trait vocabulary

**Shipped.** `ontology/tmct-core.ttl` carries the five new predicates (label, domain/range,
comment each); `test/domain/agent-traits.test.mjs` proves every trait predicate — the five new
ones and the five reused ones — stores and reads back through `appendFacts`/`readFactRows`, a
repeated multi-valued row reads back as two rows, and a numeric object survives as the string it
was written as. The `FACT_PREDICATE_PHRASES` entries in 4.3 are deferred: `chat.mjs` holds a
private twin of that table pinned byte-identical to `src/domain/fact-phrase.mjs` by
`test/domain/fact-phrase.test.mjs`, so the five phrases need a matching edit to both tables in the
same change, not `fact-phrase.mjs` alone.

Goal: the graph can state every imperative that drives an agent. No behaviour changes; everything
stores, reads back and round-trips.

### 4.1 Predicates reused unchanged

| predicate | subject | object | meaning | where it ships |
|---|---|---|---|---|
| `rdf:type` | instance | class | instance membership | everywhere |
| `rdfs:subClassOf` | class | class | the chain `objectClassChain` walks | `adventure.mjs:980` |
| `mgx:display-name` | class or instance | a word | what to call it on screen | `adventure.mjs:221`, `:1267`; MUDIII writes it but reads nothing (1.6) |
| `mgx:model` | class or instance | an asset id | the avatar | `predator-prey.mjs:98`, props only today (1.6) |
| `mgx:hasMass` | class or instance | a number | mass; on a class it reads as the starting mass | `adventure.mjs:216` |
| `mgx:mass-drain-per-turn` | class or instance | a number | what a turn costs | `adventure.mjs:234`, `:1090` |
| `mgx:is-predator` | subject | `"true"` | the world marks it dangerous | `mud-facts.mjs:11` |

Every object is a string, including numbers. The prop-facts note in
`test/fixtures/mudiii-ticks.json` states the rule: `"90"`, never `90`, because "a fact object is a
term, and a renderer that reads `mgx:rotation` parses the term it is given rather than trusting a JSON
number to survive the store."

### 4.2 New predicates

| predicate | subject | object | meaning |
|---|---|---|---|
| `mgx:pursues` | agent class or instance | a class | it moves toward members of that class. Repeated rows for several targets |
| `mgx:evades` | agent class or instance | a class | it moves away from members of that class |
| `mgx:consumes` | agent class or instance | a class | contact removes the target and transfers its mass |
| `mgx:vision-radius` | agent class or instance | a number | Chebyshev radius for `believedCellOf` |
| `mgx:guards` | agent class or instance | a class pair, one row per class | its presence suspends a `consumes` pairing (the farmer in the boat) |

`mgx:pursues` and `mgx:evades` are separate predicates rather than one link read both ways. Today
`rolesHunting` (`predator-prey.mjs:81`) derives "who fears whom" by inverting `hunts`, which is right
for a food chain and wrong for a puzzle: on the river bank the wolf would eat the goat, but neither is
hunting anybody, and the goat's evade has nothing to do with the wolf's appetite for cabbage. Two
predicates let a world state one without the other. A class that declares `mgx:consumes` and no
`mgx:evades` gets the inverse as a default, so today's cast keeps behaving exactly as it does (R2.3
states the fallback precisely).

### 4.3 Ontology and docs

- `ontology/tmct-core.ttl` gains the five predicates with `rdfs:domain`/`rdfs:range` and a comment
  each. `ontology/memory-shapes.ttl` needs no change: these are ordinary Facts, not Rules.
- `src/adapters/memory/shacl.mjs` needs no change for the same reason.
- `FACT_PREDICATE_PHRASES` in `src/domain/fact-phrase.mjs`, the table that renders a fact as a
  sentence for the ledger and the editors, gains one phrase per predicate: "pursues", "evades",
  "eats", "sees within", "guards".
- No estate guard pins the ontology against the code today, so the `.ttl` edit is documentation that a
  reviewer checks rather than a test that fails. Say so in the commit rather than implying a gate.

### 4.4 R0 tests

| file | what it holds |
|---|---|
| `test/domain/agent-traits.test.mjs` (new, grows through R1) | each predicate stores and reads back through `appendFacts`/`readFactRows`; a repeated `mgx:pursues` row for a second target reads back as two rows; a number object stored as `"3"` reads back as `"3"` |

### 4.5 R0 acceptance

```
npm run test:fast
node --test test/domain/agent-traits.test.mjs
node --test "test/estate/*.test.mjs"
```

---

## 5. Phase R1 — `src/domain/agent-traits.mjs`, the class chain and the instance copy

**Shipped.** `src/domain/agent-traits.mjs` exports `classChainOf`, `traitValueOf`,
`traitValuesOf`, `traitOriginOf`, `agentTraitsOf`, `classFactRowsFor` and `instanceFactsFrom`, all
tested in `test/domain/agent-traits.test.mjs`. `classChainOf` is the chain walk lifted out of
`adventure.mjs`'s `objectClassChain`, which now delegates to it (applying its own
`worldActionRows` filter first) rather than holding a second copy of the walk; every existing
`adventure.mjs` and `town-square-world.mjs` test still passes unchanged. Nothing calls the new
module's spawn/resolver exports yet — that starts at R2.

Goal: one pure module that answers "what drives this subject" from rows alone, and one that turns a
class into an instance's own rows on spawn. Nothing calls it yet.

### 5.1 The trait table

```js
/** Every predicate a spawn copies from a class onto an instance, and that the
 *  resolver reads back off the class chain. Sorted, frozen, closed: a
 *  predicate not on this list is world state, not an imperative, and a spawn
 *  leaves it alone. */
export const AGENT_TRAIT_PREDICATES = Object.freeze([
  "mgx:consumes",
  "mgx:display-name",
  "mgx:evades",
  "mgx:guards",
  "mgx:hasMass",
  "mgx:is-predator",
  "mgx:mass-drain-per-turn",
  "mgx:model",
  "mgx:pursues",
  "mgx:vision-radius",
]);
```

Single-valued traits (the last written wins on the chain): `mgx:display-name`, `mgx:hasMass`,
`mgx:mass-drain-per-turn`, `mgx:model`, `mgx:vision-radius`, `mgx:is-predator`. Multi-valued (every
row on the nearest chain link that declares any): `mgx:pursues`, `mgx:evades`, `mgx:consumes`,
`mgx:guards`. The split is a second frozen set, `AGENT_TRAIT_MULTI`, so the resolver and the editor
agree without either one guessing.

### 5.2 Exports

```js
export function traitValueOf(rows, subject, predicate)        // -> string | null
export function traitValuesOf(rows, subject, predicate)       // -> string[]  (sorted, deduped)
export function agentTraitsOf(rows, subject)                  // -> AgentTraits
export function classFactRowsFor(rows, className)             // -> {subject,predicate,object}[]
export function instanceFactsFrom(rows, className, instanceId) // -> {subject,predicate,object}[]
export function traitOriginOf(rows, subject, predicate)       // -> "instance" | className | null
```

`AgentTraits` is a flat, fully-populated object so no caller has to remember which key is a list:

```js
{
  subject: "goblin-1",
  classes: ["goblin", "creature"],        // objectClassChain order, nearest first
  displayName: "goblin" | null,
  model: "goblin" | null,
  mass: 8 | null,
  massDrainPerTurn: 0.06 | null,
  visionRadius: 3 | null,
  isPredator: false,
  pursues: [],                            // sorted class names
  evades: ["fox"],
  consumes: ["crumb", "morsel"],
  guards: [],
}
```

`traitValueOf` walks `objectClassChain(rows, subject)` nearest-first and returns the first declared
value, exactly as `massDrainPerTurnOf` (`adventure.mjs:1085-1096`) does today. `traitValuesOf` returns
every row on the *first* chain link that declares any, so an instance that states one `mgx:evades` row
overrides its class's three rather than adding to them. That is the rule a per-instance editor needs:
what you see in the instance box is what the instance has.

`objectClassChain` lives in `src/services/adventure.mjs:980` and cannot be imported from
`src/domain/` (`import-layers` rank, section 1.7). R1 lifts the chain walk into
`src/domain/agent-traits.mjs` as a local `classChainOf(rows, subject)` and has `adventure.mjs` import
it back down, which is a legal edge (services may import domain). That keeps one chain walk in the
tree rather than two. If lifting it turns out to drag more of `adventure.mjs` than the phase can
carry, the fallback is to inject the chain walk as an option (`{ classChain = defaultChain }`) and
leave `adventure.mjs` untouched; say which one you did in the commit message.

`traitOriginOf` is what the editor's "inherited from goblin" label reads. It returns `"instance"` when
the subject itself declares the predicate, otherwise the class name that did, otherwise `null`.

### 5.3 The spawn copy

```js
/** The instance's own rows for a fresh spawn of `className`: one row per trait
 *  the class chain declares, subject rewritten to `instanceId`, plus the
 *  rdf:type row. Sorted by (predicate, object) so two callers building the same
 *  spawn build the same list. Pure. */
export function instanceFactsFrom(rows, className, instanceId) { … }
```

It returns rows, it does not write them. The caller appends them through `appendFacts`, which is what
makes the copy idempotent: `factIdFor(s, p, o)` (`src/domain/hash.mjs:185`) is the same 64-bit content
address every time, so re-spawning `goblin-1` from `goblin` writes nothing new. There is no separate
"already spawned?" check to get wrong.

Provenance for the copied rows is `spawn:<class>:<instance>@epoch<N>`, a new tag in the family
`worldProvenanceTag` (`src/domain/worlds-pack.mjs`) already uses. It matters for three readers: the
ledger's provenance bucket, the editor's ability to tell a copied row from a hand-edited one, and
retraction, because a respawn should be able to clear the previous copy without touching a row the
visitor typed.

The instance id itself keeps the shipped conventions: `seededRoster`'s `${idPrefix}-${i}`
(`predator-prey.mjs:939-965`) for the opening cast, `freshObjectId(rows, kind, alsoTaken)`
(`adventure.mjs:1228`) for a mid-play mint. R1 adds no third scheme.

### 5.4 Determinism

Two rules, both tested:

1. Every list `agent-traits.mjs` returns is sorted before it is returned. Codepoint order, never
   `localeCompare`, for the reason `p2p-room.mjs:378-380` gives.
2. The resolver is a pure function of the row *set*. The test shuffles the rows and demands an
   identical `agentTraitsOf` result, in both directions, per `CLAUDE.md`'s standing check.

### 5.5 R1 tests

| file | what it holds |
|---|---|
| `test/domain/agent-traits.test.mjs` | the chain walk finds a class trait; an instance row overrides its class; a multi-valued instance row replaces the class's set rather than adding to it; an undeclared trait reads `null`/`[]`, never a default; `traitOriginOf` names the class it came from; `instanceFactsFrom` produces a sorted row list including `rdf:type`; two calls produce identical lists; appending the same list twice through `appendFacts` leaves the row count unchanged (the idempotence check, using the real store); the same fact set in two shuffled orders yields an identical `agentTraitsOf` |

### 5.6 R1 acceptance

```
npm run test:fast
node --test test/domain/agent-traits.test.mjs
node --test "test/estate/*.test.mjs"
```

---

## 6. Phase R2 — the drive engine reads facts

Goal: `predator-prey.mjs` decides from rows. `MUDIII_ROLES` and `DEFAULT_GAME_CONFIG.mudiii` become
the fallback for a world that states nothing, so the shipped square behaves identically and the tick
fixture's tape stays byte-identical.

This is the subtlest phase in the plan and it owns the largest file. Section 13 prices it accordingly.

### 6.1 The cast, built from rows

New pure export in `src/domain/agent-traits.mjs` (same file, so R1 and R2 serialise on it):

```js
/** The cast a world states, in the shape predator-prey.mjs's `roles` parameter
 *  already takes. One entry per class that any agent instance is typed as, with
 *  its idPrefix from the class name and its drive links from the trait rows.
 *  `fallback` fills any role the rows say nothing about. Pure, sorted. */
export function castFromFacts(rows, { fallback = null } = {})
```

The returned shape stays what `rolesHuntedBy`/`rolesHunting` already read, so their signatures do not
change. What changes is where the `hunts` link comes from.

### 6.2 The two readers

`rolesHuntedBy(role, roles)` and `rolesHunting(role, roles)` (`predator-prey.mjs:70`, `:81`) gain a
rows-aware sibling pair that takes a subject rather than a role:

```js
export function pursuedBy(rows, subject)   // -> class names this subject moves toward
export function fearedBy(rows, subject)    // -> class names this subject moves away from
```

`fearedBy` is `traitValuesOf(rows, subject, "mgx:evades")` when the subject or its chain declares any,
and otherwise the inverse of `mgx:consumes` across the cast: every class C such that some agent of
class C declares `mgx:consumes <this subject's class>`. That inverse is what keeps the shipped goblins
fleeing the fox without the world pack having to state it twice, and it is the exact behaviour
`rolesHunting`'s comment describes today.

### 6.3 What changes in the decision chain

`runTownSquareTick` (`predator-prey.mjs:1102`) currently asks the role table three questions per
agent: is there a threat, is there quarry, what do I eat on contact. Each becomes a rows read through
the subject rather than the role:

| today | after R2 |
|---|---|
| `rolesHunting(role, roles)` for the evade rung (`:1240-1268`) | `fearedBy(rows, agentId)` |
| `rolesHuntedBy(role, roles)` for the chase rung (`:1276`) | `pursuedBy(rows, agentId)` |
| `config.predatorVisionRadius` / `preyVisionRadius` | `agentTraitsOf(rows, agentId).visionRadius ?? config.<role>VisionRadius` |
| `config.predatorInitialMass` / `preyInitialMass` at spawn | `agentTraitsOf(rows, class).mass ?? config.<role>InitialMass` |
| `config.<role>MassDecrementPerTurn` | `agentTraitsOf(rows, agentId).massDrainPerTurn ?? config.<role>MassDecrementPerTurn` |
| food kinds from `roles.food` | `agentTraitsOf(rows, agentId).consumes`, falling back to `roles.food` |

The rung names, their order, the goal lines (`:543-554`) and the ecology event shapes do not change.
Neither does the seeded-random keying, so every wander cell stays where it was.

Two reads outside the engine close the gap section 1.6 names:

- `makeAgentLabel(id, height)` (`src/services/mudiii-scene.mjs:831-853`) takes a label string rather
  than reading the id, and `mudiii-viz.mjs` passes `agentTraitsOf(rows, id).displayName ?? id`. An
  agent with no stated name keeps its id, which is the honest fallback.
- `ensureAgent` (`src/services/mudiii-scene.mjs:855-885`) prefers `agentTraitsOf(rows, id).model` over
  the species-prefix lookup in `manifestByKind` (`:1111-1117`). A model name outside
  `data/mudiii-assets.json`'s allowlist falls back to the prefix and logs the miss rather than
  rendering nothing, so an edit cannot blank the board.

And one reconciliation. `structuralFactRows` (`src/domain/town-square-world.mjs:391-431`) restates the
config numbers as "by default" facts nobody reads back (section 1.3). After R2 the trait rows are the
number, so those rows either drop the "by default" hedge and become the trait rows themselves, or they
are deleted as a duplicate statement. R2 picks one and says which in the commit message.
`test/domain/town-square-world.test.mjs:237-252` pins the current wording and moves with it.

`startTownSquareGame` (`:857`) grows one step: after minting the roster it appends
`instanceFactsFrom(rows, className, id)` for each agent, so `fox-1` and `goblin-1` carry their own
trait rows from turn zero. That is the sketch's "on spawn we copy the goblin class facts to goblin-1".
`recastTownSquare:909` and the mid-play prey/hatchling mints (`:743`, `:781`) do the same.

### 6.4 The fixture is the proof

`test/fixtures/mudiii-ticks.json`'s ten ticks and `expectedTape` stay byte-identical. The world pack's
town-square worlds gain trait rows stating exactly what the JS table says today, so the fallback is
never exercised on the shipped board and the run is unchanged. `test/services/predator-prey-fixture.test.mjs`
is the guard that catches any drift, and it is the first thing to run in this phase, not the last.

A second, new fixture proves the point of the phase: `test/fixtures/mudiii-swapped-cast.json`, the
same board with the pursue and evade rows swapped, so the goblins hunt the fox. It must run through
the same engine with no code branch.

### 6.5 R2 tests

| file | what it holds |
|---|---|
| `test/services/predator-prey-fixture.test.mjs` (existing) | the ten-tick tape is byte-identical after the refactor |
| `test/services/predator-prey.test.mjs` (existing, extended) | `pursuedBy`/`fearedBy` read a world's rows; an instance row overrides its class, so `goblin-2` can stop evading the fox while `goblin-1` keeps evading; a class with no `mgx:evades` inherits the inverse of `mgx:consumes`; vision radius, mass and drain read per subject with the config as fallback |
| `test/services/predator-prey-swapped-cast.test.mjs` (new) | the swapped-cast fixture runs through the unchanged engine and produces a chase rung on a goblin and an evade rung on the fox |
| `test/domain/agent-traits.test.mjs` (extended) | `castFromFacts` builds the shipped cast from the shipped world's rows, and equals `MUDIII_ROLES` for it |

### 6.6 R2 acceptance

```
npm run test:fast
node scripts/ensure-worlds-pack.mjs
node --test test/services/predator-prey.test.mjs test/services/predator-prey-fixture.test.mjs \
            test/services/predator-prey-swapped-cast.test.mjs test/domain/agent-traits.test.mjs
node --test test/services/mudiii-turn.test.mjs test/corpus/games/mudiii.test.mjs
```

---

## 7. Phase R3 — the river crossing, defined in these same rules

Goal: a river-crossing world that stands on the square, whose legality comes from the same
`compileDomain`/`movesFromRules` path the chat lane already uses, and whose constraint is derived from
the drive facts rather than authored twice.

### 7.1 The world

`corpus/worlds/src/river-crossing.jsonl`, built by the existing pack script and loaded by the existing
loader. It is a grid world like the town square, so `mudiii-scene.mjs` draws it unchanged:

- two banks as blocks of cells, `bank-east` and `bank-west`, joined by nothing. The river is the
  column between them, expressed the way MUDIII already expresses a wall: the cells simply omit their
  `mgx:has-exit-*` edges. `backlog/PLAN_MUD_MUDIII.md` records that decision ("buildings as missing
  exit-edges, not collision code").
- `wolf-1`, `goat-1`, `cabbage-1`, `farmer-1` as instances, each `rdf:type` its class, each placed
  with `mgx:currently-in` on a `bank-east` cell.
- class rows carrying the traits: `wolf mgx:consumes goat`, `goat mgx:consumes cabbage`,
  `goat mgx:evades wolf`, `cabbage mgx:evades goat`, `farmer mgx:guards wolf`,
  `farmer mgx:guards goat`, plus `mgx:display-name` and `mgx:model` for each.
- the four `kind: "rule"` rows for the ferry action, the same slots
  `data/games/river.txt` teaches: one `action-signature`, two `action-effect` (the passenger and the
  co-travelling farmer), and the `action-constraint` rows section 7.3 derives.
- a `meta` row with the opening line.

Two model choices need a CC0 asset each (`data/mudiii-assets.json`, `public/models/`,
`scripts/check-model-manifest.mjs`, `npm run check:models`). The fixture's `_rolesNote` records that
this exact problem already bit once: "The design doc says wolf; the wolf model turned out not to be
CC0, so the cast changed." Check licences before the world file names a model. If a wolf is
unavailable, the fox already in the manifest plays the part and the class is named `fox`, which costs
nothing because the class name is a fact.

### 7.2 Where the rules come from

The world pack already carries rule rows and the browser entry already instates them
(`src/surfaces/web/mudiii-browser-entry.mjs:170`), so a MUDIII world can hold an action domain today.
R3 wires the MUDIII page's plan path to compile that domain the same way the chat lane does:

```js
const domain = compileDomain(readFactRows(memory), readRuleRows(memory));   // src/domain/domain.mjs:62
const state  = stateFromFacts(readFactRows(memory), domain);                // :211
const moves  = movesFromRules(state, domain, { budget });                   // :366
const found  = findActionPath(state, isGoal, (s) => movesFromRules(s, domain), {
  maxDepth: gameConfig.planning.maxDepth, stateKey: stateKeyFor,            // src/domain/planning.mjs:30
});
```

Nothing new is written here. The one new pure module is the bridge in 7.3.

### 7.3 `constraintsFromDrives` — the bridge that makes the sketch literally true

New export in `src/domain/agent-traits.mjs`:

```js
/** The action-constraint slot sets a world's own drive facts imply: for every
 *  `X mgx:consumes Y` pair, X may not share a place with Y unless a subject
 *  that `mgx:guards` both is there too. Returns `{ left, right, guard }` slot
 *  objects in the shape src/domain/domain.mjs:104-108 compiles, sorted by
 *  (left, right, guard). Pure. */
export function constraintsFromDrives(rows)
```

For the river world that yields exactly the two constraints `data/games/river.txt` states by hand:

```
{ left: "wolf", right: "goat",    guard: "farmer" }
{ left: "goat", right: "cabbage", guard: "farmer" }
```

This is the phase's whole point. The wolf's appetite for the goat is one fact, and the puzzle's rule
about leaving them alone is that same fact read by the planner. Edit `wolf mgx:consumes goat` away in
the page and the constraint disappears, the search space widens, and the plan gets shorter. Add
`wolf mgx:consumes cabbage` and it gets longer, or the plan wall reports that no crossing sequence
survives. Section 9.4 is where that becomes visible on the page.

A `consumes` pair with no guard yields no constraint. That is the town square: the fox eats goblins and
nobody guards anything, so the square gains no constraint rows and its behaviour is untouched.

Where a world states both a hand-authored `action-constraint` rule row and a derivable one, the two
merge and dedupe on `(left, right, guard)`. `compileDomain` already sorts its constraint list
(`domain.mjs:113-117`), so the merge order does not reach the search.

### 7.4 The four variants

The Wikipedia article names four puzzles, all traceable to Alcuin's *Propositiones ad Acuendos
Juvenes*. R3 ships the first as the world; the other three are what the vocabulary is designed to
reach, and each names what it still needs:

| puzzle | rule | what states it | status after R3 |
|---|---|---|---|
| wolf, goat and cabbage | neither pair may be left alone | `mgx:consumes` + `mgx:guards` | ships as the world |
| missionaries and cannibals (jealous husbands) | cannibals may not outnumber missionaries on either bank | a counting constraint over two classes | needs a `precond` shape that compares class populations; the existing `comparator` shape (`domain.mjs:84-91`) compares two named subjects, not two counts. Named as R3's follow-on, not built here |
| bridge and torch | two may cross at a time, and the torch must travel | a capacity number plus a co-travel effect | the co-travel effect ships (`river.txt`'s "makes the farmer stand on the target"); capacity needs a boat-load precondition |
| the man, woman and two children | the boat carries one adult's weight | `mgx:hasMass` plus a load comparison | the mass rows ship in R1; the boat-capacity precondition is the same open piece as bridge-and-torch |

R3's acceptance covers the first row. The other three are the reason section 15 names the
population-count and capacity preconditions as the next design increment rather than treating the
variant list as finished.

### 7.5 R3 tests

| file | what it holds |
|---|---|
| `test/domain/agent-traits.test.mjs` (extended) | `constraintsFromDrives` yields the two river constraints from the river world's rows; a `consumes` pair with no guard yields none; the output is sorted and identical across two row orders; a hand-authored and a derived constraint dedupe |
| `test/services/river-crossing.test.mjs` (new) | the packed river world compiles to a domain with the ferry action and two constraints; the opening state has exactly one legal move, `ferry goat-1 onto bank-west`; `findActionPath` returns 7 actions; retracting `wolf mgx:consumes goat` shortens the plan; adding `wolf mgx:consumes cabbage` reports the honest miss rather than a partial plan |
| `test/estate/pack-manifest.json` + `test/estate/pack-manifest.test.mjs` + `test/estate/world-sources-fresh.test.mjs` | the new world's files are in the manifest, its shard is inside its byte budget, and the committed source is fresh against its generator |
| `test/estate/model-manifest.test.mjs` | any new model is CC0 and credited |

### 7.6 R3 acceptance

```
node scripts/ensure-worlds-pack.mjs
npm run gen:worlds-pack
npm run test:fast
node --test test/services/river-crossing.test.mjs test/domain/agent-traits.test.mjs
npm run check:models
node --test "test/estate/*.test.mjs"
node --test test-e2e/domain-river.test.mjs
```

The last line is the regression that matters most: `data/games/river.txt`'s chat path must keep
solving at seven crossings while the world-pack path learns to do the same thing.

---

## 8. Phase R4 — the per-instance edit affordance

Goal: an actor card with its own editor, beside the whole-world one, editing only the selected
instance. Same debounce, same parse discipline, same honest miss.

### 8.1 `src/services/agent-editor.mjs`

Modelled on `src/services/mud-editor.mjs` and exporting the same four-part shape:

```js
export function renderAgentEditorText(rows, subject)                 // -> string
export function renderAgentClassText(rows, className)                // -> string
export function parseAgentEditorText(text)                           // -> { triples, unrecognized }
export function planAgentEditorSync(rows, subject, triples)          // -> { toAppend, toRemoveIds }
```

`renderAgentEditorText` prints the instance's own trait rows as sentences, then a commented block of
what it inherits and from where, read off `traitOriginOf`:

```
goblin-1 is called goblin.
goblin-1 looks like goblin.
goblin-1 weighs 8.
goblin-1 loses 0.06 each turn.
goblin-1 sees 3 cells.
goblin-1 evades fox.
goblin-1 eats crumb.
goblin-1 eats morsel.

# inherited from goblin (edit the class to change these for every goblin):
# goblin has no other stated drives.
```

The sentence table is closed, the way `mud-editor.mjs`'s is. One phrase per predicate, both
directions, so every sentence the renderer prints parses back to the row it came from. That
round-trip is the first test, mirroring `test/services/mud-editor.test.mjs:24`.

`planAgentEditorSync` diffs against the instance's own rows only. Retraction stays under the same
guard the world editor uses (`mud-browser-entry.mjs:263-273`): nothing is retracted while any line is
unparsed, so a half-typed line never reads as a deletion.

### 8.2 The class tab

The sketch asks for the class text to be reachable from the same affordance. The card carries two
tabs, **this goblin** and **all goblins**, over the same editor component, with the class tab writing
to the class subject. This needs one rule stated in the plan and enforced by a test, because it is the
only place the design can surprise someone:

> **Editing a class changes every trait an instance has not overridden, and leaves the overridden ones
> alone.** An instance's own row wins on the chain (R1.2), and R2's spawn copies every trait onto every
> instance at spawn. So on a running board, a class edit changes nothing until something spawns, and the
> card says so in one line under the class tab: "goblin-1, goblin-2 and goblin-3 already carry their own
> copies. This changes the next goblin to arrive."

There is a second, friendlier option, and the plan picks the first deliberately: a class edit could
re-copy onto every instance that has not been hand-edited. That needs the editor to distinguish a
copied row from an edited one, which the `spawn:` provenance tag (R1.3) makes possible. It is not in
R4 because it turns one edit into an unbounded write across the board mid-turn, and because the
honest, explainable rule is the one a visitor can predict. Section 15 records it as the next
increment.

### 8.3 The page wiring

In `src/services/mudiii-viz.mjs`, beside the existing `.edit-stage` (`:705-711`):

- **reuse `#agentSelect`** (`:648-651`) as the actor selector rather than adding a second one. It
  already names the followed agent and already drives the camera and the drive ring, so one selection
  now means one thing across the camera, the ring, the actor card and R5's panels. It is disabled while
  the board plays (`:1243`), which means editing an actor means pausing first. That is the right
  behaviour and the card says so rather than silently doing nothing.
- an `.actor-card` holding the two tabs, a `<textarea id="actorEditorText">`, a status line
  (`.edit-status`, the same three states the world editor uses) and the same suggestion pills the world
  editor already renders through `relatedForTerm`/`classAncestorChain` (`:1714-1732`).
- the same 450ms debounce (`:1751`) into an `applyActorEditorText` that calls a new
  `session.applyAgentEdit(subject, text)`.

In `src/surfaces/web/mudiii-browser-entry.mjs`, `applyAgentEdit(subject, text)` beside `applyEdit`
(`:284`), returning the same `{ unrecognized, added, removed }` shape.

**A trait edit must not re-cast the board.** `rebuildSceneFromEdit` re-casts whenever a world edit
added or removed anything (section 1.5, item 2), and `recastTownSquare` bumps the epoch and re-mints
every agent at a fresh seeded cell. A visitor who changed one goblin's vision radius and watched the
whole square jump would reasonably read that as a bug. So `applyActorEditorText` takes its own path:
re-read the traits, redraw the label and mesh for that one agent, redraw the panels, and leave every
placement alone. It never calls `session.recast`. The test that pins it asserts every agent's cell is
unchanged across a trait edit.

### 8.4 R4 tests

| file | what it holds |
|---|---|
| `test/services/agent-editor.test.mjs` | every sentence the renderer prints parses back and re-syncing writes nothing; an unknown phrase is an honest miss, never a guessed triple; the inherited block names the class each trait came from; a class-tab render prints the class's own rows only; `planAgentEditorSync` touches no row of another instance |
| `test/services/mudiii-viz.test.mjs` (extended) | the rendered page carries the actor selector, the two tabs, the actor textarea and the status line; every interpolation goes through `escapeHtml` |
| `test/adapters/mudiii-browser-entry.test.mjs` (extended) | `applyAgentEdit` writes only rows whose subject is the named instance; an unparsed line retracts nothing; editing `goblin-1` leaves `goblin-2`'s rows byte-identical; a trait edit leaves every agent's cell and the world epoch unchanged, so no re-cast fired |

### 8.5 R4 acceptance

```
npm run test:fast
node --test test/services/agent-editor.test.mjs test/services/mudiii-viz.test.mjs \
            test/adapters/mudiii-browser-entry.test.mjs
npm run build:mudiii-bundle
npm run demo:build
```

---

## 9. Phase R5 — beliefs and plans on the page, recalculated live

Goal: the selected actor's beliefs and its plan are visible, and both recompute on every edit without
advancing a turn.

### 9.1 The belief panel

`beliefSnapshotFor` (`src/domain/agent-belief.mjs:88`) already returns the flat, sorted
`{ subjectId: cellId | null }` map, and the tick payload already carries it per agent. The panel
renders one row per key:

| subject | what the actor believes | how it knows |
|---|---|---|
| `fox-1` | `cell-11-8` | seen (inside its 3-cell radius) |
| `goblin-2` | `cell-4-6` | told, turn 4 |
| `morsel-1` | — | nothing seen, nothing told |

The third column comes from a new pure helper beside the snapshot,
`beliefOriginOf(target, observer, observerCell, state, opts) -> "seen" | { told: turn } | null`,
which is the same three-rung walk `believedCellOf` (`:49-59`) already performs, returning which rung
answered instead of the cell. Both must stay one walk, not two, for the same reason `mud-facts.mjs`
exists: two readers of one question drift.

A `null` row renders as an em dash and the words "nothing seen, nothing told". That is the miss wall
on the page, and the module's own header already names it as the point.

### 9.2 The plan panel

Two kinds of plan reach this page and the panel must not blur them:

- **the drive plan** — the direction sequence the tick engine produced for this agent
  (`findActionPath` over `gridApplyActions`, `predator-prey.mjs:349`), already in the tick payload's
  `plan` field. Rendered as the rung name, the goal line the engine already writes (`:543-554`), and
  the step list.
- **the puzzle plan** — the taught-action plan over the world's compiled domain (section 7.2),
  rendered as the numbered move list the chat lane already prints
  (`src/services/chat.mjs:13670-13675`). Present on the river world, absent on the town square, and
  the panel says which it is showing.

Both share one honest miss. `findActionPath` returns `null` on exhaustion (`planning.mjs:30-54`), and
the panel renders that as "no plan — nothing it believes reaches its goal" for the drive plan, or the
chat lane's own wording, "no plan found within N moves", for the puzzle plan. A `PlanBudgetError`
(`domain.mjs:51`) renders as the budget decline the chat lane already words
(`chat.mjs:13485`). Neither ever shortens, pads or invents a plan.

### 9.3 Recalculation without a turn

New export in `src/services/mudiii-turn.mjs`:

```js
/** Every live agent's belief map and plan, computed from the store as it stands
 *  right now, without writing a fact or advancing a turn. The same derivations
 *  runTownSquareTick performs, run for their answers instead of their effects. */
export async function agentOutlook(memoryDir, { layout, toldFacts = [], config, roles })
```

It returns `{ turn, agents: { id: { rung, goal, belief, plan, traits } }, puzzle: { moves, plan, miss } }`.
`townSquareBoard` (`predator-prey.mjs:1483`) is the existing precedent for "read the board without
playing it", and `agentOutlook` is its belief-and-plan sibling.

The page calls it in three places: on boot, after every `applyEdit`, and after every
`applyAgentEdit`. That is the sketch's "the plan should re-calculate as the edits are made in page".
The board does not move. Nothing is written. The panels redraw.

`plan.html` already does exactly this and is the precedent to copy. Its resolve button and its chat
dock both re-run the planner in the browser and re-render the board from the fresh plan
(`src/services/plan-viz.mjs:814-830`, `:833-846`, `applyPlan` at `:781-798`), and its miss wording is
already written: "no plan found within N moves — raise max search depth and try again" (`:827`). It
also handles a missing sibling bundle by disabling both docks with a stated reason
rather than failing silently (`:726-736`). R5 reuses that shape and that wording.

The determinism rule bites hardest here, because this is a read-time resolver over the fact store in
the sense `CLAUDE.md` means. `agentOutlook` must be a pure function of the rows: same rows, same
outlook, whatever order they arrived in and whatever the wall clock says. Seeded randomness is keyed by
`(layoutName, epoch, turn, id, purpose)` (`predator-prey.mjs:150-164`) and the turn does not advance,
so two calls between two edits return the same answer. The test is the two-orders check.

### 9.4 What an edit does, visibly

The sequence the e2e file walks, and the reason the feature is worth building:

1. Open the river scenario. Select `farmer-1`. The plan panel shows seven crossings, goat first.
2. Open the actor card for `wolf-1`. Delete the line `wolf-1 eats goat.`
3. Within one debounce, the constraint derived from that row disappears (7.3), the search widens, and
   the plan panel redraws with a shorter crossing sequence.
4. Type `wolf-1 eats cabbage.` The plan panel reports the honest miss rather than a partial plan.
5. Undo it. The seven-crossing plan returns, identical to step 1.

Step 5 is the determinism assertion in user-visible form.

### 9.5 R5 tests

| file | what it holds |
|---|---|
| `test/domain/agent-belief.test.mjs` (extended) | `beliefOriginOf` returns `"seen"` inside the radius, `{ told: N }` for the newest told fact, `null` for neither, and agrees with `believedCellOf` on every case in the existing suite |
| `test/services/mudiii-turn.test.mjs` (extended) | `agentOutlook` writes no fact and does not advance the turn; two calls with no edit between them return deep-equal results; the same rows in two orders return deep-equal results; an agent with no reachable goal returns a null plan and a stated reason |
| `test/services/river-crossing.test.mjs` (extended) | the R5.4 sequence at the service layer: retracting the consumes row shortens the plan, adding the second one produces the miss, restoring it returns the original seven moves byte-identically |
| `test/services/mudiii-viz.test.mjs` (extended) | the belief table, the plan panel and the miss wording all render; a null belief renders as the stated gap, never as a blank cell |

### 9.6 R5 acceptance

```
npm run test:fast
node --test test/domain/agent-belief.test.mjs test/services/mudiii-turn.test.mjs \
            test/services/river-crossing.test.mjs test/services/mudiii-viz.test.mjs
npm run demo:build
```

---

## 10. Phase R6 — page and site wiring

**The page decision, stated.** This ships on `mudiii.html` as a fourth scenario, not as a new
`river.html`. The sketch says "using mudiii.html", the scene, camera, editor and asset pipeline are
already there, and `scripts/site-pages.mjs`'s `DEMO_PAGES` stays at six, which keeps every count-pinning
estate test (`site-meta`, `home-page-links`, `og-images`, `screenshots`) untouched. The cost is that the
river crossing is one dropdown entry down rather than a landing surface of its own, which is the right
trade until the puzzle has a measured claim behind it (R8).

1. `scripts/build-demo-site.mjs:531` — add `"river-crossing"` to the `loadScenarioWorlds([...])` list
   and a label to `MUDIII_SCENARIO_LABELS`. The `castOf` helper (`:551-557`) mints the opening cast from
   `layoutNamed(...).cast`, so the river layout declares its four passengers there.
2. `src/domain/town-square-world.mjs` — the river layout: grid size, the two bank blocks, the missing
   exit edges that are the river, and the cast counts. `scripts/gen-town-square-worlds.mjs` regenerates
   the world source from it, which is what keeps the shipped world and the engine constants in step.
3. `public/mudiii-about.html` — a section on the mechanism: drives as facts, the class-to-instance
   copy, where the puzzle's constraint comes from, and the belief/plan panels. Cite Alcuin's
   *Propositiones ad Acuendos Juvenes* for the puzzle family, and the two papers hooks the repo already
   uses (abstention, open-world) for the miss wall.
4. `public/index.html` — the mudiii feature plate copy gains one clause about the puzzle scenario. No
   new card, no renumbering, no count change.
5. `public/share.mjs` — one or two new `POSTS.mudiii` entries about the fact-driven cast.
6. `public/screenshots/mudiii.png` + manifest — regenerate if the dashboard's shape moved;
   `scripts/gen-screenshots.mjs`'s `READY_CHECKS.mudiii` may need the actor card in its ready condition.
7. `NEXT.md:26-28` — replace the stale "design only" footnote with the credit line
   `backlog/PLAN_BARTLE.md` asks for, since the page has shipped and the condition the footnote was
   waiting on has already happened. `backlog/PLAN_BARTLE.md:1-5` records that the MUD1/MUD2 lineage
   credit is still missing from the page; R6 item 3 is the natural place to add it.

Acceptance:

```
npm run gen:worlds-pack
npm run demo:build
npm run check:links
node --test "test/estate/*.test.mjs"
node scripts/gen-screenshots.mjs && node --test test/estate/screenshots.test.mjs
```

---

## 11. Phase R7 — e2e and corpus rows

New spec, following `test-e2e/pages-mudiii.test.mjs`'s own `openMudiiiPage` helper (`:73-108`: a real
Chromium context with `--enable-unsafe-swiftshader`, third-party requests blocked, console errors
tracked, and a wait for the opening tick before any assertion):

| file | what it holds |
|---|---|
| `test-e2e/pages-mudiii-river.test.mjs` | the river scenario loads with zero console and page errors; `#agentSelect` lists the four passengers; selecting `farmer-1` shows a seven-move plan; the belief panel shows at least one "nothing seen, nothing told" row; the section 9.4 edit sequence end to end (delete the consumes line, plan shortens; add the second one, the miss wall appears with its stated wording; restore, the original seven moves return identically); no horizontal overflow at 375 and 320 px |

CI: add the file name to the `e2e:deployed:pages` job list in `.gitlab-ci.yml:735-753`. A spec named in
no job never runs, which is the standing hazard this repo has already been bitten by.

Corpus rows, in `test/corpus/games/mudiii.jsonl` (the row schema is
`{ id, key, note, turns, expect: [{ turn, mode, value }] }`, `mudiii.jsonl:1`) and
`test/corpus/planning.jsonl` for the plan-lane side:

| file | key | id |
|---|---|---|
| `games/mudiii.jsonl` | `games.mudiii.river.opening` | `mudiii-river-opens-with-four-passengers-on-the-east-bank` |
| `games/mudiii.jsonl` | `games.mudiii.river.legal` | `mudiii-river-opening-prunes-to-one-legal-crossing` |
| `games/mudiii.jsonl` | `games.mudiii.drives.instance-override` | `mudiii-one-goblin-stops-evading-without-touching-its-siblings` |
| `games/mudiii.jsonl` | `games.mudiii.drives.honest-gap` | `mudiii-an-undeclared-drive-reads-as-absent-never-as-a-default` |
| `planning.jsonl` | `planning.solve.river-from-facts` | `planning-the-packed-river-world-solves-at-seven-crossings` |
| `planning.jsonl` | `planning.solve.river-drive-edit` | `planning-retracting-a-consumes-fact-shortens-the-crossing-plan` |
| `planning.jsonl` | `planning.route.river-honest-miss` | `planning-an-unsolvable-crossing-reports-the-miss-not-a-partial-plan` |

Acceptance:

```
npm run test:fast
node --test test/corpus/games/mudiii.test.mjs test/corpus/planning.test.mjs
node scripts/corpus-matrix.mjs --gaps
node --test test-e2e/pages-mudiii-river.test.mjs
```

---

## 12. Phase R8 — the claims rung

The planner already has a measurement rig. `scripts/claims/claim-planner.mjs` grows an instance size
per domain until the median solve time crosses ten seconds, running every timed instance in its own
child process (`planner-worker.mjs`) so a runaway kills itself rather than the rig. The domains live in
`src/surfaces/web/planner-instances.mjs` (`PLANNER_DOMAINS:110`, `solvePlannerInstance:127`), re-exported
by `scripts/claims/planner-domains.mjs:9`, with `blocksworldRuleSentences:40` and
`gripperRuleSentences:78` as the authoring pattern.

R8 adds one domain and one claim:

1. `riverRuleSentences(passengerCount)` and `riverInstanceSentences(passengerCount)` in
   `planner-instances.mjs`, generalising the wolf/goat/cabbage chain to N passengers in a
   consumes chain guarded by one farmer. Three passengers is the classic puzzle; the envelope is what
   happens as the chain grows.
2. `PLANNER_DOMAINS.river` wired the same way as the other three.
3. A claims-page block, backed by the committed rig table, stating the crossing optimum the search
   reaches and the size at which it stops being fast, with the fixture provenance and the honest-miss
   framing. `scripts/site-pages.mjs`'s `CLAIMS_PAGE_BLOCKS` (`:108`) grows by one and
   `test/estate/claims.test.mjs` pins it. The block lands in the same commit as the first committed rig
   number, never before.

A second measurement is worth the same rig and is the more interesting one: **the same puzzle, taught
two ways.** `data/games/river.txt`'s hand-authored constraints and R3's derived ones must produce
identical plans at every size. That is a determinism claim about the bridge in 7.3, and it belongs in
`test/services/river-crossing.test.mjs` rather than the claims page.

Acceptance:

```
node --test test/adapters/planner-domains.test.mjs
npm run claim:planner
node --test test/estate/claims.test.mjs
```

---

## 13. Concurrency, serialization and model tiers

One owner per file per round.

| track | owns | depends on | model |
|---|---|---|---|
| R0 vocabulary | `ontology/tmct-core.ttl`, the phrase-table entries, `test/domain/agent-traits.test.mjs` (created) | — | Haiku |
| R1 traits | `src/domain/agent-traits.mjs`, `test/domain/agent-traits.test.mjs`, the `classChainOf` lift in `src/services/adventure.mjs` | R0 | Sonnet |
| R2 engine | `src/services/predator-prey.mjs`, `src/domain/game-config.mjs`, `test/services/predator-prey*.test.mjs`, `test/fixtures/mudiii-swapped-cast.json`, the trait rows in the town-square world sources | R1 | Fable |
| R3 world + bridge | `corpus/worlds/src/river-crossing.jsonl`, the river layout in `src/domain/town-square-world.mjs`, `scripts/gen-town-square-worlds.mjs`, `constraintsFromDrives` in `agent-traits.mjs`, `test/services/river-crossing.test.mjs`, `data/mudiii-assets.json` | R1 (R2 for the live board, not for the tests) | Sonnet |
| R4 editor | `src/services/agent-editor.mjs`, its test, the actor-card markup in `src/services/mudiii-viz.mjs`, `applyAgentEdit` in `src/surfaces/web/mudiii-browser-entry.mjs` | R1 | Sonnet |
| R5 outlook | `agentOutlook` in `src/services/mudiii-turn.mjs`, `beliefOriginOf` in `src/domain/agent-belief.mjs`, the panels in `src/services/mudiii-viz.mjs` | R2, R3, R4 | Sonnet |
| R6 site | `scripts/build-demo-site.mjs`, `public/mudiii-about.html`, `public/index.html`, `public/share.mjs`, `NEXT.md`, screenshots + manifest | R5 | Sonnet |
| R7 e2e + corpus | `test-e2e/pages-mudiii-river.test.mjs`, `.gitlab-ci.yml` job list, the `mudiii.jsonl` and `planning.jsonl` rows | R6 | Sonnet |
| R8 claims | `src/surfaces/web/planner-instances.mjs`, `scripts/claims/*`, `scripts/site-pages.mjs`'s block list, `test/estate/claims.test.mjs` | R3 (runnable), R6 (block lands) | Sonnet |

**What runs concurrently.** Wave 1: R0 alone, it is small and everything reads its table. Wave 2: R1
alone, because R2 through R5 all import it. Wave 3: R2, R3 and R4 together, which is the plan's widest
point. They share no file: R2 owns the engine, R3 owns the world sources and the bridge function, R4
owns the editor and the card markup. R3 and R4 both append to `agent-traits.mjs`, so R3 takes the
bridge function and R4 takes none, or they serialise on that file, whichever the coordinator prefers.
Wave 4: R5 alone, since it edits `mudiii-viz.mjs` after R4 has and `mudiii-turn.mjs` after R2 has.
Wave 5: R6, then R7, then R8's block.

**What serialises.**

- `src/domain/agent-traits.mjs` is the plan's own bottleneck. R1 creates it, R2 and R3 both add
  exports to it. Dispatch them with distinct top-level names named in the brief, for the reason
  `NEXT.md`'s merge note gives: sibling agents collide on top-level `const` and `function` names even
  when their content does not overlap, and `git merge` cannot resolve that.
- `src/services/mudiii-viz.mjs` (1,925 lines) is touched by R4 and R5. One at a time.
- `src/services/predator-prey.mjs` (1,536 lines) is R2's alone.

**Other plans' surfaces.** This plan does not touch `src/services/chat.mjs`, so it does not join the
`chat.mjs` queue that `PLAN_NEWS_FEED.md`'s phase 4, `PLAN_SYLLOGIST_EL_DL.md`'s 0b/2/3b/5 chain and
`PLAN_COMMON_SENSE_QA.md`'s F2/R2/R3/R4 all share. Two shared surfaces do need sequencing:

- `scripts/site-pages.mjs` — R8's `CLAIMS_PAGE_BLOCKS` entry lands in the same file
  `PLAN_COMMON_SENSE_QA.md`'s F4 and `PLAN_NEWS_FEED.md`'s phase 9 both edit. Three plans, one block
  list, one owner at a time.
- `scripts/build-demo-site.mjs` — R6 edits the mudiii block; `PLAN_NEWS_FEED.md`'s phase 7a adds a news
  block to the same file. Different blocks, same file, so they serialise.
- `src/services/adventure.mjs` — R1's `classChainOf` lift touches it. Nothing else in flight owns it,
  and the fallback in R1.2 removes the dependency entirely if that changes.

**Model tiers.** Sonnet is enough wherever this document fixes the data structures and signatures.
R2 earns Fable: it is a 1,536-line engine file, the change is a read-path substitution rather than a
new feature, and the proof of correctness is a byte-identical ten-tick tape that a subtle
misreading breaks silently. R0 is a vocabulary table and a doc edit, which is Haiku work.

**Sub-agent discipline.** Every dispatch brief caps testing at `npm run test:fast` plus the track's
own named files, and cites this section. Worktree prep for any track that runs tests:
`node scripts/ensure-worlds-pack.mjs`, `node scripts/ensure-sprite-facts.mjs`,
`npm run build:ask-bundle`. The full suite and the e2e tier are the coordinator's post-merge job. No
sub-agent runs `stash`, `reset`, `checkout --` or `clean`.

---

## 14. Costs and risks

- **R2 is a read-path substitution inside a big engine, and its failure mode is quiet.** A drive read
  through the wrong subject still produces a plausible board. The ten-tick tape is the guard, and it is
  the first command R2 runs, not the last. If the tape moves, the change is wrong; the fixture's own
  design note already forbids retuning it.
- **`src/domain/agent-traits.mjs` is three tracks' shared file.** Name collisions across concurrent
  branches are the known failure. Distinct names in the brief, and one merge at a time.
- **The class-edit rule will surprise someone.** "I changed the goblin class and nothing happened" is a
  reasonable reaction to R4.2's chosen semantics. The card's one-line explanation is doing real work,
  and the e2e spec should assert that the line is on screen as well as that the write went where it
  should.
- **Model licensing has bitten this page before.** A wolf model that turns out not to be CC0 costs the
  world file a rename, which is cheap because the class name is a fact. Check `npm run check:models`
  before the world file names anything.
- **Three of the four Wikipedia variants need a precondition shape that does not exist.** Counting
  populations across a bank and bounding a boat's load are both real design work on
  `src/domain/domain.mjs`'s precondition shapes, not wiring. R3 ships the one the shipped frames already
  reach and section 15 names the rest as the next increment.
- **Page weight.** `mudiii.html` already carries the three vendor bundle, which
  `backlog/PLAN_MUD_MUDIII.md:140-145` records as still unmeasured in `reports/PAGE_WEIGHTS.md`. One
  more world shard and a card's worth of markup is small beside it, but the page-weights refresh is
  worth running after R6 lands.
- **The plan panel invites a wrong reading.** A drive plan and a puzzle plan are different searches
  over different state spaces, and a panel that showed them in one list would teach the visitor
  something untrue. The panel names which it is showing, and the e2e spec asserts the label.
- **Three sentence tables will drift.** `mud-editor.mjs`'s `LINE_PATTERNS`,
  `mudiii-turn.mjs`'s `TOWN_SQUARE_TEACH_PATTERNS` and R4's new one all turn English into MUDIII facts.
  Nothing today stops two of them claiming one predicate with different wording. R4's header names the
  split, and a test that walks all three and asserts no predicate appears in two of them is cheap
  insurance.
- **R4 and R5 both edit a 1,925-line renderer with 118 tests.** `mudiii-viz.mjs` is the second-largest
  file this plan touches and the one most likely to produce a merge conflict. They run in different
  waves for that reason as much as for their dependency order.
- **The board must be paused to edit an actor.** `#agentSelect` disables while playing, so the actor
  card is closed mid-run. That is a real constraint on the demo's flow, and R4's copy has to make
  pausing feel like part of the gesture rather than an obstacle.

---

## 15. Not in this plan

- The counting precondition (missionaries and cannibals, jealous husbands) and the boat-capacity
  precondition (bridge and torch, the man and woman with two children). Both are new shapes on
  `src/domain/domain.mjs`'s precondition set, sequenced after R3 proves the derived-constraint bridge.
- Re-copying a class edit onto instances that were never hand-edited. The `spawn:` provenance tag
  (R1.3) is shaped to make it possible; R4.2 records why the simpler rule ships first.
- Multiplayer. `backlog/PLAN_MUD_MUDIII_SHARED.md` owns the share/join phase, and a fact-driven cast
  replicates over the existing P2P layer without changes, since drives are ordinary facts and
  `isMudiiiStatePredicate` (`predator-prey.mjs:139`) is the filter that would need the trait predicates
  added to it.
- A `[river]` config section. Every knob this plan adds is a fact, which is the point; the existing
  `DEFAULT_GAME_CONFIG.mudiii` numbers stay as the fallback and gain no siblings.
- Generating a river world at arbitrary sizes on the page. R8's rig generates N-passenger instances for
  measurement through the chat/CLI path; a page control for it is a separate piece of UI work.
- LLM involvement of any kind, on any path.
