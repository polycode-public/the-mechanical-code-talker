# PLAN_GAMES_UPLIFT_V3.md — spider-fly deep goals, a full sprite-emotion retrofit, and a five-page site redesign

Status: DESIGNED, build in progress.

## Origin

2026-07-19/20, operator instruction, verbatim intent, delivered across several messages this
session (nothing paraphrased away):

> Also in spider-fly there should be relevant pills like we have for the adventure game but these
> don't all have to be true, we can give false information to the spiders or the flies or just 1 fly.

> The spider's goal is to lay eggs, to lay eggs the spider needs to add mass, to add mass it needs
> to eat flies, the spider wants to take the fly to a web to eat it. Then when sufficient mass is in
> the spider and it is in the web it can lay an egg and \<spawn rate\> spiders hatch after 3 turns,
> the egg laying spider transfers mass to the egg which is split between the hatching spiders. The
> graphics could do with being a bit more animated and less diagrammatic, we have the new sprites,
> and still in a grid I think we should show this as a dusty corner of a window where the default
> web is in the top left corner and the flies are arriving in random spots on the window. The
> creatures that lose all their mass should drop to the bottom, for a few turns until the carcass
> rots. There should be user controls for spider-fly with mass loss rates, spawn rates, visual range
> per actor class.

> I want the various visualisations to use the new large sprites you created.

> For spider-fly, the last created plan for each agent and its current world knowledge graph should
> be displayed, and that plan should be used to determine which way the agent is facing even though
> we will re-plan before moving (and change direction).

> For anything that can show emotion there should be a parameterisation for the emotions supported
> by the ontology. [Operator confirmed, when asked to scope this: **full library retrofit** — every
> class that can plausibly show emotion, not just spider-fly/adventure.]

> I would like a version of the artefact added to the home page, and also I note that the home page
> is getting crowded. It should only have the fully expanded "Talk to it" and "Two agents, planning
> against each other" and "Run the chat yourself" and "Ask it about a codebase" and "Use it as a
> library" (in that order); "It plans, and shows the work" (which needs a similar uplift using the
> frontend-design plugin), "A text adventure, with a room you can actually see", and the new image
> swatches (which need to show their ontology mappings) become links instead. Drop "What an answer
> looks like".

> On the towers of hanoi planning problem page (full view) that should have the last created plan
> shown in PDDL (or whatever the latest richest variant is that we can use to describe our plans)
> and include the owl/rdf tags in there.

> Use the frontend design plugin to thematically style the full page views so they look like
> separate function-focused apps with different designs: "Talk to it" (webchat style, as has been
> fairly ubiquitous since ChatGPT), "Two agents, planning against each other" (game dashboard style,
> a bit like whatever the 90s classic Civilization turned into), "It plans, and shows the work"
> (pretty much as is in that sciency style, but with parameters I can change and a chat to assert new
> facts into the world, and a representation of the information used for planning), "A text
> adventure, with a room you can actually see" (RPG style, unrepresentative characterisations of
> various trite genre characters), and "Ledger" (a bit like telemetry tools such as New Relic, with
> more stats).

> The intent of the hanoi problem is to show the mechanics of non-linear planning, while spider-fly
> shows plans being clobbered in a system where there is partial and unreliable knowledge. The hanoi
> example is based on my bachelor's dissertation and spider-fly on my master's.

> We need Playwright tests that check all these user controls too, on both the embedded mode and in
> full screen, and that includes a chat in every chat interface expecting a sensible response.

> As the first task, write all the verbatim into a PLAN_\*.md doc along with your elaboration.

**The two flagship pages are a deliberate pair, and every design decision below should read that
way, not as two unrelated re-skins.** Hanoi/river (`plan.html`) is a bachelor's-dissertation-rooted
demonstration of classical, non-linear planning under COMPLETE knowledge — a plan, once found, is
correct and stays correct. Spider-fly is a master's-dissertation-rooted demonstration of the
opposite: planning under PARTIAL, UNRELIABLE knowledge, where a plan is only ever a best guess from
what's currently believed, gets re-computed every tick, and a deliberately false belief (fed by a
player's own pill or chat assertion) can make an agent's plan visibly wrong. The new per-agent
plan/knowledge-graph display (Part A) and the PDDL+OWL plan artifact (Part C) both exist to make
that contrast legible, not just decorative.

Both parts reuse substrate this project already ships: `src/domain/seeded-random.mjs` (mulberry32 +
`src/domain/hash.mjs`'s `fnv1a32`) for reproducible "randomness"; `findActionPath`/
`findReachableSet` (`src/domain/planning.mjs`) for movement search; `src/domain/sprite-map.mjs`'s
ontology-to-sprite resolver and `src/domain/sprite-templates.mjs`'s property-aware layer on top;
`src/services/viz-ticker.mjs`'s shared play/pause/step control; `src/services/viz-theme.mjs`'s
shared design tokens.

## Part A — spider-fly deep goals

### A.1 Current behavior (confirmed live, this session)

`PLAN_GAMES_UPLIFT_V2.md` Part A (wandering, spider-vs-spider avoidance, dynamic webs, spider mass,
exact-mass eat transfer) is fully shipped — its own status line was stale and has been corrected.
Confirmed gaps this Part closes: eating happens in place (no drag-to-web); egg-laying is gated on
"eats since the last live egg" with **no web-presence check at all**; hatch always produces exactly
one spider at flat initial mass, no mass transfer; pills are 6 word-fragment buttons
(`@spider`/`@fly` + 4 compass directions), nothing contextual; no in-page tuning controls exist
(`tmct.toml`'s `[games.spider-fly]` table is the only lever today); `spider-fly-viz.mjs` hardcodes
`propertyFacts: []`, so the property-aware sprite resolver is wired but unused; dead/starved
creatures vanish instantly, no animation; the icon-tier (44px) sprites are what's actually rendered
today, not the large tier.

### A.2 Design

**A.2.1 Carrying state.** New predicate `mgx:carrying` (spider → fly id, or `"none"`), rewritten
every tick by every live spider — the same always-rewritten idiom `mgx:currently-in`/`mgx:mass`
already use (fold-by-newest-turn needs this; a merely-stopped write would leave a stale "carrying"
row standing forever). `foldSpiderFlyState` gains `carrying: Map<spiderId, {flyId, turn}>`.
`runEcologyPass` splits today's single catch-and-eat rule into two: a new **catch** step (spider not
already carrying + an uncarried live fly share a cell, web or not → writes `mgx:carrying`) ahead of
the existing **eat** step (now gated on carrying AND standing in an active web — unchanged mass
math). Movement gains a new **priority 0**, above avoid-other-spiders: carrying, not yet delivered →
`planSpiderPathToWeb(spiderCell, applyActions, state, turn, webDurationTurns)` (goal test =
`hasActiveWebAt`, reused directly), falling back to `greedySpiderApproach(spiderCell, WEB_HOME, ...)`
if no path is found. A carrying spider never drops the fly to avoid another spider — no
spider-eats-spider mechanic exists anywhere in this engine, so "avoid" is resource contention, not
survival, and dropping the catch on every crossing would undermine the whole mass-economy goal
chain (judgment call, recorded here per the operator's brief not disambiguating the tie case). A
carried fly is fully inert (rides its captor's own cell, doesn't call its own movement) but its mass
still decrements and it can still starve mid-transit — an intended emergent failure mode, not a bug.
If the captor dies mid-carry, the fly self-heals to independent movement next tick for free (its
"am I carried" check requires the captor to still be live).

**A.2.2 Egg-laying gate.** `eggsEatenThreshold` removed outright (replaced, not extended). New
gate, checked per spider: `mass >= eggLayMassThreshold` (new constant, starting value **25**) AND
standing in an active web. Stays in the fixed pass order right where "lay" already sits (after
eat/starve, before hatch). The laying spider resets to exactly `spiderInitialMass`; the surplus
becomes the egg's own new `mgx:mass` fact (a new use of an existing predicate — rides
`foldSpiderFlyState`'s existing subject-agnostic mass fold for free). One-egg-at-a-time cap stays
unchanged (an orthogonal scaling knob, not part of this ask).

**A.2.3 Hatch.** New constants `eggHatchCount` (starting value **2**, deliberately distinct from
the existing `flySpawnIntervalTurns`) and `minHatchlingMass` (starting value **3**, a floor on
*count*, never on hatch mass): `actualHatchCount = max(1, min(eggHatchCount, floor(eggMass /
minHatchlingMass)))`. The egg's mass splits evenly across however many hatchlings that produces,
remainder to the lowest-numbered one — a too-small egg produces fewer, still-viable hatchlings
rather than emaciated ones.

**A.2.4 Deception pills.** No new grammar needed — `spider-fly-turn.mjs`'s existing
`@spider(-N)`/`@fly(-N)` addressing already resolves one specific numbered fly, all flies, or the
spider. New `pillsForSpiderFly(agents, explicitAddresseeId, opts)` in `spider-fly-turn.mjs`:
address pills (bare `@spider`/`@fly` while exactly one exists, numbered once more than one does),
one true-claim pill per candidate (nearest compass direction if genuinely adjacent, else the exact
cell — always expressible), and **one canonical false-claim pill** per candidate: the point
reflection of the subject's true cell through the board center (`cell-<11-x>-<11-y>` on this 10×10
board — deterministic, no seeded RNG needed since pills aren't persisted state, always in-bounds,
never accidentally true, since the reflection point never lands on an integer cell). Pills carry a
true/false tag shown only to the human; the submitted sentence itself is plain, indistinguishable
from a hand-typed lie. A new dynamic pill container sits alongside (not replacing) the existing
tested 6-button static rail.

**A.2.5 Corpses.** Visual-only, entirely inside `spider-fly-viz.mjs` — a `corpses` map
(`id → {spriteClass, cell, diedAtTurn}`), CSS-only grayscale/fade, repositioned to the bottom of the
dying agent's own column, pruned after `CORPSE_LINGER_TURNS` (page-local constant, **4**, not a
`game-config.mjs` gameplay knob). Zero change to the actual starve/eat removal logic.

**A.2.6 Window-corner re-skin.** Confirmed near-free: `WEB_HOME={x:2,y:2}` on this grid's
un-inverted x=left/y=top coordinate mapping already renders near the top-left corner, and "flies
arrive at random spots" is already exactly the existing seeded perimeter spawn. Scope is CSS/canvas
palette plus an optional decorative silk-line texture — zero grid-logic change.

**A.2.7 Per-agent plan + knowledge-graph display, and plan-driven facing (operator addendum).**
Each live agent's side-panel entry gains two new blocks: its **last-created plan** (the actual
step sequence `planSpiderPathToWeb`/`greedySpiderApproach`/`greedyFlyMove` most recently produced —
threaded back from the engine's own per-tick return, mirroring how `plan`/`goal` already ride on
the returned `agents` map) and its **current believed world state** (the cells/agents it currently
believes are where, from `believedCellOf`/`nearestBelievedTarget` — ground truth is NOT shown here,
only what the agent itself would act on, since making that gap visible is the whole point of this
page). The agent's **sprite orientation** (which way it visually faces) is derived from the first
step of its own current plan, not from its actual next move — since a fresh plan is computed before
every move, facing can visibly flip turn to turn as a plan gets clobbered and replaced, which is
the intended, honest demonstration of "plans get clobbered under partial/unreliable knowledge," not
a glitch to smooth over.

### A.3 Files touched

`src/services/spider-fly.mjs` (carrying fold + catch step, `planSpiderPathToWeb`, egg/hatch
constants, plan/belief threaded onto the returned `agents` map), `src/domain/spider-fly-world.mjs`
(`eggLayMassThreshold`, `eggHatchCount`, `minHatchlingMass`), `src/domain/game-config.mjs`
(`SPIDER_FLY_KEY_MAP` gains `egg_lay_mass_threshold`/`egg_hatch_count`/`min_hatchling_mass`, loses
`eggs_eaten_threshold`; gains per-class mass-loss-rate/spawn-rate/vision-radius as real in-page
controls, not file-only), `src/services/spider-fly-turn.mjs` (`pillsForSpiderFly`,
`oneStepDirectionBetween`), `src/services/spider-fly-viz.mjs` (corpses, dynamic pills, window
re-skin, plan/belief panels, facing rotation, large-sprite-tier wiring — see Part C.3),
`src/surfaces/web/spider-fly-browser-entry.mjs` (re-export `pillsForSpiderFly`),
`test/services/spider-fly.test.mjs` (breaking: the "planSpiderPath returns null outside the web
block" test must be removed/rewritten — arrival now means mere co-location, not co-location-in-web),
`test/services/spider-fly-turn.test.mjs`, `test/adapters/spider-fly-viz.test.mjs`,
`test/corpus/games/spider-fly.jsonl`.

## Part B — full sprite-emotion parameterization retrofit

### B.1 Current behavior (confirmed live)

`love/hate/fear/joy/anger/hope/surprise/pride` (+`anxiety`/`ire`) already resolve
`rdfs:subClassOf emotion` in the default-active `human` corpus bundle — real, live taxonomy, the
exact predicate `sprite-map.mjs`'s ancestor walk already reads. No instance-level "X currently
feels Y" predicate exists anywhere. `sprite-templates.mjs`'s resolver only applies ONE parameter
dimension per resolution today (`parameterizedFill` returns on the first successful fill) — a
template declaring both `[parameters.material]` and `[parameters.emotion]` would not compose
without a fix. Zero current sprite (of 203 files) has any face/eye/mouth/brow geometry.

### B.2 Design

**B.2.1 New predicate + vocabulary.** `mgx:feels`, curated to 6 words: happy, sad, angry, scared,
surprised, calm. Cross-checked against the corpus's real `emotion` subclass taxonomy — happy≈joy,
angry≈anger/ire, scared≈fear/anxiety, surprised≈surprise map cleanly to a drawable universal
expression; love/hate/hope/pride are excluded (no honest single facial expression, matching this
pack's own established emoji-fallback discipline for genuinely undrawable abstracts). `sad` is a
one-line taxonomy addition (`sad rdfs:subClassOf emotion`); `calm` is the deliberate no-strong-
emotion baseline, not drawn from the taxonomy.

**B.2.2 Resolver composition fix.** `sprite-templates.mjs`'s `parameterizedFill` →
`parameterizedFillAll`: iterate every parameter table, accumulate every successful fill onto the
running SVG string instead of returning on the first hit. Byte-identical for every existing
single-parameter template (confirmed: no in-scope class combines material and emotion on one file,
so `filledCount` is always 0 or 1 for every real file this pass ships — the composition fix proves
the general mechanism without needing a real dual-parameter fixture).

**B.2.3 Shared face-fragment scheme.** New `src/domain/sprite-expressions.mjs`
(`EXPRESSION_PALETTE`, `expandExpressionReferences`), mirroring `sprite-materials.mjs`'s exact
shape. A **required, validated** per-class `[face]` table (`cx`/`cy`/`scale`) — not one universal
anchor position, justified by real measured head-geometry variance already found across just 4
sample classes (`cy` 6.6→9.6, `r` 2.7→3.6). Two new `spriteTemplateProblems` checks enforce `[face]`
and `[parameters.emotion]` are always declared together. `{{FACE}}` is always the last child before
`</svg>` (paints over existing fill/highlights, mechanical for parallel authoring).

**B.2.4 What writes the fact.** Pure derivation for spider-fly, never persisted — a small
`emotionFor(agent, kind, maxMass)` fed by a `goalKind` discriminator already implicit in
`goalLineFor`'s own branching (just-ate→happy, carrying/chasing→angry, avoiding→scared,
holding/building→calm; a low-mass evading fly→scared, otherwise→calm). The 56 person-role classes
ship the CAPABILITY (a validated `-with-emotion.toml` sibling) with no dynamic emotion source wired
this pass — no live world currently emits `mgx:feels` for any adventure NPC, and inventing
adventure-mood mechanics wasn't asked for; an instance with no fact falls through to the existing
plain template, exactly the `dog`/`dog-with-colour` precedent.

**B.2.5 Staging.** Mirrors this session's own 160-sprite parallel build: one agent lands the shared
palette + resolver fix + tests first (blocking dependency); 6 agents for the 56 person-role files
(disjoint alphabetic batches); 1 agent for the 19 expressive-faced animal classes (cat, bear, lion,
tiger, wolf, owl, mouse, rabbit, sheep, cow, pig, elephant, frog, horse, bird, spider, fly, poodle,
dog — includes spider/fly, which Part A's `emotionFor` needs real art for); 1 agent last for the
full-file-set test coverage.

### B.3 Files touched

New: `src/domain/sprite-expressions.mjs`, `test/domain/sprite-expressions.test.mjs`, ~75 new
`data/sprites-large/{class}-with-emotion.toml` files (additive-only, existing plain templates
untouched). Edits: `src/domain/sprite-templates.mjs` (`parameterizedFillAll`, two new
`spriteTemplateProblems` checks), `src/adapters/corpus/sprite-large-template-files.mjs` (its final
`return expandMaterialReferences(templates)` becomes
`return expandExpressionReferences(expandMaterialReferences(templates))`), `test/adapters/
sprite-templates.test.mjs`, `test/adapters/sprite-large-template-files.test.mjs`.

## Part C — home page reorg + five per-page thematic redesigns

### C.1 Current state (confirmed live)

`public/index.html` is hand-maintained static HTML, not generated (`build-demo-site.mjs` only
stamps its version span). Current order: Talk to it (inline `#tmct-chat` div, own widget) → ledger
hero (iframe) → "What an answer looks like" (static transcript) → "It plans, and shows the work"
(`plan.html` iframe, **Hanoi-only today, build-time-static** — the CLI solves the puzzle and the
render is baked in at build time, unlike spider-fly/adventure's live browser sessions) → "Two
agents, planning against each other" (`spider-fly.html?preview=1` iframe) → "A text adventure…"
(`adventure.html?preview=1` iframe) → ELIZA/PARRY lineage paragraph (the e2e tests' hard boundary
marker) → "Ask it about a codebase" (`#tmct-demo`, a third separate embedded widget) → "Run the chat
yourself" (static CLI docs — **not a live page, no `chat.html` exists**) → "Use it as a library"
(static code) → footer. No sprite-catalog page exists anywhere in `public/` today — the large tier
is built into `sprites-pack/` but, per that build script's own comment, "no page fetches it yet."

### C.2 Home-page reorg

Exact order, fully expanded: Talk to it → Two agents, planning against each other → Run the chat
yourself → Ask it about a codebase → Use it as a library. Link cards (new "explore more" band): It
plans and shows the work, A text adventure, The memory ledger (**judgment call, flagged for the
operator to correct if wrong**: the ledger hero is absent from both of the operator's explicit
lists; the "fully expanded" list is introduced with "it should ONLY have" — an exhaustive-reading
word — so the consistent reading is that ledger demotes to a link too, joining the other three),
Sprite library (**new page**, `sprites.html` — swatches plus their ontology class→template→
ancestor-chain mappings, genuinely new work, not a re-theme). "What an answer looks like" dropped
entirely. "Talk to it" gains a full-screen destination it doesn't have today (`chat.html`, new
`renderChatHtml()`, reusing the existing chat engine/bundle — new shell only). `e2e/pages-index.
test.mjs` + `e2e/pages-home.test.mjs`'s hardcoded hero-order/content assertions need rewriting as
part of this step.

### C.3 Large-sprite-tier wiring

Spider-fly/adventure/the new pages switch from the inline-baked icon tier to fetching `sprites-pack/
manifest.json` at page load and resolving through it — the natural point to also wire real
`propertyFacts` through for both material and the new emotion parameter (today hardcoded `[]`).
Preview (`?preview=1`) and full-screen modes already share one HTML/JS payload, so this is one
change serving both. Graceful fallback to the icon tier if the fetch fails, matching this project's
own "never go blank because one asset had a hiccup" posture already used elsewhere.

### C.4 Five per-page redesigns (frontend-design skill, once per page)

1. **Talk to it (new `chat.html`)** — post-ChatGPT webchat: centered message column, bottom-fixed
   input, message bubbles. Signature element: a per-message provenance chip (taught/corpus/entailed
   — tmct's own distinguishing trait), not a generic bubble clone.
2. **Two agents, planning against each other (`spider-fly.html`)** — 90s-Civilization-descendant
   dashboard chrome (chunky beveled panels, stat-readout HUD, a resource-bar-style turn counter)
   WRAPPING the dusty-window-corner scene from Part A — two layers of one page, not competing
   directions. The new plan/belief panels (A.2.7) are natural HUD real estate for this theme.
3. **It plans, and shows the work (`plan.html`)** — keep the sciency visual language, add: live
   parameter controls (disk count / max search depth), a chat-assert surface to teach new facts
   into the running world, and a **PDDL-plus-OWL/RDF plan artifact panel** showing the last-created
   plan in the richest textual form tmct can express (a PDDL-style `(:action move-disk ...)` action
   sequence, each action's preconditions/effects annotated with the actual `rdf:type`/
   `rdfs:subClassOf`/`mgx:*` predicate tags the engine reasoned over — a real rendering of what
   `findActionPath` actually consulted, not decorative syntax). **Real open risk, not resolved
   here**: today's page is a build-time static replay, not a live session — confirm what a
   chat-driven Hanoi/planning lane needs in `chat.mjs` (existing lane, or a new one mirroring
   spider-fly/adventure's own) before designing the live-session architecture this needs.
4. **A text adventure (`adventure.html`)** — RPG-styled chrome (ornate portrait frames, class-badge
   iconography, parchment textures) as genre pastiche LAYERED OVER Ashcombe Hall's real content —
   never replacing the actual room/goal facts with generic fantasy, per this project's own
   honest-miss principle.
5. **Ledger (`ledger.html`)** — telemetry/New-Relic-adjacent stat tiles atop its existing (already
   densest) 3-column structure; "more stats" needs a real data-availability check at execution
   time — fact totals by provenance tier, corpus bundle breakdown, session/ingestion history, chat-
   lane usage counts — never an invented number.

### C.5 Files touched

New: `src/services/chat-viz.mjs` (or similarly named — `renderChatHtml`), `public/chat.html`,
`src/services/sprite-catalog-viz.mjs`, `public/sprites.html`, `src/services/plan-pddl.mjs` (the
PDDL+OWL/RDF plan renderer). Edits: `public/index.html` (full reorg), `src/services/plan-viz.mjs`
(controls + chat-assert + PDDL panel), `src/services/spider-fly-viz.mjs`/`adventure-viz.mjs` (large-
tier wiring), `e2e/pages-index.test.mjs`, `e2e/pages-home.test.mjs`.

## Part D — Playwright coverage

Every new user control (spider-fly's sliders + deception pills + carrying/hatch behavior + plan/
belief panels, the new `chat.html`, `sprites.html`, `plan.html`'s new controls and PDDL panel,
adventure's redesigned chrome), across BOTH embedded (home-page iframe/inline) and full-screen
modes, plus one chat-interaction-with-sensible-response assertion per page carrying a chat surface.
Baseline carried forward on every touched page: no console errors, no same-origin failures, no
horizontal overflow at 375px.

## Sequencing

Part A and Part B are independent file sets (Part B's palette must land before its own fan-out) and
run as two parallel coordinator-managed tracks. Part C depends on Parts A/B's OUTPUTS (sprites,
mechanics, plan data) but not their code, so its own scaffolding starts in parallel; final
sprite/plan wiring waits. Part D is last by construction. Every background agent gets this session's
own proven file-ownership-boundary discipline (disjoint filenames, frozen shared dependencies,
`test:fast` per worktree commit, full `npm test` only at the coordinator's merge-to-main).

## Non-goals for this pass

- Not a general two-or-more-simultaneous-parameter sprite system beyond material+emotion — the
  resolver fix is general, but no third dimension is designed or authored here.
- Not adventure-NPC mood mechanics — the 56 person-role emotion templates ship the capability, not
  a new "NPCs have feelings" gameplay system.
- Not a redesign of the belief/told-fact chat-integration seam beyond what deception pills need —
  the existing transient toldFacts mechanism is reused as-is, not rearchitected.
