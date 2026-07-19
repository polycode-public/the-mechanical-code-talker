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

### A.4 Interim progress checkpoint (mid-build, harvested from the implementing agent)

**Done**: A.2.2 (egg-lay gate) and A.2.3 (multi-hatch/mass-split), both in `runEcologyPass`.
**In progress**: A.2.1 (carrying — fold/catch-eat split done, priority-0 movement wiring next) and
A.2.7 (engine-side `plan[]`/`belief{}` threading in progress, viz panels/facing rotation not
started). **Not started**: A.2.4 (pills), A.2.5 (corpses), A.2.6 (window re-skin). No commits yet.

**Deviations/decisions beyond this doc's literal text, recorded so the plan stays accurate:**
1. Vision radius is split per class as `spiderVisionRadius`/`flyVisionRadius` (both default 4,
   `spider_vision_radius`/`fly_vision_radius` in `tmct.toml`) — A.3 named the requirement without
   naming keys; this is the chosen naming.
2. Per-class "spawn rate" control (the operator's later user-controls add-on) maps as: fly spawn
   rate = existing `flySpawnIntervalTurns`; spider spawn rate = `eggHatchCount` (how many hatch per
   egg) — matches the operator's own original wording ("\<spawn rate\> spiders hatch after 3 turns").
3. `runEcologyPass`'s `events.hatched` shape changed from `{egg, spider, cell}` to `{egg, cell,
   spiders: [{spider, mass}]}` (array) — unavoidable given multi-spider hatch; every consumer
   (agent injection, `renderTickText`, tests, corpus jsonl) is being updated to match.
4. A SECOND test invalidated beyond the one this doc already named: "spider eating two flies in the
   same tick credits both" (unit test + corpus row `sf-spider-eating-two-flies-same-tick-credits-
   both`) — the new one-fly-at-a-time carrying model makes the premise impossible. Being fixed
   alongside the flagged test, per this project's own "don't narrow scope on your own judgment"
   rule (folded in, not hived off).
5. Carrying priority-0 gained a second sub-case beyond this doc's text: "carrying AND already
   delivered (standing in the web)" holds still rather than falling through to the normal
   avoid/chase/hold chain — guarantees the eat step resolves the same tick delivery completes,
   rather than risking the spider wandering back out first.
6. `oneStepDirectionBetween` lives in `spider-fly-world.mjs` (shared geometry), not only
   `spider-fly-turn.mjs` as A.3 literally lists — the engine independently needs it for plan-driven
   facing, and `spider-fly-turn.mjs` already imports `spider-fly.mjs` (a reverse import would
   cycle). `spider-fly-turn.mjs` still exports/uses it for pills, backed by the shared primitive.
7. Every agent (not just chasing spiders) now carries a `plan` array (length 0 = held, 1+ = one
   greedy step or a full search path) — needed so every sprite, including flies, gets plan-driven
   facing per A.2.7, not only spiders with a multi-step search result.
8. A new `belief` field per agent (`{[otherAgentId]: cellId | null}`, via a new local
   `beliefSnapshotFor()`) feeds A.2.7's world-knowledge-graph panel.

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
`goalLineFor`'s own branching. Operator-confirmed concrete mapping: **a fleeing fly (evading a
believed-visible spider) shows fear; a spider that just ate shows joy/happy.** Full table: fly
evading→scared, fly wandering (no threat visible)→calm; spider just-ate-this-tick→happy, spider
carrying an uncaught-yet fly or mid-chase→angry (predatory focus), spider avoiding another
spider→scared, spider holding/building a web→calm. The 56 person-role classes
ship the CAPABILITY (a validated `-with-emotion.toml` sibling) with no dynamic emotion source wired
this pass — no live world currently emits `mgx:feels` for any adventure NPC, and inventing
adventure-mood mechanics wasn't asked for; an instance with no fact falls through to the existing
plain template, exactly the `dog`/`dog-with-colour` precedent.

**B.2.5 Staging.** Mirrors this session's own 160-sprite parallel build: one agent lands the shared
palette + resolver fix + tests first (blocking dependency); 3 agents for the 56 person-role files
(disjoint ~19-class batches, actually run — 3 agents proved enough, not 6); 1 agent for the 17
remaining expressive-faced animal classes (bear, lion, tiger, wolf, owl, mouse, rabbit, sheep, cow,
pig, elephant, frog, horse, bird, spider, fly, poodle — dog/cat already shipped as B.2.3's worked
examples).

**SHIPPED: all 56 person-role classes** (3 batches, all independently re-verified by the
coordinator — tests re-run directly, group-composite and headwear-collision judgment calls
screenshot-checked, including king/nurse/officer/queen/team/soldier/worker specifically). 59 total
`-with-emotion.toml` files now on `main` (3 worked examples + 56). Two of the three content agents
found their worktree had forked before the B.4 infrastructure merged and self-corrected with a
clean fast-forward `git merge main` before continuing — noted here since it's a real pattern worth
watching for in the remaining animal-batch agent too. One agent (batch 3) also caught and fixed an
authoring bug affecting all 18 of its own files (a stray literal `</content>` line breaking TOML
parsing, silently falling through to the plain template with no face at all) before it reached the
coordinator — full credit, this is exactly the "screenshot, find real problems, fix them" discipline
this session expects.

**PART B FULLY SHIPPED**: the 17-class animal batch (dog/cat already done as examples) landed too —
76 total `-with-emotion.toml` files on `main` (3 examples + 56 person-role + 17 animal). The
coordinator's own fresh screenshot review found wolf/tiger/horse read as close to illegible against
their own darker gradients (horse's face scale was roughly half the batch median) and fixed all
three directly (a light backing patch behind the face, the same technique these files already use
for their other highlights; horse's scale bumped to match the batch) — the dispatched agent's own
session had already ended by the time this was caught, so the coordinator applied and verified the
fix itself rather than losing the round trip. Also fixed two more pre-existing "assumes one template
per class" tests (same class of gap as the earlier `dog.parameters` fix), found by this same batch.
spider/fly's emotion sprites are now real and shipped — Part A's `emotionFor` wiring (task tracked
separately) is unblocked.

### B.3 Files touched

New: `src/domain/sprite-expressions.mjs`, `test/domain/sprite-expressions.test.mjs`, ~75 new
`data/sprites-large/{class}-with-emotion.toml` files (additive-only, existing plain templates
untouched). Edits: `src/domain/sprite-templates.mjs` (`parameterizedFillAll`, two new
`spriteTemplateProblems` checks), `src/adapters/corpus/sprite-large-template-files.mjs` (its final
`return expandMaterialReferences(templates)` becomes
`return expandExpressionReferences(expandMaterialReferences(templates))`), `test/adapters/
sprite-templates.test.mjs`, `test/adapters/sprite-large-template-files.test.mjs`.

### B.4 Infrastructure half — SHIPPED (merged to main, commit fe4496f + merge)

Independently re-verified by the coordinator (not just the implementing agent's own report): all
126 named blast-radius tests + 183/183 `test:fast` re-run green on the merged worktree AND again on
`main` post-merge; a fresh coordinator-run Playwright screenshot of all 6 emotions × the 3 example
classes at real 400px confirmed every expression reads distinctly and the no-fact case correctly
falls back to the plain template, zero console errors. Content-authoring wave (56 person-role + 19
animal `-with-emotion.toml` files) is unblocked — ready to dispatch.

**Done**: B.2.1 (`sad rdfs:subClassOf emotion` added to `corpus/tier2/generate.mjs`, regenerated +
`--verify`d), B.2.2 (`parameterizedFill`→`parameterizedFillAll`, verified byte-identical against
every real single-param template), B.2.3 (`sprite-expressions.mjs` + the two `spriteTemplateProblems`
pairing checks), the `sprite-large-template-files.mjs` wiring, and 3 example files (`dog-`, `cat-`,
`person-with-emotion.toml`). 126/126 tests green across the full blast radius (materials +
expressions + templates + large-files + map). **Still in progress**: Playwright screenshot
verification at real 400px, then commit — nothing committed yet as of this checkpoint.

**The confirmed `-with-emotion.toml` shape** (the next content-authoring wave must copy this
exactly):
```toml
classes = ["dog"]
svg = """
<svg viewBox="0 0 24 24" aria-hidden="true">
  ...same body as the plain {class}.toml, own gradient id "{class}-with-emotion-fill"...
  {{FACE}}
</svg>
"""

[face]
cx = 7      # same cx the class's own head circle already declares
cy = 9      # same cy
scale = 3.6 # same r (head radius) — EXPRESSION_PALETTE fragments are authored in a unit (radius-1) face

[parameters.emotion]
property = "mgx:feels"
placeholder = "{{FACE}}"

[parameters.emotion.values]
happy = "happy"
sad = "sad"
angry = "angry"
scared = "scared"
surprised = "surprised"
calm = "calm"
```
`[parameters.emotion.values]` is an identity map (the taught `mgx:feels` value IS the palette key
directly) — unlike material's gold→metal indirection, since the curated vocabulary word taught is
exactly the palette word.

**Deviations/decisions beyond this doc's text:**
1. `EXPRESSION_PALETTE` realizes the 6-word vocabulary directly as its own key set (mirroring
   `MATERIAL_PALETTE`'s own role) — there is no separate vocabulary-list constant.
2. `expandExpressionReferences` gates by predicate (`property === "mgx:feels"`), not by table name
   — decoupled from an author's naming choice; still requires the file's own `[face]` table
   present, `spriteTemplateProblems` is what flags a mismatch as wrong, not the resolver.
3. Face fragments are unit-scale (radius 1, origin-centered), fixed ink colour `#000000` (matching
   this project's existing fixed-shadow/highlight convention, not `currentColor`, since a face must
   read against any body fill/material) — `expandExpressionReferences` wraps the matched fragment
   in `<g transform="translate(cx cy) scale(scale)">` using the template's own `[face]` table. Six
   distinct dot/circle-eye + path-mouth combinations, deliberately chosen so scared/surprised
   (both wide-eyed) and happy/calm (both content) stay visually distinct pairs, not just parameter
   variations of each other.
4. `dog-with-emotion.toml` drops `dog.toml`'s small eye-shadow ellipse (it sat exactly where the
   new eyes go) — documented inline in that file's own header comment so the content wave doesn't
   read it as an accidental omission.
5. Fixed one pre-existing test assertion (`dog.parameters === undefined` in
   `sprite-large-template-files.test.mjs`) that implicitly relied on `dog.toml` sorting first
   alphabetically — now filters explicitly for the plain (non-emotion) template, since
   `dog-with-emotion.toml` now sorts before `dog.toml`.

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

**Operator layout feedback on the CURRENT pre-redesign pages, given while these tracks were already
in flight — relayed directly to the implementing agents, recorded here too:**
- **Adventure**: the room-scene panel has too much unused space and should shrink to fit its real
  content; the "look" room-description text (currently a strip pinned to the very bottom of the
  whole page) should move up into the side column, between the action-history panel and the chat
  input, not stay banished below everything else.
- **Adventure**: the "rooms visited" map container currently grows/shrinks its height based on how
  many rooms are visited and how the directional layout falls — this pushes the goal panel and the
  bottom digest bar around inconsistently as the game progresses. Fix: a FIXED-size map container
  (scale or scroll the graph to fit), for both the existing play-mode map and the new edit-mode
  whole-map view.
- **Spider-fly**: the "agents" HUD panel is pinned to the top of the side column but its height
  grows with the live agent count, pushing the chat/pills panel down inconsistently — gets worse
  once multi-hatch (A.2.3) can spawn several agents at once. Fix: a fixed-height, internally
  scrolling agents panel. Also: a large unused horizontal gap sits between the board and the side
  column — the column should use the available width, not leave it empty.

1. **Talk to it (new `chat.html`)** — post-ChatGPT webchat: centered message column, bottom-fixed
   input, message bubbles. Signature element: a per-message provenance chip (taught/corpus/entailed
   — tmct's own distinguishing trait), not a generic bubble clone.

   **Interim progress checkpoint (mid-build, harvested from the implementing agent):** built
   `src/services/chat-page-viz.mjs` (`renderChatHtml()`, `provenanceChipFor()`), following the exact
   self-contained-page-builder pattern the other `*-viz.mjs` files use; wired into
   `build-demo-site.mjs` right after the existing chat-bundle/seed/reference-pack steps; confirmed
   via a real `demo:build` into a scratch dir that `chat.html` generates (315 lines) and reuses the
   SAME `chat-browser.bundle.js`/`chat-seed.json` the embedded widget already uses — no new bundle,
   no fork of `chat-ui.mjs`. Still to do: unit test, e2e Playwright test, live screenshots, one live
   chat turn, `test:fast`, commit — nothing committed yet as of this checkpoint.

   **Provenance-chip mechanism, a real design decision**: rather than new memory-lookup wiring, the
   chip is derived by parsing the SAME `"(source: ...)"` citation text `chat.mjs` already appends to
   most factual answers, classified through `provBucketFor` (`ledger-viz.mjs`, imported at build
   time, spliced via `.toString()` into the page's inline script) — zero changes to
   `chat.mjs`/`chat-browser-entry.mjs`/`chat-ui.mjs`. Multiple citations (a proof chain) resolve
   taught > entailed > corpus, mirroring `provBucketFor`'s own documented single-fact precedence
   applied across citations. A teach confirmation ("noted — remembered: …") cites nothing yet to
   read back, so `record.via === "assert"` stands in for "taught". A miss gets NO chip at all — the
   absence is the honest signal, not a fabricated fourth tier. Layout keeps identifiably-tmct touches
   inside the ChatGPT-shaped frame: `SERIF_STACK` for prose bubbles, `MONO_STACK` for the
   eyebrow/legend/chip labels and a literal `"tmct> "` prompt glyph prefixing user bubbles (this
   project's existing CLI-prompt convention); a permanent small legend in the header reuses
   `ledger.html`'s own tier wording verbatim. No manual light/dark toggle, matching every other page
   on the site today.
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
   `findActionPath` actually consulted, not decorative syntax).

   **De-risked by direct investigation (confirmed, not assumed):** a chat-driven planning lane
   ALREADY EXISTS — `chat.mjs`'s `PLAN_SOLVE_RE` ("solve it" / "solve the towers of hanoi" / "plan
   the moves") runs `findActionPath` over taught rules and taught goals today; teaching a new fact
   via ordinary chat then re-solving is already a first-class capability, not new plumbing. The
   spider-fly/adventure `*-browser-entry.mjs` pattern (seed a store, expose `turn(line)` over the
   real `runTurn`, thread a shared `planHolder` across calls) is generic, not
   adventure/spider-fly-specific, and mirrors directly onto a new `plan-browser-entry.mjs`. Every
   field the PDDL+OWL/RDF serializer needs already exists on the solved plan object: `plan.actions
   [i] = {name, subject, target, label}`, `plan.states` (the full before/after fact-row snapshot
   sequence — a precondition/effect block per action is a diff of consecutive states, no new
   tracking), `plan.goal`/`becauseText`. Predicates are already `mgx:*`/`rdf:type`/`rdfs:subClassOf`
   -tagged in the raw fact rows (`plan-viz.mjs`'s `displayPredicate` only strips the prefix for
   human display — the real tag sits right there unstripped). No existing serializer to any
   structured plan text format exists — the PDDL+OWL/RDF renderer is new code, but a pure
   formatting function over already-structured data, not a data-plumbing problem. Scope: medium for
   the live-session wiring (new `plan-browser-entry.mjs` + `build-plan-bundle.mjs`, mirroring the
   two existing ones almost exactly, plus swapping `build-demo-site.mjs`'s CLI-shell-out step for
   the live bundle), small-to-medium for the serializer (one new pure module, plan-in/text-out).

   **Interim progress checkpoint (mid-build, harvested from the implementing agent):** full
   investigation of the real code confirmed (`chat.mjs`'s `planLaneAnswer`/`PLAN_SOLVE_RE`,
   both existing `*-browser-entry.mjs` files, `plan-viz.mjs`, the current `build-demo-site.mjs`
   plan.html step, both bundle scripts, `import-file.mjs`'s exact mechanism, `domain.mjs`'s
   `compileDomain`/`compileGoal`/`attachPrefix`, `game-config.mjs`'s `planning.maxDepth`, and real
   test-file locations — `plan-viz` tests live at `test/adapters/plan-viz.test.mjs`, not
   `test/services/`). **Done**: `src/domain/hanoi-lesson.mjs` — a pure `hanoiLessonSentences
   (diskCount, {goalPeg})` generator reproducing `hanoi-3.txt`'s exact taught content for N=3,
   generalized to any disk count (every pairwise "smaller than" fact, matching the source file's own
   documented "scale" variation), one sentence per array entry so it maps 1:1 onto `runTurn()` calls
   the same way `import-file.mjs` teaches the committed file. **Not yet written**: `plan-pddl.mjs`,
   the `plan-viz.mjs` edits (controls/chat-dock/PDDL panel + a new exported `planToPageData`),
   `plan-browser-entry.mjs`, `build-plan-bundle.mjs`, the `build-demo-site.mjs` edit, tests, Playwright
   verification. No commits yet.

   **Design decisions beyond this doc's text:**
   - **Live-session seeding**: Hanoi has no structured fact corpus (unlike spider-fly/adventure) —
     its canonical source IS taught English sentences. So `createPlanSession()` seeds by running
     `hanoiLessonSentences()` one sentence at a time through the SAME `turn()`-over-`runTurn` wrapper
     adventure/spider-fly already use, not raw fact/rule appending — faithfully mirroring
     `import-file.mjs`'s own real mechanism rather than a shortcut.
   - **Controls**: disk-count control → a brand-new `createPlanSession({diskCount, maxDepth})`
     (fresh in-memory store, same idiom as spider-fly's own reset). Max-search-depth control →
     re-issues `"solve it."` on the SAME session via an optional per-call `gameConfig` override in
     `turn(line, {maxDepth})`, so a visitor can lower it to demonstrate the honest "no plan found
     within N moves" miss without resetting the puzzle.
   - **Chat-assert dock** is literally the existing chat-dock idiom (`session.turn(line)`) — no new
     plumbing: type a new fact, then "solve it" (or a button that sends it) — `PLAN_SOLVE_RE`'s
     existing lane re-solves from the current board once a new fact changes it.
   - **`plan.html` stays HYBRID, not fully converted to live-only**: keeps its existing build-time-
     static initial replay (`renderPlanHtml` keeps its current signature/embed shape, so
     `test/adapters/plan-viz.test.mjs`'s existing assertions keep passing largely unchanged) and ADDS
     a sibling live bundle + inline script that can re-mount a fresh plan (board + movelist + PDDL
     panel) after a live re-solve. `build-demo-site.mjs` swaps its CLI shell-out for an in-process
     call to the new `createPlanSession()` to produce the same initial hanoi-3 plan.
   - **PDDL/OWL-RDF shape settled on** (no real sample run yet at this checkpoint): a
     `(define (problem tmct-plan) ...)` block with `:objects` (each individual typed by its direct
     class from `plan.domain.classMembers`), an `:ontology` section rendering real `rdf:type`
     (individual→class) and `rdfs:subClassOf` (class→class) edges recovered from `classMembers`'
     one-hop structure, an `:ordering` section from `plan.domain.ordering`'s real `mgx:*-than` rows,
     `:init`/`:goal` using the UNSTRIPPED `mgx:` predicate tags straight off `plan.states`/
     `plan.goal.specs`, then one `(:action ...)` block per `plan.actions[i]` with
     `:precondition`/`:effect` built as a mechanical diff between `plan.states[i]` and
     `plan.states[i+1]` — exactly this doc's own "a diff of consecutive states, no new tracking"
     instruction.
4. **A text adventure (`adventure.html`)** — RPG-styled chrome (ornate portrait frames, class-badge
   iconography, parchment textures) as genre pastiche LAYERED OVER Ashcombe Hall's real content —
   never replacing the actual room/goal facts with generic fantasy, per this project's own
   honest-miss principle.

   **Plus a new "edit" mode (operator addendum), a live-linked world editor:** a text area opens
   showing the current world definition (the live fact store's own room/exit/placement/container
   facts, rendered as readable sentences — not the original build-time corpus source, since edits
   need to flow back into the RUNNING session). In edit mode the WHOLE map renders (every room, not
   just visited ones — a variant of the existing `visitedRoomGraph` layout with the visitation
   filter dropped), and clicking a room shows its contents (reusing `roomSceneObjects`/
   `worldDigestRows`, parameterized by the clicked room instead of the player's current one). As the
   text changes, the edited lines re-parse into fact rows, the world re-folds, and whichever room is
   currently being inspected re-renders live — a real text↔visual sync, not a one-way preview. As
   the user types, pills suggest relevant objects/predicates by looking up what's ontologically
   related to the word immediately before the cursor (an as-you-type autocomplete driven by the
   same relation/ancestor-lookup machinery the chat engine already uses for "related" queries — not
   a static wordlist). A general legend panel lists every known object/character class by its real
   icon (reusing the sprite resolution machinery), so an editor knows what's available to reference
   by name. This is real, substantial new scope beyond the RPG re-theme — treat it as the larger
   half of this page's work, not an add-on to the visual redesign.

   **Confirmed mechanisms (direct investigation this session, don't re-derive):**
   - **Text↔fact parsing**: the general chat `teachLane` grammar is the WRONG tool here — it's built
     for open-domain natural-language taxonomy teaching, wrapped in guards (questions, typos,
     discourse markers, existentials) that would fight a structured, line-by-line textarea parse.
     Instead: `worldDigestRows(rows, state)` (`src/services/adventure.mjs:414`) already turns fact
     rows into `{subject, predicate: <phrase>, object}` triples via a small closed phrase table
     ("is in the" / "is fixed in the" / "stands locked in the" / "has an exit <dir> to the" / etc.)
     — this is both a strong seed for the textarea's initial content AND the basis for a new,
     purpose-built parser: invert that SAME small phrase table (phrase string → predicate) rather
     than adapting the general teach grammar. Much smaller, much safer surface to get right.
   - **Real predicate vocabulary for a room's own definition** (confirmed via `foldWorldState`,
     `adventure.mjs:175-180` and `:385-391`): placement — `mgx:currently-in`, `mgx:located-in`,
     `mgx:fixed-in`, `mgx:stands-locked-in`, `mgx:hidden-in`; openness — `mgx:is-open`; exits —
     `mgx:has-exit-<direction>`; container/puzzle — `mgx:is-container`, `mgx:unlocks-with`,
     `mgx:is-npc`, `mgx:acts-on-turn`, `mgx:acts-toward`, `mgx:is-objective`.
   - **Cursor-suggestion lookup**: `relatedForTerm(rows, term, options)`
     (`src/domain/skos-view.mjs:98`) — confirmed synchronous, in-memory, no I/O, fast enough to run
     on every keystroke with zero caveats (the fact store is already fully loaded in a live
     session). Returns `null` on an honest miss or `{conceptId, prefLabel, altLabels, synonyms,
     related}`. Pair it with `classAncestorChain(className, factRows)`
     (`src/domain/sprite-map.mjs:164`, also pure/synchronous) for the complementary vertical is-a
     chain — `relatedForTerm` gives lateral skos-related/synonym neighbors, `classAncestorChain`
     gives the ancestor walk; combining both under the cursor word gives richer suggestions than
     either alone.
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
